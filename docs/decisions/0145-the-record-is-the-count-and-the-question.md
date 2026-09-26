# ADR-0145 — The record is the count and the question; a derived state is never acted on as if it were the record

**Status:** Accepted · 2026-09-26 · continues 0062 (the question is in the log), 0140 (a composite's walk is rebuilt from the log), 0051 §2 · names the fault behind P221 and P223/P224 as one fault
**Decided by:** Vahid Mohammadi, in his own words, 2026-09-26, after his item-6 run abandoned his date of birth without a word and read his address as a date. Built in P224.

## Context

Two days, two stops on the same run, and one fault under both.

**P221.** The page read the run three times for one answer — once when the send returned, once
for each event the stream delivered — and the earliest read, finishing last, overwrote the
newest. A playback stood on the screen with nothing to answer it. A later state was lost to an
earlier one.

**P223 and P224.** The date of birth was asked, answered two ways, and the question came back
verbatim: the reader's reason was thrown away and the re-ask was composed from a step derived
before the answer. P223 made the re-ask carry the reason and made the count include re-asks.
The next morning that counting rule, applied to a log that already held two silent re-asks from
the day before, exhausted the field on his third answer; the interview skipped to the next
required field without a word; his address was then read against a step derived from a count
the log did not hold, as a date, and discarded; and the worker's own advance put yet another
date question into the gap. In his words:

> *"A question order that can retreat after advancing means the step is computed from
> something that changed under it. That is the same shape as the stale-read race in P221 — a
> later state overwritten by an earlier one — and if it is the same cause in a second place,
> say so."*

It is the same cause. In P221 the derived thing was the page's view of the run; in P224 it was
the interview's position — a count kept in memory and never written, and a step derived from
that count and then used to decide which question a message answered. In both, something
derived from the record was acted on as if it were the record, and the record and the derived
thing disagreed. ADR-0140 met the same fault a fortnight earlier, in the composite walk, and
fixed it once: the walk is rebuilt from the log. This ADR names the fault so it is looked for,
rather than fixed a fourth time.

## Decision

In his words, the three conditions and the two rules:

> *"answers read against the open question on the log, not the derived step; an exhausted
> required field stops with words, never skips; the count written by the re-ask is the only
> count."*
>
> *"The stop has to say which field and what happened, in the student's terms. Not 'the
> interview stopped' — 'I asked for your date of birth three times and could not read any of
> your answers, so I have stopped rather than carry on without it.'"*
>
> *"Nothing required may ever be skipped, by any path, for any reason. If a field is required
> and unfilled, the run cannot advance past it. Make that a structural property rather than a
> branch someone could add an exception to later — and if the code cannot express it that way,
> tell me rather than approximating it."*
>
> *"Whatever the count means, it must not be possible for a change to the counting rule to
> retroactively exhaust a field that was never fairly asked. My two silent re-asks yesterday
> were the system's fault, not mine, and they spent my attempts."*

So:

1. **The asking writes its own count.** `value_asked` carries `attempt`, 1-based since the
   field was last confirmed, written by the asker from the last written attempt plus one
   (migration 0026). The service reads the count back and derives nothing: not readings
   superseded, not rejections, not re-asks inferred from adjacency. A rule can change what the
   next asking writes; it cannot change what an earlier one wrote. Rows written before 0026
   carry no count and read as 1: the old loop's silent askings do not count against the
   student. The in-memory count `receiveAnswer` keeps for the interview harness is not read by
   the service; the log's is.
2. **An answer is read against the question the log holds open**, the last `value_asked` with
   no reading after it. The derived step still decides that the run is interviewing; it no
   longer decides which question a message answers.
3. **The first outstanding field is the only selection.** `nextAction` has one choice and no
   predicate over attempts: the first outstanding field is asked, or it is the field the
   interview stops on. There is no branch that could skip it, because there is no branch. The
   run itself was never able to advance past an unfilled required field — the plan refuses to
   build with a `value_unavailable` blocker, and P212 made the interview's "complete while
   blocked" a named stop — so what could be skipped was the interview's turn, and now cannot.
   That is as structural as the code can express it: a property of one function's shape,
   pinned by a test that walks every count the first two fields can hold.
4. **The stop says which field, how many times, and what happened**, from the log: "I asked
   for your date of birth three times and could not read any of your answers, so I have stopped
   rather than carry on without it." A reading the student refused is told apart from an answer
   nobody could read.

## The rule, and the third place

**Act on the record. Re-read it under the lock before writing. Never act on a derivation older
than the write it would follow.** Where a derived state must exist — a page's view, a step, a
count in memory — it is a reading, and a later reading wins over an earlier one.

Is there a third place? Yes, and it is guarded, not absent. Two paths derive the interview's
next step from the same log: the worker's `advance` and the message path. Each reads the log
once and acts. For a question the guard is the lock in `#putTheQuestion`, which re-reads the log
before writing and writes nothing if a question already stands. For a stop the guard is the
intervention ledger's one-open-intervention-per-target key (0007): a second derivation that also
says "stop" raises nothing new. What is not guarded is any future write made from a derivation
without that re-read, and this ADR is the reason such a write is refused in review.

The message route answering before the driver has read the message is not a fourth place; it
is why P221's race existed, and P221's guard on the page is the answer to it.

## What this does not decide

It does not change `MAX_ATTEMPTS_PER_FIELD` (three), nor what happens after the stop, which is
ADR-0007's: a person. It does not read any list, page or portal.
