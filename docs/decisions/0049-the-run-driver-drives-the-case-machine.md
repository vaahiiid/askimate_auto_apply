# ADR-0049 — The run driver drives the case state machine, and a student's authorisation is captured through it

**Status:** **Accepted** — decided by Vahid, 2026-09-01 ·
**Date:** 2026-09-01 · **Supersedes:** nothing ·
**Related:** ADR-0004, ADR-0008, ADR-0011, ADR-0013, ADR-0014, ADR-0017, ADR-0031, ADR-0041, ADR-0048

## Context

P10 made a stopped run recoverable. Looking for the next gap turned up a larger
one, and it is on the critical path to any real run.

**No production path lets a student answer a consequential question.** Measured
on `main` at `d71bf88`:

| The run asks | What resolves it |
|---|---|
| `authorise` — approve the exact content before filling | **nothing** |
| `student_handoff` — "verify your email" | **nothing** |
| `hand_over_account` | **unreachable**; `handover_due` is never written |

Two consequences follow, and both are facts rather than readings:

- `scripts/journey.test.ts:717` **appends `AuthorisationCaptured` itself.** The
  whole-system journey passes because the test gives the student's approval on
  their behalf. `AuthorisationCaptured` is written by `machine.ts` and by tests,
  and by nothing else.
- `mayConcludeCase` refuses any account stage but `handed_over` or
  `not_required`, and nothing writes `handed_over`. **No case can finish.**

### The fork this exposed

The run driver writes **exactly one thing** to the case log: `openCase`, once,
at start. It never calls `decide`, and never moves a case state. But
`capture_authorisation` refuses unless the case is in
`AWAITING_STUDENT_AUTHORISATION`.

This is the "two unconnected models of a case" that
`docs/roadmap-and-priorities.md` §3 identified in August and that was never
resolved. Capturing a real authorisation forces the question.

## The options

**A · The driver drives the case machine.** The case walks its states and
authorisation is captured through `decide`, with the guards running.

**B · Append `AuthorisationCaptured` directly**, as the driver already reads it,
without driving case states. Small; the fill gate still holds, because
`durable.ts` discards any checkpoint claiming `filling` with no
`AuthorisationCaptured` in the log. But it writes a business event around its
own guard and leaves the machine decorative.

**C · Retire the case machine**, making the run's status the only lifecycle and
keeping the case log as an event record. Honest about what is used; discards
guards written for real reasons.

**Vahid chose A**, 2026-09-01.

### The argument that decides it

`transitions.ts` says a case carrying financial evidence, or involving a minor,
**cannot reach `AWAITING_STUDENT_AUTHORISATION` without a recorded, approving
human review** — *"a GUARD, not a convention … it lives in the machine rather
than in application code specifically so that it cannot be forgotten at a call
site."*

Because nothing drives the machine, that guard has never run. Option B would
capture authorisations while it continued not to run. Option A is the only one
that turns it back on, and it is a safety property about minors and money.

## Decision

### 1 · The case walks an explicit spine, one hop at a time

```
INTAKE → REQUIREMENTS_RESOLUTION → ELIGIBILITY_REVIEW → READY_TO_PREPARE
       → PREPARING → AWAITING_STUDENT_AUTHORISATION → AUTHORISED
```

An explicit ordered list, not a shortest-path search over `ALLOWED_TRANSITIONS`.
A graph walk would be shorter to write and would happily route a case through a
state nobody intended; the spine says where a healthy case goes, and anything
else is a refusal to surface rather than a path to find.

Each hop is a `transition` intent through `decide`, so `checkTransition` runs on
every one. The driver never appends a `CaseStateChanged` itself.

`caseStateFor(phase)` lives in the orchestrator beside `phaseFor`, because
ADR-0041 says each conversation decision has one implementation and this is the
same decision seen from the other side.

### 2 · Why the run authorises before filling, and the machine says the opposite

The case machine reads `PREPARING` → `AWAITING_STUDENT_AUTHORISATION` →
`AUTHORISED` → `SUBMITTING`: fill, then approve, then submit. The run approves
**before** it fills.

They agree once submission is out of scope (ADR-0014). What the student approves
is the exact content that would be submitted, rendered from the plan; the fill
is us typing that approved content into the portal. So `PREPARING` is building
the plan, `AWAITING_STUDENT_AUTHORISATION` is the preview in front of the
student, and everything after — filling included — is `AUTHORISED`. The run
stops at the `AUTHORISED → SUBMITTING` edge, which is exactly where ADR-0014
says stop.

### 3 · The triggers are raised from real data, or the guard is theatre

A guard that never sees a trigger passes every time. So the driver raises the
mandatory triggers from what the run actually holds:

- **`involves_minor`** — from the confirmed date of birth, through the domain's
  own `suggestsMinority`. Never inferred from anything else, and a missing or
  ambiguous date of birth does not mean "adult" (ADR-0013).
- **`financial_evidence`** — from the confirmed profile the run reads, through
  the domain's `isFinancialField`.

Raised with `request_human_review`, which is the intent that already exists.

> **`suggestsMinority`, not `determineAge`.** The draft of this ADR named
> `determineAge`, and implementing it that way raised `involves_minor` on
> **every case in the system**: `determineAge` answers `requires_identity_check`
> for any *stated* date of birth, which is its safety property and is right for
> the question it answers. The two questions differ — "can we conclude
> adulthood" versus "does what we hold suggest a minor" — and only the second is
> what this trigger is about. `suggestsMinority` was added to the domain rather
> than the age being recomputed in the driver, per ADR-0041.

### 4 · A specialist clears a review, through the path P10 built

Raising a trigger with no way to clear it would deadlock every case involving a
minor or money — a worse failure than the one being fixed. `complete_human_review`
is therefore reachable, and it is reachable **through the specialist path
ADR-0048 established**: the same internal plane and the same
asserted-not-authenticated identity, with the same limit on it, at
`POST /internal/v1/cases/{caseId}/review`.

As shipped there is a route and no CLI verb. `pnpm run interventions` gained
nothing for reviews, which is a gap in the operator's tooling rather than in the
path — the route is the interface ADR-0048 §1 argued for, and a CLI verb over it
is additive.

That is deliberate reuse rather than a second console. A review and an
intervention are both "a named human looked at something and said what they
found", and giving them two interfaces would be two places to build the
authentication that ADR-0048 §3 says is a release blocker once a second
specialist exists.

### 5 · A student's authorisation is a decision, not a sentence

The student's approval is captured from an explicit decision carrying the
**content hash** of what they were shown — not from a chat message a model
interprets.

This is not a new position; it is what the existing design already requires. The
authorisation ledger stores the presented text **verbatim** and binds a content
hash, and says why: *"What exactly did I approve?" … Re-rendering the preview
from current data would produce a plausible document that is **not what they
saw**.* A free-text "yes, go ahead" supplies neither. And `AuthorisablePreview`
is branded and obtainable only from `checkAuthorisable`, so there is no preview
to approve that has not passed validation.

A model deciding that a student approved a real university application is the
same class of act as a model inventing a value into one, which ADR-0004 and
ADR-0016 exist to make impossible.

The decision arrives on the **student's own authenticated session** — not the
internal service plane. It is the one decision in this system that is the
student's alone, and admitting it on a service credential would make it
something the operator could make for them.

### 6 · What this phase does NOT do

`student_handoff` and `hand_over_account` remain unresolved, and
`mayConcludeCase` still means no case can finish. They need the same decision
mechanism, pointed at `packages/account`'s lifecycle, and they are the next
phase. This ADR builds the mechanism as a closed set so that adding them is
adding members, not building it twice.

Submission stays out of scope (ADR-0014). The run reaches `AUTHORISED` and stops.

## Consequences

- The mandatory-review guard runs for the first time. A case with financial
  evidence or a minor now **cannot** reach the student's authorisation without a
  recorded approving review — which is a behaviour change, and the point.
- The journey test stops writing the student's approval for them.
- Two models of a case become one driven model. The case log gains
  `CaseStateChanged`, `HumanReviewRequested`/`Completed` and
  `AuthorisationCaptured` from the real path.
- A run whose case cannot legitimately reach authorisation now stops there
  visibly, through P10's machinery, rather than proceeding.
- Specialist identity remains asserted, not authenticated, and the condition
  that ends that (ADR-0048 §3) now covers reviews as well as interventions.
