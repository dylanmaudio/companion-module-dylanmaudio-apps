/**
 * ConsoleLink — everything between the transport and Companion.
 *
 * Owns: one decoder per socket, the mirrored state, the query scheduler,
 * the subscription registry, the liveness probe and the fade engine. Knows
 * nothing about Companion's API; main.ts is a thin adapter over this.
 *
 * Honest status (docs/protocol.md §6): a TCP connect is not "connected".
 * We send Get Name for Input 1 and report Ok only when *that* reply lands.
 */

import { EventEmitter } from 'node:events'
import { CHANNEL_TABLE, CHANNEL_TYPES, channelKey, type ChannelRef, type ChannelType } from './protocol/channels.js'
import { DliveDecoder } from './protocol/decode.js'
import { encode, toHex } from './protocol/encode.js'
import { INTENT_TIER, intentSocket, type ConsoleEvent, type Intent, type SocketRole } from './protocol/intents.js'
import { ConsoleState, eventPaths, faderPath, namePath, CONNECTION_PATH } from './state/model.js'
import { QueryScheduler, type PollTarget, type SchedulerOptions } from './state/scheduler.js'
import { SubscriptionRegistry } from './state/subscriptions.js'
import type { ConsoleTransport } from './transport/transport.js'
import { FadeEngine } from './fades.js'

import { dbToLv } from './protocol/levels.js'
import type { LinkApi, LinkDiag, LinkEvents, LinkStatus, SyncScope } from './link-api.js'
import { localEvent } from './protocol/localevent.js'

export type { LinkEvents, LinkStatus, SyncScope } from './link-api.js'

export interface LinkOptions {
	baseChannel: number // 1-indexed
	scheduler?: Partial<SchedulerOptions>
	probeIntervalMs?: number
	probeTimeoutMs?: number
	probeMisses?: number
	syncScope?: SyncScope
	/** per-type upper bound of strips the user cares about (sync + poll scope) */
	stripCounts?: Partial<Record<ChannelType, number>>
	tickMs?: number
	pingFlushMs?: number
	now?: () => number
}

const PROBE_TARGET: ChannelRef = { type: 'input', index: 1 }

export class ConsoleLink extends EventEmitter<LinkEvents> implements LinkApi {
	readonly state = new ConsoleState()
	readonly subscriptions = new SubscriptionRegistry()
	readonly scheduler: QueryScheduler
	readonly fades: FadeEngine
	private decoders: Record<SocketRole, DliveDecoder>
	private readonly now: () => number
	private tickTimer: NodeJS.Timeout | null = null
	private flushTimer: NodeJS.Timeout | null = null
	private probeTimer: NodeJS.Timeout | null = null
	private probeDeadline: number | null = null
	private probeMissCount = 0
	private _status: LinkStatus = 'disconnected'
	private _statusMessage: string | undefined
	private started = false
	public baseN: number
	public readonly opts: Required<
		Pick<LinkOptions, 'probeIntervalMs' | 'probeTimeoutMs' | 'probeMisses' | 'syncScope' | 'tickMs' | 'pingFlushMs'>
	> &
		LinkOptions
	public stats = { bytesIn: 0, bytesOut: 0, messagesOut: 0, unknownEvents: 0, faderPings: 0 }

	constructor(
		public transport: ConsoleTransport,
		options: LinkOptions,
	) {
		super()
		this.opts = {
			probeIntervalMs: 15_000,
			probeTimeoutMs: 2_000,
			probeMisses: 2,
			syncScope: 'names_state',
			tickMs: 10,
			pingFlushMs: 5,
			...options,
		}
		this.now = options.now ?? (() => Date.now())
		this.baseN = (this.opts.baseChannel - 1) & 0x0f
		this.decoders = { mixrack: new DliveDecoder(this.baseN), surface: new DliveDecoder(this.baseN) }
		this.scheduler = new QueryScheduler(
			(intent) => this.sendIntent(intent),
			(level, msg) => this.emit('log', level, msg),
			options.scheduler,
		)
		this.scheduler.setPollProvider(
			() => this.pollTargets(),
			() => this.subscriptions.version,
		)
		this.fades = new FadeEngine((key, lv) => {
			if (key.startsWith('send:')) {
				const [a, b] = key.slice(5).split('>')
				const src = parseKey(a)
				const dst = parseKey(b)
				if (src && dst) this.send({ op: 'send_level', ...src, dest_type: dst.type, dest_index: dst.index, level: lv })
				return
			}
			const ref = parseKey(key)
			if (ref) this.send({ op: 'fader', type: ref.type, index: ref.index, level: lv })
		})
		this.wireTransport()
	}

	get status(): LinkStatus {
		return this._status
	}

	get statusMessage(): string | undefined {
		return this._statusMessage
	}

	get isOk(): boolean {
		return this._status === 'ok'
	}

	diag(): LinkDiag {
		return {
			getsInFlight: this.scheduler.inFlight,
			getsMissed: this.scheduler.stats.missed,
			unsupported: this.scheduler.backedOffOps().join(', '),
		}
	}

	// ------------------------------------------------------------ lifecycle

	start(): void {
		if (this.started) return
		this.started = true
		this.setStatus('connecting', `Connecting to ${this.transport.describe()}`)
		this.tickTimer = setInterval(() => this.tick(), this.opts.tickMs)
		this.transport.start()
	}

	stop(): void {
		this.started = false
		if (this.tickTimer) clearInterval(this.tickTimer)
		if (this.flushTimer) clearTimeout(this.flushTimer)
		if (this.probeTimer) clearTimeout(this.probeTimer)
		this.tickTimer = this.flushTimer = this.probeTimer = null
		this.scheduler.setEnabled(false)
		this.fades.cancelAll()
		this.transport.stop()
		this.setStatus('disconnected', undefined)
	}

	/** Swap the transport (config change). Re-start if we were running. */
	setTransport(transport: ConsoleTransport): void {
		const wasStarted = this.started
		if (wasStarted) this.stop()
		this.transport.removeAllListeners()
		this.transport = transport
		this.wireTransport()
		if (wasStarted) this.start()
	}

	setBaseChannel(baseChannel: number): void {
		this.opts.baseChannel = baseChannel
		this.baseN = (baseChannel - 1) & 0x0f
		this.decoders = { mixrack: new DliveDecoder(this.baseN), surface: new DliveDecoder(this.baseN) }
	}

	private wireTransport(): void {
		this.transport.on('connect', (role) => this.onConnect(role))
		this.transport.on('disconnect', (role, reason) => this.onDisconnect(role, reason))
		this.transport.on('error', (role, err) => this.emit('log', 'debug', `${role} socket: ${err.message}`))
		this.transport.on('data', (role, buf) => this.onData(role, buf))
	}

	private onConnect(role: SocketRole): void {
		this.emit('log', 'debug', `${role} socket connected`)
		if (role !== 'mixrack') return
		this.decoders.mixrack = new DliveDecoder(this.baseN)
		this.setStatus('probing', 'Connected — waiting for the console to answer')
		this.probeMissCount = 0
		this.probe()
	}

	private onDisconnect(role: SocketRole, reason: string): void {
		this.emit('log', 'debug', `${role} socket disconnected: ${reason}`)
		if (role !== 'mixrack') return
		this.scheduler.setEnabled(false)
		this.fades.cancelAll()
		this.probeDeadline = null
		if (this.probeTimer) clearTimeout(this.probeTimer)
		this.probeTimer = null
		const changed = this.state.reset()
		this.state.connected = false
		changed.push(CONNECTION_PATH)
		this.emit('changed', changed)
		if (this.started) this.setStatus('connecting', `Reconnecting (${reason})`)
	}

	// ------------------------------------------------------------ liveness

	private probe(): void {
		if (!this.transport.isConnected('mixrack')) return
		this.probeDeadline = this.now() + this.opts.probeTimeoutMs
		this.sendIntent({ op: 'get_name', ...PROBE_TARGET })
	}

	private onProbeReply(): void {
		this.probeDeadline = null
		this.probeMissCount = 0
		const first = this._status !== 'ok'
		if (first) {
			this.state.connected = true
			this.setStatus('ok', undefined)
			this.emit('changed', [CONNECTION_PATH])
			this.scheduler.setEnabled(true)
			this.sync(this.opts.syncScope)
		}
		if (this.probeTimer) clearTimeout(this.probeTimer)
		this.probeTimer = setTimeout(() => this.probe(), this.opts.probeIntervalMs)
	}

	private onProbeMiss(): void {
		this.probeDeadline = null
		this.probeMissCount++
		if (this.probeMissCount >= this.opts.probeMisses) {
			const wasOk = this._status === 'ok'
			this.setStatus(
				'failure',
				'Connected, but the console is not responding. Check Utility → Control → MIDI on the console: mode must be On (not Off or Secure) and Global MIDI Receive must be enabled; also check this is the MixRack address and port 51325.',
			)
			if (wasOk) {
				this.scheduler.setEnabled(false)
				this.state.connected = false
				this.emit('changed', [CONNECTION_PATH])
			}
		}
		// keep probing — the operator may just be enabling MIDI on the desk
		if (this.probeTimer) clearTimeout(this.probeTimer)
		this.probeTimer = setTimeout(() => this.probe(), Math.min(this.opts.probeIntervalMs, 5_000))
	}

	// ------------------------------------------------------------ data path

	private onData(role: SocketRole, buf: Buffer): void {
		this.stats.bytesIn += buf.length
		const events = this.decoders[role].feed(buf)
		this.handleEvents(events, role)
		if (this.flushTimer) clearTimeout(this.flushTimer)
		this.flushTimer = setTimeout(() => {
			this.flushTimer = null
			for (const r of ['mixrack', 'surface'] as const) this.handleEvents(this.decoders[r].flush(), r)
		}, this.opts.pingFlushMs)
	}

	private handleEvents(events: ConsoleEvent[], role: SocketRole): void {
		if (events.length === 0) return
		const changed: string[] = []
		const replied: string[] = []
		for (const ev of events) {
			this.emit('event', ev, role)
			if (ev.kind === 'unknown') {
				this.stats.unknownEvents++
				continue
			}
			// A bare `63` with no level. No console firmware sends one for a fader
			// move — the 2026-08-11 "fader ping" was a parser discarding running
			// status (bridge 0ff0f46) — so this is another client's select,
			// relayed raw. Asking for the level on sight of one is what looped a
			// show machine at 2,200 Gets/s (session §3.10). Counted for
			// diagnostics, never acted on.
			if (ev.kind === 'fader_ping') {
				this.stats.faderPings++
				continue
			}
			if (ev.kind === 'cc' || ev.kind === 'strip_fader' || ev.kind === 'strip_key' || ev.kind === 'strip_rotary') {
				continue // triggers for the layer above; not channel state
			}
			if (
				ev.kind === 'name' &&
				ev.type === PROBE_TARGET.type &&
				ev.index === PROBE_TARGET.index &&
				this.probeDeadline !== null
			) {
				this.onProbeReply()
			}
			for (const p of eventPaths(ev)) replied.push(p)
			for (const p of this.state.apply(ev)) changed.push(p)
		}
		if (replied.length) this.scheduler.onReplyPaths(replied)
		if (changed.length) this.emit('changed', changed)
	}

	private tick(): void {
		const now = this.now()
		if (this.probeDeadline !== null && now >= this.probeDeadline) this.onProbeMiss()
		this.fades.tick(now)
		this.scheduler.tick(now)
	}

	// ------------------------------------------------------------ sending

	/** Encode + send an intent. Sets are mirrored into state optimistically. */
	send(intent: Intent): boolean {
		const ok = this.sendIntent(intent)
		if (ok) {
			const local = localEvent(intent)
			if (local) {
				const changed = this.state.applyLocal(local)
				if (changed.length) this.emit('changed', changed)
			}
		}
		return ok
	}

	private sendIntent(intent: Intent): boolean {
		let bytes: number[]
		try {
			bytes = encode(this.baseN, intent)
		} catch (e) {
			this.emit('log', 'warn', `Refusing to send ${intent.op}: ${(e as Error).message}`)
			return false
		}
		const role = intentSocket(intent)
		const ok = this.transport.send(role, bytes)
		if (!ok) {
			this.emit('log', 'debug', `Not connected (${role}); dropped ${intent.op}`)
			return false
		}
		this.stats.bytesOut += bytes.length
		this.stats.messagesOut++
		if (INTENT_TIER[intent.op] === 'inferred') {
			this.emit('log', 'debug', `sent ${intent.op} (byte layout inferred, unverified): ${toHex(bytes)}`)
		}
		return true
	}

	/** Request a Get for a path, via the scheduler. */
	query(intent: Intent, path: string, priority: 'high' | 'normal' | 'low' = 'normal'): void {
		this.scheduler.request({ intent, path, priority }, this.now())
	}

	/** Fade a strip's fader to `to` over `durationMs`. Unknown current level → Get it first (≤300 ms), else jump. */
	fadeTo(ref: ChannelRef, to: LevelRequest, durationMs: number): void {
		// This path only ever talks to a dLive, so dB resolves through its table.
		const toLv = 'lv' in to ? to.lv : dbToLv(to.db)
		const key = channelKey(ref)
		const from = this.state.strip(ref).level
		if (durationMs <= 0) {
			this.fades.cancel(key)
			this.send({ op: 'fader', ...ref, level: toLv })
			return
		}
		if (from === undefined) {
			this.query({ op: 'get_fader', ...ref }, faderPath(ref), 'high')
			const started = this.now()
			const wait = setInterval(() => {
				const lv = this.state.strip(ref).level
				if (lv !== undefined || this.now() - started > 300) {
					clearInterval(wait)
					this.fades.start(key, lv ?? toLv, toLv, lv === undefined ? 0 : durationMs, this.now())
				}
			}, 20)
			return
		}
		this.fades.start(key, from, toLv, durationMs, this.now())
	}

	/** Fade a send level (current level must be known). */
	fadeSend(src: ChannelRef, dst: ChannelRef, fromLv: number, toLv: number, durationMs: number): void {
		this.fades.start(`send:${channelKey(src)}>${channelKey(dst)}`, fromLv, toLv, durationMs, this.now())
	}

	// ------------------------------------------------------------ sync + polling

	stripCount(type: ChannelType): number {
		const cap = CHANNEL_TABLE[type].count
		const want = this.opts.stripCounts?.[type]
		return want === undefined ? cap : Math.max(0, Math.min(cap, want))
	}

	/** Bulk Get on connect. */
	sync(scope: SyncScope): void {
		if (scope === 'none') return
		const now = this.now()
		for (const type of CHANNEL_TYPES) {
			const n = this.stripCount(type)
			for (let i = 1; i <= n; i++) {
				const ref = { type, index: i }
				this.scheduler.request({ intent: { op: 'get_name', ...ref }, path: namePath(ref), priority: 'normal' }, now)
				this.scheduler.request(
					{ intent: { op: 'get_colour', ...ref }, path: `colour/${channelKey(ref)}`, priority: 'normal' },
					now,
				)
				if (scope === 'names') continue
				this.scheduler.request(
					{ intent: { op: 'get_mute', ...ref }, path: `mute/${channelKey(ref)}`, priority: 'low' },
					now,
				)
				if (type !== 'mute_group') {
					this.scheduler.request({ intent: { op: 'get_fader', ...ref }, path: faderPath(ref), priority: 'low' }, now)
				}
			}
		}
		if (scope === 'all') {
			// everything a feedback is watching gets polled anyway; 'all' additionally primes main assigns
			for (let i = 1; i <= this.stripCount('input'); i++) {
				const ref: ChannelRef = { type: 'input', index: i }
				this.scheduler.request(
					{ intent: { op: 'get_param', ...ref, param: 0x18 }, path: `param/${channelKey(ref)}/24`, priority: 'low' },
					now,
				)
			}
		}
	}

	/** Paths watched by feedbacks that the desk never announces → background poll rota. */
	private pollTargets(): PollTarget[] {
		const out: PollTarget[] = []
		for (const path of this.subscriptions.watchedPaths()) {
			const t = pollIntentFor(path)
			if (t) out.push({ intent: t, path })
		}
		return out
	}

	private setStatus(status: LinkStatus, message: string | undefined): void {
		if (this._status === status && this._statusMessage === message) return
		this._status = status
		this._statusMessage = message
		this.emit('status', status, message)
	}
}

function parseKey(key: string): ChannelRef | undefined {
	const [type, idx] = key.split('/')
	if (!(type in CHANNEL_TABLE)) return undefined
	return { type: type as ChannelType, index: Number(idx) }
}

/** For a watched path, the Get that refreshes it — only for parameters the console does not push. */
export function pollIntentFor(path: string): Intent | undefined {
	const parts = path.split('/')
	switch (parts[0]) {
		case 'param': {
			const ref = parseKey(`${parts[1]}/${parts[2]}`)
			if (!ref) return undefined
			return { op: 'get_param', ...ref, param: Number(parts[3]) }
		}
		case 'send': {
			const src = parseKey(`${parts[1]}/${parts[2]}`)
			const dst = parseKey(`${parts[3]}/${parts[4]}`)
			if (!src || !dst) return undefined
			return { op: 'get_send_level', ...src, dest_type: dst.type, dest_index: dst.index }
		}
		case 'mix': {
			const dst = parseKey(`${parts[2]}/${parts[3]}`)
			if (!dst) return undefined
			return { op: 'get_mix_assign', index: Number(parts[1]), dest_type: dst.type, dest_index: dst.index }
		}
		case 'preamp_gain':
		case 'preamp_pad':
		case 'preamp_48v': {
			const bank = parts[1] as 'mixrack' | 'dx12' | 'dx34'
			const socket = Number(parts[2])
			const op =
				parts[0] === 'preamp_gain' ? 'get_preamp_gain' : parts[0] === 'preamp_pad' ? 'get_preamp_pad' : 'get_preamp_48v'
			return { op, bank, socket }
		}
		default:
			return undefined // mute/fader/name/colour/scene are pushed by the console's broadcast
	}
}
