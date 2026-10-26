# The Companion module on a DiGiCo SD11 — 27 Oct 2026

The module's first sitting at a console that is neither a dLive nor an SQ.
Run by RESEARCH: Multi-console with the operator at the desk; the module
driven from here over Companion's HTTP API, one press at a time, each
confirmed on the surface before the next.

## What was running

| | |
|---|---|
| Console | DiGiCo SD11 at 192.168.31.222:8000 (borrowed, back 28 Oct) |
| MIDI Bridge | from source, `topic/mb-306-stereo` at 3d0f38a9, its one Pad |
| Companion | 5.1.0, installed, connection `dylanmaudio` on **Dev version** |
| Module | `topic/sq-test-line` — reads and mutes at **012fe4f**, the fader steps at **ef1aed5** |

The bridge's block: `verified_on_desk: true`, `fader_db: **false**`,
`send_level: false`, `scenes: {noun: "Snapshot", by_number: true}`,
`actions: {noun: "Macro", fields: [macro 1–999]}`.

## What happened

| Step | Result |
|---|---|
| Connect, cold sync | **No traffic to the desk at all** — tx stayed at 2. The same connect on an SQ costs ~138 Gets (#271); the dLive-shaped cold sync finds nothing to ask a DiGiCo |
| Names, mutes | **Read correctly** — "Ch 1", "Ch 8" live from the desk |
| Mute write | **Works.** One message, the desk echoed in 33 ms. Operator: "Mute and unmute with companion is working" |
| Desk → module | **Works.** The operator's unmute on the surface arrived with no TX from us |
| Fader write | **Correctly refused.** tx 9 → 9, nothing sent, because `fader_db` is false |
| Fader read | **Broken, found, fixed, verified** — see below |
| Snapshot recall | **Works** by place: one message, the desk confirmed 1.00 '1', pushed back in 50 ms |
| Macro fire | **Not possible** — the module hard-codes the dLive's cc/value Action |
| Desk key as trigger | **Not built**, on any desk |
| Linked pairs | Not present for the SD in this build; `linked_ch8` false |

## The bug this desk found

The SD mirrors a fader as `{"db": 10.0, "steps": null}` — **no `wire` key**.

The reader handled the dLive's `{lv, db}` and the SQ's `{wire, db, steps}`,
and keyed the second branch off `wire` being present. The SD's shape fell
through to the lv branch, failed the 0–127 check, and was **dropped in
silence**. During the sitting it was reported — by me — as "the bridge
probably doesn't mirror SD faders". It did; we were throwing it away.

Two examples had looked like a pattern. The rule is simpler: **the dLive's
shape is the only one that uses our measured table, and every other family
reports dB, which may or may not arrive with a wire value of its own.**

Fixed in `ef1aed5`, and confirmed on the desk within minutes: `fader_ch8`
read **+10.0 dB**, and then moved to **−13.0 dB by itself** when snapshot
1.00 was recalled — the desk pushing levels, the bridge mirroring them, the
module showing them.

## Gaps to carry into 1.2.0

1. **Snapshot recall is by place, and this desk is `by_number`.** Our
   `{op: "scene", scene: n}` sends an integer, which the SD driver takes as
   the place from 1 (`driver.py:182`, `sd.recall(int(...))`). On the day's
   list, our `4` would have recalled 1.93 named '2', not the snapshot named
   '4'. Only place 1 was sent, where both readings coincide. The module
   should send `scene_number` on a `by_number` desk.
2. **Macros cannot be fired.** The block declares a `macro` field; we
   hard-code cc/value. This is the block-driven Action work (#285).
3. **A desk key cannot fire a Companion trigger** on any console. New work,
   agreed for after this sitting.

## What went wrong in the method

A `yarn build` for the fader fix emitted into `dist/` at 10:50:18 **while
the connection was live**, so the module briefly ran from a half-built
state. Nothing between that and the clean `ef1aed5` build is counted.
Standing rule from this sitting: **no builds on this Mac while a desk is in
session**, and the module's own suite is a heavy run that counts as one.
