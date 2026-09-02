# ADR-0052 — The system acts when nobody is watching

**Status:** **Proposed** — drafted 2026-09-02 on four decisions Vahid settled before drafting.
Not to be acted on until approved. ·
**Amends:** [ADR-0037](./0037-service-topology-and-deployment.md) (the deployable table) ·
**Completes:** [ADR-0008](./0008-recovery-first-escalation-and-the-learning-loop.md) part 1 (the alert), and
[ADR-0034](./0034-the-vault-is-ephemeral.md) (the expiry it describes) ·
**Related:** ADR-0031, ADR-0032, ADR-0041, ADR-0045, ADR-0047, ADR-0048, ADR-0049, ADR-0050, ADR-0051

## Context — measured on `99416c6`

**Nothing in this repository runs when nobody is making a request.**

Every capability that must act on its own is built, tested, and has no production caller. This is
the reader-with-no-writer shape that `HandoffRequired` had before P12 and `AuthorisationVoided` had
before P13 — but at the level of the execution model rather than one mechanism.

| Machinery | State | Production caller |
|---|---|---|
| `LifecycleOutbox.publish` — `apps/secure-service/src/lifecycle-outbox.ts:171` | complete: `FOR UPDATE SKIP LOCKED`, attempt counting, capped backoff, retryable vs permanent codes | **none** — tests only |
| `RunDriver.advance` — `apps/conversation-service/src/run-driver.ts:791` | complete, 20+ tests | **none** — no route reaches it |
| `runOneTurn` — `apps/browser-runner/src/work-intake.ts:144` | complete | **none** — nothing loops it |
| `settle(…, "secret_expired")` — `apps/secure-service/src/requests.ts:253` | complete | **none** — only `secret_cancelled` and `secret_consumed` are ever written |
| `interventions.announced_at` — *"NULL means they have not been, and the next pass will tell them"* | column, store method, guard | **there is no next pass** |
| `secret_requests_expiring` — a partial index, commented *"expiry sweeps"* | created in migration 0001 | **there is no sweep** |

Three failures follow directly, and each is a real defect in a deployed system.

**1 · A student's composer blocks forever.** The secure service enqueues the lifecycle transition
inside the transaction that changed the lifecycle. Nothing drains the outbox. The conversation log
never learns the step settled, so its own guard keeps refusing messages. `lifecycle-outbox.ts`
predicts this exactly: *"An undelivered row means the conversation log has not heard that the step
settled … The failure mode is a composer that stays blocked."* The two-origin browser test passes
because **the test calls `publish` itself** (`two-origin.test.ts:196`).

**2 · A secure request that times out never settles.** ADR-0034 states, as an accepted consequence:
*"the request moves to `secret_expired`, the student is told in the conversation, and the model asks
again."* No code path writes `secret_expired`. Expiry is enforced at read time — `expires_at > $now`
in every lookup — which is safe, and is why this has never produced a security defect. But safety at
read time is not a transition: the request stays `secret_requested` for ever, no transition is
enqueued, the conversation log never hears, and the student is told nothing. An Accepted ADR
describes behaviour the system cannot perform.

**3 · A case only moves while a browser is posting.** `#decide` is reached from `start` and
`advance` alone (`run-driver.ts:773`, `:825`); `advance` has no route, so the sole production
trigger is the client re-POSTing `/v1/conversations/{id}/runs`, which resumes rather than restarts.
That is how `journey.test.ts:995` advances. Close the tab after being asked to verify an email
address and nothing further happens: no handoff raised, no announcement, no outgrown authorisation
voided, no `MAX_ATTEMPTS_PER_FIELD` escalation, no conclusion. The student's browser is the
scheduler.

This also subsumes the standing roadmap item. `docs/roadmap-and-priorities.md` says the alerting
transport is *"genuinely next"* now the substrate exists, and ADR-0008 requires the specialist be
*"alerted as fast as possible"*. There is no alert. But an alerter is one **consumer** of a
capability that does not exist; building it alone would leave the outbox still undrained.

## Decision

### §1 · A fifth deployable: the Background Worker

**Settled by Vahid, 2026-09-02.** A dedicated, independent background worker, deployed on its own.
Explicitly **not** a `--worker` flag on the Conversation Service.

The reason to state, because the cheaper option is genuinely tempting: a mode of an existing service
shares that service's task role, its scaling policy, its memory and its blast radius. The
Conversation Service is the one plane that faces the public internet behind the ALB. A process that
autonomously advances every case in the system — opening secure steps, creating accounts on real
university portals — should not be reachable, even in principle, from the same request path that
serves a browser. Separate task, separate role, no inbound listener at all.

ADR-0037's table is amended from four deployables to five. The amendment is in §11.

### §2 · What wakes it

**A bounded in-process interval loop, on an injected clock, per job kind.** Not cron, not ECS
Scheduled Tasks, not `LISTEN`/`NOTIFY`.

- **Not ECS Scheduled Tasks**, because the finest granularity is one minute and each firing pays a
  cold start. The outbox is holding a student's composer shut; a minute of latency on every
  transition is a minute of a person looking at a frozen page.
- **Not `LISTEN`/`NOTIFY`**, because a notification is not durable. A worker that is restarting when
  the notify fires never hears it, and the row waits until something else happens to wake it. The
  repository uses no `LISTEN` anywhere today and should not start with the mechanism whose failure
  mode is silence. A poll that finds nothing is cheap; a notification that is missed is invisible.
- **An interval loop**, then, with the interval per job kind and injected — the same shape the SSE
  route already uses for its drain and heartbeat (`routes.ts:708`, `:718`). Every read of the clock
  is injected, as everywhere else in this repository, so a test drives the worker by advancing time
  rather than by sleeping.

`NOTIFY` may later be added as an **accelerator** on top of the poll — never as the trigger. That is
a P15+ optimisation and is not in scope.

### §3 · Worker leases: the claiming mechanism, and why it is not a second source of truth

**Settled by Vahid, 2026-09-02.** `work_leases` is preserved for run execution work and is not
reused for background responsibilities. A distinct mechanism is defined here with the same safety
properties: leasing, idempotency, retry with backoff, and crash recovery.

**Why `work_leases` cannot be reused.** Migration `0005_work_leases.sql` says what that table is,
in its own header:

> *"It is not a queue. There is no `pending` row, no `status`, no ordering, and nothing that says
> what work EXISTS … a row means exactly one thing: this runner is holding this run right now,
> until this instant."*

Its primary key is `run_id`. That is the property it exists for — a run cannot be worked twice at
once — and it is a database guarantee rather than a check somebody remembered. A background job is
a different shape: "drain the outbox" is not about a run, and giving it a synthetic `run_id` to fit
the key would destroy the one meaning that key has. Reuse here would not be economy; it would be
overloading a primary key so that it no longer states a true thing.

**What is introduced instead.** One table, `worker_leases`, in the same shape and for the same
reason, keyed by **job kind** rather than by run:

```
job_kind    text  PRIMARY KEY   -- 'drain_outbox' | 'sweep_expiries' | 'advance_runs' | …
lease_id    text  NOT NULL      -- regenerated on every claim, including a takeover
holder      text  NOT NULL      -- which worker instance; for an operator, never for authorisation
claimed_at  timestamptz NOT NULL
expires_at  timestamptz NOT NULL CHECK (expires_at > claimed_at)
```

Claimed with the same single-statement `ON CONFLICT … DO UPDATE … WHERE expires_at <= $now` that
`WorkLeaseStore.claim` uses (`work-store.ts:127`), so two workers racing produce one winner by the
database's decision rather than by an application check. Renewed while a job runs; a worker that
dies stops renewing and the lease lapses, which is the whole of crash recovery (§10).

**Why this is not a second source of truth.** The distinction that matters, and the one ADR-0041 and
ADR-0047 both turn on:

> A `worker_leases` row holds **no business fact**. It answers only *"which worker is running which
> job kind right now, until when"*. Delete the entire table and nothing about any case, run,
> request, intervention or student is lost — the next worker rediscovers exactly the same work.

Every job **derives** its work from the record that already owns that fact:

| Job | Where the work is derived from | Owner of the fact |
|---|---|---|
| `drain_outbox` | `lifecycle_outbox WHERE delivered_at IS NULL AND next_attempt_at <= now` | the outbox row, which the transition wrote in its own transaction |
| `sweep_expiries` | `secret_requests WHERE lifecycle = 'secret_requested' AND expires_at <= now` — the `secret_requests_expiring` index exists for this | `secret_requests.lifecycle` |
| `advance_runs` | `workflow_runs` by `status` and `checkpoint ->> 'phase'`, excluding anything currently leased — the same derivation `WorkLeaseStore.candidates` already makes (`work-store.ts:90`) | the run's durable checkpoint and the case log |
| `announce_interventions` | `interventions WHERE resolved_at IS NULL AND announced_at IS NULL` — the `interventions_open_idx` index exists for this | the `interventions` row |

There is no `worker_jobs` table with a `pending` status, and there must never be one. A queue of
business work would be a second opinion about what the system should do next, and the answer already
exists in four places that cannot disagree with themselves.

### §4 · Job — draining the lifecycle outbox

`LifecycleOutbox.publish` is called on an interval. **No change to its semantics**, which are
already correct and tested:

- `FOR UPDATE SKIP LOCKED`, so several worker instances do not deliver the same row;
- `backoffSeconds(attempts) = min(2^min(attempts,6), 60)` — capped deliberately, because *"a
  transition that has failed twelve times is not going to succeed on the thirteenth because it
  waited an hour, and the composer it is holding shut belongs to a student who is waiting"*;
- **retryable** (`unreachable`, `server_error`) reschedules; **permanent** (`refused`,
  `unknown_conversation`, `malformed`) records `last_error` and leaves the row **undelivered on
  purpose** — giving up must not look like success, because "delivered" is what tells the guard the
  step is settled.

What P14 adds is the caller and one operational property the current design lacks: **a row that is
neither delivered nor retryable is invisible**. A permanently-failed transition holds a student's
composer shut for ever with nobody informed. P14 raises such a row as an intervention through the
existing `interventions` mechanism — the same durable, pull-discoverable channel as every other
thing a person must look at (§7). No new escalation concept.

### §5 · Job — expiring secure requests, and writing `secret_expired`

For each `secret_requests` row still `secret_requested` (or `secret_received`) whose `expires_at`
has passed, in **one transaction**:

1. `settle(client, requestId, "secret_expired", now)` — the function exists and has never been
   called with this argument;
2. `outbox.enqueue(client, { requestId, conversationId, transition: { kind: "secret_expired" }, now })`
   — the same transaction, for the same reason every other enqueue is: a crash between the two would
   lose the publication while keeping the transition.

The outbox drain then delivers `secret_expired` to the conversation log, the guard reopens the
composer, and the student is told. That is exactly the sentence ADR-0034 already promises, made
true.

**Read-time expiry is not removed.** Every lookup keeps its `expires_at > $now` clause. The sweep is
a transition, not a security control: if the sweeper is down, nothing becomes usable that was not
usable before — the request is simply not yet *announced* as expired. Fail-closed by construction,
and the sweeper cannot become load-bearing for safety.

The vault is untouched. Its TTL is the cache's own (ADR-0034) and nothing here reaches it — the
worker in this plane holds no vault, no store and no resolver, and the boundary check will be
extended to say so.

### §6 · Job — autonomous `RunDriver.advance`

**Settled by Vahid, 2026-09-02.** The worker becomes the authoritative owner of autonomous
progression. Closing the browser must never prevent the system from progressing.

The worker selects runs whose status is `running` or `suspended`, takes the run's lease through the
**existing** `work_leases` mechanism (this *is* work about a run, so the existing key means the
right thing), calls `RunDriver.advance`, and releases.

Three properties, each already true of `advance` and none of them new:

- **Idempotent.** `advance` resumes and advances by one decision; `resumeRun` reconciles the
  checkpoint against the event log and the log wins every disagreement. Running it twice costs a
  re-derivation and never costs correctness.
- **Refusal is not an error.** `#decideOnce` returns and leaves the case where it is when `decide`
  refuses. A worker pass over a case that cannot move writes nothing.
- **Announcements are already once-only.** `#raiseHandoff` appends the student's message only when
  the raise *created* the handoff — `decide` answers with no events on a token already open. That is
  what makes a repeated pass silent, and it was written for exactly this caller.

`RunDriver.advance`'s doc comment currently reads *"This is what a restarted process calls"*. No such
process exists. P14 makes the comment true rather than deleting it.

**Not every run, every tick.** The candidate query is ordered by `updated_at ASC` and limited, as
`candidates` already is, so a large backlog is worked oldest-first rather than all at once.

### §7 · Job — intervention discoverability

**Settled by Vahid, 2026-09-02.** No email, no SMS, no external vendor in P14. Open interventions
become durably discoverable through a worker-driven pull mechanism; notification transports become
later consumers of the same substrate.

What already exists: the `interventions` table with `interventions_open_idx ON (raised_at) WHERE
resolved_at IS NULL`, `GET /internal/v1/interventions`, and `pnpm run interventions`. What is
missing is that **nothing keeps it truthful without a poller**: `announced_at` is set inside
`#pause`, which is reached only from `claimWork`, which only runs when a runner polls — and no
runner process loops.

P14 adds, on the worker:

- **announcement**, so a student whose run paused is told once even if no runner ever polls, using
  the existing `announcedAt` guard so a crash between raising and announcing cannot leave a paused
  run whose student never hears;
- **staleness as a first-class read** — an open intervention's age is derivable from `raised_at`, and
  the worker records nothing new to express it.

Deliberately **not** added: a `notified_at` column, a delivery table, a channel abstraction. Those
belong to whatever transport is chosen later, and adding them now would be designing an interface
for a consumer that does not exist. ADR-0008's *"alerted as fast as possible"* is only partly
honoured by P14 — the queue becomes reliable and current; the push does not exist. Stated plainly
rather than described as complete.

### §8 · Client-triggered actions and worker-driven progression

**Settled by Vahid, 2026-09-02.** The client must no longer be *required* to advance a case.

The rule, and it is the one that keeps this from becoming two drivers of one spine:

> **The worker is the only thing that must run. A client request may cause an advance to happen
> sooner; it may never be the reason one happens at all.**

Concretely:

| Path | Before P14 | After P14 |
|---|---|---|
| `POST /v1/conversations/{id}/runs` | creates the case and run, then advances — **and is the only advance in production** | creates the case and run, then advances — as a **latency optimisation**, so a student who is present does not wait for the next tick |
| `POST …/messages` (`answerStudent`) | records the answer; puts a reading to the student | unchanged — records a student action |
| `POST …/runs/{id}/decision` | records the decision through the domain | unchanged — records a student action |
| `POST /internal/v1/work/*` | runner claims and reports | unchanged |
| the worker | — | advances every eligible run, on its own, regardless of who is connected |

`POST /runs` is kept advancing rather than reduced to a create, because removing it would make a
present student *slower* than an absent one — a worse product for no architectural gain. The two
cannot race: both go through `work_leases`, and the loser of the lease does nothing. Both are
idempotent. Correctness does not depend on which wins.

**The property P14 must prove by test:** a run advances to completion with **no client request after
the first**, driven only by the worker's clock. That is the assertion that makes decision 3 real
rather than asserted, and it is the one the journey cannot currently make.

### §9 · Idempotency and duplicate delivery

Four independent layers, three of which already exist:

1. **`FOR UPDATE SKIP LOCKED`** in `publish` — two worker instances do not claim the same outbox row.
2. **`lifecycle_outbox UNIQUE (request_id, kind)`** — a retried enqueue cannot create a second row.
3. **The conversation service's internal append is idempotent on `(conversation, request, kind)`** —
   a delivery that succeeded but whose response was lost cannot append twice when retried.
4. **`worker_leases` PRIMARY KEY (job_kind)`** — two workers do not run the same job kind at once.

Layers 1–3 exist because *"a duplicate enqueue and a duplicate delivery have different causes and
either alone leaves the other unprotected"* (`lifecycle-outbox.ts`). Layer 4 is new and does not
replace any of them: a worker whose lease lapses mid-job while it is still alive must still not be
able to double-deliver, and 1–3 are what guarantee that. **The lease is an efficiency and an
operational signal, never the correctness argument.** Any job whose correctness depended on holding
its lease would be wrong, because a lease can always lapse under a slow query.

### §10 · Crash recovery

The worker holds no state. Everything it does is derived (§3) and idempotent (§9), so recovery is
the absence of a mechanism rather than the presence of one:

- **Mid-job crash** → the lease stops being renewed and lapses; another worker (or the same one,
  restarted) re-derives the same work and redoes it. Redoing is safe by §9.
- **Crash between two writes** → every job's writes are in one transaction, or are ordered so the
  survivable half is written first: `settle` + `enqueue` share a transaction; raise-then-announce is
  ordered so a crash leaves a raised intervention the next pass announces, never an announcement of
  something that was not raised.
- **Every instance restarted at once** → nothing is lost. The outbox rows, the expired requests, the
  eligible runs and the open interventions are all still there, because none of them were ever in
  the worker.

The worker is therefore **safe to deploy, restart, scale to zero and scale out** without
coordination, and a P14 test must assert exactly that by killing a worker mid-job and showing the
work completes.

### §11 · The four-plane model, with a fifth deployable

The four **planes** of ADR-0042 and ADR-0045 are unchanged: Conversation, Secure Interaction, Secure
Fill Agent, Automation Runner. A plane is a trust level; the worker introduces no new one.

ADR-0037's **deployable** table gains a row:

| Service | Origin | Network | Holds |
|---|---|---|---|
| **worker** | none | Private only. **No inbound listener at all** — not an authenticated one, not a firewalled one | Nothing. It derives everything it does from the stores it is credentialed for |

Its task role, security group and scaling are its own (§1). It reaches the Conversation Service's
internal API the same way the fill agent reaches the secure service's — mTLS on a private subnet,
its own client certificate — and it terminates no TLS of its own because it listens on nothing.

The health-check-gated deploy ADR-0037 requires for the secure service applies here too: a rolling
restart must not interrupt a job mid-transaction. Since every job is idempotent and re-derived, the
requirement is weaker than the secure service's — an interrupted worker costs a repeat, not a
student's password.

### §12 · What P14 does not do

- **No external notification transport.** Settled above. Email, SMS, Slack and webhooks are later
  consumers of §7's substrate, and each needs a vendor decision that is not an engineering one.
- **No runner supervisor.** `runOneTurn` still has no loop. The Automation Runner is its own
  deployable in its own plane with no database (ADR-0037, ADR-0045); giving *this* worker the job of
  looping it would put conversation-plane credentials in the process that drives a browser, which is
  the exact widening ADR-0042 exists to prevent. The runner's own supervisor is a separate, smaller
  piece of work and is named here so its absence is not read as an oversight.
- **No cancellation.** `CaseCancelled` has no producer, `CANCELLED` is unreachable and
  `student_revoked` is a declared void reason nothing issues. That is a real consent gap and it is
  not this ADR's.
- **No learning loop.** `interventions.lifecycle` is only ever written `"captured"`;
  `canTransitionLifecycle` and `asReusable` have zero production callers. Closing that loop needs
  real interventions to learn from and there have been none.
- **No deployment infrastructure.** There is no Dockerfile, no IaC and no service entry point
  anywhere in this repository — the worker will be built as this repository builds everything else,
  as a library with a composition root and tests. Turning any of the five into a running container is
  its own phase.
- **No `LISTEN`/`NOTIFY`**, per §2.

## The one thing this ADR cannot settle — Vahid's decision required

**Which process drains the secure plane's outbox and expires its requests?**

The four decisions settled the worker's existence, its claiming model, its ownership of
advancement, and its alerting scope. They did not settle this, and it cannot be settled by
engineering judgement alone because it trades one of ADR-0037's stated security properties against
the simplicity of one worker.

ADR-0037 is explicit:

> *"Two Postgres databases … with separate credentials and no cross-database access. The conversation
> service cannot read `secret_requests` … A full compromise of the conversation database therefore
> yields no secret metadata beyond ids and lifecycle words."*

Draining the outbox and sweeping expiries are **secure-plane** operations: they read and write
`secret_requests` and `lifecycle_outbox` in the secure database. Advancing runs is a
**conversation-plane** operation. A single worker doing all three holds both sets of credentials —
and then a full compromise of that one process yields both, which is precisely the property the
separation was built to provide.

Three options. I recommend **C**.

**A — One worker, both credentials.** Simplest: one deployable, one loop, five services. Cost: the
worker becomes the single process whose compromise yields both databases. ADR-0037's stated property
would have to be rewritten from "no process holds both" to "one non-public process holds both", and
that is a real reduction, not a wording change.

**B — Two workers, one per plane.** Preserves the separation exactly: `worker-conversation` and
`worker-secure`, each with one database's credentials. Cost: six deployables rather than five, two
composition roots, two sets of task definitions — and it exceeds the "fifth deployable" that was
settled, so it needs your explicit agreement rather than my inference.

**C — One worker (conversation plane), and the Secure Service drains its own outbox in-process.**
The separation is preserved with five deployables, and the evidence says this was the original
design intent. `publish`'s own comment reads: *"`FOR UPDATE SKIP LOCKED` because **there are several
instances of this service and they all run this loop**."* The loop was designed to live in the
secure service; it was simply never started. Your instruction was that the worker must not be hidden
inside the **Conversation Service** — the Secure Service is a different plane, and the mechanism it
would drive is its own.

Cost, stated honestly: "background work lives in the worker" stops being a single sentence. There
would be one background *deployable* and one in-process loop, and a future reader must not conclude
the Secure Service is therefore a fine place to put arbitrary background work. If C is chosen, this
ADR must state the boundary as a rule: **the Secure Service may run only loops over its own tables
that publish outward; it may never poll another plane's state.**

## Unresolved implementation details — smaller, but yours to confirm

1. **Poll intervals.** Proposed: outbox 1s, expiry sweep 30s, advance 5s, announce 10s. These are
   defaults to be tuned against a real deployment, not decided facts. The outbox interval is the one
   a student can feel.
2. **Lease duration and renewal.** Proposed: 30s lease, renewed every 10s. Long enough that a slow
   `advance` does not lose its lease, short enough that a crashed worker's job restarts quickly.
3. **Where `worker_leases` lives.** Follows directly from the A/B/C decision above: under C it is a
   new numbered migration in the conversation plane, since that is the only database the worker
   holds.
4. **Backlog fairness.** `ORDER BY updated_at ASC LIMIT n` may starve a run that keeps being
   advanced. Probably not real at this scale; named so it is a known limitation rather than a
   surprise.
5. **Whether the worker advances runs in terminal or escalated statuses.** Proposed: no — a run that
   is `escalated` waits for a specialist by design, and a worker retrying it would be the "retry
   blindly" behaviour `assessIntent` exists to prevent.

## Consequences

**Good.**

- Six pieces of complete, tested machinery acquire the caller they were written for.
- A student's composer can no longer be held shut for ever by an undrained outbox.
- ADR-0034's expiry sentence and ADR-0008's escalation queue become true statements about the system.
- The journey can, for the first time, assert that a run completes with no client request after the
  first — the property that makes "autonomous" mean something.
- Every later notification transport has one substrate to consume rather than a new mechanism each.

**Costs, stated plainly.**

- A fifth deployable is a fifth thing to run, observe and pay for.
- A polling worker does work when there is none. Bounded, indexed and cheap at this scale, but real.
- Autonomous advancement means the system can now create an account on a real portal **while nobody
  is watching**. Every guard that made this safe already exists — explicit request evidence on
  `CaseOpened`, the authorisation gate, the mandatory-review guard, `assessIntent`'s refusal to
  retry a consequential action — and none is relaxed here. But the blast radius of a bug in those
  guards grows, because until now a bug needed a student with a browser open to reach anything.
  That is the strongest argument for keeping P14 to *wiring* and adding no new capability.
- ADR-0008 remains half-honoured. The queue becomes reliable; nothing pushes.

## Alternatives rejected

- **A `--worker` flag on the Conversation Service.** Rejected by Vahid, and by §1's reasoning: it
  shares a task role and a blast radius with the one public-facing service.
- **Reusing `work_leases` for every background job.** Rejected by Vahid, and by §3: its primary key
  is `run_id` and it would stop meaning a true thing.
- **A `worker_jobs` queue table.** Rejected by §3. It would be a second opinion about what the
  system should do next, which is the failure ADR-0041 exists to prevent and which this repository
  has already had once.
- **ECS Scheduled Tasks per job.** Rejected by §2: minute granularity and a cold start per firing,
  against a latency a student can feel.
- **`LISTEN`/`NOTIFY` as the trigger.** Rejected by §2: a missed notification is invisible.
- **Building the alert transport now.** Rejected by Vahid: a transport over an unreliable queue
  delivers unreliable alerts.

---

*Nothing in this ADR is implemented. It is a draft for a decision, not a decision.*
