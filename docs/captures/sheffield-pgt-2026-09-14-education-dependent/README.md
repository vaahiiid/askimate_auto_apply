# Sheffield PGT — the education page read as it stood, with an institution and a grading system chosen, 2026-09-14

**Read by:** Vahid, on his own account, with `--as-is` (P127; commit 645da1f) · **Page:**
`education.do?new=true`, one tab, not navigated · **Summary printed:** `read in place, not
navigated`, `Labels from row text 18 of 34`, `Marked mandatory 10` · **For:** item 5 of
[`distance-to-a-reviewed-sheffield-run.md`](../../distance-to-a-reviewed-sheffield-run.md) —
the lists that arrive only after a choice.

**What he chose, so the lists are attributable** (the file records lists, never selections):
country *United Kingdom*; institution *University of Sheffield*; grading system *UK Bachelor's
Degree (BA, BSc)* — the option's exact text is *UK Bachelors Degree (BA, BSc)*, value `7`;
subject search *business*. No grade, no subject result, nothing saved. `run.json` says
`readInPlace: true`, no request refused. Every number below is read from the file.

## 1 · The grade list arrived

Nine options, values as labels, for grading system `7`:

| value | reads |
|---|---|
| `Select your grade...` | the placeholder |
| `Still waiting for grade` | a non-grade |
| `Failed to complete course` | a non-grade |
| `1st`, `2.1`, `2.2`, `3rd`, `Pass`, `Fail` | the six grades |

His caveat holds and is the record's: the list is **per grading system**. What the file holds
is system 7's grades, not every system's; a mapping that names a grade under another system
needs another read with that system chosen.

## 2 · The subject results arrived, by search-then-select

Eighty-seven options after pressing *Search* for *business*: the two placeholders (`Select
subject...`, `Not in list`) and eighty-five entries. The shape is the one the draft models
(P100, ADR-0105): a plain `<select>` whose options arrive after a press of `subjectSearchButton`,
recorded as `optionsAfter` with the press — not a typeahead, and the Tom Select locator plays no
part. Two things a mapping must know:

- **Two values carry a trailing space the label hides:** `GCE Applied Business Advanced ` and
  `Skills for Business: Customer `. The form submits the value; an exact-value mapping (ADR-0109's
  rule, applied to a select) names it space included, never the label.
- **One value is listed twice**, `Business Administration`, identical in value and label. Either
  entry submits the same thing, so nothing is lost; noted because "two entries that read the
  same are told apart by value" (ADR-0109) does not apply when the values are the same too.

Several values are the portal's own truncations (*Business Studies With Humaniti*, *Agri
Marketing and Business Ad*); they are recorded as the form has them.

## 3 · The chain, from observation

| Field | Options in the file | Arrives after | What the file shows |
|---|---|---|---|
| `institutionCountry` | 256 (255 countries and the blank) | — | static; the UK's value is `UNITED KINGDOM`, upper-case names as values |
| `institution-ts-control` | (the typeahead; P118's eleven entries for *Sheff*) | the country | unchanged |
| `institutionCode` | 2: the blank and `SHEFFIELD` → *University of Sheffield* | the typeahead's choice | the hidden select holds the chosen entry's value only — and it is the value P118 recorded on the typeahead entry, so ADR-0109's rule and the select agree |
| `gradingSystemId` | 6: the placeholder, `Not in list`, `7` *UK Bachelors Degree (BA, BSc)*, `8` *UK Masters Degree (MA, MSc)*, `9` *UK Research Degree*, `81` *UK Medical Degree (MBBS, MBChB)* | `institutionCode` | numeric ids; **per institution** — these are Sheffield's four |
| `grade` | 9, above | `gradingSystemId` | **per grading system** — system 7's |
| `subject` | 87, above | the press | one search word's results |

So the chain `institutionCountry → institutionCode → gradingSystemId → grade` is now written in
the curated draft (0.2.21) from what the page held, and the `optionsAfter` links the draft has
carried since P94 stand as observed. The escape on the grading system is `Not in list` (value and
label), which shows the unlisted-grade boxes; nothing here names it.

## What the read changed, and what it did not

- **Folded into the curated draft 0.2.21:** the four lists above, as observed, with the search
  word and the chosen institution and system named in the set's comment. Set 0.3.21 re-bound.
- **No mapping authored.** The registry's `Qualification` holds a level, subject, institution,
  country, completion year, grade and grade scale — and **no start or end date**. The page's
  four date selects (`startDateMonth`, `startDateYear`, `endDateMonth`, `endDateYear`) are marked
  mandatory in every read. So the page cannot be filled from the registry as it stands, whatever
  is mapped, until the profile holds a qualification's dates. **Raised as blocker 27**, his
  decision, the same shape as item 2 was: what the profile collects is a product decision.
- **`degree` and `unlistedDegree` came back unlabelled and unmarked** where the third read had
  them labelled (*Qualification:*) and marked. The file has no markup, so which it is cannot be
  settled here: the observer's P125 refusals explain the unlisted box's lost label and nothing
  else, so the row itself read differently with an institution chosen. The draft keeps the third
  read's marks on both, and the review pack flags them for Iman: the star was seen once and not
  seen once, and the page decides.

## Ten marked

`startDateMonth`, `startDateYear`, `endDateMonth`, `endDateYear`, and the six document
companions — the fifty's education share less `degree` and `unlistedDegree`. Read as rows
(P131): the start and end dates are two starred rows of two selects each.
