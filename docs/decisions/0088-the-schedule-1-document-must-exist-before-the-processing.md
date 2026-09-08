# ADR-0088 — The Schedule 1 document must exist before the processing, and a decision not to determine is a decision

**Status:** **Accepted** · **§1 superseded by
[ADR-0089](./0089-national-id-leaves-the-supported-document-types.md)** the same day — decided by
Vahid Mohammadi, 2026-09-08

> **§1 no longer describes the system.** Reading this refusal, Vahid removed the document type
> instead: *"Keeping a document type that is refused at the gate means carrying a determination, an
> Article 9 condition, a consent flow and a policy-document gate for something no student can use."*
> `national_id`, the Schedule 1 gate and the Article 9 consent gate are all gone (ADR-0089). **§2,
> `other / audit_evidence` being decided rather than open, stands unchanged and is enforced.** The
> Schedule 1 requirement itself also stands — it is a fact about the law, not about this code, and
> re-adding the type needs the document first.
**Completes:** [ADR-0087](./0087-the-four-lawful-basis-determinations.md), which registered the Article 9
condition and recorded two things it deliberately did not settle

## Context

ADR-0087 answered B2 and, in doing so, changed the character of two other entries.

**Blocker 8 stopped being hypothetical.** DPA 2018 Schedule 1 requires an **appropriate policy
document** to exist *before* certain special-category processing. Until ADR-0087 there was no such
processing in scope, so the blocker was a note about a future. Registering Article 9(2)(a) for a
national identity card made it live, and the document does not exist.

**One measured pair was left open.** ADR-0087 ran all seventy (document type, purpose) pairs through
both gates and reported `other / audit_evidence` as an **open question**: it has a retention policy —
B1 row 5, six years from `case_concluded` — and no storage determination.

Vahid answered both on 2026-09-08.

## Decision 1 · `national_id` is refused at the gate until the policy document exists

> Disable `national_id` for now. Passport only. The Article 9 determination stays registered and
> correct, but the appropriate policy document must exist before that processing and it does not, so
> the honest position is that the document type is **not yet available** rather than
> available-and-non-compliant.
>
> Make it **structural, not a note**: `national_id` must be refused at the gate with a stated reason
> naming the missing policy document, so re-enabling it is a deliberate act rather than an oversight
> correcting itself. — Vahid, 2026-09-08

### Not yet available, not non-compliant

The distinction is the whole decision. Nothing here says ADR-0087 is wrong: the determination is
made, named, dated and correct. A **different person owes a different document**, and until it
exists the processing has a prerequisite it does not meet.

That is why the record is separate from the determination rather than an edit to it. Folding the
second into the first would mean editing somebody's determination to express a fact about somebody
else's unfinished work — and would make re-enabling read as a *correction to the determination*
rather than as what it is: a different person finishing a different thing.

### `held` is not a boolean

`AppropriatePolicyDocument` is a discriminated union. `outstanding` names the requirement, who holds
it and why the processing is blocked. `held` demands a **reference, a named confirmer, a date and a
review date** — the shape a lawful-basis determination and a retention policy already require, for
the same reason.

A `satisfied: false` becomes `satisfied: true` in one keystroke, by anyone, with no record of what
was relied on. This cannot: re-enabling the type means writing down which document, who confirmed it
and when. *"Re-enabling it is a deliberate act"* is the requirement, and a boolean does not meet it.

### What runs, and in what order

`assertStorable` now has **four** gates, not two:

| # | gate | refuses with |
|---|---|---|
| 1 | a configured retention policy (ADR-0010, ADR-0023) | `RetentionPolicyMissingError` · `RetentionRequirementUnresolvedError` |
| 2 | a registered lawful basis for the storing activity (ADR-0022) | `DeterminationDecidedAgainstError` · `NoLawfulBasisError` · `DocumentTypeNotCoveredError` |
| 3 | the Schedule 1 appropriate policy document, where the type needs one | `AppropriatePolicyMissingError` |
| 4 | the separate Article 9 consent, where the type needs one (ADR-0087) | `SpecialCategoryConsentMissingError` |

Gate 3 runs **before** gate 4 deliberately. If the consent check came first, a developer would be
told to record a consent, record one, and hit this wall on the next run — two rounds to learn that no
consent helps. The missing thing is not the student's to give.

Gate 3 is keyed on the **document type**, not on the determination, because it is a prerequisite of
the processing rather than a property of the decision. A type absent from the register needs no such
document, which is the ordinary case; the passport is deliberately absent, and listing it as
`outstanding` would refuse it for a prerequisite it does not have.

`StorableUpload` carries the branded `PolicyDocumentCleared` that `requireAppropriatePolicy` alone
can mint, so a later edit cannot drop gate 3 and still assemble the object.

### One staleness rule that looks inconsistent, and is not

`assertStorable` deliberately does **not** re-check a determination's or a policy's `reviewBy`:
`determineLawfulBasis` refuses a lapsed determination when it is made, and `pnpm run retention-status`
reports a stale schedule. It **does** check the policy document's, and the difference is that there
is nowhere else it could be. A `held` entry is a plain record — minted by no function, printed by no
report — so a lapse nobody checks here is a lapse nothing checks at all.

## Decision 2 · `other / audit_evidence` is **decided**, not open

> `other / audit_evidence` stays refused. That is correct, not a gap: the audit record is the
> transmission record, the preview hash and the authorisation text, not an uploaded document.
> Allowing a document to be stored under that purpose would extend the six-year period from a
> receipt to a passport scan, which is what ADR-0078 was written to prevent. Record it as decided,
> not open. — Vahid, 2026-09-08

The period is carried by the **purpose**. The same passport remains storable under
`identity_verification` for 365 days after last use; it is *this purpose* that must not accept one,
because a document admitted here would be held for six years by the retention rule doing exactly what
it was told. B1 row 5's own basis statement already said so — *"anything else added to that record
inherits six years, so it stays closed"* — and nothing enforced it.

### Why this needed more than a paragraph

The lawful-basis side had one refusal for two different facts. `NoLawfulBasisError` said *"no lawful
basis has been determined"* both for an activity awaiting a decision and for an activity **whose
decision is this refusal**. A later phase reading the second as the first would close it by
registering a determination — which is the outcome the decision was made to prevent.

The retention side has had this distinction since ADR-0023: `RetentionPolicyMissingError` means
nobody looked, `RetentionRequirementUnresolvedError` means somebody looked and could not responsibly
say. `DECIDED_NOT_TO_DETERMINE` gives the lawful-basis side the same third state, carrying the
reasoning, the name and the date — and, in the refusal text a person actually reads, the sentence
**"Do not close this by registering a determination."**

`financial_evidence` is the control: it has no determination and no decision against one, because
row 12 is out of scope and blocking (ADR-0021, ADR-0079), and it must keep reporting an *absence*.
The distinction only means something while both states exist, and a test holds it there.

## What was measured, not asserted

- **Five deliberate regressions**, each verified by reading the mutated file back from disk and each
  restored from a file copy: removing gate 3 fails 5 tests; flipping `national_id` to `held` with no
  real document fails 9; removing the decided-against check fails 3; moving gate 3 behind gate 4
  fails exactly the one ordering test; ignoring the policy document's review date fails 3.
- **The pair count is unchanged at ten of seventy**, and that is the honest number: `national_id`
  never passed gate 4 in ADR-0087's measurement either, because the Article 9 consent is not part of
  a (type, purpose) pair. What changed is *why* it is refused and *who* can change it.

## A staleness this phase found in its own output

`pnpm run retention-status` closed its summary with *"a registered lawful basis for the storing
activity (ADR-0022, blocker B2), which this report does not read and which is **NOT yet
determined**."* That sentence became false on 2026-09-08 — one phase before this one, by the change
that answered B2. A report telling a reader a decision is outstanding after it has been made is the
same false record this repository has now found in nine consecutive phases, and it was produced by
the fix for the previous one. It now names the four gates, says B2 is determined, and says which
prerequisite is outstanding; a test asserts the old phrase is gone.

## What this does NOT do

**The vault still does not open**, and nothing here is what is stopping it. There is no transport by
which bytes arrive, no `DocumentStore` implementation and no deployable holding a vault — none of
which is a decision. **The declared-but-unreachable count is unchanged at seven**: gate 3 is part of
`assertStorable`, whose register entry already says it has no production caller, and adding a second
entry for one of its four checks would answer the register's question at a granularity it does not
work at (ADR-0082's rule).

**Blocker 8 is not closed by this ADR.** It is made structural and given an owner in code. It closes
when the DPIA owner produces the document and somebody records it as `held`, with a reference and
their name.

Reversing either decision requires a new ADR that supersedes this one.
