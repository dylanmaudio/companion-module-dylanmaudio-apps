# Research: the other consoles' Companion modules

> RESEARCH: Companion modules, 20 Oct 2026, for the module's 1.2.0 line
> (multi-console: the SQ first, then the Wing, the Avantis and DiGiCo) and
> MIDI Bridge 1.5.0. The roadmap's train 3 asked for it
> (`docs/ROADMAP.md` in the monorepo, "A survey of the existing Companion
> modules").

**Method.** I read each module's repo at the commit named in §10:

- its HELP, manifest and source;
- its issues, PRs and tags;
- its Bitfocus store listing;
- user discussion where it was easy to find.

**I read them for reference only.** No code was copied, and no value map
or constant was taken from them. No console or device was contacted.

**The rule for constants.** "Copy nothing" covers derived constants as
well as code. Every byte value or number in this document is one of three
things:

1. **A published document's.** That means A&H's, Behringer's or DiGiCo's,
   through our own research docs.
2. **Our own measurement**, with its source named.
3. **A description of what another module does** (its port, its renewal
   interval, its tuning), tagged **code** and quoted _to explain its
   behaviour, not adopted_.

Nothing in group 3 is a value for us to use. A timing or a fingerprint we
would build on is measured on our own captures. A value map we wanted from
one of these modules would get the provenance treatment `docs/protocol.md`
gives the dLive maps: the MIT notice kept with the value, and its tier
recorded. None is proposed here.

The SQ and dLive facts called _measured_ are ours, from
`docs/status/console.md` in the monorepo. The Wing, DiGiCo and Avantis are
still unmeasured.

**Evidence tags:**

| Tag       | Meaning                          |
| --------- | -------------------------------- |
| **code**  | read in their source             |
| **docs**  | their HELP, README or store page |
| **issue** | an issue or PR                   |
| **ours**  | our measurement                  |
| **inf**   | inference                        |

Issues filed from this survey are in §11.

## Summary

**The picture.** Every console module on the Bitfocus store is a
_direct_ client: it opens its own connection to the desk.

**On the desks we're adding, a direct client is exclusive:**

- **The SQ** has one MIDI connection (measured).
- **The Wing** has one OSC subscription (documented).
- **DiGiCo** gives two-way feedback to one Pad device (their HELP).

So a user who runs Bitfocus's module for the same desk as MIDI Bridge
doesn't get two working controllers. They get one working, or neither.
Usually it's the same Companion, because the bridge listens only on its
own machine today.

**None of those modules says so in its HELP.** Only the Wing's comes
close. Their users meet it as "ECONNRESET, reboot the desk" (SQ) or
"feedback comes and goes" (Wing).

**The store today:**

| Desk                                    | Bitfocus module (store / newest)                                                            | Connection                                                                                 | What it costs the desk                       | With MIDI Bridge                                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **SQ**                                  | `allenheath-sq` 3.1.0 / 4.0.0-rc1                                                           | MIDI TCP 51325, one socket, **never reconnects**                                           | **the** one MIDI slot                        | **Exclusive.** Whichever connects second is reset. A vanished holder locks the desk until it returns (#232) |
| **Wing**                                | `behringer-wing` 2.3.1 / 2.4.0-alpha.2                                                      | OSC UDP 2223, `/*S` every 9 s (down to 100 ms), no off switch                              | **the** one subscription                     | **They steal it from each other, silently.** Feedback flickers in both                                      |
| **DiGiCo SD/Quantum**                   | `digico-osc` 1.0.4 (2022) / 0.9.1 rewrite, untagged                                         | OSC UDP, registered on the desk as a "DiGiCo Pad", binds 7001                              | one device entry; one Pad with feedback      | Port clash on one computer; one Pad with feedback (unmeasured on current software)                          |
| **dLive**                               | `allenheath-dlive` (Tim Steer) 1.0.1 / 1.1.0; `allenheath-dlive-ilive` 2.0.3 (1.3.8 stable) | MIDI TCP 51325 **or** the Surface's 51328; dlive-ilive also opens A&H's network port 51321 | one of the MixRack's **four**                | Fine while slots last. A fifth is silent and **shows green** in both                                        |
| **Avantis**                             | `allenheath-avantis` 2.0.2 / 2.1.1 merged, unreleased                                       | MIDI TCP 51325; 2.1.1 adds AH-Net on 51321, reopened every 24 s                            | unknown                                      | Unknown until measured                                                                                      |
| **Qu** (not on our roadmap)             | `allenheath-qu` 1.0.9 (2022, abandoned); Qu-5/6/7: community only                           | MIDI TCP 51325                                                                             | **the** one MIDI connection (A&H's document) | Exclusive, as the SQ                                                                                        |
| **X32/M32** (researched, not scheduled) | `behringer-x32` 4.0.3                                                                       | OSC UDP 10023, `/xremote` every 1.5 s                                                      | one of **four** leases                       | Fine while leases last. A fifth looks like a quiet desk                                                     |

### The top coexistence risks, ranked

1. **SQ: one MIDI slot, and their module never gives up or retries.**
   - Bitfocus's SQ module never reconnects (code). It also reconnects in the same tick on any config change, inside the ~2 s the desk takes to free the slot.
   - Its users already hit our measurements as unexplained lockouts: SQ #77, #96, #82, #50, #42.
   - When our 1.2.0 meets a Companion that still has an SQ connection enabled, one of the two goes red. It may stay red until touched, and the user blames whichever app they changed last.
   - **Do:**
     - The bridge says _slot held, and by whom_. Companion is usually the holder, found in this machine's TCP table (#246).
     - It never becomes the ghost itself (#232).
     - Our HELP says "disable Companion's Allen & Heath SQ connection for this desk", with a table from their action names to ours (#253).
2. **Wing: one subscription, taken silently.**
   - The Bitfocus Wing module renews `/*S` unconditionally and can't be told not to.
   - Its maintainers declined a poll-only mode, and called a broker "best as its own standalone application" (issue #140 there). MIDI Bridge is that application.
   - **Do:**
     - Measure whether the native TCP 2222 protocol escapes the problem.
     - If not: Subscriber, Guest (poll) and Hub (stand in for the desk so their module points at us) modes; lease-loss detection that names the culprit; never renew faster to win (#247).
3. **dLive: four slots, and a fifth looks connected.**
   - Each direct dLive connection aimed at the MixRack costs a slot. dlive-ilive also opens A&H's network port.
   - Neither direct module has a heartbeat, so an unserved one shows green for ever.
   - Every client shares one NRPN latch, so a foreign client's fade can interleave with ours.
   - **Do:**
     - #225's message;
     - a census of other clients from relayed traffic (#248);
     - a slot table in HELP (#253);
     - a Surface socket, which removes the main reason anyone adds Tim's module beside ours (#249).
4. **DiGiCo: one registration per program, one Pad with feedback, fixed UDP ports.**
   - Their rewrite binds 7001 by default, and its HELP tells users the reverse of its defaults.
   - **Do:** a setup card for the desk, ports clear of 7000–7003, a named port conflict, a heartbeat; later a Pad relay (#250).
5. **Avantis: no level Gets.**
   - A client that joins mid-show knows names, not the mix.
   - **Do:**
     - an explicit _unknown_ value in the mirror, with "?" on keys;
     - refuse toggles and relative fades from unknown (#251);
     - measure slots before promising coexistence.

**Across all of them:**

- **Every direct module can show green while it isn't being served.** Our module should say "answers, but changes aren't arriving" apart from "down" (#254).
- **The bridge only listens on its own machine today.** That shuts out the CompanionPi users who are loudest in the SQ and Wing trackers (#106).

### The top feature ideas, ranked

| #   | Idea                                                                                                                                     | Why                                                                                              | Issue |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----- |
| 1   | **The coexistence verdict on our keys**: status text, a `console_feed` variable, a "Console feed is live" feedback                       | No other module can tell "answering" from "deaf"                                                 | #254  |
| 2   | **HELP: running alongside other modules**, with slot costs, setups that work and an SQ migration table                                   | None of theirs explains coexistence; ours must                                                   | #253  |
| 3   | **Store / restore and "dip while held" presets**, from the bridge's mirror                                                               | X32 and Wing users rely on it, and we can do it on the dLive today                               | #256  |
| 4   | **Pan / balance** (SQ, Wing, X32)                                                                                                        | Every next-desk module has it, and we have none                                                  | #257  |
| 5   | **Scenes**: a recall counter for triggers; Next / Previous only after a recall has been heard; recall by name that refuses unknown names | Theirs recalled wrong scenes (SQ #102; Wing maps an unknown name to "GO on whatever's selected") | #258  |
| 6   | **SQ SoftKeys and a talk-to-mix preset**                                                                                                 | Theirs has both; our "SoftKeys can't be triggered" is a dLive fact                               | #259  |
| 7   | **Desk-named target dropdowns, one forgiving target field, comparator feedbacks**                                                        | X32's option design is the best of the lot; 1.2.0's ids are new anyway                           | #260  |
| 8   | **A Surface socket in the bridge** (dLive Go / Next / Prev, cue lists)                                                                   | The one dLive feature Tim's 1.1.0 has and we refuse                                              | #249  |
| 9   | **Raw OSC get / set for the OSC desks**, gated                                                                                           | Closes the reach gap against 99- and 104-action modules                                          | #252  |
| 10  | **An _unknown_ state rendered as "?"**                                                                                                   | Any desk without Gets (Avantis); also honest after a reconnect                                   | #251  |

**Not worth copying:**

- the Wing's ~5,700 always-on variables;
- DiGiCo's ~659 path-named actions with no presets;
- the X32's in-place change of a variable's format;
- the SQ's busy-waits on the event loop;
- sending every message twice (Wing).

**Meters** are the one big feature none of the A&H modules can have over MIDI. The Wing's is an open PR over its native TCP protocol. Meters are a bridge-era feature for the OSC desks, not a 1.2.0 item.

### Where our approach is honestly weaker

- **One more app to run, on a Mac or PC beside Companion.** It is a single point of failure for every lane, and today rules out CompanionPi, Linux and a remote Companion (#106, #103).
- **Feature lag.** A desk feature needs a bridge release, a Client API fixture and a module release. A direct module ships it in one PR, and the OSC ones reach any path.
- **No Surface socket** on the dLive (#249), so Go / Next / Prev and cue lists are theirs, not ours.
- **"MIDI Bridge" names a MIDI tool.** On an OSC desk the name undersells it and may confuse.

Where it is stronger:

- **one slot or lease for every app**, decisive on the SQ, Wing and DiGiCo, and real on the dLive and X32;
- **one mirror and one cold sync**, not a Get storm per client per restart;
- **one fade engine**, with no two controllers fighting;
- **heartbeats that tell answering from deaf**;
- **per-app attribution** in one monitor;
- **one vocabulary across desks**, behind a safety gate;
- **tests and a simulator.** Of the modules surveyed, only the SQ (41 test files), the Avantis (189 tests) and Tim Steer's dLive module have a suite. The Wing, DiGiCo, X32, dLive/iLive and Qu modules have none.

Section 9 has the long form.

---

## 1. Our module, for comparison

**The dLive connection (1.0.3; 1.1.0 is about to be submitted):**

- **Actions:** 29, of which 5 refuse with a reason (Go / Next / Prev, cue list, Surface CC).
- **Feedbacks:** 17.
- **Variables:** per strip (`name_`, `colour_`, `mute_`, `fader_`, `fader_lv_`), plus scene and diagnostics.
- **Presets:** template presets that take the strip's name and colour and say **MUTED**; scene keys named from the show file.
- **Status:** green only when the bridge reports its console link up; amber within ~20 s of a silent loss.
- **Learn** on mute and fader.

**The other app connections** are built from each app's catalogue.

**1.1.0 refuses any console but a dLive.** 1.2.0 opens the gate per family (`README.md`, `companion/HELP.md`).

## 2. Allen & Heath SQ: `companion-module-allenheath-sq`

**The facts we test it against (ours, measured 19–20 Oct, SQ-5 1.6.3):**

- **One MIDI connection on 51325.** A second is accepted, then reset when it sends.
- **A vanished client holds the slot** with no timeout (32 min in our test) until its machine returns. A clean close frees it in ~2 s.
- **A show load moves the MIDI channel.**
- **The MixPad port 51326 is separate:** three sessions, undocumented.

### 2.1 Connection and coexistence

- **One socket** to 51325 (code: `src/mixer/mixer.ts:364`). Nothing on 51326.
- **It never reconnects** (code).
  - The base library's TCP helper would retry every 2 s, but on any error the module destroys the socket, which cancels the retry (`mixer.ts:369-386`, `:334-346`).
  - The connection then sits at "Connection failure" until the user disables and re-enables it.
  - A community PR adding a 5 s retry (#126) was closed unmerged on 8 Sept, without comment. #82 asks for it.
- **Restart in the same tick** on disable→enable and on any host, model, fader-law or channel change (code: `src/instance.ts:141-159`). That is inside our measured ~2 s release window, so the new socket can be reset and is never retried (inf). It matches "disable/enable doesn't reliably work" in #77 and #96.
- **Green on TCP connect**, before the desk has answered anything (code: `mixer.ts:388-390`).
- **No keep-alive** beyond the OS's TCP keep-alive (hours).
- **Cold sync** (code):
  - a Get for every mute;
  - a 300 ms busy-wait _on the event loop_;
  - a Get for every level NRPN, ~1,260, twice in "Fully" mode.
- **The MIDI channel is fixed in config.** After a show load moves the desk's, it is silently deaf (code + ours → inf).
- **What its users hit** (issue):
  - **#35:** two Companions on one SQ: "you can't connect to two midi instances at same time".
  - **#50:** flapping with A&H MIDI Control running.
  - **#42, #53:** MixPad and SQ4You lose connection, and the desk needs a reboot.
  - **#77 (16 comments), #96:** ECONNRESET cured only by power-cycling the desk.
    - The maintainer's captures show a fresh connection accepted and every byte reset.
    - Removing a TP-Link router "fixed" it.
  - **#82:** Companion runs 24/7, the desk is switched off nightly, and the module never comes back.
  - **#102, #79:** the scene variable resets to 1 after a network blip, so "scene step" recalls the wrong scene mid-show. Closed as "make your network more resilient".
- **Our reading (inf):** #77 is our _vanished client_ case.
  - The router dropped the flow, the desk never saw a FIN, and a ghost held the one slot.
  - The maintainer suspects the desk's network stack. The one-slot-no-eviction model explains every report.
- **Its HELP says nothing** about the one connection, MixPad, DAWs or reconnecting (docs).

### 2.2 What MIDI Bridge and our module should do

- **#246, the bridge.** Classify each connect attempt:
  - a timeout or unreachable means the desk is off;
  - refused means the wrong port;
  - **accepted then reset means the slot is held**;
  - accepted but unanswered means the wrong channel.

  Then:
  - Probe with a Get for the LR mute before any cold sync.
  - Name a local holder from this machine's TCP table. Companion's node process is the likely one, since Companion runs beside the bridge.
  - Back off ≥3 s after any close of ours, then up to ~30 s.

- **#232, the bridge:** close on every exit path, and treat our own silence as loss.
- **#253, our HELP:**
  - "An SQ accepts **one** MIDI-over-network connection, and MIDI Bridge must be it."
  - "Disable Companion's _Allen & Heath SQ_ connection for this desk, and MIDI over network in A&H MIDI Control and any DAW."
  - "MixPad and SQ4You are fine."
  - "A computer that dropped off the network keeps the slot until it's back or the desk restarts."
  - A table mapping their action names to ours.
- **#254, our status:** the bridge's verdict, word for word.
- **Rejected:** having our module look for an SQ connection inside Companion.
  - A module can't list the other connections (inf).
  - Reading Companion's `db.sqlite` from the bridge would work on today's single machine, but it ties a commercial product to another app's private schema.
  - The process table is the robust route.

### 2.3 Features

**Theirs (4.0.0-rc1)** (code):

- **Actions: 45.**
  - Mute (9): On / Off / Toggle; toggle throws if the state is unknown.
  - Level: 9 source→sink, one of them a deliberately invalid stub.
  - Output level (5); pan / balance (6 + 3).
  - Assign (10), multi-sink.
  - Scene recall, and step ±50.
  - SoftKey press / release / toggle.
  - Fades: Off / 1 / 2 / 3 s only.
  - Levels are a dB dropdown or ±0.1 / 1 / 3 / 6 dB steps.
- **Feedbacks: 11** (9 mute, 2 value).
- **Variables:** `currentScene` and `sceneRecalledTrigger`, a counter that bumps on every recall and suits triggers. Plus ~1,260 `level_<MSB>.<LSB>`, and pan variables created only when the desk reports them.
- **Presets:** 104 mute keys; "mute channel with level" with a `$(local:mix)` selector; "Talk to Mix" ×12, which pulls the talkback channel from LR, assigns it to the mix and unmutes, and reverses it all on release.

**Absent from theirs:**

- names, colours, meters, EQ, preamp, all impossible over SQ MIDI (#130, #124);
- a current-scene feedback;
- assign feedback, SoftKey state, MMC, SQ-Rack.

**What we'd bring to an SQ:**

- level feedback and readable variables (`fader_ch12`, not `level_64.0`);
- a threshold feedback, assign and send-level feedback;
- a "Current scene is…" feedback;
- "Console is answering", plus Resync and Refresh;
- fades of any length that send on change;
- self-labelling level and scene presets.

Names and colours on an SQ need the MixPad port (#228); MIDI has none.

**What they have and our 1.2.0 needs:**

- **pan / balance** (#257);
- **SoftKeys** (#259), where our HELP's "can't be triggered by MIDI" is dLive-only;
- **output levels** for LR, mix, FX send, matrix and DCA;
- **assign to FX send and matrix**;
- **talk-to-mix** (#259);
- **a recall counter** (#258).

**Their UX, better:**

- the templated mute-with-level key, with a per-button mix;
- a talkback macro;
- config edits that don't restart the connection.

**Their UX, worse:**

- plain red mutes with no "MUTED";
- cryptic variable names;
- pan variables that appear only after a press;
- "Last dB value" that does nothing (`src/actions/level.ts:301-308`);
- 200 ms between the messages of every multi-command action;
- green before the desk has proven it's there;
- no level, scene or SoftKey presets;
- "CH 1" for ever.

### 2.4 Maintenance

- **Releases** (docs):
  - 1.3.x by Max Kiusso (2021–23);
  - 3.0.0, Jeff Walden's rewrite (May 2025);
  - **3.1.0 on the store** (24 Mar 2026; Companion ≥4.0, base ~1.11);
  - **4.0.0-rc1** pre-release (24 Aug 2026; Companion ≥5.0.4, base ~2.1.3, node26).

  Only dependency bumps since.

- **One active volunteer** (294 of the commits since 2025). All three community PRs of 2026 were closed unmerged.
- **A real test suite** (41 test files), unlike most modules here.
- **24 open issues.**
- **Known failure modes:**
  - no reconnect;
  - ghost lockout;
  - deaf after a channel change;
  - wrong scene after a reconnect;
  - a fader-law mismatch that silently rescales every level.

  One parser detail is worth checking on our own captures. Their parser allows for 1.5.x sending a scene message with a stray trailing program change (code: `src/midi/parse/channel-parser.ts:159-166`). That is a claim resting on their implementation alone, and not ours to fixture until our SQ captures show it.

### 2.5 Direct versus bridge, on the SQ

**Theirs wins on:**

- running anywhere, Pi included;
- free, and already on the store;
- no extra process;
- no feature lag.

**Ours wins on:**

- **the one slot shared by every app** (Companion, Console Control, a DAW). With theirs, each excludes all the others.
- a mirror, so a Companion restart doesn't re-send ~26 KB of Gets;
- fades in a long-lived process;
- connection hygiene written once;
- a persisted scene;
- per-app attribution;
- a path to the MixPad port's names and colours (#228).

**The condition.** The bridge has to be the most disciplined client on the network. A sloppy bridge locks out more than their module does.

## 3. Behringer Wing: `companion-module-behringer-wing`

**What we know of the desk** (docs, Behringer's _WING Remote Protocols_ 3.1; unmeasured):

- **One OSC subscription.** The last client to ask takes it for 10 s, and the one before isn't told.
- `mute 1` means muted.
- Levels travel in dB.

### 3.1 Connection and coexistence

- **One UDP socket** from an ephemeral port to the desk's 2223 (code: `src/index.ts:141`). No TCP; the native 2222 protocol is unused in shipping code.
- A shared discovery socket broadcasts `/?` to 2223 every 10 s (`src/handlers/device-detector.ts:95-113`). An optional OSC forwarder is a third socket.
- **`/*S` at connect and every 9 s, unconditionally** (code: `connection-handler.ts:81-110`).
  - The interval is an advanced setting, **100**–9999 ms (`config.ts:188-198`).
  - No setting turns the subscription off. It never checks whether pushes still arrive.
- **Every message is sent twice**: the write, then the same address as a query (`connection-handler.ts:166-167`, commented "a bit ugly"). So its own writes are confirmed by query, not by the subscription (code).
  - Query replies likely go to whoever asked (inf). That would explain why "actions work, feedback dies" when it loses the lease (#124).
- **Liveness is weak** (code):
  - It goes OK on the first packet.
  - The 3 s status poll was lost in the December 2025 handler refactor (`fbf6955`). Its "Status Poll Rate" now fires once, and only if "Recall Scene by Name" is used.
  - A vanished desk can leave it green. #268 is open, and #126 and #124 were the same story.
- **Its HELP** says the most recent subscriber is "the **only** receiver", and tells users to "ensure that no other application is actively subscribed" (docs). It names no apps and no working setup.
- **Its maintainers on several clients** (issue):
  - **#15** (2022) asked for master/slave; it was closed on firmware allowing more _connections_, which isn't the subscription.
  - **#140** (Oct 2025) is the key thread.
    - A user's OSC tool couldn't subscribe beside the module.
    - A poll mode was declined because it would break "almost all feedback actions".
    - OSC Forwarding shipped in 2.2.0 instead.
    - A full broker was called "outside of the scope of this module … best as its own standalone application".
    - The user's objection was a broker's single point of failure.
- **WING Edit, Copilot, Mixing Station.** Nothing shows whether they use the OSC subscription or native TCP 2222 (inf). A #173 user says WING Edit works beside the module. Open PR #265 opens a native 2222 session for meters while keeping the OSC lease. Both hint that native sessions don't touch the lease; neither proves it.

### 3.2 What MIDI Bridge and our module should do (#247, #254)

1. **Measure first** (`wing.json`):
   - (a) a second `/*S` displaces the first silently;
   - (b) Get replies route to the asker;
   - (c) **a native TCP 2222 session gets its own change notifications**;
   - (d) what WING Edit, Copilot and Mixing Station send;
   - (e) whether `-1` toggles.

   If (c) holds, the bridge speaks 2222 and never contends with any OSC client. That is the best outcome by far.

2. **If it must be OSC, three modes, shown in the popover and in `console_feed`:**
   - **Subscriber** (default): renew about every 8 s, and **never shorten on contention**. Theirs can go to 100 ms.
   - **Guest**: no subscription; round-robin Gets over watched paths; about 1–2 s latency, said so.
   - **Hub**: the bridge listens on 2223. Their module's desk IP is free text and its port fixed, so it can point at us.
     - We absorb their `/*S`, hold the one lease and fan out.
     - Queries and writes pass through on a socket per client.
     - Their ~5,700-Get startup is paced, or answered from the mirror.

   A stopgap is to accept their OSC Forwarding stream; it inherits their weak liveness.

3. **Lease loss** is inferred from verification Gets. A change with no push means a miss; two misses in 10 s, or pushes only just after our renewals, mean contended. Then resync and report.
4. **Name the culprit** from their `/?` discovery broadcasts: "Companion at 10.0.0.5 is running the Bitfocus Wing module". Hearing them needs address reuse, to check on macOS and Windows. The fingerprint is to be taken from our own capture of that module, not from its source.
5. **HELP** (#253): the one-subscription rule, the symptom, and the three setups.
   - Mention the console's OSC remote lock: a user's commands did nothing until it was off (#247 there).

### 3.3 Features

**Theirs (2.4.0-alpha.2)** (code):

- **99 actions:**
  - set / adjust / store / restore / undo for level, gain, pan and sends;
  - mute, solo, names, icons, scribble colours, delay;
  - EQ / gate / dynamics / insert on-off;
  - USB player and WLive card transport (18);
  - talkback, solo and monitor configuration (13);
  - scene recall by name and number;
  - library GO / next / prev, GPIO, sends-on-fader, select, lights;
  - **raw OSC send** (3).
- **18 feedbacks, all boolean.** No fader level, colour, name or meter.
- **~5,700 variables.** #204 complains of a slow variables page; #267 of names blank after startup.
- **8 preset templates (~312 keys):** mute, solo, sends-on-fader, "Boost & Center" (+3 dB fade and centre pan, then restore), talkback A/B, lights.
  - The mute key says "Mute CH 1", not the strip's name.
- **Fades in the module**, every 50 ms, and every step goes out twice.

**Hazards:**

- **"Recall Scene by Name" maps an unknown name to index 0 and sends GO**, which fires whatever is selected (code: `src/actions/control.ts:42-45`). **Ours must refuse** (#258).
- **Send-mute feedback is inverted** (#227 there). The maintainer says the Wing's mute state "is not internally consistent", which is worth a decoder fixture when we measure.

**Better than ours:**

- desk names in every strip dropdown;
- six learn buttons, against our two;
- toggle done on the desk (`-1`), not from a possibly stale mirror. Copy it if (e) confirms it;
- a flash-wear warning on Save;
- breadth.

**Worse than ours:**

- no level, colour or name feedback;
- no self-labelling presets;
- scenes by number blind;
- liveness that can lie.

### 3.4 Maintenance

- **The store has 2.3.1** (15 Apr 2026, base ~1.13).
- **2.4.0-alpha.2** (6 Oct, Companion 5 only, base ~2.1.3) is a pre-release in store review (#259 there). GitHub Releases still says 2.2.2.
- **Two active maintainers** (Janik Witzig 178 commits, Elliot Matson 95), 92 commits in 2026, 16 open issues, **no tests**.
- **Known failure modes:**
  - UDP startup bursts drop replies (#169);
  - missing upgrade scripts crashed fresh installs (#209, #213; fixed in 2.3.0);
  - feedback reliability still being fixed (#174, #216);
  - the forwarder's logger is overwritten with `undefined`, so its errors are never logged (code).

## 4. DiGiCo SD / Quantum: `companion-module-digico-osc`

**Two codebases** (code, issue):

- **The store has 1.0.4**, the 2022 module, served as legacy.
- **The repo now holds a Companion 5 rewrite, 0.9.1**, merged from github.com/MeestorX/companion-module-digico-osc by PR #22 (4 Oct).
  - Its author is Andrew Broughton, also one of the authors our README credits for dLive prior art.
  - It is untagged, numbered below 1.0.4, and handed out as a beta on the author's forum.
  - Its upgrade script maps the legacy action ids, so it is meant to replace 1.0.4.
  - It drops the S-series.
- Also seen, neither on the store:
  - **hx3-f/companion-module-digico-4rea4**, a 4REA4 module adapted from the dLive/iLive one: MIDI over TCP, five channels like a dLive;
  - an S-series alpha mentioned in #13.

### 4.1 Connection and coexistence

- **It registers on the desk as a "DiGiCo Pad"** with the iPad command set (`iPadv2sd8-9-11-12`, or `ipad_q3` for Quantum) (docs).
  - The engineer types Companion's IP and two ports under External Control.
  - HELP also asks for Suppress OSC Retransmit on.
- **It binds one fixed UDP port, default 7001** (code: `src/mixers.ts:82`).
  - Gets go out from that socket.
  - Sets go out through Companion's own OSC sender, from an ephemeral port (`mixers.ts:157,162`). So the desk evidently matches a client by IP, not by IP and port (inf).
- **The defaults are the reverse of its HELP.** The defaults send to 7000 and listen on 7001 (`src/config.ts:13-21`); HELP says the desk sends to 7000 and listens on 7001. Anyone who keeps the defaults and follows HELP gets silence. Open PR #24 swaps them.
- **Status goes OK when the port binds**, whether or not the desk ever answers. Losing the desk is never detected. PR #24 adds a 15 s heartbeat (code, issue).
- **Writes don't update its own cache** (code: `main.ts:97-99`). With Suppress Retransmit on, as HELP recommends, toggles and relative moves read stale values.
- **One Pad with feedback at a time.** The legacy HELP (`HELP.md:23` at v1.0.4) and #12 and #14 say only one bidirectional device can be enabled; others can be "OSC" devices with no feedback (docs, issue). Unmeasured on current software.
- **Its answer is an iPad relay** (code: `ipadRelay.ts`). The DiGiCo iPad app points at Companion (7002/7003), its packets are forwarded to the desk, and the desk's are copied back.
- **Next to MIDI Bridge** (inf):
  - two programs on one computer can't bind one UDP port;
  - two device entries for one IP may compete;
  - with the one-Pad limit, only one of us has feedback.

### 4.2 What MIDI Bridge and our module should do (#250)

1. **A desk setup card** with a copy button:
   - type DiGiCo Pad;
   - this machine's IP on the console's subnet;
   - Send = the bridge's port, Receive = the desk's ("Send is the desk sending to us");
   - External Control on;
   - the command file to load;
   - the Suppress Retransmit setting.
2. **Default ports outside 7000–7003 and 8001–8002.**
3. **Name the process on EADDRINUSE**, e.g. "port 7001 is held by Companion (its DiGiCo OSC connection)…".
4. **A heartbeat** (`/Console/Name/?`, ~5 s). "No packets" and "packets, but no replies" are kept apart.
5. **Mirror on send.**
6. **Later, a Pad relay**, so the iPad app and the DiGiCo OSC module sit behind the one registration as named lanes.
7. **Measure at the SD session:**
   - two Pads from one IP;
   - the one-Pad limit;
   - writes from an unregistered port;
   - whether Suppress Retransmit is keyed by IP or by entry.

### 4.3 Features

**Theirs (0.9.1)** (code): generated from a CSV.

- **~659 actions**, one per writable OSC path, the id being the path:
  - inputs, auxes, groups and matrices;
  - dynamics, EQ, GEQ, inserts, delay;
  - snapshots (recall, next, prev, fire, insert, update, rename, delete, undo);
  - macros and macro buttons;
  - DiGiCo channel-library presets.
- Most actions offer relative and cross-fade. Channel pickers are multi-select with "All". Names come live from the desk. Learn, and an action recorder.
- **~653 value feedbacks.** No boolean feedback with a style.
- **12 variables. 0 presets.**
- **No colours. Meters unfinished.** 15 CSV rows are marked "MAYBE?".

**Theirs has, we'd need:**

- snapshot editing and next / prev;
- macro buttons with state;
- snapshot notes;
- multi-target "All";
- breadth.

**Ours is better on:**

- presets;
- styled feedbacks;
- an honest status;
- one fade engine;
- human, frozen ids. Theirs are OSC paths, stable only as long as the CSV is.

### 4.4 Maintenance

- **People:** Jeffrey Davidsz (2020), Sydney Dykstra (2021), Andrew Broughton since Oct 2026.
- **Issues:** 9 open, mostly pre-rewrite and answered with a beta link.
- **PRs:** two open community PRs (#24 ports and status, #25), unreviewed.
- **No tests.**

## 5. Allen & Heath dLive: two modules

### 5.1 `companion-module-allenheath-dlive` (Tim Steer)

- **The store has 1.0.1** (Feb 2026): **send-only**. Incoming bytes are logged and dropped (code at `v1.0.1`, `src/main.ts:80-92`).
- **1.1.0 was tagged on 14 Oct**, not yet on the store. It adds:
  - a **Connect To** setting, MixRack (51325) or **Surface (51328, the default)**, or a custom port;
  - feedback from a parsed stream, with Gets on connect for subscribed values;
  - presets.
- **One socket per connection. No heartbeat:** only the base library's OS TCP keep-alive, plus a 2 s retry after a close.
- **Features (1.1.0, code):**
  - **25 actions:** mute, fader and ±dB, sends, assigns, socket preamp, name, colour, scene recall on the MixRack, **cue-list recall (0–1999) and Go / Next / Prev on the Surface**, PEQ, HPF, UFX, MMC (device `7F`, marked unverified; the desk itself sends `0B`).
  - **3 feedbacks**; variables created on demand.
  - **1,024–2,527 enumerated presets.** They hard-code `$(dLive:…)`, which breaks under another connection label.
  - **Open PR #41** adds Action recall on the Surface. It assumes Actions are Surface-only, though our hardware session sent them on the MixRack.
- **Its trap.** 1.0.1 defaults to the Surface and still offers "Recall Scene" there, where those bytes recall a cue list. dlive-ilive's #18 is the same bug.
- **Maintenance:**
  - TypeScript, Jest (1,218 tests in PR #41), CI;
  - base ^1.4.0, node22, Companion 3 to 5;
  - the maintainer borrows a dLive to test (PR #8 waited months);
  - the big features came from a contributor;
  - open: #10, #13, #18 (base channel 2–6), #20, #35.

### 5.2 `companion-module-allenheath-dlive-ilive`

- **Two sockets on a dLive** (code: `index.js:442-487`, `:744-753`):
  - MIDI, defaulting to **51328** at **192.168.1.70**, the Surface's port on the MixRack's address, which can't work;
  - **51321**, A&H's network (Director) port, for talkback and Virtual Soundcheck.
- **v2.0.3 doesn't read back.** The unreleased head reads fader and send levels for fades, after 128 Gets 100 ms apart.
- **It ignores the base channel** for mutes, faders, sends and DCA assigns (#12, #16, #17). The community answer is "set the desk to 1–5".
- **v2.0.3's `init()` ignores its config** (#19; fixed in a PR, never released).
- **Talkback over 51321 is broken** (#13, #24).
- **Store status.** The store page shows 2.0.3; the store's API marks 2.0.x as pre-release, with 1.3.8 stable.
- **Effectively orphaned.** Its maintainer stepped away in 2025, and #30 proposes making it iLive-only.
- **The two dLive manifests list each other in `legacyIds`**, so Companion offers each as an "upgrade" to the other (code).

### 5.3 Coexistence with MIDI Bridge

**What we've measured:**

- **Four MixRack slots,** and a fifth is accepted and never served.
- **The desk relays every client's raw bytes and Gets to every other client.**
- **The NRPN latch is console-wide.**

**What that means for these modules:**

- **A direct connection aimed at the MixRack costs one slot.**
- **One aimed at the Surface probably doesn't** (inf, unmeasured).
- **dlive-ilive adds a network-port connection** whose cost to Director users is unknown.
- **Neither module has a heartbeat, so an unserved fifth shows green for ever.** dlive-ilive's #16 ("connected, nothing happens") and #19 look like this (inf).
- **Neither HELP mentions slots.**
- **The real cross-client hazard is the shared NRPN latch.** Both modules send each triple in one write, which mostly protects them. dlive-ilive's unreleased fades stream triples every 50 ms for up to 60 s, though, and the bridge can only serialise its own lanes (#101).

**What to do:**

- **#225 first:** "the desk accepted but isn't serving; a dLive serves four".
- **#248:** a census of other clients from relayed traffic, shown as "at least one other". Lone NRPN triples, relayed Gets and each module's connect burst would be fingerprinted from **our own captures** of those modules running against the Virtual dLive, not from their source.
- **#253:** a slot table in HELP, plus the advice "for Go / Next / Prev today, add `allenheath-dlive` 1.1.0+ aimed at the **Surface**, and keep console control on the bridge".
- **#249:** our own opt-in Surface socket.
- **#261:** correct `docs/protocol.md` §1. It still says each endpoint accepts "up to 40 simultaneous TCP connections" and that nothing needs to arbitrate for the socket.
  - **A&H documents 40 per endpoint.** Measured on a MixRack (firmware 2.12), four are served, and a fifth is accepted, then silent. **The gap is unexplained.**
  - Plan for four.
- **Measure at the next dLive session (~27 Oct):**
  - Does Director take a MIDI slot?
  - Does a Surface client take a MixRack slot?

### 5.4 Features, compared

**They have, we don't:**

- Surface-socket features (Go / Next / Prev, cue lists, Surface Actions);
- MMC transport;
- a UFX unit-parameter CC on the MixRack, which we refuse as Surface-only;
- iLive;
- easing curves (dlive-ilive's unreleased head);
- talkback and Virtual Soundcheck over 51321: broken, and dropped by Tim as unsupported;
- a preset per channel to browse.

**We have, they don't:**

- 17 feedbacks;
- names and colours on keys;
- the current scene and its name;
- show-file import of scene names and the Actions table;
- dB-calibrated sends;
- diagnostics;
- loss detection in ~20 s;
- base-channel discovery;
- Console Actions on the MixRack, verified on hardware;
- bridge-app control.

## 6. Allen & Heath Avantis: `companion-module-allenheath-avantis`

- **The store has 2.0.2** (7 Jun 2026): **send-only**.
  - No reconnect, no keep-alive.
  - The status never reflects the link, and incoming data is only logged.
  - #3 ("OK, but nothing works") has been open since 2022.
- **2.1.1** (PR #44, merged 18 Oct, not released): "Avantis 2.0 and RackUltraFX".
  - **MIDI TCP 51325** for commands. 8 s connect timeout; reconnect backoff 1/2/5/10 s for ever.
  - **Liveness:** a Get Name for Input 1 every 15 s, with a reconnect if there's no reply in 5 s.
  - **An optional AH-Net session on 51321**, A&H's own Director/MixPad protocol, reverse-engineered with A&H's written non-objection but no support.
    - It is **reopened every 24 s** (code: `main.ts:1328`), because the desk drops light sessions after ~30 s.
    - It brings cold-start fader levels, scene names, talkback and USB state, firmware and dPack detection.
- **Over MIDI, an Avantis pushes surface changes but answers Gets only for names and colours** (docs, code).
  - 2.1.1 treats an unknown mute as unmuted for a toggle.
  - It refuses timed and relative fades until the level is known.
  - Mute groups sit at dLive's DCA 17–24 addresses. This is A&H's document, as our `sim/avantis/fixtures/protocol.md` already records; their code agrees.
- **Its HELP says** "one module connection per console" and warns that MIDI ignores user profiles. Nothing on Director, MixPad or a DAW.
- **Features (2.1.1):**
  - ~85 actions plus 6 MMC;
  - ~30 feedbacks;
  - 13 preset categories;
  - scene queues and recall by name without a show file;
  - USB transport, Virtual Soundcheck, tempo;
  - separate health variables for the command and sync links;
  - Stream Deck+ dial presets in a PR.

  We have PEQ, HPF, preamp and 48 V, desk-coloured keys, self-labelling presets, show-file scenes, lanes and diagnostics, which it doesn't.

- **Maintenance:** Erlend Jones and others, base 2.0.4, node22, **189 tests**. The risks are a 3,098-line `main.ts`, and AH-Net, which any firmware update could break.
- **For us (#251):**
  - an explicit _unknown_ value in the mirror, shown as "?";
  - toggles and relative fades refuse from unknown;
  - a Get Name probe for liveness;
  - **measure slots, echo and vanished-client behaviour** before saying anything about coexistence.
  - AH-Net is not a route for a commercial product without our own agreement with A&H.

## 7. Allen & Heath Qu (not on our roadmap)

- **Bitfocus `allenheath-qu` 1.0.9 is abandoned** (code, issue).
  - Last real work was in 2021, and it runs through the legacy wrapper.
  - MIDI channel 1 is hard-coded.
  - Its 1 s active-sense timer stacks up on every reconnect.
  - 15 open issues have had no reply: feedback broken since Companion 3, EPIPE, "only one connection" (#23).
- **The older Qu (16/24/32/Pac/SB) takes one MIDI-over-TCP connection** (docs: A&H Qu MIDI V1.9, "only one TCP MIDI connection at a time").
  - Once the desk has had an active-sense byte, 12 s of silence closes the link.
  - The Bitfocus module claims to be Qu-Pad and sends FE every second.
  - Get System State gives a full cold sync.
- **The Qu-5/6/7/D speak an SQ-like NRPN protocol** (docs: Issue 2).
  - **Gets** for mute, level, pan and assign.
  - **No SysEx, so no names.**
  - SoftKeys and MIDI Show Control work.
- **Nothing for the Qu-5/6/7/D is on the store** (module request #1910 is open).
  - **cptechie/companion-module-allenheath-qu-d** (6 Oct 2026, TypeScript, Companion 5) is competent. Its commits are authored "Claude", and there is no sign it has met a desk.
  - **Bamagastudios/companion-module-allenheath-qu567** (Mar 2026) has 5 actions and inputs 1–12 only.
- **For us:** the same lesson as the SQ. On a one-connection desk the bridge _is_ the connection, and must name the likely holder when it's reset: A&H MIDI Control, a BomeBox, or a Companion Qu connection.

## 8. Behringer X32 / Midas M32: `companion-module-behringer-x32`

The most mature OSC console module, maintained by Companion's lead, and the best reference for option design.

**Connection** (code):

- **OSC UDP 10023**, from an ephemeral port.
- **`/xremote` every 1.5 s**, with `/xinfo` polled on the same beat. After 5 s of silence it tears down and rebinds.
- **Every write goes out through Companion's own OSC sender, from another port** (`src/main.ts:248`, commented as a deliberate hack since 2020). The desk never echoes a write to the client that made it, so this way its own writes come back as change notifications on the lease socket. It is a neat trick for confirming writes.
- **Cold sync** is ~1,900 Gets, paced by a small in-flight limit and a short timeout, with no retry. Buttons' paths load lazily. Their tuning is theirs; ours comes from the Gets-per-second measurement in our X32 and Wing protocols.
- **No resync after a reconnect.** Missed changes stay wrong.
- **Every reconnect is a new local port,** so for up to 10 s a stale lease may hold a second slot (inf).
- **Nothing about the fifth client**, in code or HELP. A lease the desk isn't serving looks like a quiet desk.
- **No issue in its tracker reports running out of slots.** "Feedback stopped" reports exist (#112, an 18-month subscription bug from the Companion 3 port).

**For us:**

- **Sell the slot economy:** "MIDI Bridge uses one of the X32's four remote-app slots, however many apps use it".
- **Copy the second-socket write trick.**
- **Report two health signals**: "answering" (`/xinfo`) and "changes arriving", by re-Getting a few mirrored paths per second (#254).
- **Resync on every reconnect,** and keep the local port across reconnects.
- **Coexisting with this module is fine** while leases last. Each sees the other's writes.

**Features** (code):

- **104 actions:** mutes, faders with store / restore, pan, sends, scenes, cues and snippets by number, talkback, solo and monitor, banks and screens, routing, inserts, recorder and X-Live, oscillator, undo.
- **56 boolean feedbacks**, with a comparator on levels and pans.
- **~1,129 variables.**
- **8 presets**, including three "dip while held".
- **Fades** at 10 fps (5–60) with 11 easings.
- **Missing:** meters (open since 2020), learn, EQ and dynamics, DCA and mute-group assign, mute variables, scene names and current scene, colour-follow.

**Patterns worth adopting** (#256, #260):

- desk-named target dropdowns with a forgiving grammar (`ch5`, `bus3`, `dca4`);
- subscribe-on-use;
- per-button store / restore with dip presets;
- fade curves;
- comparator feedbacks;
- debounced feedback updates. We already batch variable writes (`src/main.ts:421`).

**Its cautionary tales:**

- 4.0's option migration needed three patch releases (#169, #172).
- The fader variable changed format under users (#174).
- It has **no tests**.

**Maintenance:**

- **Release:** 4.0.3 (4 May 2026), base ~2.0.4, node22.
- **Issues:** 62 of 118 open; fixes since 4.0.3 are unreleased.
- **People:** Julian Waller, with contributors.

## 9. Direct module versus bridge

**A desk-specific direct module can do, and we can't (or not yet):**

- **Run anywhere Companion runs.** CompanionPi, Linux, a laptop with no bridge. Ours needs MIDI Bridge on the same Mac or PC (#106 and #103 are the LAN work). Pi users are prominent in the SQ and Wing trackers.
- **Reach everything at once.** An OSC module exposes any path in one PR. Our first-class ops each need a bridge release, a Client API fixture and a module release, checked against Console Control's comparator. #252 proposes a gated raw OSC escape hatch.
- **Open a second desk socket on a whim.** Tim's dLive module talks to the Surface; the Avantis module to AH-Net. Ours waits for the bridge (#249).
- **Survive without another process.** If the bridge hangs, every lane loses the desk. On the SQ, a hung bridge also holds the one slot.
- **Be free, and already installed.**

**A bridge can do, and a direct module can't:**

- **Share the one slot or lease.** On the SQ, Wing, DiGiCo and Qu this is the difference between coexisting and not. On a dLive or X32 it's one slot for Companion, Console Control and a DAW together.
- **One mirror, one cold sync, kept across Companion restarts.** Theirs re-fetch: SQ ~1,260+ Gets, X32 ~1,900, Wing ~5,700.
- **One fade engine,** so two controllers don't fight. Fades also run outside Companion's event loop.
- **Serialise NRPN writes across apps,** on desks with a console-wide latch.
- **Honest health:** answering versus deaf, slot held versus desk down, said word for word on every client.
- **Persist what it saw:** the current scene, the base channel.
- **Attribute every message to its app** in one monitor.
- **Keep one vocabulary across desks,** behind a gate that refuses what would be unsafe.

**The honest condition.** The bridge's advantages hold only if it is the best-behaved client on the network:

- it closes cleanly on every exit path;
- it backs off;
- it never escalates a subscription fight;
- it says what it found.

A careless bridge is worse than any of these modules, because it locks out more.

## 10. Commits read

| Repo                                             | Commit                        | Date         | Store version (20 Oct)        |
| ------------------------------------------------ | ----------------------------- | ------------ | ----------------------------- |
| bitfocus/companion-module-allenheath-sq          | `a28af99`                     | 16 Oct 2026  | 3.1.0 (4.0.0-rc1 pre-release) |
| bitfocus/companion-module-behringer-wing         | `cc16453` (v2.4.0-alpha.2)    | 6 Oct 2026   | 2.3.1                         |
| bitfocus/companion-module-digico-osc             | `0d5290d` (0.9.1)             | 5 Oct 2026   | 1.0.4                         |
| MeestorX/companion-module-digico-osc             | `6475f81`                     | 4 Oct 2026   | —                             |
| bitfocus/companion-module-allenheath-dlive       | `8f694ad` (1.1.0+), `v1.0.1`  | 15 Oct 2026  | 1.0.1                         |
| bitfocus/companion-module-allenheath-dlive-ilive | `bdf5bc2`, `v2.0.3`, `v1.3.9` | 28 Sept 2026 | 2.0.3 shown; 1.3.8 stable     |
| bitfocus/companion-module-allenheath-avantis     | `82b8f3a`                     | 18 Oct 2026  | 2.0.2                         |
| bitfocus/companion-module-allenheath-qu          | `a258827` (1.0.9)             | 20 Dec 2022  | 1.0.9                         |
| cptechie/companion-module-allenheath-qu-d        | `0abb907`                     | 6 Oct 2026   | —                             |
| Bamagastudios/companion-module-allenheath-qu567  | `e3d9179`                     | 29 Mar 2026  | —                             |
| bitfocus/companion-module-behringer-x32          | `777300c`                     | 2 Oct 2026   | 4.0.3                         |

**Store listings:** `https://bitfocus.io/connections/<id>`.

**A&H documents:**

- _Avantis MIDI TCP Protocol_ V1.0;
- _Qu MIDI Protocol_ V1.9;
- _Qu-5/6/7 MIDI Protocol_ Issue 2.

**Forum:** forums.allen-heath.com, "Controlling the SQ5 via MIDI and the SQ4You app". Searches of Reddit, Behringer's forum and Companion's discussions added nothing first-hand.

## 11. Issues filed (dylanmaudio/dLive-Utility-Apps, 20 Oct 2026)

**For MIDI Bridge (`cross-app`):**

| #    | What                                                                                                 | Label       |
| ---- | ---------------------------------------------------------------------------------------------------- | ----------- |
| #246 | SQ: say the slot is held, and by whom; probe, classify, back off                                     | enhancement |
| #247 | Wing: share the one subscription — measure 2222, then Subscriber / Guest / Hub, lease-loss detection | idea        |
| #248 | dLive: a census of other MIDI clients from relayed traffic                                           | idea        |
| #249 | An opt-in Surface socket (Go / Next / Prev, cue lists)                                               | enhancement |
| #250 | DiGiCo: one Pad registration, a setup card, clear ports, a named conflict, a heartbeat               | idea        |
| #251 | Avantis: an _unknown_ value in the mirror                                                            | idea        |
| #252 | A raw OSC get / set lane op for the OSC desks, gated                                                 | idea        |

**For the module (`app:companion-module`):**

| #    | What                                                                | Label         |
| ---- | ------------------------------------------------------------------- | ------------- |
| #253 | HELP: running alongside other console modules and apps              | enhancement   |
| #254 | Status, `console_feed` and a feedback for "answers but deaf"        | idea          |
| #256 | Store / restore and "dip while held" presets                        | idea          |
| #257 | Pan / balance (1.2.0)                                               | idea          |
| #258 | Scenes: a recall counter, safe Next / Prev, refusing recall by name | idea          |
| #259 | SQ SoftKeys and talk-to-mix (1.2.0)                                 | idea          |
| #260 | Option UX: desk-named dropdowns, one target field, comparators      | idea          |
| #261 | `docs/protocol.md` §1's "40 connections"                            | documentation |

**Existing issues this survey adds evidence to:**

- #225 (the dLive's fifth connection);
- #232 (the SQ's ghost slot);
- #228 (the SQ's MixPad port);
- #106 and #103 (a bridge on the LAN, for Pi users);
- #102 (the Quick Reference's connection note).

---

## Appendix — the SQ desk test, 21 Oct 2026

Module 1.1.91 (the 1.1.90 test line) against MIDI Bridge 1.4.92 on an
SQ-5, `verified_on_desk: true`. The operator was at the desk.

**Worked:**

- **Mute write and mirror.** A MUTE press moved `mute_ch1` false → true
  and the bridge's `tx_total` by exactly one message. Unmute returned it.
- **Scene recall.** Scene 2 → 1 → 2, one message each, and
  `scene_current` followed.
- **Names, live from MixPad.** `input.1.name` read "jn1" on Scene 2, and
  the whole set changed with the recall — Scene 1 has default names, so
  84 name paths went empty but for ST1/ST2/ST3/USB, each marked
  `default_name: true`. Names track a scene recall without being asked.

**Correctly refused, zero bytes to the desk:** every fader nudge, by the
dLive-scale guard.

**Found, and fixed before anything reached the console:** the first build
opened the per-op gate but `applyConsoleState` still forced the
connection to `failure`, so `state.connected` stayed false and every
feedback on the page would have read as disconnected.

**For 1.2.0:**

- **`default_name` is not used yet.** On Scene 1 the module shows an
  empty `name_ch1` where it should fall back to its own label and number
  ("Input 1"). The bridge already sends the flag.
- **The SQ has no scene path in the mirror** (490 paths, none for scene),
  so on connect nothing knows which scene the desk is on. It is learned
  the first time one is recalled: from 1.4.95 the bridge fires `scene`
  on **every** SQ recall, a re-recall of the current scene included. So a
  recall preset can offer an undo once it has seen one go by, but never
  straight after connecting — and it should say which, rather than
  offering an undo that silently does the wrong thing.
- **Cold sync runs on a verified family and costs ~138 messages** of
  dLive-shaped Gets. Harmless reads, but they should become the family's
  own addresses before this is anything but a test build.

### Levels on the SQ, verified 21 Oct (module 1.1.92)

With the dB path in, against MIDI Bridge 1.4.92 on the SQ-5:

- **Read:** `fader_ch1` = `0.0` dB with `fader_lv_ch1` = **15196**. That
  wire value is the SQ's own 14-bit scale (0x765C = 118×128 + 92), which
  is 0 dB on its linear law — not a 0-127 lv. The desk's dB is what the
  variable shows; our dLive table is not involved.
- **Write:** a +1 dB nudge sent one message and came back at `+1.0` dB,
  wire **15315**. 119 steps for 1 dB matches the law's ~1,187 per 10 dB.
  The reverse nudge returned it to 15196 exactly.
- A raw 0-127 level is still refused on a non-dLive family; that path is
  covered by unit tests rather than a desk press, since the test page has
  no raw key.

### Bridge ops to pick up later (MIDI Bridge 1.4.95)

- **`batch`** — up to 1,024 mute / fader / send_level / insert items,
  validated as a whole, one ack, behind `capabilities.batch`. The dLive
  takes it too, so it is not an SQ-only path. Worth it for the cold sync
  and for any preset that moves several strips at once, where today we
  post one request each.
- **`insert`** — an SQ input's insert, over MixPad. **Not to be built
  into a public action yet:** it has not been checked on a desk through
  the bridge, and the Pilot Tone SQ session is what clears it.

### Linked pairs on the SQ, verified 21 Oct (module 1.1.93)

The operator noticed a channel picker stepping 1, 2, 3 across a linked
1-2 pair. The bridge had been reporting the link all along:

```
input.1.stereo = {"linked": true, "half": "A", "partner": 2}
input.2.stereo = {"linked": true, "half": "B", "partner": 1}
```

Read into the module and confirmed on the desk: inputs 1-2 and 3-4 are
both linked, each half naming the other.

**The B half has no fader of its own.** `input.2.fader` and
`input.4.fader` are absent from the mirror — a linked pair has one
fader between them. So before this, channel 2 read as a strip with no
level and no reason given. With the link known, a key pointed at a B
half can show its partner's level instead of a blank.

Not SQ-only: a dLive links pairs too, and the same paths carry it.
