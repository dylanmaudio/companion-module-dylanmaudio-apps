import { describe, expect, it } from 'vitest'
import { ConsoleState, eventPaths, faderPath, stereoPath, mutePath, paramPath } from './model.js'
import { SubscriptionRegistry } from './subscriptions.js'
import { QueryScheduler } from './scheduler.js'
import type { Intent } from '../protocol/intents.js'
import { PARAM_ASSIGN, PARAM_MAIN_ASSIGN } from '../protocol/intents.js'

describe('ConsoleState', () => {
	it('reports changed paths only on change', () => {
		const s = new ConsoleState()
		const ref = { type: 'input' as const, index: 1 }
		expect(s.apply({ kind: 'mute', ...ref, on: true })).toEqual([mutePath(ref)])
		expect(s.apply({ kind: 'mute', ...ref, on: true })).toEqual([])
		expect(s.apply({ kind: 'fader', ...ref, level: 107 })).toEqual([faderPath(ref)])
		expect(s.strip(ref).level).toBe(107)
		expect(s.apply({ kind: 'fader_ping', ...ref })).toEqual([])
	})
	it('a stereo link lands, and an identical one is not a change', () => {
		const s = new ConsoleState()
		const ref = { type: 'input', index: 1 } as const
		expect(s.apply({ kind: 'stereo', ...ref, linked: true, half: 'A', partner: 2 })).toEqual([stereoPath(ref)])
		expect(s.strip(ref).stereo).toEqual({ linked: true, half: 'A', partner: 2 })
		expect(s.apply({ kind: 'stereo', ...ref, linked: true, half: 'A', partner: 2 })).toEqual([])
		expect(s.apply({ kind: 'stereo', ...ref, linked: false, half: undefined, partner: undefined })).toEqual([
			stereoPath(ref),
		])
	})

	it('first name learned counts as a change even if equal to the default', () => {
		const s = new ConsoleState()
		const ref = { type: 'input' as const, index: 3 }
		expect(s.strip(ref).name).toBe('Ip 3')
		expect(s.apply({ kind: 'name', ...ref, name: 'Ip 3' })).toHaveLength(1)
		expect(s.apply({ kind: 'name', ...ref, name: 'Ip 3' })).toHaveLength(0)
		expect(s.strip(ref).nameKnown).toBe(true)
	})
	it('decodes the 0x40 assign value split into DCA and mute-group sets', () => {
		const s = new ConsoleState()
		const ref = { type: 'input' as const, index: 1 }
		s.apply({ kind: 'param', ...ref, param: PARAM_ASSIGN, value: 0x40 + 2 }) // DCA 3 on
		s.apply({ kind: 'param', ...ref, param: PARAM_ASSIGN, value: 0x58 + 0 }) // MG 1 on
		expect([...s.strip(ref).dca]).toEqual([3])
		expect([...s.strip(ref).muteGroups]).toEqual([1])
		s.apply({ kind: 'param', ...ref, param: PARAM_ASSIGN, value: 2 }) // DCA 3 off
		expect([...s.strip(ref).dca]).toEqual([])
		s.apply({ kind: 'param', ...ref, param: PARAM_MAIN_ASSIGN, value: 0x3f })
		expect(s.strip(ref).mainAssign).toBe(false)
		expect(eventPaths({ kind: 'param', ...ref, param: PARAM_ASSIGN, value: 1 })).toEqual([paramPath(ref, PARAM_ASSIGN)])
	})
	it('tracks scenes, sends and preamps', () => {
		const s = new ConsoleState()
		expect(s.apply({ kind: 'scene', scene: 129 })).toEqual(['scene'])
		s.sceneNames.set(129, 'Intro')
		expect(s.sceneName(129)).toBe('Intro')
		s.apply({ kind: 'send_level', type: 'input', index: 1, dest_type: 'mono_aux', dest_index: 2, level: 90 })
		expect(s.sendLevel({ type: 'input', index: 1 }, { type: 'mono_aux', index: 2 })).toBe(90)
		s.apply({ kind: 'mix_assign', index: 1, dest_type: 'mono_group', dest_index: 1, on: true })
		expect(s.mixAssigned(1, { type: 'mono_group', index: 1 })).toBe(true)
		s.apply({ kind: 'preamp_48v', bank: 'mixrack', socket: 5, on: true })
		expect(s.socket({ bank: 'mixrack', socket: 5 }).phantom).toBe(true)
	})
	it('reset forgets desk state but keeps scene names', () => {
		const s = new ConsoleState()
		s.apply({ kind: 'mute', type: 'dca', index: 1, on: true })
		s.sceneNames.set(1, 'Open')
		const changed = s.reset()
		expect(changed).toContain('mute/dca/1')
		expect(s.strip({ type: 'dca', index: 1 }).mute).toBeUndefined()
		expect(s.sceneNames.get(1)).toBe('Open')
	})
})

describe('SubscriptionRegistry', () => {
	it('maps feedbacks to paths both ways', () => {
		const r = new SubscriptionRegistry()
		r.touch('fb1', ['mute/input/1', 'name/input/1'])
		r.touch('fb2', ['mute/input/1'])
		expect(r.feedbacksFor(['mute/input/1']).sort()).toEqual(['fb1', 'fb2'])
		expect(r.feedbacksFor(['name/input/1'])).toEqual(['fb1'])
		expect(r.watchedPaths().sort()).toEqual(['mute/input/1', 'name/input/1'])
		const v = r.version
		r.touch('fb1', ['mute/input/1', 'name/input/1']) // unchanged → no version bump
		expect(r.version).toBe(v)
		r.touch('fb1', ['fader/input/2'])
		expect(r.feedbacksFor(['name/input/1'])).toEqual([])
		r.remove('fb2')
		expect(r.isWatched('mute/input/1')).toBe(false)
	})
})

describe('QueryScheduler', () => {
	function make(opts = {}) {
		const sent: Intent[] = []
		const logs: string[] = []
		const s = new QueryScheduler(
			(i) => sent.push(i),
			(_l, m) => logs.push(m),
			{
				inFlight: 2,
				replyTimeoutMs: 100,
				pingCoalesceMs: 40,
				settleMs: 200,
				pollIntervalMs: 50,
				backoffMs: 1000,
				missesToBackOff: 2,
				...opts,
			},
		)
		s.setEnabled(true)
		return { s, sent, logs }
	}
	const getFader = (i: number): Intent => ({ op: 'get_fader', type: 'input', index: i })

	it('dedupes by path and respects the in-flight window', () => {
		const { s, sent } = make()
		for (let i = 1; i <= 4; i++) s.request({ intent: getFader(i), path: `fader/input/${i}`, priority: 'normal' }, 0)
		s.request({ intent: getFader(1), path: 'fader/input/1', priority: 'normal' }, 0)
		expect(s.queueLength).toBe(4)
		s.tick(0)
		expect(sent).toHaveLength(2)
		expect(s.inFlight).toBe(2)
		s.onReplyPaths(['fader/input/1'])
		s.tick(1)
		expect(sent).toHaveLength(3)
		expect(s.stats.replied).toBe(1)
	})
	it('high priority jumps the queue', () => {
		const { s, sent } = make({ inFlight: 1 })
		s.request({ intent: getFader(1), path: 'fader/input/1', priority: 'low' }, 0)
		s.request({ intent: getFader(2), path: 'fader/input/2', priority: 'high' }, 0)
		s.tick(0)
		expect(sent[0]).toEqual(getFader(2))
	})
	it('backs off an op after consecutive misses and logs once', () => {
		const { s, sent, logs } = make()
		const get: Intent = { op: 'get_preamp_gain', bank: 'mixrack', socket: 1 }
		s.request({ intent: get, path: 'preamp_gain/mixrack/1', priority: 'normal' }, 0)
		s.tick(0)
		s.tick(101) // miss 1
		s.request({ intent: get, path: 'preamp_gain/mixrack/1', priority: 'normal' }, 102)
		s.tick(102)
		s.tick(203) // miss 2 → back off
		expect(s.stats.missed).toBe(2)
		expect(s.isBackedOff('get_preamp_gain', 204)).toBe(true)
		expect(s.request({ intent: get, path: 'preamp_gain/mixrack/1', priority: 'normal' }, 205)).toBe(false)
		expect(logs).toHaveLength(1)
		expect(sent).toHaveLength(2)
		expect(s.isBackedOff('get_preamp_gain', 1300)).toBe(false)
	})
	it('background-polls watched paths round-robin when idle', () => {
		const { s, sent } = make()
		let version = 1
		const targets = [1, 2, 3].map((i) => ({
			intent: { op: 'get_send_level', type: 'input', index: i, dest_type: 'mono_aux', dest_index: 1 },
			path: `send/input/${i}/mono_aux/1`,
		}))
		s.setPollProvider(
			() => targets,
			() => version,
		)
		s.tick(0)
		expect(sent).toHaveLength(1)
		s.tick(10)
		expect(sent).toHaveLength(1) // interval not elapsed
		s.tick(50)
		expect(sent).toHaveLength(2)
		s.onReplyPaths(['send/input/1/mono_aux/1', 'send/input/2/mono_aux/1'])
		s.tick(100)
		s.tick(150)
		expect(sent.map((i) => (i as { index: number }).index)).toEqual([1, 2, 3, 1])
		version = 2
		s.setPollProvider(
			() => [],
			() => version,
		)
		s.onReplyPaths(['send/input/3/mono_aux/1', 'send/input/1/mono_aux/1'])
		s.tick(200)
		expect(sent).toHaveLength(4)
	})
	it('drops everything when disabled', () => {
		const { s, sent } = make()
		s.request({ intent: getFader(1), path: 'fader/input/1', priority: 'normal' }, 0)
		s.setEnabled(false)
		s.tick(0)
		expect(sent).toHaveLength(0)
		expect(s.queueLength).toBe(0)
	})
})
