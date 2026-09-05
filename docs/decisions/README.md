# Decision Record

Per master brief §12.8: *"Maintain a decision record. Confirmed architectural, technical and
product decisions must not be quietly reversed later."*

This continues a practice that already exists in the Universitio repository as
`.agents/memory/` — formalised here as numbered ADRs.

## Status vocabulary

Brief §12.9 requires a clear distinction between implemented, planned, assumed and confirmed.
ADR status uses exactly that vocabulary:

| Status | Meaning |
|---|---|
| **Proposed** | Written up and recommended. **Not agreed by Vahid.** Must not be treated as settled. |
| **Accepted** | Vahid approved it. Binding — reversing it requires a new ADR that supersedes this one. |
| **Superseded** | Replaced. The replacing ADR is named. The record is never deleted. |
| **Rejected** | Considered and declined. Kept so the reasoning is not re-litigated. |

## Index

| ADR | Title | Status |
|---|---|---|
| [0001](./0001-integration-via-https-api-and-signed-webhooks.md) | Integration via HTTPS API + signed webhooks | Proposed |
| [0002](./0002-aas-owns-the-confirmed-profile.md) | AAS is the system of record for the confirmed profile | Proposed |
| [0003](./0003-versioned-migrations-not-push-force.md) | Versioned migrations, not `drizzle-kit push --force` | Proposed |
| [0004](./0004-branded-types-for-confirmed-values.md) | Branded types make model output unable to reach a form field | Proposed |
| [0005](./0005-contract-first-openapi.md) | Contract-first OpenAPI at the AskiMate↔AAS boundary | Accepted |
| [0006](./0006-reapplication-requires-explicit-student-instruction.md) | Re-application requires an explicit student instruction | Accepted |
| [0007](./0007-agent-led-conversational-intake.md) | Agent-led conversational intake — the student never fills in a form | Accepted |
| [0008](./0008-recovery-first-escalation-and-the-learning-loop.md) | Recovery-first escalation, and the learning loop | Accepted |
| [0009](./0009-requirements-provenance-and-verification.md) | Requirements provenance and multi-source verification | Accepted |
| [0010](./0010-policy-driven-document-retention.md) | Policy-driven document retention, with no default | Accepted |
| [0011](./0011-minor-detection-and-the-minor-workflow.md) | Identity check, minor detection, and the minor workflow | Accepted |
| [0012](./0012-aws-region-eu-west-2.md) | AWS region — eu-west-2 (London) | Accepted |
| [0013](./0013-minor-is-not-a-blocker.md) | Minor is not a blocker; minor conditions are stage-scoped | Accepted |
| [0014](./0014-discovery-cannot-submit.md) | Discovery is structurally incapable of submitting | Accepted |
| [0015](./0015-interview-is-a-capability-of-askimate-chat.md) | The interview is a capability of AskiMate Chat, not a new interface | Accepted |
| [0016](./0016-extraction-must-quote-the-document.md) | An extracted value must quote the document, or it is discarded | Accepted |
| [0017](./0017-mapping-is-reviewed-data.md) | Field mapping is reviewed data, and format rules are data too | Accepted |
| [0018](./0018-amazon-bedrock-as-the-model-provider.md) | Amazon Bedrock is the model provider, and no model is named yet | Accepted |
| [0019](./0019-requirements-curation-ownership.md) | A human specialist curates requirements, through the AskiMate knowledge workflow | Accepted |
| [0020](./0020-the-account-belongs-to-the-student.md) | The account belongs to the student, and control is handed back | Accepted |
| [0021](./0021-application-requirements-are-not-visa-requirements.md) | University application requirements are not Student visa requirements | Accepted |
| [0022](./0022-a-document-in-the-vault-is-not-permission-to-send-it.md) | A document in the vault is not permission to send it | Accepted |
| [0023](./0023-retention-periods-are-determined-not-invented.md) | Retention periods are determined from a source, or recorded as unresolved | Accepted |
| [0024](./0024-controlled-inspection-mode.md) | Controlled Salesforce-rendering inspection, with four hard boundaries | Accepted |
| [0025](./0025-sensitive-data-never-reaches-a-trace.md) | A fill session is never traced, recorded, or asked to remember a value | Accepted |
| [0026](./0026-a-password-the-model-can-ask-for-and-never-see.md) | A password the model can ask for and never see | Accepted |
| [0027](./0027-one-version-for-the-whole-repository.md) | One version for the whole repository, and a changelog that does not invent history | Accepted |
| [0028](./0028-versioning-policy.md) | Versioning policy: what counts as a release, and what does not | Accepted |
| [0029](./0029-git-workflow.md) | Git workflow, branches and releases | Accepted |
| [0030](./0030-the-secure-control-runs-on-its-own-origin.md) | The secure control runs on its own origin | Accepted |
| [0031](./0031-one-conversation-event-log.md) | One append-only conversation event log | Accepted |
| [0032](./0032-cancellation-is-its-own-lifecycle.md) | Cancellation is its own lifecycle | Accepted |
| [0033](./0033-sessions-are-httponly-cookies.md) | Sessions are `HttpOnly` cookies | Accepted |
| [0034](./0034-the-vault-is-ephemeral.md) | The vault is ephemeral, encrypted, shared by ciphertext | Accepted |
| [0035](./0035-event-delivery-is-resumable-sse.md) | Event delivery is resumable SSE over the log | Accepted |
| [0036](./0036-no-third-party-scripts-on-authenticated-surfaces.md) | No third-party scripts on authenticated surfaces | Accepted |
| [0037](./0037-service-topology-and-deployment.md) | Service topology, network boundaries, deployment | Accepted |
| [0038](./0038-identity-is-delegated-to-a-managed-oidc-provider.md) | Identity is delegated to a managed OIDC provider | Accepted |
| [0039](./0039-repository-structure-for-the-independent-product.md) | Repository structure for the independent product | Accepted |
| [0040](./0040-the-wire-contract-is-its-own-package.md) | The wire contract is its own package | Accepted |
| [0041](./0041-one-implementation-of-each-conversation-decision.md) | One implementation of each conversation decision | Accepted |
| [0042](./0042-the-credential-is-consumed-inside-the-secure-plane.md) | The credential is consumed inside the Secure Plane, not by the runner | Accepted |
| [0043](./0043-a-credential-field-is-mapped-to-the-secure-plane.md) | A credential field is mapped to the Secure Plane, not to data | Accepted |
| [0044](./0044-the-confirmed-profile-has-its-own-store.md) | The confirmed profile has its own store; the event log stays a record of events | Accepted |
| [0045](./0045-the-runner-pulls-leased-work.md) | The Automation Runner pulls leased work; nothing calls into it | Accepted |
| [0046](./0046-a-fill-plan-crosses-as-value-and-provenance.md) | A fill plan crosses to the runner as value and provenance, reassembled through the one mint | Accepted |
| [0047](./0047-page-progress-lives-in-the-intent-ledger.md) | Page progress lives in the intent ledger; a lease names the page it holds | Accepted |
| [0048](./0048-a-specialist-resolution-completes-an-intent.md) | A specialist resolution completes an intent; the operator CLI is only its first interface | Accepted |
| [0049](./0049-the-run-driver-drives-the-case-machine.md) | The run driver drives the case state machine, and a student's authorisation is captured through it | Accepted |
| [0050](./0050-the-account-lifecycle-completes-through-the-students-own-decision.md) | The account lifecycle completes through the student's own decision, and a case can finally conclude | Accepted |
| [0051](./0051-the-student-supplies-through-the-conversation.md) | The student answers in the conversation, and a correction can reach the portal | Accepted |
| [0052](./0052-the-system-acts-when-nobody-is-watching.md) | The system acts when nobody is watching: a background worker owns autonomous progression | Accepted |
| [0053](./0053-a-student-can-stop.md) | A student can stop: cancellation is reachable, and it does not strand their account | Accepted |
| [0054](./0054-the-intent-is-durable-before-the-action.md) | The intent is durable before the action, not after it | Accepted |
| [0055](./0055-a-process-refuses-to-start-when-it-is-not-safe.md) | A process refuses to start when it is not safe | Accepted |
| [0056](./0056-verification-is-established-at-login.md) | Verification is established at login, not re-read at every step | Accepted |
| [0057](./0057-approval-binds-to-content-not-to-claims.md) | An approval binds to content, not to what the content says about itself | Accepted |
| [0058](./0058-a-case-opens-from-an-offer-the-student-accepted.md) | A case opens from an offer the student accepted, not from an identifier they sent | Accepted |
| [0059](./0059-the-student-can-read-what-they-are-authorising.md) | The student can read what they are authorising: the preview is a live projection, never a stored message | Accepted |
| [0060](./0060-the-conversation-service-owns-the-student-surface.md) | The Conversation Service owns the student surface, and the journey is readable without acting on it | Accepted |
| [0061](./0061-the-run-says-what-it-is-waiting-for.md) | The run says what it is waiting for, and the hash that decision must carry | Accepted |
| [0062](./0062-the-question-the-run-is-waiting-on-is-in-the-log.md) | The question the run is waiting on is in the log, so the interview has two voices | Accepted |
| [0063](./0063-the-published-contract-names-the-routes-that-exist.md) | The published contract names the routes that exist, checked against the real router | Accepted |
| [0064](./0064-the-interviews-decision-to-stop-reaches-the-system.md) | The interview's decision to stop reaches the system, so a run cannot strand at a question nobody will answer | Accepted |
| [0065](./0065-a-run-only-a-person-can-carry-on-stops-and-says-so.md) | A run only a person can carry on stops, and says so — the orchestrator's hand-over reaches the system | Accepted |
| [0066](./0066-three-declarations-name-a-document-and-one-decides.md) | Three declarations name a document, and one of them decides: the reviewed mapping | Accepted |
| [0067](./0067-aas-obtains-documents-and-the-policy-not-the-design-is-what-blocks.md) | AAS obtains documents; what blocks it is policy, not design | Accepted |
| [0068](./0068-the-storage-boundary-refuses-what-adr-0022-says-it-refuses.md) | The storage boundary refuses what ADR-0022 says it refuses, by type rather than by convention | Accepted |

Sixty-four are **Accepted**. ADR-0013 supersedes the gate design in ADR-0011; ADR-0051 narrows ADR-0015 and amends ADR-0047 §1; ADR-0052 amends ADR-0037's deployable table; ADR-0053 makes `CANCELLED` the first reachable terminal state; ADR-0054 amends ADR-0045 §4, which claimed a crash was detectable when it was not; ADR-0055 makes ADR-0037's five deployables and ADR-0042's shared cache runnable rather than merely described; ADR-0056 amends ADR-0038, which described a verified-email guard on the secure step that nothing implemented; ADR-0057 amends ADR-0017 §1, moving the two-person rule off the artefact's own fields and onto an independent registry keyed by content hash; ADR-0058 amends ADR-0049 by removing three case states that no decision produced, and corrects ADR-0001's request-evidence channel vocabulary; ADR-0059 completes ADR-0049 §5 by making the preview a student authorises reachable by them, having measured that only the test suite could complete an authorisation; ADR-0060 settles where the student client lives — a question ADR-0039 answered for the services and left open for the client — and adds the reads a client needs so that it never becomes a second source of workflow truth; ADR-0061 completes those reads by publishing the pending decision and its hash, having measured that one of the four student decisions could not be formed by any client at all; ADR-0062 completes ADR-0051 by putting the interview's QUESTION in the log, the half that decision left uncollected while giving the student's answer a durable home; ADR-0063 makes the published route table checkable against the real Express router, having measured six discrepancies that accumulated because the contract-drift guard read only enums and never `paths`; ADR-0064 completes ADR-0062 by wiring the two interview actions the driver still dropped, having measured that a student who refused three readings stranded the run for ever, and records document upload as blocked on ADR-0022 and ADR-0023 rather than building it; ADR-0065 completes ADR-0064 by acting on the orchestrator's own hand-over, which the driver discarded wherever the orchestrator raised it, separates the two problems ADR-0064 left entangled — a planner decision nothing acted on, and the unapproved disclosure and retention determinations — and corrects ADR-0064 §2, which named the wrong reason for a control that is nonetheless real; ADR-0066 settles which of the THREE reviewed declarations naming a document may decide anything — the mapping, measured in both directions — corrects ADR-0065 §6, which credited the blueprint page's inert list, and records the product decision the catalogue entry's student-facing list still waits on rather than granting it authority ADR-0009 and ADR-0021 withhold; ADR-0067 answers the question ADR-0066 §6.1 recorded as open — AAS is designed to obtain, hold and transmit documents, decided in ADR-0010, ADR-0016 and ADR-0022 and already implemented in the vault, the transmission gate and the end-to-end demo — enumerates the four policy blockers that remain and who owns each, names pass-through as a third shape without adopting it, and corrects ADR-0022's claim that the system refuses to store without a registered basis; ADR-0068 makes that claim true — the retention and lawful-basis gates now both run in `assertStorable`, whose branded result is the only thing `store` accepts, so the S3 + KMS implementation nobody has written yet cannot skip them. Reversing any of them requires a new ADR that supersedes it.
