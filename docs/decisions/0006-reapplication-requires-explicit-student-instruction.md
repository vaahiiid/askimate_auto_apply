# ADR-0006 — Re-application requires an explicit student instruction

**Status:** **Accepted** — approved by Vahid, 2026-08-26
**Amended:** 2026-09-06 (P38) — §3, "as implemented": a re-application opens a NEW case
**Supersedes the proposal in:** [Phase 0 · Deliverable 5, Q2](../phase-0/05-open-questions.md)

## Context

Brief §4: *"Every submission attempt carries an idempotency key. Duplicate submission is the
characteristic catastrophic failure of this class of system and must be structurally impossible,
not merely unlikely."*

Phase 0 asked what makes two submissions "the same", and proposed that a second attempt be gated
behind a *human-reviewed action*. Vahid approved the shape but corrected the gate:

> **The decision to re-apply belongs to the student.**

## Decision

The submission identity is:

```
(student_id, institution_id, course_id, intake, attempt_ordinal)
```

`attempt_ordinal` starts at `1`. The rules:

1. **An automatic retry never creates a new application.** Retries always reuse the current
   ordinal. This is what makes duplicate submission structurally impossible, and it holds
   unconditionally — no configuration, no override, no exception.
2. **A rejected or withdrawn application may lead to a new one only after an explicit student
   instruction.** Nothing else can increment `attempt_ordinal` — not a specialist, not an
   operator, not the orchestrator.
3. **The instruction is recorded** as a first-class, append-only event carrying who instructed,
   when, in what words, and against which prior case.

   > **Amended 2026-09-06 (P38): a re-application opens a NEW case that references the prior
   > one.** See "§3, as implemented" below.
4. **A wait recommendation is presented where appropriate** — typically to wait until the next
   intake, or roughly six months, depending on circumstances.
5. **The student may proceed despite the recommendation.** The recommendation is advice. The
   student's explicit instruction is the decision. The event records both the recommendation shown
   and the student's response to it.

The recommendation is advisory in effect but **mandatory in presentation**: the system must show
it before accepting the instruction, and must record that it did.

## An honest limitation, surfaced rather than hidden

Brief §2.8 ends MVP responsibility at submission confirmation, with no journey tracking. **AAS
therefore does not know, of its own accord, that a prior application was rejected or withdrawn.**
Only the student knows.

So the prior outcome is stored as a **student-asserted claim**, with that provenance explicit in
the type — never as a verified fact. `PriorOutcomeAssertion` carries `assertedBy: "student"` and
the timestamp. If journey tracking arrives in a later phase and can verify outcomes, the same
field gains a verified provenance without any change to the rule above.

This matters because the alternative — recording "rejected" as though the system established it —
would be exactly the kind of quiet invention the whole design forbids.

## §3, as implemented — amended 2026-09-06 (P38)

Approved by Vahid, 2026-09-06.

§3 has always said the instruction is recorded *"against which prior case"*, and that phrasing
already pointed here: a prior case is only "prior" if there is another one. The implementation
went the other way. `fold` handled `ReapplicationInstructed` by INCREMENTING `attemptOrdinal` on
the same case, clearing its authorisation and its submission marker so the case read as a fresh
attempt.

**That was the drift, and it was not only untidy — it did not work.** Every terminal state has an
empty transition list, and `checkTransition` refuses from a terminal state before it looks at the
target at all:

> `${from}` is terminal; a case in this state can never transition again.

So what the fold produced was a `CONFIRMED` case at attempt 2 with no first move. It stayed
invisible because nothing in production could reach the intent — the defect P37 found, arriving
one layer down.

### The decision

**A re-application is a new `ApplicationCase` that references the prior one.**

Vahid's reasoning, recorded because the *why* matters more than the *what*:

> A second attempt is genuinely a different application. Different intake, different deadline,
> possibly changed entry requirements, and a separate authorisation from the student. One case
> holding two sets of requirements and two authorisations makes it impossible to state precisely
> what the student agreed to.

So:

- `ReapplicationInstructed` stays on the **prior** case — it is a decision made about that
  application — and carries `newCaseId` alongside `newAttemptOrdinal`. The prior case stays
  terminal, at its own ordinal, with its own authorisation intact.
- `CaseOpened` gains `priorCaseId`. `openCase` refuses an ordinal above 1 without it, and a prior
  case at ordinal 1: an ordinal above 1 is a claim that an earlier application exists, and a claim
  with nothing to check it against is how the ordinal became a number a caller could assert.
- `attemptOrdinal` lives on the **new** case, derived from the prior chain and never proposed by a
  caller. `openReapplication` is the only constructor for a second attempt, and every field of its
  identity comes from the prior case or from the gate.
- A case has **one** successor. `decide` refuses a second `instruct_reapplication` naming the case
  that already has one, so the chain of attempts is a chain rather than a tree.
- **`CONFIRMED` stays terminal.** The terminal rule in `checkTransition` is unchanged.

### What a student actually does

Since a conversation owns at most one case, the new case lives in a **new conversation** — which is
exactly where the student already is when they meet the refusal:

1. They ask to apply, in a fresh conversation, to a target they already applied to. The submission
   key is claimed, so the request is refused `already_applying`, naming the case that holds it and
   whether it has concluded.
2. `POST .../reapplication/prior-outcome` — they say what happened to the previous application.
   The system composes the wait recommendation and appends `reapplication_advised` plus the
   assistant message they read.
3. `POST .../reapplication` — their instruction, in their own words. The gate runs; the instruction
   is appended to the prior case; the new case opens at the derived ordinal, claims its own key,
   and its run starts.

Two calls rather than one, and not as an accident of REST: rule 4 makes the recommendation
mandatory in presentation, so collapsing the exchange would build the thing this ADR forbids. The
instruction carries the student's statement and **nothing else** — not the prior case, not the
ordinal, not the outcome, not the recommendation. Each of those would have been a field a caller
could disagree with the system about.

### What this does not decide

Naming a specific later intake. `recommendWait` advises `next_intake` when it is given one, and the
Conversation Service has no way to know that a later intake is open — its catalogue port resolves a
blueprint by id and does not list. Advising a student to wait for an intake nobody has reviewed
would be inventing a fact about the world. Production therefore advises `six_months`, and the
`next_intake` branch stays unreachable until a listing answers the question honestly.

## Consequences

- Duplicate submission remains structurally impossible: the only path to a new attempt is an
  event type that no automated code path can emit.
- Student autonomy is preserved. AAS advises; it does not gate.
- Every re-application can answer, from stored data alone: who asked, when, in what words, what
  we advised, and whether they chose to proceed anyway.
- Implemented in Phase 1 as `packages/domain/src/reapplication.ts` and the
  `ReapplicationInstructed` event. The gate was wired into `machine.ts` in P37 (ADR-0072); the
  submission key was armed and the path built in P38.
- A concluded application and the attempt that follows it are two logs, and each can answer "what
  did the student agree to, here?" without the other's answer in the way.
