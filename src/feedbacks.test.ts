/**
 * The feedbacks the bridge's state mirror cannot answer.
 *
 * Client API v1 mirrors mutes, faders, names, colours, stereo links, the
 * scene and the connection. The param family — assigns, HPF, preamps, send
 * levels — has no path there, so those feedbacks read back only what this
 * module set. That is a real limitation and companion/HELP.md states it; what
 * it also promised was that the limitation is *visible*, in
 * `$(<label>:unsupported_gets)`. It wasn't: the only thing that filled that
 * variable was BridgeLink.query(), and nothing but an action ever called it.
 * A feedback simply sat at false, silently, which is how it reached a customer
 * (23 Nov 2026) as "all the feedbacks that pull actual values from the console
 * report false".
 *
 * So each of those feedbacks now asks for its value when its subscription is
 * new, which in bridge mode is what records the op.
 */
import { describe, expect, it } from 'vitest'
import type { ModuleContext } from './context.js'
import { buildFeedbacks } from './feedbacks.js'
import { ConsoleState } from './state/model.js'
import { SubscriptionRegistry } from './state/subscriptions.js'

type Json = Record<string, any>

/** The wording buildFeedbacks puts on every feedback the mirror cannot answer. */
const LOCAL_ONLY_MARK = 'bridge state mirror does not carry this value'

function harness() {
	const asked: { op: string; path: string }[] = []
	const ctx = {
		link: {
			state: new ConsoleState(),
			subscriptions: new SubscriptionRegistry(),
			query: (intent: Json, path: string) => asked.push({ op: intent.op as string, path }),
		},
		config: { sendsInDb: true },
		actionsMap: [],
		label: 'dLive',
		log: () => undefined,
		reloadShowFile: async () => undefined,
		resync: () => undefined,
	} as unknown as ModuleContext
	return { ctx, asked, defs: buildFeedbacks(ctx) as Record<string, Json> }
}

describe('feedbacks the mirror cannot answer', () => {
	it('asks for the value once, when the subscription is new', () => {
		const { asked, defs } = harness()
		const hpf = defs.hpf_on

		hpf.callback({ id: 'fb1', options: { index: 1 } }, {})
		expect(asked).toEqual([{ op: 'get_param', path: 'param/input/1/49' }])

		// every later evaluation of the same button asks nothing more
		hpf.callback({ id: 'fb1', options: { index: 1 } }, {})
		hpf.callback({ id: 'fb1', options: { index: 1 } }, {})
		expect(asked).toHaveLength(1)

		// editing the option is a new subscription, so it primes again
		hpf.callback({ id: 'fb1', options: { index: 2 } }, {})
		expect(asked).toHaveLength(2)
		expect(asked[1]).toEqual({ op: 'get_param', path: 'param/input/2/49' })
	})

	it('asks nothing for a feedback the mirror does answer', () => {
		const { asked, defs } = harness()
		defs.mute.callback({ id: 'fb1', options: { type: 'input', index: 1 } }, {})
		defs.channel_name.callback({ id: 'fb2', options: { type: 'input', index: 1 } }, {})
		defs.fader_db.callback({ id: 'fb3', options: { type: 'input', index: 1 } }, {})
		expect(asked).toEqual([])
	})

	it('every feedback that says it is local-only actually asks — so the variable fills', () => {
		const { defs } = harness()
		const localOnly = Object.entries(defs).filter(([, d]) => String(d.description ?? '').includes(LOCAL_ONLY_MARK))
		// the param family: the three assigns, mix assign, send level, HPF, the three preamps
		expect(localOnly.map(([id]) => id).sort()).toEqual([
			'dca_assigned',
			'hpf_on',
			'main_assigned',
			'mix_assigned',
			'mute_group_assigned',
			'preamp_48v',
			'preamp_gain',
			'preamp_pad',
			'send_level',
		])
		for (const [id, def] of localOnly) {
			const { asked, defs: fresh } = harness()
			const opts: Json = {}
			for (const f of (def.options ?? []) as Json[]) opts[f.id] = f.default
			fresh[id].callback({ id: `fb_${id}`, options: opts }, {})
			expect(asked.length, `${id} asked for nothing, so it will never report itself unsupported`).toBeGreaterThan(0)
		}
	})
})
