# ADR-0077 — Two determinations, made structural rather than written down

**Status:** **Accepted** — approved by Vahid, 2026-09-07
**Answers:** [decision sheet B1](../decision-sheet-b1-retention-periods.md) — the claims question, and
row 2's §5 offer
**Continues:** [ADR-0023](./0023-an-unresolved-requirement-blocks.md) ·
[ADR-0073](./0073-a-declared-capability-with-no-production-caller-fails-the-build.md)

## Context

Decision sheet B1 ended with two things that were written down and enforced by nothing.

**Row 2**, on national identity documents, recommended *"30 days, delete — and a determination that
we do NOT extract or index any special-category field from it"*, and §5 of the same sheet noted that
such a determination *"has to be enforced somewhere in `packages/extraction`, not merely written
down"*.

**The question above the table** — *are we relying on "establishing, exercising or defending legal
claims" as a retention purpose?* — was called *"the single most valuable answer on this sheet"*,
because a yes makes the six-year limitation period the anchor for most rows and roughly triples every
recommended period.

Vahid answered both on 2026-09-07:

> Never extracting special-category fields from a national identity document becomes an enforced
> property of `packages/extraction`, not a written rule. Make it structurally impossible rather than
> checked, in the same way field values cannot originate from the model.

> We do not rely on "establishing, exercising or defending legal claims" as a retention purpose for
> documents. We do rely on it for the audit record — the transmission record, preview hash and
> authorisation text. Record the reasoning: what the student authorised is provable from the record
> without the scan.

## Decision 1 — extraction cannot produce a special-category field

**The profile registry is the boundary of what this system can extract**, and the registry is closed
against unclassified fields.

A document reading enters the system only through an extraction plan target, and every target names a
`ProfileFieldKey`. So the set of things extraction can ever produce is exactly the registry —
extraction cannot produce a religion because there is nowhere for a religion to go. Three things make
that a guarantee rather than an accident:

1. **`FIELD_CATEGORY` is total over `ProfileFieldKey`.** `satisfies Record<ProfileFieldKey,
   DataCategory>` means a field added to the registry **does not compile** until it has been
   classified. Measured, not assumed: adding `identity.religion` fails the build at `categories.ts`,
   naming the missing classification.
2. **A plan may only name an `OrdinaryFieldKey`**, derived from that classification rather than
   maintained beside it. Also measured: with the field added and classified `special_category`, a
   plan naming it fails with `Type '"identity.religion"' is not assignable to type
   'OrdinaryFieldKey'` — at the line where the plan is written.
3. **`undetermined` blocks like `special_category` does.** ADR-0023's rule in this file's terms: the
   honest answer *"nobody competent has decided"* must not be readable as permission. The dangerous
   state is the one that looks decided.

This is the same shape as the mechanism Vahid names. A value cannot originate from the model because
a reading is accepted only against a plan target and its quoted span is checked against the document
(`grounding.ts`). A special-category value cannot be extracted because there is no field for it to
land in, and no field can appear without a classification.

**The guarantee is broader than the determination, deliberately.** Row 2 named the national ID; this
refuses the field on every document type, because a per-type exception would be a hole with no stated
purpose and no document in scope has a reason to yield one (ADR-0021: these are application
requirements, not visa requirements).

**Article 9(1)'s categories are quoted as data**, not paraphrased, so a reviewer can see what the
classification was made against. Applying that enumeration to a *new* field remains a determination
for whoever owns the DPIA — this file does not make legal determinations, and `undetermined` exists so
the honest answer can be recorded and still block.

## Decision 2 — no document period rests on defending legal claims

`RetentionBasis` gains **`reliesOnLegalClaims`**, declared by the author rather than inferred, and
`validateSchedule` refuses it for any purpose but `audit_evidence`.

Declared and not inferred on purpose: a check that searched the basis statement for "Limitation Act"
would miss the period that phrased it differently while feeling like a control.

`RetentionSchedule` gains **`determinations`** — cross-cutting answers with a determiner, a date and
reasoning. Several unresolved entries name the same open question, and answering it in twelve places
is twelve chances to answer it twelve ways. A policy that declares `reliesOnLegalClaims` must be
accompanied by the determination that permits it, so the record of who allowed it cannot live
nowhere.

The reasoning, recorded because Article 5(2) makes the period ours to justify: **what the student
authorised is provable from the record without the scan.** The preview hash says what was put in
front of them, the authorisation text says what they agreed to, and the transmission record says what
was actually sent. A passport scan adds nothing to that proof and would hold the highest-consequence
data this system could own for six years in order to evidence something already evidenced.

Schedule version **0.2026-09-07** records the determination and supersedes 0.2026-08-26. **It sets no
period.** All twelve rows remain unresolved.

## What this deliberately does NOT do

- **It does not answer any of the twelve rows.** A determination is not a period. Rows 4, 8, 9, 10
  and 11 — the two third-party rows and the three children's rows — are explicitly still with Vahid
  and the DPIA owner, and B5 is untouched.
- **It does not narrow `applyConfirmation`.** The same constraint at ADR-0004's single mint point was
  written and reverted: it changes generic inference for every caller and required rewriting
  unrelated tests, for a guard that is vacuous there today. Recorded as measured rather than left
  looking unconsidered.
- **It does not classify a field as special-category.** None exists. The mechanism was proved by
  adding one, watching the build refuse it, and removing it again — inventing a product field to
  exercise a control is how a control ends up guarding something nobody wanted.

## Consequences, including an uncomfortable one

- A new profile field cannot be added without a classification. That is the day this bites, and it is
  the day that matters.
- A retention schedule cannot quietly anchor a document to the limitation period, and a schedule that
  omits the declaration is treated as suspect rather than as consent — the reader defaults to `true`,
  measured by watching the other default let a 2,190-day passport period through in silence.
- **`packages/extraction` is in no deployable's dependency closure**, so decision 1 constrains code
  that does not currently run. It is compile-time, so it holds whenever the package is built and will
  already hold on the day extraction is wired to a deployable — but it is not guarding a live path
  today, and saying otherwise would be the kind of claim ADR-0073 exists to catch. The half that IS
  in a shipped package is the registry classification, in `packages/profile`, which every deployable
  that touches a profile compiles.
- The declared-but-unreachable surface is **unchanged at six**. Nothing here is a runtime capability
  waiting on a caller: decision 1 is a type, and decision 2's checks run in `validateSchedule`, which
  `pnpm run retention-status` and its tests exercise.
