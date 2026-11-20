/**
 * The app's own colour, and the table that stands in for it.
 *
 * APP_BRAND is a mirror of the monorepo's shared/brand.py, which is itself a
 * mirror of the stylesheets. A mirror nobody checks goes stale, so the first
 * test here holds it against every fixtures/control file — the same files
 * the monorepo's shared/tests/test_brand.py checks against the CSS. A colour
 * re-pick that reaches the apps therefore fails here until it is mirrored,
 * and a connection to a current app never reads the table at all.
 */
import { describe, expect, it } from 'vitest'
import { FILES, infoBrand, load } from '../../../test/ctlmock.js'
import { APP_IDS, isAppId } from '../registry.js'
import type { Brand } from '../types.js'
import { buildLookPresets } from './looks.js'
import { APP_BRAND, brandOf } from './palette.js'

const num = (h: string): number => parseInt(h.replace('#', ''), 16)

/** WCAG 2.1 relative luminance and contrast, on `#rrggbb`. */
function contrast(a: string, b: string): number {
	const lum = (h: string): number => {
		const ch = [1, 3, 5].map((i) => {
			const c = parseInt(h.slice(i, i + 2), 16) / 255
			return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
		})
		return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]
	}
	const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
	return (hi + 0.05) / (lo + 0.05)
}

describe('APP_BRAND mirrors the apps', () => {
	const appFiles = FILES.map((f) => ({ f, fx: load(f) })).filter(({ fx }) => isAppId(fx.app.id))

	it('covers every app this module can connect to', () => {
		expect(Object.keys(APP_BRAND).sort()).toEqual([...APP_IDS].sort())
		// and every app fixture is one of them, so none goes unchecked below
		expect(appFiles.length).toBeGreaterThanOrEqual(APP_IDS.length)
	})

	for (const { f, fx } of appFiles) {
		it(`${f}: the fallback equals what the app reports`, () => {
			const reported = infoBrand(fx)
			expect(reported, `${f} reports no brand block`).toBeTruthy()
			expect(APP_BRAND[fx.app.id as keyof typeof APP_BRAND]).toEqual(reported)
		})
	}

	for (const app of APP_IDS) {
		it(`${app}: the colour a key paints clears AA for small text`, () => {
			const { deep } = APP_BRAND[app]
			expect(contrast(deep.bg, deep.text)).toBeGreaterThanOrEqual(4.5)
		})
	}
})

describe('brandOf', () => {
	const said: Brand = {
		main: { bg: '#112233', text: '#445566' },
		deep: { bg: '#778899', text: '#aabbcc' },
	}

	it('takes what the app says over the table', () => {
		expect(brandOf('sr', said)).toEqual({
			main: { bg: num('#112233'), text: num('#445566') },
			deep: { bg: num('#778899'), text: num('#aabbcc') },
		})
	})

	it('falls back when the app says nothing — an older build', () => {
		expect(brandOf('tlt')).toEqual(brandOf('tlt', null))
		expect(brandOf('tlt').deep.bg).toBe(num(APP_BRAND.tlt.deep.bg))
	})

	it('falls back field by field, not block by block, on a value it cannot read', () => {
		const bad = { main: { bg: 'rebeccapurple', text: '#445566' }, deep: { bg: '#778899' } } as unknown as Brand
		const got = brandOf('ptt', bad)
		expect(got.main.bg).toBe(num(APP_BRAND.ptt.main.bg)) // not a #rrggbb — the table stands in
		expect(got.main.text).toBe(num('#445566')) // the field beside it is still the app's
		expect(got.deep.bg).toBe(num('#778899'))
		expect(got.deep.text).toBe(num(APP_BRAND.ptt.deep.text)) // absent — the table stands in
	})
})

describe('the identity key wears it', () => {
	type Json = Record<string, any>
	const logoOf = (app: 'sr' | 'tlt', brand?: Brand): Json[] => {
		const preset = buildLookPresets(app, null, app, (k) => k, brand).presets[`p_${app}__look_logo`] as Json
		return preset.elements as Json[]
	}
	const el = (elements: Json[], id: string): Json => elements.find((e) => e.id === id) as Json

	it('paints the app deep colour behind the logo, and its text colour on the name', () => {
		const elements = logoOf('sr')
		expect(el(elements, 'bg').color).toBe(num(APP_BRAND.sr.deep.bg))
		expect(el(elements, 'name').color).toBe(num(APP_BRAND.sr.deep.text))
	})

	it('follows the app when the app reports its own', () => {
		const brand: Brand = { main: { bg: '#ffeedd', text: '#000000' }, deep: { bg: '#204060', text: '#f0f0f0' } }
		const elements = logoOf('tlt', brand)
		expect(el(elements, 'bg').color).toBe(num('#204060'))
		expect(el(elements, 'name').color).toBe(num('#f0f0f0'))
	})
})
