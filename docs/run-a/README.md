# Run A — the artefacts for one run on Vahid's own account

What is here is data for Run A (`docs/distance-to-a-reviewed-sheffield-run.md`): a synthetic
profile, and later the reviewed catalogue entry. Nothing here is a person, and nothing here is
served to anyone but the one account an `ownAccountOnly` approval names (ADR-0118).

## The synthetic profile — `synthetic-profile.json` (P150)

Vahid, 2026-09-16: *"the synthetic profile: I want to see its values before it seeds."* So the
command that writes it prints first and writes only when told to, and this table is the same
eighteen values, in the profile store's stored shape (a date is `{"$date": …}`):

| Registry field | Value |
|---|---|
| `identity.given_name` | `"Niloofar"` |
| `identity.family_name` | `"Hosseini"` |
| `identity.date_of_birth` | `{"$date": "1999-04-02T00:00:00.000Z"}` |
| `identity.nationality` | `"IR"` |
| `identity.country_of_birth` | `"IR"` |
| `identity.passport` | `{"kind": "none"}` |
| `contact.email` | `"niloofar.hosseini@example.com"` |
| `contact.address` | `{"line1": "12 Valiasr Street", "city": "Tehran", "postalCode": "1966733411", "countryCode": "IR"}` |
| `education.prior_qualifications` | `[{"level": "Bachelor's degree", "subject": "Business Management", "institution": "University of Sheffield", "countryCode": "GB", "start": {"year": 2019, "month": 9}, "end": {"kind": "completed", "date": {"year": 2022, "month": 6}}, "award": {"year": 2022, "month": 7}, "grade": "2:1", "gradeScale": "uk_honours"}]` |
| `employment.history` | `[{"employer": "Pars Novin Trading Co.", "employerAddress": "Unit 4, 8 Mirdamad Boulevard, Tehran, Iran", "position": "Business analyst", "startDate": {"year": 2022, "month": 10}, "end": {"kind": "current"}, "basis": "full_time", "duties": "Prepares monthly sales analyses, maintains the customer database and supports the commercial team's tenders."}]` |
| `residence.country` | `"IR"` |
| `residence.in_uk_now` | `false` |
| `residence.history` | `[{"countryCode": "IR", "from": {"year": 2015, "month": 9}, "to": {"kind": "ended", "date": {"year": 2019, "month": 8}}}, {"countryCode": "GB", "from": {"year": 2019, "month": 9}, "to": {"kind": "ended", "date": {"year": 2022, "month": 7}}}, {"countryCode": "IR", "from": {"year": 2022, "month": 8}, "to": {"kind": "current"}}]` |
| `residence.always_in_residence_country` | `false` |
| `residence.always_in_eu` | `false` |
| `residence.outside_residence_country_last_three_years` | `false` |
| `immigration.uk_status` | `{"british_passport": false, "indefinite_leave": false, "refugee_status": false, "migrant_worker": false, "spouse_of_uk_citizen": false, "eu_passport": false, "spouse_of_eu_citizen": false}` |
| `immigration.uk_study` | `{"kind": "studied", "onStudentVisa": true, "highestLevel": "university", "qualification": "BSc Business Management", "timeOnVisa": {"years": 3, "months": 0}}` |

**Who this is.** A synthetic Iranian national, born 1999, resident in Tehran, holding no passport,
with one qualification — a BSc in Business Management from the University of Sheffield,
2019–2022, a 2:1 — which is a UK study at university level on a student visa (three years, no
current visa), back in Iran since August 2022 and in one job there since October 2022. Every
value is invented. The qualification is Sheffield's because only Sheffield's dependent lists were
read (P132), at his word: *"A Sheffield degree for the synthetic profile."*

**What it types into the application on his account.** The whole of Part 1 as the drafts map it,
including the e-mail address into the personal page's two e-mail boxes. The e-mail here is an
`example.com` address, kept synthetic at his word (*"A real address inside an otherwise invented
profile is the worst of both — not a test and not true"*). **Sheffield may send to that address
and nothing will arrive** — no confirmation, no reminder, no reset link reaches anyone — so
silence from the portal after Run A is not evidence of a portal failure, and nobody later should
read it as one. The passport is *none*, so the nationality page gets the portal's
own *"no passport"* instruction (ADR-0117); a synthetic passport number was not invented.

**Blocker 31 (P154, decided 2026-09-17).** The runner signs in to an existing account with the
profile's `contact.email` (`existingAccountStep`, ADR-0110), so on Run A the seeded address must
be the one his Sheffield account holds, or the sign-in fails as `portal_refused` twice before a
page is touched. Vahid: *"re-seed with my account's e-mail, from the copy outside the
repository."* So **the file here keeps the synthetic address**; his machine seeds a copy of it,
outside the repository, with `contact.email` changed to his account's, after deleting the
synthetic profile's entries for the same student (the command refuses to overwrite). The two
paragraphs above then read differently for Run A: the personal page's e-mail boxes carry his
address, and mail from Sheffield reaches him. The honest product shape — the `existing_account`
declaration carrying the account's own e-mail, distinct from the contact address — is recorded
as **the thing to build** (state document, blocker 31), at his word: *"not as a note."*

**Not held, and why.** `residence.uk_entry_date` — not in the UK now, and the page hides the entry
date for a resident abroad; `immigration.uk_study.currentVisaExpiry` — no current visa, the three
expiry boxes typed empty as the row's own words allow; and every registry field no Sheffield
mapping reads. `scripts/run-a-profile.test.ts` holds that the fixture names exactly the fields the
set reads, that it plans onto the drafts with nothing blocking on Part 1, and that the preview at
the yes reads as it should.

## Seeding it

```sh
pnpm run profile:seed docs/run-a/synthetic-profile.json
#   prints the eighteen values; writes NOTHING

AAS_CONVERSATION_DATABASE_URL=postgresql://…/aas_local_conversation \
  pnpm run profile:seed docs/run-a/synthetic-profile.json --write --subject run-a
#   creates the students row for "run-a", writes the values, prints the studentId UUID
```

The UUID it prints is the identity everything keys on: post it as the dev session's `subject`
(`POST /dev/session`, from the console on `/healthz` — the runbook says why that page), and
write it into the approval's `ownAccountOnly.studentId`. The command
refuses to write for a student who already holds any profile entry — a seed never overwrites
what a person has said.

**Provenance, said plainly.** Every seeded entry is stored with `source: "seeded"` (ADR-0121,
decided by Vahid: *"add the true one. 'Seeded, no interview took place' is a real origin and the
nearest honest word is not it"*) and a `sourceExcerpt` reading *seeded from synthetic-profile.json
by `pnpm run profile:seed --write` on <date>; no interview took place*. A seeded value is not a
student's confirmation and nothing may read it as one; nothing refuses one on any path today, and
the ADR says so.

## The catalogue entry — `catalogue/entries/sheffield-pgt-2027-09.json` (P152)

The thing he signs. Assembled from the two drafts as they stand — blueprint 0.2.25 and mapping
set 0.3.31, byte for byte after parse, which `scripts/run-a-profile.test.ts` holds — plus the
portal-authentication facts of 2026-09-11, `requiredDocuments: []` (the runner attaches nothing
on the international path; the six education slots are the student's own act), the repository's
own refs for the submission key (`inst-sheffield`, `course-sheffield-msc-management-and-
international-business`, `2027-09`) and `passwordDelivery: askimate_secure_channel`.

**It is not signed.** Both artefacts still say `draft`, the set names no reviewer, and
`pnpm run catalogue check docs/run-a/catalogue` refuses the directory for exactly that. The
signature is three acts, his, in this order, after the read below:

1. In the entry file, `blueprint.status` → `"reviewed"`.
2. `mappingSet.status` → `"reviewed"`, `mappingSet.reviewedBy` → `"Vahid Mohammadi"`,
   `mappingSet.reviewedAt` → the moment, RFC 3339.
3. `pnpm run catalogue hash docs/run-a/catalogue/entries/sheffield-pgt-2027-09.json`, and the
   hash into `docs/run-a/catalogue/approvals.json` in the shape the runbook shows, with
   `ownAccountOnly.studentId` = the UUID the seed printed (ADR-0118). Then
   `pnpm run catalogue check docs/run-a/catalogue` prints *admits ONE account only*.

Anything that changes in the entry after step 3 invalidates the approval, which is the point
(ADR-0057). The test that pins the entry to the drafts will go red the moment a draft moves
under a signed entry, which is the signal to decide whether to sign again.

## The read — `what-will-be-typed.md`

Vahid, 2026-09-16: *"give me the human-readable version to read. Not the JSON — the list of what
will be typed into which box, page by page. That is the one review that is actually mine."*
`pnpm run catalogue preview <entry.json> <profile.json>` prints it, in the student's own preview
words (ADR-0059), from the same builder and renderer the run shows at the yes; the committed
file is that output for the synthetic profile, and the test holds that they are the same. A
draft entry is planned as if reviewed and the first line says so.

**Fixed before the signature, at his word (P153, draft 0.2.26):** *"If the labels in the
blueprint are wrong, then the thing I read and the thing I signed are not the same thing."* The
nationality page's radios carry the option labels the third read found (*Yes* / *No*, and the
document-status sentences) where that read's values equal the draft's; the date selects that
share a row with a labelled sibling carry the row's question (*Date of Birth:\** on the day,
month and year; *Start Date:\** and *End Date:* on both boxes), the same one-row-several-controls
shape P131 recorded for the markers; the two hidden selects behind the education boxes are
`frontedBy` the boxes that set them and appear nowhere in the read; and *"This is exactly what
will be submitted"* is gone from every preview, because no run submits (ADR-0014, ADR-0059
addendum). **Still carrying the field's own name, and why:** `fundingNationality`,
`countryOfBirth`, `permanentResidence`, `yearsOnStudentVisa`, `monthsOnStudentVisa`,
`applicationLocation` on the nationality page, and `grade` on the education page — no capture
holds their question (the five-pages read could not reach it positionally; P126), and a label the
file did not carry is not invented. Three radios off a resident abroad's path keep their name too,
because the third read's *No* label ran on into the row's help text (`britishPassport`,
`indefinateVisa`, `livingInUK`). Reading those seven questions off the screen was offered before the
signature and **declined — Vahid, 2026-09-16, in his words:** *"The seven without labels: leave
them. The values sent are right, which is what my signature is about, and a readable label is
for the developer who comes next rather than for Run A. It is exactly the class we cut on 16
September."* So the seven field names in the read are a decision, not an oversight.

## What could still change after a signature

Asked before assembling, answered plainly. Nothing in the entry is one I expect to revise. Four
things in it have never been driven on the live portal, and if any of them is wrong the fix is a
change to the entry, which means signing again:

- **The grading systems following the institution box** (draft 0.2.24): inferred from the
  dependencies read and P102's shape, not observed as a fill.
- **The two Tom Select boxes as fills**: the runner's typeahead was proved on the fixture and on
  the markup he copied (P101), never on Sheffield's page.
- **The subject search**: the word `business` produced the 87 captured results; the runner
  pressing the button and waiting on Sheffield's page is unobserved.
- **The login form's locators** (P91, from the signed-out read): the sign-in path has never run
  against the real portal. It now stops at two attempts (ADR-0120).

A smaller entry that is settled is not available: all four are on Part 1's path, and the
education page is one of its pages. Everything else — every value, the date maps, employment,
the refusals, the language section left as optional — is settled and stays as it is.

**Told and accepted — Vahid, 2026-09-16, in his words:** *"On the four unobserved things:
understood, and I accept that a smaller settled entry does not exist. All four are on Part 1's
path, so signing means accepting that the first live proof of them is Run A itself. That is what
Run A is for. Record that I was told and accepted it, with the four named, so a later reading does
not treat a re-sign as a failure of the review."* The four, named: the grading systems following
the institution box; the two Tom Select boxes as fills; the subject search; the login form's
locators. A re-sign for any of them is Run A doing what it is for, not a failure of the review.

## What Run A found before a student did — step 3, 2026-09-17

The run stopped at `fix content` with no question and no message. The validator objected to
eighteen starred boxes in the language section — the boxes Vahid had saved empty on the live
portal on 16 September, which the plan and the read already treated as not required (the
section's `optional` fact, P147). The validator had never run on this entry: the P150 test
checked the plan's blockers only. Both readings of the page are compared in that test now, the
validator reads the section fact (ADR-0123), **no draft changed and the signature stands**. The
same run found that a `fix_content` with nothing to ask was a silent dead end; it stops for a
person now. Vahid: *"The star is not the evidence. The save is."* This is the whole argument for
Run A existing, and it is recorded here as such.

## What attempt 4 put on a real account — the ADR-0110 mixture, now a fact

Attempt 4, 2026-09-21. The runner signed in through the consent path, filled and **saved** three
pages of Sheffield's real form, and read each one back with every filled value seen:
`personal.do`, `contact.do`, `nationality.do`. It stopped on `education.do?new=true` before any
save, so nothing of the fourth page reached the portal — Vahid confirmed both ends afterwards on
his own account, and section E still lists his two qualifications and no third.

ADR-0110 accepted that a run on an account the student already holds would leave the account
holding a mixture: what the plan fills is the profile's, what the plan leaves empty stays the
account holder's. That was a consequence written down in advance. **It has now happened**, and
these are the fields.

**Changed to the synthetic profile's values** — the boxes the plan fills, from
`what-will-be-typed.md`, which is the signed record of exactly these:

| Page | Boxes now holding the synthetic profile's values |
|---|---|
| `personal.do` | `forename`, `surname`, `dobDay`, `dobMonth`, `dobYear` |
| `contact.do` | `email`, `confirmEmail`, `corrAddress1`, `corrTown`, `corrCountry`, `corrPostcode`, `corrPostcode2`, `corrIntlPostcode` |
| `nationality.do` | the boxes of the nationality mapping set the profile's answers make visible (`visibleWhen`, P90): funding nationality, country of birth, permanent residence, the residence history blocks it fills, the status claims, the passport number, and the UK-study block |

Section A of `summary.do` now reads **Niloofar Hosseini, born 02 April 1999** — confirmed by
Vahid on the live portal, independently of the runner's own read-back.

**Still the account holder's, because the plan leaves them empty and the runner never touched
them** — on `personal.do`, `titleCode` (*Mrs*) and `sex` (*Female*), both unmapped in the signed
entry and both listed under *Left empty* in `what-will-be-typed.md`. So one page of a real
application now carries a synthetic name and date of birth beside a real title and gender.

That is the mixture, exactly as ADR-0110 accepted it, and it is why that decision is scoped to
**his own account and one signature**: on anyone else's account the same mixture would be two
people's details in one application.

## Starting a run in a brand-new conversation, from the raw calls (ADR-0058's two gates)

Verified here on 2026-09-18 against the signed Run A catalogue, as the one student the signature
admits (a `students` row with the approval's own id, on a scratch stack): offer 201, run 201.
Another student gets 404 at the offer. The page's *Apply to this for me* button makes exactly these
two calls, and refuses to make the second with an empty statement box.

```bash
# 1. Gate 1 — ask the server to put the reviewed target to you. The body is a LOOKUP KEY,
#    not an authority: every field of the offer comes from the catalogue entry.
curl -s -b "$JAR" -H 'content-type: application/json' \
  -d '{"blueprintId":"bp-sheffield-pgt-september-direct"}' \
  "$CONVERSATION_URL/v1/conversations/$CONV/target-offers"
#    → 201 { offerHash: "sha256:…", rendered, target }      (404: not admitted, or no such target)

# 2. Gate 2 — your explicit request, naming the offer you were shown. The statement becomes the
#    case's request evidence, so it must be your own sentence.
curl -s -b "$JAR" -H 'content-type: application/json' \
  -d '{"offerHash":"<the offerHash from 1>","studentStatement":"<your sentence>"}' \
  "$CONVERSATION_URL/v1/conversations/$CONV/runs"
#    → 201 { runId, caseId, status, phase, step, … }
#      400 pointers ["/offerHash"]  — the hash is missing or not sha256:<64 hex>
#      404                          — that offer was not made in THIS conversation
#      409 content_changed          — the offer was made and the target has since changed

# 3. Read what the run is waiting for. `pending.decision` names the kind and `pending.contentHash`
#    is the hash the next decision must carry.
curl -s -b "$JAR" "$CONVERSATION_URL/v1/conversations/$CONV/runs"
#    → 200 { run: { runId, step, status, … }, pending: { decision, contentHash } | null, ownActs }

# 4. The two decisions, in the order the run asks for them (ADR-0110, ADR-0101):
curl -s -b "$JAR" -H 'content-type: application/json' -d '{"kind":"existing_account"}' \
  "$CONVERSATION_URL/v1/conversations/$CONV/runs/$RUN/decision"          # → 204
curl -s -b "$JAR" -H 'content-type: application/json' \
  -d '{"kind":"authorise","contentHash":"<pending.contentHash from 3>"}' \
  "$CONVERSATION_URL/v1/conversations/$CONV/runs/$RUN/decision"          # → 204
#    A decision the run is not asking for answers 404 (not_asked); a stale hash answers
#    409 content_changed — re-read 3 and send the hash it shows now.
```

`GET /v1/conversations/$CONV` is the conversation itself (id, title, ordinal) — not the run.
`/reapplication/*` is only for a conversation that already holds a concluded case; a fresh one
answers 404 there, correctly. There is no `/offers` route.

## A third attempt from a fresh conversation, when two cases are already concluded (blocker 46)

Reproduced here on 2026-09-18 on the signed Run A catalogue as the admitted student, two concluded
cases in two conversations, a fresh third:

```
prior-outcome, BEFORE any start on the fresh conversation   → 404   (no binding yet)
target-offers                                               → 201
runs { offerHash, studentStatement }                        → 409 already_applying,
                                                              existingCaseId = the FIRST case, concluded: true
prior-outcome, AFTER that refused start                     → 200, priorCaseId = the LATEST case
reapplication { studentStatement }                          → 201, a new case carrying priorCaseId = the latest
```

**The order is the trap.** `adviseReapplication` and `reapply` begin with `bindings.caseFor(conversationId)`
— the conversation must already be bound to a target — and a fresh conversation has no binding until a
start is attempted. `withBinding` writes the binding (and an empty `cases` row) and **commits it even
when the start is refused** with `already_applying`. So the refused start is what makes the
reapplication pair work, and nothing said so. Then the prior case is found by the **student**
(`#latestAttempt`), which is why it names the latest case while the 409 names the first: the 409
comes from the submission key, held by whichever case claimed it first; the advice comes from the
student's newest attempt. Two routes, two answers to "which prior case", both true.

So the way through, from the raw calls: offer → runs (expect 409) → prior-outcome → reapplication.
Then the read and the two decisions as above.

## Warning to the next reader: this sequence has not been walked to the end

**Nobody has taken this document past step 5 by hand.** Steps 1 to 5 — session, offer, request,
account declared, authorisation — were walked by Vahid on 2026-09-18 and work. Step 6, the
sign-in, was reached and failed twice against the real portal. **Everything after step 6 is
untested by a person**, and everything about recovering from a failure was wrong when he tried
it: three separate resume sequences were given and none worked, because the behaviour they
described existed only in tests, or not at all.

Four defects on that path are open as blockers 37 to 40: a run stopped for a person cannot be
resolved; the stop message tells a student we created an account when they declared their own;
the route back after a stop is a refusal the student must trigger, documented nowhere; and a
stop cancels the case while leaving the run escalated, which leaves the page with no exit.

Treat every instruction below step 5 as a proposal until someone has walked it. That is what
Run A is for, and it is the honest state of this file.

**Walked by Vahid on 2026-09-18, later the same day, and now known to work:**

- **The repair.** `scripts/local-stack.sh finish-stopped <conversationId>` concluded the first
  pre-P158 case on the first run (ADR-0126, blocker 44).
- **The re-application, from the two raw calls.** Once the prior case is concluded,
  `POST …/reapplication/prior-outcome` then `POST …/reapplication` open a new case end to end.
  Blocker 42's 403 does not fire for a concluded prior case; what remains of 41 and 42 is the
  silence when something genuinely IS outstanding.
- **The runner's log, on the repeat.** The second run's first sign-in attempt printed the start
  line, then *"sign-in failed at the submit and the load that follows — TimeoutError: the step
  timed out"*, then `failed (runner_fault)`. ADR-0124 did its job: the failure is a reading now,
  not a deduction. It is `TimeoutError`, not the "execution context destroyed" the race hypothesis
  predicted — so the submit/load race is exonerated, and it was right not to fix it on a guess.
  And the reading behind it was wrong too: the load wait had resolved at once on an already-loaded
  page and guarded nothing; the click's own clock expired. ADR-0127 splits the submit into the
  press and the answer, each named, so the next line is a reading of which.
- **Attempt 2, with the split:** *the sign-in button could not be pressed … the password box is
  still on the page.* The press. Something is over the button on a page no capture has read.
  ADR-0128: read it as the runner (`--as-runner --covering name=loginBtn`, runbook) before anything
  in the runner learns to push past it. The run is with a person; attempt 3 is a fresh conversation
  once the read names the thing.
- **The as-runner read (dd12175):** nothing over the button as the page opens. Fourth hypothesis,
  tested, wrong. ADR-0129: the runner now reads the point at the moment the press fails and names
  which check was pending. Attempt 3 is the reading of the thing itself; leading candidate, with its
  caveat, in the capture's README.

Blockers 37 to 40 in the paragraph above: 40 is closed (ADR-0125), 44 raised and closed
(ADR-0126); 37, 38 and 39 stay open.

## What Run A proved before it stopped — the sign-in, 2026-09-18

The run reached the portal and stopped at the sign-in, twice, with `runner_fault`. A stop at the
last step of a sign-in is not the same as a stop at the first, and the record should say how far it
got. Nine things this run established, every one of them previously unobserved against the live
portal, and all but the last from Vahid's own machine rather than a test:

1. **robots.txt was fetched and allowed the login page.** A disallow would have been
   `robots_disallows`, not `runner_fault`, and nothing would have opened.
2. **The runner reached `www.sheffield.ac.uk`** and the login page loaded inside fifteen seconds.
3. **No CAPTCHA and no second factor** stood on the login page: the challenge probe runs before a
   character is typed and found neither.
4. **The e-mail box matched the blueprint's locator** authored in P91 from the signed-out read.
5. **It accepted the account's address**, which is the re-seed from blocker 31 working end to end.
6. **The submit button matched its locator**, resolved on the live page.
7. **The secure box, the vault and the fill agent worked against a real portal:**
   `secret_received` then `secret_consumed`, twice, each for a password typed once and spent.
8. **The fill agent typed the password into the real password box** — the Secure Plane's whole
   path, from the student's keystroke to a portal input, on a live site for the first time.
9. **ADR-0120's cap did exactly what it was built for:** two attempts, the student told which
   attempt and what happened, the run stopped for a person, nothing submitted, and nothing on the
   Sheffield account that Vahid could see.

What it did not establish is why the submit failed, because the error was discarded by a bare
catch. That is ADR-0124, built the same day. The run stays parked with a person until one repeat
with the logging in place.

## The third conversation, 2026-09-18: attempt 1 named the overlay, attempt 2 signed in, the first page fill was uncertain

Conversation `01M2TP83VDZB1EM323S0RWJ8TE`, started through the blocker-46 sequence above. Two
sign-ins, both by Vahid, both with the P162 line in place:

```
attempt 1: sign-in failed — the sign-in button could not be pressed — TimeoutError: the step
           timed out; pending: another element intercepts pointer events; the password box is
           still on the page; at the button's point: div#ccc-overlay (fixed, 1280×720 at 0,0)
           > input (static, 130×21 at 238,566)
attempt 2: sign-in/work succeeded
then:      uncertain (runner_fault)
```

**What attempt 1 measured.** `div#ccc-overlay`, fixed, the full 1280×720 viewport at 0,0 —
Civic CookieControl's backdrop — was the top layer at the button's point, and Playwright's pending
check was *another element intercepts pointer events*. The fifth hypothesis on this step, and the
first one measured rather than reasoned. The button was at y=566, not the y=690 of the as-runner
read: the bottom-bar candidate is withdrawn (the capture README of 2026-09-18 carries the
correction). Attempt 2 pressed through and signed in, and nothing was read at that press, so
whether the overlay arrived late or never appeared is **not known**. Option 0 below measures it.

**What "uncertain (runner_fault)" was.** The first page fill after the sign-in — Personal
details, `personal.do`, the first page in the signed blueprint with fields and no credential field.
The code comes from two places, the Save press throwing or a throw out of the fill, and the fill
wrote no line to say which: P157 gave the sign-in its lines and left the fill silent. P163 closed
that (ADR-0124, amended). The read-back was never reached: its own refusal is `not_recorded`.

**What the portal shows.** Vahid opened the page in his own browser: the twenty fields hold his
own details, none of them the synthetic profile's. So nothing reached the portal, `uncertain` was
the honest report, and the run did not press Save twice on a page that might have saved. The
intervention is open and unresolved at his word (`--did-not-happen` when it is), because a
resolution opens the password box within seconds and the third password should wait for the fill
log, option 0 and option 2.

**Two records, in his words, without the values he typed.** First: *"Run A writes a synthetic
person into a real person's application. That was accepted (ADR-0110, the profile is synthetic,
the account is mine) and it stays accepted, but the record should say plainly that after a
successful Run A this account will hold a mixture of both, and that is the cost of using my own
account rather than a created one."* Recorded as stated. Second, on the education listing that
already holds two entries of his: the listing read-back compares **after against before plus
one** (`packages/execution/src/verify.ts:78`), so on his account it expects three where it counted
two. A total against the plan is not what it does; a returning student's existing entries are
counted before the fill and not against it.

**The overlay: decided by Vahid, 2026-09-18.** Six options were put to him with their costs
(state doc, blocker 47). His words:

- *"Option 0 always, option 2 on top of it. Not 3."*
- Option 0, unconditionally: *"We do not know why the overlay was absent at attempt 2, and
  anything built on top of an unmeasured absence is built on a guess. Read the point at a
  successful press as well as a failed one, and once as the login page opens, so attempt 3 names
  it either way."*
- Option 2, the student decides: *"a cookie choice is a choice made on the student's account, in
  their name, against an institution that may one day be asked what they consented to. A system
  that asks for a yes before typing a date of birth cannot decide this one by itself."* Two
  conditions: *"The choice is per portal and it is durable, but it is not permanent. A student who
  chose once on Sheffield should not be asked again on Sheffield, and should be asked afresh on
  Manchester. And they must be able to see what they chose and change it — not buried, but
  somewhere they can reach."* And: *"the question must be answerable by someone who does not know
  what a cookie banner is. Not 'what is your consent preference' — what the banner actually
  offers, in the portal's own words if they are quotable, with what each means in plain terms. If
  the honest version of that question is three sentences long, it is three sentences."*
- Option 3, a fixed minimal choice, **refused**, and he wants the reason kept because it will be
  proposed again: *"'We declined non-essential cookies for you' is still a choice we made. Telling
  the student afterwards is not the same as asking. The convenience is real and the principle is
  the one this whole system is built on."*
- Options 5 and 6, **refused** with my reasons, which he adopted: pre-setting the consent cookie is
  *a fabricated consent record* on the student's account; removing, hiding or force-pressing
  through the overlay is *an assertion that a person clicked where a person could not*.
- Option 4, not loading the consent script: agreed not to build.

Build order, his: the fill log (P163), then option 0 (P164), then option 2 (P165), each
estimated separately and stopped at twice.

**The label.** The plane counts failed sign-ins and a sign-in that holds ends the count
(ADR-0120). The runner's line printed the count plus one as `attempt N`, so the next sign-in on
this conversation would have read `attempt 1`. Fixed in P163, words only: the line says
`failures in this episode: N of 2 allowed`, the student hears no ordinal. What this week's numbers
meant, with dates, is in the capture README.

## What P163 to P165 changed for attempt 3, and what still waits (2026-09-18)

- **The fill says what it did** (P163, ADR-0124 amended): a line at every place a page fill can
  stop, the Save press named with what stood at the button's point, the read-back and what was
  not seen. The two sources of `uncertain (runner_fault)` are two lines.
- **The sign-in count is named for what it is** (P163): `failures in this episode: N of 2 allowed`;
  the student hears no ordinal.
- **The point is read at every press** (P164, ADR-0130): as the login page opens, just before
  the press, and at a failure. Attempt 3 names the overlay or its absence whichever way it falls.
- **A consent notice is answered only with the student's own choice** (P165, ADR-0131). The
  mechanism is whole on the fixture. **The Sheffield entry does not yet record its notice**: its
  words and buttons have never been read (the 2026-09-18 capture had no notice on the page), so
  on attempt 3 a press the notice intercepts still stops for a person, and its line now says so
  with the notice named. To close it: a read of the notice when it is present (runbook, "Reading
  a portal's consent notice"), the entry's `authentication.consent` authored from it, and Vahid's
  signature on the changed hash. Then a fourth sign-in meets the question, the choice is his to
  make on his own account, and the runner presses it for him from then on.

