# ADR-0148 — The interview is an AI asking, not a form read aloud: the CV first, the by-hand questions from the portal's own fields, the student's words kept, and a list confirmed and corrected entry by entry

**Status:** Accepted · 2026-09-26 · supersedes ADR-0113 §4 (a CV may be read, as the separate decision that ADR said it would have to be) and keeps §1–§3 for the by-hand path · amends ADR-0092 (a second process that fetches a document after the gates: the CV reader) · continues 0004, 0007, 0111, 0112, 0140, 0146
**Decided by:** Vahid Mohammadi, in his own words, 2026-09-26. **Built in part:** §6–§7 in P230; §4 in P231; §3 in P232, with his sentence; §11 in P233. §1–§2, §8–§10 are decided and not built, in the order he set.

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

## What this does not decide

The order of building, which he set: §6–§7, then §3–§5, then the CV path. The retention row's
mechanics, which ADR-0010's schedule already shapes. What "some universities weigh work
experience" becomes once there is data.
