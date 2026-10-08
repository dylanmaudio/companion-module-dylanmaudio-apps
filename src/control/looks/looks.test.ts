/**
 * The styled keys, for every app's real catalogue: everything a preset
 * refers to must exist, and the looks that mirror the apps must match them.
 */
import { describe, expect, it } from 'vitest'
import { load } from '../../../test/ctlmock.js'
import { bareNaming, buildControlActions, buildControlFeedbacks, prefixedNaming } from '../definitions.js'
import { OPEN_APP_ACTION } from '../openapp.js'
import type { AppId } from '../registry.js'
import type { Catalogue } from '../types.js'
import { APP_LOGOS, MENUBAR_ICONS } from './images.js'
import { buildLookPresets } from './looks.js'
import { timecodeReadoutPresets } from '../readout-defs.js'
import { PALETTE, PTT_TILE } from './palette.js'

type Json = Record<string, any>
const APPS: AppId[] = ['bridge', 'tlt', 'ptt', 'tct', 'cxc', 'sr']
const catOf = (app: AppId): Catalogue => {
	const fx = load(`${app}.json`)
	return { app: fx.app.id, name: fx.app.name, version: 'x', hash: 'h', ...fx.catalogue } as Catalogue
}
function looksFor(app: AppId): { cat: Catalogue; presets: Record<string, Json>; section: Json } {
	const cat = catOf(app)
	const r = buildLookPresets(
		app,
		cat,
		app === 'bridge' ? 'dlive' : app,
		app === 'bridge' ? prefixedNaming : bareNaming(cat),
	)
	return { cat, presets: r.presets as Record<string, Json>, section: r.section }
}
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

describe('styled keys', () => {
	for (const app of APPS) {
		it(`${app}: every feedback, action and element a preset uses exists`, () => {
			const { cat, presets, section } = looksFor(app)
			const feedbacks = Object.keys(buildControlFeedbacks(cat, () => null))
			const actions = [...Object.keys(buildControlActions(cat, async () => undefined)), OPEN_APP_ACTION]
			expect(section.definitions).toEqual(Object.keys(presets))
			for (const [id, p] of Object.entries(presets)) {
				expect(p.type).toBe('layered')
				const elementIds = (p.elements as Json[]).map((e) => e.id as string)
				expect(new Set(elementIds).size, id).toBe(elementIds.length)
				for (const f of p.feedbacks as Json[]) {
					expect(feedbacks, `${id}: feedback`).toContain(f.feedbackId)
					// Companion drops a feedback whose overrides aren't wrapped as { value, isExpression }
					expect((f.styleOverrides as Json[]).length, `${id}: overrides`).toBeGreaterThan(0)
					for (const o of f.styleOverrides as Json[])
						expect(o.override, `${id}: wrapped`).toMatchObject({ isExpression: false })
					for (const o of f.styleOverrides as Json[]) expect(elementIds, `${id}: override`).toContain(o.elementId)
				}
				for (const step of p.steps as Json[])
					for (const a of step.down as Json[]) expect(actions, `${id}: action`).toContain(a.actionId)
			}
		})
	}

	it('every app has its logo, and every menu-bar app its icon; both open the app', () => {
		for (const app of APPS) {
			const { presets } = looksFor(app)
			expect(presets[`p_${app}__look_logo`]?.steps[0].down[0].actionId).toBe(OPEN_APP_ACTION)
			// Console Control and Show Recorder are windowed apps: no menu-bar icon to mirror
			if (app !== 'cxc' && app !== 'sr')
				expect(presets[`p_${app}__look_menubar`]?.steps[0].down[0].actionId).toBe(OPEN_APP_ACTION)
		}
		expect(looksFor('cxc').presets.p_cxc__look_menubar).toBeUndefined()
		expect(looksFor('sr').presets.p_sr__look_menubar).toBeUndefined()
	})

	it('every text is big enough to read on a Stream Deck key', () => {
		// Companion draws text at fontsize% of the element's own height, over 1.2 (its RenderThread)
		const presets = [...APPS.flatMap((app) => Object.values(looksFor(app).presets))]
		const readout = timecodeReadoutPresets(catOf('tct'), 'tct')
		presets.push(...(Object.values(readout?.presets ?? {}) as Json[]))
		for (const p of presets)
			for (const e of p.elements as Json[])
				if (e.type === 'text') {
					const percentOfKey = ((e.fontsize as number) * (e.height as number)) / 100 / 1.2
					expect(percentOfKey, `${p.name as string}: ${e.id as string}`).toBeGreaterThanOrEqual(14)
				}
	})

	it('the images are PNGs: a logo per app, an icon per menu-bar state', () => {
		const all = [...Object.values(APP_LOGOS), ...Object.values(MENUBAR_ICONS).flatMap((s) => Object.values(s))]
		// counted, not pinned: an app that adds a state (Pilot Tone's "degraded") adds an icon
		expect(Object.keys(APP_LOGOS).sort()).toEqual([...APPS].sort())
		for (const [app, icons] of Object.entries(MENUBAR_ICONS)) expect(Object.keys(icons).length, app).toBeGreaterThan(2)
		for (const b of all) expect([...Buffer.from(b, 'base64').subarray(0, 8)]).toEqual(PNG)
	})

	it("Pilot Tone's Latch key and status tile turn the app's latch amber", () => {
		const { presets } = looksFor('ptt')
		const latch = presets.p_ptt__look_latch.feedbacks[0]
		expect(latch.options).toEqual({ value: 'latch' })
		expect(latch.styleOverrides).toContainEqual({
			elementId: 'pill',
			elementProperty: 'color',
			override: { value: PALETTE.amber, isExpression: false },
		})
		const tile = (presets.p_ptt__look_status.feedbacks as Json[]).find((f) => f.options.value === 'latched')
		expect(tile?.styleOverrides).toContainEqual({
			elementId: 'tile',
			elementProperty: 'color',
			override: { value: PTT_TILE.latched.fill, isExpression: false },
		})
		expect(PALETTE.amber).toBe(0xe8a94a)
	})

	it('each Run key says whose it is, in words', () => {
		const names = (['bridge', 'tlt', 'ptt', 'tct'] as AppId[]).map((app) => {
			const run = looksFor(app).presets[`p_${app}__look_run`]
			return (run.elements as Json[]).find((e) => e.id === 'name')?.text
		})
		expect(names).toEqual(['BRIDGE', 'TALK', 'PILOT', 'TIMECODE'])
	})

	it("Pilot Tone's failback pills read Auto and Latch", () => {
		const { presets } = looksFor('ptt')
		const label = (id: string) => (presets[id].elements as Json[]).find((e) => e.id === 'label')?.text
		expect([label('p_ptt__look_auto'), label('p_ptt__look_latch')]).toEqual(['Auto', 'Latch'])
	})

	it('Run fills green and says RUNNING while the app runs', () => {
		const run = looksFor('tlt').presets.p_tlt__look_run.feedbacks[0] as Json
		expect(run.feedbackId).toBe('st_tlt__running')
		expect(run.styleOverrides).toContainEqual({
			elementId: 'ring',
			elementProperty: 'color',
			override: { value: PALETTE.good, isExpression: false },
		})
		expect(run.styleOverrides).toContainEqual({
			elementId: 'label',
			elementProperty: 'text',
			override: { value: 'RUNNING', isExpression: false },
		})
	})

	it("the bridge's icon shows MIDI activity over its state, with bridge_ variables", () => {
		const { presets } = looksFor('bridge')
		const fbs = presets.p_bridge__look_menubar.feedbacks as Json[]
		expect(fbs.at(-1)).toMatchObject({ feedbackId: 'st_bridge__activity' })
		expect(JSON.stringify(presets.p_bridge__look_menubar.elements)).toContain('$(dlive:bridge_state)')
		expect(presets.p_bridge__look_run).toBeDefined()
	})

	it("the Run key's label holds RUNNING whole, not RUN / NING", () => {
		// Companion breaks a word that doesn't fit rather than shrinking it (#54)
		for (const app of APPS) {
			const run = looksFor(app).presets[`p_${app}__look_run`]
			if (!run) continue
			const label = (run.elements as Json[]).find((e) => e.id === 'label') as Json
			const ofKey = ((label.fontsize as number) * (label.height as number)) / 100 / 1.2
			expect('RUNNING'.length * 0.7 * ofKey, app).toBeLessThanOrEqual(92.5)
		}
	})

	it('the Talk Light and Pilot Tone meters mark their thresholds; Time Code has none', () => {
		const line = (app: AppId) =>
			(looksFor(app).presets[`p_${app}__look_meter`].elements as Json[]).find((e) => e.id === 'threshold')
		expect(JSON.stringify(line('tlt'))).toContain('$(tlt:threshold_db)')
		expect(JSON.stringify(line('ptt'))).toContain('$(ptt:threshold_db)')
		expect(line('tct')).toBeUndefined()
	})

	it('no expression joins text with +, which Companion adds as numbers', () => {
		// Companion's + only joins strings when an expression asks for it: -53 + ' dB' draws NaN. concat() joins.
		const presets = [...APPS.flatMap((app) => Object.values(looksFor(app).presets))]
		presets.push(...(Object.values(timecodeReadoutPresets(catOf('tct'), 'tct')?.presets ?? {}) as Json[]))
		const expressions: string[] = []
		const walk = (x: unknown): void => {
			if (Array.isArray(x)) x.forEach(walk)
			else if (x && typeof x === 'object') {
				const o = x as Json
				if (o.isExpression === true && typeof o.value === 'string') expressions.push(o.value)
				Object.values(o).forEach(walk)
			}
		}
		presets.forEach(walk)
		expect(expressions.length).toBeGreaterThan(0)
		for (const e of expressions) expect(e, e).not.toMatch(/['"`]\s*\+|\+\s*['"`]/)
		expect(JSON.stringify(looksFor('tlt').presets.p_tlt__look_meter)).toContain("concat(round($(tlt:level_db)), ' dB')")
	})

	it('with no catalogue there is still the logo, which starts the app', () => {
		expect(Object.keys(buildLookPresets('ptt', null, 'ptt', (k) => k).presets)).toEqual(['p_ptt__look_logo'])
	})
})
