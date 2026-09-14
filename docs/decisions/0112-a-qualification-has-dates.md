# ADR-0112 — A qualification has dates: a start and an end as month and year, and an award date held on its own

**Status:** Accepted · 2026-09-14 · decides blocker 27 · continues 0111 (the shape of a month-and-year, the end that is never a blank) and 0103 (gap 3)
**Decided by:** Vahid Mohammadi, in his own words, 2026-09-14. The shape below is **proposed and not yet confirmed**; nothing is built until he confirms it.

## Context

Item 5's read of `education.do` as it stood (P132) put the grade list and the whole education
chain into the curated draft from observation — and showed that the page cannot be filled from
the profile whatever is mapped: its four date selects (`startDateMonth`, `startDateYear`,
`endDateMonth`, `endDateYear`) are marked mandatory in every read, and the registry's
`Qualification` holds a level, a subject, an institution, a country, a completion year, a grade
and a grade scale, and no start or end date. Raised as blocker 27, his decision, the same shape
as item 2 (ADR-0111).

## Decision

In his words:

> *"Blocker 27: add the dates to Qualification. Same reasoning as employment, and for once the
> precedent makes it easy rather than a fresh argument."*
>
> *"A student who typed their degree's start and end dates for Sheffield should not type them
> again for Manchester. And every form asks — a qualification without dates is not a
> qualification anyone can assess. This is not a Sheffield quirk to work around, it is a gap in
> what the profile knows about a student's education."*
>
> *"Shape: start and end as month and year, matching the employment entry's, since a
> qualification has no meaningful day either. Propose it properly before building and I will
> confirm, the same as last time."*

And the question he asked to have answered rather than decided silently:

> *"Sheffield asks start, end, and date of award as three separate things, with award
> unstarred. Award is not the same as end — someone finishes in June and is awarded in November.
> Whether the profile holds award separately, or holds only start and end and leaves award
> unmapped, is a real question and I do not know the answer. Tell me which you think and why."*

## The shape — PROPOSED, awaiting his confirmation

`Qualification` (`packages/profile/src/fields.ts`) gains three parts and loses one:

| Part | Type | Sheffield asks | Held because |
|---|---|---|---|
| `start` | `YearMonth`, required | *Start* — month and year, starred | every form asks when a course began |
| `end` | `{ kind: "completed" \| "expected" \| "discontinued"; date: YearMonth }`, required | *End* — month and year, starred | the date is always there; the **kind** is the student's own claim about it — finished, still studying with an expected end, or left before finishing. Never a blank: the same rule as ADR-0111's end. The third kind exists because the form itself names the case (*"Please also add any qualifications that you did not complete or failed"*; the grade list's *Failed to complete course*) |
| `award` | `YearMonth`, **optional** | *Date of Award* — month and year, unstarred | the conclusion below |
| ~~`completionYear`~~ | removed | — | it would be a second truth beside `end.date.year`, and two fields that can disagree about one fact is the inconsistency this system exists to refuse. Every literal that carries it (ten test and fixture files, the extraction plan) moves to the new parts in the build |

`level`, `subject`, `institution`, `countryCode`, `grade` and `gradeScale` are unchanged.
`YearMonth` is ADR-0111's, shared. The interview cannot yet ask for any list-valued field
(P129), which is as true after this as before.

## The award date — what I conclude, and why

**Hold it on its own, optional, and never derive it from the end.**

- **It is a different fact.** His example is the ordinary case: the course ends in June, the
  degree is conferred in November, and the certificate carries the November date. That
  certificate is what an admissions office checks a claimed qualification against, so the award
  date is the one date on the page that an assessor is most likely to compare with a document.
- **Deriving it from the end would be invention.** Filling Sheffield's award boxes from
  `end.date` would type a date the student never stated as the award, in a box the portal
  labels *Date of Award*. That is exactly the quiet inference ADR-0111 refuses for a blank end
  date, in the other direction. The only honest sources are the student's statement or a
  document that shows it.
- **Leaving it unmapped is honest but loses a fact other forms require.** On Sheffield the
  field is unstarred, so leaving it empty passes. A form that stars *date of graduation* would
  then ask the student for it, and a student who typed it once should not type it again — his
  own reasoning for the dates in the first place.
- **Optional, and absence claims nothing.** ADR-0111 made the employment end explicit because
  an absent end date would have been *read as* "still working there" — a blank turned into a
  claim. An absent award date is read as nothing: the mapping leaves the portal's award boxes
  empty (`part … absent: "leave_empty"`, ADR-0111's rule), which is what a student who has not
  yet been awarded would do, and a form that requires the date finds the value unavailable and
  asks, as for any unasked value. A qualification in progress has no award date, and a completed
  one may not yet have been conferred; requiring it would force a claim nobody can make.
- **The cost is one optional question** for a student who holds a certificate, and one
  extraction part: the plan that today reads a *completion year* off a certificate would read the
  award date instead — month and year when the document shows them, and nothing rather than a
  year alone, since a `YearMonth` with an invented month is not one.

So: `award?: YearMonth`, mapped to Sheffield's two award selects with the empty-when-absent rule,
and `end` mapped to the end selects in every case. If he decides the other way — start and end
only, award unmapped — nothing above is lost except the one fact, and the ADR says so.

## What the build will touch, when confirmed

- `packages/profile`: the type, the persistence round-trip, the format rules already cover the
  parts (`part`, `option` for the month name, `number` for the year, `absent: "leave_empty"`).
- `packages/extraction`: the certificate plan's completion-year part becomes an award part.
- The fixtures and tests that carry `completionYear` literals; the journey profiles.
- Curated draft: no change to the page; set: `startDateMonth`, `startDateYear`, `endDateMonth`,
  `endDateYear`, `awardDateMonth`, `awardDateYear` mapped per qualification, in the shape of
  the employment mappings (0.3.19).
- `scripts/sheffield-draft.test.ts`: the four date selects leave the plan's `no_mapping`
  blockers; a qualification typed once per item with its dates; an in-progress qualification's
  expected end typed and its award boxes left empty.

## Consequences

- Distance item 5 loses its registry gap; what remains of it is blocker 25 (the institution
  box) and the reviewer's option maps onto the observed lists.
- The two subject values with a trailing space and the one listed twice (P132) are recorded in
  the capture and the set's comment; his word: *"both mine to remember when a mapping is
  authored."*
