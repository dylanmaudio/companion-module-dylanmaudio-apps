import type { SomeCompanionConfigField } from '@companion-module/base'
import type { PreampGainRange } from './protocol/levels.js'
import type { SyncScope } from './link-api.js'
import { describeImport, readImport } from './showfile/upload.js'
import { APP_IDS, CONTROL_APPS, isAppId, type AppId } from './control/registry.js'
import {
	clampTalkFlashCooldown,
	clampTalkFlashHz,
	TALK_FLASH_DEFAULT_COOLDOWN_S,
	TALK_FLASH_DEFAULT_HZ,
	TALK_FLASH_DEFAULT_PAGE,
	TALK_FLASH_MAX_COOLDOWN_S,
	TALK_FLASH_MAX_HZ,
	TALK_FLASH_MIN_HZ,
} from './control/talkflash.js'

export type ModuleConfig = {
	/**
	 * Which dylanmaudio app this connection controls (brief-companion-control
	 * §3: one module, one connection per app). `bridge` is the dLive console
	 * through MIDI Bridge — everything this module did before the others
	 * existed. Every other app is driven from the catalogue it publishes.
	 */
	app: AppId
	/** control endpoint of a non-bridge app — loopback by default */
	ctlHost: string
	/** 0 = the app's registered port (control/registry.ts) */
	ctlPort: number
	/** Talk Light only: the TALK page's blink rate, capped at 3 Hz */
	talkFlashHz: number
	/** Talk Light only: after EXIT, how long a new talk leaves the decks alone */
	talkFlashCooldownS: number
	/** Talk Light only: the page the TALK page was imported to, 0 = off — the triggers read it as $(tlt:talk_page) */
	talkFlashPage: number
	bridgeHost: string
	bridgePort: number
	/** The bridge app's own /ctl/v1 endpoint, on bridgeHost. 0 = its standard 8770 */
	bridgeCtlPort: number
	/** Not a form field: each app's last catalogue, so its buttons stay defined while it is down (JSON) */
	ctlCatalogue: string
	bridgeCtlCatalogue: string
	baseChannel: number
	firmware: string
	syncScope: SyncScope
	inputs: number
	extendedTypes: boolean
	goCc: number
	goValue: number
	nextCc: number
	nextValue: number
	prevCc: number
	prevValue: number
	actionsMap: string
	showFile: string
	/**
	 * Scene names and Actions imported from an uploaded show, as JSON — see
	 * `showfile/upload.ts`. Written by the module's own upload page, never
	 * shown as an editable field.
	 */
	showImport: string
	sceneNames: string
	sendsInDb: boolean
	preampGainRange: PreampGainRange
	debugEvents: boolean
}

export const DEFAULT_CONFIG: ModuleConfig = {
	app: 'bridge',
	ctlHost: '127.0.0.1',
	ctlPort: 0,
	talkFlashHz: TALK_FLASH_DEFAULT_HZ,
	talkFlashCooldownS: TALK_FLASH_DEFAULT_COOLDOWN_S,
	talkFlashPage: TALK_FLASH_DEFAULT_PAGE,
	bridgeHost: '127.0.0.1',
	bridgePort: 8765,
	bridgeCtlPort: 0,
	ctlCatalogue: '',
	bridgeCtlCatalogue: '',
	baseChannel: 12,
	firmware: '',
	syncScope: 'names_state',
	inputs: 128,
	extendedTypes: true,
	goCc: 0,
	goValue: 0,
	nextCc: 0,
	nextValue: 0,
	prevCc: 0,
	prevValue: 0,
	actionsMap: '',
	showFile: '',
	showImport: '',
	sceneNames: '',
	sendsInDb: true,
	preampGainRange: 'spec',
	debugEvents: false,
}

/**
 * Tokens live in Companion's secrets store, not the config: its web UI is
 * sent the whole config, but only the keys of the secrets. Both stay empty
 * while the apps take connections from their own Mac only. They are for the
 * network access the apps will grow (#106).
 */
export type ModuleSecrets = {
	/** The MIDI Bridge's Client API, and its app control endpoint */
	bridgeToken: string
	/** A non-bridge app's control endpoint */
	ctlToken: string
}

export const DEFAULT_SECRETS: ModuleSecrets = { bridgeToken: '', ctlToken: '' }

export function normaliseSecrets(raw: Partial<ModuleSecrets> | null | undefined): ModuleSecrets {
	const s = { ...DEFAULT_SECRETS, ...(raw ?? {}) }
	// a pasted token often brings a space or a newline with it
	for (const k of ['bridgeToken', 'ctlToken'] as const) s[k] = typeof s[k] === 'string' ? s[k].trim() : ''
	return s
}

export function normaliseConfig(raw: Partial<ModuleConfig> | null | undefined): ModuleConfig {
	const c = { ...DEFAULT_CONFIG, ...(raw ?? {}) }
	if (!isAppId(c.app)) c.app = 'bridge'
	if (!c.ctlHost) c.ctlHost = '127.0.0.1'
	c.ctlPort = clampInt(c.ctlPort, 0, 65535, 0)
	c.talkFlashHz = clampTalkFlashHz(c.talkFlashHz)
	c.talkFlashCooldownS = clampTalkFlashCooldown(c.talkFlashCooldownS)
	c.talkFlashPage = clampInt(c.talkFlashPage, 0, 999, TALK_FLASH_DEFAULT_PAGE)
	if (!c.bridgeHost) c.bridgeHost = '127.0.0.1'
	c.bridgePort = clampInt(c.bridgePort, 1, 65535, 8765)
	c.bridgeCtlPort = clampInt(c.bridgeCtlPort, 0, 65535, 0)
	if (typeof c.ctlCatalogue !== 'string') c.ctlCatalogue = ''
	if (typeof c.bridgeCtlCatalogue !== 'string') c.bridgeCtlCatalogue = ''
	c.baseChannel = clampInt(c.baseChannel, 1, 12, 12)
	c.inputs = clampInt(c.inputs, 1, 128, 128)
	for (const k of ['goCc', 'goValue', 'nextCc', 'nextValue', 'prevCc', 'prevValue'] as const)
		c[k] = clampInt(c[k], 0, 127, 0)
	if (c.preampGainRange !== 'spec' && c.preampGainRange !== 'legacy') c.preampGainRange = 'spec'
	// A stored import is NOT silently dropped when it will not parse. Losing scene
	// names without a word is the worst outcome here — the operator finds out on
	// a show day — so the value is kept and reloadShowFile() reports it instead.
	// Only absurd sizes are refused: 500 scenes and a full Actions table is ~15 kB.
	if (typeof c.showImport !== 'string' || c.showImport.length > 512 * 1024) c.showImport = ''
	if (!['names', 'names_state', 'all', 'none'].includes(c.syncScope)) c.syncScope = 'names_state'
	return c
}

function clampInt(v: unknown, min: number, max: number, dflt: number): number {
	const n = typeof v === 'number' ? v : Number(v)
	if (!Number.isFinite(n)) return dflt
	return Math.max(min, Math.min(max, Math.round(n)))
}

export interface ConfigFieldContext {
	/** Connection label — the module's HTTP endpoint is addressed by it */
	label?: string
	/** Current value of showImport, so the form can say what is loaded */
	showImport?: string
}

/** Shown only for the MIDI Bridge (dLive) app type. */
const BRIDGE_ONLY = "$(options:app) == 'bridge'"
/** Shown only for the other apps. */
const CONTROL_ONLY = "$(options:app) != 'bridge'"
/** Shown only for Talk Light Trigger. */
const TLT_ONLY = "$(options:app) == 'tlt'"

export function GetConfigFields(ctx: ConfigFieldContext = {}): SomeCompanionConfigField[] {
	const appField: SomeCompanionConfigField = {
		type: 'dropdown',
		id: 'app',
		label: 'App',
		tooltip: 'Which dylanmaudio app this connection controls. Add one connection per app.',
		width: 12,
		default: 'bridge',
		choices: APP_IDS.map((id) => ({
			id,
			label: id === 'bridge' ? 'MIDI Bridge — the dLive console, with full feedback' : CONTROL_APPS[id].name,
		})),
	}
	const controlFields: SomeCompanionConfigField[] = [
		{
			type: 'static-text',
			id: 'infoControl',
			width: 12,
			label: 'App control',
			value:
				"This connection controls the app's own buttons and switches, and shows its state. They are built from what the app reports, so a new feature in the app appears here without updating this module. The app must be running on this Mac with <b>Allow Companion control</b> on.",
			isVisibleExpression: CONTROL_ONLY,
		},
		{
			type: 'textinput',
			id: 'ctlHost',
			label: 'App address',
			tooltip: 'The apps accept connections from this Mac only, for now.',
			width: 8,
			default: '127.0.0.1',
			isVisibleExpression: CONTROL_ONLY,
		},
		{
			type: 'number',
			id: 'ctlPort',
			label: 'Port (0 = standard)',
			tooltip: `0 uses the app's standard port: ${APP_IDS.filter((id) => id !== 'bridge')
				.map((id) => `${CONTROL_APPS[id].name} ${CONTROL_APPS[id].port}`)
				.join(', ')}.`,
			width: 4,
			min: 0,
			max: 65535,
			default: 0,
			isVisibleExpression: CONTROL_ONLY,
		},
		{
			type: 'secret-text',
			id: 'ctlToken',
			label: 'App token',
			tooltip:
				'Leave this empty. The apps accept connections from their own Mac only, for now; the field is here for the LAN access they will grow, which will show a token to paste in.',
			width: 12,
			default: '',
			isVisibleExpression: CONTROL_ONLY,
		},
		{
			type: 'static-text',
			id: 'infoTalkFlash',
			width: 12,
			label: 'Talk flash',
			value:
				"While Talk Light reports talk, every Stream Deck can jump to a TALK page whose keys blink. EXIT on a deck sends it back, and holds off the next takeover for the cooldown. The page and its two triggers import from the file linked in this module's help.",
			isVisibleExpression: TLT_ONLY,
		},
		{
			type: 'number',
			id: 'talkFlashHz',
			label: `Blink rate (Hz, max ${TALK_FLASH_MAX_HZ})`,
			tooltip: `Capped at ${TALK_FLASH_MAX_HZ} Hz, the photosensitivity guidance's limit of three flashes a second.`,
			width: 6,
			min: TALK_FLASH_MIN_HZ,
			max: TALK_FLASH_MAX_HZ,
			step: 0.5,
			default: TALK_FLASH_DEFAULT_HZ,
			isVisibleExpression: TLT_ONLY,
		},
		{
			type: 'number',
			id: 'talkFlashCooldownS',
			label: 'Cooldown after EXIT (s)',
			tooltip: 'A new talk within this time does not take the decks over again. 0 = never hold off.',
			width: 6,
			min: 0,
			max: TALK_FLASH_MAX_COOLDOWN_S,
			step: 1,
			default: TALK_FLASH_DEFAULT_COOLDOWN_S,
			isVisibleExpression: TLT_ONLY,
		},
		{
			type: 'number',
			id: 'talkFlashPage',
			label: 'TALK page number (0 = off)',
			tooltip:
				'The page you imported the TALK page to. The two triggers read it as $(tlt:talk_page), so the page can live anywhere. While it is 0, talk still flashes any TALK keys but never switches a deck.',
			width: 6,
			min: 0,
			max: 999,
			step: 1,
			default: TALK_FLASH_DEFAULT_PAGE,
			isVisibleExpression: TLT_ONLY,
		},
	]
	return [appField, ...controlFields, ...bridgeFields(ctx).map((f) => ({ ...f, isVisibleExpression: BRIDGE_ONLY }))]
}

function bridgeFields(ctx: ConfigFieldContext): SomeCompanionConfigField[] {
	return [
		{
			type: 'static-text',
			id: 'info',
			width: 12,
			label: 'dLive MIDI Bridge',
			value:
				'This module talks to the <b>dLive MIDI Bridge</b> application, which owns the connection to the console. Set the console address, base MIDI channel and reconnect behaviour <b>in the bridge</b> — this module inherits them. Status goes green only once the bridge reports its console link is up.',
		},
		{
			type: 'textinput',
			id: 'bridgeHost',
			label: 'MIDI Bridge address',
			tooltip: '127.0.0.1 when Companion runs on the same machine as the bridge.',
			width: 8,
			default: '127.0.0.1',
		},
		{ type: 'number', id: 'bridgePort', label: 'Bridge port', width: 4, min: 1, max: 65535, default: 8765 },
		{
			type: 'number',
			id: 'bridgeCtlPort',
			label: 'Bridge app control port (0 = 8770)',
			tooltip:
				"The MIDI Bridge app's own controls — Run, Restart, Auto-reconnect — on the address above. Needs MIDI Bridge 1.1.9 or later; an older bridge just doesn't offer them.",
			width: 4,
			min: 0,
			max: 65535,
			default: 0,
		},
		{
			type: 'secret-text',
			id: 'bridgeToken',
			label: 'Bridge token',
			tooltip:
				'Leave this empty. The bridge listens on its own Mac only; the field is here for the LAN access it will grow later, which will show a token to paste in. It goes to the bridge app control port too.',
			width: 12,
			default: '',
		},
		{
			type: 'textinput',
			id: 'firmware',
			label: 'Console firmware',
			tooltip: 'Not detectable over MIDI. Recorded in the $(dlive:firmware) variable and used in the support log.',
			width: 6,
			default: '',
		},
		{
			type: 'number',
			id: 'inputs',
			label: 'Inputs in use',
			tooltip: 'Bounds the variable grid and the preset library. 128 is the full desk.',
			width: 6,
			min: 1,
			max: 128,
			default: 128,
		},
		{
			type: 'checkbox',
			id: 'extendedTypes',
			label: 'Groups, auxes, matrices, FX & UFX too',
			tooltip: 'Declare variables and presets for every channel type, not only inputs, mains, DCAs and mute groups.',
			width: 12,
			default: true,
		},
		{
			type: 'dropdown',
			id: 'syncScope',
			label: 'Ask the console for',
			tooltip:
				'On connect, and when you press Resync, the bridge fetches this much for every strip. The desk announces only what changes, so without it a connection made mid-show shows nothing until someone moves something.',
			width: 12,
			default: 'names_state',
			choices: [
				{ id: 'names', label: 'Names and colours' },
				{ id: 'names_state', label: 'Names, colours, mutes and levels' },
				{ id: 'all', label: 'Everything the bridge can fetch' },
				{ id: 'none', label: 'Nothing — wait for the desk to announce a change' },
			],
		},
		{
			type: 'static-text',
			id: 'infoScene',
			width: 12,
			label: 'Scene Go / Next / Previous',
			value:
				'These are user-assigned CC messages on the console (Utility → Control → MIDI → Scene control). Enter the control number and value you chose there; 0/0 means "not assigned".',
		},
		{ type: 'number', id: 'goCc', label: 'Go — CC', width: 2, min: 0, max: 127, default: 0 },
		{ type: 'number', id: 'goValue', label: 'Go — value', width: 2, min: 0, max: 127, default: 0 },
		{ type: 'number', id: 'nextCc', label: 'Next — CC', width: 2, min: 0, max: 127, default: 0 },
		{ type: 'number', id: 'nextValue', label: 'Next — value', width: 2, min: 0, max: 127, default: 0 },
		{ type: 'number', id: 'prevCc', label: 'Previous — CC', width: 2, min: 0, max: 127, default: 0 },
		{ type: 'number', id: 'prevValue', label: 'Previous — value', width: 2, min: 0, max: 127, default: 0 },
		{
			type: 'textinput',
			id: 'actionsMap',
			label: 'Console Actions map',
			tooltip:
				'One per line: <control number>,<value>,<name>. Optional when a firmware 2.1x show file is loaded — Actions import from it automatically. Manual lines win on the same CC/value.',
			width: 12,
			multiline: true,
			default: '',
		},
		{
			type: 'static-text',
			id: 'infoShow',
			width: 12,
			label: 'Show file',
			value: showFileBlurb(ctx),
		},
		{
			type: 'textinput',
			id: 'showFile',
			label: 'Show file path (advanced)',
			tooltip:
				'Usually leave this empty and use the show file page above. Companion runs this module sandboxed to its own folder, so a path elsewhere on the disk normally cannot be read. An uploaded show takes precedence over this.',
			width: 12,
			default: '',
		},
		{
			type: 'textinput',
			id: 'sceneNames',
			label: 'Scene names (manual)',
			tooltip: 'One per line: <scene number>,<name>. Overrides the show file.',
			width: 12,
			multiline: true,
			default: '',
		},
		{
			type: 'checkbox',
			id: 'sendsInDb',
			label: 'Show send levels in dB',
			tooltip:
				'The send level ↔ dB law was measured on firmware 2.12 (September 2026) and matches the fader law at every one of its 128 steps, so these dB values are exact. Turn off to see the raw 0–127 value instead.',
			width: 6,
			default: false,
		},
		{
			type: 'dropdown',
			id: 'preampGainRange',
			label: 'Preamp gain range',
			tooltip: 'Sources disagree on the preamp gain scale. Pick the one that matches what your screen shows.',
			width: 6,
			default: 'spec',
			choices: [
				{ id: 'spec', label: '+5 … +60 dB (V2.0 spec)' },
				{ id: 'legacy', label: '−10 … +50 dB (legacy module)' },
			],
		},
		{ type: 'checkbox', id: 'debugEvents', label: 'Log every decoded event (debug)', width: 12, default: false },
	]
}

/** The show-file paragraph: what is loaded, and a link to the page that loads it. */
function showFileBlurb(ctx: ConfigFieldContext): string {
	const link = ctx.label
		? `<a href="/instance/${encodeURIComponent(ctx.label)}/" target="_blank" rel="noopener">show file page</a>`
		: 'show file page'
	const raw = ctx.showImport ?? ''
	const loaded = describeImport(readImport(raw))
	if (loaded) return `Loaded: <b>${loaded}</b>. Open the ${link} to replace or remove it.`
	if (raw)
		return `<b>The stored show could not be read</b>, so its scene names and Actions are missing. Open the ${link} and load the show again.`
	return `Scene names exist only in the show file — the protocol has no way to ask the console for them, and firmware 2.1x shows also carry the named Actions table. Open the ${link} to load one.`
}

export interface ActionMapEntry {
	cc: number
	value: number
	name: string
}

/** "20,1,Band 2 changeover" per line → entries. Bad lines are reported, not fatal. */
export function parseActionsMap(text: string): { entries: ActionMapEntry[]; errors: string[] } {
	const entries: ActionMapEntry[] = []
	const errors: string[] = []
	for (const raw of (text ?? '').split(/\r?\n/)) {
		const line = raw.trim()
		if (!line || line.startsWith('#')) continue
		const m = /^(\d{1,3})\s*[,;\t]\s*(\d{1,3})\s*[,;\t]\s*(.+)$/.exec(line)
		if (!m) {
			errors.push(`"${line}" — expected <cc>,<value>,<name>`)
			continue
		}
		const cc = Number(m[1])
		const value = Number(m[2])
		if (cc > 127 || value > 127) {
			errors.push(`"${line}" — CC and value must be 0–127`)
			continue
		}
		entries.push({ cc, value, name: m[3].trim() })
	}
	return { entries, errors }
}

/** "129,Intro" per line → map. */
export function parseSceneNames(text: string): { names: Map<number, string>; errors: string[] } {
	const names = new Map<number, string>()
	const errors: string[] = []
	for (const raw of (text ?? '').split(/\r?\n/)) {
		const line = raw.trim()
		if (!line || line.startsWith('#')) continue
		const m = /^(\d{1,3})\s*[,;\t]\s*(.+)$/.exec(line)
		if (!m) {
			errors.push(`"${line}" — expected <scene>,<name>`)
			continue
		}
		const scene = Number(m[1])
		if (scene < 1 || scene > 500) {
			errors.push(`"${line}" — scene must be 1–500`)
			continue
		}
		names.set(scene, m[2].trim())
	}
	return { names, errors }
}
