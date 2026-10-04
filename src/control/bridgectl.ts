/**
 * The MIDI Bridge app's own controls and state, inside the MIDI Bridge
 * connection (brief-companion-control.md §3).
 *
 * The console side of that connection talks to the bridge core's Client API
 * (BridgeLink, :8765). The core is a subprocess of the menu-bar app and can't
 * start or stop itself, so Run, Restart and Auto-reconnect belong to the app
 * shell's `/ctl/v1/` endpoint (:8770), which stays up while the core is
 * stopped. This is the client for that second endpoint. Its definitions are
 * built from the bridge's catalogue and merged into the connection's own.
 * Its variables keep the `bridge_` prefix, because a bare `state` or
 * `version` beside the console's variables would be ambiguous.
 *
 * A bridge older than 1.1.9 has no control endpoint. That is not an error:
 * the console side works as before, and this says so once in the log.
 */

import { EventEmitter } from 'node:events'
import type { CompanionVariableValues, InstanceBase, LogLevel } from '@companion-module/base'
import type { ModuleSchema } from '../main.js'
import { hostPort } from '../util/net.js'
import { ControlClient, type ControlStatus } from './client.js'
import {
	buildControlActions,
	buildControlFeedbacks,
	buildControlPresets,
	buildControlVariables,
	controlVariableValues,
	feedbackIdsForKey,
	prefixedNaming,
} from './definitions.js'
import { buildLookPresets } from './looks/looks.js'
import { openAppActions, type OpenAppContext } from './openapp.js'
import { CONTROL_APPS } from './registry.js'
import type { Catalogue, CmdValue, StateValue } from './types.js'

export const BRIDGE_APP_VARIABLES: Record<string, string> = {
	bridge_app_connected: 'MIDI Bridge app control is connected',
	bridge_app_allowed: 'Companion control is allowed in the MIDI Bridge app',
	bridge_app_locked: 'Show-critical controls are locked in the MIDI Bridge app',
}

export type BridgeAppHost = Pick<InstanceBase<ModuleSchema>, 'label' | 'setVariableValues' | 'checkFeedbacks'> & {
	log(level: LogLevel, message: string): void
}

interface BridgeAppEvents {
	/** The catalogue arrived or changed: re-merge the connection's definitions. */
	definitions: []
	/** What the app says about its core changed: the connection's status may read differently. */
	bridgeState: []
}

export class BridgeAppControl extends EventEmitter<BridgeAppEvents> {
	readonly client: ControlClient
	private catalogue: Catalogue | null = null
	private readonly where: string
	/** The last status said in the log, so a retry loop against an old bridge says it once. */
	private announced: ControlStatus | null = null
	private lastState = ''
	private readonly openCtx: OpenAppContext

	constructor(
		private readonly host: BridgeAppHost,
		address: string,
		port: number,
		opts: {
			retryMs?: number
			/** The bridge token: for the LAN access the bridge will grow (#106) */
			token?: string
			/** The bridge's catalogue from last time: Run and Restart stay defined while the app is down */
			cached?: Catalogue | null
			/** A catalogue arrived that differs from the one kept: keep this one for next time */
			onCatalogue?: (cat: Catalogue) => void
		} = {},
	) {
		super()
		const { cached, onCatalogue, ...clientOpts } = opts
		const p = port || CONTROL_APPS.bridge.port
		this.where = hostPort(address, p)
		this.catalogue = cached?.app === 'bridge' ? cached : null
		let keptHash = this.catalogue?.hash
		this.client = new ControlClient({ host: address, port: p, appName: CONTROL_APPS.bridge.name, ...clientOpts })
		this.openCtx = {
			app: 'bridge',
			host: address,
			running: () => this.reporting(),
			catalogue: () => this.catalogue,
			press: async (control) => this.press(control),
			log: (level, message) => this.host.log(level, message),
		}
		this.client.on('status', (s, message) => this.onStatus(s, message))
		this.client.on('log', (level, message) => this.host.log(level, message))
		this.client.on('catalogue', (cat) => {
			this.catalogue = cat
			if (cat.hash !== keptHash) {
				keptHash = cat.hash
				onCatalogue?.(cat)
			}
			this.host.log(
				'info',
				`MIDI Bridge app control: ${cat.controls.length} controls, ${cat.state.length} state values`,
			)
			this.emit('definitions')
		})
		this.client.on('info', () => this.publishMeta())
		this.client.on('values', (changed) => this.onValues(changed))
	}

	start(): void {
		this.publishMeta()
		this.client.start()
	}

	stop(): void {
		this.client.stop()
		this.client.removeAllListeners()
		this.removeAllListeners()
	}

	/** What the app reports about its core — 'stopped', 'error', … — or null while it isn't reporting. */
	get bridgeState(): string | null {
		if (!this.reporting()) return null
		const v = this.client.get('bridge.state')
		return typeof v === 'string' ? v : null
	}

	get errorHint(): string {
		const v = this.reporting() ? this.client.get('bridge.error_hint') : null
		return typeof v === 'string' ? v : ''
	}

	actions(): ReturnType<typeof buildControlActions> {
		return {
			...(this.catalogue ? buildControlActions(this.catalogue, async (c, v) => this.press(c, v)) : {}),
			// Always: starting the bridge app is what this is for when it isn't running.
			...openAppActions(this.openCtx),
		}
	}

	feedbacks(): ReturnType<typeof buildControlFeedbacks> {
		return this.catalogue ? buildControlFeedbacks(this.catalogue, (key) => this.client.get(key)) : {}
	}

	variables(): ReturnType<typeof buildControlVariables> {
		if (this.catalogue) return buildControlVariables(this.catalogue, prefixedNaming, BRIDGE_APP_VARIABLES)
		return Object.fromEntries(Object.entries(BRIDGE_APP_VARIABLES).map(([id, name]) => [id, { name }]))
	}

	presets(): ReturnType<typeof buildControlPresets> {
		const look = buildLookPresets('bridge', this.catalogue, this.host.label, prefixedNaming)
		const built = this.catalogue
			? buildControlPresets(this.catalogue, this.host.label, prefixedNaming)
			: { sections: [], presets: {} }
		return { sections: [...built.sections, look.section], presets: { ...built.presets, ...look.presets } }
	}

	private reporting(): boolean {
		return this.client.status === 'ok' || this.client.status === 'not_allowed'
	}

	private onStatus(s: ControlStatus, message: string): void {
		this.publishMeta()
		this.maybeStateChanged()
		if (s === 'connecting' || s === this.announced) return
		this.announced = s
		if (s === 'ok') this.host.log('info', 'MIDI Bridge app control connected: Run, Restart and Auto-reconnect')
		else if (s === 'not_running')
			this.host.log(
				'info',
				`MIDI Bridge app control isn't answering on ${this.where}. Run, Restart and Auto-reconnect need MIDI Bridge 1.1.9 or later; console control is unaffected.`,
			)
		else this.host.log('warn', `MIDI Bridge app control: ${message}`)
	}

	private onValues(changed: Record<string, StateValue>): void {
		const cat = this.catalogue
		if (!cat) return
		this.host.setVariableValues(controlVariableValues(cat, changed, prefixedNaming))
		const ids = [...new Set(Object.keys(changed).flatMap((k) => feedbackIdsForKey(cat, k)))]
		if (ids.length) this.host.checkFeedbacks(ids[0], ...ids.slice(1))
		this.maybeStateChanged()
	}

	private maybeStateChanged(): void {
		const now = `${this.bridgeState}|${this.errorHint}`
		if (now === this.lastState) return
		this.lastState = now
		this.emit('bridgeState')
	}

	/** A refusal is the app's own sentence (brief §2.3 rule 4) — pass it on, don't paraphrase it. */
	private async press(control: string, value?: CmdValue): Promise<void> {
		const r = await this.client.cmd(control, value)
		if (!r.ok)
			this.host.log(
				'warn',
				r.code === 'not_running' && r.message ? r.message : `MIDI Bridge: ${r.message ?? r.code ?? 'refused'}`,
			)
	}

	private publishMeta(): void {
		const info = this.client.info
		const values: CompanionVariableValues = {
			bridge_app_connected: this.reporting(),
			bridge_app_allowed: info?.allowed ?? false,
			bridge_app_locked: info?.locked ?? false,
		}
		this.host.setVariableValues(values)
	}
}
