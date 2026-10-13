# ADR-0160 — The run stops before a page whose save may be the submission, and does not open it

**Status:** Accepted · the rule, a stop before saving page 12 until it is known whether saving it is
the submission, is Vahid's, in his own words of 2026-10-13 (below) · the mechanism is mine, built in
P305 because his words ask for the stop before his live run · where the mechanism goes beyond his
words, §5 lists it as his to overturn · related:
[ADR-0159](./0159-the-run-presses-the-final-submit-on-the-students-own-confirmation-per-university.md)
§9 and §12, row 80 and row 82 of `docs/state-of-the-system.md`

## His words (2026-10-13)

Saved whole as sent:
[`docs/run-a/p305-his-answers-on-adr-0159-as-sent.txt`](../run-a/p305-his-answers-on-adr-0159-as-sent.txt).

> *"BEFORE MY LIVE RUN: find out whether saving page 12 (the course choice) is itself the
> submission. Read studyprogrammetaught.js (row 82) and anything else that shows it, read-only.
> Until this is known, my run must stop before saving page 12."*

## 1 · What the read found: it is not known

P305 searched the repository read-only, with three readers and an adversarial check on each. The
agent does not touch the portal, so nothing was fetched from Sheffield.

- **The script is not here.** `studyprogrammetaught.js` has never been in the repository, on any
  local ref, and no definition of the five handlers the page names exists in the tree or its
  history. The five are `updateCourses`, `updateQualifications`, `updateMultipleStartDates`,
  `checkOpenForFeeStatus` and `fundingSourceKnownChanged`.

  *Method:*
  - `git log --all --name-only` for the file;
  - `git log --all -S'function <name>'` for each of the five handlers;
  - a grep of the tree for the five definitions.

  Each search found nothing. Each was first shown able to find `education.js` and
  `function XMLDoc`.
- **What is observed:**
  - Page 12's form is a POST to its own address, `studyprogrammetaught.do`.
  - It has two submit inputs, `saveBtn` and `backBtn`, and no inline submit handler
    (`docs/captures/sheffield-part2-2026-09-25/taught-page.html:108`, `:269-270`).
  - The read tool never saw a control with submission words on page 12, nor on the overview read on
    2026-09-25. Its check covers buttons, submit inputs and links, and only in English.
- **What is stated, and by whom:**
  - **His own words, 2026-09-11** (quoted in ADR-0103): *"Part 2 waits, deliberately. It is the page
    where submission actually happens and it deserves the schema to be settled before it is read."*
  - **His account of his read of 2026-09-25** (the Part 2 capture README): the taught page has *"a
    save and a back … and NO submit-the-application button anywhere on it"*. On that day, in his
    account, no course choice had been saved.
  - **Sheffield's public page**, in his transcription of 2026-09-10 (S4): the application is submitted
    only when *Submit Application* is clicked. The page itself is not kept.
  - **The target file** says each course choice has its own Submit. It was transcribed on 2026-09-08,
    before any read, from his description (its header says so). It is not his verbatim words and
    gives no URL.
- **What is reasoned, not observed:**
  - **Save's live label is "Save and Continue".** It is read from the draft of the same read. The
    kept HTML blanks values, so tying the label to `saveBtn` is an inference (row 179).
- **What no read-only step can show:** what Sheffield's server does with that POST. Even the script
  would show only the browser's side.

So nothing observed shows that saving page 12 submits the application, and nothing observed shows
that it does not. His words of 2026-09-11 point the other way from S4, and both are statements.

## 2 · Decision: the run stops before the page, and does not open it

His words ask for a stop before **saving** page 12. The stop is placed earlier than that, **before
the page is handed to a runner at all**. That is mine, for three reasons:
- **Back submits too.** It is a submit in the same form, so pressing it POSTs the page.
- **Filling the page runs code nobody has read.** It fires the five handlers. The sibling script
  `education.js` sends its list lookups as POSTs.
- **The network guard cannot help.** It cannot tell a lookup POST from a write
  (`apps/browser-runner/src/preparation-safety.ts:34-39`).

### How it is held

**A register outside the signed entry.** `packages/catalogue/src/held-pages.ts` (`HELD_PAGES`) names
Sheffield's page 12:
- blueprint `bp-sheffield-pgt-september-direct`, `page12`, and the page's address;
- the words "the course choice page", for the student;
- his sentence, and the file it is kept in.

It is outside the signed entry because a hold only takes work away from a run. The precedent is
P301's rule that the run never presses "Forgot password", built in code from his typed words.

Two rules keep the register from being escaped:
- **A page is held if either key matches**: its (blueprint, pageRef), or its address. Addresses are
  compared loosely, ignoring scheme, port, `www.`, query, fragment, `;` parameters, percent-encoding,
  doubled slashes, a trailing slash and case. An address with no host of its own is read against the
  held page's address only on the held page's own blueprint, and held there if even that cannot read
  it. On another blueprint it is not that page: the second review found `about:blank`, `mailto:` and
  an empty address all held as Sheffield's page on a blueprint that was not Sheffield's.
- **A driver given a register of its own adds it to the kept one, never replaces it.**

A record test reads the signed entry from disk. It fails if the register stops naming page 12 by
both keys, names a page the entry does not have, or if any page whose save continues to page 12
(page 11 today) gains a mapping. Saving a filled page 11 would land the runner on page 12.

**Every road to the page is held, not only the claim.**
- **The claim.** `claimWork` checks the run's next page before building `execute` or `sign_in`
  work. A `create_account` comes before any page is filled. Then it checks every address any work
  would carry (form, login, registration, listing). A held page leaves no lease and no intent, and
  the stop names the entry's own page, whichever key matched. The two checks are separate layers;
  mutation 01 below shows the second catches what the first misses.
- **`#nextPage` never passes a held page that is not recorded as saved,** even one with nothing to
  fill or with a password box on it. So the run can never count itself filled past it. A held page
  already recorded as saved is passed, because that save has happened.
- **The resume path.** When the session has lapsed, the run would ask for the password to sign back
  in. `#decideOnce` holds instead, before any password box opens. A `sign_in` is not handed out
  either.
- **A person's resume.**
  - Resolving the hold's own stop with `resume` or `route_fallback` is refused while the page is
    held (`PageStillHeldError`, a validation failure on `/outcome`). Only `abandon` is taken.
    Nothing is recorded by the refusal, and the specialist command (`pnpm run interventions
    resolve`) says why it was refused, rather than only the refusal's code.
  - Resuming any other stop when the next page is held holds the run before it is released, so no
    runner can meet the hold in between and tell the student a second time. The student hears the
    hold once, not "moving again". An interview stop is the exception: it asks its question again
    first, and the hold comes after the answer (row 180).
  - The position a student's screen reads says a person is needed, not a password, when the
    resume sign-in would lead to the held page.
- **What happens when it holds:**
  - The run is set `escalated`. A lost race on that write is caught, and the next poll holds again.
    What the hold reports is the status it left the run in, read back, not assumed.
  - A person is asked once, with the reason `page_save_may_submit` and the page named on the
    intervention.
  - The student is told once:
    > *"I have stopped before the course choice page of your University of Sheffield application,
    > and I will not open it while it is not known whether saving that page sends your application to
    > the university. A member of the team has been asked to look at it, and nothing more happens on
    > your application until then."*

    It says nothing about the page's past. The first version said "Nothing on that page has been
    entered or saved", a claim no code checked.
- **The preview says so under the page, before the yes,** and so does the review tool's preview:
  > *"Held: I will stop before this page and not open it, because it is not yet known whether saving
  > it sends your application to the university. What is listed here is not entered until a person
  > has looked at it."*

  Without it, the preview's opening sentence, *"This is exactly what will be entered into the portal
  on your behalf and saved there"*, would be untrue of page 12. The hold is outside the content hash,
  as rendering is under ADR-0059, so it moves no signature and no yes. A document's disclosure
  record keeps the preview's text as the student read it, held line included.

**Tested.** The tests run on the fixture's course page, held the same way, plus the register's unit
tests and the record test. Each guard was disabled on its own, and the tests went red. The output of
every run is kept, unedited, in [`docs/run-a/p305-mutations/`](../run-a/p305-mutations/), with the
change made, the command, the exit status, and that the file was restored byte for byte.
- **01** (the claim's next-page check alone) turned red only the sign-in test. With both claim
  checks disabled (**01b**), five tests turned red.
- **02** removed the held pages from the preview.
- **03** dropped the reason.
- **04** skipped the escalated save.
- **05** broke the idempotent raise.
- **06** removed the resume refusal.
- **07** removed the password-ask hold.
- **08** removed the hold after release, the one reached when the run reads `running` at the resume
  (a lost escalation write). After the second review added the hold before release, this mutation
  stayed green until a test reaching that case was added; it now turns two tests red.
- **09** removed the sign-in hold.
- **10** stopped ignoring case in addresses.
- **11** planted a mapping on page 11.
- **12** removed the specialist command's explanation of the refusal.
- **13** removed the hold before release.
- **14** removed the status read's look ahead to the hold.
- **15** let an address with no host match on another blueprint.
- **16** stopped ignoring a trailing slash.
- **17** reported the status as assumed rather than read back.

Mutations 01 to 11 and 13 to 17 were run together after the last change to the code they cover;
12 after the last change to the command.

**Not tested, resting on reading** (row 180):
- `#nextPage` returning a held page with nothing to fill, or with a password box on it. No fixture
  page is held that way.
- A hold matched by address alone, on a blueprint that numbers the page differently.
- The held line in a document's disclosure record. Sheffield attaches no documents.

## 3 · What this leaves, and how it ends

- **His run stops before page 12, and the case rests escalated.** Part 1's pages are saved on the new
  account. `ready_to_submit` is not reached, and the account is not handed back while the run is
  held. It ends one of four ways (three until P307):
  - **Lifted:** the hold's line is removed in a commit quoting his words that lift it, the service is
    restarted (the register is read at start), and a person resolves the stop `resume`.
  - **Abandoned:** a person resolves it `abandon`.
  - **Stopped by the student** (ADR-0053).
  - **Submitted by hand, and recorded** (P307, ADR-0159 O10): a person runs
    `pnpm run submission-by-hand`, and may then resolve the stop `resume` with the page still held.
    The run opens no page, the account is handed back, and the run completes.

  Abandoned and stopped wind the case down, and the handover becomes due. A case recorded as
  submitted by hand is not wound down, and its handover becomes due too.
- **If he saves page 12 by hand without submitting, do not resume after a lift.** The case can
  record a submission made by hand (P307), but not a page saved by hand, and a resume would save
  page 12 a second time: possibly a second course choice. Abandon instead.
  - *Corrected in P307:* this line said O10 was "built with decision 1 in P306". It was not. P306
    left O10 unbuilt, and P307 built it.
- **Latent, not reachable today** (row 180):
  - The runner itself does not refuse a held address; the plane never sends it there. The page-11
    road is guarded by the record test above.
  - A new kind of browser work must be checked against the register when it is added.

## 4 · What would settle it: his reads

He does the reads; the agent never touches the portal. Nothing here is metered.

0. **One line from him first, for any console snippet.** He has not yet said what a read prints on a
   page with no country box; page 12 and the overview have none (CLAUDE.md). The steps below use no
   snippet.
1. **Save the script from the browser,** as `nationality.js` and `education.js` were saved:
   - signed in to the account the reads use;
   - open page 12 from the overview's link, press nothing on it, and leave by the address bar;
   - open the `.js` link and Save As, or use DevTools' Network or Sources "Save as", never after
     pretty-printing.

   Commit it unchanged. A saved copy must define the five handlers. It settles the browser's side:
   - whether Save is intercepted;
   - any `confirm()` and its words;
   - any rewritten action;
   - what the handlers request.

   It also settles rows 82, 84 and 86.
2. **The overview and summary as they stand, before any save,** with the read tool. He checks each
   kept page for personal details before committing it. It settles the portal's own words on course
   choices and submission before a save. It may also turn up another script.
3. **Already on his machine, perhaps:** the read of 2026-09-25 at 17:06
   (`attached-sheffield-pgt-september-direct-2026-09-25T17-06-12-514Z`) wrote the overview's page to
   its local `pages/` directory. If that file still exists, it costs nothing, though it shows the
   overview before a choice was saved.
4. **What only a save can show:** the page after Save, the overview with a choice saved, and any
   e-mail. That is a write, and may be a real application. It is his decision, not a read.

After 1 to 3, "saving is not submitting" would rest on the script, the portal's own words and S4: a
statement and reasoning, not an observation, against his own words of 2026-09-11. Whether that is
enough to lift the hold is his to say.

## 5 · Open, and his to say

My choices beyond his words, each built, each his to overturn:

- **Not opening the page at all,** where his words say "before saving". The cost: the page's lists,
  which only an open page loads, are not read on his account by the run.
- **Escalating, rather than handing page 12 to him.** The alternative was considered in P305's read:
  page 12's boxes marked as his own to fill, so the run reaches the handover and `ready_to_submit`
  without page 12. Built this way, the run rests escalated: no handover, and `ready_to_submit` is
  unreachable while the page is held. The alternative would have invited his hand on page 12 before
  the question is answered, which is his decision (ADR-0159 §12), not mine.
- **The lift procedure:** one deleted line, a restart, and a resolved stop.

## Consequences

- **The default is held.** A run of the signed Sheffield entry stops before page 12 whatever the
  deployment configures: the kept register is always applied.
- **The preview gains one line under a held page,** in the run and in the review tool.
- **Lifting is one deleted line, a restart and one resolved stop.** The record test then needs its
  expectation changed in the same commit, so a lift is visible in the diff.
