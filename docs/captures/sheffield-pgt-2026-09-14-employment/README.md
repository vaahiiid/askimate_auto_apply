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
`div.homepageInfomation`, exact to the number. `scripts/sheffield-draft.test.ts` pins the
locator. Each employment save is now counted rather than *uncertain*.

**Confirmed from the markup (`001.html`, committed ebac18d, P131).** Section F is
`div.homepageBlock` > `h2` *F. Relevant Employment* > `div.homepageInfomation`, whose direct
children are the section's sentence, then one `h5` *Previous Employment 1*, then a
`table.dataTable` of four rows, then `div.homepageUpdateSubLinks` with *Edit* and *Delete*; the
block ends with `div.homepageUpdateLinks` and the *Add new employment details* link. Education's
section E has exactly that shape with *Previous Education N*. So the locator authored on his
word stands on the page, and the draft is not corrected. `apps/browser-runner/src/preparation.test.ts`
served this file to the runner's own `count` and got 1 for employment, 2 for education, and 0
for the numbered heading of a section that has none. **The file was removed on 2026-09-25**
(31e8848, Vahid): its applicant table carried a real e-mail address in page text, which the
capture scrub — input values only — did not cover; the check recorded below ("zero matches" for
his surname and e-mail) did not look for another person's. Since P219 the test counts on
`apps/browser-runner/fixtures/sheffield-summary-listing.html`, the listing's markup as this
README records it, holding no person's data.

Three more things the markup carries, none of which he could have seen from the page's text:

- **The portal offers an edit view of a saved entry:** the *Edit* link is
  `employment.do?update=1` (education's, `education.do?update=2`). This is the thing his rule
  names as the condition for a value read-back of a saved entry — *"If a portal ever offers an
  edit view of a saved entry, that is when it becomes possible, and not before"* — so it is now
  possible in principle. It is **not built and not decided**; ADR-0106 §2 stands as he decided it,
  and the count remains the whole verification. Recorded so it is not rediscovered.
- **The *Add new employment details* link is the bare `employment.do`**, not `?new=true`;
  education's is `education.do?new=true`. Both openings he tried returned an empty form; the
  draft's page URL is the bare one.
- **Employment's *Delete* has no confirmation** (`employment.do?delete=1`, no `onclick`);
  education's asks *Are you sure you want to delete this course?*. Nothing in this system deletes
  anything on a portal, so it changes nothing; noted because a person deleting a throwaway entry
  by hand gets no second chance here.

He checked the file for his surname and e-mail before committing: zero matches. It carries his
account's education entries as saved (synthetic, P113) and the throwaway job.

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
