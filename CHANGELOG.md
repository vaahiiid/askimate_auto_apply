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
| `0.2.1` | `v0.2.1` → the `0.2.1` commit | **NO** |
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

[Unreleased]: https://github.com/vaahiiid/askimate_auto_apply/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/vaahiiid/askimate_auto_apply/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/vaahiiid/askimate_auto_apply/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/vaahiiid/askimate_auto_apply/releases/tag/v0.1.0
