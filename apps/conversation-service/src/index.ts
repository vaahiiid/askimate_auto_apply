/**
 * @askimate/aas-conversation-service — Plane A.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠  MIGRATIONS ONLY, so far.
 *
 * The schema exists and its constraints are verified against a real
 * PostgreSQL. The service — routes, SSE, the model funnel — is the next step
 * and is deliberately not here yet: ADR-0003 and ADR-0039 put versioned
 * migrations before any data exists, and this is that.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { join } from "node:path";

/** Where this service's numbered migrations live. */
export const MIGRATIONS_DIR = join(import.meta.dirname, "..", "migrations");

/**
 * The vocabularies this schema's CHECK constraints admit.
 *
 * Duplicated from the published contract on purpose, and reconciled by
 * `schema-vocabulary.test.ts` against BOTH `@askimate/aas-contracts` and the
 * database's own `information_schema`. Three lists, checked against each
 * other, rather than one list trusted three times.
 */
export const SCHEMA_EVENT_KINDS = [
  "message",
  "secret_requested",
  "secret_received",
  "secret_consumed",
  "secret_expired",
  "secret_cancelled",
  "secret_rejected",
] as const;

export const SCHEMA_ACTORS = ["student", "assistant", "mentor", "system"] as const;

/** Kinds that settle an open request. A rejection is deliberately absent. */
export const SETTLING_KINDS = [
  "secret_received",
  "secret_consumed",
  "secret_expired",
  "secret_cancelled",
] as const;
