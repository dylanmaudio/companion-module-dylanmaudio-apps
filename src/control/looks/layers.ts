/**
 * Building blocks for Companion 5 layered presets, shared by the styled keys
 * and the control presets. Positions are percent of the key; a text's size is
 * percent of its own box (Companion draws it at fontsize × box height / 100 /
 * 1.2 percent of the key).
 */

import type { CompanionPresetDefinitions } from '@companion-module/base'
import type { ModuleSchema } from '../../main.js'
import { PALETTE } from './palette.js'

export type Presets = CompanionPresetDefinitions<ModuleSchema>
export type Preset = NonNullable<Presets[string]>
export type Json = Record<string, unknown>
export interface Bounds {
	x: number
	y: number
	w: number
	h: number
}

export const FULL: Bounds = { x: 0, y: 0, w: 100, h: 100 }
/** A readout's name, small across the top */
export const CAPTION: Bounds = { x: 0, y: 4, w: 100, h: 30 }
/** A readout's value, large beneath its name */
export const VALUE: Bounds = { x: 0, y: 38, w: 100, h: 58 }

export const expr = (value: string): { value: string; isExpression: true } => ({ value, isExpression: true })
export const at = (b: Bounds): Json => ({ x: b.x, y: b.y, width: b.w, height: b.h })

export const box = (id: string, color: number, b: Bounds = FULL, more: Json = {}): Json => ({
	type: 'box',
	id,
	...at(b),
	color,
	...more,
})
export const image = (id: string, base64: string, b: Bounds): Json => ({
	type: 'image',
	id,
	...at(b),
	base64Image: base64,
	fillMode: 'fit',
	halign: 'center',
	valign: 'center',
})
export function text(id: string, value: string | { value: string; isExpression: true }, b: Bounds, o: Json = {}): Json {
	return {
		type: 'text',
		id,
		...at(b),
		text: value,
		fontsize: 100,
		fontsizeAllowShrink: true,
		font: 'companion-sans',
		color: PALETTE.textSecondary,
		halign: 'center',
		valign: 'center',
		...o,
	}
}

export interface Override {
	elementId: string
	elementProperty: string
	override: unknown
}
/**
 * Companion 5.0.5 keeps a preset feedback's override only when it is wrapped
 * as { value, isExpression } — a plain value, though the module API's types
 * allow it, is filtered out, and a feedback left with no overrides is dropped.
 */
export const set = (elementId: string, elementProperty: string, value: unknown): Override => ({
	elementId,
	elementProperty,
	override: { value, isExpression: false },
})
/** Restyles elements while the feedback is on — or, inverted, while it is off. */
export const feedback = (feedbackId: string, options: Json, overrides: Override[], isInverted = false): Json => ({
	feedbackId,
	options,
	...(isInverted ? { isInverted: true } : {}),
	styleOverrides: overrides,
})
export const press = (actionId: string, options: Json = {}): Json[] => [{ down: [{ actionId, options }], up: [] }]

export function layered(name: string, elements: Json[], feedbacks: Json[], steps: Json[]): Preset {
	return { type: 'layered', name, elements, feedbacks, steps } as unknown as Preset
}

/** The smallest text that reads on a Stream Deck key, as percent of the key's height */
export const MIN_TEXT = 14

/**
 * A mark's size, as Companion wants it: percent of its own box, from the
 * share of the key it should fill. `fitSize` can't do this — it sizes a word
 * to fit across the key and caps at 26%, where a mark is one character meant
 * to be read from the back of a room.
 */
export const markSize = (ofKey: number, boxHeight: number): number => Math.round((ofKey * 120) / boxHeight)

/**
 * The size (percent of its box) at which a label's longest line still fits
 * across the key and its lines fit down it. Companion breaks a word that
 * doesn't fit ("PLA Y") rather than shrinking it, so labels are sized to fit;
 * a character is taken as `charWidth` of the text's height.
 */
export function fitSize(label: string, boxHeight = 100, charWidth = 0.7): number {
	const lines = label.split('\n')
	const longest = Math.max(...lines.map((l) => [...l].length))
	const ofKey = Math.min(26, 92 / (charWidth * longest), (0.9 * boxHeight) / lines.length)
	return Math.max(Math.ceil((MIN_TEXT * 120) / boxHeight), Math.floor((ofKey * 120) / boxHeight))
}
