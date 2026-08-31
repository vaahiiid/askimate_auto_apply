/**
 * @askimate/aas-conversation-service — Plane A.
 *
 * The event log, its ordinals, its HTTP surface, and the origin the
 * conversation UI is served from.
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


// ── The service ───────────────────────────────────────────────────────────

export type { AppendableEvent, AppendResult } from "./event-store.js";
export {
  ConversationEventStore,
  IdempotencyConflictError,
  UnknownConversationError,
} from "./event-store.js";

export type { Caller, ConversationRoutesOptions, RunCoordinator } from "./routes.js";
export { createConversationRoutes } from "./routes.js";

export { SESSION_COOKIE, issueSession, readSession, setSession } from "./session.js";

export type { ConversationAppOptions } from "./app.js";
export { createConversationApp } from "./app.js";

// ── P1: the run (ADR-0031's log, joined to the application domain) ──────────
export type { ConversationCase } from "./application-store.js";
export {
  ApplicationBindingStore,
  CaseBindingRefusedError,
  UnknownConversationBindingError,
} from "./application-store.js";
export type {
  ApplicationCatalogue,
  CatalogueEntry,
  RunDriverOptions,
  RunOutcome,
  RunPosition,
  RunRefusal,
} from "./run-driver.js";
export { RunDriver } from "./run-driver.js";

// ── ADR-0044: the confirmed profile has its own store ───────────────────────
export { PostgresConfirmedProfileStore } from "./profile-store.js";
