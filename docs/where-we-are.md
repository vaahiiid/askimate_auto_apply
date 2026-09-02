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
  no trace.** This is the finding of the phase and it is **open**. A runner
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
