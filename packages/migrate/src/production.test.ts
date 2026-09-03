/**
 * The startup check and the migrate command, against a real PostgreSQL.
 *
 * Both are about a deployed service, and both are properties of the database:
 * whether a registry exists, and whether two processes can apply one migration
 * at the same time.
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import { migrateExclusive, pendingMigrations } from "./production.js";
import { announceSkip, databaseReachable, TEST_DATABASE_URL } from "./test-database.js";

const DATABASE = "aas_migrate_production";
const HAVE_DATABASE = await databaseReachable();
if (!HAVE_DATABASE) announceSkip("P18 — the migration command and the startup check");
const describeIfDatabase = HAVE_DATABASE ? describe : describe.skip;

let pool: pg.Pool;
let directory: string;

beforeAll(async () => {
  if (!HAVE_DATABASE) return;
  const admin = new pg.Pool({ connectionString: TEST_DATABASE_URL });
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${DATABASE} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${DATABASE}`);
  } finally {
    await admin.end();
  }
  const url = new URL(TEST_DATABASE_URL);
  url.pathname = `/${DATABASE}`;
  pool = new pg.Pool({ connectionString: url.toString(), max: 8 });

  directory = mkdtempSync(join(tmpdir(), "aas-migrations-"));
  // Deliberately NOT idempotent: a bare CREATE TABLE, so two racing callers
  // running it at once would be visible as a failure rather than absorbed.
  writeFileSync(join(directory, "0001_first.sql"), "CREATE TABLE first (id int PRIMARY KEY);");
  writeFileSync(join(directory, "0002_second.sql"), "CREATE TABLE second (id int PRIMARY KEY);");
}, 120_000);

afterAll(async () => {
  if (!HAVE_DATABASE) return;
  await pool.end();
});

describeIfDatabase("what a deployed service asks the migration runner", () => {
  it("says EVERYTHING is pending on a database with no registry", async () => {
    // The truthful answer for an empty database, and the reason this check does
    // not create the registry to look at it: a startup check must be able to
    // run without schema-changing rights.
    expect(await pendingMigrations(pool, directory)).toEqual(["0001_first", "0002_second"]);
  }, 60_000);

  it("applies them under a lock, and then nothing is pending", async () => {
    expect(await migrateExclusive(pool, directory)).toEqual(["0001_first", "0002_second"]);
    expect(await pendingMigrations(pool, directory), "the startup check now passes").toEqual([]);
  }, 60_000);

  it("is safe to run twice", async () => {
    expect(await migrateExclusive(pool, directory), "nothing left to do").toEqual([]);
  }, 60_000);

  it("serialises two callers racing the SAME pending migration", async () => {
    // ═══════════════════════════════════════════════════════════════════
    // Two operators, or a deploy script run twice. `migrate` is safe against
    // re-running an APPLIED migration; it is not safe against two processes
    // applying the same PENDING one, because a bare `CREATE TABLE` would fail
    // for whichever arrived second.
    //
    // With the advisory lock, the second caller waits, then finds the registry
    // already carries it and applies nothing.
    // ═══════════════════════════════════════════════════════════════════
    writeFileSync(join(directory, "0003_third.sql"), "CREATE TABLE third (id int PRIMARY KEY);");

    const [a, b] = await Promise.all([
      migrateExclusive(pool, directory),
      migrateExclusive(pool, directory),
    ]);
    const applied = [...a, ...b];
    expect(applied, "applied exactly once, by exactly one of them").toEqual(["0003_third"]);
    expect(await pendingMigrations(pool, directory)).toEqual([]);
  }, 60_000);

  it("notices a migration that was EDITED after it was applied", async () => {
    // The checksum rule, reached through the production caller. A file changed
    // after it ran means the database and the repository disagree about what
    // the schema is, and no amount of re-running fixes that.
    writeFileSync(join(directory, "0001_first.sql"), "CREATE TABLE first (id bigint PRIMARY KEY);");
    await expect(migrateExclusive(pool, directory)).rejects.toThrow(/0001_first/);
  }, 60_000);
});
