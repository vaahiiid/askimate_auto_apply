# ADR-0010 — Policy-driven document retention, with no default

**Status:** **Accepted** — Vahid's decision, 2026-08-26
**Answers:** Phase 0 Open Question 5 — how long do we keep a passport scan

## Decision

Vahid:

> Follow applicable ICO / UK data-protection requirements and the principle of keeping personal
> data only for as long as necessary. **Do not invent a fixed retention period simply because we
> need a number for the schema.** Design the document vault so that retention periods are
> configurable and policy-driven, with the ability to apply different retention rules to different
> document types and purposes. The exact retention schedule should be finalised based on the
> applicable ICO requirements and our documented data-retention policy before production.

So retention is **configuration, not code**. A `RetentionPolicy` is looked up by
`(documentType, purpose)` and supplied from the deployment's retention schedule.

## The design decision that matters most

**There is no default retention period, and absence of policy is not permission to keep.**

If no policy is configured for a document type, the vault **refuses to store it.** It does not fall
back to "keep indefinitely."

This is deliberate and it is the whole point. "Keep forever because nobody configured it" is the
characteristic UK GDPR failure — data minimisation and storage limitation are breached silently, by
omission, and nothing in the system ever complains. Making an unconfigured type *fail loudly at
storage time* means the gap surfaces in development, where it costs an afternoon, rather than in a
subject access request or an ICO enquiry.

## What a policy carries

- **Retention trigger** — what starts the clock: submission confirmed, case cancelled, case failed,
  or last use. Different documents legitimately start from different events.
- **Duration** — how long after the trigger.
- **Post-retention action** — delete, or anonymise.
- **Legal hold** — an override that suspends deletion (dispute, investigation), recorded with a
  reason and an owner so a hold cannot become permanent by neglect.
- **Erasure behaviour** — what a right-to-erasure request removes, and what must survive it.

## Erasure and the audit trail

Brief §8 already requires that audit records reference **document IDs, not document contents**.
That is what makes erasure workable: the object is deleted from the vault while the audit trail
keeps the ID and a content hash. The case can still answer "which document was used here, and was
it the one the student confirmed?" without retaining the personal data itself.

⚠️ **To be confirmed before production** whether that division satisfies our legal position. It is
the design that makes both requirements satisfiable at once, but the legal question is Vahid's,
per brief §12.10, and does not block Phase 2.

## Consequences

- The retention schedule can be finalised against ICO guidance without touching code.
- Different document types can have genuinely different rules, which they will need — a passport
  and a bank statement are not the same retention question.
- An unconfigured document type is a loud failure, not a silent indefinite hold.
- Retention becomes reviewable: the schedule is one artefact, in one place, that a
  data-protection review can read.
