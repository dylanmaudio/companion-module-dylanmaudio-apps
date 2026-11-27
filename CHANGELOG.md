# Changelog — dylanmaudio-apps (Bitfocus Companion module)

## Unreleased

- **Timed fades are findable** (#771). The module has faded a fader to a
  level over a duration since 1.0, and on 27 Nov 2026 the operator asked for
  it as a new feature — "that might be a nice feature in companion to have -
  fade to a level over time" — having spent a rehearsal pressing ±1 dB keys
  by hand instead. Nothing was broken; nothing said it was there. The field
  was labelled "Fade (ms)" with a default of 0, which reads as a switch to
  leave alone, and the unit was only in the label, so a 3 second fade is
  `3000` and there was nothing to tell you that. Every shipped preset passed
  `fade: 0`, so dropping a key never showed it either, and HELP.md described
  fades in seconds while the field wanted milliseconds.

  So: the label now reads **Fade (ms — 3000 = 3 s)** and the tooltip works
  the conversion; there is a new **… to 0 dB over 3 s** preset per fader
  type, beside the existing level and ±1 dB ones; and HELP.md has a
  **Timed fades** section that names the action and the unit. The option id,
  type, unit and default are unchanged, so every key already built keeps the
  behaviour it has — this release only makes the feature say its own name.

- **Send level no longer offers a fade it cannot do** (#770). The field was
  on the action and did nothing: the bridge's `fade` op takes a strip's own
  fader only and has no send target, and sends are capability-gated until the
  bridge has calibrated the console's send law, so a ramp would be refused a
  step at a time. The option is gone from the action rather than wired, and
  HELP.md says a send moves in one step and why. A stored `fade` on a key
  built earlier is still honoured and still lands as a jump, which is what it
  did before, so no button changes behaviour. A real send fade needs the
  bridge op first.

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
