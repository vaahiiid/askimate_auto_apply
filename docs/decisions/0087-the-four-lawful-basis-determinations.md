# ADR-0087 — The four lawful-basis determinations, and the condition a national ID needs

**Status:** **Accepted** — determined by Vahid Mohammadi, 2026-09-08 · **review by 2027-09-08**
· **the Article 9 scope is amended by
[ADR-0089](./0089-national-id-leaves-the-supported-document-types.md)**

> **The four determinations stand.** What changed the same day is that `national_id` left the
> supported document types, so determination 1 covers a passport alone and its Article 9(2)(a)
> clause has no type to apply to. *The determination was correct; it is the document type that is
> out of scope, not the thinking* — which is why ADR-0089 records the Article 9 reasoning in full
> rather than deleting it, and why re-adding the type starts from here.
**Answers:** B2, the last policy blocker on documents, open since P31 and named in
[ADR-0022](./0022-documents-are-stored-only-with-a-registered-lawful-basis.md)

## Context

ADR-0022 said a named person must determine and register a lawful basis for each storing and
disclosing activity, and named nobody. ADR-0068 made the claim true — `assertStorable`'s branded
result is the only thing `store` accepts, so an implementation cannot skip the gate — and the gate
then refused everything, because the register was empty. ADR-0078 closed B5 and B1 and recorded that
**B2 was the only policy blocker left**.

## The four determinations

All four: determined by **Vahid Mohammadi**, **2026-09-08**, review **2027-09-08**.

| # | activity | Article 6 | student authorisation |
|---|---|---|---|
| 1 | Storing identity documents | **(1)(b) contract** | not required |
| 2 | Storing academic documents | **(1)(b) contract** | not required |
| 3 | Disclosing a document to an institution | **(1)(b) contract** | **required** |
| 4 | A minor's route | **(1)(a) consent**, from the parent or guardian | **required** |

## Why consent is deliberately not the basis for 1, 2 and 3

This is the part that matters, and it is ADR-0022's own reasoning acted on rather than restated.
Vahid, 2026-09-08:

> Consent must be freely given, and a student who cannot get their application submitted without
> agreeing has not freely given anything. A record claiming consent in that situation looks like
> compliance and is not. Contract is both the honest description and the stronger position.

`determineLawfulBasis` has refused `consent` + *"no authorisation needed"* since P31 as a
self-contradiction. These three avoid the trap by not naming consent at all. **Determination 4 names
it and requires authorisation**, and there the consent is real: a guardian who declines is not a
student who loses their application, they are a case that does not proceed down this route.

## Storing and sending are different acts

Determination 3 carries the same Article 6 basis as 1 and 2 **and** requires specific student
authorisation. Vahid: *"Storing a document and sending it are different acts."*

The preview a student reads (ADR-0059), the authorisation text, and the content hash that binds the
authorisation to exact content (ADR-0057) were all built for this. Until now nothing said they had to
be used. **This determination registers them as required, not optional.**

## A national identity document needs a condition, not just a basis

> Some national ID cards carry religion or ethnicity on their face. ADR-0077 made extracting those
> fields impossible, but holding the image is still processing the data, whether or not anything
> reads it. — Vahid, 2026-09-08

**ADR-0077 does not cover this, and the distinction is exact.** That decision made a special-category
*field* unextractable: `FIELD_CATEGORY` is total over the profile registry, and a plan may only name
a key classified `ordinary`. None of it touches the bytes of an image sitting in a vault.

So: **Article 9(2)(a), explicit consent, asked separately at the point of upload** — and the reason
consent works *here* when it fails for 1, 2 and 3 is written into the determination so it cannot
outlive its justification: **the student has a passport as an alternative, so the choice is real.**
If that ceases to be true — a route that accepts only a national ID — the determination must be
revisited before it is relied on again.

**A passport needs none of this.** That is why the requirement is a **subset of the document types
inside one determination** rather than a flag on it. A flag would make the passport carry a condition
it does not need, and a consent asked without cause is not caution: it is a request the student
cannot refuse without losing something, which is the bundled consent the whole determination avoids.
A global table over every document type was also rejected — it would have to say something about the
twelve types nobody ruled on, and inventing *"not required"* for them is the false record ADR-0023
refuses.

## What is enforced, not merely recorded

- `assertStorable` now runs a **third** gate: a document type the determination lists under
  `article9Required` cannot be stored without a `SpecialCategoryConsent` that was **asked
  separately** and **records its wording** — ADR-0079's rule in a second place, because *"they
  consented"* without the words is evidence of nothing.
- `determineLawfulBasis` refuses a determination that names types needing a condition and names no
  condition, and one that requires a condition for a type outside its own scope.
- `b2Register` validates all four on the way in and **throws rather than returning a partial
  register**: one that silently dropped a failed determination would let storage proceed on a basis
  nobody checked.

Four deliberate regressions, each verified from disk: removing the Article 9 gate fails four tests;
giving the passport a condition fails two; naming consent for determination 1 makes the whole
register unbuildable through the check that already existed; requiring a condition without naming one
fails four.

## What this does NOT do — measured, not assumed

**Ten of seventy (document type, purpose) pairs now pass both gates**, against none before. The
refusals were counted rather than described:

| reason | pairs |
|---|---|
| `RetentionPolicyMissingError` — no policy configured, because the pair is not a real combination | 58 |
| `RetentionRequirementUnresolvedError` — the bank statement, B1 row 12 | 1 |
| `NoLawfulBasisError` — a policy exists and no determination does | 1 |

**`financial_evidence` has no determination on purpose.** The bank statement is out of scope and
blocking under ADR-0021, and ADR-0079 refused it an expiry threshold for the same reason. Absence of
a decision is not permission: `assertStorable` throws.

**The one to look at is `other / audit_evidence`** — B1 row 5, six years from `case_concluded`. It has
a retention policy and no storage determination, because the audit record is the transmission record,
the preview hash and the authorisation text (ADR-0077), not an uploaded document. Storing a *document*
under that purpose is therefore refused. That is probably right and it is **not** something this
repository should decide: recorded as an open question.

**The vault does not open.** What remains is not a decision: there is no transport by which bytes
arrive, no `DocumentStore` implementation, and no deployable holding a vault. And blocker 8 — the
DPA 2018 Sch. 1 **appropriate policy document** — becomes live rather than hypothetical the moment a
national ID is in scope: it must exist *before* that processing, and registering an Article 9
condition does not satisfy it.

**The declared-but-unreachable surface is unchanged at seven.** Both gates now have their inputs and
neither has a caller; the register's two entries were rewritten to say that the obstacle is no longer
a decision.
