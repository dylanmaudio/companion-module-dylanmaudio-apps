# The Companion module on a DiGiCo SD11 — 27 Oct 2026

The module's first sitting at a console that is neither a dLive nor an SQ.
Run by RESEARCH: Multi-console with the operator at the desk; the module
driven from here over Companion's HTTP API, one press at a time, each
confirmed on the surface before the next.

## What was running

|             |                                                                                       |
| ----------- | ------------------------------------------------------------------------------------- |
| Console     | DiGiCo SD11 at 192.168.31.222:8000 (borrowed, back 28 Oct)                            |
| MIDI Bridge | from source, `topic/mb-306-stereo` at 3d0f38a9, its one Pad                           |
| Companion   | 5.1.0, installed, connection `dylanmaudio` on **Dev version**                         |
| Module      | `topic/sq-test-line` — reads and mutes at **012fe4f**, the fader steps at **ef1aed5** |

The bridge's block: `verified_on_desk: true`, `fader_db: **false**`,
`send_level: false`, `scenes: {noun: "Snapshot", by_number: true}`,
`actions: {noun: "Macro", fields: [macro 1–999]}`.

## What happened

| Step                | Result                                                                                                                                                         |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Connect, cold sync  | **No traffic to the desk at all** — tx stayed at 2. The same connect on an SQ costs ~138 Gets (#271); the dLive-shaped cold sync finds nothing to ask a DiGiCo |
| Names, mutes        | **Read correctly** — "Ch 1", "Ch 8" live from the desk                                                                                                         |
| Mute write          | **Works.** One message, the desk echoed in 33 ms. Operator: "Mute and unmute with companion is working"                                                        |
| Desk → module       | **Works.** The operator's unmute on the surface arrived with no TX from us                                                                                     |
| Fader write         | Morning: **correctly refused**, tx 9 → 9, nothing sent, because `fader_db` was false. Afternoon, after the bridge fixed that flag: **works** — see below       |
| Fader read          | **Broken, found, fixed, verified** — see below                                                                                                                 |
| Snapshot recall     | **Works** by place: one message, the desk confirmed 1.00 '1', pushed back in 50 ms                                                                             |
| Macro fire          | **Not possible** — the module hard-codes the dLive's cc/value Action                                                                                           |
| Desk key as trigger | **Not built**, on any desk                                                                                                                                     |
| Linked pairs        | Not present for the SD in this build; `linked_ch8` false                                                                                                       |

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

## The fader write, afternoon session

`fader_db` was **false** all morning, so every fader write was correctly
refused and the sitting's table recorded "not possible". That turned out to
be a bridge-side bug, not a module one: for any family but the dLive the
Client API set `capabilities.fader_db` from the codec's fader-law table
(`table.verified`), and only the SQ has a table. The SD's wire **is** dB,
with no law to verify, so it read false even though its faders had passed
Console Check - SD that morning (−40…+10 dB within 0.5 dB). DEV: DiGiCo SD
driver's `topic/digico-fader-db` (1a5e8c55) adds `Codec.fader_db_verified`,
defaulting to the old table rule so the SQ is unchanged.

With MIDI Bridge running from that branch, `fader_db: true`, and the
connection cycled for a fresh hello (the lane had been reaped idle at
13:41:52), input 8 was driven from Companion. Input 8 only, one press at a
time, from a cold `tx_total: 0`:

| Press    | Target                  | tx_total | input.8.fader     |
| -------- | ----------------------- | -------- | ----------------- |
| mine     | −20 dB                  | 0 → 1    | −13.0 → **−20.0** |
| mine     | 0 dB                    | 1 → 2    | −20.0 → **0.0**   |
| operator | +10, 0, −20, 0, +10, −∞ | → 9      | ends at **−∞**    |

**One message per press, no retries, no stray traffic.** Every TX was
echoed by the desk 20–30 ms later. **+10 dB was accepted with no clamp at
the SD's top, and −∞ works** — the module sends `{db: null}` for −inf, and
the desk took it.

### What this evidence is, exactly

The operator read the surface **once**, at the end: "it's now at -inf". That
one reading is `hardware`. The −20, 0 and +10 steps rest on the desk's own
echoes arriving 20–30 ms after each TX — the desk reporting its own state
back, which is strong, but it is not a human reading the surface. Graded
`two-impl`, not `hardware`, and it should not be written up as though
someone watched each number land.

Input 8 was left at −∞ deliberately: the operator said to leave whatever
settings were up, so the RESTORE −13 button went unpressed.

### Two method notes

- Companion's `POST /api/location/<page>/<row>/<col>/press` returns **204
  for a page that does not exist**, and 200 once it does. The status proves
  nothing about a button firing — every number above is the bridge's
  `tx_total`, read either side of each press.
- The imported page did **not** appear in `db.sqlite` on two checks several
  seconds apart, though the import had succeeded. Companion holds pages in
  memory and flushes later. Reading the database to confirm a UI write will
  tell you it failed when it did not.

## Gaps to carry into 1.2.0

1. **Snapshot recall is by place, and this desk is `by_number`.** Our
   `{op: "scene", scene: n}` sends an integer, which the SD driver takes as
   the place from 1 (`driver.py:182`, `sd.recall(int(...))`). On the day's
   list, our `4` would have recalled 1.93 named '2', not the snapshot named
   '4'. Only place 1 was sent, where both readings coincide. The module
   should send `scene_number` on a `by_number` desk.

   Since this sitting, `f83a0c8` makes the module **refuse** the recall
   outright on a `by_number` family, so an SD on that build has no scene
   recall at all — the safe side, not the fix. The fix is #326 here, #289
   on the bridge. **Note the build that ran this sitting (`dist/` at 10:51)
   predates the refusal**, so recall-by-place was still live on the desk all
   afternoon.

2. **Macros cannot be fired.** The block declares a `macro` field; we
   hard-code cc/value. This is the block-driven Action work — #327 here,
   with #285 the bridge-side question, now answered: a Macro fired on the
   surface comes back as `action_fired`, and the driver claims
   `action_fire`.
3. **A desk key cannot fire a Companion trigger** on any console. New work,
   agreed for after this sitting.

## What went wrong in the method

A `yarn build` for the fader fix emitted into `dist/` at 10:50:18 **while
the connection was live**, so the module briefly ran from a half-built
state. Nothing between that and the clean `ef1aed5` build is counted.
Standing rule from this sitting: **no builds on this Mac while a desk is in
session**, and the module's own suite is a heavy run that counts as one.

## Still unknown to the module

Read live from the block at 13:35, and absent from `src/` and `fixtures/`
entirely — no issue covers either yet:

- **`surface_lights`** — a capability plus an option set (flash / dim /
  restore macros, `max_rate_hz: 5`). The desk offers it; the module cannot
  drive it.
- **`unavailable_retry`** — a new top-level capability.

And one that will not fix itself by flipping a bridge flag: **`send_level`
is in `SCALED_OPS`**, so it is refused for every non-dLive family because
it carries dLive-scaled values. The ch 8 sends measured this morning cannot
reach Companion until that op goes dB-native — a module change, unwritten.
