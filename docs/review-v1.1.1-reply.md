# Reply to the v1.1.1 review (digitaldrummerj, 30 Oct 2026)

Review:
`reviews/dylanmaudio-apps/review-dylanmaudio-apps-v1.1.1-20261030-090507.md`
in `digitaldrummerj/companion-module-review`. Reviewed commit `99f4e72`.

Thank you — the template drift was real and almost all of it is now fixed.
Branch `fix/template-compliance`, off `main`, one commit per item.

## Done

| Item                          | Commit    | Note                                                       |
| ----------------------------- | --------- | ---------------------------------------------------------- |
| C1 `.gitignore`               | `5030750` | Template's eight lines first, module's own below a comment |
| C2, C4–C7 husky + lint-staged | `4c76009` | Hook byte-for-byte from the template @ `e0d42b7`           |
| H1 (credentials)              | `20b3345` | `persist-credentials: false` on **both** jobs              |
| C8 + H1 (Node 26)             | `4aeef80` | Manifest, tsconfig preset, `@types/node`, both CI jobs     |
| L1 link check                 | `bf93db2` | Fixed, but not as suggested — see below                    |
| M1 `release.yaml`             | `3860278` | Byte-for-byte from the template @ `e0d42b7`                |
| N1 abort signal               | `a537ec7` | Done, with one deliberate difference — see below           |

Everything in the review is now addressed except C3, which should not be
applied as written. Three of them are worth passing back rather than just
doing.

## C3: the `.prettierignore` entries are load-bearing, and the fix as written breaks the build

C3 asks that `.prettierignore` be reduced to the template's two lines. The
entries it would remove are not formatting preference — they are there
because this repo's JSON is not this repo's to format. Measured, not
argued; `prettier --check .` with the template's two-line ignore list
reports **83 files**, and among them:

- **All nine fixture files under `fixtures/`.** These are authored in the
  `dLive-Utility-Apps` monorepo and vendored here byte-for-byte, so that the
  Python side (MIDI Bridge, the Virtual dLive) and this module are held to
  one contract. `tools/sync_fixtures.sh` compares the two copies. Prettier
  rewriting them fails that comparison on both sides, and the module's own
  `client.test.ts` replays those exact files.
- **`docs/protocol.md`.** It is one of three files the sync script copies
  _into_ the monorepo. Reformatting it here propagates upstream.
- **`dist/` and `pkg/`** — build output, regenerated on every build.
- **`companion/talk-flash.companionconfig`**, which Prettier cannot parse at
  all: named directly it is an `[error] No parser could be inferred`.

So the request would either produce a repo that cannot pass its own fixture
check, or a `yarn format` that rewrites generated output on every run.

The entries carry a comment saying so, directly above them, which the review
quotes as its own evidence for C3.

Proposal: leave `.prettierignore` as it is. If template parity matters more
than the above, the alternative that does not break anything is to keep the
ignores and treat the vendored paths as the exception the comment already
documents. Happy to take whichever you prefer — but the literal fix in C3
should not be applied.

## L1: the finding is right, the suggested fix makes it worse

L1 says the link check drops its `Response` unread, and recommends
`await r.body?.cancel()`.

The first half is correct and is fixed. The recommended fix is the worst of
the three options. Measured on Node 26.7, twelve sequential GETs, counting
connections the server accepted:

| body size | dropped | cancelled | consumed |
| --------- | ------- | --------- | -------- |
| 20 B      | 2       | 2         | 2        |
| 8 kB      | 2       | 2         | 2        |
| 100 kB    | 21      | 23        | **2**    |
| 2 MB      | 12      | 23        | **2**    |

- At the size `/ctl/v1/info` actually answers, nothing was wrong: twelve
  unread checks against the real fixture opened **zero** extra connections.
  The described failure — unread replies piling up until a press waits on a
  held connection — does not occur for this endpoint today. Low is the right
  severity; the mechanism as stated is not reproducible.
- `body.cancel()` on a reply still arriving forces the connection to be torn
  down, so it opens _more_ connections than dropping it did. Applied as
  written, it would have worsened the thing it was meant to prevent.
- Consuming the reply — `await res.arrayBuffer()`, which is what the
  review's own parenthetical (reuse `getJson`) amounts to — holds at one
  connection at every size.

`bf93db2` consumes the reply, and still ignores the status, because any
answer at all means the link is up. Its test asserts connection reuse and
pads `/info` to 100 kB, because below about 64 kB a reply fits one buffer
and Node reuses the connection however the client leaves it — which is
exactly why this was invisible. It fails on both rejected variants.

## N1: done, but an abort is not a dead app

Taken, and A1 holds — not from the change notes but from the API this
module builds against. `@companion-module/base@2.1.3` declares it on
`CompanionActionCallbackContext` in `dist/module-api/action.d.ts:57-62`:

> A signal that aborts when the result of this execution is no longer needed
> (eg the user aborted the running actions).

with, in the same comment, "Respecting it is optional; if you do, stop work
and throw - the thrown error will be ignored." So the recommendation is a
recommendation, and a press that can wait 15 s is the case it is for.
`a537ec7` passes `context.signal` from every control action callback, and
from Open <app>, through `send()`/`press()` into `ControlClient.cmd`, where
`AbortSignal.any` pairs it with the press deadline.

One difference from the snippet. `cmd` turns a failed fetch into
`code: 'not_running'`, logs the app's name and nudges the link watchdog —
which is right when an app has gone, and wrong for an abort. Applied as
written, stopping a button would have logged "Pilot Tone Trigger isn't
answering" about an app that was answering fine, and sent the watchdog
looking at a healthy link. So an abort returns `code: 'aborted'`, leaves the
watchdog alone, and both `press()` paths return without logging: the
operator stopped it, there is nothing to report.

Its test gives the press a 2 s deadline against a 500 ms `/cmd`, aborts
after 50 ms, and asserts the result comes back in under 400 ms with status
still `ok`. On the unfixed client the same test waits out the delay, so it
holds the fix in place.

## Also on the branch

`679e515` is a test-only cherry-pick from this repo's `topic/avantis-yamaha`:
`src/e2e.test.ts` asserted an exact Get count (176) that the Virtual dLive
cannot promise on a loaded machine — 54, 110 and 172 have all been seen — and
it is the one assertion in the suite that fails for reasons outside the
module. It is not a review item; it is here so this branch's CI is green for
the right reason. The scope it was really guarding is now asserted against
the pure function instead.

With it, the suite is 483 passing, three runs in a row, including the
hardware-free end-to-end against the Virtual dLive.

## Not done

- **C3**, above: the one item where the fix as written should not be applied.
