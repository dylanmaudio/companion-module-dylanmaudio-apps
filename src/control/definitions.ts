/**
 * Catalogue → Companion definitions (brief-companion-control.md §2.2).
 *
 * Every control becomes an action, every bool and enum state key a
 * feedback, and every state key a variable, with presets built from the same
 * list. Nothing here knows any particular app: a control an app adds in an
 * update arrives in its catalogue and appears in Companion without a module
 * release.
 *
 * Ids come from the catalogue's own ids, which are stable across app
 * versions, so buttons built on them survive an app update. Dots become a
 * double underscore, which cannot collide with an id that already contains
 * an underscore.
 */

import {
	combineRgb,
	type CompanionActionDefinitions,
	type CompanionFeedbackDefinitions,
	type CompanionOptionValues,
	type CompanionPresetDefinitions,
	type CompanionPresetSection,
	type CompanionVariableDefinitions,
	type CompanionVariableValues,
} from '@companion-module/base'
import type { ActionsSchema } from '../actions.js'
import type { FeedbacksSchema } from '../feedbacks.js'
import type { ModuleSchema } from '../main.js'
import type { VariablesSchema } from '../variables.js'
import { KEY_LOOKS, keyLabel, type KeyLook } from './looks/labels.js'
import * as L from './looks/layers.js'
import { GROUP_TINT, KEY, PALETTE } from './looks/palette.js'
import type { Catalogue, CmdValue, ControlDef, StateKeyDef, StateValue } from './types.js'

const WHITE = combineRgb(255, 255, 255)
const ON = combineRgb(0, 150, 60)
const CHOSEN = combineRgb(30, 90, 200)

/** Sends a press. The connection logs the app's own reason when it refuses. */
export type Send = (control: string, value?: CmdValue, abort?: AbortSignal) => Promise<void>

const slug = (id: string): string => id.replace(/\./g, '__')

export const actionId = (control: string): string => `ctl_${slug(control)}`
export const boolFeedbackId = (key: string): string => `st_${slug(key)}`
export const enumFeedbackId = (key: string): string => `st_${slug(key)}__is`

/**
 * A state key's variable id. The app prefix goes, because the connection
 * label already names the app: `ptt.state` reads as $(ptt:state) on a
 * connection labelled ptt.
 */
export function variableId(app: string, key: string): string {
	const local = key.startsWith(`${app}.`) ? key.slice(app.length + 1) : key
	return local.replace(/[^A-Za-z0-9_]/g, '_')
}

/** Connection-level variables, prefixed so no app's state key can collide with them. */
export const META_VARIABLES: Record<string, string> = {
	ctl_connected: 'Connected to the app',
	ctl_allowed: 'Companion control allowed in the app',
	ctl_locked: 'Show-critical controls locked in the app',
	ctl_version: 'App version',
}

// ------------------------------------------------------------------ actions

export function buildControlActions(cat: Catalogue, send: Send): CompanionActionDefinitions<ActionsSchema> {
	const defs: CompanionActionDefinitions<ActionsSchema> = {}
	for (const c of cat.controls) {
		const id = actionId(c.id)
		const description = describeControl(c, cat)
		switch (c.kind) {
			case 'action':
				defs[id] = {
					name: c.label,
					description,
					options: [],
					callback: async (_a, ctx) => send(c.id, undefined, ctx.signal),
				}
				break
			case 'toggle':
				defs[id] = {
					name: c.label,
					description,
					options: [
						{
							type: 'dropdown',
							id: 'mode',
							label: 'Set',
							default: 'toggle',
							choices: [
								{ id: 'toggle', label: 'Toggle' },
								{ id: 'on', label: 'On' },
								{ id: 'off', label: 'Off' },
							],
						},
					],
					callback: async (a, ctx) => send(c.id, str(a.options, 'mode', 'toggle'), ctx.signal),
				}
				break
			case 'choice': {
				const choices = (c.choices ?? []).map(([value, label]) => ({ id: value, label }))
				defs[id] = {
					name: c.label,
					description,
					options: [
						{
							type: 'dropdown',
							id: 'value',
							label: 'Set to',
							default: choices[0]?.id ?? 'next',
							choices: [...choices, { id: 'next', label: 'Next (cycles through them)' }],
						},
					],
					callback: async (a, ctx) => send(c.id, str(a.options, 'value', 'next'), ctx.signal),
				}
				break
			}
			case 'number': {
				const min = c.min ?? -1_000_000
				const max = c.max ?? 1_000_000
				const nudge = nudgeable(c)
				defs[id] = {
					name: c.label,
					description,
					options: [
						{
							type: 'dropdown',
							id: 'mode',
							label: 'Action',
							default: nudge ? 'nudge' : 'set',
							disableAutoExpression: true,
							choices: [
								{ id: 'set', label: 'Set to a value' },
								...(nudge ? [{ id: 'nudge', label: `Nudge by steps of ${c.step}` }] : []),
							],
						},
						{
							type: 'number',
							id: 'value',
							label: 'Value',
							default: Math.min(max, Math.max(min, 0)),
							min,
							max,
							step: c.step,
							isVisibleExpression: "$(options:mode) == 'set'",
						},
						{
							type: 'number',
							id: 'steps',
							label: 'Steps (negative goes down)',
							default: 1,
							min: -100,
							max: 100,
							step: 1,
							isVisibleExpression: "$(options:mode) == 'nudge'",
						},
					],
					callback: async (a, ctx) => {
						if (a.options.mode === 'nudge') await send(c.id, { nudge: num(a.options, 'steps', 1) }, ctx.signal)
						else await send(c.id, num(a.options, 'value', 0), ctx.signal)
					},
				}
				break
			}
			case 'text':
				defs[id] = {
					name: c.label,
					description,
					options: [
						{
							type: 'textinput',
							id: 'value',
							label: 'Value',
							default: '',
							...(c.pattern ? { regex: `/^(?:${c.pattern})$/` } : {}),
						},
					],
					callback: async (a, ctx) => send(c.id, str(a.options, 'value', ''), ctx.signal),
				}
				break
		}
	}
	return defs
}

/**
 * A nudge moves from the app's current value, so it needs a step and a state
 * key to read that value from. Console Control's marker and region numbers
 * have a step but no state — there is no "current marker" to nudge from —
 * so they are only ever set.
 */
function nudgeable(c: ControlDef): boolean {
	return Boolean(c.step && c.state)
}

/** What makes a control special, for the action's description. */
function describeControl(c: ControlDef, cat: Catalogue): string | undefined {
	const parts: string[] = []
	const LOCK = "refused while the app's Lock show-critical controls switch is on"
	if (c.safety === 'critical') parts.push(`Show-critical: ${LOCK}.`)
	else if (c.safety && typeof c.safety === 'object') {
		const when = Object.entries(c.safety)
			.filter(([, s]) => s === 'critical')
			.map(([v]) => valueLabel(c, v))
		if (when.length) parts.push(`Show-critical when set to ${when.join(' or ')}: ${LOCK}.`)
	}
	if (c.enabled_when) {
		const k = cat.state.find((s) => s.key === c.enabled_when)
		parts.push(`Only acts while "${k?.label ?? c.enabled_when}" is on; otherwise the app refuses it and says why.`)
	}
	return parts.length ? parts.join(' ') : undefined
}

function valueLabel(c: ControlDef, value: string): string {
	if (c.kind === 'toggle') return value === 'on' ? 'On' : value === 'off' ? 'Off' : value
	return c.choices?.find(([v]) => v === value)?.[1] ?? value
}

function str(o: CompanionOptionValues, key: string, dflt: string): string {
	const v = o[key]
	return typeof v === 'string' ? v : dflt
}

function num(o: CompanionOptionValues, key: string, dflt: number): number {
	const v = Number(o[key])
	return Number.isFinite(v) ? v : dflt
}

// ---------------------------------------------------------------- feedbacks

export function buildControlFeedbacks(
	cat: Catalogue,
	get: (key: string) => StateValue,
): CompanionFeedbackDefinitions<FeedbacksSchema> {
	const defs: CompanionFeedbackDefinitions<FeedbacksSchema> = {}
	for (const s of cat.state) {
		if (s.type === 'bool') {
			defs[boolFeedbackId(s.key)] = {
				type: 'boolean',
				name: s.label,
				description: `On while ${s.label} is on, as ${cat.name} reports it`,
				defaultStyle: { bgcolor: ON, color: WHITE },
				options: [],
				callback: () => get(s.key) === true,
			}
		} else if (s.type === 'enum') {
			const labels = valueLabels(cat, s.key)
			const values = s.values ?? []
			defs[enumFeedbackId(s.key)] = {
				type: 'boolean',
				name: `${s.label} is…`,
				description: `On while ${s.label} has the chosen value, as ${cat.name} reports it`,
				defaultStyle: { bgcolor: CHOSEN, color: WHITE },
				options: [
					{
						type: 'dropdown',
						id: 'value',
						label: 'Value',
						default: values[0] ?? '',
						choices: values.map((v) => ({ id: v, label: labels.get(v) ?? v })),
					},
				],
				callback: (fb) => get(s.key) === fb.options.value,
			}
		}
	}
	return defs
}

/** The feedbacks that depend on a state key, for re-checking when it changes. */
export function feedbackIdsForKey(cat: Catalogue, key: string): string[] {
	const s = cat.state.find((k) => k.key === key)
	if (s?.type === 'bool') return [boolFeedbackId(key)]
	if (s?.type === 'enum') return [enumFeedbackId(key)]
	return []
}

/** Readable labels for an enum's values, from a choice control that sets it when there is one. */
function valueLabels(cat: Catalogue, key: string): Map<string, string> {
	const m = new Map<string, string>()
	for (const c of cat.controls)
		if (c.kind === 'choice' && c.state === key) for (const [v, l] of c.choices ?? []) m.set(v, l)
	return m
}

// ---------------------------------------------------------------- variables

/** How a state key is named as a Companion variable. */
export type VariableNaming = (key: string) => string

/** The app connections' naming: the connection label already says which app, so `ptt.state` is `$(ptt:state)`. */
export const bareNaming =
	(cat: Catalogue): VariableNaming =>
	(key) =>
		variableId(cat.app, key)

/**
 * Keeps the app prefix: `bridge.state` is `bridge_state`. For the MIDI Bridge
 * connection, where the bridge's own state sits beside the console's
 * variables and a bare `state` or `version` would say nothing.
 */
export const prefixedNaming: VariableNaming = (key) => key.replace(/[^A-Za-z0-9_]/g, '_')

export function buildControlVariables(
	cat: Catalogue,
	naming: VariableNaming = bareNaming(cat),
	meta: Record<string, string> = META_VARIABLES,
): CompanionVariableDefinitions<VariablesSchema> {
	const defs: Record<string, { name: string }> = {}
	for (const [id, name] of Object.entries(meta)) defs[id] = { name }
	for (const s of cat.state) defs[naming(s.key)] = { name: s.unit ? `${s.label} (${s.unit})` : s.label }
	return defs
}

/** State values as variable values: unknown is empty, and a level reads to two decimals. */
export function controlVariableValues(
	cat: Catalogue,
	values: Record<string, StateValue>,
	naming: VariableNaming = bareNaming(cat),
): CompanionVariableValues {
	const out: CompanionVariableValues = {}
	for (const [k, v] of Object.entries(values)) {
		out[naming(k)] =
			v === null ? undefined : typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 100) / 100 : v
	}
	return out
}

// ------------------------------------------------------------------ presets

/** Show-critical always, or (given a value) when set to that value. */
function isCritical(c: ControlDef, value?: string): boolean {
	if (c.safety === 'critical') return true
	if (!c.safety || typeof c.safety !== 'object') return false
	return value === undefined ? Object.values(c.safety).includes('critical') : c.safety[value] === 'critical'
}

/**
 * A control's key: its short label in white on its menu's tint, with a red
 * bar across the top when the app treats the control as show-critical.
 */
function controlKey(
	name: string,
	label: string,
	bg: number,
	critical: boolean,
	feedbacks: L.Json[],
	steps: L.Json[],
): L.Preset {
	const area = critical ? { ...L.FULL, y: 8, h: 92 } : L.FULL
	return L.layered(
		name,
		[
			L.box('bg', bg),
			...(critical ? [L.box('critical', KEY.critical, { ...L.FULL, h: 8 })] : []),
			L.text('label', label, area, { fontsize: L.fitSize(label, area.h), color: PALETTE.white }),
		],
		feedbacks,
		steps,
	)
}

/**
 * A small caption over a large value in figures: a number's readout (the
 * app's value) or one of its nudges (the step), sized for `sizeFor`. A red bar
 * across the top when the control is show-critical.
 */
function stackedKey(
	name: string,
	caption: string,
	value: string | { value: string; isExpression: true },
	sizeFor: string,
	bg: number,
	critical: boolean,
	steps: L.Json[],
): L.Preset {
	const top = critical ? { ...L.CAPTION, y: 10, h: 26 } : L.CAPTION
	return L.layered(
		name,
		[
			L.box('bg', bg),
			...(critical ? [L.box('critical', KEY.critical, { ...L.FULL, h: 8 })] : []),
			L.text('caption', caption, top, { fontsize: L.fitSize(caption, top.h), color: PALETTE.textSecondary }),
			L.text('value', value, L.VALUE, {
				font: 'companion-mono',
				fontsize: L.fitSize(sizeFor, L.VALUE.h, 0.6),
				color: PALETTE.white,
			}),
		],
		[],
		steps,
	)
}

export function buildControlPresets(
	cat: Catalogue,
	label: string,
	naming: VariableNaming = bareNaming(cat),
): { sections: CompanionPresetSection<ModuleSchema>[]; presets: CompanionPresetDefinitions<ModuleSchema> } {
	const presets: CompanionPresetDefinitions<ModuleSchema> = {}
	const ids: string[] = []
	const variable = (key: string) => `$(${label}:${naming(key)})`
	const groupOf = new Map<string, string>()
	let group = ''
	const add = (id: string, p: L.Preset) => {
		presets[id] = p
		ids.push(id)
		groupOf.set(id, group)
	}
	const has = (key: string, type: StateKeyDef['type'], value?: string): boolean => {
		const s = cat.state.find((k) => k.key === key)
		return s?.type === type && (value === undefined || !!s.values?.includes(value))
	}
	const fill = (color: number): L.Override[] => [L.set('bg', 'color', color)]
	const whenOn = (key: string | undefined, color: number): L.Json[] =>
		key && has(key, 'bool') ? [L.feedback(boolFeedbackId(key), {}, fill(color))] : []
	/** The lights a key's look adds beyond its own state, where the app reports that state. */
	const lights = (look?: KeyLook): L.Json[] =>
		(look?.lit ?? []).flatMap((l) => {
			if (l.value === undefined)
				return has(l.key, 'bool') ? [L.feedback(boolFeedbackId(l.key), {}, fill(l.bg), l.invert)] : []
			return has(l.key, 'enum', l.value)
				? [L.feedback(enumFeedbackId(l.key), { value: l.value }, fill(l.bg), l.invert)]
				: []
		})

	for (const c of cat.controls) {
		group = c.group ?? ''
		const aid = actionId(c.id)
		const pid = `p_${slug(c.id)}`
		const look = KEY_LOOKS[c.id]
		const tint = look?.bg ?? GROUP_TINT[group] ?? KEY.base
		const short = look?.text ?? keyLabel(c.label)
		switch (c.kind) {
			case 'action':
				add(
					pid,
					controlKey(
						c.label,
						short,
						tint,
						isCritical(c),
						[...whenOn(c.enabled_when, KEY.attention), ...lights(look)],
						L.press(aid),
					),
				)
				break
			case 'toggle':
				add(
					pid,
					controlKey(
						c.label,
						short,
						tint,
						isCritical(c),
						[...whenOn(c.state, look?.on ?? KEY.on), ...lights(look)],
						L.press(aid, { mode: 'toggle' }),
					),
				)
				break
			case 'choice':
				for (const [value, vlabel] of c.choices ?? []) {
					const v = KEY_LOOKS[`${c.id}=${value}`]
					const chosen =
						c.state && has(c.state, 'enum', value)
							? [L.feedback(enumFeedbackId(c.state), { value }, fill(v?.on ?? KEY.chosen))]
							: []
					add(
						`${pid}__${value}`,
						controlKey(
							`${c.label}: ${vlabel}`,
							v?.text ?? keyLabel(vlabel),
							v?.bg ?? tint,
							isCritical(c, value),
							[...chosen, ...lights(v)],
							L.press(aid, { value }),
						),
					)
				}
				break
			case 'number': {
				const caption = short.replace(/\n/g, ' ')
				const unit = cat.state.find((s) => s.key === c.state)?.unit
				const suffix = unit ? ` ${unit}` : ''
				if (c.state) {
					const v = variable(c.state)
					// concat(), not +: Companion's + adds numbers, so -36 + ' dB' would read NaN
					const shown = L.expr(`isNumber(${v}) ? concat(${v}, '${suffix}') : '--'`)
					add(
						`${pid}__show`,
						stackedKey(`${c.label} (shows the value)`, caption, shown, `-00.0${suffix}`, KEY.tile, false, [
							{ down: [], up: [] },
						]),
					)
				}
				if (nudgeable(c)) {
					for (const [dir, steps] of [
						['down', -1],
						['up', 1],
					] as const) {
						const by = `${steps > 0 ? '+' : '−'}${c.step}`
						add(
							`${pid}__${dir}`,
							stackedKey(
								`${c.label} ${by}`,
								caption,
								`${by}${suffix}`,
								`${by}${suffix}`,
								tint,
								isCritical(c),
								L.press(aid, { mode: 'nudge', steps, value: 0 }),
							),
						)
					}
				}
				break
			}
			case 'text':
				break // a value typed per button: no sensible ready-made preset
		}
	}
	// Controls that carry a group (Console Control's menu categories) get a
	// section each, in the catalogue's order, so the presets follow the app's
	// menus. Ungrouped controls share the app's one section.
	const byGroup = new Map<string, string[]>()
	for (const id of ids) {
		const g = groupOf.get(id) ?? ''
		byGroup.set(g, [...(byGroup.get(g) ?? []), id])
	}
	const sections: CompanionPresetSection<ModuleSchema>[] = [...byGroup].map(([g, definitions]) => ({
		id: g ? `ctl_${cat.app}__${g.replace(/[^A-Za-z0-9]+/g, '_').toLowerCase()}` : `ctl_${cat.app}`,
		name: g ? `${cat.name}: ${g.charAt(0).toUpperCase()}${g.slice(1)}` : cat.name,
		definitions,
	}))
	return { sections, presets }
}
