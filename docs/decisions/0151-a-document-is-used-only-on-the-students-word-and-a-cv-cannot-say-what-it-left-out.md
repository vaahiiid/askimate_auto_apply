# ADR-0151 — A document is used only on the student's word, and a CV cannot say what it left out

**Status:** **Accepted** — Vahid's decision, 2026-09-29, in his own words (P251)
**Depends on:** [ADR-0148](./0148-the-interview-is-an-ai-asking-not-a-form-read-aloud.md) §9, §10,
[ADR-0149](./0149-some-parts-are-the-students-to-state-grounding-catches-invention-not-inference.md),
[ADR-0150](./0150-a-reading-is-confirmed-as-a-table-the-sentence-stands-in-while-the-surface-is-text.md)
**Amends:** [ADR-0148](./0148-the-interview-is-an-ai-asking-not-a-form-read-aloud.md) §10 — the CV comes
first and is read *on the student's word*, not on upload; [ADR-0150](./0150-a-reading-is-confirmed-as-a-table-the-sentence-stands-in-while-the-surface-is-text.md)
— the completeness question belongs in the sentence and in the table alike

## Context

Until P251 the CV path was: the CV is uploaded, everything readable is taken, and the interview asks
only what is left. P246 built it, P247 to P249 measured it on his own CV, and P250 put the walk in
his hands. Then the product correction, in his words:

> *"The student never said the CV was complete and was never asked whether to use it at all.
> Uploading a file is not consent to take its contents as the whole answer. Two things are wrong
> with that. A CV is a selective document. People leave jobs off it… Taking seven jobs from a CV
> and moving on means the eighth is silently absent and nobody ever asks. And the permission is
> missing. The student uploaded a document; they did not say 'use this instead of asking me'."*

## Decision, in his words

**Ask first.** *"Before reading anything from it: I have your CV — do you want me to fill in your
jobs and qualifications from it, or would you rather tell me yourself?"*

**Then the question the CV cannot answer.** *"If they say yes, read it, then show them what was
read and ask the question the CV cannot answer: is this all of them? A CV that gave seven jobs
should end with 'is that all of them, or are there others not on your CV?' — because the document
cannot tell us what it left out, and only they can."*

**The recap is the confirmation, not the sentence.** *"It is the confirmation: everything read,
entry by entry, shown to them, confirmed, before any of it counts. Which is the table from
ADR-0150 — so the sentence stands in for it only until the surface exists, and the 'is this all of
them?' question belongs in both."*

**A no deletes it.** *"We hold a CV under one purpose, and a student who declines that purpose has
left us holding a document for nothing. The sentence says so plainly — that they said no, that the
CV was deleted, and that we will ask them about their jobs and qualifications as usual. Not 'we
will keep it in case you change your mind', which would be holding it under a purpose they just
refused."*

**Ask when employment comes up, not on upload.** *"The student uploaded a file because a panel
invited them to; they are in the middle of answering questions. A question that arrives out of
order about a thing they did a minute ago is the kind of interruption that makes people click
without reading. When the interview reaches employment, the question is in context and the answer
means something. The cost is the reading happens later, which is fine — it is three minutes of
machine time and nobody is waiting on it."*

**One yes covering both lists.** *"Two questions about the same file is ceremony, and the second
one teaches them that the first was not real. If a student wants the CV used for one and not the
other, they can say so and we handle it as a correction — but do not design for it."*

**The no path is not quiet.** *"It is a deletion of their document, and the rule from row 98
applies: they should be told what went. And if they later say 'actually use my CV', the honest
answer is that it is gone and they would need to upload it again — say that when it happens rather
than pretending we can undo it."*

## What this decides

1. **A confirmed CV waits for the student, not for the reader.** The confirm holds it (`held`);
   nothing reads it. When the interview reaches the first field the CV could fill — the CV plan's
   list targets, named in the contract as `CV_LIST_FIELDS` — the question is put instead of the
   field's, in his words, as the run's pending decision (`use_document`) and as a plain question in
   the chat; a typed yes or no is the same answer as the buttons. One question covers both lists.
2. **Yes: the reader may claim it; the interview carries on meanwhile.** The student is told the
   reading is under way. The CV's two fields go to the end of the order while it is read, so the
   rest is asked and nobody waits on the machine; a field the interview reaches while the reading
   is still in flight is said to be waiting, once. When the report lands, the sentence of ADR-0150
   is said and the first thing the CV did not give is asked in the same breath.
3. **No: the CV is deleted, and they are told.** The vault's purge, the row ended `declined`, and
   the sentence: *You said no, so I have deleted your CV. I will ask you about your jobs and
   qualifications as usual.* Then the field's own question. A later *"actually, use my CV"* is
   answered as it is: gone, upload it again and you will be asked again.
4. **After entries a document gave, the question a document cannot answer.** The walk's "another?"
   after the last seeded entry is said as *That is the seven jobs I read from your CV. Is that all
   of them, or are there others not on your CV?* — in the chat now, and in the table when it exists
   (ADR-0150 amended).
5. **Nothing counts before confirmation, as before.** What the CV gave is held as part readings and
   enters the profile only on the whole list's confirmation. The permission before and the
   completeness question after change what the student is asked, not what a confirmation is.

## Built in P251

- `packages/contracts`: the `use_document` decision (document, yes or no; no hash) and the
  `use_document` pending decision on the run reading; `CV_LIST_FIELDS`; the OpenAPI entries; the
  reader's test holds the CV plan's list targets to the constant.
- Migration 0032: `document_readings` gains `held`, `offered` and `declined`, and `decided_at`; a
  no says when, and a document nobody answered about carries no answer. The store: `ask`, `decide`,
  `heldFor`, `declinedFor`; `request` holds rather than queues.
- `apps/conversation-service`: the question put instead of the CV field's first question, the
  pending decision derived from the row, the decision on the decision route and in typed words, the
  yes (reader's, told, the CV's fields deferred, the report resumes the interview), the no (purged,
  told, asked as usual), the honest answer to a later request to use it; the message reader reads a
  request to use the CV, negated or not. The page renders the question and its two buttons and
  states the consequence of a no beside them.
- `packages/interview`: after entries with a document origin, "another?" is said as the completeness
  question.
- Tests, fail-first where the behaviour is new: the store's two states and the end; the parser;
  the driver's no path (typed), yes path (decision route), the honest answer after a no, the
  reader offered nothing before the yes, the completeness question at the end of the walk; the
  interview's wording; the message reader's use request. The page's rendering is typechecked and
  not driven by a test in this phase; his walk is where it is first seen.

## Not decided here — and then decided (row 107, P252)

- A CV uploaded **after** both its fields are already confirmed was never asked about: the question
  is put when a CV field comes up, and none would. The document stayed held under its purpose,
  unread, deletable by asking. Whether that upload should be refused, asked about at once, or
  deleted with a sentence was left to him (row 107).

**Amended 2026-09-30, in his words:**

> *"Row 107, decided: ask, do not hold silently. A CV uploaded after both sections are confirmed
> should get a sentence, not silence. Something to the effect that we have it, that the jobs and
> qualifications are already filled in and confirmed, and asking whether they want to go back and
> use the CV for either — with the honest note that it would mean redoing what they already
> confirmed. Not refused… Not deleted without asking… And not held in silence, which is the worst
> of the three… If they say no, delete it and say so, same as the decline path."*

Built in P252:

- **The question, at once.** When a CV is confirmed into the vault and every CV field the run
  requires is already confirmed, the interview will never reach one, so the question is put on
  arrival instead, in the late words: *"I have your CV. Your jobs and qualifications are already
  filled in and confirmed. Do you want me to go back and fill them in from the CV instead? That
  would mean redoing what you already confirmed: I would show you what the CV says and ask you to
  confirm it again. Or shall I leave them as they are?"* The run's pending decision is the same
  `use_document`, now carrying `situation: late`; the page's consequence line and buttons say *go back*
  and *leave them as they are*. Whether a CV is late is derived from the blueprint and the profile
  each time it is asked, never stored: what is true of the fields when the words are said is what
  the words claim.
- **A late no** deletes the CV, same as the decline path, and says: *"You said no, so I have deleted
  your CV. Your jobs and qualifications stay as you confirmed them."* Nothing is asked after it.
- **A late yes** reopens the CV's fields from that point. The row records the conversation's last
  ordinal when the yes was said (`reopened_after`, migration 0033); the reading is seeded past it,
  so the earlier confirmation does not count as "already begun"; while a field the reading seeded
  has no confirmation after that ordinal, the run reads the profile without it, the plan blocks,
  and the walk asks what the CV did not give and the completeness question, then plays the CV's
  value back. Until they confirm it, theirs stands in the store; the confirmation replaces it.
  Ordinals, not clocks: the log is ordered by ordinal, and a clock is not.
- **The rows P251 left behind.** A CV confirmed before migration 0032 sat `pending` with no word
  from anyone, and would have been claimed without asking. 0033 puts such a row back to `held`.

**Amended again 2026-09-30 (row 108, P253), in his words**, on a reading already *done* under
the rule before this ADR — a `read` row with `decided_at` null, which 0033 leaves as it is because
the reading happened:

> *"Values the student confirmed stand. The upload sentence disclosed that the CV would be read for
> those sections, and a student who saw every entry played back and said yes was the author of
> those values. Taking that back would be undoing a confirmation only they may undo. Parts never
> confirmed get the honest question… 'I read your CV before I should have asked. Do you want me to
> use what I read, or would you rather tell me yourself?' Do not soften it. Admitting the order
> was wrong is the point… A no deletes the CV, same as the ordinary no. Name the state in the
> store so nobody repairs the null later. A `read` row with no decision is a fact about how this
> system behaved for a period, and it should be legible as that rather than as missing data."*

Built in P253: `consent` — `awaiting`, `given`, `never_asked` — on every row the store returns,
derived from `state` and `decided_at` (not a column: the table carries migration 0034's comment
on `decided_at`, which says what the null means, not the three words); the question above, put before one more part
of such a reading is used, as the pending decision (`situation: read_before_asking`) and in the
chat; a yes uses the parts; a no purges the CV and sets its parts aside, never read back into a
walk, while what the student said themselves stays. The row stays `read`, with the question and
the answer on it; nothing fills `decided_at` but the answer. And row 109, with it: a list a CV
seeded is confirmed as `document_extracted_and_completed`, naming the document — his words:
*"Provenance that says 'the student said it' for a value that came from a document is wrong… it
is our record saying something that is not so."*

**Amended a third time 2026-09-30 (P254), in his words**, on the case neither the field's
question nor the late question covers — a CV that arrives while its own field is open:

> *"The open question yields, and the yes may seed past a begun field. Use P252's ordinal mark,
> since it already means exactly this. The honest question when entries exist names them and says
> plainly that a yes starts the list again. Do not soften 'starting the list again' — a student who
> has typed two jobs needs to know they are choosing to redo that, not to add to it. The sentence
> at upload when some other field is open: yes, build it. 'I have your CV. I will ask whether to
> use it when we reach your jobs.' A document held in silence is the thing we have now ruled
> against three times, and leaving one more case silent because it is smaller is how it comes
> back."*

Built in P254: at the upload's confirmation the driver reads where the interview stands with the
CV's fields — late, begun, open, or ahead — and one of four things is said, never nothing. Open or
begun: the question at once, the open question yielding to it; begun with entries typed, the
question names them (`situation: field_begun`) and a yes starts the list again from the CV, on
P252's mark; ahead: the one sentence above. The rule of this ADR is unchanged — nothing is read
before a yes — and the moment of asking is now whichever comes first: the field, the upload while
the field is open, or the upload after the field is done.

**Amended a fourth time 2026-10-01 (P264), in his words**, on the entry a CV gave that should not
be there at all — the inverse of what this ADR was written for. A CV cannot say what it left out;
it can also put in what the student does not want listed, and until P264 the walk had no answer
that meant so. Vahid, stuck at the third qualification his CV produced:

> *"The trap: a CV-read entry that does not exist… The CV produced three qualifications. One of
> them is not a qualification I want listed. The walk asks me for its country and there is no
> answer that means 'this entry should not be here'… What I want: while walking an entry that came
> from a document, a student can say it should not be listed, and it is removed, and the walk goes
> on to the next. Not a correction — a removal. And the list's playback should show what was
> removed, or at least not silently renumber so that 'job 3' means something different
> afterwards."*

Built in P264: the first question about an entry a document gave ends *If this qualification
should not be listed, say "leave it out".*, said exactly so. The words that mean removal are few
and read whole (`readsAsRemoval`): *leave it out*, *leave this one out*, *not this one*, *skip
it*, *take it out*, *this should not be listed*, *don't list it*, *it is not a qualification*, *it
does not belong here* — and nothing else, because a reading here drops an entry and *a wrong label
is worse than none*. *Remove*, *drop* and *delete* belong to the deletion reader, which runs
first. The removal is a part of the walk, `item<n>.removed = true` with the student's words as its
verbatim: on the log as a `value_part_read` with no new event kind, and the entry keeps its slot
— the ordinals depend on nothing that moved. The walk asks the entry nothing more and goes on to
"another?"; the completeness question counts the entries that stand (and says *I have left out
every qualification I read from your CV* when none does); the whole is assembled without the
entry; its own words name the mark under *qualification 3 — left out* and carry none of the
entry's parts. The playback numbers the entries that stand as the value holds them, and each one
whose number changed is told the number it had — *Qualification 2 of 2 (this was qualification 3
when I asked you about it)* — then, after them, what was left out, without a current number:
*Left out at your word ("leave it out") — the qualification I asked you about as qualification 2,
as I read it from your CV: Institution: "Sharif University"; …*, and *Those are the 2
qualifications, with 1 left out. Is that right?* The buttons follow the numbers the playback shows,
and a correction pressed as "qualification 2" is mapped through the marks to the slot it names and
says so: *Qualification 2, then — the one I asked you about as qualification 3.*

Two boundaries, stated: the words are read only of an entry that has a document's reading in it —
a student typing their own entry has no entry to leave out, and their *leave it out* is whatever
the part makes of it; and an entry corrected after the playback becomes the student's own, so it
can no longer be left out that way (it can be corrected again). Neither is his decision; both are
the narrowest reading of what he asked for, recorded as mine.

## Consequences

- The runbook's walk changes: the sentence arrives when the interview reaches the qualifications
  or the jobs and the student says yes, not at upload; a no is a deletion the chat reports.
- ADR-0150's table shows what was read and asks the completeness question in the same view, when
  it exists. Row 105 stands.
- The reading's cost is unchanged; it is now spent only on a yes.
