# ADR-0152 — One thing to answer at a time: nothing is said over an open question

**Status:** Accepted · decided by Vahid, 2026-09-30, in his own words · built in P256

## Context

His walk of 2026-09-30, on the local stack at 0.251.0, stopped a run. The sequence, whole:

- the interview asked whether he was living in the UK; he said yes; the playback *"Is that
  right?"* opened and waited;
- the CV reader's report landed and its sentence was said over the open playback — seven jobs,
  three qualifications, and the questions still to come;
- he answered one of the questions the sentence had announced; the driver, whose record said the
  playback was open, read that as a correction to the UK reading and refused it;
- the next question was not the refused field's but a CV question about a second, earlier upload
  nobody had superseded; his answer to that was taken correctly, and the reading it started spent
  a second sixty-eight calls on a document he had not meant to use;
- the UK field was asked again, with a preface built from its label; and the stop came, counting
  three askings, of which one real failure.

His diagnosis of the first of these was right and is the principle here: *"the confirmation for
the UK question never closed — the CV sentence and the CV question arrived on top of it, and the
driver kept treating the open confirmation as what my messages answered."* The record was right.
The interview spoke over it.

## Decision, in his words

> *"The one I want stated as a principle rather than a fix: nothing is said over an open playback.
> A confirmation is a question, and speaking over it while it waits invites exactly what I did —
> reading the new sentence as the interview moving on. Whatever else is true, the student should
> never have two things to answer at once. That should hold for anything that arrives
> asynchronously, not just the reading's sentence. If the reader, a portal demand, or anything else
> lands while a question is open, it queues."*

And, on the four faults around it, decided with it:

> *"On the attempt count: counting failed answers rather than askings is right, and it also fixes
> the thing I could not name — that my three 'attempts' included two messages that were not
> addressed to that question at all. On superseding: a later CV supersedes the earlier one, yes.
> And record that the vault has defined a `superseded` state that nothing has ever set. A state in
> a schema that no code writes is a claim the system makes about itself and does not keep."*

## What this decides

1. **One thing to answer at a time.** While a playback is open, a decision is pending, or a
   question stands, nothing else is said to the student. What arrives asynchronously — the
   reader's report, a CV's arrival, a portal's demand — is recorded at once and told at the next
   moment the student has nothing to answer: at once when that is now, and after their answer
   when it is not. The one exception is ADR-0151's as amended in P254: a CV field's own open
   question yields to the CV question, because that leaves one thing to answer, not two.
2. **The telling is a record, not a memory.** A reading row carries `told_at` (migration 0035):
   null while the telling is owed — the question, that a CV ahead of its field is held, or the
   reading's sentence — and set when it was said. A row read has something new to tell, and its
   `told_at` is cleared when the reading ends. A demand's sentence is owed while the demand is the
   last thing on the log after it.
3. **A refused field is asked next.** A field whose reading the student refused at the playback is
   asked again before any other outstanding field. On his run it waited behind a CV question, and
   what he typed next was read against the wrong one.
4. **A later CV supersedes the earlier.** A CV confirmed while an earlier one of the same student's
   is still held or offered — nobody asked about it yet — ends that row `superseded`, naming the
   later document, and sets the vault's own `superseded` state, which was defined in migration
   0017 and never written by any code until this phase. A superseded row is never asked about and
   its consent is `moot`.
5. **An attempt is a failed answer, not an asking.** An answer to the question that stood that
   could not be read is on the log as `answer_unread`; a reading refused at the playback is
   `value_rejected`. The stop rule counts those, per field since its last confirmation, and stops
   at three. Askings keep their count (ADR-0145) for the words the student reads, and no longer
   decide anything.
6. **The playback, the correction preface and the stop name the question**, never the label as a
   noun: *To "Are you living in the UK at the moment?" I've recorded: yes* — and a yes is *yes*,
   never `true`. A composite or a list, whose label is a noun, keeps *I've recorded your home
   address as*.

## What this does not decide

Whether a page reload may fire the stop check — the third asking on his run is accounted for by
his log, not assumed (row 112). Whether a superseded document's contents should be purged at
once rather than left to retention. The words of any one sentence, which are his to find wanting.

## Consequences

- ADR-0140's rule that a typed message while a playback is open corrects it stands; the change
  is that nothing is said that would make a student type about something else.
- ADR-0145's asking count stands as a count of askings; it no longer stops anything.
- ADR-0151 and its amendments stand; the moment of asking is now also subject to this rule.
- His stopped run resumes by a specialist's resolution (ADR-0048), after which its failed-answer
  count for the UK field is one, and his next answer goes through.
