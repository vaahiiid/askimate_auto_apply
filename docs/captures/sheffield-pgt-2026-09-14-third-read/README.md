# Sheffield PGT — the third read of the five pages, 2026-09-14

**Read by:** Vahid, on his own signed-in account, with the attached inspection tool after P124
(commit bd4fa2b) · **Pages:** nationality, language, education (`?new=true`), marketing,
documents · **Summary printed:** `Labels from row text 93 of 149` (was 76), `Marked
mandatory 50` (was 42) · **For:** item 1 of
[`distance-to-a-reviewed-sheffield-run.md`](../../distance-to-a-reviewed-sheffield-run.md).

Every number below is read from `blueprint.draft.json` here by a script over the file and its
field-by-field difference from the re-read
([`../sheffield-pgt-2026-09-14-five-pages-relabelled/`](../sheffield-pgt-2026-09-14-five-pages-relabelled/README.md)).

| Page | Fields | Row-text labels | Marked | Unlabelled |
|---|---|---|---|---|
| nationality | 73 | 40 (was 33) | 20 (was 20) | 33 |
| language | 20 | 17 | 18 | 3 |
| education | 34 | 24 (was 16) | 12 (was 4) | 10 |
| marketing | 11 | 2 (was 0) | 0 | 9 |
| documents | 11 | 10 | 0 | 1 |
| **total** | **149** | **93** | **50** | **56** |

## The fifty-six, and which of them matter

**Forty-three have no question of their own, and "unlabelled" is the right record for them:**

- the site's search box on every page (5);
- five with a label the markup ties: `institution-ts-control` ("Search for an institution...",
  the typeahead's own input), `institutionCountry-ts-control` (an empty tied label; the
  `<select>` behind it is labelled "Select the country the institution is based in:"),
  `highestEducationLevel`, `marketingAreaCode`, `specifics`;
- the previous-country blocks 2, 3 and 4 — `previousCountryN`, `dateFromDayN` / `MonthN` /
  `YearN`, `dateToDayN` / `MonthN` / `YearN` (21) — rows of selects under one column header,
  which block 1 took (below, as a wrong label) and the others could not;
- the marketing page's `otherInst2`–`4` and `otherInstCourse2`–`4` (6), the same shape;
- the education page's six file inputs (`certificate`, `transcript`, `officialCertTranslation`,
  `officialTranTranslation`, `certificateTranslation`, `transcriptTranslation`): each slot's
  title and description now sit on its companion radio group ("Proof of Registration This is
  any document showing you are a student at the institution…"), which is the slot's text.

**Thirteen matter, and three reads have not reached them:**

- **nationality (11):** `fundingNationality`, `secondFundingNationality`, `countryOfBirth`,
  `permanentResidence`, `ukPermanentResidence`, `dateEnteredUKDay` / `Month` / `Year`,
  `yearsOnStudentVisa`, `monthsOnStudentVisa`, `applicationLocation`. These are the page's
  top questions, the ones Run A needs the mandatory set for, and the marker count on this page
  did not move between the second read and the third (twenty, twenty): his twenty-seven
  asterisks are these questions' stars, wherever they sit.
- **language (2):** `previousEnglishEducation`, `certificateStatus` — **marked** in both reads
  and still unlabelled, so the `*` is in their row and the question is not before their first
  control.

## The wrong labels: gone as they were, and fourteen new ones

The re-read's wrong labels (P124's README) do not stand as they were: `unlistedGradeDescription`
is now right ("Unlisted grade description:"), and `subject`'s "Results:" — which that README
listed among them — is the row's own text for the results list beside a "Search:" box, and
was never wrong; that entry is corrected here. But the third rule changed the others to
something else that is also wrong, in two new kinds, **fourteen** fields in all:

1. **The previous control's help sentence, with this control's question after it — five,
   all on education.** Sheffield puts a sentence of help after each control, so the text
   between two controls (the "own words" rule) is the earlier control's help plus the later
   one's question: `institutionCode` reads "This is the country of the institution that
   awarded your qualification. Please select the institution that has awarded/will award your
   final degree certificate…"; `unlistedInstitution`, `unlistedDegree`, `grade` and
   `unlistedGrade` likewise, each opening with the sentence that explains the field before it,
   the question at the tail or cut off by the 200-character cap.
2. **A column-header row taken as a question — nine.** `previousCountry1` and its six date
   selects read "Country From To"; `otherInst1` and `otherInstCourse1` read "Institution Course
   Applied For". The nearest row above with words and no controls was the table's header row.

The observer now refuses both rather than guessing (P125, red first on the fixture from the
file's own texts): own words that run to more than one sentence, or that end as a statement,
give **no label** with the marker still read from the row; a question row above is taken only
for a row holding one control or one group. On this file that would leave 79 labelled, none
wrong, and 50 marked. That is not a reason for a fourth read — the third read's file already
says which fourteen to exclude, and the fold into the curated draft excludes them.

One mark to flag with the labels: `unlistedDegree`, the text box that appears when the
qualification is *Not in list*, is marked by the `*` in the row it shares with `degree`. The
star is the row's, and belongs to the select.

## The ceiling, stated

A fourth read would not reach 149 and 27, and the target is not 149: forty-three of the
fifty-six have no question of their own. The reachable ceiling for labels is 106, and the
thirteen that stand between 93 and it are exactly the fields whose question is in none of the
three places a rule over rows can look — before the row's first control, between two controls,
or in a sibling row above with no controls. What the third read proves about them: the row
above every one of nationality's top selects holds another select, so the rule stopped there
and found nothing; and the two language radios carry the star with no words before them. So
the question is either after the control in its own row or in an enclosing structure the row
model does not see — a nested table, a heading cell — and a fourth rule for that would be a
guess written without the markup, tested by a fifth read. Every rule so far was that, and the
third one produced nine header labels and no right label on the page it was written for.

**Stop here.** The thirteen are read from the screenshots at review, which is what the review
pack's `required` section has said since it was written — the fallback, not a failure. The
fifty markers the file carries are for confirmation, not discovery, with two to look at
harder: language's eighteen of twenty (the test block's own rule, on the evidence) and
`unlistedDegree`.

## Decided by Vahid, 2026-09-14 — stop, and what the record says

*"Stop. Agreed, and for the reason you gave rather than the count. The third rule produced nine
header labels and no right label on the page it was written for. A fourth rule would be written
without the markup and tested by a fifth read, exactly as the first three were. That is the
shape to stop at, not a number."*

Recorded in his words, as he asked: *"the ceiling is 106 of 149 because 43 fields have no
question of their own, and the 13 between 93 and 106 are not a tool failure. They are markup a
positional rule cannot reach. Anyone reading this later should not take it as work left
undone."*

And on the fourteen: *"Refusing rather than guessing was the right call on the fourteen. A
wrong label is worse than none, because a reviewer confirming it has nothing to notice — and 79
right is better than 93 with 14 wrong."*

## Folded into the curated draft (P126)

`../sheffield-pgt-2026-09-10/blueprint.draft.curated.json` 0.2.18 carries, on the five pages,
the 79 row-text labels (`labelSource: "row_text"`), the 50 markers (`required`, source
`observed_marker`), the fourteen excluded (their names stand), and the thirteen as their names.
The mapping set is re-bound to 0.2.18 as 0.3.18, unchanged otherwise. The review pack lists the
thirteen on their own with the page and the field name, marks their rows, and carries the two
flags above as the author's, not Vahid's. `scripts/sheffield-draft.test.ts` pins all of it:
79, 50, the fourteen unlabelled, the thirteen unlabelled, the two flagged marks carried, and
the plan's blockers — forty-four observed-mandatory fields on the three unmapped pages now
stand beside employment's four as `no_mapping`, which is items 3, 4 and 5 made visible.
