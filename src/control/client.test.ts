/**
 * The control client against a server built from fixtures/control — the
 * same files the monorepo replays its real ControlServer against, so both
 * sides are held to one contract. Never edit a case to make this green.
 *
 * The connection tests run against Pilot Tone Trigger's real catalogue. The
 * /cmd replay runs over every fixture file: all five apps, and the demo
 * contract, which still pins wire cases no app exercises (the browser
 * protections, every error code).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ANY_STR, CtlMock, FILES, load, waitFor } from '../../test/ctlmock.js'
import { ControlClient, type ControlClientOptions } from './client.js'
import type { CmdValue } from './types.js'

const demo = load('exchanges.json')
const ptt = load('ptt.json')

describe("ControlClient against Pilot Tone Trigger's real catalogue", () => {
	let mock: CtlMock
	let client: ControlClient
	const streaming = () => client.status === 'ok' && mock.requests.some((r) => r.path === '/ctl/v1/stream')

	beforeEach(async () => {
		mock = new CtlMock(ptt)
		await mock.start()
		client = new ControlClient({
			host: '127.0.0.1',
			port: mock.port,
			appName: 'Pilot Tone Trigger',
			retryMs: 30,
			mismatchRetryMs: 30,
		})
	})
	afterEach(async () => {
		client.stop()
		await mock.stop()
	})

	it('connects as the brief says: info, catalogue, state, then the stream from that seq', async () => {
		mock.publish('ptt.state', 'ok') // so the snapshot has a seq worth resuming from
		client.start()
		await waitFor(streaming, 'stream opened')
		expect(mock.requests.map((r) => r.path).slice(0, 4)).toEqual([
			'/ctl/v1/info',
			'/ctl/v1/catalogue',
			'/ctl/v1/state',
			'/ctl/v1/stream',
		])
		expect(mock.requests[3].headers['last-event-id']).toBe(String(mock.seq))
		expect(client.catalogue?.controls).toEqual(ptt.catalogue.controls)
		expect(client.catalogue?.state).toEqual(ptt.catalogue.state)
		expect(client.get('ptt.state')).toBe('ok')
		expect(client.get('ptt.failback_mode')).toBe('auto')
		expect(client.get('ptt.level_db')).toBeNull()
	})

	it('sends no Origin and a loopback Host — the server refuses anything else', async () => {
		client.start()
		await waitFor(streaming, 'stream')
		for (const r of mock.requests) {
			expect(r.headers.origin).toBeUndefined()
			expect(r.headers.host).toBe(`127.0.0.1:${mock.port}`)
		}
	})

	it('applies state deltas from the stream', async () => {
		const seen: Record<string, unknown>[] = []
		client.on('values', (v) => seen.push(v))
		client.start()
		await waitFor(streaming, 'stream')
		mock.publish('ptt.state', 'lost')
		mock.publish('ptt.reset_available', true)
		mock.publish('ptt.level_db', -12.5)
		await waitFor(() => client.get('ptt.level_db') === -12.5, 'level delta')
		expect(client.get('ptt.state')).toBe('lost')
		expect(client.get('ptt.reset_available')).toBe(true)
		expect(seen).toContainEqual({ 'ptt.state': 'lost' })
	})

	it('rebuilds when the app changes its catalogue', async () => {
		const lengths: number[] = []
		client.on('catalogue', (c) => lengths.push(c.controls.length))
		client.start()
		await waitFor(streaming, 'stream')
		mock.catalogue = { ...ptt.catalogue, controls: [...ptt.catalogue.controls, { id: 'ptt.extra' }] }
		mock.hash = 'h2'
		mock.emit('catalogue', { hash: 'h2' })
		await waitFor(() => client.catalogue?.hash === 'h2', 'refetched catalogue')
		expect(lengths).toEqual([ptt.catalogue.controls.length, ptt.catalogue.controls.length + 1])
	})

	it('says when Companion control is switched off in the app, and when it is back', async () => {
		mock.allowed = false
		client.start()
		await waitFor(() => client.status === 'not_allowed', 'not_allowed from /info')
		expect(client.statusMessage).toMatch(/Allow Companion control/)
		await waitFor(() => mock.requests.some((r) => r.path === '/ctl/v1/stream'), 'stream still opens')
		mock.allowed = true
		mock.emit('info', { allowed: true, locked: true })
		await waitFor(() => client.status === 'ok', 'ok after the switch')
		expect(client.statusMessage).toMatch(/locked/)
	})

	it('starts again from /state when its cursor has fallen off the ring (409 resync)', async () => {
		client.start()
		await waitFor(streaming, 'stream')
		mock.values['ptt.state'] = 'latched' // changed while the client was away, with no event it will see
		mock.resyncOnce = true
		mock.dropStreams()
		await waitFor(() => mock.resyncs === 1, '409 served')
		await waitFor(() => client.get('ptt.state') === 'latched', 'refetched state')
		expect(client.status).toBe('ok')
	})

	it('reports an API version mismatch instead of guessing', async () => {
		mock.ctl = 2
		client.start()
		await waitFor(() => client.status === 'mismatch', 'mismatch')
		expect(client.statusMessage).toMatch(/v2/)
		expect(mock.requests.some((r) => r.path === '/ctl/v1/catalogue')).toBe(false)
	})

	it('reports an app that is not running, and a press comes back ok:false rather than throwing', async () => {
		await mock.stop()
		client.start()
		await waitFor(() => client.status === 'not_running', 'not_running')
		expect(client.statusMessage).toMatch(/Pilot Tone Trigger isn't running/)
		const r = await client.cmd('ptt.run', 'on')
		expect(r).toMatchObject({ ok: false, status: 0, code: 'not_running' })
	})
})

// cmd.bad_request (no "control") and cmd.bad_content_type (text/plain) are
// server-side protections this client can't trigger: it always names a
// control and always sends JSON. Each file's guard test makes sure those are
// the only cases left out, so a new /cmd case can't be skipped by accident.
const UNSENDABLE = ['cmd.bad_content_type', 'cmd.bad_request']

for (const file of FILES) {
	const fx = load(file)
	const cases = fx.cases.filter(
		(c) => c.request.path === '/ctl/v1/cmd' && typeof c.request.body?.control === 'string' && !c.request.content_type,
	)

	describe(`/cmd: every case in fixtures/control/${file} that a client can send`, () => {
		let mock: CtlMock
		let client: ControlClient
		beforeEach(async () => {
			mock = new CtlMock(fx)
			await mock.start()
			client = new ControlClient({ host: '127.0.0.1', port: mock.port, appName: fx.app.name })
		})
		afterEach(async () => {
			await mock.stop()
		})

		for (const c of cases) {
			it(c.id, async () => {
				mock.allowed = c.setup?.allowed ?? true
				mock.locked = c.setup?.locked ?? false
				const { control, value } = c.request.body as { control: string; value?: CmdValue }
				const r = await client.cmd(control, value)

				const sent = mock.requests[mock.requests.length - 1]
				const { cid, ...rest } = sent.body ?? {}
				const { cid: _fixtureCid, ...want } = c.request.body ?? {}
				expect(rest).toEqual(want)
				expect(typeof cid).toBe('string')
				expect(sent.headers['content-type']).toBe('application/json')

				const rb = c.response.body as { ok: boolean; value?: unknown; error?: { code: string; message?: string } }
				expect(r.ok).toBe(rb.ok)
				expect(r.status).toBe(c.response.status)
				if (rb.ok) {
					if ('value' in rb) expect(r.value).toEqual(rb.value)
				} else {
					expect(r.code).toBe(rb.error?.code)
					const m = rb.error?.message
					if (m === ANY_STR) expect(typeof r.message).toBe('string')
					else if (m !== undefined) expect(r.message).toBe(m)
				}
			})
		}

		it('leaves out only the cases a client cannot produce', () => {
			const skipped = fx.cases.filter((c) => c.request.path === '/ctl/v1/cmd' && !cases.includes(c)).map((c) => c.id)
			for (const id of skipped) expect(UNSENDABLE).toContain(id)
		})
	})
}

describe('ControlClient across a network (#106)', () => {
	let mock: CtlMock
	let client: ControlClient | null = null
	const streaming = (c: ControlClient) => c.status === 'ok' && mock.requests.some((r) => r.path === '/ctl/v1/stream')

	beforeEach(async () => {
		mock = new CtlMock(ptt)
		await mock.start()
	})
	afterEach(async () => {
		client?.stop()
		client = null
		await mock.stop()
	})

	/** Short timings: answers within 200 ms, a quiet stream checked after 300 ms */
	const quick = (extra: Partial<ControlClientOptions> = {}): ControlClient =>
		(client = new ControlClient({
			host: '127.0.0.1',
			port: mock.port,
			appName: 'Pilot Tone Trigger',
			retryMs: 30,
			mismatchRetryMs: 30,
			requestTimeoutMs: 200,
			cmdTimeoutMs: 200,
			idleMs: 300,
			idleTickMs: 20,
			...extra,
		}))

	it('sends the token on every request', async () => {
		const c = quick({ token: 's3cret' })
		c.start()
		await waitFor(() => streaming(c), 'stream')
		await c.cmd('ptt.failback_mode', 'latch')
		expect(mock.requests.map((r) => r.path)).toEqual(
			expect.arrayContaining(['/ctl/v1/info', '/ctl/v1/catalogue', '/ctl/v1/state', '/ctl/v1/stream', '/ctl/v1/cmd']),
		)
		for (const r of mock.requests) expect(r.headers.authorization, r.path).toBe('Bearer s3cret')
	})

	it('sends no Authorization without a token', async () => {
		const c = quick()
		c.start()
		await waitFor(() => streaming(c), 'stream')
		for (const r of mock.requests) expect(r.headers.authorization, r.path).toBeUndefined()
	})

	it('a dead link reads as not answering within the watchdog time, not after TCP gives up', async () => {
		const c = quick()
		c.start()
		await waitFor(() => streaming(c), 'stream')
		mock.frozen = true
		const t0 = Date.now()
		await waitFor(() => c.status === 'not_running', 'noticed', 3000)
		expect(Date.now() - t0).toBeLessThan(1500)
		expect(c.statusMessage).toMatch(
			/^Pilot Tone Trigger isn't answering at 127\.0\.0\.1:\d+ \((stopped answering|no answer)\)$/,
		)
	})

	it('a lost press checks the link at once', async () => {
		const c = quick({ idleMs: 60_000 })
		c.start()
		await waitFor(() => streaming(c), 'stream')
		mock.frozen = true
		const r = await c.cmd('ptt.failback_mode', 'latch')
		expect(r).toMatchObject({ ok: false, code: 'not_running' })
		expect(r.message).toMatch(/^Pilot Tone Trigger isn't answering at 127\.0\.0\.1:\d+ \(no answer\)$/)
		await waitFor(() => c.status === 'not_running', 'noticed', 2000)
	})

	it('a slow press is waited for: a handler may take longer than a read', async () => {
		const c = quick({ requestTimeoutMs: 100, cmdTimeoutMs: 2000 })
		c.start()
		await waitFor(() => streaming(c), 'stream')
		mock.cmdDelayMs = 400 // MIDI Bridge's Restart can block for seconds
		const r = await c.cmd('ptt.failback_mode', 'latch')
		expect(r.code).not.toBe('not_running')
		expect(c.status).toBe('ok')
	})

	it('a refused token says so, and is asked about again slowly', async () => {
		mock.refuse = 'Token required'
		const c = quick({ mismatchRetryMs: 10_000 })
		c.start()
		await waitFor(() => c.status === 'refused', 'refused')
		expect(c.statusMessage).toBe(
			"Pilot Tone Trigger refused this connection (Token required). Check the token in this connection's settings.",
		)
		const asked = mock.requests.length
		await new Promise((r) => setTimeout(r, 300))
		expect(mock.requests.length).toBe(asked)
	})

	it("doesn't call an app on another machine 'not running' when it can't be reached", async () => {
		const c = (client = new ControlClient({
			host: 'no-such-host.invalid',
			port: 8772,
			appName: 'Pilot Tone Trigger',
			retryMs: 30,
		}))
		c.start()
		await waitFor(() => c.status === 'not_running', 'status')
		expect(c.statusMessage).toBe("Pilot Tone Trigger isn't answering at no-such-host.invalid:8772 (address not found)")
	})
})

describe('fixtures/control', () => {
	it('has the demo contract and all five apps', () => {
		expect(FILES.sort()).toEqual(['bridge.json', 'cxc.json', 'exchanges.json', 'ptt.json', 'tct.json', 'tlt.json'])
		expect(demo.cases.length).toBeGreaterThan(20)
	})
})
