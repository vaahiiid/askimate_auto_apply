/**
 * @askimate/aas-secure-service — Plane B.
 *
 * The thing to know about this schema: it has no column that can hold a
 * secret, and `schema.test.ts` proves it by reading `information_schema` after
 * the migrations run — including the lifecycle outbox added in 0002.
 */

import { join } from "node:path";

export const MIGRATIONS_DIR = join(import.meta.dirname, "..", "migrations");

export const SCHEMA_LIFECYCLES = [
  "secret_requested",
  "secret_received",
  "secret_consumed",
  "secret_expired",
  "secret_cancelled",
] as const;

export const SCHEMA_PURPOSES = ["portal_account_creation", "portal_password_reset"] as const;

/** Why a handle could not be spent. Closed, so an audit row cannot free-text. */
export const USE_REFUSAL_CODES = [
  "unknown_handle",
  "already_spent",
  "expired",
  "wrong_student",
  "wrong_case",
  "wrong_purpose",
  "wrong_target",
  "diagnostic_capture_not_confirmed",
] as const;


// ── The lifecycle push ────────────────────────────────────────────────────

export type {
  DeliverTransition,
  DeliveryOutcome,
  LifecycleTransition,
  OutboxRow,
  PermanentCode,
  RetryableCode,
} from "./lifecycle-outbox.js";
export { LifecycleOutbox, backoffSeconds } from "./lifecycle-outbox.js";

export type { InternalAppendOptions } from "./internal-append.js";
export { internalAppend } from "./internal-append.js";
