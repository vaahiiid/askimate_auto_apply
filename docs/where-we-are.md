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

---

# Where we are — 2026-09-06 (P33)

**Date:** 2026-09-06 · **Phase:** P33 · **Document:** [`document-transport-options.md`](./document-transport-options.md) · **No ADR**

## The headline

**The document transport question is now a decision with two costed answers rather than an open
question.** Nothing was built, and no ADR was written — the correct outcome of this phase is that
the architecture is sufficiently specified to *choose*, and the choice is product and legal.

## The gap is two gaps, and the second was unnamed

**Student → AAS**: no route, no `multipart`, and a 64 KB JSON body parser.
**AAS → the browser**: `toStoredPlan` refuses uploads, and the Automation Runner has no database, no
vault and no cache. The precedent for that half is ADR-0042 — for a password, the answer was a Fill
Agent in the Secure Plane typing it into the runner's browser over CDP, never handing it over.

## The finding that matters most

`attach_document` is declared, marked verifiable, and **produced by nothing**. Uploads ride the
page's intent — and `pageValuesOf` reads instructions only, so the page's content identity is blind
to which document is attached. Replacing a passport does not change the intent key, while the
domain's own comment says *"Duplicates are visible to admissions."*

**Attachment needs its own intent identity under either option**, and that is blocked on nothing.

## Retry decides more than preference does

`executePlan` re-resolves `DocumentSource` on every execution. Under **hold**, retry is
`vault.retrieve` and transparent. Under **pass-through**, nothing can produce the bytes after a
crash: either the student supplies the document again at the least predictable moment, or something
holds them — which is holding under another name.

The architecture does not decide, but the evidence is not symmetric: the vault, the validity engine
and both storage gates are already built for hold and reachable from nothing, and pass-through's
motivating saving depends on the still-unclassified question of whether transient bytes are storage.

## Known limitations — what changed, and what did not

- **Nothing was built and nothing was decided.** One test was added, and it was regressed.
- **The classification question stays open**: neither ADR-0010 nor ADR-0023 says whether bytes held
  for the duration of an upload are storage, and ADR-0023 forbids guessing.
- **Format and size caps cannot be chosen yet** — 103 discovery runs observed zero file inputs
  because the application is behind a login. The fixture is not evidence about a real institution.
- **Nothing is submitted.** Unchanged, and structural.
- Everything from the P14–P32 lists still holds.

## What is next, on the evidence

Two items are transport-level, needed under either option, and blocked on nothing: giving attachment
its own intent identity, and binding a document to its case and target at acquisition (two of the
eight bindings do not exist). Both make either option safer and neither presumes which is chosen.

The decision itself: **does a document persist in AAS until the application is complete, or exist only
for one execution attempt?** Answering the first commits to twelve retention determinations and a
`store_document:<purpose>` basis; answering the second commits to a custody model across a plane
boundary and a retry story the current `DocumentSource` contract does not support.

---

# Where we are — 2026-09-06 (P34)

**Date:** 2026-09-06 · **Phase:** P34 · **ADR:** [ADR-0069](./decisions/0069-an-authorisation-is-spendable-only-in-the-application-it-names.md)

## The headline

**An authorisation is now spendable only in the application it names.** `DisclosureSubject.caseId`
has recorded which application an authorisation was given for since Phase 1 — the audit record copies
it, and the student is shown it as *"Which application:"* — and nothing compared it to anything.
`mayTransmit` checked withdrawal, document, content hash and host; `ExecutionContext` had no case in
it at all, so the check could not have been written even if someone had wanted to.

## The substitution the other four checks could not see

Same student, same passport, same university, same file — a **second application**. The student was
asked about the first and said yes, and that yes was spendable on the second. The transmission record
would then have named the *first* case, so the audit trail's answer to "why did this leave our
systems?" would have been confidently wrong.

The destination check does not cover it, and not by accident: two reviewed targets can share one
portal host. `ambiguousGroups` exists in `packages/catalogue` because routes collide on institution,
course and intake. Making the host stand in for the case fails four tests, including the happy path.

## What is checked, and what deliberately is not

The **case**, and only the case. `cases.student_id` is written from the conversation's own row and
`cases.blueprint_id` from an offer verified against that conversation's log, so one case names
exactly one student and exactly one target under a foreign key. Checking all three would be three
chances to disagree about one fact. No new identifier was introduced: `ClaimedWork.caseId` already
crossed to the runner and `DisclosureSubject.caseId` already recorded the binding.

Verified while establishing that, rather than assumed: student identity comes from the `__Host-`
session cookie; a client cannot supply a case id (a conversation that already owns a case gets that
one back, whatever was proposed); and the target comes from an `offerHash` checked against the
offers this conversation's own log says were made — a `blueprintId` in the request body is
deliberately not read.

## `documentRef` means two things, and the repository contains both

`BlueprintPage.requiredDocuments[].documentRef` is the **portal's field name** — `pageFrom` sets it
to `field.fieldRef`. `MappingSource { kind: "document" }.documentRef` is a **domain key** a reviewer
chose. The hand-written fixture writes `"passport"` into the first where the file input is
`"passport_upload"`, so the two readings are both present in the tree. It is harmless only because
ADR-0066 made the page's list causally inert. Nothing was renamed; a test now pins the meaning at the
one place the value is produced, and ADR-0069 states the rename as the smallest decision still to
take — free today, and costly once any catalogue approval exists.

## Attachment identity, frozen

`(fieldRef, documentRef, contentHash)`, all three inside the preview hash the student authorises
against; `documentId` deliberately outside it, because the vault mints a new one for the same scan
re-stored and a student agreed to send a document rather than a row. Three tests, one per property,
each regressed.

## Known limitations — what changed, and what did not

- **B5 is untouched.** Hold versus pass-through is still a product and legal decision. Nothing here
  assumes either: the case is on the disclosure record under both shapes.
- **`attach_document` still has no intent identity.** Declared, marked verifiable, produced by
  nothing. Building an intent for an action no code path can raise would be a test against
  unreachable code; the transport is what makes it reachable.
- **Acquisition is still unbound** — there is still nothing that acquires a document.
- **One mutation survives, and is recorded rather than hidden:** replacing `work.caseId` with a
  constant in the runner passes all 204 browser-runner tests, because `toStoredPlan` refuses a plan
  with uploads and the gate is never reached there. A coverage gap that is the transport gap.
- **Nothing is submitted.** Unchanged, and structural.
- Everything from the P14–P33 lists still holds.

## What is next, on the evidence

Unchanged by this phase, and now shorter by one item: **give attachment its own intent identity**,
which needs the transport to be reachable, and **answer B5** — does a document persist in AAS until
the application is complete, or exist only for one execution attempt? Everything else about document
transport still waits on that answer.

---

# Where we are — 2026-09-06 (P35)

**Date:** 2026-09-06 · **Phase:** P35 · **ADR:** [ADR-0070](./decisions/0070-the-portals-file-field-is-called-fieldref.md)

> **From here on, read [`state-of-the-system.md`](./state-of-the-system.md) first.** This file is the
> per-phase journal and it accretes; that one is the standing account and is rewritten to stay true.

## The headline

`BlueprintPage.requiredDocuments[].documentRef` is now `fieldRef`. One name spanned two layers, P34
measured that the repository contained *both* readings of it, and this closes it while it is free —
field names are inside the catalogue content hash, so a rename costs every approval once one exists,
and none does.

The fixture's value went with it: `"passport"` → `"passport_upload"`, because under the new name the
old value would be false rather than merely ambiguous. No field on that page is called `passport`.

## Also delivered

The standing account (`state-of-the-system.md`), and two decision sheets — **B5** (hold or
pass-through, with a recommendation and the counter-argument) and **B1** (the twelve retention
determinations as an answerable table, with the Children's Code and DPIA interactions flagged).
Neither is implemented; both are waiting on a founder decision.

## Known limitations

Unchanged from P34, less one: the `documentRef` ambiguity is closed. B5, B1, B2, the transport, the
`attach_document` intent identity and the four blockers on a real live run all still stand, and are
listed in priority order in the standing account.

---

# Where we are — 2026-09-06 (P36)

**Date:** 2026-09-06 · **Phase:** P36 · **ADR:** [ADR-0071](./decisions/0071-a-stopped-run-reaches-a-person.md)

> Read [`state-of-the-system.md`](./state-of-the-system.md) first. This file is the per-phase journal.

## The headline

**A stopped run now reaches a person who can unstick it.** Every part of the recovery design was
built and tested across P10, P11, P17 and P29 — stop at the failure point, record what was
encountered and expected, adjudicate, resume from the intent ledger — and all of it waited on
somebody thinking to run a CLI. The student was told their application was paused; the specialist
was not told anything.

This was the first of the three items the P35 standing account named as worth fixing first.

## What leaves the system

A notice carries identifiers, closed-union categories and facts from reviewed artefacts. It carries
**no free text, no checkpoint and no student** — because its destination is a URL an operator
configures and this repository does not control. `encountered` is the specialist's most useful field
and the one most likely to quote a value back from a portal, so it stays behind the internal route
they authenticate to.

`noticeFor` reads named fields rather than spreading and deleting, so a future field on the
intervention has nowhere to land, and a boundary rule stops `packages/notify` reaching a profile, a
plan, a preview, a secret or a database.

## The transport

An HTTPS POST, no SDK, nothing provisioned, nothing paid for. Plain HTTP to anything but loopback is
refused **at construction**, so a bad destination stops the worker starting rather than failing at
three in the morning. With no destination configured the job is not started at all — every
deployment before this one — but the worker now says so out loud instead of leaving it invisible.

## Known limitations

- **The specialist is still not authenticated.** ADR-0048 §3's asserted-not-authenticated model is
  unchanged, and so is the condition that ends it: a second specialist existing at all.
- **The outbound request is not signed.** The notice carries no instruction and no secret, and a
  shared signing key would be a credential in the worker's environment in exchange for that.
- **No backoff, no dead-letter.** A notice that keeps failing keeps being retried. Deliberate: the
  run stays visible in the queue an operator can already read.
- Everything from the P14–P35 lists still holds. B5, B1 and B2 are unchanged and still block every
  document path.

## What is next

Of the three P35 named: this was the first. The second — `attach_document`'s own intent identity —
still needs the transport to be reachable, so it waits on **B5**. The third, re-auditing ADRs
0005–0021 against the code, is blocked on nothing.

---

# Where we are — 2026-09-06 (P37)

**Date:** 2026-09-06 · **Phase:** P37 · **ADR:** [ADR-0072](./decisions/0072-two-decisions-enforced-by-nothing.md) · **Audit:** [`p37-adr-audit.md`](./p37-adr-audit.md)

> Read [`state-of-the-system.md`](./state-of-the-system.md) first.

## The headline

**ADRs 0005–0021 were read against the code.** Thirteen of seventeen hold as written. The four that
do not produced two fixes, two corrections, and two findings deliberately left open as one phase.

The question that found almost everything was not *does it do what the ADR says* but **does anything
in production call it**.

## Fixed

**`machine.ts` now calls `decideReapplication`.** It had imported only the type, enforced one of
ADR-0006's five rules, and accepted everything else — so an automatic retry, a specialist or an
operator could all have emitted a re-application, as could an instruction with no student statement.

**The walkthrough asserts.** It had been refusing nine consecutive steps and exiting 0 since ADR-0058
changed where a case opens. It now declares an expectation per step, exits non-zero on disagreement,
and runs inside `pnpm run verify`.

## Open, and next

`claimSubmissionKey` has no production caller, so two conversations can open two cases with the same
submission identity; and the re-application path does not exist. **These are one phase**, because
closing the first alone turns a silent duplicate into a silent dead end.

## Known limitations

- Unchanged from P36 otherwise. B5, B1 and B2 still block every document path.
- The `attach_document` intent identity still waits on the transport.

---

# Where we are — 2026-09-06 (P38)

**Date:** 2026-09-06 · **Phase:** P38 · **ADR:** [ADR-0006 §3, amended](./decisions/0006-reapplication-requires-explicit-student-instruction.md)

> Read [`state-of-the-system.md`](./state-of-the-system.md) first.

## The headline

**The duplicate ADR-0006 has forbidden since Phase 1 is now structurally impossible, and the second
application that refusal produces has somewhere to go.** P37 recorded both and fixed neither on
purpose; they are one phase.

`claimSubmissionKey` is claimed at case-open, inside the binding's own critical section and before
the case's first event. A collision is refused as `already_applying`, naming the application that
holds the identity and whether it has concluded.

## The design decision, and why

A re-application opens a **new case** that references the prior one, not a new attempt ordinal on a
concluded one. Vahid's reasoning, recorded because it is the part that generalises:

> A second attempt is genuinely a different application. Different intake, different deadline,
> possibly changed entry requirements, and a separate authorisation from the student. One case
> holding two sets of requirements and two authorisations makes it impossible to state precisely
> what the student agreed to.

It is also the only shape that works. `fold` used to increment the ordinal in place, and every
terminal state has an empty transition list — so the "fresh attempt" it produced was a `CONFIRMED`
case with no first move. `CONFIRMED` stays terminal; the rule in `checkTransition` is untouched.

## What a student does

A conversation owns at most one case, so the second application lives in a **new conversation** —
which is where the student already is when they meet the refusal.

1. Ask to apply again → `already_applying`, naming the case and whether it concluded.
2. `POST .../reapplication/prior-outcome` → they say what happened; the system advises, and records
   that it advised.
3. `POST .../reapplication` → their instruction, in their own words and nothing else.

## Known limitations

- **`start` on a conversation whose run ESCALATED throws** rather than resuming: `#openAndStart`
  resumes only `running` or `suspended`. Pre-existing and unrelated to the key. What a student
  should get back from an escalated run is a real design question, not a patch.
- **`recommendWait`'s `next_intake` branch has no production caller.** Naming a later intake means
  knowing one is open, and the Conversation Service's catalogue port resolves a blueprint by id
  rather than listing. Production advises `six_months`, which is what can be said truthfully.
- **`no_prior_application` is reachable only through a corrected catalogue identity** — an entry
  whose institution, course or intake is later fixed, so the key derived today is not the key
  claimed when the case opened. Tested at exactly that.
- B5, B1 and B2 are unchanged and still block every document path. The `attach_document` intent
  identity still waits on the transport.

## What is next

P39: make P37's audit method a check rather than a habit — a verification step that fails when a
declared capability has no production caller, or reports it in an explicit reviewed allow-list with
a reason and the phase that will close it. The initial allow-list is `attach_document`, the
`next_intake` branch above, and whatever else the first run finds.

---

# Where we are — 2026-09-06 (P39)

**Date:** 2026-09-06 · **Phase:** P39 · **ADR:** [ADR-0073](./decisions/0073-a-declared-capability-with-no-production-caller-fails-the-build.md)

> Read [`state-of-the-system.md`](./state-of-the-system.md) first.

## The headline

**`pnpm run verify` now asks P37's question.** A capability a decision says is enforced must have a
caller inside a deployable's dependency closure, or sit on a reviewed list that says why not and
what would close it.

Seven consecutive phases had each found a record asserting something production did not do. All
seven compiled, were exported, and were covered by tests — which is precisely why they were
invisible.

## It found one on its first run

`openReapplication`, which ADR-0006 §3 had called "the one constructor for a second attempt" four
hours earlier in P38, **was called by nothing.** The run driver built the opening event itself.

Fixed rather than allow-listed, and the result is better than what it replaced: the domain builds
the event, and the submission key is claimed for the identity that event carries rather than one
assembled beside it.

## The reviewed unreachable list

`checkMinorGate` · `assertStorable` · `authoriseDisclosure` · `purgeContents` · `attach_document` ·
`assessUsability`. Each names a reason and what would close it. Two are notable:

- **`assessUsability`** is called only from `packages/requirements`, which **no deployable depends
  on**. Without the closure rule the check would have called it reachable.
- **`attach_document`** is a string literal rather than a function, and the question about it is the
  same one, so the register checks literals too.

## Known limitations

- **It does not prove a REQUEST can reach a capability.** A function called only by another function
  that nothing calls passes. That needs a call graph.
- **Branch-level unreachability is invisible to it.** `recommendWait`'s `next_intake` branch has no
  caller that supplies a `nextIntake`, and a symbol search cannot see that.
- Everything from P38 still holds: `start` on an escalated run throws; B5, B1 and B2 still block
  every document path.

## What is next

The three worth doing, in order: close the ADR housekeeping (0001–0004 are still Proposed), decide
what `start` should return for an escalated run, and — when B5 comes back — the document transport
that four of the six unreachable entries are waiting on.

---

# Where we are — 2026-09-08 (P46)

**Date:** 2026-09-08 · **Phase:** P46 · **ADR:** [ADR-0080](./decisions/0080-the-visa-path-is-a-compliance-boundary.md)

> Read [`state-of-the-system.md`](./state-of-the-system.md) first.

## The headline

**ADR-0021's decision was right and its reason was weaker than the truth.** It explains the
visa/application line as product scope and correctness. Vahid, 2026-09-08:

> The entire visa path is outside this system's scope until the OISC position is resolved, and that
> is a hard compliance boundary in the business plan, not a scheduling gap.

**The word OISC appeared nowhere in this repository.** The strongest reason for the most consequential
boundary in the product lived only in the business plan, and every "out of scope" citation in the
code pointed at the version that reads like a priority call.

## Why a weaker reason is a real defect

| the recorded reason | what a later engineer could do |
|---|---|
| *"visa evidence is out of scope for the MVP"* | reasonably decide to add it, citing product value |
| *"shut until the OISC position is resolved"* | not decide that at all — it is not theirs |

That is how a boundary erodes: not by anyone overruling it, but by everyone citing the version that
sounds negotiable. It is also why `visa_document` is `out_of_scope` and never `undetermined` —
*"`undetermined` would leave it open for someone to quietly decide later. `out_of_scope` says it is
deliberately shut."*

ADR-0080 does **not** state what the OISC position is. That is a regulated question for someone
competent, and ADR-0023's rule holds. What is decided is that the path is shut **while the question
is open**, which can be decided without answering it.

## What asking the question turned up

ADR-0021 names its own enforcement: *"`blocksApplication(requirement)` is the single line that keeps
the visa journey out of the application journey."* Entering that claim in the register failed the
build immediately:

```
✗ blocksApplication — ADR-0021 says "the single line that keeps the visa journey out of the
  application journey", and NOTHING IN PRODUCTION CALLS IT.
```

Not neglect. **Nothing in production carries a `Requirement` at all** — `packages/requirements` has
no dependents, and the catalogue's `requiredDocuments` are free-text strings with no authority
(ADR-0066, ADR-0070). There is no scope for the line to read.

Listed rather than wired: a caller would be a control over unreachable code, which ADR-0071 declined
for `attach_document` for the same reason. **What makes the absence safe today is that the visa
journey is not built — not that this line is stopping it.**

This is the eighth consecutive phase to find a record asserting something production does not do.

## Declared-but-unreachable surface

**6 → 7, and the direction is the point.**

Nothing became less reachable. Something that was **always** unreachable is now *declared*, and the
register can only be honest about what it has been told to check. `blocksApplication` had never been
entered, so the check had never been asked.

When the Requirements Service phase lands it closes **two** at once — `blocksApplication` and
`assessUsability` both name it.

## A measurement worth recording

Two full-suite runs in five failed, each on a different browser test, and each of those passed 4/4
and 3/3 in isolation and 3/3 in the full suite afterwards. The shape is the Chromium starvation
`two-origin.test.ts` already documents — several browser instances competing across parallel suites
— and it is not caused by anything in this phase, which touched a register entry, an ADR and a reason
string. Recorded rather than dismissed, and worth a phase of its own.

## What is next

**B2** remains the only policy blocker on documents, and it is with Vahid. The suite's browser-test
fragility is the strongest unblocked engineering candidate.

---

# Where we are — 2026-09-07 (P45)

**Date:** 2026-09-07 · **Phase:** P45 · **ADR:** [ADR-0079](./decisions/0079-a-document-running-out-is-the-students-choice.md)

> Read [`state-of-the-system.md`](./state-of-the-system.md) first.

## The headline

**The expiry rule has its numbers.** ADR-0078 recorded the rule and deliberately left the thresholds
absent until they were proposed and confirmed; they were, on 2026-09-07.

| document | threshold |
|---|---|
| passport | 6 months |
| national ID | 3 months |
| English test certificate | 4 months, **provisional** |
| birth / degree certificate, transcript, reference, personal statement | none — they do not expire |
| bank statement | **none, deliberately** |
| sponsorship letter, parental consent, guardianship document, other | **undetermined** |

One principle throughout: the threshold is *the time a student needs to obtain a replacement*, not a
fraction of the document's life. A UK passport renewal runs to ten weeks at its worst, and six months
also covers the validity many visa routes require at entry.

## The removal is the interesting entry

The bank statement was in the proposal at 14 days and was taken out. *"Row 12 is out of scope and
blocking, and giving it a threshold makes it look half-ready. Leave it with nothing."*

That is why the table has four states rather than a number-or-nothing: `does_not_expire`,
`out_of_scope`, `undetermined` and a threshold are four different facts, and collapsing them would
have made "we decided not to" indistinguishable from "nobody has looked".

## Three properties, each structural

| | how |
|---|---|
| the wording recorded is the wording shown | `recordChoice` takes the **branded warning**, never a string — there is no parameter for a different sentence |
| it fires once | the only input about previous warnings is *when the first one happened*; there is no "warn anyway" |
| every type is classified | the table is total over `DocumentType`, so a new type does not compile until somebody decides |

The first is the one that matters most. A record saying *"the student was warned"* without saying
what they read is evidence of nothing — the same argument ADR-0059 makes about the preview a student
authorises.

## The English test number says in the code that it is not settled

It names obligation `read_the_test_provider_terms` from B1 row 8. Every warning produced from it is
marked provisional, and that mark is carried into the recorded choice — so a decision made under a
number that later moves can be found.

## Declared-but-unreachable surface

**6, unchanged.** Nothing this phase added is a runtime capability waiting on a caller.

`packages/documents` is in no deployable's dependency closure — only `packages/extraction` depends on
it, and nothing depends on that — so this constrains code that does not yet run. Compile-time and
pure, so it will already hold when the transport phase wires it in. The same limitation was stated
for ADR-0077, and it is stated again rather than assumed remembered.

## What is next

**B2** is the only policy blocker left on documents, and it is with Vahid. The transport phase is
unblocked on every design question except that one.

---

# Where we are — 2026-09-07 (P44)

**Date:** 2026-09-07 · **Phase:** P44 · **ADR:** [ADR-0078](./decisions/0078-documents-are-held-and-reused.md)

> Read [`state-of-the-system.md`](./state-of-the-system.md) first.

## The headline

**Both document blockers are answered.** B5 is **A — hold and reuse**, and all twelve B1 rows are
determined, named to Vahid Mohammadi and dated 2026-09-07.

> *"Documents are stored in the vault and reused. We never ask a student for the same document
> twice. The reason is the product's core mechanic, not convenience: fill-once, apply-to-many is
> what the business plan sells as the switching cost, and a per-attempt pass-through would destroy
> it."*

Decided on a stronger ground than the options document argued. It recommended A because B's saving
was unproven and its retry story certainly worse; the decision is that pass-through is not a cheaper
way to do the same thing — **it is a different product.**

## The correction that came with it

The sheet was written before B5 was answered, and rows 1, 2, 6, 7 and 8 said *30 days after
`submission_confirmed`*. That is the reuse mechanic destroyed by its own retention rule: **a student
applying to a second university two months later would have been asked to upload again.**

All reusable documents now run **12 months after `last_used`** — *"a student's purpose is alive for
as long as they are still applying. Twelve months of no use is the point at which it is not."*

Two triggers were added because two rows could not otherwise be written down: `age_established`
(row 9 keeps the age determination, not the certificate) and `case_concluded` (rows 5 and 10 run
from the end of the case, not from a submission that may never happen).

## What the vault can take today: still nothing

This is the part worth being precise about, because eleven green rows look like a door opening.

`assertStorable` requires **two** things: a retention policy *and* a registered lawful basis for the
storing activity. Retention is now resolved for eleven pairs. **B2 — the ADR-0022 determination — is
not**, and it is now the only policy blocker standing between a student and the vault.

`pnpm run retention-status` used to end *"10 of 10 document types could be stored today"*. With no
period set that was harmless; with eleven set it reads as permission. It now says a retention policy
is not permission to store, and names the gate that is shut.

## A defect this phase created, and the check that was missing

Writing a second schedule version on the same day made two versions effective from the same instant.
`effectiveFor` sorts by `effectiveFrom` descending; a tie keeps input order, which for the status
script is the order the directory listed the files in. **The superseded version won, and the report
said every row was still unresolved while the schedule that resolved them sat beside it.**

Nothing about either version was wrong, so `validateSchedule` had nothing to say. `validateHistory`
is what was missing: no two versions may share an instant or a name, and none may supersede one the
history does not carry.

## Recorded, and deliberately not implemented

- **The deletion cascade** — everything derived dies with the document; one exception, row 5's audit
  record. No vault holds anything, so there is nothing to cascade from yet.
- **The expiry thresholds** — the rule is recorded (warn, the student chooses, the exact wording
  shown is recorded with their choice). The numbers are to be proposed and confirmed first, and the
  determination says so rather than quietly configuring one.

## Declared-but-unreachable surface

**6, unchanged — and three of the six reasons are now different.**

| | was waiting on | now waiting on |
|---|---|---|
| `assertStorable` | B5, then transport | **B2**, then transport |
| `purgeContents` | B1, then transport | a vault with something in it, and the job that calls it |
| `attach_document` | B5, then the intent identity | the intent identity, and a `WorkKind` that carries it |
| `authoriseDisclosure` | B2, then transport | unchanged — B2 is the one still undetermined |
| `checkMinorGate` | submission scope | unchanged |
| `assessUsability` | the Requirements Service | unchanged |

A reason that names a blocker somebody has since cleared is a stale allow-list, and a stale
allow-list is what hides the next finding.

## What is next

The document transport phase is now unblocked on the design question and blocked only on B2 for the
storing half. The expiry thresholds are a proposal awaiting confirmation.

---

# Where we are — 2026-09-07 (P43)

**Date:** 2026-09-07 · **Phase:** P43 · **ADR:** [ADR-0077](./decisions/0077-two-determinations-made-structural.md)

> Read [`state-of-the-system.md`](./state-of-the-system.md) first.

## The headline

**Two things decision sheet B1 had written down, and nothing enforced.** Vahid answered both on
2026-09-07, and both are now properties of the code rather than sentences in a document.

## 1 · A special-category field cannot be extracted

Not because something checks for one — because **there is nowhere for one to go.**

A document reading enters the system only through an extraction plan target, and every target names a
`ProfileFieldKey`. The registry is therefore the boundary of what extraction can ever produce. What
P43 adds is that the registry is closed against unclassified fields: `FIELD_CATEGORY` is total over
it, so a new field **does not compile** until it has been classified against Article 9(1)'s
enumeration, and a plan may only name one classified `ordinary`.

Both halves were measured by adding `identity.religion`:

| | |
|---|---|
| unclassified | fails at `categories.ts`, naming the missing classification |
| classified `special_category`, named by a plan | `Type '"identity.religion"' is not assignable to type 'OrdinaryFieldKey'` — at the plan's own line |

`undetermined` is a third state and blocks exactly as `special_category` does. That is ADR-0023's
rule in a new place: the honest answer *"nobody competent has decided"* must not read as permission.

**The limit, stated plainly.** `packages/extraction` is in no deployable's dependency closure, so
this constrains code that does not currently run. It is compile-time, so it holds whenever the
package is built and will already hold on the day extraction is wired to a deployable — but it is not
guarding a live path today. The half that *is* in a shipped package is the classification itself, in
`packages/profile`, which every deployable that touches a profile compiles.

## 2 · No document period rests on defending legal claims

The question B1 puts above the whole table, because the answer moves most of the rows. Answered
**no** for documents, **yes** for the audit record.

The reasoning is recorded, because Article 5(2) makes the period ours to justify: **what the student
authorised is provable from the record without the scan.** The preview hash says what was put in
front of them, the authorisation text says what they agreed to, the transmission record says what was
sent. A passport scan adds nothing to that proof and would hold the highest-consequence data this
system could own for six years to evidence something already evidenced.

Enforced, not just recorded. `RetentionBasis` carries a **declared** `reliesOnLegalClaims` —
declared and not inferred, because a check that searched the statement for "Limitation Act" would
miss the period that phrased it differently while feeling like a control. `validateSchedule` refuses
it for any purpose but `audit_evidence`, and refuses it even there unless the schedule version
records who determined it and why.

**A schedule that omits the declaration is read as relying on it.** Measured: with the other default,
a passport kept 2,190 days on the strength of the limitation period printed *"No contradictions, no
placeholder bases."*

## What has NOT moved

- **No period is set.** A determination is not a period. All twelve rows are still unresolved and
  nothing can enter the vault.
- **B5 is untouched**, and so are the five rows B1 flags — rows 4 and 8 (third-party data) and 9, 10
  and 11 (children's data), which are with Vahid and the DPIA owner.
- **`applyConfirmation` was not narrowed.** The same constraint at ADR-0004's mint point was written
  and reverted: it changes generic inference for every caller and needed unrelated tests rewritten,
  for a guard vacuous there today. Recorded as measured rather than left looking unconsidered.

## Declared-but-unreachable surface

**6, unchanged.** `checkMinorGate` · `assertStorable` · `authoriseDisclosure` · `purgeContents` ·
`assessUsability` · `attach_document`.

Nothing this phase added is a runtime capability waiting on a caller: the first determination is a
type, and the second runs inside `validateSchedule`, which `pnpm run retention-status` and its new
tests exercise.

## What is next

Exercisable and unblocked: the ADR housekeeping (0001–0004 are still Proposed), and the read that
would let a student be taken to an application they already have.

---

# Where we are — 2026-09-07 (P42)

**Date:** 2026-09-07 · **Phase:** P42 · **ADR:** [ADR-0076](./decisions/0076-the-student-can-instruct-the-second-attempt.md)

> Read [`state-of-the-system.md`](./state-of-the-system.md) first.

## The headline

**A student refused because they already applied can now apply again — from the page, in their own
words.** P38 built the exchange ADR-0006 §3 requires, published both routes, and covered both with
driver tests. Nothing but a test had ever called either.

## The third phase in a row to find the same shape

| | found | one layer |
|---|---|---|
| P39 | a capability with no caller | in the code |
| P41 | a refusal with no reader | at the surface |
| P42 | a route with no client | at the surface, for a whole exchange |

Every one was correct, implemented, tested, and stopped short of the person it was for.

The refusal itself said so. `AlreadyApplyingProblem` carries `existingCaseId` and `concluded`, and
the contract's own comment explains why: *"the refusal is otherwise a dead end. 'You already have an
application for this' is only useful if the client can take the student to it, or — when it has
concluded — offer them a second attempt."* The page read the code and threw both fields away.

## The order is the decision, and it is obeyed twice

Rule 4 makes the wait recommendation *advisory in effect but mandatory in presentation*. The panel
has two states, and the second is reachable only through the round trip whose reply is the server's
advice — there is no path by which the page can put itself into the instructing state. The server
enforces the same order independently, by looking for the advice event in the conversation's own log.

`concluded` is the server's answer. The page holds no case state and reads none: offering a second
attempt against a live application would be asking for `decideReapplication`'s refusal, which its own
comment calls *"a different bug with the same blast radius"*.

## What is deliberately NOT done

- **Taking the student to the application they already have** — the other half of what
  `existingCaseId` is for. A conversation owns at most one case, so it means moving them to a
  different conversation, and no read lists a case's conversation. Recorded rather than half-built.
- **A check that every published route has a client.** Most internal routes have none by design, so
  it would be an exception list wearing a guard's clothes. The register carries `advisePriorOutcome`
  instead — its only production caller is the page, so deleting the flow fails the build.

## Declared-but-unreachable surface

**6, unchanged.** `checkMinorGate` · `assertStorable` · `authoriseDisclosure` · `purgeContents` ·
`assessUsability` · `attach_document`. Four of the six wait on B5, B2 or B1.

`advisePriorOutcome` joins the register as enforced, taking the enforced count to **14**.

## Known limitations

- The whole exchange is proved in a real browser, but the conclusion of the prior case is a fixture
  step: a cancellation reaches CANCELLED on the next *advance*, and nothing in that file advances a
  run — the worker does, and its own tests prove it.
- B5, B1 and B2 are unchanged and still block every document path.

## What is next

Exercisable and unblocked: the ADR housekeeping (0001–0004 are still Proposed), and the read that
would let a student be taken to an application they already have.

---

# Where we are — 2026-09-07 (P41)

**Date:** 2026-09-07 · **Phase:** P41 · **ADR:** [ADR-0075](./decisions/0075-a-refusal-reaches-the-person-it-is-for.md)

> Read [`state-of-the-system.md`](./state-of-the-system.md) first.

## The headline

**Every reason this system states now reaches somebody.** ADR-0073 asked *does anything call this*.
P41 asks the same question of a different kind of declaration: **does the reason anybody states ever
reach anybody**, and found two places where it did not.

## The student's page had no words for two codes that exist FOR a client

`already_applying` and `specialist_reviewing` are in the closed vocabulary on exactly one argument —
that a student refused either must not be shown a generic conflict. Both fell through to *"That did
not work. Let me show you where things stand."* For a student whose run a specialist is holding,
that sentence contradicts the transcript directly above it, which P40 had just written.

## Both services published 413 and 415, and neither had ever sent one

`express.json({ limit })` guards every route in both planes. Everything it refused reached the blind
error handler and came back **500 `internal_error`** — including a body over the limit. The comment
beside the limit already claimed otherwise, and nothing made it true.

A student who pasted a long personal statement was told **our** side had broken, for a body only
they could shorten.

`problemForBodyError` maps the parser's own error type to the published code and lives in
`packages/contracts`, because two copies would be two chances for one of them to keep answering 500.
It reads `err.type` and nothing else — `err.body` carries the raw request body on a syntax error, and
the blindness outranks the new behaviour.

## Writing down why a code could not arrive found two more defects

`CANNOT_REACH_THIS_PAGE`'s first draft had three entries and two were wrong. It claimed the page
could not be sent `payload_too_large` — the statement box takes a paste of any size — and that the
page "sends no idempotency key", when `transport.ts` sends a fresh one on two of its calls.

Neither was findable by reading the page. Both were findable by having to write the reason down.
That is the argument for the list rather than a comment, and it is the same argument ADR-0073 makes
for the reviewed unreachable list.

## What now fails the build

| | |
|---|---|
| A problem code with no wording and no reason | `refusal-wording.test.ts` |
| A `post` operation that does not publish 400, 413 and 415 | `contract-drift.test.ts` |
| `problemForBodyError` losing its production callers | `pnpm run reachability` |

## Declared-but-unreachable surface

**6, unchanged.** `checkMinorGate` · `assertStorable` · `authoriseDisclosure` · `purgeContents` ·
`assessUsability` · `attach_document`. Four of the six wait on B5, B2 or B1.

`problemForBodyError` joins the register as enforced, taking the enforced count to **13**.

## Known limitations

- One code is proved end to end in a real browser (`payload_too_large`). That *every* code has a
  wording is proved by a unit test over the two lists, which is the right shape for it — but it
  means the rendering of the other wordings is not itself browser-proved.
- B5, B1 and B2 are unchanged and still block every document path.

## What is next

Exercisable and unblocked: the ADR housekeeping (0001–0004 are still Proposed), and the
fixture/harness fragility the last four phases kept finding by accident.

---

# Where we are — 2026-09-07 (P40)

**Date:** 2026-09-07 · **Phase:** P40 · **ADR:** [ADR-0074](./decisions/0074-a-run-a-person-is-holding-is-returned-to-the-student.md)

> Read [`state-of-the-system.md`](./state-of-the-system.md) first.

## The headline

**A student whose application stopped for a specialist can come back to it.** Before this they came
back to a 500: `start` looked for a run in `running` or `suspended`, an escalated run is neither, and
it fell through to a run id that already existed.

The conversation had already promised them the opposite — *"you do not need to do anything — I will
tell you as soon as it moves again."*

## What they can and cannot do while a person is looking

| | |
|---|---|
| Ask to carry on | Returns the run where it is. Nothing created, nothing decided |
| Ask a question | Lands in the same thread, as it always did |
| Approve / confirm a handoff | **409 `specialist_reviewing`** — a stated reason, where it used to be a 404 |
| Stop | Always available (ADR-0053) |
| Confirm a reading of their own details | Available — an answer, not an advance |

## The two guards that were NOT added

Both measured rather than argued.

- **In `advance`:** one was written first and failed five tests that re-advance a stopped run on
  purpose. That is how the pause is proved idempotent and the interview's attempt limit proved
  durable. Re-deriving a held run is already a no-op that re-stops it.
- **In front of `decide`:** a mandatory-review stop is `escalated` too, and the domain's refusal is
  reachable in exactly that case. A guard there would make the coordinator the thing that refuses a
  financial-evidence or minor review.

## A second defect, found by refusing to re-run a flake

`p18-startup.test.ts` failed once in eight on this branch. Measured before concluding — 7/8 here,
6/6 on the previous commit — and the difference was real, in `apps/worker`.

`stop` set its stopped flag, cleared the timers, and released the leases it was holding, while a
pass that had *begun* before that flag was set was still running. `underLease` claims its lease
**inside** that pass, so the claim could land after the release loop had already run, and the worker
exited leaving a lease in `worker_leases`. The next worker then waits a full lease period for a job
it could have started immediately.

It is invisible in the ordinary case, because an abandoned lease lapses on its own — which is the
whole reason `p18-startup` asserts the lease table after the process is gone rather than trusting an
exit code. `stop` now awaits the passes that have started before releasing anything, and
`worker.test.ts` pins it by holding the claim's own statement open across the call to `stop`.

`apps/worker` was also missing from `scripts/with-postgres.sh`: eighteen lease tests that ran only
in CI's blanket pass and announced a skip on every local integration run. Added.

## Declared-but-unreachable surface

**6, unchanged.** `checkMinorGate` · `assertStorable` · `authoriseDisclosure` · `purgeContents` ·
`assessUsability` · `attach_document`. Four of the six wait on B5, B2 or B1.

`isHeldByAPerson` joins the register as enforced, taking the enforced count to 12.

## Known limitations

- The student is told a person is looking **once**, at the moment it stops. There is no "still with
  a specialist" reminder if it takes days, and no estimate — we have nothing truthful to base one on.
- B5, B1 and B2 are unchanged and still block every document path.

## What is next

Exercisable and unblocked, in order: the ADR housekeeping (0001–0004 are still Proposed); the
`already_applying` refusal has no client surface yet, so a student who meets it is told correctly and
shown nothing; and the fixture/harness fragility the last three phases kept finding by accident.

---

# Where we are — 2026-09-08 (P47)

**Date:** 2026-09-08 · **Phase:** P47 · **ADR:** [ADR-0081](./decisions/0081-the-browser-tests-run-in-a-lane-of-their-own.md)

> Read [`state-of-the-system.md`](./state-of-the-system.md) first.

## The headline

**Two full-suite runs in five failed, and both failures were about the machine, not the code.** Each
was a different browser test. Each passed 4/4 when run on its own. `two-origin.test.ts` had written
the diagnosis in its own comments long before anyone acted on it:

> The page is STARVED: several Chromium instances run in parallel across this directory's suites,
> and under that load a page can take well over ten seconds to process an input event.

It fixed its own instance by retrying the input. Right for that test, wrong as a strategy. Vahid,
2026-09-08:

> A suite that goes red for reasons that turn out not to matter teaches everyone to discount red, and
> the cost lands on the day a real failure arrives and gets waved through. Two in five is well past
> that threshold. **Fix the contention rather than the assertions.**

## What the contention actually was

Measured, on the four-CPU container this suite runs in:

| | before | after |
|---|---|---|
| peak concurrent browsers | 3 | **1** |
| peak Chromium processes | 21 | **7** |
| peak load average (of 4) | 5.13 | **3.13** |
| full-suite wall time | 119s | **176s** |

Vitest schedules test *files* across workers, and a browser file launches a browser that is itself
five to eight processes. Three or four landing together saturates the machine, and the symptom is not
a crash — it is a page that takes longer than a twenty-second poll to process an input event, on a
different test each time.

`vitest.workspace.ts` now runs two projects. **`chromium`** takes the seventeen files that launch a
browser, one at a time. **`unit`** takes everything else, with all its parallelism intact. Capping
workers globally would have slowed the 155 seconds of work that has no browser in it to fix the 87
seconds that does — and would still have let two browser files pair up. The lane is not the critical
path: its files sum to 87s against 242s of total work, so it finishes while the other lane runs.

**Not one assertion or timeout changed.** No test was made more patient to accommodate the load; the
load was removed. `two-origin.test.ts`'s retry stays, because it handles a *dropped* input event,
which is a different failure from a late one and is not fixed by removing contention.

## Three things this cost

**`fileParallelism: false` cannot be set on a workspace project, and setting it looked like a fix.**
Vitest lists it in `NonProjectOptions` — a root-level setting — so the config loader accepted it and
the runtime ignored it. The lane still peaked at three browsers. The measurement showed it doing
nothing and only `tsc` said *why*, which is the wrong order to find that out in. The guard now
asserts `singleFork` is present **and** that `fileParallelism` is absent: something that reads as
serialising the lane while doing nothing is worse than nothing, because it stops the next person
looking further.

**A project that `extends` a config MERGES its `include`.** The first attempt left `include` in
`vitest.config.ts`, so the browser lane matched all 113 test files instead of its 17: every file ran
in both lanes, the run went from 2,283 tests to **4,274**, and the load got *worse*. File selection
now lives in one place, and `vitest.config.ts` records why it is not there.

**Grepping for `chromium.launch` finds twelve of the seventeen.** Five launch through a
`PlaywrightDiscoverySession` or a `PlaywrightInspectionSession`, and each of those was measured
spawning eight Chromium processes. The narrow predicate was not a smaller truth; it was a wrong one.
`scripts/browser-lane.test.ts` follows one level of first-party imports, and checks the list in both
directions — a file that starts launching a browser and is not added rejoins the contention silently,
and a listed file that stops launching one is serialised for nothing.

Its first run flagged **itself**, because `connectOverCDP` appears in its own source in order to look
for `connectOverCDP`. That is the P39 mistake exactly: a check that reports the *word* as the deed.
It is excluded by name, and a test asserts the exception is that one file and no other.

## What is honest about the evidence

Five consecutive full runs are clean, against two failures in the five before. **That is evidence,
not proof**, and the claim is limited to what was measured: three browsers to one, load 5.13 to 3.13.
One run in the five showed two failures and it was **not** a flake — it picked up the guard test
added mid-measurement, which failed legitimately by flagging itself. It has passed every run since
the exclusion.

No test in this suite is genuinely fragile as opposed to starved. Every failure seen in the before
runs was a browser test under load, and every one of them passed alone.

## Declared-but-unreachable surface

**Unchanged at 7.** Nothing in this phase is a capability — no production code was added, only test
scheduling and a guard over it.

## What is next

Unchanged from P46, minus the harness item this phase closed: the ADR housekeeping (0001–0004 are
still Proposed), and the `already_applying` refusal that still has no client surface. B2 (ADR-0022's
lawful basis) remains the only policy blocker on documents, and row 8's obligation — reading the
English test providers' terms — may still move the `english_test_certificate` threshold.

---

# Where we are — 2026-09-08 (P48)

**Date:** 2026-09-08 · **Phase:** P48 · **ADR:** [ADR-0082](./decisions/0082-the-record-of-what-cannot-be-reached-is-checked-too.md)

> Read [`state-of-the-system.md`](./state-of-the-system.md) first.

## The headline

**The build's answer and the document's answer to the same question had drifted, in both directions
at once.** Since P39 the register in `scripts/check-reachability.ts` has said which declared
capabilities have no production caller, and every phase report has quoted its number. §4 of the
standing account said the same thing to a person. Nothing reconciled them.

**`checkMinorGate` was in the register and in no row of the document.** Not an incidental one: it is
ADR-0011's gate on an application involving a **minor** — a mandatory-review category. The register
states plainly why it cannot be reached (its one blocking condition is at the submission stage, and
submission is out of scope by ADR-0014) and that the trigger which stops a case for review,
`suggestsMinority`, is a different thing and *is* enforced. None of that reached the document. A
reader would have counted the rows, got a plausible total, and believed the minors gate was enforced.

**`packages/notify` sat under "Declared but unreachable" with a cell beginning "Reachable."** It is:
set `AAS_SPECIALIST_WEBHOOK_URL` on the worker and the specialist notice runs. The row said so, under
a heading asserting the opposite, and had done since P36.

A row that argues with its own heading is worse than a missing one. A missing row reads as an
oversight; this one reads as reviewed — somebody looked, wrote a true sentence, and filed it under
the false claim. Every reader after that inherits the filing, not the sentence.

## Why this counts as a defect at all

Neither finding is a code defect. Neither would ever have failed a build. **That is the argument.**
The register is checked and the prose was not, so the prose is where a false record now accumulates —
and this is the eighth consecutive phase to find a record asserting something production does not do.
The record doing it this time is the one describing the check.

## What was built

`scripts/unreachable-is-documented.test.ts` imports the register and holds §4's table A to it in both
directions. Missing a symbol fails. Inventing one fails. Naming one the register calls *reachable*
fails.

§4 is now **two** tables, separated by granularity rather than merged:

- **A** mirrors the register — one symbol, one caller, seven rows — and is checked.
- **B** holds what that question cannot express: a package with no dependents, a research build, and
  a *branch* of an enforced function. Each says why it is not a register entry. The check does not
  police B, and the document says so.

`recommendWait` is what forced the distinction. The symbol is **enforced** — the run driver calls it.
Its `next_intake` branch cannot be reached, because the catalogue port resolves a blueprint by id and
cannot list. Listing the symbol in A would be false; deleting the note would lose a real fact.

## What is honest about the coverage

Five deliberate regressions, each verified by reading back from disk and restored from a file copy.
Four were caught by the assertion that names them.

**The fifth was not, at first, and it is recorded rather than tidied.** Calling `main()`
unconditionally — so importing the register runs the whole check as a side effect — left the suite
**green at 7/7** while the register was passing. It only bit when the register was *also* failing,
and then it failed this file for a reason the file never asserted. Coverage that exists only in the
case where the defect has already done harm is not coverage of the defect, so the guard is now
asserted in the source too, and removing it fails by name.

## What this deliberately does not do

- **It does not generate the table.** *"Why it is kept"* is a judgement — ADR-0019's
  constraint-before-the-thing, ADR-0071's refusal to add a caller over unreachable code — and a
  generator would either drop it or force it into the register, which is a checker and not a place to
  argue.
- **It does not check table B**, and says so in the document rather than implying otherwise.
- **It does not widen to every document.** The README's counts and the ADR index's narrative are
  also hand-written and also drift. This is the one the README calls the standing account, and it is
  the one that was wrong. Widening is a phase, not a footnote.
- **It changes no capability's status.** Nothing became more or less reachable.

## Declared-but-unreachable surface

**Unchanged at 7.** Nothing in this phase is a capability. What changed is that the seven are now
legible to a reader as well as to the build.

## What is next

B2 (ADR-0022's lawful basis) remains the only policy blocker on documents, and it is with you. Row
8's obligation — reading the English test providers' terms — may still move the
`english_test_certificate` threshold. Unblocked and available: the ADR housekeeping (0001–0004 are
still Proposed, and ADR-0004's branded types are among the most heavily enforced decisions in the
repository while its status says Proposed), and widening this phase's check to the README's own
counts.

---

# Where we are — 2026-09-08 (P49)

**Date:** 2026-09-08 · **Phase:** P49 · **ADR:** [ADR-0083](./decisions/0083-an-adr-and-the-lists-of-it-must-agree.md)

> Read [`state-of-the-system.md`](./state-of-the-system.md) first.

## The headline

**Four decisions had been recorded as awaiting an approval that was given six weeks ago, and one of
the things that recorded it was a blocker asking you to give it.**

P48 held one document to a checked register. Asking the same of the records describing the
*decisions* found not one hand-written copy but **three**, none compared with the others: the ADR
file, `docs/decisions/README.md`, and `state-of-the-system.md` §3 — a full second copy of the same
table, in the document the README calls the standing account.

Four of eighty-two disagreed. The history is exact, all on 2026-08-26:

| time | commit | |
|---|---|---|
| 08:05 | `4ee6b1c` | Phase 0. Five ADR files, all *"Proposed · awaiting Vahid's approval"*, index to match. |
| 08:47 | `a27cb60` | *"Phase 0 approved by Vahid on 2026-08-26. ADRs 0001-0005 moved to Accepted."* Flips all five **files**. Never touches the index. |
| 09:02 | `8786fff` | Edits the index — moves **only 0005**'s row. Four left behind. |

A partial edit fifteen minutes after the approval. Seventy-eight commits and six weeks carried it.

## Why this one is different from the eight before it

Every previous finding of this shape was a record claiming **more** than the system did — a
capability with no caller, a refusal with no reader, a route with no client. Those fail loudly the
moment anyone checks.

This one claimed **less**, and understatement does not fail. It compounds. The stale column produced
a standing blocker — *"12 · Accept or revise ADRs 0001–0004 · owner: **You**"* — and a §9
recommendation to accept two of them. **You were being asked to decide something you had already
decided, by a document that had forgotten.** You could not have told it was wrong without reading
the git history.

Blocker 12 is closed as never having existed.

## A defect I made in the last two phases

§3's table had **80 rows for 82 ADRs**. ADR-0081 and ADR-0082 were absent — because P47 and P48 each
added a row to the index and not to the second table. That is not inherited from Phase 0; it is mine,
from the two phases immediately before this one, made by the same hand that then went looking for
exactly this shape. Two records are a thing that can drift. Three is a thing that will.

## What is checked now

`scripts/adr-status-agrees.test.ts` holds all three records to each other: every file's status
matches its index row **and** its §3 row, every ADR is listed in both, no list names an ADR that does
not exist, every file has a status the project recognises, and the index's stated Accepted count
matches its own rows — it said *"Seventy-eight"*, which was right for the stale index and wrong for
the decisions.

A `CONTESTED` list exists and is **empty**. It is there so that a disagreement whose resolution is a
founder's call can be declared with what each side says, the evidence, and who decides — rather than
picked. ADRs 0001–0004 are deliberately not in it: their approval is recorded in three independent
places (the four files, `a27cb60`'s message, and sibling ADR-0005, approved in the same sentence,
whose index row *was* updated), so only the listings disagreed and the listings were wrong.

## The one thing to check

**If that approval never happened, this correction is wrong** — and so have the four ADR files been,
for six weeks. Nothing here re-approves anything; four cells were corrected to match a decision the
record says you made on 2026-08-26. Say so if the record is wrong and I will reverse it and declare
the four contested instead.

## Declared-but-unreachable surface

**Unchanged at 7.** Nothing in this phase is a capability.

## What is next

B2 (ADR-0022's lawful basis) is with you and remains the only policy blocker on documents. Row 8's
obligation — reading the English test providers' terms — may still move the
`english_test_certificate` threshold. The unblocked list is now empty: blocker 12 was already
answered and 15 was done in P40. What is left on it is yours — a real portal, a specialist review,
Bedrock credentials, an account.

---

# Where we are — 2026-09-08 (P50)

**Date:** 2026-09-08 · **Phase:** P50 · **ADR:** [ADR-0084](./decisions/0084-the-census-is-generated-and-its-arithmetic-is-checked.md)

> Read [`state-of-the-system.md`](./state-of-the-system.md) first.

## The headline

**§7's test table did not add up to its own stated total, and had not for weeks.**

```
its rows summed to               1,824
plus its own "everything else"    ~346
                                ------
                                 2,170
against its own stated total     2,306
```

A hundred and thirty-six tests unaccounted for, in the document the README says to read first.

Six of the twenty rows were also individually wrong — `packages/domain` 351 against **373**,
`apps/conversation-service` 292 against **330**, `packages/documents` 52 against **67**,
`packages/profile` 39 against **46**, `packages/case-store` 139 against **143**,
`packages/extraction` 23 against **27** — every one understating. And **`scripts`, with 264 tests,
had no row at all**: the largest area outside the top three, invisible.

## The distinction worth keeping

Detecting the six wrong rows needs a suite run. **Detecting that the table does not add up needs
addition**, and nothing had ever added up the table it was reading. The expensive half of the defect
hid the free half.

**The tilde is the mechanism.** `~346` cannot be wrong. No reader could tell 346 from 482, and no
check could either, because the table was not claiming to be exact. An approximation inside a record
is not modesty about precision — it is an assertion that cannot be falsified, sitting in a document
whose whole purpose is to be checkable. The generated figure is exact, and a test fails if a tilde
comes back.

## Why this one is generated, when two phases ago I refused to generate

ADR-0082 was asked exactly this about the declared-but-unreachable table and said no, because that
table's second column is *"why it is kept"* — a judgement citing ADR-0019 and ADR-0071 that a
generator would drop or force into a checker.

This table has no such column. Twenty area names and twenty integers, and nothing in it a person
knows that a run does not.

**Generate what is arithmetic, check what is judgement, and never confuse them.** That is the rule
the two decisions make together, and it is the useful thing to take from three phases of this.

## A deadlock I built and then removed

The generator's first version threw on a non-zero exit and locked immediately: the census guard fails
while the table is stale → the suite is red → the census cannot run → the table stays stale. Not an
edge case. It is the **normal** case, because the reason to run a census is that the suite changed
and the table has not caught up.

It now reads the report either way, writes the table, names the failing files, and passes the exit
code through. It never reports a green suite it did not get.

## And the P47 mistake, inside the fix for a different one

The fourth regression — removing the census markers — first failed as a **collection crash**. Vitest
reported *"no tests"*, which fails the run without saying why, because the section lookup asserted at
module scope. That is exactly the thing P47 was about: a check that fails for a reason it never
states. The absence is a value now, and the marker has its own named test.

## The gap the phase found in its own fix

A generated number that nobody regenerates decays exactly as a hand-written one. The guard checks the
table **adds up**, not that anyone has re-run it — and that showed immediately: the census said 2,313
while the suite was 2,314, because I added a test after generating.

CI's integration job now *is* the census (`pnpm run census`, with a default reporter as well as the
JSON one so a red job still prints test names), followed by `git diff --exit-code` on the document. It
costs no extra suite run, and it is the only place the whole suite runs against a real database — the
only run whose numbers are the true ones.

That change also made ADR-0084 wrong mid-phase: it said the census would not run in CI. Corrected in
the ADR rather than left standing, which is the least this particular phase could do.

## Declared-but-unreachable surface

**Unchanged at 7.** Nothing in this phase is a capability.

## What is next, and a judgement about it

This is the third consecutive phase about the integrity of the records rather than the system, and
they were worth doing — each found something that had been wrong for weeks in the document the README
points at. But the thread is finished. What was hand-maintained and checkable is now checked; what is
arithmetic is generated; what is judgement stays prose and says so.

Everything left on the blocker list is yours: **B2** (the ADR-0022 lawful basis, still the only policy
blocker on documents), a real portal, a specialist review, Bedrock credentials, an account. Row 8's
obligation — reading the English test providers' terms — may still move the
`english_test_certificate` threshold.

Absent one of those, the honest next targets are inside the system rather than its records: the
walkthrough's coverage of the paths added since P37, and `apps/chat-integration`'s standing as a
research build whose four browser files are a fifth of the serialised lane.

---

# Where we are — 2026-09-08 (P51)

**Date:** 2026-09-08 · **Phase:** P51 · **ADR:** [ADR-0085](./decisions/0085-a-published-demonstration-is-guarded-on-what-it-shows.md)

> Read [`state-of-the-system.md`](./state-of-the-system.md) first.

## The headline

**P37's precedent was applied to one command and left off four.** `pnpm run walkthrough` printed
REFUSED through nine consecutive steps and exited 0, because a demonstration with no expectations
cannot be wrong. ADR-0072 fixed that one. `package.json` publishes twelve commands, and five —
`interview-demo`, `extraction-demo`, `catalogue`, `interventions`, `inspect-discovery` — had **no
guard of any kind**.

I ran all five. **Every one behaves correctly.** That is not reassurance: it is the same sentence
that was true of the walkthrough the day before it rotted.

## Exit code is not the property

The walkthrough's defect **passed** an exit-code check. A guard that runs a command and looks at its
status reproduces the failure it is meant to catch. So each is asserted on what it exists to show,
and `extraction-demo`'s two halves are deliberately **not** symmetric:

- The honest reader being refused is P37's shape — visible, embarrassing, harmless.
- **The inventing reader being accepted** means ADR-0016's guarantee, that an extracted value must
  quote the document, has stopped holding. It would exit 0 and look like a working demo.

The regression proving the second case is the reason the file exists. Making the confabulating reader
honest fails exactly one test, by name.

## The mistake I made, and what it turned into

Looking for demonstrations that report a refusal as a success, I found `extraction-demo` ending with

> `0 readings accepted, 8 discarded. Nothing was shown to the student.`

and reported it as exactly that defect. **It was not.** That is the tally of section *three* — a
deliberately confabulating reader, correctly discarded — in a three-section demo whose first section
accepts nine. I had read the tail of a run and taken half of it for the whole.

But the line was worth changing, and the misreading is why: the last line of a long run *is* the line
read on its own, and on its own it says the demonstration accepted nothing. It now names the reader
it counts and gives the honest section's total beside it. The contrast **is** the demonstration, so a
summary reporting one half is worse than no summary.

## What is deliberately not done

- **The walkthrough is not widened** to the paths added since P37 — the escalated-run resume, the
  refusal wordings, the second-attempt exchange, retention and expiry. Those are exercised by
  `scripts/p18`–`p21` and `journey.test.ts`. A walkthrough that narrates everything narrates nothing,
  and what the demo is *for* is a decision rather than a gap.
- **`discover` and `inspect` are not guarded**, and are excluded by name. Both drive a real browser at
  a real portal, which is blocker 1. A guard that cannot run is worse than none, because it appears
  in the list as coverage.

## Declared-but-unreachable surface

**Unchanged at 7.** Nothing in this phase is a capability.

## What is next

Nothing on the blocker list is mine. **B2** (the ADR-0022 lawful basis) is the only policy blocker on
documents and it is with you; so are a real portal, a specialist review, Bedrock credentials and an
account. Row 8's obligation — reading the English test providers' terms — may still move the
`english_test_certificate` threshold.

The remaining unblocked item I can see is `apps/chat-integration`: a research build against a
codebase that is now ten weeks stale, whose four browser files are a quarter of the serialised lane
and whose value is as evidence that the secure channel is implementable on AskiMate's real stack
shape. Whether that evidence is still worth its cost is a judgement about the product, not the code,
so it is a question for you rather than a phase I should take on my own.

---

# Where we are — 2026-09-08 (P52, in progress)

**Date:** 2026-09-08 · **Phase:** P52 · **Status: OPEN — `main` went red at P51 and the cause is only
partly established.**

## What happened

CI run #132, on commit `04ea0d9`, failed three tests in
`apps/chat-integration/src/conversation-service.test.ts` — all SSE reconnect-cursor assertions. The
other job passed. Eleven consecutive CI runs before it were green.

**That commit does not touch this file.** Whatever this is, it predates P51's changes to the test.

## What is established

**A real attribution defect, now fixed.** `streamObservations` is a single module-level array shared
by every test in the file, and two tests claimed their own entries by snapshotting `.length` and
slicing. That is sound only while no other test's page is still reconnecting, and a closed page is
not instantly quiet. It explains CI's `expected [ '3' ] to deeply equal [ null ]` precisely: a stray
reconnect from the previous test, carrying its cursor, inside this test's slice. Every page opens its
own conversation, so observations now carry a `conversationId` and each test filters by it.

**One assertion asked the wrong question, now fixed.** `expect(streamUrls.at(-1))` asserts that the
*most recent* connection resumed at ordinal 1. Nothing guarantees that, and any legitimate later
connection falsifies it. The property is that the connection the reload opened resumed at 1 and none
ever resumed from zero. That is what it asserts now, and it holds however many connections follow.

**It is fragile, not starved.** The file passes with the box saturated by four CPU burners. This is
not the P47 contention class, and no assertion was made more patient.

## What is NOT established, and must not be written down as though it were

- **The cause of the `at(-1)` failure.** A three-second stall before the assertion — long enough to
  cross the 1.5s `maxStreamMs` recycle — did **not** reproduce it. The recycle story is plausible and
  undemonstrated, and the test file now says so rather than asserting a cause.
- **That the fix closes it.** After the attribution fix the third test still failed **once in four**
  whole-file runs, then a full suite passed. Measured rate is roughly one in five, before and after,
  and 0-of-5 versus 1-of-5 does not separate them.

## The honest position

One demonstrated mechanism is fixed. **An intermittent failure in this file remains open**, at
roughly one run in five, cause unknown. It is recorded here rather than closed, because a red result
that gets re-run until it is green is precisely what makes red stop meaning anything.

`apps/chat-integration` is a research build against a codebase now ten weeks stale, kept as evidence
that the secure channel is implementable on AskiMate's real stack shape. It is now also the only
thing making the suite intermittently red. Whether that evidence is still worth its cost is a product
judgement, and it is yours.

---

# Where we are — 2026-09-08 (P53)

**Date:** 2026-09-08 · **Phase:** P53 · **ADR:** [ADR-0086](./decisions/0086-the-research-build-is-removed-and-what-it-proved-is-kept.md)

> Read [`state-of-the-system.md`](./state-of-the-system.md) first.

## The decision, and the check before it

You said remove `apps/chat-integration`, and told me to stop if removal would lose something the ADRs
do not already carry. **It would have**, so I stopped and asked, and the answer was to port first.

Four assertions in `two-origin.test.ts` were never about the research build. It imported
`createConversationApp` and `createSecureApp` — the **two deployables** — and asserted on them: no
route on the conversation plane accepts a secret, no route on the secure plane accepts an ordinary
message, the two `__Host-` cookies are not interchangeable, and a direct POST while a secure step is
open is refused and stored nowhere.

An ADR saying *"we demonstrated this once"* is not a check that fails the day it stops being true.
They are now in `scripts/plane-separation.test.ts`, booting both real services, launching **no
browser**, running in four seconds — and proved to bite by two regressions against production code.

## What removal found

**The production client's `postMessage` had no wildcard-origin rule over it.** `check-boundaries.ts`
forbids `postMessage(x, "*")` in a named list of files. That list held the secure service's control
client and the **research build's** `SecureFrame.tsx`. It never held `journey.ts`, which mounts the
real frame and posts the real handshake in the deployed service.

So the one `postMessage` a student's browser actually makes has been unchecked the whole time, and
the only reason it surfaced is that taking a file away made the rule complain about a missing path.
The list now names `journey.ts`.

Three boundary rules that read only research-build files were **deleted, not left dormant**. Each sat
behind `if (existsSync(…))`, so removal would have quietly turned them into rules that check nothing
— which ADR-0085 §2 already says is worse than none, because it looks like coverage.

## What is deliberately not carried across

Two properties need a real browser *and* a real secure frame — the password staying out of every
postMessage that crosses the boundary, and a bootstrap capability never being fetched when it cannot
be used. Both are about the **client's** behaviour, and that client is the one being removed. The
production client is a different implementation of the same design, so they do not transfer by moving
a file, and `student-client.test.ts` configures a `secureOrigin` with nothing listening on it.

Rebuilding them against `journey.ts` is a phase. It is recorded as one.

## On the P52 intermittent

It lived in this app and goes with it. **Its cause was never established.** The two fixes made while
chasing it — observations attributed by conversation rather than array index, and an assertion asking
for the first connection rather than the last — were real and are removed with the file they were in.
That is a closed ticket, not a solved problem, and the difference is worth keeping straight.

## Declared-but-unreachable surface

**Unchanged at 7.** `apps/chat-integration` sat in the standing account's table B — the granularity
the register does not track — never in the register itself.

## What is next

Nothing on the blocker list is mine. **B2** is with you, and so are a real portal, a specialist
review, Bedrock credentials and an account. The two browser properties above are the one piece of
engineering I can name that is unblocked and worth doing.

---

# Where we are — 2026-09-08 (P54)

**Date:** 2026-09-08 · **Phase:** P54 · **ADR:** [ADR-0087](./decisions/0087-the-four-lawful-basis-determinations.md)

> Read [`state-of-the-system.md`](./state-of-the-system.md) first.

## B2 is answered

Four determinations, named to you, dated today, review 2027-09-08. Storing identity documents and
storing academic documents on Article 6(1)(b) with no separate authorisation; **disclosing** on the
same basis **and** specific student authorisation; a minor's route on Article 6(1)(a) consent from
the guardian, plus authorisation.

The reasoning is registered, not just the answers — consent is deliberately not the basis for the
first three, because a student who cannot get their application submitted without agreeing has not
freely given anything, and a record claiming consent there looks like compliance and is not. That was
already ADR-0022's argument; it is now a property a test asserts, so an edit that changes the basis
cannot leave the paragraph behind.

**Determination 3 is the one that changes behaviour.** The preview, the authorisation text and the
content hash existed and nothing said they were required. Now something does.

## The national ID condition, and why it is a subset

Article 9(2)(a), explicit consent, asked separately at upload — for the national identity card and
**not** the passport.

It is scoped to one document type *inside* one determination rather than flagged on the determination,
because a flag would make the passport carry a condition it does not need, and a consent asked
without cause is not caution: it is a request the student cannot refuse without losing something,
which is exactly the bundled consent the determination avoids by naming contract. A global table over
all fourteen document types was also rejected — it would have to say something about the twelve you
did not rule on, and inventing "not required" for them is the false record ADR-0023 refuses.

Your reason for why consent works here is in the determination itself: **the student has a passport
as an alternative, so the choice is real**, and if that ceases to be true this must be revisited. A
test asserts the reasoning still says so.

**ADR-0077 does not cover this**, and the ADR says so explicitly. That decision made a
special-category *field* unextractable. Holding the image is processing the data whether or not
anything reads it — a different question, and one nothing had asked until you did.

## What else assertStorable needs — measured

I ran every (document type, purpose) pair through the real gate with the real schedule and the real
register rather than reasoning about it:

**Ten of seventy pass both gates. Before B2, none did.**

| refusal | pairs |
|---|---|
| no retention policy — the pair is not a real combination | 58 |
| the bank statement, B1 row 12, deliberately unresolved | 1 |
| **a policy exists and no determination does** | **1** |

That last one is **`other / audit_evidence`** — B1 row 5, six years from `case_concluded`. It has a
retention policy and no storage determination, because the audit record is the transmission record,
the preview hash and the authorisation text (ADR-0077), not an uploaded document. Storing a
*document* under that purpose is therefore refused, which is probably right. **It is not mine to
decide, so it is recorded as an open question rather than closed.**

## What remains, and one thing that just became live

**The vault does not open, and nothing left is a decision:** no transport by which bytes arrive, no
`DocumentStore` implementation, no deployable holding a vault.

**Blocker 8 changed character.** The DPA 2018 Sch. 1 appropriate policy document must exist *before*
special-category processing. It was hypothetical while nothing was in scope; ADR-0087 puts a national
identity card in scope, so it is now a live prerequisite, and registering the Article 9 condition does
not satisfy it. That one is the DPIA owner's.

## Declared-but-unreachable surface

**Seven, unchanged — and what it does now is nothing, which is the honest answer.** Both policy gates
have their inputs; neither `assertStorable` nor `authoriseDisclosure` has a caller. The blocker was
never only policy. I rewrote both register entries so they no longer cite B2 and say plainly that the
obstacle is transport, an implementation and a deployable.

## What is next

Yours: a real portal, a specialist review, Bedrock credentials, an account, and blocker 8. Mine, and
now unblocked: the document transport phase is the thing these four determinations were waiting for.

---

# P55 — the Schedule 1 document must exist before the processing (ADR-0088)

Two things P54 recorded and did not settle. You settled both on 2026-09-08, and both are now
structural rather than written down.

## `national_id` is refused at the gate, and the passport is not

> Make it structural, not a note: `national_id` must be refused at the gate with a stated reason
> naming the missing policy document, so re-enabling it is a deliberate act rather than an oversight
> correcting itself.

`assertStorable` refuses a national identity card **with a perfect Article 9 consent** — given, asked
separately, wording recorded — because the missing thing is not the student's to give. The refusal
names the DPA 2018 Schedule 1 appropriate policy document, names the DPIA owner as holding it, says
it is *a deliberate refusal, not a defect*, and says what re-enabling would take.

**The determination is untouched.** Nothing here says ADR-0087 is wrong: it is made, named, dated and
correct. A different person owes a different document. That is why the record is separate from the
determination rather than an edit to it — folding them together would make re-enabling read as a
*correction to a determination that is not wrong*, when it is somebody else finishing something else.

**`held` is not a boolean**, deliberately. It demands a reference, a named confirmer, a confirmation
date and a review date. A `satisfied: false` becomes `true` in one keystroke with no record of what
was relied on; this cannot, which is what *"a deliberate act"* means in code.

## `other / audit_evidence` is decided, and the code now says which kind of refusal it is

I had recorded it as an open question. Your answer:

> Allowing a document to be stored under that purpose would extend the six-year period from a receipt
> to a passport scan, which is what ADR-0078 was written to prevent.

Recording that in prose would not have been enough, and the reason is worth stating. `NoLawfulBasisError`
said one thing for two different facts: an activity **awaiting** a decision, and an activity whose
decision **is** the refusal. A later phase reading the second as the first closes it by registering a
determination — which is exactly the outcome the decision was made to prevent. The retention side has
had this distinction since ADR-0023 (*nobody looked* vs *somebody looked and could not say*); the
lawful-basis side now has it too, and the message a person reads ends **"do not close this by
registering a determination."**

`financial_evidence` is the control: no determination and no decision against one, so it must keep
reporting an absence. A test holds both states apart.

## A staleness I found by reading my own output

`pnpm run retention-status` still closed with *"a registered lawful basis … which is **NOT yet
determined**."* That became false one phase ago — by the change that determined it. Ninth consecutive
phase to find a record asserting something untrue, and this one was produced by the fix for the
previous one. `README.md` had the same shape: *"Two decisions are waiting on a person and block all
document handling: B5 · B1"*, both answered on 2026-09-07.

## Declared-but-unreachable surface

**Seven, unchanged.** The Schedule 1 gate lives inside `assertStorable`, whose register entry already
says it has no production caller; giving one of its four checks its own entry would answer the
register's question at a granularity it does not work at, which is the rule ADR-0082 set when it
refused to list `recommendWait`'s branch as a symbol.

What it does now: still nothing, and that is still the honest answer. Every policy gate is answered.
What holds the vault shut is transport, an implementation and a deployable.

## What is next

The document transport phase. Nothing is holding it.

---

# P56 — a national ID leaves the supported document types (ADR-0089)

You read P55's result and made the stronger argument:

> Keeping a document type that is refused at the gate means carrying a determination, an Article 9
> condition, a consent flow and a policy-document gate for something no student can use. That is
> unreachable surface with a policy justification attached.

That is right, and it is right about the phase I had just finished. A refusal at the gate is still a
gate — with a determination behind it, a consent interface in front of it, an error class, a
register, a test suite and a paragraph in four documents. All of it for a type nothing can store.

## What I checked before deleting

Nothing was lost. ADR-0077's special-category **field** guarantee is about the profile registry, not
document types, and no extraction plan reads a national ID. The minors gate reads
`birth_certificate`. No blueprint, mapping, catalogue entry or discovery fixture mentions it. The
Article 9 apparatus and the Schedule 1 gate were built in P54 and P55, for this type, and nothing
else names them.

**The one that looked like a loss.** Deleting the Article 9 machinery appears to leave a future
special-category document type ungated. It does not, and the reason is an older control:
`DocumentTypeNotCoveredError` refuses any type no determination names. A new type cannot be stored at
all until somebody writes a determination for it — which is exactly the moment those gates have to be
rebuilt. The apparatus was never what kept an unruled-on type out; absence of a decision was, and
still is (ADR-0023).

## The determination was correct; the type is what left

ADR-0089 records the whole argument rather than deleting it: the Article 9(2)(a) reasoning, why
consent worked there when it fails for the activity as a whole, why the condition was scoped to one
type rather than flagged on the determination, the consent gate's three checks, why `held` was not a
boolean, and the three-month expiry threshold and its principle.

**Re-adding it needs the Schedule 1 document first.** That constraint did not go away because the
code did, so it is written at the `DocumentType` union itself — the line somebody widening the scope
actually edits — and not only in an ADR nobody thinks to open.

## What removing it found

**The schedule parser was casting, not checking.** `policy["documentType"] as DocumentType` accepts
any string in the file and types it as a lie: a schedule naming a document type the system does not
have would have loaded, validated and been reported as a configured period. Removing a union member
is precisely the case a cast cannot see. Tenth consecutive phase to find a record asserting something
production does not do.

## The record I did not edit

`config/retention/v1.2026-09-07.json` carries `AAS-RET-B1-02` — 365 days from `last_used` for a
national ID, one of the eleven periods you determined and approved by name on 2026-09-07.

I did not touch the file. That determination did not become *wrong*, it became *moot* — the same
distinction you drew about the Article 9 determination — and an approved schedule version is a record,
superseded rather than rewritten, which is what `validateHistory` exists for. Editing it would
falsify a correct record; superseding it would need an approval nobody has given for a period nobody
is changing. So `pnpm run retention-status` reports it under **"Determined, and now out of scope"**,
with its reference and version.

## One thing I got wrong and fixed

Writing the regression for the cast, I found a test of my own that could not fail: it asserted the
report contains no `✓ national_id` row, which is true with the cast restored *and* with the check in
place, because `national_id` is not in the pair list and both paths print the same table. That is
ADR-0072's shape, in a test written twenty minutes earlier to catch it. Replaced with a fixture
naming an invented document type.

## Declared-but-unreachable surface

**Seven, unchanged — and this time the change was subtractive.** Both removed gates lived inside
`assertStorable`, whose register entry already said it has no production caller, so the deletion took
machinery away rather than a register row.

## What is next

The document transport phase.

---

# P57 — the document transport (ADR-0090)

**B4 is answered.** It was the last of the five blockers ADR-0067 enumerated four weeks ago, and the
only one that was engineering rather than policy.

## The shape, and why it is two steps

```
POST .../documents           declare it   ← THE GATES RUN HERE
PUT  .../documents/{id}/content   the bytes
```

Multipart was the obvious answer and it has exactly the defect this avoids: the server would have to
read the body to find out whether it was allowed to. A refusal that arrives after a passport has
crossed the wire has already failed — the bytes were received, and "we did not keep them" is a claim
rather than a structure.

What enforces it is the **type**, not the order of statements in a handler. `openIntake` takes a
`StorableUpload`, which only `assertStorable` can mint. There is no way to get an intake for a
document whose retention policy and lawful basis were never established.

The declaration answer states the constraints rather than making a client guess: the ceiling for that
document type, the content types it may arrive as, the hash that will be checked, and the retention
policy reference the gate actually resolved — which a client can put in front of a person.

## `assertStorable` is reachable

It has been on the declared-but-unreachable list since P39, and the reason was never engineering:
every policy blocker in front of it was open. **The table goes from seven to six — the first entry
ever to leave it.**

The register found the move itself and failed the build until I corrected the entry, which is what it
was built for.

## What I did not ship, and refused rather than pretended

The store is in-memory, and it **refuses to start under `NODE_ENV=production`**. One check, at wiring
time, with no configuration check beside it — ADR-0055 recorded what happens otherwise: two checks,
one reachable, and a regression deleted the real one with every test still green.

The durable encrypted store is the next phase. Rushing it in would have meant a durable store without
the customer-managed key ADR-0010 requires — the thing the constraint constrains, shipped without the
constraint.

## Two things the regressions found

**A vacuous test of mine.** The expiry assertion lived only inside a `catch`, so deleting the expiry
check made the test pass — no throw, no catch, no assertion. Second one in two phases, and both times
in a test written to prevent exactly that.

**A guard that had not been exercised in nine phases.** `unreachable-is-documented.test.ts` PINNED
the unreachable count with a literal `/Seven capabilities/` instead of checking it, so the day the
number moved it failed saying "the word 'Seven' is now wrong" and named no replacement. P49 removed
that shape once already; it survived here because the count had not changed since P39. A constant is
a guard nobody sees fail.

## Sheffield

Recorded in `docs/target-sheffield-pgt.md`, not acted on. **No discovery run has been made**, and the
impact note you asked for is in that file — the short version is in my report. The three-choices
question is recorded with your instruction not to pre-empt it.

## Declared-but-unreachable surface

**Six, down from seven.** First time it has shrunk.

## What is next

The durable, encrypted document store — envelope encryption under the `DataKeyProvider` port that
already exists, and the production refusal that comes off when it lands.

---

# P58 — robots.txt is read, obeyed and kept; requests are paced (ADR-0091)

Your two preconditions, both built. **No run has been made.**

## The first one shaped the design more than the parsing did

> The difference between "we respected the rules" and "we did not look" is the whole difference if
> anyone ever asks.

Obeying is half of it. Every run now writes `robots.json` holding the file **verbatim**, the host,
the status code, the time it was read and the group that was applied — because a crawler that quietly
complies leaves no evidence that it complied, and the evidence is what the question is about.

It is read over plain HTTP before the browser opens: a page load runs the site's JavaScript, and
reading a text file should not execute anything, least of all before we know what the file permits.

An **unreadable** robots.txt allows nothing — RFC 9309's rule, and the only reading that matches your
sentence: a run that could not read the rules has not respected them. A **404** allows everything,
because the site has told us there is no policy. The two are different facts and I kept them apart.

It applies to every request, not only to navigations. That is the inconvenient reading and the
defensible one, and it has a cost I recorded rather than hid: a page whose stylesheet sits under a
disallowed path did not render the way an applicant sees it, and the run says so in those words.

## The floor is structural

One second, in one `Math.max`. A target file may ask for slower; a site's own `Crawl-delay` may raise
it further; nothing may lower it. A target file asking to go *faster* is refused rather than clamped
— somebody wrote that number meaning something, and silently ignoring it would leave them believing
the run is doing what they asked.

## What building it found — four defects, none in the new code

Adding a second rule to a guard that had only ever had one is what surfaced them.

1. **`portalAttemptedWrite` was `blocked.length > 0`.** A run that skipped a single
   robots-disallowed stylesheet would have reported that the portal attempts writes during ordinary
   browsing. A serious finding, invented.
2. **The CLI never called `summarise()`.** The blocked log had a careful breakdown and the CLI
   printed a hard-coded warning instead.
3. **The robots fetch assumed `https://${host}`.** Against the fixture portal — loopback HTTP — it
   failed, the policy became `unavailable`, and the run correctly fetched nothing. **Correct
   behaviour from a wrong input**, which is the worst kind of bug to leave in a safety check: it
   fails closed and looks exactly like the rule working. Only "Pages visited 0" gave it away.
4. **The crawl-loop check masked the network guard.** I deleted the guard as a regression and every
   test stayed green. ADR-0082's "two checks, one reachable", in a new place. Closed by a fixture
   page referencing a disallowed *sub-resource*, which the loop never sees.

## The measurement

`RequestTally` counts navigations against sub-resources, with a per-page average and a breakdown by
resource type, printed and written to `run.json`. The "plausibly 1,500–4,000 GETs" in the target
document was honest about being a guess; it does not have to be one now.

## What is next

The scoped Sheffield run — 10 to 15 public course pages — needs a target file with real seed URLs,
which I do not have and will not invent. Then the durable encrypted document store.

## Declared-but-unreachable surface

**Six, unchanged.**

---

# P59 — the document never enters a process we run (ADR-0092)

Your decision, recorded in your words and nobody else's. This phase built what the decision is
conditioned on, and nothing it is not.

## What the boundary check did, and how it is recorded

I tried the obvious durable store first — encrypt in-process, key providers from `packages/secrets` —
and `check-boundaries.ts` failed the build. That is now written down the way you asked: a real
control that stopped a wrong design early. It fired on a design rather than on a stray import, and
it fired correctly.

## What is recorded as considered and not taken

`packages/keys`, with your reason: under D, SSE-KMS does the encryption and the extraction would be
thrown-away work. The sixth deployable, with the argument that decided it — that it does not deliver
its own promise once the session is bound to one origin. Amending the rule, out, on ADR-0080's
reasoning. All three in ADR-0092, quoted rather than paraphrased.

## The verification

`pnpm run verify-s3-checksum`. It runs five experiments against a real bucket and says VERIFIED,
REFUTED or NOT CHECKED. The part I want you to look at is `judge`: it will not say VERIFIED unless
an *unbound* URL accepted the same substituted bytes that the *bound* one refused, because a refusal
with no control is a result that cannot fail. I removed the control requirement as a regression and
exactly the vacuity-guard test failed. Without a bucket it says NOT CHECKED, exits non-zero and writes
nothing — a verification that could not run must not look like one that passed.

## The request

`docs/provisioning-request-s3-verification.md`. One bucket, `eu-west-2`, one prefix, three actions,
a temporary credential, cost rounding to zero. It does not name the bucket. This environment can
reach S3 — I checked the tunnel before writing the request — so the run can be made from here once
the credential exists.

## What I did not do

Reshape the port. Add the SDK to any package. Touch `packages/secrets` or the boundary rules. Create
anything in AWS.

## Declared-but-unreachable surface

**Six, unchanged.**

## What is next

Yours: the bucket and the credential. Then mine: the run, the verdict reported in the run's own
words, and — only on VERIFIED — the port.

---

# P59, amended — the KMS half is required, and the request is approved

Your words, on reading the provisioning request: approved, you are creating it, and *"do section 4
as well, not optionally"* — because ADR-0010 requires a customer-managed key, under D the encryption
is S3's, and *"if a pre-signed PUT cannot carry SSE-KMS under a CMK the uploader has no grant to,
then D has a hole in it."* Billing alerts first, all four thresholds.

## What changed to match

- `verify-s3-checksum` **refuses to start without `AAS_S3_VERIFY_KMS_KEY_ID`**, before any request
  is made — a run without the KMS half is not the run you approved, and a binding verdict on its own
  would invite reading half an experiment as the whole. Tested: with a bucket name set and no key,
  it exits 1, says the half is required, says nothing was sent to AWS, and writes no record.
- The exit code is **zero only when both halves are VERIFIED.** They stay two verdicts.
- A KMS refusal is named, in the run's own text, as **a different problem** from the binding — your
  instruction: *"named as such rather than folded in."* Tested on the reason text, and the binding's
  reason is asserted not to absorb it.
- The provisioning request now has §0 (billing alerts before any resource), the CMK under §1, the
  credential's one KMS action (`kms:GenerateDataKey` on that key, no `kms:Decrypt`), the key
  variable marked required, and §4 retitled *required*. §5 says what happens on each of the four
  outcomes, including KMS REFUTED on its own.
- ADR-0092 §4 carries the amendment and the approval, quoted.

## What has not happened

Nothing has run against AWS. Nothing has been created by me. I am waiting for your message that the
variables are set, and until then the command is not invoked — not even to see the STS identity.

---

# P60 — an upload URL cannot be minted unbound (ADR-0093)

You said: both halves VERIFIED, condition 1 met, reshape the port — and make the run's constraint
structural in the minting code, impossible rather than noted. Done, and the second part is the part
I want you to look at.

## Where the impossibility lives

`mintBoundUpload` in `packages/documents/src/bound-upload.ts` is the only thing that can produce a
`BoundUploadUrl`, and the route can only put a `BoundUploadUrl` on the wire. It computes the
checksum header from the intake, tells the presigner which headers may not be hoisted, and then
reads the URL it gets back and refuses it if the checksum is in the query string, if the signature
does not cover the three headers, or if it would outlive the intake. A presigner that hoisted — this
SDK by default, or a future one by regression — produces a URL the mint throws on. The declaration
answers 503 and nothing reaches a browser.

The proof I would show you first is `s3-document-vault.test.ts`: it presigns with the real SDK,
offline, the way the adapter does and the way the SDK does by default, and the same function accepts
the first and refuses the second. That is your finding, as a test that fails if it stops being true.

## What the port is

Declare (gates run, bound upload minted, headers stated) → the browser PUTs to the bucket → confirm
(the bucket is asked what it holds; recorded only from a `ReceivedUpload`). `PUT …/content` is gone,
`acceptBytes` with it, and `express.raw` is no longer imported by the conversation service: no route
on it reads a document body. `prepareRetrieval` mints a short GET for the runner; nothing calls it
yet.

## What I did not do

Durable metadata and production wiring — records and object keys are in a Map in both
implementations, and `assertDocumentStoreIsDurable` still refuses production. CORS on the bucket.
Binding content-type (the run did not verify it, so the URL does not sign it, and nothing trusts the
bucket's). Nothing ran against AWS: the adapter tests sign with fake credentials and send nothing.

## The two things you asked before the reshape

The branch is merged into `main` as a fast-forward. Its CI was red at one step only — the committed
census was one run behind the five tests it added — and every test step in both jobs passed,
browser-runner suites included; the census is regenerated and `main` is green.

## Declared-but-unreachable surface

**Six, unchanged.** `purgeContents` has an implementation now, not a caller.

---

# P61 — document metadata is durable, and the transport starts in production (ADR-0094)

The first thing P60 left. Intakes and records are in the database now, in two tables that have no
column a byte could go in, and the real entry point builds the transport from four environment
variables. Started with them set, it says `documents=s3`; without them it starts as before and the
routes answer 503.

## The two things worth reading

`PostgresDocumentIntakePort.take` — one `DELETE … WHERE … AND expires_at > now() RETURNING`. Three
takes racing for one intake, and one wins; that is tested. And the intake handed back is not a cast
from the row: `assertStorable` runs again on the schedule in force, so a document the schedule
stopped permitting is refused at confirm, in the gate's words.

`docs/provisioning-request-document-vault.md` — what the service's role must be allowed (put, get,
delete under `documents/*`, generate-data-key and decrypt on the CMK, no list), the CORS rule for
the page's origin with exactly the headers the run proved the URL is refused without, and the
lifecycle it should not have (no expiry under `documents/`; retention is the schedule's, not S3's).

## What I did not do

Run anything against AWS. The startup test constructs the client and sends nothing; the first
request this service makes to AWS happens on your deployment when you set the variables. The client
has no upload control yet, the retention sweep has no caller, and the runner's fetch waits on
`attach_document`.

## Declared-but-unreachable surface

**Six, unchanged.**

---

# 2026-09-10 — a decided blocker written up as a dependency, and the guard for it

You asked whether "the runner's fetch, which waits on B5" was stale or a dependency you had lost
track of. Stale, and I had written it five times in three phases — in two ADRs, a provisioning
request, the reachability register and a "not built" bullet in the state document — while the same
register's `attach_document` entry, two lines down, said B5 was decided. What gates the fetch is
engineering: `attach_document` needs the intent identity ADR-0069 names and a `WorkKind` that can
carry it (blocker 9, which already said "B5's answer no longer conditions it").

The guard, `decided-blockers-are-not-pending.test.ts`, refuses the combination that is the shape: a
DECIDED blocker in dependency framing, in any record that describes the present. It found a sixth
instance on its first run — my own correction note, quoting the phrase. The journal and the
changelog are not scanned: an entry from before 2026-09-07 is supposed to say "blocked on B5".

Two more present-tense statements went stale the day you created the bucket: "Infrastructure
provisioned: None, $0 spent". Corrected to what exists, without inventing an amount.

The date rolling over found a second thing. `PostgresDocumentIntakePort` called `new Date()` itself,
and its tests fixed their fixtures at 2026-09-09 — green all afternoon, red the next morning, because
an intake opened at a fixed instant was by then sixteen hours expired by the wall clock. The clock is
now injected. Fixing that showed the DELETE's `expires_at > $now` clause was hiding an expired row,
not removing it, while the migration's comment said "removed by the same statement when it is found".
The statement now takes the row by id and the code refuses it when expired; ADR-0094's sentence about
the statement is corrected in place. The one browser test that timed out under the full run passed
alone — load, not a defect.

# P62 — the student's page makes the PUT, and the CORS rule is exercised (ADR-0095)

The first thing P61 left. The page now has a document panel: choose a type from the list the server
sends, choose a file, and the page hashes it, declares the hash, PUTs the bytes to the bucket on the
URL the declaration answered with, confirms, and re-reads what is held. The bytes never touch this
service, and the browser test asserts that from the page's own request log.

## The four boundaries it crossed, each stated

The page computes one hash now — the upload's — and says in its header why that is the exception
and not a crack: the server never sees the bytes, and what the page computes is trusted by nothing,
because the bucket and the confirm both check it. The page never states a purpose: the route derives
it from the governing schedule's one row for the type, because a purpose keys a determination you
made and is not the student's to pick. A held document is drawn from a new `GET …/documents` read,
never from the confirm's answer, so a reload is right. And the CORS rule is not written in the test:
the test parses the JSON block out of `docs/provisioning-request-document-vault.md` and stands a real
HTTPS bucket on a second origin that admits exactly that and nothing else. The page's PUT is a real
cross-origin request with a real preflight, against the rule as you will create it.

## What I found and did not resolve

The storage gates write a `detail` for a person and the declaration route puts it on the wire. The
contract's `Problem` has no `detail` by your decision of 2026-08-28 ("closed, explicit contracts";
`problems.ts` says "there is nowhere on the wire for a sentence to be assembled"), and its parser
drops it. So the page can only say "That is not something you can do here" for a refused document,
and the route sends a sentence the contract says cannot exist. Both rules are yours; I have recorded
it as blocker 18 and not chosen between them.

## Declared-but-unreachable surface

**Six, unchanged.**

---

# P63 — expired document intakes are swept by the worker (ADR-0096)

The last thing P61 left. With the page's upload control live there will be declarations nobody
confirms — a file the bucket refused, a tab closed — and each leaves a row that `take` will never
return and nothing else reads. The worker now has a fourth job that removes them: one bounded
DELETE, oldest first, every sixty seconds under the same lease as the other three.

## What it deliberately is not

It names no vault. The worker is still forbidden the documents package, and the function it calls is
a DELETE over a table that cannot hold a byte. Its test writes the abandoned rows by hand rather than
through the port for exactly that reason. And it is not the retention sweep: that destroys a document
you were given, on a clock a policy started, and `purgeContents` still has no caller.

## Declared-but-unreachable surface

**Six, unchanged.**

---

# P64 — the preview names what the student holds (ADR-0097)

The first slice of the attachment path, after measuring where it is cut. The driver used to hand the
preview an empty document map, so a mapping that attaches a passport stopped every run before you
were asked — whether or not the student held one. It now reads the vault's metadata, picks the
current document per type, and the preview names it: "Upload your passport: passport". The
authorisation then binds to a hash that covers the attachment, which is what your determination 3
says the authorisation instrument is.

Nothing is sent. The plan still cannot cross to the runner with uploads in it, and the transmission
gate is untouched. Slice b — the four ADR-0022 things in the presented text, per attachment — is
where I want your word first: whether one yes over a preview naming every attachment is the
"specific" authorisation you meant. I have read your determination as pointing at the preview and
written that reading down without acting on it.

## Declared-but-unreachable surface

**Six, unchanged.**

---

# P65 — one yes over a preview that names each attachment, and the gates refuse in a closed set (ADR-0098)

Both your answers are in ADR-0098 in your own words, and both are built.

The preview now writes, for each attachment, "Upload your passport: your passport / going to:
Example University (apply.example.test) / for: this application — MSc Example Studies, 2026-09".
The host is inside the hash, so the same fields and the same passport pointed at another portal is
a different thing to say yes to. That is the condition you set, and the test reads the lines back.

The gates' five refusals are three codes with words on the page, and every `detail` has left the
wire in the Conversation Service — including two that predate the transport, on the ambiguous-target
and content-changed answers, which the contract had been silently dropping since P21. A guard
refuses the next one. You asked to be told if a refusal could not be said as a code: all five could.

Nothing is sent yet. Slice c is next: uploads cross to the runner as references, and the service
answers a retrieval URL only after `authoriseDisclosure` and `mayTransmit` with the case.

## Declared-but-unreachable surface

**Six, unchanged.**

---

# P66 — uploads cross as references, and the plane hands a document over only after the gates (ADR-0099)

Slice c. A plan with uploads now crosses to the runner, but an upload on the wire is four things —
which box, which document the mapping named, where the box is — and never a byte, an id or a hash.
The runner asks the plane for each one under its lease, and the plane answers only after six checks
in order: the lease, the run at execute naming the upload, the yes still hashing to the preview
rendered now, `authoriseDisclosure` over a record built from what the student saw, `mayTransmit`
with the case, and only then a sixty-second URL. The runner runs the disclosure gate again on its
own machine and mints the brand through it, never by a cast; the executor runs the transmission
gate at the moment of attaching, as it always has. `authoriseDisclosure` has left the unreachable
register.

## What I found, and did not resolve

The runner's entry point performs `create_account` and nothing else. `fillApplication` is called by
the journey test and by no deployable. Execute work has had no production performer since P8, and
for a portal with no login it is not even handed out, because a work item carries an account's
email and approach. Both are one question — how a runner is signed in when execute work arrives —
and it is yours. Blocker 19. The gates and the hand-over do not wait on it; slices d and e do.

## Declared-but-unreachable surface

**Six** — `authoriseDisclosure` out, `fillApplication` in.

---

# P67 — the page decides whether it can show the secure step before it asks for the capability (ADR-0100)

The two properties ADR-0086 left open are rebuilt, inside the journey's real secure step. The page
now consults `decideRendering` before it asks for the bootstrap — over this build, the browser's own
`isSecureContext`, and a probe of the secure origin it reads from a route that mints nothing — and a
page that cannot show the step says so in a fixed sentence, mounts no frame, and leaves the Secure
Plane's `frame_tokens` exactly as it found them. The journey builds the student page and the secure
control from the tree, opens the student's own browser on the page, and the password is typed into
the real cross-origin frame; the receipt reaches the conversation log through the real outbox.

## What I found

Since P25 the page framed `/v1/secret-requests/{id}/control`. The Secure Plane serves
`/control/{id}`, and always has. The frame was a 404 on the production path for forty-two phases.
Nothing caught it because the contract-drift guard reads routers and the page is not one, and the
journey typed the password by `fetch` — the stand-in ADR-0086 itself said was not the client. The
path now comes from `secureControlPath` in the contracts package, and the drift guard holds that
function to `secure.v1.yaml`.

Two counts in the state document's header were stale and are corrected: thirteen browser files, not
seventeen; one hundred decision records, not eighty-seven; and the AWS line now says what the README
already said since P59.

## Declared-but-unreachable surface

**Six** — unchanged.

# P68 — blocker 19, framed as a decision sheet

[`decision-sheet-blocker-19-how-a-runner-is-signed-in.md`](./decision-sheet-blocker-19-how-a-runner-is-signed-in.md),
as you asked, in the shape of B5 and B1. Five options for how a runner is signed in when execute
work arrives, each costed against what the tree actually does, what each forecloses, and a
recommendation: one signed-in sitting with authorisation moved before account creation, a second
ask through the secure box as the resume path, co-browsing deferred until a portal with a second
factor is a target, a persisted cookie rejected. "The student authenticates in a handed-off session
and the runner resumes with it" is costed as instructed: it works in exactly one form, a remote
desktop with a consent screen, and that form is the largest thing on the sheet.

On portals with no login: I cannot tell the fraction from here and the sheet says so. Both real
targets are behind an account; my expectation that open portals are an edge case is stated as an
expectation, with two ways to measure it.

Four questions in §7, each a sentence in your words. Nothing is built and nothing is provisioned.

## Declared-but-unreachable surface

**Six** — unchanged.

# P69 — blocker 19 decided: the yes comes first (ADR-0101)

Your six answers are in ADR-0101 in your words, and the one that costs nothing to keep is built:
`authorise` now comes before `request_secret` and `create_account`. A complete run on a gated
portal stops at the preview first; only an authorised run is asked to choose a password, and only
then is an account created in the student's name. The account step's refusals — a portal nobody
observed, no confirmed email — still go to a specialist before the student is asked for anything,
so a yes is never wasted on an application we cannot get into. The handover stays ahead of the
authorisation, because a student who stops mid-fill has had their approval voided and is still
owed their account.

The journey walks the new order: start → the yes → the password box in the real frame → the
account → the fill. Every driver, supervisor and orchestrator test that assumed the old order now
starts from an authorised run, and the supervisor's seeded runs stand on a verifying portal so
that an account is followed by a handoff and not by pages its loop tests were never about.

## What follows

P70 — a runner that meets a CAPTCHA or a second factor stops and says which. P71 — A2, one
sitting, five minutes. P72 — B as the resume path, then slice e. C is recorded in ADR-0101 §5 and
not built.

## Declared-but-unreachable surface

**Six** — unchanged.

# P70 — a runner that meets a CAPTCHA or a second factor stops and says which (ADR-0101 §6)

The requirement you put before slices d and e. Two codes cross the wire, `captcha_met` and
`second_factor_met`, and the runner reads the page for a challenge at four points: the
registration form before a character is typed — and before the Secure Plane is asked to spend the
handle — the page the portal answers with, the application form, and the page a fill was bounced
to. The detector keeps discovery's vocabulary and drops its loosest rules, because discovery's
`input[name*=code]` fires on a postcode box and a signal that stops a live run must not. What it
misses fails as it always did; what it sees stops with the reason named.

On the plane the code now has a home. I found, building it, that since P5 `reportWork` recorded
every failure as `failed_cleanly` and threw the code away — `needs_the_student` did nothing, and a
challenged registration would have been offered again on the next poll, which is the confusing
failure you described months early. A challenge now raises an intervention through the one stop
mechanism: a CAPTCHA is `new_portal_behaviour`, a second factor is `authentication_failure`; the
specialist reads which, during what, against what, and what discovery had recorded; for a
registration accepted before the code was asked for, that the account may already exist. The
student reads one fixed sentence per code. The run is `escalated`, which is never work.

The fixture portal presents both — a widget the POST refuses without, and a code asked for after
the form is accepted — and the real runner meets both in a real browser.

## Declared-but-unreachable surface

**Six** — unchanged.

# P71 — one sitting, in memory, five minutes (ADR-0101 §2)

Your A2, built. The runner now keeps the browser context it created the account in, keyed by
run, in memory, and fills the run's pages in it. `SessionHold` closes a context once it has been
idle for `SECURE_HOLD_CEILING_SECONDS` — a single constant in `packages/contracts`, and the
vault's ceiling is now defined from it rather than being a second literal that happens to agree.
Your rule was that two sensitive lifetimes must not differ; the way to make that hold is to have
one number, not two equal ones.

The runner's entry point performs `execute` for the first time. The held page is attached as a
fillable session confined to the portal's host, `fillApplication` types the plan and saves, and
the disclosure source of ADR-0099 fetches what the mapping named. `fillApplication` leaves the
declared-but-unreachable register: a deployable reaches it. It entered in P66 because building the
hand-over measured that no deployable did, and it leaves for the same kind of reason — the
measurement changed, not the list.

A claim now names the runs the runner holds a session for, and the wire requires it. The Run
Driver offers such a run to its holder first, and offers a fill to nobody else: a page handed to
any other runner would arrive logged out, so the run waits — for its holder, or for the resume
path. The hold is released when the last page is saved, when a challenge is met, when the student
is needed, and when the process stops. No password, cookie or token is written anywhere.

What is not built is the resume path, §3. The journey's restart test proves ADR-0047 — page two,
not page one again — but it signs the new context in with the password the test happens to know,
and hands it to a fresh hold through `adopt`. That is this test's cheat, marked as such in the
file, and `adopt` is the seam P72 fills with `portal_sign_in` through the secure box.

One finding while fixing a test: a claim that is never reported leaves its intent open, and an
open fill intent is the uncertain case the driver pauses rather than hands out. That is ADR-0054
working as written; the test that met it now closes the intent it inherits and says why.

## What follows

P72 — B: `portal_sign_in` into the published contract, the sign-in step and reason, a performer
that types into the login form, and the journey's cheat replaced. Then slice e.

## Declared-but-unreachable surface

**Five** — `fillApplication` left.

# P72 — `portal_sign_in` is the resume path, and the run says why (ADR-0101 §3)

Your B, built as you decided it: the resume path only, with the argument in the ADR and now in
the words the student reads.

The plane learns that a session is gone from the runners themselves. Every report that could only
have come from a signed-in browser — an account created, a sign-in done, a page saved — records
who and until when: the report's time plus the one ceiling, the same number the runner sweeps by.
The failures on which the runner lets its context go are one list in the contract, and the plane
erases the record on exactly those. So "no runner holds a session" is a question a table answers,
and nothing here is a cookie or a token.

Past the ceiling, and only where there is an account to sign back in to, the run asks a second
time. The box is the same secure box, typed once because the portal is the check, and the reason
is rendered inside the frame: that I have been signed out, that this is the exception, and what
happens to the password. Then the sign-in is work for any runner — the login form the reviewed
blueprint records, the handle, and no plan. The runner types the email, the fill agent types the
password, the page is asked whether it worked, and the context that signed in is the held session
the next page fills in. A sign-in writes no intent: the one thing it spends is already recorded
by the plane that spends it, and repeating one creates nothing on the portal.

Where the path cannot apply, the run says so to a specialist before any box is opened: the student
typed their password into the portal themselves and was promised we never see it; no password ever
reached us; the blueprint records no login form. The login form is new on the blueprint and
optional, so no reviewed hash moved.

Which request is the sign-in's I read from two records the system already keeps: the log says
when a box was opened, the ledger says when the account came to be, and a request opened after
the account can only be the resume path's. The Secure Plane would refuse a stale creation handle
spent for a sign-in in any case; this reading means it is never offered one.

The contract took the domain's word. `portal_password_reset` left, because nothing had ever
asked for it and a reset is the student's own act; the drift test that recorded the divergence
since P27 now asserts the agreement.

The journey's restart is the real thing now: an empty hold, the plane looked at from past the
ceiling, the second ask in the real frame, the production performer signing in over CDP, and page
two — not page one again. The password crosses exactly two wires in the whole journey, and both
are the student's own submissions.

## What follows

Slice e — the `attach_document` intent identity and a `WorkKind` that carries it. C stays
recorded, not built.

## Declared-but-unreachable surface

**Five** — unchanged.

# P73 — one intent per document attached, and the record of what left (ADR-0069's third layer)

Slice e, the last of the attachment path, and the thing ADR-0069 and the B5 sheet both left open:
`attach_document` was declared, marked verifiable, and produced by nothing, because uploads rode the
page's intent and that intent's key could not see which document went in.

Two things now. The page's key sees its attachments, by document id and hash, so a document the
student replaces makes the page one not yet saved and it is offered again; a page with no uploads
keeps exactly the key it had, so no ledger row of any run moved. And the claim opens one intent per
upload — `page/field=documentId@hash`, one function for both ends — after the lease and before the
hand-out, as the page's is. The runner's report carries what the executor recorded at the moment
of attaching, with the box it went into; the plane settles exactly the intents those name, for
this run's case only, and writes the audit row of what left. A page is not done until every
document it carries is recorded as attached: a page the runner saved without naming its file
leaves the intent open, the next claim stops on it as the uncertain case, and the stop names the
attachment rather than the page.

Found on the way: a page whose only content was an upload was never offered at all — the walk
counted fields to fill and not files to attach, and the documents page of a real portal is
exactly that page. No new work kind was needed; an attachment is part of the page item that
carries it, and its identity is its own.

## What follows

The attachment path is built end to end at the plane and the runner. What it has not yet met is a
portal that takes a file — the fixture portal has no upload field — so the runner's attachment is
proved against a recorded session, not a served page. That, and blocker 17, are the next two.

## Declared-but-unreachable surface

**Four** — `attach_document` left.

# P74 — the attachment path meets a portal that takes a file

The last line of P73 said what it had not met. The fixture portal now has a documents page — a
multipart upload between the study page and review, hashed as it lands and shown on the review
page by name — and the journey's student holds a passport: a metadata row in the plane's own
document store, and bytes behind a vault stand-in that answers the plane's sixty-second URL. The
restart test goes on to page three through the production performer, in the context the hold
kept: the plane opens the `attach_document` intent at the claim, the runner fetches the bytes,
hashes them against the hand-over, runs the disclosure and transmission gates, attaches the file
and saves the page; the portal holds the same SHA-256; the intent settles and
`document_transmissions` has the one row, naming this case, this document and this host. Exactly
one fetch from the vault, and the runner sees the name it was given — an `https` name, because the
runner refuses any other and the journey does not loosen that for its stand-in.

Two things were found by making it real. The preview named the blueprint's *observed* host as the
destination, while a run made to a deployment — `CatalogueEntry.portalOrigin`, the mechanism
ADR-0057 keeps so a reviewed blueprint can run against a university's UAT environment — sends the
bytes to another host. The plane's own transmission gate passed it, because both sides of that
check came from the same preview; the runner's refused it, `wrong_destination`, because its side is
the host the browser is pointed at. Correct, and an authorisation nothing could spend. The preview
now names the deployment's host when one is configured, so what the student authorises is where
the document goes, and the three places the driver builds a preview resolve it through one reading.
A run re-pointed at a deployment after the yes is a different thing to authorise and stops at the
yes again — the consequence ADR-0098 already stated for a change of host. ADR-0057's review hash is
untouched: it is over what a specialist approved, and moving an entry between environments must
not change it; the student's hash is over what leaves and where, and now does.

The second was smaller: a page whose plan has uploads and nothing to type was refused at the
runner's intake as an empty plan. It is a plan.

## What follows

Blocker 17 — the vault's role, CORS rule and lifecycle — is Vahid's, and nothing here provisions
anything. The attachment path is otherwise proved end to end, against a served page.

## Declared-but-unreachable surface

**Four** — unchanged.

# P75 — the destination inside the yes, made a named property at every level

Vahid, on P74's report: *"The deployment-host defect is the important part of that report, more
than the milestone. The preview named one host and the run would have sent to another, and the
gate caught it — which is the whole argument for putting the destination inside what the student
authorises rather than treating it as configuration. Keep it that way, and keep the property that
re-pointing a run after a yes stops at the yes again."*

Kept by naming it. The property was implied by the journey and by one assertion in a sandbox
test; it is now stated three times, at the three levels it holds. The orchestrator: a state with a
recorded authorisation, re-pointed at a deployment, asks again, and what it asks for names the
new host in the text and in the hash. The Run Driver, over the database and the catalogue: a run
past the yes, the entry re-pointed, `advance` stops at `authorise`, the preview the student would
read names the new host and not the old, no runner is handed the work, a yes to *that* host lets
the run go on, and pointing it back at the observed host stops it again — the latest yes is the
one that counts, in either direction. The journey: the preview the student reads over the real
route names the fixture portal's host and not the one the reviewed blueprint observed.

Writing the driver test found the thing worth finding. The preview it stopped over named no host
at all: the rendering put the destination only under each attachment, per ADR-0098, and an
application with nothing to attach had no such line. The host was inside the hash and outside the
text — a yes to a destination the student could not read, which is the gap ADR-0059 exists to
close. Every preview now carries a `Portal:` line under its heading. No hash changed, because the
rendering was never in the hash; `Reference:` still ties the text to it.

## What follows

Blocker 17 and the Sheffield target are Vahid's; nothing here provisions or runs against a live
site. The next work that needs neither is the plane's side of what P74 proved: the attachment
path over the real vault port once a bucket exists, and, before that, whatever the live-run
checklist still names as open.

## Declared-but-unreachable surface

**Four** — unchanged.

# P76 — the live-run record catches up with what was built

Vahid: *"Keep going on what does not need either."* What needed neither a bucket nor a live site,
and was wrong, was the record. `what-a-controlled-live-run-needs.md` is the document the README
points at for *the remaining blockers*, and it was dated 2026-08-26: it said retention was a hard
stop (ADR-0078 set the periods on 2026-09-07), the lawful basis for disclosure was unregistered
(ADR-0087, 2026-09-08, and the register is wired in both planes), persistence was in-memory (it has
been PostgreSQL and Redis since P11 and P14), attachments needed a `WorkKind` (P73 needed none), and
the interview was a terminal harness (the student's page has carried it since P25). A reader
following the README got a picture five weeks old, and the record-integrity phases (ADR-0082 to
ADR-0084) were about exactly this: a record asserting something other than what happened, in
either direction.

Each of the eighteen areas re-read against the code and the ADRs. Two blockers leave the short list.
Three areas move — retention, disclosure, the interview — and the rest are restated as *built and
proved against the fixture portal, real stores and a real browser, unproven on a real portal*,
which is the sentence that is true. The 2026-08-26 text stays in the git history at that revision,
where ADR-0067 quotes it. Blocker 9 in the state document is struck: done in P73.

What was not changed: anything that is Vahid's. The target line says what he selected and for
which phase, in his words from the target file, and does not restate the controlled run's target;
the bucket, discovery, the models and the account remain his rows. Nothing here provisions or runs
against anything.

## Declared-but-unreachable surface

**Four** — unchanged.

# P77 — deliberate regressions over the attachment path and the destination inside the yes

The repository's habit after a run of building phases: break each gate on purpose and see what
notices. Eleven mutations across P73–P75's gates, each applied to disk, run against its governing
tests, and restored from a byte copy with `cmp` — never from `git checkout`. Ten were caught.

Two are worth the read. Making the preview name the observed host, or making the driver stop
reading the deployment, fails the journey from its fourth test onward — nineteen and sixteen
failures — because the journey's entry *is* a deployment, and a yes over the wrong host stops the
run at the yes. That is P74's defect reproduced on demand, and it is also the answer to "why does
the journey carry a document now": before P74 it did not, and this mutation passed.

The eleventh was not caught, and the reason is not a missing test. The document hand-over compares
the preview's hash with the student's yes at its step 3; the orchestrator's assessment at step 2 has
already compared the same two things and refused. The comparison can differ only in a race between
two reads of one log, which no deterministic test can stage. Kept, as the second reading it is, and
the comment above it now says what the audit measured. The full account is
`docs/p77-regression-audit.md`.

## Declared-but-unreachable surface

**Four** — unchanged.

# P78 — the Sheffield target file, the sourced facts, and the network answer

Vahid: *"Sheffield target confirmed. Create the target file now. Do not run anything against it
yet."* Three things, none of them a run.

The target file, `targets/sheffield-pgt-2026-09.json`: his two entry URLs as seeds, `sheffield.ac.uk`
as the one allowed host, fifteen pages, two seconds between them. It parses — checked through
`parseTarget` without a browser — and it has not been run. Which course, and which September, are
his to supply and are written as such in the file rather than guessed; the year is part of the
submission key, so a guess there would be a guess about identity.

The facts: six things Sheffield's public pages state, each recorded in the target document with its
source URL and the date he retrieved it, the way the Requirements Service records an official
source — and each marked as *stated by the institution, observed by nobody here*. The target file
carries them as claims for the run to confirm or refute, beside the eight authentication questions
it asks and does not answer.

The thing he wants noticed: Sheffield's sibling form says it emails new applicants their login
details. If the PGT form does the same, the approach is `portal_issued`, and the code today creates
the account with no secure step and has no routine sign-in for a credential the student relays —
ADR-0101 built B as the resume path, for a password the student chose. That is recorded as a
question for observation and a decision for him after it, not as a change made ahead of either.

The network answer, from the docs and this session's proxy: the environment's Network access level
is the thing. Trusted allows package registries, GitHub and cloud SDK hosts — `*.amazonaws.com`
among them, which is why the bucket was reachable and Sheffield was not. Custom with
`sheffield.ac.uk` is the narrowest widening; Full opens the whole internet to every session in the
environment and buys this run nothing, because the runner already refuses every host outside the
target's list before a request leaves the machine. The full answer is in the target document.

## Declared-but-unreachable surface

**Four** — unchanged.

# P79 — attached inspection: the tool reads a browser a person signed in to

Vahid: *"Start step 2 now. I am not creating the account until your tool is ready to read."*

The tool is ready to read. `PlaywrightAttachedInspection` attaches over CDP to a Chromium the
person launched with a remote-debugging port and signed in to by hand, opens one tab in the context
that holds their session, and reads with the same in-page script discovery uses. It has no `fill`,
`click` or `submit`; the guard is discovery's — reads only, to the target's hosts — installed on
the whole context for as long as the tool holds it, so the person's own tabs are read-only too and
handed back on close. Navigation is a list of prefixes; a page that bounces to its login is
recorded as the finding it is. Captures have input values and textarea bodies removed before they
are written. `pnpm run inspect:attached <target> --cdp <endpoint> <url …>` writes what discovery
writes, and `inspect-discovery` reads it unchanged.

Six tests against the fixture portal's login, with the person and the tool kept apart in the code
as they are on the day: only the person registers and signs in; only the tool reads. The gated page
comes back through their session with nothing but GETs on the wire. A save the person attempts in
their own tab while the tool is attached never leaves the machine and is recorded; the same save
lands once the tool has closed. A second browser signed in to nothing is bounced to the register
page, and the tool says so instead of drafting a blueprint of the wrong page. A Chromium redirect is
followed below the route handler, so the landing URL is checked after the fact.

Two records, as he asked. The loop A1 made is in ADR-0101 as a known consequence, in his words,
and as the reason this mode exists. The interview's model being the deterministic stand-in in
every path of the service — no code builds a Bedrock client anywhere the service runs — is in the
checklist at areas 7 and 8 and on blocker 3, which is now *"you, then me"*.

One choice made here and stated rather than buried: robots.txt is not applied in this mode. It is
a person's own signed-in session and a named handful of pages, not a crawl; the pages behind a
login are disallowed to every crawler on most portals, which is right for crawlers and would make
this mode refuse the only pages it exists to read. The pacing floor is kept, and `run.json` says
what was not applied and why.

## Declared-but-unreachable surface

**Four** — unchanged.

# P80 — the first real attached read, and what it found

Vahid ran the tool against Sheffield's PGT application, signed in, one page. Everything up to the
read worked — the attach, his session carried, the guard, the pacing, the clean exit — and the read
itself threw `page.evaluate: ReferenceError: __name is not defined`. His diagnosis was right: tsx,
which `pnpm run inspect:attached` runs under, rewrites the serialised in-page script to call an
esbuild helper the page has no definition for. The three launching sessions learned this the same
way in their day and shim the helper with an init script on the contexts they create. The attached
session attaches to a context it did not create, and did not.

He set two conditions. *Fix the transform, not the script* — discovery uses the same script and
runs fine, so the difference had to be found in how this mode gets it into the page, and it was:
the missing init script, and nothing in `observe-script.ts` changed. *Make the test fail first
without the fix* — the six fixture tests had passed, so they exercised a path the real command did
not. A seventh spawns the real command under `node --import tsx` against the fixture portal's login.
It failed on exactly his error, then passed with the shim, and the hand-run command read the gated
page: one form, four fields.

Found on the way: the first version of that test spawned synchronously, and the fixture portal is
served by the test's own process, so the command starved on its first navigation and never reached
the read. The same shape as the bug it was written for, one layer up.

`run.json` now records, for each refused request, the rule that refused it and why, so a
"Requests refused 1" on the terminal is answerable from the record.

## Declared-but-unreachable surface

**Four** — unchanged.

# P81 — the first real form, read

Eleven pages of the University of Sheffield's Postgraduate Online Application Form, read by
Vahid's attached inspection in his own signed-in session, zero failed. The first real reading this
repository has ever had of a form behind a login. The record, with the tool's own draft unedited,
is `docs/captures/sheffield-pgt-2026-09-10/`, and the plain-terms account is its README.

What the form is: nine Part 1 pages — personal, contact, nationality, English language, education,
employment, equal opportunities, marketing, documents — two of them entries an applicant repeats,
and Part 2 behind them, unread. Mandatory fields are asterisks in labels, enforced on save; not one
`required` attribute in 309 controls, which is what the public page said in other words. Seventeen
document slots inside the sections, each with a now/later/not-providing choice, which is S3
confirmed by structure.

The finding Vahid named from the refusals — the education page posting to load grading systems —
is one link of a chain the structure shows whole: country, then an institution typeahead, then the
grading system by a server lookup, then the grade. Everything else that depends on another field
is static show/hide, and it is tabulated so the reviewer does not rediscover it. Three things the
blueprint schema cannot say today came out of that: options that arrive after another field is
set, a typeahead as something the fill agent types into, and a repeatable entry as a page shape.
They are raised for step 4, not solved in it.

The two open questions are answered as far as the captures allow and no further. A *Change
Password* link supports a password's existence and not who set it; the registration page, read in
a fresh profile, or Vahid's own statement of what he typed when he registered, settles it. Three
course choices submitted separately fit the key without change and strain the case — Part 1 is one
record shared by up to three submissions — and the model is not adapted until Part 2 is read.

Found on our side: the observation script's one-time-code heuristic matched six postcode boxes and
wrote an `mfa` handoff on a page that has none (P82).

## Declared-but-unreachable surface

**Four** — unchanged.

# P83 — the presigned URL is dated at the mint's `now`

CI #176 went red on the docs-only push of P81. The failing test was the real SDK presigner's, in
`s3-document-vault.test.ts`: `UnboundUploadError`, a URL valid until `16:48:04.000` against an
intake that opened at `16:48:03.964`. Nothing in that push touched code, so the cause was already
there and only the clock chose the moment to show it.

The cause: `mintBoundUpload` computes the bound from its `now` and asks the presigner for a URL
that lives that many seconds. The SDK dated the signature at its own wall clock, truncated to the
second — so when `now` was late in a second, `X-Amz-Date` fell in the next one, the URL's life
ended one second after the bound, and the exact check in `assertBoundUploadUrl` refused it. The
check was right. The signature's date was the thing decided in the wrong place.

The fix moves that decision to the mint: `PresignRequest` carries `signingDate`, the mint sets it
to its `now`, the S3 presigner passes it to `getSignedUrl`, and the in-memory store stamps the
same date. Per Vahid's rule from P80 — *"make the test fail first without the fix — I do not want a
fix I cannot prove"* — the new test uses an SDK-like presigner that dates at the next second and a
mint at `…00.964Z`; before the fix it fails with CI's exact message, after it the signed date is
the mint's and the bound holds. The check is unchanged.

## Declared-but-unreachable surface

**Four** — unchanged.

# P82 — the observation script stops reading a postcode as a one-time code

The first real form produced two signals that were not true, and both were made on our side.
Six postcode boxes on Sheffield's contact page — `corrPostcode`, `permPostcode` and their
neighbours — matched `input[name*=code]`, and the draft blueprint carried an `mfa` handoff point
on a page that has no second factor. And the word "register", found inside "registered" on two
pages, made each an account-creation page.

Both are fixed where they were made. The observe script now records a one-time-code input only
when the name or id IS a code field — the same closed set the runner's challenge detector has
required since P70, which is why the runner would not have stopped on that page even when
discovery said it might — or when the input carries `autocomplete="one-time-code"`. Page-text
signals match whole words, and the text they read has script, style, noscript and template
bodies cut out first: the fixture's own inline script mentioned registering, and that was the
second reason the word matched.

The first version of that cut the scripts out by cloning the body, and the CLI test caught it: a
cloned `<img>` fetches its source, so the observer had made a request the page had not, and the
run counted one refusal too many. An observer that fetches has touched the network. The text is
read by walking the tree, and a test now asserts the fixture's pixel is fetched once, by the page.

The signals fixture now carries a postcode box, a course-code box and a "registered charity"
footer. The two new tests failed before the fix with Sheffield's exact evidence — `name=
"corrPostcode"` under `mfa_or_otp`, `"register"` under `account_creation` — and pass after it.
The draft in `docs/captures/sheffield-pgt-2026-09-10/` is left as the tool wrote it; its README
says which of its signals a re-run would no longer produce.

CI #177, on the P83 push, was red for a different reason: every test passed and the census table
was stale, because P83 added a test without regenerating it. This commit regenerates it.

## Declared-but-unreachable surface

**Four** — unchanged.

# P84 — two of the four answered, in Vahid's words

Records only. Vahid, 2026-09-11, supplied the course and the intake: MSc Management and
International Business, September 2027. The target file carries `2027-09`, the way the Ulster
target writes an intake, so the submission key carries the year he stated. His note is recorded
with it: the course page URL carries `/2026/`, and that is the page he read the course from, not
the intake.

And he closed the password question on his own account creation, in his words: *"Password:
student_chosen, confirmed by observation not inference. I created the account myself and I typed
the password I chose. Sheffield did not email me one."* It is recorded as his direct statement
with the date, in the target file, the target document and the capture README, and it is what
closes the question — not the *Change Password* link the first read saw, which was consistent
with both answers, and not the sibling form, which says the opposite. The PGT form does not
behave like the sibling form.

What the registration read still gives is the `registration` and `login` locators, and AUTH 3, 6
and 7. The capture README now says exactly which pages, in what order, and what is captured, so
that read is only that and not more.

## Declared-but-unreachable surface

**Four** — unchanged.

# P85 — the dependencies read, the Article 9 sheet, and the draft blueprint with the course and intake set

Vahid ran `inspect-dependencies` on his machine and sent the output; it is in the capture
directory as sent. It confirms the static-dependency table handler by handler and settles three
things he asked about.

The education chain is confirmed by handler, not inferred: country → `institutionChanged()` →
institution → `loadGrades()` → grading system → grade, and a subject search beside it. Four selects
sit empty until the one before them is set and the server has answered. What the blueprint has to
carry is an order and a wait, and the schema has neither word — gap 1, recorded, and the curated
draft carries those four fields without a condition rather than with a wrong one.

Attaching a document is two acts, and on sixteen of the seventeen slots the page does the second
one itself: the file input's `onchange` ticks its own *upload now* radio. The English-language
slot does not — its four status radios are set by hand. And on the five other-documents slots the
radio the handler names was not in the captured form at all. The runner's `attach()` calls
Playwright's `setInputFiles`, which fires `change`, so the page's script would tick the radio on
the sixteen — done by the portal, verified by nothing. The draft carries each status radio as a
field beside its file input; the relation between them is a fourth schema gap, named; a runner
that verifies the radio after attaching is raised for the attachment path, not built.

The equal-opportunities page asks eleven disability checkboxes and an ethnic-origin select —
Article 9, and Vahid's decision, not a defect to design around. The sheet
(`decision-sheet-article-9-fields-a-portal-asks-for.md`, blocker 20) reads the tree first: nothing
in this system can hold such an answer, by type; the existing `student_handoff` mapping would make
the whole application untransportable (`has_handoffs`); an optional unmapped field is passed over
in silence; a constant can be put in any field with only two reviewers between it and the form.
His instinct — the student answers those themselves and we never store the answer — holds as
option A, with two things it needs: a preview line naming what was left for the student, and a
mapping-level refusal so the wrong reading cannot be written. B, *pass it through unstored*, is
shown not to exist here: every typed value is in the preview, the stored plan and the log by
design, so B is a reversal of ADR-0077 under another name. What the sheet could not see from the
tree is whether the page saves blank; everything that depends on that is marked.

And the draft blueprint is built: `blueprint.draft.curated.json`, 0.2.0, from the tool's draft
with the course and intake set, the search forms and buttons out, radio groups merged, thirteen
required validations from the captured asterisks, twelve `visibleWhen` conditions whose values
the capture holds, the mfa handoff gone, the password answer in the notes. It parses, and
`checkExecutable` refuses it as `not_reviewed`, as it should. Every change from the tool's draft
is listed in the README, and so is everything left out by design.

## Declared-but-unreachable surface

**Four** — unchanged.

# P86 — ADR-0102: use the refusal the form offers

Blocker 20, decided by Vahid on 2026-09-11 after the page refused an empty save, and built as
he decided it: *"use the refusal the form offers, not answer Article 9 fields with a safe
default"*, with three conditions enforced rather than noted. He asked first whether each was
expressible, and the answer was given before a line was written. One limit he accepted is stated
plainly in the ADR: a portal's fields are discovered data, so the refusal is the branded
usable-set check — review time, on data, before anything is built on the mapping — and not a
type error. It is the same place a mismapped password is refused.

What is built. A field carries the reviewer's classification, never discovery's, and a mapping set
is refused while any field is unclassified: absent is not ordinary, because *"one reviewer's
omission turns a health question into an ordinary field with nothing to notice"*. A new source,
`form_refusal`, is the only one accepted on a special-category field — the value the form offers,
a mandatory rationale, and the form's own words or nothing: *"quote or omit, never compose"*, and
the check refuses a line the form's captured text does not contain. With no refusal mapped the
plan blocks and a specialist is asked, required or not. The preview lists refusals under their
own heading, *We did not answer these for you*, with what was entered and why; never among the
answers; inside the hash. Transport, the wire and both conversions carry the kind as a refusal.

Found, not designed, and worth its own line: ADR-0077 closed extraction against special-category
fields and left the `profile_field` mapping and the interview's `ask` typed by the whole registry.
Both are now `OrdinaryFieldKey`, closed while still empty. Measured, the way ADR-0077 measured its
own wall: a special-category profile field fails to compile at the line that names it, in both.

Eleven tests failed before the mechanism and pass after. The curated Sheffield draft classifies
its fourteen equal-opportunities fields; the rest wait for review. No Sheffield mapping set is
written: the ethnic-origin dropdown's wording is his to state from his screen.

## Declared-but-unreachable surface

**Four** — unchanged.

# P87 — the correction recorded, a refusal covers its question's other controls, and the first real mapping set

Vahid read the live dropdown: *Prefer not to say*, and no *Information withheld* entry. The
capture was right; his recollection had come from the label. He asked for that to be recorded as
a dated correction to his own words rather than quietly fixed, because *"the form's own words and
my recollection of them are different things, and this is an instance of exactly that"*. It is in
ADR-0102, in his words.

Writing the first real mapping set found the rule as built one step too strict: Sheffield's
disability question is twelve checkboxes, *Prefer not to say* among them, and the eleven others —
each special-category, each with no refusal of its own — would have blocked the plan. So a refusal
now *covers* the other controls of its question: each must be special-category, in the blueprint,
mapped by nothing and covered once; they are planned as nothing and the preview names every one
under *Left untouched, as part of this*. A cover cannot reach an ordinary field and cannot silence
a question that has no refusal.

And a fault of P86's own, found by writing the hash test properly: the content hash had been given
the refusals as a parameter and never folded them in, and the P86 test passed because it compared
against a preview whose entries differed too. The hash now moves with each refusal's value,
rationale, quoted words and covers, and the test holds the entries fixed to prove it.

The artefacts for Iman: the curated draft at 0.2.2 with all 216 fields classified as proposals —
fourteen special-category, the rest ordinary — the equal-opportunities mapping set as a draft in
Vahid's words, and a review pack that lists every field by page with what needs a judgement
(23) and what is mechanical (193), the thirteen required validations, and the exact block the
student will read. A test holds the two drafts to the real checks as if reviewed.

## Declared-but-unreachable surface

**Four** — unchanged.

# P88 — three defects of the discovery tool the first real form exposed

Vahid's reading of ADR-0102 §7 stands in the record now as he put it: the P86 hash test compared
against a preview carrying the same error, so it agreed with the code rather than checking it.
The ADR says that, and the assertion is retired rather than left to keep passing.

Then the tool. Three things the Sheffield draft made visible were the tool's, not the form's, and
each is fixed against a test that reproduced the shape first. A radio group is one question: the
observer now records each input's submitted value, and discovery emits one field with options
carrying them, where the draft had one field per input and no values. An advance control is
never a locator with nothing in it, a sentence that happens to contain "start" is not a button,
and the page's control prefers an id, where the draft had a blank label on five pages and a
sentence on the education page. And `inspect-discovery` counts refusals by rule: one write on
the target is state-changing; fifteen analytics tags refused off-host are not, and the summary
had called them so.

## Declared-but-unreachable surface

**Four** — unchanged.

# P89 — the personal and contact pages mapped as far as the registry reaches

The Sheffield mapping set is now one draft for the whole blueprint, because a plan reads one set,
and it carries the personal and contact pages as far as the profile registry reaches. Names map
to names. The date of birth is three selects — day `1`…`31`, month by English name, year — which
no closed date pattern could produce one part of, so the closed set has three more members,
`D`, `MMMM` and `YYYY`, added against a test that failed first. The e-mail is asked twice and
mapped twice. The address maps by part. The country select takes the portal's own upper-case
names, and the option map is partial: eight countries whose names the capture shows, and any
other refuses to render rather than being approximated, which is the rule the format layer has
always had. A confirmed fixture profile fills all of it under the real checks.

What it could not map, and why, is the finding. Employment asks four required fields — start
date, position, employer name and address, duties — and the registry collects no employment
history. So nothing can be mapped, the interview cannot ask, and the plan blocks on all four.
Adding fields to the registry is a decision about what the profile collects, with each new field
classified; it is raised for Vahid, not made.

## Declared-but-unreachable surface

**Four** — unchanged.

# P90 — the plan honours `visibleWhen`

The blueprint has recorded "UK postcode, when the country is the United Kingdom" since the
schema was written, and nothing read it: the P85 reading noted that the executor honours no
visibility, and P89's Sheffield mapping put the same postcode into both boxes and left it to a
note. Now the plan evaluates each field's condition, and its section's, against its own values,
to a fixed point, and a field the form does not show for these answers is neither filled nor
missing: its instruction, blockers and upload are dropped, it is listed under `hidden`, and the
validator does not count it as a missing required field. For a UK address the international box
is gone; for a French one the UK box is, and the département the form then asks, which nobody
mapped, blocks as it should. Fail-first on a synthetic address page and on the Sheffield draft.

## Declared-but-unreachable surface

**Four** — unchanged.

# P91 — the entry page read, the AUTH questions answered from it, the locators authored

Vahid read the entry page and the forgotten-password page from a profile signed in to nothing:
three pages, zero failed, three refusals, all Google Tag Manager. He described what he saw and
asked for the eight authentication questions to be answered from the capture, not from his
description, and for the ones no page can settle to be said so. Four are settled by the capture:
the applicant chooses a password (AUTH 1), nothing passwordless is offered (3), no CAPTCHA sits on
those pages (6, with the caveat that tags were refused), and handover follows from the password
being the student's own (8). Two are settled for what the pages show and open for what follows a
submit (2, 5). Two no page read can settle: whether the e-mail must be verified before the form
opens (4), and whether the reset works and where it sends (7). They are not inferred.

The locators the entry had waited on are authored: the login URL and its three locators in the
draft's authentication block, and a registration page first in the walk with the two password
fields typed as passwords and mapped to the Secure Plane, the e-mail from the profile.

The eight facts are recorded for the reviewed entry with `unobserved` on 4 and 5 — and the
chooser refuses on exactly those two, as ADR-0020 built it to: an unobserved answer is not a
"no". The test holds the refusal and that, with both observed as false, the same facts choose
`student_chosen`. What settles them is Vahid's own account of registering and signing in,
recorded as his statement the way the password question was, or a run that does both.

Two defects of the tool the draft made visible, fixed against tests that failed first: a password
input came back `unknown`, because the converter had no case for the one type the schema names so
a blueprint can be honest about a credential; and the form's buttons came back as fields.

## Declared-but-unreachable surface

**Four** — unchanged.

# P92 — AUTH 4 and 5 in Vahid's words; the chooser picks `student_chosen`; the refusal still bites

The two facts no page read could settle are settled the way the password question was: by
Vahid's own account of what he did, recorded as his direct statement of 2026-09-11 and marked
observed by him rather than by a run. No verification step stood between *Start Application* and
the first form page; no code was asked for at sign-in. The facts file, the entry README, the
target file and the target document carry his words, and carry with them the caveat he asked
for: this is Sheffield's behaviour, not a property of direct portals, and it settles nothing for
any entry but this one. The type has no per-fact provenance, so the file's comment and the
READMEs are where "observed by Vahid" lives, and the reviewer reads them together.

With all eight facts observed the approach chooser picks `student_chosen` for this entry. He
asked for the refusal to be proved to still bite rather than merely to have stopped firing, so the
test sets each of the two facts back to `unobserved` in turn, against the committed file, and
holds that the chooser refuses on exactly that one question.

## Declared-but-unreachable surface

**Four** — unchanged.

# P93 — ADR-0103; gap 4 built: a document slot's companion, planned after the attach, entered and read back

The four things the first real form showed the schema could not say are decided in one ADR under
one principle: the blueprint records what the page does *between* fields — which field loads
another's options, which is typed into rather than chosen from, which block repeats, which control
follows an attach — so the plan can order, wait and follow, and the runner never guesses. Gap 4 is
built here because it is the one a fill would meet first and fail silently: sixteen of Sheffield's
seventeen slots tick their own *upload now* radio from the file input's handler, the seventeenth
does not, and a save without the radio may not register the file.

`RequiredDocument.companion` names the control and the value. The plan carries it with the upload
and only when a document is mapped to the slot — an unmapped slot's companion is left as the form
has it and is never a blocker. The runner sets it after the attach, because a portal's own script
may set it from the change event and a runner that went first would be undone, and reads it back;
a companion the portal did not take fails the page with what the portal shows. The preview names
it beside the attachment in the option's own words and the content hash covers it; the validator
does not count it as missing. `checkUsable` refuses a companion that is not on the blueprint, does
not offer the value, or is mapped as well — it follows the attach, and nothing else may set it.
The fixture portal's documents page now demands the status and does not tick it itself, so the
journey proves the second act rather than assuming it. Setting a radio group by value, and reading
the checked member back, is new to the fill session too; before this a group found by name could
only be ticked.

Found rather than designed, while setting the seven Sheffield companions: the language page and
the education page both call their file input `certificate` and its radio `certificateStatus`,
and the draft parsed. Every consumer keys by fieldRef alone; the companion check was the first to
meet the wrong field and refuse. The rule is now stated where the artefact enters — `parseBlueprint`
refuses a repeated fieldRef at the second occurrence, naming the first — and the language page's
two are renamed in the curated draft, locators unchanged. Ten slots carry no companion yet; the
README says which and why they wait on a re-read.

## Declared-but-unreachable surface

**Four** — unchanged.

# P94 — ADR-0103 gap 1 built: options that arrive after another field are ordered, waited for, never chosen among

The education chain on the first real form — country, then institution, then grading system,
then grade, each list empty until the one before it is set and the server has answered — is
the shape the schema could not say, and now says: `optionsAfter` names the field whose setting
loads this one's options. Three things follow from one word. Order: the plan's instructions are
the blueprint's field order, so `checkUsable` refuses a dependent that precedes the field it
follows, one that names a field on another page or itself, one that is not a list at all, and a
mapped dependent whose earlier field nothing maps — a mapping that names an option the earlier
field would never cause to appear fails on every run, and it is refused at the mapping boundary
rather than discovered at the form. Wait: the runner, before selecting, asks the session for the
one option it was told to select, bounded at five seconds, and fails the page as drift with what
the list offered when the bound passes; nothing is typed into that field. Never choose: the wait
is for one named value, not for the list to change, so the runner never picks among what arrives.

The fixture portal's apply page now asks the passport's country from a list it fetches after the
nationality is chosen and the server has answered, after a pause, and refuses a save without it;
a fill that did not wait meets an empty list. The demonstration form does the same by script, and
its stubbed review records the dependency where a reviewer would. Discovery does not infer it.
The Sheffield draft records the four dependent selects the handlers name; their lists are as
captured with nothing set, so no mapping may name an option until a capture is taken with the
earlier fields set — the schema's limit was always the capture's, and the check refuses an option
the list does not hold as `option` rendering always has.

## Declared-but-unreachable surface

**Four** — unchanged.

# P95 — ADR-0103 gap 2 built: a typeahead is typed into and the one exact entry chosen

The two Tom Select boxes on Sheffield's education page — a text input that searches, a list of
entries beneath it, a hidden select set by the choice — were a mechanism the fill had never met.
The schema now names it: `typeahead`, with the locator of the entries it offers. The rule for
choosing is the same rule `option` rendering has always had, moved to a list that is not there
until someone types: the mapped text is what the reviewer saw, the runner types it and waits a
bounded time for exactly one entry whose text equals it, and chooses that one. No entry chooses
nothing; two entries choose nothing — "Ira" offering *Iran* and *Iraq* is a mapping to correct,
not a choice to make; and both fail with what the list offered so the reviewer can see which.

Choosing an entry is a click, and the click guard exists to stop a fill pressing the wrong
button. The entry is not on the advance allow-list and is not consulted against it — it is the
answer, not a control — but the same rule that refuses every click on something that reads as a
submission refuses an entry that does. The two acts, confirmed and constant, stay apart at the
session for the reason `fill` and `fillConstant` do. Discovery does not produce the type; a
typeahead reads as a text input, and the reviewer sets it.

The fixture portal's study page now asks the course through a search the server answers for
what was typed, two courses sharing a prefix, and refuses a save naming no offered course; the
journey chooses it as a reviewed constant. The Sheffield draft marks its two boxes, and the
README says plainly that the entry locator is Tom Select's default markup and not the capture's,
because the captured pages are not in the repository: the next read confirms or corrects it, and
no mapping to either box is signed before then.

## Declared-but-unreachable surface

**Four** — unchanged.

# P96 — ADR-0103 gap 3 built: a page filled once per item of a list, each item its own page to the ledger

The last and largest of the four: Sheffield's education page is one qualification form, and the
applicant adds one entry per qualification through the same boxes. A blueprint page can now say
it repeats over a list-valued profile field, and everything downstream follows from that one
word. The mapping boundary: every mapping on such a page draws from one item of that list or is
a reviewed constant — a mapping from another field would type the same given name into every
qualification, a handoff or a credential has no per-item, a document is mapped to a held type
and not to an item, a condition would be answered by which item nobody could say — and each is
refused at `checkUsable`, not discovered at the form; the page's own declarations decide nothing
there (ADR-0066). The plan: the list is resolved once and each item is
rendered through the mapping's rule with the list's provenance, because the student confirmed the
list and each item is that confirmation; the instruction carries which item it is, and the plan
says how many times each repeating page is filled. The preview: each entry under its own heading
in the student's order, every field of it, *none* said plainly, and both the count and each
entry's position inside the yes — the same two qualifications in the other order are a different
application. The ledger: each item is its own page target, saved once and offered again for the
next; the driver hands the page out once per item, the work item says which item and how a fresh
entry is opened, and the runner comes back to the page's URL, presses *add another* when there is
one, fills the form and saves that one.

Two rules stated because they could have been left implicit. An unconfirmed list fills an
optional block zero times and asks for nothing — a student with no prior qualifications has none
to add, and the interview does not ask a question whose honest answer is "none" — unless a
mapped field on the page is required, in which case it asks as any required field does. And which
fields are lists is said once, in the profile package, so a page repeating over a given name is
refused at the parse rather than producing one entry per character.

The journey adds two qualifications through the whole path: the same page handed out twice,
each with its own four instructions and its own ledger row, the portal holding both in the
student's order, and page two still not filled again.

And the finding it ends on: the Sheffield page the gap was raised for cannot be marked. Its
education page carries six document slots per qualification — certificate, transcript, their
translations — and a field shown by another; the rule as built refuses the condition on a
repeating page today and would refuse any document mapped on one, rightly: a document is mapped
to a held document type and not to an item, so "the certificate for the second qualification"
has no way to be said, and a condition inside a repeat has no item to be answered by. The draft stays as it was and the README raises it as a fifth gap
for Vahid — a document per item, and a condition inside a repeating page — which is a product
question about what a student holds per qualification before it is a schema one. With this, the
four gaps ADR-0103 decided are built, and Part 2 can be read against a schema that will not
change under it; the fifth waits on his word.

## Declared-but-unreachable surface

**Four** — unchanged.

# P97 — deliberate regressions over the four gaps; the companion's value was never in the hash

Fifteen mutations against what P93–P96 built, each applied to disk, run against the tests that
govern it, and restored byte-for-byte. Preparing the third of them found the defect this phase
is named for: the line that put the companion inside the yes interpolated the field reference
and hashed the literal characters `{attachment.companion.text}` beside it — the mark's value was
never in the hash, and P93's test, which checked the mark was named beside the attachment,
agreed with the line. The same shape ADR-0102 §7 records for P86. Fixed test first: hold the
entries, the document and the slot, change only the mark, and the hash must change; it did not,
and now does.

Eleven of fifteen were caught on the first pass. Three of the misses were the tests' fault and
are now strong: the order rule had been tested on a text field, which the next rule refused in
its place with the same kind, so removing the order rule changed nothing the test could see; the
typeahead's rule — the one entry whose text equals the text — had never met two identical entries
or one near one, the two ways to choose wrongly. The fourth miss stays and is labelled: the
entry's index in the hash is redundancy over a stable sort, kept as the explicit statement of a
property that would otherwise live in an engine guarantee. And one thing the journey did not
catch is worth its sentence: without the item in the ledger's key the two qualifications still
had different targets, because their values differ; the key matters for two identical entries,
which the unit test states and the journey does not stage.

## Declared-but-unreachable surface

**Four** — unchanged.

# P98 — ADR-0104: blocker 21 decided; a repeating page's documents are the student's own act, said under each entry

Vahid decided the fifth gap the day it was raised, and in his words: B, with the per-item
condition built with it. C is out — *"the education page is the heart of a university
application"* — and B is honest in a way A is not yet, because it says in the preview which parts
the student does themselves and attaches nothing that could be wrong. He also corrected the
sheet's framing, and the correction is the part worth carrying: A is an option, not the end state.
It changes what a student holds, that is a product decision he has not made, and answering the
sheet did not make it. Nothing here plans A.

What B needed was found on the way in. A field handed to the student had never reached a run at
all: the transport refused any plan with a handoff, so a mapping set with one made the whole
application a person's work and no page was ever handed to a runner. That was right for a
declaration checkbox and wrong for a certificate slot on a page the runner should still fill, so
the rule is now the narrower one: a handoff on a document slot is the student's part of a page
the runner fills; a handoff on anything else still keeps the plan from a runner. The preview says
under each entry what the student attaches themselves, apart from the fields we filled — his
condition, that a student reading it can tell the difference — and the handover message names the
same acts with their entry, at the ask and at the confirmation, so the message they act on says it
too. A condition inside a repeat is answered per item, against that item's own values, and a
field hidden for one qualification is recorded as hidden for that one; a condition that looks off
the page is refused, because no item could answer it.

The fixture's education form now takes a certificate and asks a grade only of a school
qualification; the journey holds that the diploma's grade was typed, the bachelor's box was left
alone, nothing was attached by the runner, and the preview carries the two *You attach yourself*
lines. Sheffield's education page is marked, its six slots left to the student, its one condition
admitted. Whether the portal reaches a second entry by a URL or a control was not read, and the
next read says.

## Declared-but-unreachable surface

**Four** — unchanged.

# P99 — his live read of three pages, confirmed against the capture; two findings raised, not built

Vahid read three live pages and reported them in his words, asking that each be confirmed
against a capture rather than his description. The screenshots did not reach the repository;
the JSON capture, the run record and the dependencies output did the confirming. The education
page's continuation is the page's own URL — the tool read `education.do?new=true` as an empty
form, and that is the *new entry* URL the built shape already walks to for each item, so no
*add another* control is needed and no gap is raised, on the one condition the next read settles:
that the URL opens empty after a save. The page holds six file inputs where he saw four rows;
which two are hidden, and by what, the capture cannot say, and the draft keeps all six. The
radios' *in English* option is on his report alone, the capture having no labels for that page,
and it exposed a limit in ADR-0104's rule: the radio beside a slot the student attaches is not
the slot, and may not be handed to them with it. `documents.do` is exactly as he says — five
description boxes, no radios — which corrects item 6b from ten slots to five, and its 50MB page
total has no place in a schema that limits per slot. Subject is not a typeahead: a search box, a
button, a select whose options arrive after the press. P94 marked the wait; the press is not
expressible.

Two proposals wait on his word and nothing is built against either: a document slot's companion
radio handed to the student together with the slot; `optionsAfter` naming a control to press
between setting the earlier field and waiting. The formats each page states are recorded per
slot, from the page's text, since no `accept` attribute was ever captured.

## Declared-but-unreachable surface

**Four** — unchanged.

# P166 — a button nobody can be honestly asked about

Vahid read the Sheffield notice himself, from a fresh profile with the consent cookie cleared,
structure and the banner's own words only, nothing clicked. It offers *Accept all cookies*,
*Settings*, and a close control with no words. He asked what the close control does before any
entry names it. It could not be found out from here: the vendor's library is refused by this
environment's network policy, and the portal is off limits by his rule. So it is recorded as not
known, with the four-step read for his own account and what each of the four outcomes would
mean — and in every one of them the answer for the entry is the same, because the button's
meaning is set by configuration the student cannot see.

He made that the rule, in his words, for the next portal's close control as much as this one's:
a control with no words of its own is never a choice on a notice. It is structural now — the
parser refuses a blank label, empty or whitespace, red first — and the runner was already unable
to press a button the signed entry does not name.

Nothing is written into the Sheffield entry. The notice offers no refusal in words: *accept all*,
or a settings panel nobody has read. Whether option 2 as built can express that honestly, or
assumes the notice offers its choices directly, is the next answer, and what goes in the entry is
his decision after it.

## Declared-but-unreachable surface

**Four** — unchanged.

# P165 — the choice on a consent notice is the student's, and the system asks before it presses

The third of the three he ordered, and the one with a meaning before it had a mechanism. He put it in one sentence: a system that asks for a yes before typing a date of birth cannot decide a cookie choice by itself. So the blueprint now records the notice as a reviewer read it, in its own words, with what each button means in plain terms; the runner tells the notice from any other obstacle by one of its buttons being on the page and presses nothing on it until a choice of the student's is on the work item; the plane treats the meeting as not a failure, puts the question to the student before it asks for a password again, records their answer under their name for that portal and no other, carries it on the next sign-in as a key and a locator, and shows it back with a button for every other choice. A student who chose once on Sheffield is not asked again on Sheffield and is asked afresh on Manchester, which is his condition word for word.

The convenient option is refused and its reason stays where the next person proposing it will read it: telling the student afterwards is not the same as asking. The two I refused he adopted: a consent cookie we wrote would be a fabricated record, and a press forced through the backdrop would assert that a person clicked where a person could not.

What is not done is the Sheffield notice. Nobody has read its words or its buttons — his capture of the login page had no notice on it, and the runner's lines carry structure and never text, by rule. So the mechanism is proved on a fixture notice in the shape attempt 1 measured, and the entry's consent field waits on a read of the real one when it is present, and on his signature. Until then a press the notice intercepts stops for a person, as attempt 1 did, and the line says so.

## Declared-but-unreachable surface

**Four** — unchanged.

# P164 — the point is read whichever way the press falls

The first of the three he ordered after the fill log. Attempt 1 had named the overlay at a failed press and attempt 2 had pressed through unread, and his rule for that was the right one: an absence nobody measured is not a fact to build on. So the sign-in now reads the same point three times — as the login page opens, just before the press, and, as before, at a failure — and says each in the same words: nothing over the button, with the button's own box, or the layers that are over it, top-most first, and never a layer's text. Before the press rather than after, because a press that lands may take the page with it.

The fixture made the race deterministic, which is the thing a live portal never will: a layer added after the page opened reads as nothing at the open, as over the button a moment before the press, and as the thing at the point when the press fails. Whatever attempt 3 prints, it prints against those three readings, and the next "why was it absent" is answered from a log. Nothing else moved. No wait, no dismissal, no second press; getting past the overlay is the student's decision and the next phase.

## Declared-but-unreachable surface

**Four** — unchanged.

# P163 — the fill was silent in the same way the sign-in had been, and the count was a label

Attempt 1 of the third conversation did what P162 was built for: the line named the thing. A full-viewport backdrop with CookieControl's id, at the button's point, at the instant the press failed, with Playwright's own check saying another element was in the way. Five hypotheses on one button; the fifth was measured. Then attempt 2 pressed through and signed in, and nothing was read at that press, because the runner reads the point only when a press fails. So the overlay is sometimes there and nobody knows why it sometimes is not, and he was right that nothing may be built on an unmeasured absence.

Then the first page fill reported uncertain with the runner's own code, and the record said nothing about which of two places the code came from, because P157 had given the sign-in its lines and left the fill with none. He called it what it was: the same defect in a second place, to be fixed before the next attempt and not after. It is. The fill says it is starting and on which page, and at every place it can stop it says which — the press, with the pending check and the layers at the point, the way the sign-in does; the read-back, with the field names it did not see; a box that would not take its value, by count and by name and never by what the box said. The intake names a throw. Two codes that read the same on disk are two lines now.

The label was a second lesson in measuring. I told him the count was one and the next sign-in would read "attempt 2", and I had read that from the code path that increments. The test that pinned the sequence showed the count cleared by a sign-in that holds, which ADR-0120 says in its own words and I had not read to the end: a new episode of two. So the next sign-in would have read "attempt 1", and either number was a label for something else. The rule is untouched, on his word; the words now say what the number is, and the student hears no number at all — once can be chance, and if it fails again someone will look. The wrong answer is in the record beside the right one.

And the overlay is decided, in his words: measure first and unconditionally, then the student decides, once per portal, durably, changeably, asked in the banner's own words. The convenient option — decide for them and tell them — is refused with its reason kept, because it will be proposed again. The two I refused he adopted as refused: a fabricated consent record, and an assertion that a person clicked where a person could not.

## Declared-but-unreachable surface

**Four** — unchanged.

# P162 — the moment the press fails is the only moment the obstacle is certainly there

His read came back with nothing over the button. Four hypotheses on one step, each tested and each wrong, and the run still cannot press a button that is at its own point when the page opens. So whatever stops it arrives between the page settling and the click, and no static read sees that moment; only the runner does. It had the datum all along — Playwright says which check a failed click was waiting on, and for one of them names the element in the way — and ADR-0124's rule threw the message away, rightly, because a message can carry page text.

The answer is the same read the reader makes, made by the runner at the instant of the failure, with the text left out. Structure only: tag, id, classes, position, box, top-most first down to the button. And which of Playwright's checks was pending, from Playwright's own closed phrases in our words, never the element Playwright quotes. The fixture's covered button proves the line names the cover and carries no text. Attempt 3 is a reading of the thing itself.

Not the picture. He would rather earn that case than assume it, and so would I: the picture is for *nothing at the point*, and if attempt 3 says that, the design comes back to him then. Three things went into the record at his word rather than staying in a reply: the reader's own defect — two pixel iframes called a navigation, one frame short of right, a round of attention spent; that the read is the quieter of the two pages, twenty POSTs quieter; and the button eight pixels from the bottom of the runner's screen on a page with a cookie library, as the leading candidate with its caveat, so that whatever attempt 3 names is seen against what was thought before it.

## Declared-but-unreachable surface

**Four** — unchanged.

# P161 — the runner meets a page nobody has read

Attempt 2 said which clock: the press. The button could not be pressed, the password box was still there, and the page went nowhere — the thirty seconds never came into it, and both of the week's earlier hypotheses are gone. What is over the button is not known, and the honest reason is that the runner's page has never been observed. Every capture refused the tag host; the runner lets it load, sends a user agent no capture ever sent, and a viewport nobody has read at.

So nothing in the runner changes. He said it before I could propose it: no dismisser, no click-through, no wait for the overlay to clear — name it from a capture first. The attached tool gains a way to read the page as the runner meets it: reads to other hosts let through and every one recorded, the runner's own agent presented on every request, its viewport; writes refused everywhere, as before. And a read that says what stands at the button's point, top-most first, with its shape and its text, because the text is what names a banner if a banner is what it is.

The ADR names nothing. A tag's banner, a different page served to that agent, something the viewport puts over the button — each is an observation to make, and the tool now makes it possible to make without assuming any. The next step is his read, and the step after that is his word.

## Declared-but-unreachable surface

**Four** — unchanged.

# P160 — the one wait did not do what it read as doing

The repeat printed a reading, which is what P157 was for: the step timed out, at the submit. Not the error the race would have thrown, so the race is exonerated and stays untouched. But the reading I had offered as the alternative — that fifteen seconds was too short for the load after Sheffield's submit — was wrong as well, and wrong in the way he has now seen three times in a week. The load wait was called before the click, on a page that had already loaded, and Playwright's own contract says such a wait resolves at once. It guarded nothing. The clock that ran out was the click's, which waits for the button to be pressable and then for the portal's answer under one name.

So the split is the fix, and the reason for the split is the correction: two waits, two phrases, each driven to its own failure on the fixture in a real browser — a portal that answers slowly, a transparent element over the button — so that the next line from the live portal is a reading of which clock ran out and not a fourth confident deduction. The press keeps fifteen seconds. The answer gets thirty, and thirty is a measurement: a second failure there says the cause is not time. The landing is confirmed by URL, because the page after Sheffield's submit has never been recorded and a locator for it would be invented.

Two things recorded as decisions rather than sentences. No screenshot on the press failing, because it is a picture of a login form with the student's address in it, into a log file. And on the overlay side the ADR names no banner: tags were refused in every capture and are allowed in the runner, so the runner sees a page nobody has read, and a read with tags allowed is the next diagnostic if attempt 2 lands there.

## Declared-but-unreachable surface

**Four** — unchanged.

# P159 — the fix was right and it arrived too late for his case

He pulled it, restarted, refreshed, ran the same two calls and got the same 403 — and read the reason himself before I did: the fix changes what a new cancel does, and nothing re-examines a case already half-cancelled. That is exactly right, and this time it is established rather than agreed. A case stopped the old way was built on the fixture and the three doors were measured shut on it: the Worker advances running and suspended runs only, a runner is offered nothing for a stopped case, and a second stop is refused by the table. What is missing is not a design. It is a caller.

He also asked to be told if the honest answer was that the case is abandoned and he should start again, and said he would take it. It is not the honest answer. Abandoning it leaves the record saying an application is half-stopped for ever, and holds his ability to re-apply for that course, because an unconcluded prior case is the one cause of that refusal. Walking around a record rather than finishing it is the thing three phases were spent removing.

So the repair is the missing caller and deliberately nothing else. It refuses any case that is not winding down, and says where the case actually is — proved against a live one, not against a fixture shaped to be refused. It performs no transition of its own: it runs the ordinary wind-down, which asks the machine, so a case that still owes a student their account is reported and left alone rather than concluded. It is idempotent. It lives as a subcommand of the service that owns the driver rather than as a script of its own, because a second composition root is a second answer to which catalogue a case is judged against.

One thing I did not do: read his database. What state his case is in is a fact in his Postgres, and the runbook now carries the query rather than this repository guessing at the answer.

## Declared-but-unreachable surface

**Four** — unchanged.

# P158 — the stop finishes its own job

He walked the failure path himself and found what four of my sequences had not: a stop that told him it had stopped, on a case that had not. The cancellation is two acts by design and both are right — the student's stop is instant and unguarded, and the conclusion waits until nothing is owed, because a concluded case refuses everything and would strand an account created in their name on a real portal. The defect was that the second act had only one caller, and that caller runs on an advance, and the Worker does not advance a run a person is holding. So the one kind of run most likely to be stopped was the one kind that could never finish stopping.

The first diagnosis I gave him was wrong. It blamed a missing write to the run's status and it was reasoned from reading the code rather than from running it, and four resume sequences built on it failed on his machine. The corrected one came from changing one variable on the fixture and reproducing — the same two calls, the same cookie, everything held but the prior case's state — which also exonerated the gate he suspected. He asked for that method to be the thing recorded, and it is, in the ADR and beside the code: a test written from a reading asserts what the reader believed; a test written from a reproduction asserts what happened.

His condition was that the conclusion must be enforced and not assumed, and taking it seriously found a second defect underneath the first. The guard that refuses to conclude while an account is outstanding sits in the machine, with a comment beside it saying it lives there because this repository has already learned what happens to rules that live in a caller. It was never reachable through `decide`, which built its context from the case alone and never handed it the obligations. The rule had been in the caller since P15. Now the obligations travel on the intent, and their absence is its own refusal: not asking is not the same as being told there is nothing, and only the second may conclude a stop.

And the message says which. Stopped and finished says nothing is outstanding; stopped and not finished says so and names the account still in our hands — and because that sentence promises to come back, the conclusion at the handover now tells the student it is done, which it never did. One thing raised and not fixed: a stop that concludes leaves the specialist's intervention open on a closed case, and closing it would mean writing an adjudication under a person's name for an act no person performed.

## Declared-but-unreachable surface

**Four** — unchanged.

# P157 — the runner says what it did

Run A got to the portal and the sign-in failed twice, and the cap built for exactly that stopped the run and told him. What it could not tell him was anything at all about why: the runner had no logging beyond a line that printed the turn's kind, and the word for a turn that ran was the same word for a turn that succeeded, so a real failure against a live portal read as `turn: worked`. Underneath it, five bare catches in the sign-in path that never even bound the error. His reading of that was the right one, and the one I would not have reached on my own: the thing to fix first is not the connection, it is the silence.

The scrub is the part worth being careful about, and he asked for it strict rather than useful. A scrubber decides what to take out, which is a guess about every message it has not seen, and the cost of that guess is a token in a log. So this is a vocabulary instead: a message is matched against a closed set of patterns and what gets printed is the phrase written in our own source, never a slice of what was thrown. A message matching nothing is withheld whole and the line says it was withheld. The one thing quoted from a message is a Chromium network code, which is an engine enum and names no page.

The attempt number could not honestly come from the runner, which is stateless between turns, so it comes from the plane on the work item. And the record now carries every attempt's code rather than the last, which is blocker 36 raised and closed in the same phase at his word: when the two codes differ, a person reading one of them is reading half the story.

What Run A proved before it stopped is in the Run A record now, as nine things rather than a failure: a stop at the last step of the sign-in is not the same as a stop at the first. The submit and load race is untouched, on his instruction, until a log says it is the cause.

## Declared-but-unreachable surface

**Four** — unchanged.

# P156 — Run A found it before a student did

He ran step 3 and the run stood at a position my sequence did not name, with no question, no message, no intervention and no log line. It was two of our own records disagreeing about one page, the third time: the plan had read the language section's optional fact since P147 and planned nothing for its eighteen starred boxes, the read he signed over said the form did not require them, and the validator read the marks alone and objected to all eighteen. Nothing compared the two until a run did, because the Run A test had checked the plan's blockers and never run the validator on the signed entry. That gap is on the record as its own line, and the test runs the validator now.

His evidence was a save, not a star: he had opened the language page fresh on 16 September, touched nothing, pressed Save, and the portal took it. So the section fact governs and the validator reads it through the same function the plan reads. The marks stay, no draft changed, the hash is the one he signed, and the re-sign he accepted is not owed.

The dead end he found is the more serious thing and is treated as such. A fix_content the interview cannot ask for stops for a person now, with the box, the rule and its bound on the record and never a value, and the student is told once. Until the interview can ask for a fix, every fix_content stops this way, and a stop that says so beats a loop that says nothing. Run A resumes from the conversation he left. One of ten.

## Declared-but-unreachable surface

**Four** — unchanged.

# P155 — the page fill stops at two

His rule had a third exception and he would rather not have found it on the live portal, so it is closed first, before the run, the same way as 26 and 120: two attempts on a page, then a person, with the student told which page, which attempt and what the page did. The build was the ledger's memory as much as the driver's branch. The row already counted attempts across a reopen; what it could not say was what the first attempt did, and the person asked after the second needs both, so the row now keeps each attempt's code in order and both stores prove it. The words to the student say what the runner saw and no more — a box that would not take its value and a page not saved, a page not laid out as expected, a browser that failed before the save — and the words to the person say where the record cannot tell a rejected value from a wrong box, rather than picking one. A save the runner could not confirm was never a failure and still is not: it stops at once as uncertain, as it did.

Blocker 31 is his to act on and he has: Run A signs in with his account's e-mail, re-seeded from a copy outside the repository, and the declaration carrying the account's e-mail is recorded as the thing to build, not a note. The fixture in the repository keeps the synthetic address. One of ten.

## Declared-but-unreachable surface

**Four** — unchanged.

# P154 — signed

He read the regenerated file and signed. The entry on main is the two drafts with his three signature fields and nothing else, a test now holds that, and the same test holds what he asked to be confirmed in one line: an edited label moves the hash, and the loader refuses the entry it no longer covers. The hash he pasted recomputes here to the byte. One signature, his, admitting one account, and the pins that said unsigned are flipped.

Step 5 found four things on a machine with Node and pnpm and nothing else, and one of them was a control firing for the first time outside a test: a Homebrew Redis with its default save schedule, and the Secure Service refusing to start rather than let ciphertext reach his disk. He named it for what it was. The runbook now carries all four with their fixes, and says plainly that the setting he used to get past it is lost on a Redis restart and where the persistent one lives. The runbook also says how the stack is restarted on the signed catalogue instead of the fixtures.

What is left is Run A, and the sequence for it is in the report rather than the record, because it is his to run with a live portal open and I would rather he had it whole. One of ten.

## Declared-but-unreachable surface

**Four** — unchanged.

# P153 — the labels he signs are the labels he reads

He would not sign over labels he could not read correctly, and said why: what he signs is the blueprint, what he reads is the preview generated from it, and if the labels are wrong the two are not the same document. So four fixes before the signature, each from a source and none invented. The nationality page's yes/no radios carry the option labels the third read found, where that read's values equal the draft's; P110's rewrite from the markup had put the field's own name on every option, and fourteen groups get their words back while three off the path keep their name because the read's "No" ran on into help text. The date selects that share a row with a labelled sibling carry the row's question, which is his fourth, the marker shape in the labels: anyone reading "Date of Birth: 2" saw the day as the date. The two hidden selects behind the education boxes are now a blueprint fact, fronted by the boxes that set them, so the plan lists them nowhere, and a mapping to one is refused. And the sentence at the top of every preview is true now: nothing is submitted by any run, so it says what the yes is, the fill saved on the portal and not the sending of it. There was no product path to make a difference explicit against.

Seven labels still carry the field's name, and the README says which and why: no capture holds their question, and a label the file did not carry is not invented. His acceptance of the four unobserved things is on the record in his words, with the four named, so a re-sign for one of them reads as Run A doing what it is for. The ADR on the preview carries the note he asked for: the preview and the page walk had answered "which pages does the run fill" differently since P72, and nothing compared them until a person asked to read the output. Two of ten.

## Declared-but-unreachable surface

**Four** — unchanged.

# P152 — the entry, and the read that is his

Step 3, with his two conditions met before the JSON. The first was the honest list: nothing in the entry is one I expect to revise, but four things in it have never been driven on the live portal — the grading systems following the institution box, the two Tom Select boxes as fills, the subject search, and the login form's locators — and if any is wrong the fix is a change to the entry, which means signing again. A smaller settled entry does not exist, because all four sit on Part 1's path. The second was the read: not the JSON but what will be typed into which box, page by page. That is now a command, printed from the same builder and renderer the run shows at the yes, and the committed file is its output for the synthetic profile, held equal by a test.

The read did its job before he opened it. The first two lines said the run would type the synthetic e-mail into the registration page's box, on a run that signs in to an account he already holds and never visits that page. The driver's page walk has skipped any page carrying a credential field since P72; the preview had not, so "exactly what will be submitted" listed a box the fill never touches. Red first, then the same rule at the preview, and the read starts at the personal page. Three label defects remain in it and are named rather than changed, because each is in the blueprint and the blueprint is what he signs.

The entry itself is the two drafts byte for byte after parse, pinned by a test so a draft cannot move under a signed entry unnoticed, with the authentication facts, no required documents, the repository's refs and the secure-channel delivery. It is not signed. Both artefacts still say draft, the set names nobody, the directory refuses to load, and the three acts that change that are his, written in order. Two of ten.

## Declared-but-unreachable surface

**Four** — unchanged.

# P151 — the sign-in stops at two, and a seeded value says so

Three of his answers, built before step 3 because he would rather Run A's first unknown be the portal than our own retry loop. The sign-in failure shape was blocker 26 again, and it is closed the way the creation's was: attempts counted since the session was last live, the handle each was handed named and offered to nobody whatever the Secure Plane's outbox has delivered, the first failure told as the first of two with the box opening again, the second stopping for a person with the attempt and the code on the record, and no box opening on a run a person holds. The part that is new is the honesty about what the runner can see. A refused sign-in is the login form still showing after the submit, which a wrong password and a portal fault both produce, so the student is told that the two cannot be told apart from where the system stands and asked to check the password carefully because it cannot, and the person is told the same in the record. Nothing picks one. Five tests failed before the mechanism existed, and the third reproduced the dead handle being handed to the next runner.

The provenance vocabulary carries the true word now. A seeded value says it was seeded, in the domain, the contract, the API's enum and the command, and the comment on the vocabulary says that this one source bypasses the student's confirmation on purpose and is named so it can never be read as one. Nothing refuses a seeded value on any path today, and the ADR says so and why. The e-mail stays synthetic, with a line in the Run A README so that silence from Sheffield is not read as a portal failure. And the count means what it says: two items open of ten, with items 3, 4 and 5 struck for Run A and kept open for the product, in his words. Two of ten.

## Declared-but-unreachable surface

**Four** — unchanged.

# P150 — the profile, shown before it seeds

Step 2. The synthetic profile is a file of eighteen values in the shape the store keeps them, and the command that writes it prints them first and writes nothing unless told to, which is the mechanism his flag asked for rather than a promise to show him. Who the profile is, is written on the file and in its README: an invented Iranian national in Tehran with no passport, one Sheffield BSc as a UK study on a student visa, back in Iran with one job. It names exactly the registry fields the Sheffield set reads and nothing else, and a test holds that it plans onto the drafts with nothing blocking on Part 1 and that the preview at the yes reads as it should. Writing it creates the student's row with the e-mail marked verified, goes through the real store, refuses a profile that already has anything in it, and prints the UUID that the session, the store and the approval all key on.

Two things were found by building it. The profile's UK study at university level makes the nationality page ask which qualification, from its own list — blocker 25's shape on a second page — and it is mapped for that one qualification the way P149 mapped the institution box, one value, anything else loud. And the runbook was wrong about the dev-session identity: the subject is not a label of his choosing but a students row's UUID, because the profile table references that row; the local-stack journey always did it that way and the paragraph did not. Corrected, and the seed prints the UUID. Smaller: the country box read as a DOM id in the preview and now carries the row's question.

One thing is said rather than solved. The registry's provenance vocabulary has no word for a seeded value, and its comment says there is no source that bypasses the student confirming. The seed stores the nearest honest word and an excerpt that says exactly what happened, and the README says that adding the true word is his decision, not the command's. His second flag, the sign-in failure shape, was traced from the code and is in the report, not the record: the box is spent at the moment the password is typed, a fresh box opens by itself, there is no attempt limit, and a wrong password shows him only the box again. Five of ten.

## Declared-but-unreachable surface

**Four** — unchanged.

# P149 — the chain, for one qualification, by name

Step 1 of the sequence he accepted: the six boxes the education page still needed are mapped for the synthetic profile's one University of Sheffield qualification, and for nothing else. The two Tom Select boxes are mapped as the controls the runner fills, never the hidden selects behind them; the country box now records its 255 entries from the reading he confirmed, so a mapping may name one under the rule that a typeahead is chosen by value. The institution map names one value, the subject map one subject, found by the one search word the captured results came from rather than by the subject typed whole, which nobody has observed. The grading system is mapped from the level, not the grade scale, because Sheffield's systems are a level-and-country vocabulary, and only system 7 is named because only its grades were read: a Master's is refused at plan time rather than left to wait at the fill for a list nobody read. The grade maps the four honours classes across two houses' spellings and nothing else. Every map is partial by design, so that anything the synthetic profile does not hold is a loud blocker on the box, by name, and never a guess.

One thing on the draft is inferred, not observed, and says so: the grading systems now follow the institution box, the control that is filled, which sets the hidden select the lookup reads — the same shape P102 gave the institution box after the country box. Run A tests it. Six pins failed against the old drafts before the new ones passed. Blocker 25 stays open for a real student, because a map one reviewer typed for one profile is not a rule. Five of ten, with a question for him: three of the five now cost Run A nothing, and whether the line should say so by count is his to decide.

## Declared-but-unreachable surface

**Four** — unchanged.

# P148 — degree complains, and the portal does both

He left the qualification select unchosen on a full throwaway entry and Sheffield refused it by name. So the degree is required to save, and on the very page whose unanswered evidence radios drop an entry silently, this box complains instead. His reading is on the first screen of the capture README in the form he asked for: this portal does both, and you cannot tell which from the field, so an error-free save tells you nothing and a complaint tells you only about that one box. His route is taken: the degree is mapped for the two levels the synthetic profile holds, onto Sheffield's own award titles, as a recorded judgment; any other level is a loud blocker; the unlisted box stays hidden and unmapped; nothing page-wider is built. The set now hands nothing to the student on any page. Found on the way: a required box nobody mapped, shown only when a mapped select says so, was a gap even when the select could never say so; it is now judged per entry, red first. Five of ten.

## Declared-but-unreachable surface

**Four** — unchanged.

# P147 — the page saves empty, and the seventeen are left empty

He saved the language page with nothing in it and it went straight through; the summary then said, in Sheffield's words, that a student without an English qualification need not complete the section. That settled the thing the screen had to settle, the easy way, and the page-wider mechanism stays unbuilt on an observation rather than a hope. It also unsettled the hand: a hand says the student must do this and the application is not complete until they do, and both are false here in the portal's own words, so the seventeen are un-handed and left empty, the third state, with the form's own words under the page. Whether a student who has a qualification enters it is the interview's question. The section-level fact is built as proposed and erases nothing: the section carries the portal's words, the parser keeps them and the hash covers them, and a marker inside such a section is read as a mark within it and not as a box the page will not save without. The fifty markers are now tabled with the three things "mandatory" means on this form, because someone would have read it as one.

He named the pattern, and it is on the capture README's first screen: Sheffield's failure mode is a silent drop, not a complaint, four times now, and on this portal an error-free save tells you nothing. The degree stays handed until his throwaway save settles it; if it is required, the route is confirmed and cheap. Three tests failed against the old code first. Five of ten.

## Declared-but-unreachable surface

**Four** — unchanged.

# P145 — the cut, and the mechanism that makes it safe

He accepted the cut in full and asked for the reasoning to be kept where the next developer reads it: the goal changed, the list did not, and a week of work was on it out of habit rather than need. That sentence is in the skipped list, in ADR-0119 and here. What reaching Run A needed was not twenty mappings but one mechanism, and it is built: any box the reviewer hands to the student is their own act on a page the runner still fills. His one condition holds in the preview and in its hash. The preview now reads page by page, in the portal's words, and under each page it says what was filled, then which boxes the student fills in themselves and that the application is not complete until they do, in the shape the document slots already used, then which boxes are left empty because nobody mapped them. The footnote at the bottom is gone. The record keeps the three states apart: filled is the hash the yes captured, handed is an own act per box with its page, never mapped is its own record per page, and a test at the yes holds that no box is in both lists. Set 0.3.27 hands nineteen required boxes on the language and education pages, so for the first time no required field on Part 1 is without a mapping or a hand; what the plan lacks is the synthetic profile's values.

Blocker 29 is built, at his word that an hour and a gate is the whole cost: a list longer than the form's blocks stops the fill by name, with the counts in the text, and nothing is typed short. Blocker 30 stays with its two-line note. The review pack is frozen with a line at the top saying so, when and why. Eight tests failed against the old code before any of this passed. What the screen still has to settle is whether Sheffield saves a page with a handed mandatory box empty; the steps for the language page are written for him, and the education page follows it. Five of ten.

## Declared-but-unreachable surface

**Four** — unchanged.

# P144 — one signature, and the gate that keeps it to one account

He changed the framing: the goal is a system that stands and runs end to end for a developer to inherit, not one in front of a real student, and the two-person mapping review is not worth five hours of two people's time for that. So it is one signature, his, and the three places that refused an approval signed by its author now accept one — on one condition he asked to be enforced rather than noted. An approval signed by its author must name the one account it admits, and the running system holds it to that: the listing shows a one-account target to that student and to nobody else, the offer draws from the same set, the start and the re-application refuse anyone else by name with a code in the contract and words on the page, and every later lookup for a bound case answers as if the entry were gone, so a catalogue swapped under a running case stops it. His sentence is in the code's comments where the check is: my memory of this conversation is not a control.

The thing given up is written where the developer will find it first — the README's first screen, the decisions index, the state document's opening paragraph — and it is said plainly: one person reviewed the set and that person approved their own project's work; a field mapped to a plausible wrong source is a class of error every test passes and no gate refuses; a second reviewer is a precondition of serving a real student, not an improvement. He asked what else on the list is the same shape. Seven candidates are named in the same file, with what each cut would leave uncaught, and none is cut, because a decision is his only in his own words. Four tests pinned the old rule and each was run red against the old code before it changed. Five of ten.

## Declared-but-unreachable surface

**Four** — unchanged.

# P143 — handled rather than absorbed

He kept the renames and said why the script was read, which is now in the ADR in his words: a student resident in Iran would have answered "have you always lived in Iran" and we would have stored it under always_in_uk, and nobody would have noticed until a form somewhere read that field and meant the UK. Three things from the read are on the record rather than in a reply. The field the page answers itself — living in the UK, ticked by the script from the residence when the student says they have not lived outside it — is a box whose value the student never gives and this system never types, and a later phase that reads it back as the student's answer is wrong; the set's note says so, and the pack. The two things the condition language cannot say are blocker 30 with his sentence attached: true of Run A and not of the product, and the day a UK national living abroad arrives the condition is silently wrong rather than loudly missing. And Sheffield's own bug is recorded as the portal's, dated, with what it means: the study block opens on nationality or residence alone, and if they fix the comparison the condition drifts under the draft. The note that the interview should ask the seven claims only when the residence makes a portal ask went to ADR-0113, where the person who builds the interview will read it.

The blocker 25 sheet is written. The institution box is one of five places on the form with the same shape — degree, subject, grading system and grade, and the five per-level UK-study selects — where the portal's own list meets the student's words and no rule joins them. Three options: the box as the student's own act; the interview offering the portal's entries and recording the choice on the case, the profile staying portal-free; a reviewed map per institution. B is recommended, with the reviewer's record for Run A and the runner's search for the product. The registry's nationality vocabulary is answered on the same sheet: a code, through a reviewed table, with a word the table does not know refused. Five of ten.

## Declared-but-unreachable surface

**Four** — unchanged.

# P142 — what the script says, once

He committed nationality.js and it says what the two spans hold: the permanent-residence country's name, "the UK" only when that country is the United Kingdom. So the two fields were asking about the country of permanent residence, not the UK, and both are renamed once, from the script, as he asked, with their labels; their mappings do not change. The script also says who is shown what: the always-lived questions and the entry date only to a resident of the UK or its territories, the seven claims only to a non-UK national resident in the UK or the EU, the passport to every non-UK national, the country blocks and the living-in-the-UK question after "yes" to living outside, the study block to a non-UK national and its details after "yes". The entry-date question from P139 is answered by the page itself: a student who never entered the UK is never shown the boxes.

The draft carries the page as twelve sections with those rules as visibleWhen, so a mapped field the page hides is neither typed nor missing. Proved on the synthetic profile: a resident abroad with no UK study and no passport fills the page with nothing blocking, and with UK study everything but the per-level qualification select. Set 0.3.25 maps the nationality and country of birth with partial ISO-keyed maps and the UK-study block from the registry's study value, with a date rule that may now be followed by an option map, because Sheffield spells its months Jan, June, July, Sept. With nothing confirmed at all, the unmapped count on the three pages falls to twenty, because the sections a controlling answer opens are hidden until it is given.

Two things the blueprint's condition language cannot say are on the record rather than approximated: a condition names one controlling field, so the script's "better of two nationalities" is read from the first nationality only, and the study block's OR over nationality and residence is written on the nationality alone. Neither is on Run A's path. Two things are open and his: the five per-level qualification selects, which want the student's qualification in the portal's own list — blocker 25's shape — and the registry's nationality vocabulary, on which the partial maps' keys depend. The pack tells Iman which three of the four moving parts have now landed and which two remain. Five of ten.

## Declared-but-unreachable surface

**Four** — unchanged.

# P141 — the third time the same problem arrived

Group 4 is decided and built in the hour: the passport is one value, held with its number, expiry and issuing country, or stated as none. His reason is the one this registry keeps arriving at — absence as a statement in one place is the shape of a job's end and a qualification's end, and this was the third time a student who does not have a thing had three empty values and nothing anywhere saying why. The half he called important is the other one: the portal's words for the absence live in the reviewed mapping and never in the profile. "no passport" is Sheffield's instruction, not a fact about the student, and a portal that says something else gets its own words. The tempting shortcut, storing the string once and reusing it everywhere, is refused by construction: the profile has no field that could hold it, and the part rule's new absent clause takes the words from the mapping it is written in, quoted from the row's own tooltip. B, giving only the number the kind, kept the defect and called it smaller; it is not smaller for the student it happens to.

The extraction plan reads a passport as one composite now, so a passport missing its expiry is not read at all rather than read with a made-up one. Set 0.3.24 maps the row; the drafts' unmapped count falls to twenty-seven. The words came from his committed markup (P140), read off the file and never off the console paste: the row, the tooltip, the thirty-character box, and the fact that every section of the page but one is hidden in the markup and shown by a script the capture does not hold.

Two more of his decisions on that page are recorded rather than absorbed. The three-year window the previous-country blocks ask for is the interview's to ask, most recent first, and the mapping keeps typing the first four: a rule that could sort and window periods by date would decide which of a student's answers reach the form, and that decision belongs where a person can see it. What that means is said plainly and raised as blocker 29 rather than buried: a student with five periods in three years has one dropped, and nothing tells them. And the two script-filled spans, "this country" and "the UK", are renamed by nothing until the script says what they hold, because if it is the permanent-residence country, two fields are asking a different question and recording the answer to ours, and he would rather that changed once, from the script, than twice.

Iman starts now. The pack names the four parts that may still move so he does not review them twice. Five of ten.

## Declared-but-unreachable surface

**Four** — unchanged.

# P139 — a month and a year, never a day

He confirmed the three shapes with one change, and the change is the registry's own rule applied to a date: the day the student entered the UK is not held. Sheffield asks a day because it asks a day, not because anyone knows it; a student who came in September 2019 knows the month, and holding a Date would mean the profile carries a day invented at the point of asking, which is the thing refused everywhere else. So the entry date is a month and a year, every day select on the page is unmapped by decision, and a portal that insists on a day asks the student for it as any unavailable value — one extra question for the students who reach that page rather than a fabricated day for all of them. He also gave two reasons to carry, since a later phase may want to undo them: the three starred yes/no questions are asked rather than computed from the history, because the history is what they remembered and the answer is what they claim, and only one of those is signed at the bottom of an application; and the seven status claims each map to their own radio with nothing derived, because a wrong yes opens a document slot the student must refuse or fill.

Built as confirmed. Three registry groups: residence (the country of permanent residence, in the UK now, the entry date, a history of periods in the shape of a job's dates, and the three asked booleans), the seven UK status claims, and previous UK study as none or studied with its details. The domain gains a proposal origin, derived, which must name the confirmed field it was read off — his condition on group 3, expressible today as a proposal and raised by nobody until the interview is built. Set 0.3.23 maps thirty-six of the nationality page's fields from the three groups, the four previous-country blocks taking the first four periods and leaving the rest empty, a current period's end empty, and no day anywhere; the plan's unmapped count on the three pages falls from forty to twenty-eight.

What is not mapped, and why, is on the record rather than absorbed. The UK-study block the page shows after "yes" has no show/hide in the draft, and mapping a hidden select would type into a box the page does not show, so it waits on the page's own script from the markup he is committing now, as P112 read the document uploads' handler. And one consequence of the plan's semantics is noted rather than decided: a mapped field with no confirmed value blocks a fill whether the page requires it or not, because the registry has optional parts of a value and no optional field. A student who has never entered the UK therefore depends on the page hiding the entry date for someone outside the UK; if the page shows it to everyone, the field needs a stated "never entered" kind, as a job's end has "current" — his call, when the read says which. Five of ten.

## Declared-but-unreachable surface

**Four** — unchanged.

# P138 — closing the box closes it

He answered blocker 28 in the hour it was raised, and the answer is the third reading: a cancel is the student's stop. Not a reopen — a system where closing a box does not close it is one people learn to fight rather than use — and not a person's problem, because a specialist reading "the student closed the box" has nothing to do about it. The run stops, the student is told plainly what stopped and that they can carry on when they want to, nothing is offered to a runner until they do, and the application is not abandoned: it waits where they left it. Two conditions came with it — a restart that does not go back to the beginning, so a cancel is an ordinary choice rather than an expensive mistake, and a record in which "the student stopped", "the portal refused" and "nobody was told" are three different things a month later.

Built the same day, red first. The run has a seventh status, `stopped_by_student`, and it is a fourth set beside the three the domain already partitioned its statuses into: not automatable, so no worker tick and no runner claim; not held by a person, so no intervention and no queue; not terminal. The driver reads the Secure Plane's cancel off the conversation log on the next tick, the same lazy reading as an expiry, and before any box would open it stops the run with one message and the phase untouched. Advancing a stopped run answers its stopped position and nothing else.

The restart is the student asking to apply again. `start` finds the run they stopped and carries it on as a restart: the decision opens a fresh box, and its checkpoint sets `running` in the same write, so no tick between the two can read the old cancel as a new one. The restart is the one decision that sees the cancelled request and goes on, and the box it opens supersedes it in the log. Told after, and only when it actually carried on. Closing the fresh box stops it again, in the same words. The password step now answers a cancelled request with the box again, as it does an expired one — which is what it should always have done, and what blocker 28's loop was: "asked already", and on to the portal with nothing to spend.

The three records, as he asked: the student's stop is its own status; a portal's refusal is `escalated` with an intervention whose text names the attempt and the cause; a stop nobody was told about is an intervention with `announced_at` still null. The demonstration client shows the stop in its own words rather than as a step to answer, and shows the choice of what to apply to once more for a stopped run, under a heading that says it carries on where they left it. Five of ten.

## Declared-but-unreachable surface

**Four** — unchanged.

# P137 — two, then a person

Blocker 26 is built as he decided it: C, and the number is two. The loop P121 watched — a failed account creation re-offered on every tick with the password the first attempt had already spent, refused each time, nobody told — is reproduced first as the opening assertion of the third driver test, red, and then closed in three places that each hold one part of the answer.

The ledger holds the count. `workflow_action_intents` still has one row per action, as ADR-0054 requires, and that row now remembers how many attempts were actually made and which secure request the last attempt spent. "Actually made" is the distinction the sheet drew: a runner handed a password it could not use has attempted nothing on the portal, so that hand-out completes as a clean failure with the count untouched — once is chance and twice is the portal, and that was neither. The spent request is an opaque id and it is there for one reason: so the decision about whether a password is gone does not wait on the Secure Plane's outbox. `secret_consumed` arrives later; a runner that never reached the plane at all leaves the log saying `secret_received` for ever; the ledger, written at the report, says the handle is spent now.

The orchestrator reads it as a state and answers with the box. The driver reads the row into the run state, and the password step sends the run back to the secure box while the log's latest request is the one a failed attempt spent — by identity, never by the lifecycle word. A request opened after the failure is fresh, and the second attempt is handed that one. The driver's own guard against opening a second box reads the same fact, so a spent request is settled whatever the log says yet.

The driver says what happened, each time. The first failure is told in the closed set's own words — the portal did not accept the details, my browser lost its connection — with why there will be one more attempt and that the box opens again because we do not keep the password. The second raises an intervention whose text names the second of two attempts and the reported code, tells the student the account could not be created and that a person will look, and sets the status nothing automatic offers. The challenge stop from ADR-0101 and this one turned out to be the same mechanism and are now one method with two callers.

Found on the way and closed: an escalated run's advance could open a password box. `advance` deliberately has no held-run guard, because re-deriving a stopped run is a no-op that re-stops it — and the box was the one thing on that path that is not a no-op. The second failure's spent secret made the step say "ask again" on a run a person was holding, and a box opened. It no longer does; the box waits for the person like everything else about the run.

Not done, and raised rather than decided: a box the student cancels loops the same way for a different word. `secret_cancelled` reads as "asked already", the creation is handed out with no password, refused, and handed out again — silently, because saying "the password you typed could not be used" to someone who typed nothing would be false. Whether a cancel means ask me again, stop for a person, or I am stopping is a product reading, and it is blocker 28 for him. Five of ten.

## Declared-but-unreachable surface

**Four** — unchanged.

# P136 — decided before it is built, and two sheets

He answered the question I had left him while it was fresh, so that whoever builds the interview's coverage starts from it rather than re-opening it: entry by entry, not a CV block. His reasoning is ADR-0113 in his words — a model proposing entries from a pasted CV makes the model the source of what goes into the profile, and confirmation after the fact is weaker than it looks, because a student reading back five plausible jobs will confirm them without checking the dates; every value in this system comes from something the student said deterministically, and a CV block would be the first exception, its own decision with its own argument if ever wanted. The ADR turns that into four rules for the build: one entry at a time, one part at a time, parsed as the seven fields are; the student's claims asked, not inferred; "none" as a confirmation; and nothing entering the profile from a document the model summarised. Not built, at his word. He also corrected the framing I had used twice: it is not a list-valued problem, the interview covers seven of twenty-seven fields, and that number now sits under Run B rather than the phrase.

Two of his notes on item 7 are carried into ADR-0091 rather than absorbed: the gate refuses the whole unit of work rather than skipping a page, because a half-filled application with one page disallowed is worse than not starting; and of the two things not done, the account paths' reliance on the gate alone is what he would revisit first if that path changes.

Then two sheets, since the next decisions on the list are his. Blocker 26 is the retry loop P121 found: a failed account creation whose secret is spent is re-offered on every tick and refused every time, and nobody is told. The sheet names the facts from the code and three options — cap and stop for a person, ask the student again through the secure box as the resume path does, or both — and argues for both, because asking again is the honest answer to that specific failure and a cap is what stops a portal that refuses every time. Item 3's second half is the nationality page's seventy-two fields sorted by what the registry holds: four are reached and the rest fall into four groups — where the student lives and has lived, the seven UK status claims, study in the UK before, and the passport when there is none — each with options in the shape items 2 and 5 took, a recommendation, and the one that waits on the words of a row nobody has read into a file. Five of ten.

## Declared-but-unreachable surface

**Four** — unchanged.

# P135 — the run obeys it, not the operator

He asked where the interview's inability to ask for a list-valued field sits, and whether two of his last three decisions had bought nothing. Read from the code rather than remembered: the interview asks a field only when a question is defined for it, seven of the registry's twenty-seven fields have one, and for any other outstanding field it stops with *"No question is defined … The agent will not improvise one."* The two groups he decided are among the twenty it cannot ask, and so are the address, the passport, the English test, finance and immigration. Run A does not meet this — its profile is confirmed through the service's own store and page by the deterministic client, lists included, which is exactly what the journey does today — so the decisions bought the profile, the mapping, the fill, the preview and the count, all of which Run A exercises. Run B, the student talking to AskiMate, meets it on its first required field with no question, which is why it is now written under Run B on the distance list and was not on Run A's. His sharpening stands: the extraction proposes nothing for a qualification a transcript calls expected or discontinued, so the interview is the only source for those two states.

Then item 7's second half, mine since he corrected the record on 2026-09-14. ADR-0091's reading, obeying and pacing lived in the discovery CLI; the runner's fill path read nothing and paced nothing. Now a gate stands before every unit of work the runner performs: it reads the portal's robots.txt as the runner's own token, keeps it ten minutes so a fill of eleven pages does not read it eleven times, decides every URL the work would open, and refuses the work with a new member of the contract's closed set, `robots_disallows`, when any is disallowed or the file could not be read — the middle row of ADR-0091's table, failing closed, because a run that could not ask has not obeyed. The fill session refuses a disallowed navigation a second time and a disallowed subresource at its request guard, as the discovery session always has, and paces its navigations at the site's Crawl-delay or the one-second floor, whichever is longer, with nothing able to lower it. Proved red-first against the fixture portal's own robots.txt — `/private/` refused at the gate and at the session, two navigations a second apart — and in the gate's unit tests; the journey runs the real performer through the gate. Two things not done are said in the ADR rather than left to be found: the account paths open one page each through the context and rely on the gate's decision, and the runner keeps no robots.json. Item 7 is done. Five of ten.

## Declared-but-unreachable surface

**Four** — unchanged.

# P134 — the date the certificate carries

He confirmed all four parts as proposed and asked for three of the reasons in the ADR in his words rather than as design notes. The award date is held on its own because it is the one date on that page most likely to be compared against a document, since it is the date the certificate carries — not a form-filling argument but what an admissions office actually does with the claim; that is now the reason in the ADR, and the cost comparison is not. The completion year is gone because beside an end date it would be a second truth about one fact, and two fields that can disagree is what this system refuses — a sentence he wants kept in those words because it generalises. And the three-way end is noted as read off the portal rather than imagined, from the form's own instruction to include qualifications you did not complete and its grade *Failed to complete course*, because a later phase may think it over-engineered and it is not. One condition came with the confirmation: reading an award date off a certificate gives month and year or nothing, never a year with a month we chose, the same class as the trailing-space problem — works in testing, fails once, quietly, on the student whose certificate shows only a year.

Built as confirmed. `Qualification` carries a start, an end that always carries a date with the student's claim about it, and an optional award; the completion year is removed, and the seven test files and the fixture mapping that carried it moved to the new parts. The transcript plan reads an entry date, a completion date and an award, and the award is read as month and year or not at all: the fixture's *Year of award: 2022* yields no award date and the qualification assembles without one, while a second fixture's *12 November 2022* yields November 2022 — both cases in the test, as his condition asks. No format rule was needed; the parts, the option rule for the month name, the number rule and the empty-when-absent rule already cover it. The set at 0.3.22 maps the six education date selects per qualification, the months by the selects' three-letter names, the award boxes left empty when there is no award.

The draft test says what changed for the plan. Two qualifications are typed once each into the same boxes, the second one — still running — with its expected end typed as the date it is and its award boxes empty; the four mandatory date selects leave the plan's no-mapping blockers, which are now forty and all on the three unmapped pages; and a profile with no qualifications list is unavailable on the four, as it is on employment's four. Blocker 27 is closed. What remains of item 5 is the reviewer's option maps onto the lists the as-is read captured and the institution box, blocker 25. Six of ten.

## Declared-but-unreachable surface

**Four** — unchanged.

# P133 — the precedent makes it easy

He decided blocker 27 the way he decided item 2, and said so: the dates go into `Qualification`, because a student who typed a degree's start and end for Sheffield should not type them again for Manchester, and a qualification without dates is not one anyone can assess — a gap in what the profile knows about a student's education, not a Sheffield quirk. A start and an end as month and year, matching the employment entry's, since a qualification has no meaningful day either; the shape to be proposed and confirmed as last time. ADR-0112 carries his words, and the proposal: `start`; an `end` that always carries a date and the student's claim about it — completed, expected, or discontinued, the third because the form itself names the case; an optional `award`; and `completionYear` removed rather than left beside `end.date.year` as a second truth.

He asked one question to be answered rather than decided silently: whether the profile holds the award date separately, or only start and end, leaving award unmapped. My conclusion is in the ADR with its reasons: hold it on its own, optional, and never derive it from the end. It is a different fact — his own example, June finished and November conferred — and it is the date an assessor checks against the certificate; filling the award boxes from the end date would be the quiet inference ADR-0111 refuses, in the other direction; leaving it unmapped is honest on Sheffield, where it is unstarred, but loses a fact other forms require and brings back the retyping his reasoning exists to remove; and it can be optional without breaking his rule against blanks, because an absent award date claims nothing — the portal's boxes are left empty, which is what a student not yet awarded would do — where an absent employment end would have been read as a claim. The cost is one optional question and one extraction part. Nothing is built until he confirms.

Two of his instructions are carried into the record rather than absorbed. The two subject values with a trailing space and the one listed twice are his to remember when a mapping is authored — the kind of thing that works in testing and fails once, quietly, on the one student who picked that subject — and his words stand beside them in the capture. And the *Qualification* row's star, marked in one read and not the other, is unsettled until someone looks at the screen; the pack now says that no later phase resolves it by picking the more convenient reading. Six of ten.

## Declared-but-unreachable surface

**Four** — unchanged.

# P132 — the list four reads could not get

He ran item 5's read as it stood — United Kingdom, University of Sheffield, the first real grading system, *business* searched — and `--as-is` did what it was built for: nothing was navigated and the chosen state survived into the file, which was not true of the first four attempts. The grade list arrived: system 7's six grades and two non-grades, values as labels. Sheffield's four grading systems are there by numeric id with the *Not in list* escape, per institution as he said. The subject results arrived by search-then-select, eighty-seven for one word, in the shape the draft has modelled since P100 — a plain select filled after a press, not a typeahead — with two values carrying a trailing space the label hides and one value listed twice, both of which an exact-value mapping has to know. And the hidden select behind the institution typeahead holds the chosen entry's value, `SHEFFIELD`, which is the value P118 recorded on the typeahead entry, so the rule and the select agree. The chain `institutionCountry → institutionCode → gradingSystemId → grade` is now in the curated draft from observation rather than inference, and the `optionsAfter` links it has carried since P94 stand as observed. His caveat is the record's: the grade list is per grading system, and another system is another read.

What the read found is the reason no mapping is authored. The registry's `Qualification` holds a level, a subject, an institution, a country, a completion year, a grade and a grade scale, and no start or end date; the page's four date selects are marked mandatory in every read of it. So a qualification cannot be saved from the profile as it stands, whatever else is mapped, and what the profile collects is a product decision — the same shape as item 2, raised as blocker 27 for him with the two routes named and neither taken. One more thing, flagged rather than settled: `degree` and `unlistedDegree` came back unlabelled and unmarked where the third read had them marked, and the file has no markup, so the draft keeps the marks and the pack asks Iman to look at the row in both states. Six of ten.

## Declared-but-unreachable surface

**Four** — unchanged.

# P131 — the markup, and two things carried rather than absorbed

He committed the summary page as captured, checked for his surname and e-mail first, and asked whether the employment listing's shape is actually education's. It is: section F is the same `div.homepageBlock` with its `h2`, the same `div.homepageInfomation`, and inside it the section's sentence, one `h5` reading *Previous Employment 1*, the entry's table of four rows, and the *Edit* and *Delete* links — education's section E, row for row, with the other heading. The locator authored on his word stands on the page and the draft is not corrected. The runner's own `count` is now run against the captured file rather than a fixture in its shape: one employment entry, two education entries, none for a section that has no numbered heading.

Two things he asked to have carried, not absorbed. The first is a limit of ADR-0106 as he decided it and is not reopening: a repeating page's entries are counted, never read back, so nothing confirms a saved job's values — not the summary, not the new-entry form, which reopens empty — and the count is the whole of the verification; it becomes possible only when a portal offers an edit view of a saved entry, and not before. Stated in the ADR in his words, and in the standing account's list of known gaps. And the markup adds the fact that makes the sentence's second half live: Sheffield does offer that edit view, `employment.do?update=1` beside every saved entry, education's too. So a value read-back is possible there in principle. It is not built and it is not decided, and the record says both. The second is the mechanism behind the fifth marker: one star marks every control in its row, so the marked count is an upper bound and not a count of separately-required fields, and the review pack now says so in his words where the fifty are tabled, so Iman reads them as rows.

Two smaller things from the markup, noted where they belong: the *Add new employment details* link is the bare page URL rather than `?new=true`, and employment's *Delete* asks for no confirmation where education's does. Six of ten.

## Declared-but-unreachable surface

**Four** — unchanged.

# P130 — counted, not read

He saved one throwaway job on his own account, read `summary.do` and the new-entry form, and deleted it; section F reads *No employment information entered* again. The heading is *Previous Employment 1*, the same shape as education's, and the curated draft now names the listing the way P113 named education's — an `h5` reading exactly that, inside the same wrapper, exact to the number — so each employment save is counted rather than uncertain. The wrapper is taken on his word that the shape is the same, because the commit carries the draft and the run record and not the capture's HTML, and the record says so. The new-entry URL opens empty after a save, so it is the way in and nothing else is needed; the summary carries an *Add new employment details* link as education's does.

Two things he noticed are worth more than the locator. The summary lists a job's dates, title and employer and not its duties, and he asked whether a page verified by what the listing shows would ever see them. Checked against ADR-0106 as he decided it: a page filled once per item is counted on its listing and never read back by value, because the new-entry form reopens empty — so nothing today confirms a saved job's values at all, and the count is the whole of the verification. His observation does not change that; it rules out one future: a listing read-back could never reach duties, so if a job's values are ever to be confirmed it has to be from the entry's own page, and whether the portal offers one is not in the record. And five fields came back marked where he had filled four starred boxes and the year: the fifth is the year, which shares the *Start Date* row with the month and took the row's star — the mechanism that marked `unlistedDegree` on the education page — which is moot for the fill, since both are mapped and a month without its year is not a date. Six of ten.

## Declared-but-unreachable surface

**Four** — unchanged.

# P129 — one entry per job, and "none" said out loud

He confirmed the shape and asked for two of its reasons in the ADR rather than in design notes, in his words: the end date is a date or "current" and never a blank, because a student who leaves a field empty has told us nothing and treating that as still working there is exactly the silent inference this system exists not to make; and the referee is a third party's personal data held only when the student gives it, the reference-letter problem from B1 row 4 arriving in a new place. One change with them: the referee's email and phone are not collected at all until a portal we support asks — a name and role says the referee exists, contact details are for someone who has not heard of us, and we hold what we need when we need it. The entry type in the registry carries his words beside its fields.

Built as confirmed. `employment.history` is a list-valued, ordinary registry group, and each entry holds the employer and its address as given, the position, a start month and year, an end that is either a date or the student's statement that the job continues, an optional basis, the duties verbatim, and an optional referee of a name and a role. Two format rules were needed and no month rule was: the month's name comes from the option rule that already exists, nested under a part; what did not exist was a way to leave a box empty because a part is absent by the student's own statement, so `part … absent: "leave_empty"` renders the empty string for a current job's end boxes, and `join` puts the employer's name and address into the one box Sheffield offers. Both red first. The curated draft is at 0.2.19 with the employment page titled *Employment history* and repeating over the group, and the set at 0.3.19 maps the four required fields, the start year and the end date per job.

The draft test says what the fold means. Two jobs are typed once each into the same boxes, the second one's end boxes empty; a student who confirmed no jobs fills the page zero times, no field blocks, and the preview carries *Employment history: none — the page is left as it is* inside the hash — the line P96 wrote for exactly this, now reading as he asked; and a student never asked is `value_unavailable` on the four, so confirmed-empty and unasked are different things, which is the whole of what he wanted to be careful about. The plan's no-mapping blockers are now the forty-four of the three unmapped pages and no longer employment's four. Not built, said so: the interview cannot yet ask for a list-valued field, which is as true of qualifications as of jobs; the plan does not check a portal's cap against a rendered value; and the listing on `summary.do` for a saved job waits on his throwaway save, his own account and his own call, with what to capture written under the employment section of the capture README. Item 2 is done. Six of ten.

## Declared-but-unreachable surface

**Four** — unchanged.

# P128 — the product, not the page

He decided item 2 and began with the fact that shapes it, from `summary.do` in the portal's words: *"No employment information entered. If you do not have any relevant employment then you do not need to complete this section."* The section is optional, the four stars apply only once someone adds a job, a student with no work history is not stuck, and the handoff route was never needed to make the page passable — so the record's line that whether an entry is required was not in the record is corrected, and the decision became one about what the product is. His reasoning is in ADR-0111 in his words: nearly every postgraduate form asks for work history, and handing it to the student at Sheffield hands it to them at Manchester, which makes fill-once-apply-to-many untrue of the part of the form that often carries a borderline application.

Three things are decided and none is built. A registry group for employment, one entry per job, designed for the general case rather than Sheffield's four fields; the page marked repeating the way education is, so that one entry per job is not discovered again at fill time; and a page filled zero times said plainly in the preview, so that a student with nothing to add sees that we knew and chose to leave it empty. He asked for the shape before the build, and it is proposed in the ADR: `employment.history`, each entry the employer and its address as the student gives it, the position, a start month and year with no day we never had, an end that is either a date or the student's statement that the job continues, an optional basis, the duties text under the portal's cap and never trimmed, and an optional referee named for what it is — a third party's personal data, with the guardian fields as precedent. One consequence is written down because it is easy to get wrong: a confirmed empty list and an unasked one are different things, and only the first fills the page zero times; the preview's zero-count line from P96 already sits inside the hash and reads as he asked once the page is titled *Employment history*. Two things the build will need from him beyond the confirmation, both in the ADR: the `summary.do` listing for a saved job, which his account cannot show because it holds none, and the add-another control. Seven of ten.

## Declared-but-unreachable surface

**Four** — unchanged.

# P127 — the read that would have thrown away the thing it was for

He took item 5 next and asked what to do on the page before running the read. Writing the steps found that the read could not be taken as the tool stood. The education page's grade list loads only after an institution is chosen, and its grades after a grading system; the attached tool opens each page in a tab of its own and navigates to it, so every choice made by hand is gone before the observer runs, and a fresh `education.do?new=true` says *Enter your institution to see grades* and nothing else. The instruction "choose an institution, then run the read" would have produced the same empty list a fourth time.

So the tool reads a tab as it stands. With `--as-is` the session finds the person's own open tab at the URL — refusing none and refusing several, because which of two tabs is the right one is not a guess this session makes — and makes it the page the observer reads, navigating nothing and closing nothing; the tab is theirs before, during and after. The shape P80 found came back through another door: the `__name` shim the session installs with `addInitScript` reaches a tab only on its next navigation, and this tab must not have one, so the shim is put in by hand before the read. Proved red-first on the fixture: the person chooses a nationality in their tab, the passport-country list loads, the tool adopts the tab and the list is in the read while a marker on the page's window survives it; and through the real command under tsx, which is where the shim would have failed. The runbook carries the paragraph and the education page's steps are written in order, ending with what he must say in the message because the file cannot: the read records lists, not choices.

Item 2 he asked to see before deciding, and it is read from the registry rather than from memory. The four are `startMonth`, `position`, `employerDetails` and `duties` — the start of a job, its title, the employer's name and address, and up to four thousand characters of what the job involved — and the registry holds nothing of a student's working life under any name: its nearest keys are a qualification's institution and dates, which are education, and the personal statement, which is prose. Four new facts, so a product decision and his. Two things beside it for the decision: the page is one entry per job and the draft does not yet mark it repeating, and whether Part 2 opens with no employment entry at all is not in the record. Seven of ten.

## Declared-but-unreachable surface

**Four** — unchanged.

# P126 — stop, in his words, and the fold

He stopped the reads, and for the reason rather than the count: *"The third rule produced nine header labels and no right label on the page it was written for. A fourth rule would be written without the markup and tested by a fifth read, exactly as the first three were. That is the shape to stop at, not a number."* He asked for two things recorded in his words, and they are, in the third read's README and on the distance list: the ceiling is 106 of 149 because 43 fields have no question of their own, and the 13 between 93 and 106 are not a tool failure but markup a positional rule cannot reach, which nobody reading later should take as work left undone; and that refusing was right on the fourteen, because a wrong label is worse than none, a reviewer confirming it having nothing to notice, and 79 right is better than 93 with 14 wrong.

Then the fold. The curated draft is at 0.2.18 and carries, on the five pages, the seventy-nine row-text labels with their source named, the fifty markers as `required` with source `observed_marker`, the fourteen excluded so their names stand, and the thirteen as their names. The mapping set is re-bound to it as 0.3.18 and changed in nothing else. The draft test pins every one of those numbers and names, and it showed what the fold means for the plan: with an empty profile, forty-four observed-mandatory fields on nationality, language and education now stand as `no_mapping` beside employment's four, which is items 3, 4 and 5 of the distance list made visible by item 1's answer, and exactly what the list said would happen once the mandatory set was known. The six education companions the read also marked are not among them, because a handed slot's companion is the student's own act and the plan says *later* for it.

The review pack is revised as he asked. The thirteen are a list of their own with the page and the field name, before the two hundred and sixteen rows rather than buried in them, with his words above it; their rows in the tables are marked so they look different from the rest. The fifty markers are tabled for confirmation, and two of them are flagged as mine to a reviewer and not his: language's eighteen marked of twenty, which reads as the test block's own rule rather than eighteen universal questions, and `unlistedDegree`, marked by a star that belongs to the select it shares a row with. Item 1 is closed with thirteen carried into item 6. Seven of ten.

## Declared-but-unreachable surface

**Four** — unchanged.

# P125 — the ceiling of reading by position

The third read came in at ninety-three labelled and fifty marked, and he asked two things and a third: what the fifty-six still unlabelled are and whether any of them matter; whether the four wrong labels are fixed or changed to something else also wrong; and whether to stop, because he would rather be told the ceiling now than find it with me on the sixth read.

The fifty-six sort cleanly. Forty-three have no question of their own and "unlabelled" is the right record: the search box on every page, five with a tied label, the second, third and fourth previous-country blocks and other-institution rows under one column header, and the six education file inputs whose companions now carry each slot's title and description. Thirteen matter: the nationality page's eleven top questions — funding nationality, country of birth, permanent residence, the date of entry, the visa months and years, the inside-or-outside pair — and the two language radios that carry the star with no words before them. Nationality's marker count did not move between the second read and the third, twenty and twenty, which is where his twenty-seven asterisks are: on those questions, wherever they sit.

The four wrong labels are gone as they were and fourteen new ones stand, in two shapes the file itself shows. Sheffield puts a sentence of help after each control on the education page, so the text between two controls — the own-words rule — is the earlier control's help and the later one's question together, and five fields now open with a sentence about the field before them. And the nearest row above with words and no controls was, twice, a table's header row: seven selects labelled "Country From To", two boxes labelled "Institution Course Applied For". He had said a wrong label is worse than none, because a reviewer confirming it has nothing to notice, and the observer now refuses both shapes rather than guessing: own words of more than one sentence, or ending as a statement, give no label with the marker still read from the row; a question row above is taken only over one control or one group. Both red first, on a fixture built from the file's own texts. On this file that leaves seventy-nine labelled and none wrong, which needs no fourth read to know. One correction of my own record: `subject`'s "Results:" was listed among the wrong labels in P124 and is the row's own text beside a search box; it was never wrong.

The ceiling. The thirteen that matter are exactly the fields whose question is in none of the three places a rule over rows can look — before the row's first control, between two controls, in a sibling row above with no controls — and the third read proves that for nationality directly: the row above each of its top selects holds another select, so the rule stopped there. The question is after the control or in an enclosing structure the row model does not see, and a fourth rule for that would be written without the markup and tested by a fifth read, as every rule so far was; the third one produced nine header labels and no right label on the page it was written for. So the answer is to stop. The reachable ceiling is a hundred and six, not a hundred and forty-nine; the thirteen are Iman's to read from the screenshots, which is what the pack's required section has said since it was written. What follows his word is the fold into the curated draft with the fourteen excluded, and two marks for his harder look: language's eighteen of twenty, and `unlistedDegree`, marked by a star that belongs to the select it shares a row with. Eight of ten.

## Declared-but-unreachable surface

**Four** — unchanged.

# P124 — seventy-six of one hundred and forty-nine is not a read page

He ran the re-read the same day and the summary said what it was built to say: seventy-six labels from row text, forty-two marked. He asked whether that closes item 1, plainly, and what the seventy-three are. It does not, and the seventy-three are read off the file by name rather than by count: nationality's top selects — funding nationality, country of birth, permanent residence — its date of entry, all four previous-country blocks with their dates, the visa months and years, the inside-or-outside radio pair; two language radios that are marked and still unlabelled; the education page's degree and its six slots with their companions; the marketing page's other-institution boxes; and ten that carry a label the markup ties, the search box on every page among them. Four more labels are wrong rather than missing: where one row asks the country, then the institution, then the unlisted institution, every control was given the row's first question, and the grading row did the same.

What the failures say about the markup, since the file has no markup in it, is stated as inference: the question of those nationality selects sits in a row of its own above the control's row, which is also where his twenty-seven asterisks are; some rows ask several things; and some rows ask nothing anywhere. The observer now reads, per control, its own words between the previous control and itself — not for or after a radio, whose between-text is the earlier choice's — then the row's question, then the nearest row above with words and no controls, and takes the marker from any of them. Each shape is on the fixture, red first. Whether Sheffield is what the inference says is what his third read tells, and the README carries a console paste, options removed and values stripped, for the case that it is not.

His six console observations were checked against the file one by one, as he asked, and the record corrected where his version was wrong. Four held: the starred residence questions, the five companions unstarred behind their conditions in the portal's words, the previous-country rows with no question, and the passport number starred. One is half: the passport row's instruction on what to enter without a passport is nowhere in the file, because it sits after the control and the observer reads after-text for radios only. One is corrected: `refugeeStatus` is not the one starred radio group — twelve yes/no groups are marked, and his second snippet filtered names on `Scan|Proof|Status|Upload`, which of the starred groups matches `refugeeStatus` alone; the "one" was the filter's. Forty-two against twenty-seven is consistent, and not in the direction a star shared by several controls would give: nationality marks twenty, fewer than his count because the question-row markers were not attached; the rest are language's eighteen of twenty, which reads as the test block's own rule and needs his eye, and education's four dates.

One more thing the file showed. Every companion's "later" option ended in `<br/> <input type="radio" name=…`, cut at eighty characters — the text of a comment node after the last shown radio, a third option Sheffield switched off, which the observer took for the radio's own words. Text and elements only now, never a comment; red first on the fixture. Iman's pack is unchanged by count, twenty-three judgement rows and one hundred and ninety-three mechanical, because the counts are by field and the fields are the same; the row-text labels confirm the proposed categories and move none. Its `required` section is what grows, by the observed markers, once the read is complete — not from this file — and no time figure for his sitting was ever recorded, so none is put in now. Eight of ten.

## Declared-but-unreachable surface

**Four** — unchanged.

# P123 — the asterisks were never in the markup

He read the five unlabelled pages with the attached tool, from his own account, and committed the draft. It came back as the first read had: the label as the field's name on 139 of 149 fields, no asterisk, nothing required. He had predicted it before I opened the file, and he asked for it said plainly rather than worked around: the tool's own observer is what produced the placeholder labels the first time, because the markup ties no label to any input on these pages. That is what the file shows, and item 1 is not closed by it.

What closes it is the tool reading what a person reads. The observer resolved a label through `label[for]`, a wrapping label or `aria-label`, and Sheffield puts the question in the row's first cell and a bare `<font>*</font>` beside it, tied to nothing. The observer now reads, for a control the markup ties nothing to, the text of its row before the row's first control, so a date asked as three selects shares one question and a country list is never mistaken for one; it records it as the label with `labelSource: "row_text"`, because a label read from position is a judgement the reviewer confirms, not a tie in the markup. A visible asterisk in the row becomes a `required` validation with its own source, `observed_marker`, distinct from an attribute read off the element. A radio's own words are the text after it and the group takes the row's question. A row that names no question keeps the field's name, unlabelled and unmarked. An empty tied label, which the education page carried on its country box, is no label. All of it is proved on a fixture in the shape he described, since Sheffield's markup is not in this repository, and the attached read's summary now prints how many labels came from row text and how many rows carry the marker, so the next read says at once whether it got the asterisks.

Three console outputs of the nationality page never reached me; the paste was lost between the browser and the message each time, which is why he used the tool. His observations from them are held in the capture README as his, unconfirmed, until the re-read carries the same facts. The re-read is his next move and is cheap: the same command after pulling main.

## Declared-but-unreachable surface

**Four** — unchanged.

# P122 — the account is his, the data is not

He decided item 8, and he decided it against the option the list had carried since P119. A synthetic applicant registered on Sheffield's real form is, in his words, a fake person in a real university's admissions system, a record Sheffield would hold about someone who does not exist, created by us, which they did not agree to hold. The first live run enters his own existing account. He drew a line inside the decision that the record keeps: the profile typed under that account is synthetic and the account is his, two decisions, and he answered only the second. ADR-0110 carries his words and the answer to his question about what depends on it downstream: the account's address is the profile's confirmed e-mail, so the synthetic profile must carry his real one; his real password crosses the secure box once, as the resume path already does; the handover's reset item would be a real reset of his real password unless he waives it; and nothing in the system reads or checks whether a profile is true.

The start path does not exist yet and it is mine. Sized against the code rather than by feel: the orchestrator already holds the whole sign-in path (ADR-0101 §3) and already models an account as something that can exist without our having made it. What is missing is a way for the student to say so before the yes, a case event that records it, the driver deriving an account from that event as it derives one from a completed creation intent, one condition in the orchestrator so that an account with no recorded session is treated as not signed in, and the preview saying signed in rather than created. One phase, in the shape P72 took; not large, so it is built without a further ask.

One thing found while writing his robots.txt instruction. ADR-0091 reads, obeys and keeps `robots.txt` and paces requests, and every one of those lives in the discovery CLI, under ADR-0014's read-only run. The Automation Runner's fill path, the one Run A uses, reads no robots.txt and paces nothing. The distance list had said since P119 that the run reads it before the browser opens; that was true of discovery and not of the run in question, and the list now says so. His read of the public file still settles the question early; P123 puts the reading, the refusal and the one-second floor into the runner, because he set both as preconditions of any run against a live site and the run that matters does not have them.

Item 10 is held by his word: not before Run A has happened once. Items 1, 2 and 5 are his next reads in that order, and the item 1 snippet is in the capture README.

Then the build, the same day. The path is what the sizing said it would be. The student says the account is theirs while the run awaits the yes; the case records that as a fact of theirs, carrying no address, because an account's address is the profile's confirmed e-mail and the case log gains nothing by repeating it. The driver derives the account from that event as it derives one from a completed creation intent, at stage active from the declaration, made by the student. The orchestrator needed no change for the flow: an account with no live session already opened ADR-0101 §3's sign-in path, and that path is now also a start. What changed is what it says, since a student who has signed in to nothing must not be told they were signed out. He read the robots.txt and pasted it whole, and his robots.txt paragraph had one more decision in it: the handover's reset proof is waived for an account the student made themselves, in his words, because asking someone to reset a password they chose to prove they can receive mail at an address they already sign in with proves nothing and costs them a real password. Built as he said it, and read as covering both address proofs, since both establish what their signing in already has. The journey through the five processes runs again in this shape: the account registered on the fixture portal beforehand with a password only the student knows, declared before the yes, signed in to by the runner process with the agent typing over CDP, the form filled, one confirmation at the handover, the portal holding exactly the one account and no creation intent ever opened. Item 8 is closed and the count is eight of ten.

His robots.txt read was evaluated by the runner's own matcher rather than by his reading, as he asked. Every one of the eleven observed paths and the forgotten-password page is allowed, and allowed because no rule matches, not because an Allow won. The three Drupal disallows he pointed at are path rules: the matcher refuses `/user/login`, `/user/register` and `/user/password` themselves, and reaches nothing under `/postgradapplication/`. There is no crawl-delay, so the one-second floor is ours. The evaluation found one thing in the matcher: when nothing matched, a non-matching Allow rule became the winner at length minus one, and the decision read "Allowed by" a rule that had nothing to do with the path. The outcome was right and the evidence was false, in a file that exists to be the evidence. Fixed, red first; the discovery capture's own record had recorded robots as not applied to the attached inspection, so no false line stands in the record. The file is kept beside the capture and its test runs in the census.

## Declared-but-unreachable surface

**Four** — unchanged.

# P121 — the five processes, driven through the whole journey

P120 stood the five processes up and checked that each answered. P121 asked them to do the work: the student's requests over HTTP to the Conversation Service process, the password through the real frame from the Secure Service process in a Chromium the test launches for the student, the Worker process moving the run past the yes on its own clock with no request from the student, the Runner process creating the account and filling the fixture portal in the browser it launched, the Fill Agent process typing the password over CDP, the handover confirmed twice, the run finished ready to submit and nothing submitted. The test reads and asks; it performs nothing, drains nothing and advances nothing itself. It is green, in about forty seconds, and it took five defects to get there — each one invisible to the in-process journey, and each proved red before its fix.

The worker's env file did not carry the portal origins, so the worker served the fixture blueprint at the host it observed while the service served it at the origin named; the worker's tick rebuilt a preview that differed from the one the student had authorised and voided their yes as `content_changed`, every five seconds. The case log showed it directly: `AuthorisationCaptured`, then `AuthorisationVoided`, then the case back at authorisation. That is the second opinion ADR-0041 forbids, produced by two env files rather than two implementations. The script served no student page and no secure control, so the frame could nowhere mount; it builds both now and waits for each. The Fill Agent presented its certificate under `x-aas-service` and the Secure Service read `x-service-cert`; every in-process test that put the two together had added the right header in a fetch wrapper by hand, so the two real processes had never once authorised a use. Taking the wrapper out of one suite turned eight tests red; one named constant is now read and written at every hop. Under `tsx`, the launcher the runbook uses, the runner threw `__name is not defined` on its first challenge read, because the account-creation and sign-in paths open their contexts through a door P80's shim did not cover; a probe run under the real launcher was red, then green. And the Secure Service and the Fill Agent each made their own random local master key, so after the use was authorised and the handle spent the agent could not open the envelope: `secret_unavailable`, the password never typed, the account never made. Both processes now read the same 64 hex characters, generated once by the script and refused in production, where KMS does this.

Two things around the edges. The P120 test's port range collided with two other suites when the whole census runs at once, and the two secure-plane e2e suites sat inside the range the new journey first took; both stack tests moved to ranges nothing else listens on. And the journey showed what a failed account creation does: the run is re-claimed about twice a second once the secret is spent, refused `already_spent` each time, and can never succeed from there. Nothing caps it and nothing asks the student again. Recorded as blocker 26, for Vahid's decision, not fixed here.

What this changes about the distance is nothing by count: item 9 was already done, and nine of ten remain open. What it changes about the evidence is that the runbook's five processes have now taken one application from a conversation to a filled, unsubmitted form with a password that touched two wires and no log — with the same code the Sheffield variant would run.

## Declared-but-unreachable surface

**Four** — unchanged.

# P120 — one machine, five processes, and a port that was never opened

Item 9 of the distance list was mine, so it went first: one script that stands the five deployables up on a machine against a Postgres and a Redis the operator already runs, creates and migrates both databases, starts each process with exactly its own environment, waits until each answers where it should, and stops them cleanly. A test runs it against the fixture catalogue and checks every endpoint, so the runbook is proved rather than described; the Sheffield variant is the same script with a reviewed entry's directory, run from a machine that can reach the portal.

Writing it found something the tests had hidden. The runner's entry point declares a CDP endpoint to the Fill Agent, the agent dials it whenever a student's password is to be typed, and every test that had ever driven a runner injected a browser launched with a remote-debugging port. The entry point's own launch opened none. From the deployable as it would actually start, the first credential fill would have dialled an endpoint nothing served. The browser now listens at the host and port the URL names, a URL with no port is refused at startup, and a test starts the real entry point and asks the endpoint for its version, red before the fix and green after. Nine of the ten items stand; the declared-but-unreachable surface is four.

## Declared-but-unreachable surface

**Four** — unchanged.

# P119 — how far it is, written down

He asked two things of every report from here: the declared-but-unreachable number, which had dropped out of several, and the distance to an end-to-end run against a reviewed Sheffield entry, not the whole blocker list, because he had lost track of how close it was and would rather know than assume. The second is its own piece of work, and it was read from the repository rather than from memory.

The answer is ten items for the fill run, in the order they bite, in a file that is kept current from now on. The first is one that nothing else can precede: on five of the eleven pages the captured labels are placeholders, so which fields Sheffield marks mandatory was never read, and a run today would save those pages empty. The second is that the employment page blocks the plan outright, four required fields with no profile field to map, and the route out is his to choose. Then the nationality and language pages, unmapped; the education page's own fields, one of which cannot be mapped by rule at all, raised as blocker 25; the review; a robots file never read; the account and how a run enters it; a local-stack runbook that is mine to write; and Part 2, unread. What is not on the path is said too, with why: Bedrock, the vault's bucket, the policy document, the AskiMate integration. The declared-but-unreachable surface is four, and both numbers now travel with every report.

## Declared-but-unreachable surface

**Four** — unchanged.

# P118 — name the value

He read the select behind the institution box, and its one option carried the same value the dropdown had shown. The layer hypothesis was out, which meant the earlier copy had been from a different box and he had sent the wrong one twice. He asked for that to be recorded as his error and not as the portal's instability, and it is. Then he took the decision back off hold in his own words: name the value. The two entries that read *Sheffield International College* are distinguishable only by it.

His two conditions are built exactly as he set them. The mapping names the value the form submits, and the reviewer records, on the typeahead field itself, the text each value reads as; the runner types that text and chooses the one entry that reads it and carries the value, so neither alone finds anything and two entries that read the same are told apart. The preview shows the student the text, never the code. His question about the escape changed the guard's shape: on this form the escape's value is its own label, not a clean sentinel, so the guard is on value, refused at review for any constant or option target equal to it and refused by the runner before anything is typed. The open case from P102, the escape chosen when the text names it, is closed on a fixture whose escape has the harder shape. The Sheffield draft records the institution box's eleven entries and its escape, and no mapping to it is signed, because a student's institution is free text and the rule requires an option rule onto recorded entries, which is the reviewer's to write.

## Declared-but-unreachable surface

**Four** — unchanged.

# P117 — the codes moved, and the decision is held

He read the institution dropdown with the values beside each entry, and the question that had been waiting was answered: the two entries that read *Sheffield International College* carry different values, so a rule that names the value could tell them apart and a rule that names the text could not. Then he compared it with a copy he had taken from the same box two days earlier, same country, same typed text, and every value was different while the order and the text were identical. He offered two explanations, a mislabelled copy from a different box or a lookup that returns different identifiers at different times, and chose neither.

He then did the thing this project keeps asking for and withdrew his own argument. He had argued for naming the value because values outlast text; on this evidence he could not say that, because the one thing he had observed was a value that did not outlast two days. The decision is held, in his words, and nothing in the draft names either box, so nothing waits on it. One fact from the repository: the earlier copy never arrived here, so nothing recorded is contradicted, and the record cannot examine the copy that would settle it. He asked whether there is a better way than waiting a day. There is one to do before it, not instead of it: read the same entry from three layers in one sitting, the dropdown's value, the value the form actually posts through its select, and the search response, so that a difference between layers is separated from a difference over time, and the day-later read answers one question instead of two.

## Declared-but-unreachable surface

**Four** — unchanged.

# P116 — two boxes, and a seam that is the postcode's own

He ran the same comparison on the contact page. Ten fields came back exactly as typed, the e-mail not lower-cased because he had typed it lower, the postcode not upper-cased because he had typed it lower. The portal stores a postcode as entered, and he noted why that is worth knowing on its own: nothing downstream should expect Sheffield to canonicalise one. Nothing built does, and the read-back compares what was typed, so this is the good case.

The postcode also settled a question the capture had left open. Both postcode boxes came back, so the field is genuinely two boxes of four characters, and the draft's mapping that typed the whole postcode into the first was wrong. It is corrected with a rule the vocabulary did not have, one half of a UK postcode, and his instruction is its whole design: the two halves are not both three characters in general, his happen to be, so the split is at the postcode's own seam, the inward code always the last three characters and the outward code the rest, never a fixed three and three. A value that is not a UK postcode is refused rather than split at a guess, and for a non-UK address the two boxes are hidden by the country and neither filled nor a blocker. His two passing observations were checked against the capture rather than his word, as he asked: the confirm box and the telephone box are there under the names the draft uses.

## Declared-but-unreachable surface

**Four** — unchanged.

# P115 — nothing normalised, on one page

He ran the comparison on the personal page and reported shape, not content: six fields came back, the two free-text ones as typed, the four selects as their option values, no whitespace gained or lost, no case changed. That is what the runner's read-back would find on this page, so the first way of seeing works as built here, and no vocabulary gap comes out of it. His classification of the selects is right for the comparison the runner makes: it compares against the option value it chose, so a code or a month name matches by construction, and only free text can be normalised.

The contact page is still wanted, for two free-text fields. The UK postcode is the likeliest thing on the form to be upper-cased or re-spaced, and the draft currently types it as one value into what the capture read as two boxes of four characters, which the read-back will settle either way. And the e-mail is asked twice and could be lower-cased. Same comparison, same rule: which fields differ and how, never the values.

## Declared-but-unreachable surface

**Four** — unchanged.

# P114 — a filled form, and what a filled form cannot say

He saved the personal page, reopened it by URL, and every field he filled was there. That is the precondition of ADR-0106's first way of seeing, met on this portal: a page filled once can be reopened and read back, and nothing on the blueprint has to say so. He kept his limit in view, that he looked at a filled form and did not compare field by field, and offered to run whatever would settle the difference if it matters.

It matters, and the reason is in how the read-back works. The runner does not look at a filled form; it records what it typed as a redacted shape and requires the value read back to match that shape exactly. A value the portal stores differently from what was typed reads as not kept, and the page reads uncertain, every run, until the blueprint can say what the portal is expected to store, which it cannot yet. A filled form cannot tell an exact echo from a normalised one; a comparison can. So the record asks for one comparison, field by field, reporting only which fields differ and the kind of difference and never the values, which are personal data on a real account.

## Declared-but-unreachable surface

**Four** — unchanged.

# P113 — a count in the page's own words

He read the summary page with two qualifications saved. Each entry is an h5 reading exactly *Previous Education N*, with no class and no id, inside two wrapper divs that every section on the page shares, one of them misspelled on the page and kept as written. He asked whether a text-shaped locator is acceptable here, since P82 removed a text-shaped heuristic once, or whether something structural is wanted.

Text-shaped is acceptable and is the right shape. P82 removed an unreviewed guess in a tool, a substring on the word *code* that decided what a field was; this is a locator a reviewer names in the page's own words and signs into a hash-bound blueprint, and the label strategy has been text from the start. Structure would count the wrong thing, as he said himself: the wrappers are every section's. What matters is that the match is exact to the number and never a substring, and the vocabulary already says it, because the css strategy is Playwright's selector engine and its anchored text-match does exactly that. The draft names the listing that way, and a runner test on a fixture built to his reading proves the locator counts two entries where structure counts four sections and a substring counts three headings. Employment's listing is its own read, when that page is mapped at all; the mechanism is already general and nothing is built differently on the answer.

## Declared-but-unreachable surface

**Four** — unchanged.

# P112 — five slots on a path our students do not take

He read the function that governs the nationality uploads, and the contradiction from P111 dissolved into something more useful than a pairing. All five file inputs are in the DOM and all five are hidden, each shown only on a claim of UK status — a British passport, indefinite leave, a UK spouse, refugee status — and with nationality and residence set to Iran none appeared. The passport slot on that page is for a British passport holder proving fee status, not for an international student's passport scan. The draft had carried the five as ordinary slots, and one earlier note spoke of the slots the runner attaches to on that page as if a run would. Nothing was ever mapped to them, so no plan attached to one, but the description was wrong and would have gone to Iman as a path to review.

It is corrected from the function's own reads, not from the names: four file inputs carry the condition that shows them, and the draft test asserts they are hidden in a plan for an international student, that nothing is mapped to any of the five, and that no upload or blocker names one. The fifth is shown on one radio or another, a disjunction the condition vocabulary cannot say, so it carries no condition and the gap is written down rather than bent into an *equals*. His second finding — that Sheffield's own handlers name ids absent from the document in that state, and that the function's container names differ from the input names — is recorded as his and not concluded from. He asked whether reading the shown state without saving would be enough, since the read means claiming a British passport on a real form. It would be, and it is not needed: nothing built depends on the answer.

## Declared-but-unreachable surface

**Four** — unchanged.

# P111 — a handler that names what is not there

He read the five nationality file inputs' handlers. Each one, on change, ticks an element by id — the slot's own name with *UploadRadio* after it — which is the construction-level evidence the pairing rule asks for. And then the contradiction, which he reported rather than resolved: no radio on the page carried any such id. He offered a guess, marked it as a guess, and stopped, because going further would have been guessing about the portal's rendering rather than reading it.

The record does the same. The five handlers are in it verbatim, and the five companions are not in the draft, for two reasons. The step from the id to a group is, as read, name similarity, which is the step his rule forbids. And a handler that calls `getElementById` on an id the document does not hold throws, so if the DOM he read is the DOM at the moment a file is chosen, attaching a file on this page ticks nothing, and the sentence in the capture notes that says the page does the second act itself on sixteen of seventeen slots is false for these five. That would not break the design, since the runner sets the companion by name and value and reads it back so that the page's script is relied on for nothing, but the record should say which it is, and today it cannot. Four read-only console steps that settle it are in the README, with what each outcome means.

## Declared-but-unreachable surface

**Four** — unchanged.

# P110 — three pages of radios, and a "yes" the runner read as a tick

He ran the snippet on personal, contact and nationality, and every radio group on the three pages now carries the value the portal submits. The reading was mostly a records task, until one of its facts met the runner: the twelve yes-or-no groups on nationality submit *yes* and *no* in lower case, and the runner, told *yes*, did not look for the option whose value is *yes*. It read the word as a boolean and ticked whichever member of the group its locator found first. On a fixture group built to that shape, with *no* first, it ticked *no* and the read-back said so. The value is now tried first, always, in the portal's case, and the boolean shortcut survives only for a lone radio.

The four things he flagged are recorded rather than absorbed. The case of *yes* and *no* differs by page on the same form, so nothing normalises, and the draft test pins both cases as read. Three of the five nationality *not providing* options are two claims in one — an intent and a fact about what the student has — which makes the reason for never choosing them stronger, not weaker. No nationality companion offers *NotRequired*, one more reason the token is nobody's vocabulary. And on contact, the value *After* is shown as *From this date:* and *Before* as *To this date:*, which a reviewer reading values alone would invert; the draft carries both and the review pack says which to read.

The five nationality slots still have no companion. Their groups' values are known, but which group accompanies which file input is not, and the rule is to pair from the markup. He offered to read the file inputs' handlers, and the snippet for that is in the README.

## Declared-but-unreachable surface

**Four** — unchanged.

# P109 — the language page's radios, and a token that means three things

He read the language page the same way: the certificate group offers the same four values as education, and the yes-or-no about previous English-medium education submits *Yes* and *No*. The draft carries both. He gave two caveats on his own method and both are honoured: the label strings his selector returned were a parent's text repeated, so none of them is recorded as the page's words, and the labels beside the values are the capture's per-option read from two days earlier, joined by the meaning of the value token — the test says exactly that. He offered to get the exact wording properly if told what to run, and a read-only console snippet is in the README for it, which also settles the twenty-three groups on three other pages that still carry the capture's element ids.

The thing worth keeping from this reading is his observation: *NotRequired* has now meant three different things on the same form — a claim about the document, a claim about what Sheffield needs, and a claim about who the applicant is. The token is the page's, not a vocabulary, and nothing built may act on it. The draft test now asserts that no companion on any page and no mapping names it.

## Declared-but-unreachable surface

**Four** — unchanged.

# P108 — the six radios, read; the fourth value, never ours

He read the Documentary Evidence radios from the live page: six groups, the DOM's six, and every one offers the same four submitted values. The draft now names the attach, defer and not-providing values on all six companions from his reading, and the text beside each option as he gave it. What the capture had held for those radios were element ids, which the runner would have matched against nothing, so this reading was not a refinement but the first usable values for the group.

Three things he asked to be handled rather than absorbed. The fourth value, *NotRequired*, is on the translation groups a claim about the document — *My certificate is in English* — and on the others a claim about what Sheffield needs, and on two of them nothing at all. We never choose it. That was checked rather than assumed: a mapping of it on a companion is refused, the plan names only the attach or the defer value, and no plan from the draft mentions it. One trap was found on the way and closed with a test that failed first: a companion marked required on a repeating page raised a blocker the deferral had already answered, and the only thing that blocker invites is the mapping the rules refuse. Second, `certificateStatus` says *proof of registration*, not *certificate*: the pairing in the draft rests on the file input's own handler, not the shared name, but what the slot is has not been read from the page, so it is flagged for Iman and asserted nowhere. Third, the two options with no text are recorded with no text, and the record says why that is fine — because the option is chosen by nothing, not because there is nothing to say.

## Declared-but-unreachable surface

**Four** — unchanged.

# P107 — what the student owes is a record, not a mention

He took the floor and refused the reminder, and both for reasons that are now in the ADR. The
record first: a student who authorised *later* has an obligation this system created on their
behalf, and a sentence in a message that scrolls away is a mention of it, not a record. So the
case carries it. With the yes, one event per document slot left to the student, per entry, from
the preview they authorised — the thing the hash binds — with what the portal was told beside
it. The student's word closes one, through a decision that carries a key and no hash, answered
before the run's situation is asked so that it works after the handover and the account being
theirs; a key the case never recorded is refused. The run reads the list out, the student's page
lists it with a button per open item, and a specialist reading the run sees the same record.

The reminder is out on its own terms and not because of the channel: a message to a student
after the conversation has closed is a different product surface with its own consent,
deliverability, failure modes and ways of being ignored, and a reminder that fails silently
leaves the student worse off than none, because someone has been implied to be watching. So the
record says plainly that nobody is. That sentence is in the preview before the yes, in the
handover — which no longer calls an application with something owed complete — and on the
student's page as the heading over what they still owe. He asked for it to be uncomfortable to
read, and said that if the honest version makes the product look worse, that is the product.

## Declared-but-unreachable surface

**Four** — unchanged.

# P106 — a handed slot's companion says "later", and the line it must never cross

He decided blocker 23 with a sentence and asked for the sentence to be the reasoning: *I will
upload this later* is not a claim about the document, it is a statement about when. Nothing is
being sent in this act, and that is true, and it is the only option of the three that is true.
The line the option must never cross is the one the build now enforces: *later* is ours to say;
*I will not be providing this* is a claim about the student's intent and never ours, on any
portal. So the blueprint names both values on a slot's companion, the parser refuses them
being one, the usable-set check refuses any mapping on a companion and says why in his words
when the value is the refusal-style one, and a handed slot on a portal that offers nothing
between *now* and *not providing* is admitted only where the page waits for the student —
nothing on it filled by the plan — and refused otherwise, naming what would have been filled.

ADR-0105's companion half is withdrawn by this: the student attaches, and we say when. The plan
sets the companion once per entry as a reviewed constant whose rationale is his reason, marked
as the slot's deferral; the runner fills it as any constant and ADR-0106 reads it back. His
first condition is in the preview, under each entry, in the student's words rather than ours:
we are telling Gated University that your Certificate is coming later; you attach it yourself;
the application is not complete until you do. The defer value is inside the hash, so a
different thing said beside the slot is a different thing to say yes to. The handover says it
beside each document too. The fixture portal now drops an unanswered save silently, as
Sheffield does, and the journey saves two qualifications with *later* on each.

His second condition — that the deferred state must not be quietly forgotten — is not folded
in. What exists is one sentence at the handover, recorded; what does not exist is any record of
the items, any incomplete state, any way to check, and any way to reach the student afterwards.
That is blocker 24, with three options priced, and it is his to decide.

## Declared-but-unreachable surface

**Four** — unchanged.

# P105 — a page is saved when the portal shows it; the three read-backs, built

He accepted the price and said build it in the order set, and it is built the way the sheet
priced it. After the advance press the runner no longer says saved because it pressed. A page
filled once is reopened and every field it filled is read back through the locators already
reviewed, compared on the redacted shape the executor recorded at the fill, so a value the
portal changed is a value it did not keep and nothing is held in the clear. A page filled per
item is counted on its listing, before the fill and after the save, because the new-entry form
opens empty by design; the blueprint names the listing, and the claim rebases it onto the
deployed origin as it does the form — found when the journey refused its own listing as another
host. A slot the runner attached to must show the marker the blueprint names for a held file,
because a file input reads back empty by HTML's rule. Anything not seen is uncertain under a new
failure code, no transmission is recorded for it, and the wire refuses a transmission beside it.
Eight tests failed before the fix and pass after; the older test that reported a transmission
on a slot with no marker now names the marker and sees it, which is the change in one line.

The fixture portal grew the three shapes so the journey could walk them rather than fake them:
its pages re-render what they hold, its education page lists what was saved, its documents page
shows the held file. The journey passes end to end through the real runner.

His repeat of the failed save settled the cause — the unanswered radios — and he asked for the
consequence to be made explicit rather than left to be noticed: ADR-0105 as built hands the
radio to the student with its slot, and on this page that is the state that does not save. So
under ADR-0106 every qualification on Sheffield reads uncertain until that is decided, and it is
put up as blocker 23 with the options priced — the runner answering the radio with a reviewer-
named statement about when, or the whole page handed to the student — and not decided in the
same breath, as he asked.

## Declared-but-unreachable surface

**Four** — unchanged.

# P104 — blocker 22 met on the real portal, and what its cure costs

The gap P103 found in the code happened to him the same day, and it was worse than the shape I
had proposed for it. He saved a second qualification with two of the evidence radios unanswered
and got no error, no complaint, and a summary page listing one qualification. The entry was
dropped without a word. An error locator would have found nothing and passed; a landing URL
would have matched and passed. His correction is the right one and it is now the shape of the
blocker: the signal is not on the page that was saved, it is that the thing exists afterwards.
A page is reported saved when the portal shows the thing, named on the blueprint where a
reviewer can see how, and uncertain where nobody can — and uncertain is a specialist's problem
rather than a silent success.

He asked what that costs before it is built, and the sheet answers against what already exists
rather than against nothing. The uncertain outcome is built end to end: the ledger leaves the
intent open, the next claim stops on it, a person resumes or abandons, and no transmission is
written for an uncertain page. So the rule itself costs no machinery; it costs a person's look
per page nobody could verify. What makes that number small is a read-back that costs the
reviewer nothing — reopen the page and read its own fields back, which holds on most
server-rendered forms — leaving the reviewer to name, once per portal, a listing to count for a
repeating page and a marker for each slot the runner attaches to. On a portal that offers
nothing to read, every page is a look, nine on Sheffield, and that is the honest price of not
writing transmission records for files the portal dropped. Three phases, each fails first,
none touching the gates. Why his save failed is not known, two radios is his guess and he says
so, and two specific observations would settle it rather than a third guess.

## Declared-but-unreachable surface

**Four** — unchanged.

# P103 — the education page after a save: a condition closed, and a save that is only pressed

He saved one qualification, came back to *Your Details*, typed the new-entry URL into the
address bar and got an empty form. That is the condition P99 set and P98's shape rested on, met
and closed in his words, and the draft does not change: the repeating page is reached by its
own URL per item, with no *add another* control to press on another page. He added the caveat
himself — one observation, not a property shown at every count — and it turns out the built
shape does lean on it at every count. Each item is its own piece of work at the page's URL, the
runner fills and presses save and reports the item done, and it reads nothing back. If a later
opening of that URL ever showed the previous entry, the runner would type over it and save it
again, and the portal would hold one qualification where the run reported two. One more
observation closes that: a second save, a third opening, and *Your Details* listing two.

The radios beside the slots take *later* and *not providing* without a file, so a
qualification saves with no document attached — which is what option B needs, and he says so.
What his save could not show is whether the page saves with a radio left unanswered, because
he answered all four. That bears directly on ADR-0105, where the runner sets neither the slot
nor its companion and leaves both to the student: if the form will not save without an answer,
the runner cannot save the page at all under that shape, and the ADR has a sequencing question
to answer rather than a rule to bend.

The third observation looked like the smallest and was the largest. The save took him to *Your
Details*; the runner does not care where a save lands, since each item is reached by URL. But
following that through the code showed what it does after the press: nothing. The click
resolves when the control is pressed, the page is reported succeeded, and the transmissions
are joined to it. A save the portal refused on the same page — a required radio unanswered,
say — is reported as saved, which is exactly the outcome the code's own comment says must not
happen. Raised as blocker 22 with a proposal, and not built: what a saved page looks like is
the reviewer's vocabulary on the blueprint, and its shape is his to decide.

## Declared-but-unreachable surface

**Four** — unchanged.

# P102 — the institution box, observed: a typeahead whose entries follow another field

He watched the institution box load and sent what it does: a GET per keystroke, carrying the
typed text and the chosen country; eleven entries for *Sheff*, one of them twice; *Not in list*
at the end. The first of these is a dependency the built shape could not say. `optionsAfter`
was written for lists — a select whose options arrive after another field — and the usable-set
check refused it on a typeahead as a field that offers no options to wait for; had it been
admitted, the execution would have waited on the text box as though it were a list, which the
runner refuses. The fix is small and was found the honest way: the observed shape went into
the fixture first — the course search now takes a level, and offers nothing without one — the
mapping and orchestrator tests failed on it, and then the check admits a typeahead's entries as
following the earlier field, the order rules and the press apply to it as to any other, and its
wait is its own, bounded, at the fill. The journey walks it end to end. The Sheffield draft now
says the institution box follows the country box.

The second is a fixture becoming a fact. P95 refuses when more than one entry reads the text,
and P97 held that in a fixture with *Ireland* twice; *Sheffield International College* twice is
the same refusal arriving on the first real form, and it is right: nothing visible tells the two
apart, so choosing either would be a guess. He notes, correctly, that it strengthens the case
for a mapping naming the submitted value, and he is not deciding until the copied markup shows
what those two entries carry.

The third is a requirement he typed and a gap proven. *Not in list* is an escape, not an
institution, and today nothing in the runner tells it from one: a text that reads so chooses
it, and the fixture holds that as an open finding. The guard that fits is the reviewer naming
the escape on the blueprint, as the press is named — not a guess at the wording, which is the
rule P82 removed. It waits, deliberately, on the value-versus-text decision, so that it is
built once against whichever the mapping names.

## Declared-but-unreachable surface

**Four** — unchanged.

# P101 — the Tom Select entry locator, confirmed from what he copied; text, not value

He sent the country box's dropdown markup from the live page, with its shape spelled out so the
locator could be written from structure rather than from a paraphrase, and two questions with
it: does the runner match on the visible text or on the value the form submits, and does the
single-match rule depend on a class that changes with state. The second answers itself once the
locator names the list by its id and an entry by its role and selectable mark, which is what the
draft now does for each box on its own — the old class-based default would have counted both
boxes' entries together, since a closed dropdown stays in the document. The first is answered in
the code and then proven rather than asserted: the fixture's entries now carry his shape, a
`data-value` that is not the text, and the runner chooses *United Kingdom* by reading it, leaves
`UNITED KINGDOM` and `IRAN` unchosen, and matches the long Myanmar label when that is the text.

What the mapping should name is the question that remains, and it is his. Today it names the
text, because that is the one string the runner types and matches and the student reads in the
preview. His expectation — name the submitted value, find by text — is the rule selects and
radios already follow, and the captured select already holds the value-to-label table it needs,
so it is buildable and would make the match stronger, not weaker. It is recorded as a proposal
and not built. Nothing waits on it: no mapping to either box is signed. The institution box is
the same widget; what one more copy would settle is how its list loads.

## Declared-but-unreachable surface

**Four** — unchanged.

# P100 — ADR-0105: a slot's companion handed with its slot; a list's options loaded by a press

Both proposals from his live read came back decided the same day, with the reasoning he wants
the record to carry. The companion first: a student whose transcript is in English is not
attaching something, they are answering the question the slot asks, and a rule that stopped them
saying so would make the education page unfillable for a whole class of applicant — the rule
defeating the purpose option B was chosen for, the same shape as the twelve-checkbox cover in
ADR-0102. So a slot's own companion may be handed to the student with that slot, and nothing else
may: not a licence to hand over any radio on a repeating page. It crosses to the runner with the
slot, the preview says *You answer yourself* under the entry beside *You attach yourself*, and
the handover names it as answered with the document itself.

The press second, with the constraint he wanted enforced and not assumed: the control named must
load options, and pressing it must not be able to advance, save or submit. The guard on the
typeahead entry — a submission-looking name is refused at the click — guards the press the same
way, and two more stand beside it: the mapping boundary refuses a press that is any page's
advance control, add-another or the submission control, and the runner reads the page's URL
before and after and fails the page as drift if the press left it. He asked to be told before
building if the guard could not do it, and the limit is written where it belongs: a control that
saves without navigating and without a save-like name cannot be told from a lookup by the
runner; naming the control is the reviewer's act, from the dependencies read, and those three
checks are what stands between a wrong naming and a saved page.

Sheffield's subject is now a search-then-select the plan can walk — type, press, wait, choose —
and its six status radios go to the student with their slots. The four-versus-six slots, the
asterisks and the *in English* wording stay his report, for the re-read he will make.

## Declared-but-unreachable surface

**Four** — unchanged.
