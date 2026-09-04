# P26 — deliberate regression audit

Eleven mutations against the path that puts an interview question to the student, the log rule that
keeps it asked once, and the schema and contract that carry it. Each was applied to a file on disk,
**read back from disk to prove the edit landed**, run against the control that should catch it, and
restored from a byte copy taken before the edit — never from `git checkout`.

All eleven are caught. Two only after the first attempt failed to prove anything, and both are
recorded below with what went wrong, because in each case the fault was mine rather than the
system's.

| # | Mutation | File | Result | Caught by |
|---|----------|------|--------|-----------|
| R1 | The driver writes a sentence of its own instead of the step's | `run-driver.ts` | **CAUGHT** ¹ | driver e2e ×2 |
| R2 | The log gate is dropped, so every poll asks again | `run-driver.ts` | **CAUGHT** | driver e2e |
| R3 | The marker is written and the words are not | `run-driver.ts` | **CAUGHT** | driver e2e ×2 |
| R4 | A confirmed reading no longer draws the next question | `run-driver.ts` | **CAUGHT** | driver e2e |
| R5 | An unreadable answer leaves the student in silence | `run-driver.ts` | **CAUGHT** | driver e2e |
| R6 | The run reaches the interview without asking anything | `run-driver.ts` | **CAUGHT** | driver e2e ×2 |
| R7 | A student's message no longer closes the outstanding question | `run-driver.ts` | **CAUGHT** | driver e2e |
| R8 | The parser forgets the kind the vocabulary publishes | `events.ts` | **CAUGHT** | contracts |
| R9 | The schema admits a question with no field | `0014_*.sql` | **CAUGHT** | schema |
| R10 | The question is rendered to the model as history | `model-context.ts` | **CAUGHT** ² | `pnpm run lint` |
| R11 | The page shows the interview with nothing to answer | `run-driver.ts` | **CAUGHT** | student page |

¹ The first version of this mutation was a no-op. ² The first version was run against the wrong control.

## R1 — a mutation that did not mutate, and the assertion it exposed

The first R1 built a shadow object with a replaced `say` and then discarded it:

```ts
const recomposed = { ...action, say: "Tell me something." };
void recomposed;
```

Nothing downstream read it. It reported SURVIVED, and that verdict was worthless — a mutation that
never executes is not coverage, and the mistake was in the mutation, not in the code.

Rewritten to actually replace the text the driver appends, it caught. But writing it that way is
what showed the assertion underneath was weak: the test said

```ts
expect(said.at(-1)?.content?.length ?? 0).toBeGreaterThan(0);
```

which any message satisfies. It proved a message was written and **nothing about where the words
came from** — while the whole point of ADR-0062 is that the text is the step's own, so the student
is never asked something other than what the run is waiting on.

`nextAction` composes the question from the field's own label and rationale, so the assertion is now
on the label — which a driver-invented sentence cannot contain — and, one field further on, that the
second question differs from the first. A driver writing its own constant would have written the
same sentence twice.

## R10 — a lint rule cannot be tested by running tests

`model-context.ts` excludes the interview exchange from what the model is shown. R10 removed
`case "value_asked":` from that group and ran the `packages/conversation` and `packages/contracts`
suites. They passed.

That is not a shadowed control — it is the wrong control entirely. At runtime an unhandled kind
falls out of the switch and is skipped, which is byte-for-byte what the `break` in that group does,
so **there is no behavioural difference for any test to see.** What actually guards this is
`@typescript-eslint/switch-exhaustiveness-check`, which is a lint rule, and a mutation "run" through
vitest was never checked at all.

Re-run against `pnpm run lint`:

```
58:13  error  Switch is not exhaustive. Cases not matched: "value_asked"
       @typescript-eslint/switch-exhaustiveness-check
```

Recorded because the same trap caught P25's boundary rule from the other direction: the harness has
to run the control that governs the thing being mutated, and "the test suite" is not automatically
that control.

## R7 — the one that is easy to get subtly wrong

`openQuestion` treats a student **message** as closing the question, even one nothing could be read
from. Removing that clause leaves the question standing for ever: the student answers, the reading
fails, and the service never asks again because it believes it already has.

Caught by the test that says exactly that — *"records NO READING when it could not read the answer
at all, and asks again"*. That test previously asserted the opposite (*"nothing structured was
written"*), which was true and was the defect: the re-ask its own comment described existed only
inside the orchestrator and never reached the log.

## Two existing tests were corrected rather than kept green

- **`run-driver.test.ts`** — as above. The claim narrowed from "nothing was written" to "no reading
  was written", and gained what should replace it.
- **`p21-target-selection.test.ts`** — asserted `target_requested` was the last event in the log.
  Since the run now reaches the interview in the same call and asks, the log ends with the question.
  The real claim is the request's position relative to the exchange it closes, so it now asserts
  that, plus that exactly `["value_asked", "message"]` follows.

Neither was loosened to pass. Both were saying something they no longer meant.

## What is deliberately not covered

**The attempt count.** `attemptsFrom` counts proposals superseded and readings rejected; an answer
the model could not read leaves no proposal and so does not count towards
`MAX_ATTEMPTS_PER_FIELD`. A `value_asked` now exists and could carry that counter, but making it do
so would change when `information_unobtainable` fires. That is a behavioural change to an
escalation, not the journey gap this phase closes — see ADR-0062, "What this does not change".
