/**
 * BridgeLink — the module as a MIDI Bridge lane (Client API v1).
 *
 * Spec: monorepo docs/bridge-client-api-v1.md; wire shapes pinned by
 * fixtures/api/exchanges.json (authored bridge-side, vendored here).
 *
 * Division of labour versus direct mode: the bridge owns the console
 * socket, the state mirror, the heartbeat and timed
 * fades. This side is deliberately thin — hello, one snapshot, an SSE
 * delta stream mapped into the same ConsoleState the feedbacks already
 * read, and commands posted as fixture-contract intents. Ops the API
 * does not encode first-class ride `{"op":"raw"}` using the module's
 * own encoder, so the full action set keeps working.
 *
 * v1.1 feedback coverage via the bridge mirror: mutes, faders, names,
 * colours, scene, connection. The param family (assigns, HPF, preamp,
 * sends) has no mirror paths yet — those feedbacks stay at their
 * optimistic/local values in bridge mode and `diag().unsupported`
 * says so.
 */

import { EventEmitter } from 'node:events'
import { CHANNEL_TABLE, isChannelType, type ChannelRef, type Colour } from '../protocol/channels.js'
import { encode, toHex } from '../protocol/encode.js'
import { intentSocket, type ConsoleEvent, type Intent } from '../protocol/intents.js'
import { ConsoleState, CONNECTION_PATH } from '../state/model.js'
import { SubscriptionRegistry } from '../state/subscriptions.js'
import type { LinkApi, LinkDiag, LinkEvents, LinkStatus, SyncScope } from '../link-api.js'
import { localEvent } from '../protocol/localevent.js'
import { hostPort, httpOrigin, netReason } from '../util/net.js'
import { StreamWatchdog } from '../util/watchdog.js'

/** Ops the shipped v1.1 bridge encodes first-class (everything else → raw). */
const FIRST_CLASS = new Set([
	'mute',
	'fader',
	'scene',
	'set_name',
	'set_colour',
	'get_name',
	'get_colour',
	'get_mute',
	'get_fader',
])

/**
 * Capability-gated ops are sent verbatim, NEVER wrapped in `raw`: the raw
 * escape hatch would silently bypass the bridge's gate, and the polite
 * `capability_off` ack is the behaviour we want.
 *
 * send_level was gated until the send LV↔dB law was measured. The 5 Sep
 * 2026 sweep found it identical to the fader law at all 128 steps, and
 * bridge 1.1.8 ungated it — but it stays here, because a 1.1.7 bridge
 * still gates it and must still be able to say so.
 *
 * Note the gate governs *sending* only. Whether sends are displayed in dB
 * is the operator's `sendsInDb` setting, and does not read this capability.
 */
const GATED = new Set(['send_level'])

/** Gets in flight during a cold sync: enough to be quick, not a spray (client API §11). */
const COLD_SYNC_LANES = 4

export interface BridgeLinkOptions {
	host: string
	port: number
	token?: string
	laneName: string
	/** used only until /info reports the bridge's own base channel */
	baseChannel: number
	/** the strips to ask the bridge about on connect — variables.ts scopedStrips, the same set that gets variables */
	strips?: ChannelRef[]
	/** how much of each strip to ask for; 'none' asks for nothing */
	syncScope?: SyncScope
	retryMs?: number
	/** wait before asking again after the bridge refused this connection (default 10 s) */
	refusedRetryMs?: number
	/** per request (default 5 s) */
	requestTimeoutMs?: number
	/** a stream quiet this long gets its link checked (default 15 s; util/watchdog.ts) */
	idleMs?: number
	/** how often the watchdog looks (default 1 s) */
	idleTickMs?: number
	now?: () => number
}

/**
 * The bridge said no to this connection: a token it won't take, or an
 * address it won't serve. Retrying quickly can't change that.
 */
class Refused extends Error {}

/** The stream's cursor fell off the bridge's event ring. */
class Resync extends Error {}

function errorOf(json: Record<string, unknown>): { code?: string; message?: string } {
	const e = json.error
	if (typeof e !== 'object' || e === null) return {}
	const { code, message } = e as { code?: unknown; message?: unknown }
	return {
		code: typeof code === 'string' ? code : undefined,
		message: typeof message === 'string' ? message : undefined,
	}
}

/**
 * 401 or 403 outside /cmd is the bridge refusing this connection. API v1
 * has neither today (its one 401 is a reaped lane, on /cmd). The LAN mode
 * (spec §4, #106) gates requests with a token, and #105 refuses some hosts.
 */
function refusal(status: number, json: Record<string, unknown>): Refused | null {
	if (status !== 401 && status !== 403) return null
	const { code, message } = errorOf(json)
	return new Refused(
		`MIDI Bridge refused this connection (${message ?? code ?? `HTTP ${status}`}). Check the bridge token in this connection's settings.`,
	)
}

interface BridgeCaps {
	fade?: boolean
	raw?: boolean
	send_level?: boolean
}

export class BridgeLink extends EventEmitter<LinkEvents> implements LinkApi {
	readonly state = new ConsoleState()
	readonly subscriptions = new SubscriptionRegistry()
	private _status: LinkStatus = 'disconnected'
	private _statusMessage: string | undefined
	private started = false
	private laneId: string | null = null
	private caps: BridgeCaps = {}
	private baseN: number
	/** the bridge's own base channel, adopted from /info */
	public bridgeBaseChannel: number | undefined
	private consoleState: string | undefined
	private seq = -1
	private cidCounter = 0
	/** Counts sessions (one hello each), so a cold sync from an ended one stops asking */
	private session = 0
	private streamAbort: AbortController | null = null
	private watchdog: StreamWatchdog | null = null
	private retryTimer: NodeJS.Timeout | null = null
	private generation = 0
	private unsupportedOps = new Set<string>()
	public stats = { cmdsSent: 0, cmdsFailed: 0, deltas: 0, resyncs: 0 }

	constructor(private readonly opts: BridgeLinkOptions) {
		super()
		this.baseN = (opts.baseChannel - 1) & 0x0f
	}

	// ------------------------------------------------------------ LinkApi

	get status(): LinkStatus {
		return this._status
	}

	get statusMessage(): string | undefined {
		return this._statusMessage
	}

	get isOk(): boolean {
		return this._status === 'ok'
	}

	start(): void {
		if (this.started) return
		this.started = true
		this.setStatus('connecting', `Waiting for MIDI Bridge at ${this.where}`)
		void this.runSession(++this.generation)
	}

	private get where(): string {
		return hostPort(this.opts.host, this.opts.port)
	}

	stop(): void {
		this.started = false
		this.generation++
		if (this.retryTimer) clearTimeout(this.retryTimer)
		this.retryTimer = null
		this.watchdog?.stop()
		this.streamAbort?.abort()
		this.streamAbort = null
		if (this.laneId) {
			// best-effort clean detach
			void this.http('DELETE', `/api/v1/lane/${this.laneId}`).catch(() => undefined)
			this.laneId = null
		}
		this.setStatus('disconnected', undefined)
	}

	setBaseChannel(_baseChannel: number): void {
		// The bridge owns the base channel; /info tells us. Nothing to do.
	}

	send(intent: Intent): boolean {
		if (!this.laneId) {
			this.emit('log', 'debug', `Bridge lane not up; dropped ${intent.op}`)
			return false
		}
		void this.postIntent(intent)
		const local = localEvent(intent)
		if (local) {
			const changed = this.state.apply(local)
			if (changed.length) this.emit('changed', changed)
		}
		return true
	}

	query(intent: Intent, _path: string, _priority?: 'high' | 'normal' | 'low'): void {
		if (!this.laneId) return
		if (FIRST_CLASS.has(intent.op)) {
			void this.postIntent(intent)
			return
		}
		// The mirror has no paths for the param family in v1 — a Get would
		// have nowhere to land. Record it as unsupported instead of asking.
		if (!this.unsupportedOps.has(intent.op)) {
			this.unsupportedOps.add(intent.op)
			this.emit(
				'log',
				'info',
				`${intent.op}: no bridge mirror support in API v1 — feedback for it stays local in bridge mode`,
			)
		}
	}

	fadeTo(ref: ChannelRef, toLv: number, durationMs: number): void {
		if (durationMs <= 0 || this.caps.fade === false) {
			this.send({ op: 'fader', type: ref.type, index: ref.index, level: toLv })
			return
		}
		void this.postCmd({ op: 'fade', type: ref.type, index: ref.index, to_lv: toLv, over_ms: Math.round(durationMs) })
	}

	fadeSend(src: ChannelRef, dst: ChannelRef, _fromLv: number, toLv: number, _durationMs: number): void {
		// Sends are capability-gated until calibration; a ramp would be
		// rejected step by step. Send the target once; the ack reports the gate.
		this.send({
			op: 'send_level',
			type: src.type,
			index: src.index,
			dest_type: dst.type,
			dest_index: dst.index,
			level: toLv,
		})
	}

	sync(scope: SyncScope): void {
		const session = this.session
		void (async () => {
			await this.refetchState('resync requested')
			await this.coldSync(scope, 'resync', session)
		})()
	}

	diag(): LinkDiag {
		return {
			getsInFlight: 0,
			getsMissed: this.stats.cmdsFailed,
			unsupported: [...this.unsupportedOps].join(', '),
		}
	}

	// ------------------------------------------------------------ HTTP plumbing

	private baseUrl(): string {
		return httpOrigin(this.opts.host, this.opts.port)
	}

	private headers(): Record<string, string> {
		const h: Record<string, string> = { 'Content-Type': 'application/json' }
		if (this.opts.token) h.Authorization = `Bearer ${this.opts.token}`
		return h
	}

	private async http(
		method: string,
		path: string,
		body?: unknown,
	): Promise<{ status: number; json: Record<string, unknown> }> {
		const res = await fetch(this.baseUrl() + path, {
			method,
			headers: this.headers(),
			body: body === undefined ? undefined : JSON.stringify(body),
			signal: AbortSignal.timeout(this.opts.requestTimeoutMs ?? 5000),
		})
		let json: Record<string, unknown> = {}
		try {
			json = (await res.json()) as Record<string, unknown>
		} catch {
			/* non-JSON body */
		}
		return { status: res.status, json }
	}

	private nextCid(): string {
		return `c${++this.cidCounter}`
	}

	private async postCmd(intentObj: Record<string, unknown>): Promise<void> {
		const op = String(intentObj.op)
		if (!this.laneId) {
			// the session ended (a cold sync or fade still running): the next one starts afresh
			this.emit('log', 'debug', `Bridge lane not up; dropped ${op}`)
			return
		}
		const cid = this.nextCid()
		const envelope = () => ({ v: 1, session: 'main', lane_id: this.laneId, cid, intent: intentObj })
		try {
			let { status, json } = await this.http('POST', '/api/v1/cmd', envelope())
			this.stats.cmdsSent++
			if (status === 401 && errorOf(json).code === 'unknown_lane') {
				// lane reaped — re-hello and retry once
				this.emit('log', 'debug', 'Bridge lane expired; re-registering')
				await this.hello()
				;({ status, json } = await this.http('POST', '/api/v1/cmd', envelope()))
			}
			if (json.ok === false) {
				this.stats.cmdsFailed++
				const err = errorOf(json)
				const level = err.code === 'capability_off' || err.code === 'unsupported_op' ? 'info' : 'warn'
				this.emit('log', level, `Bridge rejected ${op}: ${err.code ?? status}${err.message ? ` (${err.message})` : ''}`)
			}
		} catch (e) {
			this.stats.cmdsFailed++
			if (e instanceof Refused) {
				// the token stopped working mid-session: end it, and the reconnect says so
				this.streamAbort?.abort(e)
				return
			}
			// A lost press matters, and may mean the link is down. A lost cold-sync
			// query is asked again by the next session's cold sync.
			if (op !== 'query') this.watchdog?.suspect()
			this.emit('log', op === 'query' ? 'debug' : 'warn', `${op} didn't reach MIDI Bridge (${netReason(e)})`)
		}
	}

	private async postIntent(intent: Intent): Promise<void> {
		if (FIRST_CLASS.has(intent.op) || GATED.has(intent.op)) {
			await this.postCmd(intent)
			return
		}
		// Module-side encoding, bridge-side transmission: op "raw".
		let bytes: number[]
		try {
			bytes = encode(this.baseN, intent)
		} catch (e) {
			this.emit('log', 'warn', `Refusing to send ${intent.op}: ${(e as Error).message}`)
			return
		}
		if (intentSocket(intent) === 'surface' && !this.unsupportedOps.has('surface_socket')) {
			this.unsupportedOps.add('surface_socket')
			this.emit(
				'log',
				'info',
				'Surface-role messages ride the bridge’s MixRack socket (the bridge has one console connection)',
			)
		}
		await this.postCmd({ op: 'raw', hex: toHex(bytes) })
	}

	// ------------------------------------------------------------ session

	private async runSession(gen: number): Promise<void> {
		while (this.started && gen === this.generation) {
			let wait = this.opts.retryMs ?? 2000
			try {
				await this.connectOnce(gen)
			} catch (e) {
				if (!this.started || gen !== this.generation) return
				this.laneId = null
				// A resync is the bridge still answering: the desk hasn't gone anywhere.
				if (!(e instanceof Resync)) this.consoleUnknown()
				if (e instanceof Refused) {
					this.setStatus('refused', e.message)
					wait = this.opts.refusedRetryMs ?? 10_000
				} else this.setStatus('connecting', `Waiting for MIDI Bridge at ${this.where} (${netReason(e)})`)
			}
			if (!this.started || gen !== this.generation) return
			await new Promise((r) => (this.retryTimer = setTimeout(r, wait)))
		}
	}

	/**
	 * The session ended, so nothing says the console is answering any more.
	 * Without this, "Console is answering" stayed lit while the bridge was gone.
	 */
	private consoleUnknown(): void {
		if (!this.state.connected) return
		this.state.connected = false
		this.emit('changed', [CONNECTION_PATH])
	}

	private async connectOnce(gen: number): Promise<void> {
		const session = ++this.session
		// 1. info: adopt the bridge's base channel + capabilities
		const info = await this.http('GET', '/api/v1/info')
		const refused = refusal(info.status, info.json)
		if (refused) throw refused
		if (info.status !== 200) throw new Error(`info ${info.status}`)
		const base = Number(info.json.base_channel)
		if (Number.isInteger(base) && base >= 1 && base <= 16) {
			this.bridgeBaseChannel = base
			this.baseN = (base - 1) & 0x0f
		}
		// `mirror_from_broadcast` is stored here and deliberately not consulted
		// (2026-09-08). The flag means the bridge's mirror is broadcast-fed after
		// connect, so no polling is needed — which this module already never does.
		// It does NOT mean the connect-time cold sync can be skipped: names,
		// colours, mutes and levels are only broadcast when they *change*, and the
		// full state dump only arrives on a show load, so a client connecting
		// mid-show has nothing until it asks once. Keep the cold sync.
		// See the session report §3.2 and §5.
		this.caps = info.json.capabilities ?? {}

		// 2. hello
		await this.hello()

		// 3. snapshot, then stream from its seq
		await this.refetchState('connect')
		this.applyConsoleState()

		// 4. the cold sync itself, in the background: the stream matters more
		void this.coldSync(this.opts.syncScope ?? 'names_state', 'connect', session)

		// 5. stream (returns on drop; throws on resync/other errors)
		await this.consumeStream(gen)
		throw new Error('stream closed')
	}

	/**
	 * Ask the bridge, once, for what the desk never volunteers. The console
	 * announces only what changes and the bridge's mirror starts empty, so a
	 * lane that joins mid-show sees nothing until someone moves something —
	 * names and colours above all. Results arrive as ordinary deltas.
	 */
	private async coldSync(scope: SyncScope, why: string, session: number): Promise<void> {
		if (scope === 'none') return
		const wide = scope !== 'names'
		const jobs = (this.opts.strips ?? []).map(({ type, index }) => {
			const fields = ['name', 'colour']
			if (wide) fields.push('mute')
			if (wide && type !== 'mute_group') fields.push('fader')
			return { type, index, fields }
		})
		if (jobs.length === 0) return
		let next = 0
		const lane = async (): Promise<void> => {
			for (let i = next++; i < jobs.length; i = next++) {
				// that session ended; the next one runs its own cold sync
				if (session !== this.session || !this.laneId) return
				const job = jobs[i]
				await this.postCmd({ op: 'query', type: job.type, index: job.index, fields: job.fields })
			}
		}
		await Promise.all(Array.from({ length: COLD_SYNC_LANES }, lane))
		this.emit('log', 'debug', `cold sync (${why}): asked the bridge about ${jobs.length} strips`)
	}

	private async hello(): Promise<void> {
		const res = await this.http('POST', '/api/v1/hello', {
			v: 1,
			session: 'main',
			name: this.opts.laneName,
			kind: 'companion',
		})
		const refused = refusal(res.status, res.json)
		if (refused) throw refused
		if (res.status !== 200) throw new Error(`hello ${res.status}`)
		this.laneId = String(res.json.lane_id)
	}

	private async refetchState(why: string): Promise<void> {
		const res = await this.http('GET', '/api/v1/state')
		const refused = refusal(res.status, res.json)
		if (refused) throw refused
		if (res.status !== 200) throw new Error(`state ${res.status}`)
		this.seq = Number(res.json.seq ?? -1)
		const snapshot = (res.json.state ?? {}) as Record<string, unknown>
		const changed: string[] = []
		for (const [path, value] of Object.entries(snapshot)) {
			if (path === 'connection.console') {
				this.consoleState = String(value)
				continue
			}
			const ev = deltaToEvent(path, value)
			if (!ev) continue
			for (const p of this.state.apply(ev)) changed.push(p)
		}
		if (changed.length) this.emit('changed', changed)
		this.emit('log', 'debug', `mirror snapshot: ${Object.keys(snapshot).length} paths (${why})`)
	}

	private applyConsoleState(): void {
		const console_ = this.consoleState ?? 'connected'
		if (console_ === 'connected') {
			if (this._status !== 'ok') {
				this.state.connected = true
				this.setStatus('ok', undefined)
				this.emit('changed', [CONNECTION_PATH])
			}
		} else {
			const wasOk = this._status === 'ok'
			this.setStatus('failure', `MIDI Bridge is running but its console link is ${console_} — check the bridge app`)
			if (wasOk) {
				this.state.connected = false
				this.emit('changed', [CONNECTION_PATH])
			}
		}
	}

	private async consumeStream(gen: number): Promise<void> {
		const abort = new AbortController()
		this.streamAbort = abort
		// The stream has no timeout of its own, but its headers must still arrive.
		const headersDue = setTimeout(() => abort.abort(new Error('no answer')), this.opts.requestTimeoutMs ?? 5000)
		let res: Response
		try {
			res = await fetch(`${this.baseUrl()}/api/v1/stream`, {
				headers: { ...this.headers(), 'Last-Event-ID': String(this.seq) },
				signal: abort.signal,
			})
		} finally {
			clearTimeout(headersDue)
		}
		if (res.status === 409) {
			this.stats.resyncs++
			await this.refetchState('event ring resync')
			this.applyConsoleState()
			throw new Resync('resync')
		}
		if (res.status === 401 || res.status === 403) {
			let json: Record<string, unknown> = {}
			try {
				json = (await res.json()) as Record<string, unknown>
			} catch {
				/* non-JSON body */
			}
			const refused = refusal(res.status, json)
			if (refused) throw refused
		}
		if (res.status !== 200 || !res.body) throw new Error(`stream ${res.status}`)

		// API v1's stream carries no keepalives: a quiet desk and a dead link
		// look alike from here, so the watchdog asks when it's been quiet.
		const watchdog = new StreamWatchdog({
			idleMs: this.opts.idleMs,
			tickMs: this.opts.idleTickMs,
			probe: async () => {
				await this.http('GET', '/api/v1/info') // any answer means the link is up
				return true
			},
			onDead: () => abort.abort(new Error('stopped answering')),
		})
		this.watchdog = watchdog
		watchdog.start()
		try {
			const reader = res.body.getReader()
			const decoder = new TextDecoder()
			let buf = ''
			for (;;) {
				const { value, done } = await reader.read()
				if (done || !this.started || gen !== this.generation) return
				watchdog.feed()
				buf += decoder.decode(value, { stream: true })
				let idx: number
				while ((idx = buf.indexOf('\n\n')) >= 0) {
					const frame = buf.slice(0, idx)
					buf = buf.slice(idx + 2)
					this.handleFrame(frame)
				}
			}
		} finally {
			watchdog.stop()
			if (this.watchdog === watchdog) this.watchdog = null
		}
	}

	private handleFrame(frame: string): void {
		let kind = 'message'
		let data = ''
		let id: string | undefined
		for (const line of frame.split('\n')) {
			if (line.startsWith('event:')) kind = line.slice(6).trim()
			else if (line.startsWith('data:')) data += line.slice(5).trim()
			else if (line.startsWith('id:')) id = line.slice(3).trim()
		}
		if (id !== undefined && id !== '') this.seq = Number(id)
		if (!data) return
		let payload: Record<string, unknown>
		try {
			payload = JSON.parse(data) as Record<string, unknown>
		} catch {
			return
		}
		this.handleEvent(kind, payload)
	}

	private handleEvent(kind: string, payload: Record<string, unknown>): void {
		switch (kind) {
			case 'delta': {
				this.stats.deltas++
				const ev = deltaToEvent(typeof payload.path === 'string' ? payload.path : '', payload.value)
				if (!ev) return
				this.emit('event', ev, 'mixrack')
				const changed = this.state.apply(ev)
				if (changed.length) this.emit('changed', changed)
				return
			}
			case 'scene': {
				const ev: ConsoleEvent = { kind: 'scene', scene: Number(payload.number) }
				this.emit('event', ev, 'mixrack')
				const changed = this.state.apply(ev)
				if (changed.length) this.emit('changed', changed)
				return
			}
			case 'connection': {
				this.consoleState = typeof payload.console === 'string' ? payload.console : 'down'
				this.applyConsoleState()
				return
			}
			case 'ack': {
				if (payload.ok === false) {
					const err = (payload.error ?? {}) as { code?: string }
					this.emit('log', 'debug', `ack ${String(payload.cid)}: ${err.code ?? 'error'}`)
				}
				return
			}
			default:
				return // midi feed etc. — the monitor's business, not ours
		}
	}

	private setStatus(status: LinkStatus, message: string | undefined): void {
		if (this._status === status && this._statusMessage === message) return
		this._status = status
		this._statusMessage = message
		this.emit('status', status, message)
	}
}

// ---------------------------------------------------------------- mapping

/** Bridge mirror path + value → the fixture-contract event our state applies. */
export function deltaToEvent(path: string, value: unknown): ConsoleEvent | undefined {
	const parts = path.split('.')
	if (path === 'scene.current') {
		const n = Number(value)
		return Number.isInteger(n) && n >= 1 ? { kind: 'scene', scene: n } : undefined
	}
	if (path === 'connection.console') return undefined // handled as status
	if (parts.length !== 3) return undefined
	const [type, idxStr, field] = parts
	const index = Number(idxStr)
	if (!isChannelType(type) || !Number.isInteger(index) || index < 1 || index > CHANNEL_TABLE[type].count)
		return undefined
	const ref: ChannelRef = { type, index }
	switch (field) {
		case 'mute':
			return { kind: 'mute', ...ref, on: value === true }
		case 'fader': {
			const lv = typeof value === 'object' && value !== null ? Number((value as { lv?: unknown }).lv) : Number(value)
			if (!Number.isInteger(lv) || lv < 0 || lv > 127) return undefined
			return { kind: 'fader', ...ref, level: lv }
		}
		case 'name':
			return { kind: 'name', ...ref, name: typeof value === 'string' ? value : '' }
		case 'colour':
			return typeof value === 'string' ? { kind: 'colour', ...ref, colour: value as Colour } : undefined
		default:
			return undefined
	}
}
