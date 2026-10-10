# P290: the reads for the choice and the escape, in one sitting

**Written before the rule of 2026-10-10.** The console snippets in this file do not print the
country selected when they run, and his rule of that date says every read must (CLAUDE.md, *A read
prints the country it was made under*). Do not run them as they stand. A read made again needs a
snippet that prints the country, as those in [`p294-reads.md`](./p294-reads.md) do.

These reads were made on 2026-10-06 (P291).

**What these are for.** The build lets a student choose from what Sheffield's list holds, and
choose the form's escape ("Not in list"), with the run carrying on. Choosing the escape opens a box
for the student's own words. Nobody has read when three of those boxes appear, or what the
education page holds after "Not in list" is chosen. These reads settle that. What they return goes
into the one signature at the end.

**Ground rules.**
- On your own account, read only. Nothing saved.
- Work on `https://www.sheffield.ac.uk/postgradapplication/education.do?new=true`, with **Iran**
  as the country, as before.
- Every output goes in a file **as the console printed it, unedited**. Paste it whole, and split it
  only on its own separators if you need to (CLAUDE.md, *a split is not a retyping*).
- Commit the files to `docs/captures/sheffield-pgt-2026-09-10/reads/` with the names below. If you
  would rather send them, attach the files; don't retype their contents.

`copy()` does not work in your browser, so each snippet **prints** its result. Select the printed
string and paste it.

## The five snippets

**V: which of the "unlisted" boxes are showing**
```js
JSON.stringify(["unlistedInstitution","unlistedSubject","unlistedDegree","unlistedGrade","unlistedGradeDescription"].map(n => { const e = document.querySelector('[name="' + n + '"]'); return [n, e === null ? "absent" : (e.offsetParent !== null ? "visible" : "hidden"), e && e.labels && e.labels[0] ? e.labels[0].textContent.trim() : null]; }))
```

**G: the grading-system list**
```js
JSON.stringify([...document.querySelectorAll('select[name="gradingSystemId"] option')].map(o => [o.value, o.textContent.trim()]))
```

**R: the grade list**
```js
JSON.stringify([...document.querySelectorAll('select[name="grade"] option')].map(o => [o.value, o.textContent.trim()]))
```

**S: the subject list**
```js
JSON.stringify([...document.querySelectorAll('select[name="subject"] option')].map(o => [o.value, o.textContent.trim()]))
```

**T: what the institution box offers for what is typed in it** (run while its dropdown is open)
```js
JSON.stringify([...document.querySelectorAll('#institution-ts-dropdown [role="option"]')].map(o => [o.getAttribute("data-value"), o.textContent.trim(), o.hasAttribute("data-selectable")]))
```

## The reads, in this order

1. **Before choosing anything** (country Iran, nothing else touched): run **V**. File:
   `p290-1-untouched-visibility.json`.
2. **Institution: "Not in list".** In the institution box, type `HHE`, and wait for the dropdown.
   - **Before choosing anything**, run **T**. File: `p290-2-institution-typed-HHE.json`. This is
     what the box offers for `HHE`. The build shows a student exactly that list, with "Not in
     list" beside it, and offers nothing for a word whose list nobody has read. If the dropdown
     closes when you click into the console, run **T** anyway and paste what it prints, `[]`
     included. An empty result there could mean the list closed, not that it held nothing, so
     say which you saw on the page.
   - Then choose **Not in list** from the dropdown.
   - Run **V**. File: `p290-2-institution-escape-visibility.json`.
   - Run **G**: the grading-system list after "Not in list". File:
     `p290-2-grading-after-institution-escape.json`.
3. **Grading system, from that list.**
   - If it offers **Not in list**: choose it, then run **V** (file
     `p290-3-grading-escape-visibility.json`) and **R** (file `p290-3-grade-after-grading-escape.json`).
   - If it offers a 20-point system (like "GPA 20"): choose it and run **R**. File
     `p290-3-grade-after-gpa20.json`.
   - If it offers neither, say so, and send **G** again.
4. **Subject: a search that finds something, then "Not in list".** In the subject search box type
   `international`, press the search button, and choose **Not in list** in the subject list.
   - Run **V**. File: `p290-4-subject-escape-visibility.json`.
5. **Subject: a search that finds nothing.** Search the subject box for `HHE` and press the
   button.
   - Run **S**. File: `p290-5-subject-after-empty-search.json`.

   This settles whether "Not in list" is in the list when a search returns nothing, which decides
   which word the run searches with when a student chooses the subject's escape.
6. **Award title: the empty entry.** In the award-title list, choose its empty entry (shown as "Not
   in list" or blank).
   - Run **V**. File: `p290-6-degree-escape-visibility.json`.
   - This confirms the one box whose rule is already recorded (`unlistedDegree` shows when the
     award title is empty).

Then leave the page without saving.

## What this costs

Nothing metered: no model call and no AWS. It is your own browser on your own account, reading.
