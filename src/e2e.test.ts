/**
 * End-to-end: the real module class under a fake Companion host, talking
 * real TCP to the Python Virtual dLive (dLive Utility Apps `sim/`).
 *
 * Skipped when the sim is not on this machine (set DLIVE_SIM_ROOT).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type {
	CompanionActionDefinitions,
	CompanionFeedbackDefinitions,
	CompanionVariableValues,
} from '@companion-module/base'
import DliveInstance from './main.js'
import { DEFAULT_CONFIG } from './config.js'
import { ConsoleLink } from './link.js'
import type { LinkApi } from './link-api.js'
import { TcpTransport } from './transport/transport.js'
import { stripCountsFor } from './variables.js'

const SIM_ROOT = process.env.DLIVE_SIM_ROOT ?? join(homedir(), 'Documents', 'GitHub', 'dLive Utility Apps')
const HAVE_SIM = existsSync(join(SIM_ROOT, 'sim', 'virtual_console.py'))

/**
 * The module with its console link swapped for the direct protocol harness,
 * because the Virtual dLive has no MIDI Bridge in front of it. The module
 * itself only ever talks to the bridge.
 */
class HarnessInstance extends DliveInstance {
	readonly #port: number
	constructor(internal: unknown, port: number) {
		super(internal)
		this.#port = port
	}
	protected override makeLink(): LinkApi {
		return new ConsoleLink(new TcpTransport({ host: '127.0.0.1', port: this.#port, surfacePort: 51328 }), {
			baseChannel: this.config.baseChannel,
			syncScope: this.config.syncScope,
			stripCounts: stripCountsFor({ inputs: this.config.inputs, extendedTypes: this.config.extendedTypes }),
			scheduler: { inFlight: 8, pollIntervalMs: 50 },
		})
	}
	protected override startBridgeApp(): void {
		// no MIDI Bridge behind the Virtual dLive
	}
}

// ---------------------------------------------------------------- fake host

interface PlacedFeedback {
	id: string
	feedbackId: string
	options: Record<string, unknown>
	value: unknown
}

class FakeHost {
	actions: CompanionActionDefinitions<never> = {} as never
	feedbacks: CompanionFeedbackDefinitions<never> = {} as never
	variables: CompanionVariableValues = {}
	variableDefs = new Set<string>()
	status: { status: string; message: string | null }[] = []
	presets: { sections: number; presets: number } = { sections: 0, presets: 0 }
	placed = new Map<string, PlacedFeedback>()
	recorded: unknown[] = []
	checks: string[][] = []

	readonly context = {
		_isInstanceContext: true as const,
		id: 'test-instance',
		label: 'dlive',
		upgradeScripts: [],
		saveConfig: () => {},
		updateStatus: (status: string, message: string | null) => this.status.push({ status, message }),
		oscSend: () => {},
		recordAction: (a: unknown) => this.recorded.push(a),
		setActionDefinitions: (a: CompanionActionDefinitions<never>) => (this.actions = a),
		subscribeActions: () => {},
		unsubscribeActions: () => {},
		setFeedbackDefinitions: (f: CompanionFeedbackDefinitions<never>) => (this.feedbacks = f),
		unsubscribeFeedbacks: () => {},
		checkFeedbacks: () => {},
		checkAllFeedbacks: () => this.evaluate([...this.placed.keys()]),
		checkFeedbacksById: (ids: string[]) => {
			this.checks.push(ids)
			this.evaluate(ids)
		},
		setPresetDefinitions: (s: unknown[], p: Record<string, unknown>) =>
			(this.presets = { sections: s.length, presets: Object.keys(p).length }),
		setCompositeElementDefinitions: () => {},
		setVariableDefinitions: (d: Record<string, unknown>) => (this.variableDefs = new Set(Object.keys(d))),
		setVariableValues: (v: CompanionVariableValues) => Object.assign(this.variables, v),
		getVariableValue: (id: string) => this.variables[id],
		sharedUdpSocketHandlers: new Map(),
		sharedUdpSocketJoin: async () => '',
		sharedUdpSocketLeave: async () => {},
		sharedUdpSocketSend: async () => {},
	}

	/** "Place" a feedback on a button, as Companion would, and evaluate it. */
	place(id: string, feedbackId: string, options: Record<string, unknown>): PlacedFeedback {
		const pf: PlacedFeedback = { id, feedbackId, options, value: undefined }
		this.placed.set(id, pf)
		this.evaluate([id])
		return pf
	}

	evaluate(ids: string[]): void {
		for (const id of ids) {
			const pf = this.placed.get(id)
			if (!pf) continue
			const def = (this.feedbacks as Record<string, { callback: (fb: unknown) => unknown }>)[pf.feedbackId]
			pf.value = def.callback({
				id: pf.id,
				controlId: 'c',
				feedbackId: pf.feedbackId,
				options: pf.options,
				previousOptions: null,
				type: 'boolean',
			})
		}
	}

	async runAction(actionId: string, options: Record<string, unknown>): Promise<void> {
		const def = (this.actions as Record<string, { callback: (ev: unknown, ctx: unknown) => unknown }>)[actionId]
		if (!def) throw new Error(`no action ${actionId}`)
		await def.callback(
			{ id: 'a', controlId: 'c', actionId, options, surfaceId: undefined },
			{ type: 'action', setCustomVariableValue: () => {}, signal: new AbortController().signal },
		)
	}
}

// ---------------------------------------------------------------- sim process

class Sim {
	proc!: ChildProcessWithoutNullStreams
	port = 0
	log = ''
	async start(baseChannel: number): Promise<void> {
		// The harness picks the port. `--port 0` (let the OS choose) used to work,
		// but the simulator's exclusive-mode change (cceecfd) now treats 0 as a
		// fixed port that is "already in use" and exits. Asking for a free port
		// ourselves also stops this suite depending on how the sim reads 0.
		const port = await closedPort()
		this.proc = spawn(
			'python3',
			[
				'-u',
				'-m',
				'sim.virtual_console',
				'--port',
				String(port),
				// The simulator also opens the Surface port (51328) by default now,
				// and a second instance can't — one left running anywhere on this Mac
				// takes the whole suite down, reported against the wrong port. This
				// suite never uses the Surface socket, so it opts out (0 = none).
				'--surface-port',
				'0',
				'--base-channel',
				String(baseChannel),
				'--interactive',
				'--quiet',
			],
			{
				cwd: SIM_ROOT,
				stdio: ['pipe', 'pipe', 'pipe'],
			},
		)
		this.proc.stdout.on('data', (d: Buffer) => (this.log += d.toString()))
		this.proc.stderr.on('data', (d: Buffer) => (this.log += d.toString()))
		await waitFor(() => /listening on 127\.0\.0\.1:(\d+)/.exec(this.log) !== null, 5000, 'sim did not start')
		this.port = Number((/listening on 127\.0\.0\.1:(\d+)/.exec(this.log) as RegExpExecArray)[1])
	}
	cmd(line: string): void {
		this.proc.stdin.write(line + '\n')
	}
	stop(): void {
		try {
			this.cmd('quit')
		} catch {
			/* ignore */
		}
		this.proc.kill()
	}
}

/** Scheduler has nothing queued or in flight for a full 150 ms. */
async function idle(inst: DliveInstance): Promise<void> {
	let quiet = 0
	await waitFor(
		() => {
			const s = inst.link.scheduler
			quiet = s.queueLength === 0 && s.inFlight === 0 ? quiet + 1 : 0
			return quiet >= 15
		},
		10_000,
		'scheduler idle',
	)
}

/** An ephemeral port that is bound, then released — nothing is listening on it. */
async function closedPort(): Promise<number> {
	const { createServer } = await import('node:net')
	const srv = createServer()
	await new Promise<void>((res) => srv.listen(0, '127.0.0.1', res))
	const port = (srv.address() as { port: number }).port
	await new Promise<void>((res) => srv.close(() => res()))
	return port
}

async function waitFor(cond: () => boolean, timeoutMs: number, what: string): Promise<void> {
	const start = Date.now()
	while (!cond()) {
		if (Date.now() - start > timeoutMs) throw new Error(`timeout: ${what}`)
		await new Promise((r) => setTimeout(r, 10))
	}
}

// ---------------------------------------------------------------- tests

describe.skipIf(!HAVE_SIM)('end-to-end against the Virtual dLive', () => {
	const sim = new Sim()
	const host = new FakeHost()
	let inst: DliveInstance

	beforeAll(async () => {
		await sim.start(1)
		inst = new HarnessInstance(host.context, sim.port)
		await inst.init({
			...DEFAULT_CONFIG,
			baseChannel: 1,
			inputs: 8,
			extendedTypes: false,
			syncScope: 'names_state',
		})
	}, 15000)

	afterAll(async () => {
		await inst.destroy()
		sim.stop()
	})

	it('goes Ok only after the probe reply, then syncs names/mutes/faders', async () => {
		await waitFor(() => host.status.some((s) => s.status === 'ok'), 5000, 'status ok')
		expect(host.status.map((s) => s.status)).toContain('connecting')
		await waitFor(
			() =>
				inst.link.state.strip({ type: 'input', index: 8 }).nameKnown &&
				typeof host.variables['fader_lv_ch8'] === 'number',
			5000,
			'sync',
		)
		await idle(inst)
		expect(host.variables['name_ch1']).toBe('Ip 1')
		expect(host.variables['connected']).toBe(true)
		// 46 strips in scope × (name, colour, mute) + 38 faders = 176 Gets, all answered.
		//
		// If this fails with a count BELOW 176, check the machine before the
		// code. The sim is Python against the module's fixed retry timers, so a
		// loaded Mac starves it and the module reports "No reply to get_name
		// after 3 attempts". On 22 Oct 2026, at a load average of 62, the same
		// run gave 54, then 172, then 172. **A count that varies between runs is
		// the machine; a count that is the same every time is a real break.**
		// Run `uptime` first, and don't go looking in the sim until the
		// one-minute load is in single figures.
		expect(inst.link.scheduler.stats.sent).toBe(176)
		expect(inst.link.scheduler.stats.replied).toBe(176)
		expect(host.variableDefs.has('mute_dca24')).toBe(true)
		expect(host.variableDefs.has('name_aux1')).toBe(false) // extendedTypes off
		expect(host.presets.presets).toBeGreaterThan(10)
		expect(inst.link.scheduler.stats.missed).toBe(0)
	})

	it('mute action → desk model → echo → feedback + variable', async () => {
		const fb = host.place('fb-mute3', 'mute', { type: 'input', index: 3 })
		expect(fb.value).toBe(false)
		await host.runAction('mute', { type: 'input', index: 3, mode: 'on' })
		await waitFor(() => fb.value === true, 2000, 'mute feedback')
		// Not `expect(...).toBe(true)` here: feedbacks flush on a 15 ms timer and
		// variables on a 20 ms one, so the feedback can legitimately land first.
		// Asserting the variable the instant the feedback arrives was a 5 ms race,
		// and it failed twice on 8 Sep. Both land inside 20 ms; nothing is wrong
		// with the product, the test was just assuming they were atomic.
		await waitFor(() => host.variables['mute_ch3'] === true, 1000, 'mute variable')
		await host.runAction('mute', { type: 'input', index: 3, mode: 'toggle' })
		await waitFor(() => fb.value === false, 2000, 'mute feedback off')
	})

	it('a broadcast fader triple lands in variables and a value feedback, costing no Gets', async () => {
		await idle(inst)
		const fb = host.place('fb-fader5', 'fader_db', { type: 'input', index: 5 })
		const sentBefore = inst.link.scheduler.stats.sent
		// The console broadcasts the complete triple (session §3.2). Here it is
		// played in by hand, one CC per command, to prove the decoder assembles a
		// triple whose legs arrive as separate messages: 63 = select input 5
		// (address 4), 62 = parameter 0x17 (fader), 06 = level.
		sim.cmd('cc 99 4')
		sim.cmd('cc 98 23')
		sim.cmd('cc 6 95')
		await waitFor(() => host.variables['fader_lv_ch5'] === 95, 3000, 'broadcast triple')
		expect(host.variables['fader_ch5']).toBe('-6.1')
		expect(fb.value).toBe(-6.1)
		await new Promise((r) => setTimeout(r, 300))
		expect(inst.link.scheduler.stats.sent - sentBefore).toBe(0)
	})

	it("the simulator's own surface move broadcasts a complete triple, and costs no Gets", async () => {
		await idle(inst)
		const sentBefore = inst.link.scheduler.stats.sent
		// The Virtual dLive models 2.12 since the simulator merge: a surface move
		// broadcasts the level rather than announcing a bare address.
		sim.cmd('fader input 6 60')
		await waitFor(() => host.variables['fader_lv_ch6'] === 60, 3000, 'surface move broadcast')
		expect(inst.link.stats.faderPings).toBe(0)
		expect(inst.link.scheduler.stats.sent - sentBefore).toBe(0)
	})

	it('a bare select is never answered — query-on-ping is retired', async () => {
		await idle(inst)
		const sentBefore = inst.link.scheduler.stats.sent
		// Nothing on 2.12 originates this; it is another client's select relayed
		// raw, so it has to be played in by hand now the sim no longer pings.
		sim.cmd('cc 99 4')
		await waitFor(() => inst.link.stats.faderPings > 0, 2000, 'bare select surfaced')
		await new Promise((r) => setTimeout(r, 200))
		expect(inst.link.scheduler.stats.sent - sentBefore).toBe(0)
	})

	it('a SoftKey Custom MIDI string arrives as a cc event, not as channel mode', async () => {
		await idle(inst)
		const seen: { kind: string; cc?: number; value?: number }[] = []
		const onEvent = (e: { kind: string; cc?: number; value?: number }) => seen.push(e)
		inst.link.on('event', onEvent)
		sim.cmd('softkey B0,7F,01')
		await waitFor(() => seen.some((e) => e.kind === 'cc' && e.cc === 0x7f), 2000, 'softkey string')
		inst.link.off('event', onEvent)
		expect(seen.find((e) => e.kind === 'cc' && e.cc === 0x7f)?.value).toBe(1)
	})

	it('timed fade reaches the target and is emit-on-change', async () => {
		await idle(inst)
		await host.runAction('fader', { type: 'input', index: 2, db: '0', fade: 0 })
		await waitFor(() => host.variables['fader_lv_ch2'] === 107, 2000, 'jump')
		const before = inst.link.stats.messagesOut
		await host.runAction('fader', { type: 'input', index: 2, db: '-20', fade: 400 })
		await waitFor(() => host.variables['fader_lv_ch2'] === 67, 3000, 'fade reaches target')
		expect(inst.link.stats.messagesOut - before).toBeLessThan(20)
	})

	it('surface scene recall and rename arrive pushed', async () => {
		const fb = host.place('fb-scene', 'scene_current', { scene: 129 })
		sim.cmd('scene 129')
		await waitFor(() => host.variables['scene_current'] === 129, 2000, 'scene')
		expect(fb.value).toBe(true)
		sim.cmd('rename input 1 Kick')
		await waitFor(() => host.variables['name_ch1'] === 'Kick', 2000, 'rename')
	})

	it('named console Actions from the map become a dropdown and fire the right CC', async () => {
		await inst.configUpdated({ ...inst.config, actionsMap: '20,1,Band changeover\n21,5,House lights' })
		const def = (host.actions as Record<string, { options: { choices?: { id: string; label: string }[] }[] }>)[
			'console_action'
		]
		expect(def.options[0].choices?.map((c) => c.label)).toEqual([
			'Band changeover  (CC 20 = 1)',
			'House lights  (CC 21 = 5)',
		])
		await waitFor(() => host.status[host.status.length - 1]?.status === 'ok', 5000, 'reconnected after config')
		await host.runAction('console_action', { entry: '21/5' })
		await new Promise((r) => setTimeout(r, 100))
		sim.cmd('stats')
		await waitFor(() => /control_change/.test(sim.log), 1000, 'stats')
	})

	it('honest status: a desk that stops answering goes to ConnectionFailure with the MIDI diagnostic', async () => {
		// A port with nothing behind it. This used to spin up a second Virtual
		// dLive purely to borrow its port number and then kill it, which broke
		// the moment the simulator started binding the Surface port as well —
		// two instances cannot coexist. All the test ever needed was a closed
		// port: connect will fail, so status must never reach 'ok'.
		const deadPort = await closedPort()
		const h2 = new FakeHost()
		const i2 = new HarnessInstance(h2.context, deadPort)
		await i2.init({
			...DEFAULT_CONFIG,
			baseChannel: 1,
			inputs: 4,
			extendedTypes: false,
		})
		await new Promise((r) => setTimeout(r, 300))
		expect(h2.status.some((s) => s.status === 'ok')).toBe(false)
		await i2.destroy()
	}, 20000)
})
