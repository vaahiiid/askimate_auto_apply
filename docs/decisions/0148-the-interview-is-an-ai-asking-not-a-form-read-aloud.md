# ADR-0148 — The interview is an AI asking, not a form read aloud: the CV first, the by-hand questions from the portal's own fields, the student's words kept, and a list confirmed and corrected entry by entry

**Status:** Accepted · 2026-09-26 · supersedes ADR-0113 §4 (a CV may be read, as the separate decision that ADR said it would have to be) and keeps §1–§3 for the by-hand path · amends ADR-0092 (a second process that fetches a document after the gates: the CV reader) · continues 0004, 0007, 0111, 0112, 0140, 0146
**Decided by:** Vahid Mohammadi, in his own words, 2026-09-26. **Built in part:** §6–§7 in P230; §4 in P231; §3 in P232, with his sentence; §11 in P233; §10 in part in P235–P238 (stage one of the CV path, and his signed determination); §1 and §9 in part in P239 and P242 (stage two, and the first six hours of stage three: the cut as the model's line ranges, held by structure; proven against the deterministic client only). §2, §8, the rest of §1, §9 and §10 are decided and not built, in the order he set.

## Context

The interview as built asks one field, one question, one exact answer, and discards anything
else in silence. His judgement on it, 2026-09-26, after running it on his own application:

> *"The interview today is a form read aloud … That is the wrong shape. The thing asking is
> an AI and it should behave like one: ask intelligently, read intelligently, and do the work
> rather than making the student do it."*

He asked, before any code, what it costs, what it conflicts with, what is unbuildable as
stated, and what to build first. The answers are in the P229 report and summarised here where
they bear on the decision: the conflict is with ADR-0113 §4, which refused a pasted CV as the
source of a value, and, harder, with ADR-0092, under which no process we run ever holds a
document; nothing in the shape collides with ADR-0004, because extraction already produces
proposals the student confirms and only the profile package can mint a confirmed value.

## Decision

In his words, the shape:

1. *"The CV comes first. Where a section can be filled from a CV — employment,
   qualifications — the student uploads one and we read it. We do not ask 'do you have work
   experience?' That is our job, not theirs."*
2. *"If the portal accepts a CV upload directly, tell the student they can upload it and leave
   the form section empty."* Measured: the Sheffield entry has no CV slot, so this has no case
   on the item-6 run.
3. *"If there is no CV, the choice is the student's: enter it by hand, or leave it empty. We
   give one plain warning that some universities weigh work experience, and nothing stronger —
   we have no data yet on how much it matters."*
4. *"By hand means asking properly, from what the university's form actually needs. Not 'do
   you have a job to list?' but the fields themselves, one at a time, in order"* — the position,
   the company, the start, the end (and *"if they say they are still there, we do not ask for an
   end date at all"*), the description *"or, if the university requires it, we ask for it rather
   than offering"*. Then the next job, until they say that is all. Measured: at Sheffield the
   section is optional and each entry's position, employer and duties are required.
5. *"The AI arranges and places what the student said. It does not rewrite it."* For a free-text
   part the value IS the quoted span; for a date or a closed vocabulary the value is a reading
   of the span, which is what confirmation is for.
6. *"Confirmation at every stage, without exception, precisely because we are structuring their
   words. When all the jobs are in — whether they came from a CV or by hand — we list them and
   ask: is this right?"*
7. *"If they say something in the list is wrong, we correct that item and confirm again. We do
   not throw the whole list away and start over."*
8. *"The same model for qualifications, and for every other section that is a list of things."*

And the two decisions the CV path waited on:

9. **Reading.** *"A separate process whose only job is reading a CV. It fetches the document,
   produces text, and forgets it. Amend ADR-0092 to name a second such process rather than
   carrying an exception … a service with one job and a clear boundary is the shape this system
   already uses for filling."* ADR-0092's rule stands as one rule: the conversation service
   never holds a document; a process that fetches one does so through a short-lived pre-signed
   GET after the gates, holds no key, and is named in that ADR. The runner was the first; the
   CV reader is the second.
10. **Retention and deletion.** *"One year, and the student can delete at any time by asking in
    the chat. Not a settings page, not a form — they say 'delete my CV' or 'delete everything
    you hold for me' and we do it."* With three conditions that *"matter more than the year"*:
    it is told to them plainly at the point they upload, in a sentence they will read; it works
    as a conversational request, *"a real path through the conversation and it needs building,
    not a note in the terms"*; and *"deletion has to mean the document, not the values they
    confirmed. If they confirmed three jobs from that CV, those are their own statements now and
    they stay unless they ask for those too."* Deleting the confirmed values is a separate and
    larger thing, sized below and not decided.

11. **The portal's demand for a part.** Decided 2026-09-27, on row 94's measurement: *"Build
    the capture. It is one field on one outcome type and it turns a sentence that guesses into
    one that knows."* Three conditions, his: *"The sentence names what we left empty AND what
    the portal would not take, where we know both. Where the capture gives us nothing — a
    refusal with no unseen names — the sentence says what we left empty and says plainly that
    we do not know which of them the university minded. Never imply we know when we do not."*
    Then: *"it asks for the first one, as an interview question, and resumes. A stop that
    becomes a question the student can answer is the whole point; a stop that becomes a
    better-explained stop is half a fix."* And the student's page *"stops saying 'with a member
    of the team' for this case … the position line should say so."*

## What §6–§7 are, as built (P230)

A list's playback carries its entries: the run's pending `confirm_value` names each one by
its position and the spec's own word (*job 1*, *job 2*), and the page offers *job 2 is wrong*
beside *Yes, that's right*. The press is a `correct_entry` decision bound to the playback's
hash, as a confirmation is; a stale hash is `content_changed`, a position the list does not
have is refused. On it the reading is closed with a `value_rejected`, every other entry's parts
are carried forward as fresh part rows — the student's own readings, as they were, including
that entry's "another?" where the log holds it — the named entry's parts are left out, and the
walk asks for that entry again from its first part, then plays the whole list back for a new
confirmation. The last entry's "another?" is never a row of its own, so correcting the last
entry asks it once more: one true question rather than a "no" written for the student. A typed
"no" while a list is played back does not throw the list away: which entry a sentence names is
not ours to guess, so the entries stay on offer and the student presses the one that is wrong.
No new event kind and no migration: the log records what happened in the kinds it has, and a
rejection followed by part reads is read as a walk, so the next question is asked plainly.

## What §4 is, as built (P231)

Which parts of a list or composite are asked, and which refuse "none", come from the portal
and are never authored: `partPolicyFor` reads the mapping set for the value paths each
mapped slot reads (a `part` rule's first path, a `join`'s parts, a `switch`'s path, or the
whole value) and the blueprint's own validations for which of those slots are required. A
part the spec requires is always asked, because the value cannot be built without it and the
profile is filled once for many portals (ADR-0111); a part the spec leaves optional is asked
only when some slot reads what it feeds, and refuses "none" when that slot is required. A
part names what it feeds where that differs from its key (`still` and `endDate` build `end`).
Measured at Sheffield: position, employer, address, dates and duties asked; basis and referee,
which no slot reads, not asked; duties required.

The ORDER is not the form's. His ruling, 2026-09-27: *"Position, employer, start, end reads
naturally. If Sheffield's slot order were address, duties, position, I would want the human
order, not the form's."* So the order is the spec's, written as a person would say it — a
job: position, employer, address, start, whether still there, end, duties, then the parts a
portal may read; a qualification: title, subject, institution, country, level, dates, grade —
and the portal decides only which of the optional ones are asked.

When the entry and the portal disagree — a slot the entry calls optional that the portal
refuses to save without — the portal wins, and it is found where ADR-0106 looks: a page is
saved when the portal shows it, so the run reads back after the save, and a page not shown
goes `uncertain` and to a person. The student sees that their application is with a member
of the team; the portal's own words are never printed (P178), and the entry is corrected by
review, not by the run.

## What §3 is, as built (P232)

The employment section opens with one sentence, his, said exactly as written and never
composed around:

> *"Some universities weigh work experience when they decide. I have no figures on how much, so this is your call: I can ask you about your jobs one at a time, or leave this section empty."*

The answer is theirs: *ask me*, *one at a time*, or a plain *yes* begins the walk at the first
job's title; *leave it empty*, *nothing to add* or a plain *no* puts an empty list for their
confirmation, which is the "none" ADR-0113 §3 already made a confirmation; anything else is
asked again with the same sentence, after what happened to their answer, never a rewording.
*skip* is neither: the model layer already reads it as "I don't know", and at an opening that is
a choice it is ambiguous between the question and the section. A question with fixed words is a
new thing a part can carry (`exactly`), honoured by both model clients, so the words a person
decided are the words a student reads. Until there is data the sentence is the warning; when
there is, §3 says it becomes a judgement, and the sentence changes then and not before.

## When the portal refuses what the entry called optional (row 94)

His finding on P231's answer: a student whose application stopped because a university
demanded a field the entry called optional *"is owed more than silence. They are the one who
could answer it in thirty seconds."* Not the portal's words — that rule holds — but our own
sentence from the structure we have. What is expressible today and what is not is measured in
row 94; §11 builds it.

## What §11 is, as built (P233)

**The capture.** The runner's read-back already knew what it did not see (ADR-0106) and wrote
it to its log line; now the outcome carries it: `unseen`, the blueprint's own field names, on
`uncertain (not_recorded)` and nowhere else — a success beside it is refused on the wire, since
a success saw everything it typed. On a repeating page the read-back is a count (ADR-0106's
stated limit), so `unseen` is `["entries"]`: the whole entry, and no box named.

**The demand.** From the plan, the boxes on the refused page that were typed empty because the
student left the part out (`absent: leave_empty` renders the empty string); from the runner,
what was not seen, mapped through the reviewed mapping to the profile's parts and their words
(`PART_LABELS`) — never the portal's. Where the read-back names one of the empty boxes, that is
the demand. Where it could not say which (`entries`), every empty box is, said as not knowing.
Where it names only boxes we had filled, there is no demand and the uncertainty stands: a
person looks, as before. The demand is a log event, `value_part_demanded`, closed by the
field's next confirmation.

**The sentence**, in the two shapes his conditions set. Knowing: *Gated University would not
save the "Your application" page without county, which I did not have. Let me ask you for it
now.* Not knowing: *… would not save the "Employment" page. On it I had left full-time or
part-time and job description empty, and I do not know which of them the university minded, so
let me ask you for full-time or part-time first.*

**The resume.** While a demand is open the run reads the profile without that field, so the
plan blocks on it and the interview asks — for the demanded part only, from a walk seeded with
every other part the student gave: their own part rows first, then the proposal's assembled
value (a walk's last part is never a row of its own), then the confirmed entry (a value
confirmed in an earlier conversation has no walk on this log). The demanded part is required by
the portal's evidence, so "none" is refused for it. The whole value is played back and
confirmed once; the confirmation replaces the entry, closes the demand, and the page is filled
again.

**The position line.** No stop and no person: the run stays `running` at the interview, and
the student's page reads *"I'm asking you a few questions so I can fill in your application"*
— the words the step already had. Nothing was added to the client.

**The one consequence that touches an older decision, in his narrow words (P234).** ADR-0106
and ADR-0008 hold that `uncertain` completes nothing. On this path the intent is completed
`failed_cleanly`, and the reasoning is his: *"The runner says uncertain because it cannot see;
the driver says failed cleanly because it can — the page was reopened and the value was absent.
That is evidence, not inference, and it is the only kind that should ever overturn an
uncertain."* The claim is the read-back's observation, relayed, never the driver's judgement;
where a report has no read-back behind it the claim is unavailable and the stop stands.
ADR-0106 carries the amendment in those words.

**Limits, stated.** A repeating page names no box, so on Sheffield's employment page the
not-knowing shape is the one the student will read. The refill after the answer is the page's
second attempt under ADR-0122's cap, the first having been spent on the fill that failed before
the student was asked anything — row 96, his to decide. Nothing here touches the transmission
gate, the authorisation content hash, or the mandatory-review categories.

**Their words, not ours (P234).** P233 had shown a part seeded from a confirmed value as its
rendered value — *country: IR* where the student had said *Iran*. Vahid, 2026-09-27: *"That is
us showing them our word for their answer, and it is the same defect as the field keys — one
level deeper. They said Iran. Play back Iran."* The student's own words were already kept: a
confirmed entry carries the proposal's verbatim as its provenance excerpt (ADR-0004). The seed
now reads it, so the playback says *country: Iran*. The cost was one line and a test.

## What §10 is, as built in part — stage one of the CV path (P235)

His estimate for the CV path was accepted at nineteen hours across four stages, with a stop at
the end of each. Stage one: the document type, its retention, and deletion by asking.

**The type.** `cv` is a document type: a PDF or a Word file of up to five megabytes, with no
expiry date to warn about. **The retention** is his year, in schedule version 2.2026-09-27, which
adds one policy to version 1 and changes nothing else: `cv / application_submission`, 365 days
from last use, deleted in full — the year is his (§10), the trigger follows the schedule's own
principle that a student's purpose is alive while they are still applying.

**Determined by him, not by us.** Storage is gated by a lawful-basis determination (ADR-0022).
None was registered for a CV at stage one, and the gate refused one with
`DocumentTypeNotCoveredError` until he signed determination 5 on 2026-09-27 (row 97, P238); from
then a CV enters the vault under its own purpose, `cv_section_filling`, and schedule version 3.

**Deletion by asking**, in his words: *"'Delete my CV', 'remove that document', 'get rid of
everything you have on me' should all land."* A reader of families of words — a verb that means
removal in any of its forms, and an object that says how much: one kind of document by the words
a person uses for it (*CV*, *resume*, *passport*, *transcript*…), *that document*, or
*everything* — answered before the sentence could be read as an interview answer. A negated
request (*don't delete my CV*) and a person saying what they did (*I removed the typo*) are not
requests. It is deterministic and tested over the phrasings, and it is said so: not a model's
reading. When it lands: the document's contents are purged through the vault, the record staying
with its hash for the audit (ADR-0010); the reply says what was deleted and, his condition, what
was kept — *"The details you have confirmed stay in your application, because those are your own
statements now. If you want any of those removed too, tell me and I will say what that takes."* —
and, where a deleted document had already been sent to a university, that it is beyond our
reach. *That document*, where more than one is held, is a question back, never a guess, because a
wrong deletion cannot be undone. Where nothing of the kind is held, the reply says so and names
what is held.

**The upload sentence** (P236), his after one change — *"'always showing you what I read before it
goes anywhere' — cut it, or rather move it. It belongs in the moment we show them what we read,
not in the sentence about keeping the document."* Built as written, shown on the documents panel at
the point a CV is the chosen type and for no other type: *"Before you hand me your CV: I will keep
it for one year from the last time I use it, and I will read it only to fill in the sections of
your applications that list your jobs and qualifications. You can tell me to delete it at any
time, just by saying so here. That deletes the document, or all of your documents if you ask for
that; the details you have already confirmed stay unless you ask for those too."* The moved
clause belongs to stage 3, where what was read is shown.

**Row 97 answered in reasoning, drafted for his signature** (P236), **and signed** (P238):
*"Signed: Vahid Mohammadi, 27 September 2026"*, his words verbatim in
`decision-sheet-b2-store-cv.md`. A CV is offered by the student, not demanded by a portal, so it
has its own determination and its own purpose, `cv_section_filling`, rather than being folded
into the academic one; `STORE_CV` is the fifth B2 determination, schedule version 3 carries the
CV's policy under that purpose, and the gate admits a CV. The student can complete every
application without ever giving us one.

**The reader's failure mode, found and closed** (row 98, P236–P237). His words: *"forty
phrasings tested both ways is good, and it will still miss some. The failure mode matters — a
missed 'delete my CV' leaves a document we were told to delete."* And, ordering it built before
stage two: *"It is not a preference, it is a hole. … The fall-through is the actual defect, not
the missing question. A message about deletion must never reach the interview as an answer to a
question about a job title."* Reproduced through the real driver with a question open — *"can
you get rid of the thing from yesterday"* became the first line of the student's address — then
closed: every message is read once, as about deletion or as an answer, and the interview path
takes a type that only the answer branch holds, so a deletion-shaped message cannot be passed
along; there is no value of the right type to pass. Deletion of something the reader cannot name
is asked about — what is held, the way forward, and, his condition, the way back: *"If you did
not mean a deletion, say so and we will carry on where we were."* A plain no after that question
deletes nothing and re-asks the open question; a negation, or a person saying what they did, is
said back the same way. Nothing is guessed, and nothing falls through.

**What no stage has proven, said plainly at his instruction.** Nothing in stage one reads a CV,
and nothing in it was proven against a real model. Every test in this phase runs the
deterministic client; a deterministic client passing is not the same as a CV being read, and
stage 3 is where that distinction starts to matter. Each stage's record will say which, if
either, it was proven against.

## What §1 and §9 are, as built in part — stage two of the CV path (P239)

**Bytes to text, real.** A CV arrives as a PDF or a Word file. Two extractors behind the one
port `text.ts` declares: a PDF's own text layer through a real PDF library, page by page; a Word
file's paragraphs through a real .docx library, one line each. Both are proven on real files —
synthetic CVs generated for the repository — and a PDF with no text layer reads as an empty
page, not an error. Reading a document does not destroy it: the PDF library detaches the buffer
it is handed, found when two tests read one fixture, and the extractor copies first.

**Text to entries, by code.** The model contract this package has reads one value out of a text
by its label, so the text is cut first: a heading line opens a section (*Employment*, *Work
experience*, *Education*…), the next heading closes it, and an entry begins at each line
carrying the entry's first label. Deterministic, tested, and limited to the shapes a text layer
or a Word file yields; a CV laid out as tables, columns or prose with no labels is not cut by it,
and the reading that follows finds nothing in it.

**Entries to values, grounded.** A new target kind, a list: the jobs and the qualifications, each
entry read part by part through the same model call every other target uses, each span checked
against the whole document before it is accepted. An entry a required part is missing from is
dropped and reported by its position (*employment.history[2]*, and which part); an entry whose
quoted span is not in the document is rejected — a model that invents a job invents nothing here;
the entries that read whole are one proposal, with the document's id and the lines it was read
from, and none is `not_found` and not required, because a CV may list none. The words a CV uses
for the profile's closed vocabularies — a level, a grade scale, full-time — are read into the
same tokens the interview's parsers produce for a typed answer, so a value read off a CV and a
value typed into the chat are the same value.

**What was proven against what, said plainly at his instruction.** Real: the PDF and Word
libraries on real files; the cut into sections and entries on the fixtures' layout; the
grounding guard rejecting an invented span; the assembly into the profile's own shapes.
**Proven against the deterministic client only:** every value read. That client reads a line
labelled *Position:*; a real CV has no such line. Whether the Bedrock client reads prose into
these parts — the thing stage two is for — is not shown by any test in this phase, and stage
three is where a real reading has to be proven. A green test here proves the wiring, not the
reading.

**The measurement before stage three (P240).** His reading of stage two: *"the cut into entries
by label is a fixture-shaped assumption a real CV would not meet. That means stage three cannot
start with building."* So a measurement, run by him because the model call is his spend and
his act: `pnpm run measure-cv -- --live <files>` reads real CVs through the real extractors and
the real model and reports structure only — sections found, entries found and read whole, the
parts read, missing, ungrounded (by span length) and not reached, why an entry was dropped —
never a value, a span or a line of the document, held to that by a test. What to give and how is
`docs/measure-cv-reading.md`. Stage three is not estimated again until the answer is in.

**The measurement's answer (P241, row 100).** His own CV, through the stand-in: both sections
found, 28 and 22 lines; zero entries from either. *"The cut by first label produces nothing on
a real CV … So --live was never needed."* The free run answered the question the paid one was
for. Stage three is therefore the different one: the model segments as well as reads.

**What grounding means when the model segments.** A span check catches invention and nothing
else; a merged pair of jobs and a job split in two are both real text. So the cut is held by
different things, none of them a span: (1) the model returns **line ranges**, never text, so an
entry can only be a contiguous run of the document's own lines and nothing outside the document
can become one; (2) **exclusive coverage** — no line in two entries, and every unassigned line
of the section named, so a merge cannot hide a line and a split cannot share one; (3) a
**date-range count per entry** as the merge detector — an entry holding two start–end pairs is
two jobs until a person says otherwise, and is flagged, never proposed as one; (4) the **part
reading inside the range** as the split detector — half a job has no employer or no dates, and
is dropped and named by position, as stage two already does; (5) the **student's confirmation,
entry by entry** (§6–§7), as the check no code can be: the list is played back one job at a
time, and *job 2 is wrong* corrects one without retyping the rest. Grounding of VALUES stays
exactly what it is: every part's span checked against the whole document.

**The measurement that proves stage three works, run before the reader process is built.**
`measure-cv --segment --live`: the model's cut printed as line ranges — entry 1, lines 12–18;
entry 2, lines 19–27 — with each entry's line count, its date-range count, the section's
coverage (assigned, unassigned, doubly assigned) and then stage two's part reading inside each
range, by status. He verifies the ranges against his own document by line number; nothing of the
document leaves the report. The answer decides the rest: ranges matching the jobs he knows, one
date range each, most parts read — build the reader process on it; ranges merging or splitting —
the prompt or the detectors change, and the run is repeated before anything is built.

**The honest estimate**, re-made rather than adjusted: about fifteen hours, not six. The
segmentation call and its two implementations, the line-range contract and its three checks,
the merge detector and the measurement's `--segment` mode: about five hours, before his run.
Reading parts out of prose rather than labelled lines, the deterministic path kept for
fixtures: about one hour. His run and what it changes: two hours held in reserve. The reader
process and the proposals into the interview, entry by entry: six hours, as before. Records:
one. Nothing after the first five is estimated to survive the measurement unchanged.

**Stage three, the first six hours, as built (P242).** The cut is the model's, as line ranges:
`ModelClient.segmentDocument` takes the document's lines, the section a heading found, and the
entry's labels, and answers with one-based inclusive ranges — the Bedrock client through a tool
whose schema cannot carry text, the stand-in through a rule that is crude but real (Vahid: *"we
can at least see whether the pipeline downstream of the cut works without spending anything"*):
the scope cut into blocks at blank lines and at labelled lines, a block with a date range an
entry. The cut is held by the checks §9 named: a range outside the document refused, a pair that
share a line both refused, the section's unclaimed lines and the entry lines outside it counted,
a date-range count per entry as the merge detector — an entry with two is held back, named,
never read as one — and the part reading as the split detector. And the failure he named: the
cover letter found by its opening and closing, and every entry's lines inside it counted
(*LETTER TEXT INSIDE THE ENTRY*). The list runner cuts through the model now; the label cutter
survives only as the stand-in's second rule. The measurement prints the cut before the parts.
Proven against the stand-in only, on a synthetic prose CV with a letter whose sentence carries
a date range: the scoped cut finds the two jobs and the qualification; unscoped, it starts an
entry inside the letter, and the detector says so. Whether the Bedrock client cuts a real CV
well is what his `--live` run is for, and it needs credentials the page now describes.

**His `--live` run did not reach a model (P243, row 101).** The banner said *"LIVE — Amazon
Bedrock, eu-west-2"* and the endpoint answered *"The model 'eu.anthropic.claude-sonnet-4-6' does
not exist"*, in the Claude API's own error shape. The request went where the client was built to
go — `bedrock-mantle.eu-west-2.api.aws`, the Messages-API endpoint of Amazon Bedrock — and not to
api.anthropic.com; but the id came from `verify-bedrock`, which lists the *other* Bedrock service
(InvokeModel), whose ids the Messages-API endpoint does not take. ADR-0018 carries the amendment.
The measurement waits on his choice of an id that endpoint serves, or of the other service; the
banner now names nothing before the call and the record of what was called is printed after it,
on the failure path as well. **Decided in P244, his words:** the InvokeModel service, so the
verifier and the client read one list (ADR-0018), and London that resolves to London (ADR-0012);
the measurement runs with `eu.anthropic.claude-sonnet-4-6`, and it is his run.

**His live run, 2026-09-28 (P245).** 62 calls, 13,589 tokens in, 8,647 out. Employment: seven
entries cut from 28 lines, six read whole, one date range each, no overlap, no range outside the
document, no letter line in any entry — *"the segmentation works … That is the thing stage three
depended on and it holds on a real document."* Education: three entries cut, all three dropped
for `countryCode`; 19 of 22 section lines unassigned because the letter followed the section
with no heading between. Two things followed, neither about the cut: ADR-0149 — some parts are
the student's to state, never asked of a document, because grounding catches invention and not
inference; the source flag and the incomplete entry that asks for the rest are built inside the
reader process — and the section boundary, which ends at the letter now under the guards he
asked for. The reader process comes next; the run that proves it is the same one, his CV live,
ending with three qualifications asking for their country and nothing else.

**The reader process, as built (P246).** `apps/cv-reader`: the second process ADR-0092 names —
claims one CV from the plane, fetches it once through a sixty-second URL, refuses bytes that do
not hash to what the plane said, reads it through the real extractors and the model ADR-0018
names, reports what the document gave, and keeps nothing. On the plane: `document_readings`
(migration 0030), asked for by the confirm route when a CV's bytes are in the bucket; the claim
runs the storage gate and mints the retrieval; the report becomes the interview's own walk —
`value_part_read` events with the document as their origin and the span each was read from as
its words, `any` yes, `another` yes for every entry but the last — so the interview asks only what
the document did not give, and the student confirms the whole list entry by entry (§6–§7). The
source flag of ADR-0149 sits inside it: a part marked the student's is never in a request, and
the reader names it in `toAsk`. **Proven against the deterministic client only**: the reader on
the fixture CV, the plane's claim and report against Postgres, and the end state — a
qualification seeded from a report, the interview asking for the country first, then the one
optional part the fixture mapping reads (the award date, *say none*), then *another?*, then the
playback. On a mapping that reads no award date, the country is asked and nothing else. Whether
the Bedrock client reads his CV into these parts is his run, the same measurement, `--live`.

**His live run through the reader's pipeline (P247, 2026-09-29).** The same CV, the same client:
68 calls, 16,795 tokens in, 9,705 out. Employment, lines 10–37, ended at the next heading: seven
entries, six complete, none dropped, one date range each; entry 6 incomplete because its one line
carries no duties; `basis` marked the student's to state on every entry. Education, lines 39–44,
**ended at the cover letter**: three entries, three section lines unassigned (was 19); every entry
read the award title, the subject, the institution and the level; `countryCode` marked the
student's to state on every entry. His reading: *"The section clipping works, nothing is dropped
any more, and the flag holds on a real document: basis and countryCode were never in a request."*

**What the measurement showed about the feature, in his words:** *"it fills employment almost
completely and education barely at all."* Each qualification would ask five things — the country,
the start, the end, the grade and the grade scale — because a CV, like most, lists a degree as one
line: title, institution, year. *"A student who uploads a CV to save typing still answers fifteen
questions about three degrees. That is still better than typing everything … But it changes what
the CV path is for … anyone planning from 'the CV fills it in' would be wrong about half of it."*
Recorded as what the measurement showed: the value of the CV path is different for the two
sections, and it is the employment section it fills.

**Two of the five, looked at (his question).** *"read but not that value: end"* on two entries
means the model quoted a real, grounded span for the end and the plan's parser refused the text:
the CV states a year alone, and a month and a year is what the profile holds. ADR-0112's rule —
never a year with a month we chose — is what refuses it, so the part is asked rather than guessed.
The question the interview asks is the whole date; it could ask for the month only, keeping the
year the document stated, which is a narrower question and his to decide (row 104). Whether a
qualification's start and end are needed: Sheffield's education page stars *Start:* and *End:*
and leaves *Date of Award:* unstarred, as the reviewer's notes on the mapping record; so the
portal requires them, and the mapping reads them because the page does. Independently of any
portal, the interview asks them because the field spec requires them: a part the spec requires is
always asked, since the profile is filled once for many portals (ADR-0111), and only a part the
spec leaves optional is withheld when no mapped slot reads it. If a portal is ever met that does
not require a qualification's dates, the question of asking them anyway is ADR-0111's, not the
mapping's.

**What §9 says to the student, and what it keeps (P248, ADR-0150).** On his word the sentence
went in with his split — *"I read your CV and filled in seven jobs and three qualifications from
it. I still need a few things it did not say: … And a few that are yours to tell me: …"* — said
once, as the assistant's message, when the report is seeded; a failed reading and an entry not
read whole have their own sentences, as printed. The year a CV gives alone is no longer asked as
a whole date: it is held as a reading in part and the interview asks *which month of 2019?*, with
the words it was read from in the question (ADR-0112 amended). The report's structure — every
entry, the parts it gave, the parts it did not and of which kind, the entries not read whole — is
kept on the reading's row (migration 0031) in part keys and counts, because *"the table is what
the confirmation becomes"* and a sentence would lose it. And the local stack starts the reader
(row 103 closed): run as a process for the first time, it exited after its first poll — its
timers unreferenced, nothing else holding the loop — which is the kind of thing row 103 said only
the real path would find, and it was found by the stack's own test going red on
*cv-reader: not running*.

**His third live run (P249, 2026-09-29), after the month.** The same CV, the same client, 68
calls as before. His words: *"The month works. All three qualifications now read 'read in part:
end (gives kind, year; would ask month)'… So the pipeline is proven end to end on a real document.
Seven jobs, three qualifications, nothing dropped, nothing invented, and the two parts that are
mine to state were never in a request."* And what is not: *"What is not proven is the path a
student actually walks. Everything so far went through measure-cv."* The local stack could not
walk it either: its conversation service started with `documents=none`, so no CV could be
uploaded, and the reader's refusal list guarded a variable name nothing sets. Both fixed in P249;
the walk itself is his, by hand, on the runbook's steps, and needs the vault's CORS rule and a
profile in `~/.aws`. The cost is a product fact now written down: `2 + 6 × jobs + 8 ×
qualifications` calls a CV.

**§9 and §10 as reshaped by ADR-0151 (P251).** The CV is no longer read on upload. It is held; when
the interview reaches the first field it could fill, the student is asked — *"I have your CV. Do
you want me to fill in your jobs and qualifications from it, or would you rather tell me
yourself?"* — and only a yes makes it the reader's. A no deletes it and says so. After the
entries it gave, the walk asks the question a CV cannot answer: *"is that all of them, or are there
others not on your CV?"* His words for why are in ADR-0151: *"Uploading a file is not consent to
take its contents as the whole answer… A CV is a selective document. People leave jobs off it."*
The reading, the seeding and the sentence are unchanged; what changed is what the student is asked
before and after.

**§10, for a CV that arrives late (P252, row 107).** A CV confirmed after every field it could fill
is already confirmed would meet no question, and P251 held it in silence. His word, 2026-09-30:
*"ask, do not hold silently."* So it is asked about on arrival, in words that say the fields are
filled in and confirmed and that a yes means redoing them; a no deletes it and says so, same as
the decline path; a yes reopens the CV's fields from that point, and their earlier confirmation
stands until they confirm the CV's. Under ADR-0151, as amended.

## Deleting the confirmed values, sized and not decided

A confirmed value lives in the profile's own rows, which can be deleted; in the conversation
log's proposal columns and message bodies, which are append-only and redactable only for
message text today (a redaction keeps the row and empties the words); and, once a run has
typed it, on the university's form, which is outside our reach and must be said so to the
student. Honouring "delete those too" means: the profile rows removed, redaction widened from
message bodies to the proposal columns by a migration, the case record measured for what it
carries, and a sentence to the student naming what was already sent. **Settled by him,
2026-09-27: that sentence is required, not optional** — *"A student asking us to delete their
data needs to know what is beyond our reach before they believe it is gone."* The rest of the
sizing stays open.

## Deleting the confirmed values — stage A built, stage B not promised (P275, 2026-10-03)

His word, 2026-10-03: *"D6 and D31: stage A only, the handoff. Five hours. A request that reaches
a person and a student who is told what the university already has is the whole of what I
promised. Stage B — deleting confirmed values — stays unbuilt and unpromised until someone
actually asks for it."*

Built, against the deterministic stand-in client only:

- **The words.** The deletion reader (`deletion-requests.ts`) reads the confirmed details in a
  person's words — *my details*, *my answers*, *what I told you*, *my profile* — as their own
  request. *Everything*, *my data*, *what you have on me* — which until now read as every
  document — are **asked**: *"Do you want me to delete only your documents, or the details you
  have confirmed as well?"*, answered from a closed set (*just the documents*, *just the
  details*, *both*, or the way back); anything else is asked again, never passed to the
  interview. D31's *"those"* is resolved against the sentence that named them, and only there.
  Found while writing it: *"delete everything except my passport"* read as a request to delete
  the passport — the named kind won. An exception inside a request is now asked about.
- **The request.** Migration 0038, `data_deletion_requests`: one row per request, at most one
  open per student (a partial unique index), a closing whole — when, by whom, and *deleted* or
  *declined* — and a refusal that says why. Identifiers only.
- **What the student reads.** *"I have passed your request to delete the details you confirmed
  to a person on the team: deleting those is not something I do in the chat."* Then what the
  university already has — **measured from the run's own ledger**, not assumed: the pages saved
  (a succeeded `advance_portal_page`, named by the blueprint's page title), the account (a
  succeeded `create_portal_account`, or the run's situation, the source the stop message reads),
  and the documents sent (`document_transmissions`, with the day). *"That stays with them: I
  cannot take it back … To have it deleted there, ask them directly."* Or, when the ledger holds
  none of it: *"Nothing of yours has reached a university from me."* Then: *"I will tell you here
  when it is done."* Said again while it is open, the student is told it is already with a
  person, and when it was passed on.
- **The person.** The service's start line names every open request with its age, or says
  `open deletion requests: none`. `pnpm run deletion-requests` lists them and `close <id> --by
  <name> --deleted | --declined --reason "…"` closes one through two internal routes, the service
  the one writer (ADR-0048); closing tells the student — *done*, or the person's reason quoted.
  A second closing is not recorded and tells nobody twice. `--by` is asserted, not authenticated.

**What the measurement cannot see,** said here because the sentence is quoted to a student: a
page whose save was never recorded as succeeded (an attempt left `verify_first` or escalated) is
not named, though the portal may hold what was typed on it; a value typed on a page that failed
cleanly is not named; and only this conversation's case is measured — a student's other
applications are other conversations. Nothing here deletes a confirmed detail: closing a request
with *deleted* is a person's word that they did it by hand.

## What this does not decide

The order of building, which he set: §6–§7, then §3–§5, then the CV path. The retention row's
mechanics, which ADR-0010's schedule already shapes. What "some universities weigh work
experience" becomes once there is data.
