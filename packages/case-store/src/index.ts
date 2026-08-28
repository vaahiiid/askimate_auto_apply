/**
 * @askimate/aas-case-store — persistence for cases.
 *
 * Phase 1 ships the port plus an in-memory implementation. Phase 2 adds a
 * Postgres implementation that must pass the same `runCaseStoreContract` suite.
 */

export type { CaseStore } from "./store.js";
export { CaseNotFoundError, ConcurrencyConflictError, DuplicateSubmissionError } from "./store.js";
export { InMemoryCaseStore } from "./in-memory.js";

// The Postgres implementation is exported from "@askimate/aas-case-store/postgres"
// rather than here, so a consumer that only wants the in-memory store does not
// pull `pg` — and its TCP sockets, and its DNS resolution — into a process that
// has no database. `apps/browser-runner` is exactly such a consumer, and its
// dependency-boundary rule forbids `pg`.
export { MIGRATIONS_DIR } from "./migrations-dir.js";
export { decodeEvent, encodeEvent } from "./serialisation.js";

// NOTE: `runCaseStoreContract` is deliberately NOT exported here. It imports
// vitest, and pulling a test harness into the production entry point would make
// every consumer depend on it at runtime. Import it from
// "@askimate/aas-case-store/contract" in test files instead.

// ── The workflow run store — operational state, kept apart ────────────────
//
// A SEPARATE port from CaseStore, deliberately (ADR-0029 pending; approved by
// Vahid 2026-08-27). CaseStore is append-only and holds business truth; a
// checkpoint is mutable and disposable. Forcing one into the other would mean
// either putting execution detail into the business record or adding an update
// path to an append-only log.
export type { IntentRecord, WorkflowRunStore } from "./workflow-store.js";
export {
  RunAlreadyExistsError,
  RunConcurrencyError,
  RunNotFoundError,
  RunStatusError,
} from "./workflow-store.js";
export { InMemoryWorkflowRunStore } from "./in-memory-workflow.js";
