# Changelog — dylanmaudio-apps (Bitfocus Companion module)

## Unreleased

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
