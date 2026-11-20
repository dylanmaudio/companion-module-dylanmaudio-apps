/**
 * The control presets' look, for every app's real catalogue: short labels
 * that fit a key whole, the red bar on show-critical controls, and the lights.
 */
import { describe, expect, it } from 'vitest'
import { load } from '../../../test/ctlmock.js'
import { bareNaming, boolFeedbackId, buildControlPresets, enumFeedbackId, prefixedNaming } from '../definitions.js'
import type { AppId } from '../registry.js'
import type { Catalogue } from '../types.js'
import { KEY_LOOKS, keyLabel } from './labels.js'
import { KEY } from './palette.js'

type Json = Record<string, any>
const APPS: AppId[] = ['bridge', 'tlt', 'ptt', 'tct', 'cxc', 'sr']
const catOf = (app: AppId): Catalogue => {
	const fx = load(`${app}.json`)
	return { app: fx.app.id, name: fx.app.name, version: 'x', hash: 'h', ...fx.catalogue } as Catalogue
}
const presetsOf = (app: AppId): Record<string, Json> => {
	const cat = catOf(app)
	return buildControlPresets(cat, app, app === 'bridge' ? prefixedNaming : bareNaming(cat)).presets as Record<
		string,
		Json
	>
}
const pid = (control: string) => `p_${control.replace('.', '__')}`

describe('control presets', () => {
	it('are layered keys whose words fit whole, none under 14% of the key', () => {
		for (const app of APPS)
			for (const [id, p] of Object.entries(presetsOf(app))) {
				expect(p.type, id).toBe('layered')
				for (const e of p.elements as Json[]) {
					if (e.type !== 'text') continue
					const ofKey = (e.fontsize * e.height) / 100 / 1.2
					expect(ofKey, `${id}: ${e.id}`).toBeGreaterThanOrEqual(14)
					if (typeof e.text !== 'string') continue
					// Companion splits a word that doesn't fit ("PLA Y"); a character is ~0.7 of the text's height
					const longest = Math.max(...e.text.split('\n').map((l) => l.length))
					expect(longest * (e.font === 'companion-mono' ? 0.6 : 0.7) * ofKey, `${id}: "${e.text}"`).toBeLessThanOrEqual(
						92.5,
					)
				}
			}
	})

	it('every control the six apps offer has a label written for the key, and none is left over', () => {
		const known = new Set<string>()
		for (const app of APPS) {
			const cat = catOf(app)
			const ids = Object.keys(presetsOf(app))
			for (const c of cat.controls) {
				for (const [v] of c.choices ?? []) known.add(`${c.id}=${v}`)
				known.add(c.id)
				if (!ids.some((k) => k === pid(c.id) || k.startsWith(`${pid(c.id)}__`))) continue
				if (c.kind === 'choice')
					for (const [v] of c.choices ?? []) expect(KEY_LOOKS[`${c.id}=${v}`], `${c.id}=${v}`).toBeDefined()
				else expect(KEY_LOOKS[c.id], c.id).toBeDefined()
			}
		}
		for (const k of Object.keys(KEY_LOOKS)) expect(known, k).toContain(k)
	})

	it('every light is a state the app reports, of the right kind', () => {
		const state = APPS.flatMap((app) => catOf(app).state)
		for (const [k, look] of Object.entries(KEY_LOOKS))
			for (const l of look.lit ?? []) {
				const s = state.find((x) => x.key === l.key)
				expect(s?.type, `${k}: ${l.key}`).toBe(l.value === undefined ? 'bool' : 'enum')
				if (l.value !== undefined) expect(s?.values, `${k}: ${l.key}`).toContain(l.value)
			}
	})

	it('show-critical controls carry the red bar; the rest do not', () => {
		const bar = (p: Json) => (p.elements as Json[]).some((e) => e.id === 'critical')
		const cxc = presetsOf('cxc')
		expect(bar(cxc[pid('cxc.stop')])).toBe(true)
		expect(bar(cxc[pid('cxc.play')])).toBe(false)
		expect(bar(presetsOf('ptt')[pid('ptt.run')])).toBe(true) // critical to turn off
		expect(bar(presetsOf('ptt')[`${pid('ptt.failback_mode')}__latch`])).toBe(true)
		expect(bar(presetsOf('ptt')[pid('ptt.tone')])).toBe(false)
	})

	it("Console Control's keys light with its state: REC while recording, CONFORM when the console has drifted", () => {
		const cxc = presetsOf('cxc')
		const colourOf = (f: Json) => f.styleOverrides[0].override.value as number
		const rec = (cxc[pid('cxc.record')].feedbacks as Json[]).find(
			(f) => f.feedbackId === enumFeedbackId('cxc.transport') && f.options.value === 'recording',
		)
		expect(rec && colourOf(rec)).toBe(KEY.alarm)
		const conform = (cxc[pid('cxc.conform-console')].feedbacks as Json[])[0]
		expect(conform).toMatchObject({ feedbackId: boolFeedbackId('cxc.console_matches'), isInverted: true })
		expect(cxc[pid('cxc.panic')].elements[0].color).toBe(KEY.alarm)
	})

	it("Pilot Tone's Latch lights in the app's amber, and Reset lights when it can act", () => {
		const ptt = presetsOf('ptt')
		const latch = (ptt[`${pid('ptt.failback_mode')}__latch`].feedbacks as Json[])[0]
		expect(latch.styleOverrides[0].override.value).toBe(0xe8a94a)
		const reset = (ptt[pid('ptt.reset')].feedbacks as Json[])[0]
		expect(reset).toMatchObject({ feedbackId: boolFeedbackId('ptt.reset_available') })
		expect(reset.styleOverrides[0].override.value).toBe(KEY.attention)
	})

	it('a control an app adds later still gets a short label from its name', () => {
		expect(keyLabel('Reset — fail back to primary')).toBe('RESET')
		expect(keyLabel('Toggle Chase (global)')).toBe('CHASE')
		expect(keyLabel('Show / Hide Markers List')).toBe('MARKERS\nLIST')
		expect(keyLabel('Lock All Tracks')).toBe('LOCK ALL\nTRACKS')
	})
})
