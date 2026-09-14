# ADR-0110 — A run may start on an account the student already holds; the first live run enters Vahid's own account, and never a synthetic applicant

**Status:** Accepted · 2026-09-14 · decides item 8 of the distance list and blocker 4 · continues 0101 (§3, the resume path) and 0050
**Decided by:** Vahid Mohammadi, in his own words, 2026-09-14. Built in P122.

## Context

ADR-0101 made the yes come first, the account's password come after it through the secure
channel, and `portal_sign_in` the *resume* path only (§3): a run that starts registers a new
applicant. `docs/distance-to-a-reviewed-sheffield-run.md` (P119) named the consequence as item 8:
Run A on the live portal would mean registering a synthetic applicant on Sheffield's real form,
which the gap analysis of 2026-08-26 had advised against, or admitting a run onto his existing
test account, which no path offered as a start.

## Decision

In his words:

> *"Item 8, decided: the run enters my existing account. Not a fresh synthetic applicant."*
>
> *"A synthetic applicant registered on Sheffield's real form is a fake person in a real
> university's admissions system. Even stopping at the end of Part 1, that is a record Sheffield
> holds about someone who does not exist, created by us, which they did not agree to hold. My
> account is real, it is mine, and I consented to all of it."*
>
> *"So build the start path onto an existing account. I understand that does not exist today and
> that signing in is the resume path only. If that turns out to be large, tell me before building
> and I will hear the alternative — but the synthetic applicant is not the alternative I will
> accept."*

And the distinction he drew, so that it is in the record as two decisions and not one:

> *"The profile data is synthetic, the account is mine. Those are different decisions and I am
> answering only the second. Whatever is typed into Part 1 under my account will not be true
> about me. If that matters to anything downstream, say so."*

On the same day, on item 10: *"Part 2: not now. Run A ends at the end of Part 1 and I am not
extending it before it has happened once."*

And later the same day, on the handover checklist item the consequences below had raised:

> *"Waive it for an account the student created themselves. Asking someone to reset their own
> password to prove they can receive mail at an address they chose and already signed in with
> is a check that proves nothing and costs them a real password. Keep it for an account we
> created on their behalf, where the address was never tested."*

## What this decides, and what it does not

1. **A run may start on an account the student already holds.** The student says so, before
   the yes; the case records it as a fact of the student's, not as work of ours; the run then
   takes ADR-0101 §3's path from the start: the password for that account is asked for through
   the secure box after the yes, used once by the Fill Agent to sign in, never stored, and the
   fill proceeds in that session. No account is created. ADR-0101 §3's reasoning stands; what
   changes is that the resume path is also a start.
2. **The first live run (Run A) enters Vahid's own account.** A synthetic applicant on the real
   form is refused as an alternative, in his words above.
3. **Two decisions, not one.** The profile typed under that account is synthetic. This ADR
   decides the account only. The truth of the profile is not checked by anything in the system
   and is not this ADR's to decide.

## What depends on it downstream — the answer to "if that matters, say so"

- **The account's address is the profile's confirmed e-mail.** Product rule 7, enforced in the
  orchestrator: an account's e-mail is `contact.email`, confirmed by the student, and the sign-in
  types it. So the synthetic profile for Run A must carry his real account e-mail as
  `contact.email`, and the contact page will be filled with it. That is his own data, at his own
  consent; it is the one true value in the run.
- **His real password crosses the secure box once**, exactly as the resume path already does for
  a password the student chose: single use, typed by the Fill Agent over CDP, never held by the
  Conversation Plane (ADR-0034, 0042). The hard stop — no design stores a portal password —
  is untouched.
- **The handover checklist, for an account the student made: no address proof.** Decided in his
  words above. ADR-0050's substitute — the reset on a portal that never verified the address — is
  for an account we made; an account the student made and signs in with has already established
  what either proof would. Read as covering both address proofs, the reset and the portal's own
  verification, for that reason; the three items that remain (told where it is, we retain no
  access, they confirm they can sign in) still apply, and the case still cannot conclude without
  them. An account we create on the student's behalf keeps the checklist ADR-0050 gave it.
- **Sheffield's record.** Part 1 under his account will hold statements that are not true about
  him. Nothing in the system reads or checks the truth of a profile; the preview shows exactly
  what will be typed, and his yes covers it. The refusals on the equal-opportunities page stand,
  so no special-category data is typed; the DPA obligations recorded in P44 concern a real
  student's data, and Run A processes none.
- **Unchanged:** the case binding at the transmission gate, the authorisation content hash, the
  mandatory-review categories, the account creation path for a student who has no account.

## What was built (P122)

- A student decision, `existing_account` (contracts, OpenAPI), accepted while the run awaits the
  yes where the portal needs an account and none exists on the case; `refused` after the yes,
  `not_asked` where the portal needs no account or one exists; offered on the student's page at
  the authorise step.
- A case event, `PortalAccountDeclared` `{portalHost, declaredAt}`, carrying no address; the
  case folds it once. The driver derives the account from it as it derives one from a completed
  creation intent (`accountDeclared` mirrors `accountCreated`): stage *active* from the
  declaration, `createdBy: "student"`, the confirmed e-mail, no wait for the portal's
  verification.
- No orchestrator change was needed for the flow: with an account and no live session the
  existing resume path (ADR-0101 §3) opens `request_secret` for `portal_sign_in`, then `sign_in`,
  then `execute`. What changed is the wording: the box and the step say it is a start for an
  account the student holds, not a resume of one we signed in to.
- The handover checklist drops both address proofs for `createdBy: "student"` (his waiver);
  the fixture journey confirms the account back with one confirmation, not two.
- Proved on the fixture portal through the five real processes
  (`scripts/local-stack-existing-account.test.ts`): the account made on the portal beforehand
  with a password only the student knows, declared before the yes, signed in to by the Runner
  process with the Fill Agent typing over CDP, the form filled, no creation intent ever opened,
  the portal holding exactly the one account. And in the driver against a real database, and
  in the orchestrator, account and domain packages.
