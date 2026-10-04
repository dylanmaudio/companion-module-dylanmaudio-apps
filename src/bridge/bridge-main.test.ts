/**
 * Bridge mode through the real DliveInstance: config transport='bridge',
 * a mock Client API server, and the action → cmd → optimistic state →
 * variables pipeline that the Companion UI exercises.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { CompanionActionDefinitions, CompanionVariableValues } from '@companion-module/base'
import { createServer as createTcpServer } from 'node:net'
import DliveInstance from '../main.js'
import { DEFAULT_CONFIG } from '../config.js'
import { CtlMock, load } from '../../test/ctlmock.js'

class Host {
	actions: CompanionActionDefinitions<never> = {} as never
	vars: CompanionVariableValues = {}
	statuses: string[] = []
	readonly context = {
		_isInstanceContext: true as const,
		id: 't',
		label: 'dLive-test',
		upgradeScripts: [],
		saveConfig: () => {},
		updateStatus: (s: string, m?: string | null) => this.statuses.push(m ? `${s}: ${m}` : s),
		oscSend: () => {},
		recordAction: () => {},
		setActionDefinitions: (a: CompanionActionDefinitions<never>) => (this.actions = a),
		subscribeActions: () => {},
		unsubscribeActions: () => {},
		setFeedbackDefinitions: () => {},
		unsubscribeFeedbacks: () => {},
		checkFeedbacks: () => {},
		checkAllFeedbacks: () => {},
		checkFeedbacksById: () => {},
		setPresetDefinitions: () => {},
		setCompositeElementDefinitions: () => {},
		setVariableDefinitions: () => {},
		setVariableValues: (v: CompanionVariableValues) => Object.assign(this.vars, v),
		getVariableValue: (id: string) => this.vars[id],
		sharedUdpSocketHandlers: new Map(),
		sharedUdpSocketJoin: async () => '',
		sharedUdpSocketLeave: async () => {},
		sharedUdpSocketSend: async () => {},
	}
	async run(actionId: string, options: Record<string, unknown>): Promise<void> {
		const def = (this.actions as Record<string, { callback: (e: unknown, c: unknown) => unknown }>)[actionId]
		await def.callback(
			{ id: 'a', controlId: 'c', actionId, options, surfaceId: undefined },
			{ type: 'action', setCustomVariableValue: () => {}, signal: new AbortController().signal },
		)
	}
}

async function waitFor(cond: () => boolean, what: string): Promise<void> {
	const start = Date.now()
	while (!cond()) {
		if (Date.now() - start > 4000) throw new Error(`timeout: ${what}`)
		await new Promise((r) => setTimeout(r, 10))
	}
}

describe('bridge mode through DliveInstance', () => {
	let server: Server
	let port = 0
	const cmds: Record<string, unknown>[] = []
	/**
	 * Each request's path and Authorization header, per server: a request the
	 * last test's link already had in flight still reaches the last test's server.
	 */
	let auth: [string, string | undefined][] = []

	beforeEach(async () => {
		cmds.length = 0
		const seen: typeof auth = (auth = [])
		server = createServer((req, res) => {
			seen.push([req.url ?? '', req.headers.authorization])
			let data = ''
			req.on('data', (c: Buffer) => (data += c.toString()))
			req.on('end', () => {
				const p = new URL(req.url ?? '/', 'http://x').pathname
				const send = (st: number, o: unknown) => {
					res.writeHead(st, { 'Content-Type': 'application/json' })
					res.end(JSON.stringify(o))
				}
				if (p === '/api/v1/info')
					return send(200, { v: 1, base_channel: 12, capabilities: { raw: true, fade: true }, seq: 5 })
				if (p === '/api/v1/hello') return send(200, { v: 1, lane_id: 'ln_1', seq: 5 })
				if (p === '/api/v1/state')
					return send(200, {
						v: 1,
						seq: 5,
						state: { 'connection.console': 'connected', 'input.7.fader': { lv: 101, db: -3.1 } },
					})
				if (p === '/api/v1/stream') {
					// headers go at once, as the bridge's end_headers() sends them
					res.writeHead(200, { 'Content-Type': 'text/event-stream' })
					return res.flushHeaders()
				}
				if (p === '/api/v1/cmd') {
					cmds.push(JSON.parse(data) as Record<string, unknown>)
					return send(200, { ok: true })
				}
				send(404, {})
			})
		})
		await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
		const addr = server.address()
		if (typeof addr === 'object' && addr) port = addr.port
	})
	afterEach(() => server.close())

	it('action → cmd → optimistic state → variables, and the snapshot seeds variables', async () => {
		const host = new Host()
		const inst = new DliveInstance(host.context)
		// core types only: the cold sync then covers inputs, mains, DCAs and mute groups
		await inst.init({
			...DEFAULT_CONFIG,
			bridgeHost: '127.0.0.1',
			bridgePort: port,
			inputs: 16,
			extendedTypes: false,
		})
		await waitFor(() => inst.link.isOk, 'ok')
		await waitFor(() => host.vars['fader_lv_ch7'] === 101, 'snapshot variable')
		await host.run('fader', { type: 'input', index: 1, db: '+1', fade: 0 })
		await waitFor(() => host.vars['fader_lv_ch1'] === 109, 'optimistic variable')
		expect(host.vars['fader_ch1']).toBe('+0.9')
		// the connect-time cold sync is queries; the fader is the one we ran
		const intents = () => cmds.map((c) => (c as { intent: Record<string, unknown> }).intent)
		expect(
			intents()
				.filter((i) => i.op === 'fader')
				.at(-1),
		).toEqual({
			op: 'fader',
			type: 'input',
			index: 1,
			level: 109,
		})
		// cold sync covers every type in scope, not only inputs
		await waitFor(() => intents().some((i) => i.op === 'query' && i.type === 'dca'), 'dca query')
		expect(intents().some((i) => i.op === 'query' && i.type === 'input')).toBe(true)
		await inst.destroy()
	})

	it('merges the bridge app control into the console connection, with bridge_ variables', async () => {
		const ctl = new CtlMock(load('bridge.json'))
		await ctl.start()
		const host = new Host()
		const inst = new DliveInstance(host.context)
		await inst.init({
			...DEFAULT_CONFIG,
			bridgeHost: '127.0.0.1',
			bridgePort: port,
			bridgeCtlPort: ctl.port,
			inputs: 16,
		})
		await waitFor(() => 'ctl_bridge__run' in host.actions, 'bridge app actions merged')
		expect(host.actions).toHaveProperty('fader')
		expect(host.actions).toHaveProperty('ctl_bridge__restart')
		await waitFor(() => host.vars.bridge_state === 'stopped', 'bridge state variable')
		await waitFor(() => inst.link.isOk, 'console link still ok')
		await inst.destroy()
		await ctl.stop()
	})

	it('sends the bridge token from the secrets store to both of the bridge’s ports', async () => {
		const ctl = new CtlMock(load('bridge.json'))
		await ctl.start()
		const host = new Host()
		const inst = new DliveInstance(host.context)
		await inst.init(
			{ ...DEFAULT_CONFIG, bridgeHost: '127.0.0.1', bridgePort: port, bridgeCtlPort: ctl.port, inputs: 16 },
			false,
			{ bridgeToken: ' tok-1 ', ctlToken: 'not-this-one' },
		)
		await waitFor(() => inst.link.isOk && ctl.requests.some((r) => r.path === '/ctl/v1/stream'), 'both up')
		await waitFor(() => auth.some(([path]) => path === '/api/v1/cmd'), 'the cold sync asking')
		for (const kind of ['/api/v1/info', '/api/v1/hello', '/api/v1/state', '/api/v1/stream', '/api/v1/cmd'])
			expect(
				auth.some(([path]) => path.startsWith(kind)),
				kind,
			).toBe(true)
		for (const [path, a] of auth) expect(a, path).toBe('Bearer tok-1')
		for (const r of ctl.requests) expect(r.headers.authorization, r.path).toBe('Bearer tok-1')

		// a new token reconnects both, with it
		await inst.configUpdated({ ...inst.config }, { bridgeToken: 'tok-2', ctlToken: '' })
		await waitFor(() => auth.some(([, a]) => a === 'Bearer tok-2'), 'Client API reconnected')
		await waitFor(
			() => ctl.requests.some((r) => r.headers.authorization === 'Bearer tok-2'),
			'control port reconnected',
		)
		await inst.destroy()
		await ctl.stop()
	})

	it('says the bridge is stopped, rather than that nothing answers, while its core is down', async () => {
		const ctl = new CtlMock(load('bridge.json'))
		await ctl.start()
		const host = new Host()
		const inst = new DliveInstance(host.context)
		const nothing = await closedPort()
		await inst.init({
			...DEFAULT_CONFIG,
			bridgeHost: '127.0.0.1',
			bridgePort: nothing,
			bridgeCtlPort: ctl.port,
			inputs: 16,
		})
		await waitFor(() => host.statuses.some((s) => s.includes('MIDI Bridge is stopped')), 'stopped status')
		await inst.destroy()
		await ctl.stop()
	})
})

async function closedPort(): Promise<number> {
	const s = createTcpServer()
	await new Promise<void>((r) => s.listen(0, '127.0.0.1', r))
	const p = (s.address() as { port: number }).port
	await new Promise<void>((r) => s.close(() => r()))
	return p
}
