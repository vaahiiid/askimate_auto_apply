# P23 — deliberate regression audit

Fourteen mutations, each applied to a source file on disk, **read back from disk to prove the edit
landed**, run against the suites that should catch it, and then restored from a byte copy taken
before the edit — never from `git checkout`, because a restore that consults version control cannot
distinguish "put back" from "was never changed".

Eleven were caught on the first pass. Three survived: **two were bad mutations of mine**, and one
was a real untested property.

| # | Mutation | File | Result | Caught by |
|---|----------|------|--------|-----------|
| R1 | The run read **advances** the run instead of reading it | `routes.ts` | **CAUGHT** | driver e2e |
| R2 | The run read stops checking who owns the conversation | `routes.ts` | **CAUGHT** | driver e2e |
| R3 | The run read reports a cached step, not the orchestrator's | `run-driver.ts` | **CAUGHT** | driver e2e, journey |
| R4 | The run read claims it started something (`resumed: false`) | `run-driver.ts` | **CAUGHT** | driver e2e |
| R5 | A conversation is created for someone other than the caller | `event-store.ts` | **CAUGHT** ² | routes |
| R6 | The conversation listing stops scoping to the caller | `event-store.ts` | **CAUGHT** | routes |
| R7 | A single conversation read stops scoping to the caller | `event-store.ts` | **CAUGHT** | routes |
| R8 | The page cursor loses microseconds, and so loses rows | `event-store.ts` | **CAUGHT** | routes |
| R9 | The idempotency key stops replaying | `event-store.ts` | **CAUGHT** | routes |
| R10 | The conversation id is taken from the client | `routes.ts` | **CAUGHT** ² | routes, journey |
| R11 | The generated id leaves Crockford's alphabet | `ulid.ts` | **CAUGHT** | routes |
| R12 | The generated id stops being time-ordered | `ulid.ts` | **CAUGHT** ¹ | ulid unit |
| R13 | The listing limit stops being bounded | `routes.ts` | **CAUGHT** | routes |
| R14 | An idempotency key may name no result at all | `0013…sql` | **CAUGHT** | schema |

¹ Survived the first pass — a real gap. ² Survived because the mutation was unreachable; the
mutation was redesigned, not the finding recorded as coverage.

## R8 — the mutation that was already true

`R8` reverts the cursor to `createdAt.toISOString()`. It is listed as a regression, but it is how
the code was **first written**, and the paging test failed on it immediately: `timestamptz` keeps
microseconds, a JavaScript `Date` keeps milliseconds, and `toISOString()` prints milliseconds. So a
cursor built from the Date names an instant slightly *earlier* than the row it came from, and every
row created in the rest of that millisecond sorts after the cursor and is **skipped**.

Five conversations opened in a loop lost one. The fix is to build the cursor from the database's own
value at its own precision, and the test that found it is kept as the regression for it.

## The two mutations that were unreachable, and what that taught

`R5` and `R10` both survived their first form because I gated them behind a request header no test
sends — `x-open-for`, `x-conversation-id`. That is not a shadowed control; it is a **mutation that
never executed**, and counting it as coverage would have been the exact dishonesty the regression
rule exists to prevent.

Redesigned to run unconditionally — the store inserting for `(SELECT id FROM students LIMIT 1)`, and
the route answering with a fabricated id and never inserting — both are caught immediately, by
assertions that were already there: `opens one, in the published shape` reads the `student_id` back
out of the row, and the journey uses the returned id for all forty of its later requests.

The lesson generalises: **a mutation behind a condition no test meets proves nothing about the code
and everything about the mutation.** Mutate the control on the path the tests actually take.

## R12 — a generator with two published properties and no test

Reversing the ULID so the random half came first broke nothing. The contract says the id is
*"sortable by creation time and not guessable in sequence"*, and the column's CHECK enforces
Crockford's alphabet — but every test that lists conversations inserts them with **literal** ids, so
nothing had ever looked at a generated one beyond its shape.

`ulid.test.ts` now asserts all four properties directly: the shape, the absence of I/L/O/U, that
lexical order is time order, and that 500 ids drawn in one millisecond are distinct and do not
cluster. R11 was caught even before this — but only because a bad alphabet produces an id the
*column* refuses, which is a database error, not a test of the generator.

## What the exercise confirmed about the design

**The run read really is a read.** R1 makes it advance the run, and the test that catches it does
not assert a status code: it counts `workflow_runs.revision`, `conversation_events` and
`case_events` before and after and requires all three unchanged. A `GET` that advanced a run would
make merely looking at an application a consequential act.

**Ownership is enforced in the query, not after it.** R5, R6 and R7 each remove the `student_id`
predicate from a different statement, and each is caught separately — because there is no
post-filter anywhere that would have caught them all at once.

**`resumed` is load-bearing.** R4 flips it to `false` on the read. A client that saw `resumed: false`
from a `GET` could reasonably conclude the read had started something, which is why the read hard-codes
`true` rather than passing through whatever a coordinator last set.

## Scope note

Nothing here fabricated review evidence, invented a blueprint, or approved an artefact through
production code. No UI was written: this phase establishes that the journey can be started and read
before anything renders it.
