/**
 * Catalogue → Companion definitions: the demo contract first (every kind of
 * control in one place), then each app's real catalogue. The important tests
 * are the wire ones: each action must put exactly the value on the wire that
 * fixtures/control pins.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
	actionId,
	boolFeedbackId,
	buildControlActions,
	buildControlFeedbacks,
	buildControlPresets,
	buildControlVariables,
	controlVariableValues,
	enumFeedbackId,
	feedbackIdsForKey,
	prefixedNaming,
	variableId,
} from './definitions.js'
import type { Catalogue, CmdValue, StateValue } from './types.js'

const here = dirname(fileURLToPath(import.meta.url))
const fx = JSON.parse(readFileSync(join(here, '..', '..', 'fixtures', 'control', 'exchanges.json'), 'utf8')) as {
	app: { id: string; name: string; version: string }
	catalogue: Pick<Catalogue, 'controls' | 'state'>
	initial_state: Record<string, StateValue>
	cases: { id: string; request: { body?: { control?: string; value?: CmdValue } } }[]
}
const cat: Catalogue = { app: fx.app.id, name: fx.app.name, version: fx.app.version, hash: 'h', ...fx.catalogue }

function wire(caseId: string): { control?: string; value?: CmdValue } {
	const c = fx.cases.find((x) => x.id === caseId)
	if (!c?.request.body) throw new Error(`no body for ${caseId}`)
	return { control: c.request.body.control, value: c.request.body.value }
}

/** Run an action's callback with these options and return what it sent. */
async function press(id: string, options: Record<string, unknown>): Promise<{ control: string; value?: CmdValue }> {
	const sent: { control: string; value?: CmdValue }[] = []
	const defs = buildControlActions(cat, async (control, value) => {
		sent.push({ control, value })
	})
	const def = defs[id]
	if (!def) throw new Error(`no action ${id}`)
	await def.callback({ options } as never, {} as never)
	return sent[0]
}

function options(id: string): { id: string; [k: string]: unknown }[] {
	const def = buildControlActions(cat, async () => undefined)[id]
	if (!def) throw new Error(`no action ${id}`)
	return def.options as unknown as { id: string; [k: string]: unknown }[]
}

describe('actions', () => {
	it('each kind puts on the wire exactly what the fixture pins', async () => {
		expect(await press(actionId('demo.run'), { mode: 'on' })).toEqual(wire('cmd.toggle.on'))
		expect(await press(actionId('demo.run'), { mode: 'toggle' })).toEqual(wire('cmd.toggle.flip'))
		expect(await press(actionId('demo.run'), { mode: 'off' })).toEqual(wire('cmd.locked.toggle_off_refused'))
		expect(await press(actionId('demo.mode'), { value: 'next' })).toEqual(wire('cmd.choice.next'))
		expect(await press(actionId('demo.mode'), { value: 'auto' })).toEqual(wire('cmd.locked.critical'))
		expect(await press(actionId('demo.threshold'), { mode: 'nudge', steps: 1 })).toEqual(wire('cmd.number.nudge'))
		expect(await press(actionId('demo.threshold'), { mode: 'set', value: 5 })).toEqual(wire('cmd.number.out_of_range'))
		expect(await press(actionId('demo.start_tc'), { value: '01:00:00:00' })).toEqual(wire('cmd.text.ok'))
		expect(await press(actionId('demo.reset'), {})).toEqual(wire('cmd.action.refused'))
	})

	it('one action per control, with ids that survive an app update', () => {
		expect(Object.keys(buildControlActions(cat, async () => undefined)).sort()).toEqual(
			['ctl_demo__mode', 'ctl_demo__reset', 'ctl_demo__run', 'ctl_demo__start_tc', 'ctl_demo__threshold'].sort(),
		)
	})

	it('offers each kind the choices its wire format accepts', () => {
		expect((options(actionId('demo.run'))[0].choices as { id: string }[]).map((c) => c.id)).toEqual([
			'toggle',
			'on',
			'off',
		])
		expect(options(actionId('demo.mode'))[0].choices).toEqual([
			{ id: 'auto', label: 'Automatic' },
			{ id: 'latch', label: 'Latch until Reset' },
			{ id: 'next', label: 'Next (cycles through them)' },
		])
		const [mode, value, steps] = options(actionId('demo.threshold'))
		expect(mode).toMatchObject({ id: 'mode', default: 'nudge', disableAutoExpression: true })
		expect(value).toMatchObject({
			id: 'value',
			min: -60,
			max: 0,
			step: 1,
			isVisibleExpression: "$(options:mode) == 'set'",
		})
		expect(steps).toMatchObject({ id: 'steps', isVisibleExpression: "$(options:mode) == 'nudge'" })
	})

	it("checks a text value against the app's own pattern", () => {
		const rx = options(actionId('demo.start_tc'))[0].regex as string
		const re = new RegExp(rx.slice(1, -1))
		expect(re.test(wire('cmd.text.ok').value as string)).toBe(true)
		expect(re.test(wire('cmd.text.bad_value').value as string)).toBe(false)
	})

	it('says which controls are show-critical, and which the app may refuse', () => {
		const defs = buildControlActions(cat, async () => undefined)
		expect(defs[actionId('demo.mode')]?.description).toMatch(/^Show-critical:/)
		expect(defs[actionId('demo.run')]?.description).toMatch(/Show-critical when set to Off/)
		expect(defs[actionId('demo.reset')]?.description).toMatch(/"Reset available"/)
		expect(defs[actionId('demo.threshold')]?.description).toBeUndefined()
	})
})

describe('feedbacks', () => {
	const values: Record<string, StateValue> = { ...fx.initial_state }
	const defs = buildControlFeedbacks(cat, (k) => values[k] ?? null)

	it('one per bool and enum state key; numbers and text become variables only', () => {
		expect(Object.keys(defs).sort()).toEqual(
			[
				boolFeedbackId('demo.running'),
				boolFeedbackId('demo.reset_available'),
				enumFeedbackId('demo.mode'),
				enumFeedbackId('demo.state'),
			].sort(),
		)
	})

	it('names enum values the way the choice control that sets them does', () => {
		const opts = defs[enumFeedbackId('demo.mode')]?.options as unknown as { choices: unknown }[]
		expect(opts[0].choices).toEqual([
			{ id: 'auto', label: 'Automatic' },
			{ id: 'latch', label: 'Latch until Reset' },
		])
	})

	it('reads the current value', () => {
		const run = defs[boolFeedbackId('demo.running')]
		const mode = defs[enumFeedbackId('demo.mode')]
		if (run?.type !== 'boolean' || mode?.type !== 'boolean') throw new Error('expected boolean feedbacks')
		expect(run.callback({ options: {} }, {})).toBe(false)
		values['demo.running'] = true
		expect(run.callback({ options: {} }, {})).toBe(true)
		expect(mode.callback({ options: { value: 'auto' } }, {})).toBe(true)
		expect(mode.callback({ options: { value: 'latch' } }, {})).toBe(false)
	})

	it('knows which feedbacks a changed key touches', () => {
		expect(feedbackIdsForKey(cat, 'demo.running')).toEqual([boolFeedbackId('demo.running')])
		expect(feedbackIdsForKey(cat, 'demo.state')).toEqual([enumFeedbackId('demo.state')])
		expect(feedbackIdsForKey(cat, 'demo.level_db')).toEqual([])
		expect(feedbackIdsForKey(cat, 'demo.nope')).toEqual([])
	})
})

describe('variables', () => {
	it('one per state key, named without the app prefix, plus the connection meta', () => {
		const defs = buildControlVariables(cat) as Record<string, { name: string }>
		expect(Object.keys(defs).sort()).toEqual(
			[
				'ctl_allowed',
				'ctl_connected',
				'ctl_locked',
				'ctl_version',
				'level_db',
				'mode',
				'reset_available',
				'running',
				'state',
				'threshold_db',
			].sort(),
		)
		expect(defs.threshold_db.name).toBe('Threshold (dB)')
		expect(variableId('ptt', 'ptt.state')).toBe('state')
		expect(variableId('tct', 'tct.tc.hours')).toBe('tc_hours')
	})

	it('shows unknown as empty and a level to two decimals', () => {
		expect(
			controlVariableValues(cat, {
				'demo.level_db': null,
				'demo.threshold_db': -44.123456,
				'demo.mode': 'latch',
				'demo.running': true,
			}),
		).toEqual({
			level_db: undefined,
			threshold_db: -44.12,
			mode: 'latch',
			running: true,
		})
	})
})

describe('presets', () => {
	const { sections, presets } = buildControlPresets(cat, 'demo')

	it('a button per control, lit by its own state', () => {
		const run = presets['p_demo__run']
		expect(run).toMatchObject({ type: 'layered', name: 'Run' })
		expect(JSON.stringify(run)).toContain(boolFeedbackId('demo.running'))
		for (const v of ['auto', 'latch']) {
			const p = presets[`p_demo__mode__${v}`]
			expect(JSON.stringify(p)).toContain(enumFeedbackId('demo.mode'))
			expect(JSON.stringify(p)).toContain(`"value":"${v}"`)
		}
		expect(JSON.stringify(presets['p_demo__reset'])).toContain(boolFeedbackId('demo.reset_available'))
	})

	it("numbers get a readout of the app's value and nudges both ways", () => {
		expect(JSON.stringify(presets['p_demo__threshold__show'])).toContain('$(demo:threshold_db)')
		expect(JSON.stringify(presets['p_demo__threshold__up'])).toContain('"steps":1')
		expect(JSON.stringify(presets['p_demo__threshold__down'])).toContain('"steps":-1')
	})

	it('no preset for free text, and one section holding the rest', () => {
		expect(Object.keys(presets).some((k) => k.startsWith('p_demo__start_tc'))).toBe(false)
		expect(sections).toEqual([{ id: 'ctl_demo', name: 'Demo App', definitions: Object.keys(presets) }])
	})
})

// ------------------------------------------------------------ the five apps

type Fx = typeof fx
function loadFx(file: string): { fx: Fx; cat: Catalogue } {
	const f = JSON.parse(readFileSync(join(here, '..', '..', 'fixtures', 'control', file), 'utf8')) as Fx
	return { fx: f, cat: { app: f.app.id, name: f.app.name, version: f.app.version, hash: 'h', ...f.catalogue } }
}
function wireIn(f: Fx, caseId: string): { control?: string; value?: CmdValue } {
	const c = f.cases.find((x) => x.id === caseId)
	if (!c?.request.body) throw new Error(`no body for ${caseId}`)
	return { control: c.request.body.control, value: c.request.body.value }
}
async function pressIn(
	c: Catalogue,
	id: string,
	opts: Record<string, unknown>,
): Promise<{ control: string; value?: CmdValue }> {
	const sent: { control: string; value?: CmdValue }[] = []
	const def = buildControlActions(c, async (control, value) => {
		sent.push({ control, value })
	})[id]
	if (!def) throw new Error(`no action ${id}`)
	await def.callback({ options: opts } as never, {} as never)
	return sent[0]
}

describe('Pilot Tone Trigger (fixtures/control/ptt.json)', () => {
	const { fx: pf, cat: pc } = loadFx('ptt.json')

	it('each control puts on the wire exactly what the fixture pins', async () => {
		expect(await pressIn(pc, 'ctl_ptt__run', { mode: 'on' })).toEqual(wireIn(pf, 'cmd.run.on'))
		expect(await pressIn(pc, 'ctl_ptt__failback_mode', { value: 'next' })).toEqual(wireIn(pf, 'cmd.failback_mode.next'))
		expect(await pressIn(pc, 'ctl_ptt__failback_mode', { value: 'auto' })).toEqual(
			wireIn(pf, 'cmd.failback_mode.locked'),
		)
		expect(await pressIn(pc, 'ctl_ptt__reset', {})).toEqual(wireIn(pf, 'cmd.reset.noop_when_stopped'))
		expect(await pressIn(pc, 'ctl_ptt__tone', { mode: 'toggle' })).toEqual(wireIn(pf, 'cmd.tone.toggle'))
	})

	it('Automatic and Latch are named as the app names them, and the mode is marked show-critical', () => {
		const a = buildControlActions(pc, async () => undefined)
		const opts = a.ctl_ptt__failback_mode?.options as unknown as { choices: unknown }[]
		expect(opts[0].choices).toEqual([
			{ id: 'auto', label: 'Automatic' },
			{ id: 'latch', label: 'Latch until Reset' },
			{ id: 'next', label: 'Next (cycles through them)' },
		])
		expect(a.ctl_ptt__failback_mode?.description).toMatch(/^Show-critical:/)
		expect(a.ctl_ptt__run?.description).toMatch(/Show-critical when set to Off/)
		expect(a.ctl_ptt__reset?.description).toMatch(/"Reset available"/)
	})

	it('feedbacks, variables and presets for the state it reports', () => {
		expect(Object.keys(buildControlFeedbacks(pc, () => null)).sort()).toEqual(
			[
				'st_ptt__failback_mode__is',
				'st_ptt__reset_available',
				'st_ptt__running',
				'st_ptt__state__is',
				'st_ptt__tone_running',
			].sort(),
		)
		const vars = Object.keys(buildControlVariables(pc)).filter((k) => !k.startsWith('ctl_'))
		expect(vars.sort()).toEqual(
			[
				'failback_mode',
				'integrity_errors',
				'level_db',
				'reset_available',
				'running',
				'state',
				'threshold_db',
				'tone_running',
			].sort(),
		)
		const { presets } = buildControlPresets(pc, 'ptt')
		expect(Object.keys(presets).sort()).toEqual(
			[
				'p_ptt__failback_mode__auto',
				'p_ptt__flip',
				'p_ptt__failback_mode__latch',
				'p_ptt__reset',
				'p_ptt__run',
				'p_ptt__show',
				'p_ptt__threshold__down',
				'p_ptt__threshold__show',
				'p_ptt__threshold__up',
				'p_ptt__tone',
			].sort(),
		)
	})
})

describe('Talk Light Trigger (fixtures/control/tlt.json)', () => {
	const { fx: tf, cat: tc } = loadFx('tlt.json')

	it('each control puts on the wire exactly what the fixture pins', async () => {
		expect(await pressIn(tc, 'ctl_tlt__run', { mode: 'on' })).toEqual(wireIn(tf, 'cmd.toggle.on'))
		expect(await pressIn(tc, 'ctl_tlt__run', { mode: 'toggle' })).toEqual(wireIn(tf, 'cmd.toggle.flip'))
		expect(await pressIn(tc, 'ctl_tlt__run', { mode: 'off' })).toEqual(wireIn(tf, 'cmd.locked.toggle_off_refused'))
		expect(await pressIn(tc, 'ctl_tlt__threshold', { mode: 'nudge', steps: 1 })).toEqual(wireIn(tf, 'cmd.number.nudge'))
		expect(await pressIn(tc, 'ctl_tlt__threshold', { mode: 'set', value: 10 })).toEqual(
			wireIn(tf, 'cmd.number.out_of_range'),
		)
	})

	it('talk state is a feedback, and the threshold a readout with ±1 dB nudges', () => {
		expect(Object.keys(buildControlFeedbacks(tc, () => null)).sort()).toEqual(['st_tlt__running', 'st_tlt__talk__is'])
		const { presets } = buildControlPresets(tc, 'tlt')
		expect(JSON.stringify(presets.p_tlt__threshold__show)).toContain('$(tlt:threshold_db)')
		expect(Object.keys(presets)).toEqual(
			expect.arrayContaining(['p_tlt__run', 'p_tlt__threshold__up', 'p_tlt__threshold__down']),
		)
	})
})

describe('Time Code Tool (fixtures/control/tct.json)', () => {
	const { fx: xf, cat: xc } = loadFx('tct.json')

	it('each control puts on the wire exactly what the fixture pins', async () => {
		expect(await pressIn(xc, 'ctl_tct__run', { mode: 'on' })).toEqual(wireIn(xf, 'cmd.run.on'))
		expect(await pressIn(xc, 'ctl_tct__mode', { value: 'generate' })).toEqual(wireIn(xf, 'cmd.mode.generate'))
		expect(await pressIn(xc, 'ctl_tct__input', { value: 'next' })).toEqual(wireIn(xf, 'cmd.input.next'))
		expect(await pressIn(xc, 'ctl_tct__mtc_out', { mode: 'toggle' })).toEqual(wireIn(xf, 'cmd.mtc_out.toggle'))
		expect(await pressIn(xc, 'ctl_tct__ltc_out', { mode: 'off' })).toEqual(wireIn(xf, 'cmd.ltc_out.off.locked'))
		expect(await pressIn(xc, 'ctl_tct__reset_counters', {})).toEqual(wireIn(xf, 'cmd.reset_counters'))
		expect(await pressIn(xc, 'ctl_tct__generate_start', { value: '09:59:50:00' })).toEqual(
			wireIn(xf, 'cmd.generate_start.ok'),
		)
		expect(await pressIn(xc, 'ctl_tct__generate_rate', { value: '30' })).toEqual(wireIn(xf, 'cmd.generate_rate.ok'))
	})

	it("checks a start timecode's shape, and leaves an impossible one for the app to refuse", () => {
		const opts = buildControlActions(xc, async () => undefined).ctl_tct__generate_start?.options as unknown as {
			regex: string
		}[]
		const re = new RegExp(opts[0].regex.slice(1, -1))
		expect(re.test(wireIn(xf, 'cmd.generate_start.ok').value as string)).toBe(true)
		expect(re.test(wireIn(xf, 'cmd.generate_start.bad_value').value as string)).toBe(false)
		expect(re.test(wireIn(xf, 'cmd.generate_start.not_a_timecode').value as string)).toBe(true)
	})

	it('the six states are one feedback; the input reads as the app names it', () => {
		const fb = buildControlFeedbacks(xc, () => null)
		const state = fb.st_tct__state__is?.options as unknown as { choices: { id: string }[] }[]
		expect(state[0].choices.map((c) => c.id)).toEqual([
			'stopped',
			'no_signal',
			'locked',
			'freewheel',
			'clip',
			'generating',
		])
		const source = fb.st_tct__source__is?.options as unknown as { choices: unknown }[]
		expect(source[0].choices).toEqual([
			{ id: 'ltc', label: 'LTC (audio)' },
			{ id: 'mtc', label: 'MTC (MIDI)' },
		])
	})

	it('the timecode digits are separate variables, for a multi-key readout', () => {
		expect(Object.keys(buildControlVariables(xc))).toEqual(
			expect.arrayContaining(['timecode', 'tc_h', 'tc_m', 'tc_s', 'tc_f', 'state', 'discontinuities']),
		)
		expect(controlVariableValues(xc, { 'tct.tc_h': 9, 'tct.tc_f': 24, 'tct.tc_m': null })).toEqual({
			tc_h: 9,
			tc_f: 24,
			tc_m: undefined,
		})
	})
})

describe('Console Control (fixtures/control/cxc.json)', () => {
	const { fx: cf, cat: cc } = loadFx('cxc.json')

	it('each control puts on the wire exactly what the fixture pins', async () => {
		expect(await pressIn(cc, 'ctl_cxc__play', {})).toEqual(wireIn(cf, 'cmd.play'))
		expect(await pressIn(cc, 'ctl_cxc__locate', { value: '00:10:00:00' })).toEqual(wireIn(cf, 'cmd.locate'))
		expect(await pressIn(cc, 'ctl_cxc__go-to-region', { mode: 'set', value: 2 })).toEqual(
			wireIn(cf, 'cmd.go-to-region'),
		)
		expect(await pressIn(cc, 'ctl_cxc__go-to-marker', { mode: 'set', value: 9 })).toEqual(
			wireIn(cf, 'cmd.refused_by_the_app'),
		)
		expect(await pressIn(cc, 'ctl_cxc__stop', {})).toEqual(wireIn(cf, 'cmd.stop.locked'))
		expect(await pressIn(cc, 'ctl_cxc__panic', {})).toEqual(wireIn(cf, 'cmd.panic.while_locked'))
	})

	it('keeps the command names, hyphens and all, in the action ids', () => {
		const ids = Object.keys(buildControlActions(cc, async () => undefined))
		expect(ids).toHaveLength(58)
		expect(ids).toEqual(
			expect.arrayContaining(['ctl_cxc__go-to-start', 'ctl_cxc__toggle-show-mode', 'ctl_cxc__go-to-marker']),
		)
	})

	it('marker and region numbers are set, never nudged: there is no current marker to nudge from', () => {
		const a = buildControlActions(cc, async () => undefined)
		const [mode, value] = a['ctl_cxc__go-to-marker']?.options as unknown as {
			default: unknown
			choices?: { id: string }[]
		}[]
		expect(mode.default).toBe('set')
		expect(mode.choices?.map((c) => c.id)).toEqual(['set'])
		expect(value).toMatchObject({ min: 0, step: 1, default: 0 })
		const { presets } = buildControlPresets(cc, 'cxc')
		expect(Object.keys(presets).filter((k) => k.startsWith('p_cxc__go-to-marker'))).toEqual([])
	})

	it("gives each menu group its own preset section, in the app's order", () => {
		const { sections, presets } = buildControlPresets(cc, 'cxc')
		const slug = (id: string) => `p_${id.replace('.', '__')}`
		const hasPreset = (id: string) => Object.keys(presets).some((k) => k === slug(id) || k.startsWith(`${slug(id)}__`))
		const groups = [...new Set(cc.controls.filter((c) => hasPreset(c.id)).map((c) => c.group as string))]
		expect(sections.map((s) => s.name)).toEqual(
			groups.map((g) => `Console Control: ${g[0].toUpperCase()}${g.slice(1)}`),
		)
		expect(sections[0].name).toBe('Console Control: Transport')
		expect(sections.flatMap((s) => s.definitions as string[]).sort()).toEqual(Object.keys(presets).sort())
		const transport = sections.find((s) => s.id === 'ctl_cxc__transport')?.definitions as string[]
		expect(transport).toEqual(expect.arrayContaining(['p_cxc__play', 'p_cxc__stop', 'p_cxc__record']))
	})

	it('says which commands are show-critical', () => {
		const a = buildControlActions(cc, async () => undefined)
		for (const id of ['stop', 'go-to-start', 'record', 'conform-console', 'toggle-show-mode'])
			expect(a[`ctl_cxc__${id}`]?.description).toMatch(/^Show-critical:/)
		expect(a.ctl_cxc__play?.description).toBeUndefined()
	})
})

describe('MIDI Bridge app control (fixtures/control/bridge.json)', () => {
	const { fx: bf, cat: bc } = loadFx('bridge.json')

	it('each control puts on the wire exactly what the fixture pins', async () => {
		expect(await pressIn(bc, 'ctl_bridge__run', { mode: 'on' })).toEqual(wireIn(bf, 'cmd.run.on'))
		expect(await pressIn(bc, 'ctl_bridge__run', { mode: 'off' })).toEqual(wireIn(bf, 'cmd.run.off'))
		expect(await pressIn(bc, 'ctl_bridge__restart', {})).toEqual(wireIn(bf, 'cmd.restart'))
		expect(await pressIn(bc, 'ctl_bridge__autoreconnect', { mode: 'off' })).toEqual(wireIn(bf, 'cmd.autoreconnect.off'))
	})

	it('in the MIDI Bridge connection its variables keep the bridge_ prefix', () => {
		expect(Object.keys(buildControlVariables(bc, prefixedNaming, {})).sort()).toEqual([
			'bridge_activity',
			'bridge_autoreconnect',
			'bridge_console',
			'bridge_error_hint',
			'bridge_msg_rate',
			'bridge_running',
			'bridge_state',
			'bridge_version',
		])
		expect(controlVariableValues(bc, { 'bridge.state': 'connected' }, prefixedNaming)).toEqual({
			bridge_state: 'connected',
		})
	})

	it('stopping and restarting are show-critical; auto-reconnect is not', () => {
		const a = buildControlActions(bc, async () => undefined)
		expect(a.ctl_bridge__run?.description).toMatch(/Show-critical when set to Off/)
		expect(a.ctl_bridge__restart?.description).toMatch(/^Show-critical:/)
		expect(a.ctl_bridge__autoreconnect?.description).toBeUndefined()
	})
})
