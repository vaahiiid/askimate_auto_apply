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

Nothing yet.

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
