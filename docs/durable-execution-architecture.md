# Durable execution architecture — report and implementation plan

**Date:** 2026-08-27 · **Repository version:** `0.2.1`
**Approved direction:** B+ — domain events for business milestones, plus an explicit durable
execution checkpoint.
**Status: REPORT ONLY. Nothing implemented.**

> **Headline finding: the existing architecture already supports this design, and one of the pieces
> is already built.** `ExecutionCheckpoint` exists in `packages/domain/src/recovery.ts` with almost
> exactly the shape you described. What is missing is not the model — it is that a checkpoint can
> only be created *through a recovery escalation*, so a healthy run never records one.

---

## 1. Which existing event types already support this design

| Event | Carries | Fit |
|---|---|---|
| `CaseOpened` | `submissionIdentity`, `requestEvidence` | ✅ attach-or-create a Case |
| `CaseStateChanged` | `to`, `reason` | ✅ business status |
| `ConfirmationCaptured` | `confirmationRef` **only** | ✅ — see §4 caveat |
| `AuthorisationCaptured` | `contentHash`, `hashAlgorithm`, `authorisedAt` | ✅ the strongest one |
| `TaskRaised` / `TaskCompleted` | `taskId`, `taskKind`, `blocksProgress` | ✅ what the run is waiting on |
| `HandoffRequired` / `HandoffCompleted` | `handoffKind`, `handoffToken`, `expiresAt` | ✅ already token-matched |
| `RecoveryEscalationRaised` / `RecoveryResolved` | a full `RecoveryEscalation` / `RecoveryResolution`, **each containing an `ExecutionCheckpoint`** | ✅ the checkpoint model already exists |
| `SubmissionAttempted` / `Succeeded` / `Failed` | `submissionIdentity`, `authorisedContentHash` | ✅ (submission is out of scope, but the shape is right) |
| `BlueprintDriftDetected` | — | ✅ |

**`ExecutionCheckpoint`, already in the domain:**

```ts
interface ExecutionCheckpoint {
  blueprintVersion: BlueprintVersion;
  page: string;              // e.g. "personal-details"
  section: string;           // e.g. "previous-education"
  step: number;
  completedSections: readonly string[];
  capturedAt: Date;
}
```

Its own comment says it exists so *"the specialist should not need to restart the entire
application"* is a property rather than an aspiration — *"without it, 'resume' has nowhere to
resume to."* That is precisely this work. **No new checkpoint concept is needed.**

### One important limitation of the existing checkpoint

It models **position within the portal** (page / section / step). It does *not* model **position
within the workflow** (interviewing → authorising → filling → handing over). Those are different
axes, and a resume needs both: *which orchestrator phase* and, within a fill, *where in the portal*.

This is an extension, not a redesign — see §6.

---

## 2. Which execution milestones are missing

| Missing | Why it is needed |
|---|---|
| **Run started / attached** | Nothing records that a WorkflowRun exists, or which Case it belongs to |
| **Checkpoint on a healthy run** | Today a checkpoint exists only inside a `RecoveryEscalation`. A crash raises no escalation, so it leaves no checkpoint at all |
| **Intent-to-act** ("about to do X, key K") | **The single most important gap.** Without it, a crash mid-action is indistinguishable from a crash before it — see §8 |
| **Consequential action completed** | Account created, document attached, secret spent — each externally visible and not safely repeatable |
| **Run suspended / resumed** | So "this run was resumed 4 times" is answerable, and so a resume is itself auditable |

Everything else the run does — filling a field, reading a value back — is **not** a milestone and
must stay transient. A `TaskRaised` per form field would drown the log that exists to answer *what
did this student agree to*.

---

## 3. What is currently inside `RunState`

Measured, exactly:

```ts
interface RunState {
  inputs: RunInputs;              // caseId, studentRef, blueprint, mappingSet,
                                  // documents, portalAuthentication?,
                                  // studentPresentAtCreation?, passwordDelivery?
  profile: ConfirmedProfile;      // studentId, entries: Map<key, ProfileEntry>, updatedAt
  interview: InterviewState;
  authorisation?: AuthorisationRecord;
  filled?: boolean;               // a single boolean for the entire fill
  account?: PortalAccount;
  secret?: { requestId; lifecycle; handle? };
}
```

**`filled?: boolean` is the whole record of the fill.** Not which fields, not how far — one flag.
A run that died after 40 of 60 fields records exactly the same thing as one that died after 0.

---

## 4. What must survive a restart

| Item | Survive? | How |
|---|---|---|
| `caseId`, `studentRef` | ✅ | already in `CaseOpened` |
| Blueprint + mapping set | ✅ **by reference** — `blueprintVersion`, mapping-set id | They are large, reviewed, immutable artefacts. Persisting copies invites a resume against a *different* revision than the one authorised |
| `authorisation` | ✅ | `AuthorisationCaptured` already carries `contentHash` + `authorisedAt` |
| `account.stage` + `portalHost` | ✅ | checkpoint |
| **Which fields actually landed** | ✅ | checkpoint — this is the `filled?: boolean` gap |
| `secret.lifecycle` | ✅ | checkpoint, four words only |
| Interview position (which field, attempts) | ✅ | checkpoint |
| Execution checkpoint | ✅ | the whole point |

### The caveat on `profile` — and why B+ needs it stated

`ConfirmationCaptured` carries `confirmationRef` **only, never the value**. That is a deliberate,
correct existing decision: the event log is not a copy of the profile.

**Consequence: `RunState.profile` is NOT reconstructible from the event log.** B+ therefore cannot
mean "re-derive everything from events". The profile must either be supplied at resume time (as it
is at start time) or gain its own persistence. **This is a real gap that the approved direction
does not by itself close**, and it is Phase 2 in §11.

---

## 5. What must NEVER be persisted

| Never | Why |
|---|---|
| **Secret plaintext** | ADR-0026. It lives in an in-memory store for minutes and nowhere else |
| **A live secret handle, treated as usable** | Safe to *write* (it is opaque), but it resolves to nothing after a restart. It must be persisted **only** as `secret_expired` — a resumed run asks again |
| **Document contents** (`PreviewDocument`, `AuthorisedDocument`) | The vault owns these under a retention policy (ADR-0010/0023). A checkpoint copy would be an unpoliced second copy |
| **`SubmissionPreview`** | Already throws on serialisation, deliberately |
| **Confirmed values in the event log** | The existing ref-only design. Do not weaken it |
| **Browser cookies / storage state** | A live portal session is a credential |
| **Anything model-generated as fact** | ADR-0004 |

---

## 6. The relationship between Case, WorkflowRun, Event Log and Checkpoint

```
  Case  ─────────────────────────────── business identity, event-sourced
   │      source of truth for WHAT WAS AGREED and WHAT HAPPENED
   │      append-only · CaseStore · fold(events) → ApplicationCase
   │
   ├── Event Log ──── CaseOpened · CaseStateChanged · ConfirmationCaptured
   │                  AuthorisationCaptured · TaskRaised/Completed
   │                  HandoffRequired/Completed · RecoveryEscalationRaised/Resolved
   │
   └── WorkflowRun ── ONE attempt to execute this case
         │            operational identity: runId, caseId, status, startedAt
         │
         └── Execution Checkpoint ── mutable · last-write-wins · DISPOSABLE
                  workflow phase · portal position (existing ExecutionCheckpoint)
                  completed sections · in-flight intent + idempotency key
```

### The four rules that keep the checkpoint from becoming a second truth

1. **A checkpoint may only hold what the event log cannot.** *Position*, not *facts*. If a datum
   answers "what did the student agree to", it is an event.
2. **On conflict, the event log wins and the checkpoint is discarded.** A resume that cannot
   reconcile them starts from the last event-derived state — slower, never wrong.
3. **A checkpoint must be safely deletable.** Deleting every checkpoint must lose no business fact,
   only efficiency. This is the test that keeps rule 1 honest, and it is a *test*, in §12.
4. **A checkpoint carries a schema version.** An unreadable or incompatible checkpoint is discarded,
   not guessed at.

**Why a run is a separate concept from a case:** a case may be executed more than once — a recovery
resolution with `outcome: "route_fallback"` explicitly switches route, and a reapplication increments
`attemptOrdinal`. The case is the application; the run is one attempt at it.

---

## 7. How duplicate and consequential actions are prevented after a restart

Three layers, two of which already exist:

| Layer | Mechanism | Status |
|---|---|---|
| **Domain** | `decide()` refuses a duplicate at decision time | ✅ built |
| **Storage** | `PRIMARY KEY (submission_key)` refuses it at write time | ✅ built in 0.2.0 |
| **Execution** | an **intent record** written *before* every consequential action | ❌ **missing** |

### The consequential actions in this system

| Action | Repeatable? | Verifiable after the fact? |
|---|---|---|
| Fill a field | ✅ yes — idempotent by value | ✅ `readValue` |
| Click "next"/"continue" | ⚠️ **maybe not** — may create a draft application | ⚠️ via `currentUrl` |
| Create a portal account | ❌ **no** | ✅ by attempting sign-in |
| Attach a document | ❌ no — duplicates appear on the application | ✅ usually visible on the page |
| Spend a secret handle | ❌ no — single-use by construction | ❌ the handle is simply gone |
| Submit | out of scope — deliberately absent | — |

The intent record makes the *uncertain* case detectable:

```
write intent { action, idempotencyKey, startedAt }   ← durable, before acting
  do the thing
write completion { idempotencyKey, outcome }         ← durable, after
```

On resume: **intent with no completion ⇒ UNCERTAIN.** Never "retry because it probably failed".

---

## 8. What happens when the process dies

### (a) Before the action — **safe**
No intent record. The action has provably not happened. Resume performs it normally.

### (b) During the action — **uncertain**
Intent record, no completion. The action may or may not have reached the portal.

| The action is | Then |
|---|---|
| idempotent (fill a field) | redo it, then read back to confirm |
| verifiable (account creation, attachment) | **verify first**, act only if verification says it did not happen |
| neither (a spent secret handle) | **escalate.** `RecoveryEscalationRaised`, reason `workflow_deviation`, with the checkpoint |

### (c) After the external action succeeded, before we recorded it — **indistinguishable from (b)**

This is the fundamental limit and it is worth being blunt about: **there is no way to close this
window.** Any "record after acting" has a gap, and any "record before acting" produces a record for
an action that may not have happened. The two-phase intent record does not eliminate the
uncertainty — **it makes it detectable**, which is the most any system can do.

So the design converts the problem from *"did it happen?"* into *"can we find out?"*:

- **verify where we can** — read back, check the URL, attempt a sign-in;
- **escalate where we cannot** — a specialist looks at the portal, which is exactly what ADR-0008's
  recovery layer is for.

An automatic retry of an unverifiable consequential action is the one thing this must never do.

---

## 9. Changes required in the orchestrator

Currently `nextStep(state, model)` is pure over an in-memory object, and no caller persists
anything. The minimum honest change:

| Change | Why |
|---|---|
| `RunState` gains `runId` and `checkpoint` | It has no operational identity today |
| `filled?: boolean` → real progress in the checkpoint | One boolean cannot resume a fill |
| A `WorkflowRunStore` port (§10) | Somewhere to put a checkpoint |
| `startRun` / `resumeRun` / `recordMilestone` | The lifecycle functions that do not exist |
| `assess()` and `nextStep()` stay pure | **Deliberately unchanged.** Persistence wraps them; it does not enter them |

The last row matters. `assess`/`nextStep` being pure is why the orchestrator is testable with no
browser and no database, and that property is worth preserving.

---

## 10. Is the `CaseStore` contract sufficient?

**No — and it should not be stretched to fit.**

`CaseStore` is deliberately append-only:

> *"There is deliberately no `update`, no `delete`, and no way to rewrite history. The only mutation
> is `append`."*

A checkpoint is **mutable by nature** — last-write-wins, overwritten continuously, disposable.
Forcing it into `CaseStore` would mean either making every checkpoint an event (**Option A, which
you rejected**) or adding an update path to an append-only log (which would destroy the guarantee
`contract.ts` exists to protect).

**Recommendation: a second, separate port — `WorkflowRunStore`** — in `packages/case-store`,
alongside `CaseStore`, sharing the migration mechanism and the shared-contract-suite discipline that
worked for C1.

```ts
interface WorkflowRunStore {
  start(run: WorkflowRunRecord): Promise<void>;              // fails if runId exists
  load(runId: RunId): Promise<WorkflowRunRecord | null>;
  saveCheckpoint(runId, checkpoint, expectedRevision): Promise<void>;  // optimistic
  recordIntent(runId, intent: ActionIntent): Promise<void>;
  completeIntent(runId, idempotencyKey, outcome): Promise<void>;
  findByCase(caseId: CaseId): Promise<readonly WorkflowRunRecord[]>;
}
```

`saveCheckpoint` takes an expected revision for the same reason `append` takes an expected sequence:
two processes resuming the same run must not both win. §12 tests it the same way.

**This keeps the separation you asked for:** `CaseStore` holds business truth and never changes;
`WorkflowRunStore` holds operational position and changes constantly.

---

## 11. Implementation plan

The smallest coherent milestone that delivers *"workflow starts → durable state exists → process
can die → workflow can restart safely from the correct point"* is **Phases 1–4**. Phase 5 is the
honest completion. **C2 comes after all of them.**

### Phase 1 — the run model (domain only)
- **Purpose:** name the concepts. `RunId`, `WorkflowRunRecord`, `WorkflowStatus`, `ActionIntent`,
  and a `WorkflowCheckpoint` that composes the *existing* `ExecutionCheckpoint` with a workflow
  phase. Transition rules for run status.
- **Packages:** `packages/domain` only.
- **Persistence / migration:** none.
- **Recovery behaviour:** none yet — this is vocabulary.
- **Safety:** the checkpoint type must be structurally unable to hold a confirmed value, a document
  or a secret. Enforced by type and by a boundary rule, as ADR-0004's cast rule now is.
- **Tests:** status transitions; a `@ts-expect-error` proving a `ConfirmedValue` cannot enter a
  checkpoint; a boundary check.
- **Backward compatible:** ✅ additive. **MINOR → 0.3.0**

### Phase 2 — the port and both implementations
- **Purpose:** `WorkflowRunStore` + a shared contract suite + in-memory + Postgres, mirroring C1
  exactly.
- **Packages:** `packages/case-store`.
- **Persistence:** migration `0002_workflow_runs.sql` — `workflow_runs`, `action_intents`.
  `PRIMARY KEY (run_id)`; `UNIQUE (run_id, idempotency_key)` on intents; a `revision` column for
  optimistic concurrency.
- **Recovery:** load a run and its checkpoint after a restart.
- **Safety:** an incompatible `checkpointSchemaVersion` is **discarded, never guessed at**.
- **Tests:** the full shared contract against both implementations; concurrent `saveCheckpoint`;
  corrupted and incompatible checkpoints; migration idempotency.
- **Backward compatible:** ✅ additive. **MINOR → 0.4.0**

### Phase 3 — the orchestrator learns to checkpoint
- **Purpose:** `startRun`, `resumeRun`, `recordMilestone`. `assess`/`nextStep` stay pure.
- **Packages:** `packages/orchestrator` (+ dependency on `case-store`).
- **Persistence:** none new.
- **Recovery:** a resumed run reaches the same `RunStep` as the run that died.
- **Safety:** a resume that cannot reconcile checkpoint with event log **discards the checkpoint**
  and re-derives.
- **Tests:** run → kill → resume → same next step; a checkpoint that disagrees with the log.
- **Backward compatible:** ⚠️ `RunState` gains fields. Existing callers still compile if the new
  fields are optional; if they must be required, this is **MAJOR**. Decided in Phase 3, reported
  before committing.

### Phase 4 — consequential-action safety
- **Purpose:** intent-before-action, and the three crash windows of §8 handled explicitly.
- **Packages:** `orchestrator`, `browser-runner` (verification read-backs).
- **Recovery:** uncertain action → verify, or escalate. **Never blind retry.**
- **Safety:** the single most important property in this plan.
- **Tests:** kill before / during / after-external-success, for each consequential action; assert an
  unverifiable uncertain action **escalates rather than repeats**.
- **Backward compatible:** ✅ additive. **MINOR**

### Phase 5 — profile durability (the §4 gap)
- **Purpose:** `ConfirmedProfile` is not reconstructible from the event log by existing design.
  Either persist it under its own port, or require it as a resume input.
- **This needs your decision** — it is a change to what the event log is for. Reported at the time,
  not assumed.

### Then, and only then — C2 (recovery transport)
It now has something real to hand a specialist: a run, a checkpoint, a reason, and a verified
statement of what did and did not happen.

---

## 12. Testing requirements — and the regressions that must fail

Per the standing rule, each safety property gets a deliberate regression proving the test catches it.

| Property | Regression to introduce | Must fail |
|---|---|---|
| Restart resumes at the right point | checkpoint save becomes a no-op | resume lands at the start |
| Checkpoint is disposable | delete all checkpoints | **must still pass** — if a business fact is lost, rule 1 is broken |
| Duplicate prevention | `completeIntent` becomes a no-op | a resumed run repeats a consequential action |
| Uncertain action | verification always returns "did not happen" | an unverifiable action is repeated instead of escalated |
| Event/checkpoint consistency | checkpoint claims a section the log contradicts | resume trusts the checkpoint |
| Concurrent resume | drop the revision check on `saveCheckpoint` | two resumes both win |
| Corrupt checkpoint | write malformed JSON / a future schema version | resume crashes instead of discarding |
| Migration compatibility | edit an applied migration | checksum check (already built in 0.2.0) |

**End-to-end restart, against the real Postgres adapter — not unit tests.** A run started in one
process, the process killed, a *new* process resuming from the database and reaching the same
decision. Anything less does not demonstrate recovery.

---

## 13. Version impact

| | |
|---|---|
| **This report** | Documentation only → **no version bump** (ADR-0028 §3). Recorded under `[Unreleased] ### Internal`. |
| Phase 1 | MINOR → `0.3.0` |
| Phase 2 | MINOR → `0.4.0` |
| Phase 3 | MINOR, or **MAJOR** if `RunState` gains required fields — decided and reported before committing |
| Phase 4 | MINOR |

**Release-state language, kept precise:** the repository version is `0.2.1`; local Git tags
`v0.1.0`, `v0.2.0`, `v0.2.1` exist; **no tag has been pushed and there is no published release**.

---

## 14. What I am asking for

1. **Approve Phases 1–4** as the milestone, or tell me where the boundary should move.
2. **Phase 5 (profile durability)** — flagged now because B+ does not close it, and it is a
   decision about what the event log is for.
3. Confirm **`WorkflowRunStore` as a second port** rather than extending `CaseStore` (§10).

Nothing is implemented. No architectural change has been made.
