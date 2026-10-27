/**
 * The Surface-socket actions refuse (#55). The MIDI Bridge has one console
 * connection, the MixRack's, and these bytes mean something else there:
 * on the Virtual dLive, "cue list: recall ID 11" recalled SCENE 12. A key
 * marked "cue" must not move the show to the wrong scene, so they send
 * nothing and say why.
 */
import { describe, expect, it } from 'vitest'
import { buildActions } from './actions.js'
import { DEFAULT_CONFIG } from './config.js'
import type { ModuleContext } from './context.js'

type Json = Record<string, any>

function ctxOf(): { ctx: ModuleContext; sent: Json[]; logs: string[] } {
	const sent: Json[] = []
	const logs: string[] = []
	const ctx = {
		link: {
			send: (intent: Json) => sent.push(intent),
			state: { currentScene: undefined },
			subscriptions: { touch: () => undefined, remove: () => undefined },
		},
		config: { ...DEFAULT_CONFIG, goCc: 85, goValue: 127, nextCc: 86, nextValue: 127, prevCc: 87, prevValue: 127 },
		actionsMap: [],
		label: 'midi_bridge',
		log: (_level: string, message: string) => logs.push(message),
		reloadShowFile: async () => undefined,
		resync: () => undefined,
	} as unknown as ModuleContext
	return { ctx, sent, logs }
}

const SURFACE = ['scene_go', 'scene_next', 'scene_prev', 'cue_list_recall', 'surface_cc']

describe('Surface-socket actions', () => {
	for (const id of SURFACE) {
		it(`${id} sends nothing, and the log says why`, async () => {
			const { ctx, sent, logs } = ctxOf()
			const def = buildActions(ctx)[id]
			expect(def, id).toBeDefined()
			await def?.callback({ options: { id: 11, cc: 85, value: 127 } }, {})
			expect(sent, id).toEqual([])
			expect(logs.join(' '), id).toMatch(/Surface socket/)
		})
	}

	it('says so in the name too, so the action list shows it', () => {
		const defs = buildActions(ctxOf().ctx)
		for (const id of SURFACE) expect(defs[id]?.name, id).toMatch(/Surface socket/)
	})

	it('scene recall still goes out — it is a MixRack message', async () => {
		const { ctx, sent } = ctxOf()
		await buildActions(ctx).scene_recall?.callback({ options: { scene: 12 } }, {})
		// Both keys leave the action; BridgeLink drops whichever the console
		// cannot use, because only it knows the family. An empty number box
		// means "the Scene field is the number", which is true on every desk
		// where place and number coincide.
		expect(sent).toEqual([{ op: 'scene', scene: 12, scene_number: 12 }])
	})

	it('carries a decimal scene number no integer field could hold', async () => {
		// the SD11, 27 Oct: a snapshot inserted between 1 and 2 is numbered 1.50
		const { ctx, sent } = ctxOf()
		await buildActions(ctx).scene_recall?.callback({ options: { scene: 2, scene_number: '1.5' } }, {})
		expect(sent).toEqual([{ op: 'scene', scene: 2, scene_number: 1.5 }])
	})

	it('refuses a scene number that is not one, rather than recalling something else', async () => {
		// run() logs and swallows, as it does for a bad dB value: a typo must
		// not fall back to the Scene field and recall a different snapshot.
		const { ctx, sent, logs } = ctxOf()
		await buildActions(ctx).scene_recall?.callback({ options: { scene: 1, scene_number: 'two' } }, {})
		expect(sent).toEqual([])
		expect(logs.join('\n')).toMatch(/not a scene number/)
	})
})
