/**
 * The state change our own set implies, so feedbacks update at once even
 * when the desk (or the bridge) does not echo it. Shared by BridgeLink and
 * the protocol test harness.
 */

import type { ConsoleEvent, Intent } from './intents.js'

/** The state event our own set implies, so feedbacks update even if the desk does not echo. */
export function localEvent(intent: Intent): ConsoleEvent | undefined {
	switch (intent.op) {
		case 'mute':
			return { kind: 'mute', type: intent.type, index: intent.index, on: intent.on }
		case 'fader':
			return { kind: 'fader', type: intent.type, index: intent.index, level: intent.level }
		case 'set_name':
			return { kind: 'name', type: intent.type, index: intent.index, name: intent.name }
		case 'set_colour':
			return { kind: 'colour', type: intent.type, index: intent.index, colour: intent.colour }
		// Only a desk that COUNTS its scenes has a place to apply. On one that
		// numbers them, BridgeLink has already removed `scene` (sceneForConsole)
		// and left only `scene_number`, so `intent.scene` is undefined here and
		// the place the desk will land on is not knowable from the number:
		// 9.99 is not the ninth snapshot. Applying it anyway set
		// `currentScene = undefined` and blanked `scene_current` on EVERY
		// recall — invisible while the desk's own echo followed a few ms later,
		// and permanent when none came. A Quantum 112 refusing snapshot 9.99
		// left the variable empty for the rest of the session (4 Nov, CO).
		case 'scene':
			return typeof intent.scene === 'number' && Number.isFinite(intent.scene)
				? { kind: 'scene', scene: intent.scene }
				: undefined
		case 'main_assign':
			return { kind: 'param', type: intent.type, index: intent.index, param: 0x18, value: intent.on ? 0x7f : 0x3f }
		case 'dca_assign':
			return {
				kind: 'param',
				type: intent.type,
				index: intent.index,
				param: 0x40,
				value: (intent.on ? 0x40 : 0x00) + intent.dca - 1,
			}
		case 'mute_group_assign':
			return {
				kind: 'param',
				type: intent.type,
				index: intent.index,
				param: 0x40,
				value: (intent.on ? 0x58 : 0x18) + intent.group - 1,
			}
		case 'hpf_on':
			return { kind: 'param', type: 'input', index: intent.index, param: 0x31, value: intent.on ? 0x40 : 0 }
		case 'hpf_freq':
			return { kind: 'param', type: 'input', index: intent.index, param: 0x30, value: intent.value }
		case 'send_level':
			return {
				kind: 'send_level',
				type: intent.type,
				index: intent.index,
				dest_type: intent.dest_type,
				dest_index: intent.dest_index,
				level: intent.level,
			}
		case 'mix_assign':
			return {
				kind: 'mix_assign',
				index: intent.index,
				dest_type: intent.dest_type,
				dest_index: intent.dest_index,
				on: intent.on,
			}
		case 'preamp_gain':
			return { kind: 'preamp_gain', bank: intent.bank, socket: intent.socket, value: intent.value }
		case 'preamp_pad':
			return { kind: 'preamp_pad', bank: intent.bank, socket: intent.socket, on: intent.on }
		case 'preamp_48v':
			return { kind: 'preamp_48v', bank: intent.bank, socket: intent.socket, on: intent.on }
		default:
			return undefined
	}
}
