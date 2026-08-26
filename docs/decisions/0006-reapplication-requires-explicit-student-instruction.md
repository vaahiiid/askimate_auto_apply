# ADR-0006 — Re-application requires an explicit student instruction

**Status:** **Accepted** — approved by Vahid, 2026-08-26
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

## Consequences

- Duplicate submission remains structurally impossible: the only path to a new attempt is an
  event type that no automated code path can emit.
- Student autonomy is preserved. AAS advises; it does not gate.
- Every re-application can answer, from stored data alone: who asked, when, in what words, what
  we advised, and whether they chose to proceed anyway.
- Implemented in Phase 1 as `packages/domain/src/reapplication.ts` and the
  `ReapplicationInstructed` event.
