/**
 * A /ctl/v1/ server built from one fixtures/control file, for tests: the
 * fixture's app, catalogue and initial state, with its /cmd cases replayed
 * by matching the wire body. The monorepo builds a real ControlServer from
 * the same files, so both sides are held to one contract.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'control')

export interface FxCase {
	id: string
	setup?: { allowed?: boolean; locked?: boolean }
	request: { method: string; path: string; body?: Record<string, unknown>; content_type?: string }
	response: { status: number; body: Record<string, unknown> }
}
export interface Fixture {
	app: { id: string; name: string; version: string }
	catalogue: { controls: { id: string }[]; state: { key: string }[] }
	initial_state: Record<string, unknown>
	cases: FxCase[]
}
export const load = (file: string): Fixture => JSON.parse(readFileSync(join(FIXTURE_DIR, file), 'utf8')) as Fixture
export const FILES = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.json'))

/** `<str>` / `<int>` in a fixture mean "any value of that type". */
export const ANY_STR = '<str>'
const concrete = (v: unknown): unknown => (v === ANY_STR ? 'fixture placeholder' : v)

/** A /ctl/v1/ server from one fixture's app, catalogue, initial state and cases. */
export class CtlMock {
	private server: Server | null = null
	port = 0
	allowed = true
	locked = false
	ctl = 1
	hash = 'h1'
	catalogue: Fixture['catalogue']
	values: Record<string, unknown>
	seq = 0
	resyncOnce = false
	resyncs = 0
	/** a dead link: nothing is answered and nothing more reaches a stream, but nothing closes */
	frozen = false
	/** answer every request 401 with this message, as an app that won't take the token would */
	refuse: string | null = null
	/** a press's handler that takes this long to return */
	cmdDelayMs = 0
	private held: ServerResponse[] = []
	private ring: { seq: number; frame: string }[] = []
	private streams = new Set<ServerResponse>()
	requests: { method: string; path: string; headers: IncomingMessage['headers']; body?: Record<string, unknown> }[] = []

	constructor(readonly fx: Fixture) {
		this.catalogue = fx.catalogue
		this.values = { ...fx.initial_state }
	}

	async start(): Promise<void> {
		this.server = createServer((req, res) => void this.handle(req, res))
		await new Promise<void>((r) => this.server!.listen(0, '127.0.0.1', r))
		this.port = (this.server.address() as { port: number }).port
	}

	async stop(): Promise<void> {
		this.dropStreams()
		const s = this.server
		this.server = null
		if (!s) return
		s.closeAllConnections()
		await new Promise<void>((r) => s.close(() => r()))
	}

	dropStreams(): void {
		for (const s of this.streams) s.end()
		this.streams.clear()
	}

	emit(kind: string, payload: Record<string, unknown>): void {
		if (this.frozen) return
		this.seq++
		const frame = `id: ${this.seq}\nevent: ${kind}\ndata: ${JSON.stringify({ ...payload, v: 1, seq: this.seq, ts: Date.now() })}\n\n`
		this.ring.push({ seq: this.seq, frame })
		for (const s of this.streams) s.write(frame)
	}

	publish(key: string, value: unknown): void {
		this.values[key] = value
		this.emit('state', { key, value })
	}

	private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
		const fx = this.fx
		const [path, query = ''] = (req.url ?? '').split('?')
		let body: Record<string, unknown> | undefined
		if (req.method === 'POST') {
			const chunks: Buffer[] = []
			for await (const chunk of req) chunks.push(chunk as Buffer)
			body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
		}
		this.requests.push({ method: req.method ?? '', path, headers: req.headers, body })
		if (this.frozen) {
			this.held.push(res)
			return
		}
		const json = (status: number, obj: unknown) => {
			res.writeHead(status, { 'Content-Type': 'application/json' })
			res.end(JSON.stringify(obj))
		}
		if (this.refuse !== null) return json(401, { ok: false, error: { code: 'unauthorized', message: this.refuse } })
		switch (`${req.method} ${path}`) {
			case 'GET /ctl/v1/info':
				return json(200, {
					v: 1,
					ctl: this.ctl,
					app: fx.app.id,
					name: fx.app.name,
					version: concrete(fx.app.version),
					catalogue_hash: this.hash,
					allowed: this.allowed,
					locked: this.locked,
					seq: this.seq,
				})
			case 'GET /ctl/v1/catalogue':
				return json(200, {
					v: 1,
					app: fx.app.id,
					name: fx.app.name,
					version: concrete(fx.app.version),
					hash: this.hash,
					...this.catalogue,
				})
			case 'GET /ctl/v1/state':
				return json(200, { v: 1, seq: this.seq, values: this.values })
			case 'GET /ctl/v1/stream': {
				if (this.resyncOnce) {
					this.resyncOnce = false
					this.resyncs++
					return json(409, { ok: false, error: { code: 'resync' } })
				}
				const header = req.headers['last-event-id']
				const q = new URLSearchParams(query).get('cursor')
				const cursor = typeof header === 'string' ? Number(header) : q !== null ? Number(q) : null
				res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
				for (const r of this.ring) if (cursor !== null && r.seq > cursor) res.write(r.frame)
				res.write(': keepalive\n\n')
				this.streams.add(res)
				req.on('close', () => this.streams.delete(res))
				return
			}
			case 'POST /ctl/v1/cmd': {
				if (this.cmdDelayMs) await new Promise((r) => setTimeout(r, this.cmdDelayMs))
				const c = fx.cases.find(
					(x) =>
						x.request.path === '/ctl/v1/cmd' &&
						x.request.body?.control === body?.control &&
						JSON.stringify(x.request.body?.value) === JSON.stringify(body?.value) &&
						(x.setup?.allowed ?? true) === this.allowed &&
						(x.setup?.locked ?? false) === this.locked,
				)
				if (!c) return json(500, { ok: false, error: { code: 'no_fixture_case', message: JSON.stringify(body) } })
				const rb = { ...c.response.body, cid: body?.cid }
				const err = rb.error as { code: string; message?: unknown } | undefined
				if (err) rb.error = { ...err, ...(err.message !== undefined ? { message: concrete(err.message) } : {}) }
				return json(c.response.status, rb)
			}
			default:
				return json(404, { ok: false, error: { code: 'not_found' } })
		}
	}
}

export async function waitFor(cond: () => boolean, what: string, ms = 3000): Promise<void> {
	const start = Date.now()
	while (!cond()) {
		if (Date.now() - start > ms) throw new Error(`timeout: ${what}`)
		await new Promise((r) => setTimeout(r, 10))
	}
}
