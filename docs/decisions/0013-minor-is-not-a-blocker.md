# ADR-0013 — Minor is not a blocker; minor conditions are stage-scoped

**Status:** **Accepted** — Vahid's correction, 2026-08-26
**Supersedes:** the gate design in [ADR-0011](./0011-minor-detection-and-the-minor-workflow.md)
(detection and the "never assume adult" safety property are unchanged)

## What I got wrong

ADR-0011 implemented `checkMinorGate` as an unconditional gate: a case involving a minor could not
advance until *every* determined condition was satisfied and verified.

That is wrong, and Vahid has corrected it:

> Universities can accept applications from students who are under 18. The fact that a student is a
> minor does not by itself mean that the application cannot proceed. […] **Minor ≠ automatic
> blocker.**

My version blocked at the first gate rather than at the point of actual need. In practice it would
have stopped a perfectly valid application from even starting while waiting for documentation that
the university may not want until much later, or at all.

## Decision

Minor status is **detected and recorded**, and it changes what the system watches for. It does not
by itself stop anything.

Every minor-related condition carries the **application stage at which it becomes required**. The
gate is evaluated *per stage*: a case proceeds normally until it reaches a stage that actually has
an outstanding condition, and pauses only there.

```
  intake → profile_collection → document_collection → eligibility
    → preparation → authorisation → submission
```

- A condition required at `submission` does not block `preparation`.
- A condition required at `document_collection` blocks there and stays blocking afterwards, because
  a stage's requirements do not stop applying once it is passed.
- Where the university requires nothing extra at the current stage, the workflow continues normally.

When a stage does need something, the agent **asks for it conversationally** like any other missing
information (ADR-0007) — it is not a form handed to the student, and not a wall.

## The one judgement call in this, flagged for confirmation

**What should happen if, by submission, we still could not determine what the university requires
for a minor?**

Vahid's instruction covers "requirements determined" and "nothing additional required". It does not
say what to do when determination itself fails at the final step.

**My reading, implemented:** an undetermined condition set does **not** block the early stages — the
application starts and progresses normally while determination is in flight. It **does** block
`submission`, where the case pauses and escalates to a specialist.

The reasoning: submitting a minor's application without knowing whether consent or guardian
documentation was required is the one point where not knowing can actually harm the student. That
is not "blocking because they are a minor" — the application ran normally throughout — it is
pausing at the single moment where the unknown becomes consequential, which is exactly the recovery
pattern in ADR-0008.

If you would rather it submit regardless, say so and I will change it. It is a one-line change now.

## What is unchanged from ADR-0011

- The identity / date-of-birth check.
- **The system never concludes "adult" from absent, unparseable, or merely stated evidence.**
- Conditions are **determined, never assumed** — no hardcoded parental-consent requirement.
- Anything involving a minor remains a mandatory human review trigger (brief §2.5).
- "Collected" is still not "verified".

## Consequences

- A 17-year-old's application starts, progresses and can be prepared exactly like anyone else's.
- The system pauses only where a real, determined requirement bites.
- Conditions can attach to any stage, so a university that wants guardian details only at
  submission is modelled as naturally as one that wants them upfront.
