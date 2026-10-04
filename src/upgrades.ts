import type { CompanionStaticUpgradeScript } from '@companion-module/base'
import type { ModuleConfig, ModuleSecrets } from './config.js'

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

export const UpgradeScripts: CompanionStaticUpgradeScript<ModuleConfig, ModuleSecrets>[] = [tokenToSecrets]
