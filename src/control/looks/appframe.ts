/**
 * "Which app is this key?": a frame in the app's bright colour on all four
 * edges, and a small badge with its initials in the top-left corner.
 *
 * Off by default, per connection (config `appFrame`). On a page that holds
 * one app, the identity key already says whose page it is, and the rest of
 * the deck stays neutral so that state has something to say. It is for pages
 * that mix apps, where Console Control's Next Marker and Show Recorder's
 * Next sit side by side. The operator chose frame + badge from four
 * candidates on a real deck (21 Nov 2026).
 *
 * The frame is the bg box's own border, so a feedback that recolours bg keeps
 * it. It uses the app's bright `main` colour: a frame carries no text, and the
 * contrast rule that keeps keys on `deep` is about text. The badge carries
 * text, so it wears `deep`. Show Recorder's bright red is close to the
 * show-critical bar's red; the bar is drawn over the frame (safety over
 * identity), and the badge still says SR in words.
 */
import type { AppId } from '../registry.js'
import type { Brand } from '../types.js'
import type { Json, Preset, Presets } from './layers.js'
import { brandOf } from './palette.js'

/** The badge's initials, one pair per app. */
export const APP_TAG: Record<AppId, string> = {
	bridge: 'CB',
	tlt: 'TL',
	ptt: 'PT',
	tct: 'TC',
	cxc: 'CC',
	sr: 'SR',
}

/** Frame width, as a percent of the key's longer side. */
export const FRAME_WIDTH = 4
/** The show-critical bar's height (definitions.ts draws it at 8). */
const CRITICAL_H = 8
const BADGE = { w: 26, h: 17, inset: 3 }

/** One preset with the frame and the badge. Presets without a bg box are left as they are. */
export function frameWithApp(preset: Preset, app: AppId, reported?: Brand | null): Preset {
	const p = structuredClone(preset) as unknown as { elements?: Json[] }
	const els = p.elements
	const bg = els?.find((e) => e.id === 'bg')
	if (!els || !bg) return preset
	const { main, deep } = brandOf(app, reported)
	Object.assign(bg, { borderColor: main.bg, borderWidth: FRAME_WIDTH, borderPosition: 'inside' })
	// Below a critical bar the frame's top edge is already covered, so the badge sits under the bar.
	const critical = els.some((e) => e.id === 'critical')
	const at = {
		x: BADGE.inset + FRAME_WIDTH,
		y: critical ? CRITICAL_H + BADGE.inset : BADGE.inset + FRAME_WIDTH,
		width: BADGE.w,
		height: BADGE.h,
	}
	// Make room. Text keeps inside the frame, so shrink-to-fit measures what is
	// really left. A caption across the top (a readout's) starts after the badge.
	// A label that fills the key starts below it. A mark is one narrow, centred
	// glyph that clears the corner, so it stays the size it was.
	const badgeRight = at.x + at.width + 1
	const badgeBottom = at.y + at.height + 1
	for (const e of els) {
		if (e.type !== 'text' || e.id === 'mark') continue
		let x = Number(e.x),
			w = Number(e.width),
			y = Number(e.y),
			h = Number(e.height)
		const right = Math.min(x + w, 100 - FRAME_WIDTH)
		x = Math.max(x, FRAME_WIDTH)
		w = right - x
		if (y < badgeBottom && y + h > at.y) {
			if (h <= 40) {
				x = Math.max(x, badgeRight)
				w = right - x
			} else if (h > 60) {
				h -= badgeBottom - y
				y = badgeBottom
			}
		}
		Object.assign(e, { x, y, width: w, height: h })
	}
	els.push(
		{ type: 'box', id: 'appBadge', ...at, color: deep.bg, cornerRadius: 30 },
		{
			type: 'text',
			id: 'appBadgeText',
			...at,
			text: APP_TAG[app],
			// 11% of the key, as a percent of the badge's own height (fontsize is relative to its box)
			fontsize: Math.round((11 * 120) / BADGE.h),
			fontsizeAllowShrink: true,
			font: 'companion-sans',
			color: deep.text,
			halign: 'center',
			valign: 'center',
		},
	)
	return p as unknown as Preset
}

/** Every preset in a set, framed. */
export function frameAllWithApp(presets: Presets, app: AppId, reported?: Brand | null): Presets {
	return Object.fromEntries(Object.entries(presets).map(([id, p]) => [id, p && frameWithApp(p, app, reported)]))
}
