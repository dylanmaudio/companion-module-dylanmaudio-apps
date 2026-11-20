/**
 * Renders every mark in GLYPH through Companion's OWN text path and records
 * what came back, into src/control/looks/glyphs-verified.json.
 *
 *     node tools/glyph-check.mjs [--write] [path/to/Companion.app]
 *
 * Companion draws button text with @napi-rs/canvas over a font stack it
 * registers itself — Companion-sans, Noto Sans Symbols 1-3, Noto Music, and
 * colour emoji last. This loads that same library and those same files from
 * an installed Companion, so a mark that comes back blank, as a missing-glyph
 * box, or in colour, is one that would do the same on a Stream Deck key.
 *
 * Reads the app bundle; writes nothing outside this repo, and never touches
 * a running Companion's configuration.
 *
 * Without --write it checks the record and exits non-zero on a difference,
 * which is what CI would run if it ever has a Companion to run it against.
 * glyphs.test.ts holds the GLYPH table to the record on every test run.
 */
import { createRequire } from 'node:module'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const RECORD = join(HERE, '..', 'src', 'control', 'looks', 'glyphs-verified.json')
const write = process.argv.includes('--write')
const appArg = process.argv.slice(2).find((a) => !a.startsWith('--'))
const APP = appArg ?? '/Applications/Companion.app'
const RES = join(APP, 'Contents', 'Resources')
if (!existsSync(join(RES, 'node_modules', '@napi-rs', 'canvas'))) {
	throw new Error(`No Companion to check against at ${APP}. Pass its path, or install Companion.`)
}

const require = createRequire(join(RES, 'package.json'))
const { createCanvas, GlobalFonts } = require(join(RES, 'node_modules', '@napi-rs', 'canvas'))

/** Companion's own list, main.js: the font files, the names, and their order. */
const FONTS = [
	['Arimo-Regular.ttf', 'Companion-sans'],
	['NotoSansMono-wdth-wght.ttf', 'Companion-mono'],
	['NotoSansSymbols-wght.ttf', 'Companion-symbols1'],
	['NotoSansSymbols2-Regular.ttf', 'Companion-symbols2'],
	['NotoSansMath-Regular.ttf', 'Companion-symbols3'],
	['NotoMusic-Regular.ttf', 'Companion-symbols4'],
	['NotoSansLinearA-Regular.ttf', 'Companion-symbols5'],
	['NotoSansLinearB-Regular.ttf', 'Companion-symbols6'],
	['NotoSansGurmukhi-Regular.ttf', 'Companion-gurmukhi'],
	['NotoSansSC-Regular.ttf', 'Companion-simplified-chinese'],
	['NotoSansKR-Regular.ttf', 'Companion-korean'],
	['NotoColorEmoji-compat.ttf', 'Companion-emoji'],
]
for (const [file, name] of FONTS) GlobalFonts.registerFromPath(join(RES, 'assets', 'Fonts', file), name)
const WITH_EMOJI = FONTS.filter(([, n]) => n !== 'Companion-mono')
	.map(([, n]) => n)
	.join(',')
const NO_EMOJI = WITH_EMOJI.split(',')
	.filter((n) => n !== 'Companion-emoji')
	.join(',')

function draw(ch, family) {
	const S = 64
	const g = createCanvas(S, S).getContext('2d')
	g.fillStyle = '#000'
	g.fillRect(0, 0, S, S)
	g.fillStyle = '#fff'
	g.font = `44px ${family}`
	g.textAlign = 'center'
	g.textBaseline = 'middle'
	g.fillText(ch, S / 2, S / 2)
	const px = g.getImageData(0, 0, S, S).data
	let ink = 0
	let coloured = 0
	for (let i = 0; i < px.length; i += 4) {
		if (px[i] > 24 || px[i + 1] > 24 || px[i + 2] > 24) ink++
		// white text on black: a channel that disagrees with its neighbours is paint of the glyph's own
		if (Math.abs(px[i] - px[i + 1]) > 18 || Math.abs(px[i + 1] - px[i + 2]) > 18) coloured++
	}
	return { ink, coloured, width: Math.round(g.measureText(ch).width * 10) / 10 }
}

// A codepoint no bundled font has: whatever it draws is the missing-glyph box.
const tofu = draw('\u{10FFFD}', WITH_EMOJI)

const { GLYPH } = await import(`file://${join(HERE, '..', 'dist', 'control', 'looks', 'labels.js')}`)
const marks = Object.entries(GLYPH)
const results = {}
let bad = 0
for (const [name, mark] of marks) {
	const ch = mark.char
	const got = draw(ch, WITH_EMOJI)
	const sansEmoji = draw(ch, NO_EMOJI)
	const drawn = got.ink > 0 && !(got.ink === tofu.ink && got.width === tofu.width)
	// It needs the emoji font if dropping that font changes what is drawn.
	const needsEmoji = sansEmoji.ink !== got.ink || sansEmoji.width !== got.width
	const mono = got.coloured === 0
	results[name] = {
		codepoint: `U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`,
		drawn,
		mono,
		needsEmoji,
	}
	if (!drawn || !mono || needsEmoji) bad++
	console.log(
		`${name.padEnd(9)} ${results[name].codepoint.padEnd(8)} ${drawn ? 'drawn' : 'MISSING'} ${mono ? 'mono ' : 'COLOUR'} ${needsEmoji ? 'NEEDS EMOJI FONT' : ''}`,
	)
}

const record = {
	note: 'Written by tools/glyph-check.mjs. Each mark as Companion itself draws it. Do not hand-edit.',
	companion:
		readFileSync(join(APP, 'Contents', 'Info.plist'), 'utf8').match(
			/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)</,
		)?.[1] ?? 'unknown',
	glyphs: results,
}
if (write) {
	writeFileSync(RECORD, `${JSON.stringify(record, null, '\t')}\n`)
	console.log(`\nwrote ${RECORD}`)
} else if (existsSync(RECORD)) {
	const have = JSON.parse(readFileSync(RECORD, 'utf8'))
	const same = JSON.stringify(have.glyphs) === JSON.stringify(results)
	console.log(`\n${same ? 'record matches' : 'RECORD DIFFERS — rerun with --write'}`)
	if (!same) process.exitCode = 1
}
if (bad) {
	console.error(
		`\n${bad} mark(s) would not draw as a key needs: a mark must be drawn, mono, and not from the emoji font.`,
	)
	process.exitCode = 1
}
