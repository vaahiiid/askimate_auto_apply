# ADR-0112 — A qualification has dates: a start and an end as month and year, and an award date held on its own

**Status:** Accepted · 2026-09-14 · decides blocker 27 · continues 0111 (the shape of a month-and-year, the end that is never a blank) and 0103 (gap 3)
**Decided by:** Vahid Mohammadi, in his own words, 2026-09-14. The shape confirmed by him on 2026-09-15, all four parts as proposed, with one condition on the extraction; built in P134.

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

## The shape — confirmed by Vahid, 2026-09-15

> *"Confirmed, all four, as proposed."*

Three of its choices he asked to have in this record as reasons, in his words:

> *"The point that decided it is one I had not made: the award date is the one date on that page
> most likely to be compared against a document, because it is the date the certificate carries.
> That is not a form-filling argument, it is about what an admissions office actually does with
> the claim. Put it in the ADR as the reason rather than the cost comparison."*
>
> *"Removing completionYear is right and I want the reason kept in those words: beside an end
> date it would be a second truth about one fact, and two fields that can disagree is what this
> system refuses. That sentence generalises beyond this field and someone will need it again."*
>
> *"The three-way end — completed, expected, discontinued — is the part I would have got wrong. I
> would have built completed and expected and then discovered discontinued from a student whose
> application was already half-typed. That it comes from the form's own words, both the
> instruction to include qualifications you did not complete and the grade 'Failed to complete
> course', is the right kind of evidence. Note in the ADR that it was read off the portal rather
> than imagined, because a later phase may think it over-engineered and it is not."*

And one condition:

> *"Reading an award date off a certificate must give month and year or nothing — never a year
> with a month we chose. You said that yourself and I am making it a condition rather than a
> note, because it is the same class as the trailing-space problem: it works in testing and fails
> once, quietly, on the student whose certificate shows only a year."*

`Qualification` (`packages/profile/src/fields.ts`) gains three parts and loses one:

| Part | Type | Sheffield asks | Held because |
|---|---|---|---|
| `start` | `YearMonth`, required | *Start* — month and year, starred | every form asks when a course began |
| `end` | `{ kind: "completed" \| "expected" \| "discontinued"; date: YearMonth }`, required | *End* — month and year, starred | the date is always there; the **kind** is the student's own claim about it — finished, still studying with an expected end, or left before finishing. Never a blank: the same rule as ADR-0111's end. **The third kind was read off the portal, not imagined:** the form itself names the case, in its instruction *"Please also add any qualifications that you did not complete or failed"* and in the grade list's *Failed to complete course* (P132's read). A later phase that thinks it over-engineered should read those two lines first |
| `award` | `YearMonth`, **optional** | *Date of Award* — month and year, unstarred | the conclusion below |
| ~~`completionYear`~~ | removed | — | in his words, kept because it generalises: *"beside an end date it would be a second truth about one fact, and two fields that can disagree is what this system refuses."* Every literal that carried it (ten test and fixture files, the extraction plan) moved to the new parts |

`level`, `subject`, `institution`, `countryCode`, `grade` and `gradeScale` are unchanged.
`YearMonth` is ADR-0111's, shared. The interview cannot yet ask for any list-valued field
(P129), which is as true after this as before.

## The award date — held on its own, and the reason

**Hold it on its own, optional, and never derive it from the end.** The reason, as he asked it
recorded — the one that decided it, not the cost comparison:

**The award date is the one date on that page most likely to be compared against a document,
because it is the date the certificate carries.** That is not a form-filling argument; it is
about what an admissions office actually does with the claim. His example is the ordinary case:
the course ends in June, the degree is conferred in November, and the certificate says November.
A profile that holds the award date holds the fact an assessor checks; one that derives it from
the end date types a different date into the box the assessor checks.

The rest follows from it:

- **It is a different fact from the end**, so it is held apart from it.
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
- **The extraction reads it as month and year, or not at all — his condition.** The transcript
  plan's completion-year part became an award part: *12 November 2022*, *November 2022*, *Nov
  2022*, *2022-11* and *11/2022* read; *Year of award: 2022* reads as no award date, and the
  qualification assembles without one. Nothing supplies a month the document did not show.
  `packages/extraction/src/extract.test.ts` holds both cases.

So: `award?: YearMonth`, mapped to Sheffield's two award selects with the empty-when-absent rule,
and `end` mapped to the end selects in every case.

## Built (P134)

- `packages/profile`: the type as above; the format rules already covered the parts (`part`,
  `option` for the month name, `number` for the year, `absent: "leave_empty"`), so no rule was
  added.
- `packages/extraction`: the transcript plan reads a start (*Date of entry* and the like), an
  end (*Date of completion*, as a completion), and an award as month and year or nothing; the
  fixture transcript carries the dates, and a second fixture carries a dated award.
- Every literal that carried `completionYear` — seven test files and the gated fixture's
  mapping — moved to a start and a completed end.
- Set 0.3.22: `startDateMonth`, `startDateYear`, `endDateMonth`, `endDateYear` per
  qualification, the months by the selects' three-letter names; `awardDateMonth` and
  `awardDateYear` left empty when there is no award. The draft (0.2.21) is unchanged.
- `scripts/sheffield-draft.test.ts`: the four date selects leave the plan's `no_mapping`
  blockers (forty remain, all on the three unmapped pages); two qualifications typed once each,
  the second one's expected end typed as the date it is and its award boxes empty; a profile
  with no list is `value_unavailable` on the four, as employment's is on its four.
- Not built, said so: the interview cannot yet ask for any list-valued field (P129); the
  extraction proposes nothing for a qualification a transcript describes as expected or
  discontinued, since no label there reads those, and the interview is where they are said.

## Consequences

- Distance item 5 loses its registry gap; what remains of it is blocker 25 (the institution
  box) and the reviewer's option maps onto the observed lists.
- The two subject values with a trailing space and the one listed twice (P132) are recorded in
  the capture and the set's comment; his word: *"both mine to remember when a mapping is
  authored."*
