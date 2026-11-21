/**
 * The app frame: what it adds to a key, and what it must leave alone.
 * The look itself was chosen on a real deck (page 12, FRAMES, 21 Nov 2026).
 */
import { describe, expect, it } from 'vitest'
import { load } from '../../../test/ctlmock.js'
import { GetConfigFields, normaliseConfig } from '../../config.js'
import { buildControlPresets } from '../definitions.js'
import type { AppId } from '../registry.js'
import type { Catalogue } from '../types.js'
import { APP_TAG, FRAME_WIDTH, frameAllWithApp, frameWithApp } from './appframe.js'
import type { Json, Preset } from './layers.js'
import { brandOf } from './palette.js'

function presetsOf(app: AppId) {
	const fx = load(`${app}.json`) as unknown as {
		app: { id: AppId; name: string; version: string }
		catalogue: Omit<Catalogue, 'app' | 'name' | 'version' | 'hash'>
	}
	const cat = { app: fx.app.id, name: fx.app.name, version: fx.app.version, hash: 'h', ...fx.catalogue } as Catalogue
	return buildControlPresets(cat, app).presets
}
const els = (p: Preset | undefined) => (p as unknown as { elements: Json[] }).elements
const el = (p: Preset | undefined, id: string) => els(p).find((e) => e.id === id)

describe('a framed key', () => {
	const sr = presetsOf('sr')

	it("wears the app's bright colour on all four edges, as the bg box's own border", () => {
		const bg = el(frameWithApp(sr.p_sr__record!, 'sr'), 'bg')
		expect(bg).toMatchObject({
			borderColor: brandOf('sr').main.bg,
			borderWidth: FRAME_WIDTH,
			borderPosition: 'inside',
		})
	})

	it('carries the badge in the deep colour, with the initials in its text colour', () => {
		for (const app of ['bridge', 'tlt', 'ptt', 'tct', 'cxc', 'sr'] as AppId[]) {
			const [, first] = Object.entries(presetsOf(app))[0]
			const p = frameWithApp(first!, app)
			expect(el(p, 'appBadge')).toMatchObject({ type: 'box', color: brandOf(app).deep.bg })
			expect(el(p, 'appBadgeText')).toMatchObject({ text: APP_TAG[app], color: brandOf(app).deep.text })
		}
	})

	it('follows the colour the app reports, not only the built-in one', () => {
		const said = { main: { bg: '#123456', text: '#ffffff' }, deep: { bg: '#654321', text: '#ffffff' } }
		const p = frameWithApp(sr.p_sr__record!, 'sr', said)
		expect(el(p, 'bg')?.borderColor).toBe(0x123456)
		expect(el(p, 'appBadge')?.color).toBe(0x654321)
	})

	it('draws the badge last, so nothing covers it, and below the show-critical bar when there is one', () => {
		const plain = frameWithApp(sr.p_sr__record!, 'sr')
		expect(els(plain).at(-1)?.id).toBe('appBadgeText')
		expect(el(plain, 'appBadge')?.y).toBe(3 + FRAME_WIDTH)
		const critical = frameWithApp(sr.p_sr__stop!, 'sr') // Stop is show-critical
		const bar = el(critical, 'critical') as Json
		expect(el(critical, 'appBadge')?.y as number).toBeGreaterThanOrEqual((bar.y as number) + (bar.height as number))
	})

	it('changes nothing else: the same press, the same feedbacks, the original untouched', () => {
		const before = JSON.stringify(sr.p_sr__record)
		const p = frameWithApp(sr.p_sr__record!, 'sr') as unknown as Json
		expect(JSON.stringify(sr.p_sr__record)).toBe(before)
		const orig = sr.p_sr__record as unknown as Json
		expect(p.steps).toEqual(orig.steps)
		expect(p.feedbacks).toEqual(orig.feedbacks)
		expect(els(p as never)).toHaveLength(els(sr.p_sr__record).length + 2)
		expect(els(p as never).map((e) => e.id)).toEqual([
			...els(sr.p_sr__record).map((e) => e.id),
			'appBadge',
			'appBadgeText',
		])
	})

	it('makes room: text inside the frame, a caption after the badge, a full label below it, a mark as it was', () => {
		const badge = (p: Preset) => el(p, 'appBadge') as Json
		const right = (b: Json) => (b.x as number) + (b.width as number)
		const bottom = (b: Json) => (b.y as number) + (b.height as number)
		for (const app of ['bridge', 'tlt', 'ptt', 'tct', 'cxc', 'sr'] as AppId[]) {
			for (const p of Object.values(frameAllWithApp(presetsOf(app), app))) {
				const b = badge(p!)
				for (const t of els(p).filter((e) => e.type === 'text' && !String(e.id).startsWith('appBadge'))) {
					// a mark is one narrow centred glyph in a full-width box: it keeps its box
					if (t.id === 'mark') continue
					expect(t.x as number, `${app} ${String(t.id)}`).toBeGreaterThanOrEqual(FRAME_WIDTH)
					expect(right(t)).toBeLessThanOrEqual(100 - FRAME_WIDTH)
					const overlaps =
						(t.x as number) < right(b) &&
						right(t) > (b.x as number) &&
						(t.y as number) < bottom(b) &&
						bottom(t) > (b.y as number)
					expect(overlaps, `${app} ${t.id} under the badge`).toBe(false)
				}
			}
		}
		const tlt = presetsOf('tlt')
		expect(el(frameWithApp(tlt.p_tlt__threshold__show!, 'tlt'), 'caption')?.x as number).toBeGreaterThan(30)
		const mark = el(sr.p_sr__record, 'mark') as Json
		expect(el(frameWithApp(sr.p_sr__record!, 'sr'), 'mark')).toMatchObject({ y: mark.y, height: mark.height })
	})

	it('the frame and the badge each work alone', () => {
		const frameOnly = frameWithApp(sr.p_sr__record!, 'sr', null, { frame: true, badge: false })
		expect(el(frameOnly, 'bg')?.borderWidth).toBe(FRAME_WIDTH)
		expect(el(frameOnly, 'appBadge')).toBeUndefined()
		// text stays inside the frame, but nothing makes room for a badge that isn't there
		const tlt = presetsOf('tlt')
		expect(
			el(frameWithApp(tlt.p_tlt__threshold__show!, 'tlt', null, { frame: true, badge: false }), 'caption')?.x,
		).toBe(FRAME_WIDTH)
		const badgeOnly = frameWithApp(sr.p_sr__record!, 'sr', null, { frame: false, badge: true })
		expect(el(badgeOnly, 'bg')?.borderWidth).toBeUndefined()
		expect(el(badgeOnly, 'appBadge')).toMatchObject({ x: 3, y: 3 })
		expect(el(badgeOnly, 'appBadgeText')?.text).toBe('SR')
	})

	it('neither: the preset is returned as it was', () => {
		const none = { frame: false, badge: false }
		expect(frameWithApp(sr.p_sr__record!, 'sr', null, none)).toBe(sr.p_sr__record)
		expect(frameAllWithApp(sr, 'sr', null, none)).toBe(sr)
	})

	it('frames a whole set, and leaves a preset with no bg box as it is', () => {
		const all = frameAllWithApp(sr, 'sr')
		expect(Object.keys(all)).toEqual(Object.keys(sr))
		expect(Object.values(all).every((p) => el(p, 'appBadge'))).toBe(true)
		const odd = { type: 'layered', name: 'x', elements: [{ type: 'text', id: 'label' }] } as unknown as Preset
		expect(frameWithApp(odd, 'sr')).toBe(odd)
	})
})

describe('the settings', () => {
	it('are off unless set, so a one-app page stays neutral', () => {
		expect(normaliseConfig({})).toMatchObject({ appFrame: false, appBadge: false })
		expect(normaliseConfig({ appFrame: 'yes' as never, appBadge: 1 as never })).toMatchObject({
			appFrame: false,
			appBadge: false,
		})
		expect(normaliseConfig({ appFrame: true, appBadge: true })).toMatchObject({ appFrame: true, appBadge: true })
	})

	it('are two checkboxes every connection shows, both off by default', () => {
		for (const id of ['appFrame', 'appBadge']) {
			const f = GetConfigFields().find((x) => x.id === id)
			expect(f, id).toMatchObject({ type: 'checkbox', default: false })
			expect((f as { isVisibleExpression?: string }).isVisibleExpression).toBeUndefined()
		}
	})
})
