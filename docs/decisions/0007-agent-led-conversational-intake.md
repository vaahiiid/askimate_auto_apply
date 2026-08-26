# ADR-0007 — Agent-led conversational intake

**Status:** **Accepted** — Vahid's product decision, 2026-08-26
**Affects:** ADR-0004 (extends it), the task model, the profile design (Phase 2)

## Decision

> The student must never be required to manually complete an application form. The AI agent is
> responsible for interviewing the student conversationally, identifying missing information,
> asking for it progressively, requesting documents when necessary, confirming extracted facts,
> and then using the confirmed information to complete the university application autonomously.

There is no data-entry form anywhere in the product — not the university's, and not one of ours.
Information is gathered by an agent-led interview.

## How this combines with ADR-0004 — read this part carefully

Two rules now sit next to each other, and a well-meaning implementer could read them as being in
tension:

| | |
|---|---|
| **ADR-0007 (this one)** | The student must never fill in a form. The agent works autonomously. |
| **ADR-0004 / brief §3.1** | The AI must never be the source of a value in a form field. |

They are not in tension, and the resolution must be stated explicitly because it is exactly where
this could go wrong:

> **The agent is the interviewer, not the author.** Autonomy means autonomous *execution*, never
> autonomous *invention*. The agent decides what to ask, when to ask it, and how to phrase it —
> that is conversational navigation, and it is the same category of reasoning the AI is already
> permitted to do when navigating a page. The *answer* always originates from the student or from
> a confirmed document.

So "the student never fills in a form" does **not** license the agent to guess in order to avoid
bothering them. When information genuinely is not available, the agent still stops — it just stops
by *asking a question in conversation* rather than by presenting a form field.

## A tightening this decision forces, which is worth surfacing

Brief §2.3 applies extract-then-confirm to **documents**. This decision makes conversation a
primary collection channel — and conversational answers are **also** model-interpreted:

> Student: *"I finished my bachelor's in computer science at Tehran Polytechnic in 2023, got about
> 17 out of 20."*
>
> Agent must produce: `{ qualification: BSc, subject: Computer Science, institution: …,
> completionYear: 2023, grade: 17/20, gradeScale: iran_20_point }`

That mapping from free speech to structured fields **is a model inference**, with exactly the same
failure modes as document extraction — misheard values, wrong grading scale, a confident reading of
an ambiguous sentence. Storing it directly would let a model's interpretation become an application
field, which is precisely what ADR-0004 exists to prevent.

**Therefore: extract-then-confirm applies to conversational answers exactly as it does to
documents.** The agent plays back what it understood, in structured form, and the student confirms
before anything is stored.

Enforced by a new type, `ProposedValue<T>`, which carries the model's interpretation *and* the
student's verbatim words. As with `ModelText`, there is **no conversion path** from `ProposedValue`
to `ConfirmedValue` — only the Phase 2 confirmation step can mint one.

The wall now has three sides:

```
  ModelText       — the model wrote it                    ─┐
  ProposedValue   — the model interpreted what a human said ├─→  ✗ cannot reach a form field
                                                            │
  ConfirmedValue  — a human confirmed it                   ─┴─→  ✓ the only thing that can
```

## What remains a student action — the boundary

"Never required to manually complete an application form" does not mean "never required to do
anything". Two things stay with the student, and neither is form-filling:

1. **Handoffs** — identity verification, MFA, OTP, CAPTCHA, payment, legal declarations. Brief §7
   requires these and forbids bypassing them. They cannot legitimately be automated, and the
   agent must never attempt to.
2. **Final authorisation** — reviewing the exact content to be submitted and approving it
   (brief §7). This is *reviewing*, not *completing*.

This boundary is recorded so nobody later removes a CAPTCHA handoff in the name of "the student
must never do manual work". It is enforced structurally: exactly two task kinds may be owned by
the student, and a test asserts that the set never grows.

## A consequence for the AssistedManualAdapter

Brief §6 describes `AssistedManualAdapter` as *"the system prepares everything, a human executes
the final steps"*, and it is the permanent fallback when automation fails.

Under this decision, **that human is an AskiMate specialist, not the student.** If browser
automation fails, we do not hand the form back to the student — that would be exactly the outcome
this ADR forbids, arriving through the back door at the worst possible moment.

⚠️ **Flagged for confirmation.** This reading follows from the decision but was not stated
explicitly. It has a cost: a failed automated route becomes specialist labour, which is a real
operational and margin consideration. Raising it rather than assuming it. It does not block Phase 2.

## Consequences

- **Task ownership changes.** Information-gathering tasks are owned by the **agent**, which must
  obtain the information by asking. They are no longer "assigned to the student" as work items.
  Only handoff and authorisation are student-owned.
- **A new type, `ProposedValue<T>`**, sits between raw model interpretation and confirmed data.
- **A new escalation trigger, `information_unobtainable`** — the agent asked and the student
  genuinely cannot supply it. Discretionary (layer one), not mandatory.
- **The interview engine itself is Phase 2 work**, alongside the canonical profile. This ADR and
  the accompanying domain-model changes only establish the shape it must fit.
- The document vault design is unchanged; the conversation simply becomes a second channel into
  the same extract-then-confirm flow.
