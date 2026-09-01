# ADR-0048 — A specialist resolution completes an intent; the operator CLI is only its first interface

**Status:** **Accepted** — approved by Vahid, 2026-09-01, with three amendments recorded in §3, §5 and §4. ·
**Date:** 2026-09-01 · **Supersedes:** nothing ·
**Related:** ADR-0008, ADR-0020, ADR-0031, ADR-0038, ADR-0041, ADR-0045, ADR-0046, ADR-0047

## Context

P9 closed durable multi-page execution. The happy path now runs end to end and stops where
ADR-0014 says stop. The unhappy path does not exist.

Measured, on `main` at `8fb6edc`:

| Fact | Evidence |
|---|---|
| A run that hits uncertainty leaves the work pool silently | `run-driver.ts:1155` — `if (await this.#actionMayBeUnfinished(...)) continue;` |
| Its status stays `running` | nothing in `packages/`, `apps/` or `scripts/` writes `"uncertain"` or `"escalated"` |
| No conversation event is appended | there is no append on that path |
| The vocabulary exists and is unused | `RUN_STATUSES` has both words; `NEXT_STATUS` (`workflow.ts:165`) permits `running → uncertain \| escalated`, `uncertain → running`, `escalated → running` |
| The recovery model exists and is unused | `RecoveryEscalation`, `RecoveryResolution`, `ExecutionCheckpoint`, `InterventionRecord`, `failurePointOf`, `asReusable` — referenced by nothing outside `packages/domain` and `scripts/walkthrough.ts` |

So a run that meets a `verify_first` or `escalate` verdict becomes **permanently inert**: no status
change, no student-visible word, no specialist signal, and no way in. That is safe — nothing is
retried blindly, which is the property `assessIntent` exists to protect — but ADR-0008 does not ask
only for safety. It asks that the workflow *"resumes from the appropriate state"* and
*"resumes from the failure point"*. Neither is possible today because nothing can reach the run.

**The question this ADR decides: how does a specialist's resolution enter the system, and what does
it change?**

Alerting transport — how a specialist is *told* — is the other half of ADR-0008 and is deliberately
not decided here. §1 says only enough for a specialist to find the work at all.

## The three options

### A · A specialist HTTP surface on the Conversation Service

A `/v1/interventions` surface: list open interventions, read one, post a resolution. Authenticated
as a human through the managed OIDC provider (ADR-0038), authorised by a `specialist` role.

**What it gets right.** One writer, so the service's invariants hold. A durable interface that a
console can be built on later without redoing the model.

**Why not now.** It is the largest new *trust* surface in the system, and the one where a mistake is
worst: a bug in specialist authorisation is read/write access to other students' applications.
Building it requires deciding, today, a role model, a per-case authorisation rule, and how a
specialist's identity is proven — none of which ADR-0038 has answered for a non-student human, and
none of which the unhappy path needs in order to work.

There is a tempting shortcut that must be named and refused: reusing `authoriseService` (the
`x-service-cert` shared secret that gates `/internal/v1/...`) to admit a human. That is a shared
account, and `RecoveryResolution.specialistId` says in the domain: *"The named individual who
resolved it. Never a shared account."* Admitting a human through a service credential and then
writing a name into the payload records an identity the system never checked.

This is the right *destination*. It is the wrong thing to build first, because everything it needs
from the model below has to exist anyway, and building the model first means the surface can be
added without changing what a resolution *is*.

### B · An operator CLI writing the authoritative records itself

`pnpm run interventions` and `pnpm run resolve`, run by the operator, opening the database and
writing the status change and the completion directly.

**What it gets right.** No new network surface, no new authentication model, nothing internet-facing.
There is precedent: `retention-status`, `inspect-discovery`, `version` are all operator commands.

**Why not in this form.** A CLI that writes the store directly is a **second writer**, and the
Conversation Service's invariants live in the service. This repository has already had two models of
one thing come apart — that is why ADR-0041 exists — and ADR-0045 turned on the same principle
(nothing calls into the runner; the run's own position is the authority). A second writer means
every future invariant has two places to be enforced and one place to be forgotten.

The interface is right. Writing the records itself is not.

### C · The resolution is an intent-ledger completion (ADR-0047's machinery)

A specialist resolution is modelled as the **completion of the intent that could not be completed**,
plus the status transition that follows from it.

**Why this is the strongest of the three**, and the reason is not convenience:

`assessIntent` returns `verify_first` or `escalate` when it cannot answer exactly one question —
*did this consequential action happen?* `IntentOutcome` is `"succeeded" | "failed_cleanly"`, and an
intent with no completion **is** the uncertainty window (`consequential.ts`, and ADR-0047 §1). A
specialist opening the portal and looking is not doing something new to the model. They are
supplying the answer to that exact question, in the exact slot the model already has for it. The
verdict then changes on its own: `verify_first` becomes `already_done`, and the run is workable
again with no code that says "resume".

It also answers requirement 5 without inventing anything, which is the part worth dwelling on. See
§5.

**What it does not cover, stated plainly.** The ledger holds the *fact* — did it happen. It does not
hold the *adjudication*: who decided, on what evidence, and whether the fix generalises. That is
`InterventionRecord`, and it needs a home of its own. C alone is not a complete answer; §2 gives it
one.

## Decision

**The authoritative model is C. The first interface is B, corrected so it is not a second writer:
the CLI calls the service's existing internal route rather than the database.** A is the
destination, and this ADR is written so that reaching it changes the interface only.

### 1 · How a specialist receives and identifies the intervention

An intervention is identified by an `InterventionId` — the existing domain id, minted when the run
stops, not when a human looks. Minting it at the stop is what makes the thing a specialist is
handed the same thing the run is waiting on, rather than two records that have to be matched up.

Delivery, for P10, is **pull**: `pnpm run interventions` lists every open one — id, run, student
reference, the `RecoveryReason`, the failure point from `failurePointOf`, and how long it has been
waiting. Nothing pushes.

That is honestly less than ADR-0008 asks for, and it is enough to be correct rather than merely
present: a specialist with the list can resolve any case, and no case can be lost, because "open"
is derived from run status rather than from anything a notification did or did not deliver. **The
alerting transport is the next phase, not this one**, and it will read the same list.

### 2 · What authoritative record they resolve

Three records, each with exactly one job. They are not three copies of one fact, and the difference
matters enough to state:

| Record | Holds | Authority for |
|---|---|---|
| `workflow_action_intents` (ADR-0047) | the completion of the adjudicated action | **did it happen** |
| `interventions` (new, holding the existing `InterventionRecord`) | escalation, resolution, specialist, reusability, lifecycle | **who decided, and why** |
| The conversation event log (ADR-0031) | one `message` on pause, one on resume | **what the student was told** |

The intervention record deliberately does **not** restate the outcome. `RecoveryResolution.outcome`
is `resume | route_fallback | abandon` — what to do next — which is a different axis from whether
the action landed. Keeping them apart is what stops this becoming the second source of truth
ADR-0041 forbids.

**The failure point is recorded in the vocabulary this system actually has.** `ExecutionCheckpoint`
was written in an early phase as *"pure domain modelling … the shape they must fit"*, before the
execution vocabulary existed, and it asks for a `section` and a zero-based `step` that nothing in
this system knows. Filling those with placeholders would be inventing a position, which this
repository refuses to do with a student's data and should not do with its own. P10 refines the type
to what is knowable at a stop — the blueprint version, the action, its target, the run's phase, the
pages already completed, and when it was captured — and `failurePointOf` continues to return it.

The student-visible message says the run is paused and that a person is looking. It carries no
portal internals, no field names and no specialist identity — a student can act on none of them, and
`routes.ts:408` already takes that position for a mapping-set refusal.

### 3 · How the resolution enters the system

A new internal route on the Conversation Service, alongside the ones the Secure Service and the
runner already use:

```
POST /internal/v1/interventions/:interventionId/resolution
```

gated by the existing `authoriseService`, parsed against a closed set exactly as `parseSecureAppend`
is — and, as there, ignoring any field a caller might send for an id, an ordinal or a timestamp, so
none of them can become authoritative.

`pnpm run resolve` is a client of that route. It holds the service credential because it runs where
the operator already has one; it does not open the database.

**The access-control limitation, stated rather than buried.** Under B the control is *whoever can
run the CLI with the service credential*. `specialistId` is therefore **asserted, not
authenticated** — the record is honest about who claimed to resolve it, not proof of who did.

**Vahid, 2026-09-01, approving it:** *"approved as asserted, not authenticated, for P10 only …
acceptable only for the current controlled single-operator model. The moment we introduce multiple
specialists, authenticated individual identity becomes a required architectural capability, not a
deferred cosmetic improvement."*

So this is scoped, not open-ended, and the scope is a property of the deployment rather than of the
code: **exactly one named operator holds the service credential.** The condition that ends it is not
a date or a nice-to-have — it is a second specialist existing at all. At that point authenticated
individual identity is a **required capability and a release blocker**, because every guarantee that
rests on `specialistId` — who adjudicated an uncertain account creation, whose judgement entered the
learning loop through `asReusable` — degrades from a fact to a claim the moment two people can make
it. The implementation says so where a reader will meet it: at the route, at the CLI, and on the
stored record. The route's shape does not change when option A is built; only who is allowed to
call it.

### 4 · How the run returns to `running`

The run's status is moved with the mechanism that already exists — `saveCheckpoint({ status,
expectedRevision })` — and the transition table already permits every move needed:

```
running     → uncertain | escalated      when the run stops
uncertain   → running   | escalated | abandoned
escalated   → running   | abandoned
```

Two properties come free and are worth naming because they are the reason not to build something
new. `canTransitionStatus` is enforced *in the store*, in both adapters
(`postgres-workflow.ts:152`, `in-memory-workflow.ts:109`), so an illegal move is refused wherever it
comes from. And `uncertain` may not reach `completed` directly — *"we do not know" cannot become "it
worked" without somebody finding out* — which is the invariant this whole phase is about.

`abandon` maps to `abandoned`. **`route_fallback` has no machinery and is out of scope**; a
resolution carrying it is refused rather than half-honoured.

**Vahid, 2026-09-01:** *"approved to reject explicitly for now. Do not partially implement it. A
future route change must be handled by a separate ADR and complete implementation."* So the refusal
is a tested property, not an unhandled case: a resolution naming `route_fallback` is rejected by the
route with a reason, changes nothing, and leaves the run exactly as it was.

### 5 · How the run resumes from the failure point rather than restarting

This is the requirement that would be expensive under A or B and is nearly free under C, and it is
the strongest argument for the decision.

**The run's position is already derived, not stored.** ADR-0047 put page progress in the intent
ledger; the checkpoint is a cache that `advance` refreshes, and `discardCheckpoints` exists — with
the contract that it *"must never lose a business fact"* — precisely so a run whose cached position
is unreadable or contradicted can re-derive its position instead of trusting a bad one.

So a resolution does not set a resume point. It records a business fact, and the position follows:
`#nextPage` returns the first page with no successful `advance_portal_page` intent, and
`#actionMayBeUnfinished` stops looking once no verdict is unfinished. Complete the adjudicated
intent, and the very next claim offers the right work — the page after the one the specialist
settled, not the first page, and not the one already saved.

That gives the property ADR-0008 asks for as a **consequence of the existing design** rather than as
a new mechanism, and it means there is no resume cursor that can disagree with the ledger.

**Amendment, Vahid, 2026-09-01.** The draft proposed storing `RecoveryResolution.resumeFrom` as the
specialist's account while not reading it. That was rejected, and rightly:

> *"I do not approve storing an executable field that the system deliberately ignores. The workflow
> must continue to derive its real position from authoritative facts and the intent ledger."*

A typed `ExecutionCheckpoint` sitting on a resolution record is indistinguishable, to anyone reading
the code later, from a cursor that something honours. The comment saying otherwise is one refactor
away from being wrong, and the field is one `??` away from being load-bearing. **`resumeFrom` is
therefore removed from the resolution model entirely.** A resolution carries what the specialist did
(`actionsTaken`) and what worked (`resolution`) as prose, and no position of any kind.

Where a specialist advanced the application by hand, that is expressed by completing the
corresponding page intents — the same fact, in the one place that already means it, where the resume
logic already reads it.

**The one position that remains, and why it is not the same thing.** `RecoveryEscalation.checkpoint`
records where the run *stopped*, captured at the stop. It is diagnostic: it is what a specialist
reads to know where to look, and `failurePointOf` returns it for exactly that. It is **never read by
the code that decides what runs next**, and P10 asserts that by enumeration rather than by comment.
It is also refined to what this system can truthfully record — see §2 — because a checkpoint with an
invented `section` and `step` would be a fabricated position, which is worse than none.

### 6 · Trust, auditability and idempotency

**Trust.** No new internet-facing surface. The resolution route sits behind `authoriseService` with
the runner's and the Secure Service's routes, which ADR-0045 already established as the internal
plane. The Secure Plane is untouched: a resolution names an action and a target — a portal host, a
page reference — and never a credential, so ADR-0042's boundary is not approached. `specialistId` is
asserted, not authenticated (§3), and that is the one weakness, named.

**Auditability.** Every resolution leaves: a completion with a timestamp in the ledger; an
intervention record naming the individual, what they did, and what worked; and a student-visible
message. `failurePointOf` reads the failure point back off the record, so *where it broke* survives
the fix. The intervention record feeds the ADR-0008 learning loop through the existing
`asReusable` gate — which returns `null` for anything not `published`, so nothing a specialist wrote
influences future behaviour without passing the gate. **No new gate, and no bypass.**

**Idempotency.** Replaying a resolution — a retried CLI invocation, a duplicated request — must be
safe, and it is, by three independent mechanisms already in place:

1. `completeIntent` updates `WHERE ... AND outcome IS NULL` (`postgres-workflow.ts:229`), so a
   second completion cannot overwrite a different one; it distinguishes *recorded* from *already
   had one* by `rowCount`.
2. The status change carries `expectedRevision`, so a replay loses optimistic concurrency rather
   than applying twice.
3. The intervention is keyed by `InterventionId`, and `canTransitionLifecycle` already refuses an
   out-of-order lifecycle move.

The property to test is therefore not "it does not crash" but that **resolving twice leaves exactly
one completion, one lifecycle transition, and one student-visible message** — and that a resolution
racing the run's own recovery cannot produce two.

### 7 · Why the alternatives were rejected

| Option | Why not |
|---|---|
| **A · Specialist HTTP surface, now** | The largest new trust surface in the system, needing a role model and per-case authorisation that ADR-0038 has not answered for a human who is not the student, none of which the unhappy path needs to work. The model below it has to exist either way; building the model first means A becomes an interface change rather than a redesign. It remains the destination. |
| **B · CLI writing the store directly** | A second writer, against ADR-0041 and against the principle ADR-0045 turned on. Every invariant would need enforcing in two places, and would eventually be enforced in one. Adopted as the *interface*, corrected to call the service. |
| **C alone** | Right about the fact, silent about the adjudication: the ledger cannot say who decided or whether the fix generalises, and ADR-0008's learning loop needs both. Adopted with `interventions` alongside it. |
| **A new `run_recovery` table holding position and resolution together** | The obvious shape, and it puts a resume cursor beside a ledger that already knows the position — the second source of truth ADR-0041 and ADR-0047 both refused. |
| **Let the run retry once a human says it is fine** | A "retry" verdict is precisely what `assessIntent` does not have, by design and by an enumeration test. A resolution supplies *what happened*; it never authorises a repeat. |

## Consequences

- The unhappy path becomes reachable and recoverable, and a run can no longer become silently inert.
- One new table, one new internal route, one new operator command, and two new event appends on the
  existing log. No new service, no new plane, no new workflow engine.
- Access control for the resolution is the service credential until option A is built. **A second
  specialist is the event that makes authenticated individual identity a required capability and a
  release blocker** — not a deferred improvement. This is the known limitation of this decision, and
  the only one.
- `RecoveryResolution` loses `resumeFrom`, and `ExecutionCheckpoint` is refined to a position this
  system can state truthfully. Both types are currently referenced only by `packages/domain` and
  `scripts/walkthrough.ts`, so the change costs nothing and buys a model with no ignorable
  executable field in it.
- `route_fallback` remains unimplemented; a resolution carrying it is refused.
- The alerting transport — the other half of ADR-0008 — is still not built, and is the natural
  phase after this one.
- Two documents describe a world that P1–P9 replaced (`docs/where-we-are.md`, 2026-08-26;
  `docs/roadmap-and-priorities.md`, 2026-08-27, which still says `RunState` *"is never written
  anywhere"*). They are corrected as part of the work this ADR governs.
