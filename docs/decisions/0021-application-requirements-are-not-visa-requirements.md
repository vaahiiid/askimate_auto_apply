# ADR-0021 — University application requirements are not Student visa requirements

**Status:** **Accepted** — Vahid's decision, 2026-08-26
**Refines:** [ADR-0009](./0009-requirements-provenance-and-verification.md)

## The decision

> *"For the MVP, the initial application scope is the UK. Do NOT make financial evidence a
> requirement for the first UK university application workflow simply because it is important for
> the Student Visa process… The distinction must be explicit: University application requirements ≠
> Student Visa financial requirements."*

And, equally clearly:

> *"Keep the financial-evidence architecture and criticality rules we have already designed. Do not
> remove or weaken the existing financial-evidence safety controls."*

## Why the confusion is easy, and expensive

Financial evidence is genuinely `critical` — being wrong about the 31-day recency window costs a
visa — and it is **not something a UK university asks for before considering an application**.
GOV.UK treats it as a visa requirement that depends on the applicant's circumstances, not as a
universal precondition for applying to study.

Conflating the two has a specific cost: a perfectly valid application never gets prepared, because
the system is waiting for evidence of a rule that does not apply yet and may never apply in that
form to this student. The student sees a blocked case and no explanation that makes sense to them.

## What changed: one new axis, and nothing else

`Requirement` gains a **`scope`**, separate from its criticality:

| | |
|---|---|
| `university_application` | the university asks for it to consider the application — **blocks** |
| `student_visa` | UKVI asks for it, later, depending on circumstances — **does not block the application** |
| `institution_compliance` | ATAS, right-to-study checks the institution must satisfy — **blocks**, because the institution cannot proceed either |

`blocksApplication(requirement)` is the single line that keeps the visa journey out of the
application journey.

**Scope decides *when* a requirement bites. Criticality decides *how much evidence* it needs.** They
are orthogonal, and separating them is what lets financial evidence be out of scope for the first
application while keeping every control it already had.

The field is **required**, not optional. An optional one would let a visa rule default into blocking
a university application — which is the failure, arriving by omission.

## What did not change

Tested explicitly, because "we kept the safety controls" is the kind of claim that quietly stops
being true:

- Financial evidence is still `critical`.
- A `critical` requirement still needs **corroboration from both channels**, agreeing and fresh.
- Conflicts still escalate rather than resolving automatically.
- The deterministic validity engine, the 31-day window, the branded `ValidityRule` that cannot be
  built without a `VerifiedRequirement` — all untouched.

A `student_visa` requirement that **is** in scope, at the visa stage, faces exactly the same bar it
faced before this ADR.

## Consequences

- The first Ulster Birmingham run does not collect financial evidence and does not block on it.
- The Requirements Service moves from "blocking" to "deferrable" for this run — it was blocking only
  because a critical requirement was assumed to be in scope. That is now recorded as a decision
  rather than an assumption.
- Adding financial evidence later, for a route that actually requires it, is a **data** change: mark
  the requirement `student_visa`-scoped and act on it at the visa stage. No code changes, and no
  weakening.
