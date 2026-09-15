# Review pack — Sheffield PGT, the curated draft and the equal-opportunities mapping set

**For:** Iman Behravan (approver) · **Author:** Vahid Mohammadi · **Prepared:** 2026-09-11 · **Revised:** 2026-09-14 (P126: the five pages' labels and markers from the third attached read, and the thirteen to read from the screenshots) · generated from `blueprint.draft.curated.json` (0.2.2; the five pages' labels and `observed_marker` validations from 0.2.18) and `mapping-set.draft.json` (0.2.0; the equal-opportunities page is this sitting's; its personal and contact mappings, added in P89, are the second sitting's)

What this sitting is, and is not. It is the review ADR-0102 requires before either artefact can be
used: every field classified (`ordinary` or `special_category`), and the one page's mapping set
checked against the form's own captured text. It is **not** the structural review of the blueprint
against the portal — locators, option values, the page walk — which waits on Part 2 and the
registration pages being read, and is a separate sitting.

The classifications below are **proposals**. Each row says whether it needs a judgement or is
mechanical. A judgement row is one where the label could be read as inside UK GDPR Article 9(1)
— the statute's list is quoted in `packages/profile/src/categories.ts` — or where the sheet read
it as inside. A mechanical row is a name, an address, a date, a document slot, a course detail.
Nothing here is decided by this document; `checkUsable` refuses the entry until every field carries
a category, and the signature is yours.

## Count

| | fields |
|---|---|
| judgement rows | **23** |
| mechanical rows | 193 |
| total | 216 |
| of which read from the screenshots | **13** (listed next) |

## Thirteen fields to read from the screenshots (P126, 2026-09-14)

The five pages' labels and mandatory markers now come from Vahid's attached reads of
2026-09-14 (three reads; the third is `../sheffield-pgt-2026-09-14-third-read/`), and are in the
draft with their sources named: `labelSource: "row_text"` on a label read from the row, and a
`required` validation with source `observed_marker` where the row carried the `*`. These
thirteen are the exception. Their question is where no positional rule can read it, so the
draft carries only their names, and **they are the one part of this sitting that cannot be
confirmed from the file**: read each from the screenshot, and record its question and whether
it is starred.

Vahid, 2026-09-14: *"the ceiling is 106 of 149 because 43 fields have no question of their own,
and the 13 between 93 and 106 are not a tool failure. They are markup a positional rule cannot
reach. Anyone reading this later should not take it as work left undone."*

| page | field | type | why the file does not carry it |
|---|---|---|---|
| page5 | `fundingNationality` | select | the page's top questions; the question is not in the control's row nor in a row above it |
| page5 | `secondFundingNationality` | select | the page's top questions; the question is not in the control's row nor in a row above it |
| page5 | `countryOfBirth` | select | the page's top questions; the question is not in the control's row nor in a row above it |
| page5 | `permanentResidence` | select | the page's top questions; the question is not in the control's row nor in a row above it |
| page5 | `ukPermanentResidence` | select | the page's top questions; the question is not in the control's row nor in a row above it |
| page5 | `dateEnteredUKDay` | select | the page's top questions; the question is not in the control's row nor in a row above it |
| page5 | `dateEnteredUKMonth` | select | the page's top questions; the question is not in the control's row nor in a row above it |
| page5 | `dateEnteredUKYear` | select | the page's top questions; the question is not in the control's row nor in a row above it |
| page5 | `yearsOnStudentVisa` | select | the page's top questions; the question is not in the control's row nor in a row above it |
| page5 | `monthsOnStudentVisa` | select | the page's top questions; the question is not in the control's row nor in a row above it |
| page5 | `applicationLocation` | radio | the page's top questions; the question is not in the control's row nor in a row above it |
| page6 | `previousEnglishEducation` | radio | marked in its row, the question after the controls |
| page6 | `languageCertificateStatus` | radio | marked in its row, the question after the controls |

Their rows in the tables below are marked **read from the screenshot** so they look different
from the rest; their classification stands as proposed.

## The two refusals, and what the student will read

`ratherNotSay` — ticked. The form's own words are quoted because the field's captured label
carries them. The refusal **covers** the eleven other controls of the disability question, which
are left untouched. `ethnicOriginCode` — option `998`, *Prefer not to say*. Nothing is quoted: the
field's captured text (label and twenty-two options) carries no later-opportunity statement.
Vahid's correction is recorded in ADR-0102: the label says *Information withheld*; the list does
not offer it.

What the student reads, rendered by `renderPreview` from these two drafts as if reviewed
(`scripts/sheffield-draft.test.ts` holds this to be what is rendered):

```
We did not answer these for you:
  Prefer not to say (if you go on to register on a course you will have another opportunity to answer later)
    Not answered on your behalf. Instead we ticked this box.
    Why: Health is Article 9 data this system does not hold. The form's own 'Prefer not to say' is ticked: a stated refusal to route the answer through AskiMate, not the student's answer. The empty save is refused (Vahid, 2026-09-11), so a refusal the form offers is the only honest entry.
    The form says: "if you go on to register on a course you will have another opportunity to answer later"
    Left untouched, as part of this:
      You do not have a disability nor are aware of any additional support requirements
      Learning difference such as dyslexia, dyspraxia or AD(H)D
      Blind or have a visual impairment uncorrected by glasses
      Deaf/deaf or have a hearing impairment
      Physical impairment (a condition that substantially limits one or more basic physical activities such as walking, climbing stairs, lifting or carrying)
      Social/communication conditions such as a speech and language impairment or an autistic spectrum condition
      Mental health condition, challenge or disorder, such as depression, schizophrenia or anxiety
      Long-term illness or health condition such as cancer, HIV, diabetes, chronic heart disease, or epilepsy
      Development condition that you have had since childhood which affects motor, cognitive, social and emotional skills, and speech and language
      An impairment, health condition or learning difference not listed above
      If your disability means that you have additional support needs please tick here:
      If you have additional support needs please provide a brief description:
  Please select the term you feel describes your ethnic origin. If none of the terms seem appropriate, select 'Other ethnic background'. If you want to withhold this information, select 'Information withheld'.
    Not answered on your behalf. Instead we entered "Prefer not to say".
    Why: Ethnic origin is Article 9 data this system does not hold. The form's own 'Prefer not to say' option (998) is selected: a stated refusal, not the student's answer.
```

Three things to check on this page against the screenshot: that ticking *Prefer not to say* is
accepted by the save with nothing else ticked (Vahid observed the refusal of the empty page, not
the acceptance of this one); that `supportNeeds` and `additionalSupport` are part of the
disability question and not a separate mandatory one; and that option `998` is the one the live
list shows (Vahid confirmed it on 2026-09-11).

## The thirteen `required` validations, from the captured asterisks

Authored from the `*` in the captured label; source `specialist_noted`; confirm each against the screenshot.

| page | field | label |
|---|---|---|
| page3 | `forename` | First / Given Name:* |
| page3 | `surname` | Family Name:* |
| page3 | `dobDay` | Date of Birth:* |
| page4 | `email` | E-mail:* |
| page4 | `confirmEmail` | Confirm E-Mail:* |
| page4 | `corrAddress1` | Address Line 1:* |
| page4 | `corrTown` | Town / City:* |
| page4 | `corrCountry` | Country:* |
| page4 | `corrPostcode` | UK Post Code: (* UK only) |
| page8 | `startMonth` | Start Date:* |
| page8 | `position` | Job Title / Position held:* |
| page8 | `employerDetails` | Name and address of employer:* |
| page8 | `duties` | Brief Overview of Duties(Max 4000 characters):* |

The five pages' asterisks were read on 2026-09-14 and are below as `observed_marker`; the
thirteen fields above are the ones whose star, if any, is read from the screenshot.

### The fifty `required` validations from the observed markers (P126, 2026-09-14)

Read by the attached tool from the visible `*` in the control's row, source `observed_marker`;
confirm each against the screenshot. **Read them as rows, not fields.** One star marks every
control in its row — a date asked as a month and a year under one star marks both; `unlistedDegree`
took the star of the `degree` select it shares a row with — so, in Vahid's words (2026-09-14),
*"the marked count is an upper bound, not a count of separately-required fields."* Where several
of the fifty share a row, the star is the row's, and which of them the portal enforces on its own
is yours to read from the page. A wrong label is worse than none — a reviewer confirming
it has nothing to notice — so fourteen labels the third read got wrong (a help sentence taken
with the next question; a column header taken as a question) are **not** in the draft, and
those fields carry their names; 79 right rather than 93 with 14 wrong. Vahid, 2026-09-14:
*"79 right is better than 93 with 14 wrong."*

**Two of the fifty are flagged by the author of this revision, not asserted:**

- **Language: eighteen of twenty marked.** Everything about a test — the qualification, its
  title, the three-part date of award, both certificate numbers, the awarding body, the six
  scores, the certificate and its companion — carries the `*`. That reads as the test block's
  own rule, mandatory once a test is entered, rather than eighteen questions every applicant
  must answer. Please read it as one condition, not eighteen, and say which.
- **`unlistedDegree` marked.** The text box that appears when the qualification is *Not in
  list* shares a row with the `degree` select, and the row's `*` was attached to both. The
  star is the select's; the box is conditional. Please confirm and strike the mark on the box
  if so.
- **`degree`'s star was seen once and not seen once** (P132). The third read marked `degree`
  and `unlistedDegree`; the read of the page as it stood with an institution and a grading
  system chosen marked neither and labelled neither. The draft keeps the marks. The page
  decides: please look at the *Qualification* row in both states. Vahid, 2026-09-14: *"it is
  unsettled until someone looks at the screen"* — no later phase resolves it by picking the more
  convenient reading.

| page | field | label (from the row) |
|---|---|---|
| page5 | `livedOutsideCountry` | Have you been living outside of this country during the last 3 years? |
| page5 | `alwaysUKResident` | Have you always lived in the UK ? |
| page5 | `alwaysEUResident` | Have you always lived in the EU? |
| page5 | `britishPassport` | Do you have a British passport? |
| page5 | `indefinateVisa` | Do you have indefinite leave to enter or remain in the UK? |
| page5 | `refugeeStatus` | Do you hold refugee status? |
| page5 | `migrantWorker` | Are you a migrant worker? |
| page5 | `spouseOfUKCitizen` | Are you the spouse/civil partner of a UK citizen? |
| page5 | `euPassport` | Do you have an EU passport? |
| page5 | `spouseOfEUCitizen` | Are you the spouse/civil partner of an EU citizen? |
| page5 | `passportNumber` | Please enter your passport number below. This is required in order to comply with UK immi… |
| page5 | `livingInUK` | Are you currently living in the UK? |
| page5 | `previousStudentVisa` | Have you previously studied in the United Kingdom on a Student Visa? |
| page5 | `qualificationLevel` | What is the highest qualification level you have studied in the United Kingdom? |
| page5 | `highestQualification(ENGLISH_LANGUAGE_STUDY)` | What level is your English Language Course? Please refer to your course provider to find … |
| page5 | `highestQualification(SCHOOL_LEVEL)` | Please select the qualification you studied: |
| page5 | `highestQualification(FOUNDATION_LEVEL)` | Please select the qualification you studied: |
| page5 | `highestQualification(STUDY_ABROAD_OR_EXCHANGE_LEVEL)` | Please select the qualification you studied: |
| page5 | `highestQualification(UNIVERSITY_LEVEL)` | Please select the qualification you studied: |
| page5 | `highestQualificationOther` | Please provide details of the qualification you studied for: |
| page6 | `firstLanguage` | What is your first language? |
| page6 | `previousEnglishEducation` | *(name only — read from the screenshot)* |
| page6 | `previousEducationLanguage` | Please enter the language you were educated in: |
| page6 | `title` | Qualification Title: |
| page6 | `dateOfAward.day` | Date of Award: |
| page6 | `dateOfAward.month` | Date of Award: |
| page6 | `dateOfAward.year` | Date of Award: |
| page6 | `certificateNumber` | Certificate Number : |
| page6 | `certificateNumber2` | UKVI Reference Number : |
| page6 | `awardingBody` | Awarding Body: |
| page6 | `overallScore` | Grade/Score: |
| page6 | `overallScoreComponent` | Overall Grade/Score: |
| page6 | `listeningScore` | Listening Score: |
| page6 | `readingScore` | Reading Score: |
| page6 | `writingScore` | Writing Score: |
| page6 | `speakingScore` | Speaking Score: |
| page6 | `languageCertificateStatus` | *(name only — read from the screenshot)* |
| page6 | `languageCertificate` | Please tell us how you will provide your test certificate: |
| page7 | `degree` | Qualification: |
| page7 | `unlistedDegree` | unlistedDegree |
| page7 | `startDateMonth` | Start: |
| page7 | `startDateYear` | Start: |
| page7 | `endDateMonth` | End: |
| page7 | `endDateYear` | End: |
| page7 | `certificateStatus` | Proof of Registration This is any document showing you are a student at the institution f… |
| page7 | `transcriptStatus` | Most Recent Transcript This is a breakdown of the marks/scores you received most recently… |
| page7 | `officialCertTranslStatus` | Final Academic Certificate This is the certificate you received after passing your qualif… |
| page7 | `officialTranTranslStatus` | Final Academic Transcript This is a breakdown of the marks/scores you received after pass… |
| page7 | `certificateTranslationStatus` | Final Academic Certificate Translation This is an official translation of the certificate… |
| page7 | `transcriptTranslationStatus` | Final Academic Transcript Translation This is an official translation of the transcript y… |

## Every field, by page

### page1 — Overview — the landing page after sign-in; navigation only

`https://www.sheffield.ac.uk/postgradapplication/overview.do`

No fields (navigation page).

### page2 — Summary — navigation only

`https://www.sheffield.ac.uk/postgradapplication/summary.do`

No fields (navigation page).

### page3 — Personal details

`https://www.sheffield.ac.uk/postgradapplication/personal.do`

| field | type | label | proposed | needs |
|---|---|---|---|---|
| `titleCode` | select | Title: | `ordinary` | mechanical |
| `forename` | text | First / Given Name:* | `ordinary` | mechanical |
| `surname` | text | Family Name:* | `ordinary` | mechanical |
| `middleNames` | text | Middle Names: | `ordinary` | mechanical |
| `knownAs` | text | Preferred/Chosen First Name:(optional) | `ordinary` | mechanical |
| `sex` | radio | sex | `ordinary` | **judgement** — sex is not an Article 9 category; the "Other" option is not sexual orientation. Proposed ordinary. Confirm. |
| `dobDay` | select | Date of Birth:* | `ordinary` | mechanical |
| `dobMonth` | select | dobMonth | `ordinary` | mechanical |
| `dobYear` | select | dobYear | `ordinary` | mechanical |
| `passportNameConfirmation` | checkbox | Tick to confirm that you have entered your names and date of birth as they appear in yo… | `ordinary` | mechanical |
| `hesaNumber` | text | HESA Number: | `ordinary` | mechanical |
| `learnerNumber` | text | Unique Learner Number: | `ordinary` | mechanical |
| `takenCourseAtShefUni` | radio | takenCourseAtShefUni | `ordinary` | mechanical |
| `appliedBefore` | radio | appliedBefore | `ordinary` | mechanical |
| `registrationNumber` | text | registrationNumber | `ordinary` | mechanical |
| `previousCourseName` | text | previousCourseName | `ordinary` | mechanical |
| `previousApplicantNumber` | text | previousApplicantNumber | `ordinary` | mechanical |
| `nameChanged` | radio | nameChanged | `ordinary` | mechanical |
| `previousForename` | text | Previous First / Given Name: | `ordinary` | mechanical |
| `previousSurname` | text | Previous Family Name: | `ordinary` | mechanical |

### page4 — Contact details

`https://www.sheffield.ac.uk/postgradapplication/contact.do`

| field | type | label | proposed | needs |
|---|---|---|---|---|
| `email` | text | E-mail:* | `ordinary` | mechanical |
| `confirmEmail` | text | Confirm E-Mail:* | `ordinary` | mechanical |
| `corrAddress1` | text | Address Line 1:* | `ordinary` | mechanical |
| `corrAddress2` | text | Address Line 2: | `ordinary` | mechanical |
| `corrAddress3` | text | Address Line 3: | `ordinary` | mechanical |
| `corrTown` | text | Town / City:* | `ordinary` | mechanical |
| `corrRegion` | text | County / Region / Area: | `ordinary` | mechanical |
| `corrCountry` | select | Country:* | `ordinary` | mechanical |
| `corrPostcode` | text | UK Post Code: (* UK only) | `ordinary` | mechanical |
| `corrPostcode2` | text | corrPostcode2 | `ordinary` | mechanical |
| `corrIntlPostcode` | text | International Postal Code: | `ordinary` | mechanical |
| `corrTelephone` | text | Telephone Number: | `ordinary` | mechanical |
| `corrContactDateType` | radio | corrContactDateType | `ordinary` | mechanical |
| `corrStartDay` | select | corrStartDay | `ordinary` | mechanical |
| `corrStartMonth` | select | corrStartMonth | `ordinary` | mechanical |
| `corrStartYear` | select | corrStartYear | `ordinary` | mechanical |
| `corrEndDay` | select | corrEndDay | `ordinary` | mechanical |
| `corrEndMonth` | select | corrEndMonth | `ordinary` | mechanical |
| `corrEndYear` | select | corrEndYear | `ordinary` | mechanical |
| `sameAddressCheck` | checkbox | Same as correspondence address | `ordinary` | mechanical |
| `permAddress1` | text | Address Line 1: | `ordinary` | mechanical |
| `permAddress2` | text | Address Line 2: | `ordinary` | mechanical |
| `permAddress3` | text | Address Line 3: | `ordinary` | mechanical |
| `permTown` | text | Town / City: | `ordinary` | mechanical |
| `permRegion` | text | County / Region / Area: | `ordinary` | mechanical |
| `permCountry` | select | Country: | `ordinary` | mechanical |
| `permPostcode` | text | UK Post Code: | `ordinary` | mechanical |
| `permPostcode2` | text | permPostcode2 | `ordinary` | mechanical |
| `permIntlPostcode` | text | International Postal Code: | `ordinary` | mechanical |
| `permTelephone` | text | Telephone Number: | `ordinary` | mechanical |
| `alternativeEmail` | text | Alternative Email: | `ordinary` | mechanical |

### page5 — Nationality and residence

`https://www.sheffield.ac.uk/postgradapplication/nationality.do`

| field | type | label | proposed | needs |
|---|---|---|---|---|
| `fundingNationality` | select | fundingNationality | `ordinary` | **read from the screenshot** — **judgement** — nationality is not racial or ethnic origin under the statute's list. Proposed ordinary. Confirm. |
| `secondFundingNationality` | select | secondFundingNationality | `ordinary` | **read from the screenshot** — **judgement** — as fundingNationality. |
| `countryOfBirth` | select | countryOfBirth | `ordinary` | **read from the screenshot** — **judgement** — country of birth is not ethnic origin. Proposed ordinary. Confirm. |
| `permanentResidence` | select | permanentResidence | `ordinary` | **read from the screenshot** — **judgement** — residence is not ethnic origin. Proposed ordinary. Confirm. |
| `ukPermanentResidence` | select | ukPermanentResidence | `ordinary` | **read from the screenshot** — mechanical |
| `livedOutsideCountry` | radio | Have you been living outside of this country during the last 3 years? | `ordinary` | mechanical · marked `*` |
| `alwaysUKResident` | radio | Have you always lived in the UK ? | `ordinary` | mechanical · marked `*` |
| `dateEnteredUKDay` | select | dateEnteredUKDay | `ordinary` | **read from the screenshot** — mechanical |
| `dateEnteredUKMonth` | select | dateEnteredUKMonth | `ordinary` | **read from the screenshot** — mechanical |
| `dateEnteredUKYear` | select | dateEnteredUKYear | `ordinary` | **read from the screenshot** — mechanical |
| `alwaysEUResident` | radio | Have you always lived in the EU? | `ordinary` | mechanical · marked `*` |
| `previousCountry1` | select | previousCountry1 | `ordinary` | mechanical |
| `dateFromDay1` | select | dateFromDay1 | `ordinary` | mechanical |
| `dateFromMonth1` | select | dateFromMonth1 | `ordinary` | mechanical |
| `dateFromYear1` | select | dateFromYear1 | `ordinary` | mechanical |
| `dateToDay1` | select | dateToDay1 | `ordinary` | mechanical |
| `dateToMonth1` | select | dateToMonth1 | `ordinary` | mechanical |
| `dateToYear1` | select | dateToYear1 | `ordinary` | mechanical |
| `previousCountry2` | select | previousCountry2 | `ordinary` | mechanical |
| `dateFromDay2` | select | dateFromDay2 | `ordinary` | mechanical |
| `dateFromMonth2` | select | dateFromMonth2 | `ordinary` | mechanical |
| `dateFromYear2` | select | dateFromYear2 | `ordinary` | mechanical |
| `dateToDay2` | select | dateToDay2 | `ordinary` | mechanical |
| `dateToMonth2` | select | dateToMonth2 | `ordinary` | mechanical |
| `dateToYear2` | select | dateToYear2 | `ordinary` | mechanical |
| `previousCountry3` | select | previousCountry3 | `ordinary` | mechanical |
| `dateFromDay3` | select | dateFromDay3 | `ordinary` | mechanical |
| `dateFromMonth3` | select | dateFromMonth3 | `ordinary` | mechanical |
| `dateFromYear3` | select | dateFromYear3 | `ordinary` | mechanical |
| `dateToDay3` | select | dateToDay3 | `ordinary` | mechanical |
| `dateToMonth3` | select | dateToMonth3 | `ordinary` | mechanical |
| `dateToYear3` | select | dateToYear3 | `ordinary` | mechanical |
| `previousCountry4` | select | previousCountry4 | `ordinary` | mechanical |
| `dateFromDay4` | select | dateFromDay4 | `ordinary` | mechanical |
| `dateFromMonth4` | select | dateFromMonth4 | `ordinary` | mechanical |
| `dateFromYear4` | select | dateFromYear4 | `ordinary` | mechanical |
| `dateToDay4` | select | dateToDay4 | `ordinary` | mechanical |
| `dateToMonth4` | select | dateToMonth4 | `ordinary` | mechanical |
| `dateToYear4` | select | dateToYear4 | `ordinary` | mechanical |
| `britishPassport` | radio | Do you have a British passport? | `ordinary` | mechanical · marked `*` |
| `indefinateVisa` | radio | Do you have indefinite leave to enter or remain in the UK? | `ordinary` | mechanical · marked `*` |
| `refugeeStatus` | radio | Do you hold refugee status? | `ordinary` | **judgement** — immigration status is not an Article 9 category; sensitive in other ways, already in the ordinary flow (the sheet names it). Proposed ordinary. Confirm. · marked `*` |
| `migrantWorker` | radio | Are you a migrant worker? | `ordinary` | mechanical · marked `*` |
| `spouseOfUKCitizen` | radio | Are you the spouse/civil partner of a UK citizen? | `ordinary` | mechanical · marked `*` |
| `euPassport` | radio | Do you have an EU passport? | `ordinary` | mechanical · marked `*` |
| `spouseOfEUCitizen` | radio | Are you the spouse/civil partner of an EU citizen? | `ordinary` | mechanical · marked `*` |
| `passportNumber` | text | Please enter your passport number below. This is required in order to comply with UK immi… | `ordinary` | mechanical · marked `*` |
| `livingInUK` | radio | Are you currently living in the UK? | `ordinary` | mechanical · marked `*` |
| `previousStudentVisa` | radio | Have you previously studied in the United Kingdom on a Student Visa? | `ordinary` | mechanical · marked `*` |
| `qualificationLevel` | select | What is the highest qualification level you have studied in the United Kingdom? | `ordinary` | mechanical · marked `*` |
| `highestQualification(ENGLISH_LANGUAGE_STUDY)` | select | What level is your English Language Course? Please refer to your course provider to find … | `ordinary` | mechanical · marked `*` |
| `highestQualification(SCHOOL_LEVEL)` | select | Please select the qualification you studied: | `ordinary` | mechanical · marked `*` |
| `highestQualification(FOUNDATION_LEVEL)` | select | Please select the qualification you studied: | `ordinary` | mechanical · marked `*` |
| `highestQualification(STUDY_ABROAD_OR_EXCHANGE_LEVEL)` | select | Please select the qualification you studied: | `ordinary` | mechanical · marked `*` |
| `highestQualification(UNIVERSITY_LEVEL)` | select | Please select the qualification you studied: | `ordinary` | mechanical · marked `*` |
| `highestQualificationOther` | text | Please provide details of the qualification you studied for: | `ordinary` | mechanical · marked `*` |
| `yearsOnStudentVisa` | select | yearsOnStudentVisa | `ordinary` | **read from the screenshot** — mechanical |
| `monthsOnStudentVisa` | select | monthsOnStudentVisa | `ordinary` | **read from the screenshot** — mechanical |
| `applicationLocation` | radio | applicationLocation | `ordinary` | **read from the screenshot** — mechanical |
| `visaExpiryDay` | select | If you are currently studying in the UK please enter the expiry date of your current visa… | `ordinary` | mechanical |
| `visaExpiryMonth` | select | If you are currently studying in the UK please enter the expiry date of your current visa… | `ordinary` | mechanical |
| `visaExpiryYear` | select | If you are currently studying in the UK please enter the expiry date of your current visa… | `ordinary` | mechanical |
| `passportScanStatus` | radio | Passport Scan If you hold a full UK passport please provide a scan of your passport: | `ordinary` | mechanical |
| `passportScan` | file | Passport Scan If you hold a full UK passport please provide a scan of your passport: | `ordinary` | mechanical |
| `visaScanStatus` | radio | Indefinite Leave Passport Scan If you have 'indefinite leave to enter or remain' in the U… | `ordinary` | mechanical |
| `visaScan` | file | Indefinite Leave Passport Scan If you have 'indefinite leave to enter or remain' in the U… | `ordinary` | mechanical |
| `utilityBillScanStatus` | radio | Utility Bill Scan If you hold a full UK passport or have permanent leave to remain please… | `ordinary` | mechanical |
| `utilityBillScan` | file | Utility Bill Scan If you hold a full UK passport or have permanent leave to remain please… | `ordinary` | mechanical |
| `proofOfUKSpouseStatus` | radio | Proof of UK Spouse If you are the spouse of a UK citizen please select how you will provi… | `ordinary` | mechanical |
| `proofOfUKSpouse` | file | Proof of UK Spouse If you are the spouse of a UK citizen please select how you will provi… | `ordinary` | mechanical |
| `refugeeProofStatus` | radio | Proof of Refugee Status If you have refugee status please select how you will provide pro… | `ordinary` | **judgement** — as refugeeStatus. |
| `refugeeProof` | file | Proof of Refugee Status If you have refugee status please select how you will provide pro… | `ordinary` | mechanical |

### page6 — English language

`https://www.sheffield.ac.uk/postgradapplication/language.app`

| field | type | label | proposed | needs |
|---|---|---|---|---|
| `firstLanguage` | text | What is your first language? | `ordinary` | **judgement** — language can indicate ethnic origin but is not itself in the list. Proposed ordinary. Confirm. · marked `*` |
| `previousEnglishEducation` | radio | previousEnglishEducation | `ordinary` | **read from the screenshot** — mechanical · marked `*` |
| `previousEducationLanguage` | text | Please enter the language you were educated in: | `ordinary` | **judgement** — as firstLanguage. · marked `*` |
| `englishQualTypeCode` | select | Qualification: | `ordinary` | mechanical |
| `title` | text | Qualification Title: | `ordinary` | mechanical · marked `*` |
| `dateOfAward.day` | select | Date of Award: | `ordinary` | mechanical · marked `*` |
| `dateOfAward.month` | select | Date of Award: | `ordinary` | mechanical · marked `*` |
| `dateOfAward.year` | select | Date of Award: | `ordinary` | mechanical · marked `*` |
| `certificateNumber` | text | Certificate Number : | `ordinary` | mechanical · marked `*` |
| `certificateNumber2` | text | UKVI Reference Number : | `ordinary` | mechanical · marked `*` |
| `awardingBody` | text | Awarding Body: | `ordinary` | mechanical · marked `*` |
| `overallScore` | text | Grade/Score: | `ordinary` | mechanical · marked `*` |
| `overallScoreComponent` | text | Overall Grade/Score: | `ordinary` | mechanical · marked `*` |
| `listeningScore` | text | Listening Score: | `ordinary` | mechanical · marked `*` |
| `readingScore` | text | Reading Score: | `ordinary` | mechanical · marked `*` |
| `writingScore` | text | Writing Score: | `ordinary` | mechanical · marked `*` |
| `speakingScore` | text | Speaking Score: | `ordinary` | mechanical · marked `*` |
| `languageCertificateStatus` | radio | certificateStatus | `ordinary` | **read from the screenshot** — mechanical · marked `*` |
| `languageCertificate` | file | Please tell us how you will provide your test certificate: | `ordinary` | mechanical · marked `*` |

(The two are `certificateStatus` and `certificate` on the page and in the tool's draft; the curated
draft renames them because the education page uses the same two names, and a fieldRef names one
field in the whole blueprint — the parser refuses a repeat since P93. The locators are unchanged.)

### page7 — Education — one qualification; the applicant adds one entry per qualification

`https://www.sheffield.ac.uk/postgradapplication/education.do?new=true`

| field | type | label | proposed | needs |
|---|---|---|---|---|
| `institutionCountry` | select | Select the country the institution is based in: | `ordinary` | mechanical |
| `institutionCountry-ts-control` | typeahead | institutionCountry-ts-control | `ordinary` | mechanical |
| `institutionCode` | select | institutionCode | `ordinary` | mechanical |
| `institution-ts-control` | typeahead | Search for an institution... | `ordinary` | mechanical |
| `unlistedInstitution` | text | unlistedInstitution | `ordinary` | mechanical |
| `degree` | select | Qualification: | `ordinary` | mechanical · marked `*` |
| `unlistedDegree` | text | unlistedDegree | `ordinary` | mechanical · marked `*` |
| `subjectSearch` | text | Search: | `ordinary` | mechanical |
| `subject` | select | Results: | `ordinary` | mechanical |
| `unlistedSubject` | text | If your subject is not in the list please enter it here: | `ordinary` | mechanical |
| `startDateMonth` | select | Start: | `ordinary` | mechanical · marked `*` |
| `startDateYear` | select | Start: | `ordinary` | mechanical · marked `*` |
| `endDateMonth` | select | End: | `ordinary` | mechanical · marked `*` |
| `endDateYear` | select | End: | `ordinary` | mechanical · marked `*` |
| `awardDateMonth` | select | Date of Award: | `ordinary` | mechanical |
| `awardDateYear` | select | Date of Award: | `ordinary` | mechanical |
| `gradingSystemId` | select | Grading System: | `ordinary` | mechanical |
| `grade` | select | grade | `ordinary` | mechanical |
| `unlistedGrade` | text | unlistedGrade | `ordinary` | mechanical |
| `unlistedGradeDescription` | text | Unlisted grade description: | `ordinary` | mechanical |
| `highestEducationLevel` | checkbox | Please tick here if this is this the highest qualification level you have taken: | `ordinary` | mechanical |
| `certificateStatus` | radio | Proof of Registration This is any document showing you are a student at the institution f… | `ordinary` | mechanical · marked `*` |
| `certificate` | file | certificate | `ordinary` | mechanical |
| `transcriptStatus` | radio | Most Recent Transcript This is a breakdown of the marks/scores you received most recently… | `ordinary` | mechanical · marked `*` |
| `transcript` | file | transcript | `ordinary` | mechanical |
| `officialCertTranslStatus` | radio | Final Academic Certificate This is the certificate you received after passing your qualif… | `ordinary` | mechanical · marked `*` |
| `officialCertTranslation` | file | officialCertTranslation | `ordinary` | mechanical |
| `officialTranTranslStatus` | radio | Final Academic Transcript This is a breakdown of the marks/scores you received after pass… | `ordinary` | mechanical · marked `*` |
| `officialTranTranslation` | file | officialTranTranslation | `ordinary` | mechanical |
| `certificateTranslationStatus` | radio | Final Academic Certificate Translation This is an official translation of the certificate… | `ordinary` | mechanical · marked `*` |
| `certificateTranslation` | file | certificateTranslation | `ordinary` | mechanical |
| `transcriptTranslationStatus` | radio | Final Academic Transcript Translation This is an official translation of the transcript y… | `ordinary` | mechanical · marked `*` |
| `transcriptTranslation` | file | transcriptTranslation | `ordinary` | mechanical |

### page8 — Employment — one job; the applicant adds one entry per job

`https://www.sheffield.ac.uk/postgradapplication/employment.do`

| field | type | label | proposed | needs |
|---|---|---|---|---|
| `startMonth` | select | Start Date:* | `ordinary` | mechanical |
| `startYear` | select | startYear | `ordinary` | mechanical |
| `endMonth` | select | End Date: | `ordinary` | mechanical |
| `endYear` | select | endYear | `ordinary` | mechanical |
| `position` | text | Job Title / Position held:* | `ordinary` | mechanical |
| `employerDetails` | textarea | Name and address of employer:* | `ordinary` | mechanical |
| `duties` | textarea | Brief Overview of Duties(Max 4000 characters):* | `ordinary` | mechanical |

### page9 — Equal opportunities

`https://www.sheffield.ac.uk/postgradapplication/equalOpportunities.do`

| field | type | label | proposed | needs |
|---|---|---|---|---|
| `noDisability` | checkbox | You do not have a disability nor are aware of any additional support requirements | `special_category` | **judgement** — Article 9 (health / ethnic origin), as the sheet reads the label |
| `ratherNotSay` | checkbox | Prefer not to say (if you go on to register on a course you will have another opportuni… | `special_category` | **judgement** — Article 9 (health / ethnic origin), as the sheet reads the label |
| `dyslexia` | checkbox | Learning difference such as dyslexia, dyspraxia or AD(H)D | `special_category` | **judgement** — Article 9 (health / ethnic origin), as the sheet reads the label |
| `blindness` | checkbox | Blind or have a visual impairment uncorrected by glasses | `special_category` | **judgement** — Article 9 (health / ethnic origin), as the sheet reads the label |
| `deafness` | checkbox | Deaf/deaf or have a hearing impairment | `special_category` | **judgement** — Article 9 (health / ethnic origin), as the sheet reads the label |
| `wheelchair` | checkbox | Physical impairment (a condition that substantially limits one or more basic physical a… | `special_category` | **judgement** — Article 9 (health / ethnic origin), as the sheet reads the label |
| `autistic` | checkbox | Social/communication conditions such as a speech and language impairment or an autistic… | `special_category` | **judgement** — Article 9 (health / ethnic origin), as the sheet reads the label |
| `mentalHealth` | checkbox | Mental health condition, challenge or disorder, such as depression, schizophrenia or an… | `special_category` | **judgement** — Article 9 (health / ethnic origin), as the sheet reads the label |
| `unseen` | checkbox | Long-term illness or health condition such as cancer, HIV, diabetes, chronic heart dise… | `special_category` | **judgement** — Article 9 (health / ethnic origin), as the sheet reads the label |
| `developmentCondition` | checkbox | Development condition that you have had since childhood which affects motor, cognitive,… | `special_category` | **judgement** — Article 9 (health / ethnic origin), as the sheet reads the label |
| `otherDisability` | checkbox | An impairment, health condition or learning difference not listed above | `special_category` | **judgement** — Article 9 (health / ethnic origin), as the sheet reads the label |
| `additionalSupport` | checkbox | If your disability means that you have additional support needs please tick here: | `special_category` | **judgement** — Article 9 (health / ethnic origin), as the sheet reads the label |
| `supportNeeds` | textarea | If you have additional support needs please provide a brief description: | `special_category` | **judgement** — Article 9 (health / ethnic origin), as the sheet reads the label |
| `ethnicOriginCode` | select | Please select the term you feel describes your ethnic origin. If none of the terms seem… | `special_category` | **judgement** — Article 9 (health / ethnic origin), as the sheet reads the label |

### page10 — Marketing

`https://www.sheffield.ac.uk/postgradapplication/marketing.do`

| field | type | label | proposed | needs |
|---|---|---|---|---|
| `marketingAreaCode` | select | Can you please tell us where you heard about The University of Sheffield? | `ordinary` | mechanical |
| `specifics` | text | Please provide more details, if you can | `ordinary` | mechanical |
| `otherInst1` | text | otherInst1 | `ordinary` | mechanical |
| `otherInstCourse1` | text | otherInstCourse1 | `ordinary` | mechanical |
| `otherInst2` | text | otherInst2 | `ordinary` | mechanical |
| `otherInstCourse2` | text | otherInstCourse2 | `ordinary` | mechanical |
| `otherInst3` | text | otherInst3 | `ordinary` | mechanical |
| `otherInstCourse3` | text | otherInstCourse3 | `ordinary` | mechanical |
| `otherInst4` | text | otherInst4 | `ordinary` | mechanical |
| `otherInstCourse4` | text | otherInstCourse4 | `ordinary` | mechanical |

### page11 — Other documents

`https://www.sheffield.ac.uk/postgradapplication/documents.do`

| field | type | label | proposed | needs |
|---|---|---|---|---|
| `other1Desc` | text | Document Description: | `ordinary` | mechanical |
| `other1` | file | File: | `ordinary` | mechanical |
| `other2Desc` | text | Document Description: | `ordinary` | mechanical |
| `other2` | file | File: | `ordinary` | mechanical |
| `other3Desc` | text | Document Description: | `ordinary` | mechanical |
| `other3` | file | File: | `ordinary` | mechanical |
| `other4Desc` | text | Document Description: | `ordinary` | mechanical |
| `other4` | file | File: | `ordinary` | mechanical |
| `other5Desc` | text | Document Description: | `ordinary` | mechanical |
| `other5` | file | File: | `ordinary` | mechanical |

## Employment mappings — set 0.3.19 (P129, 2026-09-14), the next sitting's

Decided by Vahid (ADR-0111): the registry holds `employment.history`, and `page8` repeats over
it. Seven mappings, per job; the section is optional on the portal's own words, and a student who
confirmed no jobs fills the page zero times with the preview saying so.

| field | source | rule |
|---|---|---|
| `startMonth` | `employment.history` | `startDate` → `month` → option, 1 → *January* … 12 → *December* |
| `startYear` | `employment.history` | `startDate` → `year` → number |
| `endMonth` | `employment.history` | `end` → `date` (**left empty when the job is current**) → `month` → option |
| `endYear` | `employment.history` | `end` → `date` (left empty when current) → `year` → number |
| `position` | `employment.history` | `position` |
| `employerDetails` | `employment.history` | `employer` and `employerAddress` joined, name on the first line |
| `duties` | `employment.history` | `duties`, verbatim; the 4,000 cap is the page's |

## Education date mappings — set 0.3.22 (P134, 2026-09-15), the next sitting's

Decided by Vahid (ADR-0112): a qualification carries a start and an end as month and year, and
an award date held on its own. Six mappings, per qualification; the page's other fields wait on
your option maps onto the observed lists (P132) and on blocker 25.

| field | source | rule |
|---|---|---|
| `startDateMonth` | `education.prior_qualifications` | `start` → `month` → option, 1 → *Jan* … 12 → *Dec* |
| `startDateYear` | `education.prior_qualifications` | `start` → `year` → number |
| `endDateMonth` | `education.prior_qualifications` | `end` → `date` → `month` → option; the end always carries a date, whether completed, expected or discontinued |
| `endDateYear` | `education.prior_qualifications` | `end` → `date` → `year` → number |
| `awardDateMonth` | `education.prior_qualifications` | `award` (**left empty when there is none** — never derived from the end) → `month` → option |
| `awardDateYear` | `education.prior_qualifications` | `award` (left empty when none) → `year` → number |

## For Iman — flagged, not asserted (P126, 2026-09-14)

- **Language's eighteen marked of twenty** and **`unlistedDegree`'s mark** — see the fifty
  observed markers above. Both flags are the author's reading of the file, offered to a
  reviewer; neither is Vahid's.
- **The education page's six companions are marked** (`certificateStatus`, `transcriptStatus`,
  `officialCertTranslStatus`, `officialTranTranslStatus`, `certificateTranslationStatus`,
  `transcriptTranslationStatus`): the radio must be answered even when the slot is the
  student's own act, which is what ADR-0107 plans (*later*). Confirm the star is the radio's.

## For Iman — flagged, not asserted (P108, 2026-09-12)

- **What the education page's first document slot asks for.** The draft pairs the `certificate`
  file input with the `certificateStatus` radio group from the input's own handler (its
  `onchange` ticks `certificateUploadRadio`, the id of that group's *Uploaded* option). But the
  radio's copy, read by Vahid from the live page, says *I will upload proof of registration
  now / later* — not *certificate*. The slot is labelled *Degree certificate* in the draft and
  the handoff reason says "the degree certificate"; neither was read from the page. Please
  confirm from the page what the slot asks for, and the label and the reason follow your reading.
  Vahid's rule: *"Do not pair a slot with a radio group by name similarity — pair by what the
  reviewed markup shows."*
- **The six status radios' values** are now from Vahid's reading of the live page (0.2.12):
  `Uploaded` / `UploadLater` / `NotSending` / `NotRequired` on every group. `NotRequired` is
  named by nothing and chosen by nothing; on two groups it has no text beside it, recorded as
  an empty label. The language page's group (`languageCertificateStatus`) carries the same four
  values from his reading of 2026-09-12 (0.2.13); its labels are the capture's per-option read,
  joined by the meaning of the value token (P109). Twenty-three groups on personal, contact and
  nationality still carry ids — listed in the README under P109 with the snippet that reads them.
- **`NotRequired` means three different things on this form** — *My certificate is in English*
  (the document), *Not required* (what Sheffield needs), *We do not require a certificate … if
  you are a UK applicant* (who the applicant is). It is never chosen and nothing acts on the
  token. If a mapping is ever proposed that treats it as one thing, it is wrong on two pages.

- **`corrContactDateType` on contact: map from the text, not the value.** The value `After` is
  shown as *From this date:* and `Before` as *To this date:* (Vahid's live read, 2026-09-12).
  A mapping written from the value alone inverts the meaning. The draft (0.2.14) carries both.
- **The yes-or-no case differs by page.** `personal.do` submits `Yes` / `No`; `nationality.do`
  submits `yes` / `no`. A constant carries that page's case exactly; nothing normalises.
- **Nationality's five document slots are not on an international student's path** (Vahid's
  read of `showHideDocumentUploads()`, 2026-09-13): each is shown only on a claim of UK status.
  The draft (0.2.15) carries the condition on four of the five; the fifth is a disjunction the
  vocabulary cannot say and is recorded as such. **Nothing on this page is to be mapped to a
  document for an international student.** Their rows below stay because the form has them.
- ~~**Nationality's five document slots have no companion yet.**~~ Moot for the path; as it stood: Their groups' values are known,
  and each file input's `onchange` ticks an id of the form `<slot>UploadRadio` (Vahid's live
  read, 2026-09-13) — but no radio on the page carried that id when read. Whether the id is on a
  radio in one of the five groups, or on nothing, is one more reading away (README, P111). Until
  then the pairing is not in the draft, and whether attaching a file on this page ticks its own
  radio is unknown.

- **The education page's listing** (0.2.16): `summary.do`, entries counted by the `h5` reading
  exactly *Previous Education N* inside `div.homepageInfomation` — the class misspelled on the
  page and kept as written. Text-shaped by necessity: the wrappers are every section's.

- **The UK postcode on contact is two boxes** (Vahid's read-back, 2026-09-13): `corrPostcode`
  takes the outward code, `corrPostcode2` the inward, each through the new `uk_postcode`
  format, split at the postcode's own seam and never at 3+3. The portal stores the postcode
  exactly as typed, case included; nothing here canonicalises it.

- **A mapping to the institution box names the VALUE** (ADR-0109, Vahid's decision of
  2026-09-13): the box carries its entries — value and the text each reads as — and its escape
  `Not in list` by value. The two *Sheffield International College* entries are `SCH40484` and
  `SHE0512`. A mapping reaches the box through an option rule onto these entries, never free
  text, never the escape; the preview shows the student the text.

## Not in this sitting

- The four schema gaps (order-and-wait on the education chain, the typeahead, repeatable entries,
  the companion upload radio) — raised in the capture README, not decided here.
- Radio option values: the draft carries the captured `id` or the label, not the submitted value.
- The mapping of the other pages. Personal and contact are mapped in the same set (P89) for the
  second sitting; employment's four required fields cannot be mapped until the registry has
  employment fields (raised, not decided); the rest are unmapped.
- Part 2 — unread. The registration and login pages were read on 2026-09-11 and their locators
  are in the draft (0.2.3) for the second sitting.
