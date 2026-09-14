# Sheffield PGT — the employment listing and the new-entry form, with one throwaway job saved, 2026-09-14

**Read by:** Vahid, on his own account, with the attached tool in its normal mode (commit 9a0bcea)
· **Pages:** `summary.do`, `employment.do?new=true` · **Summary printed:** `Labels from row text
2 of 9`, `Marked mandatory 5` · **For:** ADR-0106's `recorded` on the employment page (ADR-0111,
P129) and the two questions the build left him: the listing's heading and the way in.

The throwaway job — employer *Example Employer Ltd, 1 Example Street, Sheffield*, position *Test
Assistant*, start January 2020, no end, duties a throwaway line — was saved by hand before the read
and deleted after it; section F reads *No employment information entered* again. The commit
carries `blueprint.draft.json` and `run.json`; the capture's HTML pages are not in it, so what
the listing's markup is comes from his words, marked below where it does.

## What the file carries

| Page | Fields | Row-text labels | Marked |
|---|---|---|---|
| `summary.do` | 1 (the site search box) | 0 | 0 |
| `employment.do?new=true` | 8 | 2 | 5 |

## The heading, and the entry locator authored from it

His read: *"Previous Employment 1"*, exactly as the page shows it — *"Same shape as Previous
Education 1"*. The curated draft (0.2.20) names the listing on `page8` the way P113 named
education's: `summary.do`, one entry per `h5` reading exactly *Previous Employment N* inside
`div.homepageInfomation`, exact to the number. The `h5` and its wrapper are education's, taken
on his word that the shape is the same; the page's HTML would prove it and is not in the commit.
`scripts/sheffield-draft.test.ts` pins the locator. Each employment save is now counted rather
than *uncertain*.

## What the summary lists — and does not

Under the heading, in this order (his read): start date, end date (blank, the job current), job
title, name and address of employer. **Duties is not shown.** The form took it and did not
complain; the summary omits it.

What this means, against ADR-0106 as decided: a page filled once per item is **counted** on its
listing and never read back by value (§2), because the new-entry form reopens empty. So nothing
today confirms a saved job's *values* — not from the summary, not from the entry's own page — and
the count is the whole of the verification. His observation sharpens what a future read-back
could be: the listing could never cover duties, so a value read-back of a job would have to come
from the entry's own page, if the portal offers one; whether the listing links to an edit view is
not in the record.

## The way in

`employment.do?new=true` opened empty after the save — eight fields, as before the entry existed —
so the new-entry URL is the way in, as it is for education, and `addAnother` is not needed. The
summary carries an *Add new employment details* link, as education's does.

## The five marked, and the fifth

From the file: `startMonth`, `startYear`, `position`, `employerDetails`, `duties`. The fifth is
`startYear`. Its row is *Start Date:\** and it shares that row with `startMonth`, whose tied label
carries the star; the year's label came from the row (`labelSource: "row_text"`, *Start Date:*)
and the row's marker was attached to both. So the star is the row's, one star for the date, and
whether the portal enforces the year on its own is not something the file can say. It is moot
for the fill: the set maps both, and a start month without its year is not a start date. The
same mechanism marked `unlistedDegree` on the education page (P126), where it is flagged.

The two `endMonth` / `endYear` boxes are unmarked, as their row is; both are mapped and left
empty for a current job (ADR-0111).
