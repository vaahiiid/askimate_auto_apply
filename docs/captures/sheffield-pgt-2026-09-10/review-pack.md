# Review pack — Sheffield PGT, the curated draft and the equal-opportunities mapping set

**For:** Iman Behravan (approver) · **Author:** Vahid Mohammadi · **Prepared:** 2026-09-11 · generated from `blueprint.draft.curated.json` (0.2.2) and `mapping-set.equal-opportunities.draft.json` (0.1.0)

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

The five pages whose labels were not read carry no asterisks in the draft; theirs are read from the screenshots and added at review.

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
| `fundingNationality` | select | fundingNationality | `ordinary` | **judgement** — nationality is not racial or ethnic origin under the statute's list. Proposed ordinary. Confirm. |
| `secondFundingNationality` | select | secondFundingNationality | `ordinary` | **judgement** — as fundingNationality. |
| `countryOfBirth` | select | countryOfBirth | `ordinary` | **judgement** — country of birth is not ethnic origin. Proposed ordinary. Confirm. |
| `permanentResidence` | select | permanentResidence | `ordinary` | **judgement** — residence is not ethnic origin. Proposed ordinary. Confirm. |
| `ukPermanentResidence` | select | ukPermanentResidence | `ordinary` | mechanical |
| `livedOutsideCountry` | radio | livedOutsideCountry | `ordinary` | mechanical |
| `alwaysUKResident` | radio | alwaysUKResident | `ordinary` | mechanical |
| `dateEnteredUKDay` | select | dateEnteredUKDay | `ordinary` | mechanical |
| `dateEnteredUKMonth` | select | dateEnteredUKMonth | `ordinary` | mechanical |
| `dateEnteredUKYear` | select | dateEnteredUKYear | `ordinary` | mechanical |
| `alwaysEUResident` | radio | alwaysEUResident | `ordinary` | mechanical |
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
| `britishPassport` | radio | britishPassport | `ordinary` | mechanical |
| `indefinateVisa` | radio | indefinateVisa | `ordinary` | mechanical |
| `refugeeStatus` | radio | refugeeStatus | `ordinary` | **judgement** — immigration status is not an Article 9 category; sensitive in other ways, already in the ordinary flow (the sheet names it). Proposed ordinary. Confirm. |
| `migrantWorker` | radio | migrantWorker | `ordinary` | mechanical |
| `spouseOfUKCitizen` | radio | spouseOfUKCitizen | `ordinary` | mechanical |
| `euPassport` | radio | euPassport | `ordinary` | mechanical |
| `spouseOfEUCitizen` | radio | spouseOfEUCitizen | `ordinary` | mechanical |
| `passportNumber` | text | passportNumber | `ordinary` | mechanical |
| `livingInUK` | radio | livingInUK | `ordinary` | mechanical |
| `previousStudentVisa` | radio | previousStudentVisa | `ordinary` | mechanical |
| `qualificationLevel` | select | qualificationLevel | `ordinary` | mechanical |
| `highestQualification(ENGLISH_LANGUAGE_STUDY)` | select | highestQualification(ENGLISH_LANGUAGE_STUDY) | `ordinary` | mechanical |
| `highestQualification(SCHOOL_LEVEL)` | select | highestQualification(SCHOOL_LEVEL) | `ordinary` | mechanical |
| `highestQualification(FOUNDATION_LEVEL)` | select | highestQualification(FOUNDATION_LEVEL) | `ordinary` | mechanical |
| `highestQualification(STUDY_ABROAD_OR_EXCHANGE_LEVEL)` | select | highestQualification(STUDY_ABROAD_OR_EXCHANGE_LEVEL) | `ordinary` | mechanical |
| `highestQualification(UNIVERSITY_LEVEL)` | select | highestQualification(UNIVERSITY_LEVEL) | `ordinary` | mechanical |
| `highestQualificationOther` | text | highestQualificationOther | `ordinary` | mechanical |
| `yearsOnStudentVisa` | select | yearsOnStudentVisa | `ordinary` | mechanical |
| `monthsOnStudentVisa` | select | monthsOnStudentVisa | `ordinary` | mechanical |
| `applicationLocation` | radio | applicationLocation | `ordinary` | mechanical |
| `visaExpiryDay` | select | visaExpiryDay | `ordinary` | mechanical |
| `visaExpiryMonth` | select | visaExpiryMonth | `ordinary` | mechanical |
| `visaExpiryYear` | select | visaExpiryYear | `ordinary` | mechanical |
| `passportScanStatus` | radio | passportScanStatus | `ordinary` | mechanical |
| `passportScan` | file | passportScan | `ordinary` | mechanical |
| `visaScanStatus` | radio | visaScanStatus | `ordinary` | mechanical |
| `visaScan` | file | visaScan | `ordinary` | mechanical |
| `utilityBillScanStatus` | radio | utilityBillScanStatus | `ordinary` | mechanical |
| `utilityBillScan` | file | utilityBillScan | `ordinary` | mechanical |
| `proofOfUKSpouseStatus` | radio | proofOfUKSpouseStatus | `ordinary` | mechanical |
| `proofOfUKSpouse` | file | proofOfUKSpouse | `ordinary` | mechanical |
| `refugeeProofStatus` | radio | refugeeProofStatus | `ordinary` | **judgement** — as refugeeStatus. |
| `refugeeProof` | file | refugeeProof | `ordinary` | mechanical |

### page6 — English language

`https://www.sheffield.ac.uk/postgradapplication/language.app`

| field | type | label | proposed | needs |
|---|---|---|---|---|
| `firstLanguage` | text | firstLanguage | `ordinary` | **judgement** — language can indicate ethnic origin but is not itself in the list. Proposed ordinary. Confirm. |
| `previousEnglishEducation` | radio | previousEnglishEducation | `ordinary` | mechanical |
| `previousEducationLanguage` | text | previousEducationLanguage | `ordinary` | **judgement** — as firstLanguage. |
| `englishQualTypeCode` | select | englishQualTypeCode | `ordinary` | mechanical |
| `title` | text | title | `ordinary` | mechanical |
| `dateOfAward.day` | select | dateOfAward.day | `ordinary` | mechanical |
| `dateOfAward.month` | select | dateOfAward.month | `ordinary` | mechanical |
| `dateOfAward.year` | select | dateOfAward.year | `ordinary` | mechanical |
| `certificateNumber` | text | certificateNumber | `ordinary` | mechanical |
| `certificateNumber2` | text | certificateNumber2 | `ordinary` | mechanical |
| `awardingBody` | text | awardingBody | `ordinary` | mechanical |
| `overallScore` | text | overallScore | `ordinary` | mechanical |
| `overallScoreComponent` | text | overallScoreComponent | `ordinary` | mechanical |
| `listeningScore` | text | listeningScore | `ordinary` | mechanical |
| `readingScore` | text | readingScore | `ordinary` | mechanical |
| `writingScore` | text | writingScore | `ordinary` | mechanical |
| `speakingScore` | text | speakingScore | `ordinary` | mechanical |
| `certificateStatus` | radio | certificateStatus | `ordinary` | mechanical |
| `certificate` | file | certificate | `ordinary` | mechanical |

### page7 — Education — one qualification; the applicant adds one entry per qualification

`https://www.sheffield.ac.uk/postgradapplication/education.do?new=true`

| field | type | label | proposed | needs |
|---|---|---|---|---|
| `institutionCountry` | select | institutionCountry | `ordinary` | mechanical |
| `institutionCountry-ts-control` | text | institutionCountry-ts-control | `ordinary` | mechanical |
| `institutionCode` | select | institutionCode | `ordinary` | mechanical |
| `institution-ts-control` | text | Search for an institution... | `ordinary` | mechanical |
| `unlistedInstitution` | text | unlistedInstitution | `ordinary` | mechanical |
| `degree` | select | degree | `ordinary` | mechanical |
| `unlistedDegree` | text | unlistedDegree | `ordinary` | mechanical |
| `subjectSearch` | text | subjectSearch | `ordinary` | mechanical |
| `subject` | select | subject | `ordinary` | mechanical |
| `unlistedSubject` | text | unlistedSubject | `ordinary` | mechanical |
| `startDateMonth` | select | startDateMonth | `ordinary` | mechanical |
| `startDateYear` | select | startDateYear | `ordinary` | mechanical |
| `endDateMonth` | select | endDateMonth | `ordinary` | mechanical |
| `endDateYear` | select | endDateYear | `ordinary` | mechanical |
| `awardDateMonth` | select | awardDateMonth | `ordinary` | mechanical |
| `awardDateYear` | select | awardDateYear | `ordinary` | mechanical |
| `gradingSystemId` | select | gradingSystemId | `ordinary` | mechanical |
| `grade` | select | grade | `ordinary` | mechanical |
| `unlistedGrade` | text | unlistedGrade | `ordinary` | mechanical |
| `unlistedGradeDescription` | text | unlistedGradeDescription | `ordinary` | mechanical |
| `highestEducationLevel` | checkbox | Please tick here if this is this the highest qualification level you have taken: | `ordinary` | mechanical |
| `certificateStatus` | radio | certificateStatus | `ordinary` | mechanical |
| `certificate` | file | certificate | `ordinary` | mechanical |
| `transcriptStatus` | radio | transcriptStatus | `ordinary` | mechanical |
| `transcript` | file | transcript | `ordinary` | mechanical |
| `officialCertTranslStatus` | radio | officialCertTranslStatus | `ordinary` | mechanical |
| `officialCertTranslation` | file | officialCertTranslation | `ordinary` | mechanical |
| `officialTranTranslStatus` | radio | officialTranTranslStatus | `ordinary` | mechanical |
| `officialTranTranslation` | file | officialTranTranslation | `ordinary` | mechanical |
| `certificateTranslationStatus` | radio | certificateTranslationStatus | `ordinary` | mechanical |
| `certificateTranslation` | file | certificateTranslation | `ordinary` | mechanical |
| `transcriptTranslationStatus` | radio | transcriptTranslationStatus | `ordinary` | mechanical |
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
| `other1Desc` | text | other1Desc | `ordinary` | mechanical |
| `other1` | file | other1 | `ordinary` | mechanical |
| `other2Desc` | text | other2Desc | `ordinary` | mechanical |
| `other2` | file | other2 | `ordinary` | mechanical |
| `other3Desc` | text | other3Desc | `ordinary` | mechanical |
| `other3` | file | other3 | `ordinary` | mechanical |
| `other4Desc` | text | other4Desc | `ordinary` | mechanical |
| `other4` | file | other4 | `ordinary` | mechanical |
| `other5Desc` | text | other5Desc | `ordinary` | mechanical |
| `other5` | file | other5 | `ordinary` | mechanical |

## Not in this sitting

- The four schema gaps (order-and-wait on the education chain, the typeahead, repeatable entries,
  the companion upload radio) — raised in the capture README, not decided here.
- Radio option values: the draft carries the captured `id` or the label, not the submitted value.
- The mapping of the other ten pages. Only equal opportunities is mapped.
- Part 2 and the registration/login pages — unread.
