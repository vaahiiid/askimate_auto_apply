# ADR-0113 — The interview collects a list entry by entry; a pasted CV is never the source of a profile value

**Status:** Accepted · 2026-09-15 · decides how the interview's coverage (Run B) is to be built when it is built · continues 0007 (agent-led intake), 0111 and 0112 · §4 superseded by ADR-0148 (2026-09-26): a CV may be read by a process of its own, as the separate decision this ADR said it would need; §1–§3 stand for the by-hand path
**Decided by:** Vahid Mohammadi, in his own words, 2026-09-15. **Not built**, at his word; recorded so whoever builds it starts from it rather than re-opening it.

## Context

The interview asks a field only when a question is defined for it, and seven of the registry's
twenty-seven fields have one; for any other outstanding field it stops with *"No question is
defined … The agent will not improvise one."* (P135, recorded under Run B on the distance list.)
The two list-valued groups he decided — employment history (ADR-0111) and qualifications with
their dates (ADR-0112) — are among the twenty it cannot ask, and the interview is the only source
for a qualification's *expected* or *discontinued* end, since a transcript cannot know what a
student intends. When the coverage is built, one question shapes it: does the conversation ask
for a list entry by entry, or does the student paste a CV-like block from which the model
proposes entries for confirmation?

## Decision

In his words:

> *"Entry by entry, not a CV block. The model proposing entries from a pasted CV means the model
> is the source of what goes into the profile, and confirmation after the fact is weaker than it
> looks — a student reading back five plausible-looking jobs will confirm them without checking
> the dates. Every value in this system comes from something the student said deterministically,
> and a CV block would be the first exception. If it is ever wanted, it is a separate decision
> with its own argument, not a convenience inside this one."*

So, when the interview learns to ask for a list:

1. **One entry at a time, one part at a time.** Each part is asked as the seven fields are asked
   today: the model composes the question, the student answers, a deterministic parse decides
   whether the answer is usable, and an unusable answer is asked again — never approximated
   (`packages/interview/src/field-specs.ts`'s rule). A job's start month, a qualification's end
   kind, a referee's name are each one such part.
2. **The student's claims are asked, not inferred.** A qualification's end is *completed*,
   *expected* or *discontinued* because the student said which; a job is *current* because the
   student said so. Nothing reads these off a date.
3. **"None" is a confirmation.** A student with no jobs confirms an empty list, which fills the
   page zero times and says so in the preview (ADR-0111); a list never asked stays unavailable.
4. **No value enters the profile from a document the model summarised.** Extraction stays what it
   is: a part quoted from a line of a document, grounded separately (ADR-0007's composite case),
   and never a model's reading of a whole CV. A pasted block, if ever wanted, is its own ADR.

## Consequences

- The build is one to two phases of P129's size, mine: a list mode in the interview's state
  machine, part specs for `EmploymentEntry` and `Qualification`, the "another?" and "none"
  turns, the student's page showing an entry for confirmation, and the wire's item-part keys,
  which it already carries. Not started.
- The same mechanism — a part asked as a field is asked — is what the address, the passport,
  the English test, finance and immigration need too; the coverage gap is one gap, not a
  list-valued one.

## Scope notes for the build, added as they arise

- **The seven UK status claims (ADR-0115), 2026-09-15 (P143).** Sheffield's page asks the five
  UK claims only of a non-UK national resident in the UK and the two EU claims only of one
  resident in the EU (`nationality.js`, P142); a resident abroad is asked none. The registry holds
  all seven for everyone. The interview should ask them only when the residence makes a portal
  ask — otherwise it asks most students what no portal needs. Vahid: *"agreed, Run B, not a shape
  change."* The shape is unchanged; the asking is scoped here.

- **Built, 2026-09-25 (P211), as item 1 of the list to `ready_to_submit`.** The engineering
  choices, mine and stated so: a list's walk is a keyed sequence of parts — `any`, then
  `item<N>.<partKey>` in the item spec's order, then `item<N>.another` — so the log holds it as
  `value_part_read` rows with no new event kind (migration 0025 widens the key's shape to
  `word.word` and nothing looser). `level`, `gradeScale`, a qualification's end kind and a job's
  basis are read from **closed lists the question names** and nothing else, for `ukStudyLevel`'s
  reason: `gradingSystemId` keys on the level's exact text, and a free spelling confirmed here
  would refuse to render three pages later. The lists: levels *Bachelor's degree, Master's degree,
  Doctorate, Diploma, Certificate, High school diploma*; scales `uk_honours`, `twenty_point`,
  `gpa_4`, `percentage`. Neither list is his decision; both are the smallest that cover the
  registry's own examples, and either widens by a row when a real student needs one. The two visa
  lists (`immigration.previous_uk_visas`, `immigration.previous_visa_refusals`) are not built —
  the Sheffield entry does not read them.
