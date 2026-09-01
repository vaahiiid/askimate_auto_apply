# Roadmap, priorities, and why C2 is not the next item

> ## ⚠️ Historical — its central finding was resolved by P1–P11
>
> **Updated 2026-09-01.** This document argued that C2 (recovery transport)
> could not be next because durable run state did not exist:
>
> > *"`RunState` — the orchestrator's entire notion of where a run has got to —
> > is a plain object passed between function calls … It is never written
> > anywhere. **If the process ends, the run is gone.**"*
>
> **That is no longer true, and has not been since P1.** A run is durable in
> `workflow_runs`, its consequential actions in `workflow_action_intents`, its
> page progress derived from that ledger (ADR-0047), and since P10 its stopped
> state and adjudication in `interventions` (ADR-0048). The two unconnected
> models of a case described in §3 were joined — and since P11 the case state
> machine is *driven* by the run rather than standing beside it (ADR-0049), so
> the join is a moving one rather than a shared identifier.
>
> The reasoning is kept because the *ordering argument* was right and is worth
> reading: the substrate before the transport. What it asked for now exists, so
> **the alerting transport is genuinely next** — see the end of
> `docs/where-we-are.md` for the current state and limitations.
>
> Everything below is the state as of 2026-08-27 at `0.2.0`. Do not read its
> measurements as current.

**Date:** 2026-08-27
**Version at time of writing:** `0.2.0`
**Asked for by Vahid:** establish whether C2 is clearly next before starting it.

> **Conclusion: it is not.** C2 (recovery transport) has a hard prerequisite that does not exist,
> and building it first would produce an alert that hands a specialist a case which does not
> survive the process it was in. The recommendation and the reasoning are in §7.

---

## 1. What C1 was intended to achieve

**Intent:** make a case survive the process that created it.

From the repository's own analysis, written before either was built — in-memory persistence *"does
not survive a crash, and it does not survive the applicant going away for two days to find their
passport — so it blocks the second run, not the first."*

**Delivered in `0.2.0`:** `PostgresCaseStore`, passing the identical `runCaseStoreContract` suite as
the in-memory store; versioned migrations with checksums; tagged date serialisation; the CI
integration job that had been waiting behind `if: false`.

### What C1 did NOT achieve, stated plainly

**Nothing in the product uses `CaseStore`.** Measured:

```
$ grep -rn "CaseStore" --include=*.ts packages apps scripts | grep -v packages/case-store/
scripts/check-boundaries.ts   (four forbidden-dependency rules)
scripts/walkthrough.ts        (a demonstration script)
```

One demo script. The orchestrator does not touch it, `scripts/end-to-end.ts` does not persist
anything, and no package manifest outside `packages/case-store` depends on it.

So C1 delivered a **correct, well-tested, unused** capability. It was still the right thing to
build — the adapter has to exist before anything can use it, and the contract proved the guarantees
transferred — but **the durability it provides is currently zero, because nothing durable happens.**
That is the finding that reorders everything below.

---

## 2. What C2 is, and exactly what problem it solves

**C2 — recovery transport.** From area 11 of the live-run checklist:

> Built: the escalation model, the checkpoint on every intervention record, and `failurePointOf`. A
> run that stops names where it stopped and what it was doing.
>
> The **transport** — how a specialist is actually alerted, and the console they act in — is
> modelled, not built.

**The problem it solves:** a run fails halfway through filling a real application. Today the only
alert is *"the person watching the screen notices"*. That is acceptable for one supervised run and
not for a second.

**Why it cannot be next.** [ADR-0008](./decisions/0008-recovery-first-escalation-and-the-learning-loop.md)
does not merely require an alert; it requires that *"the workflow **resumes from the appropriate
state**"* and *"resume**s** from the failure point"*. Resumption requires the case to still exist
after the failure.

It does not. `RunState` — the orchestrator's entire notion of where a run has got to — is a plain
object passed between function calls:

```ts
export interface RunState {
  readonly inputs: RunInputs;
  readonly profile: ConfirmedProfile;
  readonly interview: InterviewState;
  readonly authorisation?: AuthorisationRecord;
  readonly filled?: boolean;
  readonly account?: PortalAccount;
  readonly secret?: { requestId; lifecycle; handle? };
}
```

It is never written anywhere. **If the process ends, the run is gone.**

So building C2 first produces an alert that says *"a specialist should take over case X at
checkpoint Y"* — pointing at a case that no longer exists to be taken over. The transport is the
delivery half of ADR-0008; durable run state is the substrate half, and the substrate comes first.

---

## 3. The two unconnected models of a case

This is the actual structural finding, and it explains both §1 and §2.

| | `packages/domain` | `packages/orchestrator` |
|---|---|---|
| Shape | event-sourced: `openCase` → `decide` → `stamp` → `append` → `fold` | a plain `RunState` object |
| Durability | `CaseStore`, now with Postgres | **none** |
| Vocabulary | 22 `CaseEvent` types | none |
| Exercised by | `scripts/walkthrough.ts` | `scripts/end-to-end.ts` — the chain that does the work |

They were built in different phases and **were never joined**. The event vocabulary already covers
most of what a run does — `ConfirmationCaptured`, `AuthorisationCaptured`, `TaskRaised` /
`TaskCompleted`, `HandoffRequired` / `HandoffCompleted`, `RecoveryEscalationRaised` /
`RecoveryResolved` — so this is not a missing design. It is an **unfinished connection between two
halves of the approved one.**

---

## 4. MVP-critical components

MVP = one student, conversation to completed-but-unsubmitted application, on the real portal.

| Component | State | Why MVP-critical |
|---|---|---|
| Domain core, branded values | ✅ | Model output cannot reach a form field. The safety model rests on it. |
| Interview capability | ✅ | The student is never handed a form (ADR-0007). |
| Mapping + validation + preview | ✅ | The student authorises exact content. |
| Authorisation ledger | ✅ | Nothing is filled without it. |
| Browser runner (discovery, fill, guards) | ✅ / 🟡 | Structurally cannot submit (ADR-0014). Unproven against the real portal. |
| Secret channel | ✅ | Needed wherever the portal demands a password. |
| **Durable, resumable run state** | ❌ | **A real applicant does not finish in one sitting.** They leave to find a passport. |
| Real blueprint + mapping set | ⛔ | Blocked on discovery + specialist review — Vahid's. |
| Interview inside AskiMate Chat | ⛔ | **Blocked by Replit access (B-category).** |

## 5. Infrastructure, but not MVP-critical yet

| Component | Why it can wait |
|---|---|
| Recovery **transport** and specialist console | A human is in the room for the first supervised run. Not acceptable for the second. |
| Learning loop wiring | An intervention that taught us something is currently discarded. Costly over time, harmless once. |
| Specialist console read-model | Needs durable state first; a console over a process-local object is not a console. |
| Blueprint drift detection against stored captures | Needs stored captures. |
| AWS infrastructure | The first run happens on a laptop. $0 spent, deliberately. |

## 6. Blocked by Replit access

Unchanged from `docs/replit-dependency-map.md`, and still explicitly blocked:

| | Item |
|---|---|
| **B1** | Production chat data-path audit |
| **B2** | Production secure-endpoint integration |
| **B3** | Verifying the `err.body` finding against the live stack |

`apps/chat-integration` remains labelled research/prototype in its README and `index.ts`. **Archive
compatibility is not production compatibility** and is not presented as such anywhere.

---

## 7. Recommendation: C2′ — make a run durable and resumable

**Not C2. This.** Renamed `C2′` rather than reusing `C2`, so the two are not confused later.

### Why it is the highest priority

1. **It is required by approved architecture.** ADR-0008 requires resumption from the failure
   point. That is impossible today, and no amount of transport work makes it possible.
2. **It is the prerequisite for C2, C6 and C7.** Recovery transport, a specialist console and drift
   detection all hand a human a case; all three need the case to outlive the process.
3. **It is MVP-critical on its own.** A real applicant leaves mid-application to find a document.
   Today that ends the run.
4. **It is what makes C1 worth having.** Right now the Postgres store is used by one demo script.
5. **It is unblocked** — it needs no Replit access, no portal, no credential, no decision from
   anyone but the one below.

### The one decision I need before implementing

How should `RunState` relate to the event log? Three options, and they differ in consequences that
last:

| | Option | What it means | Cost |
|---|---|---|---|
| **A** | **Fully event-sourced.** `RunState` is derived by `fold`, exactly as `ApplicationCase` is. | One model, one truth, complete audit trail for free. | Every run milestone needs an event type; `InterviewState`'s attempt counters need modelling. Largest change. |
| **B** | **Milestone events + re-derivation.** Record the decisions (`ConfirmationCaptured`, `AuthorisationCaptured`, handoffs) as events; rebuild `RunState` from those plus the reviewed blueprint and mapping set. | Uses the vocabulary that already exists and is unused. Audit trail covers every decision that matters. | Two representations must agree; a fold bug is a wrong resumption. |
| **C** | **Snapshot `RunState` as a blob** beside the event log. | Smallest change, fastest to build. | An opaque blob is not auditable, cannot answer "who decided this and when", and would sit awkwardly beside an event log that exists precisely to answer that. |

**My recommendation is B.** The event vocabulary was designed for exactly these milestones and is
currently unused by the orchestrator; A is the same destination with substantially more work now and
some of it speculative (`InterviewState` internals may not deserve to be events at all); C conflicts
with the reason the event log exists.

**I have not implemented any of them.** This is an architectural direction with long consequences,
so per your standing rule it is a recommendation, not a decision.

### If B is approved, the shape of the work

1. A `RunMilestone` event vocabulary — reusing existing `CaseEvent` types where they fit, adding
   only what genuinely has no home.
2. `foldRun(events, inputs)` → `RunState`, pure and total, mirroring `fold`.
3. `recordRunStep(state, step)` → events, mirroring `decide`.
4. A `resumeRun(caseId, store, inputs)` that reads, folds and continues.
5. Contract-style tests: **run, kill, resume, and prove the resumed run makes the same next
   decision** — including the adversarial case where the process dies between deciding and
   appending.
6. Version impact: **MINOR** (`0.3.0`) — a new backward-compatible capability.

---

## 8. What I will do if this is not approved as stated

Ask again rather than pick. The alternative — starting C2 because it was next on a list I wrote —
is precisely the *"work created because it is technically convenient to build next"* that you ruled
out, and it would produce an alert pointing at a case that no longer exists.
