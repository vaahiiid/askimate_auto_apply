# ADR-0051 — The student answers in the conversation, and a correction can reach the portal

**Status:** **Proposed** — drafted 2026-09-01, revised the same day after Vahid settled five open
points. Not to be acted on until approved. ·
**Amends:** [ADR-0047](./0047-page-progress-lives-in-the-intent-ledger.md) §1 ·
**Narrows:** [ADR-0015](./0015-interview-is-a-capability-of-askimate-chat.md) ·
**Defers:** [ADR-0001](./0001-integration-via-https-api-and-signed-webhooks.md) ·
**Related:** ADR-0002, ADR-0004, ADR-0007, ADR-0008, ADR-0010, ADR-0016, ADR-0031, ADR-0035, ADR-0039, ADR-0041, ADR-0049, ADR-0050

## Context

Twelve phases have been built downstream of a step that cannot happen.

Measured on `main` at `299d25e`:

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

Two further facts fix the shape:

- **`InterviewState` is rebuilt from scratch on every request.** `#situation` calls `newInterview(…)`,
  so `pending`, `attempts`, `transcript` and `collectedDocuments` are always empty. A pending
  confirmation cannot survive the request that created it, and `MAX_ATTEMPTS_PER_FIELD` can never be
  reached — so the `information_unobtainable` escalation ADR-0007 requires **can never fire**.
- **`void_authorisation` is read and never written.** `#withAuthorisationIfCaptured:1806` already
  consumes `AuthorisationVoided`, and its own comment says why: *"content that changed after approval
  is content nobody approved, and treating a voided authorisation as live would fill a form with
  values the student never saw."* Nothing produces it. Same reader-with-no-writer shape
  `HandoffRequired` had before P12.

The capability itself is not missing. `packages/interview` implements the whole loop —
`receiveAnswer`, `receiveConfirmation`, `receiveExtractedValue`, `nextAction` — and
`renderForConfirmation` already renders the deterministic playback. **Nothing calls any of it.**
What is missing is the wiring, the durability, and one honest answer about corrections.

## The decision

### 1 · The conversation is the only student-facing surface

`POST /v1/conversations/{id}/messages` is where a student answers a question and where a reading is
put back to them. **No second interview surface**: no interview UI, no interview API, no
questionnaire, no data-entry screen, no parallel route that asks the student anything.

This rules out the otherwise-obvious `GET .../interview/next` + `POST .../interview/answer` pair,
which is a form with an HTTP shape. It is ADR-0007 and ADR-0015 as written; it is restated because
it is the constraint that decides the design.

### 2 · The `answer` hook is where the interview runs

`ConversationRoutesOptions.answer` (`routes.ts:150`) already exists, is already called on the
accepted path only, and already skips idempotent replays. That is the seam, and it needs no new wire.

```
student message  ─▶  answer hook  ─▶  which field is outstanding?
                                  ─▶  receiveAnswer(state, fieldKey, utterance, model)
                                  ─▶  ProposedValue ⇒ pending
                                  ─▶  nextAction ⇒ { kind: "confirm", say }
                                  ─▶  append `say` as an assistant message
```

`say` is `renderForConfirmation(…)` — deterministic, from the structured value, never paraphrased.

### 3 · The confirmation is a decision, not a parsed "yes"

It arrives on the route P11 and P12 already built, on the student's own session, with one new member
on the closed set:

```ts
STUDENT_DECISIONS = ["authorise", "confirm_handoff", "confirm_value"]
```

`contentHash` is the hash of the playback text they were shown. The service compares it against what
it would render now and refuses on a mismatch, exactly as the other two do.

═══════════════════════════════════════════════════════════════════════════
**Why not read "yes" out of the chat message.** A model deciding that a student agreed to a reading
is the same class of act as a model inventing the value, which ADR-0004 and ADR-0016 exist to make
impossible. A free-text yes also supplies no hash, so *"what exactly did I agree to?"* has no answer
six months later. ADR-0049 §5 made this argument for the submission authorisation; it applies
identically one level down, per field.
═══════════════════════════════════════════════════════════════════════════

A **correction** ("no, it's the 3rd") is a new proposal, not a decision: it stays in the conversation,
goes through `receiveConfirmation`'s `corrected` branch, and produces a fresh playback that must
itself be confirmed. A correction the parser cannot read is `not_understood` — never the original
stored because the correction was unreadable.

### 4 · The value enters through the one sanctioned path

```
receiveConfirmation  ─▶  applyConfirmation   (the only minter of a ConfirmedValue)
                     ─▶  confirmField
                     ─▶  ConfirmedProfileStore.save
```

`receiveConfirmation` already performs the first two. **Nothing new mints a `ConfirmedValue`**, and
minting stays inside `packages/profile` (ADR-0004). The boundary check forbidding casts to
`ConfirmedValue` outside that package must stay green.

Corrections are already first-class here: `StoredProfileEntry.revision` is documented *"1 for the
first confirmation, higher after a correction"*, and the store contract asserts that saving the same
key twice keeps the later value with a higher revision. The profile side of corrections has always
worked. Only the portal side was never worked out — §6.

### 5 · Where a pending proposal lives — the conversation log

A pending proposal is a structured value awaiting a yes. It cannot be re-derived from the playback
text, because re-deriving means asking a model again, which produces a plausible value that is not
the one the student saw.

Three homes are ruled out by the architecture's own rules:

| Home | Why not |
|---|---|
| **The checkpoint** | `CheckpointValue` is primitives only, *by design*: *"each of those would admit a `ConfirmedValue`… and rule 3 would then rest on nobody doing it."* `discardCheckpoints` must lose no business fact. A proposal is not a position. |
| **The profile store** | `StoredProfileEntry` requires `ConfirmationProvenance`; the store holds a `ConfirmedProfile` by construction (ADR-0002, ADR-0004). Admitting unconfirmed values would weaken the strongest type guarantee in the system. |
| **The case log** | ADR-0031 reserves it for business facts. A proposal is not a fact about the application, and recording it there would make an unconfirmed reading look authoritative. |

**Decision: a new conversation-log event kind**, `value_proposed`, carrying the field key, the
structured value and the playback hash — closed by `value_confirmed` / `value_rejected`. `pending`
is then the last `value_proposed` with no closing event, derived exactly as `latestSecretRequest`
derives the open secure request.

Three reasons, in order of weight:

1. **The thing being confirmed lives there.** The playback is a message in that log and the
   confirmation is bound by a hash of it. Putting the proposal elsewhere separates the thing being
   confirmed from the thing that produced it, with no shared ordinal to order them.
2. **Direct precedent.** `secret_requested` is already a pending, non-message, structurally-typed,
   CHECK-constrained event on that log, closed by a later event. This is the same shape for the same
   reason.
3. **It stays honest about status.** The conversation log is explicitly *not* the business-fact log,
   so recording a proposal there says *"we understood X and showed it to you"* — a conversation
   fact, which is exactly what it is.

No new personal-data exposure: the playback text already sits in `message_bodies` under the same
`redacted_at`, and the redaction path must cover the new kind.

The structured value is stored rather than re-parsed from the playback on confirmation. Re-parsing
would depend on `render ∘ parse` being lossless for every field spec, and that fails silently.

### 6 · A correction after a page is filled — amending ADR-0047 §1

Submission is out of scope, so a filled application sits at the university as an unsubmitted draft.
The moment a student is most likely to notice a typo is when re-reading what was prepared —
**after** filling. This is the main correction case, not an edge case.

Today, and after the §7 fix alone:

```
stillCovers fails → nextStep ⇒ authorise → student re-authorises
→ state.filled is still true (derived from the ledger; a save cannot un-happen)
→ ready_to_submit
```

**The corrected value is never typed, and the student is told the application is ready.** That is the
one outcome this section exists to make impossible.

═══════════════════════════════════════════════════════════════════════════
The system must never give the student the impression that a corrected value has reached the
university when it has not. Detecting the divergence is therefore not optional, and it cannot be
detected at all while the ledger records only *that* a page was saved and not *what* was saved.
═══════════════════════════════════════════════════════════════════════════

**Decision: `advance_portal_page` intents become content-aware.** The target becomes the page ref
plus a hash of that page's planned instructions — one intent per page **version** rather than per
page. A stale page is then a page with no successful intent for its current content, which
`#nextPage` already knows how to offer.

Vahid decided the response, 2026-09-01: **re-offer the stale page as work; escalate to a specialist
where the portal will not permit re-editing a saved page.**

**Why this amends ADR-0047 rather than contradicting it.** ADR-0047 rejected a `pages_completed`
table and a checkpoint cursor because both create a second source of truth, and it holds that *"the
intent is a durable record that never changes once written"*. Neither is broken here: no intent is
mutated, and *"page P with content C₁ was saved"* stays true forever. The ledger remains the single
record of what happened to a run. What changes is the reading of `target` in §1 — from "one intent
per page" to "one intent per page version" — which is a refinement of its interpretation, not of its
architecture.

**One rule needs saying out loud.** `ActionIntent.target` is documented *"A host, a field ref, a
document id. **Never a value.**"* A content hash is not a value and leaks nothing readable, and
`AuthorisationCaptured` already stores a `contentHash` in a durable log. The doc comment is amended
to say so explicitly, rather than leaving a reader to decide whether a hash counts.

**Why not the alternatives.** *Always escalate* is safe but inverts ADR-0007: a student could not fix
their own name without a human, and the correction is already in the profile by then, so it
knowingly leaves profile and portal divergent. *A distinct `revise_portal_page` action* expands
`ConsequentialAction`, `WORK_KINDS`, the lease CHECK and the runner for what the existing
action-plus-target already expresses. *Detect and stop* satisfies honesty but parks the case with no
route forward.

**The student is never surprised by a re-fill.** Because §7 voids the authorisation the moment the
content changes, they must re-authorise the corrected preview before any page is offered again.
The "new explicit portal action" guarantee falls out of the existing authorisation gate rather than
needing a mechanism of its own.

**Open, and not a decision:** whether a real portal permits re-editing a saved page. The eight
discovery questions do not cover it. It is a fact to be observed per portal, and where the answer is
no, the escalation branch above is what runs.

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
(`void_authorisation` is a separate, deliberate act)."* That act exists, in the domain, and nothing
has ever performed it.
═══════════════════════════════════════════════════════════════════════════

**Decision: `void_authorisation` becomes symmetric with `capture_authorisation`.** Capture emits
`AuthorisationCaptured` **and** the `CaseStateChanged` forward to `AUTHORISED`; voiding emits
`AuthorisationVoided` **and** the `CaseStateChanged` back to `AWAITING_STUDENT_AUTHORISATION` — one
decided act, through `checkTransition`, on an edge `ALLOWED_TRANSITIONS.AUTHORISED` already permits.

The run driver issues it when, and only when, the orchestrator says the run is standing at
`authorise` while the case holds an authorisation. The driver does not decide that the content
changed — `stillCovers` is the orchestrator's, and the driver only observes the step it was handed.

Why this makes the guards **stronger**, not decorative:

- `capture_authorisation` keeps its guard exactly as it is. The only way back into
  `AWAITING_STUDENT_AUTHORISATION` is a recorded void, with a reason from the closed set, in the
  case log.
- `checkTransition` runs on the way back, so **the mandatory-review guard re-fires**. A correction
  that introduces financial evidence, or that reveals a minor, is reviewed again before the student
  can be asked. Under any shortcut — relaxing the spine, or letting capture accept from `AUTHORISED`
  — that review would be skipped, and P11's guard would become decorative in exactly the way this
  phase must avoid.
- The spine walk is untouched: `nextCaseHop` stays forward-only and is never used to go back.

| From | To | By | Guard that runs |
|---|---|---|---|
| `INTAKE …` | `PREPARING` | the spine walk (P11) | `checkTransition`, mandatory review |
| `PREPARING` | `AWAITING_STUDENT_AUTHORISATION` | the spine walk | mandatory review |
| `AWAITING_STUDENT_AUTHORISATION` | `AUTHORISED` | `capture_authorisation` | state must be `AWAITING_STUDENT_AUTHORISATION` |
| **`AUTHORISED`** | **`AWAITING_STUDENT_AUTHORISATION`** | **`void_authorisation` (new caller)** | **`checkTransition` + mandatory review, re-run** |

No new case state. No change to `CASE_SPINE`. No new edge in `ALLOWED_TRANSITIONS`.

### 8 · What this phase does NOT do

**Documents are out of scope, and blocked externally.** `request_document` remains an
`InterviewAction` nothing can satisfy. That is a known and recorded hole, not an oversight — see
§10 for exactly what unblocks it.

**No upload surface is built.** See §10.

**Tasks stay dormant.** Vahid decided, 2026-09-01: the interview and `planFill` already determine
what information is outstanding, and raising `provide_profile_field` tasks for the same unanswered
items would be a second source of truth — the thing ADR-0041 exists to prevent. The task model,
`TaskRaised`/`TaskCompleted`, `blockingTasks` and the blocking-task guard in `decide:388` remain
defined and unused. **They are deliberately not removed**: the model is the intended home for work
this product will have, and deleting it would cost more than leaving it dormant. This ADR records
the dormancy so a future reader does not mistake it for an oversight.

## Resolving the ADR conflict

Three accepted ADRs describe three topologies and none supersedes another. This section fixes that.

**The existing conversation message path is the single student-facing interaction surface for this
product at this stage.** There is one place a student ever says anything to this system. Everything
else they touch — the secure password control (ADR-0030), the decision route — is a narrow control
reached from that conversation, never an alternative place to be interviewed.

**ADR-0015 is NARROWED, not superseded.** Everything it decides about the *capability* stands and is
reinforced: headless, renders nothing, returns an `InterviewAction`, one thing at a time, nothing
enters the profile unconfirmed, playback rendered deterministically. What is narrowed is one
sentence of its *topology*: it says AskiMate Chat — a separate product — renders the capability and
that its public API is "the contract with AskiMate Chat … over the ADR-0001 integration boundary".
ADR-0039 made AAS the independent product, renamed `chat-integration` to `conversation-service`, and
shipped this repository's own student surface. So **the renderer is this product's own conversation
client**, and the caller is the `answer` hook in-process. ADR-0015's "nothing in this repository will
ever render a screen for a student" is superseded as a matter of fact by ADR-0039 — `ChatView.tsx`
exists — and retained in spirit: no screen is rendered *for the interview*.

**ADR-0001 is DEFERRED, explicitly and in full.** Unbuilt: `POST /v1/application-cases`, HMAC-SHA256
request signing, signed webhooks with a monotonic `event_seq`, `GET /v1/application-cases/{id}` as
the authoritative state read, and pre-signed S3 URLs for student documents. **None of it is built and
none of it is built by this phase.** Deferred rather than ignored because it becomes required the
moment a second system needs to open cases in AAS or observe them. Today AAS opens its own cases
from its own conversation, carrying the `request_evidence` ADR-0001 made non-negotiable, so product
rule 1 holds under both topologies.

**ADR-0039 is honoured.** AAS is the independent product; its student surface is its own; the
interview capability stays a pure package two services could call. Nothing here makes it harder to
expose over ADR-0001's boundary later.

## Consequences

- A real student can supply a field for the first time.
- The `information_unobtainable` escalation can fire for the first time, because `attempts` survives.
- A correction returns the case to the student with the mandatory-review guard re-run, and — if the
  portal was already filled — the corrected page is written again before the run can report itself
  ready. Both are behaviour changes, and both are the point.
- Two migrations: the new conversation-event kind with its CHECK constraints, and nothing else. The
  content-aware intent target needs no schema change — `target` is already text.
- Existing `advance_portal_page` intents written under the old target shape will not match the new
  key. On a live system that would re-offer already-saved pages; there is no live system, and the
  implementation must still state the position rather than discover it.
- The P7 journey stops seeding the profile and interviews the student instead — the single biggest
  honesty improvement available to this repository's test suite.

## What remains open, and who owns it

**Document intake is blocked on a retention schedule, and the block is working as designed.**
`pnpm run retention-status` reports the governing version `v0.2026-08-26` as **0 policies, 12
unresolved**, stamped *"UNAPPROVED — this version exists to record what is open, not to permit
storage"*. `requirePolicy` throws, so no placeholder can enter production. The complete inventory of
what must be decided is already written, grouped by who owns each answer, in
`docs/retention-analysis.md`:

| Owner | Document types awaiting a period |
|---|---|
| Ours, under storage limitation | `passport`, `national_id`, `personal_statement`, `reference_letter`, `other` (audit evidence) |
| The university's / QA Higher Education's requirement | `academic_transcript`, `degree_certificate`, `english_test_certificate` |
| Children's data | `birth_certificate`, `parental_consent`, `guardianship_document` |

Each needs `retainForDays`, `basis`, `reviewBy`, `action`, `erasureBehaviour` and `policyReference`.
Until they exist, document intake cannot ship and this ADR does not describe it.

**The upload boundary is deferred to its own decision.** There is no existing authorised upload
mechanism to reuse: the Secure Plane's vault is the *envelope* vault — ephemeral, single-use,
callback-only (ADR-0034, ADR-0042) — for secrets that get spent, while a document is retained, has a
retention clock, a validity window and a disclosure gate. Nor is ADR-0001's design a small slice:
there is **no S3 or KMS code anywhere in this repository**, and `DocumentVault.store(upload,
contents: Uint8Array, now)` takes bytes in-process, so pre-signed upload needs a different port
shape, not just an implementation. Since retention blocks documents regardless, the right answer is
to build no upload surface now and decide the boundary when documents are unblocked — which avoids
an interim interface becoming permanent rather than merely mitigating it.

**Whether a portal permits re-editing a saved page** is an observation, not a decision. §6's
escalation branch is what runs where it does not.
