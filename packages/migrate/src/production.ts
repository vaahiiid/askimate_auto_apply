/**
 * The two things a deployed service needs from the migration runner.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Until P18 `migrate()` had NO caller outside tests. A deployed database would
 * have had no schema, and there was no way to give it one — the runner has been
 * complete and correct since ADR-0003 and nothing production could reach it.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why migrating is a COMMAND and starting is a CHECK ────────────────────
 *
 * A service that migrated its own database on boot would migrate it once per
 * instance, during a rolling deploy, while the previous version is still
 * serving. The schema would move under a running process that was built against
 * the old one.
 *
 * So the two are separated: `aas-conversation-service migrate` applies them,
 * deliberately, once, when an operator says so; and every ordinary start
 * REFUSES if anything is pending. A service can then never be running against a
 * schema it was not built for, and the failure is a startup error naming the
 * missing versions rather than a runtime error naming a missing column.
 */

import type { Pool } from "pg";

import { loadMigrations, migrate } from "./runner.js";

/**
 * Which migrations exist on disk and are not yet recorded as applied.
 *
 * Read-only: it creates nothing and applies nothing, so a service without
 * schema-changing rights can still run it as a startup check. An empty array
 * means the database is exactly what this build expects.
 *
 * A database with NO registry at all answers "everything is pending", which is
 * the truthful answer for an empty database and is why this does not create the
 * table to look at it.
 */
export async function pendingMigrations(
  pool: Pool,
  directory: string,
): Promise<readonly string[]> {
  const onDisk = loadMigrations(directory);
  const registry = await pool.query<{ exists: boolean }>(
    "SELECT to_regclass('public.schema_migrations') IS NOT NULL AS exists",
  );
  if (registry.rows[0]?.exists !== true) return onDisk.map((m) => m.version);

  const applied = await pool.query<{ version: string }>("SELECT version FROM schema_migrations");
  const have = new Set(applied.rows.map((row) => row.version));
  return onDisk.filter((m) => !have.has(m.version)).map((m) => m.version);
}

/**
 * A lock id for `pg_advisory_lock`, derived from the directory.
 *
 * Two services share one database in this system — the Conversation Service and
 * the Worker both use the conversation plane's — and each owns different
 * migration directories. A single global lock would serialise unrelated
 * migrations; a per-directory one lets each proceed while still making two
 * simultaneous runs of the SAME set impossible.
 */
function lockIdFor(directory: string): number {
  let hash = 0;
  for (const character of directory) {
    hash = (hash * 31 + character.charCodeAt(0)) | 0;
  }
  return hash;
}

/**
 * Applies pending migrations with a lock, so two operators cannot race.
 *
 * `migrate()` is already safe against re-running an applied migration — the
 * registry and the checksum see to that — but two processes applying the SAME
 * pending migration at once would both run its SQL, and a migration that is not
 * itself idempotent (`CREATE TYPE`, a backfill) would fail one of them halfway.
 *
 * A SESSION-level advisory lock, held on one dedicated client for the duration
 * and released in a `finally`. Session-level rather than transaction-level
 * because `migrate` runs each migration in its own transaction, so there is no
 * single transaction to attach it to.
 */
export async function migrateExclusive(
  pool: Pool,
  directory: string,
): Promise<readonly string[]> {
  const client = await pool.connect();
  const lockId = lockIdFor(directory);
  try {
    await client.query("SELECT pg_advisory_lock($1)", [lockId]);
    return await migrate(pool, directory);
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [lockId]).catch(() => undefined);
    client.release();
  }
}
