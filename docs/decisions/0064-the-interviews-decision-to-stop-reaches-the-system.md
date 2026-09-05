# ADR-0064 — The interview's decision to stop reaches the system

**Status:** **Accepted** — 2026-09-05
**Completes:** [ADR-0062](./0062-the-question-the-run-is-waiting-on-is-in-the-log.md) — that wired one of
`nextAction`'s five kinds into the driver; this wires the two that were still dropped
**Depends on:** [ADR-0048](./0048-a-specialist-resolution-completes-an-intent.md) (the intervention a
specialist picks up), [ADR-0051](./0051-the-student-supplies-through-the-conversation.md),
[ADR-0060](./0060-the-conversation-service-owns-the-student-surface.md)
**Blocked by, and deliberately not closed:** [ADR-0022](./0022-a-document-in-the-vault-is-not-permission-to-send-it.md)
and [ADR-0023](./0023-retention-periods-are-determined-not-invented.md) — document upload, see §4

## §1 · The measurement

`nextAction` returns a closed union of five kinds. The driver honoured two:

| Kind | Before P28 |
|---|---|
| `ask` | asked (ADR-0062) |
| `confirm` | played back (ADR-0051) |
| `complete` | the plan has no blockers, so the step moves on |
| `escalate` | **silently dropped** |
| `request_document` | **silently dropped** |

The tell was in the code. `interviewAsk`'s comment enumerated the non-question kinds as *"`confirm`,
`complete` and `escalate`"* — and omitted `request_document` entirely. The author listed the union
and missed a member.

**`escalate` is reachable today, with the shipped fixture catalogue.** After
`MAX_ATTEMPTS_PER_FIELD` (3) rejected readings of the last outstanding field, `nextAction` decides a
specialist must look. Nothing happened: no message, no intervention, no status change. And because
`interviewAsk` also matched only `ask`, every further thing the student said was ignored too. The run
sat at `interview` for ever, with a composer inviting answers nobody would read.

## §2 · How a stop is represented

**Through the mechanism that already exists**, not a new one. `#raiseForSpecialist` was extracted
from `#pauseForReview` so the two callers share one construction of ADR-0048's intervention — a
second would be a second way for a run to be waiting for a person, and the two could disagree about
which runs those are.

- **Reason: `information_unobtainable`.** Its own definition in `recovery.ts` is this situation —
  *"the agent interviewed the student and still cannot obtain what is required."* The domain has
  carried that word since P10 with nothing ever raising it.
- **Priority: `high`, not `critical`.** `recovery.ts` reserves `critical` for a case whose deadline
  is imminent. This driver does not know the deadline, so it does not claim to.
- **Target: `interview:<fieldKey>` or `document:<documentType>`** — a stable identifier, never the
  model's prose, because the target is part of the idempotency key and a sentence that varied
  between calls would raise a second intervention for the same stuck field.
- **Run status: `escalated`**, which `dueRuns` already excludes, so the worker stops advancing it.
- **The case does not move.** A stopped interview is not a case transition, and `PROFILE_INCOMPLETE`
  has no edge to a review state.

The status is written whether or not an intervention store is configured. A deployment without one
must still not leave a run being advanced for ever into a step it can never leave.

## §3 · Why it is checked on the message path, not only while advancing

The first implementation put the check only in `#decideOnce`. That is the path an *advance* takes —
and **a client that has just sent a message re-READS the run rather than advancing it** (ADR-0060,
ADR-0061). So the escalation would never have fired in the journey a student actually walks. The
browser test caught it.

The stop is therefore reached from `#askAfterWriting` — which now asks, or stops, and never neither
— and `#correct` calls that after a refused reading, because a refusal is the write that can exhaust
a field.

`#decideOnce` keeps its check too, and it is not redundant: `#correct` appends the rejection and
*then* re-derives, so a process that dies between those two leaves an exhausted log and a run still
marked `running`. The advance is what stops it. That crash window has its own test.

## §4 · `request_document`, and what is deliberately not built

**Document upload is not implemented, and must not be.** ADR-0022 governs disclosure before a
document is sent anywhere, and ADR-0023 requires a retention period to be *determined* rather than
invented — and that determination is **UNAPPROVED**. Building storage for a student's
passport ahead of that decision is exactly the thing this repository refuses.

Measuring the path produced a finding that changed the phase:

- `planFill` sends a `document`-sourced mapping to `uploads`, never to `blockers`; only a
  `profile_field` whose value is unavailable becomes a blocker.
- The orchestrator enters the interview only `if (plan.blockers.length > 0)`.
- `nextAction` returns `request_document` only once no field is missing.

Those cannot both hold, so **`request_document` is not reachable through the run driver's step
derivation.** The first version of its test asserted an escalation that cannot happen; it was
deleted rather than kept green, for the reason P24 deleted one.

What that leaves is worse than the stranding it replaced, and is recorded rather than fixed here:
**a reviewed artefact can declare `requiredDocuments`, and the run neither asks for it nor stops.**
Closing that means building document support, which is the blocked decision above.

The branch stays in `#stopIfTheInterviewGaveUp` — it costs nothing, the action type permits the kind,
and the day documents do reach the interview the handling is already there. Because the branch cannot
execute, it is asserted **as data** rather than behaviourally, so it cannot silently narrow.

## §5 · What the student sees

The position line used to read `Your application: interview (escalated)` whatever had happened — the
step they were last asked about, above an open composer. The escalation message was in the transcript
directly above, contradicting it.

A run whose status is one of the two the driver names as waiting for a person (`escalated`,
`uncertain`) now reads *"Your application is with a member of the team. I will come back to you."*,
and the step is not shown at all: which step it stopped on is not the student's business, and reading
it as a prompt is exactly the mistake.

The message itself is **not** `reviewMessage`. That one says *"a rule we apply every time, not
something that has gone wrong"*, which would be a lie here — something did go wrong.

## Consequences

- A run can no longer sit at `interview` with nothing outstanding and nobody looking.
- One more caller of ADR-0048's intervention store, and no second state machine.
- No schema change: the interventions table already holds everything this needs.
- Document upload remains out of scope, with the blocking decision named rather than worked around.
