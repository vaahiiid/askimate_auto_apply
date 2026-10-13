# P298: finishing Sheffield on your account, and the nationalities test plan

Decision 5 of 2026-10-12, in your words
([`p297-his-decisions-as-sent.txt`](./p297-his-decisions-as-sent.txt)): *"Then finish Sheffield on
my account through every remaining page, stopping before final submission. Then a test plan with
synthetic students of several nationalities (India, Nigeria, Pakistan, Bangladesh, Gulf) on the
fixture portal plus live read-only list searches, measuring questions per application for each."*

The live parts are yours to run. Nothing here touched the portal. Everything below was proven
against the deterministic stand-in only (the fixture portals, the planner, the measure); what the
live form does is what your runs and reads will show.

## 1 · What changed before any live run

- **Row 155, closed.** The click guard could not see a submit control on Sheffield's form: it read
  only a control's text content, which an `<input type="submit">` does not have, and its pattern
  `\bsubmit\b` did not match `submitBtn` or `submitApplicationBtn`. It now reads what the control
  says (text, `value`, `aria-label`, `title`, an image button's `alt`) and what it is called
  (`name`, `id`), and refuses any of them that reads as a submission. Each of the three new shapes
  went red before its fix: the two inputs against the old code, which pressed them, and the image
  button against the code before `alt` was read. All three are refused now.
  The entry's own press controls were each put through the new check: `loginBtn`,
  `startApplicationBtn`, `saveBtn`, `subjectSearchButton` and the cookie notice's link. None is
  refused, so your run is not stopped by the fix.
- **Row 157, closed.** Both test portals keyed nationality on demonyms ("Iranian"), while the
  interview stores ISO codes, so no profile the interview made could pass their nationality. They
  now take the ISO code and offer the six nationalities below, beside Iran, Iraq and the United
  Kingdom (thirteen in all: the six Gulf states, India, Nigeria, Pakistan, Bangladesh).
- **Row 161, closed.** The questions-per-application measure called a value the profile does not
  hold *"stops for a person … the form records no escape for it"*. It is now its own kind, `ask`:
  *"the profile holds no value for it (not_collected): the run asks the student"*. The counts did
  not change; the words did.

## 2 · Finishing Sheffield on your account

### Which account

The signed entry (`sha256:546b2948…` since P299; it was `4368de00…` when this was written) admits one student: `5774ff16-…`, item 6, your own details,
the account the run creates (ADR-0144). Run A's `af398e01-…` is no longer admitted. This plan
finishes the item-6 run. If by "my account" you mean Run A's, that needs a signature naming it;
nothing here changes which account is admitted.

### Where your run stops today

At education. Measured on `main` in P297: **6 questions** at education today, **1** under ADR-0156
with the intake answers. With P296's patch signed, P296 measured **5** today and **0**.
Your profile lives on your machine, so these were measured in those phases with your run's values
and are not measured again here. Signing P296's patch, or not, is yours
([`p296-for-signature.md`](./p296-for-signature.md)).

**P299:** you signed it (`8f51a599`). Measured again on the signed entry with
`scripts/questions-his-run.ts`: **5** today with your title, **4** with "DBA", **0** under
ADR-0156 with the intake answers, as P296 predicted. Before the run creates your account, read
rows 152 and 170 of `docs/state-of-the-system.md`: AUTH 7 is now recorded as not observed
everywhere except inside the signed entry, and why the entry waits is there.

### What the run will meet after education, page by page

Read from the signed entry. A page counts as **visited** if the plan has something to type or
attach on it. The driver skips any other page (`#nextPage` in
`apps/conversation-service/src/run-driver.ts`: *a page with no field the plan wants is not
offered*), so a skipped page is never opened and never saved.

| Page | Boxes | Mapped | The run | What is unknown |
|---|---:|---:|---|---|
| 8 · Employment history | 7 | 7 | fills and saves, once per job | — |
| 9 · Equal opportunities | 14 | 2 | fills two boxes, saves | the other twelve are left as the form has them |
| 10 · Marketing | 10 | 0 | **skipped** | whether Sheffield lets Part 1 finish with it unsaved |
| 11 · Other documents | 10 | 0 | **skipped** | the same |
| 12 · Course choice (Part 2) | 9 | 8 | fills and saves; **never run before**. *P305: held, the run stops before it and does not open it (ADR-0160), until whether saving it is the submission is known* | the start-date list that loads after the qualification was never read and is not in the blueprint (the entry's own note); if the form needs it to save, the page will not save, and what the run does then on this page has not been seen |

Page 6 (English) is skipped the same way (row 147). On your account it was saved empty by hand
before. Whether Part 1 completes on a fresh account with pages 6, 10 and 11 never saved is
**unobserved**, and it is the first thing your run will show after education (row 168). The
onboarding record's T5, *live to the line*, names those pages as missing, so the run as it stands
cannot reach T5 where they were not saved by hand.

### The stop before final submission

Three layers, none of them a promise about the live form:

1. **Only the controls the plane sends for the page are pressed.** For each page the allow-list is
   exactly that page's advance control, the *add another* control on a page filled once per item,
   and any button the plan presses to load a list (the subject search)
   (`apps/browser-runner/src/performer.ts`). A control not on it is refused.
2. **A control that reads as a submission is refused even if it is on the allow-list.** This is
   the row 155 fix above.
3. **No blueprint names the final submission.** After the last page with something to fill, the
   run reaches `ready_to_submit` and stops. Where Sheffield's *Submit Application* control is has
   **never been read** (the entry's Part 2 note: *"WHERE THE FINAL SUBMISSION IS remains
   UNREAD"*). The entry also records the source's own words (2026-09-10): *"the application is
   submitted only when Submit Application is clicked"*. So the stop rests on 1 and 2, and on 3
   being true of the live form.

### What you run

1. Pull `main` and restart the local stack as the runbook says
   ([`item-6-runbook.md`](./item-6-runbook.md), from step 5). Migrations apply on start.
2. Continue your conversation. At education, answer what it asks, or resolve its stops as before.
   With P296's patch signed (P299), the run asks one question fewer than before.
3. Let it run through pages 8, 9 and 12. Part 2 has never been filled by the run: watch it.
   **P305:** the run now stops before page 12. The stop before *saving* it is his word (*"Until
   this is known, my run must stop before saving page 12"*); stopping before *opening* it is
   ADR-0160 §2's choice, his to overturn. It tells him so, and a person is asked. Step 4 is not
   reached while page 12 is held. If he saves page 12 by hand, the case cannot yet record it, so
   do not resume after a lift: ADR-0160 §3.
4. At `ready_to_submit`, stop. Open the portal yourself and read its overview before pressing
   anything. The overview is where the final submission is expected, and that has never been read.
   If you are willing, keep its HTML: that read closes row 80.

**What it costs:** nothing metered, unless the stack runs with `AAS_LOCAL_READER_MODEL=bedrock`.
Then a CV reading spends model calls: sixty-eight, as CLAUDE.md records of one reading. AWS spend
stays yours to start.

## 3 · The nationalities test plan

### The students

Six synthetic students, in [`synthetic-students.json`](./synthetic-students.json): India, Nigeria,
Pakistan, Bangladesh, and for the Gulf, the United Arab Emirates and Saudi Arabia. Each is Run A's
synthetic profile with its own name, nationality, address, history, qualification and jobs
replaced. Every value is invented. Each grade scale is held as a student would state it (P297):
*CGPA out of 10*, *CGPA out of 5*, *CGPA out of 4*, *GPA out of 5*, and one bare `gpa_4`.

### Measured on the stand-in

`scripts/questions-by-nationality.ts`, output saved whole as
[`p298-questions-by-nationality.txt`](./p298-questions-by-nationality.txt), tested in
`scripts/questions-by-nationality.test.ts` (including a French student the test portal must refuse,
so the check is seen to say no). On the fixture portal the nationality is also checked in the
browser: each of the six is offered, with a passport country answered for it
(`apps/browser-runner/src/fixture-portal.test.ts`).

| Student | Test portal | Sheffield today | ADR-0156, no standing rule | ADR-0156, with the escape rule |
|---|---:|---:|---:|---:|
| India | 1 | 6 | 6 | 5 |
| Nigeria | 1 | 5 | 5 | 5 |
| Pakistan | 1 | 4 | 4 | 3 |
| Bangladesh | 1 | 6 | 6 | 5 |
| United Arab Emirates | 1 | 4 | 4 | 3 |
| Saudi Arabia | 1 | 3 | 3 | 3 |

- **The test portal**: every nationality is taken. The one question is the personal statement,
  which the synthetic profile never held, and which the run asks for.
- **Sheffield**: every student stops at the institution (no list has been read under any of these
  six countries), the grading system (its escape leads nowhere, row 140) and the grade. India,
  Nigeria and Bangladesh also stop at the subject: *Commerce*, *Economics* and *Finance* are not on
  the lists the searches for *business* and *international* returned. India, Pakistan, Bangladesh
  and the UAE are also offered the award title (*BCom (Hons)*, *BBA*), which is not one of the
  forty-one titles.
- **ADR-0158** (proposed, not decided) is **not measured**. Its rule resolves a value against the
  list the form shows, and no list under these countries has been read. The reads below are what
  it needs.

### The live read-only searches

On your own account, read only, on `education.do?new=true`. Nothing saved. Paste each output whole,
as the console printed it. Split it only on its own separators. Every snippet prints the country
selected when it runs (your rule of 2026-10-10); `scripts/reads-print-their-country.test.ts` runs
each one here, under four selections, and fails if it does not.

**T: what the institution box offers for what is typed, with the country it was typed under.** Run
while its dropdown is open. (As in P294.)
```js
JSON.stringify({ under: { institutionCountry: document.querySelector('[name="institutionCountry"]').value }, typed: document.querySelector('#institution-ts-control').value, entries: [...document.querySelectorAll('#institution-ts-dropdown [role="option"]')].map(o => [o.getAttribute("data-value"), o.textContent, o.hasAttribute("data-selectable")]) })
```

**G: the grading systems offered after the institution, with the country and institution chosen.**
```js
JSON.stringify({ under: { institutionCountry: document.querySelector('[name="institutionCountry"]').value, institutionCode: document.querySelector('[name="institutionCode"]').value }, gradingSystem: [...document.querySelectorAll('select[name="gradingSystemId"] option')].map(o => [o.value, o.textContent]) })
```

**R: the grade list, with what it was read under.** (As in P294.)
```js
JSON.stringify({ under: { institutionCountry: document.querySelector('[name="institutionCountry"]').value, institutionCode: document.querySelector('[name="institutionCode"]').value, gradingSystemId: document.querySelector('[name="gradingSystemId"]').value }, grade: [...document.querySelectorAll('select[name="grade"] option')].map(o => [o.value, o.textContent]) })
```

**S: the subjects a search returned, with the word searched and the country selected.** Run after
pressing the search button.
```js
JSON.stringify({ under: { institutionCountry: document.querySelector('[name="institutionCountry"]').value }, searched: document.querySelector('[name="subjectSearch"]').value, subject: [...document.querySelectorAll('select[name="subject"] option')].map(o => [o.value, o.textContent]) })
```

Nothing in these snippets trims a value.

**For each country, in this order** (file names: `p298-<read>-<country>.json`):

| Country | Type in the institution box | Their stated scale |
|---|---|---|
| India | `Delhi` | CGPA out of 10 |
| Nigeria | `Lagos` | CGPA out of 5 |
| Pakistan | `Punjab` | CGPA out of 4 |
| Bangladesh | `Dhaka` | CGPA out of 4 |
| United Arab Emirates | `United Arab` | GPA out of 4 |
| Saudi Arabia | `King Saud` | GPA out of 5 |

1. Choose the country. Type the word. With the dropdown open, run **T**.
2. If an entry's text is the student's institution exactly (*University of Delhi*, *University of
   Lagos*, *University of the Punjab*, *University of Dhaka*, *United Arab Emirates University*,
   *King Saud University*), choose it. Otherwise choose **Not in list**. Run **G**.
3. If G holds an entry whose text is the student's scale exactly, choose it and run **R**. If none
   does, say so; do not choose the nearest.

Then, once, under any country: search the subject for `Commerce`, `Economics` and `Finance` in
turn, pressing the search button each time, and run **S** after each. File:
`p298-S-<word>.json`. Then leave the page without saving.

Fifteen to twenty-one reads, by hand, in one sitting: T and G for each country, R where a scale
matches, and S three times.

### What happens with them

- Each is compared with the entry by `scripts/read-against-entry.ts` (`institution-ts-control`,
  `gradingSystemId`, `grade`, `subject`). Each comparison will exit 1, and that is the expected
  first answer, not a fault: the entry holds no read made under these countries (**NO RECORD**),
  each line the entry does not hold is named (**MISSING**), and so is each row the file does not
  hold (**BUILT, NOT IN FILE**). For S that last list is long, because a search returns part of a
  list and the entry's rows come from other searches. Probed here on two made-up files, which are
  not reads and are not committed.
- Under the rule as it stands, each would become rows for your signature, per country. Under
  ADR-0158, if you accept it, the same reads are what the run-time rule is checked against: they
  would be evidence of structure, not rows. Which it is, is yours.
- The measure is then run again, with each list as read, and the table above gets a column for
  ADR-0158.

**What it costs:** nothing metered: no model call and no AWS. Your own browser, on your own
account, reading.
