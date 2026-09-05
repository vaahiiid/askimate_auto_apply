# Where we are

> ## ⚠️ Superseded below — this section is the state as of 2026-08-26
>
> **Updated 2026-09-02 (P15).** Everything from the headline to "Since then" is
> the picture *before* P1–P15, and its numbers are long out of date — "620
> tests" is far behind, and the state table below is missing four steps that
> have since been built and one that has since been found. The current state is
> at the **end of this file**. This section is kept rather than
> rewritten because it is the record of a real milestone, and overwriting it
> would lose what Stage D actually proved.

**Date:** 2026-08-26
**Supersedes the state table in** [`gap-analysis-to-first-end-to-end-run.md`](./gap-analysis-to-first-end-to-end-run.md)
(its account of the blockers and the account options still stands)

---

## The headline

**The full chain now runs end to end and stops before submission.**

```bash
pnpm run end-to-end
```

> discover a portal read-only → capture every page → replay it locally →
> **interview the student in conversation** → plan the fill → validate against the portal's own
> recorded rules → **show exactly what will be submitted** → capture the authorisation →
> fill the form → **STOP**

That is Stage D from the gap analysis: the milestone I said was the real proof point, reachable
without an account and without touching anything live. It is reached.

**620 tests.** Typecheck, lint, dependency-boundary checks and CI all green.

---

## What is built, and what remains

Legend: ✅ built and tested · 🟡 partial · ❌ not built

| # | Step | State | Notes |
|---|---|---|---|
| 1 | **Discovery** | ✅ | Read-only. Now also captures each page for replay. The *live run* is still blocked on egress. |
| 2 | **Application Blueprint** | ✅ | Draft → specialist review → executable. An unreviewed one cannot drive anything. |
| 3 | **Requirements** | 🟡 | Model, provenance and the evidence bar are built. **The Requirements Service and its curated content are not** — curation ownership settled in [ADR-0019](./decisions/0019-requirements-curation-ownership.md). |
| 4 | **Conversational interview** | ✅ | A capability of AskiMate Chat (ADR-0015). No new interface, and none will be built. |
| 5 | **Confirmed profile** | ✅ | In-memory. Postgres is deferrable and not on the critical path. |
| 6 | **Documents** | ✅ | Vault, deterministic validity, and extraction with the grounding rule (ADR-0016). |
| 7 | **Field mapping** | ✅ | Reviewed data pinned to a blueprint version (ADR-0017). |
| 8 | **Autonomous completion** | ✅ | Fills a real form. Proven against a real Chromium and a replay of a captured portal. |
| 9 | **Validation** | ✅ | Against rules the blueprint *observed*. There is no such thing as a guessed rule. |
| 10 | **Preview** | ✅ | Every field, no summarising, rendered deterministically. Hashed. |
| 11 | **Authorisation** | ✅ | Ledger stores the preview text verbatim, not only the hash. |
| 12 | **Submission** | ❌ | **Deliberately not built. This is where we stop.** |

---

## The three guarantees worth knowing about

Each was verified by attacking it, not by asserting it.

**A model cannot invent a value into an application.** Extraction must quote the span of the
document it read, and a span the document does not contain means the reading is discarded — at any
confidence. A confabulating model client producing perfectly passport-shaped data at confidence 1.0
has **all eight** of its readings thrown away before the student ever sees them. That matters
because a student skim-reading "I read your passport number as K98765432 — is that right?" will say
yes. See [ADR-0016](./decisions/0016-extraction-must-quote-the-document.md).

**A dropdown option is never approximated.** Confirmed nationality `Iranian` does not become
`Iran (Islamic Republic of)` because it is close. The case blocks and asks. The wrong answer here
would look entirely reasonable in the preview, which is exactly why software must not choose it.

**Preparation cannot submit.** Four layers: the session type has no `submit`; only controls the
blueprint records as *advance* controls may be clicked; a control whose name reads as a submission
is refused **even if it is on the allow-list**; and where the blueprint records the submission
endpoint it is refused at the network layer too. Tested by deliberately allow-listing the submit
button and asserting the fixture server received nothing.

---

## Since then (2026-08-26, later)

| | |
|---|---|
| **Provider** | Amazon Bedrock, approved. Adapter built behind the existing port; **no model chosen** — `pnpm run verify-bedrock` reads what the account can actually use ([ADR-0018](./decisions/0018-amazon-bedrock-as-the-model-provider.md)). |
| **Requirements curation** | A human specialist, through AskiMate's existing knowledge workflow ([ADR-0019](./decisions/0019-requirements-curation-ownership.md)). |
| **Discovery** | [Runbook](./runbook-discovery-handoff.md) for running it on a machine with network access, and `pnpm run inspect-discovery` to analyse what comes back. |
| **Account** | [QA Higher Education sandbox request](./qa-higher-education-sandbox-request.md), drafted and ready to send. |
| **Live run** | [What a controlled live run still needs](./what-a-controlled-live-run-needs.md) — five blockers; four are yours. |
| **Account ownership** | The account is the student's, on their own email, handed back before we finish ([ADR-0020](./decisions/0020-the-account-belongs-to-the-student.md)). |
| **Uploads** | A document in the vault is not permission to send it ([ADR-0022](./decisions/0022-a-document-in-the-vault-is-not-permission-to-send-it.md)). |
| **Scope** | Application requirements ≠ visa requirements ([ADR-0021](./decisions/0021-application-requirements-are-not-visa-requirements.md)). |

## What still needs a decision from you

The four decisions from the earlier version of this document have been **made** — Bedrock, the
discovery hand-off, requirements curation, and the account approach. Two new ones have surfaced, and
both come out of looking at what a live run actually requires rather than what the demonstration
shows. They are set out in full in
[what a controlled live run needs](./what-a-controlled-live-run-needs.md):

Both questions from the earlier version are **answered and built**:

- **Authentication** — the account belongs to the student, uses their own confirmed email, and is
  handed back through the portal's own password-reset flow before our involvement ends
  ([ADR-0020](./decisions/0020-the-account-belongs-to-the-student.md)). Whether the real portal fits
  that model is a question for discovery, and the ADR lists what each alternative would change.
- **Financial evidence** — out of scope for the first UK application
  ([ADR-0021](./decisions/0021-application-requirements-are-not-visa-requirements.md)), with every
  existing safety control kept. A university application requirement is not a visa requirement.

### Outstanding, and mechanical rather than a judgement

- **Bedrock credentials**, so `pnpm run verify-bedrock` can report what is actually available and the
  model choice can be made against stated criteria.
- **A retention schedule.** The vault refuses to store any document type with no configured policy —
  no default, no fallback ([ADR-0010](./decisions/0010-policy-driven-document-retention.md)). So the
  first real upload fails, loudly, by design. The periods follow from ICO guidance and the
  university's requirements, and per your instruction I have not invented any.

---

## What has deliberately not been built

Said plainly so nothing here reads as further along than it is.

- **Submission.** No code path exists. Phase 6, with its own approval.
- **The Requirements Service.** The gate is built; the service behind it is not.
- **AWS, Postgres, SQS, the API, the AskiMate integration.** None is needed for the demonstration,
  and building them now would have delayed it. `$0` of the AWS credit is spent.
- **A student-facing interface of any kind**, and there never will be one — the interview is a
  capability the existing AskiMate Chat calls (ADR-0015). The CLI harnesses in `scripts/` are test
  drivers and ship nowhere near a product.


---

# Where we are — 2026-09-01

**Version:** `0.28.0` · **Trunk:** `main` · **CI:** green

## The headline

**The happy path runs end to end, and the unhappy path is now recoverable.**

A student is interviewed, types a password into the Secure Plane that no other
service ever sees, an Automation Runner creates their account on a real portal,
fills a multi-page application across restarts, and the run stops before
submission — where ADR-0014 says stop.

And when it cannot proceed, it now **says so**: the run takes a durable
`uncertain` or `escalated` status, the student is told once in honest terms, a
specialist gets a case with the failure point on it, and their adjudication puts
the run back in the pool — resuming from where the intent ledger says it got to,
never from the beginning.

## What changed since 2026-08-26

| Phase | What it delivered |
|---|---|
| P1–P3 | The React client on the real Conversation Service; a durable event log; the Secure Service appending authoritatively |
| P4 | The Conversation Service opens the secure step and mints the frame capability |
| P5 | The Automation Runner **pulls** leased work (ADR-0045) |
| P6 | Account creation and protected fill against a real gated portal |
| P7 | The first real end-to-end execution journey, across four planes |
| P8 | A fill plan crosses as value and provenance (ADR-0046); the runner fills the form |
| P9 | Durable multi-page execution; page progress lives in the intent ledger (ADR-0047) |
| P10 | A run that stops says so, and can be picked up (ADR-0048) |
| P11 | The run driver drives the case machine; a student authorises through it (ADR-0049) |
| P12 | The account lifecycle completes; a case can finally conclude (ADR-0050) |

## The state table, corrected

| # | Step | State | Notes |
|---|---|---|---|
| 1 | Discovery | ✅ | Read-only. The *live run* is still blocked on egress. |
| 2 | Application Blueprint | ✅ | Draft → specialist review → executable. |
| 3 | Requirements | 🟡 | Model and evidence bar built. **The Requirements Service and its curated content are not** (ADR-0019). |
| 4 | Conversational interview | ✅ | A capability of AskiMate Chat (ADR-0015). **Only actually true since P13** — before it, `answer` was a hook nothing filled and no student could put one field into this system. |
| 5 | Confirmed profile | ✅ | **Postgres, behind `ConfirmedProfileStore`** (ADR-0044) — no longer in memory. |
| 6 | Documents | ✅ | Vault, deterministic validity, extraction with the grounding rule. |
| 7 | Field mapping | ✅ | Reviewed data pinned to a blueprint version. |
| 8 | Autonomous completion | ✅ | **Multi-page, durable across restarts**, against a real Chromium and a real gated portal. |
| 9 | Validation | ✅ | Against rules the blueprint observed. |
| 10 | Preview | ✅ | Every field, rendered deterministically, hashed. |
| 11 | Authorisation | ✅ | **New in P11:** captured through the student's own route and the domain's `capture_authorisation` intent. The ledger still stores the preview text verbatim; nothing appends an authorisation by hand. |
| 11a | **Case state** | ✅ | **New in P11.** The run driver walks `CASE_SPINE` one hop at a time through `decide`, so `checkTransition` runs on every move. The mandatory-review guard — financial evidence, or a minor — now actually holds a real run back. |
| 12 | **Recovery** | 🟡 | **New in P10.** A stopped run is durable, visible and resolvable. The **alerting transport is not built** — the queue is pull-only. |
| 13 | Submission | ❌ | **Deliberately not built. This is where we stop.** |
| 14 | **Account hand-over** | ✅ | **New in P12.** The stage is derived from the case log and the intent ledger — `handover_due` is reachable, `handed_over` is reachable, and `mayConcludeCase` has a caller for the first time. |

## Known limitations, stated plainly

- **No alerting transport.** A specialist must run `pnpm run interventions`.
  Nothing pushes. ADR-0008's other half.
- **`specialistId` is asserted, not authenticated.** Acceptable for exactly one
  operator; a second specialist makes authenticated identity a release blocker,
  not an improvement (ADR-0048 §3).
- **`escalated` is unreachable from `claimWork`** — every action a runner
  performs is verifiable, so `verify_first` is the only verdict the integration
  path produces. The branch is correct and enumerated directly.
- **`route_fallback` is refused, not implemented** (ADR-0048 §4).
- **`generated_ephemeral` accounts cannot yet be handed over.** Nothing in this
  service holds that credential — the runner mints it, uses it and lets it
  expire — so nothing here can truthfully say it is destroyed. The account stays
  outstanding, which is the safe direction (ADR-0050).
- **A handoff does not expire.** `expiresAt` is required by the event and nothing
  reads it. Stopping asking is a product decision nobody has made.
- **`AWAITING_HANDOFF` is unreached**, deliberately: using it takes a case off
  `CASE_SPINE` and would need a return edge the transition table does not have
  (ADR-0050 §7).
- **Mandatory review has one interface.** A specialist clears one with
  `POST /internal/v1/cases/{caseId}/review`, on the same internal plane and the
  same asserted identity as an intervention (ADR-0049 §4). There is no CLI verb
  for it yet.
- **No terminal case state is reachable, deliberately.** `CONFIRMED` means the
  portal confirmed a SUBMISSION, and submission is a later phase — reaching it
  any other way would be untrue. A finished case rests at `AUTHORISED` with its
  account handed back, and "concludable" is `mayConcludeCase` answering `true`.
  Decided by Vahid, 2026-09-01; see ADR-0050 §7.
- **No live run.** Blocked on portal egress and a sandbox account.

---

# Where we are — 2026-09-02

**Version:** `0.31.0` · **Trunk:** `main` · **CI:** green

## The headline

**A student can now put a value into this system by typing it.**

Until P13 they could not. The orchestrator composed interview questions, and
the run driver threw them away: `newInterview(…)` was rebuilt on every request,
so `pending` and `attempts` were always empty, `applyConfirmation` and
`ConfirmedProfileStore.save` had **no production caller at all**, and every
green test seeded the profile from the test process. The nine phases before
this one executed applications built from data no student had ever supplied.

That loop is closed, through the message path that already existed — the
`answer` hook on `POST /v1/conversations/{id}/messages`. There is no second
student-facing surface and ADR-0051 forbids one: a separate interview endpoint
is a form with an HTTP shape, which is the thing ADR-0007 and ADR-0015 both
refuse.

## What P13 delivered (ADR-0051)

| | What it delivered |
|---|---|
| **The interview value loop** | The student answers in the conversation; the reading is put back to them; they confirm it as a `StudentDecision`, not as a parsed "yes"; the value is written through `applyConfirmation` — the only function that mints a `ConfirmedValue`. |
| **Pending proposals in the log** | Three new event kinds — `value_proposed`, `value_confirmed`, `value_rejected` — so a pending reading survives the request that created it, and a restart. The `open_value_proposals` view answers "which is open" in SQL, beside `open_secret_requests`. |
| **Re-authorisation** | `void_authorisation` is now the true mirror of `capture_authorisation`: it emits `AuthorisationVoided` **and** the move back to `AWAITING_STUDENT_AUTHORISATION`, **through `checkTransition`**. |
| **Content-aware fill intents** | An `advance_portal_page` intent is keyed on the page **and** its content — `page-ref@sha256:…` — so the ledger can answer "was the *corrected* value written?", which ADR-0047 §1 named and could not answer. |

## The two things worth understanding

**The reader with no writer, again.** `#withAuthorisationIfCaptured` had
consumed `AuthorisationVoided` since the domain was written, and nothing ever
produced one. That is the same shape `HandoffRequired` had before P12, and the
second time in two phases that a defined-and-unused mechanism turned out to be
the missing capability rather than dead weight.

**The forward-only spine was not relaxed to fix it.** `nextCaseHop` still walks
`CASE_SPINE` forward only. Invalidation is not a healthy case going backwards —
it is a separate deliberate act, which ADR-0049 §1 had already named. Routing
the way back through `checkTransition` makes the guards *stronger*, not weaker:
a correction that introduces financial evidence, or that reveals a minor, is
**reviewed again** before the student can be asked to approve the corrected
content. `packages/domain/src/machine.test.ts` proves both halves — that the
case is put back, and that it is **refused** while a mandatory review is
outstanding.

## Known limitations — what changed, and what did not

Everything in the 2026-09-01 list still holds except the interview, with these
additions:

- **Document intake is not built, and is blocked — not deferred.** A student
  cannot supply a document through the conversation, and no upload surface
  exists. `pnpm run retention-status` reports governing version
  `v0.2026-08-26`: **0 policies, 12 unresolved**, stamped *"UNAPPROVED — this
  version exists to record what is open, not to permit storage"*. `requirePolicy`
  throws, so no placeholder period can enter production code. This is an
  external product-policy dependency, and inventing a retention period to
  unblock it would be the worst available outcome. See ADR-0051 §8.
- **An unreadable answer leaves no event, so it does not count as an attempt.**
  `MAX_ATTEMPTS_PER_FIELD` counts proposals that were superseded or rejected.
  Recording an unreadable answer would need a fourth event kind whose only
  purpose is a counter. Stated rather than hidden: the escalation now fires on
  the case that matters — three readings a student kept saying no to — where
  before it fired on nothing at all.
- **Tasks stay dormant.** The `Task` model, its intents and its guards remain
  defined and uncalled. P13 deliberately did not wire them; nothing was removed.
- **A correction after authorisation costs the approval.** That is the point:
  the student re-approves content that changed. The system never implies a
  corrected value reached the portal — the fill intent for that page is a
  different intent, so the page is offered again.

---

# Where we are — 2026-09-02 (later)

**Version:** `0.32.0` · **Trunk:** `main` · **CI:** green

## The headline

**The system now acts when nobody is watching.**

Until P14 it could not. Nothing in this repository ran without a request, and
six pieces of complete, tested machinery had no production caller at all:

| Machinery | Callers before P14 |
|---|---|
| `LifecycleOutbox.publish` — backoff, retry, `FOR UPDATE SKIP LOCKED` | tests only |
| `RunDriver.advance` — 20+ tests | no route reached it |
| `settle(…, "secret_expired")` | never called with that argument |
| `interventions.announced_at` — *"the next pass will tell them"* | there was no next pass |
| `secret_requests_expiring` — an index commented *"expiry sweeps"* | there was no sweep |
| `runOneTurn` | nothing loops it — **still true here; closed by P16** |

Three real failures followed. A student's composer stayed shut for ever,
because the secure service enqueued a lifecycle transition and nothing drained
the outbox — the two-origin browser test passed only because *the test* called
`publish` itself. A secure request that timed out never settled, so ADR-0034's
sentence about `secret_expired` described behaviour the system could not
perform. And a case only moved while a browser was posting: **the student's
browser was the scheduler.**

## What P14 delivered (ADR-0052)

| | |
|---|---|
| **A fifth deployable** | `apps/worker`, with no inbound listener at all. It advances every eligible run on its own clock and announces interventions the student was never told about. |
| **`worker_leases`** | Keyed by **job kind**, not by run. Holds no business fact: drop the table and nothing about any case, run, request or student is lost. |
| **Two Secure-Service loops** | The outbox drain and the expiry sweep, in-process — where `publish`'s own comment always assumed they would be. |
| **The client stops being load-bearing** | `POST /runs` still advances, as a latency optimisation. The worker is the only thing that *must* run. |

## The property worth knowing about

The journey now proves the thing Vahid's decision asked for: **the worker moves
a run with no HTTP request made on the student's behalf.** Every advance in that
test until this point was a POST from the student's client, because before P14
that was the only thing that moved a case.

## Database separation, preserved

Vahid chose **option C** (ADR-0052 §13.0). The worker owns the Conversation
Plane; the Secure Service drains its own outbox and expires its own requests.
**No process requires credentials for both planes**, so ADR-0037's statement
that a full compromise of the conversation database yields no secret metadata
stands unchanged.

`pnpm run boundaries` enforces both directions: the worker may not name a vault,
a store or a resolver, and the Secure Service may not depend on a
conversation-plane store in production.

## Known limitations — what changed, and what did not

Everything in the earlier lists still holds, with these corrections:

- **The alerting transport is still not built.** ADR-0008 is now *half*
  honoured rather than not at all: the intervention queue is reliable and
  current, and a student whose run paused is told without a runner having to
  poll. **Nothing pushes.** Email, SMS and webhooks are later consumers of this
  substrate and each needs a vendor decision.
- **The Automation Runner still has no supervisor.** `runOneTurn` runs one turn
  and nothing loops it. Looping it from the worker would put conversation-plane
  credentials in the process that drives a browser, which is the widening
  ADR-0042 exists to prevent. It is its own smaller piece of work. *(Closed by
  P16: the loop lives in the runner.)*
- **A permanently-failed outbox row still holds one student's composer shut.**
  It is recorded with `last_error` and surfaced within the secure plane, but it
  is not raised as an intervention — `interventions` is a conversation-plane
  table and §13.0 forbids the Secure Service from opening one. Stated as a
  limitation rather than solved (ADR-0052 §4).
- **Autonomous advancement widens the blast radius.** The system can now create
  an account on a real portal while nobody is watching. Every guard that made
  this safe already existed and none was relaxed — request evidence on
  `CaseOpened`, the authorisation gate, the mandatory-review guard,
  `assessIntent`'s refusal to retry a consequential action. But until P14 a bug
  in one of them needed a student with a browser open to reach anything. That is
  why P14 is wiring and adds no new capability.
- **Still no deployment infrastructure.** No Dockerfile, no IaC, no service
  entry point. Five deployables now exist as libraries with composition roots
  and tests; turning any of them into a running container is its own phase.
- **Cancellation is still unreachable.** `CaseCancelled` has no producer,
  `CANCELLED` is unreachable, and `student_revoked` is a declared void reason
  nothing issues. A real consent gap, and not this phase's.
- **The learning loop is still open.** `interventions.lifecycle` is only ever
  written `"captured"`; `canTransitionLifecycle` and `asReusable` have no
  production callers.

---

# Where we are — 2026-09-02 (P15)

**Version:** `0.33.0` · **Trunk:** `main` · **CI:** green

## The headline

**A student can stop.**

Until now they could not, and P14 is what made that urgent rather than merely
missing. Before P14 the client was the scheduler — `advance` had no route, so
the only production trigger was the student's browser re-POSTing `/runs`, and
**closing the tab was a de facto stop.** Undesigned, unrecorded, and the student
was told nothing, but the system did stop acting. P14 removed it deliberately
and correctly. Nothing replaced it.

The sharpest evidence of the gap was an asymmetry we had built ourselves:
ADR-0032 gave the student a way to cancel **one password prompt**, fully
implemented and reachable. They could cancel the password prompt and not the
application it was for.

| Mechanism | Before P15 |
|---|---|
| `CaseCancelled` | defined and folded — **no producer** |
| `CANCELLED` | terminal, permitted from almost everywhere — **unreachable**, not on `CASE_SPINE` |
| `student_revoked` | a declared void reason — **never issued**, against 19 sites issuing `content_changed` |
| a stop route | **none** among the six student-facing routes |

## What P15 delivered (ADR-0053)

Cancelling is **two acts separated in time**, and that is the whole design:

```
  any non-terminal state ──cancel_case──▶ WINDING_DOWN ──(nothing owed)──▶ CANCELLED
```

- **Stopping is immediate and unrefusable.** Entering `WINDING_DOWN` has no
  guard — a stop button with a precondition is not a stop button — and
  `claimWork` offers the run to no runner from that moment, which is where "no
  further consequential action" is actually enforced.
- **It does not strand the account.** `CANCELLED` is terminal, and `decide`
  refuses every intent on a terminal case except `instruct_reapplication`. A
  direct jump would have made `complete_handoff` permanently refusable and left
  an account created in the student's name on a real portal with no way back —
  defeating ADR-0050 while reporting success. The guard on `WINDING_DOWN →
  CANCELLED` refuses to conclude while anything is owed.
- **The approval is voided**, with `student_revoked` — the reason's first
  writer.
- **`CANCELLED` is the first terminal state this system can reach.** ADR-0050 §7
  declined to make one reachable because `CONFIRMED` means a portal confirmed a
  submission and submission is out of scope. That reasoning does not apply to
  "the student stopped", which is a fact this system holds entirely.

## The message, and why it is part of the phase

Stopping does not undo what already happened in the world, and a message that
said only *"I've stopped"* would let a student believe otherwise by omission.
What they are told names all three limits: the account **still exists and is
theirs**, what was already filled in **is still saved there**, nothing was
submitted — and, load-bearing, that **erasure is a separate request** which goes
to a person. Retention is not approved (0 policies, 12 unresolved), and a stop
button that quietly implied deletion would be the most damaging thing this phase
could have shipped.

## Known limitations — what changed, and what did not

- **Cancellation is not erasure**, and the system says so rather than implying
  otherwise. Erasure remains blocked on the retention schedule.
- **A specialist cannot cancel on a student's behalf.** ADR-0048 §3 already
  decided this: `specialistId` is asserted, not authenticated, and a consent act
  must not be recorded against an identity nobody verified. The condition that
  would change it is the one ADR-0048 names — authenticated individual identity.
- **Nothing un-fills a page.** Data written to a portal is in the portal.
- **A student who abandons without cancelling still leaves an open case.** The
  stop is explicit; there is no timeout that infers one, and inferring consent
  from silence is the thing product rule 1 forbids.
- Everything else from the P14 list still holds: no alerting transport, no
  runner supervisor, no deployment infrastructure, documents blocked on
  retention, and the learning loop still open.

## What is next, on the evidence

The **runner supervisor** — `runOneTurn` still has no loop. It was deliberately
sequenced *after* this phase: building it first would have opened a window of
autonomous consequential action with no way to close it. That window can now be
closed, so the ordering argument is discharged.

---

# Where we are — 2026-09-02 (later still)

**Version:** `0.34.0` · **Trunk:** `main` · **CI:** green

## The headline

**The runner loops, and the last of ADR-0052's unreached machinery has a
caller.**

`runOneTurn` had been complete since P5 and nothing had ever looped it. It was
the sixth row of the table above, and the only one P14 deliberately left alone:
looping it from the worker would have put conversation-plane credentials in the
process that drives a browser, which is the widening ADR-0042 exists to prevent.
So the loop lives in the runner, where ADR-0052 §12 put it.

**No new ADR.** ADR-0052 §12 settles where it goes and ADR-0045 settles how it
works — *"the runner PULLS leased work; nothing calls into it"* — with the cost
already accepted: *"Latency is a poll interval rather than a push."*

## What P16 delivered

| | |
|---|---|
| **`startRunnerSupervisor`** | A serial loop around `runOneTurn`. One turn at a time, prompt (250ms) after work and patient (5s) after nothing, and a `stop` that **waits** for a browser mid-action. |
| **No opinions** | It holds no view about what may be worked on. Every stop condition — a cancelled case, an `uncertain` or `escalated` run, a run somebody else holds, an action that may already have happened — is enforced on the other side of the intake, and the loop inherits all of them by performing only what it is handed. |
| **An integration proof** | `scripts/runner-supervisor.test.ts`: two real supervisors, real `httpWorkIntake`, a real Conversation Service and a real PostgreSQL. |

## What the integration proof actually asserts

- **A run advances with no client connected.** After the seed, nothing calls
  `advance`, nothing POSTs `/runs`, and there is no session cookie. The only
  requests on the wire are the runner's own claim and report.
- **Two runners, one unit of work.** Both poll every 15ms while a 150ms
  performer holds the lease: **one 200, many 204s, one browser opened.**
- **A runner dies holding the work.** Its lease is aged, an heir picks the run
  up, and when the corpse wakes and reports against the lease it no longer holds
  the report is **refused** — while the heir is still working, so the lease-id
  comparison is the only thing standing between them.
- **A stopped case reaches no browser.** A control proves the run *was* in the
  pool; `cancel_case` commits; the same loop, unchanged and untold, is handed
  nothing from that moment.

## Known limitations — what changed, and what did not

- **The intent is written on report, not on claim, and a killed runner leaves
  no trace.** This was the finding of the phase. *(Closed by P17 and ADR-0054:
  the row is now written at claim time.)* A runner
  killed mid-`create_account` records nothing, so the work returns to the pool
  and the next runner may create a second account in the student's name.
  ADR-0045 §4 claims the opposite property; `performOnce`
  (`packages/orchestrator/src/consequential.ts`) implements the safe ordering
  and has no production caller. Options, and a recommendation, are in
  [`p16-regression-audit.md` §4](./p16-regression-audit.md). **It is not
  dangerous in this repository — there is still no deployment — and it must not
  be deployed while it is open.**
- **Concurrency is one turn per runner, deliberately.** How many browsers may
  drive one university's portal at once is not an engineering detail, and
  nothing has asked for throughput yet.
- Everything else from the P14 and P15 lists still holds: no alerting
  transport, no deployment infrastructure, documents blocked on retention, and
  the learning loop still open.

## What is next, on the evidence

**The intent ordering**, if Vahid takes option A — it is small, the machinery
exists, and it closes the one gap this phase opened onto. After that the
honest candidates are unchanged: deployment infrastructure (there is still no
Dockerfile, no IaC and no service entry point anywhere), the alerting transport
(needs a vendor decision), and the learning loop (needs real interventions to
learn from).

---

# Where we are — 2026-09-02 (P17)

**Version:** `0.35.0` · **Trunk:** `main` · **CI:** green

## The headline

**A runner that dies mid-action can no longer cause a second account.**

P16 shipped the runner supervisor and, in writing its crash test, found the gap
that this phase closes. `RunDriver.reportWork` wrote the
`workflow_action_intents` row **when the report arrived** — so a runner killed
mid-action left nothing at all. The lease lapsed, the run went back in the pool,
and the next runner was handed it as new work. On `create_account` that is a
second account, on a real portal, in a student's name.

Three things made it a decision rather than a bug:

| | |
|---|---|
| **ADR-0045 §4 claimed the opposite** | *"a process can always die between an external success and our recording of it — which is precisely what `workflow_action_intents` was built to make detectable"*. True only of a runner that survived to say `uncertain`. |
| **The store already refused that ordering** | `completeIntent` has always thrown on a completion with no intent, calling it *"the ordering the whole mechanism depends on"*. `reportWork` satisfied it by recording the intent one line earlier. |
| **The safe ordering was already written and uncalled** | `performOnce`: *"The intent is durable BEFORE the action."* A seventh entry for ADR-0052's table of built-and-unreached machinery. |

Vahid took option A on 2026-09-02. **ADR-0054** records it.

## What P17 delivered

| | |
|---|---|
| **The write moved to the claim** | `claimWork` opens the ledger row after taking the lease and before returning the work. `reportWork` no longer records; it only completes. |
| **`reopenIntent`** | One row per `(run, action, target)` is unchanged — it is the ledger's primary key and what an intervention pairs with. A retry re-opens the row, **guarded in SQL to `outcome = 'failed_cleanly'`**, so a `succeeded` action can never be handed out again and an unfinished one is never taken from the specialist it belongs to. |
| **No new guard** | `#unfinishedAction` → `#pause` → an intervention and a message to the student is the P10/ADR-0048 path, unchanged. All this phase did was make it reachable by a crash. |
| **A defect fixed on the way** | `reportWork` used to skip recording when a row existed and then call `completeIntent` anyway — so a run that failed cleanly and then succeeded **threw**, leaving the account on the portal and the ledger saying `failed_cleanly` for ever. No test had ever driven a full second attempt. |

## What the crash proof asserts, against a real plane

`scripts/runner-supervisor.test.ts`, real Conversation Service, real PostgreSQL:

- **the attempt is durable while the browser is still inside it** — asserted at
  the instant a runner is mid-action;
- **the lease lapses and a second runner is offered nothing** — no second
  account, and it really did keep polling;
- **the run stops and a person is asked to look** — one intervention, status
  `uncertain`, through the mechanism that already existed;
- **the corpse's later report is refused** and changes nothing;
- **a cleanly failed attempt is tried again** by a different runner, one row,
  re-opened and then completed.

## Known limitations — what changed, and what did not

- **A crash before the first portal request raises an intervention for nothing.**
  A specialist looks, sees no account, and records that it did not happen —
  `resolveIntervention` with `didHappen: false` is that path and already exists.
  This is the accepted cost of the ordering, and the asymmetry is not close.
- **A lapsing lease no longer means "retry"** for consequential work. It means a
  runner is gone and a person must look.
- **There is still no verifier.** `performOnce`'s `verify_first` branch wants
  something that opens the portal and asks whether the account exists. Until
  that is built, a person is the verifier.
- **The ledger holds no attempt history.** It answers *did this action happen to
  this target?*, not *how many times was it tried?*. A counter nobody reads
  would be the mirror of the problem this phase fixed.
- Everything else from the P14–P16 lists still holds: no alerting transport, no
  deployment infrastructure, documents blocked on retention, the learning loop
  still open.

## What is next, on the evidence

The safety gap P16 opened onto is closed, and with it the reason not to deploy.
The honest candidates are now **deployment infrastructure** (there is still no
Dockerfile, no IaC and no service entry point anywhere — five deployables and
nothing to deploy them with), the **alerting transport** (needs a vendor
decision from Vahid; the queue it would consume has been reliable since P14),
and the **learning loop** (ADR-0008 part 2, which needs real interventions to
learn from). A **portal verifier** would turn this phase's false positives into
automatic answers, but it is worth building after there is traffic to measure.

---

# Where we are — 2026-09-03 (P18)

**Version:** `0.36.0` · **Trunk:** `main` · **CI:** green

## The headline

**The system can be run outside a test for the first time.**

Five deployables existed and **not one had an entry point.** `createConversationApp`,
`createSecureApp`, `createFillAgentApp`, `startWorker`, `startSecureBackground`
and `startRunnerSupervisor` had, between them, zero production call sites. It was
ADR-0052's reader-with-no-writer shape one level up: P14, P16 and P17 gave those
six pieces of machinery their callers, and nothing called the callers.

| Was | Now |
|---|---|
| no entry points | five processes an operator starts, and a sixth was deliberately NOT created |
| **no configuration layer at all** — zero production `process.env` reads | `@askimate/aas-config`, dependency-free, reporting every problem at once and echoing no value |
| `migrate()` had no non-test caller | `migrate` is a command mode of the two services that own the two databases, under an advisory lock; every start refuses a pending migration |
| the only `EnvelopeCache` was in-process | `RedisEnvelopeCache`, so ADR-0042's two deployables actually share one |
| `assertVaultIsProductionGrade` had no process to stop | `keyProviderFor` makes the choice and the refusal one function |
| `/dev/session` fenced by a comment | refused by configuration, with `NODE_ENV=production` |

## What the proof actually runs

`scripts/p18-startup.test.ts` spawns each entry point as a **real child process**
against a real PostgreSQL and a real Redis, and reads what it printed and what it
exited with. The last group starts the Secure Service and the Fill Agent as two
operating-system processes sharing one cache — the topology ADR-0042 has
described since it was written, working for the first time.

## The most important consequence, stated plainly

**A production start is currently impossible, on purpose.** With
`NODE_ENV=production` the Conversation Service refuses, naming two reasons:
there is no identity provider (ADR-0038's OIDC is unbuilt, so `/dev/session`
would be the only way in and it is refused), and there is no production
catalogue. That is the honest state, and a service that started in production
and quietly served nobody would be worse. The startup validator is now the
executable form of the deployment checklist.

## Standing limitations — carried forward, and one added

- **Chromium/browser resource contention is UNRESOLVED.** P17 raised three
  composer assertions in `apps/chat-integration/src/two-origin.test.ts` from
  one-shot reads to 30-second polls, and that improves reliability **under the
  workload measured there and nothing more**. The underlying problem is that
  several Chromium instances run in parallel across that directory's suites and
  a page can be starved for many seconds; a longer timeout tolerates the
  contention, it does not remove it. **Three green runs are not evidence that
  the contention is solved** — the failure rate before the change was roughly
  one run in four, so a handful of passes is well within what the old code would
  also have produced. Expect it to resurface on slower runners, under a heavier
  suite, or in tests nobody has adjusted. The real fixes — limiting browser
  concurrency, or giving these suites a serial lane — are not done.
  Measurements: `p17-regression-audit.md` §5.
- **`KmsDataKeyProvider` has never run against a live key.** The configuration
  path is real and tested; the first `GenerateDataKey` is an operator's
  first-run check (`secure-plane-deployment.md` §3.1).
- **No production catalogue**, and no blueprint parser to build one safely.
- **No identity.** Deferred to its own phase by decision, 2026-09-03.
- **No packaging.** Entry points run through `tsx`, as every operational command
  in this repository does. Bundling belongs with the container work.
- Everything from the P14–P17 lists still holds: no alerting transport (the
  operator CLI is the pull surface and suffices for one operator), the learning
  loop still open with nothing to learn from, documents blocked on retention,
  and P17's accepted cost — a crashed runner raises a specialist intervention.

## What is next, on the evidence

Two things now block a real deployment, and they are the two P18 deliberately
did not smuggle in: **identity** (ADR-0038 — which provider, and wiring it
through the session, the SSE stream and the secure-plane bootstrap) and **a
production catalogue** (where reviewed blueprints live, and a validated parse
that cannot mint an artefact nobody reviewed). Either is a phase. After them,
packaging and infrastructure can consume this foundation.

---

# Where we are — 2026-09-03 (P19)

## What P19 delivered

**The verified-email guard that ADR-0038 described and nothing implemented.**

`students.email_verified` existed from migration `0001`. Its comment said a
secure step required it. ADR-0038 said so too. The column was written `true` by
test fixtures and read by **nothing** — so the one place in this system where a
student types a password had no verification gate on it, and two accepted
documents said it had one. That is what P19 fixes, and finding it is what
reordered the roadmap in the first place.

- **ADR-0056** — verification is established at authenticated login from a
  signature-verified ID token, persisted server-side, and enforced from that
  persisted state. Deliberately **not** a live provider re-read at each step:
  that would mean holding a provider access token in the conversation plane for
  no other purpose. ADR-0038 carries an explicit amendment saying so, and
  migration `0011` rewrites the column comment that claimed otherwise.
- **`packages/oidc`** — Authorization Code + PKCE (S256) behind a port that
  returns identity **facts** and never a token. Every endpoint comes from the
  provider's discovery document; no Cognito URL template is written down.
- **Four outcomes, one of which opens a step.** `verified`, `unverified`,
  `no_email`, `no_verification_claim`. All four still sign the student **in** —
  they are authenticated, and refusing them a session would leave them unable to
  reach the conversation that explains why a secure step is closed. The secure
  step is what refuses, with `email_not_verified` (403).

## The finding of the phase

The adapter's first version read `email` and `email_verified` from the ID token
alone. OIDC Core §5.4 returns a scope's claims from the **UserInfo endpoint**
when an access token was issued, so against a certified provider it reported
`no_email` for **every student, verified ones included**. Cognito does the other
legitimate thing and puts them in the ID token — so this would have been
invisible in production and total against anything else.

Worse: the four "expects false" tests all passed while it was broken. They were
right for the wrong reason. Only the *verified* case failing exposed it. The
suite now runs **two** provider shapes and one case where the two sources
disagree, because the ID-token block alone would still pass against an adapter
that read UserInfo only.

## Standing limitations — what changed, and what did not

- **Chromium/browser resource contention is still UNRESOLVED.** Unchanged from
  P18, and repeated because it stays true: the P17 fix raised polls to 30s, and
  three green runs are not evidence that the underlying contention is gone. They
  are evidence that a longer timeout hides it.
- **A student who verifies their address later must sign in again.** Accepted,
  not a defect: it is the direct consequence of ADR-0056's choice, and it is
  stated in the ADR rather than left for someone to discover.
- **One deliberate regression (R5) is not reachable.** The UserInfo response is
  bound to the ID token's subject, and no conforming provider can be made to
  break that binding — `oidc-provider` forces `sub` after the account's claims.
  The check is correct and kept; it is untested, and saying so is better than a
  test that passes for an unrelated reason. See `docs/p19-regression-audit.md`.
- Everything from the P14–P18 lists still holds: no alerting transport, the
  learning loop still open, documents blocked on retention, and P17's accepted
  cost — a crashed runner raises a specialist intervention.

## What is next, on the evidence

Identity is no longer a blocker. **A production catalogue** is the one that
remains: where reviewed blueprints live, and a validated parse that cannot mint
an artefact nobody reviewed. After it, packaging and infrastructure can consume
this foundation.

Identity itself is deliberately *narrow* rather than finished — MFA policy,
specialist identity and guest conversations were all left out of P19 by
agreement, and each is a phase of its own when it is wanted.

---

# Where we are — 2026-09-03 (P20)

## What P20 delivered

**A catalogue that can prove what it loaded was reviewed.**

The recorded blocker was *"there is no blueprint parser"*. The investigation
that opened this phase measured something worse: the two gates between an
artefact and a real run — `checkExecutable` and `checkUsable` — passed a
blueprint and a mapping set invented from JSON, because `status: "reviewed"`
and `reviewedBy` are fields **inside the artefact**. A parser was therefore the
thing that would create the hole, not close it.

- **ADR-0057** — an approval binds to CONTENT. Production asks one question:
  does an independent registry hold an approval for the hash of this exact
  canonical artefact? Nothing the document says about itself is consulted.
- **`packages/catalogue`** — parsers that rebuild field by field with real
  `Date` coercion, a canonical form, a SHA-256 content hash, an
  `ApprovalRegistry` **port**, and a loader whose central refusal is
  `not_approved`.
- **The two-person rule moved.** It lives on the approval, where it records what
  people did, rather than on two fields written by whoever wrote the document.

## The proof

Take an approved artefact, alter anything the system acts on — a credential
field's purpose, a date's format pattern, which profile field feeds a portal
field, a locator, the intake, whether the portal demands MFA, the page order —
and leave every reviewer-looking field untouched. All seven are refused on hash
mismatch. The reverse holds too: a document sharing id, version, author,
reviewer and every descriptive field with an approved one, differing only in a
removed mapping, is refused.

Both the Conversation Service and the Worker refuse to **start** on a catalogue
holding an entry no approval covers.

## Standing limitations — what changed, and what did not

- **P20 does not enable a production run, and must not be read as if it does.**
  It delivers a trustworthy loader for artefacts that do not exist yet.
- **No real university artefact exists.** Discovery is still network-blocked
  (measured 2026-09-03: `CONNECT tunnel failed, response 403` for the target
  hosts), and nothing has been through two people. A production catalogue
  directory today holds an empty registry, which refuses everything — correctly.
- **Document retention is still UNAPPROVED** — 0 of 10 types, 12 unresolved
  questions. A real entry requiring documents would block there regardless.
- **The registry is deliberately local.** Vahid's decision: establish the
  cryptographic and governance truth in this repository first. `ApprovalRegistry`
  is a port precisely so an AskiMate-KB-backed adapter can be added later
  without touching the parse, the canonical form, the hash or the loader.
- **Chromium/browser resource contention is still UNRESOLVED.** Unchanged, and
  repeated because it stays true.
- Everything from the P14–P19 lists still holds.

## What is next, on the evidence

Both recorded deployment blockers are now closed as *engineering*. What remains
is not code:

1. **Discovery access** — one command, blocked by network policy.
2. **A second reviewer** — the two-person rule is enforced structurally and
   there is no second named person.
3. **Retention determination** — externally owned, by design.

The largest remaining *engineering* question is one this phase did not create
and did not touch: `packages/requirements` implements ADR-0009 and ADR-0019 in
full and **has no callers at all**. That is a product-scope decision about
whether the requirements half of the system is in scope, not a defect.

---

# Where we are — 2026-09-03 (later)

**Date:** 2026-09-03 · **Phase:** P21 · **ADR:** ADR-0058

## The headline

**A student can start an application, and cannot start one any other way.**

Every phase from P4 to P20 built something downstream of a step nobody could
take. The run-start endpoint took a `blueprintId` — a string a client chose,
which proves nothing about what a person was shown. That is now gone.

```
list reviewed targets → the server puts ONE to the student, rendered
→ the student names the hash of THAT offer → the case opens
```

Two gates stand between a conversation and a case:

- **Gate 1** — an offer can only be built from a **reviewed catalogue entry**.
  It needs almost no code, because P20's loader already refuses to start a
  process on an entry no approval covers.
- **Gate 2** — a case opens only when the authenticated student names the hash
  of an offer **this server made to them, in this conversation**, and that
  offer still rebuilds from the catalogue as it is now.

## What P21 delivered

**Stage A (`f89cbf2`) — three case states removed.** `REQUIREMENTS_RESOLUTION`,
`ELIGIBILITY_REVIEW` and `BLUEPRINT_REQUIRED`. Not renamed: `caseStateFor` was
total over `WorkflowPhase` and mapped **no phase** to the first two. They were
entered only because the spine walk steps through one element at a time — they
described the walk, not the case. The third was never entered at all.

**Stage B — the journey.** `GET /v1/application-targets`,
`POST /v1/conversations/{id}/target-offers`, and a run-start route that reads an
`offerHash` and **does not read `blueprintId` at all**. Migration `0012` adds
`target_offered` and `target_requested`, the CHECK constraints that keep each
column meaning one thing, and `conversation_target_exchange` — the view the run
route reads Gate 2's first condition from.

## The three things worth understanding

**Gate 2 has two conditions and needs both.** The hash must be in this
conversation's log *and* must still rebuild from the live catalogue. The log
alone would honour an offer whose target was retired or re-reviewed;
re-derivation alone would honour a hash a client computed for itself. Removing
either is a deliberate regression that the P21 suite catches, on different
tests.

**No clock is involved, and that is the point.** An offer stays valid exactly as
long as the thing it describes is unchanged. A timeout would refuse unchanged
offers and accept changed ones inside the window.

**Ambiguity is a safety refusal, not a UX preference.** `submissionKey` is
`(student, institution, course, intake, attempt)` and does **not** contain the
blueprint, so two reviewed routes to the same course and intake produce the same
key: starting one permanently blocks the other for that student. The choice is
irreversible, so nothing picks a default, a best match, or the first one found.

## Known limitations — what changed, and what did not

- **P21 does not enable a production run either.** The journey is real and the
  gates are real; what is missing is a reviewed artefact to point them at.
- **No real university artefact exists.** Unchanged from P20. Discovery is
  network-blocked and nothing has been through two people. The P21 suite loads
  a catalogue over the gated **test** portal this repository owns.
- **One case per conversation is a real constraint.** A student who requests a
  second, different target in the same conversation gets the existing case back.
  The request *is* recorded, so running into the constraint is visible rather
  than silently dropped. A multi-application-per-conversation design is a
  product decision, out of scope here.
- **`requestEvidence.channel` was false and is now true.** It said
  `askimate_chat` unconditionally; since ADR-0051 this system's own conversation
  is the surface. `aas_conversation` names it.
- **Document retention is still UNAPPROVED.** Unchanged.
- **The requirements boundary is unchanged.** Nothing here consumes requirement
  knowledge and no student data leaves. ADR-0009's service stays unwired —
  which the C1 investigation concluded is where the boundary belongs.
- Everything from the P14–P20 lists still holds.

## What is next, on the evidence

Unchanged from P20, and unchanged *because* it was never engineering:

1. **Discovery access** — one command, blocked by network policy.
2. **A second reviewer** — enforced structurally; there is no second person.
3. **Retention determination** — externally owned, by design.

---

# Where we are — 2026-09-04

**Date:** 2026-09-04 · **Phase:** P22 · **ADR:** ADR-0059

## The headline

**The student can now read what they are approving — and until this phase, nobody outside the test
suite could.**

P21 made the journey startable. This is the gate in the middle of it. The measurement that produced
the phase:

| Fact | Evidence |
|---|---|
| The preview was rendered | the orchestrator's `authorise` step carries `presentedText` |
| The driver could read it | `previewHashFor`, *"a read, for a surface that has to render the preview"* |
| Its only callers were tests | four, all in `run-driver.test.ts` |
| **No route published it** | the service's route list had no preview resource |
| **The stop was silent** | every other pause appends a message; this one appended none |
| The decision needed a hash no client could get | `journey.test.ts` rebuilt the preview in-process |

The last row is the finding. The authorisation gate — the one place the whole safety design rests
on — was passable by a test that held the blueprint, the mapping set and the plan, and by nothing a
browser could do.

## What P22 delivered

`GET /v1/conversations/{id}/runs/{runId}/preview`, returning the rendered application and its
content hash from **one** read of the step, so what is displayed and what is authorised cannot come
from two different renderings. `no-store`, owner-checked, never persisted, never logged.

One assistant message when the case reaches `AWAITING_STUDENT_AUTHORISATION` — a pointer carrying no
part of the application, written off the single hop into that state so it is said once.

And the published contract gained the `POST .../runs/{runId}/decision` path, which it had never
documented, alongside the `StudentDecision` union.

## The one thing worth understanding

**The preview is a projection, never a stored message.** Three reasons, all of which the code
already stated: `SubmissionPreview.toJSON()` throws precisely to keep the plaintext out of logs and
events, and a conversation event is an event; a stored copy goes stale silently, because the
decision route compares against what would be rendered *now*; and a second plaintext copy of the
student's data would need its own retention answer, which does not exist.

## Known limitations — what changed, and what did not

- **The React client still cannot reach any run endpoint.** It implements the conversation and the
  secure turn and nothing else — no target listing, no offer, no run start, no preview, no decision.
  That is the next phase, and it was impossible before this one: a UI cannot render a preview no
  route serves.
- **P22 does not enable a production run.** Unchanged: no real reviewed artefact exists.
- **Nothing is submitted.** Unchanged, and structural.
- **Document retention is still UNAPPROVED.** Unchanged.
- Everything from the P14–P21 lists still holds.

## What is next, on the evidence

The student-facing client is now the largest actionable gap: every consequential decision from P11
to P22 exists over HTTP and none of them is reachable from the only surface a student has. Nothing
about it needs an external fact or a product decision — the journey, the contracts and the refusals
are all settled.

The three standing blockers are unchanged, and none is engineering: discovery access, a second
reviewer, and the retention determination.

---

# Where we are — 2026-09-04 (later)

**Date:** 2026-09-04 · **Phase:** P23 · **ADR:** ADR-0060

## The headline

**A student can now open a conversation and read where their application stands — and until this
phase, neither was possible.**

P22 finished the last gate. The next question was where the client lives, and the answer turned out
to matter more than the client: `apps/chat-integration` is **not** the student surface, and building
there would have put the journey behind a second identity system and a second event log.

## Why `apps/chat-integration` is not the surface

| Evidence | Where |
|---|---|
| *"RESEARCH BUILD — NOT THE PRODUCTION INTEGRATION"*, built on the **archived** AskiMate codebase | its own `index.ts`, `README.md` |
| *"Research-only … not part of the product's behaviour"* | ADR-0028 |
| *"conversation-service ← was chat-integration"* | ADR-0039 |
| Its surface files: **"Discard. Replaced by the real dashboard"** | Phase-E audit §5 |
| *"PROVISIONAL — not an AskiMate interface"* | `ChatView.tsx` |
| No `bin.ts`, no `main.ts`, absent from the five deployables | `docs/deployables.md` |

And three facts that make it unusable rather than merely unintended: it **cannot hold the session**
(a `__Host-` cookie is browser-bound to one origin, and that origin is the Conversation Service's);
it is **already a second source of truth** (`askimate_*` tables, its own JWT identity, and per
ADR-0041 a legacy event log); and it can represent **two of the nine** things the journey needs —
conversations and messages, with no notion of a run at all.

The client therefore belongs to the Conversation Service, exactly as the secure control belongs to
the Secure Service (`control-client.ts` + `build-control.ts` + `express.static`).

## What P23 delivered — and what it deliberately did not

**No UI.** What it delivered is the four things a client needs in order to exist without becoming a
second source of workflow truth:

- `POST /v1/conversations`, `GET /v1/conversations`, `GET /v1/conversations/{id}` — **all three
  published in the contract since it was written, none implemented.** Every conversation in this
  repository was a raw `INSERT` in a test.
- `GET /v1/conversations/{id}/runs` — a **read**: no checkpoint, no hop, no event, no announcement.
  Without it a client would have to cache the run id, the step and the offer hash to know what to
  draw.

## Known limitations — what changed, and what did not

- **Still no student UI.** That is now genuinely next, and it is unblocked for the first time.
- **`apps/chat-integration` is untouched.** Its retirement is a separate decision; nothing depends
  on it.
- **P23 does not enable a production run.** Unchanged: no real reviewed artefact exists.
- **Nothing is submitted.** Unchanged, and structural.
- **Document retention is still UNAPPROVED.** Unchanged.
- Everything from the P14–P22 lists still holds.

## What is next, on the evidence

The student client, in `apps/conversation-service`, bundled the way the secure control is. Every
route it needs now exists and every one of them is proved by a test that calls it the way a browser
would. The three standing blockers are unchanged and none is engineering.

---

# Where we are — 2026-09-04 (P24)

**Date:** 2026-09-04 · **Phase:** P24 · **ADR:** ADR-0061

## The headline

**The published API can now represent every interaction the journey needs — and one of them could
not be represented at all until this phase.**

P23 made the journey readable. Before writing a client, I worked through what one would actually do
at each state, and found that `confirm_handoff` was unformable: its hash is over a message the
**orchestrator renders**, not over anything in the conversation log. A client could only produce it
by re-implementing `handoffMessageOf` and `hashOfText`, then guessing which message in the
transcript it applied to — a client holding workflow logic, which the boundary forbids.

`RunDriver.handoffHashFor` already existed, public, its own comment saying *"the client needs the
same number to send back, and it must come from the SERVICE"*. One caller: a test. No route.

## What P24 delivered

`GET /v1/conversations/{id}/runs` now answers `{ run, pending }`, where `pending` is
`{ decision, contentHash }` or `null`. Every hash comes from the same source the decision route
validates against — the open proposal's playback hash, the preview's content hash, or the hash of
the handover message the orchestrator would render now — and both halves of the answer come from
**one** situation, because two would be two derivations able to disagree.

`cancel` is deliberately absent: it is available at every step and carries no hash, so a client
offers it always rather than because a read said so.

## The measurement worth keeping

One mutation survived: removing the handoff read's open-token check. I assumed a shadowed control
and wrote a test for the state it guards — and **the state does not exist**. Completing the handoff
in the case log moves the step past `student_handoff` immediately, because the account's stage is
derived from `HandoffCompleted` rather than remembered.

The test was deleted rather than kept green. The check stays, documented as unreachable, because the
read has to match the validator by construction and not by the coincidence that two things move
together today.

## Known limitations — what changed, and what did not

- **Still no student UI**, and it is now genuinely unblocked: every state a client must render has a
  read, and every decision it must offer has a published hash.
- **P24 does not enable a production run.** Unchanged: no real reviewed artefact exists.
- **Nothing is submitted.** Unchanged, and structural.
- **Document retention is still UNAPPROVED.** Unchanged.
- Everything from the P14–P23 lists still holds.

## What is next, on the evidence

The student client, in `apps/conversation-service`, bundled the way the secure control is
(`control-client.ts` + `build-control.ts` + `express.static`). Nothing in the journey now requires
the client to derive anything the server can state.

---

# Where we are — 2026-09-04 (P25)

**Date:** 2026-09-04 · **Phase:** P25 · **ADR:** ADR-0060

## The headline

**A student can walk the journey in a browser.** Reviewed targets, a deterministic offer, an
explicit request in their own words, the interview, the preview, and a hash-bound authorisation —
through one page, over the published API, with nothing derived on the client.

The page lives in `apps/conversation-service`. Not in `apps/chat-integration`, and that is a
structural fact rather than a preference: the session is a `__Host-` cookie, which the browser binds
to exactly one origin with `Path=/` and no `Domain`. A client served from anywhere else would have
no session at all. So the page is built and served by the app that owns the origin, the same way the
secure control is (`control-client.ts` + `build-control.ts` + `express.static`).

## What P25 delivered

- **`client/transport.ts`** — fetch calls and nothing else. Every read is parsed by the contract's
  own parser; a body the parser refuses becomes a refusal, not a screen.
- **`client/journey.ts`** — `refresh()` rebuilds the whole view from the server, and it is the same
  path a fresh load takes. SSE frames trigger a re-read and are then discarded; what they say
  decides nothing here.
- **`build-client.ts`** — bundles the page. The document is deliberately empty of content: every
  sentence a student reads comes from the server.
- **A boundary rule** that no client file may import a server module beside it, or any capability
  package that would let a browser decide what the run does next — and that refuses to pass when it
  is looking at nothing.
- **Fifteen browser tests**, real Chromium against a real Postgres and the real app.

## What only a real client could find

Two defects, both invisible to every server-side test in the repository:

1. **`parseConversationEvent` did not know `target_offered` or `target_requested`.** Added in P21,
   never taught to the parser. Any consumer parsing a real conversation containing them got `null`
   — and nothing had noticed, because until this phase nothing outside the service parsed one. The
   contract test now asserts every member of `EVENT_KINDS` round-trips.
2. **The page held a run reading the server had not just confirmed.** A failed re-read left the
   previous answer on screen: a decision button still bound to a hash the server no longer names.

The second was found by chasing a regression that survived, which is the measurement worth keeping
from this phase — see below.

## The measurement worth keeping

Two of eleven mutations survived on the first attempt, and both survivals were findings.

Removing a package from the client's forbidden list changed nothing, because **no client file
imports it** — the loop never matched, so the mutation never executed. A rule whose only evidence is
"nothing violates it yet" will be quietly weakened before the day it is needed, so the rule is now
asserted as data in `ci-guard.test.ts`.

Deleting the transport's contract check changed nothing either, and that one executed on every read
— it simply had nothing to do, because the real server is correct. The response is now corrupted at
the browser's network boundary with `page.route`, exactly as a version-skewed server would corrupt
it. Writing that test is what surfaced the stale-reading defect.

## Known limitations — what changed, and what did not

- **There is now a student UI.** The three-phase-old "still no student UI" line is closed.
- **The interview question is never shown**, because it is never appended to the log:
  `#putToTheStudent` writes only the playback, after an answer. A real gap in the journey, and a
  server-side one. Recorded in the test and in the audit; not this phase's to close.
- **`apps/chat-integration` is untouched**, and is now demonstrably not the student surface. Its
  retirement is a separate decision.
- **P25 does not enable a production run.** Unchanged: no real reviewed artefact exists.
- **Nothing is submitted.** Unchanged, and structural.
- **Document retention is still UNAPPROVED.** Unchanged.
- Everything from the P14–P24 lists still holds.

## What is next, on the evidence

The interview gap above is the first thing the journey now visibly lacks, and it is the smallest
server-side change of anything outstanding: the question the run is waiting on has no representation
a client can read. Everything else that remains is one of the three standing non-engineering
blockers.

---

# Where we are — 2026-09-04 (P26)

**Date:** 2026-09-04 · **Phase:** P26 · **ADR:** ADR-0062

## The headline

**The interview has two voices.** The question the run is waiting on is in the conversation log, so
a student can read it, and a client can render it with no workflow knowledge at all.

P25 found this by being the first thing to look. Driving the page through a full case, the interview
stop drew a blank screen: a position to render, and nothing to answer.

## What was actually wrong

One line in `packages/orchestrator/src/run.ts`:

```ts
return { kind: "interview", action: await nextAction(state.interview, model) };
```

`nextAction` composes the question. The step carries it. The run driver threw it away.

That is the shape ADR-0051 opened with — *"the orchestrator composed questions and the run driver
threw them away"* — and the fix then went half the distance: the student's *answer* got a durable
home, and the *question* never did. Every test that exercised the interview supplied the answer from
the test process, so nothing needed the question to exist.

## What P26 delivered

- **`value_asked`**, a conversation event naming the field. Content-free: the words beside it are
  the step's own, never a second composition, because a driver that asked the model again could ask
  something other than what the run is waiting on.
- **`openQuestion`** and the `open_value_questions` view — one rule, written once, read in both
  places. The gate that makes asking idempotent without a marker column.
- **Three call sites**, each somewhere the driver already writes. The one that matters is
  `#confirmValue`: a client that has just confirmed a reading re-READS the run rather than advancing
  it, and a read must not append — so the next question has to be drawn by the confirmation itself
  or the journey stalls.

## The measurement worth keeping

Eleven regressions, all caught, but two needed a second attempt and **both faults were in the
harness rather than the code**. One mutation built a shadow object and discarded it, so it never
executed. One was run against the test suite when the control is a lint rule no test can observe.

Fixing the first is what mattered: it exposed an assertion that said "a message was written", which
any message satisfies and which proved nothing about where the words came from — while the entire
point of the ADR is that they are the step's. The question's text is now asserted against the
field's own label.

## Known limitations — what changed, and what did not

- **The interview gap P25 recorded is closed.** The browser test asserts the question in the
  transcript rather than working around its absence.
- **The attempt count is unchanged.** An answer the model could not read still leaves no proposal
  and does not count towards `MAX_ATTEMPTS_PER_FIELD`. `value_asked` could carry that counter now;
  making it do so would change when `information_unobtainable` fires, which is a behavioural change
  to an escalation and not this phase's.
- **P26 does not enable a production run.** Unchanged: no real reviewed artefact exists.
- **Nothing is submitted.** Unchanged, and structural.
- **Document retention is still UNAPPROVED.** Unchanged.
- Everything from the P14–P25 lists still holds.

## What is next, on the evidence

The journey is now walkable end to end in a browser with nothing missing that a student would
notice. The three standing blockers are unchanged and none of them is engineering: a reviewed
catalogue artefact for a real institution, a retention decision, and discovery evidence for a real
portal.

---

# Where we are — 2026-09-04 (P27)

**Date:** 2026-09-04 · **Phase:** P27 · **ADR:** ADR-0063

## The headline

**The published contract is now checked against the routes that exist**, by walking the real Express
layer stack rather than by reading the source. Six discrepancies had accumulated behind a guard that
loaded both OpenAPI documents and read only their enums — and reading the resulting diff found a
seventh, in the secure document's authentication default.

## What was actually wrong

`scripts/contract-drift.test.ts` has pinned the wire vocabulary against the domain since P13 — three
lists checked against each other rather than one trusted three times. It loads the YAML. **It never
read `paths`.**

So the vocabulary could not drift and the route table drifted for twenty-three phases:

| Discrepancy | Since |
|---|---|
| `GET /health` published; the real endpoint is `GET /healthz` at the app root | always |
| Server base `…/v1` with internal paths carrying their own `/internal/v1` → `…/v1/internal/v1/…` | always |
| The bootstrap route — **public, session-authenticated** — had no schema at all | P4 |
| Three `/internal/v1` review and intervention routes unpublished | P11 |
| The secure plane's frame-token route, and its `/healthz`, unpublished | P4 |
| `secure.v1.yaml`'s `security` default indented inside `components:`, where OpenAPI ignores it | always |

Two findings matter more than the rest.

**The bootstrap route**: public, session-authenticated, handing out a capability, served for
twenty-three phases with nothing describing it.

**The misplaced security default**: `security` under `components:` is not a field, so the secure
document declared no authentication on its three student-facing operations — including
`POST /v1/secret-requests/{requestId}/secret`, the one endpoint in this system that carries a
secret. Proved pre-existing against `git show HEAD`. Nothing was ever exposed — the service
authenticates them with the `__Host-` secure cookie and the two-origin browser suite proves it — but
the contract is what a reviewer reads and a generated client builds against. The path guard would
never have found this one; reading the diff did.

## What P27 delivered

- **A guard that reads the router.** A regex over `router.get("…")` reads what a file says; the
  layer walk reads what the process would dispatch against. Built with every optional surface
  supplied, because the route set depends on configuration. An empty stack throws — an empty set
  would agree with an empty contract.
- **A corrected base URL.** The conversation document now names the origin and every path is
  literally the path served, matching `secure.v1.yaml`, which was already right. That is what makes
  the comparison possible at all.
- **Four operations described from their handlers**, not invented, plus `/healthz` in both documents
  and the secure plane's frame-token route.
- **Three deliberate exceptions as data** — the two OIDC redirects and `/dev/session` — each citing
  the ADR that decided it, so the list cannot grow to cover a new surface silently.

## The measurement worth keeping

Fourteen regressions, fourteen caught — and the audit says plainly that this is a weak number,
because every mutation targets a control written in the same phase. The real measure of P27 is that
seven discrepancies existed and nothing was looking.

The one worth naming is R7: it adds a route to `routes.ts` and publishes nothing, which is exactly
what happened in P4 and P11. It fails now because the guard reads the router.

A harness hazard is recorded too, because it nearly cost the security fix: `run.py`'s `save()` skips
when a snapshot exists, so R13 restored a `secure.v1.yaml` taken before the fix and silently
reverted it. Only reading the file back from disk caught that — the same trap as P25, and the same
lesson: a restore is trustworthy only when what it restored is read back and checked.

## Known limitations — what changed, and what did not

- **No authentication boundary moved, and one was restored to the document.** Every newly published
  internal route declares `serviceMutualTls`; the bootstrap inherits the `__Host-` cookie default;
  and the secure plane's default now sits where OpenAPI reads it. Four regressions check these,
  including both directions on the newly published routes.
- **The OIDC redirects are excepted, not schema-checked.** They have no request or response body,
  and ADR-0056's own tests cover the flow.
- **P27 does not enable a production run.** Unchanged: no real reviewed artefact exists.
- **Nothing is submitted.** Unchanged, and structural.
- **Document retention is still UNAPPROVED.** Unchanged.
- Everything from the P14–P26 lists still holds.

## What is next, on the evidence

The route table and the event vocabulary are both pinned now. The remaining blockers are the same
three, and none is engineering: a reviewed catalogue artefact for a real institution, a retention
decision, and discovery evidence for a real portal.

---

# Where we are — 2026-09-05 (P28)

**Date:** 2026-09-05 · **Phase:** P28 · **ADR:** ADR-0064

## The headline

**A run can no longer sit in an interview nobody will ever answer.** When the interview decides it
cannot obtain something, the run stops for a specialist, the student is told the truth, and the page
stops showing a step as though it were live.

## What was actually wrong

`nextAction` returns five kinds. The driver honoured three and **silently dropped two**. The tell was
in the code: `interviewAsk`'s comment listed the non-question kinds as "`confirm`, `complete` and
`escalate`" and omitted `request_document` altogether — the author enumerated the union and missed a
member.

`escalate` was live and reachable with the shipped catalogue. Three rejected readings of the last
outstanding field, and the interview decides a specialist must look. Nothing happened — and because
`interviewAsk` also matched only `ask`, everything the student said afterwards was ignored too.

## What P28 delivered

- The stop, through **the mechanism that already exists**: ADR-0048's intervention, reason
  `information_unobtainable` — a word the domain has carried since P10 whose own definition is this
  situation and which nothing had ever raised.
- `#raiseForSpecialist`, extracted so the mandatory-review path and this one share **one**
  construction rather than two that could disagree about which runs wait on a person.
- The check on the **message path**, not only while advancing. A client that has just sent a message
  re-reads rather than advances (ADR-0060), so the first implementation would never have fired in
  the real journey. The browser test caught it.
- A truthful position line: a run waiting on a person no longer reads as a live interview.

## The measurement worth keeping

Ten regressions, seven caught first time. The three that survived are the useful part, and each got a
different answer:

- **One control did not exist.** Removing the decide-path check changed nothing, because every test
  reached the stop through the message path. Working out why it is *not* redundant produced the
  missing test: `#correct` appends the rejection and then re-derives, so a crash between them leaves
  an exhausted log and a running run that only an advance can stop.
- **One mutation of mine was a no-op** — `reviewMessage(...) && unobtainableMessage(...)` evaluates
  to the second operand. Second phase running that I have made that mistake.
- **One branch is genuinely unreachable** and is asserted as data rather than faked.

And a browser test of mine was a race — six composer round trips with a 400ms sleep, passing alone
and failing under load. Replaced by putting each proof where it can be made honestly.

## Known limitations — what changed, and what did not

- **Document upload is not built, and that is deliberate.** ADR-0022 governs disclosure and ADR-0023
  requires a retention period to be determined rather than invented; that determination is
  **UNAPPROVED**. A test asserts the schema still holds no table or column for a document.
- **A declared `requiredDocuments` is silently ignored by the run.** Measured, not assumed: a
  document mapping becomes an `upload`, never a `blocker`, so the interview is never entered on its
  account. This is worse than the stranding P28 fixed and it is the first thing document support must
  address. Recorded in ADR-0064 §4.
- **P28 does not enable a production run.** Unchanged: no real reviewed artefact exists.
- **Nothing is submitted.** Unchanged, and structural.
- Everything from the P14–P27 lists still holds.

## What is next, on the evidence

The journey no longer strands anywhere a student can reach. The three standing blockers are
unchanged and none is engineering: a reviewed catalogue artefact for a real institution, the
retention determination, and discovery evidence for a real portal. The largest *engineering* item
now visible is document support — and it is gated on the second of those.

---

# Where we are — 2026-09-05 (P29)

**Date:** 2026-09-05 · **Phase:** P29 · **ADR:** ADR-0065

## The headline

**A run the orchestrator hands to a person now actually stops.** `nextStep` answers `specialist` from
ten places — seven reachable, in five kinds of situation; the driver acted on none of them, so the run
stayed `running`, the worker advanced it for ever, and the student was told nothing at all.

## What was actually wrong

Measured through the real driver, against the shipped fixture catalogue:

```
step: specialist   status: running   phase: awaiting_specialist
interventions: 0   messages: 0       still due for the worker: true
```

`FIXTURE_BLUEPRINT` reaches it honestly. It attaches "Upload your passport". `planFill` routes a
document mapping to `uploads` and never to `blockers`, so the interview never hears about it; every
field being confirmed, the run walks to `buildPreview`, which refuses `document_missing`. **The
architecture was already declining to proceed. Nobody was acting on the refusal.**

## The separation that made this phase possible

P28 left these entangled as "document upload is blocked". They are two problems:

1. **A planner decision that did not reach the system.** No document is held or sent by declining to
   proceed, so neither ADR-0022 nor ADR-0023 is engaged. Fixed here, with existing machinery, no
   schema change and no new state.
2. **No approved mechanism to obtain, hold or transmit a document.** ADR-0022's disclosure
   determination and ADR-0023's retention basis, both unapproved. Untouched, and not worked around.

## What P29 delivered

- `#stopForSpecialist`, through `#raiseForSpecialist` — a third caller, still one construction.
- The orchestrator's `reason` carried losslessly in `checkpoint.target`, never mapped onto the closed
  recovery vocabulary that alerting routes off. `recovery.ts` says why in as many words.
- A message that tells the student a person has it and **does not name the document**, because naming
  it would read as a request nothing can receive.
- Proof over the **published** `GET .../runs`, which is what a client reads after a message.
- Proof that a second, non-document reason stops the same way, so a fix scoped to the one situation
  that was measured cannot pass.

## The measurement worth keeping

Ten regressions, eight caught first time. The two survivors were the same mutation against the P29
and P28 stops, and both survived for one reason: **a comment written in P28 named the wrong cause for
a control that is nonetheless real.** Falling through to `checkpointAfter` does not reset the status —
`saveCheckpoint` writes `input.status ?? from`. It burns a revision, raises `RunConcurrencyError`, and
spends one of `#decide`'s three retry attempts, and the retry makes the answer come out right anyway.
Both stops now assert the checkpoint is written once. A comment that names the wrong reason is worse
than none: the next reader deletes the control for the reason the comment gave.

Also regressed: removing `buildPreview`'s `document_missing` refusal. The run then does not strand —
it **proceeds to `authorise` with the passport silently dropped.** That is what the stop is protecting.

## Known limitations — what changed, and what did not

- **The entry-level `requiredDocuments` is still ignored.** Narrowed, not closed. There are two
  declarations and neither derives from the other: the structured one on a **blueprint page** now
  stops the run; the flat string list on the **catalogue entry** reaches only `InterviewState` and the
  published listing, and a run against an entry declaring `["passport"]` whose blueprint attaches no
  document reaches `request_secret`, still `running`. Asserted, not assumed. What it *means* is a
  product decision (ADR-0065 §6, §7c).
- **Document upload is still not built, and still deliberate.** The schema assertion holds: no table
  and no column for a document.
- **P29 does not enable a production run.** Unchanged: no real reviewed artefact exists.
- **Nothing is submitted.** Unchanged, and structural.
- Everything from the P14–P28 lists still holds.

## What is next, on the evidence

Every step the orchestrator can answer with now reaches either the student or a person. The three
standing blockers are unchanged and none is engineering: a reviewed catalogue artefact for a real
institution, the retention determination, and discovery evidence for a real portal. Document support
remains the largest engineering item and remains gated on the second — with the honest note that part
of it is not engineering at all, but a decision about whether AskiMate ever holds a document.

---

# Where we are — 2026-09-05 (P30)

**Date:** 2026-09-05 · **Phase:** P30 · **ADR:** ADR-0066

## The headline

**Which declaration decides what a document requirement means is now answered, measured and guarded.**
There are three, not two; only one of them may decide anything; and P29's account of the first two was
wrong.

| | Declared on | What it is | Decides |
|---|---|---|---|
| **A** | `BlueprintPage.requiredDocuments` | discovery's record of the file inputs it SAW | **nothing** |
| **B** | `MappingSource {kind:"document"}` | the reviewed, two-person, blueprint-pinned decision | **everything** |
| **C** | `CatalogueEntry.requiredDocuments` | domain document TYPES, shown to the student | **nothing** |

## What the measurement proved

Remove A and keep B: the run still stops for a specialist, and all ten of ADR-0065's tests pass
unchanged. Keep A and remove B: the run reaches `authorise`. **A is neither necessary nor
sufficient.** ADR-0065 §6 credited it with stopping the run; what actually stops the run is the
mapping. The fixture author gave both the same string, which is why they looked linked.

## What P30 delivered

**No behaviour changed.** The system already does the right thing; nobody had written down that it
does, or why it must keep doing it.

- A `check-boundaries` rule: the planning path may not mention `requiredDocuments` at all. The
  tempting change — joining the declarations up because they share a name — is *behaviourally silent*
  against the shipped fixture, which is exactly why the control has to be structural.
- Five tests pinning both mutation directions, the contradiction case, and the interview's
  unreachable `request_document` capability.
- Doc comments on all three declarations. The driver's said *"Document kinds the interview must
  collect"*, which was never true of any code path.

## One thing fixed that was not about documents

`packages/catalogue/src/target.ts` — the file holding both of ADR-0058's gates — joined its ambiguity
key with a **raw NUL byte**, which is git's binary heuristic. Every diff of it read `Binary files
differ`, so no change to it had ever been reviewable, including this phase's. Escaped to `\u0000`:
identical runtime string, text file again, and the separator has a test it never had. Found by
reading the file, not by looking for it.

## The archaeology, because it explains the ambiguity

`InterviewState.requiredDocuments` and the orchestrator's `if (plan.blockers.length > 0)` interview
gate were written **on the same day** and were incompatible from that moment: the interview asks for
documents only once no field is outstanding, and the orchestrator enters it only while one is.
`CatalogueEntry.requiredDocuments` was added in P1 to feed an interview state nothing would reach;
P20 folded it into the reviewed, hashed artefact, giving it two-person approval authority it was never
designed for; P21 put it in front of students. Each step was locally reasonable. None decided what the
field means, and **no ADR before ADR-0064 mentions either field.**

## Known limitations — what changed, and what did not

- **The promise in the offer is still unkept, and that is now stated rather than hidden.** A reviewed
  entry declaring `["passport"]` produces `Documents needed: passport` in the offer the student
  accepts, and nothing asks for it, blocks on it, or records that it was not obtained. The defect is
  not that the passport is unenforced — it is that the non-fulfilment is invisible. Which half to fix
  is the product decision in ADR-0066 §6.
- **C may not be made authoritative in its present shape.** No `scope` (ADR-0021), no criticality or
  provenance (ADR-0009), and promoting it would be the authority hierarchy ADR-0019 forbids.
- **Document upload is still not built**, still deliberate, still blocked on ADR-0022 and ADR-0023.
- **P30 does not enable a production run.** Unchanged.
- **Nothing is submitted.** Unchanged, and structural.
- Everything from the P14–P29 lists still holds.

## What is next, on the evidence

Two facts make the outstanding product decision both urgent and cheap right now: **no approval exists
yet** — there is no `approvals.json` and the fixture catalogue declares `[]`, so the contradiction is
not live in any deployment — and **field names are inside the content hash**, so renaming either field
costs nothing today and invalidates every approval once one exists. The decision to take, in ADR-0066
§6's words: does AAS ever obtain a document, or only ever identify one? Everything else about
documents follows from that answer, and no amount of engineering produces it.

---

# Where we are — 2026-09-05 (P31)

**Date:** 2026-09-05 · **Phase:** P31 · **ADR:** ADR-0067

## The headline

**The document question was already answered, and P30 asked it anyway.** AAS is designed to obtain,
hold, extract from and transmit documents. That is not a preference — it is what ADR-0010, ADR-0016
and ADR-0022 decide, and what `packages/documents`, `packages/execution` and the end-to-end demo
already implement.

P30 read the three fields called `requiredDocuments`, found them inert, and concluded the product
boundary was open. It never read the document subsystem beside them. Corrected in ADR-0067.

## What blocks it — none of it design

| | Blocker | Owner |
|---|---|---|
| B1 | Twelve unresolved retention requirements | `data_protection_owner` |
| B2 | No lawful-basis determination for `disclose_document_to_institution` | a named determiner |
| B3 | No lawful-basis **activity** for holding, and no gate consulting one | determiner, then engineering |
| B4 | No transport by which a student can supply bytes | product + engineering |

Plus a third shape nobody had named: **pass-through**, transmitting without ever storing. It would
engage ADR-0022's one determination and none of ADR-0023's twelve. Recorded, deliberately not adopted
— whether bytes in memory for the duration of an upload are storage is exactly what ADR-0023 forbids
guessing at.

## What is built, and what is only wired

The gate that refuses documents ships in production; the thing it would refuse cannot exist yet.
`mayTransmit`, the disclosure authorisation, the specificity check and the `TransmissionRecord` are
all reachable from the runner. The **vault is reachable from nothing** — only `packages/extraction`
depends on it, and nothing depends on `packages/extraction`. That is the right order, and it is
ADR-0019's principle: the constraint ships before the thing it constrains.

## Measured this phase

- **103 real discovery runs** against Ulster Birmingham / QA Higher Education observed **zero file
  inputs and zero document requirements** — the application is behind a login and discovery never
  signs in. Nothing here yet knows what documents a real application asks for.
- **No approval exists** anywhere in the repository.
- **Field names are inside the content hash**, so renaming a document field is free today and costs
  every approval later. Now pinned by a test and regressed.
- **A gap between ADR-0022 and the vault**: with a retention policy configured and no lawful basis
  anywhere, a document stores. The ADR's *"the system will refuse to act until"* is true of sending
  and false of storing.

## Known limitations — what changed, and what did not

- **Nothing was built.** No upload path, no storage, no table, no engine, no schema change. The phase
  produced a decision record and one test.
- **The B3 gap is recorded, not closed.** Closing it means choosing where the lawful-basis machinery
  sits relative to `packages/documents`, which is a coupling this phase exists not to make.
- **Everything from P14–P30 still holds**, including that nothing is submitted.

## What is next, on the evidence

A single product/legal decision with four parts, and only three need someone other than an engineer:
**does AAS hold documents or pass them through; who determines the lawful bases and by when; how does
a student supply a document; and what are the frozen field names** — the last being cheap today and
expensive after the first catalogue approval. ADR-0067 §13 states each concretely. Everything else
about documents follows from those answers, and no amount of engineering produces them.

---

# Where we are — 2026-09-05 (P32)

**Date:** 2026-09-05 · **Phase:** P32 · **ADR:** ADR-0068

## The headline

**ADR-0022's storage guarantee is now true.** It said *"the system will refuse to act until"*
storing activities have a registered lawful basis. P31 measured that as true of sending and false of
storing. It is now true of both — and enforced by a type rather than by a convention.

## Why a line was not enough

The gate was a helper an implementation was **trusted to call**. There is one implementation, no
production one, and every caller of the storage boundary is its own test file. Nothing made the
S3 + KMS implementation — which does not exist yet — call it too.

So `assertStorable` is now the gate and its branded result is the only thing `store` accepts. The
vault holds no schedule and no register: not "it remembers to check", but "there is nothing left to
forget". ADR-0017's sentence, applied to documents.

## The two gates, and that they are independent

| | Refuses when |
|---|---|
| Retention (ADR-0010, ADR-0023) | no policy covers `(type, purpose)`, or someone recorded the question as unresolved |
| Lawful basis (ADR-0022) | no determination is registered for `store_document:<purpose>`, or the one that is was not made about this kind of document |

Established by mutation, not by assertion: removing either fails six tests while the other's tests all
pass. A justified period is not a basis for holding the data, and a basis says nothing about for how
long.

## What else this phase established

- **Every place document bytes can exist** — three, traced: the vault, extraction's reader input, and
  the buffer handed to `session.attach`, which uses `setInputFiles` with memory rather than a path, so
  no temporary file is written. No `bytea` column anywhere, no logging of contents, no
  document-shaped event.
- **`ProcessingActivity.documentTypes`** had been declared since Phase 1 and read by nothing. It is a
  determination's scope, and it is now enforced.
- **`reviewBy` is deliberately not re-checked at storage time**, because `requirePolicy` does not
  re-check a retention policy's either — staleness is a reporting concern, in CI.

## Known limitations — what changed, and what did not

- **Nothing is unblocked.** ADR-0067's B1 (twelve retention questions), B2 (the disclosure
  determination), B4 (a transport) and B5 (hold or pass through) all still need a person. This phase
  makes the refusal true so that *answering* them is what unblocks a document, rather than forgetting
  to.
- **Whether transient in-memory bytes are "storage" is still undecided**, and deliberately: neither
  ADR classifies them, and ADR-0023 forbids guessing at exactly this kind of question. Pass-through is
  neither adopted nor ruled out; what changes if it is chosen is now written down.
- **The real portal's document requirements remain unobserved** — 103 discovery runs, zero file
  inputs, because the application sits behind a login. The fixture is not evidence about a real
  institution.
- **Nothing is submitted.** Unchanged, and structural.
- Everything from the P14–P31 lists still holds.

## What is next, on the evidence

The four blockers are unchanged and three need someone other than an engineer. The freeze list before
the first catalogue approval is also unchanged: the two `requiredDocuments` field names, what a
mapping's `documentRef` is, and — added by this phase — the storage activity naming, which is now
part of the contract a deployment's `LawfulBasisRegister` must satisfy.
