import { describe, expect, it } from 'vitest'
import { ConsoleState } from './state/model.js'
import { allVariableValues, type MetaValues, type VariableScope } from './variables.js'

const SCOPE: VariableScope = { inputs: 8, extendedTypes: false }
const META: MetaValues = { firmware: '', baseChannel: 1, getsInFlight: 0, getsMissed: 0, unsupported: '' }

function valuesFor(apply?: (s: ConsoleState) => void) {
	const state = new ConsoleState()
	apply?.(state)
	return allVariableValues(state, SCOPE, META)
}

describe('stereo variables', () => {
	it("reads empty, not false, where the desk can't say", () => {
		// A dLive cannot report an input's link, and the Client API spec is
		// explicit that this means "can't say", never mono. Until 2026-10-27
		// linked_chN read `false` on every shipped connection — the module
		// stating as fact something no console had told it.
		const v = valuesFor()
		expect(v['linked_ch1']).toBe('')
		expect(v['partner_ch1']).toBe('')
		expect(v['width_ch1']).toBe('')
	})

	it('reports a real link as a real link', () => {
		// the SQ-5, 21 Oct: inputs 1 and 2 linked
		const v = valuesFor((s) =>
			s.apply({ kind: 'stereo', type: 'input', index: 1, linked: true, half: 'A', partner: 2, width: undefined }),
		)
		expect(v['linked_ch1']).toBe(true)
		expect(v['partner_ch1']).toBe(2)
	})

	it('reports a stereo strip without inventing a partner', () => {
		// the Wing, 27 Oct: {"width": "stereo"} on 26 keys. It says the strip
		// is stereo and nothing whatever about pairing, so linked stays empty.
		const v = valuesFor((s) =>
			s.apply({
				kind: 'stereo',
				type: 'input',
				index: 1,
				linked: undefined,
				half: undefined,
				partner: undefined,
				width: 'stereo',
			}),
		)
		expect(v['width_ch1']).toBe('stereo')
		expect(v['linked_ch1']).toBe('')
		expect(v['partner_ch1']).toBe('')
	})

	it('still reports an explicit false as false', () => {
		// the SQ says {"linked": false} for an unlinked input: that IS an
		// answer, and must not be flattened into "can't say".
		const v = valuesFor((s) =>
			s.apply({
				kind: 'stereo',
				type: 'input',
				index: 1,
				linked: false,
				half: undefined,
				partner: undefined,
				width: undefined,
			}),
		)
		expect(v['linked_ch1']).toBe(false)
	})
})
