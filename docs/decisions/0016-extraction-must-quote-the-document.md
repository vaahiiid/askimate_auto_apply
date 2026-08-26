# ADR-0016 — An extracted value must quote the document, or it is discarded

**Status:** **Accepted** — 2026-08-26
**Implements:** brief §2.3 (extract, then confirm) and §2.9 (nothing is invented)
**Depends on:** [ADR-0004](./0004-branded-types-for-confirmed-values.md),
[ADR-0007](./0007-agent-led-conversational-intake.md)

## The problem this solves

Extract-then-confirm works because the student checks what was read. For a **conversation** that is
reliable: the student said the words a moment ago, and a misreading is obvious to them.

For a **document** it is much weaker, and the difference matters:

> **Agent:** I read your passport number as `K98765432`. Is that right?
> **Student:** Yes.

A student will very reasonably say yes. Nobody reads their own passport number digit by digit, and
a fabricated one looks exactly like a real one — right length, right alphabet, right shape. The
confirmation step, on its own, does not catch a **confabulated** value. It catches values the
student recognises as wrong, which is a different and much smaller set.

This is not a hypothetical failure mode. It is the characteristic one: a model asked to read a
blurry photograph, having seen a great many passports, produces something passport-shaped.

## The decision

Extraction asks the model for **two** things:

| | |
|---|---|
| `verbatim` | the span of the document it read, copied exactly |
| `value` | its interpretation of that span |

The span is then checked against the document's text. **If it is not there, the reading is
discarded** — regardless of the value's plausibility and regardless of the model's confidence.

```
model reads → quotes a span → span checked against the text → parsed → ProposedValue → student confirms
                                        │
                                        └─ absent? DISCARDED. Never reaches the student.
```

A model that invents a value must also invent the line it came from, and that invention is
**deterministically detectable**. So the one failure mode the student realistically cannot catch is
removed before it ever reaches them.

Confidence plays no part. A fabricated reading at 1.0 is discarded exactly like one at 0.2 —
consistent with every other confidence figure in this system, none of which can promote anything.

## Composite fields

A qualification is a level, a subject, an institution, a country, a year, a grade and a scale.
Asking a model for the whole object in one call means one unquotable answer covering seven separate
facts — precisely the shape grounding cannot check.

So each part is **quoted and grounded separately**, and the object is assembled by code. One
ungrounded required part fails the whole field: a qualification with six true facts and one
improved grade is not 86% correct, it is wrong.

## What this does NOT claim

Three limits, stated because a guarantee described more broadly than it holds is worse than none:

1. **It does not prove the text is a faithful reading of the paper.** If OCR turns a `0` into an
   `O`, grounding confirms the model read the `O` faithfully. The text layer is the ground truth
   here, not the document.
2. **It does not prove the interpretation is right.** A model can quote a real line and misread it.
3. **It is not a type-level wall.** Grounding is a runtime check inside one package, unlike
   ADR-0004's compile-time guarantee — because "is this string in that document?" is a fact about
   two runtime values and no type can express it.

Limits 1 and 2 are exactly what the student's confirmation is good at, which is why extraction
still produces a `ProposedValue` and nothing more. The two mechanisms cover different failures and
neither replaces the other.

## Alternatives rejected

**Trust a confidence threshold.** A confabulated reading is not a low-confidence one — it is
typically the model's most confident output, because a clean invention has none of the hesitancy a
genuinely ambiguous smudge produces. Thresholds select against exactly the wrong cases.

**Require a second model to agree.** Two models reading the same blurry number tend to make the
same guess, for the same reason two people do. Agreement between them is much weaker evidence than
presence in the document, and it costs a second inference per field.

**Ask the student to re-type the value.** That is a form, which ADR-0007 rules out — and it moves
the work back to the student to compensate for the system's uncertainty.

## Consequences

- Fixtures and tests must use realistic document **text**, not structured data. A test whose
  fixture is JSON cannot exercise this check at all.
- The stand-in model client never fabricates a span. If it did, every test of this rule would pass
  vacuously.
- `rejected_ungrounded` is reported **distinctly** from "the document did not contain it". They are
  opposite conclusions: one is a model problem, the other is a document problem, and a rising count
  of the first is something a human should see rather than something absorbed as "documents have
  been unclear lately".
