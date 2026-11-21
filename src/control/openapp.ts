/**
 * "Open <app>": the action behind the logo and menu-bar keys.
 *
 * While the app answers on its control endpoint, a press opens or closes its
 * window through the catalogue's `<app>.window` toggle (#705), so a window
 * opened from a deck can be closed from it too. An app without that toggle is
 * asked to show itself through `<app>.show`, as before. The action can be set
 * to show only. The module
 * never starts an app: that would take Companion's child-process permission,
 * which marks a module as dangerous to its users. A key pressed while the app
 * is down says in the log to start it, on this Mac or the one it is on.
 */

import { isLoopback } from '../util/net.js'
import type { buildControlActions } from './definitions.js'
import { CONTROL_APPS, type AppId } from './registry.js'
import type { Catalogue } from './types.js'

export const OPEN_APP_ACTION = 'open_app'

export interface OpenAppContext {
	app: AppId
	/** The app's address, when it isn't this machine (a tunnel, or LAN access later: #106) */
	host?: string
	/** The app is answering on its control endpoint */
	running(): boolean
	/** The app's catalogue, for its show control */
	catalogue(): Catalogue | null
	press(control: string, value?: string, abort?: AbortSignal): Promise<void>
	log(level: 'info' | 'warn', message: string): void
}

/** The catalogue's `<app>.show` action, if the app offers one. */
export function showControlOf(cat: Catalogue | null, app: AppId): string | null {
	return cat?.controls.find((c) => c.id === `${app}.show` && c.kind === 'action')?.id ?? null
}

/** The catalogue's `<app>.window` toggle, if the app offers one (#705). */
export function windowControlOf(cat: Catalogue | null, app: AppId): string | null {
	return cat?.controls.find((c) => c.id === `${app}.window` && c.kind === 'toggle')?.id ?? null
}

export type OpenAppMode = 'toggle' | 'show'

export async function openApp(ctx: OpenAppContext, abort?: AbortSignal, mode: OpenAppMode = 'toggle'): Promise<void> {
	const name = CONTROL_APPS[ctx.app].name
	if (!ctx.running()) {
		ctx.log(
			'warn',
			ctx.host === undefined || isLoopback(ctx.host)
				? `${name} isn't running. Start it on this Mac, then press again.`
				: `${name} isn't answering at ${ctx.host}. Start it on that Mac, then press again.`,
		)
		return
	}
	const window = mode === 'toggle' ? windowControlOf(ctx.catalogue(), ctx.app) : null
	if (window) return ctx.press(window, 'toggle', abort)
	const show = showControlOf(ctx.catalogue(), ctx.app)
	if (show) await ctx.press(show, undefined, abort)
	else
		ctx.log('info', `${name} is already running. Companion can bring it forward once ${name} offers a "show" control.`)
}

export function openAppActions(ctx: OpenAppContext): ReturnType<typeof buildControlActions> {
	const name = CONTROL_APPS[ctx.app].name
	return {
		[OPEN_APP_ACTION]: {
			name: `Open ${name}`,
			description: `Opens ${name}'s window, or closes it if it is open (bringing it to the front, for an app that can't say). If it isn't running, the log says so: start it first.`,
			options: [
				{
					type: 'dropdown',
					id: 'window',
					label: 'Press',
					default: 'toggle',
					choices: [
						{ id: 'toggle', label: 'Opens the window, or closes it' },
						{ id: 'show', label: 'Only brings it to the front' },
					],
				},
			],
			callback: async (a, c) => openApp(ctx, c?.signal, a.options.window === 'show' ? 'show' : 'toggle'),
		},
	}
}
