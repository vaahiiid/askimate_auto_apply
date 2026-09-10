# State of the system — the standing account

**Version:** 0.64.0 · **Date:** 2026-09-07 · **Written for:** someone who knows the product and has
not read the code.

> **This document is the standing account, not a snapshot.** `where-we-are.md` is a per-phase
> journal that accretes; the CHANGELOG is per-version. This is the one place that is rewritten to
> stay true, and it is updated at the end of every phase. Where it disagrees with an older document,
> this one is right.

---

## 0 · The one-paragraph version

AAS takes a student who has explicitly decided to apply to a specific university course and carries
that application from conversation, through preparation, to a filled form on the real portal —
stopping before submission. Twenty-six packages and five applications, all five deployable processes —
the sixth, a research build, was removed in P53 (ADR-0086). **2,346 tests, 125 files, zero skipped**, against real PostgreSQL and Redis, in two lanes —
the thirteen files that launch a browser run serially, everything else in parallel.
One hundred architecture decision records, all one hundred accepted (ADR-0006 §3 amended in P38). **AWS spend is no longer $0:** one bucket, one
customer-managed key and one revoked role exist, created by Vahid on 2026-09-09 to verify the S3
checksum binding (ADR-0092 §4); the amount is the billing console's to state. Nothing is deployed. The journey works end to end against a *replayed*
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
| **P36** | A stopped run reaches a person, and the notice carries nothing about the student (ADR-0071) | The whole recovery design was built and waited on somebody running a CLI. The student was told; the specialist was not |
| **P37** | ADRs 0005–0021 read against the code (ADR-0072) | Five phases running had each caught an older ADR asserting a guarantee the code did not provide. Thirteen of seventeen hold; the rest produced two fixes, two corrections and two open findings |
| **P38** | One application per submission identity, and the second one the student asks for (ADR-0006 §3, amended) | P37's two open findings, closed together. `claimSubmissionKey` is armed at case-open; a re-application opens a NEW case referencing the prior one, because the old same-case increment produced a terminal case that could never move |
| **P39** | A declared capability with no production caller fails the build (ADR-0073) | P37's question, asked by `pnpm run verify`. It found `openReapplication` uncalled on its first run — the constructor ADR-0006 §3 had named four hours earlier |
| **P40** | A run a person is holding is returned to the student, never restarted (ADR-0074) | A student whose application stopped for a specialist came back to a 500. They now land where they left it, their questions still arrive, and an advancing decision is refused with a reason rather than a 404 |
| **P41** | A refusal reaches the person it is for (ADR-0075) | Two codes existed so a client could tell them apart, and the page had words for neither; underneath, both services published 413 and 415 and neither had ever sent one — a body over the limit came back as `500 internal_error`, blaming us for something only the student could shorten |
| **P42** | The student can instruct the second attempt the system refuses them into (ADR-0076) | ADR-0006 §3's two-step exchange was built, published and tested in P38, and nothing but a test had ever called either half. The refusal now opens the second attempt when the server says the prior application has concluded, shows the advice first, and sends the student's own words |
| **P43** | Two determinations, made structural rather than written down (ADR-0077) | B1's claims question answered — no document period rests on defending legal claims, only the audit record — and enforced by `validateSchedule`; and a special-category field cannot be extracted, because a profile field that is not classified against Article 9(1) does not compile |
| **P44** | Documents are held and reused, and the twelve periods are set (ADR-0078) | B5 decided A — hold and reuse — which corrected five B1 rows written before it, and all twelve periods are determined. The vault stays shut on B2, and the report now says a retention policy is not permission to store |
| **P45** | A document running out is the student's choice, once, in writing (ADR-0079) | The expiry thresholds ADR-0078 left absent, approved and configured. The recorded wording is the wording shown, because the record takes the branded warning and not a string |
| **P46** | The visa path is a compliance boundary, not a scheduling gap (ADR-0080) | ADR-0021's decision stands, its reasoning was weaker than the truth, and the word OISC appeared nowhere in the repository. Registering the boundary found that `blocksApplication` — the line ADR-0021 calls the single one that keeps the visa journey out — has no production caller |
| **P47** | The browser tests run in a lane of their own (ADR-0081) | Two full runs in five failed on a browser test that passed alone. The seventeen files that launch a browser now run one at a time; the contention was fixed, not a single assertion or timeout. The list of them is checked in both directions against what the files actually do, following imports, because grepping found twelve of seventeen |
| **P48** | The record of what cannot be reached is checked too (ADR-0082) | `checkMinorGate` — the minors gate — was in the enforced register and in no row of this document, and `packages/notify` sat under "Declared but unreachable" with a cell beginning "Reachable." Neither is a code defect and neither would have failed a build, which is why the prose is where a false record now accumulates |
| **P49** | An ADR and the lists of it must agree (ADR-0083) | Three hand-written records of one fact, none compared. ADRs 0001–0004 were accepted on 2026-08-26 and a partial index edit fifteen minutes later missed four rows, so this document grew a blocker asking Vahid to decide what he had already decided. The first finding of this shape where the record claimed LESS than the system did, not more |
| **P50** | The census is generated, and its arithmetic is checked (ADR-0084) | §7's per-area table had six of twenty rows wrong and `scripts` — 264 tests — with no row at all, but the finding that mattered needed no run: the table did not add up to its own stated total, by 136. The tilde in "everything else ~346" is what made that unfalsifiable |
| **P51** | A published demonstration is guarded on what it shows (ADR-0085) | Five of twelve published commands had no guard — P37 fixed the walkthrough and left the rest. Exit code is not the property: `extraction-demo` accepting its INVENTING reader would exit 0 and mean ADR-0016's grounding guarantee had stopped holding |
| **P53** | The research build is removed, and what it proved is kept (ADR-0086) | `apps/chat-integration` retired by Vahid's decision. Four properties in it were about the two DEPLOYABLES, not the research build, and moved to `scripts/plane-separation.test.ts` rather than going with it. Taking it away found that the PRODUCTION client's `postMessage` had never been covered by the wildcard-origin rule |
| **P54** | The four lawful-basis determinations (ADR-0087) | B2 answered by Vahid — the last policy blocker on documents, open since P31. Contract for storing and disclosing, consent only for a minor's route, authorisation required for sending. A national ID additionally needs Article 9(2)(a); a passport does not. Ten of seventy (type, purpose) pairs now pass both gates, against none before |
| **P55** | The Schedule 1 document must exist before the processing (ADR-0088) | `national_id` is refused at the storage gate until the DPA 2018 Sch. 1 appropriate policy document exists — structurally, naming what is missing and who holds it, so re-enabling is a deliberate act with a name on it. `other / audit_evidence` is recorded as **decided**-refused rather than open, giving the lawful-basis side the third state the retention side has had since ADR-0023 |
| **P56** | A national ID leaves the supported document types (ADR-0089) | Vahid, reading P55's result: a type refused at the gate is *"unreachable surface with a policy justification attached"*. `national_id` leaves `DocumentType`, and the Article 9 clause, the separate-consent gate and the whole Schedule 1 module go with it — `assertStorable` is back to two gates. The determination was correct and is recorded in full, so re-adding starts from the reasoning; the Sch. 1 document comes first. Found the schedule parser CASTING `documentType` rather than checking it |
| **P57** | The document transport: the gates run before a byte is accepted (ADR-0090) | **B4 answered** — the last of ADR-0067's five blockers, and the only one that was engineering. An upload is a two-step exchange: the declaration runs the storage gates, and only then does a route exist that will read a body. `assertStorable` has a production caller for the first time since P39, so the declared-but-unreachable table goes **7 → 6** — the first entry ever to leave it. The store is in-memory and refuses to start in production; the durable encrypted one is next |
| **P58** | robots.txt is read, obeyed and kept; requests are paced (ADR-0091) | The two preconditions Vahid set before any run against a live site. Obeying is half of it — every run writes `robots.json` with the file verbatim, because a crawler that quietly complies leaves no evidence that it complied. An unreadable robots.txt allows **nothing**. A one-second floor nothing can lower. Adding a second rule to a one-rule guard surfaced **four** defects in the old code, including one that failed CLOSED and looked exactly like the rule working |
| **P59** | The document never enters a process we run (ADR-0092) | Vahid's decision, in his words, for the durable store: the gates run, then a pre-signed upload is minted, and the bytes go browser → S3. Reached through the boundary check REFUSING the in-process design — a control working, recorded as such. `packages/keys` and a sixth deployable considered and not taken, with his reasons. Rests on one unverified fact about S3, so this phase builds the verification (`pnpm run verify-s3-checksum`, a judgement that cannot say VERIFIED without its control experiment) and the provisioning request. **Nothing provisioned, port untouched.** Run 2026-09-09 against Vahid's bucket: REFUTED under the SDK's hoisted checksum, then VERIFIED on both halves with the checksum a signed header (ADR-0092 §4). Port still untouched |
| **P60** | An upload URL cannot be minted unbound (ADR-0093) | Condition 1 met on 2026-09-09 (both halves VERIFIED, ADR-0092 §4) and Vahid: *"Reshape the port … make that structural in the minting code, not a note in the ADR."* `BoundUploadUrl` is a branded type with one producer, and the producer reads the URL it minted back and refuses one whose signature does not cover the checksum header — the SDK's default, which hoists it into the query string where S3 never reads it, is refused rather than recorded. Proven against the real SDK offline. `DocumentVault` has no method that takes or returns bytes; `PUT …/content` and `acceptBytes` are gone, `POST …/confirm` asks the bucket what it holds; the S3 vault exists in the Conversation Service. **Not built:** durable metadata and production wiring (production start still refused), CORS, the retrieval's caller |
| **P61** | Document metadata is durable, and the transport starts in production (ADR-0094) | Migration 0017: `document_intakes` and `documents`, with **no column that could hold a byte** (asserted on the SQL and on `information_schema` at startup). `PostgresDocumentIntakePort.take` is one `DELETE … RETURNING` (three racing takes, one wins) and **re-runs the gates** against the schedule in force. The S3 vault's metadata sits behind a record store; the one durability check tells three in-memory cases apart. The entry point builds the transport from `AAS_DOCUMENTS_BUCKET`, `AAS_DOCUMENTS_KMS_KEY_ARN` (an ARN, checked) and `AAS_RETENTION_SCHEDULE_DIR` — all or none — loading the governing schedule through the parser moved into the domain package. Startup test: the real process starts with `documents=s3`. Nothing sent to AWS. **Not built:** the client's upload control, the retention sweep, the runner's fetch |
| **P62** | The student's page makes the PUT, and the CORS rule is exercised by the PUT it makes (ADR-0095) | The page has a document panel: type from the server's list, file, and the page hashes the file (the ONE hash it computes, stated in its header as the exception ADR-0092 forces), declares, PUTs the bytes to the bucket on the URL the declaration answered with, confirms, and re-reads `GET …/documents`. The purpose is derived by the server from the governing schedule — the page never sends one. The browser test stands a real HTTPS bucket on a second origin that admits **exactly the CORS rule parsed out of `docs/provisioning-request-document-vault.md`**, so the page's PUT is proved against the rule as written, with a real preflight. The three transport codes moved to `REFUSALS`. **Found, not resolved:** the gates' `detail` is on the wire and the contract says no `detail` exists (blocker 18). **Not built:** the retention sweep, the runner's fetch, a document the interview asks for |
| **P63** | Expired document intakes are swept by the worker (ADR-0096) | The worker's fourth job, `sweep_document_intakes`: migration 0018 widens the closed `job_kind` vocabulary; `sweepExpiredIntakes` is one bounded DELETE, oldest first, idempotent; sixty seconds under the same lease discipline as the other three, `AAS_WORKER_SWEEP_MS` to change it. The worker still names no vault — the table it deletes from cannot hold a byte, and the worker's test writes its abandoned rows by hand because the app is forbidden the documents package. The race with `take` is shown not to be one. **Not built:** the retention sweep (`purgeContents` still has no caller), the runner's fetch |
| **P64** | The preview names what the student holds (ADR-0097) | Slice a of the attachment path (§2). `RunDriver` hands the orchestrator the student's held documents from the vault's METADATA store, keyed by document type — one per type, the current one, never a superseded or purged record — so a run whose student holds the passport the mapping attaches reaches `authorise` with it named in the preview, and the authorisation binds to a hash that covers `(fieldRef, documentRef, contentHash)` (ADR-0069). `PreviewDocument.filename` → `describedAs`. The driver names no vault method that yields bytes, asserted. **Not built:** slices b–e; nothing is sent |
| **P65** | One yes over a preview that names each attachment, and the gates refuse in a closed set (ADR-0098) | Vahid's two decisions of 2026-09-10, verbatim in the ADR. Slice b: `renderPreview` writes, per attachment, which document, going where (institution and portal host) and for what (the form's label, this application); `SubmissionPreview.portalHost` is derived from the blueprint's first observed URL and is INSIDE the content hash, so a re-pointed application voids the yes. Blocker 18 closed: the storage gates' five refusals are three published codes (`document_not_retainable`, `document_basis_undetermined`, `document_type_refused`) with words on the page; every `detail` left the wire in the Conversation Service, two of them older than the transport; `no-free-text-on-the-wire.test.ts` refuses the next one. **Not built:** slices c–e; nothing is sent |
| **P66** | Uploads cross as references, and the plane hands a document over only after the gates (ADR-0099) | Slice c. An upload crosses to the runner as four things — which box, which document the mapping named, where the box is — and no bytes, id or hash. `POST /internal/v1/work/{runId}/documents/{documentRef}` under the lease: the run is at execute and names the upload; the captured authorisation still hashes to the preview rendered NOW; a `DisclosureRequestRecord` from what the student saw runs `authoriseDisclosure` (determination 3), then `mayTransmit` WITH THE CASE, then a sixty-second retrieval URL. The runner's `documentSourceFor` fetches, hashes, and mints the brand through `authoriseDisclosure` again — never a cast — before `executePlan` runs `mayTransmit` at the moment of attaching. `authoriseDisclosure` leaves the register. **Found:** the runner's entry point performs `create_account` only; `fillApplication` enters the register (blocker 19). **Not built:** slices d and e |
| **P67** | The page decides whether it can show the secure step before it asks for the capability (ADR-0100) | Closes the two properties ADR-0086 left open. `decideRendering` runs BEFORE `bootstrapSecureStep` over three observed capabilities — this build, `window.isSecureContext`, and a `no-cors` probe of the secure origin the page reads from the new non-minting `GET /v1/secure-origin`; a refusal is a code and a fixed sentence on screen, mounts no frame, and cancels nothing. The journey now builds and serves the real page and the real secure control, and the password is typed into the REAL cross-origin frame; the outbox delivers the receipt through `internalAppend`. **Found:** since P25 the page framed `/v1/secret-requests/{id}/control` while the Secure Plane serves `/control/{id}` — a 404 on the production path for forty-two phases, unseen because the page is not a router and the journey typed by `fetch`. The path is now `secureControlPath` from the contract, held to `secure.v1.yaml` by the drift guard |

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
| Specialist notices | `interventions.notified_at`, beside `announced_at` | Two audiences, two columns: either channel can fail while the other succeeds |
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
| 0001 | Integration via HTTPS API + signed webhooks | Accepted · approved 2026-08-26 with Phase 0; the index missed the row until P49 |
| 0002 | AAS is the system of record for the confirmed profile | Accepted · approved 2026-08-26 with Phase 0; the index missed the row until P49 |
| 0003 | Versioned migrations, not `drizzle-kit push --force` | Accepted · approved 2026-08-26 with Phase 0; the index missed the row until P49 |
| 0004 | Branded types make model output unable to reach a form field | Accepted · approved 2026-08-26 with Phase 0; hole closed by 0.2.1 — a brand cannot defend itself |
| 0005 | Contract-first OpenAPI at the AskiMate↔AAS boundary | Accepted · generation claim corrected by 0072 |
| 0006 | Re-application requires an explicit student instruction | Accepted · §1–§5 enforced in the machine by 0072; **§3 amended in P38** — a re-application opens a NEW case, and the path is reachable |
| 0007 | Agent-led conversational intake — the student never fills in a form | Accepted |
| 0008 | Recovery-first escalation, and the learning loop | Accepted · its alerting transport was built in 0071 |
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
| 0071 | A stopped run reaches a person, and the notice carries nothing about the student | Accepted |
| 0072 | A decision is enforced where it is made, and a demonstration that cannot fail is not evidence | Accepted · amends 0005 and 0008 |
| 0073 | A declared capability with no production caller fails the build | Accepted |
| 0074 | A run a person is holding is returned to the student, never restarted | Accepted |
| 0075 | A refusal reaches the person it is for | Accepted |
| 0076 | The student can instruct the second attempt the system refuses them into | Accepted |
| 0077 | Two determinations, made structural rather than written down | Accepted |
| 0078 | Documents are held and reused, and the twelve periods are set | Accepted |
| 0079 | A document running out is the student's choice, once, in writing | Accepted |
| 0080 | The visa path is a compliance boundary, not a scheduling gap | Accepted · amends 0021 |
| 0081 | The browser tests run in a lane of their own | Accepted |
| 0082 | The record of what cannot be reached is checked too | Accepted · completes 0073 |
| 0083 | An ADR and the lists of it must agree | Accepted · continues 0082 |
| 0084 | The census is generated, and its arithmetic is checked | Accepted · continues 0083 |
| 0085 | A published demonstration is guarded on what it shows | Accepted · completes 0072 |
| 0086 | The research build is removed, and what it proved is kept | Accepted |
| 0087 | The four lawful-basis determinations, and the condition a national ID needs | Accepted · answers 0022 |
| 0088 | The Schedule 1 document must exist before the processing, and a decision not to determine is a decision | Accepted · completes 0087 |
| 0089 | A national ID leaves the supported document types, and its gates leave with it | Accepted · supersedes 0088 §1 |
| 0090 | The document transport: the gates run before a byte is accepted | Accepted · answers 0067's B4 |
| 0091 | robots.txt is read, obeyed and kept; and requests are paced | Accepted · conditions 0014 |
| 0092 | The document never enters a process we run | Accepted · continues 0090, on two conditions |
| 0093 | An upload URL cannot be minted unbound | Accepted · continues 0092, completes 0090 |
| 0094 | Document metadata is durable, and the transport starts in production | Accepted · continues 0093 |
| 0095 | The student's page makes the PUT, and the CORS rule is exercised by the PUT it makes | Accepted · continues 0094 and 0092 |
| 0096 | Expired document intakes are swept by the worker | Accepted · continues 0094, extends 0052 |
| 0097 | The preview names what the student holds | Accepted · continues 0095 and 0096 |
| 0098 | One yes over a preview that names each attachment, and the gates refuse in a closed set | Accepted · Vahid's decisions · continues 0097 |
| 0099 | Uploads cross as references, and the plane hands a document over only after the gates | Accepted · continues 0098, amends 0046 |
| 0100 | The page decides whether it can show the secure step before it asks for the capability | Accepted · continues 0086, amends 0086 |

**On ADRs 0001–0004, which this document called Proposed until P49:** they were **accepted on
2026-08-26**, with Phase 0, and every word written here about their being unaccepted was wrong.

The history is exact. At 08:05 `4ee6b1c` created five ADR files, all *"Proposed · awaiting Vahid's
approval"*, and an index saying the same. At 08:47 `a27cb60` carried the message *"Phase 0 approved
by Vahid on 2026-08-26. ADRs 0001-0005 moved to Accepted"* and flipped all five **files** — without
touching the index. At 09:02 `8786fff` edited the index and moved **only 0005**'s row. Four rows were
left behind, and six weeks and seventy-eight commits carried them forward into this document, into
§6's blocker list, and into a recommendation that Vahid decide something he had already decided.

0001 and 0002 remain accepted decisions describing an integration that has not been built, which is
a different thing from an unaccepted decision and is recorded as blocker 10. `scripts/adr-status-agrees.test.ts`
now holds all three records — the ADR files, the index, and §3 above — to each other.

---

## 4 · Live · stubbed · declared-but-unreachable · not built

### ✅ Live and working (against fixtures and replays, with real PostgreSQL and Redis)

- The whole student journey: conversation → target offer → explicit request → case opens → interview
  → plan → validate → preview → authorise → account creation → multi-page fill → **stop before
  submission**.
- Real account creation on a fixture portal, proved by asking the portal whether the student's
  password logs them in.
- The two-origin secure credential path in a real browser — the real student page mounting the
  real frame from the secure origin, the password typed into it — with every HTTP body on every
  wire, the browser's included, scanned for the password (P67).
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
- **`packages/notify` — the specialist notice and its webhook.** Reachable, and it runs the moment
  `AAS_SPECIALIST_WEBHOOK_URL` is set on the worker. It is a configuration away, not a decision away,
  which is why P48 moved it out of the unreachable section it had been listed in while its own text
  said it was reachable. No URL has ever been set, so no notice has ever been delivered.

### ⚠️ Declared but unreachable — deliberately, and each for a stated reason

**Two lists live here, and P48 separated them because they had drifted.** The first is the register
the build enforces; the second is this document's wider notes at a granularity the register does not
work at. They used to be one table, and `checkMinorGate` — the minors gate — was in the register and
in *no* row of the table, while `packages/notify` sat under this heading with a cell that began
"Reachable". `scripts/unreachable-is-documented.test.ts` now reconciles the first table against
`scripts/check-reachability.ts` in both directions, so neither can move without the other.

#### A · The enforced register — `pnpm run reachability` fails if any of these acquires a caller

**Six** capabilities, each named by a decision, each with no caller inside any deployable's
dependency closure. It was seven until P57: `assertStorable` left this table when the document
transport gave it a production caller (ADR-0090), the first entry to move out. `authoriseDisclosure`
left it in P66 (ADR-0099), when the plane's document hand-over gave it one — and `fillApplication`
entered, because building that hand-over measured that the runner's entry point performs
`create_account` only: execute work has no production performer, and never had (blocker 19). The
reason and what would close it are the register's own words.

| Capability | Record | Why it cannot be reached | What closes it |
|---|---|---|---|
| `blocksApplication` | ADR-0021, ADR-0080 | Nothing in production carries a `Requirement`, so there is no scope for it to read — the visa journey is absent rather than excluded | The Requirements Service phase, or anything else putting a scoped `Requirement` on a production path |
| `checkMinorGate` | ADR-0011 | Its one BLOCKING condition is at the submission stage, and submission is out of scope (ADR-0014). The trigger that stops a case for review is a different thing and *is* reachable: `suggestsMinority` | The phase that brings submission into scope |
| `fillApplication` | ADR-0046 | The runner's entry point performs `create_account` only. `execute` work is claimed and handed out with its plan, and `fillApplication` is called by the journey test and by nothing a deployable runs: the browser session an account was created in does not survive to the next work item, and the password that would sign in again was single-use and is gone | A design for the signed-in session across work items — blocker 19, Vahid's |
| `purgeContents` | ADR-0010, ADR-0023 | B1 is decided; what is missing is a vault holding something to purge | The transport phase, and the job that calls this when a period elapses |
| `assessUsability` | ADR-0009 | Nothing feeds it; requirements come from the reviewed catalogue | The Requirements Service phase, if the KB workflow is ever wired |
| `attach_document` | ADR-0069 | Produced by nothing — `WorkKind` is `create_account \| execute` | The attachment intent identity ADR-0069 names, and a `WorkKind` that can carry it |

#### B · Unreachable in ways the register does not track

The register asks about **one symbol** and answers with **one caller**. These are packages, branches
and builds — real, and not expressible as that question, so they are recorded here rather than given
a register entry that would have to lie about its granularity.

| Thing | Why it cannot be reached | Why it is kept |
|---|---|---|
| `packages/documents` — the vault, the full lifecycle, the validity and expiry engines | No transport exists by which a student can supply bytes, and no deployable holds a vault. Its two gates *are* register entries (A, above); the package around them is not | The constraint ships before the thing it constrains (ADR-0019). It refuses correctly today |
| `packages/extraction` — reading a document with grounded quotation | Same: nothing to read. It is in no deployable's closure, so ADR-0077's special-category guarantee constrains code that does not yet run | Same |
| `packages/requirements` — provenance and the evidence bar | Nothing feeds it, and it has no dependents at all. Two of its symbols are register entries; the package is not | It is the shape ADR-0009 requires when a source exists |
| `recommendWait`'s `next_intake` branch, and `WaitRecommendation.suggestedIntake` | A **branch**, not a symbol: `recommendWait` itself is *enforced* in the register. The catalogue port resolves a blueprint by id and cannot list, so it cannot know a later intake is open | The domain rule is ADR-0006's, and it becomes reachable the day a listing can answer the question. Exercised in the walkthrough |
| The interview's `request_document` capability | `nextAction` asks fields before documents, and the orchestrator only enters the interview while a field is outstanding — mutually exclusive by construction | Asserted rather than deleted |

**`packages/notify` is not on either list.** It used to be, and its own cell said "Reachable", which
is what P48 went looking at. Set `AAS_SPECIALIST_WEBHOOK_URL` on the worker and the specialist notice
runs; it is a configuration away, not a decision away, and it is listed under *Built, but never run
against anything real* where that is true.


### ❌ Not built at all

- **Submission.** Out of scope by ADR-0014, and structural — the runner's click guard admits exactly
  the locators it is given, and it is never given a submit control.
- **The document transport's tail.** The transport exists end to end (ADR-0090, ADR-0092, ADR-0093,
  ADR-0094, ADR-0095): the page hashes, declares, PUTs to the bucket and confirms; intakes and
  records are in the database; the S3 vault and the production wiring exist. What does not exist is
  what follows a held document: the retention sweep that calls `purgeContents`, the runner's fetch
  of a retrieval URL (which needs `attach_document` reachable — blocker 9), and a run that notices
  what the student has sent (`request_document` is unreachable through the driver, ADR-0064 §4).
  (This bullet said "Blocked on B5" until 2026-09-10; B5 was decided on 2026-09-07 and had stopped
  being the reason long before the transport was built.)
- **AWS infrastructure beyond the vault.** No RDS, no ElastiCache, no compute; nothing is deployed.
  What exists, created by Vahid on 2026-09-09: the bucket `askimate-aas-vault-4471` in `eu-west-2`,
  the customer-managed key, and the (revoked) verification role — ADR-0092 §4.
- **The real AskiMate integration.** Blocked on access to the production source.
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
| **5** | ~~**B5 — hold or pass through**~~ | — | **Decided A — hold and reuse, 2026-09-07 (ADR-0078).** Documents are stored and reused; a student is never asked for the same document twice |
| **6** | ~~**B1 — twelve retention determinations**~~ | — | **All twelve answered, 2026-09-07 (ADR-0078).** Eleven periods set in schedule `1.2026-09-07`; row 12 (`bank_statement`) stays unresolved and blocking by ADR-0021 |
| **7** | ~~**B2 — the ADR-0022 lawful basis**~~ | — | **Answered 2026-09-08 by Vahid Mohammadi (ADR-0087).** Four determinations, review 2027-09-08. Ten of seventy (type, purpose) pairs now pass both storage gates. The one pair ADR-0087 left open — `other / audit_evidence` — was **decided-refused** on the same day (ADR-0088). The vault still does not open — what remains is transport, an implementation and a deployable, none of which is a decision |
| **8** | **DPA 2018 Sch. 1 appropriate policy document** | The DPIA owner | **Nothing today — and it is a live constraint, not a closed one.** `national_id` was the only special-category document type in scope and it was removed in ADR-0089, so no processing currently needs this. It binds again the moment one is added: **the document must exist BEFORE that processing**, which is why ADR-0089 puts the requirement at the `DocumentType` union itself and not only in an ADR |
| **16** | ~~**Billing alerts, one S3 bucket, the vault's CMK and a prefix-scoped credential, to verify the checksum binding AND SSE-KMS through a pre-signed PUT**~~ | — | **Created by you and run on 2026-09-09; VERIFIED on both halves (ADR-0092 §4, *Run 2026-09-09*).** The first run said REFUTED because the SDK hoisted the checksum into the query string, where S3 never reads it — your reading: *"the run refuted the property under the SDK's default presign, not the property itself."* The second run, with the checksum a signed header, established all three things you asked for: a mismatched body is refused (400 `BadDigest`), an uploader who omits or alters the header is refused (403 `SignatureDoesNotMatch`), and SSE-KMS holds with the binding in place. **The port is still untouched** — the reshaping starts on your word, and carries the constraint that the checksum is a signed header, never a query parameter |
| **17** | **The vault's service role, the bucket's CORS rule and its lifecycle** | You — AWS spend is your act | **The transport in production (ADR-0094).** The service starts with the transport once four variables are set; what its role must be allowed, what CORS the page's origin needs, and what lifecycle the bucket should and should not have: `docs/provisioning-request-document-vault.md`. Nothing has been created by the agent. The first request this service makes to AWS is on your deployment |
| **18** | ~~**The gate's reason on the wire — two of your rules disagree**~~ | — | **Closed by Vahid, 2026-09-10 (ADR-0098):** *"The contract's Problem stays without detail. Close the gap the way P41 closed its own: a closed set of refusal codes, each with wording written for the student and covered by the wording-coverage guard."* Done in P65: three codes, words on the page, every `detail` off the wire, and a guard. He asked to be told if a gate's refusal could not be expressed as a code; all five could |
| **19** | **The runner performs `create_account` only — execute work has no production performer** | You | **Found in P66 (ADR-0099).** `apps/browser-runner/src/main.ts` answers `needs_the_student` to every work kind but `create_account`. `fillApplication` — the thing that fills and saves a page — is called by `scripts/journey.test.ts` and by no deployable, and it is now in the register as declared-but-unreachable. The reason is a design nobody has made: the browser session an account was created in does not survive to the next work item, and the password that would sign in again was single-use and is gone (ADR-0042). A second gap sits behind it: for a portal with no login, execute work is never handed out at all, because `ClaimedWork` carries an account's email and approach (ADR-0045) and `accountDetail` answers null with neither. The attachment path's slices d and e wait on this; the transport, the gates and the hand-over do not. Two things need your word: whether a runner may hold a signed-in session across work items (and where its credential comes from), and whether a portal with no login is a route this product serves |
| **9** | **`attach_document` intent identity** | Me — unblocked, and B5's answer no longer conditions it | Safe retry of an upload. Needs the transport phase and a `WorkKind` that can carry it |
| **10** | **The AskiMate production integration** | Access, then me | The real conversational entry point. ADRs 0001–0002 are **Accepted** and describe an integration that has not been built — P49 corrected the claim that they were Proposed |
| **11** | **Authenticated specialist identity** | You, then me | Nothing today — one operator. ADR-0048 §3's condition for making it a release blocker is a *second* specialist existing at all |
| **12** | ~~**Accept or revise ADRs 0001–0004**~~ | — | **Already answered on 2026-08-26, and this blocker should never have existed.** All four were accepted with Phase 0; a partial index edit fifteen minutes later missed the rows, and this list then asked Vahid to decide it again. Corrected in P49 (ADR-0083), and now checked |
| **13** | ~~Arm the submission key, and make re-application reachable~~ | — | **Done in P38.** Both, together: the key is claimed at case-open and a refused second application has a route to a second case |
| **14** | ~~A declared capability with no production caller fails the build~~ | — | **Done in P39 (ADR-0073).** Six entries on the reviewed unreachable list, each with a reason and what would close it |
| **15** | ~~`start` on an ESCALATED run throws rather than resuming~~ | — | **Decided by Vahid and done in P40 (ADR-0074):** the student stays in the same conversation, and lands back in it |

**Not blocked and available to work on now:** nothing on this list — 12 turned out to be already
answered and 15 was done in P40. The ADR re-audit that used to sit here was done in P37; see
[`p37-adr-audit.md`](./p37-adr-audit.md); its two open findings were closed in P38.

---

## 7 · Test and verification state

**2,346 tests · 125 files · zero skipped · zero pending**, run against real PostgreSQL 16 and real
Redis (`--save "" --appendonly no --maxmemory-policy noeviction`). `pnpm run verify` chains
typecheck → lint → dependency boundaries → version check → tests; CI runs it plus a separate
integration job.

**Two lanes since P47** (ADR-0081). `vitest.workspace.ts` runs the thirteen browser files one at a
time and everything else in parallel, because three or four browsers landing together on a four-CPU
container starved pages past a twenty-second poll and failed two full runs in five — each on a
different test, each of which passed 4/4 alone. Peak Chromium processes 21 → 7, peak load 5.13 →
3.13, wall time 119s → 176s. No assertion or timeout was changed to buy it.

<!-- census:begin — generated by `pnpm run census`, do not edit by hand -->

**2,346 tests**, by the workspace they live in. Generated — run
`pnpm run census` after changing the suite. The rows and *everything else* sum to the total
exactly; the figure this replaced was approximate and had drifted 136 tests without anyone
being able to see it (ADR-0084).

| Area | Tests | Area | Tests |
|---|---|---|---|
| `apps/conversation-service` | 398 | `packages/conversation` | 52 |
| `packages/domain` | 376 | `packages/disclosure` | 47 |
| `scripts` | 292 | `packages/profile` | 46 |
| `apps/browser-runner` | 244 | `packages/catalogue` | 39 |
| `packages/case-store` | 143 | `packages/preparation` | 35 |
| `packages/documents` | 99 | `packages/extraction` | 27 |
| `packages/orchestrator` | 98 | `packages/mapping` | 26 |
| `packages/contracts` | 83 | `packages/interview` | 22 |
| `packages/secrets` | 67 | `packages/requirements` | 22 |
| `packages/account` | 65 | `apps/worker` | 21 |
| `apps/secure-service` | 64 | everything else | 80 |

<!-- census:end -->

### What is genuinely covered

Not "a test exists" but "removing the control fails a test". Every phase since P10 has ended by
deliberately breaking the thing it built and confirming the suite notices. The properties that hold
under mutation include: a password reaching no database column, log or model prompt (asserted by
scanning every column of every row, and every HTTP body on every wire); a crash not producing a
second account; the intent ledger refusing a duplicate consequential action; approvals bound to
content; the five transmission refusals; both storage gates; the three attachment-identity
components; and that a specialist notice carries no student identifier and no free text from the
failure.

**A guard on the demo (P37):** `scripts/walkthrough.test.ts` runs `pnpm run walkthrough` in a real
process and fails on a non-zero exit. The walkthrough declares an expectation per step, so a change
to the state machine that quietly stops it demonstrating what it claims is now a failing test rather
than nine lines of "REFUSED" nobody reads.

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
| **Spent** | No longer $0.00. A customer-managed key carries a flat monthly charge and two verification runs (2026-09-09) made a handful of S3 and KMS requests. The amount is read from billing, not written here |
| **Provisioned** | **The vault's bucket and key** (created by Vahid, 2026-09-09, ADR-0092 §4): `askimate-aas-vault-4471` in `eu-west-2` with block-public-access, TLS-only and SSE-KMS; the CMK; a verification role, since revoked. No RDS, no ElastiCache, no compute, no VPC. Nothing is deployed |
| **Region, when it happens** | `eu-west-2` (London), ADR-0012 |
| **Model provider** | Amazon Bedrock, ADR-0018 — adapter built, **no model selected**, no credentials |
| **Running cost today** | £0. Everything runs locally and in GitHub Actions |
| **CI** | GitHub Actions, two jobs, ~3 minutes, within the free allowance |

**The first spend will be Bedrock inference**, and it will be small — the interview is the only
high-volume workload, and ADR-0018 already flags it as the row where a cheaper model earns the most.
**The first material spend will be storage**, and B5 *is* answered "hold" (ADR-0078): S3 with a
customer-managed KMS key, plus RDS if the databases move off anything self-hosted. Both are tens of
dollars a month at this scale, not hundreds. **The credit is not the constraint. The policy
determinations are.**

---

## 9 · The three things I would fix first, given free choice

### 1 · ~~An alerting transport for interventions~~ — **done in P36 (ADR-0071)**

The Background Worker now sends a `SpecialistNotice` to a configured webhook, once per open
intervention, with a `notified_at` marker so a stopped run is paged once rather than every fifteen
seconds. The notice carries identifiers and categories and no student — its destination is outside
every boundary this repository controls.

**What it did not do**, and is the honest remainder: the specialist is still asserted rather than
authenticated (ADR-0048 §3, unchanged, and its ending condition is a second specialist existing);
the request is not signed; and there is no backoff or dead-letter, deliberately.

*The replacement for this slot, and now the first unblocked item:* **re-auditing ADRs 0005–0021** —
see item 3, promoted in practice by five consecutive phases finding an older ADR asserting a
guarantee the code did not provide.

### 2 · The attachment path — measured on 2026-09-10, and the order it has to be built in

The transport now ends at a held document (ADR-0095, ADR-0096). What is missing is the document
reaching a portal, and P62's scoping measured exactly where the path is cut. Five cuts, each a fact
about the code today:

1. **The preview never sees a document.** `RunDriver` hands the orchestrator `documents: new Map()`
   (`run-driver.ts:1712`), so a mapping with a `document` source stops the run at
   `document_missing` before the student is ever asked. Nothing looks a held document up by the
   reviewed mapping's `documentRef`.
2. **A plan with uploads does not cross to the runner.** `toStoredPlan` refuses `has_uploads`
   (`plan-transport.ts`), because the runner is forbidden the documents package and may hold none.
3. **No `DisclosureRequestRecord` is ever constructed.** `authoriseDisclosure` has no production
   caller (the register). Determination 3 (ADR-0087) says what the authorisation instrument IS —
   *"the preview a student reads, the authorisation text, and the content hash … registers them as
   required"* — and nothing yet builds the record from those three.
4. **The runner has no `DocumentSource`.** `executePlan` takes one; `fill-application.ts` supplies
   none, and the runner holds no vault credential (ADR-0042) — it must be handed a retrieval URL
   and the authorisation, by the service, under its lease.
5. **`attach_document` has no intent.** Uploads ride `advance_portal_page`, whose target is computed
   from `plan.instructions` only; replacing a passport does not change the key, while the action's
   own comment says *"Duplicates are visible to admissions."* Identity frozen in ADR-0069:
   `(fieldRef, documentRef, contentHash)`.

The order is forced by the dependencies, and it goes through the transmission gate, never round it:

| Slice | What | Gate it keeps |
|---|---|---|
| **a** ✅ | **Built in P64 (ADR-0097).** The driver supplies the student's held documents to the preview, keyed by the reviewed mapping's `documentRef` (the domain document type). The preview then names each attachment, and the `authorise` decision covers `(fieldRef, documentRef, contentHash)` as ADR-0069 froze it | ADR-0057/0059 — the authorisation binds to content |
| **b** ✅ | **Built in P65 (ADR-0098), on Vahid's decision.** The preview's presented text carries, per attachment, which document, going where and for what, and the destination host is inside the content hash, so the recorded `AuthorisationCaptured` IS the specific student authorisation determination 3 requires. `StudentDisclosureAuthorisation` is built from that event in slice c: `presentedText` = the preview, `method` = `chat_affirmation` | ADR-0022 — no `consented: boolean`; the text names what, where and for what |
| **c** ✅ | **Built in P66 (ADR-0099).** Plan transport carries uploads as **references** (`fieldRef`, `documentRef`, locators; no bytes, no ids). The runner asks the service, under its lease, for each `documentRef`; the service builds the `DisclosureRequestRecord` from the case's authorisation, runs `authoriseDisclosure` and `mayTransmit` **with the case**, and answers a sixty-second retrieval URL plus the authorisation record. The runner's `documentSourceFor` re-runs the gate before `executePlan` runs `mayTransmit` again | ADR-0069 — the case binding, checked server-side before any URL exists |
| **d** | ~~The runner's `DocumentSource` fetches the bytes and hands `executePlan` the `AuthorisedDocument`~~ — built in P66 as `documentSourceFor`. What remains of d is the runner's ENTRY POINT performing execute work at all: it performs `create_account` only (blocker 19), so the source has no production caller yet | ADR-0022 — the gate at the moment of sending |
| **e** | `attach_document` intent per upload, target `(fieldRef, documentRef, contentHash)`, written at claim beside the page intents; `assessIntent` consults it; `TransmissionRecord` written from the runner's report | ADR-0054 — verify first, never repeat |

Slices a and b are the Conversation Service alone. c is the first to change what crosses to the
runner, and the first that must not be built without b: a retrieval URL minted for a document no
specific authorisation names is the two-line failure ADR-0022 was written against. Each slice is a
phase with its own ADR; none weakens `mayTransmit`'s case check, the content hash, or the
mandatory-review categories, which are Vahid's hard limits on this work.

**Decided by Vahid, 2026-09-10 (ADR-0098):** *"One authorisation, over a preview that names each
attachment separately."* With the condition that *"the preview must name each attachment plainly —
which document, going where, for what."* Slice b is built to that condition.

### 3 · ~~Re-audit the oldest Accepted ADRs~~ — **done in P37 (ADR-0072)** · ~~close the four Proposed ones~~ — **there were none (P49)**

This recommendation rested on a stale index. ADRs 0001–0004 were accepted on 2026-08-26 with Phase 0;
a partial index edit fifteen minutes later missed four rows, and the omission propagated here. The
observation underneath it was still right — branded types and versioned migrations are among the most
load-bearing decisions in the system — but the conclusion, that they needed accepting, was not.

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
