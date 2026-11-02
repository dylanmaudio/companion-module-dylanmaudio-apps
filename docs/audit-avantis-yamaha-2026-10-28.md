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
