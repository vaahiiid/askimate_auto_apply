# Sheffield PGT application — the first real read, 2026-09-10

**What this is.** The record of the first attached inspection of a real university form
(P79–P80), made by Vahid on his own machine, signed in to the University of Sheffield's
Postgraduate Online Application Form, eleven pages, zero failed. `run.json` and
`blueprint.draft.json` are the tool's own output, unedited. The HTML captures and screenshots
stay on the machine that made them. Nothing here was typed, clicked, uploaded or submitted.

**What this is not.** Not a reviewed blueprint. The draft is a reading; the curated blueprint is
step 4 of the path recorded in `docs/target-sheffield-pgt.md`, and it waits on three things named
at the end.

## The pages, as read

| # | URL | What it is | Controls read |
|---|---|---|---|
| 1 | `overview.do` | Navigation and status. **Not a form page.** The one form on it is the site's search box | 2 (search) |
| 2 | `summary.do` | Navigation and status. **Not a form page.** Same search box | 2 (search) |
| 3 | `personal.do` | Personal details | 27 + search |
| 4 | `contact.do` | Contact details: correspondence and permanent addresses, email, telephone | 35 + search |
| 5 | `nationality.do` | Nationality, residence, immigration status, previous countries, highest qualification, and **five document slots** | 97 + search |
| 6 | `language.app` | English language: first language, qualification, scores, and **one document slot** | 25 + search |
| 7 | `education.do?new=true` | One education entry: institution, degree, subject, dates, grade, and **six document slots** | 54 + search |
| 8 | `employment.do` | One employment entry | 9 + search |
| 9 | `equalOpportunities.do` | Disability and ethnic origin | 16 + search |
| 10 | `marketing.do` | How you heard of us; other institutions applied to | 12 + search |
| 11 | `documents.do` | **Five "other" document slots** with descriptions | 12 + search |

So: **nine form pages** of Part 1, two navigation pages, and **Part 2 (course choice) not read**.
The site's search form (`query`, `btnG`) appears on every page as the first `<form>` and is
excluded from the blueprint by design; it is not the application.

Every form page carries `saveBtn` and `backBtn` (by name and id). The draft builder's advance
control heuristic picked `saveBtn` on three pages and an empty label or a stray label on the
other six; the curated blueprint sets it to `id=saveBtn` on all nine.

## Fields that depend on other fields

Vahid, from the run: *"a POST to `getGradingSystemsForCountry.do` on sheffield.ac.uk itself. The
education page fetches grading systems when a country is chosen, so some fields depend on others
being set first."* Every dependency of that shape the structure shows, and which kind it is:

### Options loaded from the server after another field is set — the shape that breaks a fill

All on the **education** page, one chain:

```
institutionCountry (select, 256)
  → institution-ts-control (a typeahead search box, "Search for an institution...")
  → institutionCode (select, id "institution": ONE empty option in the capture)
  → gradingSystemId (select, id "gradingSystems": ONE option, "Enter your institution to see grades")
  → grade (select, id "grades": ONE empty option)
```

and, beside it:

```
subjectSearch (text) + subjectSearchButton
  → subject (select: "Enter a search" | "Not in list")
```

The refused request was `POST getGradingSystemsForCountry.do?institutionCode=&noCache=…` with an
**empty** `institutionCode`, fired while the page loaded: the lookup runs on load as well as on
change. A fill that sets `gradingSystemId` before the institution is chosen and the lookup has
answered sets a field with no options. The blueprint schema today has `visibleWhen` for show/hide
and **no vocabulary for "options arrive after"**; that is a gap to raise before step 4, not a
detail for the reviewer to remember.

`institutionCountry-ts-control` and `institution-ts-control` are Tom Select typeahead controls: the
`<select>` behind them is hidden and the visible box is a text input that searches. The fill
executor types into locators the blueprint records; typing into a typeahead and choosing from its
list is a mechanism it has not met. Recorded as a second gap for step 4.

### Shown or hidden by another field, options static — a fill order, not a load

| Page | Set first | Then |
|---|---|---|
| personal | `takenCourseAtShefUni`, `appliedBefore` (radios) | `registrationNumber`, `previousCourseName`, `previousApplicantNumber` |
| personal | `nameChanged` | `previousForename`, `previousSurname` |
| contact | `corrCountry` | UK postcode (two boxes, `corrPostcode` + `corrPostcode2`, maxlength 4 each) or `corrIntlPostcode` |
| contact | `sameAddressCheck` | the `perm*` address fields |
| contact | `corrContactDateType` (radios) | `corrStart*` / `corrEnd*` date selects |
| nationality | `qualificationLevel` (7 levels) | one of five `highestQualification(...)` selects, or `highestQualificationOther` |
| nationality | `livedOutsideCountry`, `alwaysUKResident`, `alwaysEUResident` | `dateEnteredUK*`, `previousCountry1..4` with from/to dates |
| nationality | the immigration radios (`britishPassport`, `indefinateVisa`, `refugeeStatus`, `migrantWorker`, `spouseOfUKCitizen`, `euPassport`, `spouseOfEUCitizen`, `livingInUK`, `previousStudentVisa`) | `passportNumber`, `yearsOnStudentVisa`, `monthsOnStudentVisa`, `visaExpiry*`, and which document slots apply |
| language | `previousEnglishEducation` | `previousEducationLanguage` |
| language | `englishQualTypeCode` (42 types) | which score boxes apply (`overallScore`, component scores) |
| every document slot | its `…Status` radio (upload now / later / not providing / not required) | the file input |
| education | `degree` = "Not in list" | `unlistedDegree`; likewise `unlistedInstitution`, `unlistedSubject`, `unlistedGrade` |

These are read from names and option lists. Whether each is an inline handler, a script listener
or server-side is what `pnpm run inspect-dependencies <run>` reports from the HTML on Vahid's
machine; its output is the confirmation, and it is not in this directory.

## The sixteen refused requests

| Rule | Count | What |
|---|---|---|
| host | 10 | `www.googletagmanager.com/gtm.js` — Google Tag Manager, loaded on every page |
| host | 1 | `tags.srv.stackadapt.com/js_tracking` — an advertising tracker |
| method | 2 | `POST tr.snapchat.com/p`, `POST tr6.snapchat.com/p` — Snapchat pixel |
| method | 1 | `POST mc.yandex.com/watch/…` — Yandex Metrica |
| method | 1 | **`POST www.sheffield.ac.uk/postgradapplication/getGradingSystemsForCountry.do`** — the finding above |

Fifteen are the page's own analytics and advertising tags reaching out from a signed-in
application form; three of them are third parties attempting POSTs from the page. The guard
refused all of them before they left the machine. One is the portal itself, and it is the one
that matters. `inspect-discovery`'s line *"16 state-changing requests were blocked"* counts host
refusals as writes; that wording predates the rule field and overstates it.

## The two open questions, against what was captured

### Who sets the password

**Settled 2026-09-11, by the second of the two observations below — Vahid's direct statement,
verbatim:** *"Password: student_chosen, confirmed by observation not inference. I created the
account myself and I typed the password I chose. Sheffield did not email me one."* `student_chosen`.
The rest of this section is left as it was written on the captures alone, because it says what
they could and could not support; the registration read is now for the locators, not for this.

**What the captures support.** An account with a password exists — Vahid saw a *Change Password*
link on the overview page. Nothing on the eleven pages carries a password field or a word about
how the first one was set, and the run did not read the registration or login page.

**What they cannot settle.** Whether the applicant chose that password at registration
(`student_chosen`) or the portal issued one by email that the applicant may later change
(`portal_issued`). A change link is consistent with both.

**What would settle it.** Two observations, either sufficient:

1. The registration page, read in a **second, fresh profile that is signed in to nothing**, with
   the same tool: `pnpm run inspect:attached sheffield-pgt-2026-09 --cdp http://127.0.0.1:9223
   <login URL> <registration URL>`. A password box and a confirm box on registration is
   `student_chosen`; a registration that takes name and email and says the details will be sent
   is `portal_issued`. The same read gives the `registration` and `login` locators the reviewed
   entry needs.
2. Vahid's own account creation, stated in his words: whether he typed a password when he
   registered, or received one by email. He made the account; that is an observation, and the
   record can carry it as his statement rather than as an inference from a link.

### Three course choices

The overview page states three course choices per application, not necessarily submitted at the
same time (Vahid's reading; the page text is in his capture, not in this directory). Part 2 was not
read.

**What it implies for the key** `(studentId, institutionId, courseId, intake, attemptOrdinal)`:
each course choice is its own submission, so three submissions are three keys, and the key needs
no change for that. What it strains is the **case**: this repository's case is one application to
one course, and it authorises a preview of everything that will be typed. On Sheffield's shape,
Part 1 — nine pages of personal, contact, nationality, language, education, employment,
equal-opportunities, marketing and documents — is one record on the portal, shared by up to three
course choices. Three cases would each carry Part 1 in their preview and would each try to type
it, into a record the first one already saved. One case with three targets would authorise Part 1
once and each course choice separately, which is what the portal's own Submit buttons look like.

**Not decided.** The evidence points at *one application with three targets* and it is not enough:
Part 2's own structure — whether a course choice is a form of its own with its own Submit, and
whether Part 1 is locked once the first choice is submitted — is what discovery must read before
the model changes, per Vahid's instruction in the target file.

## The plain-terms account

**How many real pages.** Nine form pages in Part 1, in this order: personal, contact,
nationality, English language, education, employment, equal opportunities, marketing, documents.
Two of them are **entries** rather than pages — `education.do?new=true` is one qualification and
`employment.do` is one job, and an applicant adds as many as they have. The blueprint's page model
is one page per URL; a repeatable entry is a third gap for step 4.

**Which fields are mandatory.** The portal marks mandatory fields with `*` in the label and
enforces them on save, not in the markup: no control in 309 carries a `required` attribute, which
matches the public statement that incomplete sections are prompted back at submit. Where the tool
could read labels, the asterisks say:

- personal: first name, family name, date of birth (day, month, year)
- contact: e-mail, confirm e-mail, address line 1, town, country, UK postcode (UK only)
- employment: start date, job title, employer name and address, duties (max 4,000 characters)

On **five of the nine pages** — nationality, language, education, equal opportunities, documents
— the tool read no labels at all (the label came back as the field's name), because the markup
does not tie its labels to its inputs in a way the observation script recognises. The asterisks on
those pages are in the screenshots, not in the draft, and the reviewer authors them from there.
Marketing read its two labels; its `otherInst*` boxes have none.

**Where documents are uploaded.** Seventeen file inputs across four pages, each paired with a
status choice (upload now / later / not providing, and on language also *not required*):

| Page | Slots |
|---|---|
| nationality | passport scan, visa scan, utility bill scan, proof of UK spouse, refugee proof |
| language | English certificate |
| education (per entry) | certificate, transcript, official certificate translation, official transcript translation, certificate translation, transcript translation |
| documents | five "other" slots, each with a description box |

No `accept` attribute on any of them, so the permitted formats are not in the markup. The
statement S3 in the target file — documents are uploaded into the relevant sections of the form —
is confirmed by structure.

**What surprised me.**

1. **The observation script misread six postcode boxes as one-time-code inputs** and wrote an
   `mfa` handoff point on the contact page. `corrPostcode`, `permPostcode` and their neighbours
   matched a heuristic on the word "code". There is no second factor on that page. The heuristic
   was wrong and is fixed in P82: the name has to be a code field, as the runner's challenge
   detector already required. A re-run would not write that handoff point, and it does not enter
   the curated blueprint. The draft here is left as the tool wrote it.
2. **`account_creation` signals from the word "register"** on the education and equal-opportunities
   pages. Noise from page text, not an account-creation control — a substring match, most likely
   on "registered" or on script text, both of which P82 stops counting. A re-run would not
   produce those two signals either.
3. **The grading lookup fires on page load**, with an empty institution — so the page is built to
   re-query, and the fill must wait for the answer after choosing the institution.
4. **Typeahead widgets** for country and institution on the education page. The fill agent has
   never typed into one.
5. **The English-language page is `language.app`**, a different suffix from every `.do` page —
   possibly a different framework behind it. Its controls read normally.
6. **Third parties on a signed-in application form**: Google Tag Manager, StackAdapt, Snapchat and
   Yandex tags load on every page and three of them try to POST. All refused here. A real applicant's
   browser sends them.
7. **HESA number and Unique Learner Number** boxes on the personal page; a **passport name
   confirmation** checkbox; **up to four previous countries of residence** with date ranges inline
   on the nationality page; a **4,000-character duties** box on employment.
8. Country lists differ by page: 260 options for a contact address, 243 for nationality, 256 for
   an institution's country, 262 for permanent residence. Four lists, four reviewed constants to
   map, not one.

## The dependencies output, confirmed — 2026-09-11

`inspect-dependencies.txt` beside this file is `pnpm run inspect-dependencies` as Vahid ran it
on his machine: 129 inline handlers, no select empty in the capture, no endpoint named by a
script. It confirms the static-dependency table above handler by handler, and it settles three
things.

**The education chain is confirmed by handler, not inferred.** `institutionCountry` → `onchange:
institutionChanged()` → `institutionCode` (one option, blank) → `gradingSystemId` → `onchange:
loadGrades()` → `grade` (one option, blank); beside it `subjectSearch` → `searchSubjects()` →
`subject` (two options: *Enter a search*, *Not in list*). Four selects sit with no real option
until the one before them is set and the server has answered — three by lookup, one by search.
The lookup fires on load too, with `institutionCode=` empty, which is the refused POST. What the
blueprint has to carry is **an order and a wait**: set the earlier field, wait for the later one's
options to change, then set it. The schema has neither word; this is gap 1 for step 4, and the
curated draft records these four fields without any condition rather than a wrong one.

**Attaching a document is two acts, and the page does the second one itself on sixteen of the
seventeen slots.** Sixteen file inputs — five on nationality, six on education, five on other
documents — carry `onclick` **and** `onchange` handlers that tick their own *upload now* radio
(`…UploadRadio`). The seventeenth, the English-language `certificate` on `language.app`, carries
no handler at all; there the four `certificateStatus` radios (*now* / *later* / *not providing* /
*Not Required*) are set by hand and each re-runs `elqTypeChanged()`. And on `documents.do` the
radios the handlers name were **not in the captured form** — the draft has no radio on that page —
so on five slots the radio's existence is known from handler text only; the reviewer confirms it
from the screenshot.

What the runner does today: `attach()` calls Playwright's `setInputFiles`, which dispatches
`input` and `change` on the element. So on the sixteen, the page's own `onchange` would tick the
radio — done by the portal's script, not by the runner, and **verified by nothing**: the runner
does not read the radio afterwards, and the language slot would be left on whatever it was. If a
fill did only the first act and the script did not fire, the upload may not register on save.

What the blueprint has to carry, per slot: **(a)** the file input, which it has, as a
`requiredDocument` and a field; **(b)** the status radio group as a field, with its options and
the stable `id` of the *now* option where captured (education and language have ids;
nationality and other documents came back name-only); **(c)** the relation — *this radio's "now"
option accompanies this file input* — which the schema cannot say. A `constant` mapping of *now*
on the radio is right only when a document is mapped to the slot, and a constant that is
conditional on another mapping is a fourth vocabulary gap. The curated draft carries (a) and (b),
in DOM order, radio directly beside its file input, and names (c) here. A runner that verifies the
radio after attaching is a build item on the attachment path (P73–P74), raised, not built.

**The equal-opportunities page asks Article 9 questions.** Eleven disability checkboxes, a
support-needs box and an ethnic-origin select. That is Vahid's decision, written up as
[`decision-sheet-article-9-fields-a-portal-asks-for.md`](../../decision-sheet-article-9-fields-a-portal-asks-for.md)
(blocker 20). Decided by Vahid on 2026-09-11 and built as ADR-0102: the empty save is refused, so
the fill uses the refusal the form offers — *Prefer not to say* for disability, and for ethnic
origin the option the live dropdown shows, which he is confirming (the capture holds `998 — Prefer
not to say`; *Information withheld* is the label's wording). The curated draft, 0.2.1, classifies
the fourteen fields on this page `special_category`, and 0.2.2 classifies the other 202 `ordinary`
as proposals for review. Vahid confirmed both values from the live dropdown on 2026-09-11 and
corrected his own words (ADR-0102). The page's mapping set is
`mapping-set.draft.json` — one set for the whole blueprint, since a plan reads one; P89 added the
personal and contact pages to it, as far as the registry reaches. The review pack for Iman is
`review-pack.md`; `scripts/sheffield-draft.test.ts` holds both drafts to the real checks.

## The curated draft — `blueprint.draft.curated.json`, version 0.2.0

Built 2026-09-11 from `blueprint.draft.json` (the tool's, unedited beside it) with the course and
intake Vahid supplied. Status **draft**; `checkExecutable` refuses it (`not_reviewed`), as it
should. It parses under the catalogue's `parseBlueprint`. Every change from the tool's draft:

- `courseName` MSc Management and International Business; `intake` `2027-09`; version 0.2.0.
- The site-search form (`query`, `btnG`) is dropped from every page; `saveBtn` and `backBtn` are
  dropped as fields and `saveBtn` becomes every form page's `advanceControl` (the tool had a blank
  label locator on five pages and the wrong label on education). `nextPageRef` chains page 3 to
  page 11 in the order the form presents them; page 11 has no next, because Part 2 is unread.
- The overview and summary pages stay, as observed URLs with no fields, titled as navigation.
- Radio inputs that share a name are one `radio` field with `options`; the option `value` is the
  captured `id` where there was one and otherwise the label, **not the submitted value**, which the
  capture does not carry. The reviewer completes those. (P88 fixed the tool: a re-read groups the
  radios itself and records each input's submitted value. This draft predates that.)
- Where the captured label carries the portal's `*`, the field has a `required` validation with
  source `specialist_noted` — authored here from the label text in this same file, for the reviewer
  to confirm; thirteen fields, all on personal, contact and employment. The five pages whose
  labels were not read carry none, so their asterisks are the reviewer's from the screenshots.
- `visibleWhen` on twelve fields, only where the condition's value is in the captured options:
  the previous-name and previous-application fields on personal, the UK and international
  postcode boxes on contact, and `unlistedDegree` on education. The rest of the static table
  above is not encoded, because a wrong condition is worse than none.
- Seventeen `requiredDocuments` keep the portal's field names and get plain labels;
  `acceptedFormats` stay empty (not stated by the markup) and `required` false.
- The tool's `mfa` handoff is not carried (P82). `handoffPoints` is empty.
- `authentication`: required, account creation required, the password answer in Vahid's words,
  and no `loginUrl` or login form until the signed-out read.
- `unobservedClaims` is the target file's claims list as it stands, answered ones included.
- Blank option labels (the portal's *please select* entries) are named so the parser accepts them.

**What is not in it, by design:** the order-and-wait for the four dependent selects (gap 1); the
typeahead fill for `institution-ts-control` (gap 2); the repeatable entry for education and
employment (gap 3); the companion radio relation (gap 4); any mapping; any Article 9 decision.

## What step 4 still needs

1. ~~The course and the intake year~~ — supplied by Vahid, 2026-09-11: MSc Management and
   International Business, September 2027 (`2027-09` in the target file).
2. The registration and login pages, read in a fresh profile (above), for the `registration` and
   `login` blocks. The password question no longer waits on it (settled above). **Exactly this,
   and not more** — Vahid, 2026-09-11: *"tell me now what you need from it so I do only it and
   not more"*:
   - A second Chrome profile, signed in to nothing, on its own port: the runbook's flags with
     `--remote-debugging-port=9223` and a new `--user-data-dir`. Nothing of his is in that session.
   - Four URLs, copied from the address bar, in this order: (1) the entry point
     `https://www.sheffield.ac.uk/postgradapplication` — where a signed-out person lands is the
     login page, and its URL is the second; (2) that login page, as it lands; (3) the *register* /
     *create an account* page linked from it; (4) the *forgotten password* page linked from it.
     Both (1) and (2) go on the list: the tool refuses a landing URL that is not on it.
   - Type nothing, submit nothing, create nothing. The tool cannot, and he need not: an account
     exists. The read is of the empty forms.
   - `pnpm run inspect:attached sheffield-pgt-2026-09 --cdp http://127.0.0.1:9223 --out <dir>
     <url1> <url2> <url3> <url4>` after `git pull`. It captures `pages/*.html` (values scrubbed),
     screenshots, `blueprint.draft.json` and `run.json`; look at the pages first, then send the
     directory. That gives the `login` and `registration` locators, whether registration asks for
     a password twice (which the statement already answers, and the capture will show), whether a
     CAPTCHA is on either page (AUTH 6), whether a magic link or emailed code is offered (AUTH 3),
     and what the reset page asks for (AUTH 7).
   - Not needed: signing in, the reset e-mail, any page past those four, Part 2 (a separate read
     in the signed-in profile, item 3).
3. Part 2 — course choice — read the same way, for the three-choices question and the submission
   boundary.
4. ~~`pnpm run inspect-dependencies` output from Vahid's machine~~ — received 2026-09-11, in
   `inspect-dependencies.txt`, read above.
5. Four schema gaps raised and decided: options that arrive after another field is set; a
   typeahead as a fill mechanism; a repeatable entry (education, employment) as a page shape; a
   companion field whose value follows another act (the upload radios).
6. ~~Blocker 20 — the Article 9 fields~~ — decided and built (ADR-0102); the page is mapped.
7. **The employment page's four required fields have no profile field** — start date, position,
   employer name and address, duties. The registry (`packages/profile`) collects no employment
   history, so nothing can be mapped, the interview cannot ask, and the plan blocks `no_mapping`
   on all four. Adding fields to the registry is a product decision about what the profile
   collects, with each new field classified; raised in P89, not made.
8. The country select's option map is partial — eight countries whose names the capture shows —
   and refuses to render any other; the reviewer extends it from the captured option list.
