# ADR-0054 — The intent is durable before the action, not after it

**Status:** **Accepted** — Vahid, 2026-09-02 ·
**Amends:** [ADR-0045 §4](./0045-the-runner-pulls-leased-work.md), which claimed a property the
implementation did not have ·
**Depends on:** [ADR-0008](./0008-recovery-first-escalation-and-the-learning-loop.md) (the intent
ledger and the uncertainty window), [ADR-0047](./0047-page-progress-lives-in-the-intent-ledger.md)
(what each verdict means), [ADR-0048](./0048-a-specialist-resolution-completes-an-intent.md) ·
**Occasioned by:** [P16](../p16-regression-audit.md) §4

## Context — found while writing P16's crash test, measured on `318db36`

`RunDriver.reportWork` wrote the `workflow_action_intents` row **when the report arrived**, and
argued for it:

> *"The intent is written on REPORT rather than on claim … an intent written at claim time says
> 'this was attempted' about work a runner might never have started, which reads as more uncertainty
> than there is."*

The consequence was visible in P16's crash test, which asserted it outright: at the instant a runner
was inside a real portal action, **the durable record said nothing was attempted.** A process killed
there — SIGKILL, OOM, a rolling deploy, a lost node — left no trace. The lease lapsed, the run
returned to the pool, and the next runner was handed it as new work. On `create_account` that is a
second account, on a real university portal, in a student's name.

Three facts made this a decision rather than a bug report.

**1 · ADR-0045 §4 already claimed the opposite.**

> *"An outcome of `uncertain` is a first-class member of that set rather than an error, because a
> process can always die between an external success and our recording of it — which is precisely
> what `workflow_action_intents` was built to make detectable (ADR-0008)."*

It was detectable when the runner survived to say `uncertain`. It was not detectable when the runner
did not survive — which is the case that sentence describes.

**2 · The store already refused the ordering the driver used.** `completeIntent` has always thrown
on a completion with no intent, calling it *"the ordering the whole mechanism depends on"*.
`reportWork` satisfied that by recording the intent immediately before completing it — technically
true, and empty.

**3 · The safe ordering was already implemented and had no production caller.** `performOnce`
(`packages/orchestrator/src/consequential.ts:203`):

> *"The intent is durable BEFORE the action. If the process dies between these two lines, the next
> resume finds an intent with no completion and takes the uncertain path — which is correct, because
> the action may well have reached the portal."*

Two implementations of one safety rule, disagreeing about the ordering, and the one with the safe
ordering was the one nothing called. A seventh entry for
[ADR-0052](./0052-the-system-acts-when-nobody-is-watching.md)'s table of built-and-unreached
machinery, and the one that mattered most.

### Why P16 made it urgent

Before P16 `runOneTurn` had no loop, so "a runner process dies mid-action" was something that could
happen to a script somebody ran. The supervisor made the runner a **long-lived process that is
restarted on every deploy.** The window stopped being hypothetical. Nothing is deployed yet, which
is why this was recorded rather than hot-fixed — and why it had to be closed before anything is.

## The decision

**The intent is recorded at CLAIM time, inside `claimWork`, after the lease is taken and before the
work is returned to the runner.** `reportWork` no longer records; it only completes.

Vahid, 2026-09-02: *"Write the durable workflow action intent at claim time, before any consequential
portal action can begin, so that a runner crash leaves durable evidence of the unfinished action and
the existing safety mechanisms can stop the run rather than risk repeating it."*

### §1 · The ledger's meaning is unchanged

One row per `(run, action, target)`. That is its primary key, and it is what
`interventions.idempotency_key` pairs with — which is what makes raising a second intervention for
one stuck action *impossible* rather than merely unlikely (ADR-0048). A second attempt therefore
must not become a second row.

What changed is **when the row appears**, and so what an unfinished row means:

| | before P17 | after |
|---|---|---|
| row exists, no outcome | a runner reported `uncertain` | a runner reported `uncertain` **or a runner is inside the action right now, or died in it** |
| no row | never attempted **or attempted and the runner died** | never attempted |

The second column is the whole point: "no row" now means what a reader always assumed it meant.

### §2 · After the lease, not before it

The lease is what makes "one attempt at a time" true. An intent written *before* the lease could be
written for work this runner then loses the race for — an unfinished action nobody ever attempted,
and a specialist called out for it.

**No transaction spans the two, and none is needed.** The only window that can hurt anybody is *work
handed out with no durable intent*, and `claimWork` returns after the write, so it does not exist.
The other order of failure — a lease taken and the intent write lost — hands out nothing, lapses on
its own, and is retried. A cross-store transaction would buy tidiness at the cost of threading a
client through two stores that are deliberately separate.

### §3 · A cleanly failed attempt is re-opened, and only a cleanly failed one

ADR-0047 already decided what each verdict means, and it is unchanged:

| verdict | meaning | what happens |
|---|---|---|
| `already_done` + `succeeded` | it happened | skipped |
| `already_done` + `failed_cleanly` | nothing happened out there | **offered again** |
| unfinished (`verify_first` / `escalate`) | nobody knows | the run stops for a person |

Writing at claim time makes the middle row need something new: the retry must not collide with the
primary key, and the row must stop describing the attempt before it. `WorkflowRunStore.reopenIntent`
clears the outcome and moves `started_at`, **guarded in SQL to `outcome = 'failed_cleanly'`**. A
`succeeded` row can never be re-opened — that is the one mistake that would create the duplicate
account this ADR exists to prevent — and an unfinished row can never be re-opened either, because
that is the uncertainty window and it belongs to a specialist.

**This also fixes a defect that predates the phase.** `reportWork` used to skip recording when a row
existed and then call `completeIntent` anyway, so a run that failed cleanly and then succeeded threw:
the account existed on the portal and the ledger said `failed_cleanly` for ever. No test drove a full
second attempt, so nothing caught it.

### §4 · The cost, stated

**A runner that dies between the claim and its first portal request raises an intervention for an
action that never happened.** A specialist looks, sees no account, and records that it did not
happen — `resolveIntervention` with `didHappen: false` is exactly that path and already exists.

That is the trade this decision makes, and the asymmetry is not close: a false positive costs a
person five minutes looking at a portal, and the alternative creates a second account in a student's
name at a university. It is also the same trade the system already makes everywhere else — the
uncertainty window has always preferred stopping to guessing.

**A lease lapsing no longer means "retry".** For consequential work it now means "a runner is gone
and a person must look". Nothing else relied on the old reading.

### §5 · No new guard

`#unfinishedAction` → `#pause` → an intervention and a message to the student is the P10/ADR-0048
path, unchanged. All this decision does is make it reachable by a crash. Adding a second mechanism
to notice crashed runners would be the parallel source of truth ADR-0041 forbids.

## What this does NOT do

- **No verifier.** `performOnce`'s `verify_first` branch still wants something that opens the portal
  and asks whether the account exists. That is a real capability and a phase of its own; until it
  exists, a person is the verifier.
- **No attempt history.** The ledger answers *did this action happen to this target?*, not *how many
  times was it tried?*. A counter nobody reads would be the writer-with-no-reader mirror of the
  problem this ADR is fixing.
- **`performOnce` still has no production caller.** It remains the reference implementation of this
  ordering, and `claimWork` now performs it against the two stores it actually has. Whether the
  driver should call it directly is a refactor, not a safety question.

---

*Accepted 2026-09-02. P17 implements it.*
