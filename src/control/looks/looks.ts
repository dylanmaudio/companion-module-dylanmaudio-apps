/**
 * Styled keys for each app, as Companion 5 layered presets: the app's logo
 * and its menu-bar icon (both open the app), a round Run button, a level
 * meter, Pilot Tone's failback pills and status tile in the app's own
 * colours, and Console Control's status tiles.
 *
 * Built from the app's catalogue like everything else: a preset appears only
 * when the controls and state it uses are there. Coordinates are percent of
 * the key. Images come from images.ts (tools/app-images.py).
 */

import type { CompanionPresetSection } from '@companion-module/base'
import type { ModuleSchema } from '../../main.js'
import { actionId, boolFeedbackId, enumFeedbackId, type VariableNaming } from '../definitions.js'
import { OPEN_APP_ACTION } from '../openapp.js'
import type { AppId } from '../registry.js'
import type { Catalogue } from '../types.js'
import { APP_LOGOS, MENUBAR_ICONS } from './images.js'
import { APP_NAME, RUN_NAME } from './labels.js'
import {
	at,
	box,
	CAPTION,
	expr,
	feedback,
	fitSize,
	FULL,
	image,
	layered,
	press,
	set,
	text,
	VALUE,
	type Json,
	type Override,
	type Preset,
	type Presets,
} from './layers.js'
import { KEY, METER, PALETTE, PTT_TILE } from './palette.js'

const whenIs = (key: string, value: string, overrides: Override[]): Json =>
	feedback(enumFeedbackId(key), { value }, overrides)
const whenOn = (key: string, overrides: Override[]): Json => feedback(boolFeedbackId(key), {}, overrides)

/** The state each menu-bar icon follows, and the values it has a picture for. */
const MENUBAR_STATE: Partial<Record<AppId, string>> = {
	bridge: 'bridge.state',
	tlt: 'tlt.talk',
	ptt: 'ptt.state',
	tct: 'tct.state',
}

const METER_TITLE: Partial<Record<AppId, string>> = { tlt: 'MIC', ptt: 'PILOT', tct: 'LTC IN' }
const DB_MIN = -60
const DB_MAX = 0

export function buildLookPresets(
	app: AppId,
	cat: Catalogue | null,
	label: string,
	naming: VariableNaming,
): { section: CompanionPresetSection<ModuleSchema>; presets: Presets } {
	const presets: Presets = {}
	const add = (id: string, p: Preset): void => {
		presets[`p_${app}__look_${id}`] = p
	}
	const has = (key: string): boolean => !!cat?.state.some((s) => s.key === key)
	const control = (id: string): boolean => !!cat?.controls.some((c) => c.id === id)
	const variable = (key: string): string => `$(${label}:${naming(key)})`
	const openApp = press(OPEN_APP_ACTION)

	// The logo: always there, even with no catalogue — it is how the app gets started.
	add(
		'logo',
		layered(
			`${APP_NAME[app]} logo (opens the app)`,
			[
				box('bg', PALETTE.window),
				image('logo', APP_LOGOS[app], { x: 12, y: 4, w: 76, h: 70 }),
				text('name', APP_NAME[app], { x: 0, y: 76, w: 100, h: 22 }),
			],
			[],
			openApp,
		),
	)

	// The menu-bar icon, mirrored state by state.
	const stateKey = MENUBAR_STATE[app]
	if (stateKey && app !== 'cxc' && app !== 'sr' && has(stateKey)) {
		const icons = MENUBAR_ICONS[app] as Record<string, string>
		const feedbacks = Object.entries(icons)
			.filter(([value]) => value !== 'stopped' && value !== 'activity')
			.map(([value, png]) => whenIs(stateKey, value, [set('icon', 'base64Image', png)]))
		if (app === 'bridge' && has('bridge.activity'))
			feedbacks.push(whenOn('bridge.activity', [set('icon', 'base64Image', icons.activity)]))
		add(
			'menubar',
			layered(
				`${APP_NAME[app]} menu-bar icon (opens the app)`,
				[
					box('bg', PALETTE.window),
					image('icon', icons.stopped, { x: 12, y: 4, w: 76, h: 60 }),
					text('state', expr(variable(stateKey)), { x: 0, y: 68, w: 100, h: 30 }),
				],
				feedbacks,
				openApp,
			),
		)
	}

	// Run: the app's name over a ring that fills green, and says RUNNING, while the app runs.
	if (control(`${app}.run`) && has(`${app}.running`)) {
		const ring = { x: 18, y: 30, w: 64, h: 64 }
		add(
			'run',
			layered(
				`${APP_NAME[app]}: Run`,
				[
					box('bg', PALETTE.window),
					text('name', RUN_NAME[app], { x: 0, y: 2, w: 100, h: 26 }, { weight: 'bold' }),
					{
						type: 'circle',
						id: 'ring',
						...at(ring),
						color: PALETTE.control,
						borderWidth: 4,
						borderColor: PALETTE.textMuted,
					},
					// sized for RUNNING, the longer of the two words it carries (#54)
					text('label', 'RUN', ring, { fontsize: fitSize('RUNNING', ring.h), weight: 'bold' }),
				],
				[
					whenOn(`${app}.running`, [
						set('ring', 'color', PALETTE.good),
						set('ring', 'borderColor', PALETTE.good),
						set('label', 'color', PALETTE.ink),
						set('label', 'text', 'RUNNING'),
					]),
				],
				press(actionId(`${app}.run`), { mode: 'toggle' }),
			),
		)
	}

	// A level meter: the app's own colour, with the threshold marked where there is one.
	const levelKey = `${app}.level_db`
	const meter = app === 'tlt' || app === 'ptt' || app === 'tct' ? METER[app] : null
	if (meter && has(levelKey)) {
		const level = variable(levelKey)
		const value = `isNumber(${level}) ? ${level} : ${DB_MIN}`
		const stops = (color: number): Json[] => [{ value: DB_MIN, color, gradient: false }]
		const elements: Json[] = [
			box('bg', PALETTE.window),
			text('title', METER_TITLE[app] ?? 'LEVEL', { x: 0, y: 2, w: 100, h: 24 }),
			{
				type: 'gauge',
				id: 'meter',
				...at({ x: 8, y: 36, w: 84, h: 22 }),
				orientation: 'horizontal',
				min: DB_MIN,
				max: DB_MAX,
				value: expr(value),
				fillEnabled: true,
				roundedEnds: true,
				trackStyle: 'dimmed',
				stops: stops(meter.base),
			},
			// concat(), not +: Companion's + adds numbers unless string joining is on, so -53 + ' dB' is NaN.
			text(
				'db',
				expr(`isNumber(${level}) ? concat(round(${level}), ' dB') : '--'`),
				{ x: 0, y: 66, w: 100, h: 32 },
				{ font: 'companion-mono' },
			),
		]
		const thresholdKey = `${app}.threshold_db`
		if (has(thresholdKey)) {
			const x = `8 + 84 * (min(max(${variable(thresholdKey)}, ${DB_MIN}), ${DB_MAX}) - ${DB_MIN}) / ${DB_MAX - DB_MIN}`
			elements.push({
				type: 'line',
				id: 'threshold',
				fromX: expr(x),
				toX: expr(x),
				fromY: 30,
				toY: 64,
				borderWidth: 2,
				borderColor: PALETTE.amber,
			})
		}
		const feedbacks = has(meter.states.key)
			? Object.entries(meter.states.colours).map(([value, color]) =>
					whenIs(meter.states.key, value, [set('meter', 'stops', stops(color))]),
				)
			: []
		add(
			'meter',
			layered(`${APP_NAME[app]}: ${(METER_TITLE[app] ?? 'level').toLowerCase()} level`, elements, feedbacks, []),
		)
	}

	// Pilot Tone: the failback segmented control and the status tile, in the app's colours.
	if (app === 'ptt' && control('ptt.failback_mode') && has('ptt.failback_mode')) {
		const pill = (mode: 'auto' | 'latch', caption: string, lit: number): Preset =>
			layered(
				`Pilot Tone: failback ${caption}`,
				[
					box('bg', PALETTE.window),
					box('pill', PALETTE.control, { x: 6, y: 24, w: 88, h: 52 }, { cornerRadius: 14 }),
					text('label', caption, { x: 6, y: 24, w: 88, h: 52 }, { fontsize: 60, weight: 'bold' }),
				],
				[whenIs('ptt.failback_mode', mode, [set('pill', 'color', lit), set('label', 'color', PALETTE.white)])],
				press(actionId('ptt.failback_mode'), { value: mode }),
			)
		add('auto', pill('auto', 'Auto', PALETTE.accent))
		add('latch', pill('latch', 'Latch', PALETTE.amber))
	}
	if (app === 'ptt' && has('ptt.state')) {
		const states = Object.entries(PTT_TILE).filter(([s]) => s !== 'stopped') as [string, (typeof PTT_TILE)['ok']][]
		add(
			'status',
			layered(
				'Pilot Tone: status tile (opens the app)',
				[
					box('tile', PTT_TILE.stopped.fill, FULL, { cornerRadius: 10 }),
					{ type: 'circle', id: 'dot', ...at({ x: 10, y: 10, w: 14, h: 14 }), color: PTT_TILE.stopped.text },
					text(
						'label',
						PTT_TILE.stopped.label,
						{ x: 6, y: 28, w: 88, h: 60 },
						{ fontsize: 44, weight: 'bold', color: PTT_TILE.stopped.text },
					),
				],
				states.map(([state, look]) =>
					whenIs('ptt.state', state, [
						set('tile', 'color', look.fill),
						set('dot', 'color', look.text),
						set('label', 'color', look.text),
						set('label', 'text', look.label),
					]),
				),
				openApp,
			),
		)
	}

	// Console Control: its status bar as tiles — timecode, transport, mode and output.
	if (app === 'cxc') {
		if (has('cxc.timecode')) {
			const tc = variable('cxc.timecode')
			add(
				'timecode',
				layered(
					'Console Control: timecode',
					[
						box('bg', KEY.tile),
						// HH:MM over SS:FF, so the digits can be big
						text('tc', expr(`concat(substr(${tc}, 0, 5), '\\n', substr(${tc}, 6))`), FULL, {
							font: 'companion-mono',
							fontsize: 36,
							color: PALETTE.white,
						}),
					],
					[],
					[],
				),
			)
		}
		const status = (key: string, caption: string, colours: Record<string, number>): void => {
			if (!has(key)) return
			add(
				key.slice('cxc.'.length),
				layered(
					`Console Control: ${caption.toLowerCase()}`,
					[
						box('bg', KEY.tile),
						text('caption', caption, CAPTION, { fontsize: fitSize(caption, CAPTION.h), color: PALETTE.textSecondary }),
						text('value', expr(variable(key)), VALUE, {
							fontsize: fitSize('recording', VALUE.h),
							color: PALETTE.white,
						}),
					],
					Object.entries(colours).map(([value, color]) => whenIs(key, value, [set('bg', 'color', color)])),
					[],
				),
			)
		}
		status('cxc.transport', 'TRANSPORT', { playing: KEY.on, armed: KEY.attention, recording: KEY.alarm })
		status('cxc.mode', 'MODE', { show: KEY.attention })
		status('cxc.output', 'OUTPUT', { armed: KEY.on, shadow: KEY.attention, offline: KEY.alarm })
	}

	return {
		section: {
			id: `look_${app}`,
			name: `${cat?.name ?? APP_NAME[app]}: styled keys`,
			definitions: Object.keys(presets),
		},
		presets,
	}
}
