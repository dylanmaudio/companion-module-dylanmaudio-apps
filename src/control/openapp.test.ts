import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { load } from '../../test/ctlmock.js'
import { DEFAULT_WINDOW_MODE, openApp, openAppActions, windowModeOf, type OpenAppContext } from './openapp.js'
import type { Catalogue } from './types.js'

const tlt = (): Catalogue => {
	const fx = load('tlt.json')
	return { app: 'tlt', name: 'Talk Light Trigger', version: 'x', hash: 'h', ...fx.catalogue } as Catalogue
}
/** Talk Light as it was before #705: show, but no window switch. */
const tltBefore705 = (): Catalogue => {
	const c = tlt()
	return {
		...c,
		controls: c.controls.filter((x) => x.id !== 'tlt.window'),
		state: c.state.filter((s) => s.key !== 'tlt.window_open'),
	}
}

function context(over: Partial<OpenAppContext>) {
	const calls = { pressed: [] as string[], values: [] as unknown[], logs: [] as string[] }
	const ctx: OpenAppContext = {
		app: 'tlt',
		running: () => false,
		catalogue: () => null,
		press: async (c, v) => {
			calls.pressed.push(c)
			calls.values.push(v)
		},
		log: (_level, m) => void calls.logs.push(m),
		...over,
	}
	return { ctx, calls }
}

describe('Open <app>', () => {
	it("says to start the app when it isn't running: the module never starts one", async () => {
		const { ctx, calls } = context({})
		await openApp(ctx)
		expect(calls.pressed).toEqual([])
		expect(calls.logs).toEqual(["Talk Light Trigger isn't running. Start it on this Mac, then press again."])
	})

	it("names the Mac to start it on when the app isn't on this one (#106)", async () => {
		const { ctx, calls } = context({ host: 'studio-mac.local' })
		await openApp(ctx)
		expect(calls.logs).toEqual([
			"Talk Light Trigger isn't answering at studio-mac.local. Start it on that Mac, then press again.",
		])
		const local = context({ host: '127.0.0.1' })
		await openApp(local.ctx)
		expect(local.calls.logs).toEqual(["Talk Light Trigger isn't running. Start it on this Mac, then press again."])
	})

	it('asks a running app to show itself, when it offers a show control but no window switch', async () => {
		const { ctx, calls } = context({ running: () => true, catalogue: tltBefore705 })
		await openApp(ctx)
		expect(calls.pressed).toEqual(['tlt.show'])
	})

	it('leaves a running app without a show control alone, and says why', async () => {
		const older = { ...tltBefore705(), controls: tltBefore705().controls.filter((c) => c.id !== 'tlt.show') }
		const { ctx, calls } = context({ running: () => true, catalogue: () => older })
		await openApp(ctx)
		expect(calls.pressed).toEqual([])
		expect(calls.logs[0]).toMatch(/already running/)
	})

	// #705: an app that offers a window toggle gets its window closed by a second press.
	// Talk Light's real catalogue, as fixtures/control/tlt.json carries it since #705
	const withWindow = tlt

	it('the real fixture offers the switch in the shape the module looks for', () => {
		expect(tlt().controls.find((c) => c.id === 'tlt.window')).toMatchObject({
			kind: 'toggle',
			state: 'tlt.window_open',
		})
		expect(tlt().state.find((s) => s.key === 'tlt.window_open')).toMatchObject({ type: 'bool' })
	})

	it('toggles the window when the app offers a window toggle (#705)', async () => {
		const { ctx, calls } = context({ running: () => true, catalogue: withWindow })
		await openApp(ctx)
		expect(calls.pressed).toEqual(['tlt.window'])
		expect(calls.values).toEqual(['toggle'])
	})

	it('a key already on a page, built before #705, toggles too: its options are empty', async () => {
		const { ctx, calls } = context({ running: () => true, catalogue: withWindow })
		await (openAppActions(ctx).open_app || undefined)?.callback({ options: {} } as never, {} as never)
		expect(calls.pressed).toEqual(['tlt.window'])
	})

	it('can still be set to only bring the window forward', async () => {
		const { ctx, calls } = context({ running: () => true, catalogue: withWindow })
		const def = openAppActions(ctx).open_app || undefined
		expect(def?.options).toEqual([expect.objectContaining({ type: 'dropdown', id: 'window', default: 'toggle' })])
		await def?.callback({ options: { window: 'show' } } as never, {} as never)
		expect(calls.pressed).toEqual(['tlt.show'])
	})

	it('ignores a window control that is not a toggle, and shows instead', async () => {
		const odd = { ...withWindow() }
		odd.controls = odd.controls.map((c) => (c.id === 'tlt.window' ? { ...c, kind: 'action' as const } : c))
		const { ctx, calls } = context({ running: () => true, catalogue: () => odd })
		await openApp(ctx)
		expect(calls.pressed).toEqual(['tlt.show'])
	})

	// The operator, 27 Nov 2026: "if we can default SR and CxC buttons to go to
	// open app, and menu bar apps open and close, that will be good".
	it('is born toggling for a menu-bar app and showing for a windowed one', () => {
		expect(DEFAULT_WINDOW_MODE).toEqual({
			bridge: 'toggle',
			tlt: 'toggle',
			ptt: 'toggle',
			tct: 'toggle',
			cxc: 'show',
			sr: 'show',
		})
		for (const app of ['bridge', 'tlt', 'ptt', 'tct', 'cxc', 'sr'] as const) {
			const { ctx } = context({ app })
			const option = openAppActions(ctx).open_app?.options?.[0] as { default?: string } | undefined
			expect(option?.default, app).toBe(DEFAULT_WINDOW_MODE[app])
		}
	})

	it("only brings Show Recorder's window forward, where a menu-bar app's toggles", async () => {
		const srCat = (): Catalogue => {
			const c = tlt()
			return {
				...c,
				app: 'sr',
				controls: c.controls.map((x) => ({ ...x, id: x.id.replace(/^tlt\./, 'sr.') })),
				state: c.state.map((x) => ({ ...x, key: x.key.replace(/^tlt\./, 'sr.') })),
			}
		}
		const { ctx, calls } = context({ app: 'sr', running: () => true, catalogue: srCat })
		await openAppActions(ctx).open_app?.callback({ options: { window: 'show' } }, {})
		expect(calls.pressed).toEqual(['sr.show'])
		expect(calls.values).toEqual([undefined])
	})

	it("falls back to the app's default for a value Companion would refuse", () => {
		expect(windowModeOf('sr', undefined)).toBe('show')
		expect(windowModeOf('sr', 'toggle')).toBe('toggle')
		expect(windowModeOf('tct', undefined)).toBe('toggle')
		expect(windowModeOf('tct', 'open')).toBe('toggle')
		expect(windowModeOf('cxc', '')).toBe('show')
	})

	it('is one action, named for the app', () => {
		const { ctx } = context({})
		expect(Object.keys(openAppActions(ctx))).toEqual(['open_app'])
		expect(openAppActions(ctx).open_app?.name).toBe('Open Talk Light Trigger')
	})

	it('asks Companion for no special permissions, so the module is never flagged as dangerous', () => {
		const manifest = JSON.parse(readFileSync(new URL('../../companion/manifest.json', import.meta.url), 'utf8')) as {
			runtime: { permissions?: Record<string, boolean> }
		}
		expect(Object.values(manifest.runtime.permissions ?? {}).some(Boolean)).toBe(false)
	})
})
