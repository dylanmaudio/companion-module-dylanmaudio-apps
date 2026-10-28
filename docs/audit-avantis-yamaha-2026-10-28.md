# Assumptions audit — the Avantis and the Yamaha RCP family

> Asked for by DEV: ROADMAP on 28 Oct 2026, for the four-desk shop days:
> capture on Monday 2 Nov, a full desk check on Wednesday 4 Nov, against a
> Yamaha Rivage, a DM7, an A&H Avantis and a DiGiCo Quantum 112. Companion
> is fourth in the queue on each desk, so this is written to be usable in
> whatever time is left rather than to be worked through in order.
>
> **Done by reading only.** No desk, no bridge driver, no capture. Nothing
> below is `hardware`, and the two sources it leans on say the same of
> themselves: the Yamaha research is "from documents and third-party code
> only. No Yamaha has been on the wire", and the Avantis sheet grades its
> own rows `single` and `inferred beyond`. A claim here is therefore at
> best as good as a document someone read, and the grades say which.

## Sources

| Short name  | What it is                                              |
| ----------- | ------------------------------------------------------- |
| RESEARCH-AV | monorepo `docs/research-avantis-protocol.md` (on main)  |
| RESEARCH-YA | monorepo `docs/research-yamaha-protocol.md` (on main)   |
| SPEC        | monorepo `docs/bridge-client-api-v1.md` §1b, §6, §7, §8 |
| CODE        | this repo, at `31a21a6`                                 |

The Quantum rides on the existing `digico` driver, so it is not audited
here beyond the two notes at the end.

## 1. The finding that decides Wednesday

**The module refuses to drive a family whose driver is not marked
verified, and it does so by design.** `familyVerified` reads
`console.verified_on_desk`, and `applyConsoleState` sets the connection to
_failure_ with "MIDI Bridge is driving a &lt;x&gt;; this module version drives
a dLive only" when it is absent or false (CODE `src/bridge/bridgelink.ts`
`familyVerified`, and the `foreignFamily` doc comment above it; SPEC §1b
says the same from the bridge's side, naming this module from 1.2.0).

Both new drivers will be days old on Wednesday. Unless the bridge marks
them verified before the Companion slot, the module will sit at failure
and drive nothing on either desk — not a bug, the rule working, and it
was written deliberately because "half-driving a desk cannot be taken
back". Reads stay open either way, so variables and feedback can still be
watched.

Who flips it and when is the bridge's call, not this module's. It wants
deciding before the day, not on it.

## 2. CONSOLES, and the one line that must change

`CONSOLES = ['dlive', 'sq', 'wing', 'digico']` is sent at hello (CODE
`bridgelink.ts`). Per SPEC, that list gates **writes**: on a family the
client didn't name, every scene, mute, fader, fade, send, name and Action
is refused 400 `wrong_console`, while reads and the stream stay open.

So each family needs its id added, and **the id is the driver's, not a
guess.** `'avantis'` is the obvious spelling and `digico`/`sq`/`wing` set
the precedent, but neither new driver's id appears in SPEC or in any
fixture here yet, and the Yamaha one has a real question behind it: one
driver covers Rivage, DM7 and CL/QL (RESEARCH-YA §1, "one scheme for all
four"), so the id may be a family name rather than a model. Asked of
DEV: Multi-console apps and DEV: Yamaha driver; nothing is added until
they answer.

Adding ids is additive and breaks nobody (CLAUDE.md).

## 3. Levels

|           | Avantis                                                       | Yamaha RCP                                                                      |
| --------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Shape     | dLive scheme: NRPN faders, 0–127 wire (RESEARCH-AV §1)        | integers in **hundredths of a dB**; the wire value _is_ the dB (RESEARCH-YA §1) |
| −∞        | as the dLive                                                  | `-32768`                                                                        |
| Fader law | to be measured (RESEARCH-AV §5 item 4: "no table, no output") | **none to measure** — only the desk's rounding                                  |
| Level Get | **none at all** (§3 below)                                    | `get` answers                                                                   |

The module is already right on both, and for a reason it got on hardware
last week: since the SD11 fix it keys a foreign family's level off `db`
and not off `wire`, so a `{db, steps: null}` lands and a `{wire, db,
steps}` lands (CODE `deltaToEvent` case `'fader'`). A Yamaha's exact dB is
the easy case for that path.

A third point, which removes a worry rather than adding one: the module
never asks a foreign desk for a level in the first place. `get_fader` and
`get_send_level` are in `SCALED_OPS` and are refused locally on any
family that isn't a dLive (CODE `refuseForeign`), so the Avantis having
no level Get costs this module nothing — levels arrive, or don't, through
the bridge's mirror (§7).

Two things to confirm rather than assume:

- **How the mirror spells −∞.** The SD's came through as `-144.0` on 27
  Oct, and the module also accepts `db: null`. Which of the two a Yamaha's
  `-32768` becomes is the bridge's choice and is not written down
  anywhere I can read. One capture answers it.
- **`capabilities.fader_db`.** Levels stay held back while it is false,
  which is correct, and it is a second gate behind §1 — a verified driver
  with the capability off still refuses levels (CODE `fadeTo`, and the
  sentence it logs).

## 4. Scene keys — the real gap

**Decimal numbers are handled; two lists and the 500 ceiling are not.**

Recall by the number on the desk went in on 27 Oct for the SD (`44fa930`)
and `#342`'s fix widened the decode guard to `Number.isFinite` yesterday,
so a Rivage's `12.50` and a DM7's `4.00` recall and read back correctly.
That part is done.

What does not work:

1. **Scene names cannot be entered for either desk.** `parseSceneNames`
   takes `^(\d{1,3})...` and then range-checks 1–500 (CODE
   `src/config.ts`). A Rivage goes to 999.99 and a DM7 to 499.99, so
   `12.50,Chorus` is rejected outright with "expected &lt;scene&gt;,&lt;name&gt;"
   and `999,Finale` with "scene must be 1–500". Every scene-name variable
   and every scene preset on those desks is therefore empty.
2. **A decimal key has nowhere to live.** `scene_name_${n}` would spell
   12.50 as `scene_name_12.5` — a dot inside a Companion variable id, and
   a lossy spelling of a number the desk writes with two places. A new
   spelling has to be chosen (`scene_name_12_50` reads correctly and is
   additive; the existing integer names must keep theirs exactly).
3. **The DM7's two lists are not expressible at all.** It recalls
   `scene_a "4.00"` or `scene_b` (RESEARCH-YA §1), and nothing in the
   intent this module builds can say which list. That needs a new
   additive option on `scene_recall`, in the shape the bridge defines —
   and the bridge has not defined it. Blocked, cheap once unblocked.
4. The scene **list** in the state (`scene.<n>.number` / `scene.<n>.name`,
   SPEC) is read by the bridge for a by_number desk, and this module does
   not consume it at all. Adopting it would fix (1) without the operator
   typing anything, on every by_number family at once.

## 5. Stereo

Nothing to do, and that is worth saying plainly after yesterday. Since
`550c3ba` the decoder reports `{linked, half, partner}` where a family
sends it, `{width}` where a family sends that, and **says nothing** where
the family can't say — so an Avantis or a Yamaha that reports neither
leaves `linked_*` and `width_*` empty rather than claiming "not linked".
Neither research document mentions a link or width report for either
desk, which is exactly the case the fix was written for.

## 6. Names and colours

- **Avantis: Get Name and Get Colour are the only Gets the desk answers**
  (RESEARCH-AV §1, graded `single`). Names and colours therefore sync cold
  and work as on a dLive.
- **Yamaha: `Label/Name` and `Label/Color`, readable and writable**, names
  8 characters on DM7 and CL/QL (RESEARCH-YA §1).
- **Colours pass through unvalidated** — `deltaToEvent` case `'colour'`
  takes any string (CODE), so a Yamaha's named colour lands in
  `colour_ch1` intact. The _feedback_ dropdown is the dLive's eight
  (`COLOURS`, `src/protocol/channels.ts`), so a colour outside those eight
  shows in a variable but matches no colour feedback. Additive to widen,
  and not worth doing before a desk says what the names actually are.
- `names.available: false` means **keep the names already on the keys**,
  not blank them (SPEC §1b). Worth re-reading the module's handling of
  that before Wednesday; it is the kind of rule that is easy to have got
  backwards and no fixture here covers it.

## 7. The Avantis mirror has no cold state, and that is the visible one

RESEARCH-AV §3: "Names and colours by Get. Mutes, levels, sends and
assigns **only from what the desk broadcasts** — no cold sync, and
unknown until the first change." Its capability line says "Feedback:
broadcast only".

What the operator will see: `mute_*`, `fader_*` and every send variable
empty on connect, filling in one at a time as somebody touches the
surface. A button's colour will be wrong until its channel moves once.

Where that blankness comes from is worth stating exactly, because it is
not this module's doing and the module cannot fix it. In bridge mode the
module does not poll the desk at all: cold values come from the mirror
snapshot at `GET /api/v1/state` and changes from the stream (CODE
`refetchState`). If the bridge's own mirror has no level for a strip —
and on an Avantis it cannot have one, because the desk answers no level
Get to anybody — then there is nothing for the snapshot to carry and
nothing for the module to show. **This is the same shape as #342**: a
value the desk never volunteered, looking like a module fault.

So what is wanted is wording, not code: a sentence in
`companion/HELP.md` telling an Avantis operator that mutes and levels
start blank and fill in on first movement. Otherwise it reads as a broken
connection, and it will be read that way on Wednesday by somebody who
did not build it.

### 7b. A thing I found while checking the above

`coldSync` opens with `if (this.refuseForeign('query')) return`, and
`query` is in neither `FIRST_CLASS` nor `GATED`, so `refuseForeign`
classes it as dLive bytes and refuses it on **every** family that isn't a
dLive — including a verified one. So on a verified SQ, Wing or DiGiCo
today, and on these two if they are marked verified, the module skips its
cold-sync nudge entirely and lives off the mirror snapshot and the
stream.

The effect is mostly harmless, because the snapshot is the better source
anyway and the comment above the line is right that a dLive-shaped Get
would earn one `bad_intent` per strip. Two things are not harmless:

- It logs, once, "query isn't sent on a &lt;family&gt;: it is encoded as dLive
  bytes, which mean something else there." On a desk the module is
  happily driving, that sentence tells the operator something was refused
  that they wanted. It is the wrong message for the verified case.
- The reasoning in the comment — "a desk we won't drive isn't worth
  asking about" — is the unverified case's reasoning, left in place when
  verified families started being driven. The code is doing something
  defensible for a reason that no longer describes it, which is how the
  next person gets it wrong.

Worth tidying before Wednesday, for the log line alone: four desks, three
of them foreign, and that sentence in the log of each.

## 8. Strip counts are the dLive's, not the desk's

The console block carries `types[]` with a per-type `count` — the
family's most until the desk's layout is read, then the desk's own (SPEC
§1b). **This module ignores it.** Scope comes from the dLive
`CHANNEL_TABLE` and the operator's `inputs` config (CODE
`src/variables.ts` `scopedStrips`).

On a 64-input Avantis, a DM7 or a Quantum that means variables and
pickers for strips the desk does not have, and Gets sent into the void
(RESEARCH-AV §5 item 5 asks what the desk even does with those).
Adopting `types[].count` as a ceiling is additive, fixes all four desks
at once, and is the largest of the pieces here.

## 9. Sizing

Code first, because it is the small half:

| Piece                                                                                 | Size                  | Blocked on                                             |
| ------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------ |
| `CONSOLES` += two ids                                                                 | minutes               | the two drivers' ids                                   |
| Scene names: widen the parser, choose the decimal spelling, keep integers as they are | half a day with tests | nothing                                                |
| Adopt the bridge's scene list for by_number desks                                     | half a day            | nothing; supersedes most of the above for the operator |
| DM7 list A/B option on `scene_recall`                                                 | 1–2 h                 | the bridge's intent shape                              |
| Adopt `types[].count` for scope                                                       | a day with tests      | nothing                                                |
| HELP wording: Avantis feedback starts blank; which desks are gated                    | 1–2 h                 | nothing                                                |
| §7b: the cold-sync log line on a verified foreign desk                                | under an hour         | nothing                                                |
| Colour feedback beyond the dLive's eight                                              | 2 h                   | a desk saying what the names are                       |

So **two to three days of work**, almost none of it deep: this module
asks the bridge for intents and never encodes a byte for a foreign desk,
so a new family mostly costs scope, scenes and wording rather than
protocol. The two genuinely blocked pieces are small and both sit with
other threads.

What is **not** a code problem and matters more:

1. §1, the verified gate. Decide it before Wednesday.
2. Reads work on an unverified family, so even a gated desk can earn a
   capture: names, colours, scene reports, whatever it broadcasts. Worth
   planning for, since Companion is fourth in the queue and may get
   minutes rather than a slot.
3. Everything above is reading. The first desk minute should go to
   confirming the shapes, not to exercising features — one `/state` dump
   and one `/info` block per desk is worth more than the rest of the list.

## 10. The Quantum

Rides the existing `digico` driver, so `CONSOLES` already names it and
the SD11's work applies. Two cautions: `scenes.by_number` and the 503
`scene_unavailable` hold-and-retry were measured on an SD11 (#318, and
the fixture `cmd.scene_number.list_unread`), and a Quantum is a different
desk on the same driver — the module deliberately does not retry that
503, because a scene recall arriving late is its own hazard (CODE
`postCmd`). If a Quantum raises it more often than an SD11 does, that
decision is worth revisiting with the capture in hand.
