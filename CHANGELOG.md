# Changelog — dylanmaudio-apps (Bitfocus Companion module)

## Unreleased (1.1.9x test line, not for the store)

- **Show Recorder is the sixth app** (port 8775), built from its own control
  catalogue like the other four: transport, markers, dropout reset, takes and
  the session's state on the keys. Its Master Out mute is a red key while the
  output is muted, not the green a toggle's own state would give it, and it
  carries the show-critical bar, because un-muting is the half that can
  surprise a room.
- **A fade that didn't land now says so.** A fade and a cold sync's Gets are
  accepted rather than finished — the bridge answers "pending" and states the
  outcome once, in an ack on the stream (#602). Every failed ack went to the
  log at debug, which Companion doesn't show by default, so a fade the desk
  never ran read exactly like one that worked: no line, no status, the fader
  simply where it was. Those now warn and name the op, which the ack itself
  doesn't carry. The one that doesn't warn is a fade stopped by your own next
  write to that fader, or by a second fade on it: that is what those presses
  mean, and it logs at info instead of crying wolf.

- **A desk the bridge verifies while you are connected now works** without
  reconnecting. MIDI Bridge re-sends its console block whenever it changes,
  and the module was reading it only at connect — so on a console the bridge
  can only identify after asking the desk its model (a Yamaha: the Rivage
  PM5 and the DM7 Compact are verified separately), the connection could sit
  there saying "this module version drives a dLive only" for the whole
  session on a desk it was free to drive. The scene settings are re-read from
  the same block.
- **A value the bridge says it no longer knows is no longer invented.** The
  Client API sends `null` for a path it cannot answer, and on an Allen &
  Heath Avantis every scene recall — including one pressed from Companion —
  forgets every mute and level, because the desk sends the recall and none
  of the values it changed. The module read that `null` as a value: a
  forgotten mute became "not muted", and a forgotten fader became level 0,
  which is −∞. So after a recall on that desk every input read un-muted at
  −∞, stated as fact. It now un-learns the field instead, and the variable
  goes blank, which is the honest answer and what the Client API asks a
  client to show. On a dLive nothing changes: that mirror keeps the values
  until something re-reads them.
- **A recall that reports no place no longer puts the current scene at 0.**
  A scene event can carry `number: null` with the number on screen beside
  it, and `Number(null)` is 0, so the current scene went to 0; the module
  now reads the screen number instead. Written for a Yamaha on the driver
  thread's word of 28 Oct, which that thread withdrew on 5 Nov: every
  Yamaha recall reports its place, and the two families whose own recall
  the bridge announces at send (the Wing, the Avantis) count their scenes
  and so fill the place in. So this is a guard against a 0 that no shipped
  desk produces today, not a fix an operator will see. Same cause as the
  snapshot fix above it in this list, in the live stream rather than at
  connect.
- **And the current scene no longer blanks on a recall by number** (a
  DiGiCo). The module applies what its own press implies, so a feedback
  lights without waiting for the desk — but a recall by number carries no
  place to apply ("9.99" is not the ninth snapshot), and it was applying
  the missing one anyway, emptying `scene_current` on every recall until
  the desk's echo arrived a few milliseconds later. Where no echo came —
  a Quantum 112 refusing a snapshot that doesn't exist — the variable
  stayed empty for the rest of the session. A number is no longer taken
  for a place: the variable now waits for the desk's own word, and a
  refused recall leaves it as it was.
- **Scene recall takes a scene list.** A Yamaha DM7 keeps two, A and B. A
  new **Scene list** box names one; empty means the desk's only list, which
  is every other console. A list the desk does not have recalls nothing and
  says so, rather than silently recalling from the other one.

- **Linked stereo pairs are no longer invisible** (#268). MIDI Bridge
  reports `{linked, half, partner}` per strip and the module was dropping
  it, so a pair looked like two unrelated strips: a fader move on one
  half showed nothing on the other, and a channel picker stepped through
  both halves of a pair. It now lands at connect with the rest of the
  mirror. New per-strip variables `linked_*` and `partner_*`, and three
  feedbacks — partner number, half (A/B), and is-linked. The partner
  feedback takes an expression index on purpose: a picker needs the
  partner of whichever channel it is pointed at, and Companion can't
  nest `$(dlive:partner_ch$(custom:ch))`.
- **Levels on a console that isn't a dLive.** A fader was a 0–127 dLive
  wire value all the way down, which is unity here and near silence on a
  14-bit desk. The level a caller asks for now carries its own scale —
  dB, or a dLive lv — and the link resolves it against the family it is
  attached to: dB goes to another desk as `db` / `to_db` and the bridge
  converts with the law that desk is actually set to. A raw 0–127 is
  refused there and says why, because there is no honest way to read it.
- **The level that comes back is the desk's own.** Another family's
  mirror sends `{wire, db, steps}`; we keep its dB rather than running
  its wire value through the dLive taper. The dLive's `{lv, db}` is
  unchanged, and its dB still comes from our measured table.
- **Nudges step in dB**, which every family understands, instead of
  stepping the dLive's table.
- Levels stay held back when `capabilities.fader_db` is false: that means
  the bridge hasn't verified that family's law on a desk, so a dB would
  not land where it says.
- **The current scene no longer reads blank until the first recall**
  (#342). The mirror reports it as `{number, name}`, an object, and the
  module read that as a number: `Number({…})` is NaN, so the value was
  dropped without a word. A connection made mid-show — which is every
  connection, after a Companion restart — left `scene_current` and
  `scene_current_name` empty while the desk sat on a scene, and they only
  filled in when someone recalled the next one. Seen on a Behringer Wing,
  27 Oct, parked on scene 2 with both variables blank. A decimal scene
  number (an SD's 1.50) is kept rather than discarded as well.
- **Console Control's reference-out mute has a key.** The app added the
  control, so the presets carry it: REF OUT MUTE, lit red while the output
  is muted rather than the green a toggle's own state would give it, and
  carrying the show-critical bar, because un-muting is the half that can
  surprise a room.

## 1.1.2 — 2026-11

A review-fix release. Nothing in it changes what a button does — except
that two things now stop sooner than they used to.

- **Stopping a button now stops the press.** Companion's "Abort actions on
  button" reaches an app press: a Console Control or MIDI Bridge key left
  waiting on a slow app — the bridge's Restart is the one that can take
  seconds — gives up at the abort instead of waiting out its 15 s. An
  aborted press logs nothing and doesn't mark the app as not answering,
  because the app never failed.
- **The link check reuses its connection.** The "is the app still there?"
  check read nothing back from the app's reply, and Node holds a connection
  until its reply is read. At the size these apps answer today nothing was
  wrong, but a larger reply would have opened a fresh connection every
  check.

The rest is repo housekeeping the Bitfocus review asked for, with no effect
on the module inside Companion: the module template's `.gitignore`,
pre-commit hook, husky and lint-staged, its release workflow, CI that
doesn't keep Git credentials after checkout, and the Node 26 runtime that
API 2.1 expects.

## 1.1.1 — 2026-10

Same module as 1.1.0, which was submitted and withdrawn before review —
the store's submission page won't take a version number twice, so the
release is renumbered. It also carries two dependency bumps the Bitfocus
fork merged after 1.1.0 was tagged (brace-expansion, source-map-js).

## 1.1.0 — 2026-10 (withdrawn, never published)

A dLive release. It also makes sure it stays one: MIDI Bridge can now
drive other Allen & Heath consoles, and this version refuses them rather
than half-driving them.

- **This version drives a dLive, and refuses any other console.** MIDI
  Bridge is learning to drive other Allen & Heath desks. Every op this
  module sends carries dLive meaning — the raw path is dLive bytes, and
  even a plain fader is 0–127, which on a 14-bit desk is not unity but
  near silence. So when the bridge reports a console family this version
  doesn't know, the module sends nothing at all, says which desk it found
  in the log, and shows it in the connection status. It doesn't move its
  own keys either: a refused press leaves the button where it was.
  It doesn't ask such a desk anything either: a cold sync's dLive-shaped
  Gets earn one rejection per strip from a bridge driving an SQ.
  A bridge that reports no console family is a dLive, so every bridge in
  the field today is driven exactly as before. Refusing is the reversible
  choice — a later version can turn a console on without breaking a
  button anyone has built.
- `capabilities.raw: false` from the bridge is now honoured: the raw path
  stays quiet instead of sending bytes the bridge will reject.

Ground work for Companion on another machine than the apps (#106): a
CompanionPi, through a tunnel today and the apps' LAN access later.

- **A bridge or app that stops answering shows within about 20 s.** A Mac
  that sleeps, or a network that drops, used to leave the connection green
  for about 70 s, and presses in that time changed the keys but never
  arrived. While a stream is quiet the module now asks whether the app is
  still there. A lost press logs a warning and asks at once.
- **Console is answering goes off when the bridge goes away.** It stayed
  lit, and `$(dlive:connected)` true, after the bridge quit or became
  unreachable.
- **Tokens are secrets.** The bridge token is a secret-text field, kept in
  Companion's secrets store rather than the connection config; an upgrade
  script moves one that was set. It also goes to the bridge app's control
  port. Each app connection has an **App token** too. Both stay empty while
  the apps accept connections from their own Mac only.
- **A refused token says so**, and is asked about every 10 s, not read as
  an expired lane and retried every 2 s.
- Status messages give the address and the reason (connection refused, no
  answer, unreachable, address not found), and no longer say "this Mac"
  about an app on another one. An IPv6 bridge address makes a valid URL.

Talk Light Trigger and Pilot Tone Trigger 1.3.0 reach the console
through MIDI Bridge. These keys come from the apps' own catalogues, so
they appear once the apps are updated:

- **MIDI Bridge link**, a variable and a feedback on each app's
  connection: connected, no console, reconnecting, not responding,
  absent, or direct (the app's old Direct TCP or MIDI port).
- **Not reaching the console**, lit while the app is armed and can't
  reach the console: the app's red tile.
- **Pilot Tone: Send now** (a SEND NOW key). It sends the failover or
  signal OK that wasn't delivered within 10 seconds, and is enabled only
  while one is waiting.

## 1.0.3 — 2026-09

- **Cue list, Scene Go / Next / Previous and Send CC to the Surface now
  refuse.** They belong on the console's Surface socket, which the MIDI
  Bridge doesn't open; its one console connection is the MixRack's, where
  the same bytes mean something else. Verified on the Virtual dLive: "cue
  list: recall ID 11" recalled **scene 12**. They now send nothing and say
  why, in the log and in their own names, rather than moving the show to
  the wrong scene. **Scene recall** is unaffected. The GO / Next /
  Previous presets are gone.
- The styled **Run** key read "RUN / NING" while an app ran; its label now
  holds the word whole.
- Every key on the importable **TALK page** read "TAL / K"; same fix.
- Pilot Tone's **Signal Degraded** is purple on the menu-bar icon and the
  level meter, matching the app since 1.1.3 (it was orange).
- The **bridge token** setting and the help no longer speak of LAN access:
  the bridge listens on its own Mac.

## 1.0.2 — 2026-09

- **Names and colours arrive on connect.** The desk announces only what
  changes, and the bridge's mirror starts empty, so a connection made
  mid-show showed nothing until someone moved something. The module now
  asks the bridge for each strip in scope on connect and on **Resync**,
  through its `query` op. **Ask the console for** in the connection
  settings chooses how much: names and colours, plus mutes and levels, or
  nothing.
- **Muted keys say MUTED**, on a red darker than any desk colour — a
  channel coloured red read the same muted or not.
- **One text size for desk text** across the MIDI Bridge presets — names,
  levels, scene names, MUTED — chosen to hold a full-length dLive name
  whole. `auto` picked a size per label, and a fixed size that is too big
  breaks the word rather than shrinking it ("Maste r").

## 1.0.1 — 2026-09

- `legacyIds` is empty, as the module review asked for a first release.
- Pilot Tone Trigger 1.1: the **Flip A/B** key, the **Signal Degraded**
  state on the status tile (violet), the menu-bar icon (orange) and the
  level meter, and the `integrity_errors` variable.

## 1.0.0 — 2026-09 (submitted to Bitfocus)

First release. One connection per dylanmaudio app:

- **dLive MIDI Bridge** — attaches to the bridge's Client API as a named
  lane (never to the console directly): mutes, fader levels with timed
  fades, names, colours, scene recall and Actions, with full state
  feedback, variables and self-labelling presets; bridge start / stop /
  restart and status through the bridge's own control endpoint.
- **Talk Light Trigger** — Run and Threshold, live state, and the Talk
  flash page (`companion/talk-flash.companionconfig`).
- **Pilot Tone Trigger** — Run, Failback mode, Reset, the tone generator,
  the threshold; state reflected on the keys.
- **Time Code Tool** — Start/Stop, Read/Generate, input source, MTC and
  LTC output, counters, generator start and rate, and multi-key timecode
  readout presets.
- **Console Control** — every remote-flagged command of the app's
  registry (transport, locate, record, Show Mode, conform), state from
  the app's tick.
- Every app: an "open app" key that brings the running app forward,
  a status feed, and the app's own "Companion control" and "Lock
  show-critical controls" switches honoured.

Requires the apps (MIDI Bridge 1.1.9+ for the bridge controls). Companion
5.0+ (`@companion-module/base` 2.1). MIT.
