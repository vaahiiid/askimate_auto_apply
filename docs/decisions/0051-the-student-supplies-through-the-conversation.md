# ADR-0051 — The student supplies everything through the conversation, and a correction can be re-authorised

**Status:** **Proposed** — drafted 2026-09-01, not to be acted on until Vahid approves ·
**Date:** 2026-09-01 ·
**Narrows:** [ADR-0015](./0015-interview-is-a-capability-of-askimate-chat.md) ·
**Defers:** [ADR-0001](./0001-integration-via-https-api-and-signed-webhooks.md) ·
**Related:** ADR-0004, ADR-0007, ADR-0010, ADR-0016, ADR-0022, ADR-0031, ADR-0039, ADR-0041, ADR-0047, ADR-0049, ADR-0050

## Context

Twelve phases have been built downstream of a step that cannot happen.

Measured on `main` at `4ace241`:

| The link | State |
|---|---|
| `nextStep` composes the question — `nextAction(state.interview, model)` | ✅ `run.ts:391` |
| the question reaches the student | ❌ the runs route returns `phase` and `step` only; the `InterviewAction` is discarded |
| the answer becomes a `ProposedValue` | ❌ `receiveAnswer` has no production caller |
| the deterministic playback is put to the student | ❌ |
| the student confirms it | ❌ **`applyConfirmation` has zero production callers** |
| the confirmed value enters the profile | ❌ **`confirmField` and `ConfirmedProfileStore.save` have zero production callers** |

The live system only ever calls `profiles.load`. Every integration test and the P7 journey seed the
profile through `confirmTheInterview`, a test helper writing the store from the test process.
**No real student can put one field into this system.**

Three further facts make the shape of the gap precise:

- **`documents: new Map()`** is hardcoded at `run-driver.ts:797`. No document can reach a run, and
  `packages/documents`, `packages/extraction`, `packages/disclosure` and `packages/requirements` are
  depended on by **no app manifest at all**.
- **`InterviewState` is rebuilt from scratch on every request.** `#situation` calls `newInterview(…)`,
  so `pending`, `attempts`, `transcript` and `collectedDocuments` are always empty. The consequence
  is not only that a pending confirmation cannot survive the request that created it — it is that
  `MAX_ATTEMPTS_PER_FIELD` can never be reached, so the `information_unobtainable` escalation
  ADR-0007 requires **can never fire**.
- **`void_authorisation` is read and never written.** `#withAuthorisationIfCaptured:1806` already
  consumes `AuthorisationVoided`; nothing produces it. This is the same reader-with-no-writer shape
  that `HandoffRequired` had before P12.

The capability itself is not missing. `packages/interview` implements the whole loop —
`receiveAnswer`, `receiveConfirmation`, `receiveExtractedValue`, `nextAction` — and
`renderForConfirmation` in `packages/profile` already renders the deterministic playback.
**Nothing calls any of it.** What is missing is the wiring and the durability, not the logic.

## The decision

### 1 · The conversation is the only student-facing surface

The existing message path — `POST /v1/conversations/{id}/messages` — is where a student answers a
question, confirms a reading, and is asked for a document. **No second interview surface is
introduced**: no interview UI, no interview API, no questionnaire, no data-entry screen, and no
parallel route that asks the student anything.

This is ADR-0007 and ADR-0015 as written. It is restated here because it is the constraint that
rules out the otherwise-obvious design of a `GET .../interview/next` + `POST .../interview/answer`
pair, which would be a form with an HTTP shape.

### 2 · The `answer` hook is where the interview runs

`ConversationRoutesOptions.answer` already exists (`routes.ts:150`), is already called on the
accepted path only, and already runs after the student's message is durably placed and only when the
write was not an idempotent replay. That is the correct seam and it needs no new wire.

Today it is supplied by a free-text model reply. Under this ADR it becomes the interview driver:

```
student message  ─▶  answer hook  ─▶  which question is outstanding?
                                  ─▶  receiveAnswer(state, fieldKey, utterance, model)
                                  ─▶  ProposedValue, pending
                                  ─▶  nextAction ⇒ { kind: "confirm", say }
                                  ─▶  append `say` as an assistant message
```

`say` is `renderForConfirmation(…)` — deterministic, from the structured value, never paraphrased.
The student is agreeing to exactly what will be stored.

### 3 · The confirmation is a student decision, not a parsed "yes"

The student's agreement arrives on the route P11 and P12 already built:
`POST /v1/conversations/{id}/runs/{runId}/decision`, on their own authenticated session, with one
new member on the closed set:

```ts
STUDENT_DECISIONS = ["authorise", "confirm_handoff", "confirm_value"]
```

`contentHash` is the hash of **the playback text they were shown**, taken over the message the
service appended. The service compares it against what it would render now and refuses on a
mismatch, exactly as `authorise` and `confirm_handoff` do.

═══════════════════════════════════════════════════════════════════════════
**Why not read "yes" out of the chat message.** A model deciding that a student agreed to a
reading is the same class of act as a model inventing the value — which ADR-0004 and ADR-0016
exist to make impossible. And a free-text yes supplies no hash, so "what exactly did I agree
to?" has no answer six months later. This is the argument ADR-0049 §5 made for the submission
authorisation; it applies identically one level down, to each field.
═══════════════════════════════════════════════════════════════════════════

A **correction** ("no, it's the 3rd") is different: it is a new proposal, not a decision. It stays
in the conversation, goes through `receiveConfirmation`'s `corrected` branch, and produces a fresh
playback that must itself be confirmed. A correction the parser cannot read is `not_understood` —
never the original value stored because the correction was unreadable.

### 4 · The confirmed value enters through the one sanctioned path

```
receiveConfirmation  ─▶  applyConfirmation   (the only minter of a ConfirmedValue)
                     ─▶  confirmField
                     ─▶  ConfirmedProfileStore.save
```

`receiveConfirmation` already performs the first two. The Conversation Service persists the
resulting profile. **Nothing new mints a `ConfirmedValue`, and the minting stays inside
`packages/profile`** (ADR-0004). The dependency-boundary check that forbids casting to
`ConfirmedValue` outside that package is unchanged and must stay green.

### 5 · `InterviewState` is derived, and the one part that cannot be

Consistent with ADR-0041 and ADR-0047: nothing stores a second copy of anything already
authoritative.

| Part | Derived from |
|---|---|
| `profile` | the confirmed profile store — already durable |
| `requiredFields`, `requiredDocuments` | the blueprint + reviewed mapping set — already derived |
| `collectedDocuments` | the document vault |
| `attempts`, `transcript` | the conversation log |
| `pending` | **nothing holds it** |

A pending proposal is a structured value awaiting a yes. It cannot be re-derived from the playback
text, because re-deriving means asking a model again — which produces a plausible value that is not
the one the student was shown. So it must be recorded.

**Proposed:** a new conversation-log event kind, `value_proposed`, carrying the field key, the
structured value and the playback hash — with `value_confirmed` / `value_rejected` closing it.
`pending` is then the last `value_proposed` with no closing event, derived exactly as
`latestSecretRequest` derives the open secure request today.

The precedent is direct: `secret_requested` / `secret_received` are already non-message events on
the conversation log carrying structured fields and CHECK-constrained kinds (ADR-0031). This is the
same shape for the same reason, and it costs one migration.

The proposal holds personal data. So does every message body beside it, and `message_bodies` already
has `redacted_at`; the redaction path must cover the new kind.

### 6 · Documents complete the same capability

`request_document` is one of the five `InterviewAction` kinds. An interview that can ask for a
passport and never receive one is half a loop, and it is the exact "defined and unused" pattern this
phase exists to end.

```
nextAction ⇒ request_document  ─▶  assistant message, in the conversation
student uploads                ─▶  the vault (assertStorable, ADR-0010 retention policy)
extraction                     ─▶  ProposedValue, quoting the document (ADR-0016)
receiveExtractedValue          ─▶  the SAME pending → playback → confirm_value path
                               ─▶  applyConfirmation → the profile
```

═══════════════════════════════════════════════════════════════════════════
**There is deliberately no shortcut for documents.** "It came off their passport" is not
confirmation. OCR misreads, a model can misread a real line, and the student is the only party who
knows what their passport says. An extracted value takes the identical confirmation path a spoken
answer takes — `receiveExtractedValue` already enforces this by producing a `pending` and nothing
else.
═══════════════════════════════════════════════════════════════════════════

The upload is a **file transfer, not a question**: the request and the confirmation stay in the
conversation, and only the bytes move over a separate endpoint on the student's own session. That is
what keeps §1 true — an upload control is not an interview UI, and ADR-0015 already says documents
are requested "in the conversation, not on an upload page".

`documents: new Map()` is replaced by the vault's records for the case. Nothing is sent anywhere
without a `DisclosureAuthorisation` (ADR-0022): a document in the vault is not permission to send it,
and that check moves from unreachable to load-bearing.

### 7 · Re-authorisation: invalidation is a decided act, not a backwards walk

The defect, reachable the moment §4 works:

1. Student authorises → case `AUTHORISED`, `AuthorisationCaptured(hash₁)`.
2. A confirmed answer is corrected → preview `hash₂` → `stillCovers` fails → `nextStep` returns
   `authorise` again.
3. `nextCaseHop(AUTHORISED, AWAITING_STUDENT_AUTHORISATION)` answers `null` — the spine is
   forward-only (ADR-0049 §1).
4. `capture_authorisation` refuses unless the case is in `AWAITING_STUDENT_AUTHORISATION`.

**The student can never approve their corrected application.** 404, permanently.

═══════════════════════════════════════════════════════════════════════════
The forward-only spine is NOT the problem and must not be relaxed. `nextCaseHop` answers *"where
does a healthy case go next?"*, and a healthy case does not go backwards. Invalidating an
authorisation is not a healthy case moving backwards — it is a **separate, deliberate act**, and
ADR-0049 §1 already names it: *"moving it back would void an authorisation the student gave
(`void_authorisation` is a separate, deliberate act)."*

That act exists, in the domain, and nothing has ever performed it.
═══════════════════════════════════════════════════════════════════════════

**Proposed:** `void_authorisation` becomes symmetric with `capture_authorisation`. Capture emits
`AuthorisationCaptured` **and** the `CaseStateChanged` forward to `AUTHORISED`; voiding emits
`AuthorisationVoided` **and** the `CaseStateChanged` back to `AWAITING_STUDENT_AUTHORISATION` — one
decided act, through `checkTransition`, on an edge `ALLOWED_TRANSITIONS.AUTHORISED` already permits.

The run driver issues it when, and only when, the orchestrator says the run is standing at
`authorise` while the case holds an authorisation. The driver does not decide that the content
changed — `stillCovers` is the orchestrator's, and the driver only observes the step it was handed.

Why this makes the guards **stronger**, not decorative:

- `capture_authorisation` keeps its guard exactly as it is. The only way back into
  `AWAITING_STUDENT_AUTHORISATION` is a recorded void, with a reason from the closed set
  (`content_changed` | `expired` | `student_revoked`), in the case log.
- `checkTransition` runs on the way back, so **the mandatory-review guard re-fires**. A correction
  that introduces financial evidence, or that reveals a minor, is reviewed again before the student
  can be asked. Under any shortcut — relaxing the spine, or letting capture accept from
  `AUTHORISED` — that review would be skipped, and P11's guard would become decorative in exactly
  the way this phase must avoid.
- The spine walk is untouched: `nextCaseHop` stays forward-only and is never used to go back.

State transitions this phase involves, in full:

| From | To | By | Guard that runs |
|---|---|---|---|
| `INTAKE …` | `PREPARING` | the spine walk (P11) | `checkTransition`, mandatory review |
| `PREPARING` | `AWAITING_STUDENT_AUTHORISATION` | the spine walk | mandatory review |
| `AWAITING_STUDENT_AUTHORISATION` | `AUTHORISED` | `capture_authorisation` | state must be `AWAITING_STUDENT_AUTHORISATION` |
| **`AUTHORISED`** | **`AWAITING_STUDENT_AUTHORISATION`** | **`void_authorisation` (new)** | **`checkTransition` + mandatory review, re-run** |

No new case state. No change to `CASE_SPINE`. No new edge in `ALLOWED_TRANSITIONS`.

## Resolving the ADR conflict

Three accepted ADRs currently describe three different topologies and none supersedes another. This
section fixes that.

**The existing conversation message path is the single student-facing interaction surface for this
product at this stage.** There is one place a student ever says anything to this system, and it is
the conversation. Everything else the student touches — the secure password control (ADR-0030), the
decision route, the document upload — is a narrow control reached from that conversation, never an
alternative place to be interviewed.

**ADR-0015 is NARROWED, not superseded.** Everything it decides about the *capability* stands and is
reinforced: the interview is headless, it renders nothing, it returns an `InterviewAction`, it asks
one thing at a time, and nothing enters the profile unconfirmed with a deterministic playback. What
is narrowed is one sentence of its *topology*: it says AskiMate Chat — a separate product — renders
the capability, and that "the capability's public API is the contract with AskiMate Chat … called
over the ADR-0001 integration boundary". ADR-0039 made AAS the independent product, renamed
`chat-integration` to `conversation-service`, and shipped this repository's own student surface. So
**the renderer is this product's own conversation client**, and the capability's caller is the
`answer` hook in-process rather than a foreign system over HTTP. Its rule that "nothing in this
repository will ever render a screen for a student" is superseded by ADR-0039 as a matter of fact —
`ChatView.tsx` exists — and is retained in spirit: no screen is rendered *for the interview*.

**ADR-0001 is DEFERRED, explicitly and in full.** Its integration surface is unbuilt:
`POST /v1/application-cases`, HMAC-SHA256 request signing, signed webhooks with a monotonic
`event_seq`, `GET /v1/application-cases/{id}` as the authoritative state read, and pre-signed S3
URLs for student documents. **None of it is built and none of it is built by this phase.** It is
deferred rather than ignored because it becomes required the moment a second system needs to open
cases in AAS or observe them; today AAS opens its own cases from its own conversation
(`POST /v1/conversations/{id}/runs`), which carries the `request_evidence` ADR-0001 made
non-negotiable — so product rule 1 holds under both topologies. The document-upload half is the one
piece this phase touches: it builds an upload path on the student's own session, and does **not**
build the pre-signed-S3 route, which stays deferred with the rest.

**ADR-0039 is honoured.** AAS is the independent product; its student surface is its own; the
interview capability stays a pure package that two services could call. Nothing here makes the
capability harder to expose over ADR-0001's boundary later — it stays a function over
`InterviewState`, and the hook is a caller, not an owner.

## Consequences

- A real student can supply a field, and a document, for the first time.
- `packages/documents`, `packages/extraction` and `packages/disclosure` come onto the live path.
  ADR-0022's disclosure check and ADR-0016's grounding rule stop being unreachable.
- The `information_unobtainable` escalation can fire for the first time, because `attempts` survives.
- A correction after authorisation returns the case to the student with the mandatory-review guard
  re-run — a behaviour change, and the point.
- One migration: the new conversation-event kind and its CHECK constraints.
- The P7 journey stops seeding the profile and interviews the student instead. That is the single
  biggest honesty improvement available to this repository's test suite.

## Genuinely unresolved — decisions I have not made

**(a) Do the interview's outstanding asks become Tasks?** `provide_profile_field`,
`provide_document` and `confirm_extracted_data` are `TaskKind`s; `TaskRaised`/`TaskCompleted`,
`blockingTasks`, `ownerFor`, `sourceFor` and the blocking-task guard in `decide:388` are all defined
and unused — the guard has never fired. Wiring them would make that mechanism live. **Against:**
`planFill`'s blocker list already answers "what is outstanding", and two answers to one question is
what ADR-0041 exists to prevent. I lean to **not** raising tasks in this phase and recording the
task model as knowingly dormant, but it is a real choice.

**(b) A correction *after* the portal has been filled.** `filled` is derived from the intent ledger
(`advance_portal_page` succeeded), and a save that happened cannot un-happen (ADR-0047). So after a
post-fill correction the run would re-authorise and then answer `ready_to_submit` — **the corrected
value would never be typed into the portal.** Options: record fill intents per (page, contentHash)
so a changed hash means an unfilled page; refuse post-fill corrections and route them to a
specialist; or accept and document the hole. This touches ADR-0047's ledger semantics and I do not
think it should be decided inside this ADR.

**(c) Document retention periods are a real external blocker.** ADR-0010's vault refuses any
document type with no configured policy — no default, no fallback — so **the first real upload
fails by design** until a retention schedule exists. The code path can be built and tested against a
test policy, but the document half of this phase is not deployable without periods that only you can
supply (`docs/retention-analysis.md`).

**(d) Where the pending proposal lives.** §5 proposes the conversation log. The alternative is the
case log, which ADR-0031 reserves for business facts — and a proposal is not yet a fact. I am fairly
confident in the conversation log, but it is a schema decision worth naming.

**(e) Scope of the upload endpoint.** Multipart to the Conversation Service on the student's session
is the minimum. ADR-0001's pre-signed S3 direct upload is the stated long-term shape and is deferred;
building the interim path means building something that is later replaced.
