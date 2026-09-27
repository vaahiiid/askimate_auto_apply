# Decision sheet — B2 determination 5: storing a CV (row 97)

**Status:** DRAFT, for Vahid Mohammadi's signature. Not in force. Drafted 2026-09-27 (P236) at his
instruction, from his reasoning below. The same text is `STORE_CV_DRAFT` in
`packages/disclosure/src/b2-determinations.ts`, deliberately NOT in `B2_DETERMINATIONS`, so that
what he signs is exactly what the code will enforce.

**Signature:** he reads it and signs it in his own words, the same as an entry (ADR-0118). Nothing
below is his decision until he does.

## His reasoning, 2026-09-27

> *"A CV is offered by the student, not demanded by a portal. Nobody's application is refused for
> not having one; it is a convenience we offer so they do not have to type what they have already
> written down. That is a different thing from a passport we must hold because a university
> requires it, and it should have its own determination rather than being folded into the
> academic one."*

> *"And it should say what the academic determination does not need to: that the student can
> complete every application without ever giving us one."*

## The determination, as drafted

| Field | Value |
|---|---|
| Determination | `b2-5-store-cv` |
| Activity | `store_document:cv_section_filling` — its own purpose, so the academic determination's scope is not widened |
| Document type | `cv`, and nothing else |
| Article 6 basis | 6(1)(b), performance of a contract. Consent is deliberately not the basis, for the reason on determination 1 |
| Purpose | Filling in the sections of the student's applications that list their jobs and qualifications, from what they have already written down — and nothing else. The CV is not sent to any university under this determination; disclosure is determination 3, and a CV is not in its scope |
| Retention | One year from the last use (ADR-0148 §10; retention schedule version 3 will carry the policy under this purpose) |
| Deletion | On the student's request, made in the conversation in their own words, at any time. The document is purged; the details they confirmed from it stay unless they ask for those too, and they are told so |
| What the academic determination need not say | The student can complete every application without ever giving us a CV: by answering the questions by hand, or by leaving a section empty (ADR-0148 §3) |
| Student authorisation required | No — storage is not disclosure |
| Review | Twelve months after signature |

## What moves when he signs, in one phase

1. `cv_section_filling` joins `RetentionPurpose`.
2. Retention schedule version 3 supersedes version 2, carrying the CV's policy under
   `cv_section_filling`. Version 2 carried it under `application_submission`; nothing was ever
   stored under it, because no determination covered a CV.
3. `STORE_CV_DRAFT` becomes `STORE_CV`, joins `B2_DETERMINATIONS` with his name and his date, and
   the register carries it. `assertStorable` then admits a CV, and the documents panel's offer of
   one stops being an offer the gate refuses.

## Signed

_Not yet. His words, dated, go here — quotable verbatim._
