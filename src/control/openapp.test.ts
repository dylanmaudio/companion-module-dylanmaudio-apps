import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { load } from '../../test/ctlmock.js'
import { openApp, openAppActions, type OpenAppContext } from './openapp.js'
import type { Catalogue } from './types.js'

const tlt = (): Catalogue => {
	const fx = load('tlt.json')
	return { app: 'tlt', name: 'Talk Light Trigger', version: 'x', hash: 'h', ...fx.catalogue } as Catalogue
}

function context(over: Partial<OpenAppContext>) {
	const calls = { pressed: [] as string[], logs: [] as string[] }
	const ctx: OpenAppContext = {
		app: 'tlt',
		running: () => false,
		catalogue: () => null,
		press: async (c) => void calls.pressed.push(c),
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

	it('asks a running app to show itself, when it offers a show control', async () => {
		const { ctx, calls } = context({ running: () => true, catalogue: tlt })
		await openApp(ctx)
		expect(calls.pressed).toEqual(['tlt.show'])
	})

	it('leaves a running app without a show control alone, and says why', async () => {
		const older = { ...tlt(), controls: tlt().controls.filter((c) => c.id !== 'tlt.show') }
		const { ctx, calls } = context({ running: () => true, catalogue: () => older })
		await openApp(ctx)
		expect(calls.pressed).toEqual([])
		expect(calls.logs[0]).toMatch(/already running/)
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
