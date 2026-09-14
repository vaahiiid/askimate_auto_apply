# Sheffield PGT — the five pages re-read with row-text labels, 2026-09-14

**Read by:** Vahid, on his own signed-in account, with the attached inspection tool after P123
(commit 9a3a1db) · **Pages:** nationality, language, education (`?new=true`), marketing,
documents · **Summary printed:** `Labels from row text 76 of 149`, `Marked mandatory 42` ·
**For:** item 1 of [`distance-to-a-reviewed-sheffield-run.md`](../../distance-to-a-reviewed-sheffield-run.md).

Every number below is read from `blueprint.draft.json` in this directory by a script over the
file, not from the summary lines or from memory. His console observations of the same day are
checked against it, one by one, and corrected where the file says otherwise.

## Is item 1 closed? No.

Seventy-six of 149 fields carry a label read from the row, and 42 fields carry the visible
marker. The other seventy-three do not, and among them are the nationality page's top selects
and every one of its date and previous-country boxes — the fields Run A most needs the
mandatory set for. A page is read when every field on it carries what the student sees; these
do not. The observer's rule was the row's text *before the row's first control*, and on these
pages the question of the fields that failed is not in their row at all (see the shapes below).

| Page | Fields | Row-text labels | Marked | Unlabelled | Of which tied labels |
|---|---|---|---|---|---|
| nationality | 73 | 33 | 20 | 40 | 1 (`query`) |
| language | 20 | 17 | 18 | 3 | 1 (`query`) |
| education | 34 | 16 | 4 | 18 | 4 (`query`, both Tom Select boxes, `highestEducationLevel`) |
| marketing | 11 | 0 | 0 | 11 | 3 (`query`, `marketingAreaCode`, `specifics`) |
| documents | 11 | 10 | 0 | 1 | 1 (`query`) |
| **total** | **149** | **76** | **42** | **73** | **10** |

`query` is the site's search box, present on every page and no part of the form; the five
count among the 149 and among the seventy-three.

## The seventy-three, by name

Ten carry a label the markup ties (`label[for]` or a wrapping label), so nothing was missing
on them: the five `query` boxes; on education `institution-ts-control` ("Search for an
institution...", the typeahead's own input) and `institutionCountry-ts-control` (an empty
tied label, now treated as none, and still without a row question), and
`highestEducationLevel`; on marketing `marketingAreaCode` and `specifics`. Sixty-three carry
only their name:

- **nationality (39):** `fundingNationality`, `secondFundingNationality`, `countryOfBirth`,
  `permanentResidence`, `ukPermanentResidence`; `dateEnteredUKDay` / `Month` / `Year`; the
  four previous-country blocks, each `previousCountryN`, `dateFromDayN` / `MonthN` / `YearN`,
  `dateToDayN` / `MonthN` / `YearN` (28); `yearsOnStudentVisa`, `monthsOnStudentVisa`;
  `applicationLocation` (the radio pair *Inside / Outside the United Kingdom*, its options
  read, its question not).
- **language (2):** `previousEnglishEducation` and `certificateStatus` — both **marked** and
  both unlabelled: the row carried the `*` and no words before its first control.
- **education (14):** `degree`, `unlistedDegree`, and the six document slots with their six
  companions (`certificate`, `transcript`, `officialCertTranslation`, `officialTranTranslation`,
  `certificateTranslation`, `transcriptTranslation` and each `…Status`).
- **marketing (8):** `otherInst1`–`4` and `otherInstCourse1`–`4`.
- **documents (0).**

Four labels are **wrong**, not missing, and are counted among the seventy-six: on education
`institutionCode` and `unlistedInstitution` carry the country question ("Select the country
the institution is based in:"), because the three controls share one row and the rule gave
every control the row's first question; `grade`, `unlistedGrade` and `unlistedGradeDescription`
carry "Grading System:" and `subject` carries "Results:" for the same reason. The rule that
produced this is replaced below.

## What the shapes must be, read off the failures

The file does not carry markup, so this is inference from which fields succeeded and which
did not, stated as such:

1. **The question sits in a row of its own above the control's row.** `fundingNationality`,
   `countryOfBirth`, the three `dateEnteredUK` selects, `yearsOnStudentVisa`: no words before
   the first control in their row, so no label, and the `*` (his twenty-seven) in the row
   above, so no marker either. The two marked-but-unlabelled language radios are the same
   shape with the `*` in the control's row.
2. **One row asks several things.** The education page's country, institution and
   unlisted-institution controls; grading system and grade. The row's first question was given
   to all.
3. **A row with no question anywhere.** The previous-country blocks (his sixth observation)
   and, on the evidence, `otherInst1`–`4` on marketing.

The observer (P124, `apps/browser-runner/src/observe-script.ts`) now reads, per control, its
**own words** (the text between the previous control in the row and itself; not for or after a
radio or checkbox, whose between-text is the earlier choice's own words), then the **row's
question** (before the row's first control), then a **question row above** (the nearest
preceding row or block with words and no controls of its own), and takes the marker from the
row or from that question row. Proved on a fixture in each of the three shapes
(`apps/browser-runner/src/observe-row-text.test.ts`). Whether Sheffield's markup is what the
inference says is what the next read tells.

## His six console observations, checked against the file

1. **Twenty-seven bare `<font>*</font>` on nationality.** *Not confirmable from this file.* The
   draft records rows the observer attached a marker to, not markers; nationality has twenty
   marked fields, and the seven or so it did not attach are on the fields whose question is in
   the row above. The count stands as his.
2. **The starred residence-history questions with no registry counterpart.** *Held.*
   `livedOutsideCountry`, `alwaysUKResident`, `alwaysEUResident` are labelled by their questions
   and marked. The four `previousCountry` blocks behind them are unlabelled and unmarked, which
   is the same shape he described.
3. **`passportNumber` starred, with an instruction on what to enter without a passport.**
   *Half held.* The field is marked, labelled "Please enter your passport number below. This is
   required in order to comply with UK immigration law." The no-passport instruction is **not
   in the file** anywhere — no field's text mentions it. It sits after the control, and the
   observer records text after a control only for radios and checkboxes. His reading stands as
   his; the file neither confirms nor denies it.
4. **The five companions unstarred, behind UK-status conditions in the portal's words.** *Held.*
   `passportScanStatus`, `visaScanStatus`, `utilityBillScanStatus`, `proofOfUKSpouseStatus`,
   `refugeeProofStatus`: none marked; each labelled with its condition ("If you hold a full UK
   passport…", "If you have 'indefinite leave to enter or remain'…", "If you hold a full UK
   passport or have permanent leave to remain…", "If you are the spouse of a UK citizen…", "If
   you have refugee status…"), the utility-bill condition an OR as P112 recorded.
5. **`refugeeStatus` the one starred radio group.** *Not held — corrected.* Twelve yes/no groups
   on nationality are marked: `livedOutsideCountry`, `alwaysUKResident`, `alwaysEUResident`,
   `britishPassport`, `indefinateVisa`, `refugeeStatus`, `migrantWorker`, `spouseOfUKCitizen`,
   `euPassport`, `spouseOfEUCitizen`, `livingInUK`, `previousStudentVisa`; the five
   `highestQualification` groups too. The unmarked radio groups are the five companions and
   `applicationLocation`. His second snippet filtered names on `Scan|Proof|Status|Upload`, and
   of the starred groups only `refugeeStatus` matches that filter — the "one" was the filter's
   artefact, not the page's.
6. **The four `previousCountry` blocks carry no question text in their rows.** *Held.* All
   twenty-eight controls unlabelled, unmarked.

## Forty-two marked against his twenty-seven asterisks

Consistent, and not in the direction one star per several controls would give. His
twenty-seven are nationality's; the file marks **twenty** fields there, fewer, because the
marker in a question row above was not attached to the controls below it. The other
twenty-two marked fields are on language (**eighteen** of twenty: `firstLanguage`,
`previousEnglishEducation`, `previousEducationLanguage`, the qualification title, the
three-part date of award, both certificate numbers, awarding body, the six scores,
`certificateStatus`, `certificate`) and education (**four**: the start and end month and year).
The language figure will need his eye: eighteen starred of twenty reads as the test block's
own rule — everything about a test is mandatory once a test is entered — rather than eighteen
questions every applicant must answer, and the file cannot tell those apart.

## One more thing the file showed, fixed

Every companion's "later" option label ends
`… later <br/> <input type="radio" name="passportSca` (cut at eighty characters). That is the
text of a **comment node** after the last shown radio — a third option Sheffield switched off
in the markup — which the observer read as the radio's own words. It now reads text and
elements only, never a comment (red first, on the fixture). A reviewed entry must never carry
markup as an option's label.

## For Iman's review pack

The pack's counts are by field, and the field count is unchanged: 216 in the curated draft, of
which the five pages' 144 are these 149 less the five search boxes. **Twenty-three judgement
rows and 193 mechanical stand**; the row-text labels confirm the proposed categories where the
name alone did not ("Do you hold refugee status?", "What is your first language?") and change
no classification. What changes is the `required` section: thirteen rows from the captured
asterisks, and the pack's line that the five pages' asterisks *"are read from the screenshots
and added at review"* — the read now carries them as `observed_marker`, forty-two so far, each
to be confirmed rather than found. That number is not final until the next read attaches the
question-row markers, so the pack is not regenerated from this file. No time figure was ever
recorded for his sitting, and none is put in now.

## What to run

The same attached read after pulling `main` (P124). If the summary still leaves the
nationality selects unlabelled, the shapes above are wrong, and one console paste settles
them — this one prints, for six controls, the ancestor chain and the row and the row above,
with every `<option>` removed and every `value`, `checked` and `selected` attribute stripped,
so nothing typed into the form is in it:

```js
(names => names.map(n => { const el = document.querySelector(`[name="${n}"]`); if (!el) return n + ': not found';
  const row = el.closest('tr') ?? el.parentElement; const strip = e => { const c = e.cloneNode(true);
  c.querySelectorAll('option').forEach(o => o.remove()); c.querySelectorAll('*').forEach(x => ['value','checked','selected'].forEach(a => x.removeAttribute(a))); return c.outerHTML.slice(0, 700); };
  const chain = []; for (let a = el; a && a.tagName !== 'FORM'; a = a.parentElement) chain.push(a.tagName.toLowerCase() + (a.id ? '#' + a.id : ''));
  return n + '\n  chain: ' + chain.join(' < ') + '\n  row: ' + strip(row) + '\n  row above: ' + (row.previousElementSibling ? strip(row.previousElementSibling) : '(none)');
}).join('\n\n'))(['countryOfBirth','dateEnteredUKDay','applicationLocation','previousEnglishEducation','institutionCode','alwaysUKResident'])
```
