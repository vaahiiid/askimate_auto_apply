# ADR-0118 — The mapping review is one signature, Vahid's, until a developer takes the system over; a single signature admits the signer's own account and nothing else

**Status:** Accepted · 2026-09-16 · amends [ADR-0017](./0017-mapping-is-reviewed-data.md) §1 (the two-person rule on a mapping set) and [ADR-0057](./0057-approval-binds-to-content-not-claims.md) property 4 (the registry enforces it) · changes blocker 2 without closing it
**Decided by:** Vahid Mohammadi, in his own words, 2026-09-16. **Built in P144**, the same day.

## What changed, and why

Until this morning a mapping set reached a run only after two people had signed it: an author,
and a second person who was not the author. Three copies of the rule enforced it — the approval
registry (`approveContent`, `parseApprovals`), the mapping gate (`checkUsable`'s
`reviewed_by_author`), and the loader that runs both. Blocker 2 named Iman Behravan as the
approver, and the review pack was written for his sitting.

Vahid changed the framing, and with it what the review is for:

> *"My goal now is to get the whole thing standing and working end to end, so that a professional
> developer can later sit down with a system that runs rather than a system on paper. It is not to
> put this in front of a real student. That comes after the developer, not before."*
>
> *"So the two-person mapping review is not worth five hours of two people's time right now. Drop
> it to one: I approve, and I am the only signature. Change whatever refuses an approval signed by
> its author, and record that I changed it and why, in my words."*

He attached two conditions and asked for both to be enforced rather than noted.

## The two conditions, in his words

**1. Nothing reaches a real student on a one-signature approval.**

> *"Whatever gate stands between a run and a real applicant, tie it to this: a mapping set with one
> signature may be used for my own account and for nothing else. If that gate does not exist as a
> thing in the code, build it, because my memory of this conversation is not a control."*

**2. The thing given up is visible to whoever comes next.**

> *"Write it where a developer reading this repo will find it early: the mapping set was reviewed by
> one person, that person authored nothing but approved their own project's work, and the class of
> error it was meant to catch — a field mapped to a plausible wrong source, which every test passes
> and no gate refuses — is uncaught. Say plainly that a second reviewer is a precondition of serving
> a real student, not an improvement."*

> *"I would rather a developer inherits a working system with an honest list of what was skipped
> than a half-built one with a clean review record."*

## Decision

1. **An approval may be signed by the artefact's author.** `checkUsable` no longer refuses a set
   whose `reviewedBy` is its `authoredBy` (the `reviewed_by_author` refusal is gone), and the
   registry no longer refuses an approval whose two names are one person.

2. **A single signature admits one account.** An approval signed by its author is accepted only
   when it names the one account it admits — `ownAccountOnly: { studentId }` on the approval, in
   `approvals.json`, where the signature lives (ADR-0057). One that names no account is refused as
   `self_approval_unbounded`: a signature on a draft, for everyone, which is what was refused
   before. A second person's approval admits any applicant, as it always did.

3. **The gate is in the code, at every point a run touches the entry.** The loader carries the
   approval's admission onto the served entry (`DeployedCatalogueEntry.admits`) and onto every
   listed target (`ReviewedTarget.admits`). The Conversation Service compares it with the
   student's identity:
   - the listing (`GET /v1/application-targets`) shows a one-account target to the one student it
     names and to nobody else;
   - the offer (`POST …/target-offers`) draws from the same set, so no offer can be made for a
     target the student was never shown;
   - the start and the re-application refuse every other student by name —
     `not_for_this_applicant`, a code in the contract, 403 on the wire, worded for the student;
   - every later lookup of the entry for a bound case (`#entryAdmitting`: preview, work claim,
     advance, resume, handover) answers as if the entry were not served to that student, so a
     catalogue swapped under a running case stops that case too, and the advance says why.
   The Worker advances runs through the same driver, so it is bound by the same check.

   The identity compared is `studentId` as the session carries it: under `AAS_DEV_SESSION` the
   subject the person posts; under OIDC the `students.id` row for the signed-in subject. The
   runbook says how to read it. Nothing here can verify who owns a portal account; what it can
   verify is which signed-in student a case belongs to, and that is what the approval names.

4. **Nothing else is loosened.** The content hash still binds the approval to the exact artefact
   (ADR-0057). The blueprint must still be executable and the set usable. A draft is still
   refused. The Requirements Service's own two-person rule on knowledge-base entries
   (`packages/requirements`, blocker 10's path) is untouched: it was not asked for, it is not on
   the path to standing, and it is named in the skipped list as the same shape for him to decide.

## What this deliberately gives up

The second reviewer was the one control against **a field mapped to a plausible wrong source**: a
mapping that names a real profile field, in a real format, for the wrong box. Every test passes
it — the tests check that the set is coherent and that what it names exists, not that it is
right. No gate refuses it — the gates check signatures, hashes, versions and categories, not
meaning. A second person reading the set against the form was the only thing that could catch it,
and there is now nobody doing that.

So, in his words and as a precondition rather than a preference: **a second reviewer is a
precondition of serving a real student, not an improvement.** Blocker 2 stays open with that
sentence in it. The developer who inherits this reads it in
[`docs/what-was-skipped-to-get-it-standing.md`](../what-was-skipped-to-get-it-standing.md), which
the README links from its first screen.

## Consequences

- The Sheffield set is signed by Vahid alone when he is ready, in `approvals.json`, with his own
  `studentId` under `ownAccountOnly`. The service then serves that entry to him and to nobody.
  Iman Behravan's sitting is dropped; the review pack stays as the reviewer's map for whoever
  reviews before a real student.
- The refusal vocabulary grows by one code (`not_for_this_applicant`), the run refusals by one,
  and the client's wording covers it (P41's rule).
- `pnpm run catalogue check` prints, per entry, whom its approval admits, so an operator can see a
  one-account entry for what it is before starting a process on it.
- The four tests that pinned the two-person rule are rewritten to pin this one, and each was run
  red against the old code before the change (P144).

## Built

P144, 2026-09-16: `packages/catalogue` (`Approval.ownAccountOnly`, `Admission`, `admissionOf`,
`admits`, the loader and the target carrying it, `parseApprovals` through `approveContent`);
`packages/mapping` (`reviewed_by_author` removed); `packages/contracts` (the problem code, title,
status, the OpenAPI enum, `RUN_REFUSALS`); `apps/conversation-service` (`CatalogueEntry.admits`,
the driver's `#entryAdmitting` and the three worded checks, the listing and offer filters, the
route mapping, the client's words); `scripts/catalogue.ts` (`check` prints the admission); the
records this ADR names.
