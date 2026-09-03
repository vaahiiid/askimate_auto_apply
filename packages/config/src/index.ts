/**
 * @askimate/aas-config — how a process learns what it is.
 *
 * Deliberately dependency-free, like `@askimate/aas-contracts` and for a
 * related reason: every deployable imports this, including the one that
 * receives a student's password, so its dependency tree is a supply-chain path
 * into all five (ADR-0042's argument, applied to configuration).
 */

export type { ConfigProblem, Environment, Reader } from "./read.js";
export { ConfigError, isProduction, readConfig } from "./read.js";

// ── Starting and stopping (ADR-0055) ──────────────────────────────────────
export type { Log, ShutdownOptions } from "./process.js";
export { DEFAULT_GRACE_MS, installShutdown, reportStartupFailure } from "./process.js";
