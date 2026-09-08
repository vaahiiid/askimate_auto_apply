# ADR-0089 — A national ID leaves the supported document types, and its gates leave with it

**Status:** **Accepted** — decided by Vahid Mohammadi, 2026-09-08
**Supersedes:** [ADR-0088](./0088-the-schedule-1-document-must-exist-before-the-processing.md) §1 ·
**amends** [ADR-0087](./0087-the-four-lawful-basis-determinations.md)'s Article 9 scope. Neither
decision was wrong; both were about a document type that is no longer in scope.

## Context

ADR-0087 put a national identity card in scope under Article 9(2)(a). ADR-0088, one phase later,
refused it at the storage gate because the DPA 2018 Schedule 1 appropriate policy document its
processing requires does not exist. Vahid, reading the result:

> Passport is sufficient for identity. Keeping a document type that is refused at the gate means
> carrying a determination, an Article 9 condition, a consent flow and a policy-document gate for
> something no student can use. **That is unreachable surface with a policy justification attached,
> which is the shape this repository has spent nine phases removing.**

That is the argument, and it is stronger than the one ADR-0088 acted on. A refusal at the gate is
still a gate: it has a determination behind it, a consent interface in front of it, an error class,
a register, a test suite and a paragraph in four documents. All of it for a type nothing can store.

## Decision

**`national_id` leaves `DocumentType`.** With it go the Article 9 clause on determination 1
(`article9`, `article9Required`), the separate-consent gate (`SpecialCategoryConsent`,
`SpecialCategoryConsentMissingError`), the two `determineLawfulBasis` refusals that read
`article9Required`, and the whole Schedule 1 module (`appropriate-policy.ts`,
`APPROPRIATE_POLICY_DOCUMENTS`, `requireAppropriatePolicy`, `PolicyDocumentCleared`).

`assertStorable` is back to **two** gates, and no longer takes a clock — that parameter existed only
so a test could put a policy document on either side of its review date.

## What was removed, and why it was built — so re-adding starts from the reasoning

Vahid: *"The determination was correct; it is the document type that is out of scope, not the
thinking."* What follows is the record that makes re-adding a resumption rather than a restart.

**The Article 9 determination (ADR-0087, 2026-09-08).** Some national ID cards carry religion or
ethnicity on their face. **ADR-0077 does not cover that**, and the distinction is exact: that
decision made a special-category *field* unextractable, and holding the image is processing the data
whether or not anything reads it. So the card needed an Article 9 condition as well as an Article 6
basis: **Article 9(2)(a), explicit consent, asked separately at the point of upload.**

**Why consent worked there when it fails for the activity as a whole.** Consent is not the Article 6
basis for storing or disclosing, because a student who cannot get their application submitted
without agreeing has not freely given anything (ADR-0022). The Article 9 consent escaped that
because **the student had a passport as an alternative, so the choice was real.** ADR-0087 recorded
that a route accepting only a national ID would invalidate the determination. It is also, read
today, the reason the removal costs nothing: *the alternative that made the consent honest is the
same passport that makes the type unnecessary.*

**Why the condition was scoped to one type rather than flagged on the determination.** A flag would
have made the passport carry a condition it does not need, and a consent asked without cause is not
caution — it is a request the student cannot refuse without losing something, which is the bundled
consent the determination exists to avoid.

**The consent gate's three checks.** Present, **asked separately**, and **records its wording** —
ADR-0079's rule in a second place, because *"they consented"* without the words is evidence of
nothing.

**The Schedule 1 gate (ADR-0088).** DPA 2018 Schedule 1 requires an appropriate policy document to
exist **before** the processing. `held` was deliberately not a boolean: it demanded a reference, a
named confirmer and two dates, so that re-enabling was a deliberate act with somebody's name on it.
A `held` entry past its review date was treated as outstanding, because a `held` entry is minted by
no function and printed by no report, so a lapse nobody checks at the gate is a lapse nothing checks.

**The expiry threshold (ADR-0079).** A national ID warned at **three months** — determined on the
same principle as the passport's six: *the threshold is the time a student needs to obtain a
replacement*, and a national ID is usually renewable in-country in weeks, with the student often
there.

## Re-adding it requires the Schedule 1 document first

**The constraint did not go away because the code did.** A national identity card is Article 9
processing, and Schedule 1 wants the appropriate policy document to exist *before* that processing
begins, not alongside it. It is the DPIA owner's, and it is blocker 8.

The order, and the last step is what makes the rest live:

1. the DPA 2018 Sch. 1 appropriate policy document exists, held by a named person;
2. determination 1 regains its Article 9 clause, scoped to that type;
3. the separate-consent gate is rebuilt (present · asked separately · wording recorded);
4. `national_id` re-enters `DocumentType`.

That order is written **at the union itself**, not only here, because a comment at the line somebody
edits is the one that gets read.

## What was checked before deleting, and what would have stopped it

Vahid: *"If removing it would lose a control that also protects something else, stop and tell me
before deleting, the same way you did with the research build."* The check was made and nothing
qualified. What was examined:

| | verdict |
|---|---|
| **ADR-0077's special-category FIELD guarantee** | Untouched. `FIELD_CATEGORY` is total over the *profile registry* and a plan may only name an `ordinary` key. Nothing there references a document type, and no extraction plan reads a national ID (`PLANS` covers passport, bank statement, academic transcript) |
| **The minors gate, `suggestsMinority`, `checkMinorGate`** | Read `birth_certificate` and dates. No reference |
| **Blueprints, mappings, catalogue entries, discovery fixtures** | No occurrence anywhere |
| **`article9Required` + the two `determineLawfulBasis` refusals** | Built in P54, for this type, used by nothing else |
| **`SpecialCategoryConsent` and its gate** | Built in P54, for this type, used by nothing else |
| **The Schedule 1 module** | Built in P55, for this type, used by nothing else |

**The one that looked like a loss, and is not.** Deleting the Article 9 apparatus appears to leave a
future special-category document type ungated. It does not, because an **older and broader control
stands in front of it**: `DocumentTypeNotCoveredError` refuses any document type no determination
names, and `NoLawfulBasisError` refuses any activity none covers. A new type cannot be stored at all
until somebody writes a determination for it — **which is exactly the moment these gates have to be
rebuilt**, and this ADR is what they will read. The apparatus was never the thing keeping an
unruled-on type out; absence of a decision was, and still is (ADR-0023).

`Article9Condition` and the optional `article9` field **stay**, because ADR-0022 names them as part
of the determination's shape and they predate all of this by fifty-four phases. Their doc comment now
says plainly what they are: **a record, not a control.** Nothing validates them and nothing acts on
them — which was true before P54 too, and is the kind of thing that has to be written down rather
than inferred.

## What removing it found

**`retention-status.ts` was casting, not checking.** The schedule parser read
`policy["documentType"] as DocumentType` — which accepts *any string in the file* and types it as a
lie. A schedule naming a document type the system does not have would have loaded, validated, and
been reported as a configured period, and nothing would have said so. Removing a union member is
precisely the case a cast cannot see, and it is the tenth consecutive phase to turn up a record
asserting something production does not do.

`DOCUMENT_TYPES` is now the union as values, written as `satisfies Record<DocumentType, true>` rather
than as an array, because `satisfies readonly DocumentType[]` would only check that each *entry* is a
member — a member left out would compile and the check would silently stop covering it. That is the
idiom `FIELD_CATEGORY` and `EXPIRY_THRESHOLDS` already use.

## The determination that is now moot, and the record that is not edited

`config/retention/v1.2026-09-07.json` carries **`AAS-RET-B1-02`**: 365 days from `last_used` for a
national ID, one of the eleven periods Vahid determined and approved by name on 2026-09-07.

**The file is not edited.** That determination did not become *wrong*, it became *moot* — the same
distinction this ADR draws about the Article 9 determination — and an approved schedule version is a
record, superseded rather than rewritten, which is what `validateHistory` exists for. Editing it
would falsify a correct record; superseding it would need an approval nobody has given for a period
nobody is changing.

So the row is **reported**. `pnpm run retention-status` prints a section — *"Determined, and now out
of scope"* — naming the policy reference, the version and the reason. Dropping it silently would have
lost the fact; refusing to load it would have made a correct historical record unreadable.

## Verification

Three deliberate regressions, each verified by reading the mutated file back from disk and each
restored from a file copy: putting `national_id` back into the union fails **3** tests including the
schedule report; restoring the parser's cast fails **2**; slipping the type back into determination
1's scope fails **3**, across both packages.

Writing the second of those found a **vacuous test of my own**: an assertion that the report contains
no `✓ national_id` row passed with the cast restored *and* with the check in place, because
`national_id` is not in `PAIRS` and the two code paths print the same table for it. A demonstration
that cannot fail is not evidence (ADR-0072), so it was replaced with a fixture naming an invented
document type, which fails when the cast comes back.

**The declared-but-unreachable surface is unchanged at seven**, and the change is subtractive: the
Schedule 1 gate and the Article 9 gate lived inside `assertStorable`, whose register entry already
said it has no production caller, so removing them removes machinery rather than a register row.

Reversing this requires a new ADR that supersedes it — and the Schedule 1 document first.
