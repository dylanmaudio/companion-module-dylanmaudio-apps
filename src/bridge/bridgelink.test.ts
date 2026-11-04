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
import { SCENE_PATH } from '../state/model.js'

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
	/** reject once with a bare status and no {ok:false} body — a proxy's error page */
	rejectCmdOnceBare: number | null = null
	/** answer hello with this instead (a token the bridge won't take) */
	refuseHello: { status: number; body: Record<string, unknown> } | null = null
	cmdDelayMs = 0
	infos = 0
	/** a dead link: nothing is answered and nothing more reaches the stream, but nothing closes */
	frozen = false
	/** /info's console block (1.4.90+). Absent is a bridge older than that, i.e. a dLive. */
	console: Record<string, unknown> | null = null
	/** what /info reports as the API's capabilities */
	caps: Record<string, unknown> = { raw: true, fade: true, query: true, fader_db: true, send_level: false }
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
				capabilities: this.caps,
				...(this.console ? { console: this.console } : {}),
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
			if (this.rejectCmdOnceBare !== null) {
				const status = this.rejectCmdOnceBare
				this.rejectCmdOnceBare = null
				res.writeHead(status, { 'Content-Type': 'text/html' })
				res.end('<html><body>Service Unavailable</body></html>')
				return
			}
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
		link.fadeTo({ type: 'input', index: 5 }, { lv: 95 }, 2000)
		await waitFor(() => bridge.cmds.length >= 1, 'fade')
		expect(bridge.cmds[0].body.intent).toEqual({ op: 'fade', type: 'input', index: 5, to_lv: 95, over_ms: 2000 })
		// zero duration bypasses the fade op
		link.fadeTo({ type: 'input', index: 5 }, { lv: 0 }, 0)
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

	it('ignores an SSE event kind it does not know, and still follows the sequence', async () => {
		// The bridge gains kinds we have no use for — a midi feed, and `trigger`
		// for a desk key that isn't MIDI (1.4.107, the Wing's user keys).
		// Ignoring has to be free AND has to keep the seq moving, or a run of
		// them would leave us thinking we had missed events.
		link.stop()
		const fresh = new BridgeLink({
			host: '127.0.0.1',
			port: bridge.port,
			laneName: 'unknown-kinds',
			baseChannel: 1,
			retryMs: 50,
		})
		const logs: string[] = []
		fresh.on('log', (level, msg) => logs.push(`${level}: ${msg}`))
		const changed: string[][] = []
		fresh.on('changed', (p) => changed.push(p))
		fresh.start()
		await waitFor(() => bridge.streamOpen, 'stream')
		changed.length = 0

		bridge.pushEvent('trigger', { trigger: 'user:U1.1', value: 127, family: 'wing' })
		bridge.pushEvent('midi', { hex: '90 40 7f' })
		await new Promise((r) => setTimeout(r, 150))
		expect(changed).toEqual([])
		expect(logs.filter((l) => l.startsWith('warn:') || l.startsWith('error:'))).toEqual([])

		// a known event straight after still lands: the stream wasn't disturbed
		bridge.pushEvent('scene', { number: 7 })
		await waitFor(() => fresh.state.currentScene === 7, 'scene after the unknown kinds')
		fresh.stop()
	})

	it('says so when a press is refused without an {ok:false} envelope', async () => {
		// A self-clearing 503 <op>_unavailable (#318) arrives as {ok:false} and
		// is already logged. A proxy's error page is not, and without this the
		// press would vanish with nothing in the log at all.
		link.stop()
		bridge.rejectCmdOnceBare = 503
		const fresh = new BridgeLink({
			host: '127.0.0.1',
			port: bridge.port,
			laneName: 'bare-503',
			baseChannel: 1,
			retryMs: 50,
		})
		const logs: string[] = []
		fresh.on('log', (level, msg) => logs.push(`${level}: ${msg}`))
		fresh.start()
		await waitFor(() => fresh.isOk, 'ok')
		fresh.send({ op: 'mute', type: 'input', index: 1, on: true })
		await waitFor(() => logs.some((l) => l.includes('HTTP 503')), 'the refusal is logged')
		expect(logs.find((l) => l.includes('HTTP 503'))).toMatch(/^warn: Bridge rejected mute/)
		// not a transport failure: no reconnect, no "didn't reach MIDI Bridge"
		expect(logs.some((l) => l.includes("didn't reach"))).toBe(false)
		fresh.stop()
	})

	it('recalls by the number on the desk, and never sends a place as well', async () => {
		// The SD11 of 27 Oct listed 1.00, 1.01, 1.03, 1.93, 2.83. Sent as a
		// PLACE, a key labelled "Scene 4" recalls 1.93 — the snapshot the desk
		// calls '2'. MIDI Bridge 1.4.111 takes scene_number (#289), so we send
		// that and strip `scene`: a place reaching a by_number driver is the
		// very recall this exists to stop.
		link.stop()
		bridge.console = {
			driver: 'digico',
			title: 'DiGiCo',
			verified_on_desk: true,
			scenes: { noun: 'Snapshot', first: 1, last: null, by_number: true },
		}
		bridge.cmds.length = 0
		const fresh = new BridgeLink({
			host: '127.0.0.1',
			port: bridge.port,
			laneName: 'sd-scene',
			baseChannel: 1,
			retryMs: 50,
		})
		const logs: string[] = []
		fresh.on('log', (level, msg) => logs.push(`${level}: ${msg}`))
		fresh.start()
		await waitFor(() => fresh.status === 'ok', 'ok')

		// the decimal a DiGiCo allows, which no integer field could carry
		expect(fresh.send({ op: 'scene', scene: 2, scene_number: 1.5 })).toBe(true)
		await waitFor(() => bridge.cmds.some((c) => (c.body.intent as { op?: string }).op === 'scene'), 'scene')
		const sent = bridge.cmds.at(-1)?.body.intent as Record<string, unknown>
		expect(sent.scene_number).toBe(1.5)
		expect('scene' in sent).toBe(false) // the place must not ride along
		expect(logs.some((l) => l.includes('numbers its scenes'))).toBe(false)

		// a button built before the new option: the Scene box is the number
		bridge.cmds.length = 0
		expect(fresh.send({ op: 'scene', scene: 4 })).toBe(true)
		await waitFor(() => bridge.cmds.length > 0, 'fallback')
		const fallback = bridge.cmds.at(-1)?.body.intent as Record<string, unknown>
		expect(fallback.scene_number).toBe(4)
		expect('scene' in fallback).toBe(false)
		fresh.stop()
	})

	it('leaves the current scene alone on a by_number recall instead of blanking it', async () => {
		// The place is stripped on a by_number desk, so there is nothing to
		// apply optimistically: 9.99 is not the ninth snapshot. This used to
		// apply `scene: undefined` anyway, which blanked `scene_current` on
		// every recall — hidden by the desk's echo arriving a few ms later,
		// and permanent when none came. On a Quantum 112, 4 Nov, snapshot
		// 9.99 does not exist, MIDI Bridge refused it with 400 desk_state,
		// the desk said nothing, and the variable stayed empty for the rest
		// of the session.
		link.stop()
		bridge.console = {
			driver: 'digico',
			title: 'DiGiCo',
			verified_on_desk: true,
			scenes: { noun: 'Snapshot', first: 1, last: null, by_number: true },
		}
		bridge.cmds.length = 0
		const fresh = new BridgeLink({
			host: '127.0.0.1',
			port: bridge.port,
			laneName: 'sd-scene-keep',
			baseChannel: 1,
			retryMs: 50,
		})
		fresh.start()
		await waitFor(() => fresh.status === 'ok', 'ok')

		// where the desk had got to: its own echo of an earlier recall
		bridge.pushEvent('scene', { number: 2 })
		await waitFor(() => fresh.state.currentScene === 2, 'scene 2 from the desk')

		const changed: string[][] = []
		fresh.on('changed', (paths) => changed.push(paths))
		expect(fresh.send({ op: 'scene', scene: 1, scene_number: 9.99 })).toBe(true)
		await waitFor(() => bridge.cmds.some((c) => (c.body.intent as { op?: string }).op === 'scene'), 'scene')
		expect(fresh.state.currentScene).toBe(2)
		expect(changed.flat()).not.toContain(SCENE_PATH)
		fresh.stop()
	})

	it('still recalls by place on a desk that lists its scenes', async () => {
		// the dLive and the SQ: no by_number, so a recall is unchanged
		link.stop()
		bridge.console = {
			driver: 'sq',
			title: 'SQ',
			verified_on_desk: true,
			scenes: { noun: 'Scene', first: 1, last: 300 },
		}
		bridge.cmds.length = 0
		const fresh = new BridgeLink({
			host: '127.0.0.1',
			port: bridge.port,
			laneName: 'sq-scene',
			baseChannel: 1,
			retryMs: 50,
		})
		fresh.start()
		await waitFor(() => fresh.status === 'ok', 'ok')
		expect(fresh.send({ op: 'scene', scene: 4, scene_number: 4 })).toBe(true)
		await waitFor(() => bridge.cmds.some((c) => (c.body.intent as { op?: string }).op === 'scene'), 'scene')
		// a counting desk gets the place and NOTHING else: an older MIDI Bridge
		// has never seen scene_number, and the dLive is the shipped case.
		const sent = bridge.cmds.at(-1)?.body.intent as Record<string, unknown>
		expect(sent.scene).toBe(4)
		expect('scene_number' in sent).toBe(false)
		// and the place IS applied at once, so a feedback lights on the press
		expect(fresh.state.currentScene).toBe(4)
		fresh.stop()
	})

	it("reads the desk's stereo link", () => {
		// seen on the SQ-5, 21 Oct: inputs 1 and 2 linked
		expect(deltaToEvent('input.1.stereo', { linked: true, half: 'A', partner: 2 })).toEqual({
			kind: 'stereo',
			type: 'input',
			index: 1,
			linked: true,
			half: 'A',
			partner: 2,
		})
		expect(deltaToEvent('input.3.stereo', { linked: false })).toEqual({
			kind: 'stereo',
			type: 'input',
			index: 3,
			linked: false,
			half: undefined,
			partner: undefined,
		})
		// a half we don't recognise is dropped rather than guessed at
		expect(deltaToEvent('input.1.stereo', { linked: true, half: 'M', partner: 0 })).toMatchObject({
			half: undefined,
			partner: undefined,
		})
	})

	it('reads {width} as width, and never as "not linked"', () => {
		// The Wing, 27 Oct: 26 *.stereo keys, every one {"width": ...}, for
		// inputs and aux_in. The SD mirrored the same shape. Per the Client
		// API spec §1b it is also every family's MIXES, the SQ included.
		expect(deltaToEvent('input.1.stereo', { width: 'stereo' })).toEqual({
			kind: 'stereo',
			type: 'input',
			index: 1,
			linked: undefined, // NOT false: this says nothing about pairing
			half: undefined,
			partner: undefined,
			width: 'stereo',
		})
		expect(deltaToEvent('input.3.stereo', { width: 'mono' })).toMatchObject({
			linked: undefined,
			width: 'mono',
		})
	})

	it("says nothing where the family can't say, rather than 'not linked'", () => {
		// The spec: "`stereo: null` means the family can't say, never mono."
		// A dLive cannot report an input's link at all, and the dLive is the
		// whole of the shipped product — so this is the case that was wrong
		// in every customer's hands, not an exotic one.
		expect(deltaToEvent('input.1.stereo', null)).toBeUndefined()
		expect(deltaToEvent('input.1.stereo', {})).toBeUndefined()
		expect(deltaToEvent('input.1.stereo', { width: 'quadraphonic' })).toBeUndefined()
		// and an absent `linked` key is not a false one
		expect(deltaToEvent('input.1.stereo', { half: 'A', partner: 2 })).toBeUndefined()
		expect(deltaToEvent('input.1.stereo', 'yes')).toBeUndefined()
	})

	it('reads the current scene from the object the desk sends (#342)', () => {
		// Straight off the fixture, so the shape and the decoder can't drift
		// apart: the Wing's scene.current is {number, name}, an object.
		const body = fixture('state.scene.current.wing').response.body as {
			state: Record<string, unknown>
		}
		const value = body.state['scene.current']
		expect(value).toEqual({ number: 4, name: 'UP1' })
		expect(deltaToEvent('scene.current', value)).toEqual({ kind: 'scene', scene: 4 })
		// a bare number is tolerated too; nothing says a family sends one
		expect(deltaToEvent('scene.current', 12)).toEqual({ kind: 'scene', scene: 12 })
		// A DM7 adds a third key, because it has two scene lists: scene.current
		// is {number, name, scene_list} there. Reading `number` and ignoring
		// the rest is what makes that free — the list itself is the scene_list
		// work, which waits for the Client API shape and its fixture.
		expect(deltaToEvent('scene.current', { number: 2.5, name: 'Verse', scene_list: 'B' })).toEqual({
			kind: 'scene',
			scene: 2.5,
		})
		// And a desk that cannot list its scenes has no place to give: number
		// is null and the screen number is in scene_number. Without the
		// fallback this is #342 all over again, on a different desk.
		expect(deltaToEvent('scene.current', { number: null, scene_number: 2.5, name: 'Verse', scene_list: 'A' })).toEqual({
			kind: 'scene',
			scene: 2.5,
		})
		// Both shapes are DEV: Yamaha driver's word as of 28 Oct and NOT yet in
		// fixtures/api/exchanges.json — due 2 Nov. When it lands, this test
		// should read the case out of the fixture the way the one above it
		// does, and these literals should go.
		expect(deltaToEvent('scene.current', { number: null, name: 'Verse' })).toBeUndefined()
		// an SD's snapshot number is decimal, and dropping it would be the
		// same silent loss this bug was
		expect(deltaToEvent('scene.current', { number: 1.5 })).toEqual({ kind: 'scene', scene: 1.5 })
		// junk is still refused rather than reported as scene NaN
		expect(deltaToEvent('scene.current', { name: 'UP1' })).toBeUndefined()
		expect(deltaToEvent('scene.current', {})).toBeUndefined()
		expect(deltaToEvent('scene.current', null)).toBeUndefined()
		expect(deltaToEvent('scene.current', 0)).toBeUndefined()
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

	describe('a console this version does not drive', () => {
		const connectTo = async (consoleBlock: Record<string, unknown> | null) => {
			link.stop()
			bridge.console = consoleBlock
			bridge.cmds.length = 0
			const fresh = new BridgeLink({
				host: '127.0.0.1',
				port: bridge.port,
				laneName: 'sq',
				baseChannel: 1,
				retryMs: 50,
			})
			const logs: string[] = []
			fresh.on('log', (level, msg) => logs.push(`${level}: ${msg}`))
			fresh.start()
			await waitFor(() => bridge.infos > 0 && bridge.hellos.length > 0, 'connect')
			return { fresh, logs }
		}

		it('sends nothing to the console, and says why once', async () => {
			const { fresh, logs } = await connectTo({ driver: 'sq', title: 'SQ' })
			// a fader is the dangerous one: 0-127 is unity on a dLive and near
			// silence on the SQ's 14-bit scale, so it must not travel at all
			expect(fresh.send({ op: 'fader', type: 'input', index: 5, level: 107 })).toBe(false)
			expect(fresh.send({ op: 'mute', type: 'input', index: 5, on: true })).toBe(false)
			expect(fresh.send({ op: 'scene', scene: 3 })).toBe(false)
			fresh.fadeTo({ type: 'input', index: 5 }, { lv: 107 }, 2000)
			await new Promise((r) => setTimeout(r, 120))
			expect(bridge.cmds.filter((c) => (c.body.intent as { op?: string }).op !== 'query')).toEqual([])
			const warnings = logs.filter((l) => l.startsWith('warn:') && l.includes('SQ'))
			expect(warnings).toHaveLength(1)
			expect(warnings[0]).toContain('drives a dLive only')
			fresh.stop()
		})

		it('does not move its own mirror either', async () => {
			const { fresh } = await connectTo({ driver: 'sq', title: 'SQ' })
			const changed: string[][] = []
			fresh.on('changed', (paths) => changed.push(paths))
			fresh.send({ op: 'mute', type: 'input', index: 5, on: true })
			await new Promise((r) => setTimeout(r, 50))
			// a refused press that still lit the key would be the #106 bug again
			expect(changed.flat()).not.toContain('mute/input/5')
			fresh.stop()
		})

		it('does not cold-sync a desk it will not drive', async () => {
			// found on the SQ-5, 20 Oct: the bridge answers a dLive-shaped Get
			// with bad_intent, once per strip, so a wide scope is a wall of warnings
			link.stop()
			bridge.console = { driver: 'sq', title: 'SQ' }
			bridge.cmds.length = 0
			const fresh = new BridgeLink({
				host: '127.0.0.1',
				port: bridge.port,
				laneName: 'sq-sync',
				baseChannel: 1,
				retryMs: 50,
				strips: [
					{ type: 'input', index: 1 },
					{ type: 'input', index: 2 },
				],
				syncScope: 'names_state',
			})
			fresh.start()
			await waitFor(() => bridge.hellos.length > 0, 'connect')
			await new Promise((r) => setTimeout(r, 150))
			expect(queriesTo(bridge)).toEqual([])
			fresh.stop()
		})

		it('a verified family is driven, but not with dLive-scaled values', async () => {
			link.stop()
			bridge.console = { driver: 'sq', title: 'SQ', verified_on_desk: true }
			bridge.cmds.length = 0
			const fresh = new BridgeLink({
				host: '127.0.0.1',
				port: bridge.port,
				laneName: 'sq-ok',
				baseChannel: 1,
				retryMs: 50,
			})
			fresh.start()
			await waitFor(() => bridge.hellos.length > 0, 'connect')
			// a verified desk is a working connection, not a failed one, or every
			// feedback on the page reads as disconnected
			await waitFor(() => fresh.status === 'ok', 'status ok')
			// family-neutral: these travel
			expect(fresh.send({ op: 'mute', type: 'input', index: 1, on: true })).toBe(true)
			expect(fresh.send({ op: 'scene', scene: 2 })).toBe(true)
			// dLive-scaled: 107 is unity here and near silence on a 14-bit desk
			expect(fresh.send({ op: 'fader', type: 'input', index: 1, level: 107 })).toBe(false)
			fresh.fadeTo({ type: 'input', index: 1 }, { lv: 107 }, 1000)
			// dLive bytes: never, on any other desk
			expect(fresh.send({ op: 'dca_assign', type: 'input', index: 1, dca: 1, on: true })).toBe(false)
			await waitFor(() => bridge.cmds.some((c) => (c.body.intent as { op?: string }).op === 'mute'), 'mute')
			await new Promise((r) => setTimeout(r, 100))
			const ops = bridge.cmds.map((c) => (c.body.intent as { op?: string }).op)
			expect(ops).toContain('scene')
			expect(ops).not.toContain('fader')
			expect(ops).not.toContain('fade')
			expect(ops).not.toContain('raw')
			fresh.stop()
		})

		it('declares the families it handles at hello', async () => {
			// 1.4.93+ refuses writes from a client that didn't say; without this
			// the SQ mutes and scenes would come back 400 wrong_console
			link.stop()
			bridge.hellos.length = 0
			const fresh = new BridgeLink({
				host: '127.0.0.1',
				port: bridge.port,
				laneName: 'hello-consoles',
				baseChannel: 1,
				retryMs: 50,
			})
			fresh.start()
			await waitFor(() => bridge.hellos.length > 0, 'hello')
			// avantis and yamaha from 28 Oct, for the four-desk day on 4 Nov. The
			// ids are the monorepo's own: Family("avantis", …) and
			// Family("yamaha", "Yamaha Rivage PM / DM7 (RCP)") in
			// sim/session/families.py, one id for both Yamaha desks.
			expect(bridge.hellos[0].consoles).toEqual(['dlive', 'sq', 'wing', 'digico', 'avantis', 'yamaha'])
			fresh.stop()
		})

		it('skips the cold sync on a verified desk, and says so without crying refusal', async () => {
			// Found while auditing for 4 Nov. The cold sync is right to skip a
			// family that isn't a dLive — `query` carries dLive-shaped Gets,
			// which earn one bad_intent per strip there, and the mirror has the
			// values anyway — but it used to say so through refuseForeign, so a
			// Wing the module was driving happily logged "query isn't sent on a
			// Wing: it is encoded as dLive bytes, which mean something else
			// there." That reads as a refusal of something the operator wanted.
			link.stop()
			bridge.console = { driver: 'wing', title: 'Wing', verified_on_desk: true }
			bridge.cmds.length = 0
			const fresh = new BridgeLink({
				host: '127.0.0.1',
				port: bridge.port,
				laneName: 'wing-coldsync',
				baseChannel: 1,
				retryMs: 50,
				strips: [
					{ type: 'input', index: 1 },
					{ type: 'input', index: 2 },
				],
			})
			const said: string[] = []
			fresh.on('log', (_l, m) => said.push(m))
			fresh.start()
			await waitFor(() => fresh.status === 'ok', 'ok')
			await new Promise((r) => setTimeout(r, 100))
			// no Gets at all, which is the behaviour that was always right
			expect(bridge.cmds.some((c) => (c.body.intent as { op?: string }).op === 'query')).toBe(false)
			// and nothing claiming a refusal on a desk we are driving
			expect(said.some((m) => m.includes('dLive bytes'))).toBe(false)
			expect(said.some((m) => m.includes('No cold sync on a Wing'))).toBe(true)
			fresh.stop()
		})

		it('sends a level to a verified desk in dB, never in lv', async () => {
			link.stop()
			bridge.console = { driver: 'sq', title: 'SQ', verified_on_desk: true }
			bridge.caps = { raw: false, fade: true, query: true, fader_db: true, send_level: false }
			bridge.cmds.length = 0
			const fresh = new BridgeLink({
				host: '127.0.0.1',
				port: bridge.port,
				laneName: 'sq-db',
				baseChannel: 1,
				retryMs: 50,
			})
			fresh.start()
			await waitFor(() => fresh.status === 'ok', 'ok')
			fresh.fadeTo({ type: 'input', index: 1 }, { db: -6 }, 0)
			fresh.fadeTo({ type: 'input', index: 2 }, { db: 0 }, 2000)
			// a dLive wire value has no meaning here, so it isn't guessed at
			fresh.fadeTo({ type: 'input', index: 3 }, { lv: 107 }, 0)
			await waitFor(() => bridge.cmds.length >= 2, 'cmds')
			await new Promise((r) => setTimeout(r, 80))
			// both are posted without awaiting, so they can arrive either way round
			const sent = bridge.cmds.map((c) => c.body.intent as Record<string, unknown>)
			expect(sent).toHaveLength(2)
			expect(sent).toContainEqual(expect.objectContaining({ op: 'fader', type: 'input', index: 1, db: -6 }))
			expect(sent).toContainEqual(
				expect.objectContaining({ op: 'fade', type: 'input', index: 2, to_db: 0, over_ms: 2000 }),
			)
			expect(sent.every((i) => i.level === undefined && i.to_lv === undefined)).toBe(true)
			fresh.stop()
		})

		it("holds levels back when the bridge hasn't verified the dB law", async () => {
			link.stop()
			bridge.console = { driver: 'sq', title: 'SQ', verified_on_desk: true }
			bridge.caps = { raw: false, fade: true, query: true, fader_db: false }
			bridge.cmds.length = 0
			const fresh = new BridgeLink({
				host: '127.0.0.1',
				port: bridge.port,
				laneName: 'sq-nodb',
				baseChannel: 1,
				retryMs: 50,
			})
			fresh.start()
			await waitFor(() => fresh.status === 'ok', 'ok')
			fresh.fadeTo({ type: 'input', index: 1 }, { db: -6 }, 0)
			await new Promise((r) => setTimeout(r, 100))
			expect(bridge.cmds.filter((c) => (c.body.intent as { op?: string }).op !== 'query')).toEqual([])
			fresh.stop()
		})

		it("reads the other families' fader shape, and keeps the dLive's", () => {
			// {wire, db, steps}: the desk's own resolution and its own dB
			expect(deltaToEvent('input.5.fader', { wire: 9000, db: -6.2, steps: 16384 })).toEqual({
				kind: 'fader',
				type: 'input',
				index: 5,
				level: 9000,
				db: -6.2,
			})
			// -inf survives as null, not as "missing"
			expect(deltaToEvent('input.5.fader', { wire: 0, db: null, steps: 16384 })).toMatchObject({ db: null })
			// the dLive's shape is unchanged, and its db is ignored: ours is measured
			expect(deltaToEvent('input.5.fader', { lv: 95, db: -6.1 })).toEqual({
				kind: 'fader',
				type: 'input',
				index: 5,
				level: 95,
			})
		})

		it('says so in the connection status', async () => {
			const { fresh } = await connectTo({ driver: 'sq', title: 'SQ' })
			await waitFor(() => fresh.status === 'failure', 'status')
			fresh.stop()
		})

		it('a bridge with no console block is a dLive, and is driven as before', async () => {
			const { fresh } = await connectTo(null)
			expect(fresh.send({ op: 'mute', type: 'input', index: 5, on: true })).toBe(true)
			await waitFor(() => bridge.cmds.some((c) => (c.body.intent as { op?: string }).op === 'mute'), 'mute')
			fresh.stop()
		})

		it('driver dlive is driven as before', async () => {
			const { fresh } = await connectTo({ driver: 'dlive', title: 'dLive' })
			expect(fresh.send({ op: 'fader', type: 'input', index: 5, level: 107 })).toBe(true)
			await waitFor(() => bridge.cmds.some((c) => (c.body.intent as { op?: string }).op === 'fader'), 'fader')
			fresh.stop()
		})

		it('honours capabilities.raw: false without refusing the rest', async () => {
			link.stop()
			bridge.console = null
			bridge.caps = { raw: false, fade: true, query: true }
			bridge.cmds.length = 0
			const fresh = new BridgeLink({
				host: '127.0.0.1',
				port: bridge.port,
				laneName: 'noraw',
				baseChannel: 1,
				retryMs: 50,
			})
			fresh.start()
			await waitFor(() => bridge.hellos.length > 0, 'connect')
			// first-class still travels; the raw path doesn't
			fresh.send({ op: 'mute', type: 'input', index: 5, on: true })
			fresh.send({ op: 'dca_assign', type: 'input', index: 5, dca: 1, on: true })
			await waitFor(() => bridge.cmds.some((c) => (c.body.intent as { op?: string }).op === 'mute'), 'mute')
			await new Promise((r) => setTimeout(r, 80))
			expect(bridge.cmds.some((c) => (c.body.intent as { op?: string }).op === 'raw')).toBe(false)
			fresh.stop()
		})

		it('opens the gate when the console event says the desk is verified', async () => {
			// The Yamaha driver is verified PER MODEL — the Rivage PM5 and the
			// DM7 Compact are separate commits — and MIDI Bridge can only say
			// which desk it is once the desk has answered with its name. So the
			// block at connect can say "not verified" and the console event say
			// otherwise a moment later. Reading /info alone left the connection
			// refusing every write for the rest of the session (spec §1b: "An
			// SSE `console` event carries the whole block").
			link.stop()
			bridge.console = { driver: 'yamaha', title: 'Rivage PM5', verified_on_desk: false }
			bridge.cmds.length = 0
			const statuses: string[] = []
			const fresh = new BridgeLink({
				host: '127.0.0.1',
				port: bridge.port,
				laneName: 'yamaha-late',
				baseChannel: 1,
				retryMs: 50,
			})
			fresh.on('status', (s) => statuses.push(s))
			fresh.start()
			await waitFor(() => bridge.hellos.length > 0, 'connect')
			await waitFor(() => fresh.status === 'failure', 'refused at first')
			expect(fresh.send({ op: 'scene', scene: 2 })).toBe(false)

			await waitFor(() => bridge.streamOpen, 'stream')
			bridge.pushEvent('console', {
				console: { driver: 'yamaha', title: 'Rivage PM5', model: 'DSP-RX', verified_on_desk: true },
				family: 'yamaha',
			})
			await waitFor(() => fresh.status === 'ok', 'gate opens')
			expect(fresh.send({ op: 'scene', scene: 2 })).toBe(true)
			await waitFor(() => bridge.cmds.some((c) => (c.body.intent as { op?: string }).op === 'scene'), 'recall')
			expect(statuses).toContain('ok')
			fresh.stop()
		})

		it('shuts the gate again if the console event takes the verification away', async () => {
			link.stop()
			bridge.console = { driver: 'yamaha', title: 'DM7 Compact', verified_on_desk: true }
			const fresh = new BridgeLink({
				host: '127.0.0.1',
				port: bridge.port,
				laneName: 'yamaha-unverified',
				baseChannel: 1,
				retryMs: 50,
			})
			fresh.start()
			await waitFor(() => bridge.hellos.length > 0, 'connect')
			await waitFor(() => fresh.status === 'ok', 'driven at first')
			await waitFor(() => bridge.streamOpen, 'stream')
			bridge.pushEvent('console', {
				console: { driver: 'yamaha', title: 'DM7 Compact', verified_on_desk: false },
				family: 'yamaha',
			})
			await waitFor(() => fresh.status === 'failure', 'gate shuts')
			expect(fresh.send({ op: 'scene', scene: 2 })).toBe(false)
			fresh.stop()
		})
	})

	describe('a desk that keeps more than one scene list', () => {
		const dm7 = (lists: string[] | undefined) => ({
			driver: 'yamaha',
			title: 'DM7 Compact',
			verified_on_desk: true,
			scenes: { noun: 'Scene', by_number: true, ...(lists ? { lists } : {}) },
		})

		const laneFor = async (consoleBlock: Record<string, unknown>, name: string) => {
			link.stop()
			bridge.console = consoleBlock
			bridge.cmds.length = 0
			const logs: string[] = []
			const fresh = new BridgeLink({
				host: '127.0.0.1',
				port: bridge.port,
				laneName: name,
				baseChannel: 1,
				retryMs: 50,
			})
			fresh.on('log', (level, msg) => logs.push(`${level}: ${msg}`))
			fresh.start()
			await waitFor(() => bridge.hellos.length > 0, 'connect')
			await waitFor(() => fresh.status === 'ok', 'ok')
			return { fresh, logs }
		}

		const scenesSent = () =>
			bridge.cmds.map((c) => c.body.intent as Record<string, unknown>).filter((i) => i?.op === 'scene')

		it('sends the list the button names, with the number the desk uses', async () => {
			const { fresh } = await laneFor(dm7(['A', 'B']), 'dm7-b')
			expect(fresh.send({ op: 'scene', scene: 3, scene_number: 2.5, scene_list: 'B' })).toBe(true)
			await waitFor(() => scenesSent().length > 0, 'recall')
			// by_number, so the place is stripped and the list rides along
			expect(scenesSent()[0]).toEqual({ op: 'scene', scene_number: 2.5, scene_list: 'B' })
			fresh.stop()
		})

		it("takes the desk's spelling when only the case differs", async () => {
			const { fresh } = await laneFor(dm7(['A', 'B']), 'dm7-case')
			expect(fresh.send({ op: 'scene', scene: 1, scene_number: 1, scene_list: 'b' })).toBe(true)
			await waitFor(() => scenesSent().length > 0, 'recall')
			expect(scenesSent()[0].scene_list).toBe('B')
			fresh.stop()
		})

		it('refuses a list the desk does not have, before the press leaves', async () => {
			const { fresh, logs } = await laneFor(dm7(['A', 'B']), 'dm7-c')
			expect(fresh.send({ op: 'scene', scene: 1, scene_number: 1, scene_list: 'C' })).toBe(false)
			await new Promise((r) => setTimeout(r, 80))
			expect(scenesSent()).toEqual([])
			expect(logs.some((l) => l.startsWith('warn:') && l.includes('"A" and "B"'))).toBe(true)
			fresh.stop()
		})

		it('refuses a list on a desk that keeps one, rather than recalling from the only one', async () => {
			// 400 bad_intent at the bridge (spec §8). Refused here instead, so
			// the sentence names the button's own box — and so a recall never
			// quietly lands in list A on a desk with no lists at all.
			const { fresh, logs } = await laneFor(dm7(undefined), 'dm7-nolists')
			expect(fresh.send({ op: 'scene', scene: 1, scene_number: 1, scene_list: 'B' })).toBe(false)
			await new Promise((r) => setTimeout(r, 80))
			expect(scenesSent()).toEqual([])
			expect(logs.some((l) => l.startsWith('warn:') && l.includes('one scene list'))).toBe(true)
			// and with the box empty the same button recalls as it always did
			expect(fresh.send({ op: 'scene', scene: 1, scene_number: 1 })).toBe(true)
			await waitFor(() => scenesSent().length > 0, 'recall')
			expect(scenesSent()[0]).toEqual({ op: 'scene', scene_number: 1 })
			fresh.stop()
		})

		it('reads the lists from the console event, not only from /info', async () => {
			// §8: the block "can change once the desk says its model", so the
			// lists arrive with the model on a desk whose model is asked for.
			const { fresh } = await laneFor(dm7(undefined), 'dm7-late-lists')
			expect(fresh.send({ op: 'scene', scene: 1, scene_number: 1, scene_list: 'B' })).toBe(false)
			await waitFor(() => bridge.streamOpen, 'stream')
			bridge.pushEvent('console', { console: dm7(['A', 'B']), family: 'yamaha' })
			await waitFor(() => {
				// the gate didn't move, so nothing is logged: ask by sending
				return fresh.send({ op: 'scene', scene: 1, scene_number: 1, scene_list: 'B' })
			}, 'lists arrive')
			await waitFor(() => scenesSent().length > 0, 'recall')
			expect(scenesSent()[0]).toEqual({ op: 'scene', scene_number: 1, scene_list: 'B' })
			fresh.stop()
		})

		it('keeps the current scene on a recall a desk reports with no place (#342 in the stream)', async () => {
			// The Yamaha's own recall announcement: `number` null, the number on
			// screen in `scene_number`. `Number(null)` is 0, so this used to set
			// the current scene to 0 on every recall.
			const { fresh } = await laneFor(dm7(['A', 'B']), 'dm7-stream-scene')
			const scenes: number[] = []
			fresh.on('event', (ev) => {
				if (ev.kind === 'scene') scenes.push(ev.scene)
			})
			await waitFor(() => bridge.streamOpen, 'stream')
			bridge.pushEvent('scene', { number: null, scene_number: 2.5, name: 'Verse', scene_list: 'B' })
			await waitFor(() => scenes.length > 0, 'scene event')
			expect(scenes[0]).toBe(2.5)
			expect(fresh.state.currentScene).toBe(2.5)
			// and a desk that has no number at all says nothing, rather than 0
			bridge.pushEvent('scene', { number: null, name: 'Verse' })
			await new Promise((r) => setTimeout(r, 60))
			expect(scenes).toEqual([2.5])
			fresh.stop()
		})
	})
})
