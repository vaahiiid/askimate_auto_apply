# Decision sheet — B1: the twelve retention determinations

**For:** Vahid · **Prepared:** 2026-09-06 · **Answerable as a table**
Background: [`retention-analysis.md`](./retention-analysis.md) ·
[ADR-0010](./decisions/0010-policy-driven-document-retention.md) ·
[ADR-0023](./decisions/0023-an-unresolved-requirement-blocks.md)

---

## How to use this

Twelve `(document type, purpose)` pairs are recorded in the retention schedule as **unresolved**, and
each one blocks its document from ever entering the vault. That is the designed state, not a fault:
`validateSchedule` refuses placeholder bases (`"TODO"`, `"TBC"`, `"unknown"` and a dozen others), and
a `legal_requirement` whose statement is under twenty characters is refused outright — *a legal
requirement we cannot state is one we have not read.*

**Answer the last two columns.** Where you disagree with my recommendation, say the period you want
and one sentence of reasoning; that sentence becomes the `justification` field, which is what the
schedule stores and what a subject access request eventually surfaces.

**Confidence key.** **High** = I have read the constraint and it is unambiguous. **Medium** = the
principle is clear, the period is a judgement. **Low** = I am guessing at a shape and a competent
person must decide. No row here is legal advice.

---

## Before the table: one decision that moves most of it

> **Are we relying on "establishing, exercising or defending legal claims" as a retention purpose?**

If **yes**, the limitation period for a contract claim in England and Wales — Limitation Act 1980
s.5, **six years**, and this needs confirming by someone competent rather than taken from me —
becomes the anchor for rows 1–5 and 9–10, and every recommended period below roughly triples.

If **no**, the periods stay as recommended: short, tied to the application outcome.

My recommendation is **no** for documents, **yes** for the audit record. We can defend a claim from
the transmission record, the preview hash and the authorisation text without keeping the passport
scan itself. Keeping the evidence *about* the document is a much smaller footprint than keeping the
document. **This is the single most valuable answer on this sheet.**

---

## The twelve

Trigger vocabulary the schedule already understands: `submission_confirmed`, `case_cancelled`,
`case_failed`, `last_used`. Action is `delete` or `anonymise`.

### Group 1 — our own decision under storage limitation

| # | Data category | Why it is held | What bounds it | Recommended | Confidence |
|---|---|---|---|---|---|
| 1 | `passport` · identity verification | The university requires proof of identity with the application | Storage limitation: the purpose ends when the application is decided. Special-category risk is low but it is a strong identifier and a prime breach target | **30 days after `submission_confirmed`**, then `delete`. Same after `case_cancelled` / `case_failed` | Medium |
| 2 | `national_id` · identity verification | Alternative to passport for some nationalities | As row 1, **plus**: some national IDs carry religion, ethnicity or biometric markers on their face, which would be special-category in context | **30 days**, `delete` — and a determination that we do **not** extract or index any special-category field from it | Medium |
| 3 | `personal_statement` · application submission | Part of what is submitted; also what the student authorised | Storage limitation. It is the student's own writing, and reuse across applications is a *product* question, not a retention one | **12 months after `last_used`**, `delete`. Longer than the identity documents because reuse is plausible and the sensitivity is far lower | Medium |
| 4 | `reference_letter` · application submission | Required by some courses | Contains a **third party's** personal data. Article 14 may require telling the referee we hold it, and *what* we tell them is itself unresolved | **30 days after `submission_confirmed`**, `delete` — and a separate determination on referee notification before any reference is accepted | **Low** |
| 5 | `other` · audit evidence | Reproducing what a student authorised, months later | This is the row where defending a claim genuinely applies. But the *evidence* is the preview hash, the authorisation text and the transmission record — not the document | **6 years**, `anonymise` — keep hashes, ids and the presented text; keep **no bytes**. Explicitly reject "keep the document as audit evidence" | Medium |

### Group 2 — the university's or QA Higher Education's requirement

| # | Data category | Why it is held | What bounds it | Recommended | Confidence |
|---|---|---|---|---|---|
| 6 | `academic_transcript` · application submission | Required by essentially every course | The university's own retention duty is **theirs, not ours**. We are not a Student-visa sponsor and must not inherit sponsor record-keeping duties — keeping data longer than *our* purpose needs is the breach, not the safe option | **30 days after `submission_confirmed`**, `delete` | Medium |
| 7 | `degree_certificate` · application submission | As transcript | As row 6 | **30 days**, `delete` | Medium |
| 8 | `english_test_certificate` · application submission | Required for most international applicants | As rows 6–7, **plus** the test provider's own terms (IELTS, PTE, Duolingo) may constrain onward handling and verification — needs reading before the first one is accepted | **30 days**, `delete`, **conditional on** reading the provider terms | **Low** |

### Group 3 — children's data · **flagged, see below**

| # | Data category | Why it is held | What bounds it | Recommended | Confidence |
|---|---|---|---|---|---|
| 9 | `birth_certificate` · minor safeguarding | Establishing age where a course or route requires it | Minimisation says *shorter* for a child. It also names parents, so it carries third-party data | **7 days after age is established**, `delete` — hold the *determination* ("verified 18+ on <date>"), not the certificate | **Low** |
| 10 | `parental_consent` · minor safeguarding | Evidencing that a guardian authorised the application | Pulls the **opposite** way: Art. 7(1) requires being able to *demonstrate* consent, which means the consent record must outlive the processing it authorised | **6 years after the case concludes**, `anonymise` — keep the consent record, not the supporting document | **Low** |
| 11 | `guardianship_document` · minor safeguarding | Proving the consenting adult may consent | As row 10, but it is evidence *supporting* the consent rather than the consent itself | **30 days after `submission_confirmed`**, `delete`; the consent record (row 10) carries the durable evidence | **Low** |

### Group 4 — out of scope, recorded so it blocks

| # | Data category | Why it is held | What bounds it | Recommended | Confidence |
|---|---|---|---|---|---|
| 12 | `bank_statement` · financial evidence | **Not held.** Out of scope for the first UK application — a visa requirement, not a university application requirement ([ADR-0021](./decisions/0021-application-requirements-are-not-visa-requirements.md)) | Recorded as unresolved deliberately, so that a route which *does* require it blocks rather than silently proceeds | **No period — leave unresolved.** Answer it when a route needs it | High |

---

## Where these interact with the DPIA and the Children's Code

**Flagged as you asked. Minors are in scope, so none of this is hypothetical.**

1. **Rows 9–11 are Children's-Code territory, and the two principles genuinely conflict.** Data
   minimisation says hold a child's data for less time; Article 7(1) says hold the *consent record*
   longer so it can be demonstrated. My recommendation splits them — delete the child's documents
   fast, keep the consent record long — but which principle wins is exactly the kind of question
   ADR-0023 says not to answer by assumption. **These three rows should go to whoever owns the DPIA
   before they are set.**

2. **The Age Appropriate Design Code's "data minimisation" and "data sharing" standards bear on row 9
   specifically.** Holding a birth certificate any longer than it takes to record "age verified" is
   the kind of thing the Code is written about.

3. **The outstanding AskiMate DPIA should cover, and currently does not:** whether processing a
   child's application at all triggers a DPIA in its own right (systematic processing of children's
   data at scale generally does); and whether the *transmission* of a minor's documents to a
   university is a separate high-risk processing operation from holding them.

4. **DPA 2018 Schedule 1 appropriate policy document.** Surfaced by the retention analysis and not a
   retention question, but it will block sooner: if any of these documents are handled as
   special-category data — a reference mentioning a disability, a medical reason for deferred entry,
   a national ID carrying religion — an appropriate policy document must exist **before** the
   processing, and it has its own retention rule. This belongs with the ADR-0022 lawful-basis
   determinations.

5. **Row 2 has a hidden dependency on the DPIA**: if we determine that we never extract
   special-category fields from a national ID, that determination has to be enforced somewhere in
   `packages/extraction`, not merely written down. Say the word and I will make it structural.

---

## What I need from you

- The **claims question** at the top: yes or no.
- **A period and one sentence of justification for rows 1–11.** Accepting a recommendation as-is is a
  complete answer; say so and I will record it with your name and the date.
- **Rows 4, 8, 9, 10, 11** are the five I would not set without someone competent looking — the two
  third-party rows and the three children's rows. Tell me whether to route them to the DPIA owner or
  whether you are taking them yourself.
- Row 12 needs no answer. It should stay blocking.

Once rows are answered, they go into the retention schedule with a named determiner and a review
date, `validateSchedule` stops refusing them, and the corresponding document types become storable —
**subject to B5 and to the ADR-0022 disclosure determination (B2), which are separate blockers.**
