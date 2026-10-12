# The grade row from read R, and the escape boxes' words from read L: one patch, one signature (P296)

**Status: signed, at his word of 2026-10-12** (the message's timestamp in the session record, 16:28:33 UTC; saved as sent:
[`p299-his-message-as-sent.txt`](./p299-his-message-as-sent.txt)): *"I approve P296's patch. Apply it
and sign it exactly as docs/run-a/p296-for-signature.md says"*. Applied and signed in one commit,
`8f51a599` (P299): the printed hash was the one below; approvedAt `2026-10-12T16:30:36Z`; his note,
*"Approved by Vahid: grade row from read R (Iran, twenty-point scale, institution Not in list) and the
preview labels from read L."* On the institution box's label (item 5 below), in his words: *"The
institution box label: the last sentence is right. Keep it."* So the label stays the row's last
sentence, and the choice is now his.

Until then: the batch was the patch
[`p296-for-signature.patch`](./p296-for-signature.patch), applied and signed in one commit, so
`main` never holds an entry no approval covers. It applies on top of the P296 commit on `main`
(the commit that adds this sheet), which carries the reads the entry's notes cite; "How to sign"
checks that they are there.

## What he asked, in his words (2026-10-11, 18:26 UTC)

Saved whole as he sent it:
[`p296-reads-as-sent.txt`](../captures/sheffield-pgt-2026-09-10/reads/p296-reads-as-sent.txt). The
time is the message's timestamp in the session record (18:26:56 UTC).

> *"Next: build the grade row from R for my signature, fix the preview labels from L, and measure
> questions on my run again."*

Of how the message was made, it says: *"I ran each snippet in the Chrome console and pasted each
output into a chat with Claude, which assembled this message from my pastes without editing them."*

## His reads, as they reached the repository

- His message, byte for byte from the session record, is the file above. Each console output is
  split from it into its own file beside it, at the message's own separators (the line naming the
  read, and the blank line after the output), nothing else. Each file is a byte slice of the
  message, checked: `p294-T1-…`, `p294-R-…`, `p294-L-…`, `p294-T2-…`, `p294-R2-…`, and the three
  extra outputs of the same sitting (`p294-L-before-award-title-escape.json`,
  `p294-T2-first-try-still-under-iran.txt`, `p294-L-after-switching-to-united-kingdom.json`),
  which nothing here uses.
- The console printed each output as a string in its own quotes. `scripts/read-against-entry.ts`
  now reads that printed form (P296, on `main`): it takes the delimiters off and reads back the
  console's own escapes, refuses anything else, and says that it did. R, R2, T1 and T2 hold no
  backslash, so nothing in them is an escape: read back, they are the bytes between the quotes.
- He typed `azad` and `sheff` in lower case.

**What the reads printed**, compared line by line by `read-against-entry.ts`:

| Read | Made under (printed) | Lines | Against the entry |
|---|---|---|---|
| R: grade, after *Not in list* and GPA 20 | IRAN, `Not in list`, `6` | 204 | 204 of 204 among the grade's options; with this patch, the record matches and the 203 values the new row sends are held by its lines |
| R2: grade, after Islamic Azad University and GPA 20 | IRAN, `UNI30764`, `6` | 204, the same as R pair for pair | 204 of 204; the 203 values the Islamic Azad University case sends, held by its lines (no record of R2 in the entry: NO RECORD) |
| T1: institution, `azad` | IRAN | 35 | 35 of 35, codes and labels; 34 of the 43 institution rows held (no search record for `azad`: NO RECORD) |
| T2: institution, `sheff` | UNITED KINGDOM | 11 | 11 of 11; the other 9 rows held (NO RECORD) |
| L: the three escape boxes | IRAN | 3 boxes | each `visible`; no label, aria-label, placeholder or title; their rows' text |

## What the patch records (blueprint 0.2.34 → **0.2.35**, mapping set 0.3.46 → **0.3.47**)

1. **The grade's list after GPA 20** (`listsAfter` on `grade`): value `6`, under
   `institution-ts-control` = `Not in list` and `institutionCountry-ts-control` = `IRAN`. The values
   are as R printed them; the names are those of the boxes that set the selects R printed
   (`frontedBy`). The 203 entries are R's values in R's order, less its first line.
2. **The grade's prompt**, `Select your grade...`: R's first line, recorded as the list's prompt so
   it is never offered as an answer. Every line R printed was already among the grade's options.
3. **The grade row he asked for**: on the grade's mapping, the branch taken once the institution
   box holds the form's escape for that entry (the student's own choice, recorded), in place of the
   cases; for a qualification in Iran (`IR`) on the twenty-point scale, each of R's 203 lines after
   its prompt maps its label, what the student states, to its value, what the form submits. Every
   key and value is text R printed, cut at R's separators; nothing formatted, nothing trimmed. A
   grade R does not hold refuses, as before. Keyed `IR` and `twenty_point`, as the GPA 20 row that
   renders `6` is.
4. **The grade note** says so, and also that R2 holds every row of the Islamic Azad University
   case: those rows, said in your signed note to rest on a description with 5 of 203 confirmed,
   are each now confirmed by a line of a read passed through whole.
5. **Two escape boxes labelled from L**, the words the page shows:
   - `unlistedDegree`: *"If your qualification is not in the list please enter it here:"*, the
     row's text with whitespace collapsed and its ends trimmed, as the observer treats row text.
   - `unlistedInstitution`: *"If you cannot find your institution listed, please enter its name
     below."* The row's text is three sentences, two of help and this one, addressed to the box. The
     label is the last, cut at the row's last sentence boundary and otherwise unchanged. **That
     choice is mine (P296), not the observer's, and not yours**: the observer gives no label from a
     control's own words when they run to more than one sentence or end as a statement. If you would
     rather the label be the whole row, or another sentence, say so.
   - No `labelSource` is claimed for either: the observer did not read them.
   - `unlistedSubject` already carried its row's words; L confirms them unchanged.
6. **What the notes now say about the country entered by hand in P294.** P294's note expected the
   reads planned next to replace it. They do not: R prints the grading system's value, not its
   list, and T searched `azad` and `sheff`, not `HHE`. Both records still rest on your words of
   2026-10-10: *"I confirm that my reads of 6 October were made with the country set to Iran."*

Also in the patch: `what-will-be-typed.md` regenerated (its version line and reference only), and
the tests that pin the entry: the hash; your two qualifications through the offer (the grade typed
`19.5` after the escape, no blocker left, the row equal to R's lines read from your file, its scale
key equal to the GPA 20 row's, the preview naming the boxes in the page's words); the draft-label
test (79 observer labels, as before; two of the fourteen the third read got wrong now carry L's
words); and the hypothetical that drops rows resting on the institution's escape, now the grade's
with the GPA 20 row's. **The patch adds no test**, so the census table does not move.

## The hash

```
sha256:546b2948c7e721ed3f6e28f800ec486bf595554f38456936a0074c68d2b24ab7
```

## What it does to your run (measured)

`scripts/questions-his-run.ts`, your two qualifications as P286 measured them (the doctorate at HHE,
the Master's at Islamic Azad University, both 19.5 on the twenty-point scale), on `main` and on the
patched entry, with the validator as fixed in P296:

| | `main` (signed `4368de00…`) | with this patch |
|---|---|---|
| Today, your title | 6 | **5** |
| Today, "DBA" | 5 | **4** |
| ADR-0156 proposed, with the intake answers | 1 | **0** |

The one that goes is the doctorate's grade. What is left today: the institution's escape, the award
title's escape, the subject's escape for each qualification, and, with your full title, its 36
characters for a 28-character box.

**The preview** (rendered for your walk with "DBA", each offer answered with its escape): on `main` it
cannot be built, because the grade blocks it. With the patch it is built, and the two boxes read:

```
    If you cannot find your institution listed, please enter its name below.: HHE
    If your qualification is not in the list please enter it here:: DBA
```

With the two labels put back to their handles, the same lines read `unlistedInstitution: HHE` and
`unlistedDegree: DBA`. The doubled colon is the renderer's, for every label that ends in one; it is
on `main` already (row 141).

**Row 141** is about the boxes the escapes open; with this patch all three carry the page's words.
Other boxes in the same preview are still named by their handles: 24 by my count (a filled line
that starts with the handle, or the handle in a "Left empty" list; other phrasings would be missed),
among them `grade: 19.5` and `Left empty: unlistedGrade`. They predate P296, are already in the
page-by-page read on `main`, and are a row of their own (row 150). L did not read them.

## Checks

- `checkUsable`: usable. Broken on purpose, three ways, each refused: a value R does not hold
  (`escaped_branch_invalid`), keyed `IN` (no GPA 20 row for it), the country removed from the read's
  record (`read_under_invalid`).
- The new test assertions, each made to fail once: the grade row taken out (`grade#0` blocks again);
  the labels reverted (the preview lines go).
- On the patched tree, with a stand-in approval over this hash that was never committed and says it
  is not yours: the patch's tests and the P296 tests, 261 of 261; typecheck; lint; the census,
  **3,367 of 3,367, 169 files** (a green census removes its report (P209), so the `/tmp/census-SU2Ila/results.json` this line first named was not kept; the run's console output survives only in the session's scratch directory). After it, two
  test files changed: a comment in the patch's `run-a-profile.test.ts`, and the reader's test on
  `main` (one refusal test split by reason, one case added). Those files were run again, 46 of 46.
  The patch adds no test: the census on `main` counts the same tests as the patched tree.

## What the adversarial review found, and what was done

Five lenses ran read-only (the row, the records, the labels, the printed-form reader, the tests),
each finding then given to a separate agent told to refute it. Nothing in the row itself was found
wrong. What changed because of them:

| Found | Done |
|---|---|
| `labelSource: "row_text"` on the two labels said the observer read them. | Dropped; the note says why. |
| The note misdescribed the observer's rule. | Corrected: its rule is about a control's own words, and it also refuses words that end as a statement, as this one does. |
| "R's own under, as it printed it": the names were translated. | Said so. |
| The R2 claims named no method; the build never compared R2 with R. | The build asserts R2 equals R, pair for pair; the note names that check and `read-against-entry.ts`. |
| The note paraphrased how your message was made. | It quotes your sentence. |
| P294's note expected these reads to replace the hand-entered IRAN; they do not. | Said so, for both records. |
| The row's keys rested on the build script alone, and the check does not compare the grade row's scale key with the GPA 20 row's. | A test now pins the row to R's lines read from your file, and its scale key to the GPA 20 row's. The check's gap is recorded (row 144). |
| The patch cites read files that exist only after the P296 commit. | "How to sign" checks for them first. |
| The validator keyed what the plan types by the field alone, so on a repeating page the last entry's value stood for every entry's; and it read the award title's escape, `""`, as missing. Reachable since P291 recorded `""` as that escape. | Fixed on `main` (P296, not in this patch): each entry validated on its own, a chosen escape counted as an answer. Measured below. |

The validator, measured with your two qualifications **Master's first**: today's code counts 6 with
"DBA", one of them a false *"Qualification:" is required*; fixed, 5, as in the other order. And one
qualification with its title escaped is no longer stopped for a person.

## How to sign: one commit

```sh
test -f docs/captures/sheffield-pgt-2026-09-10/reads/p296-reads-as-sent.txt   # the P296 commit is in
git apply docs/run-a/p296-for-signature.patch
# then edit docs/run-a/catalogue/approvals.json — replace the one entry (see below)
pnpm run catalogue hash docs/run-a/catalogue/entries/sheffield-pgt-2027-09.json   # must print the hash above
git add docs/run-a docs/captures/sheffield-pgt-2026-09-10 scripts/run-a-profile.test.ts scripts/sheffield-draft.test.ts
git commit
```

The approval file keeps **one** entry; the test asserts exactly one:

```json
[
  {
    "contentHash": "sha256:546b2948c7e721ed3f6e28f800ec486bf595554f38456936a0074c68d2b24ab7",
    "authoredBy": "Vahid Mohammadi",
    "approvedBy": "Vahid Mohammadi",
    "approvedAt": "<when you sign, UTC>",
    "ownAccountOnly": { "studentId": "5774ff16-ff9c-424a-882f-42d0f304968b" },
    "note": "<your words>"
  }
]
```

## What this does not do

- **T is not in it.** You asked for the grade row and the labels. T1 and T2 together hold every one
  of the 43 institution rows, but the entry records neither search, and re-keying the rows on the
  country is a patch of its own, and the check would today refuse a part of it it needs: once the
  institution rows are keyed on the country, no grading list read after a listed institution can be
  recorded, for any country (row 145).
- **R2 is not recorded as a read in the entry**, only compared; recording it would bring the
  Islamic Azad University rows under the same country rule, which is that next patch's work.

## What this costs

Nothing metered: no model call and no AWS.
