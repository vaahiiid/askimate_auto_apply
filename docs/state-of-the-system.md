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
the sixth, a research build, was removed in P53 (ADR-0086). **2,527 tests, 130 files, zero skipped**, against real PostgreSQL and Redis, in two lanes —
the fifteen files that launch a browser run serially, everything else in parallel.
One hundred and one architecture decision records, all accepted (ADR-0006 §3 amended in P38). **AWS spend is no longer $0:** one bucket, one
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
| **P68** | Blocker 19 framed as a decision sheet | [`decision-sheet-blocker-19-how-a-runner-is-signed-in.md`](./decision-sheet-blocker-19-how-a-runner-is-signed-in.md). What is already true in the tree (step order, single-use credential, the session dying with the work item, the test-only bridges); five options — one signed-in sitting with `authorise` moved first, a second ask through the secure box (`portal_sign_in`), co-browsing (the only honest form of "the student authenticates in a handed-off session"), a persisted cookie (rejected), password reset (recovery, not a path); side by side; a recommendation; the open-portal fraction stated as unmeasured with two ways to measure it; four questions for Vahid. Nothing built, nothing provisioned |
| **P69** | Blocker 19 decided; the yes comes first (ADR-0101) | Vahid's six answers recorded verbatim: A1 yes; A2 yes, in memory, five minutes matching ADR-0034; B yes, `portal_sign_in` as the resume path only, with the phishing-normalisation argument in the ADR; open portals refused explicitly; C recorded as the plan for a second-factor portal; D no. And one requirement not on the sheet: detect a CAPTCHA or second factor and stop saying which, before slices d and e. **Built:** A1 — `nextStep` returns the account's refusals before the authorisation and its asks after it; the orchestrator, driver, supervisor and journey tests walk the new order; the journey starts at the yes, and the password is asked for only after it. The handover stays ahead of the authorisation, because a stopped run still owes the account back. **Not built:** A2, B, the detection, C |
| **P70** | A runner that meets a CAPTCHA or a second factor stops and says which (ADR-0101 §6) | Vahid's requirement before slices d and e, built. `captcha_met` and `second_factor_met` on the wire; the runner reads the page at four points — the registration form before anything is typed or the handle spent, the page the portal answers with, the application form, and the page a fill was bounced to — with a detector narrower than discovery's signals on purpose (a postcode box is not a second factor). The plane stops the run through the one stop mechanism, naming the challenge, the action, the page, the reviewed observation it contradicts, and for a creation met by a code that the account may already exist; one fixed message per code; `escalated`. **Found:** since P5 `reportWork` recorded every failure as `failed_cleanly` and discarded the code — `needs_the_student` did nothing. The fixture portal presents both challenges; both are met by the real runner |
| **P71** | One sitting, in memory, five minutes (ADR-0101 §2) | Slice d — A2 built. `SessionHold` keeps the browser context a run's account was created in, keyed by run, in memory, and closes it after `SECURE_HOLD_CEILING_SECONDS` idle — one constant in `packages/contracts`, from which the vault's ceiling (ADR-0034) is now defined, so the two lifetimes cannot drift apart. The runner's entry point performs `execute`: the held page, confined to the portal's host, `fillApplication`, the disclosure source of ADR-0099. A claim names the runs the runner holds (`sessions`, required on the wire); the driver offers a run to its holder first and a fill to nobody else. Released when the last page is saved, on a challenge, when the student is needed, and at shutdown. `fillApplication` leaves the register — **five** remain. **Not built:** the resume path (§3): the journey's restart still signs in by a cheat marked as such, through the `adopt` seam P72 fills |
| **P72** | `portal_sign_in` is the resume path, and the run says why (ADR-0101 §3) | B built, as the resume path only. The plane records who last reported a run's session live and until when (`run_sessions`, migration 0019) from the runners' reports and the one ceiling; the contract's `SESSION_ENDING_FAILURES` erase it at both ends. Past it, and only where an account exists, the run asks for the password a second time — purpose `portal_sign_in`, typed once, the reason rendered in the frame — then the `sign_in` step and work kind: the blueprint's login form (`authentication.login`, new and optional), the handle, no plan. `signInToPortal` types, submits and asks the page; the context is the held session and the fill follows. No intent for a sign-in: the Secure Plane's lifecycle is the record. Where the path cannot apply the run says so before a box opens. `portal_password_reset` left the contract; the purposes agree and the drift test asserts it. The journey's restart is driven through the real path; the cheat is gone. **Not built:** slice e |
| **P73** | One intent per document attached, and the record of what left (ADR-0069's third layer) | Slice e, the last of the attachment path. The page's intent key sees its attachments by `documentId@contentHash`, so a replaced document re-offers the page and a page without uploads keeps its key. The Run Driver opens one `attach_document` intent per upload at the claim — `page/field=documentId@hash` — and settles exactly the ones the runner's report names, for this run's case only; `document_transmissions` (migration 0020) is the audit row of what left, written from the same report. A page is not done until every document it carries is recorded as attached; one it saved without naming stops the next claim as the uncertain case, named as the attachment. **Found:** a page whose only content was an upload was never offered — `#nextPage` counted fields to fill and not files to attach. `attach_document` leaves the register — **four** remain |
| **P74** | The attachment path meets a portal that takes a file | The fixture portal grew a documents page — a multipart upload it hashes and shows on review — and the journey's student holds a passport: a metadata row in the plane's own store, bytes behind a vault stand-in the runner fetches by the plane's sixty-second URL. The restart test now goes on to page three through the production performer: the plane opens the `attach_document` intent, the runner fetches, hashes, gates and attaches, the portal holds the same SHA-256, the intent settles and `document_transmissions` has the row. **Found:** the preview named the blueprint's observed host while a run made to a deployment (`portalOrigin`, ADR-0057) sent the bytes to another, so the runner's transmission gate refused — `wrong_destination`, correctly — an authorisation the plane's own gate had passed. The preview now names the deployment's host, so what the student authorises is where the document goes (ADR-0098 amended); a run re-pointed after the yes stops at the yes again. Also: a plan with uploads and no fields to type is a plan (`parseTransportedPlan`) |
| **P75** | The destination inside the yes, made a named property at every level | Vahid: *"Keep it that way, and keep the property that re-pointing a run after a yes stops at the yes again."* Three tests state it: the orchestrator over a state re-pointed after a recorded authorisation; the Run Driver over the database and the catalogue — a run past the yes, the entry re-pointed at a deployment, `advance` stops at `authorise`, the preview names the new host, no runner is handed the work, a yes to *that* host lets it go on, and removing the deployment stops it again; the journey reads the fixture portal's host in the preview the student is shown. **Found:** the rendered text named the host only under each attachment, so a student with nothing to attach said yes to a destination they could not read. Every preview now carries a `Portal:` line (ADR-0059 amended); no hash changed |
| **P76** | The live-run record catches up with what was built | `docs/what-a-controlled-live-run-needs.md` — the document the README calls *"the remaining blockers"* — was dated 2026-08-26 and still said retention was a hard stop, the lawful basis unregistered, persistence in-memory, a `WorkKind` needed for attachments, the interview a terminal harness. Every one of the eighteen areas re-read against the code and the ADRs: two blockers off the list (ADR-0078, ADR-0087), three areas moved, the rest restated as *built and proved against the fixture, unproven on a real portal*, which is the truth. Blocker 9 here struck (done in P73). Vahid's items stay his — the target, the bucket, discovery, the models — with nothing restated that he has not typed |
| **P77** | Deliberate regressions over the attachment path and the destination inside the yes | Eleven mutations, applied to disk and restored byte-for-byte: the transmission gate's case and host checks, the destination in the preview's hash and its deployment reading, the driver's one reading of the deployment, the runner's refusals before a byte is fetched, the wire's HTTPS rule, the settlement's case filter, the hand-over's hash comparison, the executor's gate call. **Ten caught**; making the preview ignore the deployment fails the whole journey, which is P74's defect on demand. **One not caught:** the hand-over's own hash comparison is a second reading of a fact the orchestrator's assessment already refused on, one step earlier; it can differ only in a race, and it is kept and labelled as exactly that. `docs/p77-regression-audit.md` |
| **P78** | The Sheffield target file, the sourced facts, and the network answer | Vahid confirmed the target and gave six things its public pages state; each is recorded with its source URL and retrieval date, as stated by the institution and observed by nobody here. `targets/sheffield-pgt-2026-09.json` exists, parses, and has not been run; the course and the intake year are marked as his to supply rather than invented. The sibling form's *"an email will be sent containing your login details"* is recorded as `portal_issued` to be confirmed by observation, with what the code does with that answer today: creation without a secure step, and no routine sign-in built for a relayed credential (ADR-0101 built B as the resume path for `student_chosen`). The network question answered from the docs and the proxy: the environment's **Network access** level governs; Trusted's list carries `*.amazonaws.com` and not Sheffield; the narrowest widening is Custom with `sheffield.ac.uk`; Full buys nothing the runner's own host confinement does not already refuse |
| **P79** | Attached inspection: the tool reads a browser a person signed in to | The loop A1 made — a reviewed blueprint of the form is a precondition of the account, and a blueprint of a form behind a login needs an account to see it — recorded in ADR-0101 as a known consequence in Vahid's words, and closed by a mode rather than a change to A1. `PlaywrightAttachedInspection` attaches over CDP to a Chromium a person launched and signed in to, opens one tab in their context, and reads: discovery's guard (GET, HEAD, OPTIONS to the target's hosts) on the whole context for as long as it holds it, so the person's own tabs are read-only too and given back on close; navigation allow-listed by prefix; a redirect to the login page recorded as a finding; captures scrubbed of input values. `pnpm run inspect:attached` writes what discovery writes, and `inspect-discovery` reads it. Proved against the fixture portal's login in six tests: the gated page read through the person's session with nothing but GETs; a POST from the person's own tab refused while attached and landing after; a browser signed in to nothing bounced and recorded. **Found:** the service constructs the deterministic model client in every path (blocker 3 amended, checklist areas 7 and 8). robots.txt not applied in this mode, stated in the run record |
| **P80** | The first real attached read, and what it found | Vahid's first run against Sheffield's PGT form: the attach, his session, the guard, the pacing and the exit all worked; the read failed with `page.evaluate: ReferenceError: __name is not defined`. tsx injects esbuild's helper into the serialised in-page script; the three launching sessions shim it on the contexts they create and the attached session did not, and vitest's transform hid it from every in-process test. Vahid: *"Fix the transform, not the script … make the test fail first without the fix."* A test that spawns the real command under tsx against the fixture login failed on that error first, then passed with the shim. Found on the way: the test's first version spawned synchronously and starved the fixture portal it was serving. `run.json` now says which rule refused each request and why |
| **P81** | The first real form, read | Vahid's attached inspection of Sheffield's PGT application: eleven pages, zero failed, nine of them Part 1 form pages, 309 controls, seventeen document slots, Part 2 unread. Recorded in `docs/captures/sheffield-pgt-2026-09-10/`. The finding he named — a `POST getGradingSystemsForCountry.do` fired on the education page — is one link of a chain the structure shows whole: country → institution (typeahead) → grading system (server lookup) → grade, plus a subject search; every other dependency on the form is static show/hide, tabulated. The site's search form on every page is excluded by design. Mandatory fields are marked by `*` in labels and enforced on save, and on five of nine pages the tool read no labels at all. The password question and the three-choices question are answered as far as the captures allow and named as open. Three schema gaps for step 4: options that arrive after another field, a typeahead as a fill mechanism, a repeatable entry. **Found on our side:** the one-time-code heuristic flagged six postcode boxes and wrote a false `mfa` handoff (P82) |
| **P83** | The presigned URL is dated at the mint's `now` | CI #176 went red on the docs-only push `a02d989`: `s3-document-vault.test` refused a URL valid until `16:48:04.000` against an intake at `16:48:03.964`. Root cause on our side, not CI's: the SDK dated the signature at its own clock, truncated to the second, which can land one second after the `now` the bound was computed from, and the exact check in `assertBoundUploadUrl` rightly refused it. `PresignRequest` now carries `signingDate`, set by the mint to its `now` and passed to the SDK's `getSignedUrl`; the in-memory store stamps the same date. A test reproduces CI's failure before the fix — an SDK-like presigner dating at the next second — and passes after. The check is unchanged; only the date the signature carries is |
| **P82** | The observation script stops reading a postcode as a one-time code | The two false signals from the first real form, fixed where they were made. `input[name*=code]` had matched six postcode boxes on Sheffield's contact page and written an `mfa` handoff where there is no second factor; the observe script now requires the name or id to BE a code field, the set the runner's challenge detector has used since P70, or `autocomplete="one-time-code"`. Page-text signals match whole words and read the page with script and style bodies cut out, so "registered charity" and a script that mentions registering no longer make an account-creation page. The signals fixture carries the three false positives; the two new tests failed on Sheffield's exact evidence before the fix. The first version cloned the body to cut scripts out and a cloned `<img>` fetched its source — caught by the CLI test's refusal count; the text is read by walking the tree, and a test asserts the observer fetches nothing. Also regenerates the census CI #177 found stale after P83 |
| **P84** | Two of the four answered, in Vahid's words | Course and intake supplied: MSc Management and International Business, September 2027 (`2027-09` in the target file, so the key carries it; the course page URL's `/2026/` is the page he read it from, not the intake). The password question closed on his direct statement — *"I typed the password I chose. Sheffield did not email me one"* — `student_chosen`, AUTH 1 yes, AUTH 2 no; recorded as his statement with the date, not inferred from a link or the sibling form. Still his: the registration and login pages in a signed-out profile, now for the locators only and specified page by page in the capture README; the inspect-dependencies output; Part 2; the three schema gaps |
| **P86** | ADR-0102 — use the refusal the form offers | Blocker 20 built as Vahid decided it. `BlueprintField.dataCategory`, set by the reviewer and never by discovery; a mapping set is refused while any field is unclassified. `ValueSource.form_refusal` — the value the form offers, a mandatory rationale, the form's own words or nothing — the only source `checkUsable` accepts on a special-category field, refused when misused, not offered or composed. With no refusal mapped the plan blocks `special_category_unhandled`, required or not, and a specialist is asked. The preview lists refusals under *We did not answer these for you*, never among the answers, inside the hash. Transport, wire and both conversions carry the kind. Found while costing the sheet: `profile_field` and the interview's `ask` were typed by the whole registry; both are now `OrdinaryFieldKey`, measured to refuse a special-category key at the line that names it. Eleven tests, all failing before the mechanism. The curated Sheffield draft classifies its fourteen equal-opportunities fields |
| **P87** | The correction recorded, a refusal covers its question's other controls, and the first real mapping set | Vahid's dated correction in ADR-0102: the ethnic-origin list offers *Prefer not to say*; *Information withheld* was the label's wording he reported as the option. `form_refusal.covers`, found while writing the first real set — Sheffield's disability question is twelve boxes and the rule would have blocked the plan on the eleven others; a cover must be special-category, unmapped and covered once, is planned as nothing and named in the preview. The hash now moves with each refusal (P86 had declared it and not hashed it). The equal-opportunities mapping set is written as a draft for Iman's review; the curated draft classifies all 216 fields as proposals; the review pack counts 23 judgement rows and 193 mechanical; a test holds the drafts to the real checks |
| **P88** | Three defects of the discovery tool the first real form exposed | Fixed fail-first, each against the shape Sheffield showed: radio inputs sharing a name become one field whose options carry the submitted values, recorded by the observer (the draft had one field per input and no values); an advance-control candidate is never blank, a sentence containing "start" is not a button, and the page's control prefers an id (the draft had a blank locator on five pages); `inspect-discovery` counts refusals by rule and calls only a write on the target state-changing (the summary had called fifteen off-host tags writes). ADR-0102 §7 now says what the P86 hash test did wrong — it agreed with the code — and the assertion is retired |
| **P89** | The personal and contact pages mapped as far as the registry reaches | The Sheffield mapping set is one draft for the whole blueprint and now carries personal and contact: names, the date of birth as three selects (three new date-part patterns, `D`/`MMMM`/`YYYY`, fail-first), the e-mail twice, the address parts, and the country as a partial option map of eight captured names that refuses any other rather than approximate. A confirmed fixture profile fills them under the real checks. **Raised, not decided:** employment's four required fields have no profile field — the registry collects no employment history — so the plan blocks on them until Vahid decides what the profile collects |
| **P90** | The plan honours `visibleWhen` | Recorded by discovery since the blueprint schema existed, read by nothing until now: a field's condition, and its section's, is evaluated at plan time against the plan's own values, to a fixed point. A field the form hides for these answers is neither filled nor missing — dropped from instructions, blockers and uploads, listed under `hidden`, and not a violation in the validator. Sheffield's two postcode boxes were both planned with one hidden on the page; the international one is now absent for a UK address, and an unmapped required field on a hidden branch no longer blocks. Fail-first on a synthetic address page and on the Sheffield draft |
| **P91** | The entry page read; the AUTH questions answered from it; the registration and login locators authored | Vahid's signed-out read of the entry page and the reset page, three pages, zero failed, recorded unedited. From the capture: AUTH 1 yes, 3 none offered, 6 no CAPTCHA on those pages (tags refused), 8 yes by design; 2 and 5 settled for what the pages show and open for what follows a submit; 4 and 7 not settled by any page read, and not inferred. The curated draft carries the login URL and locators and a registration page first in the walk; the mapping set sends the e-mail from the profile and the passwords to the Secure Plane. The eight facts are recorded with `unobserved` on 4 and 5, and the chooser refuses on exactly those — the design holding: what settles them is Vahid's own account of registering and signing in. Two tool defects the draft showed, fixed fail-first: `password` inputs came back unknown; buttons came back as fields |
| **P106** | ADR-0107: a handed slot's companion says "later" — blocker 23 decided A by Vahid; the line it must never cross enforced; the preview in the student's words; blocker 24 raised | His reason: *"'I will upload this later' is not a claim about the document, it is a statement about when … nothing is being sent in this act."* The blueprint names a companion's defer option and its not-providing option; a companion is mapped by nothing (ADR-0105's admission withdrawn), and a mapping naming the not-providing value is refused in his words; a handed slot with no defer value named is admitted only on a page the plan fills nothing on. The plan sets the companion to the defer value once per entry as a reviewed constant marked as the slot's deferral; the slot's handoff names what is told. The preview says under each entry *We are telling <institution> that your Certificate is coming later. You attach it yourself. The application is not complete until you do.*, and the hash holds the value. The handover says it beside each document. The fixture drops an unanswered save silently as Sheffield does; the journey saves two qualifications with *later*. Sheffield's set (0.3.9) no longer hands the six radios; their defer values wait on a copy of the fieldset. What happens to the deferred state after the handover — today, one sentence and nothing else — is blocker 24, with options priced |
| **P105** | ADR-0106: a page is saved when the portal shows it — blocker 22 decided by Vahid; the three read-backs built; blocker 23 raised | His words: *"Your cost answer: accepted … Build the three phases in the order you set."* Built, each failing first: after the press the runner reopens a page and reads every filled value back (compared on the redacted shape recorded at the fill — a changed value is not a kept one); a repeating page's listing is counted before and after (`repeats.recorded`, rebased onto the deployed origin at the claim); a slot the runner attached to must show the marker the blueprint names (`requiredDocuments[].recorded`). Anything not seen is `uncertain` with the new `not_recorded` code, and no transmission is recorded — the wire refuses one beside it. The fixture portal's pages re-render what they hold, its education page lists what was saved, its documents page shows a held file; the journey walks all three. The cause of his dropped save is settled — the unanswered radios — and that makes ADR-0105's handed-with-its-slot shape a page that never saves on Sheffield: raised as blocker 23 with the options priced, on his instruction, not decided |
| **P104** | Blocker 22 met on the real portal; its shape restated by Vahid; the cost answered before building | A second qualification saved with two radios unanswered: no error, and `summary.do` listing one entry — dropped silently, so an error locator or a landing URL would both have passed. His shape: saved when the portal shows the thing exists; named where a blueprint can; `uncertain` where it cannot, and uncertain is a specialist's problem. The sheet prices it against what exists: `uncertain` is already built end to end (the ledger leaves the intent open, the next claim stops, a person resumes or abandons; no transmission is written), so the rule costs a look per unverifiable page; reopen-and-read of the page's own fields costs the reviewer nothing and holds on most server-rendered forms; a listing count per repeating page and a marker per attached slot are vocabulary the reviewer names from a copy; a portal with nothing to read is a look per page — nine on Sheffield. Three phases estimated, each fails first. Why the save failed is unknown; two specific observations would settle it. Nothing built |
| **P103** | The education page after a save, observed: the P99 condition closed; a save pressed is not a save read | Vahid saved one qualification and reopened `education.do?new=true` empty: the repeat's continuation is the page's own URL, not a fifth gap, closed in his words with his caveat (*one observation, not a property shown at every count*) — and the per-item walk does depend on it, since a second opening that showed the first entry would be typed over and saved with nothing noticing; the second observation is asked for. The evidence radios accept *later* and *not providing* without a file, so a page saves with no document; whether it saves with a radio *unanswered* is unobserved and bears on ADR-0105's handed-with-its-slot shape. The save landed on *Your Details*: the runner reaches each item by URL and does not care — but after the press it reads nothing, so a refused save is reported as saved. Blocker 22 raised with a proposal; not built |
| **P102** | The institution box observed: a typeahead's entries may follow another field (found, fixed, fails first); the duplicate entries as an observed case; "Not in list" checked | Vahid observed the live institution search: a GET per keystroke carrying the typed text *and the chosen country*; *Sheffield International College* offered twice; *Not in list* closing the list. The dependency could not be written before: `checkUsable` refused `optionsAfter` on a typeahead as offering no options, and the execution would have waited on the text box as a list. Written into the fixture (the course search takes a level), watched fail, fixed: the order rules and the press apply to a typeahead, its wait is its own at the fill. Draft 0.2.11 says `institution-ts-control` follows the country box. The duplicate is P95's refusal observed rather than fixtured. *Not in list*: nothing today stops a text that reads so from choosing it — proven, OPEN; the guard (the reviewer names the escape on the blueprint) waits on the value-versus-text decision so it is built once |
| **P101** | The Tom Select entry locator confirmed from the markup Vahid copied; the runner's match is on visible text, proven | He copied the live country box's dropdown: list id `<name>-ts-dropdown`, entries `div.option[role=option][data-selectable]` with a `data-value` the form submits that is not the visible text, and state classes. The draft (0.2.10) names each box's own list by id and an entry by role and mark — the class-based default would have matched both boxes' entries at once. Proven against a fixture with his shape: the runner matches the text an entry shows, refuses the submitted value and the wrong case, ignores the classes. His expectation that a mapping names the submitted value is recorded as a proposal — buildable through the blueprint's `options`, as selects already work — and undecided; no mapping to either box is signed. The institution box's loading is what one more copy would settle |
| **P100** | ADR-0105: a slot's companion handed with its slot; a list's options loaded by a press | Both decided by Vahid in his words. *"'My transcript is in English' is not the student attaching something, it is the student answering the question the slot asks"* — a `student_handoff` on a slot's own companion is admitted when the slot is handed too, on any page, and nothing else is; it crosses with the slot, the preview says *You answer yourself* under the entry, the handover names it. `optionsAfter.press` names the control that loads a list — Sheffield's subject is a search-then-select — guarded three ways: `checkUsable` refuses a press that is any page's advance, add-another or the submission control; the runner refuses a submission name at the click; the page's URL is read before and after and a press that left the page is drift. The limit stated before building: a save that neither navigates nor reads as a save is not distinguishable from a lookup; naming the control is the reviewer's act. Fixture: a certificate status radio; start dates shown on a press; the journey holds both. Sheffield: six status radios handed with their slots; `subject` presses `subjectSearchButton` |
| **P99** | Vahid's live read of three Sheffield pages, confirmed against the capture; two shape findings raised, not built | The education page's continuation is its own `education.do?new=true` URL, which the built shape expresses with no *add another* control — one condition for the next read. Six file inputs are in the capture where four rows show; the radios' *in English* option and the asterisks are on his report alone, the capture having no labels for that page. `documents.do` has five description boxes and no radios; the 50MB page total is not expressible per slot; the institution's words on what must not go there bind the reviewer. Subject is a search-then-select, not a typeahead: the wait is marked, the button press between is not expressible. Two proposals wait on him: a slot's companion radio handed to the student with the slot; `optionsAfter` naming a control to press. Accepted formats recorded per page (draft 0.2.8) |
| **P98** | ADR-0104: blocker 21 decided — a repeating page's documents are the student's own act, said under each entry; a condition inside a repeat answered per item | Vahid's decision in his words: B, with the per-item condition; C out; A an option, not the end state. `checkUsable` admits a `student_handoff` on a repeating page's document slots and nothing else on it, and a condition that looks at the page; the plan carries the handoff once per item and evaluates the page's conditions per item against that item's own values, recording what is hidden for which entry; a document slot left to the student does not refuse transport; the preview says *You attach yourself* under each entry, inside the hash; the handover message names the same acts with their entry. The fixture's education form takes a certificate and asks a grade only of a school qualification; the journey holds the diploma's grade typed, the bachelor's box untouched, nothing attached by the runner, and the preview's two lines. Sheffield's `page7` is marked repeating with its six slots left to the student |
| **P97** | Deliberate regressions over the four gaps ADR-0103 built; the companion's value was never in the hash | Fifteen mutations applied to disk and restored byte-for-byte: the companion's check, entry and hash; the late option's order, wait and bound; the typeahead's check and its two wrong choices; the repeating page's rendering, ledger identity, hash position, driver filter and add-another; the repeated fieldRef. **Preparing M3 found a defect**: the hash held the literal text `{attachment.companion.text}`, so the mark beside a document was never in the yes — fixed, test first. Eleven of fifteen caught on the first pass; three weak tests made strong (the order rule masked by the type rule; the typeahead never meeting two identical or one near entry); one kept as labelled redundancy (the entry's index over a stable sort). `docs/p97-regression-audit.md` |
| **P96** | ADR-0103 gap 3 built — a page filled once per item of a list; each item its own page to the ledger; every entry in the preview | `BlueprintPage.repeats` names the list a page repeats over; the profile package says which fields are lists and the parser refuses any other. `checkUsable` refuses a mapping on the page drawing from anything but that list, a document, handoff or credential mapped on it, or a condition. The plan renders each item through the mapping's rule with the list's provenance and carries `item` on the instruction; an unconfirmed optional block is filled zero times and asks for nothing. The preview lists each entry in order and says none plainly, count and position inside the hash. The driver offers the page once per item, each its own ledger target; the runner returns to the page, presses add-another, saves one. The journey adds two qualifications end to end. All four ADR-0103 gaps are built; a fifth is raised — Sheffield's education page carries documents per qualification and a condition, which the rule refuses on a repeating page once mapped |
| **P95** | ADR-0103 gap 2 built — a typeahead is typed into and the one exact entry chosen; a fill, not an advance | `FieldInputType` gains `typeahead` and the field says where its entries are found; `checkUsable` refuses one that does not, and entries on a field that is not one. The runner types the text, waits a bounded five seconds for exactly one entry reading it, and clicks that entry; none or more than one fails with what was offered and chooses nothing; an entry reading as a submission is refused. The fixture portal's study page asks the course through a server-answered search; the Sheffield draft marks its two Tom Select boxes, entry locator flagged as the library's default pending the next read |
| **P94** | ADR-0103 gap 1 built — options that arrive after another field: ordered, waited for, never chosen among | `BlueprintField.optionsAfter` names the field whose setting loads this one's options. `checkUsable` refuses an order the fill could not follow, a dependent with nothing to wait for, and a mapped dependent whose earlier field nothing maps. The plan carries it to the runner, which waits a bounded five seconds for the one named option before selecting and fails the page as drift with what the list offered if it never arrives. The fixture portal's apply page now fills the passport-country list after the nationality and after a round trip; the gated fixture, the demonstration and the Sheffield draft's education chain record the dependency |
| **P93** | ADR-0103; gap 4 built — a document slot's companion is planned after the attach, entered and read back | The first real form showed four things the schema could not say; ADR-0103 decides all four and builds the fourth: `RequiredDocument.companion` names the control set beside a slot when a file is placed and the value it must hold. The plan carries it with the upload only when a document is mapped; the runner sets it after the attach and reads it back; the preview names it in the option's own words inside the hash; `checkUsable` refuses a companion that is mapped, absent or not offered. Proved on the fixture portal, whose documents page now refuses a save without the status. The Sheffield draft carries it on seven slots; ten wait on a re-read. Found on the way: two pages shared `certificate`/`certificateStatus`, so the parser now refuses a repeated fieldRef |
| **P92** | AUTH 4 and 5 in Vahid's words; the chooser picks `student_chosen`; the refusal proved to still bite | Two facts no page read could settle are settled by his direct statement of 2026-09-11, marked observed by him and not by a run: no verification step between *Start Application* and the form; no code at sign-in. Recorded with his caveat that this is Sheffield's behaviour and not a property of direct portals — per-target work. With all eight facts observed the approach chooser picks `student_chosen` for this entry; the test holds that, and holds one fact at a time that the chooser still refuses when either is set back to unobserved |
| **P85** | The dependencies read, the Article 9 sheet, and the draft blueprint with the course and intake set | Vahid's `inspect-dependencies` output recorded and read: the education chain is confirmed by handler (four selects empty until the one before them is set and the server answers — an order and a wait the schema cannot say); sixteen of seventeen file inputs tick their own *upload now* radio by `onchange`, the English-language slot does not, and the five other-documents radios were not in the capture at all — the runner's `setInputFiles` fires the page's script and verifies nothing, so the draft carries the radio as a field beside each slot and names the relation as a fourth schema gap. The equal-opportunities page asks eleven disability boxes and an ethnic-origin select: Article 9, Vahid's decision, written as blocker 20's sheet — B (pass through, unstored) does not exist here because every typed value is in the preview, the stored plan and the log by design; `student_handoff` would make the whole application untransportable; A (unmapped, passed over, named in the preview) recommended with the two things it needs. The curated draft blueprint, 0.2.0, parses and is refused as `not_reviewed` |

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
| 0101 | The yes comes first, and a runner is signed in for one sitting | Accepted · decides blocker 19, amends 0045, 0049 and 0050 |
| 0102 | Use the refusal the form offers | Accepted · decides blocker 20, continues 0077, 0059 and 0043, amends 0077 |
| 0105 | A slot's companion is handed to the student with its slot; a list's options may be loaded by a press that loads options and nothing else | Accepted · both decided by Vahid, 2026-09-11; the press's three guards and the limit stated before building; built in P100 |
| 0106 | A page is saved when the portal shows it, not when a control was pressed | Accepted · decides blocker 22; decided by Vahid, 2026-09-12; built in P105 |
| 0107 | A handed slot's companion says "later": a statement about when, never a claim about the document | Accepted · decides blocker 23 (A); decided by Vahid, 2026-09-12; amends 0105's companion half; built in P106 |
| 0104 | A repeating page's documents are the student's own act, said under each entry; a condition inside a repeat is answered per item | Accepted · blocker 21 decided by Vahid, 2026-09-11 (B, with the per-item condition; A an option, not the end state); built in P98 |
| 0103 | The blueprint says what the form does between fields | Accepted · the four schema gaps under Vahid's "Take the four schema gaps"; gap 4 built, 1–3 to follow; continues 0017, 0069 and 0102 |

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

**Four** capabilities, each named by a decision, each with no caller inside any deployable's
dependency closure. It was seven until P57: `assertStorable` left this table when the document
transport gave it a production caller (ADR-0090), the first entry to move out. `authoriseDisclosure`
left it in P66 (ADR-0099), when the plane's document hand-over gave it one — and `fillApplication`
entered, because building that hand-over measured that the runner's entry point performed
`create_account` only (blocker 19). It left again in P71 (ADR-0101 §2), when the entry point began
performing `execute` in the session the account was created in. `attach_document` left in P73
(ADR-0069's third layer), when the Run Driver began opening one intent per document attached. The
reason and what would close each remaining entry are the register's own words.

| Capability | Record | Why it cannot be reached | What closes it |
|---|---|---|---|
| `blocksApplication` | ADR-0021, ADR-0080 | Nothing in production carries a `Requirement`, so there is no scope for it to read — the visa journey is absent rather than excluded | The Requirements Service phase, or anything else putting a scoped `Requirement` on a production path |
| `checkMinorGate` | ADR-0011 | Its one BLOCKING condition is at the submission stage, and submission is out of scope (ADR-0014). The trigger that stops a case for review is a different thing and *is* reachable: `suggestsMinority` | The phase that brings submission into scope |
| `purgeContents` | ADR-0010, ADR-0023 | B1 is decided; what is missing is a vault holding something to purge | The transport phase, and the job that calls this when a period elapses |
| `assessUsability` | ADR-0009 | Nothing feeds it; requirements come from the reviewed catalogue | The Requirements Service phase, if the KB workflow is ever wired |

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
| **1** | **Real portal discovery** — a scoped, read-only run against the University of Sheffield's public PGT application pages (*"Sheffield target confirmed"*, Vahid, 2026-09-10; `targets/sheffield-pgt-2026-09.json`, course and intake supplied 2026-09-11, not run as a crawl — read through attached inspection, P81) | You — the environment's network access is Trusted and refuses `sheffield.ac.uk`; the run needs Custom with that domain, or another machine | *Everything portal-facing.* Nothing downstream is real until this exists. The earlier target (Ulster Birmingham / QA HE): 103 discovery runs saw zero file inputs because the application is behind a login |
| **2** | **Specialist review** of the blueprint, then a mapping set reviewed by a second person | You, and Iman Behravan as approver (Vahid, 2026-09-10: *"author Vahid Mohammadi, approver Iman Behravan"*) | Any real fill. `checkExecutable` refuses a draft; `checkUsable` refuses an unreviewed mapping set; the loader refuses an approval signed by its author |
| **3** | **Bedrock credentials**, then four model IDs | You, then me | The interview, interpretation, extraction and navigation workloads. The adapter is built and idle — and **not wired**: `wiring.ts` constructs `DeterministicModelClient` in every path, so the service has no code that builds a Bedrock client with or without credentials (found P79). Credentials are necessary and not sufficient |
| **4** | **An account** — QA HE sandbox, or a consenting applicant | You | The controlled live run |
| **5** | ~~**B5 — hold or pass through**~~ | — | **Decided A — hold and reuse, 2026-09-07 (ADR-0078).** Documents are stored and reused; a student is never asked for the same document twice |
| **6** | ~~**B1 — twelve retention determinations**~~ | — | **All twelve answered, 2026-09-07 (ADR-0078).** Eleven periods set in schedule `1.2026-09-07`; row 12 (`bank_statement`) stays unresolved and blocking by ADR-0021 |
| **7** | ~~**B2 — the ADR-0022 lawful basis**~~ | — | **Answered 2026-09-08 by Vahid Mohammadi (ADR-0087).** Four determinations, review 2027-09-08. Ten of seventy (type, purpose) pairs now pass both storage gates. The one pair ADR-0087 left open — `other / audit_evidence` — was **decided-refused** on the same day (ADR-0088). The vault still does not open — what remains is transport, an implementation and a deployable, none of which is a decision |
| **8** | **DPA 2018 Sch. 1 appropriate policy document** | The DPIA owner | **Nothing today — and it is a live constraint, not a closed one.** `national_id` was the only special-category document type in scope and it was removed in ADR-0089, so no processing currently needs this. It binds again the moment one is added: **the document must exist BEFORE that processing**, which is why ADR-0089 puts the requirement at the `DocumentType` union itself and not only in an ADR |
| **16** | ~~**Billing alerts, one S3 bucket, the vault's CMK and a prefix-scoped credential, to verify the checksum binding AND SSE-KMS through a pre-signed PUT**~~ | — | **Created by you and run on 2026-09-09; VERIFIED on both halves (ADR-0092 §4, *Run 2026-09-09*).** The first run said REFUTED because the SDK hoisted the checksum into the query string, where S3 never reads it — your reading: *"the run refuted the property under the SDK's default presign, not the property itself."* The second run, with the checksum a signed header, established all three things you asked for: a mismatched body is refused (400 `BadDigest`), an uploader who omits or alters the header is refused (403 `SignatureDoesNotMatch`), and SSE-KMS holds with the binding in place. **The port is still untouched** — the reshaping starts on your word, and carries the constraint that the checksum is a signed header, never a query parameter |
| **17** | **The vault's service role, the bucket's CORS rule and its lifecycle** | You — AWS spend is your act | **The transport in production (ADR-0094).** The service starts with the transport once four variables are set; what its role must be allowed, what CORS the page's origin needs, and what lifecycle the bucket should and should not have: `docs/provisioning-request-document-vault.md`. Nothing has been created by the agent. The first request this service makes to AWS is on your deployment |
| **18** | ~~**The gate's reason on the wire — two of your rules disagree**~~ | — | **Closed by Vahid, 2026-09-10 (ADR-0098):** *"The contract's Problem stays without detail. Close the gap the way P41 closed its own: a closed set of refusal codes, each with wording written for the student and covered by the wording-coverage guard."* Done in P65: three codes, words on the page, every `detail` off the wire, and a guard. He asked to be told if a gate's refusal could not be expressed as a code; all five could |
| **19** | ~~**The runner performs `create_account` only — execute work has no production performer**~~ | — | **Decided 2026-09-10 (ADR-0101).** A1 built in P69: the yes comes before the password and the account. The detection of a CAPTCHA or second factor built in P70; A2 (one sitting, in memory, five minutes) built in P71; B (`portal_sign_in` as the resume path only) built in P72. Open portals refused explicitly; C recorded as the plan for a second-factor portal. The row that follows is the record as it stood when it was found. **Was:** | **Found in P66 (ADR-0099).** `apps/browser-runner/src/main.ts` answers `needs_the_student` to every work kind but `create_account`. `fillApplication` — the thing that fills and saves a page — is called by `scripts/journey.test.ts` and by no deployable, and it is now in the register as declared-but-unreachable. The reason is a design nobody has made: the browser session an account was created in does not survive to the next work item, and the password that would sign in again was single-use and is gone (ADR-0042). A second gap sits behind it: for a portal with no login, execute work is never handed out at all, because `ClaimedWork` carries an account's email and approach (ADR-0045) and `accountDetail` answers null with neither. The attachment path's slices d and e wait on this; the transport, the gates and the hand-over do not. Two things need your word: whether a runner may hold a signed-in session across work items (and where its credential comes from), and whether a portal with no login is a route this product serves. **Framed as a decision sheet in P68 — [`decision-sheet-blocker-19-how-a-runner-is-signed-in.md`](./decision-sheet-blocker-19-how-a-runner-is-signed-in.md)**: five options costed, a recommendation (one signed-in sitting with authorisation moved first; a second ask through the secure box as the resume path; co-browsing deferred; a persisted cookie rejected), and four questions in §7 |
| **20** | **A field the portal asks for that our rules forbid us to hold** — Sheffield's equal-opportunities page: eleven disability checkboxes, a support-needs box, an ethnic-origin select (Article 9). Sheet: [`decision-sheet-article-9-fields-a-portal-asks-for.md`](./decision-sheet-article-9-fields-a-portal-asks-for.md) | **Decided by Vahid, 2026-09-11, and built in P86 (ADR-0102)**: the empty save is refused, so *"use the refusal the form offers"* — never presented as the student's answer — with the three conditions enforced at the mapping boundary, in the plan and in the preview. Both values confirmed *Prefer not to say* from the live dropdown, his correction recorded. The equal-opportunities mapping set and the classified draft are written for Iman Behravan's review (`review-pack.md`) | The review: 23 judgement rows, 193 mechanical, the page's two refusals |
| **22** | ~~**A page is saved when the portal shows it, not when a control is pressed**~~ — Sheet: [`decision-sheet-blocker-22-a-page-is-saved-when-the-portal-shows-it.md`](./decision-sheet-blocker-22-a-page-is-saved-when-the-portal-shows-it.md) | — | **Decided by Vahid, 2026-09-12 (ADR-0106):** *"Nine looks per application on a portal with nothing to read is the honest price and I would rather pay it than report a success we cannot see."* Built in P105: reopen-and-read, the listing count, the slot marker; `uncertain` and no transmission where none holds. Left for a later phase: the intervention's text does not yet say which field was not seen |
| **23** | ~~**A companion the page will not save without**~~ — Sheet: [`decision-sheet-blocker-23-a-companion-the-page-will-not-save-without.md`](./decision-sheet-blocker-23-a-companion-the-page-will-not-save-without.md) | — | **Decided A by Vahid, 2026-09-12 (ADR-0107):** *"'I will upload this later' is not a claim about the document, it is a statement about when."* Built in P106. On Sheffield the six defer values wait on a copy of the education fieldset, since the capture holds one radio value three times over |
| **24** | **The deferred state after the handover** — a student who authorised *later* has an application with something outstanding, and today the system tells them once at the handover and records nothing, holds no incomplete state, cannot check, and cannot reach them afterwards. Raised by Vahid, 2026-09-12: *"It is the difference between a student who knows what they owe and one who finds out from a rejection."* Sheet: [`decision-sheet-blocker-24-the-deferred-state-after-the-handover.md`](./decision-sheet-blocker-24-the-deferred-state-after-the-handover.md) | You — in your words; then me | Every application with a handed slot, on every portal. Options priced: A, the outstanding items as a durable record on the case, closed by the student's word (recommended as the floor); B, A plus a reminder the student agreed to, which needs a channel to the student this system does not have; C, a better sentence |
| **21** | ~~**A document per item of a repeating page, and a condition inside one**~~ — Sheet: [`decision-sheet-blocker-21-a-document-per-item-of-a-repeating-page.md`](./decision-sheet-blocker-21-a-document-per-item-of-a-repeating-page.md) | — | **Decided by Vahid, 2026-09-11, and built in P98 (ADR-0104): B, with the per-item condition.** *"C is out. The education page is the heart of a university application."* A repeating page's document slots are the student's own act, said under each entry in the preview and at the handover; a condition inside a repeat is answered per item. **A is recorded as an option, not the end state** — his correction of the sheet's *"B now, A when the registry holds education"*: *"that is a product decision I have not made and am not making by answering this sheet."* The Sheffield education page is marked repeating with its six slots left to the student |
| **9** | ~~**`attach_document` intent identity**~~ | — | **Done in P73 (ADR-0069's built note).** One intent per upload at the claim, keyed `page/field=documentId@hash`, settled from the runner's report for this run's case only, with `document_transmissions` as the record of what left. No new `WorkKind` was needed: an attachment is part of the page item that carries it. Proved against a served page in P74 |
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

**2,527 tests · 130 files · zero skipped · zero pending**, run against real PostgreSQL 16 and real
Redis (`--save "" --appendonly no --maxmemory-policy noeviction`). `pnpm run verify` chains
typecheck → lint → dependency boundaries → version check → tests; CI runs it plus a separate
integration job.

**Two lanes since P47** (ADR-0081). `vitest.workspace.ts` runs the sixteen browser files one at a
time and everything else in parallel, because three or four browsers landing together on a four-CPU
container starved pages past a twenty-second poll and failed two full runs in five — each on a
different test, each of which passed 4/4 alone. Peak Chromium processes 21 → 7, peak load 5.13 →
3.13, wall time 119s → 176s. No assertion or timeout was changed to buy it.

<!-- census:begin — generated by `pnpm run census`, do not edit by hand -->

**2,527 tests**, by the workspace they live in. Generated — run
`pnpm run census` after changing the suite. The rows and *everything else* sum to the total
exactly; the figure this replaced was approximate and had drifted 136 tests without anyone
being able to see it (ADR-0084).

| Area | Tests | Area | Tests |
|---|---|---|---|
| `apps/conversation-service` | 413 | `packages/mapping` | 62 |
| `packages/domain` | 376 | `packages/conversation` | 52 |
| `scripts` | 306 | `packages/preparation` | 52 |
| `apps/browser-runner` | 295 | `packages/profile` | 49 |
| `packages/case-store` | 145 | `packages/disclosure` | 47 |
| `packages/orchestrator` | 122 | `packages/catalogue` | 45 |
| `packages/documents` | 100 | `packages/extraction` | 27 |
| `packages/contracts` | 90 | `packages/interview` | 22 |
| `apps/secure-service` | 68 | `packages/requirements` | 22 |
| `packages/secrets` | 67 | `apps/worker` | 21 |
| `packages/account` | 66 | everything else | 80 |

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
