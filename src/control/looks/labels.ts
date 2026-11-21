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
	bridge: 'Console Bridge',
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

/**
 * A mark a key can carry above its word. Companion draws button text in its
 * own font stack — Companion-sans, then Noto Sans Symbols 1-3, Noto Music,
 * and colour emoji last — so a mark is text, not an image: it costs no bytes
 * and a feedback recolours it like any label.
 *
 * Two rules decided this list, both from drawing it rather than reasoning
 * about it (tools/glyph-check.mjs renders each one through Companion's own
 * canvas and fonts):
 *
 * - Nothing here may fall through to the emoji font. An emoji is drawn in its
 *   own colours and ignores the element's, so a feedback could not light it —
 *   which rules out the bell and the microphone, whatever they would have
 *   suited.
 * - `scale` is not decoration. The fonts disagree about how big a glyph is at
 *   a given size: ■ comes out small and ◆ large, so each is nudged until the
 *   set looks like one set.
 */
export interface Mark {
	char: string
	/** multiplies the mark's height; 1 is 42% of the key */
	scale?: number
}

export const GLYPH = {
	record: { char: '\u23FA' },
	play: { char: '\u25B6' },
	stop: { char: '\u25A0', scale: 1.2 },
	toStart: { char: '\u23EE', scale: 1.05 },
	prev: { char: '\u23EA', scale: 1.1 },
	next: { char: '\u23E9', scale: 1.1 },
	marker: { char: '\u25C6', scale: 0.8 },
	mute: { char: '\u{1F507}', scale: 0.85 },
	lock: { char: '\u{1F512}' },
	unlock: { char: '\u{1F513}' },
	warning: { char: '\u26A0', scale: 1.15 },
	reset: { char: '\u27F2', scale: 1.2 },
	loop: { char: '\u21BB', scale: 1.25 },
	undo: { char: '\u21B6', scale: 1.35 },
	redo: { char: '\u21B7', scale: 1.35 },
} as const satisfies Record<string, Mark>

export interface KeyLook {
	text: string
	/** the key's colour, where its menu's tint won't do */
	bg?: number
	/** its colour while its own state is on, or its option chosen */
	on?: number
	lit?: Light[]
	/**
	 * The mark above the word. Verbs get one — what the key does is a shape
	 * an operator reads faster than a label. Nouns don't: a name, a value or
	 * a mode is a word, and marking everything would leave the transport
	 * nothing to stand out against.
	 */
	glyph?: Mark
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
	// #705: the window as a switch, lit while it is open
	...(['bridge', 'tlt', 'ptt', 'tct', 'cxc', 'sr'] as const).map((app): [string, KeyLook] => [
		`${app}.window`,
		{ text: `${RUN_NAME[app]}\nWINDOW` },
	]),

	['bridge.restart', { text: 'RESTART\nBRIDGE', glyph: GLYPH.reset }],
	['bridge.autoreconnect', { text: 'AUTO\nRECONNECT' }],

	['tlt.threshold', { text: 'THRESHOLD' }],

	['ptt.threshold', { text: 'THRESHOLD' }],
	['ptt.failback_mode=auto', { text: 'AUTO' }],
	// the app's own latch amber
	['ptt.failback_mode=latch', { text: 'LATCH', on: PALETTE.amber }],
	['ptt.reset', { text: 'RESET', glyph: GLYPH.reset }],
	['ptt.tone', { text: 'TONE\nGEN' }],
	['ptt.flip', { text: 'FLIP\nA/B' }],
	// a side that wasn't delivered within the late window (train 8a)
	['ptt.send_now', { text: 'SEND\nNOW' }],

	['tct.mode=read', { text: 'READ' }],
	['tct.mode=generate', { text: 'GENERATE' }],
	['tct.input=ltc', { text: 'LTC\nIN' }],
	['tct.input=mtc', { text: 'MTC\nIN' }],
	['tct.mtc_out', { text: 'MTC\nOUT' }],
	['tct.ltc_out', { text: 'LTC\nOUT' }],
	['tct.reset_counters', { text: 'RESET\nCOUNTERS', glyph: GLYPH.reset }],
	...Object.entries(RATES).map(([value, t]): [string, KeyLook] => [`tct.generate_rate=${value}`, { text: t }]),

	[
		'sr.record',
		{ text: 'REC', glyph: GLYPH.record, lit: [{ key: 'sr.transport', value: 'recording', bg: KEY.alarm }] },
	],
	['sr.stop', { text: 'STOP', glyph: GLYPH.stop }],
	['sr.play_stop', { text: 'PLAY', glyph: GLYPH.play, lit: [{ key: 'sr.transport', value: 'playing', bg: KEY.on }] }],
	['sr.start', { text: 'TO\nSTART', glyph: GLYPH.toStart }],
	['sr.marker', { text: 'ADD\nMARKER', glyph: GLYPH.marker }],
	['sr.go_marker', { text: 'GO TO\nMARKER' }],
	['sr.prev', { text: 'PREV\nMARKER', glyph: GLYPH.prev }],
	['sr.next', { text: 'NEXT\nMARKER', glyph: GLYPH.next }],
	['sr.reset_dropouts', { text: 'RESET\nDROPOUTS', glyph: GLYPH.reset }],
	// Its own state lights it, and a muted master output is a red key, never the
	// toggle's green. "MASTER OUT" on one line is wider than the key allows.
	['sr.master_out_mute', { text: 'MASTER\nMUTE', glyph: GLYPH.mute, on: KEY.alarm }],

	['cxc.play', { text: 'PLAY', glyph: GLYPH.play, lit: [{ key: TRANSPORT, value: 'playing', bg: KEY.on }] }],
	['cxc.stop', { text: 'STOP', glyph: GLYPH.stop }],
	['cxc.go-to-start', { text: 'TO\nSTART', glyph: GLYPH.toStart }],
	// Cue list mode (Console Control 0.3.0): GO and Back light while the show plays as a cue list.
	['cxc.go', { text: 'GO', lit: [{ key: 'cxc.playback_mode', value: 'cuelist', bg: KEY.on }] }],
	['cxc.go-back', { text: 'BACK', lit: [{ key: 'cxc.playback_mode', value: 'cuelist', bg: KEY.on }] }],
	['cxc.go-to', { text: 'JUMP\nTO' }],
	['cxc.standby-next', { text: 'STANDBY\nNEXT' }],
	['cxc.standby-prev', { text: 'STANDBY\nPREV' }],
	[
		'cxc.record',
		{
			text: 'REC',
			glyph: GLYPH.record,
			lit: [
				{ key: TRANSPORT, value: 'armed', bg: KEY.attention },
				{ key: TRANSPORT, value: 'recording', bg: KEY.alarm },
			],
		},
	],
	['cxc.toggle-mixer', { text: 'MIXER' }],
	['cxc.toggle-solo', { text: 'SOLO' }],
	['cxc.toggle-arm', { text: 'ARM\nTRACK' }],
	// its own state lights it, and a muted reference output is a red key, never the toggle's green
	['cxc.reference-out-mute', { text: 'REF OUT\nMUTE', glyph: GLYPH.mute, on: KEY.alarm }],
	[
		'cxc.conform-console',
		{ text: 'CONFORM\nCONSOLE', lit: [{ key: 'cxc.console_matches', bg: KEY.attention, invert: true }] },
	],
	['cxc.panic', { text: 'PANIC', glyph: GLYPH.warning, bg: KEY.alarm }],
	['cxc.toggle-chase', { text: 'CHASE', glyph: GLYPH.loop, lit: [{ key: 'cxc.chase', bg: KEY.on }] }],
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
	['cxc.add-marker', { text: 'ADD\nMARKER', glyph: GLYPH.marker }],
	['cxc.prev-marker', { text: 'PREV\nMARKER', glyph: GLYPH.prev }],
	['cxc.next-marker', { text: 'NEXT\nMARKER', glyph: GLYPH.next }],
	['cxc.toggle-grid', { text: 'GRID' }],
	['cxc.regions-from-audio', { text: 'CLIP\nREGIONS' }],
	['cxc.toggle-marker-list', { text: 'MARKER\nLIST' }],
	['cxc.add-region', { text: 'ADD\nREGION' }],
	['cxc.cycle-snap', { text: 'SNAP' }],
	['cxc.lock-track', { text: 'LOCK\nTRACK', glyph: GLYPH.lock }],
	['cxc.lock-all-tracks', { text: 'LOCK\nALL', glyph: GLYPH.lock }],
	['cxc.unlock-all-tracks', { text: 'UNLOCK\nALL', glyph: GLYPH.unlock }],
	['cxc.undo', { text: 'UNDO', glyph: GLYPH.undo }],
	['cxc.redo', { text: 'REDO', glyph: GLYPH.redo }],
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
