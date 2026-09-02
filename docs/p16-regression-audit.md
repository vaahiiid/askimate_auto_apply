# P16 — the deliberate regressions, and the ordering this phase could not settle

**Date:** 2026-09-02 · **Governs:** the runner supervisor
([ADR-0052 §12](./decisions/0052-the-system-acts-when-nobody-is-watching.md),
[ADR-0045](./decisions/0045-the-runner-pulls-leased-work.md))

Twelve mutations. Each was applied, then the file was re-read **from disk** and
the new text asserted present before any test ran. Restores are from a file
copy, never `git checkout`.

Nine were caught on the first attempt. **Three survived**, and they are the
part of this report worth reading: two properties the code argued for in a
comment and nothing checked, and one test of mine that was refusing a report
for the wrong reason. All three now have tests, and each was re-run against the
new test to prove it bites.

The phase also found something the mutations did not: an ordering in the
production write path that contradicts an accepted ADR and has a correct,
tested, uncalled implementation sitting beside it. That is §4, and it is
Vahid's decision rather than mine.

| # | The mutation | Caught by |
|---|---|---|
| **R1** | Turns are scheduled without waiting for the one in flight | `polls again on its own`, `comes back PROMPTLY after work` — see §0 |
| **R2** | The loop dies of one bad response from the intake | `survives an intake that throws, rather than dying quietly` |
| **R3** | `stop` abandons a browser mid-action | `WAITS for a browser that is mid-action` |
| **R4** | The adaptive interval is collapsed to "always prompt" | `polls again on its own`, `comes back PROMPTLY after work` |
| **R5** | A refused report is counted as work | **survived** — see §1 |
| **R5b** | as above, against the new test | `does NOT hurry back after a report the plane REFUSED` |
| **R6** | `scheduleNext` ignores the stop flag | **survived** — see §2 |
| **R6b** | as above, against the new test | `schedules nothing further when the turn it waited for FINISHES` |
| **R7** | A stopped case is offered to runners like any other | `is offered nothing the moment the student stops the case` |
| **R8** | A live lease can be taken over anyway | `hands it to exactly ONE of them, however hard both poll` |
| **R9** | A report is accepted whatever lease id it names | **survived my new test** — see §3 |
| **R9b** | as above, against the repaired test | `lets a second runner recover the work once the lease has LAPSED` |
| **R10** | An intent is never completed | 4 of the 5 integration tests |

## 0 · R1 — caught, but not by the test that exists for it

R1 made `scheduleNext` fire the next turn without waiting for the current one,
which is precisely the property `never runs two turns at once, however slow one
is` was written to defend. That test **failed by timing out**, and a timeout is
not evidence of detection — it is evidence that something hung.

What actually caught R1 were the two interval tests, by assertion: `expected 6
to be 2` and `expected 3 to be 2`. So the property is detected, but by tests
aimed at something else, and the test aimed at it cannot report cleanly on a
loop that has stopped being serial. Recorded rather than fixed: making that
test fail by assertion under R1 would mean giving it a bounded wait for a
condition that, unmutated, never occurs.

R1 was also run against the integration suite, and the honest result is that it
**never finished**. Each scheduled callback schedules another before its turn
and one after it, so the loop doubles every tick and buries a real PostgreSQL
under claims. The run was killed after six minutes. That is a real consequence
worth naming — a runner that lost its serialisation does not degrade, it
detonates — but it is not a test result and is not counted as one.

## 1 · R5 — the loop argued a property nothing checked

`runOneTurn` answers `report_refused` when the plane will not take a report:
the lease lapsed while this runner was working and somebody else now owns the
run. The loop treats that as **idle** rather than as work, and its comment
says why — *"the pool has moved on and hurrying back would just race the runner
that now owns it"*.

R5 collapsed `result.kind === "worked"` into `result.kind !== "idle"`, so a
refused report would send the runner straight back at the busy interval. **All
twelve tests passed.** The distinction existed only in prose.

`does NOT hurry back after a report the plane REFUSED` now asserts it: an
intake that accepts nothing, a turn that reports and is refused, and a clock
that has to reach the idle interval before the next claim. R5b fails it
(`expected 2 to be 1`).

## 2 · R6 — the stop flag defends the case no test reached

`scheduleNext` opens with `if (stopped) return;`. R6 deleted it. **All
thirteen tests passed** — including `schedules nothing further once stopped`,
which is named for exactly this.

The reason is worth stating because it is the general shape of a test that
proves less than it looks: `stop()` does two things, and that test only ever
exercised one of them. It stops an **idle** supervisor, so `clearTimeout`
cancels the pending timer and the flag is never consulted. The flag matters
only when `stop()` is called while a turn is **in flight** — there is no
pending timer to clear then, and the turn's own completion is what asks for the
next one.

That is not an exotic case. It is what a rolling deploy does to every runner
that happens to be inside a portal action: `stop`, wait for the browser, exit.
Without the flag the process finishes its turn and then polls for ever.

`schedules nothing further when the turn it waited for FINISHES` stops a busy
supervisor, releases it, and then advances five seconds of clock. R6b fails it:
**51 claims where there should be 1.**

## 3 · R9 — my own test was refusing a report for the wrong reason

The integration suite's crash test has a dead runner wake up and report against
a lease it no longer holds. R9 deleted the lease-id comparison in `reportWork`
— `held.leaseId !== input.report.leaseId` — and **the test still passed**.

Because in the version I first wrote, the heir had already finished. Its lease
had been released, so `held` was `null` and the revenant was refused by the
`held === null` branch. The test proved that *a report against a run nobody is
working on* is refused, and said nothing about *a report against a run somebody
else is in the middle of* — which is the case the comparison exists for and the
only one where the wrong answer costs anything.

The heir is now held inside its turn while the corpse wakes up, so the
comparison is the only thing standing between them. R9b fails on the assertion
`and nothing was written about work the heir has not finished`.

**And it was already covered elsewhere.** R9 run against
`apps/conversation-service` fails two pre-existing tests, including `REFUSES a
report from a runner that no longer holds the lease`. So the property was never
unprotected — my new test was simply not one of the things protecting it, while
appearing to be. That is the over-determined-property finding of P13, P14 and
P15 arriving a fourth time, and it is the reason a mutation that survives has
to be followed to *why* rather than counted as a near miss.

## 4 · What this phase found and did not fix: the intent is written too late

Not a mutation. Found while writing the crash test, and it is the more
important half of this document.

`RunDriver.reportWork` writes the `workflow_action_intents` row **when the
report arrives**, and argues for it:

> *"The intent is written on REPORT rather than on claim … an intent written at
> claim time says 'this was attempted' about work a runner might never have
> started, which reads as more uncertainty than there is."*

The consequence is visible in the crash test, which asserts it outright: at the
instant a runner is inside a real portal action, **the durable record says
nothing was attempted.** A process killed there — SIGKILL, OOM, a rolling
deploy, a lost node — leaves no trace. The lease lapses, the run returns to the
pool, and the next runner is handed it as new work. On `create_account` that is
a second account, on a real university portal, in a student's name.

Two things make this a decision rather than a bug report:

**ADR-0045 §4 already claims the opposite.** *"A process can always die between
an external success and our recording of it — which is precisely what
`workflow_action_intents` was built to make detectable (ADR-0008)."* It is
detectable when the runner survives to say `uncertain`. It is not detectable
when the runner does not survive, which is the case that sentence describes.

**The other ordering is already implemented, tested, and has no production
caller.** `performOnce` in `packages/orchestrator/src/consequential.ts:203`:

> *"The intent is durable BEFORE the action. If the process dies between these
> two lines, the next resume finds an intent with no completion and takes the
> uncertain path — which is correct, because the action may well have reached
> the portal."*

Two implementations of one safety rule, disagreeing about the ordering, and the
one with the safe ordering is the one nothing calls. It is a seventh entry for
ADR-0052's table of built-and-unreached machinery, and the one that matters
most.

### Why P16 makes it live rather than merely true

Before this phase `runOneTurn` had no loop, so "a runner process dies mid-action"
was a thing that could happen to a script somebody ran. The supervisor makes the
runner a **long-lived process that will be restarted on every deploy**. The
window stops being hypothetical.

It is not yet dangerous *in this repository*: there is still no Dockerfile, no
IaC and no service entry point, so nothing is deployed and no student has an
account at risk. That is the reason this phase ships with the gap recorded
rather than stopping — and the reason it must not be deployed with the gap open.

### The options, and my recommendation

- **A — write the intent at claim time.** `claimWork` records
  `{action, target, startedAt}` with no completion, in the same statement that
  takes the lease. A crash anywhere after that leaves an unfinished intent, and
  the existing `#unfinishedAction` check stops the run and raises an
  intervention — the machinery is already there and already tested. Cost: a
  runner that dies between the claim and its first portal request raises an
  intervention for an action that never happened. A specialist looks, sees an
  account that does not exist, and says so.
- **B — leave it, and write down that a crashed runner may duplicate.** Cheapest,
  and honest only if it is documented as an accepted risk in ADR-0045.
- **C — verification first.** `performOnce`'s `verify_first` branch wants a
  verifier: something that opens the portal and asks whether the account exists.
  That is a real capability and a phase of its own.

**I recommend A.** The asymmetry is not close: option A's worst case costs a
specialist five minutes looking at a portal, and today's worst case creates a
second account in a student's name at a university — the exact harm ADR-0008
and the intent ledger were built to prevent. The argument in the current
comment is sound about *reading* — an intent at claim time does overstate what
was attempted — but that is a cost in how a record reads, weighed against a
consequence in the world.

It also needs a decision rather than a patch, because it changes what a row in
`workflow_action_intents` means, and ADR-0045 §4 states the property it would
be making true.

---

*Twelve mutations, nine caught first time, three survivors each now tested.
The finding in §4 is open and belongs to Vahid.*
