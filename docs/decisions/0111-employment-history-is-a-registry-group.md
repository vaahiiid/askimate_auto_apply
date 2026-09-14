# ADR-0111 — Employment history is a registry group of its own; a page of jobs repeats over it; a student with none sees that said plainly

**Status:** Accepted · 2026-09-14 · decides item 2 of the distance list (raised in P89) · continues 0103 (gap 3, a repeating page), 0104 and 0106
**Decided by:** Vahid Mohammadi, in his own words, 2026-09-14. The shape confirmed by him the same day, with one change (the referee); built in P129.

## Context

Sheffield's `employment.do` asks, per job, a start date, a job title, the employer's name and
address, and up to four thousand characters of duties, all four starred. The profile registry
(`packages/profile/src/fields.ts`) holds nothing of a student's working life under any name:
its nearest keys are a qualification's institution and dates, which are education, and the
personal statement, which is prose (P127). `planFill` therefore raises `no_mapping` on all four
and no run can be claimed. Two routes stood since P89: registry fields for employment, or the
four handed to the student as `student_handoff`.

The fact that shapes it, from `summary.do` in the portal's own words, read by Vahid:

> *"No employment information entered. If you do not have any relevant employment then you do
> not need to complete this section."*

So the section is optional; the four stars apply only once someone chooses to add a job; a
student with no work history is not stuck; and the handoff route was never needed to make the
page passable. That makes the decision one about what the product is.

## Decision

In his words:

> *"Item 2, decided: employment goes into the registry as a new group."*
>
> *"Nearly every postgraduate form asks for work history. If we hand it to the student here, we
> hand it to them at the second university and the third, and then fill-once-apply-to-many is
> not true of a part of the form that matters — for a taught master's, work experience is often
> the thing that carries a borderline application. A student who typed it once for Sheffield
> should not type it again for Manchester."*
>
> *"So: a new registry group for employment, one entry per job, with at minimum what this page
> asks — start date, job title, employer name and address, and duties. Design it for the general
> case rather than for Sheffield's four fields; other portals will ask for an end date, whether
> it was full or part time, and a reference contact. Propose the shape before building it and I
> will confirm."*
>
> *"Mark the page as repeating, the way education is. One entry per job is the same shape as one
> entry per qualification, and it should not be discovered again at fill time."*
>
> *"One thing I want to be careful about. The section being optional means the run must be able
> to complete the page with no entries at all, and say so plainly in the preview — 'no
> employment history recorded' rather than silence. A student with nothing to add should see
> that we knew and chose to leave it empty, not wonder whether we forgot."*

Three things are therefore decided: a registry group for employment, one entry per job, in the
general shape; `employment.do` marked as a repeating page over it, as `education.do` is over
`education.prior_qualifications`; and a page filled zero times said plainly in the preview, as a
fact the student authorises rather than an omission.

## The shape — confirmed by Vahid, 2026-09-14

> *"Shape confirmed. Build it as proposed."*

Two of its choices he asked to have in this record as reasons rather than left as design notes,
in his words:

> *"The end date being either an ended date or 'current', never a blank. A student who leaves a
> field empty has told us nothing, and treating that as 'still working there' is exactly the
> silent inference this system exists not to make. The distinction costs one extra question and
> removes a whole class of wrong answer."*
>
> *"And the referee being a third party's personal data held only when the student gives it,
> with the guardian fields as precedent. That is the reference-letter problem from B1 row 4
> arriving in a new place."*

And one change:

> *"The referee's email and phone: do not collect them at all until a portal we actually support
> asks for them. A name and role tells us the referee exists. An email and phone is contact
> details for someone who has not heard of us, held on the chance that a future form wants them.
> Hold what we need when we need it."*

One list-valued, ordinary registry field, `employment.history`, label *Employment history*, each
item an `EmploymentEntry` (`packages/profile/src/fields.ts`):

| Part | Type | Sheffield asks | Held because |
|---|---|---|---|
| `employer` | string, required | *Name and address of employer* (with the next) | every form asks who |
| `employerAddress` | string, required, as the student gives it | *Name and address of employer* | Sheffield wants it in the same box; other forms split it; free text refuses nothing a student knows and invents nothing they do not |
| `position` | string, required | *Job Title / Position held* | every form asks what |
| `startDate` | `{ year, month }`, required | *Start Date* — month and year as two selects | a job has no day; a `Date` would carry one we never had |
| `end` | `{ kind: "ended", date: { year, month } }` or `{ kind: "current" }`, required | *End Date*, optional on Sheffield | "no end date" must be the student's statement that the job continues, never our inference from a blank |
| `basis` | `"full_time"` or `"part_time"`, optional | not asked | other portals ask; a form that requires it and finds none asks the student, as any unavailable value does |
| `duties` | string, required | *Brief Overview of Duties*, max 4,000 | the free text that carries a borderline application; the portal's cap is the field's `maxlength`, refused at the fill if exceeded, never trimmed |
| `referee` | `{ name, role? }`, optional — **no email, no phone**, by his word above | not asked | other portals ask; **a third party's personal data**, held only when the student gives it and named as such, with `guardian.*` the precedent; contact details only when a supported portal asks |

- Category **ordinary**: employment is not an Article 9 category; `duties` is free text of the
  student's own, as `study.personal_statement` is.
- A mapping to a part uses the existing `part` rule, nested (`part startDate → part month`); the
  month's name comes from the existing `option` rule (1 → *January*), so no month rule was
  needed. Two things were: `part … absent: "leave_empty"`, which renders the empty string when
  the part is absent — a current job has no end date, and the portal's end-date boxes are left
  empty because of what the student said — and `join`, which puts the employer's name and
  address into the one box Sheffield offers. Both in `packages/profile/src/format.ts` and the
  catalogue parser, red first.
- **Confirmed-empty is not unavailable.** A student with no work history confirms an empty list
  through the interview; the plan then fills the page zero times and the preview says so. A list
  never asked for stays *unavailable* and blocks the required fields, as any unasked value does —
  "we knew and chose to leave it empty" is a confirmation, not a default.
- The preview already carries a line for a page filled zero times, inside the hash (P96:
  *`<title>: none — the page is left as it is`*). The page's title becomes *Employment history* so
  the line reads as he asked, and the test pins the wording.

## Built (P129)

- Registry: `employment.history`, list-valued, ordinary, labelled; the entry type as above with
  the referee narrowed; persistence round-trips it.
- Curated draft 0.2.19: `page8` titled *Employment history* and repeating over
  `employment.history`; set 0.3.19 maps the four required fields, the start year and the end
  date per job. `scripts/sheffield-draft.test.ts` fills the page twice from two jobs — the
  current one's end boxes empty — and zero times from a confirmed empty list, with the preview
  line *Employment history: none — the page is left as it is* inside the yes; a profile never
  asked stays `value_unavailable` on the four.
- Item 2 of the distance list is done; the plan's `no_mapping` blockers are the forty-four
  observed-mandatory fields of the three unmapped pages, and no longer employment's four.
- Not built, and said so: the interview does not yet ask for any list-valued field (the
  qualifications list has the same gap); the plan does not check a `maxlength` against a
  rendered value, so a 4,000-character cap is the portal's refusal to meet, not ours to
  pre-empt; the listing on `summary.do` for a saved job is his read, below.

## What the build needs from him besides the confirmation

- **The listing on `summary.do` for a saved job** (ADR-0106): the runner counts entries before
  and after each save, and one more is the save; without the entry locator every item is
  *uncertain*. Education's was read from a heading (*Previous Education N*, P113). His account
  holds no employment entry. **His call, 2026-09-14:** *"I will save one by hand and delete it
  after. It is my own account and one throwaway entry is cheaper than running every employment
  page as uncertain forever."* What to capture is in the 2026-09-10 capture README under
  *Employment*; `recorded` goes on the page when the read is in.
- The *add another* control, if `employment.do?new=true` is not the way in, as it is for
  education — he checks it in the same sitting.

## Consequences

- `planFill` stops raising `no_mapping` on the four once the set maps them; the plan's blocker
  list in `scripts/sheffield-draft.test.ts` loses four entries and the count in item 2 closes.
- The interview gains a group to ask for, one entry at a time, with an explicit "none" that is
  confirmed rather than assumed.
- Nothing here decides how the duties text is written; it is the student's, confirmed verbatim,
  as every free-text value is.
