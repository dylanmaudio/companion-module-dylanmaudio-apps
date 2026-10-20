/**
 * Fader level ↔ dB. docs/protocol.md §3.2.
 *
 * The dLive taper is not a clean function — every formula tried drifts
 * somewhere, and A&H's published anchors are wrong at +5 dB and below
 * −25 dB. The mapping is a measured table or it is wrong.
 *
 * MEASURED: 53 points from a full-range sweep against firmware 1.94
 * (Reaper Automation Pack calibration, reproduced in the dLive Utility Apps
 * `shared/target/dlive/tables.py`). 0x6B (107) = 0.0 dB; ~0.5 dB/step near
 * unity. Unmeasured LVs are linearly interpolated between neighbours —
 * fine for display, never a source of new calibration data.
 *
 * Send levels are a different SysEx surface and are NOT known to follow
 * this table; the module shows raw values for sends until calibrated.
 *
 * The EQ width table, the EQ/HPF frequency curves and the preamp gain
 * mapping below are derived from the MIT-licensed
 * companion-module-allenheath-dlive (Tim Steer) and
 * companion-module-allenheath-dlive-ilive (Andrew Broughton et al.);
 * see the Credits section in README.md.
 */

export const FADER_CAL_FIRMWARE = '1.94'

const MEASURED: ReadonlyArray<readonly [lv: number, db: number | null]> = [
	[0, null],
	[8, -49.9],
	[18, -44.9],
	[28, -39.8],
	[38, -34.8],
	[48, -29.8],
	[57, -25.2],
	[67, -20.2],
	[69, -19.2],
	[71, -18.2],
	[73, -17.2],
	[75, -16.2],
	[77, -15.1],
	[79, -14.1],
	[81, -13.1],
	[83, -12.1],
	[85, -11.1],
	[87, -10.1],
	[88, -9.6],
	[89, -9.1],
	[90, -8.6],
	[91, -8.1],
	[92, -7.6],
	[93, -7.1],
	[94, -6.6],
	[95, -6.1],
	[96, -5.6],
	[97, -5.1],
	[98, -4.6],
	[99, -4.1],
	[100, -3.6],
	[101, -3.1],
	[102, -2.6],
	[103, -2.0],
	[104, -1.5],
	[105, -1.0],
	[106, -0.5],
	[107, 0.0],
	[108, 0.4],
	[109, 0.9],
	[110, 1.4],
	[111, 1.9],
	[112, 2.4],
	[113, 2.9],
	[114, 3.4],
	[115, 3.9],
	[116, 4.4],
	[117, 4.9],
	[119, 5.9],
	[121, 6.9],
	[123, 7.9],
	[125, 8.9],
	[127, 9.9],
]

/** Which LVs were actually measured (true) vs interpolated (false). */
export const LV_MEASURED: readonly boolean[] = (() => {
	const m = new Array<boolean>(128).fill(false)
	for (const [lv] of MEASURED) m[lv] = true
	return m
})()

/** 128-entry lookup, LV → dB. `null` is −∞ (only LV 0). */
export const LV_TO_DB: ReadonlyArray<number | null> = (() => {
	const table = new Array<number | null>(128).fill(null)
	const finite = MEASURED.filter((p): p is readonly [number, number] => p[1] !== null)
	for (const [lv, db] of MEASURED) table[lv] = db
	for (let lv = 1; lv < 128; lv++) {
		if (table[lv] !== null) continue
		let lo = finite[0]
		let hi = finite[finite.length - 1]
		for (const p of finite) {
			if (p[0] < lv) lo = p
			if (p[0] > lv) {
				hi = p
				break
			}
		}
		if (lo[0] > lv) {
			// below the lowest finite point: extend the first segment's slope
			const [l1, d1] = finite[0]
			const [l2, d2] = finite[1]
			table[lv] = round1(d1 - ((l1 - lv) * (d2 - d1)) / (l2 - l1))
		} else {
			const frac = (lv - lo[0]) / (hi[0] - lo[0])
			table[lv] = round1(lo[1] + frac * (hi[1] - lo[1]))
		}
	}
	return table
})()

function round1(x: number): number {
	return Math.round(x * 10) / 10
}

export const UNITY_LV = 107
export const MIN_DB = LV_TO_DB[1] as number
export const MAX_DB = LV_TO_DB[127] as number

export function lvToDb(lv: number): number | null {
	const i = Math.max(0, Math.min(127, Math.round(lv)))
	return LV_TO_DB[i]
}

/** Nearest LV for a dB target (−Infinity or null → 0). Ties break upward. */
export function dbToLv(db: number | null): number {
	if (db === null || !Number.isFinite(db) || db === -Infinity) return 0
	let best = 1
	let bestErr = Infinity
	for (let lv = 1; lv < 128; lv++) {
		const d = LV_TO_DB[lv] as number
		const err = Math.abs(d - db)
		if (err < bestErr || (err === bestErr && lv > best)) {
			bestErr = err
			best = lv
		}
	}
	return best
}

/** "0.0 dB", "-inf dB", "+3.4 dB" */
export function formatDb(db: number | null, opts: { sign?: boolean; unit?: boolean } = {}): string {
	const unit = opts.unit === false ? '' : ' dB'
	if (db === null) return `-inf${unit}`
	const s = db.toFixed(1)
	const signed = opts.sign !== false && db > 0 ? `+${s}` : s
	return `${signed}${unit}`
}

export function formatLv(lv: number): string {
	return formatDb(lvToDb(lv))
}

/** Parse "0", "-6", "+3.5", "-inf", "−∞" into dB (null for −∞). */
export function parseDb(text: string): number | null | undefined {
	const t = text
		.trim()
		.toLowerCase()
		.replace('−', '-')
		.replace('∞', 'inf')
		.replace(/\s*db$/, '')
	if (t === '-inf' || t === 'inf' || t === 'off') return null
	const v = Number(t)
	return Number.isFinite(v) ? v : undefined
}

/** Step an LV by `steps` (±), clamped. */
export function stepLv(lv: number, steps: number): number {
	return Math.max(0, Math.min(127, lv + steps))
}

/** Move by ±dB along the table: nearest LV to (current dB + delta). −∞ + delta stays −∞ unless delta > 0 (then from MIN_DB). */
/**
 * Step a level in dB, staying in dB.
 *
 * `stepDb` below does the same for a dLive wire value, by going out to dB and
 * back through the measured table. On a console with its own taper there is no
 * such table here, so a step has to stay in the portable unit: null is -inf,
 * and a step down past the bottom lands there.
 */
export function stepFromDb(cur: number | null, deltaDb: number): number | null {
	if (cur === null) return deltaDb > 0 ? MIN_DB + deltaDb - 0.05 : null
	const target = cur + deltaDb
	return target < MIN_DB - 2.5 ? null : target
}

export function stepDb(lv: number, deltaDb: number): number {
	const cur = lvToDb(lv)
	if (cur === null) return deltaDb > 0 ? dbToLv(MIN_DB + deltaDb - 0.05) : 0
	const target = cur + deltaDb
	if (target < MIN_DB - 2.5) return 0
	return dbToLv(target)
}

// ---------------------------------------------------------------- other value maps (two-impl)

export const PREAMP_GAIN_RANGES = {
	spec: { min: 5, max: 60, label: '+5 … +60 dB (V2.0 spec formula)' },
	legacy: { min: -10, max: 50, label: '−10 … +50 dB (legacy module)' },
} as const
export type PreampGainRange = keyof typeof PREAMP_GAIN_RANGES

export function preampGainToValue(db: number, range: PreampGainRange): number {
	const r = PREAMP_GAIN_RANGES[range]
	const v = Math.round(((db - r.min) / (r.max - r.min)) * 127)
	return Math.max(0, Math.min(127, v))
}

export function preampValueToGain(value: number, range: PreampGainRange): number {
	const r = PREAMP_GAIN_RANGES[range]
	return Math.round((r.min + (value / 127) * (r.max - r.min)) * 2) / 2
}

export function eqFreqFromValue(v: number): number {
	return Math.round(20 * Math.pow(1000, v / 127))
}

export function eqFreqToValue(hz: number): number {
	const v = Math.round((Math.log(hz / 20) / Math.log(1000)) * 127)
	return Math.max(0, Math.min(127, v))
}

export function hpfFreqFromValue(v: number): number {
	return Math.round(20 * Math.pow(100, v / 127))
}

export function hpfFreqToValue(hz: number): number {
	const v = Math.round((Math.log(hz / 20) / Math.log(100)) * 127)
	return Math.max(0, Math.min(127, v))
}

export function eqGainToValue(db: number): number {
	return Math.max(0, Math.min(127, Math.round(((db + 15) / 30) * 127)))
}

export function eqGainFromValue(v: number): number {
	return Math.round((-15 + (v / 127) * 30) * 2) / 2
}

/** EQ width (Q-ish, in octaves) → value; table from the V2.0 spec. */
export const EQ_WIDTHS: ReadonlyArray<number> = [
	1.5,
	1.4,
	1.3,
	1.2,
	1.1,
	1.0,
	0.95,
	0.9,
	0.85,
	0.8,
	0.75,
	0.7,
	2 / 3,
	0.6,
	0.55,
	0.5,
	0.45,
	0.4,
	1 / 3,
	0.3,
	0.25,
	0.2,
	1 / 6,
	0.13,
	1 / 9,
]

export function eqWidthToValue(width: number): number {
	let best = 0
	let err = Infinity
	EQ_WIDTHS.forEach((w, i) => {
		const e = Math.abs(w - width)
		if (e < err) {
			err = e
			best = i
		}
	})
	return best
}

export function formatHz(hz: number): string {
	return hz < 1000 ? `${hz} Hz` : `${(hz / 1000).toFixed(2)} kHz`
}
