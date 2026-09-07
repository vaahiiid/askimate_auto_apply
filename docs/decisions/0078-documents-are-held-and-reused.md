# ADR-0078 — Documents are held and reused, and the twelve periods are set

**Status:** **Accepted** — decided by Vahid Mohammadi, 2026-09-07
**Answers:** [decision sheet B5](../decision-sheet-b5-hold-or-pass-through.md) ·
[decision sheet B1](../decision-sheet-b1-retention-periods.md) — all twelve rows
**Completes:** [ADR-0010](./0010-policy-driven-document-retention.md) — the mechanism shipped in
August with nothing configured; this configures it
**Continues:** [ADR-0067](./0067-aas-obtains-holds-and-transmits-documents.md) ·
[ADR-0077](./0077-two-determinations-made-structural.md)

## Context

Two blockers had stood since the document-handling boundary was established: **B5**, whether AAS
holds documents or passes them through per attempt, and **B1**, the twelve `(document type, purpose)`
retention determinations. Both were founder decisions. Both are now answered.

## Decision 1 — B5 is A: hold and reuse

> Documents are stored in the vault and reused. We never ask a student for the same document twice.
> The reason is the product's core mechanic, not convenience: fill-once, apply-to-many is what the
> business plan sells as the switching cost, and a per-attempt pass-through would destroy it.

The options document recommended A on engineering grounds — B's saving was unproven and its retry
story was certainly worse. The decision was taken on a stronger ground than either: pass-through is
not a cheaper way to do the same thing, it is a different product.

## Decision 2 — the correction that follows from it

The sheet was written before B5 was answered, and rows 1, 2, 6, 7 and 8 said *30 days after
`submission_confirmed`, delete*. That contradicts holding and reuse: **a student applying to a second
university two months later would be asked to upload again.** All five move to the trigger row 3
already used.

> A student's purpose is alive for as long as they are still applying. Twelve months of no use is
> the point at which it is not.

This is why `last_used` matters and is now the trigger for every reusable document. Two triggers were
added to the vocabulary because two rows could not otherwise be written down: `age_established`
(row 9 — the *determination* is kept, the certificate is not) and `case_concluded` (rows 5 and 10,
which run from the end of the case rather than from a submission that may never happen).

## Decision 3 — the twelve

| # | pair | period | action |
|---|---|---|---|
| 1 | passport · identity_verification | 365d after `last_used` | delete |
| 2 | national_id · identity_verification | 365d after `last_used` | delete |
| 3 | personal_statement · application_submission | 365d after `last_used` | delete |
| 4 | reference_letter · application_submission | 365d after `last_used` | delete |
| 5 | other · audit_evidence | 2190d after `case_concluded` | anonymise |
| 6 | academic_transcript · application_submission | 365d after `last_used` | delete |
| 7 | degree_certificate · application_submission | 365d after `last_used` | delete |
| 8 | english_test_certificate · application_submission | 365d after `last_used` | delete |
| 9 | birth_certificate · minor_safeguarding | 7d after `age_established` | delete |
| 10 | parental_consent · minor_safeguarding | 2190d after `case_concluded` | anonymise |
| 11 | guardianship_document · minor_safeguarding | 365d after `last_used` | delete |
| 12 | bank_statement · financial_evidence | **none — stays unresolved and blocking** | — |

Row 5's reasoning, because it is the one row that carries six years: the audit record is the only
place a legal claim is defensible from, and it holds three things only — the preview hash, the
authorisation text, and the transmission record. No bytes. **Anything else added to that record
inherits six years, so it stays closed.**

Row 12 stays blocking so that a route which *does* require financial evidence stops rather than
silently proceeding (ADR-0021).

Every period is recorded as a `policy_decision` naming Vahid Mohammadi and 2026-09-07. Row 10 is a
policy decision *informed by* Article 7(1) rather than a `legal_requirement`, because the Article
requires demonstrability and does not prescribe a period — claiming otherwise would be a legal
determination this repository is not entitled to make.

## Decision 4 — the deletion cascade

When a document is deleted, everything derived from it is deleted with it: extractions, previews,
working copies, anything carrying its content. **One exception, and only one:** the audit record of
row 5, which survives because it is the only thing that protects us, contains no document content,
and costs a few lines of text and a hash.

**Not implemented.** No vault holds anything, so there is nothing to cascade from. Recorded on the
schedule so the transport phase inherits it as a requirement rather than discovering it.

## Decision 5 — expiry is the student's choice

Every document carrying an expiry date has that date recorded. When it approaches, the student is
warned and chooses: proceed as it is, or upload a new one. If they proceed, that is their decision
and it is recorded **with the exact wording they were shown**.

The threshold belongs to each document type's own rule, not to a single global number — a passport's
threshold cannot be a bank statement's. One rule, per-type thresholds.

**No threshold is configured.** They are to be proposed with reasoning and confirmed before
implementation, and that has not happened. The determination records the rule and explicitly records
that the numbers are absent.

## The two obligations

Recorded as first-class schedule content, cited by the policies they attach to, so that deleting one
while leaving the period that required it fails `validateSchedule`:

- **`tell_the_student_about_the_referee`** (row 4) — one line at upload: the letter contains another
  person's information, and they should make sure the writer knows. No form, no confirmation step,
  no email to the referee. It must not add friction.
- **`read_the_test_provider_terms`** (row 8) — read IELTS, PTE and Duolingo's terms before the first
  real submission; if any is stricter than twelve months, change row 8.

## What this changes, and what it does not

**Schedule version `1.2026-09-07`** is the first that permits storage. Eleven policies, one
unresolved row, five determinations, two obligations.

**A resolved period is not permission to store.** `assertStorable` requires a retention policy *and*
a registered lawful basis for the storing activity (ADR-0022, blocker **B2**), which is still
undetermined. Retention resolved means **one of two gates opened**, and `retention-status` now says
so rather than printing "10 of 10 could be stored today" over a shut door.

## A defect this phase created and had to close

Writing a second schedule version on the same day as the first made two versions effective from the
same instant. `effectiveFor` sorts by `effectiveFrom` descending; a tie keeps input order, which for
the status script is the order the directory listed the files in — so **the superseded version won,
and the report said every row was still unresolved while the schedule that resolved them sat beside
it.** Nothing about either version was wrong, so `validateSchedule` had nothing to say.

`validateHistory` is the check that was missing: no two versions may share an `effectiveFrom`, no two
may share a name, and a version may not supersede one the history does not carry — because *"what
was our retention policy in March?"* must have exactly one answer.

## Consequences

- The retention gate is open for eleven pairs; B2 keeps the vault shut.
- Three of the six declared-but-unreachable capabilities have had their first blocker cleared:
  `assertStorable` and `attach_document` were waiting on B5, `purgeContents` on B1. None becomes
  reachable today — each still needs the transport phase, and `assertStorable` also needs B2 — and
  the register's reasons now say precisely that instead of naming a blocker that is decided.
- The declared-but-unreachable surface is **unchanged at six**.
