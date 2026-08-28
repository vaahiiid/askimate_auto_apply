/**
 * Whether a real PostgreSQL is reachable, and what to do when it is not.
 *
 * ── Shared, deliberately ─────────────────────────────────────────────────
 *
 * Every database-backed package needs this, and every copy of it is a copy of
 * the mechanism that decides whether a SECURITY test may quietly not run. Three
 * near-identical `announceSkip` implementations is three chances for one of
 * them to grow a subtly quieter banner, or to forget that
 * `AAS_REQUIRE_DATABASE=1` must turn a skip into a failure.
 *
 * So it lives here, beside the migration runner, and is imported through
 * `@askimate/aas-migrate/testing`.
 *
 */

import pg from "pg";

export const TEST_DATABASE_URL =
  process.env["AAS_TEST_DATABASE_URL"] ?? "postgresql://postgres@localhost:55432/postgres";

/** True when `AAS_REQUIRE_DATABASE=1` — a skip becomes a failure. */
export const DATABASE_REQUIRED = process.env["AAS_REQUIRE_DATABASE"] === "1";

let reachable: boolean | null = null;

export async function databaseReachable(): Promise<boolean> {
  if (reachable !== null) return reachable;
  const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL, connectionTimeoutMillis: 2_000 });
  try {
    await pool.query("SELECT 1");
    reachable = true;
  } catch {
    reachable = false;
  } finally {
    await pool.end().catch(() => undefined);
  }
  return reachable;
}

/**
 * Announces, in terms nobody can mistake for a pass, what was not checked.
 *
 * Throws instead when `AAS_REQUIRE_DATABASE=1`.
 */
export function announceSkip(what: string): void {
  const message =
    `\n${"█".repeat(78)}\n` +
    `██  NOT CHECKED: ${what}\n` +
    `██\n` +
    `██  No PostgreSQL at ${TEST_DATABASE_URL}\n` +
    `██  These tests prove a student's password does not reach the database,\n` +
    `██  the logs, or the model. They did NOT run. A green suite below does\n` +
    `██  not mean that property holds.\n` +
    `██\n` +
    `██  To run them:   pnpm run verify:integration\n` +
    `${"█".repeat(78)}\n`;

  if (DATABASE_REQUIRED) throw new Error(message);
  console.warn(message);
}
