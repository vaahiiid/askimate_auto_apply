# ADR-0025 — A fill session is never traced, recorded, or asked to remember a value

**Status:** **Accepted** — Vahid's instruction, 2026-08-26
**Extends:** [ADR-0004](./0004-branded-types-for-confirmed-values.md) (confirmed values),
brief §8 (redact personal data from logs by default)

## What was wrong

`PlaywrightPreparationSession` opened its context with `recordVideo` and
`tracing.start({ screenshots: true, snapshots: true })`, then filled passport numbers, dates of
birth, addresses, phone numbers, emails and personal statements into it.

**Every one of those values was being written to disk in the clear, on every run.**

This was not suspected from reading the code. It was found while investigating a separate proposal,
and then established by experiment.

## The experiments

Marker values, a real Chromium, and a scan of every byte of every artefact:

| Input route | Leaks into |
|---|---|
| `page.fill()` | `trace.trace` |
| `keyboard.type()` | `trace.trace` |
| `locator.pressSequentially()` | `trace.trace` |
| `page.evaluate(setter, value)` | `trace.trace` |
| page fetches the value itself over HTTP | `trace.trace` **and** a trace resource — response bodies are stored |

And the mitigations, which is where the surprise is:

| Mitigation | Result |
|---|---|
| `tracing.stopChunk()` around the fill | **still leaks** |
| full `tracing.stop()` → fill → `tracing.start()` | **still leaks** — buffered and replayed into the *next* trace file |
| **tracing never started on the context** | **clean** |

The middle row is the important one. *"Turn tracing off for the sensitive part"* is not a technique
that exists. The only configuration that works is one where tracing was never started at all.

Two things were checked and found **not** to leak: `page.content()` does not expose typed values
(they are not in `outerHTML`), and `setInputFiles({ buffer })` does not put document bytes in the
trace.

## Where else it leaked

The trace was the largest, but not the only one.

| | Site | What escaped |
|---|---|---|
| 1 | `tracing.start(…)` on the fill context | every filled value, verbatim |
| 2 | `recordVideo` on the fill context | every non-password value, visually |
| 3 | `screenshots: true` in tracing, and `screenshot()` | the filled form, legibly |
| 4 | `ValueNotAcceptedError.intended` / `.stored` | the full personal statement, on the error object |
| 5 | `OptionNotAvailableError` message | the student's nationality, **in the message text** |
| 6 | `reformattedFields` getter | intended and stored plaintext for every reformatted field |
| 7 | `ExecutionOutcome.stored` | every filled value, on the orchestrator's outcome |
| 8 | `scripts/end-to-end.ts` | **printed 7 to stdout** — a demo run put confirmed personal data into the terminal and any CI log capturing it |

Site 8 is the one worth dwelling on: the end-to-end test *asserted* it, requiring the output to
contain `given_name       Niloofar`. The test suite was pinning the leak in place.

## The decision

**A session that fills personal data is opened through `openSensitiveContext`, which cannot be
traced or recorded.**

- No `recordVideo`. A video cannot be scanned for a leak afterwards, which makes it worse than a
  trace rather than better.
- Tracing is **made unavailable, not left off**: `tracing.start` and `tracing.startChunk` are
  replaced with functions that throw. `stop` remains a harmless no-op so shared teardown does not
  need to know which kind of context it holds.
- `SensitiveContextOptions` has no field that could re-enable either. There is no argument to pass.
- `screenshot()` masks every `input`, `textarea` and `select` at capture time, so the values never
  reach the PNG. Layout, error banners and page state — what a screenshot is actually for — survive.
- Errors and diagnostics carry a `RedactedValue`: a length and a 12-character digest. Enough to
  answer *did it arrive, was it truncated, is it the same value* without carrying the value.
- The portal's own option list stays in full in `OptionNotAvailableError` — it is the portal's data,
  not the student's, and naming it is what makes the error actionable.

`RedactedValue` lives in `packages/domain` rather than the browser app, because the orchestrator's
execution outcomes need it and a package may not depend on an app.

## Three layers, because one is not enough

1. **Type** — `SensitiveContextOptions` cannot express tracing or video.
2. **Runtime** — the context's tracing methods throw, synchronously, so code that forgets to `await`
   still cannot enable it.
3. **Build** — `check-boundaries.ts` fails if `tracing.start` or `recordVideo` appears in the fill
   session or in `sensitive.ts` at all. Comments and string literals are stripped first, so the
   prose explaining the rule does not trip it.

## The tests, and why they are the shape they are

They run a real fill against a real page with `TEST-PASSPORT-987654`, `TEST-DOB-2000-01-01`,
`TEST-SECRET-PASSWORD-123!` and four more, then walk **every byte of every file the run produced**,
including inside archives, and assert none appears — as raw bytes, as UTF-16, as base64 and as
percent-encoding.

Expanding archives is not thoroughness for its own sake. When the fix was deliberately reverted to
check the tests caught it, **every marker assertion still passed** and only "no trace file" failed —
because a trace is a zip and compression hides plaintext from a substring scan. A scan a regression
can walk past is not a proof. With archive expansion, the same deliberate revert fails **11** tests.

## What is deliberately NOT redacted

**The submission preview.** It exists to show the student exactly what will be sent, in their own
words, so they can authorise it. Redacting it would make it useless. It is shown to the data
subject, not written to a log — and production must never log one.

## What this does not change

Nothing about authentication, account creation, or ADR-0020. `ConfirmedValue` is untouched:
personal data stays confirmed, credentials never become `ConfirmedValue`, and `fill` still accepts
nothing else.
