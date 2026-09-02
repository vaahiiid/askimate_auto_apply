# P14 — the deliberate regressions, and the three that told me something

**Date:** 2026-09-02 · **Governs:** [ADR-0052](./decisions/0052-the-system-acts-when-nobody-is-watching.md)

Twenty-four mutations across four rounds. Each was applied, then the file was
re-read **from disk** and the new text asserted present before any test ran — a
mutation that did not land and a suite that passes look identical. Restores are
from a file copy, never `git checkout`.

Round 1 ran twenty. **Seventeen were caught. Three survived**, and each survivor
turned out to be a different kind of thing: one was my own mistake in the
harness, one was a rule that correctly stays silent until something trips it,
and one was a guard that genuinely changes nothing. All three are written up
below, because "three survived" without them would be a worse report than no
report.

| # | The mutation | Caught by |
|---|---|---|
| **R1** | An expired request is settled but never announced | `EXPIRES a request whose time ran out, and enqueues the transition`, +2 |
| **R2** | The sweep settles a request that is not due yet | `leaves a request that has NOT expired alone` |
| **R3** | The sweep expires a request that already holds a value | `does NOT expire a request that already holds a value` |
| **R4** | A settle that lost a race is enqueued anyway | **survived** — see §2 |
| **R5** | `runOnce` drains before it sweeps, so one pass cannot do both | `runOnce SWEEPS BEFORE IT DRAINS, so one pass does both` |
| **R6** | Two workers may hold one job at once | `REFUSES a second worker while the first still holds it` |
| **R7** | A worker presenting any lease id wins | `REFUSES a worker presenting a lease id it does not hold` |
| **R8** | A lapsed lease is never taken over — crash recovery stops | `RECOVERS the job after a worker dies without releasing` |
| **R9** | `release` ignores which lease it is giving back | **survived round 1** — my harness error, see §1 |
| **R10** | An expired lease still counts as held | `an EXPIRED lease is not a lease` |
| **R11** | The worker advances runs a specialist is holding | `offers RUNNING and SUSPENDED, and nothing else` |
| **R12** | The worker advances a run a RUNNER is mid-operation on | `does NOT offer a run a RUNNER is holding` |
| **R13** | The batch is unbounded | `respects the batch limit` |
| **R14** | One broken run stops every other run in the system | `keeps going when ONE run throws` |
| **R15** | The worker advances without holding the lease at all | `a SECOND worker does nothing while the first holds the lease` |
| **R16** | The worker forgets its own lease, so its next tick does nothing | `the SAME worker keeps working on its next tick` |
| **R17** | `stop()` does not give the leases back | `gives the lease back on an orderly stop` |
| **R18** | A job kind outside the closed set is accepted | `REFUSES a job kind outside the closed set` |
| **R19** | A lease may start already spent | `REFUSES a lease that starts already spent` |
| **R20** | The worker may hold the secure plane's credentials | **survived, correctly** — see §3 |
| **R9** (round 2) | as above, at the right gate | `release gives it back immediately, and only to its holder` |
| **R20b** (round 2) | The worker *declares* the secure-service dependency | `✗ apps/worker must not depend on: @askimate/aas-secure-service` |
| **R4** (round 3) | as above, against a new racing test | **still not detected** — see §2 |
| **R4b** (round 4) | The outbox accepts a duplicate enqueue | 3 tests in `a retry cannot duplicate a durable lifecycle event` |

## 1 · R9 was my mistake, not a coverage gap

The mutation made `release` delete a job's lease regardless of which lease id
was presented — so a superseded worker could hand away the lease its successor
now holds. It survived, and for a moment that looked like a real hole.

It was not. I pointed the mutation at `apps/worker`'s suite, and the test that
detects it lives in `apps/conversation-service/src/worker-leases.test.ts`,
because that is where the store lives. **The gate could not see the detector.**
Re-run against the right suite it was caught immediately, by the assertion it
was aimed at.

Recorded because the failure mode is invisible: a regression harness pointed at
the wrong suite reports "NOT DETECTED" in exactly the same words as a genuine
coverage gap, and the only way to tell them apart is to go and look. A run that
had accepted the first answer would have concluded this repository had a hole it
does not have — and, worse, might have had a test added to "fix" it that
duplicated one already there.

## 2 · R4 survives because the property lives somewhere better

`sweepExpiredRequests` settles a request and enqueues its transition in one
transaction, and guards the enqueue:

```ts
const moved = await store.settle(client, id, "secret_expired", now);
if (!moved) return false;      // ← the mutation removes this
await outbox.enqueue(client, …);
```

`settle` answers false when the row was settled by somebody else between the
SELECT and the UPDATE. Removing the guard survived every test in the file, so I
wrote one that creates the race directly — two sweeps in `Promise.all` over the
same due row — and **it still survived.**

The reason is the interesting part. `enqueue` is
`ON CONFLICT (request_id, kind) DO NOTHING`, so the duplicate the mutation
produces is discarded by the database. **R4b** proves that is where the property
lives: remove the `ON CONFLICT` and three existing tests fail at once.

Two mechanisms, one property, and the mutation only removed the weaker one. The
guard stays, for two reasons now written into the code rather than implied:

- it keeps the **count** truthful — a sweep that lost the race must not report
  an expiry it did not cause;
- relying on a constraint to absorb a write you know is wrong is a worse habit
  than not making the write.

This is the third phase running in which a mutation was caught somewhere other
than where it was aimed, or survived because the property was over-determined
(P12's R1 and the handoff token, P13's R8 and R12). The lesson is the same one
each time, and it is the reason this exercise is worth its cost: **an
integration test sitting downstream of several guards cannot tell you which one
is load-bearing.** Only a mutation can, and only if you then go and find out
why it survived.

## 3 · R20 is a tripwire, and a silent tripwire is a working one

ADR-0052 §13.0 is the decision that keeps ADR-0037's credential separation
intact: the worker owns the Conversation Plane, the Secure Service drains its
own outbox, and **no process holds both planes' credentials**. `pnpm run
boundaries` enforces it by forbidding `@askimate/aas-secure-service` in
`apps/worker`.

R20 removed that name from the forbidden list. Boundaries passed — correctly,
because nothing in `apps/worker` actually depends on the secure service. A rule
against something that is not happening is silent by construction, and mutating
the rule tests nothing.

So **R20b** trips it instead: the dependency is added to `apps/worker/package.json`
and the build fails with

```
✗  apps/worker must not depend on: @askimate/aas-secure-service
```

Both directions of §13.0 are enforced, and both were tripped this way:
`apps/worker` may not name a vault, a store or a resolver, and the Secure
Service may not depend on a conversation-plane store **in production** — a
production-only rule, because `lifecycle.test.ts` legitimately builds a real
conversation app in a second database, which is the only way to prove the push
crosses two planes rather than two objects in one process.

## 4 · What the raw round-1 numbers would have said

Seventeen of twenty, three survivors. Reported flat, that reads as a good result
with a few gaps. It was three different things: **one harness error of mine**,
**one over-determined property whose real owner is a database constraint**, and
**one correctly-silent tripwire**. Only one of the three led to new test code —
the racing-sweep test — and even that one did not detect what it was written
for, which is itself the finding.

The suite is 1816 tests across 92 files, green against a real PostgreSQL.
