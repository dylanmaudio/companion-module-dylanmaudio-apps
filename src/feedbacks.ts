import {
	combineRgb,
	type CompanionAdvancedFeedbackResult,
	type CompanionFeedbackDefinitions,
	type CompanionOptionValues,
} from '@companion-module/base'
import type { ModuleContext } from './context.js'
import { CHANNEL_TABLE, COLOUR_STYLE, type ChannelRef } from './protocol/channels.js'
import { formatDb, lvToDb, parseDb } from './protocol/levels.js'
import type { StripState } from './state/model.js'

/**
 * A strip's level in dB: the desk's own figure where it reports one (every
 * family but the dLive), else our measured dLive table. Undefined means the
 * level isn't known yet, which is not the same as -inf.
 */
function levelDb(s: StripState): number | null | undefined {
	if (s.db !== undefined) return s.db
	return s.level === undefined ? undefined : lvToDb(s.level)
}
import { PARAM_ASSIGN, PARAM_HPF_ON, PARAM_MAIN_ASSIGN, type Intent } from './protocol/intents.js'
import {
	CONNECTION_PATH,
	SCENE_PATH,
	colourPath,
	faderPath,
	stereoPath,
	mixPath,
	mutePath,
	namePath,
	paramPath,
	preampPath,
	sendPath,
} from './state/model.js'
import { readChannel, readSocket } from './actions.js'
import {
	CHOICES_ASSIGNABLE_TYPES,
	CHOICES_FADER_TYPES,
	CHOICES_MIX_DEST,
	CHOICES_SEND_DEST,
	CHOICES_SEND_SOURCE,
	channelFields,
	socketFields,
} from './choices.js'

export type FeedbacksSchema = Record<string, { type: 'boolean' | 'value' | 'advanced'; options: CompanionOptionValues }>

type Opts = CompanionOptionValues

const RED = combineRgb(200, 0, 0)
const WHITE = combineRgb(255, 255, 255)
const GREEN = combineRgb(0, 160, 60)
const AMBER = combineRgb(220, 160, 0)
const BLACK = combineRgb(0, 0, 0)

/**
 * Said on every feedback the bridge's state mirror cannot answer.
 *
 * Client API v1 mirrors mutes, faders, names, colours, stereo links, the
 * scene and the connection. The param family — assigns, HPF, preamps, send
 * levels — has no path there, so in bridge mode these read back only what
 * this module itself set. A customer reported it as "all the feedbacks that
 * pull actual values from the console report false" (23 Nov 2026), having
 * found the HPF and then the assign; it is nine feedbacks, and it is a gap in
 * the mirror rather than anything the desk does or does not announce.
 */
const LOCAL_ONLY =
	'Follows only what this module sets. The bridge state mirror does not carry this value yet, so a change made on the surface or by another controller will not appear here.'

function num(o: Opts, key: string, dflt = 0): number {
	const v = o[key]
	const n = typeof v === 'number' ? v : Number(v)
	return Number.isFinite(n) ? n : dflt
}

export function buildFeedbacks(ctx: ModuleContext): CompanionFeedbackDefinitions<FeedbacksSchema> {
	const link = ctx.link
	const subs = link.subscriptions

	/**
	 * Wrap a callback so the feedback registers the paths it read; bad options
	 * unsubscribe it.
	 *
	 * A callback may also `ask` for the value behind a path it reads. That Get
	 * goes out once, when the subscription is new, never on the evaluations
	 * that follow. In direct mode it primes the feedback from the desk. In
	 * bridge mode a param-family Get has nowhere to land, so BridgeLink sends
	 * nothing and records the op instead — which is what puts it in
	 * `$(<label>:unsupported_gets)` and the log. Without the ask, that
	 * diagnostic only ever fired for someone who had *also* placed a
	 * param-family action, so an operator whose HPF button sat at false was
	 * told nothing at all.
	 */
	const watch = <T>(
		fn: (o: Opts, register: (...paths: string[]) => void, ask: (intent: Intent, path: string) => void) => T,
		fallback: T,
	) => {
		return (feedback: { id: string; options: Opts }): T => {
			const paths: string[] = []
			const gets: [Intent, string][] = []
			try {
				const r = fn(
					feedback.options,
					(...p) => paths.push(...p),
					(intent, path) => gets.push([intent, path]),
				)
				if (subs.touch(feedback.id, paths)) for (const [intent, path] of gets) link.query(intent, path, 'low')
				return r
			} catch (e) {
				subs.remove(feedback.id)
				ctx.log('debug', `feedback ${feedback.id}: ${(e as Error).message}`)
				return fallback
			}
		}
	}
	const unsubscribe = (feedback: { id: string }) => subs.remove(feedback.id)

	const strip = (o: Opts, _register: (...p: string[]) => void, prefix = ''): ChannelRef => readChannel(o, prefix)

	return {
		mute: {
			type: 'boolean',
			name: 'Mute is on',
			description: 'True while the strip is muted (pushed by the desk the moment it changes)',
			defaultStyle: { bgcolor: RED, color: WHITE },
			options: [...channelFields()],
			callback: watch((o, reg) => {
				const ref = strip(o, reg)
				reg(mutePath(ref))
				return link.state.strip(ref).mute === true
			}, false),
			unsubscribe,
		},
		fader_db: {
			type: 'value',
			name: 'Fader level (dB)',
			description: 'The current fader level as a number (−∞ is reported as -100)',
			options: [...channelFields({ types: CHOICES_FADER_TYPES })],
			callback: watch((o, reg) => {
				const ref = strip(o, reg)
				reg(faderPath(ref))
				const db = levelDb(link.state.strip(ref))
				if (db === undefined) return null
				return db === null ? -100 : db
			}, null),
			unsubscribe,
		},
		fader_above: {
			type: 'boolean',
			name: 'Fader is at or above a level',
			defaultStyle: { bgcolor: GREEN, color: WHITE },
			options: [
				...channelFields({ types: CHOICES_FADER_TYPES }),
				{ type: 'textinput', id: 'db', label: 'Threshold (dB)', default: '-inf', useVariables: true },
			],
			callback: watch((o, reg) => {
				const ref = strip(o, reg)
				reg(faderPath(ref))
				const db = levelDb(link.state.strip(ref))
				if (db === undefined) return false
				const th = parseDb(typeof o.db === 'string' || typeof o.db === 'number' ? String(o.db) : '-inf')
				if (th === undefined) return false
				if (th === null) return db !== null
				return db !== null && db >= th
			}, false),
			unsubscribe,
		},
		stereo_partner: {
			type: 'value',
			name: 'Linked partner (number)',
			description:
				"The number of the strip this one is linked to, or 0. Read it into a local variable to step a channel picker past the other half of a pair — a plain variable can't be nested.",
			options: [...channelFields({ types: CHOICES_FADER_TYPES })],
			callback: watch((o, reg) => {
				const ref = strip(o, reg)
				reg(stereoPath(ref))
				return link.state.strip(ref).stereo?.partner ?? 0
			}, 0),
			unsubscribe,
		},
		stereo_half: {
			type: 'value',
			name: 'Linked half (A / B / empty)',
			description: 'Which half of a linked pair this strip is. Empty when it is not linked.',
			options: [...channelFields({ types: CHOICES_FADER_TYPES })],
			callback: watch((o, reg) => {
				const ref = strip(o, reg)
				reg(stereoPath(ref))
				const st = link.state.strip(ref).stereo
				return st?.linked ? (st.half ?? '') : ''
			}, ''),
			unsubscribe,
		},
		stereo_linked: {
			type: 'boolean',
			name: 'Strip is half of a linked pair',
			defaultStyle: { bgcolor: GREEN, color: WHITE },
			options: [...channelFields({ types: CHOICES_FADER_TYPES })],
			callback: watch((o, reg) => {
				const ref = strip(o, reg)
				reg(stereoPath(ref))
				return link.state.strip(ref).stereo?.linked === true
			}, false),
			unsubscribe,
		},
		fader_text: {
			type: 'value',
			name: 'Fader level (text)',
			description: '"0.0 dB", "-inf dB" — for button labels via a local variable',
			options: [...channelFields({ types: CHOICES_FADER_TYPES })],
			callback: watch((o, reg) => {
				const ref = strip(o, reg)
				reg(faderPath(ref))
				const db = levelDb(link.state.strip(ref))
				return db === undefined ? '' : formatDb(db)
			}, ''),
			unsubscribe,
		},
		channel_colour: {
			type: 'advanced',
			name: 'Button takes the channel colour',
			description: 'Background (and text) follow the colour set on the desk for this strip',
			options: [...channelFields(), { type: 'checkbox', id: 'text', label: 'Also set text colour', default: true }],
			affectedProperties: ['bgcolor', 'color'],
			callback: watch<CompanionAdvancedFeedbackResult>((o, reg) => {
				const ref = strip(o, reg)
				reg(colourPath(ref))
				const c = COLOUR_STYLE[link.state.strip(ref).colour]
				return o.text === false ? { bgcolor: c.bg } : { bgcolor: c.bg, color: c.text }
			}, {}),
			unsubscribe,
		},
		channel_name: {
			type: 'value',
			name: 'Channel name',
			description: 'The name from the desk (or the show file before the desk answers)',
			options: [...channelFields()],
			callback: watch((o, reg) => {
				const ref = strip(o, reg)
				reg(namePath(ref))
				return link.state.strip(ref).name
			}, ''),
			unsubscribe,
		},
		main_assigned: {
			type: 'boolean',
			name: 'Assigned to main mix',
			description: LOCAL_ONLY,
			defaultStyle: { bgcolor: GREEN, color: WHITE },
			options: [...channelFields({ types: CHOICES_ASSIGNABLE_TYPES })],
			callback: watch((o, reg, ask) => {
				const ref = strip(o, reg)
				reg(paramPath(ref, PARAM_MAIN_ASSIGN))
				ask({ op: 'get_param', ...ref, param: PARAM_MAIN_ASSIGN }, paramPath(ref, PARAM_MAIN_ASSIGN))
				return link.state.strip(ref).mainAssign === true
			}, false),
			unsubscribe,
		},
		dca_assigned: {
			type: 'boolean',
			name: 'Assigned to DCA',
			description: LOCAL_ONLY,
			defaultStyle: { bgcolor: GREEN, color: WHITE },
			options: [
				...channelFields({ types: CHOICES_ASSIGNABLE_TYPES }),
				{ type: 'number', id: 'dca', label: 'DCA', default: 1, min: 1, max: 24 },
			],
			callback: watch((o, reg, ask) => {
				const ref = strip(o, reg)
				reg(paramPath(ref, PARAM_ASSIGN))
				ask({ op: 'get_param', ...ref, param: PARAM_ASSIGN }, paramPath(ref, PARAM_ASSIGN))
				return link.state.strip(ref).dca.has(Math.round(num(o, 'dca', 1)))
			}, false),
			unsubscribe,
		},
		mute_group_assigned: {
			type: 'boolean',
			name: 'Assigned to mute group',
			description: LOCAL_ONLY,
			defaultStyle: { bgcolor: GREEN, color: WHITE },
			options: [
				...channelFields({ types: CHOICES_ASSIGNABLE_TYPES }),
				{ type: 'number', id: 'group', label: 'Mute group', default: 1, min: 1, max: 8 },
			],
			callback: watch((o, reg, ask) => {
				const ref = strip(o, reg)
				reg(paramPath(ref, PARAM_ASSIGN))
				ask({ op: 'get_param', ...ref, param: PARAM_ASSIGN }, paramPath(ref, PARAM_ASSIGN))
				return link.state.strip(ref).muteGroups.has(Math.round(num(o, 'group', 1)))
			}, false),
			unsubscribe,
		},
		mix_assigned: {
			type: 'boolean',
			name: 'Input assigned to group / aux / matrix',
			description: LOCAL_ONLY,
			defaultStyle: { bgcolor: GREEN, color: WHITE },
			options: [
				{ type: 'number', id: 'index', label: 'Input', default: 1, min: 1, max: 128 },
				...channelFields({ types: CHOICES_MIX_DEST, prefix: 'dest', label: 'Mix', defaultType: 'mono_aux' }),
			],
			callback: watch((o, reg, ask) => {
				const index = Math.round(num(o, 'index', 1))
				const dst = readChannel(o, 'dest')
				reg(mixPath(index, dst))
				ask({ op: 'get_mix_assign', index, dest_type: dst.type, dest_index: dst.index }, mixPath(index, dst))
				return link.state.mixAssigned(index, dst) === true
			}, false),
			unsubscribe,
		},
		send_level: {
			type: 'value',
			name: 'Send level',
			description: `dB, or raw 0-127 if "Show send levels in dB" is turned off in the connection settings. ${LOCAL_ONLY}`,
			options: [
				...channelFields({ types: CHOICES_SEND_SOURCE, label: 'From' }),
				...channelFields({ types: CHOICES_SEND_DEST, prefix: 'dest', label: 'To', defaultType: 'mono_aux' }),
			],
			callback: watch((o, reg, ask) => {
				const src = readChannel(o)
				const dst = readChannel(o, 'dest')
				reg(sendPath(src, dst))
				ask({ op: 'get_send_level', ...src, dest_type: dst.type, dest_index: dst.index }, sendPath(src, dst))
				const lv = link.state.sendLevel(src, dst)
				if (lv === undefined) return null
				if (!ctx.config.sendsInDb) return lv
				const db = lvToDb(lv)
				return db === null ? -100 : db
			}, null),
			unsubscribe,
		},
		hpf_on: {
			type: 'boolean',
			name: 'HPF is on',
			description: LOCAL_ONLY,
			defaultStyle: { bgcolor: AMBER, color: BLACK },
			options: [{ type: 'number', id: 'index', label: 'Input', default: 1, min: 1, max: 128 }],
			callback: watch((o, reg, ask) => {
				const ref: ChannelRef = { type: 'input', index: Math.round(num(o, 'index', 1)) }
				reg(paramPath(ref, PARAM_HPF_ON))
				ask({ op: 'get_param', ...ref, param: PARAM_HPF_ON }, paramPath(ref, PARAM_HPF_ON))
				return link.state.strip(ref).params.get(PARAM_HPF_ON) === 1
			}, false),
			unsubscribe,
		},
		preamp_48v: {
			type: 'boolean',
			name: 'Preamp 48 V is on',
			description: LOCAL_ONLY,
			defaultStyle: { bgcolor: RED, color: WHITE },
			options: [...socketFields()],
			callback: watch((o, reg, ask) => {
				const sock = readSocket(o)
				reg(preampPath('48v', sock))
				ask({ op: 'get_preamp_48v', ...sock }, preampPath('48v', sock))
				return link.state.socket(sock).phantom === true
			}, false),
			unsubscribe,
		},
		preamp_pad: {
			type: 'boolean',
			name: 'Preamp pad is on',
			description: LOCAL_ONLY,
			defaultStyle: { bgcolor: AMBER, color: BLACK },
			options: [...socketFields()],
			callback: watch((o, reg, ask) => {
				const sock = readSocket(o)
				reg(preampPath('pad', sock))
				ask({ op: 'get_preamp_pad', ...sock }, preampPath('pad', sock))
				return link.state.socket(sock).pad === true
			}, false),
			unsubscribe,
		},
		preamp_gain: {
			type: 'value',
			name: 'Preamp gain (dB)',
			description: LOCAL_ONLY,
			options: [...socketFields()],
			callback: watch((o, reg, ask) => {
				const sock = readSocket(o)
				reg(preampPath('gain', sock))
				ask({ op: 'get_preamp_gain', ...sock }, preampPath('gain', sock))
				const v = link.state.socket(sock).gain
				if (v === undefined) return null
				const r = ctx.config.preampGainRange === 'legacy' ? { min: -10, max: 50 } : { min: 5, max: 60 }
				return Math.round((r.min + (v / 127) * (r.max - r.min)) * 2) / 2
			}, null),
			unsubscribe,
		},
		scene_current: {
			type: 'boolean',
			name: 'Current scene is…',
			description: 'True when the last scene recalled (by anyone) is this one',
			defaultStyle: { bgcolor: GREEN, color: WHITE },
			options: [{ type: 'number', id: 'scene', label: 'Scene', default: 1, min: 1, max: 500 }],
			callback: watch((o, reg) => {
				reg(SCENE_PATH)
				return link.state.currentScene === Math.round(num(o, 'scene', 1))
			}, false),
			unsubscribe,
		},
		// Names change only when the show reloads, which re-checks every feedback, so there is nothing to watch.
		scene_name: {
			type: 'value',
			name: 'Scene name',
			description: "A scene's name, from the show file or the connection's scene names (empty when it has none)",
			options: [{ type: 'number', id: 'scene', label: 'Scene', default: 1, min: 1, max: 500 }],
			callback: (feedback) => link.state.sceneName(Math.round(num(feedback.options, 'scene', 1))),
		},
		connected: {
			type: 'boolean',
			name: 'Console is answering',
			description: 'True only when the desk replies to our liveness probe — not merely when TCP connected',
			defaultStyle: { bgcolor: GREEN, color: WHITE },
			options: [],
			callback: watch((_o, reg) => {
				reg(CONNECTION_PATH)
				return link.state.connected
			}, false),
			unsubscribe,
		},
	}
}

export { CHANNEL_TABLE }
