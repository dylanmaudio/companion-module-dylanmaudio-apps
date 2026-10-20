/**
 * ConsoleState — the mirrored desk. Events from the decoder write it;
 * feedbacks and variables are pure functions of it. Every write returns
 * the list of *paths* that changed so the subscription registry can
 * invalidate exactly the right feedbacks.
 *
 * Path grammar (strings, used as map keys everywhere):
 *   mute/<type>/<i>         fader/<type>/<i>        name/<type>/<i>
 *   colour/<type>/<i>       param/<type>/<i>/<p>    send/<type>/<i>/<dtype>/<di>
 *   mix/<i>/<dtype>/<di>    preamp_gain/<bank>/<s>  preamp_pad/<bank>/<s>
 *   preamp_48v/<bank>/<s>   scene                   connection
 */

import {
	channelKey,
	defaultName,
	socketKey,
	type ChannelRef,
	type ChannelType,
	type Colour,
	type SocketRef,
} from '../protocol/channels.js'
import { PARAM_ASSIGN, PARAM_HPF_ON, PARAM_MAIN_ASSIGN, type ConsoleEvent } from '../protocol/intents.js'

export interface StripState {
	name: string
	nameKnown: boolean
	colour: Colour
	colourKnown: boolean
	mute: boolean | undefined
	/** the wire value: a dLive lv (0-127), or another family's own units */
	level: number | undefined
	/**
	 * dB as the desk itself reports it, where it does (`{wire, db, steps}`).
	 * On a dLive this stays undefined and dB is derived from `level` through
	 * the measured table; on another family there is no such table here, so
	 * this is the only honest source.
	 */
	db: number | null | undefined
	params: Map<number, number>
	sends: Map<string, number>
	/** input → mix assigns, keyed by destination channelKey */
	mixes: Map<string, boolean>
	mainAssign: boolean | undefined
	dca: Set<number>
	dcaKnown: boolean
	muteGroups: Set<number>
	muteGroupsKnown: boolean
}

export interface SocketState {
	gain: number | undefined
	pad: boolean | undefined
	phantom: boolean | undefined
}

export function mutePath(ref: ChannelRef): string {
	return `mute/${channelKey(ref)}`
}
export function faderPath(ref: ChannelRef): string {
	return `fader/${channelKey(ref)}`
}
export function namePath(ref: ChannelRef): string {
	return `name/${channelKey(ref)}`
}
export function colourPath(ref: ChannelRef): string {
	return `colour/${channelKey(ref)}`
}
export function paramPath(ref: ChannelRef, param: number): string {
	return `param/${channelKey(ref)}/${param}`
}
export function sendPath(src: ChannelRef, dst: ChannelRef): string {
	return `send/${channelKey(src)}/${channelKey(dst)}`
}
export function mixPath(input: number, dst: ChannelRef): string {
	return `mix/${input}/${channelKey(dst)}`
}
export function preampPath(kind: 'gain' | 'pad' | '48v', sock: SocketRef): string {
	return `preamp_${kind}/${socketKey(sock)}`
}
export const SCENE_PATH = 'scene'
export const CONNECTION_PATH = 'connection'

export class ConsoleState {
	private readonly strips = new Map<string, StripState>()
	private readonly sockets = new Map<string, SocketState>()
	public currentScene: number | undefined
	/** scene number → name, from a show file */
	public sceneNames = new Map<number, string>()
	public connected = false

	strip(ref: ChannelRef): StripState {
		const key = channelKey(ref)
		let s = this.strips.get(key)
		if (!s) {
			s = {
				name: defaultName(ref),
				nameKnown: false,
				colour: 'off',
				colourKnown: false,
				mute: undefined,
				level: undefined,
				db: undefined,
				params: new Map(),
				sends: new Map(),
				mixes: new Map(),
				mainAssign: undefined,
				dca: new Set(),
				dcaKnown: false,
				muteGroups: new Set(),
				muteGroupsKnown: false,
			}
			this.strips.set(key, s)
		}
		return s
	}

	socket(ref: SocketRef): SocketState {
		const key = socketKey(ref)
		let s = this.sockets.get(key)
		if (!s) {
			s = { gain: undefined, pad: undefined, phantom: undefined }
			this.sockets.set(key, s)
		}
		return s
	}

	sendLevel(src: ChannelRef, dst: ChannelRef): number | undefined {
		return this.strip(src).sends.get(channelKey(dst))
	}

	mixAssigned(input: number, dst: ChannelRef): boolean | undefined {
		return this.strip({ type: 'input', index: input }).mixes.get(channelKey(dst))
	}

	/** Forget everything learned from the desk (keeps show-file scene names). */
	reset(): string[] {
		const changed: string[] = []
		for (const key of this.strips.keys()) {
			const [type, idx] = key.split('/')
			const ref = { type: type as ChannelType, index: Number(idx) }
			changed.push(mutePath(ref), faderPath(ref), namePath(ref), colourPath(ref))
		}
		this.strips.clear()
		this.sockets.clear()
		this.currentScene = undefined
		changed.push(SCENE_PATH)
		return changed
	}

	/** Apply a decoded event. Returns the paths whose value changed (or were first learned). */
	apply(ev: ConsoleEvent): string[] {
		switch (ev.kind) {
			case 'mute': {
				const s = this.strip(ev)
				if (s.mute === ev.on) return []
				s.mute = ev.on
				return [mutePath(ev)]
			}
			case 'fader': {
				const s = this.strip(ev)
				if (s.level === ev.level && s.db === ev.db) return []
				s.level = ev.level
				s.db = ev.db
				return [faderPath(ev)]
			}
			// Events, not channel state: a ping carries no value, and CC / strip
			// traffic belongs to whatever is triggering on it, not to the mirror.
			case 'fader_ping':
			case 'cc':
			case 'strip_fader':
			case 'strip_key':
			case 'strip_rotary':
				return []
			case 'name': {
				const s = this.strip(ev)
				const changed = !s.nameKnown || s.name !== ev.name
				s.name = ev.name
				s.nameKnown = true
				return changed ? [namePath(ev)] : []
			}
			case 'colour': {
				const s = this.strip(ev)
				const changed = !s.colourKnown || s.colour !== ev.colour
				s.colour = ev.colour
				s.colourKnown = true
				return changed ? [colourPath(ev)] : []
			}
			case 'scene': {
				if (this.currentScene === ev.scene) return []
				this.currentScene = ev.scene
				return [SCENE_PATH]
			}
			case 'param':
				return this.applyParam(ev, ev.param, ev.value)
			case 'send_level': {
				const s = this.strip(ev)
				const dst = { type: ev.dest_type, index: ev.dest_index }
				const key = channelKey(dst)
				if (s.sends.get(key) === ev.level) return []
				s.sends.set(key, ev.level)
				return [sendPath(ev, dst)]
			}
			case 'mix_assign': {
				const ref = { type: 'input' as const, index: ev.index }
				const dst = { type: ev.dest_type, index: ev.dest_index }
				const s = this.strip(ref)
				const key = channelKey(dst)
				if (s.mixes.get(key) === ev.on) return []
				s.mixes.set(key, ev.on)
				return [mixPath(ev.index, dst)]
			}
			case 'preamp_gain': {
				const s = this.socket(ev)
				if (s.gain === ev.value) return []
				s.gain = ev.value
				return [preampPath('gain', ev)]
			}
			case 'preamp_pad': {
				const s = this.socket(ev)
				if (s.pad === ev.on) return []
				s.pad = ev.on
				return [preampPath('pad', ev)]
			}
			case 'preamp_48v': {
				const s = this.socket(ev)
				if (s.phantom === ev.on) return []
				s.phantom = ev.on
				return [preampPath('48v', ev)]
			}
			case 'unknown':
				return []
		}
	}

	/**
	 * NRPN parameters. Assign (0x40) is a *set membership* encoded in the value:
	 * 0x40+d = DCA d on, d = DCA d off, 0x58+g = mute group g on, 0x18+g = off.
	 */
	private applyParam(ref: ChannelRef, param: number, value: number): string[] {
		const s = this.strip(ref)
		if (param === PARAM_ASSIGN) {
			const changed: string[] = []
			if (value >= 0x58 && value < 0x60) {
				const g = value - 0x58 + 1
				if (!s.muteGroups.has(g) || !s.muteGroupsKnown) changed.push(paramPath(ref, param))
				s.muteGroups.add(g)
				s.muteGroupsKnown = true
			} else if (value >= 0x18 && value < 0x20) {
				const g = value - 0x18 + 1
				if (s.muteGroups.has(g) || !s.muteGroupsKnown) changed.push(paramPath(ref, param))
				s.muteGroups.delete(g)
				s.muteGroupsKnown = true
			} else if (value >= 0x40 && value < 0x58) {
				const d = value - 0x40 + 1
				if (!s.dca.has(d) || !s.dcaKnown) changed.push(paramPath(ref, param))
				s.dca.add(d)
				s.dcaKnown = true
			} else if (value < 0x18) {
				const d = value + 1
				if (s.dca.has(d) || !s.dcaKnown) changed.push(paramPath(ref, param))
				s.dca.delete(d)
				s.dcaKnown = true
			}
			return changed
		}
		if (param === PARAM_MAIN_ASSIGN) {
			const on = value >= 0x40
			if (s.mainAssign === on) return []
			s.mainAssign = on
			return [paramPath(ref, param)]
		}
		const v = param === PARAM_HPF_ON ? (value >= 0x40 ? 1 : 0) : value
		if (s.params.get(param) === v) return []
		s.params.set(param, v)
		return [paramPath(ref, param)]
	}

	/** Apply our own outgoing set optimistically (the desk may not echo it). */
	applyLocal(ev: ConsoleEvent): string[] {
		return this.apply(ev)
	}

	sceneName(scene: number | undefined): string {
		if (scene === undefined) return ''
		return this.sceneNames.get(scene) ?? ''
	}
}

/** Paths an event *addresses* (whether or not the value changed) — used to match Get replies. */
export function eventPaths(ev: ConsoleEvent): string[] {
	switch (ev.kind) {
		case 'mute':
			return [mutePath(ev)]
		case 'fader':
			return [faderPath(ev)]
		case 'fader_ping':
		case 'cc':
		case 'strip_fader':
		case 'strip_key':
		case 'strip_rotary':
			return []
		case 'name':
			return [namePath(ev)]
		case 'colour':
			return [colourPath(ev)]
		case 'scene':
			return [SCENE_PATH]
		case 'param':
			return [paramPath(ev, ev.param)]
		case 'send_level':
			return [sendPath(ev, { type: ev.dest_type, index: ev.dest_index })]
		case 'mix_assign':
			return [mixPath(ev.index, { type: ev.dest_type, index: ev.dest_index })]
		case 'preamp_gain':
			return [preampPath('gain', ev)]
		case 'preamp_pad':
			return [preampPath('pad', ev)]
		case 'preamp_48v':
			return [preampPath('48v', ev)]
		case 'unknown':
			return []
	}
}
