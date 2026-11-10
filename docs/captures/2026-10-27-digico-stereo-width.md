# The stereo shape, and the module's bug — 27 Oct 2026

Written while the SD11 was on the bench, **corrected the same day**. The
first version of this note said `{"width": ...}` was "one build's
behaviour". That was wrong, and the correction matters more than the
observation did.

## The source is the spec, not a mirror

`{width}` is the Client API's documented shape, in
`docs/bridge-client-api-v1.md` §1b **on main** (DEV: ROADMAP, with the
line references). The contract reads:

> **`stereo: null` means the family can't say,** never mono. The dLive
> can't report an input's link, so its inputs are `null`. The SQ reports
> `{"linked": false}` or `{"linked": true, "half", "partner"}` for every
> input, and `{"width": "mono" | "stereo"}` for every mix.

So `{width}` is not a DiGiCo quirk. It is **every mix on every family**,
the SQ included — a desk this module already drives.

## How I got it wrong

I read a running bridge's mirror, saw 40 `*.stereo` keys of
`{"width": ...}` on `topic/digico-fader-db` 1a5e8c55, went back for a
cleaner reading, found `mc-318 043319ab` mirroring **no** stereo keys at
all (233 keys, not one `*.stereo`), and concluded the shape was
build-specific. It isn't: 043319ab was cut before `topic/digico-names`.
**A branch that predates a change is not a bridge that sends something
else**, and I had the spec available the whole time.

Grading a single mirror reading `single` was right for what it was. The
mistake was treating "what I saw running" as the only available source
when a written contract existed. `protocol.md`'s rule is about not citing
summaries as sources; this is its mirror image — not noticing that a real
source was there to be read.

## The bug, which is not about `{width}` at all

`bridgelink.ts`, `case 'stereo'`, returns `linked: o.linked === true`. For
any shape it does not recognise, that is `linked: false` — **a confident
"not linked" where the spec says "can't say"**. The silent-drop class
again, one layer up from `ef1aed5`'s fader bug: a plausible wrong answer
rather than nothing.

It reaches the shipped product. `variables.ts:153` reads
`s.stereo?.linked ?? false`, so on a **dLive** — whose inputs are `null`
by the spec, because the desk cannot report a link — every
`$(dylanmaudio:linked_chN)` reads `false`. 1.1.x is dLive-only, so this is
what every user of the shipped module has today: a variable stating as
fact something the console never said.

## What the fix has to do

- `{linked, half, partner}` read as now.
- `{width: "mono" | "stereo"}` read for what it says. It means this strip
  is stereo; it does **not** name a half or a partner, and nothing should
  be inferred about either.
- **Anything else — unrecognised, `null`, or absent — is unknown, never
  `linked: false`.** This is the actual defect, whatever shapes exist.
- Decide deliberately what `linked_*` reads when the answer is unknown.
  `false` is a lie; `''` matches how `partner` already reports nothing.
  It is a change to shipped behaviour on every dLive, which is why it is
  not made here on my own authority.

Confirm on a desk with a bridge from `topic/digico-names`, or on the Wing
with 1.4.111. Nothing here was read on a console's display.
