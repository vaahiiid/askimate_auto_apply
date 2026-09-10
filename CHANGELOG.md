# Changelog

All notable changes to this repository are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this repository
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

**One version, locked across every package** — see
[ADR-0027](./docs/decisions/0027-one-version-for-the-whole-repository.md) for why, and
`scripts/version.ts` for the mechanism. The authoritative source is the root `package.json`, and
`pnpm run verify` fails if any manifest has drifted from it.

**Nothing in this repository has been released or deployed.** Versions mark states of the source,
not shipped artefacts.

---

## [Unreleased]

---

## [0.86.0] — 2026-09-10

**P69 — blocker 19 decided: the yes comes first (ADR-0101).** Vahid's six answers to the
decision sheet, recorded verbatim, and A1 built.

### Changed

- `nextStep` (orchestrator): the account step's refusals are returned before the authorisation
  and its asks after it. Order now: interview → validate → authorise → request_secret →
  create_account → execute → hand_over_account. The handover is consulted before the
  authorisation, because a stopped run still owes the account back.
- The journey starts at the yes: the student approves over the real decision route and only then
  is asked for a password, in the real frame; the account and the fill follow.
- Tests that assumed the old order — orchestrator, run driver, runner supervisor — now start from
  an authorised run (`pastTheYes`, `authorised`); the supervisor's seeded runs stand on a
  verifying portal.

### Recorded

- ADR-0101: A1 yes; A2 yes, in memory, five minutes matching ADR-0034 ("do not quietly widen
  it"); B yes, `portal_sign_in` single use as the resume path only, with the
  phishing-normalisation argument a future phase must meet; open portals refused explicitly; C
  recorded as the plan for a second-factor portal; D no. And the requirement not on the sheet:
  detect a CAPTCHA or second factor and stop saying which, before slices d and e.
- The decision sheet marked decided; blocker 19 closed; ADR-0049, ADR-0050 amended.

### Not built

A2 (P71), B (P72), the detection (P70), C.

---

## [0.85.0] — 2026-09-10

**P68 — blocker 19 framed as a decision sheet.**
[`docs/decision-sheet-blocker-19-how-a-runner-is-signed-in.md`](./docs/decision-sheet-blocker-19-how-a-runner-is-signed-in.md):
how a runner is signed in when execute work arrives. What the tree already does; five options
costed (one signed-in sitting with `authorise` moved first; a second ask through the secure box as
`portal_sign_in`; co-browsing, the only honest form of a handed-off session; a persisted cookie,
rejected; password reset, recovery only); a side-by-side table; a recommendation; the open-portal
fraction stated as unmeasured, with two ways to measure it; four questions for Vahid. Documents
only. Nothing built, nothing provisioned.

---

## [0.84.0] — 2026-09-10

**P67 — the page decides whether it can show the secure step before it asks for the capability
(ADR-0100).** The two browser-level properties ADR-0086 left open, rebuilt against the production
page inside the journey's real secure step.

### Added

- `journey.ts` consults `decideRendering` BEFORE `bootstrapSecureStep`, over three observed
  capabilities: this build, `window.isSecureContext`, and a `no-cors` probe of the secure origin.
  A refusal is `<p id="secure-refusal" data-reason>` with the fixed sentence for its code; no frame
  is mounted and nothing is cancelled. The page's one clock is handed to `start` by its entry point.
- `GET /v1/secure-origin` — where the secure plane is, on a student's session, minting nothing;
  published in `conversation.v1.yaml`. `readSecureOrigin` and `probeSecureOrigin` in the transport.
- `secureControlPath` in `packages/contracts` — the frame's path, held to `secure.v1.yaml` by the
  contract-drift guard.
- `scripts/journey.test.ts` builds and serves the real student page and the real secure control,
  opens the student's own browser on the page, types the password into the REAL cross-origin frame,
  and delivers the receipt through the real outbox. Two properties inside that step: *REFUSES to
  open the password box on an insecure page, and mints NOTHING* (no bootstrap request, `frame_tokens`
  unchanged) and *takes the student's password through the REAL frame, and no postMessage carries
  it* (the captured messages carry `ready`, `secret_received` and the request id, and not the
  password). The browser's requests are recorded on the same `wire` as the services'.
- `student-client.test.ts` asserts the `endpoint_unreachable` refusal on the real path.

### Fixed

- **The page framed a path the Secure Plane does not serve.** Since P25 the frame's `src` was
  `/v1/secret-requests/{id}/control`; the service serves `/control/{id}`. A 404 on the production
  path for forty-two phases, unseen because the page is not a router and the journey typed by
  `fetch`.
- The state document's header: thirteen browser files, one hundred decision records, and the AWS
  line the README already carried.

### Removed

- `typeThePassword` — the journey's `fetch`-shaped stand-in for the student.

---

## [0.83.0] — 2026-09-10

**P66 — uploads cross as references, and the plane hands a document over only after the gates
(ADR-0099).** Slice c of the attachment path.

### Added

- `StoredUpload` / `TransportedUpload`: an upload crosses to the runner as which box, which document
  the reviewed mapping named, and where the box is — no bytes, no document id, no hash; the parser
  refuses a fifth field. `toStoredPlan` no longer refuses `has_uploads`; a page whose only box is a
  file input is a page to fill.
- `POST /internal/v1/work/{runId}/documents/{documentRef}` and `RunDriver.documentForWork`: six
  ordered checks — the lease, the run at execute naming this upload, the captured authorisation
  still hashing to the preview rendered NOW, `authoriseDisclosure` over a record built from what
  the student saw (determination 3; a minor-held case passes an empty condition set and is
  refused as undetermined), `mayTransmit` WITH THE CASE, then a sixty-second retrieval URL. Nine
  refusals in the driver, four codes on the wire, no sentence.
- `WorkDocument`, `WireDisclosure`, `WorkDocumentRequest`, `parseWorkDocument`; both published in
  `conversation.v1.yaml`.
- `documentSourceFor` in the runner: asks the plane under the lease, refuses a record about
  another case before fetching, fetches once, hashes, refuses a determination its own register
  does not hold, and mints the `DisclosureAuthorisation` brand through `authoriseDisclosure` —
  never a cast. `fillApplication` requires a `DocumentSource`. The runner depends on
  `@askimate/aas-disclosure`.
- `RunDriverOptions.disclosure` and `DriverWiring.disclosure`; the service builds the document
  transport before the driver and threads its register and vault.
- Tests: the runner's source (seven), the contract parser, the route (every refusal mapped, no
  `detail`), the plane-side hand-over against Postgres, the transport round trip with uploads.

### Changed

- `authoriseDisclosure` leaves the declared-but-unreachable register: `documentForWork` is its
  production caller. `fillApplication` enters it — see below. The count stays six.

### Found, not resolved

- **The runner's entry point performs `create_account` only.** Execute work has no production
  performer and never had; `fillApplication` is called by the journey test and by no deployable.
  Behind it: for a portal with no login, execute work is never handed out at all. Blocker 19,
  Vahid's.

### Not built

Slice d (the entry point performing execute work with this source) and slice e (the
`attach_document` intent; the `TransmissionRecord` from the runner's report). No
`WithdrawalRecord` producer. Nothing ran against AWS. Declared-but-unreachable: six.

---

## [0.82.0] — 2026-09-10

**P65 — one yes over a preview that names each attachment, and the gates refuse in a closed set
(ADR-0098).** Vahid's two decisions of 2026-09-10, recorded verbatim, and built.

### Added

- `renderPreview` names each attachment plainly under *Documents that will be sent:* — which
  document, going where (institution and portal host), for what (the form's label, this application
  by course and intake). His condition, in his words: *"'Your documents will be sent' is not a
  preview."*
- `SubmissionPreview.portalHost`, derived from the blueprint's first observed URL and INSIDE the
  content hash: ADR-0022's "where" is part of the yes, and a re-pointed application voids it. A
  blueprint that observed no URL cannot be previewed (`destination_unknown`).
- Three problem codes for the storage gates — `document_not_retainable`,
  `document_basis_undetermined`, `document_type_refused` — in the vocabulary, both OpenAPI documents,
  the titles and statuses, and `REFUSALS` on the page. Each is 403.
- `scripts/no-free-text-on-the-wire.test.ts` — refuses a `detail:` member in any route file of any
  process that answers a problem document.
- Tests: the destination changes the hash; no URL, no preview; each gate refusal answers its code
  and no `detail`; the driver's authorisation preview names the passport, the host and the
  application.

### Removed

- Every `detail` from the wire in the Conversation Service: the four document-route ones, the
  `validation_failed` on `/purpose`, and two hand-rolled problem documents older than the transport
  (the ambiguous-target 409 and `content_changed`). The contract's parser had dropped them all along.

### Not built

Slices c–e of the attachment path. Nothing is sent. Declared-but-unreachable: six, unchanged.

---

## [0.81.0] — 2026-09-10

**P64 — the preview names what the student holds (ADR-0097).** Slice a of the attachment path.

### Added

- `RunDriverOptions.heldDocuments` and `previewDocumentsOf` — the driver builds the preview's
  document map from the vault's metadata store, keyed by document type: one per type, the current
  one, never a superseded or purged record. Wired in `buildRunDriver`, so the service and the worker
  name the same documents.
- The state document's §2 replaced with the measured attachment path: five cuts in the code, the
  five slices that close them in dependency order, and the gate each keeps.
- Tests: a run whose student holds a passport reaches `authorise` with it named in the preview
  (Postgres); the current-not-superseded choice (pure); the measurement test that asserted the
  empty map now asserts the driver names no vault method that yields bytes.

### Changed

- `PreviewDocument.filename` → `describedAs`. The vault records no filename; the preview names the
  document type the reviewed mapping named.

### Not built

Slices b–e. Nothing is sent: `toStoredPlan` still refuses uploads and `mayTransmit` is untouched.
Slice b waits for Vahid's word on whether one `authorise` over a preview naming every attachment is
the specific authorisation determination 3 means.

---

## [0.80.0] — 2026-09-10

**P63 — expired document intakes are swept by the worker (ADR-0096).**

The last of the three things ADR-0094 left unbuilt. An intake nobody came back to confirm is a row
that holds no byte and no fact the conversation log lacks; the worker now removes it.

### Added

- `apps/conversation-service/migrations/0018_sweep_document_intakes_job.sql` — the closed
  `job_kind` vocabulary widened by one, the way migration 0015 did it.
- `sweepExpiredIntakes(pool, now, batch)` — one bounded DELETE, oldest first, idempotent on the
  same clock. Exported from the service package for the worker; the service's own path is still
  `take`, per intake.
- `apps/worker`: the `sweep_document_intakes` job, `DEFAULT_SWEEP_MS = 60 000`,
  `AAS_WORKER_SWEEP_MS`, `swept` in `runOnce`, a startup line naming the interval. Held under the
  same lease discipline as the other three jobs.
- ADR-0052 §13.1's interval table gains the row, dated.
- Tests: three in `document-store.test.ts` (only the expired go, bounded oldest-first, racing
  `take` is not a race); three in `worker.test.ts` (under a lease with the count, a second worker
  sweeps nothing, the lease is released on stop). The worker's test writes its abandoned rows by
  hand: the app is forbidden the documents package, and a test that imported it would be the
  undeclared dependency wearing a passing test's clothes.

### Not built

The retention sweep — `purgeContents` still has no caller, and its first row's clock (`last_used`)
needs a use to exist before it can start. The runner's fetch. Declared-but-unreachable: six,
unchanged.

---

## [0.79.0] — 2026-09-10

**P62 — the student's page makes the PUT, and the CORS rule is exercised by the PUT it makes
(ADR-0095).**

The first thing ADR-0094 left unbuilt. The page has a document panel: the student chooses a type
from the server's list and a file, and the page hashes the file, declares the hash, PUTs the bytes to
the bucket on the URL the declaration answered with, confirms, and re-reads what is held. The bytes
never touch this service, and the browser test asserts that from the page's own request log.

### Added

- `journey.ts` — the document panel, built once and kept across draws so a server-triggered redraw
  does not empty the file input; `sendDocument` (hash, declare, PUT, confirm, re-read); the header's
  stated exception: the upload's SHA-256 is the ONE hash this page computes, because under
  ADR-0092 the server never sees the bytes, and what the page computes is checked by the bucket and
  the confirm rather than trusted.
- `transport.ts` — `readDocuments`, `declareDocument`, `putDocument` (the one absolute, cross-origin
  call in the file, carrying no cookie), `confirmDocument`.
- `GET /v1/conversations/{conversationId}/documents` — what this STUDENT holds (documents are held
  for reuse across applications, B5) and the document types the governing schedule has a row for.
  Published as `HeldDocuments`; the page draws its panel from this read and nothing else.
- The purpose is derived by the server: `purpose` is optional in `DocumentUploadDeclaration`, and
  when omitted the route takes the one policy row the governing schedule holds for the type, or
  answers 400 on `/purpose`. The page never sends one — why the system holds a document is the
  controller's decision per row (ADR-0087), not the student's to pick from a menu.
- `InMemoryObjectStore(bucket, origin?)`; `InMemoryDocumentIntakePort` takes a vault.
- Tests: four route cases (`document-routes.test.ts`); three browser cases in
  `student-client.test.ts` against a real HTTPS bucket on a second loopback origin whose preflight
  admits **exactly the CORS rule parsed out of `docs/provisioning-request-document-vault.md`** —
  the page's PUT is proved against the rule as written, with a real preflight, and a refused
  declaration is proved to reach the bucket with nothing.

- `scripts/decided-blockers-are-not-pending.test.ts` — refuses a decided blocker (B1, B2, B5, as
  data with the record that decided each) in dependency framing, across every record that describes
  the present: ADRs from 0078, the provisioning requests, the state document, the README, the
  reachability register. The journal and the changelog are not scanned; they record what was true
  at the time. It found the sixth instance by itself: the correction note that quoted the stale
  phrase.

### Changed

- `content_hash_mismatch`, `intake_not_open` and `upload_not_received` moved from
  `CANNOT_REACH_THIS_PAGE` to `REFUSALS`, each worded as something the student can do — the visible
  act ADR-0090 said would mark the upload surface landing.
- `StoredDocument` carries the declared content type, the size and `uploadedAt`; the confirm and
  the listing answer the same shape.

### Fixed

- **A decided blocker written up as a dependency — the twelfth finding of that shape.** Vahid,
  reading P61's report: *"you wrote 'The runner's fetch, which waits on B5.' B5 was answered on
  2026-09-07 … Either that is a stale reference of the shape this repository has found eleven times
  running, or there is a dependency I have lost track of. Check which, and say plainly."* Stale. Five
  places said something "waits on" or "is blocked on" B5 — ADR-0093, ADR-0094, the vault
  provisioning request, the reachability register's `authoriseDisclosure` entry, and a "not built"
  bullet in the state document that also still said there was no `documents` table. All corrected to
  what actually gates the runner's fetch: `attach_document` becoming reachable, which needs the
  attachment intent identity ADR-0069 names and a `WorkKind` that can carry it (blocker 9). No
  dependency was lost.
- Two present-tense statements that a bucket and a key made stale: the README's "Infrastructure
  provisioned: None, $0 spent" and the state document's §8 "Provisioned: Nothing". Both now say what
  Vahid created on 2026-09-09 and that the spend is the billing console's to state.
- **`PostgresDocumentIntakePort` read the wall clock, and its `take` did not spend an expired
  row.** Found by the date rolling over: tests whose fixtures were fixed at 2026-09-09 passed all
  afternoon and failed on 2026-09-10, because the class called `new Date()` itself and an intake
  "opened" at a fixed instant was by then sixteen hours expired. The clock is now injected, as
  everywhere else in the service. The same failure showed that `… AND expires_at > $now` in the
  DELETE's WHERE clause hid an expired row rather than removing it — a take at an earlier clock
  could still find it — while the migration's comment said "removed by the same statement". The
  DELETE now takes the row by id and the code refuses it when expired, so an expired row is spent,
  as the comment always said. ADR-0094's description of the statement is corrected in place, dated.
  `s3-document-vault.test.ts` opens its intake on the wall clock deliberately, because the SDK stamps
  `X-Amz-Date` with the real time and the mint refuses a URL that outlives its intake.

### Found, not resolved

- **The gate's reason on the wire.** The storage gates write a `detail` for a person (ADR-0075) and
  the declaration route sends it; the contract's `Problem` has no `detail` by Vahid's rule of
  2026-08-28 (*"closed, explicit contracts"*) and its parser drops it. The page words a refused
  document per code. Blocker 18 in the state document; both rules are his.

### Not built

The retention sweep; the runner's fetch; a document the interview asks for (`request_document` is
unreachable through the driver, ADR-0064 §4). Nothing ran against AWS. Declared-but-unreachable:
six, unchanged.

---

## [0.78.0] — 2026-09-09

**P61 — document metadata is durable, and the transport starts in production (ADR-0094).**

The first thing ADR-0093 left unbuilt. Intakes and document records move from Maps into the
conversation database; the entry point builds the transport from the environment; the process
starts with it, or without it and answers 503.

### Added

- `apps/conversation-service/migrations/0017_documents.sql` — `document_intakes` and `documents`.
  No column of any type that could hold a document's contents, asserted on the file's text and, at
  startup, on `information_schema`. A purged record names when; a superseded one names what.
- `PostgresDocumentIntakePort` — `take` is one `DELETE … RETURNING` (three racing takes, one wins;
  an expired row is never returned) and **re-runs the gates** on the schedule in force, so a
  schedule that stopped permitting the document between declare and confirm refuses the confirm.
- `DocumentRecordStore` (`document-record-store.ts`) with Postgres and in-memory implementations;
  `S3DocumentVault` over it, with `durable`; `purgeContents` deletes the object before the record.
- `readDocumentsConfig` — `AAS_DOCUMENTS_BUCKET`, `AAS_DOCUMENTS_KMS_KEY_ARN` (must be an ARN),
  `AAS_RETENTION_SCHEDULE_DIR`, optional `AAS_DOCUMENTS_REGION` (`eu-west-2` only). All or none.
- `loadGoverningSchedule` and `buildDocumentPort` in `wiring.ts`; `main.ts` builds and reports
  `documents=s3` or `none`.
- `parseRetentionSchedule` in `packages/domain` — the parser moved out of `retention-status.ts`
  so the service and the script read a schedule the same way.
- `docs/provisioning-request-document-vault.md` — the service role's policy, the CORS rule, the
  lifecycle, the variables, the cost, the reach.
- Tests: `document-store.test.ts` (17, against Postgres), `config.test.ts` (5), two startup cases.

### Changed

- `assertDocumentStoreIsDurable` refuses three things and names which: an in-memory intake store,
  an in-memory vault, an S3 vault whose metadata store is in memory.

### Not built

The client's upload control (the CORS rule's first exercise); the retention sweep; the runner's
fetch; an intake sweep beyond delete-on-take. Nothing ran against AWS. Declared-but-unreachable:
six, unchanged.

---

## [0.77.0] — 2026-09-09

**P60 — an upload URL cannot be minted unbound (ADR-0093). The port is reshaped.**

Vahid, on the run: *"Both halves VERIFIED. Condition 1 of ADR-0092 is met. Reshape the port. The
constraint you found is the important output of this, more than the verdict: the property holds only
when the checksum is a signed header the browser sends, and the SDK's default hoists it into the
query string where S3 never reads it. Make that structural in the minting code, not a note in the
ADR … If it can be made impossible to mint an upload URL without that header signed, do that."*

### Added

- `packages/documents/src/bound-upload.ts` — `BoundUploadUrl`, a branded type with one producer.
  `mintBoundUpload` computes the checksum header from the intake, names the headers the presigner
  must not hoist, and **reads the URL back**: hoisted checksum, uncovered header, non-https, no
  expiry, or an expiry past the intake, and it throws `UnboundUploadError` instead of returning.
  `receiveUpload` is the read-back on the other end — the only producer of the `ReceivedUpload` a
  record is written from. 18 tests.
- `apps/conversation-service/src/s3-document-vault.ts` — the S3 + KMS vault, minted from the process
  ADR-0092 says mints it. Its test presigns with the REAL SDK offline, both the adapter's way and
  the SDK's default, and shows the mint accepting the one and refusing the other. 9 tests.
- `InMemoryObjectStore` — an in-memory bucket that refuses what the run saw S3 refuse: the
  substitution (`BadDigest`), the header omitted or altered (`SignatureDoesNotMatch`), an expired
  URL, a forged signature.
- `POST /v1/conversations/{id}/documents/{intakeId}/confirm`, and the problem code
  `upload_not_received`.

### Changed

- `DocumentVault` has no method that takes or returns bytes: `prepareUpload`, `confirmUpload` and
  `prepareRetrieval` replace `store` and `retrieve`. The declaration's response carries `upload:
  { url, method, headers, expiresAt }`.
- `document-routes.test.ts` — 20 tests around the new shape, over an in-memory bucket.
- The reachability register: `purgeContents` gained an implementation, not a caller; the reasons
  on it and on `authoriseDisclosure` say what is now true.

### Removed

- `PUT /v1/conversations/{id}/documents/{intakeId}/content`, `acceptBytes`, `AcceptedBytes`, and
  `express.raw` from the Conversation Service — **no route on it reads a non-JSON body.**

### Not built

Durable document metadata and production wiring of the S3 vault (the in-memory intake port keeps its
production refusal); CORS on the bucket; the retrieval's caller. Content-type is not bound by the
upload URL and is not trusted from the bucket. Declared-but-unreachable: six, unchanged.

**P59 — the verification ran. Binding VERIFIED, SSE-KMS VERIFIED, with the checksum a signed header.**

Two runs on 2026-09-09 against the bucket Vahid created (ADR-0092 §4, *Run 2026-09-09*). The first
said **binding REFUTED**: the SDK had hoisted `x-amz-checksum-sha256` into the query string, where
S3 never reads it — no checksum stored, bound and unbound URLs identical. Vahid: *"The run refuted
the property under the SDK's default presign, not the property itself. … Treating that as final would
have abandoned D over a client-side hoisting default."* The second run, with the header signed,
said **VERIFIED on both halves** and exited 0. The port is untouched; the reshaping starts on his word.

### Changed

- `scripts/verify-s3-checksum.ts` — the checksum header is unhoistable: signed into the URL, sent by
  the uploader, covered by the signature. Three experiments added for the three things he asked the
  run to establish: **E6** the uploader omits the header, **E7** the uploader alters it to match the
  substituted body, **E8** the substitution under the SSE-KMS URL. The binding is VERIFIED only if
  E6 and E7 are refused as well, and REFUTED if any of E2/E6/E7/E8 is accepted; the KMS half is
  VERIFIED only *with both in place* — `aws:kms` on HEAD **and** E8 refused — and NOT CHECKED if E8
  did not run. Each observation records how the checksum travelled and which headers were signed, so
  the two runs read side by side. E8 runs only when E5 succeeded, so a KMS refusal is never mistaken
  for a binding refusal.
- `scripts/verify-s3-checksum.test.ts` — five more judgement tests: omitted-header accepted →
  REFUTED; altered-header accepted → REFUTED; E6/E7 missing → NOT CHECKED; KMS applied but E8 untried
  or incomplete → NOT CHECKED with the binding standing on its own; substitution accepted under the
  KMS URL → both verdicts refuted, the KMS reason saying the encryption itself worked.
- ADR-0092 §4 — the two runs, the outcome, Vahid's words, and the one constraint the port carries
  when reshaped: the checksum is a signed header, never a query parameter. §2 — created by Vahid.
- `docs/provisioning-request-s3-verification.md` §6 and `docs/state-of-the-system.md` blocker 16 —
  closed by the run; port still untouched.

- `scripts/verify-s3-checksum.ts` reads the temporary credential from `AAS_S3_VERIFY_ACCESS_KEY_ID`,
  `AAS_S3_VERIFY_SECRET_ACCESS_KEY` and `AAS_S3_VERIFY_SESSION_TOKEN`, handed to its clients
  explicitly, and never consults the SDK's default chain: the sandbox injects placeholder `AWS_*`
  values of its own and precedence against the environment's is undocumented. Without all three it
  refuses before any request; a test populates `AWS_*` with junk and proves no fallback.
- `docs/provisioning-request-s3-verification.md` — the three credential names; where the variables
  go so they never enter the repository, a file in it, or a log (the cloud environment's
  *Environment variables* field, copied once at session start, so a running session does not see
  them); the two-session order; Vahid's note that an exposed temporary credential was revoked with
  nothing created.

### Fixed

- `apps/conversation-service/src/document-routes.test.ts` listened on fixed ports 45617 and 45618,
  inside Linux's ephemeral range (32768–60999), where the kernel hands out source ports to every
  outbound connection the suite makes. CI run #143 lost that race: `listen(45618)` failed with
  EADDRINUSE, `listening` never fired, and the `service_unavailable` test timed out. Reproduced
  locally by occupying the port; the file now takes its ports from the kernel (`listen(0)`) and
  passes under the same condition. Every other test file already sat below 32768.

---

## [0.76.1] — 2026-09-09

**P59, amended — the SSE-KMS half of the verification is required, and the request is approved.**

Vahid, on reading the provisioning request: *"Provisioning request read and approved. I am creating
it. One change: do section 4 as well, not optionally. The KMS half is not a nice-to-have — ADR-0010
requires the vault to be encrypted with a customer-managed key, and under D the encryption is S3's,
so if a pre-signed PUT cannot carry SSE-KMS under a CMK the uploader has no grant to, then D has a
hole in it."* And: *"Billing alerts first, before any resource. All four thresholds."*

### Changed

- `scripts/verify-s3-checksum.ts` — `AAS_S3_VERIFY_KMS_KEY_ID` is required. Without it the command
  refuses before any request, says the half is required, and writes no record. E5 runs on every run.
  The exit code is zero only when **both** verdicts are VERIFIED. A KMS refusal's reason names it as
  a different problem from the checksum binding, per *"named as such rather than folded in."*
- `scripts/verify-s3-checksum.test.ts` — two more tests: the KMS refusal is named as a different
  problem and the binding's reason does not absorb it; and the bucket-without-key refusal exits 1,
  reports "Nothing was sent to AWS", and writes no record.
- `docs/provisioning-request-s3-verification.md` — §0 billing alerts before any resource; the CMK
  and the credential's single KMS action added to §1; the key variable required; §4 retitled
  *required* with his words; §5 rewritten for four outcomes, nothing running until he says so.
- ADR-0092 §4 and `docs/state-of-the-system.md` blocker 16 — the amendment and the approval, quoted.

### Not done

Nothing has run against AWS and nothing has been created. *"I will tell you when the environment
variables are set. Do not run anything until then, and do not create anything yourself."*

---

## [0.76.0] — 2026-09-09

**P59 — the document never enters a process we run (ADR-0092).**

The durable document store, decided by Vahid in his own words:

> D. In my own words: the conversation service runs the gates, then mints a pre-signed upload rather
> than accepting bytes, and the document never enters any process we run.

### How it was reached · a control that worked

The obvious durable store encrypts in-process and needs the key providers in `packages/secrets`.
`check-boundaries.ts` **failed the build** rather than let the conversation plane depend on the
package that holds the only plaintext password. Recorded, at Vahid's instruction, *"as what it was —
a real control that stopped a wrong design early, not an obstacle that was routed around."*

### Considered and not taken, with his reasons

- **A · extract `packages/keys`** — *"under D, SSE-KMS does the encryption and the extraction would be
  thrown-away work."*
- **B · a sixth deployable** — he leaned toward it and asked to be told if he was wrong. The premise
  was: the Phase-0 record has separate *storage with direct upload*, not a separate *service*. The
  argument that decided it: *"B does not deliver its own promise: with the session bound to one
  origin, either we build a new auth mechanism or the conversation service proxies every document —
  which is the exact thing I was trying to prevent. A sixth process that still touches every file is
  worse than no sixth process, because it looks solved."*
- **C · amend the boundary rule** — out. *"Same reasoning as ADR-0080."*

### Added · the verification the decision is conditioned on

D rests on one fact about S3: a pre-signed PUT bound to hash H refuses any body that does not hash
to H. Flagged as unverified from the sandbox; Vahid made the flag a condition — *"verify the S3
checksum enforcement against a real bucket BEFORE reshaping the port around it."*

`pnpm run verify-s3-checksum` is that experiment. Five observations, and a judgement that **cannot
say VERIFIED by accident**: the refusal of a same-length substitution counts only if the bound URL
accepted the right bytes *and an unbound URL accepted the same substitution*, so the refusal is
attributable to the binding and to nothing else. REFUTED needs one observation and answers *"Do not
reshape the port around it."* Without a bucket: NOT CHECKED, exit 1, no record written. The judgement
is tested offline in every branch; a regression removing the control requirement fails exactly the
vacuity guard.

### Added · the provisioning request

`docs/provisioning-request-s3-verification.md` — one bucket in `eu-west-2`, a credential whose whole
reach is three actions on the prefix `verify/*`, cost that rounds to zero against a credit with $0
spent, reach of nothing. **It names no bucket.** Nothing has been created; AWS spend is Vahid's act.

### Not built, deliberately

No change to `packages/documents`, the transport routes, `packages/secrets`, the boundary rules, or
any AWS resource. The S3 SDK and pre-signer are root dev-dependencies for the script; no package
depends on them. The port's new shape is described in the ADR and will not exist until the
verification says VERIFIED.

---

## [0.75.0] — 2026-09-08

**P58 — robots.txt is read, obeyed and kept; requests are paced (ADR-0091).**

The two preconditions Vahid set before any run against a live site, both of which
`docs/target-sheffield-pgt.md` had just measured as absent.

### Added · robots.txt, read before the browser opens

> "The difference between 'we respected the rules' and 'we did not look' is the whole difference if
> anyone ever asks." — Vahid, 2026-09-08

Read over plain HTTP for every host the run may touch, **before anything navigates** — a page load
runs the site's JavaScript, and reading a text file should not execute anything.

| outcome | effect |
|---|---|
| `fetched` | its rules apply |
| `absent` (4xx) — the site says there is no policy | everything allowed |
| `unavailable` (5xx, timeout, network failure) — **we could not ask** | **nothing allowed** |

RFC 9309 §2.3.1.4, and the only reading that satisfies the instruction: a run that could not read the
rules has not respected them.

**Obeying is half of it.** Every run writes `robots.json` — the file verbatim, the host, the status,
the time it was read, the group applied. A crawler that quietly complies leaves no evidence that it
complied.

Applied to **every request**, not only navigations. The cost is recorded rather than hidden: a page
whose stylesheet sits under a disallowed path did not render the way an applicant sees it, and the
run's summary says so in those words.

### Added · a delay floor nothing can lower

`MINIMUM_CRAWL_DELAY_MS = 1000`. A target file may ask for slower; a site's `Crawl-delay` may raise
it further; nothing may lower it. A target asking to go faster is **refused, not clamped** — a person
wrote that number meaning something.

### Fixed · four defects a second guard rule surfaced

- **`portalAttemptedWrite` was `blocked.length > 0`** — so skipping one robots-disallowed stylesheet
  would have reported *"the portal attempts writes during normal browsing"*. A serious finding,
  invented.
- **The CLI never called `summarise()`** — it printed a hard-coded warning, so the blocked log's
  breakdown reached nobody. Three rules are now three findings.
- **The robots fetch assumed `https://${host}`** — right for a real site, wrong for the fixture
  portal's loopback HTTP. The fetch failed, the policy became `unavailable`, and the run correctly
  fetched nothing. **Correct behaviour from a wrong input: it failed closed and looked exactly like
  the rule working.** The origin now comes from the run's own seeds.
- **The crawl-loop check masked the network guard** — a regression deleting the guard left every test
  green. ADR-0082's *"two checks, one reachable"* in a new place; closed by a fixture page
  referencing a disallowed **sub-resource** the loop never sees.

### Added · the sub-resource count, measured

`maxPages` bounds navigations; nothing bounded or counted the CSS, scripts, images and fonts each
page pulls. `RequestTally` counts them — navigations, sub-resources, per-page average, breakdown by
resource type — printed and written to `run.json`. `docs/target-sheffield-pgt.md`'s *"plausibly
1,500–4,000 GETs"* was honest about being a guess; it does not have to be one any more.

### Verification

Four deliberate regressions, each verified from disk and restored from a file copy: an unavailable
robots.txt allowing everything → 2 fail; removing the delay floor → 2; removing the network guard →
**0 until the sub-resource test existed**, then 1; and a disallowed page reaching the visited list is
caught by the run's own output.

**No run has been made.** These are the preconditions; the run is a separate act.

---

## [0.74.0] — 2026-09-08

**P57 — the document transport: the gates run before a byte is accepted (ADR-0090).**

**B4 is answered** — the last of the five blockers ADR-0067 enumerated four weeks ago, and the only
one it called engineering rather than policy: *"There is no route, no schema and no client surface by
which a student could supply a document."*

### Added · a two-step upload, where the split is the control

```
POST /v1/conversations/{id}/documents                      declare it · THE GATES RUN HERE
PUT  /v1/conversations/{id}/documents/{intakeId}/content    the bytes
```

Multipart would have been the obvious shape and has exactly the defect this avoids: the server would
have to **read the body to find out whether it was allowed to.** A refusal that arrives after a
passport has crossed the wire has already failed — the bytes were received, and *"we did not keep
them"* is a claim rather than a structure.

The **type** enforces it, not the order of statements in a handler: `openIntake` takes a
`StorableUpload`, which only `assertStorable` can mint (ADR-0068), and `acceptBytes` returns a
branded `AcceptedBytes` that `vault.store` takes nothing else in place of.

The declaration answer **states** the constraints — the byte ceiling for that type, the accepted
content types, the hash that will be checked, and the retention policy the gate actually resolved —
instead of a client guessing and being refused.

### Added · the bytes must be the ones the gates were run for

The intake carries the SHA-256 the declaration passed the gates with; the content route recomputes it
and refuses a mismatch. Without it a student could declare a two-megabyte personal statement, clear
the gates for one, and send a passport. **ADR-0057 binds an authorisation to exact content by hash
for the same reason, at the other end of the journey.** The same-length substitution is the case that
proves the hash rather than the length is doing the work, and it is tested at both levels.

An intake is spent **once** — read and removed in one operation, because read-then-delete leaves a
window in which two concurrent requests both see it open. An unknown id, an expired one and a spent
one answer `intake_not_open` identically, deliberately: telling a caller which is which would say
what intake ids exist.

`DOCUMENT_LIMITS` is total over `DocumentType` and deliberately unequal — one ceiling for a personal
statement and a multi-page transcript means accepting a 20 MB "personal statement" nobody decided to
accept. Engineering limits, not policy.

### Changed · `assertStorable` is REACHABLE — the register table goes 7 → 6

Declared-but-unreachable since P39, for a reason that was never engineering: every policy blocker in
front of it was open. The register found the move itself and failed the build until the entry was
corrected — *"a stale allow-list is what hides the next one"*. **First entry ever to leave that
table.**

### Not shipped, and refused rather than pretended

The store is **in-memory**, and `assertDocumentStoreIsDurable` throws on `NODE_ENV=production`. One
check, at wiring time, with no configuration check beside it that would make it unreachable — the
mistake ADR-0055 recorded. The durable encrypted store is the next phase; a durable store without the
customer-managed key ADR-0010 requires would be the thing the constraint constrains, shipped without
the constraint.

The student's page has no upload control yet, so `content_hash_mismatch` and `intake_not_open` are in
`CANNOT_REACH_THIS_PAGE` with that reason rather than given wording nobody would see.

### Verification

- **Four deliberate regressions**, each verified from disk and restored from a file copy: remove the
  hash comparison → **2** fail; replace `assertStorable` with a cast → **3** route tests fail *and*
  `pnpm run reachability` fails; make `take` read without removing → **1**; remove the expiry check →
  **2**.
- The expiry regression exposed a **vacuous test of mine**: an assertion that lived only inside a
  `catch`, so deleting the check made it pass. Second such find in two phases, both in tests written
  to prevent exactly it (ADR-0072).
- It also found `unreachable-is-documented.test.ts` **pinning** the unreachable count with a literal
  `/Seven capabilities/` rather than checking it. P49 removed that shape once already; it survived
  here because the number had not moved in nine phases. Computed now, both directions.

### Added · the first target, and what a discovery run would do to it

`docs/target-sheffield-pgt.md` — University of Sheffield PGT, September, direct. Chosen by Vahid for
what it removes from the first blueprint. It records the open question discovery must settle
(**three cases, or one case with three targets?**) with the instruction not to pre-empt it, and a
measured account of what a read-only discovery run does: no account, no submission, `GET`/`HEAD`/
`OPTIONS` only with everything else aborted before it leaves the machine, page visits bounded by
`maxPages` and sub-resources unbounded, no throttling and no `robots.txt` check. **No run has been
made.**

---

## [0.73.0] — 2026-09-08

**P56 — a national ID leaves the supported document types (ADR-0089).**

P55 refused `national_id` at the storage gate. Vahid, reading the result:

> Passport is sufficient for identity. Keeping a document type that is refused at the gate means
> carrying a determination, an Article 9 condition, a consent flow and a policy-document gate for
> something no student can use. **That is unreachable surface with a policy justification attached,
> which is the shape this repository has spent nine phases removing.**

### Removed · the document type, and the two gates that existed for it alone

- `national_id` leaves `DocumentType`, `EXPIRY_THRESHOLDS`, determination 1's scope, determination
  3's scope and the `retention-status` pair list.
- With it: `article9Required`, the two `determineLawfulBasis` refusals that read it,
  `SpecialCategoryConsent`, `SpecialCategoryConsentMissingError`, and the whole Schedule 1 module
  (`appropriate-policy.ts`, `APPROPRIATE_POLICY_DOCUMENTS`, `requireAppropriatePolicy`,
  `PolicyDocumentCleared`).
- `assertStorable` is back to **two** gates, and no longer takes a clock — that parameter existed
  only so a test could put a policy document on either side of its review date.
- `Article9Condition` and the optional `article9` field **stay**: ADR-0022 names them and they
  predate this by fifty-four phases. Their comment now says plainly what they are — **a record, not
  a control** — which was true before P54 too.

### Added · ADR-0089 records what was built, so re-adding starts from the reasoning

*"The determination was correct; it is the document type that is out of scope, not the thinking."*
Recorded in full: the Article 9(2)(a) reasoning; why consent worked there when it fails for the
activity as a whole (the student had a passport as an alternative — the same passport that makes the
type unnecessary); why the condition was scoped to one type rather than flagged; the consent gate's
three checks; why `held` was not a boolean; and the three-month expiry threshold.

**Re-adding it requires the DPA 2018 Sch. 1 appropriate policy document to exist first.** The
constraint did not go away because the code did. The order — document, then the determination's
Article 9 clause, then the consent gate, then the type — is written **at the `DocumentType` union
itself**, because a comment at the line somebody edits is the one that gets read.

### The check made before deleting, and the one thing that looked like a loss

Nothing else uses any of it: ADR-0077's special-category **field** guarantee is about the profile
registry and no extraction plan reads a national ID; the minors gate reads `birth_certificate`; no
blueprint, mapping, catalogue entry or fixture mentions it.

Deleting the Article 9 apparatus appears to leave a future special-category type ungated. It does
not: `DocumentTypeNotCoveredError` refuses any document type no determination names, so a new type
cannot be stored until somebody writes one — **which is exactly the moment these gates have to be
rebuilt**, and ADR-0089 is what they will read.

### Fixed · the schedule parser was casting, not checking

`retention-status.ts` read `policy["documentType"] as DocumentType` — which accepts *any string in
the file* and types it as a lie. A schedule naming a document type the system does not have would
have loaded, validated, and been reported as a configured period. Removing a union member is exactly
the case a cast cannot see; tenth consecutive phase to find a record asserting something production
does not do.

`DOCUMENT_TYPES` and `isDocumentType` are new, written as `satisfies Record<DocumentType, true>`
rather than as an array, because `satisfies readonly DocumentType[]` only checks that each *entry* is
a member — one left out would compile and the check would silently stop covering it.

### Changed · an approved schedule record is reported, not edited

`config/retention/v1.2026-09-07.json` carries `AAS-RET-B1-02`, one of the eleven periods Vahid
determined and approved by name on 2026-09-07. **The file is not edited.** That period did not become
*wrong*, it became *moot*, and an approved version is a record superseded rather than rewritten
(`validateHistory`). `pnpm run retention-status` now prints it under **"Determined, and now out of
scope"** with its reference and version.

The summary line has now been wrong twice in opposite directions one phase apart — "B2 NOT yet
determined" after it was determined, then "four gates" after two were removed. Both were produced by
the fix for the one before.

### Verification

- **Three deliberate regressions**, each verified by reading the mutated file back from disk and each
  restored from a file copy: `national_id` back in the union → **3** tests fail; the parser's cast
  restored → **2**; the type back in determination 1's scope → **3**, across both packages.
- Writing the second found a **vacuous test of my own** — an assertion that passed with the cast
  restored *and* with the check in place, because `national_id` is not in the pair list and both
  paths print the same table. Replaced with a fixture naming an invented document type (ADR-0072).
- **The declared-but-unreachable surface is unchanged at seven**, and the change is subtractive: both
  removed gates lived inside `assertStorable`, whose register entry already said it has no production
  caller.

---

## [0.72.0] — 2026-09-08

**P55 — the Schedule 1 document must exist before the processing (ADR-0088).**

ADR-0087 answered B2 and left two things it deliberately did not settle. Vahid decided both on
2026-09-08, and both are now structural rather than noted.

### Added · `national_id` is refused at the storage gate, and re-enabling it needs a name on it

DPA 2018 Schedule 1 requires an **appropriate policy document** to exist *before* certain
special-category processing. ADR-0087 put a national identity card in scope under Article 9(2)(a),
which turned blocker 8 from hypothetical into live — and the document does not exist.

> Disable `national_id` for now. Passport only. The Article 9 determination stays registered and
> correct, but the appropriate policy document must exist before that processing and it does not, so
> the honest position is that the document type is **not yet available** rather than
> available-and-non-compliant. Make it **structural, not a note**. — Vahid, 2026-09-08

- `packages/disclosure/src/appropriate-policy.ts` — `APPROPRIATE_POLICY_DOCUMENTS`,
  `requireAppropriatePolicy`, `AppropriatePolicyMissingError`, and the branded
  `PolicyDocumentCleared` that only that function can mint.
- **`held` is not a boolean.** It demands a reference, a named confirmer, a confirmation date and a
  review date — the shape a lawful-basis determination and a retention policy already require. A
  `satisfied: false` becomes `true` in one keystroke with no record of what was relied on; this
  cannot.
- **Kept SEPARATE from the determination**, because they have different owners. The determination is
  Vahid's, made and correct; the policy document is the DPIA owner's and outstanding. Folding them
  together would make re-enabling read as a correction to a determination that is not wrong.
- A `held` entry **past its review date is treated as outstanding** — the one staleness rule
  `assertStorable` applies itself, because a `held` entry is minted by no function and printed by no
  report, so a lapse nobody checks there is a lapse nothing checks at all.

### Added · `other / audit_evidence` is **decided**, not open

> The audit record is the transmission record, the preview hash and the authorisation text, not an
> uploaded document. Allowing a document to be stored under that purpose would extend the six-year
> period from a receipt to a passport scan, which is what ADR-0078 was written to prevent. Record it
> as decided, not open. — Vahid, 2026-09-08

- `DECIDED_NOT_TO_DETERMINE` and `DeterminationDecidedAgainstError` give the lawful-basis side the
  third state the retention side has had since ADR-0023. `NoLawfulBasisError` said one thing for two
  facts — an activity awaiting a decision, and an activity whose decision **is** the refusal — and a
  later phase reading the second as the first would close it by registering a determination.
- The refusal a person reads ends **"Do not close this by registering a determination."**
- `financial_evidence` is the control and still reports an *absence*: B1 row 12 is out of scope and
  blocking (ADR-0021, ADR-0079), and nobody has decided either way.

### Changed · `assertStorable` runs four gates and takes a clock

| # | gate | refuses with |
|---|---|---|
| 1 | a configured retention policy | `RetentionPolicyMissingError` · `RetentionRequirementUnresolvedError` |
| 2 | a registered lawful basis | `DeterminationDecidedAgainstError` · `NoLawfulBasisError` · `DocumentTypeNotCoveredError` |
| 3 | the Sch. 1 appropriate policy document | `AppropriatePolicyMissingError` |
| 4 | the separate Article 9 consent | `SpecialCategoryConsentMissingError` |

Gate 3 runs **before** gate 4 on purpose: no consent can substitute for a document that does not
exist, and a developer told to record a consent first would record one and hit the same wall on the
next run. `StorableUpload` now carries the branded `PolicyDocumentCleared`, so a later edit cannot
drop gate 3 and still assemble the object. `now` is a required parameter rather than an ambient
`new Date()`, so a test can put a document type on either side of a review date.

### Fixed · `pnpm run retention-status` still called B2 undetermined

Its summary read *"a registered lawful basis … which this report does not read and which is **NOT
yet determined**."* That became false one phase earlier, by the change that answered B2 — the ninth
consecutive phase to find a record asserting something untrue, this one produced by the fix for the
previous one. It now names the four gates, says B2 is determined, and says which prerequisite is
outstanding. A test asserts the old phrase is gone.

`README.md` carried the same shape: *"Two decisions are waiting on a person and block all document
handling: B5 · B1"*, both answered on 2026-09-07.

### Verification

- **Five deliberate regressions**, each verified by reading the mutated file back from disk and each
  restored from a file copy: removing gate 3 → 5 tests fail; flipping `national_id` to `held` with no
  real document → 9; removing the decided-against check → 3; moving gate 3 behind gate 4 → exactly
  the one ordering test; ignoring the policy document's review date → 3.
- **The declared-but-unreachable surface is unchanged at seven.** Gate 3 lives inside
  `assertStorable`, whose register entry already says it has no production caller; a second entry for
  one of its four checks would answer the register's question at a granularity it does not work at
  (ADR-0082).

---

## [0.71.0] — 2026-09-08

**P54 — the four lawful-basis determinations (ADR-0087).**

### Added · B2 answered — the last policy blocker on documents, open since P31

Four determinations by **Vahid Mohammadi, 2026-09-08**, review **2027-09-08**:

| # | activity | Article 6 | authorisation |
|---|---|---|---|
| 1 | Storing identity documents | (1)(b) contract | not required |
| 2 | Storing academic documents | (1)(b) contract | not required |
| 3 | Disclosing a document to an institution | (1)(b) contract | **required** |
| 4 | A minor's route | (1)(a) consent, from the guardian | **required** |

**Consent is deliberately not the basis for 1, 2 and 3**, on ADR-0022's own reasoning: a student who
cannot get their application submitted without agreeing has not freely given anything, and a record
claiming consent there looks like compliance and is not. `determineLawfulBasis` has refused
consent-without-authorisation since P31; these three avoid it by not naming consent.

**Storing and sending are different acts.** Determination 3 registers ADR-0059's preview, the
authorisation text and ADR-0057's content hash as **required, not optional** — they were built for
this and nothing had ever said they had to be used.

### Added · a national identity card needs a condition, not just a basis

Some carry religion or ethnicity on their face. **ADR-0077 does not cover this**: it made a
special-category *field* unextractable, and holding the image is processing the data whether or not
anything reads it.

**Article 9(2)(a), explicit consent, asked separately at upload** — scoped to that one document type
*inside* the determination rather than flagged on it, because **a passport needs none** and a consent
asked without cause is not caution. The reason consent works here is recorded so it cannot outlive
itself: the student has a passport as an alternative, so the choice is real. If that stops being
true, the determination must be revisited.

`assertStorable` now runs a third gate: a type listed under `article9Required` cannot be stored
without a consent that was **asked separately** and **records its wording**.

### Measured, not assumed

**Ten of seventy (document type, purpose) pairs now pass both gates**, against none before. Refusals
counted: 58 have no retention policy because the pair is not a real combination; 1 is the bank
statement (B1 row 12, deliberately unresolved); 1 — `other / audit_evidence` — has a policy and no
determination, because the audit record is not an uploaded document. **That last one is recorded as
an open question rather than decided here.**

**The vault does not open.** What remains is not a decision: no transport, no `DocumentStore`
implementation, no deployable holding a vault. And **blocker 8 became live** — the DPA 2018 Sch. 1
appropriate policy document must exist *before* special-category processing, and registering an
Article 9 condition does not satisfy it.

### Decisions

- [ADR-0087](./docs/decisions/0087-the-four-lawful-basis-determinations.md) — **Accepted**.

Four deliberate regressions, each verified from disk. Naming consent for determination 1 makes the
whole register unbuildable, through a check that already existed.

The declared-but-unreachable surface is **unchanged at seven** — both gates now have their inputs and
neither has a caller. The register's two entries were rewritten to say the obstacle is no longer a
decision.

---

## [0.70.0] — 2026-09-08

**P53 — the research build is removed, and what it proved is kept (ADR-0086).**

### Removed · `apps/chat-integration`

Decided by Vahid, 2026-09-08:

> Its value was evidence that the secure channel works on AskiMate's real stack shape, and that
> evidence is recorded in the ADR trail. Keeping the code costs a quarter of the serialised lane and
> an intermittent red, and produces no new evidence.

A React client and Express shim built across **P26–P36** against the AskiMate codebase as it stood in
late June — ten weeks stale. Never a deployable, never the production integration. What it
demonstrated is recorded by phase in ADR-0086 so removing the code does not remove the finding.

### Added · `scripts/plane-separation.test.ts` — four properties that were never about it

The removal was **checked before it was made**, and it was not clean. Four assertions in
`two-origin.test.ts` were about the two **deployables** — it imported `createConversationApp` and
`createSecureApp` — and existed nowhere else:

- the Conversation Service has **no route that accepts a secret**, and a smuggled `secret` field
  reaches no text-ish column of the whole plane;
- the Secure Service has **no route that accepts an ordinary message**;
- the two `__Host-` cookies are **not interchangeable** across planes;
- a client that **POSTs directly while a secure step is open** is refused, and nothing is stored.

They boot both real services, launch **no browser**, and run in four seconds. Two regressions against
production code prove they bite: removing the open-request guard in `routes.ts` fails the fourth by
name; adding a `/v1/frame-sessions` route to the Conversation Service fails the first.

### Fixed · the production client's `postMessage` had no wildcard-origin rule

`check-boundaries.ts` forbids `postMessage(x, "*")` in a named list, and that list held the secure
service's control client and the **research build's** `SecureFrame.tsx`.
`apps/conversation-service/src/client/journey.ts` — which mounts the real frame in the deployed
service — was never in it. **The one `postMessage` a student's browser actually makes was
unchecked**, and only taking the research build away surfaced it.

Three boundary rules reading only research-build files were **deleted rather than left dormant**:
each sat behind `if (existsSync(…))`, so removal would have turned them into rules that check
nothing.

### Decisions

- [ADR-0086](./docs/decisions/0086-the-research-build-is-removed-and-what-it-proved-is-kept.md) —
  **Accepted**.

Two browser-level properties are deliberately **not** carried across — they are about the client being
removed, and rebuilding them against `journey.ts` needs a two-origin harness that does not exist.
Recorded as an open phase rather than pretended away.

The P52 intermittent lived in this app and goes with it. **Its cause was never established**, and
nothing here claims otherwise.

The declared-but-unreachable surface is **unchanged at seven** — `apps/chat-integration` was in the
standing account's table B, which the register does not track, not in the register.

---

## [0.69.0] — 2026-09-08

**P51 — a published demonstration is guarded on what it shows (ADR-0085).**

### Added · the P37 precedent, applied to the four commands it skipped

P37 found `pnpm run walkthrough` printing **REFUSED** through nine consecutive steps and exiting 0.
ADR-0072 fixed that one. `package.json` publishes twelve commands, and five — `interview-demo`,
`extraction-demo`, `catalogue`, `interventions`, `inspect-discovery` — had **no guard of any kind**.

All five behave correctly today. That is the same sentence that was true of the walkthrough the day
before it rotted.

**Exit code is not the property** — the walkthrough's defect *passed* an exit-code check. So each is
asserted on what it exists to show: `extraction-demo` an honest reader accepted **and** an inventing
one discarded; `interview-demo` both asking and refusing; `catalogue` and `inspect-discovery`
refusing with no argument and saying how to call them; `interventions` refusing without its service
credential without printing a credential while it explains.

**`extraction-demo`'s two halves are not symmetric.** A run where the honest reader is refused is
P37's shape — visible and harmless. A run where the **inventing** reader is *accepted* means
ADR-0016's guarantee, that an extracted value must quote the document, has stopped holding. It would
exit 0 and look like a working demo. The regression proving that case is why the file exists.

### Fixed · a summary that reported one section as the whole run

`extraction-demo` closed with `0 readings accepted, 8 discarded` — the last line of a **three-section**
demo whose first section accepted nine. Read on its own, and the last line of a long run *is* read on
its own, it says the demonstration accepted nothing.

I misread it exactly that way while looking for demos that report refusal as success, and reported a
defect that was not there. The tally now names the reader it counts and gives the honest section's
total beside it, because the **contrast is the demonstration**.

### Decisions

- [ADR-0085](./docs/decisions/0085-a-published-demonstration-is-guarded-on-what-it-shows.md) —
  **Accepted**.

### Fixed · a hand-written list that lasted exactly one ADR

P49's guard checked the index's stated Accepted count against a **hand-written map** of numbers to
words, 78 to 84. The eighty-fifth ADR — the one this phase added — failed it with *"no spelling for
85"*. A list that must be extended every time the thing it counts grows is precisely the defect the
last three phases removed, so it is computed now.

A command added to `package.json` and guarded nowhere now fails the check. `discover` and `inspect`
are excluded by name — both need a real portal, which is blocker 1, and a guard that cannot run is
worse than none because it appears in the list as coverage.

Four deliberate regressions, each verified from disk, each caught by name.

The declared-but-unreachable surface is **unchanged at seven**. Nothing here is a capability.

---

## [0.68.0] — 2026-09-08

**P50 — the census is generated, and its arithmetic is checked (ADR-0084).**

### Fixed · a table that did not add up to its own stated total

`state-of-the-system.md` §7 carried a per-area test table by hand. Six of twenty rows were wrong,
every one understating — `packages/domain` 351→**373**, `apps/conversation-service` 292→**330**,
`packages/documents` 52→**67**, `packages/profile` 39→**46**, `packages/case-store` 139→**143**,
`packages/extraction` 23→**27** — and **`scripts`, with 264 tests, had no row at all.**

**The part that needed no run:**

```
its rows summed to               1,824
plus its own "everything else"    ~346
                                ------
                                 2,170
against its own stated total     2,306
```

A hundred and thirty-six tests unaccounted for. Detecting the six wrong rows needs a suite run;
detecting *this* needs addition, and nothing had ever added up the table it was reading.

**The tilde is the mechanism.** `~346` cannot be wrong — no reader could tell 346 from 482 and no
check could either. An approximation in a record is not modesty about precision; it is an assertion
that cannot be falsified, in a document whose purpose is to be checkable.

### Added · `pnpm run census`, and a guard that costs nothing

The command runs the suite, groups every test file by its workspace, and rewrites §7 between two
markers with an **exact** *everything else*. `scripts/census.test.ts` adds the rows up against the
stated total, refuses a tilde, refuses a row naming a directory that does not exist, and refuses a
table whose markers have gone — none of which needs a run.

The table gains `scripts` (264) and `packages/conversation` (52), neither ever listed, and
*everything else* falls from an approximate 346 to an exact 98.

### Fixed · the generator survives a red suite

The first version threw on a non-zero exit and deadlocked instantly: the guard fails while the table
is stale, so the suite is red, so the census cannot run, so the table stays stale. That is the
**normal** case, not an edge case. The report is now read either way, the table written, the failing
files named, and the exit code passed through — it never reports a green suite it did not get.

### Why this generates where ADR-0082 refused

ADR-0082 declined to generate the declared-but-unreachable table because its second column is a
judgement citing ADR-0019 and ADR-0071. This table has no such column: twenty names and twenty
integers, nothing in it a person knows that a run does not. **Generate what is arithmetic, check what
is judgement, and never confuse them.**

### Decisions

- [ADR-0084](./docs/decisions/0084-the-census-is-generated-and-its-arithmetic-is-checked.md) —
  **Accepted**.

Four deliberate regressions, each verified from disk. The fourth is recorded with a correction: it
first failed as a *collection crash* — vitest reporting "no tests", failing the run without saying
why — because the section lookup asserted at module scope. That is the P47 mistake inside the fix for
a different one; the marker now has its own named test.

The declared-but-unreachable surface is **unchanged at seven**. Nothing here is a capability.

---

## [0.67.0] — 2026-09-08

**P49 — an ADR and the lists of it must agree (ADR-0083).**

### Fixed · four decisions had been recorded as awaiting an approval that was given six weeks ago

ADR-0082 asked whether the prose describing a check still matched the check. Asking the same of the
records describing the **decisions** found not one hand-written copy but **three**, none compared
with the others: the ADR file, the index, and `state-of-the-system.md` §3's full second copy of the
same table.

**Four of eighty-two disagreed.** The history is exact, all on 2026-08-26:

| time | commit | |
|---|---|---|
| 08:05 | `4ee6b1c` | Phase 0. Five ADR files, all *"Proposed · awaiting Vahid's approval"*, index to match. |
| 08:47 | `a27cb60` | *"Phase 0 approved by Vahid on 2026-08-26. ADRs 0001-0005 moved to Accepted."* Flips all five **files**. Never touches the index. |
| 09:02 | `8786fff` | Edits the index — moves **only 0005**'s row. Four left behind. |

Seventy-eight commits and six weeks carried it forward. **The direction is what makes this one
different.** Eight consecutive phases had each found a record claiming *more* than the system did.
This one claimed **less**, so it never failed loudly — it grew a standing blocker,
*"12 · Accept or revise ADRs 0001–0004 · owner: You"*, **asking Vahid to decide something he had
already decided**, plus a §9 recommendation to do the same. A record that understates generates work
for a person who cannot tell it is wrong without reading git history.

Blocker 12 is closed as never having existed.

### Fixed · two ADRs were missing from the second table, added in the two previous phases

§3's table had **80 rows for 82 ADRs**: ADR-0081 and ADR-0082 were absent, because P47 and P48 each
added a row to the index and not to the second table. Not an old Phase 0 inheritance — a mistake made
in the two phases immediately before this one, by the same hand that then went looking for exactly
this shape. Two records are a thing that can drift; three is a thing that will.

### Added · `scripts/adr-status-agrees.test.ts`

Holds all three records to each other: every file's status matches its index row and its §3 row,
every ADR is listed in both, no list names an ADR that does not exist, every file has a recognised
status, and the index's stated Accepted count matches its own rows — it said *"Seventy-eight"*, right
for the stale index and wrong for the decisions.

A `CONTESTED` list, currently empty, exists so a future disagreement whose resolution is a founder's
call can be declared with its evidence and owner rather than picked. **ADRs 0001–0004 are
deliberately not in it:** their approval is recorded in three independent places — the four files,
`a27cb60`'s message, and sibling ADR-0005 whose index row *was* updated — so only the listings
disagreed, and they were wrong.

### Decisions

- [ADR-0083](./docs/decisions/0083-an-adr-and-the-lists-of-it-must-agree.md) — **Accepted**.

Four deliberate regressions, each verified from disk, each caught by name.

The declared-but-unreachable surface is **unchanged at seven**. Nothing here is a capability.

---

## [0.66.0] — 2026-09-08

**P48 — the record of what cannot be reached is checked too (ADR-0082).**

### Fixed · the document the README says to start with disagreed with the build

Since P39 the build has asked, of every capability a decision calls enforced, *does anything in
production call it?* `docs/state-of-the-system.md` §4 answered the same question for a person, and
nothing reconciled the two. They had drifted in both directions at once.

**`checkMinorGate` was in the register and in no row of the document.** ADR-0011's gate on an
application involving a **minor** — a mandatory-review category. The register says why it cannot be
reached, and that the trigger which stops a case for review, `suggestsMinority`, is a different thing
and *is* enforced. None of that reached the document. A reader would have believed the minors gate
was enforced.

**`packages/notify` sat under "Declared but unreachable" with a cell beginning "Reachable."** It is —
set `AAS_SPECIALIST_WEBHOOK_URL` on the worker and the specialist notice runs. The row said so, under
a heading asserting the opposite, and had done since P36. A row that argues with its own heading is
worse than a missing one: a missing row reads as an oversight, this one reads as reviewed.

Neither is a code defect and neither would ever have failed a build. That is the point — the register
is checked and the prose was not, so the prose is where a false record now accumulates.

### Added · `scripts/unreachable-is-documented.test.ts`

Imports the register and asserts the document's table A names exactly the symbols it marks
unreachable, both directions, and that nothing the register calls *reachable* appears there.

§4 is now two tables. **A** mirrors the register and is checked. **B** holds what the register cannot
express — a package with no dependents, a *branch* of an enforced function, a research build — and
says why each is not a register entry. `recommendWait` forced the distinction: the symbol is enforced
and its `next_intake` branch is not, so listing the symbol would be false and deleting the note would
lose a real fact.

### Changed · the register is importable without running

`main()` in `scripts/check-reachability.ts` runs only when the script is the program. Without it,
importing the register would run the whole check as a side effect and leak its `process.exitCode`
into the suite — a test file able to fail for a reason it never asserts.

### Decisions

- [ADR-0082](./docs/decisions/0082-the-record-of-what-cannot-be-reached-is-checked-too.md) —
  **Accepted**.

Five deliberate regressions, each verified from disk. The fifth is recorded with its limit: with the
register passing, removing the guard left the suite green at 7/7, so the guard is asserted in the
source as well. Coverage that exists only where the defect has already done harm is not coverage.

The declared-but-unreachable surface is **unchanged at seven**. Nothing here is a capability.

---

## [0.65.0] — 2026-09-08

**P47 — the browser tests run in a lane of their own (ADR-0081).**

### Fixed · the suite stopped failing for reasons nobody acts on

Two full-suite runs in five failed, each on a different browser test, each of which passed 4/4 when
run on its own. `two-origin.test.ts` had diagnosed the shape in its own comments long before — *"the
page is STARVED: several Chromium instances run in parallel across this directory's suites"* — and
fixed its own instance by retrying the input. Right for that test, wrong as a strategy. Vahid,
2026-09-08:

> A suite that goes red for reasons that turn out not to matter teaches everyone to discount red, and
> the cost lands on the day a real failure arrives and gets waved through. **Fix the contention
> rather than the assertions.**

Measured on the four-CPU container the suite runs in: a full run peaked at **21 concurrent Chromium
processes** and a load average of **5.13**. Vitest schedules test *files* across workers, and a
browser file launches a browser that is itself five to eight processes.

`vitest.workspace.ts` splits the suite into two projects. **`chromium`** runs the seventeen files
that launch a browser, one at a time. **`unit`** runs everything else, with all its parallelism
intact — capping workers globally would have slowed the 155 seconds that has no browser in it to fix
the 87 seconds that does, and would still have let two browser files pair up.

| | before | after |
|---|---|---|
| peak concurrent browsers | 3 | **1** |
| peak Chromium processes | 21 | **7** |
| peak load average (4 CPUs) | 5.13 | **3.13** |
| full-suite wall time | 119s | **176s** |

**Not one assertion or timeout was changed.** No test was made more patient to accommodate the load;
the load was removed.

### Added · `scripts/browser-lane.test.ts` — the list is checked, not trusted

`BROWSER_TEST_FILES` is a list, and a list is the thing this repository keeps finding out of date.
The guard checks it against what the files actually do, in **both** directions: a file that starts
launching a browser and is not added rejoins the contention silently, and a listed file that stops
launching one is serialised for nothing.

The predicate follows one level of first-party imports, because grepping the test files alone found
**twelve of the seventeen** — five launch through a `PlaywrightDiscoverySession` or a
`PlaywrightInspectionSession`, and each of those was measured spawning eight Chromium processes. The
narrow predicate was not a smaller truth; it was a wrong one.

Its first run flagged **itself**: `connectOverCDP` appears in its own source because it is looking
for `connectOverCDP`. That is the P39 mistake exactly — a check that reports the *word* as the deed
— and it is excluded by name, with a test asserting the exception is that one file and no other.

### Fixed · `fileParallelism: false` was doing nothing, and looked like it was doing everything

The first version of the lane set `fileParallelism: false` on the chromium project. Vitest lists it
in `NonProjectOptions` alongside `maxWorkers` and `coverage` — it is a **root-level** setting, so a
workspace project carrying it is accepted by the config loader and ignored at runtime. The lane still
peaked at three browsers, and only `tsc` said why.

`poolOptions.forks.singleFork` is a project setting and is what made the measured difference. The
guard now asserts both that it is present **and** that `fileParallelism` is absent: a
plausible-looking belt-and-braces re-addition is worse than nothing, because it stops the next person
looking further.

### Fixed · file selection lives in exactly one place

A project that `extends` a config **merges** its `include` rather than replacing it. The first
attempt left `include` in `vitest.config.ts`, and the browser lane matched all 113 test files instead
of its 17: every file ran in both lanes, the run went from 2,283 tests to **4,274**, and the load
average got *worse*. `vitest.config.ts` now carries no `include`, and says why the absence is
deliberate.

### Decisions

- [ADR-0081](./docs/decisions/0081-the-browser-tests-run-in-a-lane-of-their-own.md) — **Accepted**.

The declared-but-unreachable surface is **unchanged at seven**. Nothing in this phase is a
capability.

---

## [0.64.0] — 2026-09-08

**P46 — the visa path is a compliance boundary, not a scheduling gap (ADR-0080).**

### Changed · ADR-0021's decision stands; its reasoning was weaker than the truth

ADR-0021 explains the visa/application line as **product scope and correctness** — a valid
application should not be blocked waiting on evidence of a rule that may never apply. True, and
insufficient. Vahid, 2026-09-08:

> The entire visa path is outside this system's scope until the OISC position is resolved, and that
> is a hard compliance boundary in the business plan, not a scheduling gap.

**The word OISC appeared nowhere in this repository.** The strongest reason for the most consequential
boundary in the product lived only in the business plan, and every "out of scope" citation in the
code pointed at the version that sounds like a priority call.

The difference is not academic: a product-scope reason is one a later engineer could reasonably
decide to overturn citing product value. A compliance boundary is not theirs to overturn. That is
also why `visa_document` is `out_of_scope` and never `undetermined` — *"`undetermined` would leave it
open for someone to quietly decide later. `out_of_scope` says it is deliberately shut."*

### Found · the line ADR-0021 calls "the single line" has no production caller

Registering the boundary meant asking what enforces it. ADR-0021 answers in its own words —
`blocksApplication(requirement)` — and `pnpm run reachability` said so the moment the claim was
entered:

```
✗ blocksApplication — ADR-0021 says "the single line that keeps the visa journey out of the
  application journey", and NOTHING IN PRODUCTION CALLS IT.
```

The cause is not neglect: **nothing in production carries a `Requirement` at all.**
`packages/requirements` has no dependents, and the catalogue's `requiredDocuments` are free-text
strings with no authority (ADR-0066, ADR-0070). There is no scope for the line to read.

Listed as declared-but-unreachable rather than wired. A caller would be a control over unreachable
code — the reason ADR-0071 declined one for `attach_document`. **What makes the absence safe today is
that the visa journey is not built, not that this line is stopping it**, and the register says so.

### Declared-but-unreachable surface: **6 → 7**

It went **up**, and the direction is the point: nothing became less reachable. Something that was
always unreachable is now *declared*, and the register can only be honest about what it has been told
to check. When the Requirements Service phase lands it closes two at once —
`blocksApplication` and `assessUsability`.

---

## [0.63.0] — 2026-09-07

**P45 — a document running out is the student's choice, once, in writing (ADR-0079).**

ADR-0078 §5 recorded the expiry rule and deliberately left the numbers absent until proposed and
confirmed. They were proposed and approved on 2026-09-07, with one removal.

### Added · the thresholds

One principle throughout: **the threshold is the time a student needs to obtain a replacement**, not
a fixed fraction of the document's life. Passport **6 months** (UK renewal runs to 10 weeks at its
worst, and six months also covers the validity many visa routes require at entry); national ID
**3 months**; English test certificate **4 months and provisional**. Nothing for the documents that
do not expire.

**A bank statement gets nothing, and that is the decision rather than an omission.** *"Row 12 is out
of scope and blocking, and giving it a threshold makes it look half-ready."* It was in the proposal
at 14 days and was removed — which is why the table distinguishes `does_not_expire` from
`out_of_scope` from `undetermined` rather than treating all three as an absent number.

### Added · three properties, each structural rather than remembered

- **The wording recorded is the wording shown.** `recordChoice` takes the branded `ExpiryWarning`,
  never a string, so there is no parameter through which a caller could record a sentence other than
  the one the student read.
- **It fires once.** The only input about previous warnings is when the first one happened; there is
  no "warn anyway". *A countdown that nags is one people learn to dismiss.*
- **Every document type is classified.** The table is total over `DocumentType`, so a new type does
  not compile until somebody decides — and `undetermined` blocks rather than reading as "no warning
  needed".

### The English test number says in the code that it is not settled

It names obligation `read_the_test_provider_terms`, `provisionalThresholds()` lists it, and every
warning produced from it is marked provisional and carries that into the recorded choice.

### `already_expired` is not a warning

A document past its expiry is a validity failure — `assessValidity` refuses it — and *"this is about
to expire"* would be both wrong and too late. Its own answer, with its own name.

### Declared-but-unreachable surface: **6, unchanged.**

`packages/documents` is in no deployable's dependency closure, so this constrains code that does not
yet run — the same limitation stated for ADR-0077, and stated again rather than quietly repeated.

---

## [0.62.0] — 2026-09-07

**P44 — documents are held and reused, and the twelve periods are set (ADR-0078).**

The two blockers that had stood since the document boundary was drawn are both answered by Vahid
Mohammadi on 2026-09-07.

### Decided · B5 is A — hold and reuse

> Documents are stored in the vault and reused. We never ask a student for the same document twice.

Decided on a stronger ground than the options document argued: pass-through is not a cheaper way to
do the same thing, **it is a different product**. Fill-once, apply-to-many is what the business plan
sells as the switching cost.

### Fixed · the five rows that contradicted it

The sheet was written before B5 was answered, and rows 1, 2, 6, 7 and 8 said *30 days after
`submission_confirmed`*. **A student applying to a second university two months later would have
been asked to upload again** — the reuse mechanic destroyed by its own retention rule. All five now
run **12 months after `last_used`**, the trigger row 3 already used.

Two triggers were added because two rows could not otherwise be written down: `age_established`
(row 9 keeps the age *determination*, not the certificate) and `case_concluded` (rows 5 and 10 run
from the end of the case, not from a submission that may never happen).

### Added · schedule version `1.2026-09-07` — the first that permits storage

Eleven policies, each naming Vahid Mohammadi and dated; row 12 (`bank_statement`) still unresolved
and blocking by ADR-0021; five determinations (the claims purpose, the custody model, the last-used
trigger, the deletion cascade, the expiry rule); and two obligations.

**Obligations are new schedule content**, cited by the policies they attach to — so deleting the
referee notice or the test-provider reading while leaving the period that required it fails
`validateSchedule`.

### Fixed · a defect this phase created, and the check that was missing

Writing a second version on the same day made two versions effective from the same instant.
`effectiveFor` sorts descending and a tie keeps input order — the directory listing — so **the
superseded version won, and the report said every row was unresolved while the schedule that
resolved them sat beside it.** Nothing about either version was wrong, so `validateSchedule` had
nothing to say.

`validateHistory` refuses two versions sharing an `effectiveFrom`, two sharing a name, and a version
superseding one the history does not carry. *"What was our retention policy in March?"* must have
exactly one answer.

### Changed · the report no longer implies permission it cannot grant

`retention-status` said *"10 of 10 document types could be stored today"*. With no period set that
was harmless; with eleven set it reads as permission. `assertStorable` requires a registered lawful
basis **as well as** a policy (ADR-0022, blocker **B2**), which is still undetermined — so the
summary now says a retention policy is not permission to store, and names the gate that is shut.

### Not implemented, and recorded as such

The **deletion cascade** (no vault holds anything to cascade from) and the **expiry thresholds**
(to be proposed and confirmed first). Both are recorded on the schedule with their absence stated.

### Declared-but-unreachable surface: **6, unchanged** — but three reasons rewritten

`assertStorable` and `attach_document` were waiting on B5; `purgeContents` on B1. Both are decided,
so the register's reasons now name what is actually left rather than a blocker that has been
cleared — a stale reason is what hides the next finding.

---

## [0.61.0] — 2026-09-07

**P43 — two determinations, made structural rather than written down (ADR-0077).**

Decision sheet B1 ended with two things that were written down and enforced by nothing. Vahid
answered both on 2026-09-07.

### Added · a special-category field cannot be extracted, because there is nowhere for one to go

The profile registry is the boundary of what extraction can produce: a reading enters the system only
through a plan target, and every target names a `ProfileFieldKey`. `FIELD_CATEGORY` is now **total**
over that registry, so a field added without a classification against Article 9(1)'s enumeration
**does not compile**, and a plan may only name one classified `ordinary`. `undetermined` is a third
state and blocks exactly as `special_category` does — ADR-0023's rule in a new place, because the
dangerous state is the one that looks decided.

Measured rather than asserted. Adding `identity.religion` fails the build at `categories.ts`, naming
the missing classification; classifying it `special_category` and naming it in a plan fails with
`Type '"identity.religion"' is not assignable to type 'OrdinaryFieldKey'`, at the line of the plan.

Broader than the determination, deliberately: row 2 named the national ID, and this refuses the field
on every document type, because a per-type exception would be a hole with no stated purpose.

### Added · the claims determination, recorded and load-bearing

**No document period rests on "establishing, exercising or defending legal claims."** Only the audit
record does, and the reasoning is recorded because Article 5(2) makes the period ours to justify:
*what the student authorised is provable from the record without the scan* — the preview hash, the
authorisation text and the transmission record say what was shown, agreed and sent.

`RetentionBasis` carries a declared `reliesOnLegalClaims` — declared and not inferred, because a
check that searched the statement for "Limitation Act" would miss the period that phrased it
differently while feeling like a control. `validateSchedule` refuses it for any purpose but
`audit_evidence`, and refuses it even there unless the schedule records who determined it and why.

A schedule that **omits** the declaration is read as relying on it. Measured: with the other default,
a passport kept 2,190 days on the strength of the limitation period printed *"No contradictions, no
placeholder bases."*

### Changed · schedule version 0.2026-09-07

Records the determination. **Sets no period.** All twelve rows remain unresolved; B5 and the five rows
B1 flags — the two third-party rows and the three children's rows — are untouched and still with
Vahid and the DPIA owner.

### Not done, and recorded rather than left looking unconsidered

The same constraint at `applyConfirmation` — ADR-0004's single mint point — was written and reverted:
it changes generic inference for every caller and required rewriting unrelated tests, for a guard
vacuous there today.

### An uncomfortable consequence, stated

`packages/extraction` is in **no deployable's dependency closure**, so the first determination
constrains code that does not currently run. It is compile-time, so it holds whenever the package is
built and will already hold on the day extraction is wired in — but it is not guarding a live path
today, and saying otherwise would be the claim ADR-0073 exists to catch. The half that *is* in a
shipped package is the registry classification, in `packages/profile`.

### Declared-but-unreachable surface: **6, unchanged.**

---

## [0.60.0] — 2026-09-07

**P42 — the student can instruct the second attempt the system refuses them into (ADR-0076).**

The third consecutive phase to find the same shape one layer further out. P39 found a capability
with no caller. P41 found a refusal with no reader. P42 finds **a route with no client.**

### Fixed · both halves of ADR-0006's exchange were reachable only from a test

P38 built the two-step exchange rule 4 requires — say what happened to the previous application, be
shown the advice, then instruct — published both routes, and covered both with driver tests.
**Nothing but a test had ever called either.**

The refusal that leads to them explains, in the contract's own words, why its fields exist:

> It is on the wire because the refusal is otherwise a dead end. "You already have an application for
> this" is only useful if the client can take the student to it, or — when it has concluded — offer
> them a second attempt.

The page read the `code` and discarded `existingCaseId` and `concluded`. A student whose earlier
application had finished — the exact case the system is ready to help with — was told they already
had one and shown nothing further.

### Added · the exchange, on the page, in the order the decision requires

The panel has two states and the second is reachable only through the round trip whose reply is the
server's advice. There is no path by which the page can put itself into the instructing state, so
rule 4's *"mandatory in presentation"* is obeyed rather than re-implemented — and the server still
enforces the same order independently, by looking for the advice event in the conversation's log.

`concluded` is the server's answer and the only thing that decides whether the offer appears. The
page holds no case state and reads none.

### Changed · a refusal keeps its whole document

`Outcome`'s failed member now carries the `Problem` as `parseProblem` read it, so the next refusal
that means more than its code does not need this work done again. A document the parser refuses
still yields a code — a refusal the client cannot fully read must not become a success.

### Not done, and deliberately

**Taking the student to the application they already have** — the other half of what `existingCaseId`
is for. A conversation owns at most one case, so it means moving them to a different conversation,
and no read lists a case's conversation yet. Recorded rather than half-built.

**A check that every published route has a client.** Most internal routes have none by design, so it
would be an exception list wearing a guard's clothes. The reachability register carries
`advisePriorOutcome` instead, whose only production caller is the page.

### Declared-but-unreachable surface: **6, unchanged.**

---

## [0.59.0] — 2026-09-07

**P41 — a refusal reaches the person it is for (ADR-0075).**

ADR-0073's question, asked of a different kind of declaration: not *does anything call this*, but
**does the reason anybody states ever reach anybody**.

### Fixed · two codes that existed so a client could tell them apart, and no client could

`already_applying` and `specialist_reviewing` are in the vocabulary on exactly one argument — that a
student refused either must not be shown a generic conflict. The page had six wordings and neither
of those, so both fell through to *"That did not work. Let me show you where things stand."* For a
student whose run a specialist is holding, that sentence contradicts the transcript directly above
it, which P40 had just written.

### Fixed · both services published 413 and 415, and neither had ever sent one

`express.json({ limit })` guards every route in both planes, and everything it refused reached the
blind error handler and came back `500 internal_error`. The comment beside the limit already claimed
otherwise — *"`413` from here is the contract's `payload_too_large`"* — and nothing made it true.

A student who pasted a long personal statement was told our side had broken, for a body only they
could shorten. `problemForBodyError` now maps the parser's own error type to the published code —
413, 400 or 415 — and lives in `packages/contracts` because two copies would be two chances for one
of them to keep answering 500. It reads `err.type` and nothing else, so it stays as blind as the
handler around it: `err.body` carries the raw request body on a syntax error.

### Fixed · a refusal document the contract's own parser refused

`parseProblem` requires `instance`, and neither the new refusals nor the existing `internal_error`
had one — a refusal the client cannot read, which is the same defect one layer down.

### Added · three checks over the gap that used to be invisible

- `refusal-wording.test.ts` — `REFUSALS` and `CANNOT_REACH_THIS_PAGE` must together cover
  `PROBLEM_CODES`, so a code added to the vocabulary cannot reach nobody.
- `contract-drift.test.ts` — every `post` in both documents publishes 400, 413 and 415, read off the
  documents rather than a list.
- The reachability register gains `problemForBodyError`, taking the enforced count to **13**.

### The reviewed list found two of this phase's own defects

`CANNOT_REACH_THIS_PAGE`'s first draft had three entries and two were wrong: it claimed the page
could not be sent `payload_too_large` (the statement box takes a paste of any size) and that it
"sends no idempotency key" (`transport.ts` sends a fresh one on two calls). Neither was findable by
reading the page. Both were findable by having to write down why a code could not arrive.

### Declared-but-unreachable surface: **6, unchanged.**

---

## [0.58.0] — 2026-09-07

**P40 — a run a person is holding is returned to the student, never restarted (ADR-0074).**

P29 made a run that only a person can carry on stop and say so. P36 made that stop reach a
specialist. Neither answered what the student does next: **they come back.**

### Fixed · they came back to a 500

`start` looked for a run in `running` or `suspended` before deciding whether to resume. An escalated
run is neither, so it fell through to `startRun`, which refused a run id that already existed and
threw — and the route turned that into an internal error. The student had been told, in that same
conversation, *"you do not need to do anything — I will tell you as soon as it moves again."*

Vahid: *"When a specialist reviews a case, there is no handoff to a separate conversation or a
different person. The student stays where they were."*

`start` now returns the run in the state it is in: its own id, its status, `step: "specialist"`,
`resumed: true`. The orchestrator is not asked — its answer would name a step the run is not going
to take, and re-deriving would write a checkpoint for a run whose next move belongs to somebody
else. `runFor` makes the same substitution, so the read and the start cannot disagree.

### Changed · an advancing decision is refused with a reason, not a 404

`authorise` and `confirm_handoff` reach the student as **409 `specialist_reviewing`**. A 404 told
them their application did not exist, for a state that clears itself when a person finishes looking.

`cancel` is never refused for being ill-timed (ADR-0053), `confirm_value` is an answer about their
own details rather than an advance, and their messages land as they always did.

### Added · `isHeldByAPerson`, and a partition

The question *"is a person holding this run?"* was asked in four places in three spellings — two SQL
`IN` lists, a `status === "running" || status === "suspended"`, and a comment. **The spelling that
mattered was the one that was missing.** Automatable, held-by-a-person and terminal now partition
`WorkflowStatus`, asserted as a partition so a seventh status cannot land in none of them, and
`WorkLeaseStore` builds its `IN (…)` from `AUTOMATABLE_STATUSES`.

### Not done, and both deliberately

**No guard in `advance`.** One was written first and failed five tests that re-advance a stopped run
on purpose — which is how the pause is proved idempotent and the interview's attempt limit proved
durable. The measurement is in the code, not just the conclusion.

**No guard in front of `decide`.** A mandatory-review stop is `escalated` too, and `recordDecision`'s
domain refusal is reachable in exactly that case. A guard before it would make this coordinator the
thing that refuses a financial-evidence or minor review. The classification happens after the domain
has refused; a regression that swallows that refusal still fails.

### Fixed · the worker gave a lease back it had not yet taken

Found by an intermittent `p18-startup.test.ts` failure on this branch — one run in eight — and
measured rather than re-run: 7/8 here, 6/6 on the previous commit. The cause was real. `stop` set
its stopped flag, cleared the timers, and released the leases in `holding`, while a pass that had
*begun* before that flag was set was still running. `underLease` claims its lease **inside** that
pass, so the claim could land after the release loop had already run, and the worker exited leaving
a lease in `worker_leases`. The next worker then waits a full lease period for a job it could have
started immediately. Invisible in the ordinary case, because an abandoned lease lapses on its own.

`stop` now tracks the passes that have started and awaits them before releasing anything.
`worker.test.ts` pins it by holding the claim's own statement open across the call to `stop`, which
is the only ordering that reproduces it.

### Fixed · eighteen lease tests that skipped on every local integration run

`apps/worker` was missing from `scripts/with-postgres.sh`, so its database-backed tests ran only in
CI's blanket pass and announced a skip locally — the shape that lets a lease test rot unnoticed
between pushes. Added to both invocations.

### Declared-but-unreachable surface: **6, unchanged.**

---

## [0.57.0] — 2026-09-06

**P39 — a declared capability with no production caller fails the build (ADR-0073).**

Seven consecutive phases each found a record asserting something production did not do, and the
question that found almost all of them was not *does the code contain this* but **does anything in
production call it**. Every one compiled, was exported, and was covered by tests — which is why the
defect was invisible: a capability with a thorough unit test and no caller looks, to everything
automatic, exactly like one that works.

### Added · `pnpm run reachability`

A register of capabilities a DECISION says are enforced, each naming the symbol, the files that
declare it, the record and the promise in one line. The check fails three ways: an entry marked
enforced with no production caller; an entry on the reviewed unreachable list that has acquired
one (a stale allow-list is what hides the next finding); an entry naming a file that no longer
declares the symbol.

"Production" is narrow on purpose. Not a test. **Not a script** — the whole of P37's finding was
that `scripts/walkthrough.ts` was `claimSubmissionKey`'s only caller, so a check that counted it
would agree with the defect. And inside a deployable's dependency closure: `packages/requirements`
has no dependents at all, so `assessUsability`, called only from there, is called by nothing that
runs. Without that rule the check would have passed it.

### Fixed · it found one on its first run

`openReapplication` — which ADR-0006 §3, written in P38 four hours earlier, calls *"the one
constructor for a second attempt"* — **had no production caller.** The run driver built the opening
event itself from an ordinal and a prior case id passed as two separate fields. The ADR said one
thing and the code did another, in the phase that wrote the ADR.

Fixed rather than allow-listed, and the fix is better than what it replaced: `#openAndStart` takes
a discriminated attempt, the domain builds the opening event, and the submission key is claimed for
**the identity that event carries** rather than one assembled beside it. Two constructions that
could disagree became one.

### The reviewed unreachable list

Six entries, each with a stated reason and what would close it: `checkMinorGate` (its one blocking
condition is at the submission stage, out of scope by ADR-0014), `assertStorable`,
`authoriseDisclosure`, `purgeContents` and `attach_document` (B5, B2, B1 and the document
transport), and `assessUsability` (no deployable depends on `packages/requirements`).

The list is now a reviewed artefact with an expiry condition rather than a fact somebody once knew.

### What it does not prove

That a REQUEST can reach a capability. This answers P37's question — is there a production call
site — not "is there a path from an HTTP route". A function called only by another function that
nothing calls passes. Closing that needs a call graph rather than a symbol search, and the script
says so in its own header rather than implying otherwise.

Branch-level reachability is out of scope too: `recommendWait`'s `next_intake` branch has no
production caller because no caller supplies a `nextIntake`, and a symbol-level check cannot see
that. Recorded in `state-of-the-system.md` instead.

---

## [0.56.0] — 2026-09-06

**P38 — the duplicate ADR-0006 has always forbidden is now impossible, and the second application
it refuses has somewhere to go (ADR-0006 §3, amended).**

P37 recorded two things and deliberately fixed neither, because closing the first without the second
would replace a silent duplicate with a silent dead end. They are one phase, and this is it.

### Fixed · the second line of defence, finally armed

`claimSubmissionKey` has existed since Phase 1 and ADR-0006 calls the database's unique key *"the
second line of defence"* against duplicate submission. **Nothing in production called it.** Its only
caller in the repository was `scripts/walkthrough.ts`. A student could open a second conversation,
request the same target, and receive a second case with the same `(studentId, institutionId,
courseId, intake, attemptOrdinal: 1)` — the failure the brief names as *"the characteristic
catastrophic failure of this class of system"*.

The claim now happens at case-open, inside the same critical section as the binding and before the
case's first event: re-claiming for the same case is a no-op, so a retry of a start that crashed
between the two arrives, sees its own claim, and writes the log it did not write last time. The
other order leaves a case log with no key, which is a duplicate waiting for the next caller.

A collision is refused as `already_applying`, and the refusal names the application that holds the
identity and whether it has concluded. Both are safe to publish and both are necessary: the student
is part of the submission identity, so a collision is always with an application of the caller's own,
and a refusal that cannot say "that one is finished, you may apply again" is a dead end.

### Changed · a re-application is a NEW case (ADR-0006 §3, amended)

`fold` handled `ReapplicationInstructed` by incrementing `attemptOrdinal` on the same case. **The
case that produced could never act:** every terminal state has an empty transition list and
`checkTransition` refuses from a terminal state before it looks at the target, so what the fold
produced was a `CONFIRMED` case at attempt 2 with no first move.

Vahid's decision, and the reasoning rather than only the rule: *"A second attempt is genuinely a
different application. Different intake, different deadline, possibly changed entry requirements,
and a separate authorisation from the student. One case holding two sets of requirements and two
authorisations makes it impossible to state precisely what the student agreed to."*

So `ReapplicationInstructed` stays on the prior case and names the successor it opened; `CaseOpened`
gains `priorCaseId`; `openCase` refuses an ordinal above 1 without one and a prior case at ordinal 1;
`openReapplication` is the only constructor for a second attempt and derives every field of its
identity; a case has exactly one successor, so the chain is a chain rather than a tree. **The
terminal rule in `checkTransition` is unchanged.**

### Added · the path a refused student actually takes

Since a conversation owns at most one case, the second application lives in a new conversation —
which is where the student already is when they meet the refusal. Two routes, because ADR-0006 rule 4
makes the wait recommendation *advisory in effect and mandatory in presentation*:

- `POST /v1/conversations/{id}/reapplication/prior-outcome` — they say what happened; the system
  composes the recommendation, appends `reapplication_advised` and the message they read, and
  returns it.
- `POST /v1/conversations/{id}/reapplication` — their instruction, in their own words, and nothing
  else. Not the prior case, not the ordinal, not the outcome, not the recommendation: each of those
  would have been a field a caller could disagree with the system about.

`already_applying` is a published problem code at 409 with `existingCaseId` and `concluded`;
`reapplication_advised` is a published event kind with its own columns and two CHECK constraints
(migration 0017).

### Fixed · a test fixture that was right by accident

`run-driver.test.ts` ran almost every conversation against one student, which by the measure that
matters made most of the file's conversations the same application. Threading a student per
conversation found a real defect: `recordPage` and `leaveOpen` derived a page's CONTENT target from
the shared student rather than the run's own, and were correct only because an unrelated group four
hundred lines earlier seeded that student's profile as a side effect. When it stopped, the target
became the hash of an empty plan and seven tests in two other groups failed for reasons that read
like an order dependence and were not one.

### Not done, deliberately

`start` on a conversation whose run has ESCALATED throws rather than resuming: `#openAndStart`
resumes only `running` or `suspended`. Pre-existing, unrelated to the submission key, and a real
design question about what a student gets back — recorded rather than fixed here.

`recommendWait`'s `next_intake` branch has no production caller. Naming a later intake means knowing
one is open, which is a catalogue listing question; advising a student to wait for an intake nobody
has reviewed would be inventing a fact.

---

## [0.55.0] — 2026-09-06

**P37 — ADRs 0005–0021, read against the code (ADR-0072).**

Five consecutive phases had each found an older ADR asserting a guarantee the code did not provide —
ADR-0038 on verified email (P19), ADR-0045 §4 on crash detection (P17), ADR-0022 on storage (P31)
and on the application context (P34), the `documentRef` layering (P35). At five that is a property of
how the repository accumulated, not a run of coincidences, and the oldest records were the unaudited
ones. Two questions per named artefact: *does it do what the ADR says?* and *does anything in
production call it?* **The second question found almost everything.** Full sweep:
[`docs/p37-adr-audit.md`](./docs/p37-adr-audit.md).

### Fixed · one gate, not two

`decideReapplication`'s doc comment has read *"The single gate. `machine.ts` calls this"* since Phase
1. **`machine.ts` imported only the type.** Its `instruct_reapplication` case checked one of
ADR-0006's five rules — that the ordinal increases by one — and accepted everything else, so the
state machine would have emitted `ReapplicationInstructed` for an `automatic_retry`, a `specialist`
or an `operator`; for a live case; for an empty student statement; and for a recommendation shown
after the fact. Four rules enforced only by a function nothing called: ADR-0041's failure inside the
domain, with the weaker implementation on the path.

Not exploitable today — nothing in production can reach the intent — which is the reason to fix it
now rather than later. `priorCaseConcluded` is **derived** from the case's own state rather than
passed, and the intent no longer proposes an ordinal: the gate returns it, because a caller that
proposed one would be a second opinion about the one number ADR-0006 says may only increase by one.

### Fixed · a demonstration that could not fail

`pnpm run walkthrough` — which the README calls *"the fastest way to see what has been built"* — was
**refusing nine consecutive steps and exiting 0**.

Two later decisions caused it, neither wrongly. ADR-0058 made a case open directly into
`READY_TO_PREPARE`, turning the script's "Mark ready" into a self-transition and giving every later
step the wrong state; and capturing an authorisation became the act that *moves* a case to
`AUTHORISED`, so submitting straight from `AWAITING_STUDENT_AUTHORISATION` is correctly refused. The
script also never retried the authorisation transition after the mandatory financial-evidence review
it exists to demonstrate — so the gate was shown being requested and never shown being satisfied.

**The defect is not the drift. The defect is that nothing could notice.** `apply` now takes
`"accepted"` or `"refused"`, and that argument is not documentation: a step marked refused is one the
script exists to show being refused. Disagreements are collected, printed with the domain's own
refusal text, and the process exits 1. `scripts/walkthrough.test.ts` runs the real script in a real
process inside `pnpm run verify`. The expectations stay in the walkthrough, next to the narrative
they are about.

The walkthrough now runs its whole story again, through the real state machine: 24 events, a
document blocking progress, a financial-evidence review being satisfied, an authorisation, a
specialist recovery, a re-authorisation *because* the recovery changed the application, one
submission, a refused second, and a re-application that reaches attempt ordinal 2.

### Corrected

**ADR-0005** claimed validators and clients are *"generated from it, never hand-written"*. There is
no generator in this repository and never was. ADR-0063's drift check against the real Express router
is what holds spec and server together — and is stronger in the direction that matters, because a
generated client matches the spec and says nothing about whether the server does.

**ADR-0008** said the alerting transport was *"not built, and explicitly not claimed"*. Built in P36.
A dated note, not an edit, so what was true when the decision was taken survives.

### Recorded and NOT fixed, deliberately

**`claimSubmissionKey` has no production caller.** ADR-0006 calls the database's unique key *"the
second line of defence"* against duplicate submission; it is never armed. `POST /v1/conversations`
lets a student open a second conversation, request the same target, and get a second case with the
same `(studentId, institutionId, courseId, intake, attemptOrdinal: 1)`. Blast radius today is nil —
nothing submits, no live portal — and at the first live run it is the failure the brief calls
characteristic and catastrophic.

**The re-application path does not exist.** No route, no `StudentDecision` member, no driver path.

They are **one phase**, and it is the next one. Closing the first without the second would replace a
silent duplicate with a silent dead end — a student whose case concluded, refused a second case with
no way to ask for one — and four phases have gone into removing exactly that shape.

### What held

Thirteen of the seventeen records audited hold as written, and the ones checked hardest are the
standing hard stops. **Minors:** the trigger comes from `suggestsMinority` on a *confirmed* date of
birth (the code carries the record of getting this wrong once, with `determineAge`, which raised it
on every case in the system); nothing concludes "adult" from absent, unparseable or merely stated
evidence; no parental-consent requirement is hardcoded; `checkMinorGate` has no production caller and
that is correct, because its one blocking condition is at the submission stage, which does not exist.
**Financial evidence:** the gate is live on every mandatory-review derivation, and the walkthrough
now demonstrates it being satisfied rather than merely requested.

### Regressions

Three, and one of them is the point. Removing `decideReapplication` from `machine.ts` fails 4.
Reintroducing the **real** ADR-0058 drift with the check intact fails the walkthrough test, naming
the step and quoting the domain's refusal. Reintroducing that same drift **with the check removed**
passes — which is the pre-P37 state, and the proof that the check is the load-bearing part rather
than the repair.

2186 tests, 107 files, zero skipped, against real PostgreSQL and Redis.

---

## [0.54.0] — 2026-09-06

**P36 — a stopped run reaches a person (ADR-0071).**

Every part of the recovery design was built and tested across P10, P11, P17 and P29: a run stops at
the failure point; `interventions` records what was encountered and what was expected; a specialist
adjudicates through an internal route; the run resumes from the intent ledger.

**And nothing told anyone.** A stopped run wrote a durable, discoverable row and then waited for
somebody to think of running `pnpm run interventions`. The student was told their application was
paused — `announcePending` has done that since P14 — so the one person who could not act on it was
informed, and the one who could was not. The schema had been waiting for this since P10: migration
0003's index carries the comment *"the query the operator CLI runs, and the one an alerting
transport will run when it exists."*

### The notice, and what it deliberately omits

A notice goes to a URL this repository does not control, so the question is not *what would be
useful in the message* but *what may be handed to a third party in order to say that something needs
a person.*

**Sent:** `interventionId`, `runId`, `caseId`; `reason` and `priority`, both closed unions;
`institutionId`, `courseId`, `portal` and `page`, all from **reviewed** artefacts; `raisedAt`.

**Not sent, each for its own reason:**

- `encountered` / `expected` — the specialist's most useful fields, and free text composed at the
  point of failure. A portal quoting back an invalid value is the ordinary shape of an
  `unfamiliar_validation_error`; free text is where a value ends up.
- `checkpoint` — structured, but it names the pages of a real application in progress, and a webhook
  subscriber has authenticated to nothing.
- `studentRef` — pseudonymous is still personal, and it buys the specialist nothing: the CLI and the
  internal route both take the case.

`noticeFor` is the only constructor and it **reads named fields** rather than spreading and deleting.
A delete-list is a list somebody has to update, and the field they forget is the one that leaks. A
`check-boundaries` rule is the second control: `packages/notify` cannot reach a profile, a plan, a
preview, a secret, a model or a database driver.

### The transport

An HTTPS POST via `fetch`. No SDK, nothing provisioned, nothing paid for — a chat webhook, a paging
endpoint and an operator's own relay all speak it, so which one is used stays operational rather than
becoming a dependency in this repository. **Plain HTTP to anything but loopback is refused at
construction**, so a misconfigured destination stops the worker starting (ADR-0055) rather than
failing at three in the morning on the first stopped run.

### Ordering, failure, and the second column

**Send first, mark second** — `announcePending`'s order, for its reason: a crash between them pages
somebody twice, which is much smaller than a stopped run nobody hears about. `markNotified` is
idempotent, so the duplicate does not move the time. A failed delivery leaves the row unmarked and
**the batch carries on**; abandoning the pass would let one permanently-failing notice suppress every
notice behind it, which is the original defect with an extra step. No attempt counter, no backoff, no
dead-letter — a notice that keeps failing keeps being retried, and the run is still visible in the
queue an operator can already read.

`notified_at` is a **second column**, not a reuse of `announced_at`: the student and the specialist
are different audiences, told different things over different channels, and either can succeed while
the other fails.

### Where it runs

The Background Worker — noticing that something needs a person is autonomous progression, and
ADR-0052 puts that in the worker. Third job under the existing lease vocabulary
(`notify_specialists`, added to `worker_leases`' CHECK in a reviewed migration), at fifteen seconds:
the slowest of the three, because it is the only job that talks to something outside this system.

**With no `AAS_SPECIALIST_WEBHOOK_URL` the job is not started at all**, so `worker_leases` carries no
lease for a job that can never work. That is every deployment before this one and stays valid — but
it is now a choice, and the worker says so on startup rather than leaving it invisible.

### Added

`packages/notify` (the shape, the port, the webhook), `packages/case-store` migration 0004,
`apps/conversation-service` migration 0015, `RunDriver.notifyPending`, the worker's third job, and
`AAS_SPECIALIST_WEBHOOK_URL` / `AAS_WORKER_NOTIFY_MS`.

Twenty-seven tests — fifteen on the notice and the webhook, four on the store contract (both
implementations), five driving a **real** run to a **real** specialist stop through the driver and
asserting what leaves the system, and three on the worker's job and its lease. Nine deliberate regressions, all caught: prose in the
notice fails 3; the student in the notice fails 3; admitting plain HTTP fails 2; a notifier that
swallows a failure fails 2; a driver that marks a failed delivery fails 1; ignoring the marker fails
1; one column for both audiences fails 1; the notify job without a lease fails 2; the notify job
running with no destination fails 1.

**A real defect the tests found before anything shipped:** `new URL("http://[::1]:9000/").hostname`
is `[::1]`, with brackets. The loopback allow-list held the bare `::1` and would have refused a
legitimate IPv6 local relay — wrong in exactly one deployment, which is the kind that is discovered
in production.

2182 tests, 106 files, zero skipped, against real PostgreSQL and Redis.

---

## [0.53.0] — 2026-09-06

**P35 — the portal's file field is called `fieldRef` (ADR-0070), and the standing account of the
system now exists.**

### Renamed

`BlueprintPage.requiredDocuments[].documentRef` → `fieldRef`. `MappingSource { kind: "document" }
.documentRef` is unchanged.

One name spanned two layers, and P34 measured that **the repository contained both readings of it**:
`pageFrom` wrote the portal's field name, and the hand-written fixture wrote `"passport"` where the
file input on that page is `"passport_upload"`. A comment says what a field means; the name said
something else, and the fixture had already followed the name.

Done now because it is free now. `toCanonical` walks the parsed object, so **field names are inside
the catalogue content hash** (ADR-0057) — renaming a blueprint key after the first approval
invalidates every approval, and each one is a two-person review. No approval exists yet. The parser
is one line, and the readers are two: `scripts/inspect-discovery.ts` and `allRequiredDocuments`,
which `git log -S` showed in P30 has never had another caller.

**The fixture's value was wrong, and the rename made it say so.** Under `documentRef`, `"passport"`
was ambiguous; under `fieldRef` it is false, because no field on that page is called `passport`. It
is now `"passport_upload"` — what discovery would have written. One assertion moved with it: the P30
measurement in `run-driver.test.ts` now expects `["passport_upload"]`. The measurement is unchanged,
and the page declaration is still inert in both directions.

No behaviour changed. `check-boundaries` still bars `requiredDocuments` from the whole planning path.

### Added

**[`docs/state-of-the-system.md`](./docs/state-of-the-system.md)** — the standing account, rewritten
each phase rather than appended to. Every phase from Phase 0 to P35; the architecture as actually
built; all seventy ADRs with their status and amendment chain; a precise split of live / stubbed /
declared-but-unreachable / not built; eleven deviations from the original brief with reasons; twelve
open blockers in priority order; the test position including the surviving mutation; the cost
position; and the three things worth fixing first.

**Two decision sheets**, each answerable in one sitting, neither implemented:

- **[B5 — hold or pass through](./docs/decision-sheet-b5-hold-or-pass-through.md)**: the two options
  costed side by side, what each forecloses, what each means for B4, and a recommendation (**hold**,
  with the shortest period B1 permits) together with the counter-argument that would overturn it.
- **[B1 — the twelve retention determinations](./docs/decision-sheet-b1-retention-periods.md)**: all
  twelve as a table — data category, why it is held, what bounds it, a recommended period, and a
  confidence rating. Five rows are flagged **Low** and routed to the DPIA owner: the two carrying a
  third party's data, and the three children's rows, where minimisation and Article 7(1)
  demonstrability pull in opposite directions. The Children's Code and DPIA interactions are called
  out explicitly, as is the DPA 2018 Sch. 1 appropriate-policy-document question.

`README.md`'s status block is corrected — it still said Phase 5 and 669 tests.

2155 tests, 105 files, zero skipped, against real PostgreSQL and Redis.

---

## [0.52.0] — 2026-09-06

**P34 — an authorisation is spendable only in the application it names (ADR-0069).**

`DisclosureSubject.caseId` has recorded *"the case this belongs to"* since Phase 1.
`recordTransmission` copies it into the audit record and `renderDisclosureRequest` shows it to the
student as *"Which application:"*. **Nothing compared it to anything.** `mayTransmit` checked
withdrawal, `documentId`, `contentHash` and host, and `ExecutionContext` was
`{ portalHost, withdrawals, now }` — the executor had no case to compare against even if the check
had been written.

So an authorisation captured for one application was spendable in another whenever the document id,
the content hash and the host matched. ADR-0022 says an authorisation *"is not transferable"* about
documents; it was transferable between applications.

### The host is not the case

Two reviewed targets can share one portal host — a second course, a January intake beside a
September one, the same university. `ambiguousGroups` and `isAmbiguous` exist in
`packages/catalogue` precisely because routes collide on institution, course and intake. So "the
right university" is not "the right application", and the destination check cannot stand in for a
case check. Replacing `context.caseId` with `context.portalHost` at the gate fails four tests,
including the happy path.

### Changed

- `mayTransmit` takes `forCase` and gains a fifth refusal, `wrong_case`, checked **before** the
  document comparison: an authorisation belonging to another application is not this run's to spend,
  and reporting "wrong document" for it would name the wrong fault.
- `ExecutionContext` gains a required `caseId`. `executePlan` supplies it at every upload; the
  Automation Runner supplies it from `ClaimedWork.caseId`, which already crossed to the runner.

Required rather than optional, for ADR-0068's reason: an optional case is a case somebody forgets,
and every caller that must supply one already holds it. **No new identifier was introduced** — the
change joins two that existed and were never compared. The student and the target are deliberately
*not* checked separately: `cases.student_id` is written from the conversation's own row and
`cases.blueprint_id` from an offer verified against that conversation's log (ADR-0058), so one case
names exactly one student and one target under a foreign key. Three checks where a constraint
already holds one fact would be three chances to disagree.

### Verified, not assumed, about case and target binding

- **Student identity** comes from the `__Host-` session cookie, never a request body. A case's
  `student_id` is copied from the conversation row inside the binding transaction.
- **Case identity cannot be supplied by a client.** `RunDriver.start` derives it from the
  conversation, and `withBinding` returns the case the conversation already owns — a proposed id for
  a conversation that has one is ignored, not honoured.
- **Target identity is verified against the conversation**, not taken from the body:
  `POST .../target-requests` reads only an `offerHash`, checks it against the offers *this
  conversation's own log* says were made, and passes `verified.target.blueprintId` to the driver. A
  `blueprintId` in the request body is deliberately not read.

### `documentRef` — two meanings, recorded, neither renamed

`BlueprintPage.requiredDocuments[].documentRef` is a **portal** identifier: `pageFrom` sets it to
`field.fieldRef`, the name attribute of the `<input type="file">`. `MappingSource { kind: "document"
}.documentRef` is a **domain** key: what a reviewer decided AskiMate calls the document, and what
`DocumentSource` and the preview's document map are looked up by.

The repository contains both readings of the *same* field: discovery writes the portal's field name,
and the hand-written fixture writes `"passport"` where the file input's `fieldRef` is
`"passport_upload"`. Harmless only because ADR-0066 made the page's list causally inert and
`check-boundaries` keeps `requiredDocuments` out of the planning path. A test now pins the meaning
where the value is produced, asserted against the field and against its label. The smallest decision
still to take — renaming that field to `fieldRef` — is stated in ADR-0069 and not taken here: it is
free today and costs every catalogue approval once one exists.

### Attachment identity, frozen

An attachment is `(fieldRef, documentRef, contentHash)`, all three inside the preview content hash a
student authorises against, and `documentId` deliberately outside it — the vault mints it at store
time, so re-storing the same scan mints another, and a student agreed to send a document rather than
a row. Three tests, one per property, each regressed.

### Added

Six tests, all against real production paths: two cross-case refusals in `packages/disclosure`, one
through `executePlan` itself, three on the preview content hash, and one on `pageFrom`.

### Six deliberate regressions, all caught; one that survives, and why

Disabling the case check fails 3; making the host stand in for the case fails 4; dropping `fieldRef`,
dropping `documentRef` or adding `documentId` to the attachment hash line each fail exactly 1;
making discovery write the label instead of the field name fails 2.

**Not caught:** replacing `work.caseId` with a constant in the runner passes all 204 browser-runner
tests. `toStoredPlan` refuses a plan with uploads, so the runner's `plan.uploads` is always empty and
the gate is never reached. That is the transport gap appearing as a coverage gap rather than a
defect, and it is recorded rather than papered over.

### Not done, deliberately

**B5 is untouched.** Nothing here assumes hold or pass-through; the case check reads a field the
disclosure record carries under either shape. **`attach_document` still has no intent identity** —
it is declared, marked verifiable, and produced by nothing, so building an intent for it would be a
test against unreachable code. **Acquisition is still unbound**, because there is still nothing that
acquires a document. No transport, no route, no parser, no storage, no change to the Secure Plane.

---

## [0.51.0] — 2026-09-06

**P33 — the document transport boundary, costed. No ADR, because no decision was made.**

A read-only investigation turning ADR-0067's **B4** (no transport by which a student can supply
bytes) and **B5** (hold or pass through) into one decision with two costed answers. **Nothing was
built**: no route, no upload surface, no object storage, no document table, no change to the Secure
Plane. See [`docs/document-transport-options.md`](./docs/document-transport-options.md).

### The transport gap is two gaps

**(a) Student → AAS.** No route among the Conversation Service's nineteen; no `multipart` in either
OpenAPI document; the only body parser is `express.json({ limit: "64kb" })`.

**(b) AAS → the process holding the browser.** `toStoredPlan` refuses `has_uploads`, and the
**Automation Runner has no database, no vault and no cache** — it claims work over an internal API.
Nobody had named this half before. There is an exact precedent for it and it is *not* "send it to the
runner": for a password, ADR-0042 put a **Fill Agent** in the Secure Plane that types the credential
into the runner's browser over CDP.

### The finding that matters most

`ConsequentialAction` declares `attach_document` and marks it `VERIFIABLE` — and **nothing produces
it**. `WorkKind` is `create_account | execute`; `ACTION_FOR_WORK` maps those to
`create_portal_account | advance_portal_page`. So an upload rides the *page's* intent, and:

> **`pageValuesOf` reads `plan.instructions` only. Uploads are not in the target.**

The page's content identity is blind to which document is attached — replacing a passport does not
change the intent key, while `attach_document`'s own comment says *"Duplicates are visible to
admissions."* ADR-0051 §6 built the content-aware target so a late correction produces a different
intent; a document replacement is the same class of event and is invisible to it.

**Attachment needs its own intent identity under either option.** That is transport-level, not
policy, and blocked on nothing.

### Retry is the sharpest asymmetry

`executePlan` re-resolves `DocumentSource` **on every execution**. After a crash, `verify_first`
pauses for a person, and then the whole page re-runs.

- **Hold** — `vault.retrieve`. Transparent; nothing is asked of the student twice.
- **Pass-through** — nothing can produce the bytes. Either the student supplies the document again,
  at the least predictable moment, or something holds them, which is holding under another name.

### The Secure Plane exclusion, verified

Confirmed and stronger than P31 stated: ≤5-minute TTL (ADR-0034), all persistence disabled, a data
key per secret zeroed after use, `express.json({ limit: "8kb" })`, and `check-boundaries` forbidding
every request logger and error reporter in that app for a **measured** reason — body-parser attaches
the raw request body to a JSON parse error as `err.body`. **Verdict: evidence that document transport
is a separate boundary.** That `err.body` hazard is not Secure-Plane-specific and transfers.

### Added

- One test in `packages/orchestrator`, built from the real fixture rather than a cast, asserting that
  a page's target is unchanged by adding an upload or by swapping the document it names. Regressed:
  making `pageValuesOf` include uploads fails it.

**No ADR was written, deliberately.** The phase's correct outcome is that the architecture is
sufficiently specified to *choose*, and the choice is a product and legal one. Writing an ADR would
have been recording a decision nobody made.

---

## [0.50.0] — 2026-09-05

**P32 — the storage boundary refuses what ADR-0022 says it refuses. ADR-0068.**

ADR-0022 says a determination must be registered for *"storing identity documents, storing academic
documents…"* and that **"the system will refuse to act until they have"**. P31 measured that
sentence: true of sending, **false of storing**. `InMemoryDocumentVault` took a `RetentionSchedule`
and nothing else, and `store()`'s only gate checked retention — so with a policy configured and no
lawful basis anywhere, a document stored.

### Why a line was not enough

The gate was a **helper an implementation was trusted to call**. Every caller of the storage boundary
in this repository is its own test file; there is one implementation and no production one. Nothing
made the S3 + KMS implementation — which does not exist yet — call it too, and nothing would have
noticed if it had not.

So the question was never "add the check", it was "where does the check have to live so the
implementation nobody has written cannot skip it".

### Changed

- **`assertStorable` is the gate, and its result is the only thing `store` accepts.** It returns a
  branded `StorableUpload` carrying the resolved policy reference and the determination relied on.
  `InMemoryDocumentVault` consequently holds **no schedule and no register**: it is not that it now
  remembers to check, it is that there is nothing left to forget. ADR-0017's sentence applied to
  documents — *"was this reviewed?" is answered by the function signature rather than by a check
  someone has to remember to call*.
- **Two independent refusals.** `NoLawfulBasisError` when no determination is registered for the
  storing activity; `DocumentTypeNotCoveredError` when the determination that is registered was not
  made about this kind of document. Retention refuses exactly as before.
- **The activity name is derived, not invented.** `storageActivityFor(purpose)` returns
  `store_document:<RetentionPurpose>` — the closed union that already keys the retention gate, at the
  granularity ADR-0022 enumerates. Both gates keyed the same way, so they cannot disagree about which
  category a document is in, and adding a purpose adds a determination somebody must make.
- **`ProcessingActivity.documentTypes` is read for the first time.** Declared since Phase 1 and
  checked nowhere; it is a determination's scope, and holding outside it relies on a decision nobody
  made.
- Public contract changes to `packages/documents` — `store`'s signature and the vault's constructor —
  made because ADR-0022 states a guarantee the previous shape could not provide.

### Deliberately not checked

A determination's `reviewBy`, at storage time. `determineLawfulBasis` refuses an expired one when it
is made, and `requirePolicy` does not re-check a policy's `reviewBy` either — `validateSchedule`
reports staleness and `retention-status` prints it in CI. A second, differently-placed staleness rule
on one of the two gates would be an inconsistency, not a control.

### Every place document bytes can exist — traced, not assumed

Three: the vault's `store` argument and in-memory contents; `packages/extraction`'s reader input; and
`AuthorisedDocument.contents` on its way to `session.attach`, which uses `setInputFiles` with an
**in-memory buffer** rather than a path, so the runner writes no temporary file. Searched and found
absent: any `bytea` or blob column, any logging or serialisation of `contents`, any document-shaped
conversation event. Everything else holding a `Buffer` is the secret plane, structurally separated.

### Still not settled

**Whether transient in-memory bytes are "storage".** ADR-0010 gates `vault.store`; ADR-0023 says an
unresolved requirement blocks storage; neither classifies bytes held for the duration of an upload.
ADR-0067's pass-through shape is therefore neither adopted nor closed off — but what changes if it
were chosen is now stated precisely, including that on retry `executePlan` re-resolves the
`DocumentSource` every time, so something must be able to produce the bytes again.

### Proved

Six deliberate regressions, all caught. M1 and M5 remove one gate each and fail six tests apiece with
the other gate's tests untouched, which is how the independence is established rather than asserted.
M4 — widening the signature back — passes every behavioural test and is caught by a source assertion,
recorded plainly as the honest form for a property that lives in a type. See
[`docs/p32-regression-audit.md`](./docs/p32-regression-audit.md).

---

## [0.49.0] — 2026-09-05

**P31 — AAS obtains documents; what blocks it is policy, not design. ADR-0067.**

P30 ended by recording *"does AAS ever obtain a document, or only ever identify one?"* as an open
product question. **It is not open**, and the error is worth naming: P30 read the three fields called
`requiredDocuments` and concluded from their inertness that the boundary was undecided. It never read
the document subsystem sitting beside them.

### The answer, and the evidence

**AAS is designed to obtain, hold, extract from and transmit documents.**

- **ADR-0010** answers *Phase 0 Open Question 5 — how long do we keep a passport scan*, and
  instructs: *"Design the document vault so that retention periods are configurable and
  policy-driven."*
- **ADR-0022**: *"The system must not upload a document to a university merely because the document
  exists in the vault."* Its whole subject is constraining that upload, not preventing it.
- **ADR-0016** is about AAS reading a document it holds — *"a model asked to read a blurry
  photograph"*.
- `packages/documents` implements the full lifecycle; `packages/execution` **already transmits**,
  gating every upload on `mayTransmit` at the moment of upload, wired into the runner today;
  `scripts/end-to-end.ts` already performs a document upload end to end against a replay.
- `docs/what-a-controlled-live-run-needs.md`: *"the first real document upload will fail loudly."*

Identification-only would be a **narrowing** of a decided design, stranding `packages/documents`,
`packages/extraction` and the upload half of `packages/execution`.

### What actually blocks it — four things, three needing a person

| | Blocker | Owner |
|---|---|---|
| B1 | Twelve unresolved retention requirements | `data_protection_owner` |
| B2 | No lawful-basis determination for `disclose_document_to_institution` | a named determiner |
| B3 | No lawful-basis **activity** for holding, and no storage-time gate consulting one | determiner, then engineering |
| B4 | No transport: nothing by which a student can supply bytes | product + engineering |

And a third shape nobody had named: **pass-through** — transmit without ever storing. `DocumentSource`
returns bytes and an authorisation; nothing requires a vault. It would engage ADR-0022's single
determination and none of ADR-0023's twelve. **Recorded, not adopted**: whether bytes held in memory
for the duration of an upload are storage under UK GDPR is exactly what ADR-0023 forbids guessing at.

### Corrections

- **ADR-0066 §6.1** — the product direction is answered, not open.
- **ADR-0022** overstates what the vault enforces. Measured: `InMemoryDocumentVault` takes a
  `RetentionSchedule` and nothing else, and `store()`'s only gate is `assertStorable`. With a
  retention policy configured and no lawful-basis determination anywhere, a document stores. The
  ADR's *"the system will refuse to act until"* is true of sending and false of storing. Not
  exploitable today — no policy exists and no deployable holds a vault — and deliberately not closed
  here, because closing it means deciding where the lawful-basis machinery sits relative to
  `packages/documents`, a coupling inside the architecture this phase exists to leave unsettled.

### Measured

- **103 real discovery runs** against the Ulster Birmingham / QA Higher Education portal observed
  **zero file inputs and zero document requirements** — the application is behind a login and
  discovery never signs in (ADR-0014). Nothing in this repository yet knows what documents a real
  application requires.
- **No approval exists**: the only `approvals.json` files anywhere are in `/tmp` test directories.
- **Field names are inside the content hash** — `{requiredDocuments: […]}` and
  `{studentDocuments: […]}` hash differently. Now pinned by a test, and regressed.

### Added

- One test, in `packages/catalogue`: the canonical form depends on field names, which is why the
  document field names must be frozen **before** the first artefact is approved and not after.
- [`docs/p31-document-evidence-map.md`](./docs/p31-document-evidence-map.md) — every ADR and module
  that assumes something about documents, with a reachable-from-a-deployable column.

**Nothing was built.** No upload path, no storage, no table, no engine, no schema change.

---

## [0.48.0] — 2026-09-05

**P30 — three declarations name a document, and one of them decides. ADR-0066.**

P29 found two fields called `requiredDocuments` and could not say which meant what. Investigating it
produced a **third**, and a correction to P29's own account of the first two.

| | Declared on | What it is |
|---|---|---|
| **A** | `BlueprintPage.requiredDocuments` | discovery's record of the `<input type="file">` elements it SAW; `documentRef` is the portal's own `fieldRef` |
| **B** | `MappingSource {kind:"document"}` | the reviewed, two-person, blueprint-pinned decision (ADR-0017) |
| **C** | `CatalogueEntry.requiredDocuments` | domain document TYPES, shown to the student in the offer |

They are not three names for one thing. **A is an observation of a portal, B is a decision about a
portal, C is a statement to a student.**

### Measured, in both directions

Two mutations through the real driver:

- **A removed, B kept** — the page declares no document, the mapping still does → the run still stops
  for a specialist naming `passport`; **all 10 of ADR-0065's tests pass unchanged**.
- **A kept, B removed** — the page declares a *required* passport, the mapping does not → the run
  reaches **`authorise`**.

So **A is neither necessary nor sufficient: it decides nothing.** `allRequiredDocuments` has exactly
one caller in the repository — `scripts/inspect-discovery.ts` — and `git log -S` shows it has never
had another.

### Changed

- **ADR-0065 §6 is corrected.** It said the blueprint page's declaration "reaches the preview and
  stops the run". What reaches `plan.uploads` is `mapping.source.documentRef`; the fixture author
  happened to give both the same string, which is why they looked linked. The live code comments that
  repeated it are fixed; the ADR's own text stands with the correction recorded in ADR-0066, as
  ADR-0065 did for ADR-0064.
- **Doc comments on all three declarations** naming the concept, its authority and the ADR. The
  driver's read *"Document kinds the interview must collect"*, which was never true of any code path.

### Added

- **A `check-boundaries` rule.** `packages/orchestrator`, `packages/mapping` (outside fixtures),
  `packages/preparation` and `packages/execution` may not mention `requiredDocuments` at all. The
  tempting change is to join the declarations up because they share a name — and against the shipped
  fixture that change is *behaviourally silent*, which is exactly why the control has to be
  structural.
- **Five tests** pinning both mutation directions, the contradiction case, and the interview's
  unreachable capability.

### Measured, and deliberately not fixed

A reviewed entry declaring `["passport"]` against a blueprint that attaches nothing produces the
offer the student **accepts**:

```
  Documents needed: passport
```

Nothing then asks for it, blocks on it, or records that it was never obtained. **The defect is not
that the passport is unenforced — it is that a promise is made and its non-fulfilment is invisible.**

It may not be made authoritative in its present shape: a bare `string[]` has no `scope` (ADR-0021
makes the field mandatory precisely so a rule cannot default into blocking), no criticality and no
provenance (ADR-0009 refuses anything below its evidence bar for an application decision), and
promoting it would be the "new authority hierarchy that bypasses these rules" ADR-0019 forbids.

Two timing facts make the product decision urgent and cheap: **no approval exists yet** — there is no
`approvals.json` anywhere and the fixture catalogue declares `[]` — and because `toCanonical` walks
the parsed object, **field names are inside the content hash**, so renaming either field costs
nothing today and invalidates every approval once one exists.

### Also, found while reading `target.ts`

`ambiguousGroups` joins the three identity refs with **U+0000**, and the separator is the whole safety
property: a character that can occur in a ref would let `("a", "b|c")` and `("a|b", "c")` collide into
one key and hide an ambiguity the student must be shown — which, by `submissionKey`, is irreversible.

It was written as a **raw NUL byte**, inside the first 8 KB of the file, which is git's binary
heuristic. So every diff of `target.ts` — the file holding **both** of ADR-0058's gates and the offer
hash's canonical form — came back as `Binary files differ`, including this phase's own change to it. A
control nobody can review in a diff is most of the way to not being one.

Escaped to `\u0000`. **The runtime string is unchanged**, the file is text again, and the separator now
has a test: a printable separator fails it. A repo-wide scan found the other raw control bytes
(`0x1f` unit separators in the preview hash and the submission key, `0x1b` colour codes in scripts) —
none is a NUL, none makes git treat its file as binary, and none was touched.

### Proved

Eight deliberate regressions, all caught, attacking both joining the declarations up and taking one
away. Also recorded: a fault in the mutation harness itself, which could leave a half-applied
mutation on disk on the path where it reports failure. Found by reading the filesystem back rather
than trusting the harness — the third phase running that this has caught something. See
[`docs/p30-regression-audit.md`](./docs/p30-regression-audit.md).

---

## [0.47.0] — 2026-09-05

**P29 — a run only a person can carry on stops, and says so. ADR-0065.**

`nextStep` answers `{kind: "specialist", reason, detail}` from **ten** places — seven reachable — in
five kinds of situation. The run driver acted on **none** of them. `#decideOnce` fell through to `checkpointAfter`, which preserves the status it
finds, so the run stayed `running`, `dueRuns` handed it to the worker on every pass, and the student
was told nothing at all.

Measured through the real driver, against the shipped fixture catalogue, before the change:

```
step: specialist   status: running   phase: awaiting_specialist
interventions: 0   messages: 0       still due for the worker: true
```

`FIXTURE_BLUEPRINT` reaches it honestly. It attaches "Upload your passport"; `planFill` routes a
document-sourced mapping to `uploads` and never to `blockers`, so the interview never hears about it;
every field being confirmed, the run walks to `buildPreview`, which refuses `document_missing`. That
refusal is the architecture declining to proceed. Nobody was acting on it.

### Added

- `#stopForSpecialist` — the orchestrator's hand-over becomes a real stop, through
  `#raiseForSpecialist`, the construction P28 extracted so there is still exactly one way for a run
  to be waiting for a person. Reason `information_unobtainable`, deliberately **not** derived from
  the orchestrator's `reason`, which is typed `string`: `recovery.ts` says alerting routes off the
  reason and "a routing decision made from free text is a routing decision waiting to fail". The
  precise reason is carried losslessly in `checkpoint.target` as `specialist:<reason>`, where nothing
  routes off it, and its detail becomes `encountered` — so a specialist reads *The application
  attaches "Upload your passport" and no document has been provided for "passport"* without opening
  the blueprint.
- `specialistMessage`. It tells the student a person now has it, that nothing they gave is lost and
  nothing has been submitted — and **does not name the document**, because naming it would read as a
  request and there is nothing to receive one with.
- A test that the stop reaches the student over the **published** `GET /v1/conversations/{id}/runs`,
  the only thing a client reads after sending a message.
- A test that a second, non-document reason (`portal_authentication_unobserved`, reached from a
  different branch of `nextStep`) stops the same way — so a fix that only handled the reason that
  happened to be measured cannot pass.

### Changed

- **ADR-0064 §2's stated reason for returning a position rather than falling through is corrected.**
  It said the ordinary checkpoint would put the status back to `running`. It would not:
  `saveCheckpoint` writes `input.status ?? from`, so omitting the status preserves it. What falling
  through actually costs is the revision — the stop has already saved at `record.revision`, so
  `checkpointAfter` passes a stale one, raises `RunConcurrencyError`, and `#decide` spends one of
  three retry attempts. The outcome still came out right, which is why nothing noticed. Both stops
  now assert that the checkpoint is written **once**.

### Measured, and deliberately not fixed

There are **two** `requiredDocuments` and neither is derived from the other. The structured one on a
**blueprint page** reaches the preview and now stops the run. The flat string list on the
**catalogue entry** reaches only `InterviewState` and the published target listing: nothing plans
from it. Asserted, not assumed — a run against a reviewed entry declaring `["passport"]` whose
blueprint attaches no document reaches `request_secret`, still `running`.

Closing that means deciding what an entry-level declaration *means*, which is a product question.
**No upload path, no storage, no retention period and no disclosure rule was invented here**, and the
schema assertion from P28 still holds: no table and no column for a document.

### Proved

Ten deliberate regressions. Eight caught first time; two survived, and both were the same mutation
against the P29 and P28 stops — real controls whose comment named the wrong reason, which is how the
correction above was found. Also regressed: removing `buildPreview`'s `document_missing` refusal,
under which the run does not strand but **proceeds to `authorise` with the passport silently
dropped**. See [`docs/p29-regression-audit.md`](./docs/p29-regression-audit.md).

---

## [0.46.0] — 2026-09-05

**P28 — the interview's decision to stop reaches the system. ADR-0064.**

`nextAction` returns a closed union of five kinds. The driver honoured `ask` (ADR-0062) and `confirm`
(ADR-0051), and `complete` lets the step move on. **`escalate` and `request_document` were silently
dropped.** The tell was in the code: `interviewAsk`'s comment enumerated the non-question kinds as
"`confirm`, `complete` and `escalate`" and omitted `request_document` entirely.

`escalate` was a live stranding bug, reachable with the shipped fixture catalogue. After three
rejected readings of the last outstanding field the interview decides a specialist must look — and
nothing happened. No message, no intervention, no status change. Because `interviewAsk` also matched
only `ask`, every further thing the student said was ignored too. The run sat at `interview` for
ever, above a composer inviting answers nobody would read.

### Added

- `#stopIfTheInterviewGaveUp` — the run stops for a person when the interview cannot obtain
  something. Reason `information_unobtainable`, whose own definition in `recovery.ts` is this
  situation and which nothing had ever raised; priority `high`, because `recovery.ts` reserves
  `critical` for an imminent deadline and this driver does not know the deadline; target
  `interview:<fieldKey>` or `document:<documentType>`, a stable identifier rather than the model's
  prose, because the target is part of the idempotency key.
- `#raiseForSpecialist`, extracted from `#pauseForReview` so both callers share **one** construction
  of ADR-0048's intervention rather than two that could disagree about which runs are waiting.
- Two honest student-facing messages. Neither is `reviewMessage`, which says "a rule we apply every
  time, not something that has gone wrong" — true for a mandatory review, a lie here.

### Changed

- The stop is reached from the **message path** as well as the decide path. A client that has just
  sent a message re-READS the run rather than advancing it (ADR-0060), so a check only in
  `#decideOnce` would never have fired in the journey a student actually walks. The browser test
  caught that. `#decideOnce` keeps its check for the crash window: `#correct` appends the rejection
  and then re-derives, so a process dying between them leaves an exhausted log and a running run.
- The student's page no longer shows the step for a run waiting on a person. It read
  `Your application: interview (escalated)` above an open composer; it now says the application is
  with a member of the team, and does not name the step at all.

### Measured, and deliberately not fixed

`request_document` is **not reachable** through the run driver's step derivation: `planFill` sends a
document mapping to `uploads` and never to `blockers`, the orchestrator enters the interview only
when blockers exist, and `nextAction` returns `request_document` only once no field is missing. The
first version of its test asserted an escalation that cannot happen and was deleted rather than kept
green.

What that leaves is worse than the stranding it replaced, and is recorded rather than worked around:
**a reviewed artefact can declare `requiredDocuments`, and the run neither asks for it nor stops.**
Closing it means building document upload, which is blocked on the disclosure (ADR-0022) and
retention (ADR-0023) decisions. **No upload, no storage, no retention rule was invented here**, and a
test asserts the schema still holds no table or column for a document.

### Proved

Ten deliberate regressions. Seven caught first time; three survived and each got a different honest
answer — a missing crash-window test written, a no-op mutation of my own rewritten, and one branch
recorded as unreachable and asserted as data. See
[`docs/p28-regression-audit.md`](./docs/p28-regression-audit.md), which also records a browser test
of mine that was a race and what replaced it.

---

## [0.45.0] — 2026-09-04

**P27 — the published contract names the routes that exist. ADR-0063.**

`scripts/contract-drift.test.ts` has guarded the seam between the contracts package and the domain
since P13. It loads both OpenAPI documents. **It never read `paths`.** Every check in it compares an
enum, so while the vocabulary was pinned in three directions at once, the route table drifted for
twenty-three phases with nothing looking at it.

Six discrepancies had accumulated:

- `GET /health` was published; the real endpoint is `GET /healthz` at the app root. A generated
  client would have called `…/v1/health` and got a 404.
- The server base was `…/v1` while internal paths carried their own `/internal/v1`, so they resolved
  to `…/v1/internal/v1/…`, which nothing serves — and `/healthz`, at the root, could not be
  expressed at all.
- `GET /v1/conversations/{id}/secure-requests/{id}/bootstrap` — a **public, session-authenticated**
  route — had no schema at all. Served since P4.
- Three `/internal/v1` review and intervention routes were unpublished while three other internal
  routes were published, so "internal means unpublished" was not the explanation.
- The Secure Plane's `POST /internal/v1/secret-requests/{id}/frame-tokens` and its `GET /healthz`
  were unpublished too.

A seventh, found by reading the resulting diff rather than by the new guard: `secure.v1.yaml`'s
`security` default was indented **inside `components:`**, where OpenAPI has no such field and every
generator ignores it. As published, that document declared no authentication at all on its three
student-facing operations — including `POST /v1/secret-requests/{requestId}/secret`, the one
endpoint in this system that carries a secret. Proved pre-existing against `git show HEAD`. Nothing
was ever exposed — the service authenticates them with the `__Host-` secure cookie, and the
two-origin browser suite proves it — but the contract is what a reviewer reads.

### Added

- A path-level guard in `contract-drift.test.ts` that walks the **real Express layer stack** rather
  than parsing `router.get("…")` out of the source, and compares it against both documents. Built
  with every optional surface supplied — `auth`, `issueSessionFor`, `publicDir` — because the route
  set depends on configuration and the minimal app would let a surface hide behind an unset option.
  An absent or empty stack throws: an empty set would agree with an empty contract.
- Schemas and operations for the four undescribed routes, written from the handlers rather than
  invented: `SecureStepBootstrap`, `HumanReview`, `OpenIntervention`, `ResolutionSubmission`.
- `GET /healthz` in both documents, and `POST /internal/v1/secret-requests/{id}/frame-tokens` in the
  secure one.
- `UNPUBLISHED` — the three routes that are deliberately not operations, each with the ADR that
  decided it, asserted as **data**: an exception naming an unserved route fails, and so does one
  whose reason cites no ADR.

### Changed

- `conversation.v1.yaml`'s server base is now the origin and every path is literally the path the
  process serves — the shape `secure.v1.yaml` already used and was right about. That is what makes a
  mechanical comparison possible at all.
- `openapi.test.ts`'s intended-open list corrects `/health` to `/healthz` and gains the secure
  plane's. No authentication boundary moved: every newly published internal route declares
  `serviceMutualTls`, and the bootstrap inherits the `__Host-` cookie default.
- `secure.v1.yaml`'s `security` default moved from inside `components:` to the document level, plus
  two assertions that close the class: every operation must resolve to a real requirement — its own
  or a document default that exists — and `components.security` must be undefined. The existing
  test looked for an explicit `security: []` and so could not see an operation declaring nothing.

### Removed

- `ConversationEventStore.isOrdinalCollision` and the `UNIQUE_VIOLATION` constant that fed only it.
  Zero callers anywhere including tests, no ADR reserving it, and the store's own design comment
  says the `UPDATE` takes the lock first so the 23505 it detects is a backstop the design avoids
  triggering. The other collision retry in the file uses `ON CONFLICT DO NOTHING`, not the code.
- The barrel export of `handoverChecklistFrom`. No importer anywhere; the function stays with its
  one internal caller.

### Proved

Fourteen deliberate regressions, all caught. Recorded honestly in
[`docs/p27-regression-audit.md`](./docs/p27-regression-audit.md): fourteen of fourteen measures
controls built and tested in the same phase, and the real finding is the seven discrepancies found
before any mutation existed. The mutation worth naming is R7, which adds a route and publishes
nothing — the exact P4 and P11 failure, replayed, and now caught. The audit also records a harness
hazard that nearly cost the security fix: a stale snapshot silently reverted it, and only reading
the file back from disk caught that.

### Not changed, deliberately

`withAccount` is barrel-exported and imported only by `orchestrator.test.ts`. That is a real caller,
so it is exported-for-test rather than dead, and removing it was out of scope for a contract phase.

---

## [0.44.0] — 2026-09-04

**P26 — the question the run is waiting on is in the log. ADR-0062.**

P25's client drove a full case and drew a blank screen at the interview: the run said
`interviewing`, nothing was pending, and the transcript held no question. The cause is one line in
`packages/orchestrator/src/run.ts` — `nextAction` composes the question, the step carries it, and
**the run driver threw it away.**

The same shape ADR-0051 opened with, and the fix then went half the distance. `answerStudent` was
wired to the message route, so an *answer* became a proposal and a playback. Nothing ever wrote the
question that answer was answering. Every test supplied the answer from the test process, which is
why nothing noticed: a test that knows the question does not need it in the log.

The interview was a conversation with one voice.

### Added

- `value_asked` — a conversation event naming the field a question was put about. Content-free: the
  words are the assistant message beside it, which is the orchestrator's own `action.say`, carried
  on the step. A second composition here could ask something other than what the run is waiting on.
- `openQuestion(events)` — the last `value_asked` with nothing after it that answers or supersedes
  it, and the `open_value_questions` view that says the same rule in SQL. A student **message**
  closes it, even one nothing could be read from: they answered, the reading failed, and they are
  owed the question again rather than silence.
- Migration `0014_the_question_is_in_the_log.sql`. `a_proposal_exchange_names_a_field` is widened to
  the new kind rather than made vaguer; `a_playback_hash_belongs_to_the_exchange` is untouched,
  because nothing is confirmed against a question.

### Changed

- The driver asks from three places, each one somewhere it already writes: `#decideOnce` when the
  run reaches the interview, `#confirmValue` when a reading is accepted, and `answerStudent` when an
  answer could not be read. Under the conversation's row lock with the log re-read inside it, the
  way `#openSecureStep` takes it, and idempotent by the log the way `#raiseHandoff` is by token.
- The ask hangs off `#confirmValue` rather than waiting for an advance because a client that has
  just confirmed a reading **re-reads** the run (ADR-0060, ADR-0061) and a read must not append.
  Without it the journey stalls on a screen that says `interview` and asks nothing.
- Two existing tests were corrected rather than kept green. `run-driver.test.ts` asserted "nothing
  structured was written" after an unreadable answer — true, and the defect. `p21-target-selection`
  asserted `target_requested` was the last event in the log, which the interview's question now
  follows.

### Proved

Eleven deliberate regressions, all caught. Two needed a second attempt, and both faults were in the
harness: one mutation built a shadow object and discarded it, and one was run against vitest when
the control is a lint rule that no test can see. Fixing the first exposed a weak assertion — "a
message was written" proved nothing about where the words came from — so the question's text is now
asserted against the field's own label. See [`docs/p26-regression-audit.md`](./docs/p26-regression-audit.md).

### Not changed, deliberately

An answer the model could not read still leaves no proposal and so does not count towards
`MAX_ATTEMPTS_PER_FIELD`. `value_asked` could now carry that counter; making it do so would change
when `information_unobtainable` fires, which is a behavioural change to an escalation rather than a
gap in the journey.

---

## [0.43.0] — 2026-09-04

**P25 — the student client, in the service that serves its origin. ADR-0060.**

Every route the journey needs has existed since P24. This phase built the one browser document that
walks it: reviewed targets → a deterministic offer → an explicit request in the student's own words
→ the interview → the preview → hash-bound authorisation.

It lives in `apps/conversation-service`, not in `apps/chat-integration`, because the session is a
`__Host-` cookie and the browser binds that to exactly one origin — this service's. A page served
from anywhere else has no session at all. Same shape as the secure control: a client module, a
build step, and `express.static`.

### Added

- `apps/conversation-service/src/client/transport.ts` — the browser's side of this service's own
  API. Fetch calls and nothing else: no derivation, no caching, no state. Every read is parsed by
  the **contract's own parser**, and a body the parser refuses is a `contract_mismatch` outcome
  rather than a screen built from a shape nobody published.
- `apps/conversation-service/src/client/journey.ts` — the page. `refresh()` rebuilds the entire view
  from the server, and it is the same path a fresh load takes, so there is one code path to be right
  about rather than two. SSE frames are a **trigger to re-read**, never a source: the frame is
  parsed to confirm it is an event this contract publishes, and then discarded.
- `apps/conversation-service/src/build-client.ts` — `buildStudentClient(outDir)` writes
  `journey.js`, `journey.css` and `index.html`. Not committed, for the reason the secure control's
  bundle is not: a committed bundle is a second copy that can go stale.
- `apps/conversation-service/src/student-client.test.ts` — fifteen tests, real Chromium against a
  real Postgres and the real app. It reconstructs the screen after `localStorage.clear()` and a
  reload, asserts browser storage is empty, and drives a full case from the target listing to a
  confirmed reading.
- A boundary rule, **"the student's page"**: no client file may import a server module of the
  service beside it, or any of the capability packages that would let a browser decide what the run
  does next. It refuses to pass when it is looking at nothing.

### Fixed

- **`parseConversationEvent` did not know `target_offered` or `target_requested`.** Added in P21,
  never taught to the parser — so any consumer parsing a conversation containing them got `null`.
  Nothing had noticed, because nothing outside the service had parsed a real log. `contracts.test.ts`
  now asserts that **every** member of `EVENT_KINDS` round-trips.
- **The page held a run reading the server had not just confirmed.** A failed re-read left the
  previous answer in place — a decision button still bound to a hash the server no longer names,
  which is exactly what ADR-0060 forbids the client to hold. The failed half is now cleared and
  reported, and the target listing is suppressed after a failed run read.

### Changed

- `apps/conversation-service` may hold `playwright` in tests but not in production, matching
  `apps/secure-service`. `tsconfig.json` gains DOM types, app-wide, matching the three apps that
  already have them; what stops a *server* file reaching for `document` is the boundary check, not
  the compiler setting.

### Proved

Eleven deliberate regressions, all caught — two of them only after the first attempt **survived**,
and both survivals are recorded as findings rather than re-run until they looked better. Removing a
package from the client's forbidden list changed nothing while no client file imports it: a mutation
that never executes is not coverage, so the rule is now asserted as data. Deleting the transport's
contract check changed nothing while the server stays correct: the response is now corrupted at the
browser's network boundary, and chasing that test is what found the stale-reading defect above.

See [`docs/p25-regression-audit.md`](./docs/p25-regression-audit.md).

### Not closed

The interview *question* is never appended to the conversation log — `#putToTheStudent` writes only
the playback, after an answer — so the page has nothing to render while a question is outstanding.
A real gap in the journey, recorded in the test and the audit. It is a server-side gap.

---

## [0.42.0] — 2026-09-04

**P24 — the run says what it is waiting for. ADR-0061.**

Reconstructing what a client would do at each state — before writing one — found one student
decision it **could not form at all**.

Three of the four decisions carry the hash of what the student was looking at. `confirm_value`'s is
on the `value_proposed` event; `authorise`'s is served by the preview route since ADR-0059. But
**`confirm_handoff`'s hash is over a message the orchestrator renders**, not over anything in the
conversation log — so a client could only produce it by re-implementing `handoffMessageOf` and
`hashOfText` and then being right about which message it applied to.

`RunDriver.handoffHashFor` already existed, public, saying in its own comment *"the client needs the
same number to send back, and it must come from the SERVICE"*. One caller: a test. No route. The
third time this shape has been found.

`journey.test.ts` was hashing the last message in the conversation. That worked, and would not work
in a client: "the last message" stopped being the handoff message the moment ADR-0059 made the
authorisation announcement an assistant message too.

### Added

- `GET /v1/conversations/{id}/runs` now returns `pending` — `{ decision, contentHash }` or `null`.
  `decision` is one of `confirm_value`, `authorise`, `confirm_handoff`: the three that are
  *prompted*. Every hash comes from the same source the decision route validates against, and the
  position and the pending decision are computed from **one** situation.
- `PendingDecision` in the published contract.

### Removed

- `handoffHashFor`. Its one caller was a test, and a second derivation beside the read is the drift
  this closes.

### Changed

- `journey.test.ts` computes no hash at all any more. It reads what the run is waiting for and sends
  that — which is what a browser will do.

### Why `cancel` is absent

ADR-0053 makes a stop available at every step and it carries no hash, so it is not something a run
*waits* for. A client offers it always, because the architecture says so, not because a read
mentioned it.

### Proved

Seven deliberate regressions, six caught. The seventh is **recorded as unreachable rather than
counted**: removing the handoff read's open-token check broke nothing, and probing the state it
guards showed the state cannot occur — the step is derived from the same completion that closes the
token, so the two move together. The test written for it was deleted rather than kept green, and
both the code and the ADR now say the branch is unreachable, kept so the read matches the validator
by construction rather than by coincidence.

---

## [0.41.0] — 2026-09-04

**P23 — the journey is startable and readable. ADR-0060.**

P22 completed the last consequential gate, so the next question was where the student's client
lives. The obvious answer — `apps/chat-integration`, which already holds a React client that talks
to this service — is wrong, and the repository says so in six independent voices: its own
*"RESEARCH BUILD — NOT THE PRODUCTION INTEGRATION"* banner over the **archived** AskiMate codebase;
ADR-0028's *"research-only … not part of the product's behaviour"*; ADR-0039's *"conversation-service
← was chat-integration"*; the Phase-E audit's disposition for its surface files — **"Discard.
Replaced by the real dashboard"**; `ChatView.tsx`'s own *"PROVISIONAL — not an AskiMate interface"*;
and its absence from the five deployables.

It also **cannot** be the surface: the session is a `__Host-` cookie, which the browser binds to one
origin, and that origin is this service's. And it is already a second source of truth — a parallel
schema, a parallel identity, and per ADR-0041 a parallel event log.

So the client belongs to the Conversation Service, following the precedent the Secure Service
already set with `control-client.ts`. **No UI is written in this release.** What is written is the
four things a client needs before it can exist without becoming a second source of workflow truth.

### Added

- `POST /v1/conversations` — **published in `conversation.v1.yaml` since the contract was written and
  never implemented.** Every conversation in this repository was a raw `INSERT` in a test; there was
  no production path to the first step of the journey. No request body; the server generates the id.
- `GET /v1/conversations` — the caller's own, newest first, paged on a `(created_at, id)` cursor.
  The `conversations_by_student` index has existed since migration 0001 for this query.
- `GET /v1/conversations/{id}`.
- **`GET /v1/conversations/{id}/runs`** — where the application has got to, **without acting on it**.
  Before it, `POST .../runs` was the only way to learn a run's position and it needs an `offerHash`,
  so a client that reloaded had to keep the run id, the step and the offer hash in browser storage —
  making the client a durable holder of workflow identity. `{ run: null }` is a real answer,
  distinct from 404.
- `src/ulid.ts` — Crockford base32, 48 bits of time then 80 from the CSPRNG. The contract and the
  column's CHECK had demanded this shape from the start and nothing produced one.
- Migration `0013` — an idempotency key may name a conversation, not only an event, with a CHECK
  that it names exactly one.

### Changed

- `journey.test.ts` opens its conversation over HTTP instead of by SQL, and reads the run position
  from the new route rather than remembering it — which is the proof a client could.
- The published contract drops the `409` from `POST /conversations`: with no request body, two
  requests carrying one key cannot disagree, so the conflict was unreachable. The key is documented
  as the replay guard it is.

### Fixed

- **A page cursor built from a JavaScript `Date` silently lost rows.** `timestamptz` keeps
  microseconds and `toISOString()` prints milliseconds, so the cursor named an instant earlier than
  its own row and skipped everything created in the rest of that millisecond. Found by the paging
  test on its first run; the cursor now carries the database's own value.

### Proved

Fourteen deliberate regressions, eleven caught first pass. One real gap: the id generator's two
published properties — sortable, not guessable — had no test, because every listing test inserts
literal ids. Two others survived because I had gated the mutation behind a request header no test
sends; both were redesigned to run on the path the tests actually take, and both are then caught by
assertions that already existed. A mutation that never executes proves nothing about the code.

---

## [0.40.0] — 2026-09-04

**P22 — the student can read what they are authorising. ADR-0059.**

The brief's rule is that nothing is typed into a university's form until the student has seen
exactly what will be sent and said yes. Measured at `4b22a99`, after P21 made the journey
startable:

- the orchestrator rendered the preview and carried it on the `authorise` step;
- `RunDriver.previewHashFor` could read it, and said in its own comment that it existed *"for a
  surface that has to render the preview and send the hash back"*;
- **no route published either**, and the `authorise` stop appended no message — the only pause in
  the system that announced nothing;
- `POST .../runs/{runId}/decision` requires a `contentHash` a client had no way to obtain.

So **the only code in this repository that could complete an authorisation was a test that rebuilt
the preview in-process** from the blueprint, the mapping set and the plan — three things a browser
will never hold and must never be given. The gate was passable by the test suite and by nothing
else.

### Added

- `GET /v1/conversations/{conversationId}/runs/{runId}/preview` — the application as it will be
  sent, in the words the student reads, with the hash their approval names. `Cache-Control:
  no-store`; owner-checked; 404 both for a run that does not exist and for one that is not asking,
  deliberately the same answer.
- `RunPreview` and `parseRunPreview` in `@askimate/aas-contracts`, and the schema in
  `conversation.v1.yaml`.
- `StudentDecision`, `HashedStudentDecision` and `CancelDecision` schemas, and the
  `POST .../runs/{runId}/decision` path — which the published contract had never documented at all.
- One assistant message when the case first reaches `AWAITING_STUDENT_AUTHORISATION`. A **pointer,
  not a copy**: it carries no part of the application.

### Changed

- `RunDriver.previewHashFor` → `previewFor`, returning `{ contentHash, presentedText }` from **one**
  read of the step. Two reads that recomputed the same situation could answer differently after a
  change between them; one cannot.
- `journey.test.ts` obtains the hash from the route instead of re-deriving it. It still re-derives
  one independently — but now only to assert the route served the same content the run fills from.

### Why the preview is a projection and not a message

`SubmissionPreview.toJSON()` throws on purpose: the plaintext may go to the student and to no log,
event, trace or audit record. A conversation event is an event. A stored copy would also go stale
silently — the decision route compares against what would be rendered *now*, so a student reading
yesterday's message would be refused for a mismatch they cannot see. And `NO_RUN_FIELD_IS_FREE_TEXT`
in `runs.ts` had already anticipated this, naming *"a `preview` added later"* as a build failure.

### Proved

Thirteen deliberate regressions, ten caught on the first pass. Three survived and are now caught:
a refusal test that reached the guard through a run that did not exist, so the guard in front
answered first; and a contract parser exercised only on its accepting path, leaving both its
refusals — an empty rendering, a malformed hash — unasserted.

---

## [0.39.0] — 2026-09-03

**P21 — a student chooses a reviewed target, and asks for it. ADR-0058.**

Every phase from P4 to P20 built something downstream of a step nobody could
take. The run-start endpoint took a `blueprintId`: a string a client chose,
which proves nothing about what a person was shown. `bp-gated-portal` is not a
sentence anybody can consent to.

Two gates now stand between a conversation and a case.

**Gate 1 — an offer can only be built from a reviewed catalogue entry.** It
needs almost no code, because P20's loader already refuses to start a process on
an entry no approval covers. `GET /v1/application-targets` is a read-only view
over artefacts an approval registry vouched for; listing one neither creates nor
implies approval.

**Gate 2 — a case opens only when the authenticated student names the hash of an
offer this server made to them, in this conversation.** Two independent
conditions, and neither is sufficient:

- the hash is in **this conversation's log** as a `target_offered` event, and
- some reviewed target, **rebuilt from the catalogue as it is now** for this
  student and this conversation, hashes to it.

The log alone would honour an offer whose target was retired or re-reviewed.
Re-derivation alone would honour a hash a client computed for itself. The first
draft of ADR-0058 had only the second; writing the refusal tests made the gap
visible, and the ADR was corrected rather than left to disagree with the code.

No clock is involved anywhere, and that is the point: an offer stays valid
exactly as long as the thing it describes is unchanged. A timeout would refuse
unchanged offers and accept changed ones inside the window.

### Added

- `packages/catalogue/src/target.ts` — `ReviewedTarget`, `offerCanonical`,
  `offerFor`, `renderOffer`, `ambiguousGroups`, `isAmbiguous`. Pure; no
  knowledge of runs, cases or HTTP.
- `ReviewedCatalogue.targets()` and `.hashOf()`.
- `apps/conversation-service/src/target-offers.ts` — `makeOffer` and
  `verifyRequest`, the two gates as decisions with refusals as outcomes.
- `GET /v1/application-targets` — authenticated; carries neither `contentHash`
  nor `blueprintVersion`.
- `POST /v1/conversations/{id}/target-offers` — resolves a chosen target and
  puts it to the student. Opens nothing: no case, no run.
- Migration `0012_target_offers` — the `target_offered` / `target_requested`
  events, two CHECK constraints, and `conversation_target_exchange`, the view
  the run route reads Gate 2's first condition from.
- `scripts/p21-target-selection.test.ts` — 23 tests against a real PostgreSQL
  and a catalogue loaded from **files** through P20's registry.

### Changed

- **`POST /v1/conversations/{id}/runs` takes an `offerHash` and no longer reads
  `blueprintId` at all.** A breaking change to an endpoint with no production
  caller and no deployment — verified by search. The old contract cannot survive
  as a second path around Gate 2, because a body carrying only a `blueprintId`
  is answered as one that named no offer.
- `requestEvidence.channel` said `askimate_chat` unconditionally. Since ADR-0051
  this system's own conversation is the student surface, so **every case ever
  opened asserted in an audit field that the request arrived through a product
  that did not receive it.** `REQUEST_CHANNELS` is now a closed set and the
  driver writes `aas_conversation`.
- `target_requested` is written **once per offer**, not once per call: a log
  that grew one on every retry would say the student asked to apply five times
  when they asked once.

### Removed

- `REQUIREMENTS_RESOLUTION`, `ELIGIBILITY_REVIEW` and `BLUEPRINT_REQUIRED`
  (Stage A, `f89cbf2`). `caseStateFor` was total over `WorkflowPhase` and mapped
  **no phase** to the first two; they were entered only because the spine walk
  steps through one element at a time. They described the walk, not the case.
  The third was never entered at all.

### Proved

Eighteen deliberate regressions on Stage B, sixteen caught on the first pass.
Two survived, both shadowed controls, both now caught:

- the **student** binding in the offer hash was shadowed by the **conversation**
  binding, because a conversation belongs to exactly one student. It is now
  asserted at the function, holding the conversation fixed.
- reading `blueprintId` from the request body survived because no test sent both
  a valid offer *and* a competing id. One now does, and asserts which blueprint
  the `cases` row was bound to.

A third case is recorded because it is new: moving the log read to the
`conversation_target_exchange` view — a better design — orphaned the only thing
exercising the column in `SELECT_EVENT`, turning a hard failure into an
invisible one. `event-store.test.ts` now round-trips the exchange directly.

---

## [0.38.0] — 2026-09-03

**P20 — the catalogue loads a reviewed artefact, and can prove that is what it
loaded. ADR-0057.**

`docs/deployables.md` recorded the blocker as *"there is no blueprint parser"*.
That was true and it was not the danger. Measured before a line of P20 was
written, with a blueprint and a mapping set invented from JSON — no discovery
run, no reviewer, a portal that does not exist:

```
checkExecutable  -> EXECUTABLE
checkUsable      -> USABLE
authoredAt is a  -> [object String]
```

Both review gates passed. They check a document's internal consistency, which
they do correctly — but `status`, `reviewedBy` and `reviewedAt` are fields
**inside the artefact**, and an artefact is not evidence about itself. A parser
is therefore what *creates* the hole, not what closes it, and the integrity
model had to be designed with it.

### The decision

Production decides an artefact is reviewed by one question: does an independent
registry hold an approval for the hash of this exact content? Nothing the
document says about itself is consulted.

### Added

- `packages/catalogue` — validated parsers that rebuild field by field (with
  real `Date` coercion), a canonical form, a SHA-256 content hash, an
  `ApprovalRegistry` port, and a loader that refuses anything the registry does
  not vouch for. The two-person rule now lives on the **approval**, where it is
  a record of what people did rather than a document's claim about itself.
- `AAS_CATALOGUE=registry` with `AAS_CATALOGUE_DIR`, read by a **shared**
  config reader so the Conversation Service and the Worker cannot hold two
  opinions about which artefacts exist (ADR-0041). `fixtures` remains refused in
  production.
- `AAS_PORTAL_ORIGINS` — which deployment of a portal to run against. Applied
  after hashing and deliberately outside the reviewed artefact, so one approved
  entry runs against a university's UAT environment without a second approval.
- `pnpm run catalogue` — `hash`, `show` and `check`. There is deliberately no
  `approve`: a CLI that writes an approval on request manufactures the evidence
  it is meant to record.
- 28 unit tests and 11 against real files and real processes, including the
  Conversation Service and the Worker each refusing to start on an entry no
  approval covers.

### Notes

`docs/p20-regression-audit.md` — twelve mutations, ten caught on the first pass.
Both survivors are recorded: one was a control shadowed by an identical control,
the sixth consecutive phase in which that shape has appeared.

**This does not enable a production run.** Discovery remains network-blocked and
document retention remains unapproved, so P20 delivers a trustworthy loader for
artefacts that do not exist yet. The gated portal fixture is used as the
controlled test artefact and stays labelled as one.

---

## [0.37.0] — 2026-09-03

**P19 — verification is established at login. ADR-0056.**

ADR-0038 said a secure step required a verified email address. The
`students.email_verified` column said so too, in its own comment. Neither was
true: the column was written `true` only by test fixtures and read by nothing at
all, and the one place in this system where a student types a password had no
verification gate on it. The investigation that opened this phase found it by
looking for readers of a column everybody assumed was load-bearing.

The guard now exists, and the architecture says what the system actually
guarantees rather than what it once intended.

### The decision, and what was deliberately not chosen

Verification is taken from a **signature-verified provider response at
authenticated login**, persisted server-side, and read from that persisted state
at every secure step. It is **not** a live provider lookup on each step, which
would mean holding a provider access token in the conversation plane for no other
purpose. A student who verifies their address after signing in must sign in again
before this system recognises it. ADR-0038 carries an explicit amendment saying
so, and migration `0011` rewrites the column comment that claimed otherwise.

### Four outcomes, and only one of them opens a step

`verified` | `unverified` | `no_email` | `no_verification_claim` — a closed set,
because an optional boolean has a fourth state nobody handles and it is the
dangerous one. Only `verified` opens a secure step; absence is never consent. A
non-boolean `email_verified` (the string `"true"`, say) is `no_verification_claim`
and refuses, because deciding a security question by string coercion is not a
decision.

### Added

- `packages/oidc` — Authorization Code + PKCE (S256) behind a port that returns
  identity **facts** and never a token. Every endpoint comes from the provider's
  discovery document; no Cognito URL template is written down anywhere.
- `apps/conversation-service` — `GET /auth/login` and `GET /auth/callback`, a
  `StudentIdentityStore` that upserts on the provider's `sub`, and the
  `email_not_verified` refusal on `#openSecureStep`. All four outcomes still sign
  the student **in**; the secure step is what refuses.
- `scripts/p19-identity.test.ts` — 20 tests against a real certified OpenID
  Provider on loopback, in **both** standard claim shapes.

### Fixed

- The adapter read `email` and `email_verified` from the ID token alone. OIDC
  Core §5.4 returns a scope's claims from the **UserInfo endpoint** when an
  access token was issued, so against a conforming provider this reported
  `no_email` for every student — verified ones included. Cognito puts them in the
  ID token, so the defect would have been invisible in production and total
  against anything else. The ID token is now authoritative and UserInfo fills
  only what it did not carry; the two are proved against separate providers, and
  against one case where they disagree.

### Notes

`docs/p19-regression-audit.md` — eleven mutations, ten caught. The eleventh is
not reachable against any conforming provider and the test written to reach it
was deleted rather than kept passing for the wrong reason.

---

## [0.36.0] — 2026-09-03

**P18 — a process refuses to start when it is not safe. ADR-0055.**

Five deployables existed and not one had an entry point: `createConversationApp`,
`createSecureApp`, `createFillAgentApp`, `startWorker`, `startSecureBackground`
and `startRunnerSupervisor` had zero production call sites between them. There
was also no configuration layer at all — outside the runner's Chromium path and
test helpers this repository read no environment variables — no non-test caller
for `migrate()`, and no `EnvelopeCache` that two processes could share.

### Added

- `@askimate/aas-config` — dependency-free, like `@askimate/aas-contracts` and
  for a related reason: all five deployables import it, including the one that
  receives a password. It reports **every** configuration problem at once, and
  **never echoes a value** — these variables carry a session secret and two
  database URLs with credentials in them.
- Entry points for all five deployables, plus `installShutdown` (one clean stop,
  a bounded grace period, and a second signal ignored rather than escalated —
  what it would interrupt is a browser mid-portal-action or an outbox flush).
- `@askimate/aas-envelope-cache-redis` — the shared ciphertext cache ADR-0042
  requires. Its own package, because `packages/secrets` holds the only plaintext
  in the system and a client in its dependency tree would be a supply-chain path
  into it. `take` is `GETDEL`, one command; `verify()` refuses a server that
  would evict under memory pressure or write ciphertext to disk, and refuses one
  that will not answer `CONFIG GET` at all.
- `migrateExclusive` and `pendingMigrations`. Migrating is a **command mode** of
  the two services that own the two databases — a separate migrator would need
  both planes' credentials — and every ordinary start refuses a pending
  migration rather than serving a schema it was not built for.
- `keyProviderFor`, which makes choosing the data key provider and asserting it
  one function. See "Fixed" below.
- `scripts/p18-startup.test.ts` — every entry point spawned as a **real child
  process**, including the Secure Service and the Fill Agent sharing one real
  Redis in two operating-system processes.
- `docs/deployables.md` — the five processes, their configuration, startup
  checks and shutdown behaviour, and why two of them deliberately have no health
  endpoint (ADR-0045 and ADR-0052 give them no inbound surface).
- `docs/p18-regression-audit.md` — ten mutations, eight caught, two survivors.

### Changed

- CI runs a Redis, started with `--save "" --appendonly no --maxmemory-policy
  noeviction`. A stock image has RDB save points on and would, correctly, be
  refused; `ci-guard.test.ts` now asserts the flags and `AAS_REQUIRE_REDIS`.
- `/dev/session` and `AAS_CATALOGUE=fixtures` are refused by configuration under
  `NODE_ENV=production`, not by a comment.

### Fixed

- **`assertVaultIsProductionGrade` was not actually a control.** Called from the
  Secure Service's entry point, deleting the call changed nothing — the
  service's configuration already refused a production start without
  `AAS_SECURE_KMS_KEY_ID`. Two checks, one reachable, and the one being relied
  on was not the one the requirement named. The control now lives inside the
  choice it guards.
- **A "clean" shutdown that closed nothing passed every assertion.** Exit code
  zero and the right log lines describe what a process said, not what it did.
  The worker's shutdown releases its `worker_leases`, which is observable after
  the process exits, and that is now the assertion.

### Known limitation — a production start is currently impossible, on purpose

With `NODE_ENV=production` the Conversation Service refuses: ADR-0038's OIDC
provider is not built, so there is no way to sign a student in, and there is no
production catalogue adapter. Both are deferred to their own phases by decision.
A service that started in production and quietly served nobody would be worse.

---

## [0.35.0] — 2026-09-02

**P17 — the intent is durable before the action. ADR-0054.**

The safety follow-up to P16. `RunDriver.reportWork` wrote the
`workflow_action_intents` row when the REPORT arrived, so a runner killed
mid-action — SIGKILL, OOM, a rolling deploy — left no record that anything had
been attempted: the lease lapsed, the run returned to the pool, and the next
runner was handed it as new work. On `create_account` that is a second account,
on a real university portal, in a student's name.

ADR-0045 §4 already claimed this case was detectable; it was detectable only
when the runner survived to report `uncertain`. `completeIntent` has always
refused a completion with no intent, calling it *"the ordering the whole
mechanism depends on"* — and `performOnce`, which implements that ordering
correctly, still has no production caller. Vahid took option A on 2026-09-02.

### Changed

- `RunDriver.claimWork` opens the ledger row **after taking the lease and
  before returning the work**, so no consequential action can begin without a
  durable record that it was about to. It refuses the claim and releases the
  lease if the ledger will not open, rather than handing out work whose attempt
  could not be recorded.
- `RunDriver.reportWork` no longer records; it only completes.
- The claim and the report now derive the ledger target through one function,
  so the row a report completes cannot drift from the row the claim opened.
- A lapsing lease no longer means "retry" for consequential work. It means a
  runner is gone, and `#unfinishedAction` — the guard that already existed —
  stops the run and raises an intervention. **No new guard was added.**

### Added

- `WorkflowRunStore.reopenIntent`, on both implementations and in the shared
  contract suite. One row per `(run, action, target)` is unchanged — it is the
  ledger's primary key and what `interventions.idempotency_key` pairs with — so
  a retry re-opens the row instead of adding one. **Guarded in SQL to
  `outcome = 'failed_cleanly'`**: a `succeeded` action can never be handed out
  again, and an unfinished one is never taken from the specialist it belongs to.
- Crash proof against a real Conversation Service and a real PostgreSQL: the
  attempt is durable while the browser is still inside it; the lease lapses and
  a second runner is offered nothing; the run stops and a person is asked to
  look; the corpse's later report is refused; and a cleanly failed attempt is
  tried again by a different runner.
- `docs/p17-regression-audit.md` — ten mutations, nine caught, one survivor now
  tested, and the finding that `#unfinishedAction` and `reopenIntent`'s SQL
  guard are layered rather than redundant: only the first raises the
  intervention, and only it makes a stopped run visible.

### Fixed

- A run that failed cleanly and then succeeded **threw** inside `reportWork`:
  it skipped recording because a row existed, then asked `completeIntent` to
  turn a `failed_cleanly` into a `succeeded`, which is refused. The account
  existed on the portal and the ledger said `failed_cleanly` for ever. No test
  had ever driven a full second attempt; one does now.
- `scripts/runner-supervisor.test.ts` (P16) bound port 4907, which is
  `run-driver.test.ts`'s `PORT + 4`. Running the two together made a bootstrap
  test reach the wrong service and fail with 401 instead of 404, depending on
  file scheduling. The suite now binds 4980.
- A long-standing intermittent failure in
  `apps/chat-integration/src/two-origin.test.ts` — three composer tests, roughly
  one run in four of that directory, on the committed tree since well before
  this phase. Not a React re-render race, which is what it looks like and what
  a ten-second poll failed to fix: under parallel browser load the page is
  starved for longer than that. The draft assertions now poll at thirty
  seconds, matching the waits the file already uses. Measurements in
  `docs/p17-regression-audit.md` §5.

---

## [0.34.0] — 2026-09-02

**P16 — the Automation Runner's supervisor.**

`runOneTurn` had been complete since P5 and nothing had ever looped it. It was
the last of the six pieces of machinery ADR-0052 listed as having no production
caller, and the only one P14 deliberately left alone — looping it from the
worker would have put conversation-plane credentials in the process that drives
a browser, the exact widening ADR-0042 exists to prevent. **No new ADR:**
ADR-0052 §12 settles where the loop goes and ADR-0045 settles how it works.

### Added

- `apps/browser-runner/src/supervisor.ts` — `startRunnerSupervisor`, a serial
  loop around `runOneTurn`. One turn at a time; prompt (`DEFAULT_BUSY_MS`,
  250ms) after work and patient (`DEFAULT_IDLE_MS`, 5s) after nothing; a `stop`
  that **awaits** the turn in flight, because abandoning a browser mid-portal-
  action is the situation `assessIntent` refuses to retry. It holds no opinion
  about what may be worked on — every stop condition is enforced on the other
  side of the intake and inherited by performing only what it is handed.
- `apps/browser-runner/src/supervisor.test.ts` — 14 tests, against a controlled
  intake. Two of them exist because a deliberate regression survived: a refused
  report must not send the runner back at the busy interval, and a supervisor
  stopped *while busy* must schedule nothing when its turn finishes.
- `scripts/runner-supervisor.test.ts` — the integration proof, against a real
  Conversation Service and a real PostgreSQL over real HTTP: a run advances with
  no client connected; two competing runners polling every 15ms yield one 200,
  many 204s and exactly one browser; a dead runner's lease lapses, an heir
  recovers the run, and the corpse's later report is refused while the heir
  still holds the lease; and a cancelled case reaches no browser at all.
- `docs/p16-regression-audit.md` — twelve mutations, nine caught first time,
  three survivors each written up and now tested.

### Known limitation — open, and named

`RunDriver.reportWork` writes the `workflow_action_intents` row **on report**,
so a runner killed mid-`create_account` leaves no record that anything was
attempted: the lease lapses, the run returns to the pool, and the next runner
may create a second account in the student's name. ADR-0045 §4 claims this is
detectable; `performOnce` in `packages/orchestrator/src/consequential.ts`
implements the safe ordering (*"the intent is durable BEFORE the action"*) and
has no production caller. P16 makes the window live by making the runner a
long-lived process. Nothing is deployed, so nothing is at risk today — and this
must not be deployed while it is open. Options and a recommendation are in
`docs/p16-regression-audit.md` §4; the decision is Vahid's.

---

## [0.33.0] — 2026-09-02

**P15 — a student can stop. ADR-0053.**

A student could start an application and could not stop one. `CaseCancelled`
had no producer; `CANCELLED` was unreachable because it is not on `CASE_SPINE`;
`student_revoked` was a declared void reason nothing had ever issued; and there
was no stop among the six student-facing routes. Meanwhile ADR-0032 had given
them a way to cancel one *password prompt*, fully implemented. **They could
cancel the password prompt and not the application it was for.**

P14 is what made this urgent. Until then the client was the scheduler, so
closing the tab *was* a stop — undesigned and unrecorded, but real. P14 removed
it deliberately and nothing replaced it.

### Added

- **`WINDING_DOWN`**, a new non-terminal case state: *no further consequential
  work will be started; what is already owed is still being met.* Its own state
  rather than a reuse of `AWAITING_HANDOFF`, which would have made "a healthy
  case awaiting handover" and "the student stopped" indistinguishable.
- **`cancel_case`**, which emits `CaseCancelled`, the move to `WINDING_DOWN`,
  and — where one exists — `AuthorisationVoided` with **`student_revoked`**,
  giving that reason its first writer.
- **`cancel`** on the closed `StudentDecision` set, through the existing
  decision route. No second surface.
- **A guard on `WINDING_DOWN → CANCELLED`**, refusing to conclude while
  anything is outstanding, with `GuardContext.outstandingObligations` supplied
  by the driver from `mayConcludeCase`.
- **`HandoverEvidence.runStopped`.** A stopped run's account is due back
  immediately: the branch above it uses "the application is filled" because
  handing an account back early would mean changing a password we are about to
  sign in with, and that reasoning inverts when there will be no next sign-in.

### Changed

- **Every non-terminal state now reaches `WINDING_DOWN` rather than `CANCELLED`
  directly.** That substitution is the decision: `decide` refuses every intent
  on a terminal case except `instruct_reapplication`, so a direct jump would
  have made `complete_handoff` permanently refusable and stranded an account
  created in the student's name on a real portal — defeating ADR-0050 while
  reporting success.
- **`StudentDecision` is a discriminated union.** Three members carry the hash
  of what the student was shown; `cancel` carries none, because a stop is a
  refusal of all of it rather than agreement to any of it. An optional field
  would have made a hashless confirmation and a hash-carrying cancellation both
  representable.
- **`A_DECISION_CARRIES_A_HASH_NOT_THE_CONTENT` is distributive.** `keyof` on a
  union yields only the common keys, so the constraint had quietly become a
  check on `kind` alone; it is now verified to fail on each member.
- **`claimWork` offers nothing for a stopped case**, read from the case rather
  than the run's status — the run stays `running` while winding down, because
  the handover it still owes is real work.
- **`CANCELLED` is the first terminal state this system can reach.** ADR-0050 §7
  declined to make one reachable because `CONFIRMED` means a portal confirmed a
  submission; that reasoning does not apply to "the student stopped", which is a
  fact this system holds entirely.

### Not built, deliberately

- **No erasure.** A different request with a different lawful basis, bound up
  with a retention schedule that is not approved. The student-facing message
  names it as separate rather than letting "stopped" be heard as "deleted".
- **No specialist cancellation.** ADR-0048 §3 already decides it:
  `specialistId` is asserted, not authenticated, and a consent act must not be
  recorded against an identity nobody verified.
- **No un-fill.** Nothing reaches back into a portal to clear a page.

---

## [0.32.0] — 2026-09-02

**P14 — the system acts when nobody is watching. ADR-0052.**

Nothing in this repository ran without a request. Six pieces of complete,
tested machinery had no production caller: `LifecycleOutbox.publish`,
`RunDriver.advance`, `runOneTurn`, `settle(…, "secret_expired")`,
`interventions.announced_at`'s "next pass", and a partial index commented
"expiry sweeps". The student's browser was the scheduler.

### Added

- **A fifth deployable, `apps/worker`** — the Background Worker (ADR-0052 §1).
  No inbound listener at all. It advances every eligible run on its own clock
  and tells students about interventions raised but never announced.
- **`worker_leases`** (migration `0010`), keyed by **job kind** rather than by
  run. `work_leases` stays for run execution work: its primary key is `run_id`
  and that key is the property it exists for.
- **Two in-process loops in the Secure Service** (`background.ts`) — the outbox
  drain and the expiry sweep.
- **`sweepExpiredRequests`**, which finally makes ADR-0034's sentence true:
  *"the request moves to `secret_expired`, the student is told in the
  conversation, and the model asks again."* The settle and the enqueue share one
  transaction.
- **`RunDriver.dueRuns` and `RunDriver.announcePending`**, so the worker holds
  no SQL and composes no message of its own.
- **`WorkLeaseStore.dueForWorker`**, beside `candidates` and deliberately: both
  answer "which runs are live and unheld", and two implementations in different
  files would be free to drift.

### Changed

- **The client is no longer required to advance a case.** `POST /runs` still
  advances — as a latency optimisation, so a present student does not wait for
  the next tick — but the worker is the only thing that *must* run. The journey
  now proves the worker moves a run with **no HTTP request** made on the
  student's behalf.
- **Database and credential separation preserved** (ADR-0052 §13.0, Vahid's
  option C). The worker holds conversation-plane credentials only; the Secure
  Service drains its own outbox. **No process requires credentials for both
  planes**, so ADR-0037's compromise analysis stands unchanged.
- **`pnpm run boundaries` enforces both directions of that rule** — the worker
  may not name a vault, a store or a resolver, and the Secure Service may not
  depend on a conversation-plane store in production.
- **ADR-0037 amended**: four deployables becomes five, in the decision line, the
  table and a note. Nothing else in it changes.

### Not built, deliberately

- **No external notification transport.** ADR-0008 stays half-honoured: the
  queue becomes reliable and current, nothing pushes. Email, SMS and webhooks
  are later consumers of the same substrate.
- **No runner supervisor.** `runOneTurn` still has no loop. Looping it from this
  worker would put conversation-plane credentials in the process that drives a
  browser, which ADR-0042 exists to prevent.
- **No `LISTEN`/`NOTIFY`.** A missed notification is invisible; a poll that
  finds nothing is cheap.

---

## [0.31.0] — 2026-09-02

**P13 — the student supplies through the conversation. ADR-0051.**

The loop that was never closed. `applyConfirmation` and
`ConfirmedProfileStore.save` had no production caller: the orchestrator composed
interview questions and the run driver threw them away, rebuilding
`newInterview(…)` on every request so that `pending` and `attempts` were always
empty. Every green test seeded the profile from the test process. No real
student could put one field into this system.

### Added

- **The interview runs through the existing message path.** `RunDriver.answerStudent`
  fills the `answer` hook on `POST /v1/conversations/{id}/messages`. There is no
  second student-facing surface, and ADR-0051 §1 forbids one.
- **Three conversation-log event kinds** — `value_proposed`, `value_confirmed`,
  `value_rejected` — so a pending reading survives the request that created it,
  and a restart. `value_proposed` is the one non-message event that may carry a
  structured value, and the migration says why in full.
- **`open_value_proposals`**, a view beside `open_secret_requests`: "which
  proposal is open" is a rule about the log, and a rule written in the
  application is a rule each caller can get subtly wrong.
- **`confirm_value`** joins the closed `StudentDecision` set. A confirmation is
  a decision carrying the hash of the playback the student read — never a parsed
  "yes".
- **`work_leases.page_version`**, so a lease names the page *version* it holds.

### Changed

- **`void_authorisation` is now the mirror of `capture_authorisation`.** It emits
  `AuthorisationVoided` **and** the move back to `AWAITING_STUDENT_AUTHORISATION`,
  **through `checkTransition`** — so the mandatory-review guard re-fires and a
  correction that introduces financial evidence, or reveals a minor, is reviewed
  again before the student is asked. `#withAuthorisationIfCaptured` had consumed
  `AuthorisationVoided` since the domain was written and nothing produced one:
  the same reader-with-no-writer shape `HandoffRequired` had before P12.
  The forward-only spine (ADR-0049 §1) is **not** relaxed.
- **`advance_portal_page` intents are content-aware.** A target is
  `page-ref@sha256:…`, so the ledger answers "was the *corrected* value
  written?" — which ADR-0047 §1 named and could not answer. `pageOf()` strips
  the version for anything a person reads.
- **`SECURE_EVENT_KINDS` is an explicit list**, not `EVENT_KINDS.filter(k => k !== "message")`.
  The complement stopped being true the moment a third family of kinds existed;
  `isSecureEventKind()` is now the one predicate.

### Not built, deliberately

- **Document intake and any upload surface.** Blocked on the retention schedule,
  not deferred by preference: `pnpm run retention-status` reports 0 policies and
  12 unresolved questions under an **UNAPPROVED** governing version, and
  `requirePolicy` throws. Inventing a period to unblock it is the worst
  available outcome. ADR-0051 §8.
- **Tasks.** The model, intents and guards stay defined and uncalled. Nothing
  was removed.

---

## [0.30.0] — 2026-09-01

**P12 — the account lifecycle completes through the student's own decision, and
a case can finally conclude. ADR-0050.**

**Version bump: MINOR.** No migration, no new store, no new route. One member on
a closed set, two intents on the case machine, and a derivation.

### The change that matters

Three things had been unreachable since the account model was written, and they
were one gap:

- **`AccountStage` never moved.** `handover_due` and `handed_over` were words in
  a union that nothing wrote.
- **`HandoffRequired` / `HandoffCompleted` were folded and never produced.**
- **`mayConcludeCase` had no caller**, and could not have had one: it refuses
  any account that is not `handed_over`, and none could be.

An account that cannot change stage cannot be handed back, and a case that
cannot hand an account back cannot finish — the rule that makes handover
non-optional, enforcing itself into a deadlock.

**`ready_to_submit` now follows the handover rather than preceding it.** A run
that reported itself ready while still holding the student's credentials had
skipped part of the work.

### Added

- `require_handoff` and `complete_handoff` on the case machine, idempotent by a
  token derived from the case and the kind. A second, different handoff while
  one is open is refused rather than silently replacing it.
- `confirm_handoff` on `STUDENT_DECISIONS` — one member, not three. What was
  confirmed comes from the case's open handoff, never from the client.
- `email_verification`, `password_reset` and `account_handover` on
  `HANDOFF_KINDS`; `raisedHandoffs` and `completedHandoffs` on the folded case.
- `RunDriver.mayConclude`, the first caller `mayConcludeCase` has ever had. The
  P7 journey ends by asserting it answers `true`.
- `studentHandoverItems` — what the student is shown, as distinct from the gate.

### Changed

- `applicableItems` takes the portal observation as well as the approach: where
  discovery observed that a portal does not verify email addresses,
  `emailVerifiedByPortal` is **replaced** by `passwordResetCompleted` rather
  than dropped. The portal's own email still provides exactly one proof of
  receipt. Decided by Vahid, 2026-09-01 (ADR-0050 §4).
- `checkHandoverComplete` takes the whole `AuthenticationPlan` rather than an
  approach — the same reason `mintCredentialUnder` does.
- The P7 journey now walks the handover and ends with a concludable case.

### Known limitations

- `generated_ephemeral` accounts cannot yet reach `handed_over`: nothing in this
  service holds that credential, so nothing here can say it is destroyed.
- A handoff does not expire; `expiresAt` is required by the event and unread.
- `AWAITING_HANDOFF` stays unreached, deliberately (ADR-0050 §7).
- No terminal case state is reachable, deliberately. A finished case rests at
  `AUTHORISED` with its account handed back.

---

## [0.29.0] — 2026-09-01

**P11 — the run driver drives the case machine, and a student's authorisation is
captured through it. ADR-0049.**

**Version bump: MINOR.** No migration, no new store, no new plane. One decision
route on the student's own session, one review route on the internal plane, and
a spine walk in the coordinator that already existed.

### The change that matters

The case state machine has been in the domain since the beginning, guards and
all, and **nothing drove it**. A run advanced; its case sat in `INTAKE`. The
most consequential of those guards — that a case carrying financial evidence or
involving a minor cannot reach `AWAITING_STUDENT_AUTHORISATION` without a
recorded, approving human review — had therefore never run in the assembled
system.

It runs now, and it holds a real run back.

### Added

- `CASE_SPINE`, `caseStateFor`, `caseStateForStep` and `nextCaseHop` in the
  orchestrator: an explicit ordered spine, walked **one hop at a time, forward
  only**, never a shortest-path search over the transition table.
- `RunDriver.recordDecision` and `POST /v1/conversations/{id}/runs/{runId}/decision`
  — the one decision that is the student's alone, on the student's own
  authenticated session rather than the internal service plane. It carries a
  content hash and never the content: the service compares it against the
  preview it would render now and refuses on a mismatch.
- `RunDriver.completeReview` and `POST /internal/v1/cases/{caseId}/review` — a
  specialist clears a mandatory review through the same plane and the same
  asserted identity as an intervention (ADR-0048 §3).
- `suggestsMinority` in the domain, and `REVIEW_TRIGGERS`. Triggers are raised
  from the student's own confirmed profile or not at all.
- `packages/contracts/src/decisions.ts`, with the compile-time constraint
  `A_DECISION_CARRIES_A_HASH_NOT_THE_CONTENT`.
- `packages/orchestrator/src/case-spine.test.ts` — the spine as a pure function,
  including that every spine edge is one the case machine allows.

### Changed

- `scripts/journey.test.ts` authorises through the real decision route instead
  of appending `AuthorisationCaptured` itself.
- Three tests that were passing for the wrong reason were rewritten, and one
  renamed to what it proves. See `docs/p11-regression-audit.md`.

### Known limitations

- Clearing a mandatory review has an HTTP route but no CLI verb.
- `SUBMITTING` and `handover_due` remain unreachable — deliberately (ADR-0014,
  ADR-0020). The spine stops at `AUTHORISED`.

---

## [0.28.0] — 2026-09-01

**P10 — a run that stops says so, and can be picked up. ADR-0048: a specialist
resolution completes an intent; the operator CLI is only its first interface.**

**Version bump: MINOR.** One ADR, one migration, one new store port with two
adapters, two internal routes, one operator command — and no new service, no new
plane, no second workflow engine.

### Added

- **Durable `uncertain` and `escalated` run states.** Both words were already in
  `RUN_STATUSES` and in the transition table, and nothing wrote either. A run
  that met an unfinished consequential action simply fell out of the work pool
  with its status still `running` — safe, and indistinguishable from a run with
  nothing to do. It now takes a durable status, and the transition back is one
  the store already enforces.
- **`interventions`** — a third store port beside the case log and the workflow
  runs, holding who adjudicated a stopped run and what they found. It never
  says whether the action happened; completing the intent says that, and the
  split is what keeps the two from being able to disagree.
- **Honest student-facing messages** on pause and on resume. They name no portal
  field and no specialist — a student can act on neither — and they do not
  pretend a paused application is still progressing.
- **`GET /internal/v1/interventions`** and
  **`POST /internal/v1/interventions/:id/resolution`**, behind the same service
  credential as the runner's routes.
- **`pnpm run interventions`** — list and resolve. It calls the service; it does
  not open the database, and `pnpm run boundaries` fails if it ever does.
- **`unverified_consequential_action`**, a recovery reason for the one thing the
  existing nine could not say: an intent exists, no completion does, and nobody
  knows which side of the action the process died on.

### Changed

- **`RecoveryResolution` no longer carries `resumeFrom`.** A draft proposed
  storing it unread; Vahid rejected that — *"I do not approve storing an
  executable field that the system deliberately ignores."* Where a run resumes
  is derived from the intent ledger, and `A_RESOLUTION_CARRIES_NO_POSITION`
  makes adding a position back fail to compile.
- **`ExecutionCheckpoint` records a position this system can state truthfully** —
  the action, its target, the phase, the pages done. It asked for a `section`
  and a zero-based `step` that nothing here knows, and filling those with
  placeholders would have been inventing a position.
- `InterventionContext` loses `section` for the same reason.

### Security

- **`specialistId` is asserted, not authenticated**, and the scope of that is
  written at the route, at the CLI and on the stored record: acceptable while
  exactly one operator holds the service credential, and a **release blocker**
  the moment a second specialist exists.
- **`route_fallback` is refused in three places** — the wire's closed set, the
  store, and a database CHECK — and implemented in none.

### Fixed

- Two documents describing a world P1–P10 replaced. `docs/where-we-are.md` and
  `docs/roadmap-and-priorities.md` are marked historical and carry the current
  state; the latter still asserted that a run *"is never written anywhere"*.

---

## [0.27.0] — 2026-08-31

**P9 — durable multi-page execution. ADR-0047: page progress lives in the intent
ledger, and a lease names the page it holds.**

**Version bump: MINOR.** One ADR, one migration adding one nullable column, a
second page on the fixture portal and its blueprint, and the page-selection
logic. No new table, no cursor, no second workflow engine.

### The gap P8 left, closed

`formPageFor` handed out the first fillable page and nothing recorded that it
was done — so a two-page application got its first page filled and then had
nothing more offered, while the run reported itself `filling` forever.

`advance_portal_page` now gets **one intent per page**. Nothing new is stored:
`idempotencyKeyFor` already takes a `target`, documented as *"a host, a field
ref, a document id"*, and a page ref is exactly that. It was being built with
the run id in that slot because there had only ever been one page.

### What each verdict means, per page

`assessIntent` already distinguishes the three states this needs, and its
deliberate absence of a "retry it" branch is what makes uncertainty safe:
`succeeded` skips the page, `failed_cleanly` offers it again, and an unfinished
intent **stops the whole run** — not just that page, because pages are ordered
and a later one is often unreachable until an earlier one is saved.

A run stopped that way is visibly stopped: its position is unchanged and no work
is offered, which is what "a specialist looks at the portal" means while nothing
here can verify.

### A lease names the page it holds

`work_leases.page_ref`, nullable, with a CHECK that only a fill may carry one.
The lease says *this runner is doing page P*; the ledger says *page P was done*.
They answer different questions, and the lease exists because a report arrives
with a lease id and nothing else — re-deriving the page at report time would
complete an intent for a page the runner never touched if the plan had changed.

### `markFilled` means a page was saved

Not "no page remains", which is vacuously true of a run with nothing to fill.
A blueprint whose only mapped fields are on the registration page would
otherwise report `ready_to_submit` having typed nothing into the application.

### Proved on a genuinely paginated portal

The fixture portal now has two application pages, and page one being saved is
what makes page two reachable — so a run that lost track would stall or re-save.
The journey fills page one, **restarts everything** (a new pool, a new driver, a
new server, a new browser context signed in again), and resumes on page two;
page one is saved exactly once, and the portal's own request log is what says so.

### Where submission still is

Nowhere near this. Advancing a page is `advance_portal_page` — consequential,
because it may create a draft visible to admissions — and the runner's click
guard admits exactly the one locator the plane sends. The review page has no
fields and no advance control, so it is never a candidate.

Nine deliberate regressions in
[`docs/p9-regression-audit.md`](./docs/p9-regression-audit.md), including two
that were not detected first time: a CHECK constraint nobody tested, and a test
that stopped at `authorise` long before the property it was about.

---

## [0.26.0] — 2026-08-31

**P8 — the runner fills the application form. ADR-0046: a fill plan crosses as
value and provenance, reassembled through the one mint.**

**Version bump: MINOR.** A new ADR, a new package, a migration, the plan
transport, the fill performer, and four latent defects fixed. The runner's
forbidden-dependency list is narrowed by decision and widened by another name.

### The gap ADR-0045 left, decided

`FillInstruction.value` carries a `ConfirmedValue<string>`, mintable only inside
`packages/profile`, and the runner may not depend on that package — so `execute`
was not claimable work and the journey stopped at the account.

A plan now crosses as its two halves: each value's text and **the provenance the
student's confirmation produced**. It is reassembled through `rehydrateConfirmed`
— the same cast `rehydrateProfile` already made, extracted so a second caller
can use it. Nothing outside `packages/profile` casts.

The provenance is **carried, never rebuilt**. A provenance nobody produced is a
lie about a student: `student_stated` means they said it, the agent played it
back, and they confirmed it. A compile-time assertion fails the build if it
becomes optional, and the parser refuses a confirmed value without one.

### `executePlan` moves to `@askimate/aas-execution`

Which is what makes the above possible. The runner must run the executor and
cannot take `@askimate/aas-orchestrator`: that package carries
`@askimate/aas-case-store` (and `pg`) and `@askimate/aas-secrets`, and browser
automation must have neither anywhere in its tree.

The move is right on its own terms too. `executePlan` is a pure function over a
session and a plan — it reads no run state, writes no checkpoint, decides
nothing. Its four real dependencies are blueprint, disclosure, domain and
mapping. The orchestrator re-exports it, so no caller changes.

### A unit of fill work is one page, and it is saved

A portal keeps nothing until the page is saved, so a runner that stopped at the
last field would report success over an application the university has no record
of. The work item carries the page's **advance control**, and the runner's click
guard admits exactly that locator — so it cannot become a submit however the
blueprint changes (ADR-0014).

A save that never lands is `uncertain`, never `failed`: the click may have
reached the portal.

### Four defects found by running it

- **A credential field read as a missing required field.** ADR-0043 routed
  password fields to `plan.credentials`; `validatePlan` looked only at
  `instructions` and `uploads`. Every gated run answered `fix_content` and asked
  the student to fix something they could not fix, forever.
- **A stored provenance came back with a string in its `Date`.** The value half
  of a profile entry is date-tagged; the provenance half was not, and it holds
  `confirmedAt`. Nothing at compile time; a `TypeError` at runtime.
- **The work item's email was a placeholder for `execute`**, so the wire parser
  refused it, the route 500'd, and the client read that as "nothing to do" — an
  idle-looking system with a student waiting.
- **The lease table's `kind` CHECK still had one member.** Migration
  `0006_execute_work` widens it; 0005 is untouched.

Ten deliberate regressions in
[`docs/p8-regression-audit.md`](./docs/p8-regression-audit.md), which also
records the one thing this phase deliberately does not do: page progress beyond
the first application page is not durable, and a two-page portal would stop
after one.

---

## [0.25.0] — 2026-08-31

**P7 — the first real end-to-end execution journey. A student asks, and ends up
with a portal account they own, created by a browser they never see, with a
password nobody in this system has ever read.**

**Version bump: MINOR.** One orchestrator function, one guard in the claim path,
one whole-system journey suite. A latent defect fixed. No trust boundary moved.

### The journey, with nothing simulated

`scripts/journey.test.ts` runs two real PostgreSQL databases (one per plane), the
real Conversation Service, the real Secure Service including the student's own
submit endpoint, the real fill agent over real HTTP, a real Chromium reached over
real CDP, the real gated portal, and the real runner intake loop.

It lives in `scripts/` for a boundary reason rather than a stylistic one: it
needs the Conversation Plane's model client AND the Secure Plane's vault AND the
runner's Playwright, and no app may depend on all three — `apps/secure-service`
is forbidden `@askimate/aas-llm`, `apps/conversation-service` is forbidden
`@askimate/aas-secrets`. Those rules are the architecture; a harness that ships
nothing is the right home for the one thing that has to see across them.

The password crosses exactly one wire — the student's own submission — and
appears in no log line. The portal is asked, at the end, whether anything was
submitted. It was not (ADR-0014).

### The account survives the report

`accountCreated` reconstructs the account from `workflow_action_intents`, the
durable record that the creation happened. Without it a run loops:
`accountStepFor` answers `create_account` whenever `state.account` is absent, and
it is absent on every request because nothing rebuilt it — so a run whose account
was created a second ago would be told to create it again, on a real portal, for
a student who already has one.

Everything on the account is derived. The email is the same `resolveField` call
that chose it; the plan is the same `planFor`. Nothing is stored and re-read, so
nothing can be stored wrongly. The stage is `awaiting_email_verification` where
discovery observed that requirement and `active` where it did not — a reviewed
per-portal fact, not a guess, because this system has no mailbox capability and
never will.

### Fixed — an unfinished creation was being re-offered as work

Found by a deliberate regression, and it was a genuine defect rather than a gap.
`#withAccountIfCreated` ignored every verdict but `already_done`, so a run whose
`create_portal_account` intent had been **started and never completed** fell
through to `create_account` and was handed to a runner again. An account may
already exist on a real portal in that state.

`claimWork` now refuses work for a run with an unfinished consequential action.
`assessIntent` has no "retry it" branch and that absence is the safety property;
the verdict is `verify_first`, nothing here can look yet, so the run stops
visibly for a specialist.

### What an end-to-end journey does not prove

On the first run, **five of six regressions aimed at this phase went
undetected**. They changed behaviour only in states the journey never reaches —
it walks the happy path. The journey was kept as the proof that four planes, two
databases, a real browser and a real portal actually compose; the properties
moved to where they can be varied: `account-created.test.ts` in the orchestrator
and the intent-verdict tests in the run driver.

An end-to-end test proves the pieces fit. It is not where the pieces are checked.
[`docs/p7-regression-audit.md`](./docs/p7-regression-audit.md) records all six,
including the one that is **not** claimed as tested and why.

### Where this stops

At the account. Filling the form is the orchestrator's `execute` step, and
`WORK_KINDS` still does not carry it — a `FillPlan`'s instructions hold
`ConfirmedValue`s, mintable only inside `packages/profile`, which the runner may
not depend on (ADR-0004, ADR-0045). Submission is further still and out of scope
by ADR-0014.

---

## [0.24.0] — 2026-08-31

**P6 — an account is really created on a portal, with a password nobody in this
system has ever seen.**

**Version bump: MINOR.** The fill contract's `locator` becomes `locators`, the
work payload gains the registration targets, and the runner gains the performer
that does the work. No trust boundary moved; the credential still exists only
inside the Secure Plane and only for the length of one callback.

### One handle, both password boxes

`SecretFillRequest.locator` is now `locators`, and the agent types the secret
into every one of them inside a **single** `vault.use`.

Every registration form asks for the password twice, and the alternatives were
both wrong: two requests need two handles, and a handle is single-use — so the
student would be asked for the same password twice and the two would have to be
compared, which cannot be done without holding both. Spending one handle on two
calls would mean it was not single-use.

The whole set is established **before** any plaintext exists: every field must
be present and masked, or the request is refused with the handle untouched. A
confirmation box rendered as plain text is refused too — it would show the
student's password in the clear, in the page and in any capture of the run.

### The runner creates the account

`createPortalAccount` opens a sensitive context (tracing made unavailable, not
merely unused), checks the form is on the host the work was bound to, types the
email itself, asks the Secure Plane's agent to type the password, and only then
submits. Submitting first would create an account with no password; asking for
the password afterwards would be asking for a box that is no longer there.

Whether it worked is asked of the **page** — a portal that refused re-renders
the form, a portal that accepted moves on — never assumed from the click.

### Proved against a real portal

`apps/secure-service/src/account-creation-e2e.test.ts` runs a real PostgreSQL,
the real Secure Service including the student's own submit endpoint, the real
fill agent over real HTTP, a real Chromium reached over real CDP, the real gated
fixture portal with real cookies and `timingSafeEqual` comparison, and the real
runner performer.

The assertion that matters is `credentialsWork(email, password)` — asked of the
**portal**. Nothing in this repository renders a password back, so the only way
to establish that the right characters reached the right box is to ask the site
whether they let you in. Every HTTP body between every pair of processes is
recorded, and the password appears in exactly one: the student's own submission,
travelling towards the endpoint designed to receive it.

### A blueprint can be pointed at a sandbox without being rewritten

`CatalogueEntry.portalOrigin` moves a reviewed blueprint's paths onto another
origin — a university's UAT environment, typically. Rewriting the blueprint
would mean running one nobody reviewed, so the origin is a deployment fact and
the paths stay in the reviewed artefact.

It moves **every** use of the portal's location together. Moving only the form
would bind the handle to the blueprint's host and type into the sandbox, which
the fill agent refuses as `host_mismatch` — correctly, and a long way from the
configuration that caused it.

### `uncertain` is what a click that never lands means

A submit that times out is reported `uncertain`, never `failed`. The click may
have reached the portal and the account may exist; the runner simply stopped
being able to tell, and `failed` would assert that nothing happened on a
university's system.

Ten deliberate regressions in
[`docs/p6-regression-audit.md`](./docs/p6-regression-audit.md). Two were not
detected first time — one property had no test at all, the other was never
exercised — and each forced a new one, including a portal that serves the form
and never answers the POST.

---

## [0.23.0] — 2026-08-31

**P5 — the Automation Runner can be given work. ADR-0045: it pulls, and nothing
calls into it.**

**Version bump: MINOR.** A new ADR, a wire contract, a migration, a lease store,
an orchestrator predicate, two internal endpoints and a runner-side loop. No
trust boundary moved: the runner keeps its single inbound port and gains no
capability it did not have.

### The runner pulls; nothing calls into it

ADR-0037 already gave the runner exactly one inbound port — a CDP endpoint
reachable by the fill agent **alone**. An HTTP control API would be a second
inbound surface on the component that loads pages we do not control, so the
shape was already decided: the runner claims work over the internal API and
reports how it ended.

`POST /internal/v1/work/claims` and `POST /internal/v1/work/{runId}/report`,
both behind the same injected service-certificate predicate every internal route
uses — the one that **denies when absent**, so a deployment that forgot to
configure it refuses every runner rather than accepting every caller. `204` is
the ordinary answer to a claim: a poll that found nothing is a successful poll.

### A lease, not a queue

`work_leases.run_id` is a PRIMARY KEY, so "one run, one runner" is what the
table can hold rather than what a handler remembers to check. Leases **expire**
rather than being released by a heartbeat — a runner that dies mid-task cannot
tell anyone, and a lease that outlived its holder would strand a student's
application behind a process that no longer exists. The lease id is regenerated
on every takeover, so a runner that was slow rather than dead cannot close out
work the new holder is in the middle of.

There is no queue. The run's own durable position says what work exists and
`nextStep` decides it; the lease only says who has it. A queue would be a second
opinion about what a run should do next, and this repository has already had two
models of one thing come apart once (ADR-0041).

### What crosses to the runner

Identifiers, closed-set words, a portal host, the student's own email, and the
**opaque secret handle** — which is safe to hand about precisely because seeing
one confers nothing (ADR-0026). No password, no profile, no fill value, no
document, no database credential. `packages/contracts` has no dependencies, so
the payload *cannot* import a `ConfirmedValue` or a `FillPlan`; a compile-time
assertion covers the rest, and a boundary rule reads the interface's own fields.

### A report is evidence, not permission

`reportWork` records the outcome as a `workflow_action_intent` and gives the
lease back. It does **not** move the run — what happens next is `nextStep`'s
decision on the next advance, and a report handler that set a phase would be
that decision reimplemented by the least trusted process in the system.

An outcome of `uncertain` completes **nothing**, because `IntentOutcome` has two
members and neither means "we do not know": an intent with no completion *is* the
uncertainty window (ADR-0008). A runner that cannot tell whether the portal
accepted must report `uncertain`; `failed` is a claim that nothing happened on
somebody else's system, and only the runner is in a position to make it. A
performer that throws is reported as `uncertain`, never as a clean failure.

### `execute` is deliberately not claimable yet

`WORK_KINDS` has one member. The orchestrator's other browser step, `execute`,
carries a `FillPlan` whose instructions hold `ConfirmedValue<string>` — a branded
type that may only be minted inside `packages/profile` (ADR-0004, enforced
package-scoped), and the runner may not depend on that package. Serialising a
plan and rebuilding it there would mint confirmed values outside the one place
allowed to. That needs a decision, not a field; it is recorded in ADR-0045, in
the contract, in `browserWorkFor`, and in a drift test that a future phase
deletes in the same diff that resolves it.

### Fixed — a guessed enum, caught by the drift test

`WORK_APPROACHES` was first written with three members that do not exist. The
contract-drift test compares it against `AUTHENTICATION_APPROACHES` in both
directions and failed immediately, which is what that test is for. `packages/account`
now exports the set as a named value rather than keeping it private beside the
preference order.

Ten deliberate regressions in
[`docs/p5-regression-audit.md`](./docs/p5-regression-audit.md) — including two
that were **not** detected first time and forced two new tests, because the
existing suite was reaching the right answers through the wrong guards.

---

## [0.22.0] — 2026-08-31

**P4 — the first production caller of the Secure Interaction Service.
`POST /internal/v1/secret-requests` has existed and been tested since the secure
plane was built and had nobody calling it. The Conversation Service now does.**

**Version bump: MINOR.** A new port and its HTTP client, two refusal kinds, one
orchestrator predicate, one concurrency primitive, and a latent race fixed. No
trust boundary moved, no new plaintext path, and nothing that returns a value.

### The Conversation Service opens the secure step

When `nextStep` answers `request_secret`, the Run Driver asks the Secure
Interaction Service to open a request and appends the authoritative
`secret_requested` event to the conversation's own log. That is the whole of the
change from the student's point of view: the first code path by which anybody is
actually asked for a password.

What crosses is metadata — identifiers, a purpose and a target host, both taken
from the case and the blueprint rather than from model output, so a
prompt-injected model can ask for *a* password but not for whose or for which
portal — plus the title and explanation shown inside the frame. What comes back
is an id, an expiry and a one-time frame token; the title and explanation are
**not** returned, so this plane holds no text a model wrote about a password and
its schema needs no exception. A test scans every row of `conversation_events`
for the word rather than checking a type.

`parseOpened` rebuilds the response field by field instead of casting it, so a
service that answered with a value-shaped field has nowhere to put it, and
`check-boundaries` now fails the build if that rebuild is replaced by a cast.

### One port for both halves of the secure step

`createConversationApp` takes a `SecureRequestOpener`, and both the driver's
`open` and the bootstrap endpoint's `mintFrameToken` go through it. Wired
separately they could name different services, and a deployment that opened
against one and minted against the other would answer `not_found` for every
bootstrap — a misconfiguration indistinguishable, from a support ticket, from an
expiry.

### `requiresSecureRequest` — the orchestrator says which steps have effects

The Run Driver may not branch on a step's kind; that rule is what keeps one
implementation of the decision. But it does have to know which steps need
something outside the process. So the orchestrator answers that too, as a type
predicate, and the driver obeys it — a list of step kinds kept in the driver
would go silently out of date the first time another step gained an effect.

### Fixed — two concurrent starts could ask the student twice

Two callers advancing the same conversation can both hold a valid run revision,
because the second loads the record after the first has already checkpointed and
nothing conflicts. Both then read a log with no live request in it and both ask.
The student would watch one secure box be replaced by another, and whichever
they typed into would settle a request the run was no longer watching.

The read → open → append sequence is now serialised per conversation with an
advisory lock. Deliberately advisory: `SELECT … FOR UPDATE` on the conversation
row deadlocks, because appending an event updates `conversations.last_ordinal`
on a different connection, so the transaction holding the row waits for the
append that is waiting for the row.

### Fixed — the loser of a checkpoint race got a 500

Latent since P1 and exposed by the extra log read this phase adds: two racing
starts leave `withBinding` holding a record at the same revision and both write a
checkpoint against it, and the loser's `RunConcurrencyError` reached the student.
It now does what the error's own message says — re-loads and decides again,
bounded at three attempts.

Nine deliberate regressions are recorded in
[`docs/p4-regression-audit.md`](./docs/p4-regression-audit.md), including the one
that was recorded as *not detected* until the racing test was made deterministic.

---

## [0.21.0] — 2026-08-31

**Two blockers resolved, both by decision rather than by working around them:
ADR-0043 (a credential field is mapped to the Secure Plane) and ADR-0044 (the
confirmed profile has its own store).**

**Version bump: MINOR.** A fifth `ValueSource`, a new store and port, two
migrations, and one design weakness corrected. No trust boundary moved and no
plaintext path changed.

### ADR-0043 — a credential field is mapped to the Secure Plane, not to data

Building the first gated blueprint produced two approved rules that could not
both be satisfied: no mapping may target a password field (ADR-0026/0042), and
every required field must have a mapping (`planFill`). The password field
genuinely *is* required, so `nextStep` answered `specialist / no_mapping` and the
run stopped for a specialist who had nothing to decide.

The root cause was an absence: `ValueSource` had no way to say *"the Secure Plane
fills this"*. It now does — a marker with two closed-set words, no `value`, no
`fieldKey`, and a compile-time assertion that fails the build if a field is added
that could hold one.

Credentials route to their own `FillPlan.credentials` list, away from the
`instructions` every existing consumer reads — because a `FillInstruction`
carries a `FillValue` and there is no `FillValue` that could hold a credential.
The preview shows *"filled from the password you typed in the secure box"*, and
hashes the **fact** — field and purpose — so an application that gained a
credential field after the student authorised it is a different application.

Enforced **both ways**, in `checkUsable` and again at the build: a password field
may have only this source, and this source may target only a password field.

### ADR-0044 — the confirmed profile has its own store

`docs/durable-execution-architecture.md` §12 flagged this when durable runs were
designed and explicitly deferred it: *"This needs your decision — it is a change
to what the event log is for."* It was decided, not assumed.

The log keeps recording **that** a confirmation happened, by reference;
`ConfirmationCaptured` is unchanged. The values live in `profile_entries` in the
Conversation Plane's database, behind `ConfirmedProfileStore`.

Rehydration lives in `packages/profile`, beside `applyConfirmation`, because the
boundary check that keeps `as ConfirmedValue` in one package is package-scoped —
putting it anywhere else would have meant widening the rule or casting outside
it. A rehydrated value carries the provenance it was minted with, so it is the
value the student confirmed rather than one nobody did.

**This is what unblocked the run.** The driver previously called `emptyProfile`
on every request, so a run could never leave `interviewing`: each call
re-derived a profile with nothing in it and reported the same blockers as the
one before. A restarted process now resumes an interview where it left off, and
the gated blueprint's run reaches `awaiting_secret`.

### Fixed — a version cannot identify a blueprint

P1's driver resumed by asking the catalogue for the blueprint whose *version*
matched the checkpoint. That worked while one blueprint existed and broke the
moment a second was written: both fixtures are at `1.0.0`, and a version is only
unique within a blueprint.

Migration 0004 records `cases.blueprint_id` — the fourth part of an identity
`CaseOpened.submissionIdentity` already carried three of. The checkpoint's
`blueprintVersion` keeps its own job, which is detecting that the blueprint
*moved*. Identity and revision are two questions and now have two answers;
`ApplicationCatalogue.findByVersion` is gone.

---

## [0.20.0] — 2026-08-31

**P2 — a controlled portal that actually requires an account.** The first
end-to-end product test needs a target, and this is one we own: gated, stateful,
and described by a blueprint proved against the real pages.

**Version bump: MINOR.** New test infrastructure, one new blueprint fixture, one
new `FieldInputType` member and one new build rule. No production behaviour
changed; no security boundary moved.

### Added — `startFixturePortal`

`/register` → `/apply` → `/review`, with real cookies, real refusals and real
state. The gate is the point: **`/apply` redirects to `/register` without a
session.** A fixture that served the form to anyone would let the entire
credential path be skipped while every later test still passed.

It has a login page for a reason. Nothing here ever renders a password back — so
"the right password arrived" cannot be checked by reading a page, which is the
property we want. It is proved by signing in instead: the portal using the
credential the way a real one does, failing on a single truncated character.

`submissions()` exists so that "it did not submit" is an assertion rather than a
hope (ADR-0014).

### Added — `FieldInputType` gains `password`

It was absent, which did not stop password fields existing on real pages — it
only stopped a blueprint saying so, leaving the document quietly wrong about the
field that matters most.

Naming it makes a rule checkable that was previously only a convention:
`check-boundaries` now fails the build if a **mapping set targets a password
field**. A password is not profile data, never becomes a `ConfirmedValue`, and
reaches its field through the Secure Plane's fill agent alone. There must be no
mapping for it to review.

### Found — an ambiguous locator that would have typed a credential into the wrong box

The blueprint first located the password field by `label: "Password"`. The test
that resolves every reviewed locator against the real page failed with *expected
2 to be 1*: `getByLabel` is non-exact by design, so "Password" also matches
"Confirm password".

On any other field that is a bug. On this one it is the bug that types a
credential into the wrong box — and the fill agent takes ONE locator, with no
list to fall through. Both password fields are now located by `name`, which is
also what discovery's own observer records for them.

---

## [0.19.0] — 2026-08-31

**P1 — the run exists.** A student conversation can now create and own a
durable application run, and the run survives the process that started it.

**Version bump: MINOR.** One new endpoint, one new migration, one new
orchestrator transition, and the first production caller of `nextStep`. No
approved security boundary moved.

### Added — the Conversation Service is now the Application Plane's service

`nextStep` had exactly one caller in the whole repository — `scripts/end-to-end.ts`,
a demo. The orchestrator was complete, tested and unreachable from anything a
student could do. `apps/conversation-service/src/run-driver.ts` is the join.

The division is stated and enforced: **the Conversation Service coordinates and
the orchestrator decides.** `scripts/check-boundaries.ts` fails the build if the
driver grows a `switch (step.kind)`, calls `phaseFor` or `deriveCheckpoint`, or
stops calling `nextStep` at all — because a second implementation of the
decision is exactly how the two models of a case came apart in the first place.

### Added — migration 0002, and the binding is the database's rule

`cases` is an identity anchor: an id, an owner, a timestamp. No status, no
phase, no checkpoint, no business fact — `case_events` is still the sole
authoritative record, and a `status` column here would have become a second
opinion about it within a bug or two.

`conversations.case_id` references `cases` through a **composite** foreign key
over `(student_id, case_id)`. A plain reference to `cases (case_id)` would let
student A's conversation point at student B's case: the reference would be valid
and the ownership would be wrong. MATCH SIMPLE keeps the column nullable, so a
conversation that has not started an application is the normal case rather than
an exception the schema has to tolerate.

### Added — `withSecret`, the only sanctioned writer of `RunState.secret`

The field has existed since the secret channel was designed and nothing could
write it. The writer is a machine, not an assignment: nothing may move out of a
settled secret, a second request may only replace one that has settled, and a
handle may only accompany a lifecycle that can have one — the same rule the
secure plane's own schema states as `a_handle_means_it_was_answered`. Re-reporting
the same word is a no-op, because lifecycle deliveries are at-least-once.

### Added — `POST /v1/conversations/{id}/runs`

No `Idempotency-Key`, and that is not an oversight: a conversation owns at most
one case, so a retry is the same question rather than a second request.
`resumed` and the status code (201 created, 200 resumed) are how a caller tells
which it got. The response carries position and identity only — a type-level
assertion in `@askimate/aas-contracts` fails the build if a free-text field is
ever added to it.

### Fixed — a concurrency defect the tests caught

The first version locked the conversation row for the BINDING and nothing after
it. Two simultaneous starts therefore agreed on one case and then raced to open
that case's event log, and the loser got a `ConcurrencyConflictError` a student
would have seen as a 500. The critical section now spans bind → open the case →
start the run, and run ids are derived from the case rather than from a clock,
for the same reason `idempotencyKeyFor` is derived rather than random.

### Discovered — a seam between the blueprint and the domain

`ApplicationBlueprint.intake` is the label `"September 2026"`; the domain's
`Intake` is a branded, validated `YYYY-MM` that goes into the submission key
preventing duplicate applications. Parsing the label would have made a
coordinator derive a business fact from prose, and derive it wrongly the first
time a blueprint said "Autumn 2026". The catalogue states the identity instead,
beside the institution and course references that were already there for this
reason.

### Honestly not durable yet

The `ConfirmedProfile` and the `InterviewState`. `resumeRun` has said so in its
own documentation since it was written — `ConfirmationCaptured` carries a
reference rather than a value, deliberately, so the event log is not a copy of
the profile. Everything P1's brief lists as durable does survive: case identity,
run identity, durable run state, checkpoint state and the conversation binding.

---

## [0.18.0] — 2026-08-30

**The runner no longer holds a password. The component that consumes a credential
moved inside the Secure Plane's trust boundary, and the plaintext still never
becomes service-to-service response data.**

**Version bump: MINOR.** A new deployable, two extractions, one contract
operation added, and one internal operation whose meaning changed without its
shape changing. No approved security boundary moved.

### Added — `apps/secure-filler`, the Secure Plane's fill agent

The vault hands plaintext to a **callback**, and a closure cannot cross mTLS. So
the callback moved to where the vault can reach it: a fourth deployable that
constructs its **own** `EnvelopeVault` over the **same** envelope cache and the
**same** KMS key as the secure service, obtains the ciphertext locally, decrypts
it in its own process, and types it into the runner's browser over the Chrome
DevTools Protocol.

Vahid, 2026-08-30: *"Sending the plaintext back in an HTTP response, even over
mTLS and a private subnet, weakens one of the strongest guarantees we have
deliberately established."* Nothing sends the agent a secret. `SecretUseResult`
is unchanged and still has no field that could carry one — and the contract's
sentence about the vault handing plaintext to a callback is now literally true
for the first time.

### Added — three checks the agent makes against the live page

`confirmNoDiagnosticCapture()` reads a private symbol on a `BrowserContext`
object, and the agent holds a different object for the same underlying context.
Rather than take the runner's word for it, three experiments were run against
real Chromium with the fill performed by a second process:

| Runner-side state | Value in `trace.trace` | Detectable from the page |
| --- | --- | --- |
| tracing, `snapshots: true` | **yes, verbatim** | **yes** |
| tracing, `snapshots: false` | no | no |
| no tracing | no | no |

The first row is the finding: a value typed by *another process* still lands in
the runner's trace, because the leak is the DOM snapshot rather than the action.
The third column makes it fixable — Playwright's snapshotter installs a `window`
property beginning `__playwright_snapshot_streamer_`, present in exactly the
configuration that leaks. So the agent **verifies** rather than trusts, which is
stronger than what it replaces: a check performed by the component being checked
guards against accident, and this one is performed by the component holding the
plaintext.

Two more, neither of which existed before: the page's host must equal the bound
target host (checked against the document, not against metadata), and the field
must be an input the browser renders **masked** — which is what closes video, the
one capture route the agent cannot detect remotely.

### Changed — `/internal/v1/secret-uses` grants authority, and no longer takes the ciphertext

It used to call `vault.use(handle, () => true, now)`: spending the entry with a
callback that discarded the plaintext, because there was nothing on that side to
hand it to. Now it re-checks the binding, settles `secret_consumed`, records the
use and enqueues the outbox row — and the agent takes the ciphertext.

Single use is enforced twice, now on either side of the boundary: `settle` and
`recordUse` make a second call answer 409, and `EnvelopeCache.take` is atomic and
removes the entry before the callback runs. The authority is obtained **before**
any plaintext exists, so a failure after that point is a spent password — the
same semantic ADR-0026 §3 already establishes for a callback that throws, and the
failure direction that leaves a record.

### Changed — the runner is a client, and cannot become anything else

`fillSecret` posts to the agent and reads back one of two words. The runner
declares no `@askimate/aas-secrets`, no `@aws-sdk/client-kms`, and none of its
source files may so much as name `EnvelopeVault`, `InMemorySecretStore`,
`useSecret` or `getSecret` — checked in the manifest AND in the source, because
a deep relative import resolves perfectly well and pnpm never hears about it.

`apps/secure-service` may not declare Playwright as a production dependency: the
browser automation went to the agent precisely so that service would not grow
one.

### Added — two extractions, so nothing is duplicated across a trust boundary

`@askimate/aas-secure-logging` (the field-allowlist logger, now used by both
Secure Plane processes) and `@askimate/aas-browser-fill` (locator resolution, the
keystroke, and the page guards, used by the runner and the agent). Two copies of
"which element does this blueprint mean" would eventually disagree, and on the
agent's side that disagreement is a password typed somewhere it should not be.

### Added — the whole path, end to end, with every byte on every wire scanned

`fill-agent-e2e.test.ts`: a real PostgreSQL, the real secure service reached
through the real frame bootstrap, the real agent over real HTTP, a real Chromium
over real CDP, and the real runner client. It records the body of every HTTP
message between the three processes and asserts the password appears in
**exactly one** — the student's own submission. "Exactly one" rather than "none"
because a scan finding zero would mean the recording was broken.

### Verified — ten deliberate regressions

Recorded in `docs/adr-0042-regression-audit.md`, each proved to have applied by
reading the file back from disk before its suite was read.

### Documented — the residual, rather than glossed over

The runner still **owns** the browser the agent types into, so a runner that has
been actively compromised can read the field afterwards. ADR-0042 records this
deliberately. What the change protects is the password's existence outside the
browser — in a heap, a log, an error object, a crash dump, a KMS grant — not the
live page. A password is reused across sites and a portal session is not, which
is why that is the trade worth making.

---

## [0.17.0] — 2026-08-30

**The seven coverage gaps are closed, and closing them found two real defects:
the composer reopened on the browser's own word, and the client never asked
whether it could show the step at all.**

**Version bump: MINOR.** New coverage, two behavioural corrections, one contract
alignment, and the first staged deletion from the legacy harness.

### Fixed — the composer gate read provisional state

`useSecureTurn` computed `awaitingSecret` from the MERGED view: durable events
plus whatever the browser was drawing. So when the secure frame posted
`secret_received`, the client drew a provisional entry, the merged view went
empty, and **the composer reopened before the Secure Interaction Service had
published anything**. Nothing unsafe was ever accepted — the Conversation
Service refused the resulting message with a 409 — but the student saw a live
composer for a step the log still held open, and "provisional UI must never
override server authority" is the rule.

The gate now reads `openSecretRequest(log.durable)`. Rendering still uses the
merged view, because the card *should* close the instant the student succeeds.
The two are different questions and now have different answers.

On the provisional app there is no durable log — its turns arrive through
`receive` without ordinals — so there the merged view IS the server's word, and
the gate says so explicitly.

### Fixed — the real path never asked whether it could render

`decideRendering` was written for this architecture; its own comment cites
ADR-0030. The cross-origin path went straight to fetching a bootstrap
capability without consulting it, which is why three refusal reasons had no
coverage: nothing called them. It is now asked BEFORE the capability is
fetched, so a client that cannot show the step never obtains a one-time token
it has no use for.

**One legacy behaviour is deliberately not preserved.** The provisional path
cancelled the request on a refusal. The real path cannot — cancellation needs a
secure session, which needs the bootstrap it has just declined — and should
not: a client that reports it cannot display a password box is not a client
that should decide nobody will be asked. The request stays open, the composer
stays blocked, and the TTL settles it.

### Fixed — a contract divergence on the internal API

`secure.v1.yaml` distinguishes 409 (already spent) from 404 (unknown) on
`POST /internal/v1/secret-uses`. The implementation collapsed both to 404,
because `settle` nulls the handle. It now consults the audit table, answers 409
for a handle that was spent, and records the refused attempt — a second attempt
on a dead handle is either a retry that should stop or a capability being used
where it should not be, and both deserve a row.

Note the deliberate asymmetry: on the STUDENT-facing surface one answer still
covers unknown, spent and expired, because telling them apart would confirm that
some handle had once been real. The internal caller is our own runner behind
mutual TLS, where "do not retry" and "wrong id" are different instructions.

### Fixed — a frozen clock in the two-origin browser suite

The servers minted `expiresAt` from a hard-coded `2026-08-28T10:00:00Z` while
the browser compared it with `Date.now()`. Two days later every secure step the
tests opened was already expired as far as the page was concerned. Nothing
looked before, because nothing checked the expiry; wiring `decideRendering` in
exposed it immediately — every frame refused with `prompt_expired`. Production
has one real clock on both sides, and so does the suite now.

### Added — 21 tests against the real architecture

Ten composer/draft questions answered on the two-origin stack, three capability
refusals, three plane-separation tests, two handle-spend tests, and a
"never fetches a capability it cannot use" test.

### Findings

**Two properties are defended twice over, which two regressions revealed.**
Filtering `secret_requested` out of the paged read did not break the
refresh-restore test, because the SSE backfill still delivered it; the
regression had to break the single source both paths use. And bypassing the
vault did not produce a double-spend, because `settle` nulls the handle
independently. Both are good news, and both mean a single-mutation regression
proves less than it appears to.

**Three regressions were caught only by a timeout at first**, which is not proof.
Each test was restructured so the assertion fails and names what it found: Q5
waits for the transcript then asserts, Q7's capability tests do the same, and
Q4's release case polls for "released OR something was sent" so a released
buffer fails on the assertion rather than on a composer that never reopens.

### Harness retirement — the first deletion

**Seven `it` blocks deleted from `fail-closed.test.ts`** (33 → 26), each after a
regression proved its replacement fails. Nothing else was removed:
`quarantine.test.ts`, `end-to-end.test.ts`, `continuity.test.ts` and the
provisional app all stay. **One property still has no replacement** —
`refuses an unverified email` — because ADR-0038's identity delegation is not
implemented and there is no claim for a test to assert on.

`docs/harness-coverage-mapping.md` carries the full decision matrix.

### Verification

- **1490 tests, 75 files**, `pnpm run verify` green.
- **445 tests against real PostgreSQL**, none skipped.
- **27 two-origin Chromium tests**.
- **Nine deliberate regressions**, each verifying it applied first.

---

## [0.16.0] — 2026-08-28

**A real browser now types a real credential into a real cross-origin Secure
Plane, and the conversation page cannot read it — because the browser will not
let it, not because our code promises not to look.**

**Version bump: MINOR.** The Secure Interaction Service gained its HTTP surface
and the vault became what ADR-0034 specifies; additive in capability. Two
contract corrections are described below. No security property is weakened.

### Added — the Secure Interaction Service

Seven operations, implementing `secure.v1.yaml` as written. The contract and the
`postMessage` protocol in `packages/contracts/src/frame.ts` already existed and
were followed rather than re-invented.

- **`control-document.ts`** — the control, served by the secure origin, under
  `default-src 'none'; script-src 'self'; connect-src 'self'; form-action
  'self'; base-uri 'none'; frame-ancestors <parent>`. `connect-src 'self'` is
  the load-bearing one: even an injected script has no origin to send a value to.
- **`control-client.ts`** — the only code that ever sees a password. No
  framework, deliberately: React is what would have tempted someone to make the
  input controlled. The value exists in one DOM element and one `fetch`
  argument, and nowhere else.
- **`routes.ts`** — the one endpoint in AskiMate that accepts a secret. Every
  check that does not need the value runs first, so no refusal path ever holds
  the plaintext in a variable.
- **`logger.ts`** — a field allowlist, by type. `LogFields` admits scalars with
  known meanings and there is no `meta`, no `extra`, no `err`. `failure()`
  reduces a thrown value to a class name at its first statement.

### Added — the vault ADR-0034 actually specifies

AES-256-GCM, a fresh KMS data key per secret, keys zeroed after use, ciphertext
in a cache with a five-minute ceiling applied at encryption time. `use()` still
takes a callback and returns the callback's result — ADR-0034 says that design
"is kept exactly", and it is.

`LocalDataKeyProvider` is for development, and
`assertVaultIsProductionGrade(provider, NODE_ENV)` **refuses to start** a
production process that is using it. `KmsDataKeyProvider` is real code that has
never been run against a live key from this repository, and
`docs/secure-plane-deployment.md` says so rather than implying otherwise.

### Fixed — two contradictions between the contracts and reality

**The TTL ceiling.** `packages/secrets` said fifteen minutes; `secure.v1.yaml`
said 60–300 seconds; ADR-0034 said "hard ceiling 5 minutes". The contract and
the ADR are the authority — they were written in the contract-first phase that
the constant predates — so the ceiling is 300 and the floor is 60. The vault
applies the ceiling again at encryption, so a caller that never went through
request validation still cannot exceed it.

**The secure session cookie.** The contract specified `SameSite=Lax`, and that
**cannot work**: measured in Chromium, a `Lax` cookie is not sent on requests
made from inside a cross-site iframe, which is the only context this session
exists in. The frame would set the cookie and then be refused by its own service
on the next fetch — `SameSite=Lax` and ADR-0030 are mutually exclusive. It is
now `SameSite=None; Partitioned` (CHIPS), which keys the cookie to the top-level
site as well, so it is not a general third-party cookie. The CSRF protection
`Lax` would have given is replaced by `Origin` and `Sec-Fetch-Site` checks,
which refuse a cross-site POST outright rather than merely withholding a cookie.

### Findings

**A backup directory keyed by basename destroyed a file.** Two services both
have `routes.ts`; the regression harness copied both into one directory and a
restore wrote the conversation service's routes over the secure service's. It
was caught by the next test run, the file was rewritten, and the backups are now
keyed by full path. Recorded because the failure mode — a "restore" that
silently installs the wrong file — is one a green suite would not have shown.

**Four regressions were not caught, and each exposed a real gap.**

- **R7** (a prefix origin comparison instead of an exact one) passed every test.
  The rule was documented in `frame.ts` and enforced nowhere.
  `packages/contracts/src/frame.test.ts` now tests nine lookalike origins,
  including `https://app.askimate.com.evil.test`.
- **R8** (`postMessage(payload, "*")`) passed everything, because a wildcard is
  a superset of correct behaviour and no cooperating test notices. A boundary
  rule now reads the source — and my first version of that rule caught the
  wildcard in one file and missed it in the other, because the second call had a
  trailing comma.
- **R13** (splitting the receipt from its outbox row) passed, because on the
  happy path both writes succeed either way. There is now a test that fails the
  publication and asserts the receipt rolled back with it, plus a rule that only
  `withTransaction` may issue BEGIN or COMMIT.
- **R3**, in its first form, was "caught" only by a timeout after my patch broke
  the control flow. That is not evidence, and it was redone surgically.

### Verification

- **1475 tests, 75 files**, `pnpm run verify` green.
- **7 two-origin Chromium scenarios**: the full journey, postMessage scanning,
  refresh, cancellation, rejection, a stale client POSTing directly, and two
  browsers on one conversation.
- **20 secure-service tests** against a real database and a real vault, every
  log assertion on a FAILURE path.
- **All 14 required regressions** confirmed, each verifying it applied first.

### Not done, deliberately

`docs/harness-coverage-mapping.md` is updated: the secret-entry path now has
browser-level coverage on the real architecture, and **seven properties still
have none**. Nothing was deleted.

---

## [0.15.0] — 2026-08-28

**The browser now talks to the real Conversation Service, and the Secure
Interaction Service pushes lifecycle transitions into the real event log. The
architecture that existed as separated pieces in 0.14.0 is connected and proven
end to end in real browsers, across two services and two databases.**

**Version bump: MINOR.** Two services gained real surfaces and the client moved
onto them; additive in capability. One contract gained a parameter, described
below. No security property is weakened; three are newly proven in a browser.

### Phase 1 — the React client on the real service

```
Browser → Conversation Service → PostgreSQL → server-assigned ordinal
        → SSE → ConversationLog → React UI
```

- **`apps/conversation-service/src/app.ts`** — the conversation plane as ONE
  origin: the API and the client it serves. ADR-0030 already said so; this makes
  the session cookie simply attach, `EventSource` work without `withCredentials`,
  and leaves no cross-origin preflight in front of the fail-closed guard.
- **`apps/conversation-service/src/session.ts`** — the `__Host-` HttpOnly cookie
  of ADR-0033. The stream is what turned the approved model into the *only*
  workable one: `EventSource` takes no request headers, so a bearer token could
  only ride in the URL — where it reaches the access log, the `Referer`, the
  proxy and the browser history.
- **`apps/chat-integration/src/conversation-client.ts`** — `load`, `send`,
  `stream`. Relative URLs, no base to configure, and the browser's own
  `EventSource` so its automatic reconnect and `Last-Event-ID` handling are the
  ones ADR-0035 depends on rather than a reimplementation.

### Phase 3 — the lifecycle push, as a transactional outbox

```
Secure Interaction Service → authenticated internal append
        → Conversation Service → durable event log → SSE → browser
```

- **`0002_lifecycle_outbox.sql`** — the transition and the intent to publish it
  commit in ONE transaction, in the secure plane's own database. Separate
  databases mean the two planes cannot share a transaction, so the choice was
  where the failure lands: pushing inside the request loses a student's
  submission when another service blinks; pushing and forgetting loses the
  transition. The outbox loses neither.
- **Fail-closed follows the DIRECTION of the error.** An undelivered row means
  the conversation log still shows the request open, so the guard there refuses
  messages. The failure mode is a composer that stays shut — never one that
  opens early — and that is a property of the arrangement rather than a rule
  someone has to remember.
- **Two idempotency layers**, because a duplicate enqueue and a duplicate
  delivery have different causes: `UNIQUE (request_id, kind)` here, and the
  internal route's existing idempotency on (conversation, request, kind) there.
- **`FOR UPDATE SKIP LOCKED`**, because several instances run the publisher.

### Changed — the stream contract gained a resume parameter

A browser's `EventSource` sends `Last-Event-ID` **automatically, and only on its
own reconnects**. A page that has just loaded cannot send it: the API accepts no
request headers. So a client holding events up to ordinal 41 had no way to say
so on a fresh connection, and every refresh re-sent the whole conversation while
announcing `resumingAfter: 0`.

`conversation.v1.yaml` now documents a `lastEventId` query parameter alongside
the header, parsed and constrained identically — a strict non-negative integer,
used only as a lower bound inside a conversation already authorised. **The
header wins when both are present:** it is the browser's account of what this
connection received, whereas the query parameter is what the page believed
before the connection existed.

### Added — a bounded stream lifetime

`maxStreamMs`, five minutes by default. An SSE connection is open indefinitely
by design, and that is exactly what stops an instance draining: a rolling
deployment cannot retire a pod holding streams nobody will close. The server
closes them on a schedule it controls and the browser reconnects by ordinal, so
a routine deployment costs nothing. This is also what let the browser test prove
reconnection — see below.

### Findings

**Three tests that would have passed while proving nothing.** Each was caught by
asserting that the thing under test actually happened:

- **The stream never dropped.** The reconnect test registered a Playwright route
  to abort the stream — but routing only affects requests a page has yet to
  make, and the `EventSource` was already open, so the pattern matched nothing
  and the test asserted that an *uninterrupted* stream delivers events.
  `context.setOffline(true)` did not sever the established loopback connection
  either. Closing it server-side does, and is the realistic case.
- **The client never resumed by ordinal.** The resume point was a ref assigned
  during render; `backfill` calls `setLog`, React applies that on a later
  render, and the stream opened in the same microtask — so the ref still read 0.
  Correct on screen, because `admitDurable` deduplicates, and wrong on the wire.
  The watermark is now a local advanced by the code that learns the ordinals.
- **A client-created ordinal was invisible end to end.** Overwriting the send
  response's ordinal with `1` failed *none* of the fourteen browser tests: the
  stream delivers the same event at its real ordinal moments later and repairs
  it. The durable path is defended twice, which is good — but a suite that
  cannot distinguish "correct" from "repaired" would let the response path rot.
  `conversation-client.test.ts` now drives the transport with an injected
  `fetch` and `EventSource` so each path is observable alone.

**An ambient clock in a column default.** `lifecycle_outbox.next_attempt_at`
defaulted to `now()`, the database's clock — a second clock, and it disagreed
with the injected one the moment a test used a fixed time. Every row was queued
in the database's present and asked for in the caller's past, so nothing was
ever due: a publisher that silently delivered nothing, which has the shape of an
outage rather than a bug. `enqueue` now takes the caller's clock.

**Two schema guards did their job.** Adding the outbox failed the migration-list
assertion and the "names every table it has, so a new one cannot arrive
unnoticed" test, which is exactly what they are for — the column-by-column
"no column can hold a secret" scan now covers the new table because it was
registered rather than because anyone remembered.

### Verification

- **1422 tests, 71 files**, `pnpm run verify` green.
- **405 tests against real PostgreSQL**, `scripts/with-postgres.sh`, none skipped.
- **14 real-Chromium tests** against the real service: server ordinals, two
  clients converging, refresh, reconnect, and the fail-closed guard.
- **8 cross-service tests** across two databases: delivery, retry, permanent
  failure, duplicate retry, and both services restarting.
- **All ten required regressions** confirmed, each verifying it applied first.
- `app.test.ts`, `conversation-service.test.ts` and `lifecycle.test.ts` added to
  `scripts/ci-guard.test.ts`, so CI fails rather than skips without a database.

### Not done, deliberately

`docs/harness-coverage-mapping.md` maps every legacy property to its
replacement — and names the ones that have none. **The legacy harness stays.**
The Secure Interaction Service has no HTTP surface yet, so nothing in the new
architecture accepts a password, and the suites that prove what happens when one
is typed are still the only proof of it.

---

## [0.14.0] — 2026-08-28

**The Conversation Service exists, and it is the only thing in the system that may say where an
event sits. The client had been inventing that answer for a whole phase, and nothing objected
because a rendering position and a durable ordinal were both `number`.**

**Version bump: MINOR.** A new service, additive in capability. Two wire shapes changed and one
divergence between two contract artefacts was resolved; both are described below. No security
property is weakened.

### The bug this removes

```ts
// superseded — apps/chat-integration/src/useSecureTurn.ts
{ ...event, ordinal: previous.length + 1, createdAt: now().toISOString() }
```

That is a plausible number and a false claim. An ordinal is dense, unique per conversation, assigned
by the database inside the insert's transaction — and it is also the SSE event id a reconnect
resumes from. Two tabs would produce different "ordinal 4"s for different events, and a reconnect
carrying a locally-computed `Last-Event-ID` would skip or repeat real events. The value looked like a
resume cursor and was not one.

It is now impossible to write. A `Position` is either the server's ordinal or a client-local id, and
they share no field; an `UnpositionedEvent` has no `ordinal` and no `createdAt` to put one in.
`createdAt` travels with `ordinal` for the same reason — the contract already said a client's clock
is never trusted for it, and a shape permitting "the server said where but not when" invites
`new Date()` onto a durable event.

### Added — `apps/conversation-service`

- **`event-store.ts`** — the ordinal authority. A position is claimed by
  `UPDATE conversations SET last_ordinal = last_ordinal + 1 WHERE id = $1 RETURNING last_ordinal`:
  one statement that claims, locks and advances, in the same transaction as the insert. Not a
  sequence — sequences are non-transactional, so a rolled-back insert would leave a gap, and ordinals
  must be dense because the ordinal *is* the SSE event id.
- **`routes.ts`** — messages (with the fail-closed guard ahead of reading the body), paged event
  reads, a resumable SSE stream, and the internal append the Secure Interaction Service uses.
  `Last-Event-ID` maps to `WHERE ordinal > $cursor`: no cursor table, no opaque token.
- **33 tests against real PostgreSQL and a real listening server** — twenty simultaneous writers,
  cross-conversation independence, reconnect without duplication, two readers converging on one
  ordering, a hostile `Last-Event-ID`.

### Added — `packages/conversation`

- **`log.ts`** — the client's `ConversationLog`, which separates events the server placed from
  entries the browser is merely drawing. `admitDurable` deduplicates by ordinal, orders by ordinal,
  and retires the local echo the arriving event supersedes. It lives in the domain authority rather
  than in a client because "a rendering position is not a durable ordinal" is a rule every client
  must obey, and a rule kept in one client is a rule the next one reinvents wrongly.
- **`unpositioned.ts`** — `UnpositionedEvent`, and the compile-time constraint that it names no
  position. `openSecretRequest`, `persistableContent` and `buildModelRequest` now take it: each reads
  `kind`, `requestId`, `actor` or `content` and never a position, so requiring an ordinal was forcing
  callers to invent one merely to ask a question.
- **`Position`** — `{ placement: "durable", ordinal }` or `{ placement: "provisional", localId }`,
  with `renderKey` the only thing that flattens them, into a prefixed string that is never an
  ordinal. A shared key space would let React reuse a settled secure step's DOM node for a live
  control.

### Changed — two wire shapes

- **`ChatSendResponse` moved to `packages/contracts`** and its accepted branch now carries
  `events: readonly ConversationEvent[]` rather than `reply: string`. A single request can cause the
  server to append more than one durable event — the student's message and, on a synchronous
  endpoint, the assistant's answer — and a client told about only the first would have to place the
  second itself.
- **`ChatRoutesOptions.persist` became `append`**, which returns the event at the position the server
  gave it. `persist` returned `void`, which is why the route was left fabricating `ordinal: 1`.

### Fixed — a contradiction between two artefacts in `packages/contracts`

`conversation.v1.yaml` declared `POST /messages`'s 409 as `application/problem+json` carrying
`SecretRequestOpenProblem`. The service was sending `application/json` carrying a bespoke
`{ status: "refused" }` envelope, and its 201 returned an envelope where the contract named a bare
`MessageEvent`. The OpenAPI tests compare the two *documents* against each other and against the
vocabulary; nothing compared either with what the service actually sends.

The contract wins — ADR-0005 is contract-first, and RFC 9457 for every failure is the better answer
than one endpoint with its own error envelope. The service now sends problem+json, returns the bare
event, and `routes.test.ts` asserts the media type as well as the body. The document gained the
`200`-on-idempotent-replay response it was already returning. `ChatSendResponse` remains the shape of
the *provisional* `POST /api/askimate/ai`, which has no OpenAPI document and answers inline because
it has no stream.

### Added — a boundary rule for wire types

`scripts/check-boundaries.ts` now fails if a browser file imports from a server route module, or
names a type such a module declares. The declared names are read out of the server modules rather
than listed, so a wire type added to a route tomorrow is covered without anyone remembering.

### Verification

All ten named properties were confirmed by deliberate regression — each guarantee broken in turn,
with the failing test recorded. Two of those runs are worth keeping:

- **A regression that silently did not apply.** My first attempt to break the atomic claim used a
  patch string that did not match the source, and `str.replace` made it a no-op. The suite passed and
  briefly looked like proof that the concurrency tests were vacuous. Every later regression asserted
  that it had applied before the tests ran.
- **A regression aimed at the wrong line.** Swapping the `ROLLBACK` in `append`'s catch clause for a
  `COMMIT` does not break anything: PostgreSQL aborts a transaction as soon as a statement in it
  fails, and `COMMIT` on an aborted transaction rolls back. What actually carries "a failed
  transaction cannot leave `last_ordinal` advanced" is that the claim and the insert share ONE
  transaction — and committing the claim separately does break the test. Recorded in
  `event-store.test.ts`.

`apps/conversation-service` was added to `scripts/ci-guard.test.ts`, so CI fails rather than skips if
its database is missing.

---

## [0.13.0] — 2026-08-28

**`packages/conversation` is now the single domain authority. The duplication it removes was not
redundancy — one of the two copies was wrong, and nothing could have told them apart.**

**Version bump: MINOR.** A new package and a client migrated onto it, additive in capability. Every
security property is preserved or strengthened; two are strengthened, described below.

### The bug the duplication was hiding

Two generations of the same five decisions coexisted: the turn model in `apps/chat-integration` and
the wire model in `packages/contracts`. They had drifted:

```ts
// superseded — closes the open step on ANY status
else if (item.render === "secret_status") open = null;

// authority — closes only the request it NAMES
if (open === event.requestId) open = null;
```

`ChatTurn`'s `secret_status` variant carried no `requestId`, so **the old model could not express the
correct rule.** Two requests in one conversation — a lapsed one and a live one — and the lapsed one's
settlement released the live one's composer guard, letting an ordinary message through while a
password box was on screen. That is why this was a migration to the wire model rather than a lift of
the existing code.

### Added — `packages/conversation`

Five decisions, one implementation each, consumed by both the server routes and the browser client:

| Decision | Question |
| --- | --- |
| `openSecretRequest` | Is a secure step open? |
| `composerPolicy` | What may the composer do about it? |
| `decideRendering` | Can this client show the step at all? |
| `projectTranscript` | What is drawn, and in what order? |
| `buildModelRequest` | What reaches the model? |

**`check-boundaries.ts` now fails the build if any file outside that package DEFINES one of those
names.** Importing is what they are for; a second implementation is how the client and the server
come to disagree.

### Removed — four files of duplicated decisions

`chat-transport.ts`, `render-decision.ts`, `transcript.ts` and `transcript.test.ts` are gone from
`apps/chat-integration`, which now imports the authority. `continuity.test.ts` keeps only its unique
coverage — `replayEvents` over the legacy table — because its other assertions were about decisions,
and the decisions moved.

### Changed — two narrowings, both improvements

- **`decideRendering` takes the channel and the expiry**, not a whole `SecretPrompt`. Under ADR-0030
  the conversation plane never has the title, the explanation or the portal host. A decision that
  cannot reach the prompt cannot leak it.
- **`SecureControl` takes only the five fields it renders**, and no longer imports
  `@askimate/aas-secrets` at all — so the package holding the secret store is one step further from
  any browser bundle. Neither does `useSecureTurn`.

### Strengthened

- **The wire parser no longer spreads.** It used to `{ ...fields }` an incoming prompt, so an
  unexpected server field rode along unread. It now constructs field by field, and the test that
  asserted `conversationId` *survived* the spread now asserts it is **absent**, along with the exact
  key set.
- **A replayed receipt replays as `secret_expired`, not `secret_received`.** A handle nobody can
  spend is not an available secret, and `secret_received` without a handle is unrepresentable in the
  wire model — which is what the database's `a_handle_means_receipt` CHECK says too.

### Also moved — ADR-0040's own boundary

`openSecretRequest` and `persistableContent` were in `packages/contracts`. They are **decisions**, so
they moved. `contracts` keeps the model, its parser, and `eventCarriesContent` — a fact about the
shape rather than a choice about it. Recorded as an addendum to ADR-0040 and in
[ADR-0041](./docs/decisions/0041-one-implementation-of-each-conversation-decision.md).

### Verification

**64 files, 1317 tests, 0 failures, 0 skipped** — identical totals to before the extraction, with the
coverage relocated rather than lost: `transcript.test.ts` (17) and part of `continuity.test.ts` and
`contracts.test.ts` became `conversation.test.ts` (27). **All browser coverage preserved**:
`fail-closed.test.ts` (33), `end-to-end.test.ts` (12), `react-client.test.tsx` (25) all run against
the extracted implementation.

| Deliberate regression | Caught by |
| --- | --- |
| A second `composerPolicy` appears in the app | ✅ build rule |
| Openness closes on ANY settlement | ✅ package tests |
| A rejection closes the request | ✅ package **and** browser tests |
| The composer becomes disable-able | ✅ package tests |
| `decideRendering` stops checking the channel first | ✅ package tests |
| The model funnel serialises the whole event | ✅ package **and** e2e tests |

Two of those fired in both the package's own suite and the app's — which is the evidence that both
consumers really do run the same implementation.

---

## [0.12.1] — 2026-08-28

**Migrations: the first implementation step of the independent product. The security guarantees
move from the application into `CHECK` constraints, verified against a real PostgreSQL.**

**Version bump: PATCH.** Two new schemas that nothing runs against yet, plus an extracted runner.
No behaviour changed and no boundary moved.

### Added — two schemas, two databases

Per ADR-0037 the planes hold **separate databases with separate credentials**, so these are two
migration sets, not one.

- **`apps/conversation-service/migrations/0001_conversation_log.sql`** — students (keyed by the
  OIDC `sub` and nothing else), conversations, `message_bodies`, `conversation_events`, idempotency
  keys, and the `open_secret_requests` view.
- **`apps/secure-service/migrations/0001_secret_requests.sql`** — requests, hashed single-use frame
  tokens, hashed sessions, and the use audit. **No column can hold a secret.**

### The guarantees, as constraints rather than as code

| Property | Enforced by |
| --- | --- |
| A secure event cannot hold what a student typed | `CHECK ((kind = 'message') = (body_id IS NOT NULL))` |
| …and a message cannot lose its text | the same constraint, read the other way |
| A secure event names its request; a message never does | `CHECK ((kind = 'message') = (request_id IS NULL))` |
| A handle exists exactly on a receipt | `CHECK ((kind = 'secret_received') = (handle IS NOT NULL))` |
| A reason exists exactly on a rejection | `CHECK ((kind = 'secret_rejected') = (reason_code IS NOT NULL))` |
| Closed vocabularies | `CHECK (… IN (…))` on kind, actor, reason, channel, lifecycle, purpose, refusal code |
| One event per position | `UNIQUE (conversation_id, ordinal)` — two racing writers, one gets 23505 |
| Redaction is not deletion | `ON DELETE RESTRICT` on `body_id` |
| The secure database holds no secret | asserted from `information_schema` after migrating |

`open_secret_requests` deliberately contains **no `now()`**: a clock inside a view is an ambient
read no test can move, and every clock in this repository is injected. The caller supplies the
instant. A rejection is deliberately absent from the settling kinds, so a mistyped confirmation
leaves the step open — the divergence Phase D removed, now expressed in SQL.

### Added — `packages/aas-migrate`

The runner extracted from `packages/case-store`, which now passes its own directory like everyone
else. **There is no default directory**: a runner with one silently migrates the wrong database
when a caller forgets the argument. `@askimate/aas-migrate/testing` also holds the shared
database-availability helper — three copies of `announceSkip` would be three chances for one of
them to forget that `AAS_REQUIRE_DATABASE=1` must turn a skip into a failure.

### Added — the internal append endpoint, found by writing the schema

`POST /internal/v1/conversations/{id}/events`, behind mutual TLS. See the architectural note in the
report: with separate databases the conversation service **cannot** read `secret_requests` to run
its fail-closed guard, which is what the previous design did when both tables shared a database.
The secure service now pushes each transition server-to-server and the guard reads the
conversation's own log.

### Changed — three corrections to ADR-0031's sketch, found by implementing it

1. **`ON DELETE SET NULL` → `ON DELETE RESTRICT`** on `body_id`. `SET NULL` would have silently
   violated `only_messages_have_bodies` the first time anybody deleted a body.
2. **`actor` is nullable and message-only.** The sketch had it `NOT NULL` on every event; the
   shipped contract puts it on `MessageEvent` alone, and a lifecycle transition is not "from"
   anybody.
3. **`content` is nullable with a paired `redacted_at`**, not `NOT NULL`. Redaction has to leave the
   row so the event pointing at it survives; `CHECK ((content IS NULL) = (redacted_at IS NOT NULL))`
   makes it symmetric.

### Verification

**64 files, 1317 tests, 0 failures, 0 skipped**, with PostgreSQL up and `AAS_REQUIRE_DATABASE=1`.
45 of those are new schema tests, every one of which writes a row the design forbids and asserts the
database refuses it by SQLSTATE and constraint name.

| Deliberate regression | Caught by |
| --- | --- |
| `only_messages_have_bodies` dropped | ✅ both directions |
| `body_id` becomes `ON DELETE SET NULL` | ✅ redaction tests |
| The event-kind vocabulary is opened up | ✅ closed-set tests |
| A rejection closes the request in the view | ✅ guard tests |
| A secret column appears in the secure DB | ✅ `information_schema` scan |
| A `bytea` blob appears instead | ✅ `information_schema` scan |
| Ordinal uniqueness dropped | ✅ position tests |
| `now()` creeps into the guard view | ✅ view-definition test |
| A handle allowed on an unanswered request | ✅ lifecycle tests |
| The frame token stored raw | ✅ token tests |
| An audit row may free-text its refusal | ✅ audit tests |

---

## [0.12.0] — 2026-08-28

**The contract-first phase: both services' APIs are specified, checked against the code, and proved
unable to carry a secret outside the one endpoint that takes one.**

**Version bump: MINOR.** A new package and a new lifecycle member, both additive. One security
boundary was strengthened and one of my own compile-time assertions turned out to be vacuous; both
are described below.

### Added — `packages/contracts`

The wire contract, as its own dependency-free package ([ADR-0040](./docs/decisions/0040-the-wire-contract-is-its-own-package.md)).

- **`openapi/conversation.v1.yaml`** — the Conversation Service. Six paths, eighteen schemas.
  Sessions are a `__Host-` `HttpOnly` cookie; every endpoint but `/health` requires one.
- **`openapi/secure.v1.yaml`** — the Secure Interaction Service. Six paths, sixteen schemas, split
  into a student-facing surface and an internal API behind mutual TLS on a subnet with no public
  route.
- **`vocabulary.ts`** — every closed set declared exactly once, with the union **derived from** the
  runtime array so the two cannot drift, and a fail-closed parser for each.
- **`events.ts`** — the conversation event model. Exactly one member has a `content` field; the
  others do not have it optional or nullable, they do not have it.
- **`problems.ts`** — RFC 9457 `problem+json` **minus `detail`**. That member is "a human-readable
  explanation specific to this occurrence", which is precisely the field a helpful handler
  interpolates the failing value into — and on the one endpoint that receives a password, the
  failing value is the password. Wording is chosen client-side from a table keyed by code.
- **`frame.ts`** — the cross-origin protocol. A closed union in both directions, content-free, with
  four checks on every receipt: exact origin equality, the specific `contentWindow`, the request id,
  and every enum member parsed against its set.
- **`sse.ts`** — the ordinal **is** the SSE event id, so `Last-Event-ID` maps onto the log with
  nothing in between.
- **`versioning.ts`** — adding an enum member is explicitly non-breaking, because every client is
  contractually required to fail closed on unknown values. The security requirement buys
  evolvability as a side effect.

### Changed — `secret_cancelled` reaches the domain (ADR-0032)

- `SecretLifecycle` gains `secret_cancelled`; three terminal states now, not two.
- **`SecretStore.cancel()`** joins `discard()`. Two verbs rather than one with a reason parameter: a
  reason parameter needs a default, and a default is how the wrong word gets recorded silently.
- Cancellation is reachable **only from `secret_requested`**. Once a handle exists the automation may
  already be spending it, and a cancellation racing a consumption would be a lie in one direction.
- The Phase D compile-time drift assertion caught the change the moment the domain gained the member,
  naming it exactly. Three browser and unit tests asserted the old collapsed word and were updated.

### Fixed — an assertion of mine that was proving nothing

`ONLY_MESSAGES_CARRY_CONTENT` in `events.ts` was written as a conditional type that **computed**
`never` when the claim was false. `never` is a legal type, so the declaration succeeded and nothing
errored: adding `content?: string` to a secure event compiled cleanly. Regression **C4b** found it —
an *optional* field, so no consequential parser error masked the silence.

The distinction that matters: `AssertNever<T extends never>` fails because a **constraint** is
violated. A conditional type that merely evaluates to `never` fails at nothing. Rewritten as
`AssertTrue<Exactly<…>>`, and both directions now caught.

Also fixed: the new package was added without a project reference, so `pnpm run typecheck` passed
having never compiled it. Proved by introducing a deliberate type error and confirming it was
*missed*, then confirming it was caught after the reference was added.

### Verification

| Deliberate regression | Caught by |
| --- | --- |
| A conversation endpoint accepts a password | ✅ contract structure |
| A response hands the submitted secret back | ✅ contract structure |
| A secure event gains `content` in the YAML | ✅ contract structure |
| A secure event gains `content` in TypeScript | ✅ typecheck |
| A secure event gains an **optional** `content` | ✅ typecheck (after the fix above) |
| `MessageEvent` loses its `content` | ✅ typecheck |
| A frame message gains a `password` field | ✅ typecheck |
| A problem gains RFC 9457's `detail` | ✅ typecheck |
| The YAML gains a reason the code lacks | ✅ drift |
| TypeScript gains a reason the YAML lacks | ✅ drift |
| Frame origin check becomes `startsWith` | ✅ frame tests |
| Frame stops checking which window sent it | ✅ frame tests |
| A rejection closes the open request | ✅ openness tests |
| `Last-Event-ID` parsed with `parseInt` | ✅ SSE tests |
| The contract package takes a dependency | ✅ build rule |
| An internal endpoint loses mutual TLS | ✅ contract structure |
| The message endpoint becomes public | ✅ contract structure |

### Still out of scope, deliberately

No migrations, no service implementation, no `packages/conversation`. The contract-first phase
specifies; it does not build.

---

## [0.11.0] — 2026-08-28

**Phase D: one client, and it is the React one — plus the client/server divergence that had been
trapping every student who successfully set a password.**

**Version bump: MINOR.** New capability (the integrated React client), additive. One security
boundary was deliberately NARROWED and one client behaviour deliberately CHANGED; both are
described below, and neither weakens a property — they remove disagreements between two halves of
the system that each believed the other agreed with it.

### Fixed — the two divergences

- **A successful secure step no longer traps the student.** `openRequestFor` counted a row as open
  while its lifecycle was `secret_requested` **or** `secret_received`, released only by
  `secret_consumed` or `secret_expired`. Nothing in this application ever writes `secret_consumed`
  — `store.use()` moves the in-memory entry, not the database row, because the consumer is the
  orchestrator and it does not reach this table. So the only thing that ever released the guard was
  the five-minute TTL, while the client released its composer immediately on the status turn. A
  student who successfully set a password saw a live Send button and collected `409
  secret_request_open` on every message until the request lapsed. "Open" is now exactly
  `secret_requested`, unexpired — the state in which a password box is on screen, which is the only
  state in which an ordinary message risks being a password in the wrong field.

  Why no test caught it: the release path was only ever exercised through `secret_expired`, and the
  browser lifecycle test asserted the Send button was enabled without ever pressing it against the
  guarded route. Two correct halves, and nothing standing on the seam. There are now three tests on
  that seam, one of which asserts the row is *still* `secret_received` when the message goes
  through — so a fix that worked by writing a consumption record would not satisfy it.

- **A rejection no longer closes an open request (F3).** The vanilla harness closed the card for
  every rejection except `confirmation_mismatch`, which released the composer while the server still
  held the request at `secret_requested` — the exact divergence the fail-closed guard exists to
  catch. `openSecureRequest` had always said a rejection closes nothing; the client had simply not
  been asking it. Three browser tests that encoded the old behaviour were rewritten, and say so in
  place.

### Added

- **`useSecureTurn.ts`** — the headless container. Owns the turn list and the three lifecycle
  network calls, and **decides nothing itself**: rendering goes to `decideRendering`, ordering to
  `projectTranscript`, openness to `openSecureRequest`, the composer to `composerPolicy`. The
  harness had hand-copied all four into browser JavaScript, and one of the copies had drifted.
- **`ChatView.tsx`** — the provisional React surface. Composer is **uncontrolled**, for the same
  reason the password field is: a student who mistypes a password into the ordinary box has made a
  mistake, and a controlled input turns that mistake into React state an error boundary can
  serialise. Not a UI/UX proposal; banner-marked in the page.
- **`browser-entry.tsx`, `public/index.html`, `build-client.ts`** — the mount, the page, and an
  esbuild bundle built from the tree on every test run. The bundle is never committed: a checked-in
  build is a second copy of the client, which is what this release removes.
- **Cancellation actually cancels.** `DELETE /api/askimate/secret/:requestId` shipped in 0.10.0 with
  **no client at all**; `SecureControl`'s `onCancelled` cleared the inputs and told nobody. It now
  issues the delete and, only on a confirmed 200, appends a `secret_status · secret_expired` turn —
  a real lifecycle transition, the only closure `openSecureRequest` accepts. A failed delete appends
  a rejection instead, which by design leaves the request open, because it *is* still open.
- **`SECRET_REJECTION_REASONS`** — the closed set is now a runtime array with the union **derived
  from it**, so the two cannot drift; plus `parseRejectionReason`, through which every reason off
  the wire is narrowed before it can reach a turn, the transcript, or the model.
- **`SECRET_LIFECYCLE_WORDS`** — the client's own copy of the four lifecycle words, with a
  compile-time assertion in both directions against `SecretLifecycle`. Not an import, deliberately:
  see the bundle note below.
- **A boundary rule over every client `.tsx`**, not one hardcoded path. Exactly one file may render
  `<input type="password">`, and no file may bind a password-ish name in `useState`/`useReducer`. A
  parent holding the secret in state is as fatal as the control doing it, and was unenforced.
- **A test on the built browser bundle.** It must contain no `InMemorySecretStore`, no
  `node:crypto`, and no consumption vocabulary — and must be a real bundle, so an empty file cannot
  pass by containing none of them.

### Changed

- **`onRejected` is `(reason: SecretRejectionReason) => void`**, not `(reason: string)`. It feeds a
  turn whose `reason` is the closed union, so a `string` meant the narrowing happened elsewhere, or
  nowhere. An unrecognised reason is now narrowed by *how* it failed: a response that named
  something unknown is a newer server (`client_does_not_support_secure_control`); a response that
  named nothing usable — a 500, a proxy page, an unparseable body — is
  `endpoint_unreachable`.
- **Capabilities are read from the client, at the moment a directive arrives** — a function, like
  `now`, rather than a value fixed at mount. The harness carried them on the directive turn, which
  was always a fiction: a server cannot tell a browser what that browser can do.
- **The browser suites now drive the React client** and read real signals instead of debug globals:
  Playwright's record of network traffic replaced `window.__askimateSent` (which proved only what
  the page *believed* it had sent), the 409 response itself replaced `__askimateChatRefusal`, and
  the rendered rejection replaced `__askimateStatus`.

### Removed

- **`public/chat.html` and `public/secure-control.js` — the vanilla harness, retired.** Kept until
  the React path had full browser-level coverage, then deleted. Two clients implementing the same
  security rules is how F3 happened.

### Fixed — found on the way

- **A flaky assertion in `packages/secrets/src/adversarial.test.ts`.** The clean baseline for this
  phase came up red: `expected 'sh_27c123ffea…' not to contain '123'`. A handle is 32 hex
  characters, and "123" occurs in one somewhere in **0.70%** of draws (measured over 200 000
  samples), so the assertion failed about one run in a hundred and forty on entirely correct code.
  It was also proving nothing — a handle derived by hashing the password would contain "123" no more
  often than a random one — so it was replaced by the property it was groping at: derivation is a
  *function*, so fifty draws for the same password must give fifty distinct handles, and the handle's
  shape must not vary with the password's length.
- **`chat.html`'s composer comment (F9)** claimed the composer was disabled while a password box was
  open and pointed at `chatInputEnabled`, deleted in Phase B. Corrected, then removed with the file.
- **A React state update that was not being flushed.** `react-client.test.tsx` imported `act` from
  React rather than from Testing Library, leaving `IS_REACT_ACT_ENVIRONMENT` unset; every delivery
  printed a warning and the wrapper was doing nothing. The assertions passed anyway, because
  `fireEvent` flushed them a moment later — a green test whose synchronisation is inert.

### Verification

| Deliberate regression | Caught by |
| --- | --- |
| `secret_received` counts as open again | ✅ quarantine |
| The guard matches nothing that is open | ✅ quarantine |
| A rejection closes the request | ✅ react-client + fail-closed |
| The server's reason passes through unnarrowed | ✅ fail-closed |
| The secure control becomes controlled | ✅ build rule |
| A parent holds the password in React state | ✅ build rule |
| A second password input appears in the view | ✅ build rule |
| The composer clears optimistically on send | ✅ react-client + fail-closed |
| Drafts keep reaching storage while a request is open | ✅ react-client + fail-closed |
| The secret store is imported into the client | ✅ fail-closed (bundle) |
| Cancel closes the card without the DELETE | ✅ react-client + fail-closed |
| A settled request still renders a live card | ✅ react-client + end-to-end |
| A refused directive still draws a card | ✅ react-client + fail-closed |
| Any string is accepted as a lifecycle word | ✅ react-client |
| A refused message is appended to history anyway | ✅ react-client |

### Still out of scope, deliberately

No request producer, no directive delivery route, and no conversation-event read/write routes.
`replayEvents` still has no caller in application code. Those are Phase E, and Phase E is blocked on
access to the production AskiMate client — a fact about access, not about the design.

---

## [0.10.0] — 2026-08-28

**Phase C: a refused attempt no longer stalls the conversation, and a refresh no longer leaves a
hole in it.**

**Version bump: MINOR.** New capability, additive. No security boundary moved, no behaviour
weakened.

### Added

- **`secret_rejected` as its own turn kind**, carrying a `SecretRejectionReason` — a code from a
  closed union of twelve literals, never assembled text. The client previously recorded a rejection
  only on a `window` variable and pushed no turn at all, so **the model never learned an attempt had
  failed**: it had no reason to offer another and the run waited for a secret that was never coming.

  A separate kind rather than another `secret_status` because a rejection is **not** a lifecycle
  transition — after a mismatch the request is still `secret_requested`, waiting.

- **A compile-time assertion that the two rejection unions cannot drift.** The endpoint's reasons
  and the transport's reasons live in different files and would silently diverge the first time
  someone added one to the route alone. `Exclude<ServerReason, SecretRejectionReason>` must be
  `never`, so a new server reason fails the build naming itself.

- **`askimate_conversation_events`** — the content-free record that lets a refresh redraw a secure
  step *in its original position*. Stores an ordinal, a kind, a request id, and a lifecycle word or
  reason code. **Nothing renderable is stored**: the prompt is reconstructed at read time from
  `askimate_secret_requests`.

  `kind`, `lifecycle` and `reason_code` are text columns constrained by **database CHECK
  constraints** to their closed sets, so "just put the message in `reason_code`" fails at the
  `INSERT` rather than at review. `UNIQUE (conversation_id, ordinal)` makes a replayed write a
  no-op rather than a duplicated item.

- **`DELETE /api/askimate/secret/:requestId`** — cancellation. Without it, a student who changes
  their mind is locked out of their own conversation until the TTL expires, because the composer's
  send is blocked and the server refuses ordinary messages while a request is open. No new lifecycle
  word was needed: `secret_expired` already reads *"the TTL passed, **or the student abandoned
  it**"*.

- **`replayEvents`** — rebuilds non-message turns from those rows. Deliberately does **not** restore
  a handle: one from before a restart resolves to nothing, and replaying it would tell the model a
  secret is available when it is not. An event whose request is no longer resolvable is **dropped**
  rather than rendered from a placeholder.

### Changed

- A rejection **does not close the open request**. A mismatch leaves it `secret_requested` on the
  server; treating the rejection as closure would release the composer while a live request is still
  open — exactly the client/server divergence the fail-closed guard exists to catch.

### Deliberate regressions, and whether they were caught

| Regression | Caught |
|---|---|
| Rejection rendered as a fixed sentence instead of the code | ✅ 2 tests |
| Rejection swallowed — no model turn at all (the original stall) | ✅ 2 tests |
| A rejection wrongly closes the open request | ✅ 1 test |
| Replay restores a stale handle | ✅ 1 test |
| Replay invents a prompt instead of dropping the event | ✅ 1 test |
| CHECK constraints dropped from the events table | ✅ 2 tests |
| Cancellation does not discard the secret | ✅ 1 test |
| Cancellation skips the ownership check | ✅ 1 test |
| Client swallows the rejection again | ✅ 2 tests |
| The typed value put on the rejection turn | ✅ 2 tests |
| The rendered note built from the typed value | ✅ 2 tests |
| A new server reason the transport cannot represent | ✅ typecheck |
| Refresh restores the composer draft from browser storage | ✅ 1 test |

### One of my regressions did not fire, and why that mattered

The first attempt at "the note must not carry the typed value" set the note text from
`el("secure-password").value` — and the tests stayed green. Not because they were wrong, but because
the inputs are cleared *before* the note renders, so the value was already gone. The regression was
unfaithful, not the test.

Re-run at points where the value genuinely **is** in scope — put on the turn, and captured in a
closure before clearing — both were caught. Recorded because "the regression passed" is only
evidence when the regression was actually possible.

### A behaviour deliberately left alone

A confirmation mismatch is caught **client-side, before any request is sent**: the box clears, says
so, and stays open. No turn is pushed, and no rejection reaches the model. That is correct — a typo
is not a stall, the student simply retries, and reporting every mistyped character would be noise
the model cannot act on. The stall this phase removes is the **server** rejection, where the box
closes and the attempt is over.

### Still provisional

All UI, copy, layout and interaction detail remains **provisional and unapproved**, including the
wording of the inline rejection note. What is proposed is the mechanism: the sentence is chosen at
render time from a fixed table keyed by the code, and is never carried on the turn.

---

## [0.9.1] — 2026-08-27

**A green local run, a red CI: a constraint checked against the wrong Node version.**

**Version bump: PATCH.** A dependency pin and a new check. No behaviour changed.

### Fixed

- **`jsdom` pinned to `^28`.** `jsdom@30` declares
  `engines.node: "^22.22.2 || ^24.15.0 || >=26.0.0"`, and `.nvmrc` pins `22.20.0`. CI installs the
  `.nvmrc` version, so `pnpm install --frozen-lockfile` refused with `ERR_PNPM_UNSUPPORTED_ENGINE`
  and **both jobs died before a single test ran** — on the commit whose local verification was fully
  green: 56 files, 1108 tests, lint, typecheck and boundaries all passing.

  It passed locally because this development sandbox happens to run Node **22.22.2** — the exact
  minimum jsdom wanted. `engine-strict` is on, so the check did run. It ran against a version the
  project does not target.

  Nothing was skipped and nothing was vacuous. The signal was simply measured against the wrong
  number, which is a failure mode worth naming separately from the others.

### Added

- **`scripts/check-engines.test.ts`** — reads `.nvmrc` and asserts every declared dependency's
  installed `engines.node` accepts it. Checking against the pinned version rather than the running
  one makes the answer the same on every machine, which is exactly what was missing.

  Verified by reinstalling `jsdom@30` and watching it fail with the precise reason.

  It carries three controls, because a checker that silently checks nothing is the failure this
  repository keeps rediscovering:
  1. `.nvmrc` must parse as a version — an empty file would otherwise pass everything.
  2. The workspace walk must find more than fifteen packages — a broken glob would otherwise check
     none.
  3. Fewer than a quarter of dependencies may be unresolvable — the per-package check *skips* what
     it cannot resolve, and a skip reports as a pass.

  Each control was verified by breaking the thing it guards.

### Also

- `semver` and `@types/semver` added as root devDependencies, for the range comparison above.
- `apps/chat-integration/package.json` restored to the repository's compact one-line style for
  `exports` and `scripts`, which `pnpm add` had expanded, and the React specs normalised to caret
  ranges matching every other entry in the file.

---

## [0.9.0] — 2026-08-27

**Phase B continued: the React secure control, transport separation, and four of my own tests that
proved nothing.**

**Version bump: MINOR.** New capability (`SecureControl`), additive. No security boundary moved.

### Added

- **`SecureControl.tsx`** — the secure password control as a React component, **uncontrolled by
  construction**. The inputs own their values; a ref reads them at submit; the two locals in the
  submit handler are the entire lifetime of the password inside the component.
- **`SecureControl.test.tsx`** — walks the React fibre tree (`__reactFiber$…`, hook `memoizedState`,
  `memoizedProps`) for the typed value, deliberately excluding the DOM element's own `value` so it
  can tell "in the DOM" from "in React". Also asserts an error boundary catching a crash captures
  nothing of the password.
- **A boundary rule** in `scripts/check-boundaries.ts`: `useState`/`useReducer`, a `value=` prop, or
  a secret-bearing top-level prop in that file **fails the build**. Tests can be deleted by the same
  commit that breaks the rule; a build rule has to be argued with.
- **Transport-separation tests**: the chat route will not accept a secret submission, the secret
  route will not accept an ordinary message, and neither is reachable at the other's path.
- **A log/telemetry scan** for the guarded chat route, with a **canary test proving the capture
  instrument works** — because a scan over an empty string passes for the wrong reason.

### Fixed

- **ESLint never covered `.tsx`.** Every `files` pattern was `**/*.ts`, which does not match `.tsx`,
  so the new component and its test were outside every rule in the repository — including the
  ambient-clock ban. Widened; linting then found four real problems in the new test.

### Four of my own tests that passed for the wrong reason

Each was found by trying to break it, not by reading it.

1. **`requires authentication before it decides anything`** — sent unauthenticated with *no* open
   request, so the guard was a no-op and the 401 came out either way. **All eight tests passed with
   authentication moved after the guard.** Now opens a request first: auth-first gives 401,
   guard-first would give 409 and tell an unauthenticated caller that a password step is open on
   someone else's conversation.
2. **`has no prop through which a secret could enter or escape`** — used `@ts-expect-error` over
   `void { ...props, password: X }`. Spreading into a discarded object literal gets no
   excess-property check, so all four directives came back **unused**. Replaced with a distributive
   type assertion plus a runtime mirror.
3. **Conversation scoping and expiry** were asserted against the store, not the route. A handler
   that looked up a hardcoded conversation, or passed no clock, would have passed both. Now checked
   through HTTP, both ways.
4. **The guard's placement before the body is read** was a claim in a comment with nothing observing
   it. Now: an open request plus a body with **no** `content` field must still answer 409, not 400.

### The boundary rule was wrong twice before it was right

Worth recording, because a rule that rejects correct code is worse than no rule — it teaches
whoever hits it to weaken the rule rather than the code.

- First version matched file-wide and fired on the **doc comment that explains the hazard**, which
  shows `useState` and `value={…}` as the thing to avoid. Now strips comments before matching.
- Second version matched anywhere inside `SecureControlProps` and fired on the `submit` callback's
  own parameter type, which legitimately carries a password — that function is how the value
  reaches the endpoint. Now anchored to top-level props only.
- It also fails loudly if the interface is renamed, rather than going quietly inert.

### Deliberate regressions, and whether they were caught

| Regression | Caught |
|---|---|
| Password input made controlled (`useState` + `value`) | ✅ 3 tests + build rule |
| A `password` prop added to `SecureControlProps` | ✅ typecheck + build rule |
| `value=` prop on the input | ✅ build rule |
| `SecureControlProps` renamed, rule goes inert | ✅ build rule |
| Guard moved after authentication | ✅ 1 test |
| Route ignores `conversationId` | ✅ 1 test |
| Route ignores expiry | ✅ 1 test |
| Content validated before the guard | ✅ 1 test |
| Chat route falls back to reading `password` as content | ✅ 1 test |
| Refusal echoes the request body | ✅ 4 tests |
| Route logs the refused message | ✅ 1 test |
| Client clears the composer optimistically | ✅ 1 test |

### Dependencies

React 19, react-dom, @testing-library/react, @testing-library/dom and jsdom, all as
**devDependencies of `apps/chat-integration` only**. The component is a research prototype for a
client this repository cannot reach; nothing in the runtime path depends on React.

### Still provisional

The component's markup and copy are **placeholders and not approved**. What is proposed is the data
shape and the state discipline — where the value lives, what leaves the component, and what cannot.
A visual redesign should be able to replace every element in the returned tree without touching any
of it.

---

## [0.8.0] — 2026-08-27

**Phase B: the composer stays live, nothing is destroyed, and the guard cannot fail open.**

**Version bump: MINOR.** New capability and a changed public surface
(`chatInputEnabled` → `composerPolicy`, `SecretBindingStore.find` → `findSync` + `openRequestFor`).
Additive for behaviour the student sees; nothing existing was weakened.

### Added

- **`composerPolicy`** replaces `chatInputEnabled`. `typing` is the literal `"live"` rather than a
  boolean, so "disable the composer" is not a value the function can return — reinstating the modal
  freeze requires editing the type, in a diff a reviewer would see.
- **`SecretBindingStore.openRequestFor`** — authoritative, asynchronous, reads the database.
- **`createChatRoutes`** — the ordinary message endpoint with the fail-closed guard, checked
  *before* the message is read for any purpose, so the text never enters scope on the refused path.
- **`scripts/ci-guard.test.ts`** — see **CI** below.

### Changed

- **`find` → `findSync`**, and the port now names two lookups **split by what happens when they are
  wrong**. A cache miss on the secret route means "refuse", which fails closed. The same miss in the
  quarantine guard would mean "nothing is open", which fails **open** — the message path left
  available at the moment a student is most likely to type a password into it. Same data, same
  staleness, opposite consequence, so the types say so.
- **The composer accepts typing while a secure request is open; only the send is inert.** No bytes
  leave the browser, and the draft stays exactly where the student put it.
- **The draft is never auto-sent.** Releasing a buffer when the card closes would transmit a
  password typed into the wrong box, turning a contained accident into a persisted one.
- **The composer clears on acknowledgement, never optimistically**, so a fail-closed refusal
  restores the draft instead of destroying it.
- **Draft persistence to browser storage is suspended** while a request is open.

### Fixed

- **`openRequestFor` had no `ORDER BY`** and returned an arbitrary row when a conversation had more
  than one open request. For "is anything open?" any row would do — but the `requestId` travels back
  to a stale client, which uses it to render the card the student is looking at. Found by a test
  that named the request it had just opened and got a different one back.
- **CI had never passed. Forty-seven runs, forty-seven failures.** Two independent causes, both now
  fixed — see below.

### Security

- **`AAS_DISCOVERY_DRY_RUN` was set by a test and read by nothing.** The comment beside it said "no
  network, so navigation will fail — which is fine", which was true only of the sandboxed
  development machine. GitHub Actions has open network, so on **every push** three tests launched a
  real browser and crawled `qahighereducation.com` and `ulster.ac.uk` — live university sites —
  until each hit its sixty-second timeout.

  This is the more serious half of the CI failure. The standing rule is that nothing runs against a
  real university site without an explicit safe target and Vahid's go-ahead, and a test suite had
  been doing it unattended since the workflow was added. The flag is now real: the CLI resolves the
  target, prints its details, and stops before any browser exists. Every one of those tests now also
  asserts `"No pages fetched."`, so a regression that re-enables the crawl fails here rather than
  quietly reaching the internet again.

### CI

- **The integration job now runs the whole suite** instead of three named directories. A list goes
  stale: a database-backed suite added anywhere else would never have run, and the job would have
  stayed green while covering less.
- **`scripts/ci-guard.test.ts` asserts the workflow still does its job** — from the ordinary
  no-database test path. Delete the integration job, drop `AAS_REQUIRE_DATABASE=1`, or narrow it
  back to a path list, and the default test run goes red.
- The suite-level check **executes** the property rather than grepping for it: each database-backed
  suite is run in its own subprocess against a closed port and must exit non-zero on its own.

### Deliberate regressions, and whether they were caught

| Regression | Caught |
|---|---|
| `openRequestFor` reads the process cache instead of the database | ✅ 3 tests |
| Guard removed from the chat route | ✅ 4 tests |
| Composer send not blocked | ✅ 1 test |
| Draft auto-sent when the card closes | ✅ 1 test |
| Draft persistence not suspended | ✅ 1 test |
| `ORDER BY` removed from `openRequestFor` | ✅ 1 test |
| `AAS_REQUIRE_DATABASE` dropped from CI | ✅ 1 test |
| Integration job narrowed to a path list | ✅ 1 test |
| Resolve-only guard removed from the CLI | ✅ 1 test |
| A database-backed suite skips silently under `AAS_REQUIRE_DATABASE=1` | ✅ 1 test each |

### Two of my own tests passed for the wrong reason

Both are recorded because they are the same mistake wearing different clothes.

The CI guard first asserted each database-backed file **contained the string** `"announceSkip"`. It
went red on two files that were entirely correct, because `packages/case-store` inlines the same
throw-if-required logic instead of importing the helper. It was checking a MECHANISM when the
property is behavioural — and a text match would equally have passed on the word inside a comment.

The replacement ran all four suites in **one** subprocess and asserted a non-zero exit. That passed
while a suite skipped silently, because the other three still threw and the aggregate exit code hid
it. Now one subprocess per suite, each of which must fail on its own — verified by making each
suite skip in turn.

### Still provisional

All UI, copy, layout and interaction detail remains **provisional and unapproved**. The harness page
carries a banner saying so. Every assertion added here tests structure, transport or state — never
appearance.

### Residual risk, unchanged

A student can still type their password into the composer and deliberately press Send. Autofocus, an
inert send button and the visible draft reduce the likelihood; none eliminates it, and password
detection is explicitly not used because it cannot work.

---

## [0.7.0] — 2026-08-27

**Phase A of the inline secure turn: the password request takes its real place in the
conversation.**

**Version bump: MINOR.** New capability, additive. The security model is unchanged — no boundary
moved, no new data path opened.

### Added

- **`projectTranscript`** (`apps/chat-integration/src/transcript.ts`) — turns the `ChatTurn` list
  into an ordered list of things to draw, **dropping nothing**. The absence of a `continue` in that
  function is the entire fix: the prototype rendered `if (turn.kind !== "message") continue`, which
  removed the secure request from the conversation and pushed it into a detached panel below the
  composer.
- **`openSecureRequest`** — whether a request is open, *derived from the transcript* rather than
  tracked separately. A tracked boolean is a second source of truth, and the thing it gates is the
  composer, where drifting *open* means an enabled send button beside a password box. This is the
  client's view of what to draw; it is **not** a security control, and the server does not trust it.
- **`NO_FREE_TEXT_OUTSIDE_MESSAGES`** — a compile-time assertion that no transcript item except a
  message may carry free text.

### Changed

- The provisional harness renders directives and statuses **inline, in sequence**, and the secure
  card is *moved into* the transcript rather than living beside it.
- Rendering is now **append-only**. The previous implementation began every render with
  `innerHTML = ""`, which — once the card lives inside the transcript — would tear it out of the DOM
  whenever any unrelated turn arrived, discarding whatever the student had typed.

### Fixed

- **The browser-driven tests had silently stopped testing anything.** `NOW` was the literal
  `2026-08-27T10:00:00Z` while the browser reads its own clock (`secure-control.js` must, since a
  page has no clock to inject). With a 300-second TTL, every prompt was judged expired from
  10:05 UTC onwards and the control refused to render. **Seven tests — including "runs all ten
  steps and leaks the marker nowhere" and "survives a page refresh" — failed for that one reason**,
  reported as six unrelated-looking 30-second `locator.fill` timeouts naming an invisible element
  rather than why it was invisible.

  The clock is now anchored to the real one, and `deliver()` carries a guard that turns a refusal
  under full capabilities into an immediate, named harness fault. These tests are not in the default
  `pnpm run test` path — they need PostgreSQL — so nothing went red until the suite was run against
  a real database.

### Correction to the previous entry

The audit said the secret channel is *"wired to nothing"*. That was too strong. The **orchestrator
already emits `RunStep { kind: "request_secret" }` deterministically** — the decision logic is
integrated. What is missing is the store instantiation, the transport and the UI.

### Deliberate regressions, and whether they were caught

| Regression | Caught |
|---|---|
| Reinstate the `continue` that skipped non-message turns | ✅ 8 tests |
| Append controls at the end instead of in place | ✅ 3 tests |
| Interpolate the portal host into the model's directive sentence | ✅ 1 test |
| `content` field on `secure_control` only | ✅ typecheck + 1 test |
| `content` field on `secret_status` only | ✅ typecheck |
| `openSecureRequest` stops closing on a status | ✅ 1 test |
| Revert to `innerHTML = ""` rendering | ✅ 1 test |
| Stop moving the card into the transcript | ✅ 2 tests |
| Password input inside the composer's form | ✅ 1 test |
| `name` attribute on the password input | ✅ 1 test |

The first attempt at the type-level guard was **vacuous**: an `@ts-expect-error` on `item.content`
over the narrowed union only trips if *every* non-message variant grows a free-text field at once,
because `keyof` over a union is the intersection of its members' keys. The realistic mistake is one
variant, in one commit. Replaced with a distributive `ContentBearing<T>` and an `AssertNever`, which
catches either variant alone.

### Not done, deliberately

The composer is still hard-disabled while a card is open. Replacing that with the approved
prevention/containment/fail-closed model is Phase B. **All UI, copy and layout in the harness is
provisional** and carries a banner saying so.

### Internal — documentation carried into this release

These landed as documentation-only commits before 0.7.0 and were correctly not versioned at the
time under [ADR-0028](./docs/decisions/0028-versioning-policy.md) §3. They are recorded here
because 0.7.0 is the first release that follows them.

- **Password flow audit and plan** — `docs/password-flow-audit.md`. **Nothing implemented.**

  Principal finding: every secret-channel component exists and is well tested in isolation, and
  **none of them is wired to anything**. The store is instantiated in no product code; `fillSecret`
  is called only by its own test; `ApplicationSession` has no secret capability.

  Two corrections to the working assumptions: **`storageState` session handoff does not exist** (it
  appears once, as a leak-scan test artefact), and **the model cannot request a credential** — the
  orchestrator decides deterministically, which is stronger than the stated requirement and is
  flagged for a decision rather than changed.

- **The inline secure turn** — `docs/inline-secure-turn-architecture.md`. The finding that
  `ChatTurn` already separates the conversational layer from the secure interaction layer, and that
  the prototype re-joined them at render time.

- **The composer during a secure turn** — `docs/composer-during-secure-turn.md`. Prevention,
  containment and fail-closed as three layers, with server-side quarantine demoted from primary
  mechanism to last line.

---

## [0.6.0] — 2026-08-27

**Phase 4 of durable execution: a consequential action happens at most once — or we admit we cannot
tell.**

**Version bump: MINOR.** New capability, additive. Nothing existing changed.

### Added

- **`performOnce`** — the two-phase intent record. Look for an existing intent, record the new one
  *durably before acting*, act, record the completion *durably after*. A crash between steps 2 and
  4 is the uncertainty window, and it is detectable precisely because step 2 happened.
- **`VerificationResult`** with three cases, not two. `unknown_still` is the honest answer when a
  portal is down or the evidence is ambiguous, and it is **never collapsed into `did_not_happen`** —
  that collapse is exactly what creates a second university account for a student who already has
  one.
- **`recordCleanFailure`** — for failures that provably never left this process. A network timeout
  is explicitly *not* one: a request that timed out may have been received and acted upon.
- **Two end-to-end restart tests against real PostgreSQL**: an account is created exactly once
  across three separate processes with three separate connection pools, and an unverifiable action
  escalates across a restart without ever running twice.

### Security

- **There is no code path that retries an unverifiable consequential action.** `assessIntent` has
  no `retry` verdict and `performOnce` has no branch that reaches `perform()` from an escalation.
  Both are tested by enumeration, because an absence needs a test or it is just a thing nobody has
  done yet.
- **A verifiable action with no verifier escalates** rather than assuming. An action the domain
  says cannot be checked is not made checkable by an optimistic caller.
- **`failed_cleanly` is not retried.** A cleanly failed action still ran; running it again is a
  second attempt nobody decided to make.

### Deliberate regressions, and whether they were caught

| Regression | Caught |
|---|---|
| `unknown_still` collapsed into "did not happen" | ✅ 2 tests |
| Intent recorded *after* the action instead of before | ✅ 1 test |
| Unverifiable action retried instead of escalated | ✅ 2 tests |
| `failed_cleanly` retried | ✅ 1 test |
| Missing verifier treated as "did not happen" | ✅ 1 test + typecheck |

**A test that passed for the wrong reason, found and fixed.** The "never performs twice"
enumeration originally started from a *clean* run: perform once, then retry five times. Every retry
hit `already_done` and returned immediately, so the verify branch was never exercised — and the
`unknown_still` regression, which is the whole point of this phase, was caught by exactly one other
test. It now starts from the state a crash actually leaves: an intent written, no completion. With
that change the regression fails 2 tests instead of 1.

### Known limitations

- The three crash windows cannot be reduced to two. A process can always die between an external
  success and our recording of it, and no design closes that gap — this makes it **detectable**,
  which is the most any system can do.
- `RunState.profile` reconstruction remains **explicitly open** (Phase 5, not implemented).

---

## [0.5.0] — 2026-08-27

**Phase 3 of durable execution: the orchestrator checkpoints, and `assess`/`nextStep` stay pure.**

**Version bump: MINOR, not MAJOR.** `RunState.run` is **optional**, so every existing caller still
compiles and a run that does not need to survive a restart passes no store and carries no position.
Making it required would have been MAJOR for no gain.

### Added

- **`packages/orchestrator/src/durable.ts`** — `startRun`, `resumeRun`, `checkpointAfter`,
  `deriveCheckpoint`, `phaseFor`, `mayContinue`.
- **`RunState.run?`** — `runId`, `revision`, `checkpoint`. Position only.
- **A genuine process-restart test against real PostgreSQL.** Process A opens a case, starts a run,
  records an authorisation in the event log, checkpoints two filled fields, then **closes its pool
  — every socket and server-side session gone**. Process B opens its own pool, knowing only the
  `runId`, and resumes at exactly `filling` with both fields.

### Architecture

- **Persistence wraps the decision functions; it does not enter them.** `assess` and `nextStep` are
  untouched and still pure, which is why the orchestrator's tests run without a browser or a
  database.
- **The event log wins every disagreement.** A checkpoint claiming the run reached `filling` with no
  `AuthorisationCaptured` in the log describes a position that never legitimately existed — nothing
  may be filled before the student authorises the exact content — so it is discarded and the run
  re-derives. Same for a checkpoint written against a different blueprint revision.
- **`deriveCheckpoint` copies nothing from a step but its kind.** A `contentHash` is tempting and is
  a business fact that already lives in `AuthorisationCaptured`; two copies is two sources of truth.
- **An `uncertain` or `escalated` run does not continue automatically.** A run that may have created
  a portal account is not something to carry on with because the code path happens to be open.
- **`pg` is a devDependency of the orchestrator and must stay one** — enforced by a new boundary
  check. The orchestrator reaches storage only through ports; a runtime driver would let a query be
  written inside a decision function.

### Known limitations

- **`RunState.profile` is still not reconstructible from the event log**, because
  `ConfirmationCaptured` carries a reference and not a value. `resumeRun` therefore returns the run
  and its events and does **not** rebuild `RunState`; the caller still supplies the profile. This
  is **Phase 5 and remains explicitly open** — closing it here would have meant copying profile data
  into either the log or a checkpoint, which the architecture forbids.

### Deliberate regressions, and whether they were caught

| Regression | Caught |
|---|---|
| `checkpointAfter` saves nothing | ✅ 4 tests, incl. both restart tests |
| Reconciliation dropped — checkpoint always trusted | ✅ 2 tests |
| Blueprint-version check dropped | ✅ 1 test |
| `mayContinue` lets an `uncertain` run carry on | ✅ 1 test |
| `deriveCheckpoint` copies a `contentHash` into `detail` | ✅ 1 test |

---

## [0.4.0] — 2026-08-27

**Phase 2 of durable execution: the `WorkflowRunStore`.**

**Version bump: MINOR.** A new port with two implementations, additive. `CaseStore` is untouched —
its append-only guarantees are neither weakened nor extended.

### Added

- **`WorkflowRunStore`** — a **separate** port from `CaseStore`, as approved. `CaseStore` is
  append-only and holds business truth; a checkpoint is mutable and disposable. Forcing one into
  the other would mean either putting execution detail into the business record, or adding an
  update path to an append-only log.
- **`InMemoryWorkflowRunStore`** and **`PostgresWorkflowRunStore`**, both passing the same
  `runWorkflowStoreContract` suite.
- **Migration `0002_workflow_runs.sql`** — `workflow_runs`, `workflow_action_intents`. The
  guarantees are constraints: `PRIMARY KEY (run_id)`,
  `PRIMARY KEY (run_id, idempotency_key)`, a conditional revision UPDATE, and
  `CHECK ((outcome IS NULL) = (completed_at IS NULL))` so a half-written completion cannot exist.
- **`discardCheckpoints`** — the only destructive operation, and the one the contract uses to prove
  rule 3.

### Fixed

- **A corrupt checkpoint crashed `load()` instead of being discarded.** `decodeEvent` is built for
  events, which are always objects, and calls `JSON.parse` on a string input; a JSONB column
  holding the scalar `"a string"` comes back from `pg` as a JS string and parsing it throws.
  Found by the corrupt-checkpoint test, which is why it exists. `decodeEvent` still throws — an
  unreadable *event* means business truth is corrupt and a crash is right — and the workflow store
  absorbs it, because an unreadable *checkpoint* is routine.
- **`ActionIdempotencyKey`** renamed from `IdempotencyKey`. The domain already had an
  `IdempotencyKey` for submissions; two concepts sharing a name is how someone eventually passes
  the wrong one.

### Security

- **Losing every checkpoint loses no business fact** — the executable form of rule 3, in the shared
  contract. After `discardCheckpoints`, the run still knows its case, its student and when it
  started; only position is gone, and position is re-derivable.
- **Intents are NOT discarded with checkpoints.** They are evidence that a consequential action may
  have happened; throwing one away turns a detectable uncertainty into a silent repeat.
- **Every loser of a concurrent resume gets `RunConcurrencyError`**, not a raw driver error — the
  C1 lesson, where a transient-looking error invited exactly the retry that must not happen. Tested
  with eight concurrent resumes, because two can pass by luck.

### Deliberate regressions, and whether they were caught

| Regression | Caught |
|---|---|
| Revision check dropped — two resumes both win | ✅ 3 tests |
| `discardCheckpoints` also deletes intents | ✅ 1 test |
| Unreadable checkpoint trusted instead of discarded | ✅ 2 tests |
| The completion `CHECK` constraint removed | ✅ 1 test |

### Known limitations

- The orchestrator does not use this yet. That is Phase 3.
- `RunState.profile` reconstruction remains **explicitly open** (Phase 5, not implemented).

---

## [0.3.0] — 2026-08-27

**Phase 1 of durable execution: the run model.**

**Version bump: MINOR.** New backward-compatible domain vocabulary. Nothing existing changed;
`ExecutionCheckpoint` is reused unmodified.

### Added

- **`packages/domain/src/workflow.ts`** — `RunId`, `WorkflowPhase`, `WorkflowStatus`,
  `WorkflowCheckpoint`, `WorkflowRunRecord`, `ActionIntent`, `ConsequentialAction`,
  `IntentVerdict`, and `assessIntent`.
- **`WorkflowCheckpoint` composes the EXISTING `ExecutionCheckpoint`** rather than replacing it.
  The existing type models position inside the *portal*; the new one adds position inside the
  *workflow*. Two axes, both needed to resume.
- **`assessIntent` has no branch that means "retry".** Its absence is the safety property, and a
  test enumerates every verdict to prove no `retry` appears.
- **`fieldsCompleted: readonly string[]`** — field *refs*, never values. Replaces the
  `filled?: boolean` that recorded a run dying after 40 of 60 fields identically to one dying
  after none.

### Security

- **Rule 3 is enforced structurally, not by discipline.** `CheckpointValue` admits only
  `string | number | boolean | null`, so a `ConfirmedValue`, a document, a profile entry, a secret
  handle or a nested object cannot enter a checkpoint. Five `@ts-expect-error` tests assert each.
- **`scripts/check-boundaries.ts` guards the definition itself.** Following the ADR-0004 lesson
  that a type cannot defend itself against the code that defines it, the check parses
  `CheckpointValue`'s declaration and fails if it is widened, and fails if `workflow.ts` so much as
  *names* `ConfirmedValue`, `PreviewDocument`, `SecretHandle` or `ConfirmedProfile`.
- **`uncertain` cannot become `completed`.** "We do not know whether the account was created"
  cannot become "it worked" without verification (→ `running`) or a human (→ `escalated`).
- **A checkpoint with an unrecognised schema version is discarded, never guessed at** — in either
  direction, past or future.

### Deliberate regressions, and whether they were caught

| Regression | Caught |
|---|---|
| `CheckpointValue` widened to `unknown` | ✅ boundary check **and** 4 unused `@ts-expect-error` directives |
| `assessIntent` returns `verify_first` for unverifiable actions | ✅ 2 tests |
| `uncertain → completed` allowed | ✅ 1 test |
| Schema-version check removed | ✅ 1 test |

### Known limitations

- Nothing persists a checkpoint yet. That is Phase 2.
- `RunState.profile` reconstruction remains **explicitly open** (Phase 5, not implemented).

---

## [0.2.1] — 2026-08-27

**A safety claim that was wrong, and the enforcement that makes it true.**

**Version bump: PATCH.** A security fix with no API change, plus the documentation correction that
goes with it — [ADR-0028](./docs/decisions/0028-versioning-policy.md) §3 makes a doc change that
corrects a *wrong safety claim* a PATCH rather than unversioned, because the claim was part of the
product's contract.

### Security

- **ADR-0004's guarantee had a hole.** `values.test.ts` claimed that *"if someone ever adds a
  conversion path from `ModelText` to `ConfirmedValue`… the build fails."* Measured: adding

  ```ts
  export function trustTheModel<T>(t: ModelText): ConfirmedValue<T> {
    return t as unknown as ConfirmedValue<T>;
  }
  ```

  to `packages/domain` **compiled cleanly and failed no test.** The `@ts-expect-error` directives
  test one illegal *assignment*; a conversion *function* casting through `unknown` leaves that
  assignment just as illegal, so the directives stay used and the build stays green.

  **A brand cannot defend itself against a cast.** `scripts/check-boundaries.ts` now fails the
  build if any non-test file outside `packages/profile` casts to `ConfirmedValue` — plain,
  qualified (`Domain.ConfirmedValue`), or dynamic-import
  (`import("@askimate/aas-domain").ConfirmedValue`). All three forms were tested against the check.
  The first version of the rule caught only the plain form and a qualified cast walked past it.

### Fixed

- The header of `values.test.ts` and ADR-0004 now state what the directives actually prove, and
  name the boundary check as the other half. Neither half is sufficient alone.

### Internal

- **Safety regression audit** — five core guarantees deliberately weakened to confirm the tests
  fail. Recorded in `docs/safety-regression-audit.md`.
- **Roadmap and priority analysis** — `docs/roadmap-and-priorities.md`. **C2 is not the next item**;
  the recommendation and the one architectural decision it needs are in §7, awaiting Vahid.

---

## Release state — read before trusting a tag

| Version | Tag object | On the remote? |
|---|---|---|
| `0.6.0` | `v0.6.0` → the `0.6.0` commit | **NO** |
| `0.5.0` | `v0.5.0` → `6dd0500` | **NO** |
| `0.4.0` | `v0.4.0` → `441dd66` | **NO** |
| `0.3.0` | `v0.3.0` → `c59459d` | **NO** |
| `0.2.1` | `v0.2.1` → `fb69b68` | **NO** |
| `0.2.0` | `v0.2.0` → `d39ddb1` | **NO** |
| `0.1.0` | `v0.1.0` → `11629f4` (commit `d985ec4`) | **NO** |

`git push origin refs/tags/v0.1.0` returns **HTTP 403**: this session's
credential can write branch refs but not tag refs. A branch push to the same
remote succeeded seconds earlier, so this is a permission on tags specifically.

**The repository therefore has no published release.** The tag objects exist
locally and must be pushed as the *same objects* once a credential with tag
permission is available — never re-created at a different commit, which is the
state that produces arguments about which `v0.1.0` is real. See
[ADR-0029 §7](./docs/decisions/0029-git-workflow.md) for the reconciliation
order.

---

## [0.2.0] — 2026-08-27

A case now survives the process that created it.

### Internal

Governance work that does not earn a version under
[ADR-0028](./docs/decisions/0028-versioning-policy.md) §3, recorded here so it
stays traceable.

- **Versioning policy formalised** — ADR-0028 defines what earns a release and
  what is tracked by commit only, with explicit rules and exceptions for
  documentation-only, test-only, refactoring, research-only and tooling-only
  changes.
- **Git workflow proposed** — ADR-0029. **Status: Proposed. Awaiting Vahid.
  Nothing has been done — no branch created, no default changed, no tag moved.**
- **Baseline reviewed** — `docs/versioning-baseline-review.md`. `0.1.0` and the
  locked single-version strategy both stand; five conditions named that would
  require independent per-package versioning.
- **Replit dependency map** — `docs/replit-dependency-map.md`. Three items are
  genuinely blocked by the missing production access; everything else continues.
- **`apps/chat-integration` relabelled** as a research build against the
  2026-06-18 archive, in its README and its `index.ts` header.

**Version bump: MINOR.** New backward-compatible capability — a second
implementation behind an existing port. The in-memory store is unchanged and
still passes the same contract; no consumer must change anything.

### Added

- **`PostgresCaseStore`** (`@askimate/aas-case-store/postgres`) — passes the
  identical `runCaseStoreContract` suite as the in-memory store, which is the
  whole reason that suite exists. The guarantees live in constraints rather
  than in application code: `PRIMARY KEY (case_id, "sequence")` is what makes
  two concurrent writers resolve to exactly one winner, and
  `PRIMARY KEY (submission_key)` is the second line of defence against
  duplicate submission. Application-level check-then-write races by
  construction; a unique index does not.
- **Versioned migrations** (`packages/case-store/migrations/`) with a runner —
  forward-only, applied in order, each in its own transaction, per
  [ADR-0003](./docs/decisions/0003-versioned-migrations-not-push-force.md). An
  applied migration's SHA-256 is recorded, so a file edited after it ran fails
  the next run rather than silently doing nothing in every environment where it
  already applied.
- **Tagged date serialisation** — an event's `Date` fields survive storage as
  `Date`, not as strings.
- **Integration CI job enabled.** It had been sitting behind `if: false`
  awaiting exactly this adapter. It runs both database-backed suites with
  `AAS_REQUIRE_DATABASE=1`, so a broken Postgres service fails the run instead
  of reporting green while checking nothing.

### Fixed

- `pnpm run verify:integration` now covers `packages/case-store` as well as
  `apps/chat-integration`.

### Known limitations

- The orchestrator is not yet wired to the Postgres store; it still takes a
  `CaseStore` and is given the in-memory one by the demo scripts. Swapping it is
  a separate change.
- Nothing is deployed. This version marks a state of the source.

---

## [0.1.0] — 2026-08-27

**The first versioned state.** Before this, all eighteen manifests said `0.0.0`, there were no git
tags, no changelog and no release tooling.

This entry is deliberately *not* a reconstructed release history. Everything under **Added** below
already existed in the repository when versioning was introduced; it is listed so that `0.1.0`
names a real, verified state rather than an empty one. What is dated to today is the versioning
mechanism itself.

### Added

- **Versioning mechanism** (today). `scripts/version.ts` with `version:check`, `version:set` and
  `version:bump`; the root `package.json` as the authoritative source; a drift check wired into
  `pnpm run verify`; this changelog; and ADR-0027 recording the choice.

The state this version names, all of which predates the mechanism:

- **Domain core** (`packages/domain`) — branded `ConfirmedValue`, case state machine, event log,
  tasks, retention, minors, requirements, escalation, redaction, audit.
- **Capabilities** — profile, interview, extraction, mapping, preparation, blueprint, disclosure,
  documents, account, requirements, orchestrator, case store, LLM port with a Bedrock adapter.
- **Browser runtime** (`apps/browser-runner`) — read-only discovery that cannot submit (ADR-0014),
  controlled Salesforce-rendering inspection with four hard boundaries (ADR-0024), an LWC-aware
  observation layer, and a sensitive fill session on which tracing and video are structurally
  unavailable (ADR-0025).
- **Model-blind secret channel** (`packages/secrets`) — `SecretHandle`, `useSecret` with no
  getter, single-use destruction before the callback runs, five binding checks, and the four
  lifecycle words (ADR-0026).
- **Chat integration research build** (`apps/chat-integration`) — a secure endpoint, secure
  control and fail-closed render decision, built against the **archived** AskiMate codebase.
  See the Security note below.
- **27 architecture decision records**, and a verification suite of 885 tests plus 31 integration
  tests that require a real PostgreSQL.

### Security

- Personal data can no longer reach a Playwright trace, a video or a log. Playwright writes typed
  values verbatim into `trace.trace`, and stopping tracing around a fill does not prevent it — the
  action is buffered and replayed into the next trace file. A sensitive context therefore never has
  tracing at all, and `tracing.start` throws on it (ADR-0025).
- `tracingIsForbidden` used to answer its question by **calling** `tracing.start()`, which on an
  ordinary context started tracing — a check meant to detect the leak mechanism was switching it
  on. It now reads a module-private mark and touches nothing.
- `fillSecret` relied on a Playwright locator returning null for a missing field. Locators are
  lazy, so a bad selector spent the student's single-use password and then timed out. Field
  existence is now established before the secret is spent.
- `scrubParseErrorBody` removes the raw request body that `body-parser` attaches to a JSON parse
  error as `err.body`. Measured on Express 5 + body-parser 2.3.0: `err.message` and the default
  handler do **not** carry the body, but `JSON.stringify(err)` emits it in full — which is exactly
  what a structured logger does to a caught error.
- The audit system accepts only `AuditSafeText`, so a runtime string carrying personal data cannot
  enter it under an innocuous key.
- A `SubmissionPreview` throws on serialisation rather than silently JSON-encoding a student's
  application into a log or an event.

### Known limitations

- **`apps/chat-integration` is research, not production integration.** It was built against
  `archive/askimate/` in `vaahiiid/Universitio`, which is the AskiMate codebase as of 2026-06-18.
  The current production source for askimate.com is not accessible from this repository — see
  `docs/production-repository-audit.md`. No claim about production security is supported by it.
- Nothing here has touched a live university portal. No account created, no registration, no live
  fill, nothing submitted.
- The default password delivery remains `student_types_into_portal`, where AskiMate holds no
  secret at all.

[Unreleased]: https://github.com/vaahiiid/askimate_auto_apply/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/vaahiiid/askimate_auto_apply/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/vaahiiid/askimate_auto_apply/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/vaahiiid/askimate_auto_apply/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/vaahiiid/askimate_auto_apply/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/vaahiiid/askimate_auto_apply/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/vaahiiid/askimate_auto_apply/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/vaahiiid/askimate_auto_apply/releases/tag/v0.1.0
