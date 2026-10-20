# Changelog — dylanmaudio-apps (Bitfocus Companion module)

## Unreleased (1.1.9x test line, not for the store)

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
