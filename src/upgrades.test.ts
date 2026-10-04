import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, GetConfigFields, normaliseSecrets, type ModuleConfig } from './config.js'
import { tokenToSecrets, UpgradeScripts } from './upgrades.js'

const run = (config: Record<string, unknown> | null, secrets: Record<string, unknown> | null = null) =>
	tokenToSecrets(
		{ currentConfig: DEFAULT_CONFIG },
		{
			config: config as ModuleConfig | null,
			secrets: secrets as never,
			actions: [],
			feedbacks: [],
		},
	)

describe('the bridge token moves to the secrets store (#106)', () => {
	it('is the first upgrade script', () => {
		expect(UpgradeScripts[0]).toBe(tokenToSecrets)
	})

	it('moves a token out of a 1.0.x config, trimmed', () => {
		const r = run({ ...DEFAULT_CONFIG, bridgeToken: ' abc123\n' })
		expect(r.updatedConfig).not.toHaveProperty('bridgeToken')
		expect(r.updatedConfig).toMatchObject({ bridgeHost: DEFAULT_CONFIG.bridgeHost })
		expect(r.updatedSecrets).toEqual({ bridgeToken: 'abc123', ctlToken: '' })
	})

	it('drops the empty field the help asked for, leaving the secrets alone', () => {
		const r = run({ ...DEFAULT_CONFIG, bridgeToken: '' })
		expect(r.updatedConfig).not.toHaveProperty('bridgeToken')
		expect(r.updatedSecrets).toBeNull()
	})

	it('keeps an app token already in the secrets', () => {
		const r = run({ ...DEFAULT_CONFIG, bridgeToken: 'abc' }, { ctlToken: 'xyz', bridgeToken: '' })
		expect(r.updatedSecrets).toEqual({ bridgeToken: 'abc', ctlToken: 'xyz' })
	})

	it('changes nothing in a config that never had the field, or no config at all', () => {
		expect(run({ ...DEFAULT_CONFIG })).toMatchObject({ updatedConfig: null, updatedSecrets: null })
		expect(run(null)).toMatchObject({ updatedConfig: null, updatedSecrets: null })
	})
})

describe('the token fields', () => {
	it('are secret-text, each shown for its own kind of connection', () => {
		const fields = GetConfigFields()
		const bridge = fields.find((f) => f.id === 'bridgeToken')
		const app = fields.find((f) => f.id === 'ctlToken')
		expect(bridge?.type).toBe('secret-text')
		expect(app?.type).toBe('secret-text')
		expect(bridge?.isVisibleExpression).toBe("$(options:app) == 'bridge'")
		expect(app?.isVisibleExpression).toBe("$(options:app) != 'bridge'")
	})

	it('trims what was pasted, and takes nothing for missing', () => {
		expect(normaliseSecrets({ bridgeToken: ' t0k\n' })).toEqual({ bridgeToken: 't0k', ctlToken: '' })
		expect(normaliseSecrets(undefined)).toEqual({ bridgeToken: '', ctlToken: '' })
		expect(normaliseSecrets({ ctlToken: 5 as never })).toEqual({ bridgeToken: '', ctlToken: '' })
	})
})
