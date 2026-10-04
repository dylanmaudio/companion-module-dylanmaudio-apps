# dylanmaudio apps

One module, five macOS apps, one connection per app: **dLive MIDI
Bridge**, **Talk Light Trigger**, **Pilot Tone Trigger**, **Time Code
Tool** and **Console Control**. Pick the app in the connection's
settings. Through MIDI Bridge you control an Allen & Heath dLive **and
see what it is doing**: mutes, fader levels, names, colours and the
current scene come back from the desk and drive feedbacks, variables and
self-labelling presets. The other four apps expose their own controls
(run/stop, thresholds, modes, the timecode readout) with live state on
the keys.

## What this module is

The MIDI Bridge connection controls an Allen & Heath dLive **through the
dLive MIDI Bridge application**. The bridge owns the connection to the console;
this module attaches to it as a named lane, alongside anything else you
have connected — a DAW, Console Control, other apps — all sharing one
console connection and one MIDI monitor that attributes every message
to the app that sent it.

**It does not connect to a console directly.** You need the MIDI Bridge
app (v1.1 or later) running and connected to your desk. Console address,
base MIDI channel and reconnect behaviour are configured **in the
bridge**, and this module inherits them.

## Setup

1. In the MIDI Bridge app, connect to your console and confirm it is
   online.
2. On the console: **Utility → Control → MIDI**, mode **On** (not
   Secure), Global MIDI Send and Receive enabled.
3. In this connection, set the bridge address — `127.0.0.1` when
   Companion runs on the same machine as the bridge — which today is the
   only way, as the bridge listens on its own Mac. Leave the token empty;
   it is for the LAN access the bridge will grow later.

### The bridge app's own controls

With MIDI Bridge 1.1.9 or later, this connection also controls the bridge
app itself: **Run** (start or stop the bridge), **Restart bridge** and
**Auto-reconnect**. Its state shows as `$(dlive:bridge_state)` (stopped ·
not connected · connecting · connected · error), `$(dlive:bridge_running)`,
`$(dlive:bridge_msg_rate)` and a few more, with presets under _MIDI
Bridge_. These go to the bridge's menu-bar side on port 8770, so they
still work while the bridge itself is stopped. The connection status then
reads "MIDI Bridge is stopped" instead of "nothing answering".

Turn on **Allow Companion control** in the bridge's popover. Stopping and
restarting are refused while its _Lock show-critical controls_ switch is
on. An older bridge simply doesn't offer these, and console control works
as before.

## Other dylanmaudio apps

The same module also controls **Talk Light Trigger**, **Pilot Tone
Trigger**, **Time Code Tool** and **Console Control**. Add one connection
per app and choose it under **App**; each app must be running on this Mac
with **Allow Companion control** switched on in its popover.

Everything for those connections is built from what the app reports about
itself: each of its buttons and switches becomes an action, each on/off
or choice becomes a feedback, and every value it shows becomes a variable,
with ready-made presets. A feature added to an app in an update appears
here without a new version of this module.

- **Name the connection after the app** — `ptt`, `tlt`, `tct` — because the
  label is the variable prefix: `$(ptt:state)`, `$(tct:timecode)`.
- **Port 0** uses the app's standard port (Talk Light 8771, Pilot Tone
  8772, Time Code Tool 8773, Console Control 8774).
- **Leave the App token empty.** The apps accept connections from their
  own Mac only, for now; the field is for the LAN access they will grow.
- **Show-critical controls** — stopping an app, changing Pilot Tone's
  failback mode — are refused while the app's _Lock show-critical
  controls_ switch is on. The action says so in its description.
- **When an app says no**, its own reason goes to the Companion log word
  for word — "Signal is still below threshold — stay on backup".
- **When an app isn't running**, its buttons stay put: the connection
  remembers the app's controls from last time. A press then says in the
  log that the app isn't answering.
- **The presets read at a glance.** Each key has a short label sized to fit
  whole, like PLAY, TO START or CUE UNITY. It sits on its menu's colour, with a
  red bar across the top when the control is show-critical. A key lights:
  - **green** while its switch is on;
  - **blue** for the chosen option (Pilot Tone's Latch in its amber);
  - **amber** when it needs a look: Reset available, record armed, unsaved
    changes, the console out of step with the timeline.

  Console Control's REC turns red while it records. A control an app adds
  later gets a short label made from its name.

- **Styled keys.** Each app also has a _styled keys_ preset section, in
  the app's own look:
  - its **logo** and its **menu-bar icon** (mirroring every state, with
    MIDI Bridge's activity flash). Pressing either brings the app to the
    front; if it isn't running, the log says to start it;
  - a round **Run** button that fills green while the app runs;
  - a **level meter** (Talk Light's and Pilot Tone's with the threshold marked);
  - Pilot Tone's **Auto / Latch** keys and **status tile**, amber when
    latched and violet when the tone is degraded, as in the app;
  - Console Control's **status tiles**: timecode, transport, mode and output.

- **Console Control's presets follow its menus**: a section per
  category (Transport, Console, Cue, Navigate, Track, Edit, Markers, …),
  one key per keyboard shortcut. In Show Mode, edits are refused with the
  app's own "Locked in Show Mode."
- **Time Code Tool** also has a four-key **timecode readout** preset
  (hours, minutes, seconds, frames). The digits are zero-padded, green
  while locked or generating, amber in freewheel, and `--` without a
  signal.

The connection's status says which of these it is: the app isn't running;
Companion control is switched off in the app (state still shows, presses
are refused); or the app and this module speak different versions of the
control API, in which case update whichever is older.

## Talk flash (Talk Light Trigger)

While Talk Light reports talk, your Stream Decks can jump to a **TALK
page** whose keys blink, so a talkback call can't be missed. The page and
the two triggers that drive it ship as one file,
[`talk-flash.companionconfig`](https://github.com/dylanmaudio/companion-module-dylanmaudio/blob/main/companion/talk-flash.companionconfig).

**Importing it**

1. **Import / Export** → choose the file → the **Buttons** tab (not Full
   Import, which replaces your configuration). Source page **1 (TALK)**,
   destination **[ Insert new page ]**. Under _Import Connections
   Behavior_, pick your Talk Light connection — or **[ Create new
   connection ]**, which arrives set up for Talk Light on its standard port.
   Don't leave it linked to a MIDI Bridge connection.
2. Same file, the **Triggers** tab: select both, the same connection
   choice, **Add to existing triggers**.
3. In the Talk Light connection, set **TALK page number** to the page the
   import created. Until you do (0 = off), TALK keys still blink but no
   deck is switched.

**What it does**

- **Talk starts** — _Talk flash: talk start_ sends the deck to the TALK
  page. Every TALK key blinks together, off one timer: 2 Hz by default,
  adjustable, never faster than 3 Hz.
- **Talk ends** — _Talk flash: talk end_ sends the deck back to the page
  it was on.
- **EXIT** (top-left) sends the deck it is pressed on back straight away
  and starts a cooldown: 10 s by default, adjustable, 0 for none. A talk
  that starts during the cooldown doesn't switch any deck, so an operator
  who dismissed one call isn't pulled straight back by the next.

**Returning to the right page (recommended).** "Back" relies on
Companion's page history, which doesn't always hold the page a deck
came from. Seen on a real Stream Deck: talk taken over from page 7
came back to page 5. For each deck, the module can remember the
page for you:

1. A trigger on the deck's page variable: event _variable changed_
   `internal:surface_<id>_page`, with the action **Talk flash: remember a
   deck's page**. Choose Deck 1, and set the page field to that same
   variable in expression mode. It keeps the deck's last page that
   isn't the TALK page, as `$(tlt:talk_return_1)`.
2. In _Talk flash: talk end_, and in the TALK page's EXIT key, set the
   page to `$(tlt:talk_return_1)` (expression) instead of _back_.

Decks 2–4 work the same way with `talk_return_2` … `_4`.

**More than one deck.** The triggers act on surface index 0, the first
deck in Companion's Surfaces list. For each other deck, duplicate both
triggers and change the surface index. EXIT's "already went back" is
shared, not per deck: after EXIT on one deck, the others stay on the TALK
page when talk ends — press EXIT on each, or step them back by hand.

The pieces are ordinary module parts you can reuse on any page: the
**Talk flash** feedback, the **Talk flash: exit** action, the **TALK key**
preset, and the variables `$(tlt:talk_active)`, `$(tlt:talk_flash_armed)`,
`$(tlt:talk_flash_exited)`, `$(tlt:talk_flash_took_over)` and
`$(tlt:talk_page)`.

## Connection settings

| Setting                                       | Notes                                                                                                                                                                                                     |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App                                           | Which dylanmaudio app this connection controls. **MIDI Bridge** is the dLive console, and everything below; the others are covered above                                                                  |
| Talk flash rate / cooldown / TALK page number | Talk Light only — see _Talk flash_ above                                                                                                                                                                  |
| MIDI Bridge address / port / token            | Where the bridge is: 127.0.0.1 : 8765, beside Companion. The bridge listens on its own Mac, so the token stays empty until it grows LAN access. It is kept as a secret, and also goes to the control port |
| Bridge app control port                       | 0 = the standard 8770, on the same address. For Run, Restart and Auto-reconnect (MIDI Bridge 1.1.9+)                                                                                                      |
| Console firmware                              | Not detectable over MIDI; shown in `$(dlive:firmware)`                                                                                                                                                    |
| Inputs in use / extended types                | Bounds the variable grid and the preset library                                                                                                                                                           |
| Ask the console for                           | What the bridge fetches for every strip on connect, and on **Resync**. The desk announces only what _changes_, so without this a connection made mid-show shows nothing until someone moves something     |
| Scene Go / Next / Previous                    | The CC number + value you assigned on the console. 0/0 = not assigned                                                                                                                                     |
| Console Actions map                           | `cc,value,Name` per line. Optional when a firmware 2.1x show file is loaded — Actions import automatically; manual lines win on the same CC/value                                                         |
| Show file                                     | Loaded on the connection's own **show file page**, not here — see below                                                                                                                                   |
| Show file path (advanced)                     | Only useful when the file sits somewhere this sandboxed module can read. An uploaded show wins over it                                                                                                    |
| Scene names (manual)                          | `scene,Name` per line; overrides the show file                                                                                                                                                            |
| Show send levels in dB                        | On by default. The send law was measured on hardware and matches the fader law exactly; turn off for raw 0–127                                                                                            |
| Preamp gain range                             | Sources disagree; pick what matches your screen                                                                                                                                                           |

### Status colours

Green means **the bridge is reachable _and_ reports its console link is
up** — not merely that the bridge answered. If the bridge is running but
the desk is not connected you get:

> MIDI Bridge is running but its console link is down — check the bridge app

and if the bridge itself is not reachable, the status stays amber with
the address it is waiting on, and why: connection refused, no answer,
unreachable. Fix console-side problems (MIDI mode Off or Secure, Global
MIDI Receive disabled, wrong address) in the bridge, not here.

A bridge that stops answering without closing the connection (its Mac
asleep, or a network between it and Companion gone) turns the status
amber within about 20 seconds, and **Console is answering** goes off. A
press made while the bridge can't be reached is logged as a warning.

## Loading a show file

Scene names exist only in the show file — there is no way to ask the console
for them over MIDI — and firmware ~2.1x shows also carry the named Actions
table. Both are loaded from the connection's own page:

> `http://<your-companion>:8000/instance/<connection label>/`

The link is on the connection settings page, next to **Show file**. Choose a
dLive show — the `.tar.gz` the console writes to USB, or a Director export —
and the page reports how many scene names and Actions came out of it.

The file is read in the browser and only the **scene names** and the
**Actions table** are kept, in this connection's settings. The show itself is
not stored, and nothing leaves the computer. It survives restarts, so the
show file does not have to stay on the Companion machine — which matters,
since Companion runs modules sandboxed to their own folder and usually
_cannot_ read a path you type in.

Anything typed into **Scene names (manual)** or **Console Actions map** still
wins over the loaded show, so a wrong or out-of-date entry can be corrected
without re-exporting anything.

## How feedback works

- **Mutes and scene recalls** are pushed by the desk the moment they
  change — no polling, sub-50 ms.
- **Faders**: the desk only announces _which_ fader moved. The module
  asks for the level once the movement settles (one query per gesture).
- **Names and colours** are read on connect and whenever a strip is
  renamed on the surface.
- **Sends, assigns, preamps, HPF**: not announced by the desk, and the
  bridge's state mirror does not yet carry them. Feedbacks for these
  reflect changes _this module_ makes, and will not follow changes made
  on the surface or by another controller. They are listed in
  `$(dlive:unsupported_gets)` so the limitation is visible.
- Anything the module sets itself is mirrored immediately, so buttons
  update even if the desk does not echo.

## Actions

Mute · Fader (dB, ±dB, raw, all with optional timed fade) · Send level ·
Main / DCA / mute-group / mix assign · Preamp gain / pad / 48 V · PEQ
band · HPF · Set name / colour · Scene recall · Console Action (named,
from the map) · UFX key / scale · Refresh strip · Resync · Reload show
file.

**Scene Go / Next / Previous, Cue-list recall and Surface CC refuse.**
They belong on the console's second socket, the Surface (51328), and the
MIDI Bridge has one console connection: the MixRack's. There the same
bytes mean something else — on the Virtual dLive, "cue list: recall ID
11" recalled **scene 12** — so the module says so in the log and sends
nothing. Use **Scene recall**, which is a MixRack message and works.

Channel numbers accept expressions, so `$(custom:channel)` in the Number
field works for "selected channel" layouts.

Fades are dB-linear and only send when the value changes (a 3 s fade is
~60 messages, not 600).

## Feedbacks

Mute · Fader level (value, text, above-threshold) · Channel colour
(button takes the desk colour) · Channel name · Main / DCA / mute-group /
mix assigned · Send level · HPF on · Preamp pad / 48 V / gain · Current
scene is… · Scene name · Console is answering.

## Variables

Per strip: `name_ch12`, `colour_ch12`, `mute_ch12`, `fader_ch12` (dB
text), `fader_lv_ch12` (0–127). Type prefixes: `ch` inputs, `grp`/`stgrp`
groups, `aux`/`staux`, `mtx`/`stmtx`, `fxsnd`/`stfxsnd`/`fxrtn`, `main`,
`dca`, `mgrp`, `ufxsnd`/`ufxrtn`.

Global: `scene_current`, `scene_current_name`, `scene_name_<n>`,
`connected`, `firmware`, `base_channel`, plus diagnostics
`gets_in_flight`, `gets_missed`, `unsupported_gets`.

## Presets

Template groups per channel type — mute buttons that take the strip's
name and colour, and turn a deep red marked **MUTED** when muted (the
word matters: a channel coloured red on the desk is red either way); level buttons showing the dB
value with ±1 dB nudges; scene recall buttons that show the scene's name
from the show and light when current; the current scene; named Console
Actions; a status button.

## Limitations (protocol, not the module)

- **No metering.** Meters live on A&H's proprietary network protocol, not
  MIDI.
- **No scene names over MIDI** — hence the show-file import.
- **SoftKeys cannot be triggered by MIDI**; use a console Action instead.
- **No cue list, and no scene Go / Next / Previous.** Those live on the
  console's Surface socket, which the MIDI Bridge does not open.
- **Preamps are addressed by socket**, not channel; the patch is not
  readable.
- Some "Get" queries (preamp, mix assign) are extrapolated from the
  documented pattern. If the desk ignores one, the module notices (no
  reply), pauses that query type for a minute and lists it in
  `$(dlive:unsupported_gets)` — it never marks the connection failed for it.

## Troubleshooting

- **Stays "Connecting"**: the bridge is not running, or the address/port
  is wrong. Check the bridge app is open and note its API port.
- **"console link is down"**: the bridge is fine, the desk is not — fix
  it in the bridge (address, MIDI mode Off/Secure, Global MIDI Receive).
- **Wrong strip moves**: base MIDI channel mismatch — set it in the
  bridge; this module reads it from there.
- Tick _Log every decoded event_ in the settings and watch the Companion
  log to see exactly what the desk is sending.
