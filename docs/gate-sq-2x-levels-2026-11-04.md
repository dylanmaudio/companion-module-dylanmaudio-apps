# The SQ 2.x master addresses, and why this branch holds the SQ

**4 Nov 2026.** `topic/avantis-yamaha` is the first tree that would send
levels to an Allen & Heath SQ. It must not be released while
`CONSOLES` (`src/bridge/bridgelink.ts:97`) declares `sq`. This note records
why, what the evidence is, and what is ours to fix before the gate can
come off.

Nothing here is this module's protocol: the bridge owns the SQ connection
and its address tables. The findings are MIDI Bridge's and
`DEV: Multi-console apps`' (MC); they are recorded here because they decide
a release from this repo. Grades follow `docs/protocol.md`.

## 1. What moved

On SQ+ firmware 2.x all 28 master faders moved. A&H's *SQ+ MIDI Protocol
— Firmware V2.0.3* puts them at `4F 50`–`6E`; the bridge's `FADER_BASE`
(`shared/target/sq/protocol.py`, cited to A&H's *SQ MIDI Protocol, Issue
5*) puts them at `4F 00`–`27`, which under 2.0.3 is the Group → Matrix
send grid.

| Type | Bridge (1.x) | A&H 2.0.3 | Shift | The bridge's address under 2.0.3 |
|---|---|---|---|---|
| main (LR) | `4F 00` | `4F 50` | +0x50 | Grp3 → Mtx3 |
| aux 1–12 | `4F 01`–`0C` | `4F 51`–`5C` | +0x50 | Grp3 → Mtx4 … Grp5 → Mtx3 |
| fx_send 1–4 | `4F 0D`–`10` | `4F 5D`–`60` | +0x50 | Grp5 → Mtx4 … Grp6 → Mtx1 |
| matrix 1–3 | `4F 11`–`13` | `4F 61`–`63` | +0x50 | Grp6 → Mtx2 … Grp6 → Mtx4 |
| **dca 1–8** | `4F 20`–`27` | `4F 67`–`6E` | **+0x47** | Grp8 → Mtx5 … Grp9 → Mtx6 |

The DCA shift is **not** +0x50: A&H pack DCA1 straight after Mtx6
(`4F 66`), while the bridge leaves `4F 14`–`1F` unused and restarts at
`4F 20`. A flat +0x50 would address DCA1 at `4F 70`, past the end of A&H's
masters table.

Unchanged on 2.x: all 104 mutes, masters included; input, group and
FX-return faders; input→aux and input→FX sends; scenes.

## 2. Grade: `hardware`

Three independent legs, all from the shop's SQ5+ on firmware 2.0.2,
4 Nov (`sim/captures/2026-11-04-sq-signoff-sq/masters/` in the monorepo,
rig `3cca09c2`):

1. **The desk broadcasts its masters at the 2.0.3 addresses.** When the
   operator moved them at the surface from 14:38:55: `4F 54` ×149,
   `63` ×36, `62` ×35, `61` ×28, `67` ×22, `51` ×20, `50` ×18 — Aux 4,
   Mtx 3/2/1, DCA 1, Aux 1, LR. Never at `4F 01`, `04`, `11` or `20`.
2. **It answers Gets there.** 15:42, one TCP session: `4F 67` → 12936,
   `4F 50` → 14009, `4F 51` → 14045, `4F 61` → 13702.
3. **Its silences at the 1.x addresses match the 2.0.3 grid, nine times
   out of nine.** The show had 4 groups and 3 matrices, so each 1.x master
   address is a Group → Matrix cell that either exists on that show or
   does not. The desk answered exactly the ones that exist: `4F 00`, `04`,
   `05`, `06` answered (Grp3 → Mtx3, Grp4 → Mtx1–3); `4F 01`, `02`, `11`,
   `20`, `21` were silent (Mtx4/5/6 and Grp6/Grp8, none of which that show
   has). MC asked whether the show had 4 groups and 3 matrices *before*
   the operator confirmed it, so this was a prediction and not a fit.

Leg 3 is the one that persuades, and it is stronger than the by-eye
record: "the writes did nothing" is an absence, while the grid predicts
which addresses answer and which stay quiet.

**The boundary is narrower than the grade.** 1.x layout is confirmed on
hardware at firmware **1.6.3** — an SQ-5 set and read back Aux 1 `4F 01`,
Aux 5 `4F 05`, FX send 1 `4F 0D`, Matrix 1 `4F 11` and DCA 1 `4F 20`
(`sim/captures/2026-10-21-sq-strips-1/RESULTS.md`, 21 Oct). So the move
sits inside **(1.6.3, 2.0.2]**. A&H publish no changelog for it: their
V1.6 article's prose gives no master addresses and says nothing about
parameter numbers changing. Its structure only *suggests* 2.0 — V1.6 has
one "Level Parameter Numbers – Mix Sends" image where 2.0.3 has two, the
second being the masters block — which is `inferred`, from the article's
layout rather than its values. Pinning it needs A&H attachment
47833372120593 read, which is a download and waits on the operator.

A&H's 2.0.3 tables themselves are `single`: one article, fetched through
the public Zendesk API (the HTML returns a Cloudflare 403 and was not
bypassed), whose Reference Tables are PNG images read visually. There is
no SQ+ left to re-check them on, because an SQ-5 cannot run SQ+ firmware.

## 3. What this module would have shipped

**Writes.** `src/presets.ts` generates `level_<type>`, `up_<type>` and
`down_<type>` for every channel type in scope, each a `fader` or
`fader_step` action with `db: '0'` or ±1 dB. A release from this branch
would therefore offer a labelled "Main level" button that writes to a
Group → Matrix send on a 2.x SQ. The exposure is the shipped preset set,
not only the buttons an operator hand-builds.

**And reads, which refusing writes would not fix.** The bridge currently
stores the `4F 04`–`06` answers as Aux 4–6's faders, so a 2.x desk's
unused Grp4 → Mtx1–3 sends reach the mirror as aux levels and this module
publishes them as `fader_aux4`–`6`. An operator would read −∞ on an aux
sitting at unity and believe it. That is why the hold is the whole SQ
family and not merely its level writes.

**How much harm a write does depends on the show.** On the shop's
4-group, 3-matrix show only two of the seven addresses written on the day
were live sends — `4F 00` (Grp3 → Mtx3), which took 210 writes *as "LR"*
from the normal tooling, and `4F 04`, one write by hand. The rest
addressed cells that show does not have and changed nothing. On a show with 8 groups and 6 matrices every one of those seven
is a live send, a master move would move a send instead, and a cue setting
a "master" to −∞ would silence a group in a matrix. Today's small show is
not the general case.

**That tooling is two tools, not one**, and the counts say so. Writes at
`4F 00`, counted here from the capture's own `*.jsonl` (NRPN `06`, Gets
excluded):

| Span | Writes at `4F 00` | What ran |
|---|---|---|
| 14:14:05.355–14:15:53.357 | 102 | MIDI Bridge's own `console_check --play` |
| 14:16:45.663–14:18:38.052 | 104 | Console Control's Console Check play |
| 14:19:18.75x, 14:19:20.49–.51 | 2 | the `cc/` rechecks (they end 14:19:24) |
| 14:21:05.20x, 14:21:34.67–.70 | 2 | the restores (monorepo #407 cites the 14:21:34 one) |

So **206** for the two plays — the figure I counted first, its span being
exactly the first write to the last — and **210** with the rechecks and
restores, which live only in MIDI Bridge's running log. The same
four-write difference appears at each of the other addresses, which is
what makes the two figures agree: `4F 01` and `02` went 64 + 66 + 2 + 2,
`4F 20` and `21` 64 + 67 + 2 + 2, `4F 11` 1 + 2 + 2 + 2 and the by-eye
write. RESEARCH reconciled the split (masters `README.md` §5, rig
`eb107553`); the rows above are counted here, from the same files.

Which matters for what the day shows: not that someone probed an address
by hand, but that the normal tooling — the bridge's own acceptance check
and Console Control's — wrote to a live Group → Matrix send a few hundred
times while calling it LR.

## 4. The guard, and the two things that are ours

MC's guard (monorepo `docs/ROADMAP.md`): on an SQ that is 2.x or not yet
identified, MIDI Bridge refuses writes to the main, aux, FX send, matrix
and DCA faders and to group → matrix sends, and says why; Gets are kept
but their answers stay out of the mirror. Identification is by behaviour,
never by a firmware number: a Get at `4F 67` answers on 2.x (DCA 1 there,
no address in the 1.x tables), and `4F 67` unanswered *while MixPad's
51326 serves* means 1.x. Before the desk is identified a master write
draws 503 `fader_unavailable`, bounded at about 3 s per connect; once it
is known to be 2.x, a 400 in plain words. `fader_db` stays the fader
law's flag, because withholding it would also block input, group and
FX-return faders, which are correct on 2.x.

Two module-side items block gating on that, both public surfaces, both
the operator's to decide:

1. **Presets do not rebuild when the console block changes.**
   `publishDefinitions()` (`src/main.ts:376`) builds them, and is called
   from show import (`:254`), the bridge app's `definitions` event
   (`:283`) and init (`:365`). A re-sent console block reaches none of
   them: `applyConsoleBlock()` (`src/bridge/bridgelink.ts:808`) updates
   the gate flags, re-arms the say-once refusals and returns. Since the
   desk's status starts unknown and settles only at the first cold sync,
   presets built while it is unknown would never be regenerated. A gate on
   the 2.x status would read as working and would not be.
2. **A refused level tells the operator nothing** beyond one log line per
   session, and this module does not retry a 503. Only a 401
   `unknown_lane` is re-sent (`src/bridge/bridgelink.ts:559`); everything
   else is logged and dropped, deliberately (#318).

On that last point the 503 class is not homogeneous, and the Client API's
"a client holds it and tries again"
(`docs/bridge-client-api-v1.md`, #318) covers two different things:

- **bounded, cleared by a timer** — `fader_unavailable`, ≤ ~3 s, cleared
  by an answer or by the Get's own timeout, with nothing external needed.
  Retrying is safe and lands the press.
- **cleared by an unpredictable external event** — `fade_unavailable`
  (the starting level is unknown, and on an Avantis the mirror may never
  learn it: §7 of `audit-avantis-yamaha-2026-10-28.md`), and
  `scene_unavailable` on a list that may go long unread. Retrying holds
  the intent and may fire it at the worst moment, which is the hazard
  #318 was written about.

So the no-retry rule is right for the second kind and wrong only for the
first. Proposed, for the operator: retry `fader_unavailable` to its stated
bound, keep no-retry for `fade_unavailable`, `scene` and `action`. It needs
the bound stated in the Client API doc rather than inferred from a roadmap
row, and a decision on whether `capabilities.unavailable_retry` is per-op;
this module reads that flag nowhere today.

## 5. The gate

**No release from this branch while `CONSOLES` declares `sq`.** It comes
off when the bridge's guard ships and is on `main`, and when items 1 and 2
above are decided. Adding an id is free; this is not about ids but about a
button labelled as something it is not.
