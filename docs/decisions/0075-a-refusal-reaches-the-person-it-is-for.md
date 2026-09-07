# ADR-0075 — A refusal reaches the person it is for

**Status:** **Accepted** — approved by Vahid, 2026-09-07
**Completes:** [ADR-0061](./0061-the-run-says-what-it-is-waiting-for.md) ·
[ADR-0073](./0073-a-declared-capability-with-no-production-caller-fails-the-build.md) — the same
question one layer out: a reason nothing states is a reason nobody has

## Context

`PROBLEM_CODES` is a closed set, and two of its members were argued for on exactly one ground —
that a client must be able to tell them apart from a generic conflict. The vocabulary says so in
its own comments:

> `already_applying` … *"if that application has concluded the student can instruct a second
> attempt. A client that could not tell this apart from any other 409 could not offer them that."*
>
> `specialist_reviewing` … *"a state they were already told about in the conversation, and a client
> that could not tell it from a 404 would show them a dead end for something that resumes by
> itself."*

Both were correct on the wire. Neither reached anybody. The student's page held six wordings, and
every other code — including those two, added in P38 and P40 — fell through to:

> That did not work. Let me show you where things stand.

That sentence is the opposite of what P40 had just promised a student whose run a specialist is
holding, in the transcript directly above the notice.

Underneath it was a second, larger version of the same defect. Both services put
`express.json({ limit })` in front of every route, and both publish `413 payload_too_large` and
`415 unsupported_media_type`. **Neither had ever sent one.** Everything the parser itself refused
reached the blind error handler and came back `500 internal_error`. The comment beside the limit
said *"`413` from here is the contract's `payload_too_large`"*, and nothing made it true. A student
who pasted a long personal statement was told our side had broken, for a body only they could
shorten.

This is the shape ADR-0073 named — a record asserting something production does not do — found by
asking the same question about a different kind of declaration.

## Decision

**Every refusal is stated by the service that decides it, published by the contract that describes
it, and worded by the surface that shows it. A gap in any of the three fails the build.**

### 1. The service states the code the contract publishes

`problemForBodyError(error)` maps a body-parser failure to a published code, and both error
handlers consult it before falling through to `internal_error`:

| `err.type` | code | status |
|---|---|---|
| `entity.too.large` | `payload_too_large` | 413 |
| `entity.parse.failed` | `validation_failed` | 400 |
| `charset.unsupported`, `encoding.unsupported` | `unsupported_media_type` | 415 |

It lives in `packages/contracts` because both services need it and two copies would be two chances
for one of them to answer 500 for a refusal the other states properly.

**It reads `err.type` and nothing else.** `body-parser` puts the *raw request body* on `err.body`
for a syntax error — the field that would carry a half-typed password into a log line or a
response. Both handlers delete it before anything touches the error; this function is written so it
would be harmless if they did not.

A Content-Type that is simply not JSON is **not** in the table. `express.json` skips such a body
silently and the route's own validation refuses it, which is the answer that names the missing
field rather than the header. The contract's `UnsupportedMediaType` description said otherwise and
was wrong; it now says what the parser does.

### 2. The document carries `instance`

`parseProblem` requires it, so a document without one is a refusal the client cannot read — the
same defect one layer down. Neither the new refusals nor the existing `internal_error` had one.

### 3. Every POST publishes what the parser can refuse

The parser guards every route, so 400, 413 and 415 are now published on every `post` operation in
both documents — read off the documents by `contract-drift.test.ts`, not off a list.

### 4. The student's page words every code it can be told

`REFUSALS` and `CANNOT_REACH_THIS_PAGE` must together cover `PROBLEM_CODES`, and a code in neither
fails `refusal-wording.test.ts`. The second list is the reachability register's shape: a reviewed
claim with a reason each, rather than silence.

**Writing that list is what made it useful.** Its first draft had three entries and two were wrong:
it claimed `payload_too_large` could not arrive because *"the only bodies are short text"* — the
statement box takes a paste of any size — and that the page *"sends no idempotency key"*, when
`transport.ts` sends a fresh one on two of its calls. Neither error was findable by reading the
page. Both were findable by having to write down why a code could not arrive.

### 5. The page does not navigate away on a mid-journey 401

`start` sends a page loaded with no session to `/auth/login`, and that stays. A session that
expires *during* the journey is worded instead, because by then the student may have typed
something, and the one thing this page is careful about above everything else is not losing what
they wrote. A redirect is a failed send that takes the box with it.

## What this deliberately does NOT do

- **It does not add a code.** Every wording is for a code that already existed and was already
  stated somewhere. The set stays closed.
- **It does not let the page decide anything.** A wording is a rendering of the server's reason, not
  a second opinion about it. The page still cannot tell `not_found` from `forbidden` except by what
  it was told.
- **It does not touch the blindness.** The refusal names a status and a code. It quotes nothing from
  the body, and `app.test.ts` proves a 70 KB body carrying a marker comes back without it.
- **It does not re-word the six that were already there.** They were right.

## Consequences

- A student who pastes something too long is told to shorten it, by the service, in one round trip.
- A student whose run a specialist is holding reads a notice that agrees with their transcript.
- An integrator reading either OpenAPI document sees every status the process can send them.
- Three checks now fail on a gap that used to be invisible: the wording coverage, the published
  statuses, and — for `problemForBodyError` — the reachability register.
- The declared-but-unreachable surface is **unchanged at six**. The enforced count goes from twelve
  to thirteen.
