/**
 * BridgeLink against a mock Client API v1 server. The mock's shapes are
 * checked against fixtures/api/exchanges.json (authored bridge-side,
 * vendored here) so the two implementations can't drift silently.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BridgeLink, deltaToEvent, type BridgeLinkOptions } from './bridgelink.js'
import { encode, toHex } from '../protocol/encode.js'

const here = dirname(fileURLToPath(import.meta.url))
const exchanges = JSON.parse(readFileSync(join(here, '..', '..', 'fixtures', 'api', 'exchanges.json'), 'utf8')) as {
	cases: {
		id: string
		request: { method: string; path: string; body?: Record<string, unknown> }
		response: { status: number; body: Record<string, unknown> }
		sends?: string[]
	}[]
}
const fixture = (id: string) => {
	const c = exchanges.cases.find((x) => x.id === id)
	if (!c) throw new Error(`no api fixture ${id}`)
	return c
}

interface Cmd {
	body: Record<string, unknown>
}

/** A cmd carries its intent in an envelope: { v, lane_id, intent: { op, … } }. */
const queriesTo = (bridge: MockBridge): Record<string, unknown>[] =>
	bridge.cmds.map((c) => c.body.intent as Record<string, unknown>).filter((intent) => intent?.op === 'query')

const queriesOn = (bridge: MockBridge, lane: string): Record<string, unknown>[] =>
	queriesTo({ cmds: bridge.cmds.filter((c) => c.body.lane_id === lane) } as MockBridge)

class MockBridge {
	server!: Server
	port = 0
	baseChannel = 1
	consoleState = 'connected'
	snapshot: Record<string, unknown> = {}
	seq = 100
	cmds: Cmd[] = []
	hellos: Record<string, unknown>[] = []
	laneCounter = 0
	activeLanes = new Set<string>()
	resyncNextStream = false
	rejectCmdOnceWith: number | null = null
	/** the error code that rejection carries (default: what a reaped lane gets) */
	rejectCode: string | null = null
	/** answer hello with this instead (a token the bridge won't take) */
	refuseHello: { status: number; body: Record<string, unknown> } | null = null
	cmdDelayMs = 0
	infos = 0
	/** a dead link: nothing is answered and nothing more reaches the stream, but nothing closes */
	frozen = false
	private held: ServerResponse[] = []
	private sse: ServerResponse | null = null

	async start(): Promise<void> {
		this.server = createServer((req, res) => void this.route(req, res))
		await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r))
		const addr = this.server.address()
		if (typeof addr === 'object' && addr) this.port = addr.port
	}

	stop(): void {
		this.sse?.end()
		this.server.close()
		this.server.closeAllConnections()
	}

	pushEvent(kind: string, payload: Record<string, unknown>): void {
		if (this.frozen) return
		this.seq++
		const enriched = { v: 1, session: 'main', seq: this.seq, ts: Date.now(), ...payload }
		this.sse?.write(`id: ${this.seq}\nevent: ${kind}\ndata: ${JSON.stringify(enriched)}\n\n`)
	}

	get streamOpen(): boolean {
		return this.sse !== null
	}

	sseClose(): void {
		this.sse?.end()
		this.sse = null
	}

	private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
		const url = new URL(req.url ?? '/', 'http://x')
		const body = await readBody(req)
		if (this.frozen) {
			this.held.push(res)
			return
		}
		const send = (status: number, obj: unknown) => {
			res.writeHead(status, { 'Content-Type': 'application/json' })
			res.end(JSON.stringify(obj))
		}
		if (url.pathname === '/api/v1/info') {
			this.infos++
			send(200, {
				v: 1,
				session: 'main',
				api: 1,
				base_channel: this.baseChannel,
				capabilities: { raw: true, fade: true, query: true, fader_db: true, send_level: false },
				seq: this.seq,
			})
			return
		}
		if (url.pathname === '/api/v1/hello') {
			this.hellos.push(body)
			if (this.refuseHello) {
				send(this.refuseHello.status, this.refuseHello.body)
				return
			}
			const laneId = `ln_${String(++this.laneCounter).padStart(4, '0')}`
			this.activeLanes.add(laneId)
			send(200, { v: 1, session: 'main', lane_id: laneId, capabilities: { raw: true }, seq: this.seq })
			return
		}
		if (url.pathname === '/api/v1/state') {
			send(200, {
				v: 1,
				session: 'main',
				seq: this.seq,
				state: { 'connection.console': this.consoleState, ...this.snapshot },
			})
			return
		}
		if (url.pathname === '/api/v1/stream') {
			if (this.resyncNextStream) {
				this.resyncNextStream = false
				send(409, fixture('stream.resync').response.body)
				return
			}
			res.writeHead(200, { 'Content-Type': 'text/event-stream' })
			res.flushHeaders() // as the bridge does: end_headers() on an unbuffered handler
			this.sse = res
			res.on('close', () => {
				if (this.sse === res) this.sse = null
			})
			return
		}
		if (url.pathname === '/api/v1/cmd') {
			if (this.cmdDelayMs) await new Promise((r) => setTimeout(r, this.cmdDelayMs))
			if (this.rejectCmdOnceWith !== null) {
				const status = this.rejectCmdOnceWith
				this.rejectCmdOnceWith = null
				const code = this.rejectCode ?? (status === 401 ? 'unknown_lane' : 'capability_off')
				send(status, { ok: false, error: { code } })
				return
			}
			if (!this.activeLanes.has(String(body.lane_id))) {
				send(401, fixture('cmd.unknown_lane').response.body)
				return
			}
			this.cmds.push({ body })
			const intent = body.intent as Record<string, unknown>
			if (intent.op === 'send_level') {
				// Ungated in bridge 1.1.8 (cmd.send_level.ok). The status comes from
				// the fixture; the cid is echoed, since the link matches acks by it.
				const f = fixture('cmd.send_level.ok').response
				send(f.status, { ...f.body, cid: body.cid })
				return
			}
			send(200, { cid: body.cid, ok: true })
			return
		}
		if (req.method === 'DELETE' && url.pathname.startsWith('/api/v1/lane/')) {
			send(200, { ok: true })
			return
		}
		send(404, { ok: false })
	}
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
	return new Promise((resolve) => {
		let data = ''
		req.on('data', (c: Buffer) => (data += c.toString()))
		req.on('end', () => {
			try {
				resolve(data ? (JSON.parse(data) as Record<string, unknown>) : {})
			} catch {
				resolve({})
			}
		})
	})
}

async function waitFor(cond: () => boolean, what: string, timeoutMs = 4000): Promise<void> {
	const start = Date.now()
	while (!cond()) {
		if (Date.now() - start > timeoutMs) throw new Error(`timeout: ${what}`)
		await new Promise((r) => setTimeout(r, 10))
	}
}

describe('BridgeLink', () => {
	let bridge: MockBridge
	let link: BridgeLink
	let changes: string[][]
	let logs: string[]

	beforeEach(async () => {
		bridge = new MockBridge()
		await bridge.start()
		link = new BridgeLink({
			host: '127.0.0.1',
			port: bridge.port,
			laneName: 'dLive-test',
			baseChannel: 12,
			retryMs: 50,
		})
		changes = []
		logs = []
		link.on('changed', (p) => changes.push(p))
		link.on('log', (_l, m) => logs.push(m))
	})
	afterEach(() => {
		link.stop()
		bridge.stop()
	})

	it('hello matches the fixture shape, snapshot applies, status is probing-honest', async () => {
		bridge.snapshot = {
			'input.1.name': 'Kick',
			'input.1.mute': true,
			'input.5.fader': { lv: 95, db: -6.1 },
			'scene.current': 12,
		}
		link.start()
		await waitFor(() => link.isOk, 'ok')
		// hello body carries exactly the fixture request fields
		const fx = fixture('hello.ok').request.body as Record<string, unknown>
		expect(bridge.hellos[0]).toMatchObject({ v: fx.v, session: fx.session, kind: fx.kind })
		expect(bridge.hellos[0].name).toBe('dLive-test')
		// mirror landed in ConsoleState
		expect(link.state.strip({ type: 'input', index: 1 }).name).toBe('Kick')
		expect(link.state.strip({ type: 'input', index: 1 }).mute).toBe(true)
		expect(link.state.strip({ type: 'input', index: 5 }).level).toBe(95)
		expect(link.state.currentScene).toBe(12)
		expect(link.bridgeBaseChannel).toBe(1)
	})

	it('cold sync: asks about every strip in scope, and only for what the scope covers', async () => {
		link.stop()
		const wide = new BridgeLink({
			host: '127.0.0.1',
			port: bridge.port,
			laneName: 'cold',
			baseChannel: 12,
			retryMs: 50,
			strips: [
				{ type: 'input', index: 1 },
				{ type: 'input', index: 2 },
				{ type: 'dca', index: 3 },
				{ type: 'mute_group', index: 1 },
			],
			syncScope: 'names_state',
		})
		wide.start()
		await waitFor(() => queriesTo(bridge).length >= 4, 'queries')
		const queries = queriesTo(bridge)
		expect(queries).toContainEqual({
			op: 'query',
			type: 'input',
			index: 1,
			fields: ['name', 'colour', 'mute', 'fader'],
		})
		expect(queries).toContainEqual({
			op: 'query',
			type: 'input',
			index: 2,
			fields: ['name', 'colour', 'mute', 'fader'],
		})
		// every type in scope, not only inputs: scopedStrips counts these, stripCountsFor left them undefined
		expect(queries).toContainEqual({
			op: 'query',
			type: 'dca',
			index: 3,
			fields: ['name', 'colour', 'mute', 'fader'],
		})
		// a mute group has no fader to ask about
		expect(queries).toContainEqual({ op: 'query', type: 'mute_group', index: 1, fields: ['name', 'colour', 'mute'] })
		wide.stop()
	})

	it('cold sync: names asks for names and colours; none asks for nothing', async () => {
		link.stop()
		const names = new BridgeLink({
			host: '127.0.0.1',
			port: bridge.port,
			laneName: 'cold-names',
			baseChannel: 12,
			retryMs: 50,
			strips: [{ type: 'input', index: 1 }],
			syncScope: 'names',
		})
		names.start()
		await waitFor(() => queriesTo(bridge).length > 0, 'query')
		expect(queriesTo(bridge)).toEqual([{ op: 'query', type: 'input', index: 1, fields: ['name', 'colour'] }])
		names.stop()

		bridge.cmds = []
		const quiet = new BridgeLink({
			host: '127.0.0.1',
			port: bridge.port,
			laneName: 'cold-none',
			baseChannel: 12,
			retryMs: 50,
			strips: [{ type: 'input', index: 1 }],
			syncScope: 'none',
		})
		quiet.start()
		await waitFor(() => quiet.isOk, 'ok')
		expect(queriesTo(bridge)).toEqual([])
		quiet.stop()
	})

	it('reports failure (not ok) when the bridge is up but the console is down', async () => {
		bridge.consoleState = 'down'
		link.start()
		await waitFor(() => link.status === 'failure', 'failure')
		expect(link.statusMessage).toMatch(/console link is down/)
		// The link reports failure before it has reopened its stream; an event pushed
		// into no stream is lost, and the test then waits out its timeout.
		await waitFor(() => bridge.streamOpen, 'stream open')
		bridge.pushEvent('connection', { console: 'connected' })
		await waitFor(() => link.isOk, 'recovers')
	})

	it('deltas over SSE update state and emit changed', async () => {
		link.start()
		await waitFor(() => link.isOk && bridge.streamOpen, 'stream')
		bridge.pushEvent('delta', { path: 'input.3.mute', value: true, provenance: { source: 'surface' } })
		bridge.pushEvent('delta', { path: 'input.5.fader', value: { lv: 107, db: 0.0 }, provenance: { source: 'surface' } })
		bridge.pushEvent('scene', { number: 129, name: null })
		await waitFor(() => link.state.currentScene === 129, 'scene')
		expect(link.state.strip({ type: 'input', index: 3 }).mute).toBe(true)
		expect(link.state.strip({ type: 'input', index: 5 }).level).toBe(107)
		expect(changes.flat()).toContain('mute/input/3')
		expect(changes.flat()).toContain('fader/input/5')
	})

	it('first-class sets post the fixture intent verbatim; others ride op raw with module-encoded hex', async () => {
		link.start()
		await waitFor(() => link.isOk, 'ok')
		link.send({ op: 'mute', type: 'input', index: 1, on: true })
		await waitFor(() => bridge.cmds.length >= 1, 'cmd1')
		const fx = fixture('cmd.mute.input1.on').request.body.intent
		expect(bridge.cmds[0].body.intent).toEqual(fx)
		expect(bridge.cmds[0].body).toMatchObject({ v: 1, session: 'main' })
		// optimistic mirror
		expect(link.state.strip({ type: 'input', index: 1 }).mute).toBe(true)

		link.send({ op: 'main_assign', type: 'input', index: 2, on: true })
		await waitFor(() => bridge.cmds.length >= 2, 'cmd2')
		// hex must be the module encoder's bytes at the BRIDGE's base channel (1)
		expect(bridge.cmds[1].body.intent).toEqual({
			op: 'raw',
			hex: toHex(encode(0, { op: 'main_assign', type: 'input', index: 2, on: true })),
		})
	})

	it('fades go to the bridge fade op with to_lv', async () => {
		link.start()
		await waitFor(() => link.isOk, 'ok')
		link.fadeTo({ type: 'input', index: 5 }, 95, 2000)
		await waitFor(() => bridge.cmds.length >= 1, 'fade')
		expect(bridge.cmds[0].body.intent).toEqual({ op: 'fade', type: 'input', index: 5, to_lv: 95, over_ms: 2000 })
		// zero duration bypasses the fade op
		link.fadeTo({ type: 'input', index: 5 }, 0, 0)
		await waitFor(() => bridge.cmds.length >= 2, 'jump')
		expect((bridge.cmds[1].body.intent as { op: string }).op).toBe('fader')
	})

	it('send level goes through on a 1.1.8 bridge, in the wire shape the fixture pins', async () => {
		link.start()
		await waitFor(() => link.isOk, 'ok')
		const before = bridge.cmds.length
		link.send({ op: 'send_level', type: 'input', index: 1, dest_type: 'mono_aux', dest_index: 1, level: 100 })
		await waitFor(() => bridge.cmds.length > before, 'posted')
		const posted = bridge.cmds[bridge.cmds.length - 1].body
		const want = fixture('cmd.send_level.ok').request.body
		expect(posted.v).toBe(want.v)
		expect(posted.session).toBe(want.session)
		expect(posted.intent).toEqual(want.intent)
		await new Promise((r) => setTimeout(r, 50))
		expect(logs.some((l) => l.includes('capability_off'))).toBe(false)
		expect(link.diag().getsMissed).toBe(0)
	})

	it('capability_off is still reported politely — a 1.1.7 bridge gates send level', async () => {
		link.start()
		await waitFor(() => link.isOk, 'ok')
		// No fixture case pins the 409 any more (it moved to cmd.send_level.ok),
		// but an older bridge still answers this way and must not crash us.
		bridge.rejectCmdOnceWith = 409
		link.send({ op: 'send_level', type: 'input', index: 1, dest_type: 'mono_aux', dest_index: 1, level: 100 })
		await waitFor(() => logs.some((l) => l.includes('capability_off')), 'logged')
		expect(link.isOk).toBe(true)
		expect(link.diag().getsMissed).toBe(1)
	})

	it('409 on the stream resyncs from a fresh snapshot', async () => {
		link.start()
		await waitFor(() => link.isOk && bridge.streamOpen, 'stream up')
		bridge.snapshot = { 'input.9.name': 'Snare' }
		bridge.resyncNextStream = true
		bridge.sseClose()
		await waitFor(() => link.state.strip({ type: 'input', index: 9 }).name === 'Snare', 'resynced')
		await waitFor(() => bridge.streamOpen, 'stream re-established')
		expect(link.isOk).toBe(true)
	})

	it('a reaped lane re-registers on 401 and the command still lands', async () => {
		link.start()
		await waitFor(() => link.isOk, 'ok')
		bridge.rejectCmdOnceWith = 401
		link.send({ op: 'mute', type: 'input', index: 4, on: true })
		await waitFor(() => bridge.cmds.length >= 1, 'retried cmd')
		expect(bridge.hellos.length).toBe(2)
		expect((bridge.cmds[0].body.intent as { index: number }).index).toBe(4)
	})

	describe('across a network (#106)', () => {
		let watched: BridgeLink | null = null
		afterEach(() => watched?.stop())

		/** Short timings: answers within 200 ms, a quiet stream checked after 300 ms */
		const quick = (extra: Partial<BridgeLinkOptions> = {}): BridgeLink =>
			new BridgeLink({
				host: '127.0.0.1',
				port: bridge.port,
				laneName: 'watched',
				baseChannel: 12,
				retryMs: 50,
				requestTimeoutMs: 200,
				idleMs: 300,
				idleTickMs: 20,
				...extra,
			})

		it('a dead link ends the session within the watchdog time, and the desk stops reading as answering', async () => {
			link.stop()
			const w = (watched = quick())
			const statuses: string[] = []
			const changedPaths: string[] = []
			w.on('status', (s, m) => statuses.push(`${s} ${m ?? ''}`))
			w.on('changed', (p) => changedPaths.push(...p))
			w.start()
			await waitFor(() => w.isOk, 'ok')
			expect(w.state.connected).toBe(true)
			bridge.frozen = true
			const t0 = Date.now()
			await waitFor(() => !w.isOk, 'noticed', 3000)
			// quiet for 300 ms, then a question that gets no answer in 200 ms
			expect(Date.now() - t0).toBeLessThan(1500)
			expect(statuses).toContainEqual(
				expect.stringMatching(/^connecting Waiting for MIDI Bridge at 127\.0\.0\.1:\d+ \(stopped answering\)$/),
			)
			expect(w.state.connected).toBe(false)
			expect(changedPaths).toContain('connection')
		})

		it('a quiet bridge that still answers keeps its session', async () => {
			link.stop()
			const w = (watched = quick({ idleMs: 100 }))
			w.start()
			await waitFor(() => w.isOk, 'ok')
			const infosBefore = bridge.infos
			await new Promise((r) => setTimeout(r, 600))
			expect(bridge.infos).toBeGreaterThan(infosBefore) // the watchdog asked,
			expect(w.isOk).toBe(true) // was answered,
			expect(bridge.hellos.length).toBe(1) // and never reconnected
		})

		it('a lost press is a warning, and the link is checked at once rather than after the quiet', async () => {
			link.stop()
			const w = (watched = quick({ idleMs: 60_000 }))
			const warns: string[] = []
			w.on('log', (level, m) => {
				if (level === 'warn') warns.push(m)
			})
			w.start()
			await waitFor(() => w.isOk, 'ok')
			bridge.frozen = true
			w.send({ op: 'mute', type: 'input', index: 3, on: true })
			await waitFor(() => !w.isOk, 'noticed', 3000)
			expect(warns).toContain("mute didn't reach MIDI Bridge (no answer)")
		})

		it('says so when the bridge refuses the token, and asks again slowly', async () => {
			link.stop()
			bridge.refuseHello = { status: 401, body: { ok: false, error: { code: 'bad_token', message: 'Token required' } } }
			const w = (watched = quick({ refusedRetryMs: 10_000 }))
			const statuses: [string, string | undefined][] = []
			w.on('status', (s, m) => statuses.push([s, m]))
			w.start()
			await waitFor(() => w.status === 'refused', 'refused')
			expect(statuses.at(-1)?.[1]).toBe(
				"MIDI Bridge refused this connection (Token required). Check the bridge token in this connection's settings.",
			)
			await new Promise((r) => setTimeout(r, 300))
			expect(bridge.hellos.length).toBe(1)
		})

		it('a 401 on a command that is not a reaped lane does not re-register', async () => {
			link.start()
			await waitFor(() => link.isOk, 'ok')
			bridge.rejectCmdOnceWith = 401
			bridge.rejectCode = 'bad_token'
			link.send({ op: 'mute', type: 'input', index: 4, on: true })
			await waitFor(() => logs.some((l) => l.includes('bad_token')), 'rejection logged')
			expect(bridge.hellos.length).toBe(1)
		})

		it('a cold sync from an ended session stops asking', async () => {
			link.stop()
			const strips = Array.from({ length: 60 }, (_, i) => ({ type: 'input' as const, index: i + 1 }))
			bridge.cmdDelayMs = 15
			const w = (watched = quick({ strips, syncScope: 'names' }))
			w.start()
			await waitFor(() => queriesTo(bridge).length >= 8, 'first sync under way')
			bridge.sseClose() // the session ends mid-sync; the next one syncs again
			await waitFor(() => bridge.hellos.length === 2, 'second session')
			await waitFor(() => queriesOn(bridge, 'ln_0002').length >= 60, 'second sync done', 4000)
			await new Promise((r) => setTimeout(r, 200))
			// every strip asked once on the new lane: none of the old sync's leftovers
			expect(queriesOn(bridge, 'ln_0002').length).toBe(60)
			expect(queriesOn(bridge, 'ln_0001').length).toBeLessThan(60)
			expect(bridge.hellos.length).toBe(2)
		})

		it('brackets an IPv6 address', () => {
			link.stop()
			const w = (watched = new BridgeLink({ host: '::1', port: 8765, laneName: 'v6', baseChannel: 12 }))
			const statuses: (string | undefined)[] = []
			w.on('status', (_s, m) => statuses.push(m))
			w.start()
			expect(statuses[0]).toBe('Waiting for MIDI Bridge at [::1]:8765')
		})
	})

	it('when the bridge goes away, the desk stops reading as answering', async () => {
		link.start()
		await waitFor(() => link.isOk && link.state.connected, 'ok')
		bridge.stop()
		await waitFor(() => !link.isOk, 'noticed')
		expect(link.state.connected).toBe(false)
		expect(changes.flat()).toContain('connection')
	})

	it('deltaToEvent rejects junk honestly', () => {
		expect(deltaToEvent('input.5.fader', { lv: 95, db: -6.1 })).toEqual({
			kind: 'fader',
			type: 'input',
			index: 5,
			level: 95,
		})
		expect(deltaToEvent('input.999.mute', true)).toBeUndefined()
		expect(deltaToEvent('bogus.5.mute', true)).toBeUndefined()
		expect(deltaToEvent('input.5.fader', { lv: 300 })).toBeUndefined()
		expect(deltaToEvent('connection.console', 'connected')).toBeUndefined()
		expect(deltaToEvent('scene.current', 12)).toEqual({ kind: 'scene', scene: 12 })
	})
})
