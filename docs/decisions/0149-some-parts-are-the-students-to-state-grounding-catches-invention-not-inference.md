# ADR-0149 — Some parts are the student's to state: a document is never asked for them, because grounding catches invention, not inference

**Status:** **Accepted** — Vahid's decision, 2026-09-28, in his own words (P245)
**Depends on:** [ADR-0016](./0016-extraction-must-quote-the-document.md),
[ADR-0148](./0148-the-interview-is-an-ai-asking-not-a-form-read-aloud.md) §1, §9, §11
**Amends:** [ADR-0016](./0016-extraction-must-quote-the-document.md) — a fourth limit added to
"What this does NOT claim"

## The finding

His first live reading of his own CV (2026-09-28, ADR-0148 §9): every qualification was dropped
because `countryCode` was not found, and the model's reason was exact. Nobody writes *"University
of Tehran, Iran"* on a CV. The country is known to the reader and never stated. The same holds for
`basis` on a job: a CV does not say *full-time*.

The costing that followed said the fix was a flag that reduces drops. He read it differently, and
he is right:

> *"Asked for the country of 'University of Tehran', a model answers Iran and finds a span to
> ground it. Grounding does not catch it because the span is real — what is missing is that the
> student never stated it. That is the rule against the model sourcing values, defeated not by
> invention but by inference from something real."*

> *"So the flag is not a convenience for reducing drops. It is a boundary: some parts are the
> student's to state and must never be asked of a document, even when the document appears to
> imply them."*

> *"A reviewer authoring a plan should meet the question 'could a model derive this rather than
> read it?' and mark those parts accordingly."*

> *"Say plainly in that ADR what grounding does and does not protect against — it catches
> invention, not inference. I have been treating grounding as the guarantee and it is narrower
> than that."*

## What grounding does, and what it does not

ADR-0016 discards any reading whose quoted span is not in the document. That is a check on the
**span**: it proves the model quoted text that exists. It has always said it does not prove the
text is a faithful reading of the paper, nor that the interpretation is right.

**The fourth limit, now stated:** grounding does not prove that the **value** was stated. A model
asked for the country of *"University of Tehran"* answers *Iran*, quotes the line the institution
is on, and the span is real. The value is not on the page; it is derived from something that is.
Grounding catches **invention** — a span from nowhere. It does not catch **inference** — a value
from somewhere real that does not say it. The two look identical to the span check and are
opposite in what they mean for the rule this system is built on: *a value the student did not
state is never supplied by us* (ADR-0148, Vahid, 2026-09-27).

Inference is the more dangerous of the two, because it is usually right. *Iran* is the right
country for the University of Tehran. A right answer nobody stated enters the profile as if the
student had said it, and the student's confirmation — which catches a wrong reading — does not
catch a right guess, because the student confirms what they know to be true, not what they know
they said. The confirmation step is a check on **truth**; this boundary is a check on **source**.

## The decision

**Some parts are the student's to state, and a document is never asked for them.** A part so
marked is never sent to a model with a document, never read out of one, and never carries a
document as its origin. It is asked in the interview, in the student's own words, and it enters
the profile the way every stated value does (ADR-0148 §6–§7). This holds even when the document
appears to imply the value, because *appears to imply* is exactly the case the boundary exists
for.

**How a part is marked.** Every part of a document plan (`packages/extraction/src/plans.ts`)
carries its **source**: `document` — read by the model and grounded in the text — or `student` —
never asked of a document. The reader skips a `student` part without a call. An entry that lacks
it is not dropped and not filled: it arrives incomplete, and the interview asks for what the
document did not give (ADR-0148 §11's mechanism, the walk seeded with the parts that were read).

**The reviewer's question.** Anyone authoring or reviewing a plan asks of every part: *could a
model derive this rather than read it?* A part a document of this kind does not state — a country
the reader knows, an employment basis nobody writes, a nationality on a document that carries only
a place of birth — is marked `student`. A part the document prints under a label — a passport's
issuing country, a transcript's grade — is `document`. Where a document sometimes prints it and
sometimes does not, the part is `document` and its absence is asked, never derived. The question
is met at authoring, because it cannot be met at run time: the span check has no way to tell a
read value from a derived one.

**What is marked now, on his words.** On the CV plan, `education.prior_qualifications.countryCode`
and `employment.history.basis` are the student's to state. The CV's `duties` stays a document
part: a CV states duties when it has them, and a job that lists none is asked.

**What is not decided here.** The other plans have parts that meet the question and have not been
answered by him: the transcript's `countryCode` (labelled *Country*, which a transcript may print
in the institution's address and may not), and any part of the passport and bank-statement plans
a reviewer finds answers *derive* rather than *read*. Each is a row until he marks it (row 102).
Nothing is re-marked by inference here either.

## What this changes in the code, and when

The source on every plan part, the reader that skips a `student` part, and the incomplete entry
that arrives with what the document gave and asks for the rest: built inside the reader process
of stage three (ADR-0148 §9), not before it, because an incomplete entry with nothing to carry it
into the interview would be produced by nothing and consumed by nothing. **Built in P246:** every
part of a list plan carries `source`; `readListEntries` builds no request for a `student` part and
drops no entry for a missing one; the CV reader names such parts in `toAsk`; the plane seeds the
interview's walk with what the document gave and the interview asks the rest. A test holds the
boundary before the model: a client that records every part it is asked for is never asked for
the country of a qualification or the basis of a job, even off a fixture that prints them (red
before the flag, green after).

## Consequences

- A required part is required of the **application**, not of the document (Vahid, 2026-09-28).
  The interview's field spec carries what the application needs; the document plan carries what
  the document can be expected to state; the portal's demand (ADR-0148 §11) carries what one
  portal insists on. Three different things, and the reader no longer conflates the first with
  the second by dropping an entry for a part the document never had.
- "Missing" from a document is a normal outcome for a `document` part and an impossible one for a
  `student` part, which was never asked. The measurement reports each part's source.
- The grounding rule of ADR-0016 keeps its guarantee and loses its reputation for a larger one.
  Its section "What this does NOT claim" carries the fourth limit and points here.
- A test holds the boundary the way ADR-0004 holds confirmed values: a `student` part is not
  reachable from the reader's model call, so the reader cannot ask for it by mistake.
