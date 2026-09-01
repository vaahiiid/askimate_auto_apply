# P11 — the deliberate regressions, and the three tests that were passing for the wrong reason

**Date:** 2026-09-01 · **Governs:** [ADR-0049](./decisions/0049-the-run-driver-drives-the-case-machine.md)

Fifteen mutations. Each one was proved to have landed by **re-reading the file
from disk** after the write and asserting the new text is there — and, for the
replacements that remove text, that the old text is gone. Restores are from a
file copy, never `git checkout`: P10 recorded why, and the reason has not
improved.

The applier is `regress.py` (kept in the session scratchpad, not committed —
it is eleven lines and the discipline is what matters, not the script).

| # | The mutation | Caught by |
|---|---|---|
| **R1** | `nextCaseHop` jumps straight to the target instead of hopping | 20 tests across F, G, H, I, J — every gated run deadlocks at a transition the machine forbids |
| **R2** | `nextCaseHop` walks BACKWARDS as well as forwards | **NOT CAUGHT FIRST TIME.** See §1 |
| **R3** | `financial_evidence` is never raised from the profile | `REFUSES to ask for authorisation while a mandatory review is outstanding` |
| **R4** | Every review is recorded as `approved` | **NOT CAUGHT FIRST TIME.** See §2 |
| **R5** | `#advanceCase` swallows the machine's refusal and reports success | `REFUSES to ask…` — the run is left `running` instead of `escalated` |
| **R6** | The student's content hash is not compared against the preview | `REFUSES a hash that is not what was rendered`, and one more |
| **R7** | `recordDecision` swallows the domain's refusal of a capture | **NOT CAUGHT FIRST TIME.** See §3 |
| **R8** | The decision route no longer asks whose session it is | `REFUSES a decision from someone else's session`, and two more |
| **R9** | The pause message names the trigger ("the financial evidence on it") | `REFUSES to ask…` — *and not why: expected … not to contain 'financial'* |
| **R10** | The case walk moved into `#situation`, so a LOOK is a move | `REFUSES rather than skipping when the plane is unreachable` — see §4 |
| **R11** | The case walk moved BEFORE the secure step | `REFUSES rather than skipping…` — *a refused run has not moved its case* |
| **R12** | The re-read after raising a trigger is dropped | **NOT CAUGHT — AND CORRECTLY SO.** See §5 |
| **R13** | `awaiting_authorisation` maps to `PREPARING` | 9 tests, including the whole journey suite |
| **R14** | The internal review route admits any caller | `an APPROVING review clears it, over the real internal route` |
| **R15** | A decision with no content hash is accepted | `REFUSES a body with no hash at all` |

## 1 · R2 — a test named for a property it never reached

`does NOT walk backwards when a later phase reads earlier` passed with the
backwards branch deliberately broken.

The reason: in these fixtures a run's phase never actually reads *earlier* than
the case has already got to. `nextCaseHop` answered `null` on `to === from`
long before the direction check mattered, so the test proved idempotence and
nothing else. It was named for the property somebody wanted, not the one it
exercised.

**Fixed by asking the function directly.** `packages/orchestrator/src/case-spine.test.ts`
now proves it over **every ordered pair on the spine**, along with three things
that had no test at all: that every spine edge is one `checkTransition` allows,
that a case which has *left* the spine is not walked back onto it, and that
every `WorkflowPhase` lands on a state the walk can reach.

The integration test kept its assertion and lost its name — it is now `says
nothing new when the run advances and stays where it is`, which is what it
proves.

## 2 · R4 — a guard test that never put the case in front of the guard

`a REJECTING review does NOT clear it` passed with **every review forced to
`approved`**.

It started a run, recorded a rejection and asserted the case had not reached the
student. But the run it started never got past `request_secret` — no secret, no
account — so its case never targeted `AWAITING_STUDENT_AUTHORISATION` and there
was nothing for the guard to hold back. The assertion was true for a reason
that had nothing to do with reviews.

**Fixed by driving the run to the authorisation first**, through the same helper
the sibling test uses (now parameterised on the conversation), and asserting the
case is held *before* any review is recorded. With that, forcing `approved`
fails the test.

## 3 · R7 — a branch nothing in the suite could reach

`recordDecision` refuses when the domain refuses the `capture_authorisation`
intent. Replacing that refusal with `{ ok: true }` changed no test.

The branch was unreachable: everywhere in the suite, by the time a second
decision arrives the run has moved off `authorise`, and the earlier `not_asked`
refusal answers first. The domain's refusal never ran.

There is exactly one situation where the run *is* asking and the case says no —
a case held by the mandatory-review guard, where the orchestrator will happily
render a preview because nothing at the run level is wrong. That is now a test:
`REFUSES the student's own approval while the review is outstanding`, which also
asserts that nothing was written. It is the most important thing in this phase
that had no coverage: a student being able to approve an application the system
has decided a human must look at first.

## 4 · R10 — detected, but not by the test written for it

`does NOT move ANY case when a runner merely looks for work` did **not** fail
when the walk was moved into `#situation`. The secure-refusal test did.

The poll genuinely looked at a run (the test now asserts it claimed something,
so it cannot pass on an empty pool). But a *claimable* run is by definition one
whose phase is `creating_account` or `filling`, and the decide path has already
walked its case to the state those phases map to — so there was no hop left for
a poll to make.

The test is kept as a standing check, with a comment saying exactly this. If a
future phase mapping ever leaves a claimable run's case behind, it is what
notices. It is a canary, and calling it a proof would be the same mistake as §1.

## 5 · R12 — not detected, and not a defect

`#advanceCase` re-reads the case after raising a trigger (`if (raised)
continue;`). Deleting that changed nothing, and should not have.

Deciding against the stale `held` appends at a sequence the trigger write has
just taken; the store refuses it; the loop re-reads. The safety is the
optimistic sequence check, not the `continue` — which is an efficiency. The
code now says so, because a reader would otherwise assume the `continue` is
load-bearing and be wrong about which line to keep.

## 6 · What this pass added to the suite

Four tests, all of them written because a regression showed the property was
uncovered rather than because the property looked untested:

- `packages/orchestrator/src/case-spine.test.ts` — 7 tests on the spine as a
  pure function (§1)
- `REFUSES the student's own approval while the review is outstanding` (§3)
- `an APPROVING review clears it, over the real internal route` — the review
  route had **no test at all**, including no credential test, until R14
- `a refused run has not moved its case`, on the secure-refusal test (R11)

and one test renamed to what it proves (§1), one rewritten to reach the guard
(§2), one given a precondition so it cannot pass vacuously (§4).

## 7 · A defect found before the regressions, in the P11 draft itself

The draft moved the secure-refusal test onto a second student to keep profiles
apart. That student had no confirmed interview, so the run stopped at
`interview` and never reached the password — and the refusal under test never
happened. The test failed loudly, which is the only reason it was found; had
the expectation been `ok: true` it would have passed forever.

The fix was to put it back on the student whose interview that group confirms,
and the case is recorded in the test itself, because "a refusal test needs the
run to actually get there" is the general form of §1, §2 and §3.
