# ADR-0148 — The interview is an AI asking, not a form read aloud: the CV first, the by-hand questions from the portal's own fields, the student's words kept, and a list confirmed and corrected entry by entry

**Status:** Accepted · 2026-09-26 · supersedes ADR-0113 §4 (a CV may be read, as the separate decision that ADR said it would have to be) and keeps §1–§3 for the by-hand path · amends ADR-0092 (a second process that fetches a document after the gates: the CV reader) · continues 0004, 0007, 0111, 0112, 0140, 0146
**Decided by:** Vahid Mohammadi, in his own words, 2026-09-26. **Built in part:** §6–§7 in P230. §3–§5 and §1–§2, §8–§10 are decided and not built, in the order he set.

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

## Deleting the confirmed values, sized and not decided

A confirmed value lives in the profile's own rows, which can be deleted; in the conversation
log's proposal columns and message bodies, which are append-only and redactable only for
message text today (a redaction keeps the row and empties the words); and, once a run has
typed it, on the university's form, which is outside our reach and must be said so to the
student. Honouring "delete those too" means: the profile rows removed, redaction widened from
message bodies to the proposal columns by a migration, the case record measured for what it
carries, and a sentence to the student naming what was already sent. Not decided here.

## What this does not decide

The order of building, which he set: §6–§7, then §3–§5, then the CV path. The retention row's
mechanics, which ADR-0010's schedule already shapes. What "some universities weigh work
experience" becomes once there is data.
