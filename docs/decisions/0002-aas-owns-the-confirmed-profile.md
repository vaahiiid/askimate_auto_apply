# ADR-0002 — AAS is the system of record for the confirmed profile

**Status:** Proposed · awaiting Vahid's approval
**Date:** 2026-08-26
**Detail:** [Phase 0 · Deliverable 2 §2](../phase-0/02-integration-contract-proposal.md)

## Context

Product rule 3: *extract, then confirm, then store — only confirmed information enters the
profile.* Product rule 6: *minors are detected from date of birth.*

The inventory found that `askimate_users.dateOfBirth` is a **nullable, free-text, unvalidated
`TEXT` column**. Nobody confirmed it; nobody validated its format. It may hold `1999-04-02`,
`2 April 1999`, `02/04/99`, or nothing.

AskiMate holds no qualifications, grades, test scores, passport data, financial information, or
documents of any kind. There is very little to share.

## Decision

AAS owns the confirmed profile. AskiMate data enters **only** as unconfirmed `seed_hints`, typed
distinctly from confirmed fields so no code path can conflate them. The date-of-birth hint is
named `date_of_birth_raw` to make its status unmissable at every call site.

Every seed hint must pass the extract → confirm → store flow before it is usable. Email is
re-confirmed specifically as *the official application contact* (rule 7), which is a different
consent from verifying it for login.

**If a date of birth cannot be parsed unambiguously, AAS asks. It never assumes the student is
an adult.**

## Consequences

- AAS correctness becomes independent of AskiMate data quality. AskiMate can change its schema
  freely without risking a wrong application submission.
- The parental-consent safeguard cannot be skipped by an unchecked or ambiguous field.
- Some duplication of name/email between the systems. Accepted deliberately: they are different
  facts serving different purposes, not one fact stored twice.
- Phase 2 must build the entire canonical profile from zero. No reuse. Budget accordingly.
