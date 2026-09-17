# ADR-0122 — A failed page fill is tried twice, then stops for a person; the student is told which page, which attempt and what the page did

**Status:** Accepted · 2026-09-17 · closes blocker 32 · applies 0114's rule to the third path, `execute` · the ledger of 0054/0114 gains the memory of what each attempt failed with
**Decided by:** Vahid Mohammadi, in his own words, 2026-09-17. **Built in P155**, the same day; see *Built* below.

## Context

P154 found it writing Run A's sequence, the way blocker 26 was found for the account creation and
its sign-in half: a page the runner reported `failed` — `portal_refused`, `portal_drift`,
`robots_disallows`, `runner_fault` before the save — completed its intent `failed_cleanly`; the
next claim re-opened it (ADR-0047: *already_done + failed_cleanly is offered again*); the Worker
re-offered it on its next tick; and the runner tried the page again, paced only by the one-second
floor, until someone stopped the stack or the student pressed *Stop this application*. No count,
no message, no person. Against a live portal that is a failing save retried every few seconds.

ADR-0114 had capped the creation at two and told the student why; ADR-0120 had applied the same
shape to the sign-in the day before, at his word, so that Run A's first unknown would be the
portal rather than our own retry loop. The page fill was the third path with the same hole.

## Decision

In his words, 2026-09-17:

> *"Blocker 32: build the cap first. My own rule, and I would rather not discover on the live
> portal that it has a third exception. Two attempts then stop, same shape as 26 and 120, and
> the student told which attempt failed and what the page did. If a page's save failure cannot be
> told from a portal fault, say so rather than guessing, as 120 does."*

So, for a page the runner fills (`execute` work, the `advance_portal_page` intent):

1. **The attempts are counted**, on the page's own ledger row, which already survives a reopen
   (ADR-0114's `attempts_made`). A runner that held no session (`needs_the_student`) attempted
   nothing on the page: the resume path asks for the password (ADR-0101 §3), and nothing is
   counted or said here.
2. **The first failure:** the student is told which page, that it was the first of two attempts,
   what the page did, that there will be one more, and that nothing has been submitted. The row
   stays re-openable for one more attempt, as before.
3. **The second failure:** the run stops for a person. The intervention names the page, the
   attempt, this attempt's code **and the first attempt's**, and that the ledger records two
   attempts and no save; the reason is `page_structure_changed` for `portal_drift`,
   `unfamiliar_validation_error` for `portal_refused`, `new_portal_behaviour` for
   `robots_disallows`, `timeout_exhausted` otherwise. The student is told the same in their words
   and that a person will look. The status is `escalated`, which `claimWork` never offers. The
   number is two; no third attempt is made.
4. **The ledger remembers what each attempt did.** The count alone says a second failure is the
   second; it cannot say what the first was, and a page refused twice is a different fault from a
   page refused once then not found the way the blueprint says. So the row keeps the runner's
   closed code for every attempt made, in order, across every reopen (`attempt_failures`,
   migration 0006 of the case store). A success adds nothing; a hand-out that was not an attempt
   adds nothing, on the line `attempts_made` already draws.
5. **What cannot be distinguished is said, not guessed.** The runner's `failed` is a claim that the
   page was not saved: it read the page back (ADR-0106) and found no save, or never reached the
   save. `portal_refused` on a fill means a box would not take its value and the page was not
   saved; whether the portal rejected the value or the box is not the one the blueprint names
   cannot be told from the record, and the words to the person say so. A save the runner could
   not confirm is not a failure at all: it is `uncertain`, which stops for a person at once
   (`#pause`, `not_recorded`) and is never counted against the two.

## Built — P155, 2026-09-17

Tests first, red — the driver's three cases had no mechanism, and the ledger had no memory of a
code — then:

- **The ledger** (`packages/case-store`): `IntentRecord.attemptFailures`, appended by
  `completeIntent` from `IntentCompletionDetail.failure` when the attempt was made; left alone by
  a reopen. Migration `0006_intent_failures.sql`: `attempt_failures text[] NOT NULL DEFAULT '{}'`.
  The contract suite proves both stores keep the codes in order across a reopen, ignore a
  hand-out that was not an attempt, and add nothing for a success.
- **The driver** (`#afterFailedPage`): a failed `execute` report completes the intent with its
  code, then reads the row's count. Fewer than two: `pageFailedOnceMessage` — *"I tried to fill in
  the "Your application" page … on the first of two attempts: a box on it would not take what I
  had for it, and the page was not saved. That can happen once by chance, so I will try once
  more. Nothing has been submitted."* Two: `#stopForPerson` with the page in the intervention's
  context, both codes in *encountered*, `pageStoppedMessage` to the student.
- **The words.** `portal_refused` reads *"a box on it would not take what I had for it, and the
  page was not saved"*; `portal_drift` *"the page was not laid out the way I expected, so I did
  not type into it"*; `runner_fault` *"my browser lost its connection before the page was
  saved"*. To the person, each code's meaning and, for `portal_refused`, that a rejected value
  and a wrong box cannot be told apart from the record.
- Tests: the driver on real Postgres — the first failure told with the page's title and the page
  re-takeable, no intervention; the second stopped with `page_structure_changed`, the page, both
  codes and *"once is chance, twice is the portal"* on the record, the student told, never
  offered; a lost session neither counted nor told.

## Consequences

- Run A's first unknown on any page is the portal: a page that does not save shows him one plain
  message naming the page, one more attempt, and a stop that says what both attempts did.
- Every portal gets the same cap. A blueprint that no longer describes a page costs two attempts
  and a person's look, not a loop.
- Nothing here touches the transmission gate, the authorisation content hash, or the
  mandatory-review categories; a page the runner could not confirm still stops at once as
  uncertain, unchanged.
