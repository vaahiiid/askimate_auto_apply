/**
 * @askimate/aas-case-store — persistence for cases.
 *
 * Phase 1 ships the port plus an in-memory implementation. Phase 2 adds a
 * Postgres implementation that must pass the same `runCaseStoreContract` suite.
 */

export type { CaseStore } from "./store.js";
export { CaseNotFoundError, ConcurrencyConflictError, DuplicateSubmissionError } from "./store.js";
export { InMemoryCaseStore } from "./in-memory.js";

// NOTE: `runCaseStoreContract` is deliberately NOT exported here. It imports
// vitest, and pulling a test harness into the production entry point would make
// every consumer depend on it at runtime. Import it from
// "@askimate/aas-case-store/contract" in test files instead.
