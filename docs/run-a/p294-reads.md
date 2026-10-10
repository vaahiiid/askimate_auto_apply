# P294: reads R, L and T, in one sitting; R and T record what they were made under

**Supersedes** [`p293-reads.md`](./p293-reads.md). Three things changed (the third in P295), and one
read is added:

1. **R and T now print the values their list follows, with the list.** L reads labels, not a list.
   Since P295 it prints the country too. His words, 2026-10-09
   ([`p294-his-decisions-as-sent.txt`](./p294-his-decisions-as-sent.txt)): *"Record the country a
   read was made under in the reads record itself, and make the check refuse a mapping row whose key
   does not match the country of the read it rests on."* So the country (and, for R, the institution
   and the grading system) comes from the read's own output, not from a heading written beside it.
   In the entry it becomes the read's `under`, and `checkUsable` holds every row to it (P294).
2. **No `copy()`.** P293's plan told you to wrap R in `copy(…)`. That was wrong: the message of 2026-10-04,
   17:50 UTC, reported that *"copy() does not work in that browser, and the download trick did not
   either"*, and P290's plan already said so. Every snippet here **prints** its result. If the console shows a long
   string shortened, use its own control to show or copy the whole string. As on 4 October, cutting
   the console's string at its own separators is not a retyping. Nothing in these snippets trims a
   value.
3. **T is added.** It re-reads the institution box under each country its rows came from (below).
4. **P295: every snippet prints the country selected when it runs, L included.** His words,
   2026-10-10 ([`p295-his-message-as-sent.txt`](./p295-his-message-as-sent.txt)): *"For reads R
   and L and every read from now on: each snippet must also print the country selected at the
   time of the read, so the country is never typed in by hand again."* R and T already did. L now
   does. `scripts/reads-print-their-country.test.ts` runs each snippet here in Chromium, on a fresh
   page, under four selections: Iran, the United Kingdom, none, and a value made up for the run.
   It fails if a snippet does not print the value selected. It holds any snippet written in these
   folders from now on to the same rule.

## Ground rules (as before)

- On your own account, read only. Nothing saved.
- Work on `education.do?new=true`.
- Paste each output whole, **as the console printed it, unedited**. Split it only on its own
  separators.
- Commit the files to `docs/captures/sheffield-pgt-2026-09-10/reads/` with the names below, or
  attach them.

## The snippets

**R: the grade list, with what it was read under.**
```js
JSON.stringify({ under: { institutionCountry: document.querySelector('[name="institutionCountry"]').value, institutionCode: document.querySelector('[name="institutionCode"]').value, gradingSystemId: document.querySelector('[name="gradingSystemId"]').value }, grade: [...document.querySelectorAll('select[name="grade"] option')].map(o => [o.value, o.textContent]) })
```

**T: what the institution box offers for what is typed, with the country it was typed under.** Run
while its dropdown is open.
```js
JSON.stringify({ under: { institutionCountry: document.querySelector('[name="institutionCountry"]').value }, typed: document.querySelector('#institution-ts-control').value, entries: [...document.querySelectorAll('#institution-ts-dropdown [role="option"]')].map(o => [o.getAttribute("data-value"), o.textContent, o.hasAttribute("data-selectable")]) })
```

**L: what stands beside each escape box, with the country selected when it was read.** P295: the
same per-box line as before, under `boxes`, beside the country.
```js
JSON.stringify({ under: { institutionCountry: document.querySelector('[name="institutionCountry"]').value }, boxes: ["unlistedInstitution","unlistedSubject","unlistedDegree"].map(n => { const e = document.querySelector('[name="' + n + '"]'); if (e === null) return [n, "absent"]; const before = e.previousElementSibling; const row = e.closest("tr, li, .form-group, .row, fieldset, p, div"); return [n, e.offsetParent !== null ? "visible" : "hidden", e.labels && e.labels[0] ? e.labels[0].textContent : null, e.getAttribute("aria-label"), e.getAttribute("placeholder"), e.getAttribute("title"), before ? before.textContent : null, row ? row.innerText : null]; }) })
```

The country prints as the hidden select's value (`IRAN`). The country box the runner fills
(`institutionCountry-ts-control`) sets that select, value for value (P149). So the record in the
entry names the box, with the value the select printed.

If a snippet is run where the page has no country select, it stops with an error and prints no
list. That is deliberate: a read with no country printed is the case his rule removes. A read
planned for a page with no country box at all has no country to print. Whether, and how, the rule
covers it is his to say when such a read is planned.

## The reads, in this order

1. **Country: Iran.**
2. **T, Iran.** Type `Azad` in the institution box and, with its dropdown open, run **T**. File:
   `p294-T1-institution-Azad-under-iran.json`. The row's note says the 34 Azad rows came from this
   search, read with Iran chosen (P283).
3. **Institution: "Not in list".** Type `HHE` in the institution box and choose **Not in list**.
4. **Grading system: GPA 20.** Choose *GPA 20 (e.g. 16.5/20)*.
   - Run **R**. File: `p294-R-grade-after-institution-escape-gpa20.json`.
   - It should hold every option from *Select your grade...* to the last. If the printed string is
     shortened, say so; do not complete it by hand.
5. **Subject: "Not in list".** Search the subject for `international`, press the search button,
   and choose **Not in list**.
6. **Award title: "Not in list".** Choose its "Not in list" entry, which submits the empty string.
7. All three boxes should now be showing. Run **L**. File: `p294-L-escape-box-labels.json`.
8. **Country: United Kingdom.** Clear the institution box, choose *United Kingdom*, type `Sheff`,
   and with its dropdown open run **T**. File: `p294-T2-institution-Sheff-under-united-kingdom.json`.
   The row's note says the nine Sheffield rows came from this search, *'Sheff', United Kingdom,
   2026-09-10*, which returned ten institutions; two of them read *Sheffield International College*,
   and only one is mapped.

Then leave the page without saving.

**Optional, same sitting, yours to choose: R2.** Country Iran, institution *Islamic Azad
University* (`UNI30764`), GPA 20, then **R**. File: `p294-R2-grade-azad-gpa20.json`. The records
disagree about the Master's grade rows you signed on 2026-10-04:
- the signed entry's own note says they rest on a **description** of this list, with 5 of 203
  confirmed by a line passed through (the note itself, and P285's count in CLAUDE.md);
- P286 records the message of 2026-10-04, 17:50 UTC: the form's own string, split in the shell,
  203 of 203 held; and your approval note says *"The grade list was read whole from the form and
  every row it sends is confirmed against it."*
- That split's file was never committed, so nothing in the repository can be re-read to show it.

R2 would put the list itself here, with the country and institution it was read under, so all 203
can be compared by anyone. It is not needed for the doctorate's row.

## What happens with them

- **R** becomes, in the entry, the grade's list after GPA 20 (`listsAfter` on `grade`, keyed on
  `gradingSystemId` = `6`), with `under` taken from R's own `under`: the institution's escape and
  the country. Then the grade row: on the grade's switch over the institution, a branch taken only
  after the student's own choice of the institution's escape, keyed on the country R was read under,
  then on the scale they state; for `twenty_point`, each line of R maps its label to its value.
  `checkUsable` refuses that row unless every list it rests on records the escape and the country
  its key renders (P294).
- **T** becomes the institution box's two searches, each with `under` from its own output. The
  check will then refuse the institution rows as they stand, because none is keyed on the country.
  This is expected, not measured on a read: simulated in P294 on a scratch copy, with the two
  searches built from the entry's own options, the check refused all 43. The rows are then re-keyed
  on `countryCode`, each under the country whose search holds it, from T's own lines. Until T, they
  are held to no country. `scripts/rows-held-to-a-country.ts` counts 43, none held by a
  country-recorded read. So a student elsewhere whose words match one would be typed an entry from
  a list read under another country.
- **L** gives each escape box the words the page shows (row 141).
- Each is compared with the entry by `scripts/read-against-entry.ts`, which now reads the printed
  form, says what the file was read under, and reports where the entry's record of it differs.

All of it goes into one patch, with one signature, built from the entry **as you signed it** after
P294.

## What this costs

Nothing metered: no model call and no AWS. It is your own browser on your own account, reading.
