/**
 * What the apps' keys say. A Stream Deck key holds about two short words, so
 * each control we know gets a label written for the key ("TO START"), and a
 * control an app adds later gets one made from its catalogue label. A look can
 * also light its key from state beyond the control's own: REC turns red while
 * Console Control records.
 */

import type { AppId } from '../registry.js'
import { KEY, PALETTE } from './palette.js'

export const APP_NAME: Record<AppId, string> = {
	bridge: 'MIDI Bridge',
	tlt: 'Talk Light',
	ptt: 'Pilot Tone',
	tct: 'Time Code',
	cxc: 'Console Control',
	sr: 'Show Recorder',
}

/** The app's name on its Run key: the logo alone is too small to tell apart on a deck. */
export const RUN_NAME: Record<AppId, string> = {
	bridge: 'BRIDGE',
	tlt: 'TALK',
	ptt: 'PILOT',
	tct: 'TIMECODE',
	cxc: 'CONSOLE',
	sr: 'RECORDER',
}

/** A state that lights a key: a bool key while on (off, inverted), or an enum key at a value. */
export interface Light {
	key: string
	value?: string
	bg: number
	invert?: boolean
}

export interface KeyLook {
	text: string
	/** the key's colour, where its menu's tint won't do */
	bg?: number
	/** its colour while its own state is on, or its option chosen */
	on?: number
	lit?: Light[]
}

const TRANSPORT = 'cxc.transport'
const RATES: Record<string, string> = {
	'23.976': '23.976\nFPS',
	'24': '24\nFPS',
	'25': '25\nFPS',
	'29.97df': '29.97\nDF',
	'29.97nd': '29.97\nND',
	'30': '30\nFPS',
}

const looks: [string, KeyLook][] = [
	...(['bridge', 'tlt', 'ptt', 'tct'] as const).map((app): [string, KeyLook] => [
		`${app}.run`,
		{ text: `${RUN_NAME[app]}\nRUN` },
	]),
	...(['bridge', 'tlt', 'ptt', 'tct', 'cxc', 'sr'] as const).map((app): [string, KeyLook] => [
		`${app}.show`,
		{ text: `SHOW\n${RUN_NAME[app]}` },
	]),

	['bridge.restart', { text: 'RESTART\nBRIDGE' }],
	['bridge.autoreconnect', { text: 'AUTO\nRECONNECT' }],

	['tlt.threshold', { text: 'THRESHOLD' }],

	['ptt.threshold', { text: 'THRESHOLD' }],
	['ptt.failback_mode=auto', { text: 'AUTO' }],
	// the app's own latch amber
	['ptt.failback_mode=latch', { text: 'LATCH', on: PALETTE.amber }],
	['ptt.reset', { text: 'RESET' }],
	['ptt.tone', { text: 'TONE\nGEN' }],
	['ptt.flip', { text: 'FLIP\nA/B' }],

	['tct.mode=read', { text: 'READ' }],
	['tct.mode=generate', { text: 'GENERATE' }],
	['tct.input=ltc', { text: 'LTC\nIN' }],
	['tct.input=mtc', { text: 'MTC\nIN' }],
	['tct.mtc_out', { text: 'MTC\nOUT' }],
	['tct.ltc_out', { text: 'LTC\nOUT' }],
	['tct.reset_counters', { text: 'RESET\nCOUNTERS' }],
	...Object.entries(RATES).map(([value, t]): [string, KeyLook] => [`tct.generate_rate=${value}`, { text: t }]),

	['sr.record', { text: 'REC', lit: [{ key: 'sr.transport', value: 'recording', bg: KEY.alarm }] }],
	['sr.stop', { text: 'STOP' }],
	['sr.play_stop', { text: 'PLAY', lit: [{ key: 'sr.transport', value: 'playing', bg: KEY.on }] }],
	['sr.start', { text: 'TO\nSTART' }],
	['sr.marker', { text: 'ADD\nMARKER' }],
	['sr.go_marker', { text: 'GO TO\nMARKER' }],
	['sr.prev', { text: 'PREV\nMARKER' }],
	['sr.next', { text: 'NEXT\nMARKER' }],
	['sr.reset_dropouts', { text: 'RESET\nDROPOUTS' }],

	['cxc.play', { text: 'PLAY', lit: [{ key: TRANSPORT, value: 'playing', bg: KEY.on }] }],
	['cxc.stop', { text: 'STOP' }],
	['cxc.go-to-start', { text: 'TO\nSTART' }],
	[
		'cxc.record',
		{
			text: 'REC',
			lit: [
				{ key: TRANSPORT, value: 'armed', bg: KEY.attention },
				{ key: TRANSPORT, value: 'recording', bg: KEY.alarm },
			],
		},
	],
	['cxc.toggle-mixer', { text: 'MIXER' }],
	['cxc.toggle-solo', { text: 'SOLO' }],
	['cxc.toggle-arm', { text: 'ARM\nTRACK' }],
	[
		'cxc.conform-console',
		{ text: 'CONFORM\nCONSOLE', lit: [{ key: 'cxc.console_matches', bg: KEY.attention, invert: true }] },
	],
	['cxc.panic', { text: 'PANIC', bg: KEY.alarm }],
	['cxc.toggle-chase', { text: 'CHASE', lit: [{ key: 'cxc.chase', bg: KEY.on }] }],
	['cxc.toggle-lane-chase', { text: 'LANE\nCHASE' }],
	['cxc.toggle-show-mode', { text: 'SHOW\nMODE', lit: [{ key: 'cxc.mode', value: 'show', bg: KEY.attention }] }],
	['cxc.insert-cue-unity', { text: 'CUE\nUNITY' }],
	['cxc.insert-cue-mute', { text: 'CUE\nMUTE' }],
	['cxc.insert-cue-neg-inf', { text: 'CUE\n-inf' }],
	['cxc.insert-cue-unmute', { text: 'CUE\nUNMUTE' }],
	['cxc.next-cue', { text: 'NEXT\nCUE' }],
	['cxc.prev-cue', { text: 'PREV\nCUE' }],
	['cxc.next-track', { text: 'NEXT\nTRACK' }],
	['cxc.prev-track', { text: 'PREV\nTRACK' }],
	['cxc.preflight', { text: 'PRE-\nFLIGHT' }],
	['cxc.copy-range', { text: 'COPY\nRANGE' }],
	['cxc.paste-range', { text: 'PASTE' }],
	['cxc.clear-selection', { text: 'CLEAR\nSEL' }],
	['cxc.delete-range', { text: 'DELETE\nRANGE' }],
	['cxc.nudge-left', { text: 'NUDGE\nLEFT' }],
	['cxc.nudge-right', { text: 'NUDGE\nRIGHT' }],
	['cxc.add-marker', { text: 'ADD\nMARKER' }],
	['cxc.prev-marker', { text: 'PREV\nMARKER' }],
	['cxc.next-marker', { text: 'NEXT\nMARKER' }],
	['cxc.toggle-grid', { text: 'GRID' }],
	['cxc.regions-from-audio', { text: 'CLIP\nREGIONS' }],
	['cxc.toggle-marker-list', { text: 'MARKER\nLIST' }],
	['cxc.add-region', { text: 'ADD\nREGION' }],
	['cxc.cycle-snap', { text: 'SNAP' }],
	['cxc.lock-track', { text: 'LOCK\nTRACK' }],
	['cxc.lock-all-tracks', { text: 'LOCK\nALL' }],
	['cxc.unlock-all-tracks', { text: 'UNLOCK\nALL' }],
	['cxc.undo', { text: 'UNDO' }],
	['cxc.redo', { text: 'REDO' }],
	['cxc.save', { text: 'SAVE', lit: [{ key: 'cxc.dirty', bg: KEY.attention }] }],
]

/** By control id, or `<id>=<value>` for one option of a choice. */
export const KEY_LOOKS: Record<string, KeyLook> = Object.fromEntries(looks)

/**
 * A key label from a catalogue label, for a control the table doesn't know:
 * the asides go ("Toggle", "(global)", "— fail back to primary"), and the
 * words split over two lines as evenly as they will.
 */
export function keyLabel(label: string): string {
	const words = label
		.replace(/\([^)]*\)/g, ' ')
		.split(/\s+[—–]\s+/)[0]
		.replace(/^\s*(toggle|show \/ hide|jump to)\s+/i, '')
		.replace(/[:…]/g, '')
		.trim()
		.toUpperCase()
		.split(/\s+/)
		.filter(Boolean)
	let best = words.join(' ')
	let widest = Infinity
	for (let i = 1; i < words.length; i++) {
		const lines = [words.slice(0, i).join(' '), words.slice(i).join(' ')]
		const width = Math.max(...lines.map((l) => l.length))
		if (width < widest) {
			widest = width
			best = lines.join('\n')
		}
	}
	return best
}
