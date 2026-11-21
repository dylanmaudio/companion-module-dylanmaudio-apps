/**
 * The MIDI Bridge app's control endpoint as the MIDI Bridge connection uses
 * it: against a server built from the bridge's real catalogue, and against
 * nothing at all, as with a bridge older than 1.1.9.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { createServer } from 'node:net'
import { CtlMock, load, waitFor } from '../../test/ctlmock.js'
import { BridgeAppControl } from './bridgectl.js'

function fakeHost() {
	const h = {
		label: 'dlive',
		vars: {} as Record<string, unknown>,
		checked: [] as string[],
		logs: [] as string[],
		log: (_l: string, m: string) => h.logs.push(m),
		setVariableValues: (v: Record<string, unknown>) => Object.assign(h.vars, v),
		checkFeedbacks: (...ids: string[]) => h.checked.push(...ids),
	}
	return h
}

async function closedPort(): Promise<number> {
	const s = createServer()
	await new Promise<void>((r) => s.listen(0, '127.0.0.1', r))
	const port = (s.address() as { port: number }).port
	await new Promise<void>((r) => s.close(() => r()))
	return port
}

describe('Console Bridge app control inside the Console Bridge connection', () => {
	let mock: CtlMock | null = null
	let app: BridgeAppControl | null = null
	afterEach(async () => {
		app?.stop()
		await mock?.stop()
		mock = null
		app = null
	})

	async function connect(): Promise<ReturnType<typeof fakeHost>> {
		mock = new CtlMock(load('bridge.json'))
		await mock.start()
		const host = fakeHost()
		app = new BridgeAppControl(host, '127.0.0.1', mock.port)
		let defined = false
		app.on('definitions', () => (defined = true))
		app.start()
		await waitFor(() => defined && host.vars.bridge_state === 'stopped', 'catalogue and state')
		return host
	}

	it('builds Run, Restart and Auto-reconnect from the catalogue, with bridge_ variables', async () => {
		const host = await connect()
		expect(Object.keys(app!.actions()).sort()).toEqual([
			'ctl_bridge__autoreconnect',
			'ctl_bridge__restart',
			'ctl_bridge__run',
			'ctl_bridge__show',
			'open_app',
		])
		expect(Object.keys(app!.variables())).toEqual(
			expect.arrayContaining(['bridge_state', 'bridge_running', 'bridge_msg_rate', 'bridge_app_connected']),
		)
		expect(host.vars).toMatchObject({ bridge_running: false, bridge_autoreconnect: true, bridge_app_connected: true })
		expect(app!.bridgeState).toBe('stopped')
		expect(Object.keys(app!.presets().presets)).toEqual(expect.arrayContaining(['p_bridge__run']))
		// the app frame, when the connection asks for it: the bridge's keys framed, its logo key not
		const framed = app!.presets(true).presets
		expect(JSON.stringify(framed.p_bridge__run)).toContain('appBadge')
		expect(JSON.stringify(app!.presets().presets.p_bridge__run)).not.toContain('appBadge')
		expect(framed.p_bridge__look_logo).toBeDefined()
		expect(JSON.stringify(framed.p_bridge__look_logo)).not.toContain('appBadge')
	})

	it('follows the core as the app reports it, and says when that changes', async () => {
		const host = await connect()
		let changes = 0
		app!.on('bridgeState', () => changes++)
		mock!.publish('bridge.state', 'connected')
		await waitFor(() => host.vars.bridge_state === 'connected', 'state change')
		expect(app!.bridgeState).toBe('connected')
		expect(changes).toBe(1)
		expect(host.checked).toContain('st_bridge__state__is')
	})

	it('a press reaches the app', async () => {
		const host = await connect()
		await app!.actions().ctl_bridge__run?.callback({ options: { mode: 'on' } }, {})
		expect(mock!.requests.filter((r) => r.path === '/ctl/v1/cmd')).toHaveLength(1)
		expect(host.logs.some((m) => m.startsWith('Console Bridge:'))).toBe(false)
	})

	it("with last time's catalogue, Run and Restart stay defined while the bridge app is down", async () => {
		const host = fakeHost()
		const fx = load('bridge.json')
		const cached = { app: 'bridge', name: 'MIDI Bridge', version: 'x', hash: 'kept', ...fx.catalogue }
		app = new BridgeAppControl(host, '127.0.0.1', await closedPort(), { retryMs: 20, cached: cached as never })
		expect(Object.keys(app.actions())).toEqual(expect.arrayContaining(['ctl_bridge__run', 'ctl_bridge__restart']))
		app.start()
		await app.actions().ctl_bridge__run?.callback({ options: { mode: 'on' } }, {})
		expect(host.logs.at(-1)).toMatch(/^Console Bridge isn't answering/)
	})

	it('says once, and only once, when the bridge is too old to have app control', async () => {
		const host = fakeHost()
		app = new BridgeAppControl(host, '127.0.0.1', await closedPort(), { retryMs: 20 })
		app.start()
		await new Promise((r) => setTimeout(r, 250))
		expect(host.logs.filter((m) => m.includes('1.1.9'))).toHaveLength(1)
		expect(host.vars.bridge_app_connected).toBe(false)
		expect(app.bridgeState).toBeNull()
		expect(Object.keys(app.actions())).toEqual(['open_app']) // what starts the bridge app
		expect(Object.keys(app.variables()).sort()).toEqual([
			'bridge_app_allowed',
			'bridge_app_connected',
			'bridge_app_locked',
		])
	})
})
