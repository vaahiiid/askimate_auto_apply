# ADR-0011 — Identity check, minor detection, and the minor workflow

**Status:** **Accepted** — Vahid's decision, 2026-08-26
**Answers:** Phase 0 Open Question 6 — what the parental consent flow involves
**Related:** ADR-0009 (requirements verification), brief §2.5, §2.6

## Decision

Vahid:

> The system must perform an identity / date-of-birth check. If the student is under 18, the system
> must detect that and enter a dedicated minor workflow. **Do not assume that parental consent is
> automatically the only legal requirement.** […] The exact requirements for minors must be verified
> before production based on the applicable UK data-protection rules, the university's own
> requirements, and the specific application route.

The flow:

```
  Identity check → minor detected → minor-specific requirements DETERMINED
    → required parent/guardian consent or documentation collected
    → verification → continue only when all required conditions are satisfied
```

> If the required conditions cannot be verified or completed, the system must stop and escalate
> rather than assume consent or proceed.

## The load-bearing instruction

**"Do not assume that parental consent is automatically the only legal requirement."**

This rules out the obvious implementation — a `parentalConsent: boolean` on the case. That would
hardcode an assumption about what the law and the university require, which is exactly the kind of
invention this system exists to prevent, in the one area where being wrong involves a child.

Instead, minor requirements are **determined, not assumed** — and determined through the *same*
multi-source verification as any other requirement (ADR-0009). Requirements concerning a minor are
`critical` by definition, so they need **corroboration**: a human-reviewed knowledge-base entry
*and* an official-source check, agreeing and fresh. Nothing less can carry the decision.

The requirement set varies by UK data-protection rules, the university's own rules, and the
application route — so it is resolved per case, not baked into the code.

## Date of birth must be verified, not merely stated

Phase 0 found that `askimate_users.dateOfBirth` is a **nullable, free-text, unvalidated `TEXT`
column**. Nobody validated it; nobody confirmed it. Minor detection cannot rest on that.

So date of birth carries a verification level:

| Level | Meaning | Sufficient to conclude age? |
|---|---|---|
| `unknown` | not captured | **No** |
| `stated` | the student said it; agent interpreted and student confirmed | **No — not for the minor determination** |
| `document_verified` | extracted from an identity document and confirmed | **Yes** |

A student-stated date of birth is enough to *raise a suspicion of minority* and trigger the
identity check. It is **not** enough to conclude the student is an adult and proceed.

### The safety property, stated plainly

**The system never concludes "adult" from an absent, unparseable, or merely stated date of birth.**

Under-18 status is a legal safeguard. Absence of evidence that someone is a minor is not evidence
that they are an adult. Every ambiguous case resolves toward *check further*, never toward
*proceed*. Enforced in the domain, and tested.

There is also a genuine ambiguity, deliberately not resolved here: **under 18 at application, or at
course start?** These differ, and which applies is itself a determined requirement rather than
something to hardcode. The model carries both dates so either rule can be applied once determined.

## Stop and escalate — never assume

If minor requirements cannot be determined, or the required consent or documentation cannot be
collected or verified, the case **stops and escalates**. It does not proceed on an assumption, and
it does not proceed on a partially satisfied set.

Anything involving a minor is already a **mandatory human review** trigger (brief §2.5), which no
confidence score can bypass. This ADR adds a second, independent gate: the determined conditions
must all be *satisfied and verified* before the case can advance, whatever the review said.

## Scope

**Modelled now (Phase 1):** date-of-birth verification levels, the age determination with its
fail-safe direction, the minor condition set, and the hard gate that blocks progress until every
condition is satisfied and verified.

**Built later:** the identity-document extraction (Phase 2), the determination of what UK law and
each university actually require (Phase 4), and the consent collection flow (Phase 5).

**Verified before production:** the actual requirements, per Vahid — applicable UK data-protection
rules, the university's own requirements, and the specific application route.

## Consequences

- The system can detect minority but cannot *proceed* on an assumption about what that requires.
- A misconfigured or under-specified minor policy blocks the case rather than waving it through.
- Deferring minors from the MVP remains available as a product decision — but it would have to be
  an explicit refusal, not a silent mishandling.
