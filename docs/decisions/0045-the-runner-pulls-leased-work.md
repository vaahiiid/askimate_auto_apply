# ADR-0045 — The Automation Runner pulls leased work; nothing calls into it

**Status:** Accepted · **Date:** 2026-08-31 · **Supersedes:** nothing ·
**Related:** ADR-0008, ADR-0014, ADR-0020, ADR-0037, ADR-0040, ADR-0041, ADR-0042

## Context

Until now the Automation Runner had no way to be told to do anything. It is a
library and two argv-driven CLIs: `pnpm run discover <target>` and
`pnpm run inspect <target>`. There is no process that stays up, no inbound
surface, and exactly one outbound HTTP call in the whole app — `fillSecret`,
which asks the Secure Plane's fill agent to type a password.

Meanwhile the Conversation Service's Run Driver reaches `nextStep` answers that
require a browser — `create_account` and `execute` — and does nothing with them.
The only code in the repository that has ever executed a fill plan is
`scripts/end-to-end.ts`, which holds the run state in a local variable, the
profile in memory, and never crosses a service boundary. It is a demonstration
standing in for a component that does not exist.

So the question is: **how does the runner learn there is work?**

## The constraint that decides it

ADR-0037's topology table, for the runner:

> **runner** — none [public exposure] — Private only. No inbound from the
> internet, plus a CDP endpoint reachable by the fill agent **alone**.

That word is load-bearing. The runner's only inbound port is the Chrome DevTools
Protocol endpoint, and exactly one peer may reach it. Giving the runner an HTTP
control API — so the Application Plane could push work to it — would add a second
inbound surface to the process that loads pages we do not control, runs
blueprint-driven logic against sites we cannot audit, and is the most likely
thing in this system to be compromised.

That is not a decision this ADR gets to make freshly. It is already decided, and
the shape it leaves is **pull**.

## Decision

**The runner claims work from the Application Plane over the internal API, and
reports the outcome back over the same API. Nothing ever calls the runner.**

### 1 · A claim is a lease, and the lease is a database guarantee

`work_leases.run_id` is the PRIMARY KEY. One run has at most one lease, because
the table cannot hold two — not because a handler remembers to check. Claiming
an unleased run is an INSERT; reclaiming an expired one is an UPDATE whose
`WHERE` includes `expires_at <= now`, so two runners racing to take over the same
abandoned run resolve the way two writers racing for an ordinal do: one wins and
the other's statement matches no row.

Leases expire rather than being released by a heartbeat. A runner that dies
mid-task cannot tell anyone, and a lease that outlived its holder forever would
strand the student's application behind a process that no longer exists.

### 2 · The run's own position says what work exists. The lease says who has it

There is no work queue. A queue would be a second opinion about what a run should
do next, and ADR-0041 exists because this repository has already had two models
of the same thing come apart.

So the claim path narrows candidates by the durable checkpoint's phase and then
asks the orchestrator, exactly as every other decision does. `browserWorkFor`
lives in `packages/orchestrator` beside `requiresSecureRequest` for the same
reason: *which steps need a browser* is a property of the step vocabulary, and a
list of step kinds kept in the driver or in a route would go silently out of date
the first time another step gained one.

A lease is deleted when the work is reported. Nothing marks a run as "done with
work" — its checkpoint moves, `nextStep` answers something else, and it stops
being a candidate. One authority, not two.

### 3 · What crosses to the runner, and what does not

A claimed unit of work carries identifiers, closed-set words, a portal host, the
student's own email address, and — for account creation — the **opaque secret
handle**. ADR-0026 already settles that a handle is safe to hand about: it
contains no plaintext, no length and nothing derived from the secret, and the
runner holds no vault and no certificate that could resolve it (ADR-0042,
enforced by `scripts/check-boundaries.ts`). It hands the handle to the fill
agent, which resolves it inside the Secure Plane.

There is no field on the wire form that could carry a password, and
`packages/contracts` — which has no dependencies at all (ADR-0040) — is where the
form is declared, so the constraint is checkable without reading a route.

### 4 · Reporting is not permission to have done more

A report says how a unit of work ended, from a closed set. It cannot say that a
submission happened, because the runner has no capability to submit (ADR-0014)
and nothing in this mechanism grants one. `succeeded` on account creation means
an account exists; it does not advance the run past anything the orchestrator
would not have advanced it past anyway.

An outcome of `uncertain` is a first-class member of that set rather than an
error, because a process can always die between an external success and our
recording of it — which is precisely what `workflow_action_intents` was built to
make detectable (ADR-0008).

## Consequences

**Good.** The runner keeps its single inbound port and its single outbound
dependency shape. Work handoff reuses the run's existing durable position rather
than introducing a queue to disagree with it. A crashed runner's work returns to
the pool on its own. The intake surface is service-authenticated by the same
injected predicate every other internal route uses, which denies when absent.

**The cost.** Latency is a poll interval rather than a push. That is the right
trade for a system where the unit of work is "fill in a university application"
and the student is not watching a progress bar for milliseconds.

**Not decided here.** How the `execute` step's fill plan reaches the runner. Its
`FillInstruction`s carry `ConfirmedValue<string>`, a branded type that may only
be minted inside `packages/profile` (ADR-0004, enforced package-scoped), and the
runner may not depend on that package. Serialising a plan and rebuilding it in
the runner would mean minting confirmed values outside the one place allowed to.
This ADR covers the mechanism and the `create_account` work it carries today;
`execute` needs its own decision, and adding a member to `WORK_KINDS` is a
reviewable change to a one-member list.
