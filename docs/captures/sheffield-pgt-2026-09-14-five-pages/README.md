# Sheffield PGT — the five unlabelled pages, attached read of 2026-09-14

**Read by:** Vahid, on his own signed-in account, with the attached inspection tool (commit
b338705) · **Pages:** nationality, language, education (`?new=true`), marketing, documents ·
**For:** item 1 of [`distance-to-a-reviewed-sheffield-run.md`](../../distance-to-a-reviewed-sheffield-run.md)
— which fields on these five pages are mandatory.

## What this read shows, and what it does not

All five pages read, none failed, nine off-list requests refused (tag manager and the like;
`run.json`). The draft carries 149 fields with their names, ids, types, options and DOM
attributes.

It does **not** carry the asterisks, and so it does not close item 1. On 139 of the 149 fields
the label is the field's name; no label carries `*`; no field carries a `required` validation.
The observer resolved a label through `label[for]`, a wrapping `<label>` or `aria-label`, and
these pages tie no label to any input — Vahid's own reading of the markup: the question in the
row's first cell and a bare `<font>*</font>` beside it, tied to nothing. One field carries an
empty label (`institutionCountry-ts-control`, the education page's country box, an empty
`<label for>`), which a reviewed entry would refuse.

| Page | Fields | Label is the name | Starred | Required |
|---|---|---|---|---|
| nationality | 73 | 72 | 0 | 0 |
| language | 20 | 19 | 0 | 0 |
| education | 34 | 30 | 0 | 0 |
| marketing | 11 | 8 | 0 | 0 |
| documents | 11 | 10 | 0 | 0 |

## What closes it: the observer now reads the row (P123)

`apps/browser-runner/src/observe-script.ts` reads, for a control the markup ties no label to,
the text of its row before the row's first control — the question every control in the row
answers, other controls' contents excluded — and records it as `context`; discovery makes it
the field's label with `labelSource: "row_text"`, so the review pack can say which labels are
a judgement from position. A visible `*` in the row becomes a `required` validation with source
`observed_marker`, distinct from an attribute read off the element. A radio's own words are the
text after it; the group takes the row's question. A row that names no question keeps the
field's name, unlabelled and unmarked, so a country list does not become a question. An empty
tied label is no label. Proved on a fixture in the shape Vahid described
(`apps/browser-runner/src/observe-row-text.test.ts`); Sheffield's markup is not in this
repository.

**What to run:** the same attached read, after pulling `main`. The summary now prints two
more lines, `Labels from row text N of M` and `Marked mandatory K`, which say at once whether
the read got the asterisks.

## Vahid's console readings of 2026-09-14, held as his

Three console-snippet outputs of nationality never reached the record (the paste was lost
between the browser and the message each time; the attached tool writes to disk, which is why
it was used instead). His observations from them stand as his, unconfirmed against any JSON
here, until the re-read carries the same facts: twenty-seven bare `<font>*</font>` markers;
the starred residence-history questions with no registry counterpart (item 3); `passportNumber`
starred, with a portal instruction on what to enter without a passport; the five document
companions unstarred behind UK-status conditions in the portal's words; `refugeeStatus` the one
starred radio group; the four `previousCountry` blocks whose rows carry no question text. The
re-read is what decides each.
