import type { CompanionStaticUpgradeScript } from '@companion-module/base'
import type { ModuleConfig, ModuleSecrets } from './config.js'
import { DEFAULT_WINDOW_MODE, OPEN_APP_ACTION } from './control/openapp.js'
import { isAppId } from './control/registry.js'

/**
 * Upgrade scripts run in order when a config from an older module version
 * is loaded. Migration from `allenheath-dlive-ilive` is planned (see
 * docs/roadmap.md) and will land here too.
 */

/**
 * 1.0.x kept the bridge token in the config, which Companion's web UI is
 * sent whole. It is a secret-text field now, kept in the secrets store
 * (#106). The help said to leave it empty, but move one that is there.
 */
export const tokenToSecrets: CompanionStaticUpgradeScript<ModuleConfig, ModuleSecrets> = (_context, props) => {
	const unchanged = { updatedConfig: null, updatedSecrets: null, updatedActions: [], updatedFeedbacks: [] }
	const config = props.config
	if (!config || !('bridgeToken' in config)) return unchanged
	const { bridgeToken, ...rest } = config
	const token = typeof bridgeToken === 'string' ? bridgeToken.trim() : ''
	return {
		...unchanged,
		updatedConfig: rest,
		updatedSecrets: token ? { ctlToken: '', ...props.secrets, bridgeToken: token } : null,
	}
}

/**
 * #705 gave `open_app` a `window` dropdown (toggle / show). Every key built
 * before it has no `window` value, and Companion refuses a dropdown whose
 * stored value isn't one of the choices: the press fails with "Value is not in
 * the list of choices" and does nothing. The operator's own HOME page hit it
 * at the Birmingham rehearsal on 26 Nov 2026, on three connections.
 *
 * So fill a missing — or otherwise invalid — value with this app's default.
 * The id stays `window`, as a frozen option id must.
 */
export const fillOpenAppWindow: CompanionStaticUpgradeScript<ModuleConfig, ModuleSecrets> = (_context, props) => {
	const unchanged = { updatedConfig: null, updatedSecrets: null, updatedActions: [], updatedFeedbacks: [] }
	const app = props.config?.app
	if (!isAppId(app)) return unchanged
	const want = DEFAULT_WINDOW_MODE[app]
	const updatedActions = props.actions.filter((action) => {
		if (action.actionId !== OPEN_APP_ACTION) return false
		// A migration action's options are wrapped as { value, isExpression } —
		// unlike the plain values a callback is handed. An expression is the
		// operator's own, so leave it be; Companion evaluates it at press time.
		const stored = action.options.window
		if (stored?.isExpression) return false
		if (stored?.value === 'toggle' || stored?.value === 'show') return false
		action.options.window = { value: want, isExpression: false }
		return true
	})
	return { ...unchanged, updatedActions }
}

export const UpgradeScripts: CompanionStaticUpgradeScript<ModuleConfig, ModuleSecrets>[] = [
	tokenToSecrets,
	fillOpenAppWindow,
]
