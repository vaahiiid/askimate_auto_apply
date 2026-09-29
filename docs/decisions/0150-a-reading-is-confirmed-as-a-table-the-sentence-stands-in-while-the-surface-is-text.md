# ADR-0150 — A reading is confirmed as a table; the sentence stands in while the only surface is text

**Status:** **Accepted** — Vahid's decision, 2026-09-29, in his own words (P248)
**Depends on:** [ADR-0148](./0148-the-interview-is-an-ai-asking-not-a-form-read-aloud.md) §9,
[ADR-0149](./0149-some-parts-are-the-students-to-state-grounding-catches-invention-not-inference.md),
[ADR-0112](./0112-a-qualification-has-dates.md) (amended by this phase)
**Amends:** [ADR-0112](./0112-a-qualification-has-dates.md) — the rule forbids supplying a month,
not asking for one

## Context

P246 built the reader and the seeding: a CV confirmed into the vault is read once, and what it
gave goes onto the conversation log as part readings the interview holds as if the student had
typed them. P247 measured it on his own CV and left three things for his word: what the student
is told when a CV has been read (row 103 — nothing told them), whether a year the CV states alone
is asked as a whole date or as the month only (row 104), and where a reading's confirmation ends
up when the interface is more than text.

The sentence printed for his word in P247 said *"I still need a few things it did not say"* and
listed, among them, whether each job was full-time — a part the document was never asked for
(ADR-0149).

## Decision, in his words

**The sentence goes in with the separation, not as printed.** *"'Things it did not say' and
'things that are yours to tell me' are different kinds of missing, and a student reading the
first version would think their CV was deficient for not stating whether a job was full-time. It
is not — we never asked it to."* His wording:

> I read your CV and filled in seven jobs and three qualifications from it. I still need a few
> things it did not say: for one job, what you did there; and for each qualification, when it
> started and ended, the grade and its scale. And a few that are yours to tell me: for each job,
> whether it was full-time or part-time; and for each qualification, the country.

*"Your words, my split."* The other two sentences go in as printed: a failed reading — *"I
could not read your CV as text, so I will ask you about your jobs and qualifications as
usual."* — and an entry not read whole — *"I read your CV and filled in six jobs; one I could
not read whole, so I will ask you about it."*

**The month, not the date.** *"Yes, ask the narrower one. 'Which month of 2019?' keeps what the
document gave and asks only what it did not. Asking for the whole date when we already have the
year makes the student retype something we are looking at. ADR-0112 forbids supplying the
month, not asking for it, and the narrower question is the more honest one anyway — it shows we
read their document rather than pretending we did not."* And: *"Make that general if it is
expressible: where a parser refuses a value because one component is missing, ask for that
component rather than the whole. If it only works for dates, say so."*

**Where this ends up — designed for, not retrofitted.** *"The sentence is right for a text
conversation. It is not the confirmation. When the interface exists, a student who uploads a CV
should see everything that was read from it as a table — every job, every qualification, every
part — and confirm it there, with the gaps visible in the same view. Not a summary in a message
they have to trust. So the sentence is what we say while the only surface is text. The table is
what the confirmation becomes. Record that as the intended shape, and when you build the seeding,
keep the report's structure intact rather than collapsing it into prose — the table needs the
parts, the entries and the gaps, and if the only thing that survives is a sentence we will be
rebuilding it later."*

## What this decides

1. **Two kinds of missing, told apart everywhere.** A part the document did not state, or stated
   as something else, is *what it did not say*. A part that is the student's to state
   (ADR-0149) is *theirs to tell*, never a deficiency of the document. The reader's report names
   which of the parts to ask are the student's; the sentence keeps them in separate clauses; the
   table will show them as different kinds of gap.
2. **A value read in part is a question about the rest, never a value.** A year without its month
   is held as a reading that names what it lacks; the interview asks for the lacking component
   with what was read in the question, and reads the answer together with what was held. A
   student who states the whole value instead is taken at their word. Nothing assembles, plays
   back or confirms a reading in part. ADR-0112's rule stands and is amended in its reading: it
   forbids a month we chose, not a month we asked for.
3. **General where the value has components.** The mechanism sits on the part, not on dates: any
   part whose value has named components can carry one. Today only the month-and-year parts do,
   because a date is the only such value on a CV — a grade and its scale are two parts already.
   Said plainly, as he asked: it works for dates, and it would work for anything else with named
   components, and nothing else has them yet.
4. **The structure survives the sentence.** A reading that was read keeps, on its own row, what
   the report was made of: per list, whether the walk was seeded from it; per entry, which parts
   the document gave, which it did not, which it gave in part and which are the student's; and
   how many entries it could not read whole. Part keys and counts only — the values and their
   words are on the conversation log as part readings with the document as their origin, and the
   table is the join of the two. The sentence is derived from the structure and said once.
5. **The table is the confirmation.** When a surface exists that can show one, the student
   confirms a reading against every entry and every part, with the gaps in the same view. Until
   then the sentence stands in, and the walk's playback — one confirmation for the whole list —
   remains the confirmation. Nothing here changes what a confirmation is (ADR-0004): it changes
   what the student is shown before they give one.

## Built in P248

- `packages/extraction`: a plan part may carry `components`, tried only when its parser refused;
  the CV plan's four date parts do — a year alone reads as `{ year }` lacking `month`, a job's
  end as ended that year, a qualification's as completed, expected or discontinued that year. A
  new status, `partial`, beside `unparsed`; the measurement prints *read in part: end (gives
  kind, year; would ask month)*.
- `packages/contracts`: an entry carries `student` (which of `toAsk` are the student's) and
  `partial` (what was read in part, with its words in `spans`); the parser refuses either where
  it contradicts the rest. The OpenAPI document carries both.
- `packages/domain`: a proposal may be read in part (`lacking`), never with nothing lacking;
  `isReadInPart`.
- `packages/interview`: `FieldPart.components` (parse the answer with what is held; the narrowed
  question, said exactly so; its expected shape); the seven month-and-year parts carry
  `YEAR_MONTH_COMPONENTS`. A reading in part is not an answer, is not a value, and narrows the
  question to *For qualification 1 — end date, the document I read gives "2019": the year,
  2019, but not the month. Which month of 2019 was it?*; the answer is held as *June (2019 from
  the document)*.
- `apps/conversation-service`: the seeding holds an end read in part as *how it ended*, whole,
  and *when*, in part; the driver records the answer that replaces a reading in part — before,
  a part already held was never re-recorded, and the year came back on the next turn. Migration
  0031 adds `structure` to `document_readings`, only on a reading that was read; `reading-account.ts`
  derives the structure from the report and the sentence from the structure; `reportReading`
  keeps the one and says the other once, as the assistant's message.
- `scripts/local-stack.sh` starts the reader (row 103), with the stand-in unless asked for
  Bedrock, and never writes a key to a file. Run as a process for the first time, the reader
  exited after its first poll: its timers were unreferenced and nothing else held the event
  loop. It holds it now.

## Consequences

- Row 103 closes; row 104's month-only question is built; row 105 records the table as the
  intended shape, not built, and what it needs from the structure.
- The measurement's *would ask* for his CV changes in kind: the three qualifications still ask
  five things, and two of them — the start and the end — are now asked as months, with the years
  the CV gave in the question.
- A reviewer authoring a plan part meets a second question beside ADR-0149's: *does this value
  have components a document might give separately?* If so, the part carries `components`.
