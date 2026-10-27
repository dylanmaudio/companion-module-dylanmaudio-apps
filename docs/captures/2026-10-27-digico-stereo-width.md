# The SD's stereo shape — read from a live bridge, 27 Oct 2026

Captured while the SD11 was on the bench, for the module's stereo decoder
work (#3 on the Companion checklist). **Not a fixture**: fixtures under
`fixtures/api/` are authored in the monorepo and vendored here. This is a
note of what one running build mirrored, with the build named, so the
decoder work has something better than a description to go on.

## What was observed

MIDI Bridge from source, `topic/digico-fader-db` at **1a5e8c55**, pid 66371,
connected to the SD11 at 192.168.31.222. Read from `/api/v1/state` at about
13:50:

```
input.1.stereo = {"width": "mono"}
input.2.stereo = {"width": "mono"}
input.3.stereo = {"width": "stereo"}
input.4.stereo = {"width": "stereo"}
```

40 `*.stereo` keys in all. The mirror also carried `input_type` on that
build. The console block's `capabilities` did **not** advertise stereo:
`[action_fire, fader, mute, name_get, scene_recall, surface_lights]`.

## What the next build mirrored

MIDI Bridge `mc-318` at **043319ab**, pid 89373, same desk, read at about
14:20: **233 keys and not one `*.stereo` among them**, and no `input_type`
either. Same console capabilities list.

## Why that matters

The module's decoder (`bridgelink.ts`, `case 'stereo'`) reads the SQ's
`{linked, half, partner}`. Against `{width: ...}` it does not reject the
payload — it returns `linked: false`, so **every channel reads as unlinked,
confidently and wrongly**. That is the same silent-drop class as the fader
bug of the same morning, one layer up: a plausible wrong answer rather than
nothing.

But the fix must not be written as though `{width}` is simply "the SD's
shape". On the evidence here it is **one build's shape**, and the build the
desk finished the day on sent no stereo at all. So:

- Handle `{width}` **and** `{linked, half, partner}`, and treat an
  unrecognised shape as unknown rather than as "not linked".
- Don't infer a partner from `{width}` alone. `{"width": "stereo"}` says
  this channel is half of a pair; it does not say which half, or which
  channel the other half is. The SQ's shape says all three.
- Confirm against a bridge build that actually mirrors it before claiming
  a desk verified it. Nothing here was read on the console's display.

Graded `single`: one implementation, one reading, no hardware confirmation.
