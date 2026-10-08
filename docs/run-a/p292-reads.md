# P292: two reads, in one sitting

**What these are for.** The message of 2026-10-08 (saved as
[`p292-message-as-sent.txt`](./p292-message-as-sent.txt)) asks for both to be planned:

1. *"Plan the read of the full grade list with the institution escaped."* Row 140, Option A. A
   grade can only be offered, or mapped by a signed row (ADR-0156 §3, proposed), from the list the
   form shows **after** "Not in list" as the institution and *GPA 20* as the grading system. P291's
   read 3 sent that list's first eight lines, so nothing rests on it yet.
2. *"Plan the read of the visible label beside each escape box."* Row 141. The boxes the escapes
   open printed `null` as their label, so the preview names them by their handles
   (`unlistedInstitution: HHE`). The words the page shows beside each box are what the preview
   should say.

**Ground rules (as before).**
- On your own account, read only. Nothing saved.
- Work on `education.do?new=true`, with **Iran** as the country.
- Paste each output whole, **as the console printed it, unedited**. Split it only on its own
  separators.
- Commit the files to `docs/captures/sheffield-pgt-2026-09-10/reads/` with the names below, or
  attach them.

## The two snippets

**R: the whole grade list**, as `[value, label]` pairs, every option:
```js
JSON.stringify([...document.querySelectorAll('select[name="grade"] option')].map(o => [o.value, o.textContent]))
```
It prints `textContent` untrimmed. A trailing space is part of a value the form submits (CLAUDE.md,
*a split is not a retyping*: a trim is a retyping).

**L: what stands beside each escape box.** For each box it prints the label element, any
accessible name, the placeholder, the text of the element just before it, and the text of the row
that holds it:
```js
JSON.stringify(["unlistedInstitution","unlistedSubject","unlistedDegree"].map(n => { const e = document.querySelector('[name="' + n + '"]'); if (e === null) return [n, "absent"]; const before = e.previousElementSibling; const row = e.closest("tr, li, .form-group, .row, fieldset, p, div"); return [n, e.offsetParent !== null ? "visible" : "hidden", e.labels && e.labels[0] ? e.labels[0].textContent : null, e.getAttribute("aria-label"), e.getAttribute("placeholder"), e.getAttribute("title"), before ? before.textContent : null, row ? row.innerText : null]; }))
```

## The reads, in this order

1. **Institution: "Not in list".** Type `HHE` in the institution box and choose **Not in list**.
2. **Grading system: GPA 20.** Choose *GPA 20 (e.g. 16.5/20)*.
   - Run **R**. File: `p292-1-grade-after-institution-escape-gpa20.json`.
   - It should hold every option from *Select your grade...* to *20.0*. If the console shortens
     the string, say so; do not complete it by hand.
3. **Subject: "Not in list".** Search the subject for `international`, press the search button,
   and choose **Not in list**.
4. **Award title: "Not in list".** Choose its "Not in list" entry, which submits the empty string.
5. All three boxes should now be showing. Run **L**. File: `p292-2-escape-box-labels.json`.

Then leave the page without saving.

## What happens with them

- **R** lets the grade after the institution's escape be offered under Option A, or mapped by one
  signed row if ADR-0156 is approved. Every row is then compared line by line with the file
  (`scripts/read-against-entry.ts`).
- **L** gives each box the words the page shows. The entry's labels change only from the printed
  text, and the preview stops printing handles (row 141).

Both go into one patch, with one signature, after he has decided ADR-0156, because that decision
changes what the grade rows are for.

## What this costs

Nothing metered: no model call and no AWS. It is your own browser on your own account, reading.
