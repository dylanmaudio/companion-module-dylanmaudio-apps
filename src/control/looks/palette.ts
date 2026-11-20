/**
 * The apps' own colours, so keys read like the popovers they mirror. From
 * the monorepo's shared/ui/design-system.css and each app's ui/app.css.
 * Gradients are flattened to their leading colour: a key is one fill.
 */

import type { AppId } from '../registry.js'
import type { Brand } from '../types.js'

const hex = (s: string): number => parseInt(s.replace('#', ''), 16)

export const PALETTE = {
	/** --bg-window */
	window: hex('#12121a'),
	/** --control-bg */
	control: hex('#1a1a26'),
	/** --text-secondary */
	textSecondary: hex('#b7b7c4'),
	/** --text-muted */
	textMuted: hex('#6b6b78'),
	/** --accent: the selected segment of a segmented control */
	accent: hex('#2e80f2'),
	/** --good */
	good: hex('#4ec972'),
	/** --amber: Pilot Tone's latched state */
	amber: hex('#e8a94a'),
	/** --red */
	red: hex('#e85c5c'),
	white: hex('#ffffff'),
	/** dark text on a lit shape */
	ink: hex('#12121a'),
} as const

/** Pilot Tone's status tile, per state (apps/pilot-tone-trigger/ui/app.css, app.js STATE_COPY). */
export const PTT_TILE = {
	stopped: { fill: hex('#1c1c28'), text: hex('#8a8a99'), label: 'Stopped' },
	ok: { fill: hex('#1c2a3f'), text: hex('#8fb3e0'), label: 'Signal Present' },
	lost: { fill: PALETTE.red, text: PALETTE.white, label: 'Signal Lost' },
	latched: { fill: PALETTE.amber, text: PALETTE.white, label: 'Restored — Latched' },
	/** the tile's violet: the level is fine, but the tone looks corrupted */
	degraded: { fill: hex('#a16ae8'), text: PALETTE.white, label: 'Signal Degraded' },
} as const

/**
 * The control presets: what a key's colour means when it lights, and each
 * app menu's tint (Console Control's groups). White text reads on them all.
 */
export const KEY = {
	/** a key outside any menu */
	base: hex('#262626'),
	/** a readout */
	tile: hex('#333333'),
	/** on, or going well: a toggle that's on, playing, chase */
	on: hex('#1f8f4e'),
	/** the chosen option: the app's selected segment */
	chosen: PALETTE.accent,
	/** needs a look: available, armed, unsaved, Show mode */
	attention: hex('#b36b00'),
	/** stop and look: recording, offline, Panic */
	alarm: hex('#b3261e'),
	/** the bar across a show-critical key */
	critical: PALETTE.red,
} as const

export const GROUP_TINT: Record<string, number> = {
	transport: hex('#14213d'),
	cue: hex('#173a2a'),
	navigate: hex('#1d2f4a'),
	markers: hex('#2d1f47'),
	edit: hex('#3a2a14'),
	audio: hex('#123636'),
	track: hex('#2b2340'),
	view: hex('#22303a'),
}

/** Level-meter fill per app and state, from each app's menu-bar ICON_COLOURS. */
export const METER = {
	tlt: { base: hex('#5c8fd6'), states: { key: 'tlt.talk', colours: { active: hex('#e8f0ff') } } },
	ptt: {
		base: hex('#5c8fd6'),
		states: {
			key: 'ptt.state',
			colours: { lost: hex('#e85c5c'), latched: hex('#e8a94a'), degraded: hex('#a16ae8') },
		},
	},
	tct: {
		base: hex('#3fb65c'),
		states: { key: 'tct.state', colours: { freewheel: hex('#e0a93f'), clip: hex('#e8503f') } },
	},
} as const

/**
 * Each app's own colour, in the shape `/ctl/v1/info` reports it. This table
 * is the fallback, not the source: `brandOf` prefers what the app says, and
 * only an app too old to report a `brand` block lands here. Kept honest by
 * brand.test.ts, which holds it against every fixtures/control file — the
 * same files the monorepo's shared/tests/test_brand.py checks against the
 * stylesheets, so a re-pick that reaches the apps cannot sit stale here.
 */
export const APP_BRAND: Record<AppId, Brand> = {
	bridge: { main: { bg: '#4db0ec', text: '#1c1a14' }, deep: { bg: '#3090c7', text: '#1c1a14' } },
	tlt: { main: { bg: '#edd473', text: '#1c1a14' }, deep: { bg: '#cbaa51', text: '#1c1a14' } },
	ptt: { main: { bg: '#0b8ba2', text: '#ffffff' }, deep: { bg: '#035260', text: '#ffffff' } },
	tct: { main: { bg: '#9d5bf4', text: '#ffffff' }, deep: { bg: '#5a368d', text: '#ffffff' } },
	cxc: { main: { bg: '#2e80f2', text: '#ffffff' }, deep: { bg: '#214a8f', text: '#ffffff' } },
	sr: { main: { bg: '#ea3c43', text: '#ffffff' }, deep: { bg: '#882529', text: '#ffffff' } },
}

/** A swatch as Companion wants it: two 24-bit numbers. */
export interface Swatch {
	bg: number
	text: number
}
export interface BrandColours {
	main: Swatch
	deep: Swatch
}

const HEX6 = /^#[0-9a-f]{6}$/i

/**
 * The app's colour for a key. The app's own `brand` wins; anything it leaves
 * out, or writes in a shape that is not `#rrggbb`, falls back to APP_BRAND
 * value by value — a connection should not lose its identity key to one bad
 * string from a process this module does not own.
 *
 * Which of the two to paint is settled by contrast, not taste. Measured
 * (brand.test.ts does it again on every run): the text on `main` reaches
 * only 3.8:1 for Console Control and about 4.0:1 for Pilot Tone, Time Code
 * and Show Recorder — enough for the large semibold titles their UIs put
 * there, short of the 4.5:1 AA needs for small text. A Companion key is
 * small and not bold, so a key paints `deep`, which is 4.9:1 or better for
 * every app.
 */
export function brandOf(app: AppId, reported?: Brand | null): BrandColours {
	const fallback = APP_BRAND[app]
	const swatch = (which: 'main' | 'deep'): Swatch => {
		const said = reported?.[which]
		const pick = (field: 'bg' | 'text'): number => {
			const v = said?.[field]
			return hex(typeof v === 'string' && HEX6.test(v) ? v : fallback[which][field])
		}
		return { bg: pick('bg'), text: pick('text') }
	}
	return { main: swatch('main'), deep: swatch('deep') }
}
