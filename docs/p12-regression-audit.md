# P12 — the deliberate regressions, and the bug the journey found first

**Date:** 2026-09-01 · **Governs:** [ADR-0050](./decisions/0050-the-account-lifecycle-completes-through-the-students-own-decision.md)

Eleven mutations, each proved to have landed by re-reading the file **from
disk** after the write. Restores are from a file copy, never `git checkout`.

| # | The mutation | Caught by |
|---|---|---|
| **R1** | Raising a handoff is no longer idempotent by token | `is IDEMPOTENT by token — a second raise writes nothing` — see §2 |
| **R2** | The student is told on every poll, not once | `stops for the verification, raises ONE handoff, and tells the student ONCE` |
| **R3** | A confirmation is accepted whatever hash it carries | `REFUSES a confirmation whose hash is not the message they were shown`, and one more |
| **R4** | The account never reaches `handover_due` | 7 tests, including the whole journey and the P9 multi-page group |
| **R5** | `studentConfirmedAccess` is assumed rather than established | `reaches handed_over only when every applicable item is a FACT`, and the journey |
| **R6** | The verification item is DROPPED on a non-verifying portal instead of substituted | `substitutes the reset flow where the portal does not verify the address`, and the journey |
| **R7** | The student is shown the whole gate, not their own items | `asks for the account back when handover is due` — *and the journey returns 409*, see §1 |
| **R8** | `mayConclude` answers `true` without looking at the account | `REFUSES to conclude the case while the account is still ours` |
| **R9** | `fold` forgets which handoffs were completed | 5 tests, including the restart test and the journey |
| **R10** | The password reset is never asked for | `asks for the account back when handover is due`, and the journey never finishes |
| **R11** | The account handover is never raised at all | the journey, twice — see §3 |

## 1 · The bug the journey found before any regression did

The journey failed with **409 `content_changed`** on a confirmation the student
had just been sent, and the cause is the most interesting thing in this phase.

`hand_over_account` carried the full handover checklist as the list shown to the
student. That list includes `studentInformed` — *"the student has been told the
account exists"* — and **telling them is what makes it true**. So the message
was composed with the item outstanding, appended, and then the raise flipped the
item; the next render produced a different message, and the hash the student
sent no longer matched.

A message a student confirms has to be the message they read. The fix is two
lists: the full checklist is the gate, and `studentHandoverItems` is what they
see. R7 is the mutation that puts it back, and it reproduces the same 409.

This is the second time in three phases that a test caught something no amount
of reading would have: P11's `determineAge` raised a minor trigger on every case
in the system.

## 2 · R1 was caught, but not where it was aimed

The mutation removed the "already open, nothing to say" branch from
`require_handoff`, and the **driver's** test still passed. The token is derived
from `(caseId, kind)`, so a second raise carries the same token — and with the
idempotence branch gone it fell through to the *next* guard, "a different
handoff is already open", and was refused rather than duplicated.

Two mechanisms protect one property, and the mutation only removed one of them.
The domain test caught it because it asks the function directly. Worth recording
because the driver test looks like the detector and is not: an integration test
sitting downstream of two guards cannot tell you which one is load-bearing.

## 3 · R11 exposed a detection that failed on the wrong thing

Removing the account-handover raise left the conversation with no message, and
the journey's assertion — `expect(rows[0]?.content).toContain(institutionName)`
— failed with *"the given combination of arguments (undefined and string) is
invalid for this assertion"*.

That is a pass/fail signal and nothing more. It says the argument was the wrong
type; it does not say the student was never told. The P10 audit recorded the
same class of problem (detections that fire on a precondition rather than on the
property) and the same fix applies: the assertion now establishes the string
exists, and then searches it. Re-run against the fix, R11 reports *"the student
was told something: expected '' not to be ''"*.

## 4 · What this pass changed in the suite

- Four tests were added in `packages/domain/src/machine.test.ts` for the handoff
  intents, including that a second raise writes nothing and that a completion
  for a handoff the case is not waiting on is refused.
- Six were added in `packages/orchestrator/src/account-created.test.ts` for the
  stage derivation — including that an open lease keeps the account
  outstanding, and that the same evidence gives the same answer twice, which is
  what "derived, not stored" means.
- Three were added in `packages/account/src/account.test.ts` for the
  substitution, including the half that matters most: it does **not** fire on a
  portal that does verify.
- Group N in `run-driver.test.ts` covers the whole path against a real database,
  including a restart that must not ask the student again.
- Two existing tests changed on purpose: `ready_to_submit` now follows the
  handover rather than preceding it (§5 of the ADR).

## 5 · Not detected, and worth knowing

The **ordering** of `#raiseHandoff` relative to the case walk has no test. It
sits after the walk and before the checkpoint, for the same reason the walk
sits after the secure step, but moving it earlier breaks nothing in the suite —
in these fixtures no case is refused at the point a handoff is raised, so there
is no masking to observe. It is recorded here rather than left implied.

`generated_ephemeral` accounts cannot reach `handed_over` at all, so nothing
exercises `temporaryCredentialDestroyed` on the true side. That is the honest
consequence of nothing in this service holding that credential, is stated in
ADR-0050's consequences, and is not a gap this phase can close.
