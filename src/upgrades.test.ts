import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, GetConfigFields, normaliseSecrets, type ModuleConfig } from './config.js'
import { fillOpenAppWindow, tokenToSecrets, UpgradeScripts } from './upgrades.js'

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

describe("every open-app key keeps working when the action grew a 'window' option (#705)", () => {
	/** An option as Companion stores it in a saved button. */
	const lit = (value: unknown) => ({ value, isExpression: false })
	const upgrade = (app: string, actions: { actionId: string; options: Record<string, unknown> }[]) => {
		const props = {
			config: { ...DEFAULT_CONFIG, app } as ModuleConfig | null,
			secrets: null as never,
			actions: actions as never,
			feedbacks: [],
		}
		const r = fillOpenAppWindow({ currentConfig: DEFAULT_CONFIG }, props)
		return { r, actions }
	}

	it('is the second upgrade script, so a key already upgraded once still runs it', () => {
		expect(UpgradeScripts[1]).toBe(fillOpenAppWindow)
		expect(UpgradeScripts).toHaveLength(2)
	})

	it("fills a menu-bar app's missing value with toggle: the window opens and closes", () => {
		const { r, actions } = upgrade('tct', [{ actionId: 'open_app', options: {} }])
		expect(r.updatedActions).toHaveLength(1)
		expect(actions[0].options).toEqual({ window: lit('toggle') })
	})

	it('fills Show Recorder and Console Control with show: a second press must not take the window away', () => {
		for (const app of ['sr', 'cxc']) {
			const { actions } = upgrade(app, [{ actionId: 'open_app', options: {} }])
			expect(actions[0].options).toEqual({ window: lit('show') })
		}
	})

	it('leaves a choice the operator made alone, both ways round', () => {
		const { r, actions } = upgrade('sr', [
			{ actionId: 'open_app', options: { window: lit('toggle') } },
			{ actionId: 'open_app', options: { window: lit('show') } },
		])
		expect(r.updatedActions).toEqual([])
		expect(actions.map((a) => a.options.window)).toEqual([lit('toggle'), lit('show')])
	})

	it('replaces a value that is not one of the choices — what Companion refuses', () => {
		const { r, actions } = upgrade('tlt', [{ actionId: 'open_app', options: { window: lit('open') } }])
		expect(r.updatedActions).toHaveLength(1)
		expect(actions[0].options).toEqual({ window: lit('toggle') })
	})

	it('touches no other action, and no action at all without a usable config', () => {
		const { r, actions } = upgrade('bridge', [{ actionId: 'ctl_bridge__run', options: {} }])
		expect(r.updatedActions).toEqual([])
		expect(actions[0].options).toEqual({})
		// an expression the operator wrote stands: Companion works it out at press time
		const expr = upgrade('sr', [{ actionId: 'open_app', options: { window: { value: '$(x:y)', isExpression: true } } }])
		expect(expr.r.updatedActions).toEqual([])
		expect(expr.actions[0].options.window).toEqual({ value: '$(x:y)', isExpression: true })
		const none = fillOpenAppWindow(
			{ currentConfig: DEFAULT_CONFIG },
			{ config: null, secrets: null, actions: [], feedbacks: [] },
		)
		expect(none.updatedActions).toEqual([])
	})
})
