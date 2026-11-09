# Show Recorder, verified against the running app — 9 Nov 2026

The build on `build/show-recorder` (package `1.2.0-sr.1`) was packaged
before Show Recorder was running on this Mac, so the live handshake was
untested and said so. It has now been checked against the real app,
read-only. **No `/cmd` was ever sent**, so nothing was pressed: a press here
would have started a recording or a playback.

## The app

`GET /ctl/v1/info` on `127.0.0.1:8775`:

```json
{
	"v": 1,
	"ctl": 1,
	"app": "sr",
	"name": "Show Recorder",
	"version": "0.2.15",
	"catalogue_hash": "53cfa734d8ba",
	"allowed": true,
	"locked": false,
	"seq": 4
}
```

`ctl: 1` against the module's `CTL_API_VERSION = 1` — no version mismatch.
The app is **0.2.15**, where the monorepo README still says 0.2.7, so the
app has moved eleven patch versions since `fd4494a` vendored its contract.

## The contract did not drift with it

`fixtures/control/sr.json` is **byte-identical** to the monorepo's current
copy, and the live catalogue matches it exactly:

- 10 controls live, 10 in the fixture, **no key on either side only**
- 9 state keys live, 9 in the fixture, **no key on either side only**

So nothing needed syncing, and nothing in the app is unlabelled.

## The module against it

`ControlClient` from the built `dist`, pointed at the registry's own
`sr`/8775 entry: status went **ok**, the catalogue came back with 10
controls and 9 state keys, and the stream delivered state. Values read at
the time:

| key               | value             |
| ----------------- | ----------------- |
| `sr.transport`    | `"stopped"`       |
| `sr.time`         | `"00:00:13"`      |
| `sr.take`         | `0`               |
| `sr.armed`        | `8`               |
| `sr.dropouts`     | `0`               |
| `sr.disk_left`    | `"53 h 19 min"`   |
| `sr.disk_warning` | `false`           |
| `sr.session`      | `"Untitled Show"` |
| `sr.dirty`        | `false`           |

Then `stop()` closed cleanly.

## Button text

All ten live controls resolve to a shipped label — none would show a raw
key:

```
sr.record        "REC"              lit red while sr.transport = recording
sr.play_stop     "PLAY"             lit green while sr.transport = playing
sr.stop          "STOP"
sr.start         "TO\nSTART"
sr.marker        "ADD\nMARKER"
sr.go_marker     "GO TO\nMARKER"
sr.prev          "PREV\nMARKER"
sr.next          "NEXT\nMARKER"
sr.reset_dropouts "RESET\nDROPOUTS"
sr.show          "SHOW\nRECORDER"
```

`APP_NAME.sr` is "Show Recorder", `RUN_NAME.sr` is "RECORDER", the logo is
present, and there is no menu-bar icon — correct, it is a windowed app as
Console Control is.

## What is still untested

The presses themselves. Every control was checked for a label and a
contract, and the read path was exercised against the live app, but no
control was fired, by choice. The first real press of `sr.record` will
happen on the show machine.
