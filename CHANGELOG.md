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

[Unreleased]: https://github.com/vaahiiid/askimate_auto_apply/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/vaahiiid/askimate_auto_apply/releases/tag/v0.1.0
