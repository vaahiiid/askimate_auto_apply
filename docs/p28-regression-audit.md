# P28 — deliberate regression audit

Ten mutations against the two interview actions the driver used to drop, the intervention they now
raise, and the line the student reads. Each was applied to a file on disk, **read back from disk to
prove the edit landed**, run against the control that governs it, and restored from a byte copy
taken before the edit — never from `git checkout`.

**Seven were caught on the first attempt. Three survived**, and the three are the useful part: one
was a mutation that did not mutate, one was a control that did not exist, and one is genuinely
unreachable and is recorded as such rather than papered over.

| # | Mutation | File | Result | Caught by |
|---|----------|------|--------|-----------|
| R1 | `escalate` is dropped again on the decide path | `run-driver.ts` | **CAUGHT** ¹ | driver e2e |
| R2 | `escalate` is dropped on the MESSAGE path, where the client lives | `run-driver.ts` | **CAUGHT** | student page |
| R3 | A rejection no longer re-derives, so the third one is silent | `run-driver.ts` | **CAUGHT** | student page |
| R4 | The run is not stopped, only talked about | `run-driver.ts` | **CAUGHT** | driver e2e |
| R5 | The specialist is never told | `run-driver.ts` | **CAUGHT** | driver e2e ×2 |
| R6 | The intervention stops naming WHICH field | `run-driver.ts` | **CAUGHT** | driver e2e |
| R7 | The stop is announced as routine rather than as a failure | `run-driver.ts` | **CAUGHT** ² | driver e2e |
| R8 | `request_document` falls through as if it were ordinary | `run-driver.ts` | **CAUGHT** ³ | driver e2e |
| R9 | The page shows the step again for a run waiting on a person | `client/journey.ts` | **CAUGHT** | student page |
| R10 | `escalated` stops counting as waiting on a person | `client/journey.ts` | **CAUGHT** | student page |

¹ Survived first: the control did not exist. ² Survived first: the mutation was a no-op.
³ Survived first, and correctly — the path is unreachable; asserted as data instead.

## R1 — a survival that found a missing durability test

Removing the check from `#decideOnce` changed nothing, because every test reached the escalation
through the **message** path and the later `advance()` found the run already stopped. The decide-path
check was shadowed.

It is not redundant, though, and working out why produced the test that was missing. `#correct`
appends the rejection and **then** re-derives. A process that dies between those two leaves a log
whose attempts are exhausted and a run still marked `running` — the client only re-reads, so nothing
would ever stop it except an advance.

The new test writes exactly that half-finished state — the exchange appended directly, `answerStudent`
never called — and then advances from a fresh instance:

```
× the interview stops rather than stranding > STOPS a run whose log already shows the interview gave up
```

The mutation now executes and is caught. The lesson is the P24 one from the other direction: a
survival is a question about the code, not only about the harness, and the answer here was a real
crash window nothing covered.

## R7 — a mutation that did not mutate

The first R7 replaced the message with `reviewMessage(input.entry) && unobtainableMessage(...)`.
`reviewMessage` returns a non-empty string, so `&&` evaluates to its second operand and **the message
was unchanged**. It reported SURVIVED, and the verdict was worthless.

Rewritten to replace the call outright, it is caught by the assertion that the student is not told
this was routine:

```
× TELLS the student, truthfully, and the message survives a fresh read
```

That assertion matters because `reviewMessage` says *"a rule we apply every time, not something that
has gone wrong"* — true for a mandatory review, and a lie for an interview that gave up.

This is the second phase running in which one of my own mutations was a no-op (P26's R1 was the
first). The check is cheap and I did not do it: read the mutated line back and ask whether the
program's behaviour can differ, not merely whether the text did.

## R8 — unreachable, and asserted as data rather than faked

Removing `request_document` from `#stopIfTheInterviewGaveUp` survived, and **correctly**:

- `planFill` sends a `document`-sourced mapping to `uploads`, never to `blockers`; only a
  `profile_field` whose value is unavailable becomes a blocker.
- The orchestrator enters the interview only `if (plan.blockers.length > 0)`.
- `nextAction` returns `request_document` only once no field is missing.

Those cannot both hold, so the branch cannot execute and no behavioural test can catch its removal.
The first version of that test group asserted an escalation that cannot happen; it was **deleted
rather than kept green**, as P24 deleted one.

The branch stays, and is asserted as **data** — the same answer P25 gave for the client's
forbidden-capability list and P27 gave for its unpublished-route exceptions. It cannot silently
narrow to `escalate` alone, and the day documents do reach the interview the handling is there.

What the measurement left behind is recorded in ADR-0064 §4 and is worse than the stranding it
replaced: **a reviewed artefact can declare `requiredDocuments`, and the run neither asks for it nor
stops.** Closing that means building document support, which is blocked on the disclosure (ADR-0022)
and retention (ADR-0023) decisions.

## R2 and R3 — the mutations that justify the message path

Both are caught only by the **browser** suite, and that is the point. R2 removes the stop from
`#askAfterWriting` and R3 stops `#correct` re-deriving after a refused reading. Neither changes what
an *advance* does, so the driver tests pass — and the student, whose client only ever re-reads
(ADR-0060), is stranded exactly as before.

The first implementation of this phase had that bug. The browser test found it.

## A test of mine that was a race, and what replaced it

The browser test originally drove all six exchanges through the composer and slept 400ms between
them. It passed alone and failed under parallel load — a race dressed as a test, and one that would
have become a flaky CI failure for somebody else to debug.

Replaced by putting each proof where it can be made honestly: the escalation is driven through the
server's own `answerStudent` (the entry point the route calls, proven end-to-end in the driver
suite), and the browser asserts the **rendering** — that a stopped run does not read as a live
interview, after a reload with browser storage cleared. Stable across three consecutive full-suite
runs under load.

## Verified after every restore

The harness's `save()` skips when a snapshot exists, which silently reverted a fix in P27. The
snapshot store was deleted before this phase's runs, and every mutated file was read back from disk
afterwards — `git status` clean, and each mutated line spot-checked by grep.
