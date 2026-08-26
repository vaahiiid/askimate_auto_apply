# ADR-0008 — Recovery-first escalation, and the learning loop

**Status:** **Accepted** — Vahid's product decision, 2026-08-26
**Refines:** ADR-0007 (corrects the AssistedManualAdapter consequence)
**Affects:** the case state machine, the event log, Phases 3–7

## Context — and a correction

ADR-0007 flagged a question about who executes `AssistedManualAdapter` when automation fails. I
recorded the reading that "a specialist completes the application". **Vahid has corrected that,
and the correction is a genuinely better design:**

> The purpose of the human specialist is not to routinely perform application work instead of the
> AI. The human specialist is a **recovery and escalation layer**, not the primary application
> operator.

Handing a whole application to a specialist on any failure would turn every automation gap into
manual labour, which does not scale and quietly converts the product into an agency.

## Decision, part 1 — recovery-first escalation

When the AI cannot safely proceed:

1. The workflow **creates a high-priority escalation immediately.**
2. The relevant specialist is **alerted as fast as possible.**
3. The case **pauses safely at the exact point of failure** — it does not unwind, and it does not
   fail the application.
4. The specialist reviews and **continues** the application.
5. The specialist **does not restart from the beginning.**
6. **Everything the AI already completed stays available and auditable.**
7. On resolution, the workflow **resumes from the appropriate state.**

This is modelled as a distinct case state, `AWAITING_SPECIALIST_RECOVERY`, deliberately separate
from `AWAITING_HUMAN_REVIEW`. They are different situations and conflating them would lose the
distinction that drives alerting:

| | `AWAITING_HUMAN_REVIEW` | `AWAITING_SPECIALIST_RECOVERY` |
|---|---|---|
| Situation | "Check my work before I proceed" | "I am stuck and cannot proceed" |
| Trigger | Mandatory (financial evidence, minor) or low confidence | The AI hit something it cannot safely resolve |
| Urgency | Normal queue | **High priority, alert immediately** |
| Resolution | Approve / reject / request changes | Unblock, then **resume from the failure point** |
| Progress | Application is essentially complete | Application is mid-flight and must be preserved |

**`ROUTE_FALLBACK` is demoted to a last resort.** Previously it was the first response to a failed
automated route. It is now what happens only when a specialist cannot make the automated route work
at all — switching route entirely, rather than unblocking in place.

**Resuming requires knowing where the AI got to.** A new `ExecutionCheckpoint` records the
blueprint version, page, section, step and the sections already completed. It is what makes
"do not restart from the beginning" a property of the system rather than an aspiration.

## Decision, part 2 — the learning loop

Vahid: *"This learning loop should be treated as an important architectural requirement for the
system, not merely as logging."*

Every human intervention captures an `InterventionRecord`:

- what the AI **encountered**
- what the AI **expected**
- **where** it failed (the execution checkpoint)
- what the **specialist did**
- what the **successful resolution** was
- which **university / portal / course / step** it happened on
- whether the resolution is **reusable**

The intended loop:

```
AI attempts → failure → alert → specialist resolves → resolution captured
   → reviewed / validated → reusable knowledge or workflow rule
   → future attempts use it → fewer interventions over time
```

### The control that makes this safe

Vahid is explicit, and this is the load-bearing constraint:

> Do not interpret "learning" as allowing the AI to automatically change its own production
> behaviour without controls.

So an intervention record has a lifecycle, and **only the final state may influence production
behaviour**:

```
  captured  →  under_review  →  validated  →  published   ← ONLY this is usable
                            ↘  rejected
                               superseded
```

Enforced the same way as every other guarantee in this codebase: a branded type. `ReusableResolution`
is minted **only** from a record whose lifecycle is `published`, and the (future) knowledge
retrieval accepts nothing else. Wiring the raw intervention log into the AI's context — the exact
failure mode this constraint names — does not fail a review, it fails to compile.

### This is not a new workflow for the team

Worth stating, because it de-risks the whole requirement: **the existing AskiMate already runs this
loop.** Its knowledge base uses `kb_pending_entries` (`status: pending`, `approvedBy`, `ingestedAt`
/ `rejectedAt`) → human approval → `kb_entries`, with a quality gate on the human's answer before
ingestion.

The learning loop here is that same pattern applied to intervention resolutions rather than student
questions. The team has operated it successfully in production, which means the operational
question — *who reviews these, and how often* — has a known answer rather than a hypothetical one.

## What is modelled now, and what is not

**Modelled in Phase 1 (this change):** the recovery state and its transitions, the execution
checkpoint, the escalation and resolution events, the intervention record, its lifecycle, and the
promotion gate.

**Not built, and explicitly not claimed:** the alerting transport, the specialist console,
similarity matching against past interventions, and the retrieval that lets a future attempt use
published knowledge. Those are Phases 3–7. What exists now is the shape they must fit, so they
cannot be bolted on in a way that bypasses the promotion gate.

## Consequences

- A specialist's job is to unblock, not to operate. Failure does not become manual labour by
  default.
- Cases survive failure without losing work, which matters most at the point where the most work
  has been done.
- The system has a defined path to needing fewer interventions over time, rather than a constant
  human cost per application.
- Interventions become a data asset: they are the raw material for blueprint corrections, mapping
  fixes, and new workflow rules.
- **The student is never handed the form.** Reaffirmed by Vahid and unchanged from ADR-0007: if
  human intervention is needed, the specialist is the recovery layer.
