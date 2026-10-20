import type { CompanionActionDefinitions, CompanionOptionValues, DropdownChoice } from '@companion-module/base'
import type { ModuleContext } from './context.js'
import {
	CHANNEL_TABLE,
	isChannelType,
	isSocketBank,
	type ChannelRef,
	type ChannelType,
	type Colour,
	type SocketRef,
	COLOURS,
} from './protocol/channels.js'
import {
	dbToLv,
	eqFreqToValue,
	eqGainToValue,
	eqWidthToValue,
	hpfFreqToValue,
	lvToDb,
	parseDb,
	preampGainToValue,
	preampValueToGain,
	stepDb,
	stepFromDb,
	stepLv,
} from './protocol/levels.js'
import type { PeqParam } from './protocol/intents.js'
import { faderPath, mutePath, paramPath, preampPath, sendPath } from './state/model.js'
import {
	CHOICES_ASSIGNABLE_TYPES,
	CHOICES_COLOURS,
	CHOICES_FADER_TYPES,
	CHOICES_MIX_DEST,
	CHOICES_ON_OFF_TOGGLE,
	CHOICES_PEQ_TYPES,
	CHOICES_SEND_DEST,
	CHOICES_SEND_SOURCE,
	DB_FIELD,
	FADE_FIELD,
	channelFields,
	socketFields,
} from './choices.js'

// The schema is intentionally loose (Record<string, {options}>): option values
// arrive expression-parsed and are validated at use by the helpers below.
export type ActionsSchema = Record<string, { options: CompanionOptionValues }>

type Opts = CompanionOptionValues

function num(o: Opts, key: string, dflt = 0): number {
	const v = o[key]
	const n = typeof v === 'number' ? v : Number(v)
	return Number.isFinite(n) ? n : dflt
}

function str(o: Opts, key: string, dflt = ''): string {
	const v = o[key]
	if (v === undefined || v === null) return dflt
	if (typeof v === 'object') return JSON.stringify(v)
	return String(v)
}

export function readChannel(o: Opts, prefix = ''): ChannelRef {
	const p = prefix ? `${prefix}_` : ''
	const type = str(o, `${p}type`, 'input')
	if (!isChannelType(type)) throw new Error(`unknown channel type "${type}"`)
	const index = Math.round(num(o, `${p}index`, 1))
	const count = CHANNEL_TABLE[type].count
	if (index < 1 || index > count)
		throw new Error(`${CHANNEL_TABLE[type].label} number must be 1–${count} (got ${index})`)
	return { type, index }
}

export function readSocket(o: Opts): SocketRef {
	const bank = str(o, 'bank', 'mixrack')
	if (!isSocketBank(bank)) throw new Error(`unknown socket bank "${bank}"`)
	return { bank, socket: Math.round(num(o, 'socket', 1)) }
}

function onOffToggle(o: Opts, key: string, current: boolean | undefined): boolean {
	const mode = str(o, key, 'toggle')
	if (mode === 'on') return true
	if (mode === 'off') return false
	return !(current ?? false)
}

function readDb(o: Opts, key: string): number | null {
	const parsed = parseDb(str(o, key, '0'))
	if (parsed === undefined) throw new Error(`"${str(o, key)}" is not a dB value (try 0, -6, +3.5 or -inf)`)
	return parsed
}

export function actionsMapChoices(ctx: ModuleContext): DropdownChoice[] {
	if (ctx.actionsMap.length === 0)
		return [{ id: '', label: '— add entries to the Console Actions map in the connection settings —' }]
	return ctx.actionsMap.map((e, i) => ({
		id: `${e.cc}/${e.value}`,
		label: `${e.name}  (CC ${e.cc} = ${e.value})${dupMarker(ctx, i)}`,
	}))
}

function dupMarker(ctx: ModuleContext, i: number): string {
	const e = ctx.actionsMap[i]
	return ctx.actionsMap.findIndex((x) => x.cc === e.cc && x.value === e.value) !== i ? ' ⚠ duplicate' : ''
}

export function buildActions(ctx: ModuleContext): CompanionActionDefinitions<ActionsSchema> {
	const link = ctx.link

	const run = (fn: (o: Opts) => void) => (event: { options: Opts }) => {
		try {
			fn(event.options)
		} catch (e) {
			ctx.log('warn', (e as Error).message)
		}
	}

	const defs: CompanionActionDefinitions<ActionsSchema> = {
		// ------------------------------------------------------------ mutes
		mute: {
			name: 'Mute',
			description: 'Mute, unmute or toggle any strip',
			options: [
				...channelFields(),
				{ type: 'dropdown', id: 'mode', label: 'Set', default: 'toggle', choices: CHOICES_ON_OFF_TOGGLE },
			],
			callback: run((o) => {
				const ref = readChannel(o)
				const on = onOffToggle(o, 'mode', link.state.strip(ref).mute)
				link.send({ op: 'mute', ...ref, on })
			}),
			learn: (event) => {
				try {
					const ref = readChannel(event.options)
					const m = link.state.strip(ref).mute
					return m === undefined ? undefined : { mode: m ? 'on' : 'off' }
				} catch {
					return undefined
				}
			},
		},

		// ------------------------------------------------------------ faders
		fader: {
			name: 'Fader: set level (dB)',
			description: 'Set a fader to a dB value, optionally over a timed fade',
			options: [...channelFields({ types: CHOICES_FADER_TYPES }), DB_FIELD('db', 'Level', '0'), FADE_FIELD],
			callback: run((o) => {
				const ref = readChannel(o)
				link.fadeTo(ref, { db: readDb(o, 'db') }, num(o, 'fade'))
			}),
			learn: (event) => {
				try {
					const lv = link.state.strip(readChannel(event.options)).level
					if (lv === undefined) return undefined
					const db = lvToDb(lv)
					return { db: db === null ? '-inf' : db.toFixed(1) }
				} catch {
					return undefined
				}
			},
		},
		fader_step: {
			name: 'Fader: adjust by dB',
			description: 'Nudge a fader up or down relative to where it is now (Get-queried if unknown)',
			options: [
				...channelFields({ types: CHOICES_FADER_TYPES }),
				{ type: 'number', id: 'delta', label: 'Change (dB)', default: 1, min: -60, max: 60, step: 0.5 },
				FADE_FIELD,
			],
			callback: run((o) => {
				const ref = readChannel(o)
				const cur = link.state.strip(ref).level
				if (cur === undefined) {
					link.query({ op: 'get_fader', ...ref }, faderPath(ref), 'high')
					ctx.log(
						'info',
						`${CHANNEL_TABLE[ref.type].label} ${ref.index} level not known yet — asked the desk; press again`,
					)
					return
				}
				// step in dB, which every family understands, rather than in lv
				const from = link.state.strip(ref).db ?? lvToDb(cur)
				link.fadeTo(ref, { db: stepFromDb(from, num(o, 'delta', 1)) }, num(o, 'fade'))
			}),
		},
		fader_raw: {
			name: 'Fader: set raw value (0–127)',
			description:
				'Set a fader by dLive MIDI value; 107 = 0 dB, 0 = −∞. Not sent to other consoles — use Set level (dB) there.',
			options: [
				...channelFields({ types: CHOICES_FADER_TYPES }),
				{ type: 'number', id: 'lv', label: 'Value', default: 107, min: 0, max: 127 },
				{
					type: 'number',
					id: 'steps',
					label: 'Or adjust by steps (±)',
					tooltip: 'Non-zero: ignore Value and move relative to the current level',
					default: 0,
					min: -127,
					max: 127,
				},
				FADE_FIELD,
			],
			callback: run((o) => {
				const ref = readChannel(o)
				const steps = Math.round(num(o, 'steps'))
				if (steps !== 0) {
					const cur = link.state.strip(ref).level
					if (cur === undefined) {
						link.query({ op: 'get_fader', ...ref }, faderPath(ref), 'high')
						return
					}
					link.fadeTo(ref, { lv: stepLv(cur, steps) }, num(o, 'fade'))
				} else {
					link.fadeTo(ref, { lv: Math.max(0, Math.min(127, Math.round(num(o, 'lv', 107)))) }, num(o, 'fade'))
				}
			}),
		},

		// ------------------------------------------------------------ sends
		send_level: {
			name: 'Send level',
			description: 'Set the send from a channel to an aux / FX / matrix / UFX bus',
			options: [
				...channelFields({ types: CHOICES_SEND_SOURCE, label: 'From' }),
				...channelFields({ types: CHOICES_SEND_DEST, prefix: 'dest', label: 'To', defaultType: 'mono_aux' }),
				{
					type: 'dropdown',
					id: 'mode',
					label: 'Value as',
					default: ctx.config.sendsInDb ? 'db' : 'raw',
					choices: [
						{ id: 'raw', label: 'Raw 0–127' },
						{ id: 'db', label: 'dB' },
					],
				},
				{
					type: 'number',
					id: 'lv',
					label: 'Value (0–127)',
					default: 107,
					min: 0,
					max: 127,
					isVisibleExpression: `$(options:mode) == 'raw'`,
				},
				{ ...DB_FIELD('db', 'Level (dB)', '0'), isVisibleExpression: `$(options:mode) == 'db'` },
				{
					type: 'number',
					id: 'delta',
					label: 'Or adjust by (±, same units)',
					default: 0,
					min: -127,
					max: 127,
					step: 0.5,
				},
				FADE_FIELD,
			],
			callback: run((o) => {
				const src = readChannel(o)
				const dst = readChannel(o, 'dest')
				const inDb = str(o, 'mode', 'raw') === 'db'
				const delta = num(o, 'delta')
				let target: number
				if (delta !== 0) {
					const cur = link.state.sendLevel(src, dst)
					if (cur === undefined) {
						link.query(
							{ op: 'get_send_level', ...src, dest_type: dst.type, dest_index: dst.index },
							sendPath(src, dst),
							'high',
						)
						ctx.log('info', `Send level not known yet — asked the desk; press again`)
						return
					}
					target = inDb ? stepDb(cur, delta) : stepLv(cur, Math.round(delta))
				} else {
					target = inDb ? dbToLv(readDb(o, 'db')) : Math.max(0, Math.min(127, Math.round(num(o, 'lv', 107))))
				}
				const fade = num(o, 'fade')
				const cur = link.state.sendLevel(src, dst)
				if (fade > 0 && cur !== undefined) {
					link.fadeSend(src, dst, cur, target, fade)
					return
				}
				link.send({ op: 'send_level', ...src, dest_type: dst.type, dest_index: dst.index, level: target })
			}),
		},

		// ------------------------------------------------------------ assigns
		main_assign: {
			name: 'Assign to main mix',
			options: [
				...channelFields({ types: CHOICES_ASSIGNABLE_TYPES }),
				{ type: 'dropdown', id: 'mode', label: 'Set', default: 'toggle', choices: CHOICES_ON_OFF_TOGGLE },
			],
			callback: run((o) => {
				const ref = readChannel(o)
				const cur = link.state.strip(ref).mainAssign
				if (cur === undefined && str(o, 'mode', 'toggle') === 'toggle')
					link.query({ op: 'get_param', ...ref, param: 0x18 }, paramPath(ref, 0x18), 'high')
				link.send({ op: 'main_assign', ...ref, on: onOffToggle(o, 'mode', cur) })
			}),
		},
		dca_assign: {
			name: 'Assign to DCA',
			options: [
				...channelFields({ types: CHOICES_ASSIGNABLE_TYPES }),
				{ type: 'number', id: 'dca', label: 'DCA', default: 1, min: 1, max: 24 },
				{ type: 'dropdown', id: 'mode', label: 'Set', default: 'toggle', choices: CHOICES_ON_OFF_TOGGLE },
			],
			callback: run((o) => {
				const ref = readChannel(o)
				const dca = Math.round(num(o, 'dca', 1))
				const s = link.state.strip(ref)
				const cur = s.dcaKnown ? s.dca.has(dca) : undefined
				link.send({ op: 'dca_assign', ...ref, dca, on: onOffToggle(o, 'mode', cur) })
			}),
		},
		mute_group_assign: {
			name: 'Assign to mute group',
			options: [
				...channelFields({ types: CHOICES_ASSIGNABLE_TYPES }),
				{ type: 'number', id: 'group', label: 'Mute group', default: 1, min: 1, max: 8 },
				{ type: 'dropdown', id: 'mode', label: 'Set', default: 'toggle', choices: CHOICES_ON_OFF_TOGGLE },
			],
			callback: run((o) => {
				const ref = readChannel(o)
				const group = Math.round(num(o, 'group', 1))
				const s = link.state.strip(ref)
				const cur = s.muteGroupsKnown ? s.muteGroups.has(group) : undefined
				link.send({ op: 'mute_group_assign', ...ref, group, on: onOffToggle(o, 'mode', cur) })
			}),
		},
		mix_assign: {
			name: 'Input to group / aux / matrix',
			description: 'Assign an input channel to a mix bus',
			options: [
				{ type: 'number', id: 'index', label: 'Input', default: 1, min: 1, max: 128 },
				...channelFields({ types: CHOICES_MIX_DEST, prefix: 'dest', label: 'Mix', defaultType: 'mono_aux' }),
				{ type: 'dropdown', id: 'mode', label: 'Set', default: 'toggle', choices: CHOICES_ON_OFF_TOGGLE },
			],
			callback: run((o) => {
				const index = Math.round(num(o, 'index', 1))
				const dst = readChannel(o, 'dest')
				const cur = link.state.mixAssigned(index, dst)
				link.send({
					op: 'mix_assign',
					index,
					dest_type: dst.type,
					dest_index: dst.index,
					on: onOffToggle(o, 'mode', cur),
				})
			}),
		},

		// ------------------------------------------------------------ preamps
		preamp_gain: {
			name: 'Preamp gain',
			description: 'Set or nudge the gain of a physical socket',
			options: [
				...socketFields(),
				{ type: 'number', id: 'gain', label: 'Gain (dB)', default: 30, min: -10, max: 60, step: 0.5 },
				{ type: 'number', id: 'delta', label: 'Or adjust by (dB, ±)', default: 0, min: -60, max: 60, step: 0.5 },
			],
			callback: run((o) => {
				const sock = readSocket(o)
				const range = ctx.config.preampGainRange
				const delta = num(o, 'delta')
				let value: number
				if (delta !== 0) {
					const cur = link.state.socket(sock).gain
					if (cur === undefined) {
						link.query({ op: 'get_preamp_gain', ...sock }, preampPath('gain', sock), 'high')
						ctx.log('info', 'Preamp gain not known yet — asked the desk; press again')
						return
					}
					value = preampGainToValue(preampValueToGain(cur, range) + delta, range)
				} else {
					value = preampGainToValue(num(o, 'gain', 30), range)
				}
				link.send({ op: 'preamp_gain', ...sock, value })
			}),
		},
		preamp_pad: {
			name: 'Preamp pad',
			options: [
				...socketFields(),
				{ type: 'dropdown', id: 'mode', label: 'Set', default: 'toggle', choices: CHOICES_ON_OFF_TOGGLE },
			],
			callback: run((o) => {
				const sock = readSocket(o)
				link.send({ op: 'preamp_pad', ...sock, on: onOffToggle(o, 'mode', link.state.socket(sock).pad) })
			}),
		},
		preamp_48v: {
			name: 'Preamp 48 V',
			options: [
				...socketFields(),
				{ type: 'dropdown', id: 'mode', label: 'Set', default: 'toggle', choices: CHOICES_ON_OFF_TOGGLE },
			],
			callback: run((o) => {
				const sock = readSocket(o)
				link.send({ op: 'preamp_48v', ...sock, on: onOffToggle(o, 'mode', link.state.socket(sock).phantom) })
			}),
		},

		// ------------------------------------------------------------ EQ
		peq: {
			name: 'PEQ band',
			description: 'Set one parameter of a parametric EQ band',
			options: [
				...channelFields({ types: CHOICES_PEQ_TYPES }),
				{ type: 'number', id: 'band', label: 'Band (1–4)', default: 1, min: 1, max: 4 },
				{
					type: 'dropdown',
					id: 'param',
					label: 'Parameter',
					default: 'gain',
					choices: [
						{ id: 'gain', label: 'Gain' },
						{ id: 'freq', label: 'Frequency' },
						{ id: 'width', label: 'Width' },
						{ id: 'type', label: 'Type' },
					],
				},
				{
					type: 'number',
					id: 'gain',
					label: 'Gain (dB)',
					default: 0,
					min: -15,
					max: 15,
					step: 0.5,
					isVisibleExpression: `$(options:param) == 'gain'`,
				},
				{
					type: 'number',
					id: 'freq',
					label: 'Frequency (Hz)',
					default: 1000,
					min: 20,
					max: 20000,
					isVisibleExpression: `$(options:param) == 'freq'`,
				},
				{
					type: 'number',
					id: 'width',
					label: 'Width (0.11–1.5)',
					default: 1,
					min: 0.11,
					max: 1.5,
					step: 0.05,
					isVisibleExpression: `$(options:param) == 'width'`,
				},
				{
					type: 'dropdown',
					id: 'filter_type',
					label: 'Filter type',
					default: 0,
					choices: [
						{ id: 0, label: 'Bell' },
						{ id: 1, label: 'Low shelf (band 1)' },
						{ id: 2, label: 'High shelf (band 4)' },
						{ id: 3, label: 'Low pass (band 4)' },
						{ id: 4, label: 'High pass (band 1)' },
					],
					isVisibleExpression: `$(options:param) == 'type'`,
				},
			],
			callback: run((o) => {
				const ref = readChannel(o)
				const band = Math.round(num(o, 'band', 1))
				const param = str(o, 'param', 'gain') as PeqParam
				let value: number
				switch (param) {
					case 'gain':
						value = eqGainToValue(num(o, 'gain'))
						break
					case 'freq':
						value = eqFreqToValue(num(o, 'freq', 1000))
						break
					case 'width':
						value = eqWidthToValue(num(o, 'width', 1))
						break
					default:
						value = Math.round(num(o, 'filter_type'))
				}
				link.send({ op: 'peq', ...ref, band, param, value })
			}),
		},
		hpf: {
			name: 'HPF',
			description: 'High-pass filter on an input: on/off and/or frequency',
			options: [
				{ type: 'number', id: 'index', label: 'Input', default: 1, min: 1, max: 128 },
				{
					type: 'dropdown',
					id: 'mode',
					label: 'Set',
					default: 'toggle',
					choices: [...CHOICES_ON_OFF_TOGGLE, { id: 'keep', label: 'Leave on/off as is' }],
				},
				{ type: 'number', id: 'freq', label: 'Frequency (Hz, 0 = leave)', default: 0, min: 0, max: 2000 },
			],
			callback: run((o) => {
				const index = Math.round(num(o, 'index', 1))
				const mode = str(o, 'mode', 'toggle')
				const freq = num(o, 'freq')
				if (freq > 0) link.send({ op: 'hpf_freq', index, value: hpfFreqToValue(freq) })
				if (mode !== 'keep') {
					const cur = link.state.strip({ type: 'input', index }).params.get(0x31)
					link.send({ op: 'hpf_on', index, on: onOffToggle(o, 'mode', cur === undefined ? undefined : cur === 1) })
				}
			}),
		},

		// ------------------------------------------------------------ names & colours
		set_name: {
			name: 'Set channel name',
			options: [...channelFields(), { type: 'textinput', id: 'name', label: 'Name', default: '', useVariables: true }],
			callback: run((o) => link.send({ op: 'set_name', ...readChannel(o), name: str(o, 'name') })),
		},
		set_colour: {
			name: 'Set channel colour',
			options: [
				...channelFields(),
				{ type: 'dropdown', id: 'colour', label: 'Colour', default: 'off', choices: CHOICES_COLOURS },
			],
			callback: run((o) => {
				const colour = str(o, 'colour', 'off')
				if (!(COLOURS as readonly string[]).includes(colour)) throw new Error(`unknown colour ${colour}`)
				link.send({ op: 'set_colour', ...readChannel(o), colour: colour as Colour })
			}),
		},

		// ------------------------------------------------------------ scenes & cues
		scene_recall: {
			name: 'Scene: recall',
			options: [
				{
					type: 'number',
					id: 'scene',
					label: 'Scene (1–500)',
					tooltip: 'Accepts an expression',
					default: 1,
					min: 1,
					max: 500,
				},
			],
			callback: run((o) => link.send({ op: 'scene', scene: Math.round(num(o, 'scene', 1)) })),
		},
		scene_go: {
			name: 'Scene: Go (cue list) — needs the Surface socket',
			description: `Cue-list Go ${SURFACE_ONLY}. Scene recall works: it is a MixRack message.`,
			options: [],
			callback: run(() => surfaceCc(ctx, ctx.config.goCc, ctx.config.goValue, 'Go')),
		},
		scene_next: {
			name: 'Scene: Next — needs the Surface socket',
			description: `Cue-list Next ${SURFACE_ONLY}.`,
			options: [],
			callback: run(() => surfaceCc(ctx, ctx.config.nextCc, ctx.config.nextValue, 'Next')),
		},
		scene_prev: {
			name: 'Scene: Previous — needs the Surface socket',
			description: `Cue-list Previous ${SURFACE_ONLY}.`,
			options: [],
			callback: run(() => surfaceCc(ctx, ctx.config.prevCc, ctx.config.prevValue, 'Previous')),
		},
		cue_list_recall: {
			name: 'Cue list: recall by ID — needs the Surface socket',
			description: `Cue-list recall ${SURFACE_ONLY}: on the Virtual dLive, ID 11 recalled scene 12. Use "Scene: recall" instead.`,
			options: [{ type: 'number', id: 'id', label: 'Recall ID (0–1999)', default: 0, min: 0, max: 1999 }],
			callback: run(() => refuseSurface(ctx, 'Cue list: recall by ID')),
		},

		// ------------------------------------------------------------ console Actions
		console_action: {
			name: 'Recall console Action',
			description:
				'Fires an Action from the map in the connection settings (Surface → Actions → MIDI Recall on the desk)',
			options: [
				{
					type: 'dropdown',
					id: 'entry',
					label: 'Action',
					default: actionsMapChoices(ctx)[0]?.id ?? '',
					choices: actionsMapChoices(ctx),
				},
			],
			callback: run((o) => {
				const [cc, value] = str(o, 'entry').split('/').map(Number)
				if (!Number.isInteger(cc) || !Number.isInteger(value))
					throw new Error('Pick an Action from the map (add entries in the connection settings)')
				link.send({ op: 'action', cc, value })
			}),
		},
		console_action_raw: {
			name: 'Recall console Action (CC/value)',
			options: [
				{ type: 'number', id: 'cc', label: 'Control number', default: 20, min: 0, max: 127 },
				{ type: 'number', id: 'value', label: 'Value', default: 1, min: 0, max: 127 },
			],
			callback: run((o) =>
				link.send({ op: 'action', cc: Math.round(num(o, 'cc')), value: Math.round(num(o, 'value')) }),
			),
		},
		surface_cc: {
			name: 'Send CC to the Surface — needs the Surface socket',
			description: `Any user-assigned Surface control (Go/Next/Prev, UFX unit parameters…). It ${SURFACE_ONLY}.`,
			options: [
				{ type: 'number', id: 'cc', label: 'Control number', default: 0, min: 0, max: 127 },
				{ type: 'number', id: 'value', label: 'Value', default: 127, min: 0, max: 127 },
			],
			callback: run(() => refuseSurface(ctx, 'Send CC to the Surface')),
		},
		ufx_key: {
			name: 'UFX global key',
			options: [
				{
					type: 'dropdown',
					id: 'key',
					label: 'Key',
					default: 0,
					choices: ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].map((k, i) => ({
						id: i,
						label: k,
					})),
				},
			],
			callback: run((o) => link.send({ op: 'ufx_key', key: Math.round(num(o, 'key')) })),
		},
		ufx_scale: {
			name: 'UFX global scale',
			options: [
				{
					type: 'dropdown',
					id: 'scale',
					label: 'Scale',
					default: 0,
					choices: [
						{ id: 0, label: 'Major' },
						{ id: 1, label: 'Minor' },
					],
				},
			],
			callback: run((o) => link.send({ op: 'ufx_scale', scale: Math.round(num(o, 'scale')) })),
		},

		// ------------------------------------------------------------ housekeeping
		refresh_strip: {
			name: 'Refresh a strip from the desk',
			description: 'Re-query name, colour, mute and fader',
			options: [...channelFields()],
			callback: run((o) => {
				const ref = readChannel(o)
				link.query({ op: 'get_name', ...ref }, `name/${ref.type}/${ref.index}`, 'high')
				link.query({ op: 'get_colour', ...ref }, `colour/${ref.type}/${ref.index}`, 'high')
				link.query({ op: 'get_mute', ...ref }, mutePath(ref), 'high')
				if (ref.type !== 'mute_group') link.query({ op: 'get_fader', ...ref }, faderPath(ref), 'high')
			}),
		},
		resync: {
			name: 'Resync everything from the desk',
			options: [],
			callback: run(() => ctx.resync()),
		},
		reload_show_file: {
			name: 'Reload show file',
			description: 'Re-read scene names and channel names from the show file in the connection settings',
			options: [],
			callback: async () => {
				await ctx.reloadShowFile()
			},
		},
	}

	return defs
}

/**
 * Surface-socket work the bridge cannot do (#55). Cue-list recall and the
 * scene CCs belong on the console's Surface socket, 51328. The MIDI Bridge
 * has one console connection — the MixRack's — and these bytes mean
 * something else there: verified on the Virtual dLive, 28 Sept 2026, where
 * "cue list: recall ID 11" recalled SCENE 12. Refusing is the only safe
 * answer until the bridge grows a Surface socket; a show must not jump to
 * the wrong scene because a key said "cue".
 */
const SURFACE_ONLY =
	"needs the console's Surface socket, which the MIDI Bridge doesn't have. Its one console connection is the MixRack's, where these bytes recall a scene instead — so nothing was sent"

function refuseSurface(ctx: ModuleContext, what: string): void {
	ctx.log('warn', `${what} ${SURFACE_ONLY}`)
}

function surfaceCc(ctx: ModuleContext, _cc: number, _value: number, what: string): void {
	refuseSurface(ctx, `Scene ${what}`)
}

export { type ChannelType }
