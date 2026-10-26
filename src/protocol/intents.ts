/**
 * Intents — what the module wants to say to the console, independent of
 * bytes. This vocabulary is shared with fixtures/tx.json (`intent`), so a
 * fixture can be replayed through `encode()` verbatim.
 *
 * Indexes are 1-based; sockets are bank + 1-based socket; levels and
 * parameter values are raw 0–127 — dB conversion happens above this layer.
 */

import type { ChannelType, Colour, SocketBank } from './channels.js'

export type Intent =
	| { op: 'mute'; type: ChannelType; index: number; on: boolean }
	| { op: 'fader'; type: ChannelType; index: number; level: number }
	| { op: 'main_assign'; type: ChannelType; index: number; on: boolean }
	| { op: 'dca_assign'; type: ChannelType; index: number; dca: number; on: boolean }
	| { op: 'mute_group_assign'; type: ChannelType; index: number; group: number; on: boolean }
	| { op: 'peq'; type: ChannelType; index: number; band: number; param: PeqParam; value: number }
	| { op: 'hpf_freq'; index: number; value: number }
	| { op: 'hpf_on'; index: number; on: boolean }
	| { op: 'scene'; scene: number }
	| { op: 'cue_list'; id: number }
	| { op: 'surface_cc'; cc: number; value: number }
	| { op: 'action'; cc: number; value: number }
	| { op: 'send_level'; type: ChannelType; index: number; dest_type: ChannelType; dest_index: number; level: number }
	| { op: 'mix_assign'; index: number; dest_type: ChannelType; dest_index: number; on: boolean }
	| { op: 'preamp_gain'; bank: SocketBank; socket: number; value: number }
	| { op: 'preamp_pad'; bank: SocketBank; socket: number; on: boolean }
	| { op: 'preamp_48v'; bank: SocketBank; socket: number; on: boolean }
	| { op: 'get_name'; type: ChannelType; index: number }
	| { op: 'set_name'; type: ChannelType; index: number; name: string }
	| { op: 'get_colour'; type: ChannelType; index: number }
	| { op: 'set_colour'; type: ChannelType; index: number; colour: Colour }
	| { op: 'ufx_key'; key: number }
	| { op: 'ufx_scale'; scale: number }
	| { op: 'get_mute'; type: ChannelType; index: number }
	| { op: 'get_fader'; type: ChannelType; index: number }
	| { op: 'get_param'; type: ChannelType; index: number; param: number }
	| { op: 'get_send_level'; type: ChannelType; index: number; dest_type: ChannelType; dest_index: number }
	| { op: 'get_mix_assign'; index: number; dest_type: ChannelType; dest_index: number }
	| { op: 'get_preamp_gain'; bank: SocketBank; socket: number }
	| { op: 'get_preamp_pad'; bank: SocketBank; socket: number }
	| { op: 'get_preamp_48v'; bank: SocketBank; socket: number }

export type IntentOp = Intent['op']

export type PeqParam = 'type' | 'freq' | 'width' | 'gain'

/** Which socket an intent belongs on — docs/protocol.md §1. */
export type SocketRole = 'mixrack' | 'surface'

export function intentSocket(intent: Intent): SocketRole {
	switch (intent.op) {
		case 'cue_list':
		case 'surface_cc':
			return 'surface'
		default:
			return 'mixrack'
	}
}

/** Verification tier of each op — docs/protocol.md tiers. Surfaced in HELP and logs. */
export const INTENT_TIER: Record<IntentOp, 'hardware' | 'two-impl' | 'single' | 'inferred'> = {
	mute: 'hardware',
	fader: 'hardware',
	scene: 'hardware',
	action: 'hardware',
	surface_cc: 'hardware',
	get_name: 'hardware',
	set_name: 'hardware',
	get_colour: 'hardware',
	set_colour: 'hardware',
	main_assign: 'two-impl',
	dca_assign: 'two-impl',
	mute_group_assign: 'two-impl',
	peq: 'two-impl',
	hpf_freq: 'two-impl',
	hpf_on: 'two-impl',
	send_level: 'two-impl',
	mix_assign: 'two-impl',
	preamp_gain: 'two-impl',
	preamp_pad: 'two-impl',
	preamp_48v: 'two-impl',
	ufx_key: 'two-impl',
	ufx_scale: 'two-impl',
	cue_list: 'single',
	get_mute: 'single',
	get_fader: 'single',
	get_send_level: 'single',
	get_param: 'inferred',
	get_mix_assign: 'inferred',
	get_preamp_gain: 'inferred',
	get_preamp_pad: 'inferred',
	get_preamp_48v: 'inferred',
}

// ---------------------------------------------------------------- events

/**
 * Events — what the console said, decoded. Shared with fixtures/rx.json
 * (`events`), so every decoder implementation emits the same shapes.
 */
export type ConsoleEvent =
	| { kind: 'mute'; type: ChannelType; index: number; on: boolean }
	| {
			kind: 'stereo'
			type: ChannelType
			index: number
			/** the desk links this strip to a partner */
			linked: boolean
			/** which half of the pair it is, where the desk says */
			half: 'A' | 'B' | undefined
			/** the partner's index on the same type, where the desk says */
			partner: number | undefined
	  }
	| {
			kind: 'fader'
			type: ChannelType
			index: number
			/**
			 * The wire value: a dLive lv, or another family's own units.
			 * Absent where the desk reports only dB — the DiGiCo SD sends
			 * `{db, steps: null}` with no wire value at all.
			 */
			level?: number
			/** dB as the desk reported it, where it does; undefined on a dLive */
			db?: number | null
	  }
	/**
	 * A bare `63` with no parameter or level after it. The name is historical:
	 * no console sends this for a fader move (that was a parser dropping running
	 * status). On a real desk it is another client's select, relayed raw.
	 */
	| { kind: 'fader_ping'; type: ChannelType; index: number }
	| { kind: 'param'; type: ChannelType; index: number; param: number; value: number }
	| { kind: 'scene'; scene: number }
	| { kind: 'name'; type: ChannelType; index: number; name: string }
	| { kind: 'colour'; type: ChannelType; index: number; colour: Colour }
	| { kind: 'send_level'; type: ChannelType; index: number; dest_type: ChannelType; dest_index: number; level: number }
	| { kind: 'mix_assign'; index: number; dest_type: ChannelType; dest_index: number; on: boolean }
	| { kind: 'preamp_gain'; bank: SocketBank; socket: number; value: number }
	| { kind: 'preamp_pad'; bank: SocketBank; socket: number; on: boolean }
	| { kind: 'preamp_48v'; bank: SocketBank; socket: number; on: boolean }
	/**
	 * A control change on a protocol channel that is not channel state: an
	 * Action echo, Scene Go/Next/Previous, a SoftKey's Custom MIDI string, or
	 * one of our own apps signalling (see APP_CC). Surfaced so a controller
	 * above can trigger on it.
	 */
	| { kind: 'cc'; channel: number; cc: number; value: number }
	/** MIDI Strip traffic — see the strip tables in decode.ts */
	| { kind: 'strip_fader'; strip: number; value: number }
	| { kind: 'strip_key'; strip: number; key: StripKey; on: boolean }
	| { kind: 'strip_rotary'; strip: number; rotary: StripRotary; value: number }
	| { kind: 'unknown'; status: number; data: number[] }

export type StripKey = 'mute' | 'mix' | 'pafl'
export type StripRotary = 'gain' | 'pan' | 'custom1' | 'custom2'

export type ConsoleEventKind = ConsoleEvent['kind']

// NRPN parameter numbers (docs/protocol.md §3.2–3.3)
export const PARAM_FADER = 0x17
export const PARAM_MAIN_ASSIGN = 0x18
export const PARAM_PREAMP_GAIN = 0x19 // Get only — the set is a pitch bend
export const PARAM_ASSIGN = 0x40 // DCA + mute group, split by value range
export const PARAM_HPF_FREQ = 0x30
export const PARAM_HPF_ON = 0x31
export const PARAM_PEQ_BASE = 0x1a // band b param p = 0x1A + 4b + p

export const PEQ_PARAM_OFFSET: Record<PeqParam, number> = { type: 0, freq: 1, width: 2, gain: 3 }

export function peqParamNumber(band: number, param: PeqParam): number {
	if (!Number.isInteger(band) || band < 1 || band > 4) throw new RangeError(`PEQ band must be 1..4, got ${band}`)
	return PARAM_PEQ_BASE + 4 * (band - 1) + PEQ_PARAM_OFFSET[param]
}
