import type {
	DropdownChoice,
	SomeCompanionActionInputField,
	SomeCompanionFeedbackInputField,
} from '@companion-module/base'
import {
	ASSIGNABLE_TYPES,
	CHANNEL_TABLE,
	CHANNEL_TYPES,
	COLOURS,
	FADER_TYPES,
	MIX_ASSIGN_DESTINATION_TYPES,
	PEQ_TYPES,
	SEND_DESTINATION_TYPES,
	SEND_SOURCE_TYPES,
	SOCKET_BANK_TABLE,
	SOCKET_BANKS,
	type ChannelType,
} from './protocol/channels.js'

export function typeChoices(types: readonly ChannelType[] = CHANNEL_TYPES): DropdownChoice[] {
	return types.map((t) => ({ id: t, label: CHANNEL_TABLE[t].label }))
}

export const CHOICES_ALL_TYPES = typeChoices()
export const CHOICES_FADER_TYPES = typeChoices(FADER_TYPES)
export const CHOICES_ASSIGNABLE_TYPES = typeChoices(ASSIGNABLE_TYPES)
export const CHOICES_SEND_SOURCE = typeChoices(SEND_SOURCE_TYPES)
export const CHOICES_SEND_DEST = typeChoices(SEND_DESTINATION_TYPES)
export const CHOICES_MIX_DEST = typeChoices(MIX_ASSIGN_DESTINATION_TYPES)
export const CHOICES_PEQ_TYPES = typeChoices(PEQ_TYPES)

export const CHOICES_ON_OFF_TOGGLE: DropdownChoice[] = [
	{ id: 'on', label: 'On' },
	{ id: 'off', label: 'Off' },
	{ id: 'toggle', label: 'Toggle' },
]

export const CHOICES_COLOURS: DropdownChoice[] = COLOURS.map((c) => ({
	id: c,
	label: c === 'lt_blue' ? 'Light Blue' : c[0].toUpperCase() + c.slice(1),
}))

export const CHOICES_SOCKET_BANKS: DropdownChoice[] = SOCKET_BANKS.map((b) => ({
	id: b,
	label: SOCKET_BANK_TABLE[b].label + 's',
}))

type Field = SomeCompanionActionInputField & SomeCompanionFeedbackInputField

/** A strip selector: type dropdown + 1-based index. Index accepts expressions ($(custom:ch)). */
export function channelFields(
	opts: { types?: DropdownChoice[]; prefix?: string; label?: string; defaultType?: ChannelType } = {},
): Field[] {
	const p = opts.prefix ? `${opts.prefix}_` : ''
	const label = opts.label ? `${opts.label} ` : ''
	return [
		{
			type: 'dropdown',
			id: `${p}type`,
			label: `${label}Type`,
			default: opts.defaultType ?? 'input',
			choices: opts.types ?? CHOICES_ALL_TYPES,
		},
		{
			type: 'number',
			id: `${p}index`,
			label: `${label}Number`,
			tooltip: 'As shown on the console (1-based). Accepts an expression.',
			default: 1,
			min: 1,
			max: 128,
		},
	]
}

export function socketFields(): Field[] {
	return [
		{ type: 'dropdown', id: 'bank', label: 'Sockets', default: 'mixrack', choices: CHOICES_SOCKET_BANKS },
		{
			type: 'number',
			id: 'socket',
			label: 'Socket',
			tooltip: 'Physical socket number, not channel — the desk addresses preamps by socket.',
			default: 1,
			min: 1,
			max: 64,
		},
	]
}

export const FADE_FIELD: Field = {
	type: 'number',
	id: 'fade',
	// The unit is in the label as well as the tooltip, and with a worked
	// number. On 27 Nov 2026 the operator asked for "fade to a level over
	// time" as a new feature, having had it since 1.0: they were hand-riding
	// ±1 dB keys instead. 'Fade (ms)' next to a 0 default reads as a
	// switch you leave alone, and nobody converts seconds in their head
	// mid-show. companion/HELP.md says the same thing the same way.
	label: 'Fade (ms — 3000 = 3 s)',
	tooltip:
		'How long to travel to the new level. 0 = jump. Milliseconds, so a 3 second fade is 3000. Ramps are dB-linear and only send when the value changes, so a 3 s fade is ~60 messages, not 600.',
	default: 0,
	min: 0,
	max: 600_000,
}

export const DB_FIELD = (id: string, label: string, dflt: string): Field => ({
	type: 'textinput',
	id,
	label,
	tooltip: 'dB, e.g. 0, -6, +3.5, -inf. Accepts an expression.',
	default: dflt,
	useVariables: true,
})
