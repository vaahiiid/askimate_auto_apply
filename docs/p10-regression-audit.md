# P10 — the deliberate regressions, and the one that had no test

**Date:** 2026-09-01 · **Governs:** [ADR-0048](./decisions/0048-a-specialist-resolution-completes-an-intent.md)

Eight mutations, each proved applied by re-reading the file **from disk** before
the result was interpreted. Restores are from a file backup, not `git checkout`
— see §4 for why that matters.

| # | The mutation | Caught by |
|---|---|---|
| **R1** | A stopped run never changes status — the pre-P10 behaviour | `becomes UNCERTAIN…` — *expected 'running' to be 'uncertain'* |
| **R2** | The driver raises under a key that is not stable | **NOT CAUGHT FIRST TIME.** See §1 |
| **R3** | The student is told on every poll, not once | `raises ONE intervention even if…` — *told exactly once: expected 2 to have length 1* |
| **R4** | Resolving records the adjudication but not the FACT | `resolving it completes THE FACT…` — *expected null to be 'succeeded'* |
| **R5** | The operator CLI opens the database | `pnpm run boundaries` — *the operator CLI is an INTERFACE, not a writer* |
| **R6** | `route_fallback` admitted onto the wire | compile error on `ROUTE_FALLBACK_IS_NOT_ON_THE_WIRE`, **and** three drift tests |
| **R7** | A second resolution silently overwrites the first | store contract — *promise resolved instead of rejecting* |
| **R8** | The `route_fallback` CHECK no longer refuses | schema test — *promise resolved instead of rejecting* |

## 1 · The one that was NOT detected, and what it exposed

**R2: the driver raised under a randomised key, and every test still passed.**

The reason is worth recording, because it is the same shape as the misses in P7
and P9. `raise` is idempotent per `(runId, idempotencyKey)`, and the store's own
contract suite proves that on both adapters. But at the *driver* the property
was never exercised, because **the first poll moves the run to `uncertain` and
the candidate query never offers it again**. One raise, ever. Idempotency had
nothing to be idempotent about.

The case it exists for is the crash window. `#pause` raises, announces, then
writes the status — three writes across two stores with no transaction between
them. A process that dies after the raise leaves a run still marked `running`,
and the next poll comes straight back through the same path. That must find the
same intervention and must not tell the student twice.

So a test was added for exactly that: reset the status to `running` behind the
driver's back (the interruption), poll six times, and assert one intervention,
the same id, one message, and the status write completing on the retry. With
that test present, R2 fails as *"one stuck action is one case, however many
times it is polled: expected 2 to have length 1"*.

**The recurring lesson, now five phases running:** a property that only holds
during a crash needs a test that simulates the crash. The happy path cannot
reach it, and a suite that only walks the happy path will report it covered.

## 2 · A detection that was rejected as insufficient

R2 and R3 were first run with `vitest -t`, which filtered out the test that
*creates* the paused run. Both "failed" — on `expect.unreachable("the run is
paused")`, the precondition, not the property. That is not evidence, and it was
not counted: both were re-run against the whole file, where the setup executes
in order and the failure names the property.

The same rule retired an earlier R3 attempt whose only symptom was a bare
`duplicate key value violates unique constraint`: the mutation was caught, but
by a constraint rather than by the assertion, and the message said nothing about
what had broken. It was replaced with a mutation at the key's source, which
fails on the property itself.

## 3 · What this phase deliberately does not do

**`escalated` is not reachable from `claimWork`.** `assessIntent` returns
`escalate` only for an action `isVerifiable` says cannot be checked. Both actions
a runner performs — `create_portal_account`, `advance_portal_page` — are
verifiable, and the two that are not (`consume_secret`, `submit_application`) are
never handed to a runner. So the branch is real, wired end to end, and currently
exercised only by a direct enumeration of `statusForVerdict`. This is stated in
the code, in the test, and here, rather than left to look covered.

**The journey test has no pause leg.** `scripts/journey.test.ts` builds a healthy
run across four planes; a pause needs an uncertainty injected into the ledger,
which groups I and J do against the same real stack — a real database, the real
driver, and for J the real HTTP routes. The journey proves the pieces fit; the
variants belong in tests that can vary them.

**No alerting transport.** ADR-0008's other half. `pnpm run interventions` is
pull-only, and "open" is derived from the store rather than from anything a
notification delivered, so no case can be lost by an alert that never arrived.

**`route_fallback` is refused in three places** — the wire's closed set, the
store, and a database CHECK — and implemented in none. ADR-0048 §4.

## 4 · A mistake made during this phase, recorded

Reverting R1 with `git checkout -- apps/conversation-service/src/run-driver.ts`
discarded **every uncommitted P10 change in that file**, not just the mutation.
The earlier phases' regressions touched files that were clean against `HEAD`, so
the habit was safe until it was not.

It was noticed immediately (the restored file no longer contained
`statusForVerdict`), the work was rebuilt, and the full suite returned to the
same 1714 tests it had before. Every regression after that point restores from a
file copy taken at mutation time. Recorded because the failure mode — a revert
that silently reverts more than intended — is quiet, and the next person
reaching for `git checkout` mid-phase deserves the warning.
