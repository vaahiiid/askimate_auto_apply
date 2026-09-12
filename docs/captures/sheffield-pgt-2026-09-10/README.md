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

## Vahid's live read of 2026-09-11 — three pages, confirmed against the capture

His report, in his words, and what the JSON capture (`blueprint.draft.json`, `run.json`,
`inspect-dependencies.txt`) confirms, cannot see, or contradicts. The three screenshots did not
reach the repository; nothing below relies on them.

**How the education page reaches a second entry.** *"Enter one qualification, click 'Save And
Continue', and you are taken back to the Your Details page. To add more, click 'Add another
qualification' from there and repeat."* The capture confirms the shape from the other side: the
page the tool read is **`education.do?new=true`** — a *new entry* URL, read as an empty form —
and `summary.do` is the page it returns to. So the continuation control is on `summary.do`, as
he says, **and the shape as built does not need it**: a repeating page is reached each time
through its own URL (ADR-0103 gap 3, "its own *new entry* URL or *add another* control"), and
`?new=true` is that URL. ~~Not a fifth gap, on one condition the next read settles: after one
qualification is saved, opening `education.do?new=true` directly must open an empty form, not
the saved entry.~~ **Condition met — Vahid, 2026-09-12 (P103):** *"I filled one qualification,
pressed Save and Continue, was returned to Your Details, then typed education.do?new=true
straight into the address bar and got an empty form."* His closing, in his words: *"The
repeat's continuation does not live behind the link on summary.do — the new-entry URL works on
its own, and the built shape walks to a repeating page's own URL per item. Not a fifth gap."*
The draft stays as it was: `page7` carries `repeats` with no `addAnother`. His caveat, and what
depends on it, are under *The education page after a save* below.

**The document slots.** *"Four slots, not six … all four asterisked … the two translation groups
have a fourth option the others do not: 'My certificate is in English' / 'My transcript is in
English'."* The capture holds **six** file inputs on the page — `certificate`, `transcript`,
`officialCertTranslation`, `officialTranTranslation`, `certificateTranslation`,
`transcriptTranslation` — each with its own four-option radio group and its own handlers
(`inspect-dependencies.txt`, form 2, 61 controls). The page shows four rows, so two inputs are in
the DOM and not shown, and the capture cannot say which two or what shows them; the draft keeps
all six until the next read says. The capture holds **no labels** for this page's radios (each
reads as its field name) and **no asterisks** (no `required` attribute was captured), so the
option wording and the asterisks are recorded here on his report alone. The *in English* option
is a fact about the rule, not only the draft: under ADR-0104 the slot is the student's act, but
the radio group beside it is a separate field that a handoff on a repeating page may not name —
the rule admits a handoff on a document slot and on nothing else. **A student whose transcript
is in English answers that group and attaches nothing, and the shape as built cannot say so.**
Proposed, not built: a document slot's companion radio group may be handed to the student
*together with* the slot, so the whole row is theirs. That is an extension of ADR-0104's rule,
and it waits on Vahid's word.

**Accepted formats.** Recorded per page, as the page states them and not from any `accept`
attribute (none was captured): the education page's six slots carry `.jpg .png .gif .pdf .doc
.docx .odf`; `documents.do`'s five carry those and `.xls .xlsx .ppt .pptx .rtf .txt .tif`. The
draft is 0.2.8 for it.

**`documents.do`.** *"Five rows, each a Document Description text box and a file input. No
radio group at all."* Confirmed by the capture exactly: `other1Desc`…`other5Desc` and
`other1`…`other5`, no radio, and a `saveBtn`. The description box is in the draft and
classified; what fills it is a mapping question — a reviewed constant naming the document, or
the student's own words — that waits on the reviewer. **The 50MB total across all documents**
is stated by the page and **not expressible**: the schema carries `maxSizeBytes` per slot and
nothing per page; recorded here, and a page-level limit is a small schema addition if a
reviewer needs it enforced before the fill. **The institution's own words on what must NOT go
here** — education certificates, transcripts and English qualifications belong in their own
sections; course-specific documents belong in Part 2's *Course Supporting Documents* — are a
mapping constraint from the institution and bind the reviewer: nothing mapped to these five
slots may be a certificate, a transcript, a language result or a course-specific document.
That last is the first mention of a document slot in Part 2, for its read.

**The typeahead.** *"Institution is a 'Search for an institution...' box. Subject is a different
shape: a Search box, a Search button, and a Results select."* Confirmed: `institution-ts-control`
(placeholder *Search for an institution...*) and `institutionCountry-ts-control` are the two Tom
Select boxes, and both are marked `typeahead` (P95). **Subject is not a typeahead.** The capture
has `subjectSearch` (text, Enter-key handler), `subjectSearchButton` (`onclick: searchSubjects()`)
and `subject` (a select that reads *Enter a search* until the search has run) — a
search-then-select. P94 marked `subject` as `optionsAfter: subjectSearch`, which is half of it:
the wait for the option is right, and the **press of the Search button between typing and
waiting is not expressible** — the runner presses only a page's advance control and a repeat's
*add another*. Proposed, not built: `optionsAfter` carries an optional control to press after
the earlier field is set (`optionsAfter: { fieldRef, press? }`), on the click allow-list because
the plane sent it, as *add another* is. Waits on Vahid's word.

**Both proposals decided and built — Vahid, 2026-09-11 (ADR-0105, P100).** The six status
radios beside the education page's slots are handed to the student with their slots — *"'My
transcript is in English' is not the student attaching something, it is the student answering
the question the slot asks"* — and the preview says so under each qualification. `subject` now
presses `subjectSearchButton` after `subjectSearch` and waits for the option; the control is
named from the dependencies read (`onclick: searchSubjects()`), and the guards on it and their
limit are in the ADR. The four-versus-six slots, the asterisks, the titles and the *in English*
wording stay as his report, for the re-read.

**The Tom Select entry locator — confirmed from the markup Vahid copied, 2026-09-11 (P101).**
He copied the country box's dropdown (`institutionCountry`) from the live page, not the
institution box, since both are the same widget. Its shape, in his words: the dropdown is
`.ts-dropdown` and its list `.ts-dropdown-content`, whose id is the field's name plus
`-ts-dropdown`; each entry is a `div.option` with `role="option"`, a `data-value` carrying the
value the form submits, `data-selectable`, and an id of the field's name plus `-opt-N`; a
selected entry carries `class="option selected"` and an active one `class="option active"`.
The 255 entries are the captured `<select id="institutionCountry">`'s options without its blank
*please select* (256 with it): the count agrees, and the two pairs he quoted — `UNITED KINGDOM` /
*United Kingdom*, `MYANMAR` / *Myanmar (Burma) [The Republic of the Union of Myanmar]* — are in
the draft value for value and label for label, held since P85. The other 253 are not compared.

Three things follow, and the draft (0.2.10, set 0.3.7) carries the first:

- **The locator is per box and by structure, not by class.**
  `#institutionCountry-ts-dropdown [role="option"][data-selectable]` for the country box —
  the list by its id, an entry by its role and its selectable mark. The former locator
  (`.ts-dropdown .option[data-selectable]`) would have matched the entries of *both* boxes on
  the page, since both dropdowns stay in the document while closed, and a text present in both
  lists would have counted twice and been refused. Class never enters: `.option` matched
  `option selected` too, but naming the role and the mark means the state classes he saw are
  not consulted at all. The institution box's locator is written the same way
  (`#institution-ts-dropdown …`, the id from `<select id="institution">`) **on his report that
  it is the same widget and the library's id rule, not from a copy** — see below for what
  would confirm it.
- **The runner matches an entry by the text it shows, never by `data-value`.** Confirmed in
  the code and proven against a fixture that carries his shape (`preparation.test.ts`, P101):
  typing *United Kingdom* chooses the entry and the form then holds `UNITED KINGDOM`; naming
  `MYANMAR` or `IRAN` finds no entry and chooses nothing; the long Myanmar label is matched
  when it is the text; the state classes change nothing. Exact means exact, case included.
- **What the mapping names — raised, not decided.** Today a mapping to either box names the
  visible text, because that is the one string the runner types and matches, and the preview
  shows the student that same text. Vahid's expectation, in his words: *"I would expect the
  mapping to name the value the form submits, and the runner to find the entry by text."*
  That is buildable, and it is the rule selects and radios already follow: the mapping names
  the submitted value; the blueprint's `options` (which the captured select supplies) give the
  label; the runner types the label and chooses the one entry that reads it **and** carries the
  value — a stronger match than text alone. It changes what a mapping to these boxes names and
  what the preview shows, so it waits on his word; no mapping to either box is signed, so
  nothing waits on it.

~~**What the institution box could differ in, and what would settle it.**~~ Settled by his
observation below, the same day; the dropdown markup copy is still to come.

**The institution box, observed — Vahid, 2026-09-11 (P102).** His report, and what was done
with each part of it:

- **How the list loads.** Typing in the box fires a GET, from `education.js` line 105:
  `…/postgradapplication/ajax/institution/search.app?name=Sheff&studyAbroad=false&country=UNITED+KINGDOM`
  — 2.5 kB, 92 ms, 200. The list is fetched *per keystroke* against the typed text **and the
  chosen country**; it is not loaded once when the country is set. His two consequences for the
  wait, both right: the list cannot arrive before something is typed, and the five-second bound
  is measured against a 92 ms round trip, so it is generous on this portal. Two things the
  runner adds. It fills the box in one act, not keystroke by keystroke, so the portal sees one
  request carrying the whole text. And the request is the page's own, so it passes through the
  runner's guard over every request the page makes: an on-target GET is admitted, and it is
  neither a write to record nor a submission endpoint. Whether `robots.txt` says anything about
  `/postgradapplication/ajax/` is **not in this repository** — the file was never read from here
  (P78's egress refusal) and no capture holds it; the run reads it before the browser opens and
  will obey what it says.
- **The dependency, now expressible.** That the request carries the country confirms what the
  handlers implied: the country is an input to the institution lookup. The draft (0.2.11, set
  0.3.8) now says so — `institution-ts-control` has `optionsAfter: institutionCountry-ts-control`
  (the box that is filled, which sets the `<select>` the request reads). **It could not say so
  before this phase**: the usable-set check refused `optionsAfter` on a typeahead as *"a
  typeahead field, which offers no options to wait for"*, and the execution would then have
  waited on the text box as if it were a list, which the runner refuses. Both found by writing
  the observed shape into the fixture and watching the tests fail, then fixed: a typeahead's
  entries follow the earlier field, the order rules and the press apply to it, and the wait is
  the typeahead's own at the fill. The fixture portal's course search now takes a level the same
  way, and the journey walks it.
- **Two entries read identically.** Typing *Sheff* returned eleven entries, and *Sheffield
  International College* twice — different institutions with the same display text, presumably
  different codes. **This is P95's refusal arriving in the first real form**: nothing in the
  visible text can tell the two apart, so choosing either would be a guess, and the runner
  chooses neither and says what was offered (P97's M7 holds it in a fixture; this is the
  observed case). It strengthens the proposal above, in his words: *"Under that rule the two
  would still read the same but carry different values, so a mapping could name which one.
  Under text-only matching there is no way to express it at all."* He is not deciding it yet:
  what the copied markup shows for those two entries' `data-value` comes first, and the copy is
  still to arrive.
- **"Not in list".** The list ends with an escape the form offers, not an institution. His
  requirement: *"A mapping must never resolve to it by accident, and a student whose institution
  genuinely is not listed is a handoff, not a match."* Checked: **today nothing stops it** beyond
  the exact-text rule. The runner tells an entry from an entry by text alone, so a text that
  reads *Not in list* — a reviewed constant, or a profile value that happens to read so —
  chooses it, and the fixture proves it (`preparation.test.ts`, marked OPEN). A guess at the
  wording (a heuristic on *not in list*, *other*, *none of the above*) is the kind of rule P82
  removed. What fits is the reviewer naming the escape on the blueprint, as the press is named:
  the usable-set check refuses a constant equal to it, the runner refuses to choose it whatever
  the text's source, and the not-listed case is a handoff to `unlistedInstitution` or to the
  student. **Not built yet, deliberately**: its shape follows the value-versus-text decision —
  if the mapping names the submitted value, the escape is named by its value too — so it waits
  for that decision rather than being built twice.

**The education page after a save — Vahid, 2026-09-12 (P103).** Three observations from one
save, each with what was done with it.

- **The new-entry URL opens empty after a save.** Closes the P99 condition, above. His caveat,
  verbatim, because it is what he did rather than what he proved: *"I saved one qualification
  and reopened once. I did not save a second and reopen a third time, so 'the URL always opens
  empty' is an inference from one observation, not a property I have shown holds at every
  count."* **Something downstream does depend on it holding for every item.** A repeating page
  is offered to the runner once per item, each as its own work at the page's own URL; the runner
  fills, presses the save, and reports the item done. It reads nothing back. If the second
  opening of `?new=true` ever showed the first entry instead of an empty form, the runner would
  type over it and save — one qualification in the portal, two reported — and nothing built
  would notice. So the second observation is worth having: save a second qualification, reopen
  `education.do?new=true` a third time, and check that *Your Details* lists two.
- **The Documentary Evidence radios accept *later* and *not providing* without a file.** He chose
  those for all four, and the qualification saved with no document attached. Recorded as he
  reads it: for blocker 21's option B, the student attaching their own certificates does not
  stop the page being saved, and the run can complete the page and leave the documents to them.
  One thing his save did not show, because he answered every radio: **whether the page saves
  with a radio left unanswered.** It matters for ADR-0105's shape, where a slot's companion
  radio is handed to the student *with* the slot and the runner sets neither. If the form
  requires an answer to each asterisked radio before it saves, the runner cannot save the page
  while leaving the radio to the student, and that is a sequencing question for ADR-0105 to
  answer — not built around. One more save settles it: leave one radio unanswered and press
  Save and Continue.
- **The save returned him to *Your Details*, not to the page.** The runner does not expect to
  remain: each item is reached by the page's own URL, so where the save lands is not consulted.
  But checking that exposed the real gap, and it is not about landing. **After the save is
  pressed, nothing reads what came back.** The click resolves when the control is pressed; the
  runner then reports the page succeeded, and joins the transmissions to it. A save the portal
  refused — a validation error rendered on the same page, a required radio unanswered — is
  reported as saved. The code's own comment says this is what must not happen (*"Stopping at the
  last field would report success over an application the university has no record of"*), and
  the press is treated as the save. Raised as **blocker 22** in the state document, with the
  proposal: the blueprint names how a saved page looks (the URL it lands on, or an error
  locator that must be absent), the runner reads that after the press, and reports *refused*
  or *uncertain* rather than *succeeded* when it does not hold. Not built: what counts as
  "saved" is the reviewer's vocabulary, and the shape is his to decide.

Still to come from him: the dropdown markup copy; the second save and reopen; the save with a
radio unanswered.

## What step 4 still needs

1. ~~The course and the intake year~~ — supplied by Vahid, 2026-09-11: MSc Management and
   International Business, September 2027 (`2027-09` in the target file).
2. ~~The registration and login pages, read in a fresh profile~~ — read on 2026-09-11
   (`../sheffield-pgt-2026-09-11-entry/`); the `login` block and a registration page are in the
   curated draft 0.2.9 and the mapping set 0.3.6. AUTH 4 and 5 are settled by Vahid's direct
   statement of 2026-09-11, observed by him and not by a run, for this entry only; the approach
   chooser picks `student_chosen`. The instructions below are kept as they were given. **Exactly this, and not more** — Vahid, 2026-09-11: *"tell me now what you need from it so I do only it and
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
5. ~~Four schema gaps raised and decided (ADR-0103)~~ — all four built: options that arrive
   after another field is set (P94); a typeahead as a fill mechanism (P95); a repeatable entry
   (education, employment) as a page shape (P96); a companion field whose value follows another
   act, the upload radios (P93).
   - **P98 — marked, under ADR-0104.** Vahid decided blocker 21 on 2026-09-11 (B, with the
     per-item condition): the curated draft (0.2.7) marks `page7` as repeating over
     `education.prior_qualifications`; the mapping set (0.3.4) leaves its six document slots to
     the student as handoffs, said under each qualification in the preview; `unlistedDegree`,
     shown by `degree` on the same page, is answered per entry. How the portal reaches a second
     entry was not read, and the draft records no `addAnother`. No field on the page is mapped
     yet: which portal box each part of a `Qualification` fills waits on the reviewer.
   - **P96 — the finding as it stood.** The education page (`page7`) is the repeatable entry
     the gap was raised for, and the schema as built in P96 **could not mark it**: `checkUsable` refuses a
     condition on a repeating page, and refuses any document mapped on one, and `page7` has
     both in prospect — `unlistedDegree`, shown by another field, refuses it today; six document
     slots (certificate, transcript and their translations, one set per qualification) would
     refuse it the moment one was mapped. Both refusals are right as built: a document is mapped
     to a held document type, not to an item, so "the certificate for the second qualification"
     has no way to be said; and a condition on a repeating page would be answered by which item
     nobody could say. So the draft stays 0.2.6 with `page7` unmarked, and this is raised as **a
     fifth gap for Vahid: a document per item of a repeating page, and a condition inside one** —
     blocker 21, with a decision sheet
     (`../../decision-sheet-blocker-21-a-document-per-item-of-a-repeating-page.md`). It is a
     schema and product question — what a student holds per qualification — not a curation
     detail. The employment page has neither documents
     nor conditions and would mark cleanly once the registry holds employment (item 7).
   - **P95.** The curated draft (0.2.6) marks `institutionCountry-ts-control` and
     `institution-ts-control` as `typeahead`. ~~The entry locator is Tom Select's default
     markup, not something this capture shows~~ — **confirmed for the country box from the
     markup Vahid copied on 2026-09-11 (P101, above)**: the draft (0.2.10) names each box's own
     list by id and an entry by role and selectable mark. The institution box's locator follows
     the same rule on his report and waits on its own copy. The `<select>` each box fronts
     (`institutionCountry`, `institutionCode`) stays as captured; the typeahead is the way in,
     and the select is what the portal submits. What the mapping names — the text shown or the
     value submitted — is raised above and undecided; no mapping to either box is signed.
   - **P94.** The curated draft (0.2.5) records `optionsAfter` on the four education fields the
     handlers name: `institutionCode` after `institutionCountry`, `gradingSystemId` after
     `institutionCode`, `grade` after `gradingSystemId`, `subject` after `subjectSearch`. Their
     options are as captured with nothing set — a blank entry each — so no mapping may name one
     until a capture is taken with the earlier fields set; the schema now says the order and the
     wait, and the check refuses an option the list does not hold. The curated draft (0.2.4) carries `companion` on the seven slots whose *upload now* radio
   value the capture holds: the six education slots (`…UploadRadio`) and the language slot
   (`certificateStatusUpload`, the one labelled *I will upload my certificate now*). On the
   education page the radio labels were not captured — the option is read from its value, which
   the handler text names — so the reviewer confirms each from the screenshot.
   - **6b, corrected 2026-09-11 from Vahid's live read (below):** `documents.do` has **no**
     radio groups — beside each of its five file inputs is a *Document Description* text box,
     which the capture holds (`other1Desc`…`other5Desc`, classified ordinary, unmapped). So the
     slots waiting on radio values are the five on nationality, not ten. As it stood:
   - **6b.** Ten slots carry no companion yet: the five on nationality, whose status radios were
     not in the captured form (their values are known from handler text only, and the draft's
     `…ScanStatus` options repeat one value three times), and the five on other documents, whose
     radios the capture did not record at all. They wait for a re-read of those two pages; until
     then a document mapped to one of them is attached with no second act, and the reviewer must
     not sign that page as complete.
   - Found while setting the seven: the language page and the education page both name their
     file input `certificate` and its radio `certificateStatus`. A fieldRef names one field in
     the whole blueprint, so `parseBlueprint` now refuses a repeat (P93) and the curated draft
     renames the language page's two to `languageCertificate` and `languageCertificateStatus`,
     locators unchanged. The tool's draft keeps the page's names.
6. ~~Blocker 20 — the Article 9 fields~~ — decided and built (ADR-0102); the page is mapped.
7. **The employment page's four required fields have no profile field** — start date, position,
   employer name and address, duties. The registry (`packages/profile`) collects no employment
   history, so nothing can be mapped, the interview cannot ask, and the plan blocks `no_mapping`
   on all four. Adding fields to the registry is a product decision about what the profile
   collects, with each new field classified; raised in P89, not made.
8. The country select's option map is partial — eight countries whose names the capture shows —
   and refuses to render any other; the reviewer extends it from the captured option list.
