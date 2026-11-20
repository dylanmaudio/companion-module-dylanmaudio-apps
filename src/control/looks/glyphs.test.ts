/**
 * The marks on the keys.
 *
 * A mark is only worth having if Companion really draws it, in one colour, on
 * every machine. That can't be decided here — it needs Companion's own fonts
 * and canvas — so tools/glyph-check.mjs renders each one through them and
 * records the result, and these tests hold the table to that record. Adding a
 * mark without re-running the tool fails, which is the point: the last way to
 * find out that a glyph is a missing-glyph box should not be a show.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { load } from '../../../test/ctlmock.js'
import { buildControlPresets } from '../definitions.js'
import type { Catalogue } from '../types.js'
import { GLYPH, KEY_LOOKS, type Mark } from './labels.js'

interface Verified {
	companion: string
	glyphs: Record<string, { codepoint: string; drawn: boolean; mono: boolean; needsEmoji: boolean }>
}
const record = JSON.parse(
	readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'glyphs-verified.json'), 'utf8'),
) as Verified

const marks = Object.entries(GLYPH) as [string, Mark][]

describe('every mark was drawn by Companion before it was used', () => {
	it('the record covers the table, and nothing else', () => {
		expect(Object.keys(record.glyphs).sort()).toEqual(marks.map(([n]) => n).sort())
	})

	for (const [name, mark] of marks) {
		it(`${name}: drawn, in one colour, without the emoji font`, () => {
			const r = record.glyphs[name]
			expect(r, `${name} is not in glyphs-verified.json — run tools/glyph-check.mjs --write`).toBeTruthy()
			expect(`U+${mark.char.codePointAt(0)?.toString(16).toUpperCase().padStart(4, '0')}`).toBe(r.codepoint)
			expect(r.drawn, `${name} draws nothing, or draws the missing-glyph box`).toBe(true)
			// An emoji is painted in its own colours, so a feedback could not light it.
			expect(r.mono, `${name} is drawn in colour, so a feedback cannot recolour it`).toBe(true)
			expect(r.needsEmoji, `${name} comes from the emoji font`).toBe(false)
		})
	}

	it('each mark is one character — a key has room for one', () => {
		for (const [name, mark] of marks) expect([...mark.char].length, name).toBe(1)
	})

	it('a scale is a nudge, not a redesign', () => {
		for (const [name, mark] of marks) {
			if (mark.scale === undefined) continue
			expect(mark.scale, name).toBeGreaterThanOrEqual(0.6)
			expect(mark.scale, name).toBeLessThanOrEqual(1.6)
		}
	})
})

describe('a marked key', () => {
	type Json = Record<string, any>
	const catOf = (app: string): Catalogue => {
		const fx = load(`${app}.json`)
		return { app: fx.app.id, name: fx.app.name, version: 'x', hash: 'h', ...fx.catalogue } as Catalogue
	}
	const presets = (app: string): Record<string, Json> =>
		buildControlPresets(catOf(app), app).presets as Record<string, Json>
	const elements = (p: Json): Json[] => p.elements as Json[]
	const el = (p: Json, id: string): Json | undefined => elements(p).find((e) => e.id === id)

	it('carries the mark above its word, both as their own elements', () => {
		const p = presets('sr').p_sr__record
		expect(el(p, 'mark')?.text).toBe(GLYPH.record.char)
		expect(el(p, 'label')?.text).toBe('REC')
		// the word sits below the mark, and inside the key
		expect((el(p, 'mark') as Json).y).toBeLessThan((el(p, 'label') as Json).y)
		expect((el(p, 'label') as Json).y + (el(p, 'label') as Json).height).toBeLessThanOrEqual(100)
	})

	it('leaves the mark clear of the show-critical bar', () => {
		const p = presets('sr').p_sr__stop // Stop is critical: it stops a take
		expect(el(p, 'critical')).toBeTruthy()
		expect((el(p, 'mark') as Json).y).toBeGreaterThanOrEqual((el(p, 'critical') as Json).height)
	})

	it('is drawn bigger than a word would be', () => {
		const mark = el(presets('sr').p_sr__play_stop, 'mark') as Json
		const word = el(presets('sr').p_sr__play_stop, 'label') as Json
		// fontsize is percent of the element's own box, so compare shares of the key
		const share = (e: Json): number => ((e.fontsize as number) * (e.height as number)) / 100
		expect(share(mark)).toBeGreaterThan(share(word) * 1.5)
	})

	it('changes nothing for a control with no mark', () => {
		const p = presets('sr').p_sr__show
		expect(el(p, 'mark')).toBeUndefined()
		expect(el(p, 'label')?.height).toBe(100)
	})

	it('only marks controls the table knows, and every mark is from the vocabulary', () => {
		const chars = new Set(marks.map(([, m]) => m.char))
		for (const [id, look] of Object.entries(KEY_LOOKS))
			if (look.glyph) expect(chars.has(look.glyph.char), id).toBe(true)
	})
})
