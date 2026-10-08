# P293: reads R and L, in one sitting, so a grade row can follow

**Supersedes** [`p292-reads.md`](./p292-reads.md). Same two reads; R is now planned for the row it
has to carry.

**What he asked, in his words** (2026-10-08, 17:11 UTC, the message's timestamp in the session
record; saved whole as
[`p293-his-decisions-as-sent.txt`](./p293-his-decisions-as-sent.txt)):

> *"Build a signed mapping row "grade scale 20 → GPA 20" for Sheffield from my existing read, for
> my signature. Then plan read R so a grade row can follow."*
>
> *"Do reads R and L in one sitting after this."*

The grading-system row is built and waits for his signature
([`p293-for-signature.md`](./p293-for-signature.md)). Once it is signed, the doctorate's grade is
the **one** field on his run that still asks, with the intake answers given (measured in P293). It
asks because the form records no escape for the grade, and no row maps a grade for an institution
that is not on the list. Read R is what such a row has to rest on.

## Ground rules (as before)

- On your own account, read only. Nothing saved.
- Work on `education.do?new=true`, with **Iran** as the country.
- Paste each output whole, **as the console printed it, unedited**. Split it only on its own
  separators. A trim is a retyping (CLAUDE.md): the values keep any space they have.
- Commit the files to `docs/captures/sheffield-pgt-2026-09-10/reads/` with the names below, or
  attach them.

## The two snippets

**R: the whole grade list**, as `[value, label]` pairs, every option. Wrapped in the console's own
`copy(…)`, so the whole string goes to the clipboard and the console's display cannot shorten it:
```js
copy(JSON.stringify([...document.querySelectorAll('select[name="grade"] option')].map(o => [o.value, o.textContent])))
```
Paste the clipboard into the file as it is. If you would rather read it on screen, the same
expression without `copy(` and its `)` prints it. If the printed string is shortened, say so; do
not complete it by hand.

**L: what stands beside each escape box** (unchanged from P292):
```js
JSON.stringify(["unlistedInstitution","unlistedSubject","unlistedDegree"].map(n => { const e = document.querySelector('[name="' + n + '"]'); if (e === null) return [n, "absent"]; const before = e.previousElementSibling; const row = e.closest("tr, li, .form-group, .row, fieldset, p, div"); return [n, e.offsetParent !== null ? "visible" : "hidden", e.labels && e.labels[0] ? e.labels[0].textContent : null, e.getAttribute("aria-label"), e.getAttribute("placeholder"), e.getAttribute("title"), before ? before.textContent : null, row ? row.innerText : null]; }))
```

## The reads, in this order

1. **Institution: "Not in list".** Type `HHE` in the institution box and choose **Not in list**,
   the one entry it offered in your P291 read 2.
2. **Grading system: GPA 20.** Choose *GPA 20 (e.g. 16.5/20)*, the system the new row types (`6`).
   - Run **R**. File: `p293-R-grade-after-institution-escape-gpa20.json`.
   - Your P291 read 3 sent this list's first eight lines and said *"So the full 0.0–20.0 list
     returns even with the institution escaped."* That is a description. R is the list itself.
3. **Subject: "Not in list".** Search the subject for `international`, press the search button,
   and choose **Not in list**.
4. **Award title: "Not in list".** Choose its "Not in list" entry, which submits the empty string.
5. All three boxes should now be showing. Run **L**. File: `p293-L-escape-box-labels.json`.

Then leave the page without saving.

**Optional, same sitting, yours to choose: R2.** Change the institution to *Islamic Azad
University* (`UNI30764`), choose GPA 20 again, and run R again into
`p293-R2-grade-azad-gpa20.json`. The records disagree about the Master's grade rows you signed on
2026-10-04, and R2 would settle it in the repository:
- the signed entry's own note says they rest on a **description** of this list, with 5 of 203
  confirmed by a line passed through (the note itself, and P285's count in CLAUDE.md);
- P286 records the message of 2026-10-04, 17:50 UTC: the form's own string, split in the shell,
  203 of 203 held; and your approval note says *"The grade list was read whole from the form and
  every row it sends is confirmed against it."*
- That split's file was never committed, so nothing in the repository can be re-read to show it.

R2 would put the list itself here, so all 203 can be compared line by line by anyone. It is not
needed for the doctorate's row.

## What happens with them

**R becomes three things in the entry, all built from R's own lines and nothing else:**

1. **The grade's list after GPA 20**: `listsAfter` on `grade`, keyed on `gradingSystemId` = `6`,
   holding R's values in R's order, less the list's prompt. Any line R holds that the field's
   options do not is added to them, value and label as printed.
2. **The grade's prompt**, `Select your grade...`, if R's first line is that, so it is never offered
   as an answer (as P291 did for the award title).
3. **The grade row**: on the grade's switch over the institution, a branch taken only when the
   student's own choice of the institution's escape is in, keyed on the country R was read under
   (Iran) and then on the scale they state. For
   `twenty_point`, each line of R maps its label to its value (a stated *19.5* to the form's
   `19.5`), the two non-grades included as the Azad rows include them. Each key and each value is
   text R printed, cut at R's separators; no number is formatted, no space trimmed. A grade R does
   not hold refuses, as now.

**The checks the row has to pass before it is put to you:**

- **`checkUsable` refuses it without R.** Since P293, a row taken after an escape on a field whose
  list follows another field (the grade follows the grading system) must name only values held by
  every list read after that field set to what **its own** row after the same escape renders: here
  the grading system's GPA 20 row, so the list read after `6` (`listsAfter`). The grade has none
  today, so a grade row built now, from the options gathered for Islamic Azad University, is
  refused (`escaped_branch_invalid`). That is the point: the row rests on R or it does not load.
- **Line by line against the file:**
  `pnpm exec tsx scripts/read-against-entry.ts <entry> grade <R's file> "(escaped)"`. Every line
  must match the entry's options, and every value the row sends must be held by a line of the
  file. Its summary says how many of the rows a line passed through confirms, and that it cannot
  tell where the file came from: that is said by where R came from, which is your console.
- **The measure again:** `pnpm exec tsx scripts/questions-his-run.ts <entry> DBA`, recorded as
  printed.

**L** gives each box the words the page shows; the entry's labels change only from the printed
text, and the preview stops printing handles (row 141).

All of it goes into one patch, with one signature, built from the entry **as you signed it** after
P293. If you have not signed P293's patch by then, the reads still stand, and the rows wait for it.

## What this costs

Nothing metered: no model call and no AWS. It is your own browser on your own account, reading.
