import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConsoleLink } from './link.js'
import { FakeTransport } from './transport/transport.js'
import { encode } from './protocol/encode.js'
import { faderPath } from './state/model.js'

const HDR = [0xf0, 0x00, 0x00, 0x1a, 0x50, 0x10, 0x01, 0x00]
const nameReply = (n: number, addr: number, name: string) => [
	...HDR,
	n,
	0x02,
	addr,
	...Array.from(name, (c) => c.charCodeAt(0)),
	0xf7,
]

describe('ConsoleLink', () => {
	let t: FakeTransport
	let link: ConsoleLink
	let statuses: string[]
	let changes: string[][]

	beforeEach(() => {
		vi.useFakeTimers()
		t = new FakeTransport()
		link = new ConsoleLink(t, {
			baseChannel: 1,
			syncScope: 'none',
			scheduler: { inFlight: 4, replyTimeoutMs: 100 },
			now: () => Date.now(),
		})
		statuses = []
		changes = []
		link.on('status', (s) => statuses.push(s))
		link.on('changed', (p) => changes.push(p))
		link.start()
	})
	afterEach(() => {
		link.stop()
		vi.useRealTimers()
	})

	it('is not Ok on TCP connect; only on the probe reply for Input 1', () => {
		t.connect()
		expect(statuses).toEqual(['connecting', 'probing'])
		expect(t.sent[0].bytes).toEqual(encode(0, { op: 'get_name', type: 'input', index: 1 }))
		t.receive(nameReply(0, 5, 'Wrong')) // a reply for another strip must not count
		vi.advanceTimersByTime(50)
		expect(link.status).toBe('probing')
		t.receive(nameReply(0, 0, 'Kick'))
		vi.advanceTimersByTime(50)
		expect(link.status).toBe('ok')
		expect(link.state.strip({ type: 'input', index: 1 }).name).toBe('Kick')
		expect(changes.flat()).toContain('connection')
	})

	it('reports failure with the MIDI-settings diagnostic when the desk never answers', () => {
		t.connect()
		vi.advanceTimersByTime(2_100) // probe timeout → miss 1, re-probe after 5 s
		expect(link.status).toBe('probing')
		vi.advanceTimersByTime(5_000 + 2_100)
		expect(link.status).toBe('failure')
		expect(link.statusMessage).toMatch(/Global MIDI Receive/)
	})

	it('a broadcast fader triple lands in state and feedback paths without asking for anything', () => {
		t.connect()
		t.receive(nameReply(0, 0, 'Kick'))
		vi.advanceTimersByTime(50)
		t.sent.length = 0
		// What firmware 2.12 actually sends when a fader moves on the surface, or
		// when any other client moves one: the complete triple, not a bare ping.
		t.receive([0xb0, 0x63, 0x0b, 0xb0, 0x62, 0x17, 0xb0, 0x06, 0x6b])
		vi.advanceTimersByTime(80)
		expect(link.state.strip({ type: 'input', index: 12 }).level).toBe(0x6b)
		expect(changes.flat()).toContain(faderPath({ type: 'input', index: 12 }))
		expect(t.sent).toHaveLength(0) // no Get: query-on-ping is retired
	})

	it('a bare select is counted, never answered — that loop cost a show machine 2,200 Gets/s', () => {
		t.connect()
		t.receive(nameReply(0, 0, 'Kick'))
		vi.advanceTimersByTime(50)
		t.sent.length = 0
		t.receive([0xb0, 0x63, 0x0b]) // a bare `63`: another client's select, relayed raw
		vi.advanceTimersByTime(80)
		expect(link.stats.faderPings).toBe(1)
		expect(t.sent).toHaveLength(0)
	})

	it('drops an orphan data entry instead of pairing it with a stale address', () => {
		t.connect()
		t.receive(nameReply(0, 0, 'Kick'))
		vi.advanceTimersByTime(50)
		changes.length = 0
		t.receive([0xb0, 0x63, 0x0b, 0xb0, 0x62, 0x17, 0xb0, 0x06, 0x6b])
		vi.advanceTimersByTime(20)
		// Another controller's partial NRPN, relayed verbatim by the desk. Pairing
		// it with the address still latched from the triple above is what invented
		// a phantom channel on 5 Sep.
		t.receive([0x90, 0x01, 0x7f, 0xb0, 0x62, 0x17, 0xb0, 0x06, 0x40])
		vi.advanceTimersByTime(20)
		expect(link.state.strip({ type: 'input', index: 12 }).level).toBe(0x6b) // unmoved
	})

	it('mutes from the surface arrive pushed, no Get needed', () => {
		t.connect()
		t.receive(nameReply(0, 0, 'Kick'))
		vi.advanceTimersByTime(50)
		t.sent.length = 0
		t.receive([0x94, 0x36, 0x7f]) // DCA 1 muted
		vi.advanceTimersByTime(10)
		expect(link.state.strip({ type: 'dca', index: 1 }).mute).toBe(true)
		expect(t.sent).toHaveLength(0)
	})

	it('sets are mirrored optimistically and fades emit on change only', () => {
		t.connect()
		t.receive(nameReply(0, 0, 'Kick'))
		vi.advanceTimersByTime(50)
		t.sent.length = 0
		link.send({ op: 'mute', type: 'input', index: 2, on: true })
		expect(link.state.strip({ type: 'input', index: 2 }).mute).toBe(true)
		link.send({ op: 'fader', type: 'input', index: 2, level: 107 })
		link.fadeTo({ type: 'input', index: 2 }, { lv: 95 }, 500)
		vi.advanceTimersByTime(600)
		const faders = t.sent.filter((s) => s.bytes[1] === 0x63 && s.bytes.length === 9).map((s) => s.bytes[8])
		expect(faders[0]).toBe(107)
		expect(faders[faders.length - 1]).toBe(95)
		expect(faders.length).toBeLessThan(20)
		for (let i = 1; i < faders.length; i++) expect(faders[i]).toBeLessThan(faders[i - 1])
	})

	it('surface-role intents ride the MixRack socket when no surface is configured', () => {
		t.connect()
		link.send({ op: 'surface_cc', cc: 64, value: 127 })
		expect(t.sent[t.sent.length - 1]).toEqual({ role: 'mixrack', bytes: [0xb0, 64, 127] })
	})

	it('disconnect resets state and stops the scheduler', () => {
		t.connect()
		t.receive(nameReply(0, 0, 'Kick'))
		vi.advanceTimersByTime(50)
		t.drop()
		expect(link.state.strip({ type: 'input', index: 1 }).nameKnown).toBe(false)
		expect(link.scheduler.isEnabled).toBe(false)
		expect(link.status).toBe('connecting')
	})
})
