# Where we are

> ## ⚠️ Superseded below — this section is the state as of 2026-08-26
>
> **Updated 2026-09-01 (P10).** Everything from the headline to "Since then" is
> the picture *before* P1–P10, and its numbers are long out of date — "620
> tests" is now 1715, and the state table below is missing four steps that have
> since been built and one that has since been found. The current state is at
> the **end of this file**, under *Where we are — 2026-09-01*. This section is
> kept rather than
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
| 4 | Conversational interview | ✅ | A capability of AskiMate Chat (ADR-0015). |
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
- **Account hand-over is unreachable**, as above.
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
