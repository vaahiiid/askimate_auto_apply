# P24 — deliberate regression audit

Seven mutations, each applied to a source file on disk, **read back from disk to prove the edit
landed**, run against the suites that should catch it, and then restored from a byte copy taken
before the edit — never from `git checkout`.

Six were caught. One survived, and it is **recorded as unreachable rather than counted as
coverage**.

| # | Mutation | File | Result | Caught by |
|---|----------|------|--------|-----------|
| R1 | The handoff hash is published without the open-token check | `run-driver.ts` | **SURVIVED — unreachable** ¹ | — |
| R2 | The `authorise` hash is invented instead of read off the step | `run-driver.ts` | **CAUGHT** | driver e2e, journey |
| R3 | The `confirm_value` hash comes from something other than the open proposal | `run-driver.ts` | **CAUGHT** | driver e2e |
| R4 | The run keeps asking for an authorisation it already has | `run-driver.ts` | **CAUGHT** | driver e2e ×3 |
| R5 | The read stops publishing what the run is waiting for | `routes.ts` | **CAUGHT** | driver e2e, journey |
| R6 | The handoff message is hashed with one character changed | `run-driver.ts` | **CAUGHT** | driver e2e ×2, journey |
| R7 | The pending decision is computed from a SECOND situation | `run-driver.ts` | **CAUGHT** | driver e2e, journey |

¹ See below. It is not coverage and is not claimed as any.

## R1 — an unreachable branch, measured rather than asserted

`#pendingDecision` publishes a `confirm_handoff` hash only when the case holds an open handoff token
**and** the step is asking for one — the two conditions `#handoffIntent` validates against. Removing
the token check broke nothing.

I first assumed a shadowed control and wrote a test for the state it guards: complete the handoff in
the case log, do not advance the run, then read. **The state does not exist.** The probe showed the
step moving straight from `student_handoff` to `authorise` the moment the completion was appended,
because the account's handoff stage is *derived* from `HandoffCompleted` rather than remembered —
which is exactly what the existing test `does NOT ask again after a restart — the stage is derived,
not remembered` says. The token and the step move together.

So the test was **deleted rather than kept green**. A test that constructs a state the system cannot
reach proves nothing and costs a reader's trust; this is the same call made about P19's R5.

The check itself stays, and not as decoration. The read must agree with the validator **by
construction**, not by the coincidence that two things happen to move together today: a step that
ever became sticky — cached on a checkpoint, say — would separate them, and the symptom would be a
client offered a decision the route immediately refuses `not_asked`. `handoffHashFor` omitted the
check and got away with it for the same reason, which is not a reason. Both the code and ADR-0061
now say this in as many words, so nobody reads the branch as tested.

## What the exercise confirmed about the design

**The three hashes are genuinely independent.** R2, R3 and R6 each corrupt one and leave the others
correct, and each fails on a different test. There is no single assertion that would have caught all
three, which is what "three sources, one read" should look like.

**One situation, not two.** R7 computes the pending decision from a fabricated step while the
position still comes from the real one — the exact drift that having two derivations would produce.
It is caught immediately, and by the journey as well as the unit suite, because a client that is
told the wrong thing to do cannot finish the journey.

**`pending: null` is load-bearing.** R4 makes the read ask for an authorisation unconditionally, and
three tests fail — including `waits for NOTHING once the student has approved`. A client that kept
being told to approve would offer the button again on a run that has moved on.

## Scope note

No UI was written. This phase closed the last interaction the published API could not represent,
which was found by reconstructing the journey rather than by discovering it halfway through a screen.
