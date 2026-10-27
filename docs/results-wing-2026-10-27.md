# The Companion module on a Behringer Wing — 27 Oct 2026

The module's second sitting at a console that is neither a dLive nor an SQ,
the same evening as the DiGiCo SD11's
([results](results-digico-sd-2026-10-27.md)). Run by RESEARCH:
Multi-console with the operator at the desk; the module driven from here,
the buttons pressed by the operator, every claim below checked on the wire.

## What was running

|             |                                                                      |
| ----------- | -------------------------------------------------------------------- |
| Console     | Behringer Wing at 192.168.31.100, show DYLNTEST, scene 2 BO SETUP    |
| MIDI Bridge | from source, `test/wing-rig-27oct` at **359d12cb**, `fader_db: true` |
| Companion   | 5.1.0, connection `dylanmaudio`, Dev version                         |
| Module      | `topic/sq-test-line`, `dist` at **44fa930**                          |

Block: `verified_on_desk: true`, `fader_db: **true**`, `send_level: false`,
`scenes: {noun: "Scene", first: 1, last: null}` — **no `by_number`** — and
`capabilities` including `trigger_receive` and `surface_lights`.

## What happened

| Step                    | Watched                                 | Result                                                                                                                            |
| ----------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Declare `wing` at hello | —                                       | **Already shipped** in `dc62a96`; nothing new needed                                                                              |
| Names                   | **read** (module vs mirror, no traffic) | **Pass.** DRUMS, CYMS, BASS, VOX, "" for ch 1, 2, 3, 6, 10 — identical both sides                                                 |
| Fader write             | **echo** (wire)                         | **Pass.** −20, 0, −∞ went out as `/ch/10/fdr ,f` **−20.0 / 0.0 / −144.0**, each echoed 158–192 ms later                           |
| Scene recall by place   | **echo** (wire)                         | **Pass.** Place 1 loaded DOWN, place 2 loaded BO SETUP. Native GO echoed in **1 ms**; the OSC "Scene N recalled" 311/346 ms after |
| Stereo                  | **held**                                | Deliberately out — see below                                                                                                      |

`tx_total` 2862 → **2877**: fifteen messages for eight presses, nothing
stray. The desk ended as found — BO SETUP, ch 10 at −∞, mirror identical.

**Nothing here needed new module code.** Four of the five rows were already
written and proven on other families; the sitting was a wire check, not a
build. The one new thing was `44fa930`'s scene handling, and what it proves
on a Wing is the _other_ half: a desk with no `by_number` gets the place and
no `scene_number`, exactly as the dLive and SQ do.

## −∞ is −144.0 dB on this desk

The module sends `{db: null}` for −inf and the bridge rendered it
`/ch/10/fdr ,f -144.0`. Worth recording because it is the first time we
have seen a family's floor as a finite number on the wire; the SD took
`null` and the dLive uses its own table. Nothing to change — the module
should keep sending `null` and let each driver choose its floor — but a
reader comparing wire logs across desks will meet it.

## Two bugs confirmed here, neither caused by this desk

Both seen with **no traffic sent**, by reading the mirror against the
module's own variables.

1. **#342 — the current scene is dropped on connect.** The bridge mirrors
   `scene.current = {"number": 2, "name": null}`, an object. The module's
   `deltaToEvent` does `Number(value)`, which is `NaN` for an object, so the
   value is discarded. On arrival `scene_current` was **blank** while the
   desk sat on scene 2. After the first recall of the evening it read **2**,
   because a recall emits a `scene` event by a different path. That is the
   failure mode exactly: blank until something moves, on the dLive too, in
   the public v1.0.3. Caught in the act rather than reasoned about.

2. **The stereo link the desk never reported.** The Wing mirrors
   `{"width": "mono"|"stereo"}` on **26 keys** (inputs and aux_in, one shape
   throughout). `input.1.stereo` is `{"width": "stereo"}` and the module
   read `linked_ch1` as **`false`** — a stereo channel reported as not
   linked. Fixed after the sitting in `550c3ba`; the build that ran tonight
   predates it, which is why stereo was held out of the checks rather than
   measured half-fixed.

## What this evidence is

`two-impl` throughout: the wire log and the desk's echoes, plus a direct
read of the mirror for names. **No console display was read**, by design —
the Wing's fader law and scene places were read on the display earlier in
the day by Console Control, Pilot Tone and Show Recorder, so under the
operator's rule Companion's check is the wire matching the measured write.

One honest note on the fader count: a **sixth** fader send went out at
20:34:48.506, a second 0 dB. That was the operator pressing the button
twice, and they said so. It is in the capture and it is not a module
repeat — but a log read later without that remark would look like one.
