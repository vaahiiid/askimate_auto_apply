# ADR-0096 — Expired document intakes are swept by the worker

**Status:** **Accepted** — 2026-09-10
**Continues:** [ADR-0094](./0094-document-metadata-is-durable-and-the-transport-starts.md), which
named *"an intake sweep"* as the last of the three things it left unbuilt: *"Expired intakes are never
returned and are deleted when found by `take`; rows nobody confirms stay until then. A periodic
delete is a worker job for when the worker has one."* Extends [ADR-0052](./0052-the-background-worker-is-the-fifth-deployable.md)'s job vocabulary
by one.

## Context

An intake is fifteen minutes of permission to confirm one upload (ADR-0090). `take` refuses an
expired row and spends the one it finds (corrected 2026-09-10, ADR-0094), so an expired intake is
already unusable. What remains is the row of a declaration that was made and never confirmed — a
student who chose a file, was refused by the bucket, or closed the tab. Nothing reads such a row
again, and with the page's upload control now live (ADR-0095) there will be such rows.

The row holds no document and no byte — migration 0017 has no column that could — and no fact the
conversation log does not already hold. Keeping it protects nothing; removing it loses nothing.

## Decision

### A fourth worker job, and only a DELETE

`sweep_document_intakes` joins `advance_runs`, `announce_interventions` and `notify_specialists`.
Migration `0018` widens the closed `job_kind` vocabulary the way migration `0015` did. The job calls
`sweepExpiredIntakes(pool, now, batch)` in the Conversation Service package — one statement,
`DELETE … WHERE intake_id IN (SELECT … WHERE expires_at <= $now ORDER BY expires_at LIMIT $batch)` —
bounded like every batch in the worker, oldest first, idempotent on the same clock.

The worker still names no vault. The function it calls is a DELETE over a table that cannot hold a
byte, and `pnpm run boundaries` goes on refusing this app the documents package and the secrets
package. The worker's test writes its abandoned rows by hand for exactly that reason.

### Sixty seconds, under a lease

Default interval `60 000 ms`, configurable as `AAS_WORKER_SWEEP_MS`. The reasoning is ADR-0052
§13.1's for the Secure Service's `sweep_expiries`, at half the pace: nobody is waiting on a sweep,
read-time expiry already makes the row unusable, and here there is no student to be *told* anything
by it. Held under the same sixty-second lease as the other three, re-claimed on each tick, released
on an orderly stop — tested for the sweep as it was for the others: a second worker sweeps nothing
while the first holds the lease.

### The race with `take` is not a race

Both statements are single DELETEs by id. If the sweep wins, `take` finds no row; if `take` wins, it
spends the row itself and refuses it as expired. Neither path can hand an expired permission out,
and neither errors. Tested with the two racing.

## What was built

- `apps/conversation-service/migrations/0018_sweep_document_intakes_job.sql`
- `sweepExpiredIntakes` in `document-intake-store.ts`, exported from the service package;
  `WORKER_JOBS` widened
- `apps/worker`: the job, `DEFAULT_SWEEP_MS`, `sweepIntervalMs`, `AAS_WORKER_SWEEP_MS`, `swept` in
  `runOnce`, the startup line
- Tests: three in `document-store.test.ts` (only expired, bounded oldest-first, racing `take`);
  three in `worker.test.ts` (under a lease with the count, a second worker sweeps nothing, the lease
  is released on stop)

## What was not built

- **The retention sweep** — `purgeContents` still has no caller. A retention sweep is a different
  thing from this one: it destroys a document a student gave us, on a clock a policy started, and
  its first row (`last_used`) needs the *use* to exist before the clock can. It is in the
  reachability register with that reason.
- **The runner's fetch** — as ADR-0095 left it.

**Declared-but-unreachable surface: six, unchanged.**
