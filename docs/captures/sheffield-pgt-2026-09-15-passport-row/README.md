# Sheffield PGT — the nationality page's markup, read for the passport row (2026-09-15)

Vahid's attached read of `nationality.do` in its normal mode (`run.json`: `attached_read_only`,
`readInPlace: false`), committed as `001.html` beside the run's draft after he checked it for his
surname and his account's e-mail (zero matches). Read here, P140, for distance item 3's group 4
and for the page's show/hide. Everything below is quoted or counted from the file; nothing is
from the console paste that never reached a file.

## The passport row — exact words

The row (starred, in `sectionE`, hidden at load):

> Please enter your passport number below. This is required in order to comply with UK
> immigration law.

Its tooltip (the `<span>` inside the help link beside the box):

> Enter your passport number if possible. If you don't have a passport please enter 'no passport'
> in the box.

The box: `<input type="text" name="passportNumber" maxlength="30">`. So the portal's own
instruction for a student without a passport is the literal text `no passport`, typed into the
number box — thirty characters at most.

## What the markup shows about the page's structure

Every section but one is `display:none` in the markup and is shown or hidden by
`updateSections()` in **`nationality.js`**, an external script (`<script src="nationality.js">`)
that this capture does not hold — the read records the page, not its scripts. `<body
onload="updateSections();highestQualificationChanged()">` runs it at load, and it runs again on a
change to `fundingNationality`, `secondFundingNationality`, `countryOfBirth`,
`permanentResidence`, `livedOutsideCountry`, `alwaysUKResident`, `livingInUK` and
`previousStudentVisa`. The five UK-status radios that open document slots call
`showHideDocumentUploads()` (read in P112).

| section | initial | controls |
|---|---|---|
| top of the form | shown | `fundingNationality`, `secondFundingNationality`, `countryOfBirth`, `permanentResidence`, `ukPermanentResidence`, `livedOutsideCountry`, the five document-slot pairs |
| `sectionA` › `alwaysUKResidentSection` | hidden | `alwaysUKResident`; inside it `dateEnteredUKSection` (hidden): `dateEnteredUKDay/Month/Year` |
| `sectionA` › `alwaysEUResidentSection` | hidden | `alwaysEUResident` |
| `sectionB` | hidden | the four `previousCountryN` blocks with from/to day, month, year |
| `sectionC` | hidden | `britishPassport`, `indefinateVisa`, `refugeeStatus`, `migrantWorker`, `spouseOfUKCitizen` |
| `sectionD` | hidden | `euPassport`, `spouseOfEUCitizen` |
| `sectionE` | hidden | `passportNumber` |
| `sectionF` | **shown** | `livingInUK` |
| `academicProgression` | hidden | `previousStudentVisa`; inside it `academicProgression2`: `qualificationLevel`, the six `quals…` divs (each hidden, one shown per level by `highestQualificationChanged()`), `highestQualificationOther`, `yearsOnStudentVisa`, `monthsOnStudentVisa`, `applicationLocation`, `visaExpiryDay/Month/Year` |

Which answers open which section is in `nationality.js` and nowhere in this file. The per-level
rule IS in the file: `highestQualificationChanged()` hides all six `quals…` divs and shows
`quals<level>` for the chosen `qualificationLevel` — so the five `highestQualification(<level>)`
selects and `highestQualificationOther` are visible one at a time, by the level.

`validate()` (in the file) refuses a save when `academicProgression` is shown and
`previousStudentVisa` is unanswered; when *yes*, it requires the level, the matching per-level
select (or the *Other* text), and a non-zero time on the visa.

## Three things read off the words that the registry's naming did not know

1. **"this country" is script-filled.** The question reads *"Have you been living outside of
   `<span id="livedOutsideCountryLabel">this country</span>` during the last 3 years?"* — the
   span is replaced by `updateSections()`, presumably with the country of permanent residence
   chosen just above it. The registry field is named `residence.outside_uk_last_three_years`;
   if the span holds the permanent-residence country, the question is about *that* country,
   not the UK, and the field's meaning (and name) must follow the script, not the sheet's
   guess. Likewise *"Have you always lived in the
   `<span id="alwyasUKResidentLabelCountry">UK</span>`?"* — the static text is *UK*, the span
   is a target for the script.
2. **The previous-country list is a three-year window.** `sectionB`'s heading: *"Please list the
   countries you have lived in over the last 3 years and the dates you were resident there"*.
   Set 0.3.23 types the FIRST four periods of `residence.history`; a format rule cannot select
   the periods inside the last three years or sort them. Either the interview asks for the
   last three years' periods, most recent first (Sheffield's scope), or the mapping needs a
   rule that can — his call.
3. **The entry date's words:** *"What date did you first come to live in the UK?"* — the
   registry's `residence.uk_entry_date` (month and year) matches the question; the day is the
   mapping's problem, by his decision.

## The radios' values

In the markup every radio has `value=""`; the values `yes` / `no` the runs record (P110 and this
one) are set by `nationality.js` at load, and this capture's draft records them as `yes` / `no`
again. Consistent with P110; nothing to change.

## What the next step needs

`nationality.js` itself — one file, the site's script, no personal data — saved from the browser
(view the page source, follow the `nationality.js` link, save; or the Network panel) and committed
beside `001.html`. It answers, in one read: which answers show `sectionA`–`E` and
`academicProgression`, what the two spans are filled with, and therefore every `visibleWhen`
this page needs and the meaning of two registry fields.
