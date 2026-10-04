/**
 * Notices a stream that has gone quiet because the link under it is dead.
 *
 * On one Mac, a server that goes away closes its sockets, and the stream
 * ends. Across a network it doesn't: a Mac that sleeps or a pulled cable
 * leaves the stream open with nothing on it. The connection then reads as
 * up until TCP gives up, measured at about 70 s (#106), and presses in that
 * time change the buttons but never arrive.
 *
 * So once a stream has been quiet for `idleMs`, ask the server something
 * cheap. Any answer means the link is up. No answer ends the stream, and the
 * caller's reconnect loop takes over. A server that sends keepalives (the
 * control API, every 10 s) is never asked. The bridge's Client API sends
 * none, so a quiet desk costs one small GET per `idleMs`.
 */

export interface StreamWatchdogOptions {
	/** Quiet for this long → ask (default 15 s) */
	idleMs?: number
	/** How often to look (default 1 s) */
	tickMs?: number
	/** Resolves true if the server answered at all */
	probe(): Promise<boolean>
	/** The server didn't answer: end the stream */
	onDead(): void
	now?(): number
}

export const WATCHDOG_IDLE_MS = 15_000

export class StreamWatchdog {
	private last = 0
	private timer: NodeJS.Timeout | null = null
	private probing = false
	/** Something else failed: ask on the next tick rather than wait out the quiet */
	private due = false

	constructor(private readonly opts: StreamWatchdogOptions) {}

	private now(): number {
		return this.opts.now?.() ?? Date.now()
	}

	start(): void {
		this.stop()
		this.last = this.now()
		this.due = false
		this.timer = setInterval(() => void this.tick(), this.opts.tickMs ?? 1000)
	}

	stop(): void {
		if (this.timer) clearInterval(this.timer)
		this.timer = null
	}

	/** Bytes arrived on the stream: the link is up. */
	feed(): void {
		this.last = this.now()
		this.due = false
	}

	/** A request on the same link failed (a lost press): check now. */
	suspect(): void {
		if (this.timer) this.due = true
	}

	private async tick(): Promise<void> {
		if (this.probing || !this.timer) return
		if (!this.due && this.now() - this.last < (this.opts.idleMs ?? WATCHDOG_IDLE_MS)) return
		this.probing = true
		let answered: boolean
		try {
			answered = await this.opts.probe()
		} catch {
			answered = false
		}
		this.probing = false
		if (!this.timer) return // stopped while asking
		if (answered) {
			this.feed()
			return
		}
		this.stop()
		this.opts.onDead()
	}
}
