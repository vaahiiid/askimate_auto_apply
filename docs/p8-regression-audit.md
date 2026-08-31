# P8 — the deliberate regressions, and the four defects wiring the fill revealed

Ten regressions against ADR-0046's plan transport and the fill, each applied to
a clean tree, proved to have applied by reading the file back from disk, gated
on a named check, and reverted byte-for-byte.

| | The regression | Detected by |
| --- | --- | --- |
| **R1** | The provenance is dropped and rebuilt on arrival | `contract-drift` — *loses nothing — not the value, and not the confirmation behind it* |
| **R2** | The wire admits a confirmed value with no provenance | `tsc` — `A_CONFIRMED_VALUE_CARRIES_ITS_PROVENANCE` |
| **R3** | An untransportable plan is trimmed rather than refused | `contract-drift` — *REFUSES a plan it cannot carry* |
| **R4** | The runner never presses save, so the portal keeps nothing | `journey` — the portal has no application |
| **R5** | A save that never lands is reported as a CLEAN failure | `fill-application` — *reports UNCERTAIN when the save never lands* |
| **R6** | A filled run is offered to a runner again | `journey` — *does NOT create a second account… and there is no browser work left* |
| **R7** | Fill work is not limited to one page | `journey` — the runner times out on another page's fields |
| **R8** | A credential field counts as a missing required field again | `journey` — the run never leaves `fix_content` |
| **R9** | A stored provenance comes back with a string where a `Date` belongs | `journey` — a `TypeError` inside the claim |
| **R10** | The runner takes `@askimate/aas-orchestrator`, and `pg` with it | `check-boundaries` — the runner's forbidden list |

R5 was the only one not detected on the first run, and for the reason P6's R7
was: nothing exercised a save that fails. `fill-application.test.ts` now does,
with a session whose click rejects.

## The four defects this phase found by running

None of these were introduced here. All four were shipped, green, and only
visible once a real plan crossed a real wire into a real browser.

**A credential field read as a missing required field.** ADR-0043 routed
password fields to `plan.credentials`, and `validatePlan` looks at
`instructions` and `uploads`. So every password box on every gated portal was a
`required` violation, `nextStep` answered `fix_content`, and the student was
asked to fix content they could not fix — forever, because nothing they typed
would satisfy it. The run could never reach `execute`.

**A stored provenance came back with a string in its `Date`.** The value half of
a profile entry goes through `encodeValue`/`decodeValue`, which tag a `Date`.
The provenance half did not, and it holds `confirmedAt`. Every profile read back
from the database therefore carried a provenance whose timestamp was a string
claiming to be a `Date`: nothing at compile time, a `TypeError` at runtime the
moment anyone did arithmetic on it. It surfaced here because transporting a plan
serialises the provenance a second time. It was wrong everywhere else too.

**The account's email was left as a placeholder for `execute` work.** The first
version derived the work item's `email` from the `create_account` step, which
does not exist by then, and passed `""`. The wire parser refused the item, the
route's 500 was read by the client as "nothing to do", and the run sat in
`filling` with work nobody could take — an idle-looking system with a student
waiting. It now comes from the account, which `accountCreated` built from the
same confirmed profile.

**The lease table's `kind` CHECK still had one member.** `WORK_KINDS` gained
`execute` and the database's copy of that closed set did not, so the insert
failed and the claim 500'd — the same symptom, from a different cause, and found
the same way. Migration `0006_execute_work` widens it; 0005 is untouched,
because a change to an applied migration does nothing everywhere it already ran.

## What the journey could not have caught on its own

R5 again, and it is worth naming twice. An end-to-end journey walks one path: a
portal that answers, a session that holds, a click that lands. Every outcome the
code decides for a path the journey does not walk is unexercised, and a
regression aimed at it passes silently.

The pattern across P6, P7 and P8 is now consistent enough to state as a rule:
**the journey proves the pieces fit; the variants belong in tests that can vary
them.** Three phases running, the regression that went undetected was always the
one about a failure mode, and the fix was always a focused test rather than a
bigger journey.

## What is deliberately not tested, and stated instead

**Multi-page applications beyond the first page.** A unit of fill work is one
page, and nothing records which pages are done — so a portal with two
application pages gets its first one filled and then has nothing more offered.
The gated blueprint has one page, so the journey completes honestly. Making page
progress durable is a phase of its own, and `formPageFor`'s own comment says so
rather than the code pretending otherwise.
