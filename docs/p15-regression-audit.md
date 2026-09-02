# P15 — the deliberate regressions, and the two tests that proved nothing

**Date:** 2026-09-02 · **Governs:** [ADR-0053](./decisions/0053-a-student-can-stop.md)

Twenty-three mutations across four rounds. Each was applied, then the file was
re-read **from disk** and the new text asserted present before any test ran.
Restores are from a file copy, never `git checkout`.

Round 1 ran seventeen and caught fifteen. The two survivors were the most
valuable part of the exercise: one exposed a test of mine that **passed against
an empty list**, and the other exposed a mechanism I had written that turned out
to be **dead code**. Both are written up below, because "fifteen of seventeen"
without them would be a flattering and useless report.

| # | The mutation | Caught by |
|---|---|---|
| **R1** | Cancelling produces no `CaseCancelled` | `produces the CaseCancelled nothing had ever produced, and winds down` |
| **R2** | Cancelling does not void the approval | `VOIDS the approval, and names the student as the reason` |
| **R3** | The void names the wrong reason | as above — `student_revoked`, not `content_changed` |
| **R4** | Cancelling goes straight to a terminal state | 3 domain tests |
| **R5** | A mandatory review can hold a student in the application | `is not refused by a mandatory review, or by anything else` |
| **R6** | A cancellation concludes while the account is outstanding | `REFUSES to conclude while the student is still owed their account` |
| **R7** | Winding down can go somewhere other than concluded | `has NO way back — winding down goes one place only` |
| **R8** | Every state can still jump straight to `CANCELLED` | **survived round 1** — see §1 |
| **R9** | A stopped run is still offered to runners | **survived round 1** — see §2, the important one |
| **R10** | A stopped case keeps walking the spine | 4 tests |
| **R11** | A stopped case never pursues the handover it owes | `stays wound down for as long as the account is owed` |
| **R12** | A stopped run's account is never due back | 3 tests |
| **R13** | The driver never tells the orchestrator the run stopped | 3 tests |
| **R14** | A confirmation no longer needs to name what was confirmed | `parses a student's decision, and refuses one that names no content` |
| **R15** | A cancellation is refused unless it names content it cannot have | `takes a CANCELLATION with no hash, and ignores one sent anyway` |
| **R16** | The student is not told the account still exists | `tells the student the truth, including what stopping did NOT do` |
| **R17** | Erasure is not named as a separate request | as above |
| **R8** (round 2) | as above, against a new property test | `is the ONLY door into the terminal state` |
| **R9** (round 3) | as above, against a repaired probe | `is offered to NOBODY the moment they stop, so no account is created` |
| **R18** | The step substitution for a stopped run is removed | **survived every round — because it was dead code.** §3 |
| **R19** | A case with no account winds down for ever | `CONCLUDES, because nothing is owed`, and one more |
| **R9+R18** | Both defences removed at once | nothing failed — which is how §2 and §3 were found |

## 1 · R8 — a rule with no test is a rule that can be undone

Every non-terminal state used to list `CANCELLED` as a permitted target, and
P15 replaced each with `WINDING_DOWN`. **That substitution is the decision**: a
direct jump would skip the obligations guard, and `decide` refuses every intent
on a terminal case — so `complete_handoff` would be refused and the student's
account stranded.

R8 put `CANCELLED` back on one state's list. Nothing failed, because nothing
*issues* a direct transition: `cancel_case` always targets `WINDING_DOWN`. The
table had been changed correctly and no test asserted the shape it now had.

`is the ONLY door into the terminal state` now asserts it over the whole table
rather than over the one state somebody thought of, so re-adding `CANCELLED`
anywhere fails.

## 2 · R9 — my test passed against an empty list

This is the finding that justifies the whole exercise.

The guard reads: a case winding down or concluded is skipped in `claimWork`
before its step is consulted, so **no runner is offered its work**. `execute`
and `create_account` are the two things this system does to the outside world
and both arrive through there.

R9 deleted the guard. Every test still passed. Three rounds of investigation
found three separate reasons, and all three were problems with my tests:

**First**, the run I cancelled had already been **authorised**, so cancelling
voided the authorisation — and an unapproved run is never offered fill work
anyway (ADR-0051). The guard was being backstopped by an unrelated mechanism. A
new group now stops a run standing at `create_account`, which has **no
authorisation to void**, because the approval comes later.

**Second**, the "is it offered?" probe took work leases with a one-second
duration — and the driver's clock is **fixed** in these tests, so those leases
never lapsed. The probe emptied the pool permanently, and the assertion
`not.toContain(runId)` then passed against `[]`. It now deletes the leases it
took.

**Third**, only with both repaired did the mutation finally fail. The guard is
real, and it protects the worst thing this phase could fail to prevent: without
it, a runner polling one second after a student stopped would **create a real
account, in their name, at a university, for an application they had just
cancelled.**

Three layers of accident, each of which alone made a green test meaningless.
None would have been found by reading the test.

## 3 · R18 — I wrote a mechanism that was not needed, and deleted it

`#situation` gained a branch: for a stopped run, substitute the account's step
for the run's own, because `nextStep` consults the account after filling and a
student who stops mid-fill leaves the step at `execute`.

R18 removed that branch. Nothing failed. Sharpening the test to assert the
**step** rather than a handoff count — the count passed either way, because
handoffs had been raised before the cancellation too — did not change it.

So the branch was removed entirely, and all 113 tests still passed. The reason
is `HandoverEvidence.runStopped`, added in the same phase: it makes the account
`handover_due`, and `nextStep` then reaches the account branch on its own. Two
mechanisms for one property, and **the one I wrote second was never needed.**

It is deleted, along with the `#hasStopped` helper it used and the
`accountStepFor` export added to `packages/orchestrator` for its single caller.
Leaving that export would have created exactly the reader-with-no-writer shape
the last four phases have each been about.

`runStopped` itself is load-bearing and proved so: **R12** and **R13** each
fail three tests.

## 4 · What the raw round-1 numbers would have said

Fifteen of seventeen. Reported flat, that is a good result. It was two things:
**a test that asserted nothing against an empty list**, guarding the single most
consequential property in the phase, and **a mechanism I had written that the
codebase did not need.** One led to a new test group and two repaired probes;
the other led to deleting code, an unused helper and a needless export.

Neither was visible from the tests passing. This is the fourth phase running in
which a mutation was caught somewhere other than where it was aimed, or survived
because a property was over-determined — and the first in which the answer was
"delete what you added".

The suite is 1843 tests across 92 files, green against a real PostgreSQL.
