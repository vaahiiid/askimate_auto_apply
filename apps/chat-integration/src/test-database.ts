/**
 * Whether a real PostgreSQL is reachable, and what to do when it is not.
 *
 * ── Why this is not a silent skip ─────────────────────────────────────────
 *
 * The integration tests need a real database, because requirement 8 is
 * *"search the actual database writes triggered during the test"* and a fake
 * would make that vacuous. But `pnpm run verify` has to work on a laptop with
 * no Postgres running.
 *
 * The usual answer — `describe.skipIf(noDatabase)` — is dangerous here in a way
 * it is not for an ordinary test. **"The leak test did not run" looks exactly
 * like "the leak test passed"** in a terminal full of green ticks, and the
 * whole value of these tests is that someone believes them.
 *
 * So a skip prints a loud, unmissable banner naming what was NOT checked, and
 * `pnpm run verify:integration` fails outright rather than skipping, so CI and
 * a pre-release check can demand the real thing.
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
