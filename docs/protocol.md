# dLive MIDI-over-TCP — protocol spec as implemented

This is the single human-readable statement of every byte this module
sends or expects. The machine-readable authority is `fixtures/*.json`;
both the TypeScript codec in this repo and the Python codec in MIDI
Bridge must pass the same fixtures. When the two disagree, the fixture
wins; when a fixture disagrees with hardware, hardware wins and the
fixture is corrected (with the capture attached).

Sources, in order of trust:

| Tier       | Meaning                                                                                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `hardware` | Observed on a real dLive — the 11 Aug 2026 desk (base channel 1) or the S5000 session of 4–5 Sep 2026 on firmware 2.12 — or proven over years of shows by the Reaper Automation Pack |
| `two-impl` | Two independent implementations agree (TSteer `allenheath-dlive` v1.0.1 and Broughton `allenheath-dlive-ilive`), both derived from the A&H _MIDI Over TCP/IP Protocol V2.0_ PDF      |
| `single`   | One implementation / the PDF only                                                                                                                                                    |
| `inferred` | Extrapolated from a pattern, or synthesised for a test — not observed on a desk                                                                                                      |

A search result is not a source. On 20 Oct 2026 this file briefly
carried an explanation of the connection limit that traced back to a
sub-agent's summary of a support article nobody could open (it returns
403). It read like a citation and was not one. If a claim here can't be
traced to a capture in `sim/captures/`, a document someone has actually
read, or an implementation someone has actually looked at, it doesn't
belong in the table above.

Firmware is undetectable over this protocol (the SysEx header carries
`01 00` on every version); the user tells us.

## 1. Transport

| Endpoint | Plain | TLS   | Owns                                                                                                                                                                    |
| -------- | ----- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MixRack  | 51325 | 51327 | Scene recall, all parameter control, Actions, Gets                                                                                                                      |
| Surface  | 51328 | 51329 | Cue-list recall, Scene Go / Next / Previous. Also **mirrors** desk scene recalls in the same bytes as 51325, and answers the name heartbeat. The MixRack refuses 51328. |

TLS port numbers are `single` (the PDF, p.1). An earlier note in the
dLive Utility Apps repo said 51326; that was wrong and is corrected —
51326 is not a dLive control port.

Both sockets are plain MIDI byte streams: no framing, no length prefix.
TCP splits packets arbitrarily — the decoder is a byte-at-a-time state
machine.

**A&H documents 40 connections per endpoint (`single`, the spec
reading). A MixRack on firmware 2.12 serves four (`hardware`).** The gap
is unexplained; where they disagree, hardware wins.

Measured over two sessions, captures in the monorepo at
`sim/captures/2026-10-18-dlive-connections/` and
`2026-10-19-dlive-fifth-connection/`:

- A fifth and a sixth client are **accepted and never served** — no Get
  answered, nothing relayed, not after 30 s. One run's second connection
  received nothing all day while 3,572 messages went to its first.
- **A stranded client is not rescued when a slot frees.** Only a _fresh_
  connection is served. MIDI Bridge survives this because it reconnects
  every 10 s (1.4.4 took ~8 s to recover, 1.4.5 ~2 s); anything that
  connects once and waits stays silent for ever.
- "One connection per host" is retired: three clients from one Mac were
  all served.

So a client past the limit **looks connected and goes quiet**, with no
error and no close, and closing something else does not fix it on its
own — it has to reconnect.

Multiple clients on multiple hosts do work within that budget, and have
been run against one console in the field — Companion and A&H's own
dLive MIDI control app at the same time. The earlier "one connection per
port per host" note was an artefact of two clients on one Mac fighting
over the same local resource, not a console limit.

This module still never arbitrates for the socket, because it never
opens one: MIDI Bridge owns the console connection and this module is a
lane behind it. The slot budget matters anyway, because it is spent by
everything _else_ the operator runs — a direct dLive Companion module
aimed at the MixRack costs one, and the fifth thing to connect is the
one that silently does nothing.

TLS requires sending `UserProfile, UserPassword` then waiting for the
six bytes `AuthOK` before any MIDI, or the console drops the
connection (`single`). **`UserProfile` is a byte `0x00`–`0x1F` — a
profile index, not a name string**; only the password is text. The
separator and any terminator are unspecified and must be captured.

## 2. Addressing

`N` = base MIDI channel (0-indexed; console Utility → Control → MIDI,
shown there 1-indexed). Every channel type is `N + offset`, with a
7-bit address `CH`. Table verbatim from the V2.0 PDF p.8 (`two-impl`):

| Type           | MIDI ch | CH range | Count |
| -------------- | ------- | -------- | ----- |
| input          | N+0     | 00–7F    | 128   |
| mono_group     | N+1     | 00–3D    | 62    |
| stereo_group   | N+1     | 40–5E    | 31    |
| mono_aux       | N+2     | 00–3D    | 62    |
| stereo_aux     | N+2     | 40–5E    | 31    |
| mono_matrix    | N+3     | 00–3D    | 62    |
| stereo_matrix  | N+3     | 40–5E    | 31    |
| mono_fx_send   | N+4     | 00–0F    | 16    |
| stereo_fx_send | N+4     | 10–1F    | 16    |
| fx_return      | N+4     | 20–2F    | 16    |
| main           | N+4     | 30–35    | 6     |
| dca            | N+4     | 36–4D    | 24    |
| mute_group     | N+4     | 4E–55    | 8     |
| ufx_send       | N+4     | 56–5D    | 8     |
| ufx_return     | N+4     | 5E–65    | 8     |

`N+4` must stay ≤ 15; the console offers base channels 1–12 for that
reason. Preamps are addressed by **physical socket**, not channel, on
`N+0`: MixRack sockets 1–64 → `00–3F`, DX 1/2 → `40–5F`, DX 3/4 →
`60–7F` (`two-impl`). There is no way to read the socket→channel patch.

## 3. Messages to the console (MixRack socket unless stated)

All multi-byte CC sequences below are emitted with an explicit status
byte on every message (never running status) — proven safe, and it
keeps the NRPN triple atomic across any interleaving.

### 3.1 Mute — `hardware`

```
9n CH 7F      mute on
9n CH 3F      mute off
```

We send a single Note On with no Note Off (an intermediate layer once
mangled a paired Note Off into `00 00 00 00`); the console is happy
with the lone message.

The console's OWN mute messages are a pair — `9N CH 7F, [9N] CH 00`
for on and `9N CH 3F, [9N] CH 00` for off (PDF p.2). Receive rules,
quoted exactly:

| Velocity               | Meaning     |
| ---------------------- | ----------- |
| `00`, and any Note Off | **ignored** |
| `01`–`3F`              | mute OFF    |
| `40`–`7F`              | mute ON     |

**Decode by threshold, but ignore velocity 0 first.** `9n CH 00` is
the note-off half of the console's pair written in running-status
idiom, not a mute-off value — the OFF range starts at `01`. Reading it
as a mute-off makes every mute-on from the surface arrive as
on-then-immediately-off, silently corrupting mirrored state. This doc
and both codecs previously had it wrong (the `rx.mute.*.spec.*`
fixtures asserted `9n CH 00` = mute off and were tagged `hardware`
though they were authored from this PDF section, not captured).
Whether the console actually emits the terminator is a capture item.

A corollary, for anything talking to older tooling: the Reaper pack's
Python used `40`/`00`. `40` is the lowest ON velocity, and `00` is
ignored — so that path could mute a channel but never un-mute it.

### 3.2 Fader level — `hardware`

```
Bn 63 CH   Bn 62 17   Bn 06 LV
```

NRPN MSB = channel address, LSB = parameter `0x17`, Data Entry MSB =
level. No Data Entry LSB (CC 38). **The console latches the NRPN
address**: the triple must never be interleaved with another lane's
NRPN bytes on the same socket. Level ↔ dB is a measured table
(`levels.ts`, firmware 1.94, `0x6B` = 0 dB, ~0.5 dB/step); never a
formula.

The PDF does publish a law — `LV = [(dB + 54) / 64] × 0x7F`, linear in
dB from −54 to +10 across 0–127 with LV 0 = −inf and a 0.504 dB step —
and the firmware-1.94 measurements agree with it to within 0.10 dB at
every one of their 52 finite points, with no outliers. The rule stands
anyway: the console _display_ is what is being matched, and a firmware
is free to move the taper. Use the law to CHECK a calibration, not to
compute a level.

What is genuinely unreliable is the PDF's printed anchor table, not its
formula: those rows are rounded to whole dB and rounded inconsistently
— the `+5 dB` row even self-contradicts, listing hex `74` against
decimal `117` (`0x74` is 116; the formula gives 117).

### 3.3 NRPN parameters on a channel — `two-impl`

Same triple shape, different parameter LSB:

| Param             | LSB     | Data                                                    |
| ----------------- | ------- | ------------------------------------------------------- |
| main assign       | 18      | 7F on / 3F off                                          |
| DCA assign        | 40      | on: `40 + dca` (dca 0–23), off: `dca`                   |
| mute-group assign | 40      | on: `58 + mg` (mg 0–7), off: `18 + mg`                  |
| PEQ band b type   | 1A + 4b | 0 bell, 1 lf_shelf, 2 hf_shelf, 3 low_pass, 4 high_pass |
| PEQ band b freq   | 1B + 4b | 0–127, f = 20·1000^(v/127) Hz                           |
| PEQ band b width  | 1C + 4b | table 0x00 (1.5) … 0x18 (0.11)                          |
| PEQ band b gain   | 1D + 4b | 0–127 linear over −15…+15 dB                            |
| HPF frequency     | 30      | 0–127, f = 20·100^(v/127) Hz                            |
| HPF on/off        | 31      | 40 on / 00 off                                          |

PEQ bands b = 0..3. Band 0 may be bell/lf_shelf/high_pass; band 3
bell/hf_shelf/low_pass; bands 1–2 bell only.

### 3.4 Scene recall — `hardware`

```
Bn 00 bank   Bn 20 00   Cn pc        bank = (scene−1) div 128, pc = (scene−1) mod 128
```

Scenes 1–500 across banks 0–3. Bank in CC0 (MSB) — confirmed by the
PDF, which writes all four banks as `BN 00 <bank>, CN SS` and never
mentions CC32 at all. (Console Control brief §6.8.3 had the bank in
CC32 — wrong.) CC32 is nonetheless sent as 0 so the stream stays
byte-identical to the Reaper traffic proven over years of shows; the
PDF's silence means it is presumed harmless rather than known to be,
which is a 30-second console check.

The console **transmits a recall made on its own screen**, which is what
makes scene state mirrorable without polling — but it sends the
**two-message form**, `Bn 00 bank` then `Cn pc`, with **no CC 32**. The
fixtures are deliberately the client's three-message shape, because that
is what we send; a decoder must accept both, and treat a lone `Cn pc`
with no preceding bank as bank 0.

### 3.5 Cue-list recall — `single` (Surface socket)

```
Bn 00 bank   Cn pc        id 0–1999, bank = min(15, id div 128), pc = id mod 128
```

2000 user-assignable Recall Ids across 16 banks (the last bank stops at
pc `0x4F`). The console **transmits this message** when a cue is
recalled from the console, so the Surface socket carries cue state the
MixRack socket does not. The MIDI message for a given cue can be read
off the console in Scene Manager → Surface MIDI.

### 3.6 Go / Next / Previous — `hardware` (Surface socket)

A single CC on the base channel; number and value are whatever the
operator assigned in Utility → Control → MIDI.

```
Bn cc val
```

### 3.7 Console Actions — `hardware` (MixRack socket)

Same shape as 3.6 — user-assigned CC on the base channel; the pack
fires them at 51325 in shows. There is no enumeration: the module's
Actions table is user-entered.

```
Bn cc val
```

### 3.8 Send level — `hardware`, calibrated

```
F0 00 00 1A 50 10 01 00  0N 0D CH  0M DST LV  F7
```

`0N`/`CH` source (N includes the type offset), `0M`/`DST` destination
(aux / fx send / matrix / ufx send, with _its_ type offset). `LV` is
0–127.

**The send law is the fader law.** Swept over all 128 steps on firmware
2.12 (5 Sep 2026): the send readings are identical to the fader readings
at every step, and both sit within 0.05 dB of the published
`LV = [(dB + 54) / 64] × 0x7F`. The long-standing "uncalibrated, keep it
raw" caveat is discharged; dB display for sends is safe.

**The source is not restricted to inputs and groups.** The PDF's heading
names the message by its _destination_ ("AUX / FX / Matrix Send Level")
and puts no stated restriction on the source operand. Aux 1 → Matrix 1
was confirmed on hardware — the send moved. Every published dLive module
copies the narrower reading and omits it. Note the asymmetry with §3.9:
the same source on an _assign_ does nothing.

### 3.9 Input → mix assign (group / aux / matrix) — `two-impl`

An aux source was tried on hardware and **does not work**: the `0E`
message was accepted and relayed to the other clients, but the assign
button did not change. Accepted-and-relayed is not applied — the relay
proves only that the desk passed the bytes on.

```
F0 <hdr> 0N 0E CH  0M DST  40|00  F7
```

### 3.10 Preamp (by socket) — `hardware`

```
En SOCK GAIN                          gain, +5…+60 dB;  GV = [(dB − 5) / 55] × 0x7F
F0 <hdr> 0N 09 SOCK 40|00 F7          pad
F0 <hdr> 0N 0C SOCK 40|00 F7          48 V
```

Gain range is **+5…+60 dB**, confirmed on hardware at GV `00` and `7F`.
The −10…+50 dB figure some tooling carries is iLive's, not dLive's.

All on the base channel `N` (no type offset). Gain rides a _pitch bend_
status byte: the socket is the first data byte (MIDI's LSB position)
and the gain the second (MSB). A generic MIDI library that combines
pitch bend into one 14-bit value will scramble it — handle the two
bytes raw.

### 3.11 Name & colour — `hardware`

Names are **8 characters**. Twelve were written and `ABCDEFGH` came
back.

```
F0 <hdr> 0N 01 CH F7                  get name
F0 <hdr> 0N 03 CH <ascii…> F7         set name (7-bit ASCII; console truncates)
F0 <hdr> 0N 04 CH F7                  get colour
F0 <hdr> 0N 06 CH COL F7              set colour  0 off 1 red 2 green 3 yellow 4 blue 5 purple 6 lt_blue 7 white
```

Replies: `0N 02 CH <ascii…>` and `0N 05 CH COL`.

### 3.12 UFX global — `two-impl`

```
Bn 0C key      0 = C … 11 = B
Bn 0D scale    0 major, 1 minor
```

### 3.13 Gets — `hardware` for the shapes below

Pad and 48 V answer with their **dedicated reply ops** (`08` / `0B`),
not the generic `05 0F` form that was inferred here before. Preamp gain
answers the PDF's `05 0B 19 <socket>` form with a pitch bend
`En <socket> <gv>`; the inferred `05 0E` form is silent — retired.
A burst of 300 Gets produced 300 replies with nothing dropped. Replies
come back in **11.5 ms median, 29 ms worst case** — not the ~1 ms a
loopback simulator suggests. Anything that assumes a Get is effectively
synchronous is calibrated against the sim, not the desk.
The generic Get wraps the _message type_ the reply will come back as:

```
F0 <hdr> 0N 05 09 CH F7                mute        (09 = Note On)      reply: 9n CH 7F|3F
F0 <hdr> 0N 05 0B 17 CH F7             fader       (0B = CC/NRPN)      reply: Bn 63 CH Bn 62 17 Bn 06 LV
F0 <hdr> 0N 05 0B <param> CH F7        any NRPN parameter of §3.3     reply: NRPN triple
F0 <hdr> 0N 05 0F 0D CH 0M DST F7      send level  (0F = SysEx)        reply: §3.8 message
F0 <hdr> 0N 05 0F 0E CH 0M DST F7      mix assign                      reply: §3.9 message
F0 <hdr> 0N 05 0B 19 SOCK F7           preamp gain                     reply: En SOCK GAIN
F0 <hdr> 0N 07 SOCK F7                 pad                             reply: 0N 08 SOCK 00|7F
F0 <hdr> 0N 0A SOCK F7                 48 V                            reply: 0N 0B SOCK 00|7F
```

**The three preamp Gets break the generic pattern** — corrected here
after reading the PDF directly (p.4), having previously been
_inferred_ from the pattern and therefore wrong in both codecs. Pad and
48 V have dedicated Get ops (`07`, `0A`) _and_ dedicated reply ops
(`08`, `0B`) rather than echoing their set ops (`09`, `0C`); the
decoder accepts both, since an echo is what a console might plausibly
send instead. Gain uses the NRPN-style Get with parameter `19`.

The PDF's apparent slip was not one: it writes the gain Get's last
operand as `CH` rather than `MP`, and the socket does go there. The form
answers; the `05 0E` shape extrapolated from the generic pattern is
silent, and is retired rather than kept as a fallback.

Mute and fader Gets remain `single` (PDF + legacy module). Reply shapes
for the rest are still assumed to be the matching _set_ messages — the
legacy module parses fader and send-level replies that way — and stay
`inferred` until a capture says otherwise. **The scheduler must treat a Get with no reply
within 500 ms as "unsupported", not as an error**, so an `inferred`
Get that the console ignores degrades to "no feedback" rather than
a connection fault.

## 4. Messages from the console (unsolicited) — `hardware`

**The console broadcasts.** On firmware 2.12, observed 5 Sep 2026 from a
passive client that sent nothing all session: every value change reaches
every connected client, including changes made by _other_ clients. This
replaces the polling model the module was built around.

| Event                             | Arrives                                              | Carries state  |
| --------------------------------- | ---------------------------------------------------- | -------------- |
| Fader moved on the surface        | complete triple `Bn 63 CH 62 17 06 LV`, ~16 in 0.3 s | **yes**        |
| Another client's write            | that client's own bytes, relayed **verbatim**        | yes            |
| Mute toggled                      | `9n CH 7F` / `9n CH 3F`, then the `00` terminator    | yes            |
| Scene recalled at the desk        | `Bn 00 bank` + `Cn pc`, on **both** 51325 and 51328  | yes            |
| Show load                         | the whole state — 1,747 messages in 12 s             | yes            |
| Get **request**                   | another client's Get, relayed raw — see rule 11      | no             |
| Get reply                         | reaches every client, not only the asker             | yes            |
| SoftKey with a Custom MIDI string | the string, verbatim (`b0 7f 01`)                    | no — a trigger |
| MIDI Strip fader / key            | `b1 00 v` / `91 00 v` on channels 2–3 (§4b)          | no — a trigger |

Consequences, in order of how much they change:

1. **A state mirror is built from the broadcast alone.** No polling. The
   connect-time sync survives as belt and braces, not as the mechanism.
2. **Query-on-ping is retired, and the ping it answered never existed.**
   It was built on a 2026-08-11 capture in which a surface fader move
   seemed to arrive as a lone `Bn 63 CH` with no level. That capture went
   through MIDI Bridge's inbound parser, `mido.Parser`, which discards
   MIDI running status — and the desk sends every fader message in
   running status (`b0 63 00 62 17 06 <lv>`). The parser kept the `63` and
   threw away the level. The "ping" was the parser, not the console, on
   1.94 as on 2.12 (bridge `0ff0f46`, 13 Sept 2026); read through a
   running-status-aware parser, 2.12 sent **zero** lone pings in 40,000
   records. The same artefact explains the loop: the `63` leg of each
   reply fired a Get whose own running-status reply reached the bridge as
   another lone `63` — 2,200 Gets/s until the operator intervened. The
   decoder still reports a bare `63` as a `fader_ping`, and nothing acts
   on it; on a real desk the only source of one is another client's
   select, relayed raw.
3. **Relay is raw, not semantic** — see decoder rule 4. This is the one
   that bites: another controller's _partial_ NRPN arrives here missing
   its select leg.
4. **Changes made by a console Action are NOT broadcast.** CC 20 fired an
   Action that muted Input 5; neither of two other clients saw anything.
   A button that fires a console-side Toggle cannot know the result — use
   explicit Set On / Set Off Actions, or drive the mute over MIDI, where
   feedback matters.
5. **The NRPN latch is console-wide, not per-client.** Client A sent
   `b0 63 00`; client B sent `b0 62 17 b0 06 6b` with no select of its
   own; **Input 1 moved**. The desk applied B's data entry to A's
   selection. NRPN _writes_ must therefore be serialised through one
   socket — which is what the bridge is for. Multiple clients are fine
   for reading; for NRPN writing they are not.

Global MIDI Send must be on at the console for any of this.

## 4b. MIDI Strips — `hardware`

A dLive fader strip can be configured as one of 32 **MIDI Strips**,
which transmit custom MIDI rather than controlling audio. They are
named, coloured, stored in scenes and can be made scene-safe. The
factory template (Scene 9 of the Template Show) assigns:

| Control             | Message               |
| ------------------- | --------------------- |
| Fader               | `B1 00 v` … `B1 1F v` |
| Rotary gain         | `B2 00 v` … `B2 1F v` |
| Rotary pan          | `B2 20 v` … `B2 3F v` |
| Rotary custom 1 / 3 | `B2 40 v` … `B2 5F v` |
| Rotary custom 2 / 4 | `B2 60 v` … `B2 7F v` |
| Mute key            | `91 00 v` … `91 1F v` |
| Mix key             | `91 20 v` … `91 3F v` |
| PAFL key            | `91 40 v` … `91 5F v` |

This is a whole surface-as-control-source path the module does not use
yet: it turns physical strips into arbitrary triggers, which is exactly
what a Companion user wants.

**It also settles a recurring question: Sel is not on MIDI.** The PDF
excludes it from the strip controls, because Sel is what selects the
Processing screen used to configure the strip — and on 5 Sep a clean
listen on 51325 confirmed that pressing Sel emits nothing at all.
Nothing in this protocol carries channel selection in either direction,
so "follow the console's selected channel" is a dead end here. It does
move on A&H's own Director/MixRack protocol (port 51321), which is out
of scope for this module.

**Confirmed on the socket, 5 Sep 2026**: the strip mute key arrived as
`91 00 7f` and the strip fader as `b1 00 <v>`, streaming 7-bit — the
factory defaults above, on the network port, not just DIN/USB.

`Local` off makes a strip key's LED follow **remote** messages instead of
local presses (MIDI tally). Untested, and the only known way to light
anything on this desk from outside.

**The channel collision is real and it is silent.** Strips transmit on
MIDI channels 2 and 3, and those numbers are fixed — whether they follow
the Global base channel is untested, so nothing may assume they move. On
base channel 1, channel 2 is N+1 (groups) and channel 3 is N+2 (auxes):
`b1 00 xx` is then Bank Select MSB on the groups channel, and a protocol
decoder swallows the strip fader without a trace. That is what happened
in the session. The module therefore decodes channels 2–3 as strips
_before_ the protocol path sees them, and only when strip decoding is
switched on — see decoder rule 9.

## 4c. Which surface changes are broadcast, family by family — `hardware`

§4 establishes that the console broadcasts; it does not say _what_. Faders,
mutes, scene recalls and show loads were proven on 5 Sep 2026. The param
family was not, and the September report's §10 item 3b was written to settle
it: "a clean listen while the operator moves, on the desk, a send level, a
preamp gain/pad/48 V, a DCA and mute-group assign, a PEQ band and the HPF …
Decides which families the bridge's mirror can follow from the surface".

**That listen was run** — section A of the 14 Oct 2026 session, on a dLive at
firmware 2.12, base channel 12, two client sockets, the operator moving each
control at the surface in a 15 s window per step. The session's `summary.md`
left section A's free-text slots blank, so the answer sat unread in the
capture until 24 Nov 2026; these counts are the decoded events in
`capture.jsonl`, by step.

Capture: `sim/captures/2026-10-14-dlive-2/` (monorepo), protocol
`sim/session/protocols/dlive.json` draft 1, sha256 `9c518b159e12`.

| Moved at the surface            | Broadcast               | What arrived                                                 |
| ------------------------------- | ----------------------- | ------------------------------------------------------------ |
| Input send to a mono aux        | **yes**                 | `send_level` × 342                                           |
| MixRack socket gain, pad, 48 V  | **no — nothing at all** | —                                                            |
| DCA then mute-group assign      | **yes**                 | param `0x40` (`PARAM_ASSIGN`) × 8                            |
| PEQ band 1 gain, then frequency | **yes**                 | params `0x1F`, `0x21` × 332                                  |
| HPF on/off, then frequency      | **yes**                 | `0x31` (`PARAM_HPF_ON`) × 4, `0x30` (`PARAM_HPF_FREQ`) × 156 |
| Rename an input at the surface  | **yes**                 | `name` × 2                                                   |
| Show load from Show Manager     | yes, undecoded          | 18 messages the decoder does not read                        |

What this settles, and what it does not:

1. **The param family broadcasts, with one exception.** HPF, send level,
   the DCA / mute-group assign and the PEQ all reach a passive client when
   moved by hand. A mirror can follow them from the broadcast alone, by the
   same model §4 consequence 1 describes for mutes and faders.
2. **The preamp cannot be followed.** Gain, pad and 48 V produced nothing
   in a 15 s window with all three moved. For these, write-through — the
   mirror holding what clients wrote — is the ceiling the hardware imposes,
   not a gap in an implementation.
3. **Two were never listened for.** `PARAM_MAIN_ASSIGN` (`0x18`) and the
   input → mix assign of §3.9 are not in section A: step A.3 moved the DCA
   and mute-group assigns only, and step A.1 moved a send's _level_, not its
   on/off. Their broadcast status is **unknown**, and nothing may assume it
   from the rest of the table.
4. **A show load still arrives undecoded.** The 18 messages are the same
   `A.7` surprise that session's `summary.md` lists for retest; §4's "the
   whole state" row is the 5 Sep observation, and this is not yet reconciled
   with it.

Grade: one desk, one firmware, one session, counts read from the capture
rather than from a summary. Strong for the positives, where something
arrived and was decoded into a known param. Weaker for the preamp negative,
which is an absence in one 15 s window — worth a second listen before
anything is built on it being permanent.

## 5. Decoder rules

1. System real-time bytes (`F8`–`FF`) may appear anywhere, including
   mid-message and mid-SysEx; they never disturb running status.
2. Running status applies to voice messages; SysEx and system-common
   clear it.
3. A status byte aborts an unterminated SysEx; the SysEx accumulator is
   bounded (256 bytes) — an overrun drops the SysEx, never the stream.
4. **NRPN is trusted only in contiguous complete triples — as a client.**
   This rule and the console's own behaviour are opposites, and both are
   correct for what they are:

   |                                 | On an orphan data entry (`62`/`06` with no `63` of its own)                                                                     |
   | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
   | **The console**                 | applies it to whatever its **console-wide** selection currently is (§4 note 5) — one client's `63` steers another client's `06` |
   | **A client decoder (this one)** | drops it                                                                                                                        |

   The console can do that because it _owns_ the selection: there is one,
   it knows it, and acting on it is what the desk's own operators expect.
   A client cannot, because it sees the selection only through relayed
   bytes it may have missed the start of. Modelling the console's rule on
   this side does not reproduce the console's behaviour; it invents
   values. A simulator implements the console's rule, this decoder
   implements the client's, and the fixtures pin the client side. Because relay is raw, another controller's partial NRPN
   arrives here verbatim, missing its select leg; combining that orphan
   data entry with a stale address invents a value for a channel nobody
   touched. It did exactly that on the desk, producing a phantom
   "Input 128 → LV 107" (`rx.nrpn.orphan_data_entry_dropped`).

   So: `63` starts a run, `62` continues it only if it is the very next
   message on that channel, `06` completes it only if `62` was. A `06`
   may repeat while the run is unbroken — that is how a fader move
   streams. Anything else ends the run, and a `63` that is never
   continued surfaces as a `fader_ping`, which nothing acts on (§4).

5. `Bn 78`–`7F` is **not** MIDI channel mode here. A SoftKey assigned the
   Custom MIDI string `B0,7F,01` put exactly those bytes on the socket
   (§4), so the whole high range is ordinary user traffic. Inbound it is
   reported as a `cc` event for triggers; the module never sends it.
6. Note On velocity ≥ 0x40 = mute on, else off. Note Off = ignore, and
   Note On velocity 0 = ignore — the console writes its mutes as a pair
   (`9N CH 7F`, `9N CH 00`), so reading the terminator as a mute-off
   makes every desk mute arrive as on-then-immediately-off.
7. Channel → type is resolved with the configured base channel; a
   voice message on a MIDI channel outside `N..N+4`, or on an address
   in a gap of the §2 table, is passed through as `unknown`. A CC on a
   protocol channel that is not NRPN or Bank Select — an Action echo,
   UFX, Go/Next/Previous, a SoftKey string, one of our own apps
   signalling (§7) — is reported as `cc` rather than dropped.
8. **Transparent messages** — Note Off, the velocity-0 mute terminator,
   non-A&H SysEx, and real-time bytes — neither flush a pending ping nor
   break an NRPN run (`rx.nrpn.triple_survives_transparent_between`).
   They are the only exceptions to rule 4, and they are safe ones: none
   of them can carry another controller's NRPN. Refusing them too would
   drop real fader moves whenever a mute pair lands mid-triple, which on
   a broadcast desk is ordinary traffic.
9. **MIDI Strip traffic is claimed before the protocol path** when strip
   decoding is on: `9n`/`Bn` on MIDI channels 2–3 decode as strips (§4b)
   and never as groups or auxes. Off by default, because on base channel
   1–3 the two readings are genuinely ambiguous and the protocol one is
   what an operator without MIDI Strips expects.
10. The decoder is one-directional. SysEx op `05` means _Reply Colour_
    coming from the console and _Get_ going to it, so a tap that sees
    both directions through one parser cannot tell `00 05 09 00` (colour
    reply, input 10, off) from `00 05 09 00` (Get mute, input 1). Parse
    each direction with its own instance.
11. **Relayed Get requests arrive on the inbound stream**, because the
    console relays requests and not merely replies (§4). This drags the
    rule-10 ambiguity out of the "tap" hypothetical and into ordinary
    traffic: op `05` now genuinely arrives from the console in both
    meanings. Length separates most of it — a colour reply body is always
    four bytes (`0N 05 CH COLOUR`), while a Get is five (`05 0B …`) or
    seven (`05 0F …`) — so anything longer than four is a relayed Get and
    is dropped. At four bytes only `05 09 <v>` collides, and there the
    fourth byte decides: a colour is `00`–`07`, so `v > 7` is a relayed
    Get mute. **`05 09 00`–`05 09 07` stays irreducibly ambiguous** — it
    is both a colour reply for input 10 and a Get mute for inputs 1–8.
    This decoder reads it as the colour reply, because dropping real
    colour replies for one input is worse than a rare spurious one, and
    because a Get is always followed by its own reply.
12. On the Surface socket a cue-list recall (§3.5) is byte-identical to
    a scene recall and decodes as `scene` — a listener on 51328 must
    label accordingly. Whether the Surface pushes anything at all is
    checklist item 7.

## 5b. Our own apps' control changes

Ordinary user CCs on the base channel, meaningless to the console, which
reach us only because the desk relays every client's writes (§4). Listed
so nothing else in the family claims the same number.

| CC  | App                | 127          | 0         |
| --- | ------------------ | ------------ | --------- |
| 85  | Pilot Tone Trigger | tone present | tone lost |
| 86  | Talk Light Trigger | talking      | clear     |

## 6. Liveness

TCP connect succeeding means nothing — a console with MIDI set to
Off or Secure, or the wrong device entirely, accepts the socket and
drops every byte. After connect the module sends **Get Name for Input
1** and reports `Ok` only when the reply for _that target_ arrives
(matched by target, never by timing). The same probe repeats every
15 s; two consecutive misses → `ConnectionFailure` with the message
"Connected, but the console is not responding. Check Utility →
Control → MIDI: mode must be On (not Off or Secure) and Global MIDI
Receive must be enabled."
