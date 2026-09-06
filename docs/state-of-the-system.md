# State of the system — the standing account

**Version:** 0.53.0 · **Date:** 2026-09-06 · **Written for:** someone who knows the product and has
not read the code.

> **This document is the standing account, not a snapshot.** `where-we-are.md` is a per-phase
> journal that accretes; the CHANGELOG is per-version. This is the one place that is rewritten to
> stay true, and it is updated at the end of every phase. Where it disagrees with an older document,
> this one is right.

---

## 0 · The one-paragraph version

AAS takes a student who has explicitly decided to apply to a specific university course and carries
that application from conversation, through preparation, to a filled form on the real portal —
stopping before submission. Twenty-five packages and six applications, five of which are deployable
processes. **2,155 tests, 105 files, zero skipped**, against real PostgreSQL and Redis. Seventy
architecture decision records, sixty-six accepted. **£0 / $0 of the ~$1,000 AWS credit is spent —
nothing is provisioned and nothing is deployed.** The journey works end to end against a *replayed*
portal. It has never run against a real one, because that needs a real blueprint, a two-person
mapping review, Bedrock credentials and an account, and all four are with you.

---

## 1 · Every phase, in order

### Foundation — before the phase numbering (0.1.0 → 0.18.0, 2026-08-27 → 08-30)

| | What it did | Why |
|---|---|---|
| Phase 0 | Inventory of the existing AskiMate system, integration contract, repository structure, AWS bootstrap plan, and the first twenty-nine ADRs | Decide before building; nothing since has had to be undone at this layer |
| Phases 1–5 | The domain core (states, transitions, events, branded values), document extraction, field mapping, the fillable session, validation/preview/authorisation, and the orchestrator with a replay harness | The product's actual logic, built pure and I/O-free so it could be tested without infrastructure |
| `0.1.0` | The first versioned state — one version across every manifest, and a changelog that does not invent history | Eighteen manifests said `0.0.0`; there was no way to say what "this build" meant |
| `0.2.0` | `PostgresCaseStore`, passing the same contract suite as the in-memory one; versioned migrations with checksums | A case now survives the process that created it — in-memory blocks the second run, not the first |
| `0.2.1` | A safety claim that was wrong, and the enforcement that made it true | The first of many: a stated guarantee measured and found not to hold |
| `0.3.0`–`0.6.0` | Durable execution in four steps: the run model, the `WorkflowRunStore`, orchestrator checkpointing, and "a consequential action happens at most once — or we admit we cannot tell" | A crash mid-application must not create a second account or a second submission |
| `0.7.0`–`0.11.0` | The inline secure turn, phases A–D: the password request takes its place in the conversation, the composer stays live, the React secure control, and one client rather than two diverging ones | A student typing a password must not leave the conversation, and the guard must not fail open |
| `0.12.0`–`0.12.1` | Contract-first OpenAPI for both services, checked against the code; then migrations for the independent product | The wire contract is a reviewed artefact, not a description written afterwards |
| `0.13.0` | `packages/conversation` becomes the single domain authority | Two implementations of the same conversation decision had drifted |
| `0.14.0`–`0.16.0` | The Conversation Service exists; the browser talks to it; a real browser types a real credential into a real cross-origin Secure Plane | The two-origin design stops being a diagram |
| `0.17.0` | Seven coverage gaps closed — which found two real defects | Coverage claimed is not coverage held |
| `0.18.0` | The runner no longer holds a password: the Fill Agent consumes the credential inside the Secure Plane (ADR-0042) | The component that loads pages we do not control is the most likely thing to be compromised |

### The numbered phases (P1 → P34, 2026-08-31 → 09-06)

| Phase | What it did | Why |
|---|---|---|
| **P1** | A student conversation creates and owns a durable run | Until this, a run had no identity a conversation could refer to |
| **P2** | A controlled fixture portal that actually requires an account | The first portal in the repo that behaves like a real one |
| **P3** | Two blockers resolved by decision rather than by working around them | Working around a blocker is how a system acquires a second truth |
| **P4** | The Conversation Service becomes the first production caller of the Secure Interaction Service | The secure step opens from the run, not from a test |
| **P5** | The Automation Runner claims leased work — it pulls, nothing calls in (ADR-0045) | The browser process gets exactly one inbound port, and it is CDP |
| **P6** | A real account created on a portal, with a password nobody in the system can read | The end of the credential design, proved by asking the portal to log the student in |
| **P7** | The first real end-to-end journey: a student asks, and ends up with an account | Four planes and two databases in one run |
| **P8** | The runner fills the application form; the plan crosses as value + provenance (ADR-0046) | A branded `ConfirmedValue` cannot survive a wire, so it is reassembled through the one mint |
| **P9** | Durable multi-page execution; page progress lives in the intent ledger (ADR-0047) | A lease must name the page it holds, or a retry refills the wrong one |
| **P10** | A run that stops says so and can be picked up; the intervention record (ADR-0048) | A stopped run that nobody can see is a stranded student |
| **P11** | The run driver drives the case state machine; a student's authorisation is captured through it (ADR-0049) | Two models of a case, joined by a moving join rather than a shared id |
| **P12** | The account lifecycle completes through the student's own decision; a case can conclude (ADR-0050) | Handover is the student's act, and a case that cannot end is a leak |
| **P13** | The student answers in the conversation; a correction can reach the portal (ADR-0051) | The interview stops being a demo script |
| **P14** | A background worker owns autonomous progression (ADR-0052) | The system must act when nobody is watching |
| **P15** | A student can stop: cancellation is reachable and does not strand the account (ADR-0053) | The first reachable terminal state |
| **P16** | The Automation Runner's supervisor — competing claims, lapsing leases, real concurrency | Decided by PostgreSQL, so a fake proves none of it |
| **P17** | The intent is durable *before* the action, not after (ADR-0054) | ADR-0045 §4 claimed a crash was detectable when it was not |
| **P18** | A process refuses to start when it is not safe (ADR-0055); the five-deployable map | Startup is where a misconfiguration becomes a security property |
| **P19** | Identity delegated to a real OIDC provider; verification established at login (ADR-0056) | ADR-0038 described a guard nothing implemented |
| **P20** | The catalogue loads a reviewed artefact and can prove that is what it loaded (ADR-0057) | An approval must bind to content, not to what the content says about itself |
| **P21** | A case opens from an offer the student accepted, not an identifier they sent (ADR-0058) | An id is not something a student can consent to |
| **P22** | The student can read what they are authorising (ADR-0059) | Measured: only the test suite could complete an authorisation |
| **P23** | The journey is startable and readable over published routes (ADR-0060) | A client must never become a second source of workflow truth |
| **P24** | The run says what it is waiting for, and the hash that decision must carry (ADR-0061) | One of the four student decisions could not be formed by any client |
| **P25** | The student client, in the service that serves its origin | ADR-0039 answered this for services and left it open for the client |
| **P26** | The interview's *question* reaches the student, in the log (ADR-0062) | ADR-0051 gave the answer a home and left the question homeless |
| **P27** | The published contract is checked against the real Express router (ADR-0063) | Six discrepancies had accumulated because the guard read enums and never `paths` |
| **P28** | The interview's decision to stop reaches the system (ADR-0064) | A student who refused three readings stranded the run for ever |
| **P29** | A run only a person can carry on stops, and says so (ADR-0065) | The driver discarded the orchestrator's hand-over wherever it was raised |
| **P30** | Three declarations name a document; one decides — the reviewed mapping (ADR-0066) | Measured in both directions; the other two are inert and now structurally barred from the planning path |
| **P31** | AAS obtains documents; what blocks it is policy, not design (ADR-0067) | P30 had recorded this as an open product question. It was decided in ADR-0010/0016/0022 and already implemented |
| **P32** | The storage boundary refuses what ADR-0022 says it refuses (ADR-0068) | The gate was a helper an implementation was trusted to call; it is now the only thing `store` accepts |
| **P33** | The document transport boundary, costed — no ADR, because no decision was made | Turning a question into a decision with two costed answers is the correct outcome; writing an ADR would record a decision nobody made |
| **P34** | An authorisation is spendable only in the application it names (ADR-0069) | `DisclosureSubject.caseId` had recorded the application since Phase 1 and nothing ever compared it |
| **P35** | `BlueprintPage.requiredDocuments[].documentRef` → `fieldRef` (ADR-0070) | Two layers shared one name, and the repository contained both readings of it. Free today; costs every catalogue approval once one exists |

---

## 2 · The architecture as actually built

### Five deployable processes

```
                    ┌──────────────────────────────────────────────┐
   browser ────────▶│  1. Conversation Service    (Conversation)   │──▶ conversation DB
   (student)        │     student surface, routes, run driver      │
                    └──────────────┬───────────────────────────────┘
                                   │ internal API (mTLS)
                    ┌──────────────▼───────────────────────────────┐
   browser ────────▶│  2. Secure Interaction Service    (Secure)   │──▶ secure DB
   (iframe, own     │     the ONLY service that sees a password    │──▶ Redis (ciphertext)
    origin)         └──────────────┬───────────────────────────────┘
                                   │ reads envelope from shared cache
                    ┌──────────────▼───────────────────────────────┐
                    │  3. Fill Agent                    (Secure)   │
                    │     decrypts locally, types over CDP         │
                    └──────────────┬───────────────────────────────┘
                                   │ CDP — the runner's ONLY inbound port
                    ┌──────────────▼───────────────────────────────┐
                    │  4. Automation Runner             (Browser)  │
                    │     NO database · NO vault · NO cache        │
                    └──────────────────────────────────────────────┘
                    ┌──────────────────────────────────────────────┐
                    │  5. Background Worker        (Conversation)  │──▶ conversation DB
                    │     listens on NOTHING                       │
                    └──────────────────────────────────────────────┘
```

**Why it is exactly five.** Migrations are a *command mode* of the owning service
(`aas-conversation-service migrate`), not a sixth process — a separate migrator would need both
planes' credentials, which is the shape ADR-0037 exists to prevent. The worker does not drain the
Secure Plane's outbox; that service drains its own, because a worker that drained it would be the
one process whose compromise yields both databases.

**Two processes deliberately have no health endpoint.** The runner and the worker. A `/healthz` is
not a control API but it *is* an inbound surface, and it would be one on the two processes whose
whole design is that they have none.

### Where state lives

| State | Home | Notes |
|---|---|---|
| Conversation events | `conversations` / event log, PostgreSQL | Append-only, ADR-0031. Resumable SSE reads it (ADR-0035) |
| Case events | `case_events` (jsonb), PostgreSQL | The domain event log; state is `fold`ed, never stored |
| Runs, checkpoints | `workflow_runs` | Optimistic concurrency on `revision` |
| Consequential-action intents | `workflow_action_intents` | Written **before** the action (ADR-0054); page progress is derived from it (ADR-0047) |
| Interventions | `interventions` | What a specialist sees and adjudicates |
| Confirmed profile | `profile_entries` | Its own store; the event log stays a record of events (ADR-0044) |
| Work + worker leases | `work_leases`, `worker_leases` | Runner and worker claim by lease; PostgreSQL decides the race |
| Target offers | `target_offers` + the conversation log | Gate 2 verifies an `offerHash` against *this conversation's own* log |
| Secret requests | secure DB, separate | No column in that schema can hold a secret — asserted from `information_schema` after migrating |
| Encrypted credential envelope | Redis, ciphertext only | ≤5-minute TTL ceiling; `verify()` refuses a server whose config would let ciphertext reach disk |
| **Document bytes** | **Nowhere.** No `bytea`, no blob column, no bucket | The vault exists and is reachable from no deployable |

### The boundaries that are enforced structurally, not by convention

- **Branded types.** `ConfirmedValue` cannot be constructed from model output; `StorableUpload` can
  only be minted by `assertStorable`; `DisclosureAuthorisation` only by `authoriseDisclosure`;
  `ReviewedConstant` only from a `UsableMappingSet`. The signature answers "was this reviewed?".
- **`scripts/check-boundaries.ts`.** Import rules per package, plus specific bans: no request logger,
  APM agent or error reporter in the Secure Service (a **measured** reason — body-parser attaches the
  raw request body to a JSON parse error as `err.body`, and `JSON.stringify(err)` emits the password
  in full); no `step.kind ==` branching in the run driver; no `requiredDocuments` anywhere in the
  planning path.
- **Contract drift guard.** The published OpenAPI is checked against the real Express router.
- **Startup refusal.** A process exits non-zero rather than starting unsafely (ADR-0055).

---

## 3 · Every ADR, and whether it is still in force

**Seventy records. Sixty-six Accepted, four Proposed.** None is superseded outright; several are
amended, and the amendment is always a later ADR that says so.

| # | Decision | Status |
|---|---|---|
| 0001 | Integration via HTTPS API + signed webhooks | Proposed |
| 0002 | AAS is the system of record for the confirmed profile | Proposed |
| 0003 | Versioned migrations, not `drizzle-kit push --force` | Proposed |
| 0004 | Branded types make model output unable to reach a form field | Proposed |
| 0005 | Contract-first OpenAPI at the AskiMate↔AAS boundary | Accepted |
| 0006 | Re-application requires an explicit student instruction | Accepted |
| 0007 | Agent-led conversational intake — the student never fills in a form | Accepted |
| 0008 | Recovery-first escalation, and the learning loop | Accepted |
| 0009 | Requirements provenance and multi-source verification | Accepted |
| 0010 | Policy-driven document retention, with no default | Accepted |
| 0011 | Identity check, minor detection, and the minor workflow | Accepted · gate design superseded by 0013 |
| 0012 | AWS region — eu-west-2 (London) | Accepted |
| 0013 | Minor is not a blocker; minor conditions are stage-scoped | Accepted |
| 0014 | Discovery is structurally incapable of submitting | Accepted |
| 0015 | The interview is a capability of AskiMate Chat, not a new interface | Accepted · narrowed by 0051 |
| 0016 | An extracted value must quote the document, or it is discarded | Accepted |
| 0017 | Field mapping is reviewed data, and format rules are data too | Accepted · §1 amended by 0057 |
| 0018 | Amazon Bedrock is the model provider, and no model is named yet | Accepted |
| 0019 | A human specialist curates requirements, through the AskiMate knowledge workflow | Accepted |
| 0020 | The account belongs to the student, and control is handed back | Accepted |
| 0021 | University application requirements are not Student visa requirements | Accepted |
| 0022 | A document in the vault is not permission to send it | Accepted · corrected by 0067, made true by 0068, completed by 0069 |
| 0023 | Retention periods are determined from a source, or recorded as unresolved | Accepted |
| 0024 | Controlled Salesforce-rendering inspection, with four hard boundaries | Accepted |
| 0025 | A fill session is never traced, recorded, or asked to remember a value | Accepted |
| 0026 | A password the model can ask for and never see | Accepted |
| 0027 | One version for the whole repository | Accepted |
| 0028 | Versioning policy: what counts as a release | Accepted |
| 0029 | Git workflow, branches and releases | Accepted · §9 governs commit authorship |
| 0030 | The secure control runs on its own origin | Accepted |
| 0031 | One append-only conversation event log | Accepted |
| 0032 | Cancellation is its own lifecycle | Accepted |
| 0033 | Sessions are `HttpOnly` cookies | Accepted |
| 0034 | The vault is ephemeral, encrypted, shared by ciphertext | Accepted |
| 0035 | Event delivery is resumable SSE over the log | Accepted |
| 0036 | No third-party scripts on authenticated surfaces | Accepted |
| 0037 | Service topology, network boundaries, deployment | Accepted · table amended by 0052 |
| 0038 | Identity is delegated to a managed OIDC provider | Accepted · amended by 0056 |
| 0039 | Repository structure for the independent product | Accepted · client question settled by 0060 |
| 0040 | The wire contract is its own package | Accepted |
| 0041 | One implementation of each conversation decision | Accepted |
| 0042 | The credential is consumed inside the Secure Plane, not by the runner | Accepted |
| 0043 | A credential field is mapped to the Secure Plane, not to data | Accepted |
| 0044 | The confirmed profile has its own store | Accepted |
| 0045 | The Automation Runner pulls leased work; nothing calls into it | Accepted · §4 amended by 0054 |
| 0046 | A fill plan crosses as value and provenance, reassembled through the one mint | Accepted |
| 0047 | Page progress lives in the intent ledger; a lease names the page it holds | Accepted · §1 amended by 0051 |
| 0048 | A specialist resolution completes an intent | Accepted |
| 0049 | The run driver drives the case state machine | Accepted · three states removed by 0058; §5 completed by 0059 |
| 0050 | The account lifecycle completes through the student's own decision | Accepted |
| 0051 | The student answers in the conversation, and a correction can reach the portal | Accepted · completed by 0062 |
| 0052 | The system acts when nobody is watching | Accepted |
| 0053 | A student can stop | Accepted |
| 0054 | The intent is durable before the action, not after it | Accepted |
| 0055 | A process refuses to start when it is not safe | Accepted |
| 0056 | Verification is established at login, not re-read at every step | Accepted |
| 0057 | An approval binds to content, not to what the content says about itself | Accepted |
| 0058 | A case opens from an offer the student accepted | Accepted |
| 0059 | The student can read what they are authorising | Accepted |
| 0060 | The Conversation Service owns the student surface | Accepted |
| 0061 | The run says what it is waiting for | Accepted |
| 0062 | The question the run is waiting on is in the log | Accepted |
| 0063 | The published contract names the routes that exist | Accepted |
| 0064 | The interview's decision to stop reaches the system | Accepted · §2 corrected by 0065 |
| 0065 | A run only a person can carry on stops, and says so | Accepted · §6 corrected by 0066 |
| 0066 | Three declarations name a document, and one of them decides | Accepted · §6.1 answered by 0067 |
| 0067 | AAS obtains documents; what blocks it is policy, not design | Accepted |
| 0068 | The storage boundary refuses what ADR-0022 says it refuses | Accepted |
| 0069 | An authorisation is spendable only in the application it names | Accepted |
| 0070 | The portal's file field is called `fieldRef` | Accepted |

**On the four Proposed records (0001–0004):** they are the pre-implementation integration
proposals. 0003 and 0004 are in force *in practice* — versioned migrations and branded types are
both built and enforced — but they were never formally accepted, and 0001 and 0002 describe an
AskiMate↔AAS integration that has not been built because the production AskiMate source is not
accessible from here. **Worth a decision: accept 0003 and 0004, and re-examine 0001 and 0002 when
the integration is real.**

---

## 4 · Live · stubbed · declared-but-unreachable · not built

### ✅ Live and working (against fixtures and replays, with real PostgreSQL and Redis)

- The whole student journey: conversation → target offer → explicit request → case opens → interview
  → plan → validate → preview → authorise → account creation → multi-page fill → **stop before
  submission**.
- Real account creation on a fixture portal, proved by asking the portal whether the student's
  password logs them in.
- The two-origin secure credential path in a real browser, with every HTTP body on every wire
  scanned for the password.
- Durable runs across a genuine process restart; competing runner supervisors; lapsing leases.
- Read-only portal discovery, structurally incapable of submitting — **103 real runs executed**.
- OIDC login against a real local provider.
- The catalogue: content-hash-bound approvals, and processes that refuse to start on an unapproved
  entry.
- The transmission gate: five refusals, all tested, all reachable from the executor.

### 🟡 Built, but never run against anything real

- **Everything portal-facing.** The blueprint is a fixture; a real portal has never been filled.
- **The Bedrock adapter.** Complete, behind the LLM port. No credentials, and **no model chosen** —
  `pnpm run verify-bedrock` is written to read what an account can actually use rather than guess.

### ⚠️ Declared but unreachable — deliberately, and each for a stated reason

| Thing | Why it cannot be reached | Why it is kept |
|---|---|---|
| `packages/documents` — the vault, the full lifecycle, the validity engine, `purgeContents`, both storage gates | No transport exists by which a student can supply bytes (B4), and no deployable holds a vault | The constraint ships before the thing it constrains (ADR-0019). It refuses correctly today |
| `packages/extraction` — reading a document with grounded quotation | Same: nothing to read | Same |
| `packages/requirements` — provenance and the evidence bar | Nothing yet feeds it; requirements come from the reviewed catalogue | It is the shape ADR-0009 requires when a source exists |
| `attach_document` — a declared `ConsequentialAction`, `VERIFIABLE: true` | **Produced by nothing.** `WorkKind` is `create_account \| execute` | Deleting it would destroy the evidence of what was intended |
| The interview's `request_document` capability | `nextAction` asks fields before documents, and the orchestrator only enters the interview while a field is outstanding — mutually exclusive by construction | Same reason; asserted rather than deleted |
| `apps/chat-integration` | A **research build** against the archived AskiMate codebase (10 weeks stale). Explicitly not the production integration | It is the evidence that the secure channel is implementable on AskiMate's real stack shape, and the source of the measured `err.body` finding |

### ❌ Not built at all

- **Submission.** Out of scope by ADR-0014, and structural — the runner's click guard admits exactly
  the locators it is given, and it is never given a submit control.
- **Document transport**, in both halves: no route, no multipart parser, no upload UI, no object
  storage, no `documents` table. Blocked on B5.
- **Any AWS infrastructure.** No S3, no KMS key, no RDS, no ElastiCache, no compute. Nothing is
  deployed.
- **The real AskiMate integration.** Blocked on access to the production source.
- **An alerting transport** for interventions (email, Slack, anything). A specialist sees them
  through a CLI.
- **Any real student data path.** Fixtures and synthetic data only, by standing instruction.

---

## 5 · Deviations from the original brief, and why

| # | Deviation | Why |
|---|---|---|
| 1 | **"Submit the application" became "fill and stop before submission"** | ADR-0014. A system that can submit can submit by accident. Submission is deferred until a controlled live run exists, and the incapacity is structural rather than a flag |
| 2 | **The student never types a password into AAS's own origin** | ADR-0030/0042. A separate Secure Plane on its own origin, and a Fill Agent that types the credential into the runner's browser over CDP. The runner — the component most likely to be compromised — never holds it |
| 3 | **The interview lives in the conversation, not in a form** | ADR-0007, narrowed by ADR-0051. The brief allowed a form; a form would have made the student do the data entry the product exists to remove |
| 4 | **A case opens from an accepted *offer*, not from a `blueprintId`** | ADR-0058. An identifier is not something a student can consent to, and receiving one proves nothing about what they were shown |
| 5 | **Mapping is reviewed data with a two-person rule, not model output** | ADR-0017 + ADR-0057. The model proposes; a reviewed artefact decides. The approval binds to a content hash rather than to a claim in the artefact |
| 6 | **Requirements are curated by a human specialist through the AskiMate KB workflow** | ADR-0019. The brief implied AAS would derive requirements. A requirement that blocks an application needs provenance a scraper cannot supply |
| 7 | **Documents: the boundary was built before the feature** | ADR-0010/0022/0023/0068. Retention and lawful-basis gates ship and refuse *today*, while the vault they guard is reachable from nothing. Deliberate inversion of the usual order |
| 8 | **Financial evidence is out of scope for the first application** | ADR-0021. It is a *visa* requirement, not a university application requirement, and conflating them would have pulled the whole visa surface into scope |
| 9 | **Five deployables, not one service** | ADR-0037/0052. The brief did not specify topology. Trust levels forced the split: the process that sees a password and the process that loads untrusted pages must not be the same one |
| 10 | **The student client lives in the service that serves its origin** | ADR-0060. ADR-0039 had answered this for services and left it open for the client; a separately hosted client becomes a second source of workflow truth |
| 11 | **`main` is the trunk; no agent attribution in commits** | ADR-0029 §9 + `CLAUDE.md`. Your decision, 2026-08-31 |

**No deviation was made to work around a blocker.** Where something blocked, it was recorded as
blocking — which is why twelve retention questions and two lawful-basis determinations are still
open rather than quietly answered.

---

## 6 · Open blockers and decisions, ordered by what they hold up

| | Blocker | Owner | Holds up |
|---|---|---|---|
| **1** | **Real portal discovery** — run against the live Ulster Birmingham / QA HE portal | You | *Everything portal-facing.* Nothing downstream is real until this exists. 103 discovery runs saw zero file inputs because the application is behind a login |
| **2** | **Specialist review** of the blueprint, then a mapping set reviewed by a second person | You | Any real fill. `checkExecutable` refuses a draft; `checkUsable` refuses an unreviewed mapping set |
| **3** | **Bedrock credentials**, then four model IDs | You | The interview, interpretation, extraction and navigation workloads. The adapter is built and idle |
| **4** | **An account** — QA HE sandbox, or a consenting applicant | You | The controlled live run |
| **5** | **B5 — hold or pass through** | **You** (founder decision) | All document transport. See [`decision-sheet-b5-hold-or-pass-through.md`](./decision-sheet-b5-hold-or-pass-through.md) |
| **6** | **B1 — twelve retention determinations** | **You**, with the DPIA owner for five rows | Any document entering the vault. See [`decision-sheet-b1-retention-periods.md`](./decision-sheet-b1-retention-periods.md) |
| **7** | **B2 — the `disclose_document_to_institution` lawful basis** | A named determiner | Any document *leaving*. `authoriseDisclosure` refuses without it |
| **8** | **DPA 2018 Sch. 1 appropriate policy document** | The DPIA owner | Any special-category document. Must exist *before* the processing |
| **9** | **`attach_document` intent identity** | Me — unblocked, but needs the transport to be reachable | Safe retry of an upload under either B5 answer |
| **10** | **The AskiMate production integration** | Access, then me | The real conversational entry point. ADRs 0001–0002 are Proposed pending this |
| **11** | **An alerting transport** for interventions | Me | A specialist currently learns about a stopped run by running a CLI |
| **12** | **Accept or revise ADRs 0001–0004** | You | Nothing operationally; it is a tidiness and honesty question |

**Not blocked and available to work on now:** the alerting transport (11), the ADR housekeeping (12),
and hardening anywhere the tests are thinner than the claims.

---

## 7 · Test and verification state

**2,155 tests · 105 files · zero skipped · zero pending**, run against real PostgreSQL 16 and real
Redis (`--save "" --appendonly no --maxmemory-policy noeviction`). `pnpm run verify` chains
typecheck → lint → dependency boundaries → version check → tests; CI runs it plus a separate
integration job.

| Area | Tests | Area | Tests |
|---|---|---|---|
| `packages/domain` | 351 | `packages/documents` | 52 |
| `apps/conversation-service` | 292 | `packages/catalogue` | 39 |
| `apps/browser-runner` | 204 | `packages/profile` | 39 |
| `apps/chat-integration` | 164 | `packages/preparation` | 33 |
| `packages/case-store` | 139 | `packages/disclosure` | 31 |
| `packages/orchestrator` | 98 | `packages/mapping` | 26 |
| `packages/contracts` | 78 | `packages/extraction` | 23 |
| `packages/secrets` | 67 | `packages/interview` | 22 |
| `packages/account` | 65 | `packages/requirements` | 22 |
| `apps/secure-service` | 64 | everything else | ~346 |

### What is genuinely covered

Not "a test exists" but "removing the control fails a test". Every phase since P10 has ended by
deliberately breaking the thing it built and confirming the suite notices. The properties that hold
under mutation include: a password reaching no database column, log or model prompt (asserted by
scanning every column of every row, and every HTTP body on every wire); a crash not producing a
second account; the intent ledger refusing a duplicate consequential action; approvals bound to
content; the five transmission refusals; both storage gates; the three attachment-identity
components.

**A guard on the guard:** `scripts/ci-guard.test.ts` starts each database-backed suite *without* a
database and asserts it **fails** rather than skipping. A silent skip is how a security proof
evaporates.

### Known coverage gaps — stated, not hidden

1. **The surviving mutation.** Replacing `work.caseId` with a constant in
   `apps/browser-runner/src/fill-application.ts` passes all 204 browser-runner tests. `toStoredPlan`
   refuses any plan with uploads, so the runner's `plan.uploads` is always empty and the upload gate
   is never reached there. **This is the transport gap appearing as a coverage gap, not a defect** —
   the wiring becomes reachable, and testable, the day something can supply a document.
2. **Everything portal-facing is fixture-only.** The fixture portal is well-behaved by construction.
   A real portal will drift, rate-limit, use CAPTCHA and change its DOM.
3. **No model is exercised.** Every LLM path runs against a fake. The prompts have never met Bedrock.
4. **Type-level properties need source assertions.** `StorableUpload`'s brand cannot be broken by a
   behavioural test — widening `store`'s signature back passes every behavioural test and is caught
   by a source assertion. Recorded as the honest form for a property that lives in a type.
5. **`packages/documents`, `packages/extraction` and `packages/requirements` are tested in isolation
   only** — no integration test crosses from a deployable into any of them, because none can.

---

## 8 · Infrastructure and cost

| | |
|---|---|
| **AWS credit** | ~$1,000, per ADR-0018 |
| **Spent** | **$0.00** |
| **Provisioned** | **Nothing.** No S3, no KMS key, no RDS, no ElastiCache, no compute, no VPC |
| **Region, when it happens** | `eu-west-2` (London), ADR-0012 |
| **Model provider** | Amazon Bedrock, ADR-0018 — adapter built, **no model selected**, no credentials |
| **Running cost today** | £0. Everything runs locally and in GitHub Actions |
| **CI** | GitHub Actions, two jobs, ~3 minutes, within the free allowance |

**The first spend will be Bedrock inference**, and it will be small — the interview is the only
high-volume workload, and ADR-0018 already flags it as the row where a cheaper model earns the most.
**The first material spend will be storage**, and only if B5 is answered "hold": S3 with a
customer-managed KMS key, plus RDS if the databases move off anything self-hosted. Both are tens of
dollars a month at this scale, not hundreds. **The credit is not the constraint. The policy
determinations are.**

---

## 9 · The three things I would fix first, given free choice

### 1 · An alerting transport for interventions

Today a run that stops for a specialist writes a row in `interventions` and **nothing tells anyone**.
A person learns about it by running `pnpm run interventions`. Every other part of the recovery
design — pause at the failure point, adjudicate, resume from the checkpoint — is built and tested,
and it all waits on somebody thinking to look.

This is the single largest gap between "the system works" and "the system is operable", it is
blocked on nothing, and it is perhaps two days' work. It was correctly deprioritised in
August because durable run state did not exist yet. It does now.

### 2 · Give `attach_document` its intent identity

An upload currently rides the page's `advance_portal_page` intent, whose target is computed from
`plan.instructions` only — so **replacing a passport does not change the intent key**, while the
domain's own comment on `attach_document` says *"Duplicates are visible to admissions."* ADR-0051 §6
built the content-aware target precisely so that a late correction produces a different intent; a
document replacement is the same class of event and is invisible to it.

It is transport-level rather than policy, needed under **either** B5 answer, and it is the one thing
on this list that could produce a visible mistake in a real admissions system. I have not built it
because the action is produced by nothing today, so it would be a control over unreachable code —
but it should be the first thing built the moment B5 is answered.

### 3 · Close the four Proposed ADRs, and re-audit the oldest Accepted ones

Four records (0001–0004) have sat Proposed since Phase 0. Two of them — versioned migrations and
branded types — are among the most load-bearing decisions in the system and are fully implemented;
they should be Accepted. The other two describe an integration that does not exist and should be
either re-examined or explicitly parked.

More importantly, the last five phases each found that an **older ADR asserted a guarantee the code
did not provide** — ADR-0022 on storage (P31), the transmission gate's case check (P34), the
`documentRef` ambiguity (P35), and before those ADR-0038's verified-email guard and ADR-0045 §4's
crash detection. That is now a pattern rather than a coincidence, and the remaining unaudited
records are the oldest ones. I would read ADRs 0005–0021 against the code, in order, and write down
every sentence that is not true today. On the evidence, I expect to find two or three more.

---

## Appendix · Where to look

| Question | Document |
|---|---|
| What happened in one phase | `CHANGELOG.md`, and `docs/where-we-are.md` for the narrative |
| Why a decision was made | `docs/decisions/` — the index in `README.md` carries the amendment chain |
| What each deployable does at startup | `docs/deployables.md` |
| The document transport decision | `docs/document-transport-options.md` + the B5 decision sheet |
| What is unresolved about retention | `docs/retention-analysis.md` + the B1 decision sheet |
| What a controlled live run still needs | `docs/what-a-controlled-live-run-needs.md` |
| How the regressions for a phase were run | `docs/p<N>-regression-audit.md` |
