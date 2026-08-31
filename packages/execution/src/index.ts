/**
 * @askimate/aas-execution — filling a portal, and nothing else.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Extracted from `@askimate/aas-orchestrator` by ADR-0046, for a dependency
 * reason that is also a design one.
 *
 * The dependency reason: the Automation Runner has to run `executePlan`, and it
 * may not depend on the orchestrator — that package carries `@askimate/aas-
 * case-store` (and therefore `pg`) and `@askimate/aas-secrets`, both of which
 * `scripts/check-boundaries.ts` forbids the runner by name. Browser automation
 * executes untrusted page content; it must not have a database driver or a
 * vault anywhere in its tree, transitively or otherwise.
 *
 * The design reason: `executePlan` is a pure function over a session and a
 * plan. It reads no run state, writes no checkpoint, and decides nothing about
 * what happens next. It was in the orchestrator because that is where it was
 * written, not because it belonged there — and the four dependencies below are
 * what it actually needs.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export type {
  ApplicationSession,
  AuthorisedDocument,
  DocumentSource,
  ExecutionContext,
  ExecutionOutcome,
  ExecutionReport,
} from "./execute.js";
export { executePlan, failures } from "./execute.js";
