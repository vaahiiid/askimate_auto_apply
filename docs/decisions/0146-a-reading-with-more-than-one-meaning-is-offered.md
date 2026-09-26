# ADR-0146 — A reading with more than one meaning is offered, never guessed and never refused

**Status:** Accepted · 2026-09-26 · continues 0051 (a reading is put to the student and confirmed), 0062 (the question is in the log), 0140 (a composite's parts are on the log), 0145 (the record is the count) · narrows P223's refusal to what cannot be read at all
**Decided by:** Vahid Mohammadi, in his own words, 2026-09-26, after P223's refusal of his date of birth left him to find the shape that reads. Built in P225.

## Context

P223 made the reader refuse a numeric date that reads two ways, and say why: *"11/08/1989" could
be 11 August 1989 or 8 November 1989, and I do not guess which.* Not guessing was right — a date
of birth decides whether the applicant is a minor, and ADR-0051 puts every reading to the student
before it is held. Refusing was not. The student knows which they meant; the refusal told them
what was seen and left them to work out which shape to type; and a third such answer would have
stopped the run on a date they had given correctly twice. His words:

> *"The date fix works — the two-way refusal names both readings, and '11 aug 1989' read in lower
> case and played back 1989-08-11. Confirmed and stored. But the refusal is a dead end for a
> real student … Not guessing was right. Not offering is the defect."*
>
> *"The system already knows both readings. It should put them to the student and let them
> pick, the same way it plays back a reading for confirmation today: '11/08/1989 could be
> 11 August 1989 or 8 November 1989. Which did you mean?' with the two as choices, the way the
> consent question offers its two."*

And the two conditions:

> *"The pick is an answer to the open question, not a new question — so it should not spend an
> attempt, and the count must not treat choosing between two offered readings as a failed
> attempt."*
>
> *"It generalises. Any field where the reader can see more than one valid reading should offer
> them rather than refuse … the mechanism should be the field's, not the date's."*

## Decision

1. **A reader may return more than one valid reading, and then the readings are offered.** A
   scalar field's spec and a composite's part each carry an optional `readings(raw)` beside
   `parse`. When `parse` refuses and `readings` returns two or more, the answer is `ambiguous`:
   each reading is a proposal in its own right, carrying the student's verbatim words, labelled
   in words for the student. It is not a refusal. No attempt is spent, nothing is recorded as
   unread, and the question stays open. One reading is never an offer — it is read, or it is
   refused with why, as P223 built.

2. **The offer is on the record, hashed, and the pick is bound to it.** `value_offered` carries
   the field, the part when there is one, the readings (id, label, proposal) and the hash of
   the offer as put (migration 0027). The run's pending decision is `choose_reading` with that
   hash and the readings' ids and labels; the student's decision is `choose_reading` with the
   hash and one id. A pick over an offer the student can no longer see is refused as
   `content_changed`, the way a confirmation over a stale playback is (ADR-0051); an id the
   offer did not carry is refused. The page shows the readings as buttons under *Which did you
   mean?*, beside the consent question's shape.

3. **The pick is the student's own statement of the value, and an answer to the question that
   stands.** For a scalar the pick is proposed and confirmed in one act: a `value_proposed`
   carrying the reading they chose, then the `value_confirmed`, both bound to the offer's hash,
   and the value reaches the profile. The label they pressed is the playback's own words for
   that reading, so asking *Is that right?* afterwards would put the same words back to them;
   the offer IS the playback. For a part the pick is read as that part, the walk continues, and
   the whole value is played back for confirmation as ADR-0140 has it. Neither the offer nor the
   pick writes a `value_asked`: the count ADR-0145 gives the asking is untouched, and the next
   field's first asking writes 1.

4. **The mechanism is the field's.** `readings` is a property of a spec or a part, not of the
   date reader, and the driver, the log, the contract and the page know only `ambiguous`,
   `value_offered` and `choose_reading`. Measured today: the numeric date reader is the only
   reader in the interview that can see two valid readings, and the four places it is used
   carry `readings` — the date of birth, a passport's expiry, a language test's date, a current
   visa's expiry. The month-and-year reader (P191) refuses a numeric `09/08` outright, because
   its one-way forms are enough and nothing in the run has met the two-way one; the country,
   e-mail, name, yes/no and list readers have one reading or none. A reader that grows a second
   valid reading adds `readings` to its spec and touches nothing else; a reader that returns one
   reading from `readings` has made a mistake the interview refuses, not a refusal it softens.

## What was found on the way

**A Date confirmed through the log was stored as a string.** Migration 0003 tagged the profile's
JSON precisely because a plain round-trip turns a Date into its string silently. The profile
store honoured that; the conversation log did not. A proposal crossed the log as plain JSON, the
Date inside became its ISO string, and a confirmation read back from the log stored that string
as the confirmed value. The plan then refused the three date-of-birth maps as `render_refused`,
its next step read `specialist` while the run's status was `running`, and the page printed the
step and the status — *specialist (running)* — which is what he saw during the interview and
asked to have explained. It is a real state, not a wrong label: the run was running, and its
next step was a person, because the profile held a value the plan could not render. The service
now encodes at the log boundary — every proposal, part and offer written, every one read back —
and the driver's test asserts the stored shape of the date is the tagged one. Migration 0028
re-tags the rows written before it did, in the four places a date lives in a profile; his own
date of birth, confirmed on the 26th through this path, is such a row, and the migration runs
before his run's next answer. What the page should say when a running run's next step is a
person is row 92, and his to decide.

## What this does not decide

The wording of the position line (row 92). `MAX_ATTEMPTS_PER_FIELD` (three), which the pick
does not touch. Whether a scalar pick should be played back a second time before it is held —
built as one act for the reason in §3, and his word if he wants the second playback. It reads no
list, page or portal.
