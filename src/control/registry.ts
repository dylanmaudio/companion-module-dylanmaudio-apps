/**
 * The dylanmaudio apps a connection can control, and where each listens.
 *
 * A copy of CONTROL_PORTS / APP_NAMES in the monorepo's shared/control_api.py
 * (brief-companion-control.md §2.5), which is the source. Each app binds
 * loopback on its fixed port, so a Companion on the same Mac finds it with
 * no discovery. LAN reach, with a token and Bonjour, is a later shared step.
 */
export const CONTROL_APPS = {
	bridge: { name: 'MIDI Bridge', port: 8770 },
	tlt: { name: 'Talk Light Trigger', port: 8771 },
	ptt: { name: 'Pilot Tone Trigger', port: 8772 },
	tct: { name: 'Time Code Tool', port: 8773 },
	cxc: { name: 'Console Control', port: 8774 },
	sr: { name: 'Show Recorder', port: 8775 },
} as const

export type AppId = keyof typeof CONTROL_APPS

export const APP_IDS = Object.keys(CONTROL_APPS) as AppId[]

export function isAppId(v: unknown): v is AppId {
	return typeof v === 'string' && Object.prototype.hasOwnProperty.call(CONTROL_APPS, v)
}

/** The `/ctl/v1/` API version this module speaks — `ctl` in /info. */
export const CTL_API_VERSION = 1
