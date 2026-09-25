# Sheffield — Part 2: the overview's links and the taught-course page, read in place (2026-09-25)

**Read by:** Vahid, on his own account, `--as-is`, pressing nothing at any point. His commit
`581070e`; this README is P215's reading of it. His account of what he did is the record:

> The overview page, read in place. Its only two links out of Part 1 are plain `<a href>` GETs,
> both under `/postgradapplication/`: `studyprogrammetaught.do`, `studyprogrammeresearch.do`. No
> form, no button. So opening Part 2 commits nothing. I opened the taught one — an MSc is taught.
> The taught-course page, read in place, untouched: 2 forms, 14 fields, 6 marked mandatory. Its own
> form is `studyProgrammeTaughtForm`, `method="post"`, `action="/postgradapplication/studyprogrammetaught.do"`,
> submits `saveBtn`, `backBtn`. The same shape as every Part 1 page — a save and a back, no id on
> either, and NO submit-the-application button anywhere on it.

## What the taught page holds

| Box | Kind | Marked | What loads it |
|---|---|---|---|
| `studyTerm` | select: Full Time / Part Time / Part Time Distance Learning | * | static |
| `startYear` | select: *August 2026 to July 2027* = `2026`, *August 2027 to July 2028* = `2027` | * | static; `2027` was pre-selected on his account |
| `course-ts-control` (+ hidden `courseSelection`) | Tom Select typeahead, *Search for a course…* | * | `updateCourses()` on `studyTerm` and `startYear` |
| `qualification` | select, empty until a course is chosen | * | `updateQualifications()` on the course |
| `startDate` | select, empty until a qualification is chosen | * | `updateMultipleStartDates()` on the qualification |
| `flexibleStartDateDay` / `Month` | selects in a row hidden by default | (* on its label) | shown for a course with a flexible start |
| `fundingSourceKnown` | radio Yes / No | * | static; toggles the three rows below (`fundingSourceKnownChanged()`) |
| `fundingSource` | select, 32: five generic and twenty-seven named scholarships | | static |
| `fundingDetails` | text | | static |
| `fundingStage` | select, five stages | marked by the tool | static |

The page's script (`studyprogrammetaught.js`) was not captured, so the loaded lists and the row
conditions are read from the markup's own handler names, not from their bodies.

## His three questions, read from the capture

**Where the final submission is.** Not on this page: the form has a save and a back, the shape of
every Part 1 page, and saving Part 1's pages submitted nothing (Run A; the portal's own line was
*"Completed Part 1"*). What the capture implies: saving here saves **a course choice**, one per
save, as the overview's *three course choices* line says. What it cannot say: whether saving a
choice is that choice's submission or whether a Submit appears on the overview afterwards (the
overview's HTML was not kept, and nothing read shows the overview after a choice is saved); and
whether a saved choice can be removed. **Unread**, and said so — row 80. The research route is
unread too — row 79.

**One case, one course.** The page takes one course per save and Part 1 is shared. For the goal —
one course, his — the model needs no change: one case, its Part 1 pages and this page. The strain
is real only for a second course on the same account: a second case would carry Part 1 in its
preview and re-type it into a record the first case saved. Row 81, not a phase; nothing on the
path re-decides it tonight.

**Funding.** Three of the six boxes are mandatory and the registry holds `finance.funding_source`
(free text: *"who is paying, e.g. self-funded, family, an employer, a government scholarship"*),
`finance.sponsor_name` and `finance.available_funds`. Read box by box: `fundingDetails` is
answerable from `sponsor_name` when there is a sponsor or a named scholarship; `fundingSourceKnown`
is answerable only in the *Yes* direction and only by deriving it from a source being held — and
*No* has no registry home; `fundingSource` cannot be keyed on free text (blocker 25's shape) and
needs the registry's source to become a closed vocabulary — self or family, employer, sponsor,
scholarship with its name, loan, other — before a map can be right; `fundingStage` is not held at
all and needs its own question. So: one answerable, one answerable in one direction by a
derivation his rule refuses, two not held. That is a registry decision, his, and it is put to him
in P215's report rather than built.

## What was built from this read (P215)

Page 12 in the entry's blueprint and the curated draft, from the taught draft as read: fourteen
fields, the loading order as the handlers name it (`course-ts-control` after `startYear`,
`qualification` after the course, `startDate` after the qualification), `saveBtn` by name as the
advance (Run A's lesson), page 11 continuing to it. One map: `courseStartYear` (the page's `startYear`, renamed because page 8 already holds that ref; the locator carries the real name) as a reviewed constant,
`2027`, from the target's intake. Everything else on the page is a `no_mapping` blocker at the plan,
loudly, until: his statement of the study mode in the target file; his next read with the course
chosen in the typeahead (a client-side choice, not a save); and the funding decision.

## The second read (526174c), and what P216 built from it

`taught-with-course-*`: the course typed into the typeahead and chosen, the qualification left to
load, Save not pressed. Read from the file: `courseSelection` holds two MGT entries and the chosen
one submits `MGT:Management and International Business`; `qualification` loaded one real entry,
*MSC, Master of Science*; `startDate` has no entries — the list follows the qualification and none
was chosen (row 83). The funding radios carry `value=""` on both (row 84). Built: the course, the
qualification and the study mode (his words) as reviewed constants; the four funding boxes from
`finance.funding` (ADR-0143). One box stands: `startDate`.
