# ADR-0132 — The uniqueness that protects a queue must not outlive the resolution: one OPEN intervention per stuck action, and the missing caller for the runs it already stranded

**Status:** Accepted · 2026-09-21 · corrects the constraint P10 wrote (ADR-0048); the repair is the same shape as [ADR-0126](./0126-a-stop-recorded-before-the-fix-needs-a-caller-of-its-own.md) · found by Vahid on Run A
**Built in P177**, the same day.

## Context — a paused run that no listing showed and no command could release

Vahid resolved the 18 September intervention `--did-not-happen` on the morning of the 21st, which is
the resolution that means *the act did not land; carry on*. Attempt 3 then signed in through the
consent path, reached `personal.do`, and failed there because the entry named a save locator that
page does not have. He restarted the stack on the newly signed catalogue and found this:

> *"The third run is uncertain from this morning's page fill, and there is NO intervention for it …
> So a paused run exists that no specialist can see and no command can release."*

Read from the code rather than inferred from the symptom, and then reproduced on a real database:

- an intervention is keyed by the stuck action — `idempotencyKeyFor` is `runId:action:target`, with
  no attempt counter and no time in it (`packages/domain/src/workflow.ts`);
- `raise` inserts `ON CONFLICT … DO NOTHING` and, when nothing was inserted, answers with the row
  already there and `created: false`;
- and migration 0003 wrote that conflict target as `UNIQUE (run_id, idempotency_key)` — **with no
  condition on `resolved_at`**.

The reason the constraint exists is the poller: a run is examined every few seconds, so one stuck
page must not become a queue of identical cases. That reason is about the interventions a person is
**holding**. What was written says something much stronger — one intervention per stuck action for
the life of the run, resolved or not — and nothing could tell the two readings apart until an action
stuck, was answered, and stuck again. Which is precisely what a `did_not_happen` resolution invites.

What followed was worse than a duplicate:

1. the second raise collided with the row he had closed that morning and came back naming it;
2. `#pause` announces only when `announcedAt` is unset — and that row had been announced on 18
   September — so **the student was told nothing**;
3. the status write then moved the run to `uncertain`, which is outside `AUTOMATABLE_STATUSES`, so
   neither `dueRuns` nor `candidates` will ever offer it work again.

An application stopped where no queue shows it and no poll reaches it. This is blocker 43 seen from
the other side: there, interventions outliving their cases; here, a case outliving its intervention.

## The three questions, answered

**Why was no intervention raised?** The collision above. Not a missing call, not a failed write: a
successful no-op against a constraint that was stricter than anyone intended.

**Was there a route to release it?** No, and it is worth saying which routes were checked rather than
implying an exhaustive search: the resolution route answers `409 intervention_already_resolved` on a
row that is already resolved, and that is right rather than broken — two specialists disagreeing is
evidence, ADR-0048 §3; the derive path returns a run held by a person **without** re-stopping it, so
a student's message raises nothing; a re-application needs the prior case concluded, and this one is
not; and the student's own cancel, which does reach a held run, ends the application rather than
releasing it.

**Is it a defect?** Yes, ours, and in the schema rather than in the driver.

## Decision — the uniqueness holds over the OPEN interventions, and nothing else changes

Migration 0007 drops the unconditional constraint and creates a partial unique index:

```sql
CREATE UNIQUE INDEX interventions_one_open_per_stuck_action
    ON interventions (run_id, idempotency_key)
    WHERE resolved_at IS NULL;
```

`raise` names the same columns and the same predicate, because `ON CONFLICT` can only infer a partial
index when it is given both; `findForAction` answers the OPEN one, which is what the port's own words
have said since P10 and what neither adapter did.

What does **not** change: two pollers racing on one stuck run still produce one intervention, because
both see the same unresolved row. What changes is only what happens *after* a specialist has
answered — the next episode of the same stuck action is its own intervention, with its own
announcement to the student.

A resolved intervention is never reopened by any of this. It stays resolved, under the name of the
person who resolved it — the class of record ADR-0082 to ADR-0084 spent their phases making
truthful.

## The repair, for the runs it already stranded

0007 stops this happening again. It cannot help a run it already happened to, for the same reason
ADR-0126's case could not be reached: nothing offers an `uncertain` run work, and `#pause` is only
ever reached from a claim. So there is a second repair beside `finish-stopped`, of the same shape:

```bash
scripts/local-stack.sh raise-missing <conversationId>
```

- it raises through the driver's **own** `#pause`, from the same ledger, so the intervention says
  what it would have said and the student is told in the ordinary words;
- it REFUSES a run not held by a person. The two states it acts on are the ones a person is
  supposed to be holding, so it can never touch a live application;
- it REFUSES a run that already has an open intervention, and names it — raising a second beside a
  live one is the queue-full-of-copies failure wearing a repair's clothes;
- it REFUSES a run with nothing unfinished in the ledger. Inventing a fault to explain a state is
  worse than leaving the state;
- it resolves nothing. The adjudication stays a person's act, and the resolution route — unchanged
  — is still what puts the run back to `running`.

Idempotent: run twice, the second says `already_open` and writes nothing.

## Consequences

- A run that stops twice on the same action now costs a person two looks rather than one. That is
  the correct price: the second stop is a second thing that happened.
- The student hears about the second stop. Before, they heard about the first and then silence.
- Two repairs now exist as subcommands of the Conversation Service (`finish-stopped`,
  `raise-missing`). Both are scoped by a state they refuse to act outside, and neither performs a
  transition of its own. A third would be worth pausing over: the pattern is a sign that a state
  machine has holes only an operator can see.
- Proved red first at both levels before the fix: the shared `InterventionStore` contract, and the
  run driver against a real PostgreSQL, where the second stop on one page raised nothing and the
  queue came back empty.
