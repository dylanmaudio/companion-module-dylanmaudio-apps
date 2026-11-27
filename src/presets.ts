/**
 * Presets — template groups (API 2.1): one parameterised button per kind,
 * expanded over every strip in scope. The strip number lives in a local
 * variable (`$(local:ch)`), the desk name and level come through feedback
 * local variables, so a Stream Deck page labels and colours itself from
 * the show.
 */

import { combineRgb, type CompanionPresetDefinitions, type CompanionPresetSection } from '@companion-module/base'
import type { ModuleSchema } from './main.js'
import type { ModuleContext } from './context.js'
import { CHANNEL_TABLE, CHANNEL_TYPES, type ChannelType } from './protocol/channels.js'
import { scopedStrips, type VariableScope } from './variables.js'

const WHITE = combineRgb(255, 255, 255)
const BLACK = combineRgb(0, 0, 0)
const DARK = combineRgb(20, 20, 20)
const RED = combineRgb(200, 0, 0)
const GREEN = combineRgb(0, 160, 60)
/** muted: darker than any desk colour, so a red channel still reads as muted */
const MUTED = combineRgb(90, 0, 0)

// Never 'auto' — it picks a size per label, so a row of channel names came out
// at half a dozen sizes. A fixed size doesn't shrink either: it breaks the word
// ("Maste r"), and a dLive name runs to eight characters. A key fits about
// 84 / size characters, so 10 holds the longest name whole.
const TEXT = 10
/** fixed labels, short by construction */
const LABEL = 14

const expr = (value: string) => ({ isExpression: true as const, value })

export function buildPresets(
	ctx: ModuleContext,
	scope: VariableScope,
): { sections: CompanionPresetSection<ModuleSchema>[]; presets: CompanionPresetDefinitions<ModuleSchema> } {
	const presets: CompanionPresetDefinitions<ModuleSchema> = {}
	const sections: CompanionPresetSection<ModuleSchema>[] = []

	const counts = new Map<ChannelType, number>()
	for (const ref of scopedStrips(scope)) counts.set(ref.type, Math.max(counts.get(ref.type) ?? 0, ref.index))
	const typesInScope = CHANNEL_TYPES.filter((t) => counts.has(t))

	// ---------------------------------------------------------------- per-type templates
	const nameVar = (type: ChannelType) => ({
		variableType: 'feedback' as const,
		variableName: 'name',
		feedbackId: 'channel_name',
		options: { type, index: expr('$(local:ch)') },
	})
	const dbVar = (type: ChannelType) => ({
		variableType: 'feedback' as const,
		variableName: 'db',
		feedbackId: 'fader_text',
		options: { type, index: expr('$(local:ch)') },
	})
	const chVar = { variableType: 'simple' as const, variableName: 'ch', startupValue: 1 }

	for (const type of typesInScope) {
		const label = CHANNEL_TABLE[type].label
		const n = counts.get(type) ?? 0
		const values = Array.from({ length: n }, (_, i) => ({ value: i + 1, name: `${label} ${i + 1}` }))

		// Mute toggle — red when muted, desk colour otherwise
		presets[`mute_${type}`] = {
			type: 'simple',
			name: `${label} mute`,
			style: { text: '$(local:name)', textExpression: false, size: TEXT, color: WHITE, bgcolor: DARK },
			localVariables: [chVar, nameVar(type)],
			feedbacks: [
				{ feedbackId: 'channel_colour', options: { type, index: expr('$(local:ch)'), text: true } },
				{
					feedbackId: 'mute',
					options: { type, index: expr('$(local:ch)') },
					// says it as well as colours it: a red channel is red either way
					style: { bgcolor: MUTED, color: WHITE, text: '$(local:name)\\nMUTED', size: TEXT },
				},
			],
			steps: [{ down: [{ actionId: 'mute', options: { type, index: expr('$(local:ch)'), mode: 'toggle' } }], up: [] }],
		}
		sections.push({
			id: `mutes_${type}`,
			name: `Mutes — ${label}s`,
			definitions: [
				{
					id: `mutes_${type}_t`,
					type: 'template',
					name: `${label} mute`,
					presetId: `mute_${type}`,
					templateVariableName: 'ch',
					templateValues: values,
				},
			],
		})

		if (type === 'mute_group') continue

		// Level readout + nudge
		presets[`level_${type}`] = {
			type: 'simple',
			name: `${label} level`,
			style: { text: '$(local:name)\\n$(local:db)', textExpression: false, size: TEXT, color: WHITE, bgcolor: DARK },
			localVariables: [chVar, nameVar(type), dbVar(type)],
			feedbacks: [{ feedbackId: 'channel_colour', options: { type, index: expr('$(local:ch)'), text: true } }],
			steps: [
				{ down: [{ actionId: 'fader', options: { type, index: expr('$(local:ch)'), db: '0', fade: 0 } }], up: [] },
			],
		}
		presets[`up_${type}`] = {
			type: 'simple',
			name: `${label} +1 dB`,
			style: {
				text: '$(local:name)\\n▲ $(local:db)',
				textExpression: false,
				size: TEXT,
				color: WHITE,
				bgcolor: DARK,
			},
			localVariables: [chVar, nameVar(type), dbVar(type)],
			feedbacks: [],
			steps: [
				{
					down: [{ actionId: 'fader_step', options: { type, index: expr('$(local:ch)'), delta: 1, fade: 0 } }],
					up: [],
					500: {
						options: { runWhileHeld: true },
						actions: [{ actionId: 'fader_step', options: { type, index: expr('$(local:ch)'), delta: 1, fade: 0 } }],
					},
				},
			],
		}
		presets[`down_${type}`] = {
			type: 'simple',
			name: `${label} −1 dB`,
			style: {
				text: '$(local:name)\\n▼ $(local:db)',
				textExpression: false,
				size: TEXT,
				color: WHITE,
				bgcolor: DARK,
			},
			localVariables: [chVar, nameVar(type), dbVar(type)],
			feedbacks: [],
			steps: [
				{
					down: [{ actionId: 'fader_step', options: { type, index: expr('$(local:ch)'), delta: -1, fade: 0 } }],
					up: [],
					500: {
						options: { runWhileHeld: true },
						actions: [{ actionId: 'fader_step', options: { type, index: expr('$(local:ch)'), delta: -1, fade: 0 } }],
					},
				},
			],
		}
		// A key that *shows* the timed fade exists. Every other level preset
		// ships `fade: 0`, so the option was only ever met by scrolling the
		// action's own fields — and the operator never did (#771). 3 s is a
		// usable default for a music change rather than a demo value.
		presets[`fade_${type}`] = {
			type: 'simple',
			name: `${label} to 0 dB over 3 s`,
			style: {
				text: '$(local:name)\\n0 dB ⟶ 3 s',
				textExpression: false,
				size: TEXT,
				color: WHITE,
				bgcolor: DARK,
			},
			localVariables: [chVar, nameVar(type), dbVar(type)],
			feedbacks: [],
			steps: [
				{
					down: [{ actionId: 'fader', options: { type, index: expr('$(local:ch)'), db: '0', fade: 3000 } }],
					up: [],
				},
			],
		}
		sections.push({
			id: `levels_${type}`,
			name: `Faders — ${label}s`,
			definitions: [
				{
					id: `levels_${type}_t`,
					type: 'template',
					name: `${label}: to 0 dB (shows level)`,
					presetId: `level_${type}`,
					templateVariableName: 'ch',
					templateValues: values,
				},
				{
					id: `up_${type}_t`,
					type: 'template',
					name: `${label}: +1 dB`,
					presetId: `up_${type}`,
					templateVariableName: 'ch',
					templateValues: values,
				},
				{
					id: `down_${type}_t`,
					type: 'template',
					name: `${label}: −1 dB`,
					presetId: `down_${type}`,
					templateVariableName: 'ch',
					templateValues: values,
				},
				{
					id: `fade_${type}_t`,
					type: 'template',
					name: `${label}: to 0 dB over 3 s`,
					presetId: `fade_${type}`,
					templateVariableName: 'ch',
					templateValues: values,
				},
			],
		})
	}

	// ---------------------------------------------------------------- scenes
	// Named from the show where it has names, so the list reads "12 Changeover", not "Scene 12".
	const sceneNames = ctx.link.state.sceneNames
	const sceneValues = Array.from({ length: 500 }, (_, i) => {
		const name = sceneNames.get(i + 1)
		return { value: i + 1, name: name ? `${i + 1} ${name}` : `Scene ${i + 1}` }
	})
	presets.scene_recall = {
		type: 'simple',
		name: 'Recall scene',
		// The name comes through a feedback local variable, as a strip's name does: a variable
		// named from another ($(conn:scene_name_$(local:sc))) doesn't resolve in Companion.
		style: { text: '$(local:sc)\\n$(local:name)', textExpression: false, size: TEXT, color: WHITE, bgcolor: DARK },
		localVariables: [
			{ variableType: 'simple', variableName: 'sc', startupValue: 1 },
			{
				variableType: 'feedback',
				variableName: 'name',
				feedbackId: 'scene_name',
				options: { scene: expr('$(local:sc)') },
			},
		],
		feedbacks: [
			{ feedbackId: 'scene_current', options: { scene: expr('$(local:sc)') }, style: { bgcolor: GREEN, color: WHITE } },
		],
		steps: [{ down: [{ actionId: 'scene_recall', options: { scene: expr('$(local:sc)') } }], up: [] }],
	}
	// No GO / Next / Previous keys (#55): they are Surface-socket CCs, and the
	// bridge's one console connection is the MixRack's. The actions remain, and
	// say so, for anyone whose buttons already carry them.
	presets.scene_current = {
		type: 'simple',
		name: 'Current scene display',
		style: {
			text: `$(${ctx.label}:scene_current)\\n$(${ctx.label}:scene_current_name)`,
			size: TEXT,
			color: WHITE,
			bgcolor: DARK,
		},
		feedbacks: [],
		steps: [{ down: [], up: [] }],
	}
	sections.push({
		id: 'scenes',
		name: 'Scenes',
		definitions: [
			{
				id: 'scene_nav',
				type: 'simple',
				name: 'Current scene',
				presets: ['scene_current'],
			},
			{
				id: 'scene_recall_t',
				type: 'template',
				name: 'Recall scene',
				presetId: 'scene_recall',
				templateVariableName: 'sc',
				templateValues: sceneValues,
			},
		],
	})

	// ---------------------------------------------------------------- console Actions (named)
	if (ctx.actionsMap.length > 0) {
		const ids: string[] = []
		ctx.actionsMap.forEach((e, i) => {
			const id = `console_action_${i}`
			ids.push(id)
			presets[id] = {
				type: 'simple',
				name: e.name,
				style: { text: e.name, size: TEXT, color: BLACK, bgcolor: combineRgb(230, 200, 60) },
				feedbacks: [],
				steps: [{ down: [{ actionId: 'console_action', options: { entry: `${e.cc}/${e.value}` } }], up: [] }],
			}
		})
		sections.push({ id: 'console_actions', name: 'Console Actions', definitions: ids })
	}

	// ---------------------------------------------------------------- status
	presets.status = {
		type: 'simple',
		name: 'Console status',
		style: { text: `dLive\\n$(${ctx.label}:firmware)`, size: LABEL, color: WHITE, bgcolor: RED },
		feedbacks: [{ feedbackId: 'connected', options: {}, style: { bgcolor: GREEN, color: WHITE } }],
		steps: [{ down: [{ actionId: 'resync', options: {} }], up: [] }],
	}
	sections.push({ id: 'status', name: 'Status', definitions: ['status'] })

	return { sections, presets }
}
