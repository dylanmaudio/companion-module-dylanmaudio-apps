import type { CompanionVariableDefinitions, CompanionVariableValues } from '@companion-module/base'
import {
	CHANNEL_TABLE,
	CHANNEL_TYPES,
	parseChannelKey,
	type ChannelRef,
	type ChannelType,
} from './protocol/channels.js'
import { formatDb, lvToDb } from './protocol/levels.js'
import type { StripState } from './state/model.js'

/**
 * A strip's level in dB.
 *
 * The desk's own figure wins where it sends one: another family's taper is
 * its own, and our measured table is the dLive's. Only fall back to the table
 * when nothing was reported, which is every dLive.
 */
const fmtDb = (db: number | null | undefined): string => (db === undefined ? '' : formatDb(db, { unit: false }))

function stripDb(s: StripState): number | null | undefined {
	if (s.db !== undefined) return s.db
	return s.level === undefined ? undefined : lvToDb(s.level)
}
import type { ConsoleState } from './state/model.js'

/** Variable-name slug per type: $(dlive:name_ch12), $(dlive:mute_dca3), $(dlive:fader_aux5)… */
export const TYPE_SLUG: Record<ChannelType, string> = {
	input: 'ch',
	mono_group: 'grp',
	stereo_group: 'stgrp',
	mono_aux: 'aux',
	stereo_aux: 'staux',
	mono_matrix: 'mtx',
	stereo_matrix: 'stmtx',
	mono_fx_send: 'fxsnd',
	stereo_fx_send: 'stfxsnd',
	fx_return: 'fxrtn',
	main: 'main',
	dca: 'dca',
	mute_group: 'mgrp',
	ufx_send: 'ufxsnd',
	ufx_return: 'ufxrtn',
}

export type VariablesSchema = CompanionVariableValues

export interface VariableScope {
	inputs: number
	extendedTypes: boolean
}

const CORE_TYPES: ChannelType[] = ['input', 'main', 'dca', 'mute_group']

/** Strips that get variables/presets under this scope. */
export function scopedStrips(scope: VariableScope): ChannelRef[] {
	const out: ChannelRef[] = []
	for (const type of CHANNEL_TYPES) {
		if (!scope.extendedTypes && !CORE_TYPES.includes(type)) continue
		const count = type === 'input' ? Math.min(scope.inputs, 128) : CHANNEL_TABLE[type].count
		for (let i = 1; i <= count; i++) out.push({ type, index: i })
	}
	return out
}

/** Per-type strip counts for the link's sync/poll scope — the same strips that get variables. */
export function stripCountsFor(scope: VariableScope): Partial<Record<ChannelType, number>> {
	const out: Partial<Record<ChannelType, number>> = {}
	for (const type of CHANNEL_TYPES) {
		if (!scope.extendedTypes && !CORE_TYPES.includes(type)) out[type] = 0
		else if (type === 'input') out[type] = Math.min(scope.inputs, 128)
	}
	return out
}

export function stripVar(prefix: string, ref: ChannelRef): string {
	return `${prefix}_${TYPE_SLUG[ref.type]}${ref.index}`
}

export function variableDefinitions(
	scope: VariableScope,
	sceneNumbers: Iterable<number>,
): CompanionVariableDefinitions<VariablesSchema> {
	const defs: CompanionVariableDefinitions<VariablesSchema> = {
		connected: { name: 'Console is answering' },
		firmware: { name: 'Console firmware (from config)' },
		base_channel: { name: 'Base MIDI channel (from config)' },
		scene_current: { name: 'Current scene number (last recalled)' },
		scene_current_name: { name: 'Current scene name (from show file)' },
		gets_in_flight: { name: 'Diagnostics: Gets awaiting reply' },
		gets_missed: { name: 'Diagnostics: Gets with no reply' },
		unsupported_gets: { name: 'Diagnostics: Get types the console ignored' },
	}
	for (const ref of scopedStrips(scope)) {
		const label = `${CHANNEL_TABLE[ref.type].label} ${ref.index}`
		defs[stripVar('name', ref)] = { name: `${label} name` }
		defs[stripVar('colour', ref)] = { name: `${label} colour` }
		defs[stripVar('mute', ref)] = { name: `${label} mute (true/false)` }
		if (ref.type !== 'mute_group') {
			defs[stripVar('fader', ref)] = { name: `${label} fader (dB)` }
			defs[stripVar('fader_lv', ref)] = { name: `${label} fader (wire value)` }
			defs[stripVar('linked', ref)] = { name: `${label} is half of a linked pair (true/false)` }
			defs[stripVar('partner', ref)] = { name: `${label} linked partner's number` }
		}
	}
	for (const n of sceneNumbers) defs[`scene_name_${n}`] = { name: `Scene ${n} name` }
	return defs
}

/** Values for every variable — used once at init and after a reset. */
export function allVariableValues(
	state: ConsoleState,
	scope: VariableScope,
	meta: MetaValues,
): CompanionVariableValues {
	const v: CompanionVariableValues = metaValues(state, meta)
	for (const ref of scopedStrips(scope)) Object.assign(v, stripValues(state, ref))
	for (const [n, name] of state.sceneNames) v[`scene_name_${n}`] = name
	return v
}

export interface MetaValues {
	firmware: string
	baseChannel: number
	getsInFlight: number
	getsMissed: number
	unsupported: string
}

export function metaValues(state: ConsoleState, meta: MetaValues): CompanionVariableValues {
	return {
		connected: state.connected,
		firmware: meta.firmware,
		base_channel: meta.baseChannel,
		scene_current: state.currentScene ?? '',
		scene_current_name: state.sceneName(state.currentScene),
		gets_in_flight: meta.getsInFlight,
		gets_missed: meta.getsMissed,
		unsupported_gets: meta.unsupported,
	}
}

export function stripValues(state: ConsoleState, ref: ChannelRef): CompanionVariableValues {
	const s = state.strip(ref)
	const v: CompanionVariableValues = {
		[stripVar('name', ref)]: s.name,
		[stripVar('colour', ref)]: s.colour,
		[stripVar('mute', ref)]: s.mute ?? false,
	}
	if (ref.type !== 'mute_group') {
		v[stripVar('fader', ref)] = fmtDb(stripDb(s))
		v[stripVar('fader_lv', ref)] = s.level ?? ''
		v[stripVar('linked', ref)] = s.stereo?.linked ?? false
		v[stripVar('partner', ref)] = s.stereo?.partner ?? ''
	}
	return v
}

/** Variable values affected by these changed state paths. */
export function valuesForPaths(
	state: ConsoleState,
	paths: Iterable<string>,
	scope: VariableScope,
	meta: MetaValues,
): CompanionVariableValues {
	const v: CompanionVariableValues = {}
	const inScope = new Set(scopedStrips(scope).map((r) => `${r.type}/${r.index}`))
	let metaTouched = false
	for (const p of paths) {
		const [kind, type, idx] = p.split('/')
		if (kind === 'scene' || kind === 'connection') {
			metaTouched = true
			continue
		}
		if (!type || !idx) continue
		const key = `${type}/${idx}`
		if (!inScope.has(key)) continue
		const ref = parseChannelKey(key)
		if (!ref) continue
		const s = state.strip(ref)
		switch (kind) {
			case 'name':
				v[stripVar('name', ref)] = s.name
				break
			case 'colour':
				v[stripVar('colour', ref)] = s.colour
				break
			case 'mute':
				v[stripVar('mute', ref)] = s.mute ?? false
				break
			case 'fader':
				if (ref.type !== 'mute_group') {
					v[stripVar('fader', ref)] = fmtDb(stripDb(s))
					v[stripVar('fader_lv', ref)] = s.level ?? ''
				}
				break
			case 'stereo':
				if (ref.type !== 'mute_group') {
					v[stripVar('linked', ref)] = s.stereo?.linked ?? false
					v[stripVar('partner', ref)] = s.stereo?.partner ?? ''
				}
				break
		}
	}
	if (metaTouched) Object.assign(v, metaValues(state, meta))
	return v
}
