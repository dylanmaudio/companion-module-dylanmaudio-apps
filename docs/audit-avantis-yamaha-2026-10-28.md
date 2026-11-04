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

### 1b. What the rig actually says, 3 Nov — and the module's half of it

Read on the monorepo, read-only: the three verified commits exist and are
**held off the rig on purpose**. `topic/avantis-verified-4` 3d0188ed:
"Applied on the rig at the desk with RESEARCH's `apply <SHA>` once MIDI
Bridge's acceptance on the shop's Avantis passes (Wed 4 Nov 2026); never
on main before those RESULTS." The two Yamaha ones say the same, per
model (`topic/yamaha-verified-rivage` 5c06d69f, `topic/yamaha-verified-dm7`
4529aca4). `test/shop-rig` (91e0c707) carries the scene vocabulary and the
per-type counts; it does **not** carry any of the three.

So on Wednesday the gate is shut when each desk starts and opens partway
through the day, per desk, when RESEARCH applies that desk's SHA. Two
consequences, one each way:

- **Sequencing, for the day:** Companion is fourth on each desk, so its
  slot is probably after the apply anyway — but it is after the apply only
  if the bridge was restarted into it. Worth saying out loud on the day
  rather than discovering it at the desk.
- **Ours, and it was a real bug:** the module read the console block *only
  at connect*, and ignored the `console` event the bridge sends whenever
  the block changes (SPEC §1b: "An SSE `console` event carries the whole
  block"). A Yamaha is verified **per model**, and the bridge can only say
  which model it is once the desk has answered — so the block at connect
  could say "not verified" and the event say otherwise a second later, and
  this module would have refused every write for the rest of the session
  on a desk the bridge was happy to drive. Fixed 3 Nov (69635f4): the
  gate, `by_number` and `scenes.lists` are re-read from the event, and the
  connection's status follows. Nothing else is re-read — a block that says
  more about the desk we are already talking to is not a reconnect.

## 2. CONSOLES, and the one line that must change

`CONSOLES = ['dlive', 'sq', 'wing', 'digico']` is sent at hello (CODE
`bridgelink.ts`). Per SPEC, that list gates **writes**: on a family the
client didn't name, every scene, mute, fader, fade, send, name and Action
is refused 400 `wrong_console`, while reads and the stream stay open.

**Settled on 28 Oct, after this section was first written.** Both ids are
now in `CONSOLES`, read from the monorepo and not from a thread's message:

- **`yamaha`** is the driver's own. `YamahaTargetDriver.name` returns it
  and `client_profile` puts `"driver": self.name` into the console block,
  so it is the string this module will actually compare
  (topic/yamaha-driver, `shared/target/yamaha/driver.py` at d2471478 — a
  draft, and unregistered). One id covers the Rivage and the DM7; the
  model comes from the desk's own `devinfo productname`, not the family.
- **`avantis`** is the family registry's: `Family("avantis", "Allen &
Heath Avantis")` in `sim/session/families.py` on
  topic/cxc-avantis-yamaha. That is the convention every other family
  follows, but it is not the driver declaring its own name the way the
  Yamaha's does, so it is the weaker of the two.

Neither branch is on the monorepo's main. One line changes if a desk says
otherwise on the day.

Adding ids is additive and breaks nobody (CLAUDE.md).

**But declaring `sq` is what holds this branch unreleased**, as of 4 Nov:
on an SQ+ on firmware 2.x the desk's master faders are not where the
bridge writes them, so a shipped "Main level" preset would move a
Group → Matrix send. See
[gate-sq-2x-levels-2026-11-04.md](gate-sq-2x-levels-2026-11-04.md) —
the evidence, the grades, and the two module-side items that have to be
decided before the gate comes off.

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

   And a scene's number **can be changed at the desk** (RENAME, RIVAGE
   PM manual p. 811, same source and the same secondhand caveat). So on a
   Rivage neither the place nor the number is stable: #326 exists because
   places move when a snapshot is inserted, and now the number moves too.
   A button pinned to 2.50 can recall something else after a renumber,
   silently, which is the one failure mode a scene recall must not have.

   There is already a pattern for this in the API, and it is worth
   reusing rather than inventing: the SD's pinned macro takes
   `{"op": "action", "macro": 4, "macro_name": "dim"}` and fires **only**
   if macro 4 is still named "dim", on one macro only, else 400. The same
   guard on a scene — a number plus the name it is expected to carry —
   would make a pinned scene button safe on a desk that renumbers, and it
   would read the same way to anyone who already knows the macro one.
   Suggested to the driver and API threads; not this module's to decide,
   and nothing is built for it. **Accepted 28 Oct** as `scene_name`, an
   optional field on a by-number recall: an exact, non-empty string match
   against the scene at that number and list, with no trimming and no
   case folding, and — unlike `macro_name` — no uniqueness requirement,
   because shows repeat scene names and uniqueness would refuse every
   pinned recall in one. A mismatch is 400 `desk_state` carrying the
   scene's actual name; a name not read yet is 503 `scene_unavailable`;
   with `scene` (a place) instead of `scene_number` it is 400
   `bad_intent`. The Client API checks it from the state's scene list
   where the desk has places, so the SD gets it with no codec change.
   Due in the doc and `exchanges.json` by 2–3 Nov, and nothing is built
   here until it is in the fixture.

   **Two things that are this module's to get right, not theirs.**

   First, and it is the one that could hurt: the pin may only be sent
   where the console block says `scenes.name_pin: true`. A bridge older
   than the field ignores unknown intent fields, so a pin sent to one
   **recalls unchecked and says nothing** — the exact silent wrong recall
   the pin exists to prevent, now wearing the operator's belief that they
   are protected. So the module must read the flag and, where it is
   false, **refuse the press locally and say why** rather than recall
   without the guard. Recommending refusal: a button that says it is
   pinned either is or stops. That is a product decision and the
   operator's to confirm.

   Second, "no trimming, no case folding" meets a free-text box and an
   expression. A trailing space in the typed name, or in the name the
   desk reports, fails the pin for a reason nobody can see. The 400
   carries the actual name, which is the right design, so the module's
   job is to put it in the log plainly and to say in the tooltip and
   HELP that the match is exact, spaces included.

   This module wants a new **additive** option on `scene_recall` beside
   `scene_number`, which is another 1–2 h on §9's table, plus the flag
   reader and the refusal path.

   And one more piece, if Tuesday's B6 finds the Yamaha has no scene
   list: the prefetch. `{"op": "query", "type": "scene", "scene_number",
"scene_list", "fields": ["name"]}` after connect and after every
   `connection` event, for each pinned key, so a pinned press never meets
   the 503. That is implementable here — Companion reports an action
   instance through `subscribe` / `unsubscribe`, which this module
   already uses for feedbacks — but it reaches only **literal** pins.
   `scene_number` takes an expression on purpose, and a computed number
   has no value at subscribe time, so there is nothing to prefetch and
   the 503 window stays exactly as wide for those keys. An operator
   cannot tell the two apart by looking at the button, which is why it
   needs saying out loud rather than leaving "pins are prefetched" as the
   sentence anyone remembers. A pin on a computed number is a
   contradiction — a name captured when the key was made cannot be right
   for a number that changes at press time — so **this module refuses
   that combination locally, with a sentence**. Agreed with the driver
   thread on 28 Oct, and DEV: Multi-console apps is asked for a doc line
   saying a pin is meant for a fixed number, so that "pins are
   prefetched" cannot be misremembered for picker buttons.

   Also new, and this one is plain work: the answer path has five
   segments, and `deltaToEvent` drops anything that isn't three (or
   `scene.current`). Decoding `scene.by_number.<list>.<hundredths>.name`
   is part of the scene-list piece above, not extra.

   One thing to settle with them before it is built, because it is this
   module's behaviour and not theirs: a 503 is **not** retried here. The
   code deliberately drops a refused scene recall and logs it, because a
   scene arriving late is its own hazard (`postCmd`, and the same decision
   for the SD's #318). So a guarded recall pressed while the name isn't
   read is a lost press, not a delayed one — fine, but the operator must
   be told in the log, and the guard's value is in the 400 case rather
   than the 503 one.

   The driver's canonical form, for what it is worth to the decision
   below, is **two decimals**: `"2.50"`, and on a DM7 the scene key is
   `"A 2.50"` / `"B 1.00"` with the list first (DEV: Yamaha driver, 28
   Oct, `shared/target/yamaha/protocol.py` `scene_text`). The driver does
   not constrain how that becomes a Companion variable id, and says so.
   What the desk's own screen shows is read on 2 Nov.

2. **A decimal key has nowhere to live.** `scene_name_${n}` would spell
   12.50 as `scene_name_12.5` — a dot inside a Companion variable id, and
   a lossy spelling of a number the desk writes with two places. A new
   spelling has to be chosen (`scene_name_12_50` reads correctly and is
   additive; the existing integer names must keep theirs exactly).

   **The Client API has since hit the same problem and answered it**
   (DEV: Multi-console apps, 28 Oct): a prefetched scene name arrives as
   a delta on `scene.by_number.<list>.<hundredths>.name`, so 2.50 is
   `scene.by_number.A.250.name`, and `-` stands in for the list on a desk
   that has none. Hundredths precisely so no dot sits inside a path
   segment. That does not bind a Companion variable id, and I would not
   copy it: `scene_name_250` reads as scene two hundred and fifty to the
   person holding the surface, which is worse than a dot. But it settles
   that the dot is a real constraint and not my fussiness, and `_` for the
   point is the same trick with a readable face. **Still the operator's
   call.**

3. **The DM7's two lists are not expressible at all.** It recalls
   `scene_a "4.00"` or `scene_b` (RESEARCH-YA §1), and nothing in the
   intent this module builds can say which list. That needs a new
   additive option on `scene_recall`, in the shape the bridge defines —
   and the bridge has not defined it. Blocked, cheap once unblocked.

   **Unblocked and built, 3 Nov** (69635f4). The shape is in the rig's own
   doc and fixtures (`topic/mb-scene-vocab-rig` 8003fe93, merged to
   `test/shop-rig` as cfa3ee77), not a thread's word for it: the console
   block carries `scenes.lists`, such as `["A", "B"]`; `"scene_list": "B"`
   picks one; without it a recall goes to the first; an undeclared list, or
   any `scene_list` on a console with no `lists`, is 400 `bad_intent`. Three
   decisions were this module's and are worth recording, because each one
   could have gone the lazy way:

   - **An empty box sends no field at all**, never `""` — an empty string
     is `bad_intent`, so it would have refused every recall on every desk.
     The same rule the pin is written to: "no pin means no field".
   - **A list the desk hasn't got refuses the press here**, with a sentence
     naming what the desk does offer, instead of being sent and refused
     there. A 400 arrives after the press, we don't retry one (#318), and
     the only alternative to refusing is a recall that quietly lands in
     list A — the #55 class of failure.
   - **The desk's spelling wins where only the case differs**: "b" can only
     have meant a DM7's "B", and a show button that fails on a capital is a
     bad trade. An ambiguous match is still refused.

   The lists are read from the `console` **event** as well as `/info`, as
   §8 says to: the block "can change once the desk says its model", and a
   Yamaha's model is only known once the desk has answered. See §1b.
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

**Updated 28 Oct, and it lands on the good side.** DEV: Yamaha driver,
reading the RIVAGE PM manual pp. 138–141 (the operator's copy, sent
tonight; this reaches here secondhand, so it is their reading of a
document rather than mine), reports that a Rivage's stereo is **linked
pairs**: adjacent input channels, odd/even or even/odd, and MIX and
MATRIX buses odd/even. That is the SQ's `{linked, half, partner}` shape,
which this module has read since `550c3ba`, and not the SD's `{width}`.

So if Monday's B5 finds the pair leaf, a Rivage's links should appear in
`linked_*`, `half_*` and `partner_*` with no module change at all — and
the partner feedback's expression index, which exists because a channel
picker needs the partner of whatever it is pointed at, should work there
too. Worth putting on Wednesday's list precisely because it costs
nothing to try: it either works or it tells us something.

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
| `CONSOLES` += two ids                                                                 | minutes               | **done** 7e0f8c7, sourced 09c9b2f                      |
| Scene names: widen the parser, choose the decimal spelling, keep integers as they are | half a day with tests | nothing                                                |
| Adopt the bridge's scene list for by_number desks                                     | half a day            | nothing; supersedes most of the above for the operator |
| DM7 list A/B option on `scene_recall`                                                 | 1–2 h                 | **done** 69635f4 (the shape landed 3 Nov; §4.3)        |
| Adopt `types[].count` for scope                                                       | a day with tests      | nothing (deferred past Wednesday on ROADMAP's word)    |
| Re-read the console block from its event (not sized; found while doing the above)     | an hour with tests    | **done** 69635f4 (§1b)                                 |
| The `scene` stream event's number on a desk with no places                            | minutes               | **done** 69635f4 (#342's class, a second site)         |
| HELP wording: Avantis feedback starts blank; which desks are gated                    | 1–2 h                 | **done** 7e0f8c7, and the late gate 3 Nov              |
| §7b: the cold-sync log line on a verified foreign desk                                | under an hour         | **done** 7e0f8c7                                       |
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

### 10b. What the Quantum's CO actually did, 4 Nov — and what it did not

RESEARCH ran the Quantum's CO block on the shop's SD7Q-Q1 (module
bcc48ea, run from source; the Shop check page imported on page 2, not
11). It reported `verified_on_desk: true`, `scenes.by_number: true`, the
connection ok, the cold state as the answer key has it (ZEBRA1,
NARWHAL8, 0.0, −20.0, muted ch 8, scene 1), `width_ch11` stereo with
`linked`/`partner` empty, the scene recall by number landing (2.00 →
Snapshot 2, `fader_ch2` 0.0, `mute_ch8` false, `scene_current` 2), and
#342 holding across a bridge restart. Four things to record, none of
which changed `src/`:

1. **SAFE9's three fader buttons sent nothing, and that is the designed
   chain, not a bug.** `fader` → `fadeTo(ref, {db}, 0)` → on a foreign
   family, `if (this.caps.fader_db === false)` logs once and returns
   before anything is posted (CODE `bridgelink.ts`). The desk reported
   `capabilities.fader_db: false`. The bridge's rule for that flag:
   `caps["fader_db"] = fader_db_verified and self._model_verified() is
   not False`, documented as "fader_db only where the family's dB writes
   are verified on a desk … and, where the family lists its verified
   models, on one of them" (`_capabilities`, read in the monorepo
   worktree `dreamy-bose-42e71b`, 4 Nov). The DiGiCo codec's
   `fader_db_verified` is `True` unconditionally and its
   `verified_models` is `frozenset({"SD11"})` in that copy, so a
   Q112 withholds the flag. **Two claims from the same bridge build
   disagree in a way worth a rig ticket**: the console block said
   `verified_on_desk: true` for this model while `fader_db` was withheld
   for it. Precedent for the working case: the SD11 run of 27 Oct took
   +10, 0, −20 and −∞ with echoes in 20–30 ms — on MIDI Bridge
   `1a5e8c55`, branch `topic/digico-fader-db`, i.e. a build where the
   flag was true (`docs/status/console-checklist.md`, Faders row). Same
   module path, different bridge build. **Grade: two-impl → hardware for
   the refusal; the dB write itself is still `hardware` only on an
   SD11.**
2. **Open, and ours: the operator sees nothing.** The refusal's only
   trace is one `info` line in Companion's log, once per session. A
   button that silently does nothing is the look RESEARCH reported
   ("sends nothing"), and they went to MIDI Bridge's log for it, where by
   construction there is nothing. Worth considering after the desks: a
   warn rather than an info, and whether a refused level should leave a
   mark a preset can read. Not changed on a desk day.
3. **The 9.99 refusal is in Companion's log, not the bridge's.** The
   DiGiCo codec's `write_refusal` refuses a number not in the list
   before the desk is touched, so no TX is correct, and `_desk_nack`
   answers 400 `desk_state` (or 503 `scene_unavailable` while the list is
   unread). The module logs `Bridge rejected scene: desk_state (…)` at
   warn and does not retry. The CO blocks' record note asked for "the
   400 for 9.99" from the bridge's log — wrong place, corrected in all
   six blocks.
4. **`scene_current` going blank after that refused recall is
   unexplained, and nothing on the refusal path can do it.** A refused
   post changes no state; a `scene.current` delta of `null` is dropped
   (`deltaToEvent` returns `undefined`, leaving the value alone); a
   `scene` event with no usable number returns early. The only writer of
   `undefined` is `state.reset()`, which runs on a resync or a fresh
   instance — so the likely cause is a reconnect or resync in that
   window, after which the variable stays blank until the first recall
   because the bridge's `scene.current` reads null (#270, the cold-sync
   blank). Settled by Companion's log for that window; asked for.

Also reported and **not** a module matter: the first presses after the
bridge's 12:26 restart drew MIDI Bridge's "command refused, unknown or
expired lane … (client should re-hello)". `postCmd` already re-hellos and
resends the same envelope once on exactly `401` + `error.code ==
"unknown_lane"`, and the bridge's `cmd` returns exactly that pair
(`401, _nack(cid, "unknown_lane", …)`). So that warning is the first half
of a successful recovery; a press is only lost if Companion's log also
carries `"<op> didn't reach MIDI Bridge"` or `Bridge rejected`.

And one of mine, in the page rather than the module:
`blocks/shop-check.companionconfig` gave 'MUTE on' and 'MUTE off' the
same `mute` feedback on input 9, so both lit red whenever ch 9 was muted.
The feedback is now on 'MUTE on' only. Not re-imported on the day: it is
a look, the read-backs are the evidence, and a mid-day import costs the
operator time for nothing.

### 10c. The fader buttons never reached the module — and §10b item 1 was wrong about the cause

Companion's own log for the dylanmaudio connection, on every fader press
of the day — the Quantum at 12:55:30, 12:55:32, 12:55:38, 12:56:09,
12:56:11, 12:56:13, and the Avantis at 13:31:16, 13:31:18, 13:31:20 and
again after a bridge restart at 13:32:2x:

    warn Failed to parse action options for action fader:
         {"fade":"A value must be provided"}
    warn Error executing action: Error: Failed to parse action options.
         One or more options were invalid
         Action: Fader: set level (dB) - Location: Button 2/0/0

So the action never ran and the module never saw the press. **§10b item 1
is wrong about the cause**: the Quantum's `capabilities.fader_db` was
indeed false and `fadeTo` would have refused the level, but nothing got
that far, and the Companion log line I predicted ("Levels aren't sent to
a …") is nowhere in today's log, which is the evidence that the gate was
never reached. The rule in §10b still holds for the next desk and the
blocks still need the flag read — it just did not cause this.

**The bug is mine, in `blocks/shop-check.companionconfig`:** the three
fader buttons carried `{type, index, db}` and no `fade`. The `fader`
action declares four options (`channelFields` → type, index; `DB_FIELD`
→ db; `FADE_FIELD` → fade), and **Companion 5.1 rejects a control whose
options are missing a declared key even when that field has a default**
— `FADE_FIELD` is `{type: 'number', id: 'fade', default: 0}`. A button
built in Companion's UI always writes every key; a hand-authored one
must too. `mute` (type/index/mode) and `scene_recall`
(scene/scene_number/scene_list) were complete, which is why they worked
all day. **Checked for the whole page, not just the three buttons.**

Consequences for the record: the fader rows on the Quantum and the
Avantis are **not exercised** — not an expected refusal, not a module
fail — and a re-import of the page is needed before any fader row means
anything. The dB write on any A&H or DiGiCo desk therefore still rests
on the SD11 run of 27 Oct.

Two lines of the day that did land, from the same log:
`Bridge rejected scene: desk_state (no snapshot on the console is
numbered 9.99)` (12:55:43.762 and 12:56:15.690) — the refusal §10b item
3 predicted, in the module's own words.

And `scene_current` going blank (§10b item 4) is still unexplained: the
log shows the dylanmaudio instance starting only at 00:22 and 13:18, no
reload and no resync in the Quantum's window, and no path writes
`undefined` except `state.reset()`.

**Re-run, and what it settled.** The operator imported the fixed page at
13:41:22 (`ImportExport/Controller Import: Parsing 2564 bytes` — the
patched file's exact size) and all three fader rows were re-run before
the SQ5+: the Avantis at 13:41:55-13:42:00 (the operator's presses, so no
HttpApi lines), the Quantum at 13:43:06/08/10 and the SQ5+ at 14:34:35/38/44
(RESEARCH's presses over Companion's HTTP API). **No warn line of any kind
from the dylanmaudio connection in any of the three windows** — no parse
failure, no `Bridge rejected`, no dB-law refusal. So the fader row is
exercised on three desks, the page fix is proved on a desk, and the `fade`
option was the whole of it.

**And a finding for the next block, from the Avantis's TX — a WRITE-side
one, not a read-back.** That desk did not land on the number the button
asked for: `Input channel 9 fader -0.1 dB (wire 107)` for the 0 dB button,
`-20.2 dB (wire 67)` for the -20 one (RESEARCH's reading of MIDI Bridge's
log, 4 Nov — the bridge's own description of what it sent, so `single`,
and about the bridge's law table, not this module). The DiGiCo is the
opposite case in the same run: dB on the wire, so -20.0 / +0.0 / -inf went
out and came back exactly.

**What the read path actually showed, which is not stepping:** on the
Avantis `fader_ch2` read **blank** after both recalls and `mute_ch8` stayed
false, because that desk reports nothing a recall changes and answers no
Gets (audit section 7; RESEARCH, 4 Nov). On the SQ5+ `fader_ch2` was not
read at all. On the Quantum it read "0.0" and "-5.0" exactly. **So there is
no evidence that an A&H dB READ-BACK is quantised — only that the write
is.** An earlier draft of this section claimed the read-back was a step;
it isn't established, and the Rivage and the DM7 are the next chance to
see one.

**Owed block change, and it is not a dB tolerance.** The scene step in all
six blocks proved a recall with `fader_ch2` -> "0.0" (after ALLZERO) and
"-5.0" (after BASE). On a desk with no mirror update on recall and no Gets
— the Avantis today — that variable is permanently blank, so the
expectation is simply wrong there however loose the tolerance: the proof
has to be `scene_current` alone, which did read 2 then 1. Add a dB
tolerance only if the Rivage or the DM7 shows a stepped read-back.

### 10e. That block change, done — and what the captures say about it

Three things turned up while writing it, two of which make the proof
stronger than a tolerance would have.

**Who broadcasts what after a recall, from the captures and not from
belief.** A DiGiCo re-broadcasts the channels the recall changed in the
same burst as the scene event: the Quantum sent Inputs 2–8's faders and
Input 8's mute 30 ms after "Scene recall applied" (12:55:40.732–.765,
`pt2/mb-dlive-midi-1236-1257.jsonl`). An SQ does too, but not at once —
after the recall at 14:35:39.539 the first mute came at **+0.54 s** and
the first fader at **+2.99 s**, the rest about 20 ms apart
(`masters/mb-dlive-midi-1435-1440.jsonl`, the SQ5+ CO run, which is clean;
the `cc/` file is a Console Check play writing faders throughout and
cannot be read for this). So a block that reads back 2 s after the press
catches the SQ's mute and misses its fader, and the "failure" is the
read's timing. The blocks now say the numbers. For the **dLive** — the
shipped family — nothing in these notes records it either way, which was
worth finding out: that block now asks for it rather than asserting it.

**A recall that changes nothing broadcasts nothing.** The Quantum's
second ALLZERO, pressed while the desk was already on that scene, sent
scene events and not one fader (12:56:26). So pressing the same recall
twice proves nothing the second time, and the blocks say so.

**And `scene_current` means different things by family now, which is
tonight's fix showing through.** On a desk that counts its scenes the
module still applies the place it just sent, so the variable moves whether
or not the desk did: it proves the press ran and reached the bridge, and
the desk's own word is the scene event in the bridge's log. On a desk that
numbers them there is no local apply any more (§10d), so the variable
moves *only* on the desk's own event — it is the stronger proof there, of
the two, which is the opposite of what the old wording assumed. Each block
now says which kind its desk is.

The page fix and this section landed together on 4 Nov, after RESEARCH
released the hold on this repo (the desks were reset and packed by about
17:50). Two of my own commits had reloaded the module in the operator's
live Companion earlier in the day — `Instance/Modules Attempting to
reload module in: …/companion-dev-modules/dylanmaudio`, 13:18:23 and
13:18:39 — because Companion watches the whole repo through the
dev-module symlink. Re-importing the fixed page is the operator's, not
mine.

### 10d. `scene_current` went blank after the refused 9.99 — and it was never the refusal

RESEARCH left this open for me on the Quantum's RESULTS page (rig
`3032bf05`): MIDI Bridge refused snapshot 9.99 with
"desk_state (no snapshot on the console is numbered 9.99)" at 12:55:43.762
and 12:56:15.690, which is right, and `scene_current` then read empty
until the next recall.

**The refusal has nothing to do with it.** I went looking for a path from
a 400 to the variable and there is none: `postCmd` counts the failure and
logs it (`src/bridge/bridgelink.ts:576`), nothing more, and the bridge's
own log for the span shows the press never left the bridge — the desk sent
no scene traffic at all between 12:55:40.765 ("Scene recall applied", the
2.00 that worked) and 12:56:25
(`pt2/mb-dlive-midi-1236-1257.jsonl`). `scene_current` is only ever
`state.currentScene ?? ''` (`src/variables.ts:138`), so something had set
`currentScene` to undefined.

**It was the optimistic apply, on every by_number recall.** `send()`
applies the event its own intent implies so a feedback lights on the press
(`localEvent`, `src/protocol/localevent.ts`). On a desk that numbers its
scenes, `sceneForConsole()` has already removed `scene` and left only
`scene_number` — deliberately, §4 — so `intent.scene` is `undefined` by
then, and the cast that builds that intent hides it from the compiler.
`localEvent` returned `{kind: 'scene', scene: undefined}`, and
`ConsoleState.apply` duly set `currentScene = undefined` and reported
`scene` as changed.

So the blank was not the refusal's doing and not special to 9.99: **every**
recall on the Quantum blanked the variable for as long as it took the
desk's echo to arrive. 2.00 blanked it too, at 12:55:3x, and the desk
answered 9 ms later ("Scene 2 is current", 12:55:40.732) before anything
read it. 9.99 was the case where no echo was ever coming, so the blank
stood — and the second press at 12:56:09 changed nothing, because
`undefined === undefined` is not a change.

**Fixed:** `localEvent` applies a scene only where a place is actually
known, which is a desk that counts its scenes. A number is not a place —
9.99 is not the ninth snapshot — so on a by_number desk the variable now
waits for the desk's own word and a refused recall leaves it reading what
the desk last said. Covered by "leaves the current scene alone on a
by_number recall instead of blanking it"
(`src/bridge/bridgelink.test.ts`), which fails against the old code with
`expected undefined to be 2`; the counting desk's optimistic apply is
pinned in the test beside it.

**What it cost to find, worth keeping:** two of the three times I was
wrong here I was reading prose instead of the record. The RESULTS page
states the refusal and the blank next to each other, and the sequence
invites the inference that one caused the other. The bridge's MIDI log is
what ruled it out, in about a minute, and the by-eye reading of §10b's
own transcript — ALLZERO reporting `scene_current` 2, 9.99 reporting
empty — is what pointed at the difference being an echo and not a status
code.

### 10f. #342's field check could not fail the way it says, and both runs took the weaker path

Found 5 Nov, from ROADMAP's line that the RESULTS pages' "#342 rows stay
as they are: they read the bridge's scene on connect". They don't
necessarily.

**In bridge mode the module never clears its state on a reconnect.**
`ConsoleState.reset()` is called from exactly two places —
`DliveInstance.resync()` (the operator's own Resync action) and
`ConsoleLink.onDisconnect()`, which is the protocol test harness, not the
shipping path. `BridgeLink` calls it nowhere. A dropped stream, a 409
resync and a MIDI Bridge restart all go through `connectOnce()`, and
`refetchState()` only *applies* what the new snapshot carries: a path the
snapshot does not mention keeps whatever the module already had, and
`apply()` returns no change where the value matches.

So the two ways the blocks offered of "making the module reconnect" are
not equivalent:

- **Toggling the connection off and on** in Companion destroys the
  instance and builds a new one. `state` is a field initialiser
  (`new ConsoleState()`), so it starts empty and `scene_current` can only
  have come from the snapshot. That tests #342.
- **Restarting MIDI Bridge** leaves the module's instance alone. It still
  remembers the 2 it had, so the read passes — and would pass against a
  completely empty bridge mirror, which is the one thing #342 was about.

**Four of the day's five runs took the restart** — the Avantis at
13:32:24, the Quantum at 12:56:52, the SQ5+ at 14:35:39 and the Rivage at
15:15:10 — and the DM7 never ran #342 at all. Each restart read
`scene_current` back correctly afterwards and was scored a pass. They are
real evidence of something — the lane re-hellos, the connection recovers,
no variable is destroyed by a reconnect — but not of the snapshot being
read. All six blocks now require the toggle and say why, and keep the
restart as its own, weaker check.

**The dLive did toggle, and that one does show it — the other way up than
expected.** At 16:34:46 the operator toggled the connection; the fresh
instance read `scene_current` **3**, which is the bridge's cold snapshot,
while the desk was on Scene 2
(`sim/captures/2026-11-04-dlive-signoff-dlive/RESULTS.md`, and the same
note in `capture.jsonl`'s CO.8). So the connect-time read is shown: a
fresh instance cannot have remembered 3, and it was neither blank nor 1,
which is exactly what #342 was. The value being wrong is the bridge's
`scene.current` going stale after an app's own recall — **#413**, filed
against MIDI Bridge, and the console checklist already carries it as such
on the Companion row.

**What that does to the design question below.** Before the toggle the
module's own `scene_current` read 2, which was right, because on a
counting desk it applies the place it sent. After the toggle it read the
mirror's 3, which was wrong. So the reconnect took the operator's display
from right to wrong, and the dangerous read there was the **fresh** one,
not the remembered one — the opposite of the risk I had written down.
Keeping state is not simply the softer, less honest option; on this desk
it was the accurate one. A `stale` mark would have been better than either,
and that is now the option I would argue for.

**And it answers the dLive question §10e left open.** `fader_ch2` read −∞
three seconds after the place-2 recall — the pre-recall value — and became
+9.9 only after the reconnect's cold sync. A dLive tells its sender
nothing of its own write, so the recall's values reach no mirror until
something asks again. Both the dLive and the Avantis blocks now say to
expect stale rather than right, the Avantis on its codec's own claim to
the same behaviour (`recall_told_to_writer` False, A5 and A6 on 2 Nov).

**The design question underneath, which is the operator's.** `ConsoleLink`
blanks everything on a dropped socket; `BridgeLink` keeps it. Keeping it is
kinder in a show — a brief reconnect doesn't empty every button — but it
means that after a MIDI Bridge restart the module can show values the new
mirror has never confirmed, which is the #342 class of fault wearing the
operator's trust. Blanking instead would be honest and would also empty
every strip on an Avantis for good, since that desk answers no Get and the
cold sync cannot refill it. A third option is to keep the values and mark
them: a `stale` flag after a reconnect until the cold sync completes. None
of the three is free, and nothing is changed here pending that call.
