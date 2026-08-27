/**
 * The migration runner.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ADR-0003: *"AAS uses versioned, reviewed, forward-only migrations, committed
 * to the repository, applied in order… `push --force` is never used against
 * any environment."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Deliberately about a hundred lines rather than a dependency. What a
 * migration tool has to do here is: read numbered files, apply the ones not yet
 * applied, in order, each in a transaction, and record it. Everything beyond
 * that — down-migrations, squashing, branching — is machinery this project does
 * not use and would have to reason about anyway.
 *
 * ── The two rules it enforces ────────────────────────────────────────────
 *
 *  1. **A migration runs at most once**, guaranteed by a primary key on the
 *     version rather than by checking first and then inserting, which races.
 *  2. **An applied migration cannot change.** Its SHA-256 is recorded, and a
 *     file whose contents no longer match what was applied fails the run.
 *     That is the failure this exists to catch: someone edits `0001` to add a
 *     column, it applies cleanly on their empty laptop database, and does
 *     nothing at all in an environment where `0001` already ran.
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { Pool } from "pg";

/** Where the numbered `.sql` files live. */
export const MIGRATIONS_DIR = join(import.meta.dirname, "..", "migrations");

const REGISTRY = `
CREATE TABLE IF NOT EXISTS schema_migrations (
    version     text        PRIMARY KEY,
    checksum    text        NOT NULL,
    applied_at  timestamptz NOT NULL DEFAULT now()
);
`;

export interface Migration {
  readonly version: string;
  readonly sql: string;
  readonly checksum: string;
}

/** Raised when an already-applied migration file has been edited. */
export class MigrationChangedError extends Error {
  public override readonly name = "MigrationChangedError";
  public constructor(version: string) {
    super(
      `Migration ${version} has been modified since it was applied. Migrations are forward-only ` +
        `(ADR-0003): an applied file must never change, because the change would silently do ` +
        `nothing in every environment where it has already run. Add a new numbered migration ` +
        `instead.`,
    );
  }
}

export function loadMigrations(directory: string = MIGRATIONS_DIR): readonly Migration[] {
  return readdirSync(directory)
    .filter((name) => name.endsWith(".sql"))
    // Lexicographic order over zero-padded numeric prefixes. `0002` sorts after
    // `0001` and before `0010`, which a plain numeric sort of unpadded names
    // would get wrong.
    .sort()
    .map((name) => {
      const sql = readFileSync(join(directory, name), "utf8");
      return {
        version: name.replace(/\.sql$/, ""),
        sql,
        checksum: createHash("sha256").update(sql).digest("hex"),
      };
    });
}

/**
 * Applies every migration that has not been applied yet.
 *
 * Returns the versions applied by THIS call, so a caller can log what it did
 * rather than reporting "migrations complete" whether or not anything ran.
 */
export async function migrate(
  pool: Pool,
  directory: string = MIGRATIONS_DIR,
): Promise<readonly string[]> {
  await pool.query(REGISTRY);

  const applied = new Map<string, string>();
  const rows = await pool.query<{ version: string; checksum: string }>(
    "SELECT version, checksum FROM schema_migrations",
  );
  for (const row of rows.rows) applied.set(row.version, row.checksum);

  const ran: string[] = [];
  for (const migration of loadMigrations(directory)) {
    const previous = applied.get(migration.version);
    if (previous !== undefined) {
      if (previous !== migration.checksum) throw new MigrationChangedError(migration.version);
      continue;
    }

    const client = await pool.connect();
    try {
      // Each migration in its own transaction: a failure half-way leaves the
      // schema as it was, rather than in a state no migration describes.
      await client.query("BEGIN");
      await client.query(migration.sql);
      await client.query(
        "INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)",
        [migration.version, migration.checksum],
      );
      await client.query("COMMIT");
      ran.push(migration.version);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
  return ran;
}
