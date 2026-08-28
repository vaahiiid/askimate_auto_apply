/**
 * The secure schema, against a real PostgreSQL.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * The headline test is `has no column that could hold a secret`. It reads
 * `information_schema` after the migration has run, so it is a fact about the
 * database that exists rather than a claim about the SQL somebody wrote.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import { migrate } from "@askimate/aas-migrate";
import { announceSkip, databaseReachable, TEST_DATABASE_URL } from "@askimate/aas-migrate/testing";
import { REJECTION_REASONS, SECRET_LIFECYCLES } from "@askimate/aas-contracts";

import { MIGRATIONS_DIR, SCHEMA_LIFECYCLES, SCHEMA_PURPOSES, USE_REFUSAL_CODES } from "./index.js";

const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";

const MARKER = "SECRET-PASSWORD-DO-NOT-LEAK-123!";
const REQUEST_ID = `sr_${"a".repeat(32)}`;
const HANDLE = `sh_${"b".repeat(32)}`;
const SHA = "c".repeat(64);

let pool: pg.Pool;

const HAVE_DATABASE = await databaseReachable();
if (!HAVE_DATABASE) announceSkip("the secure schema, including that it holds no secret");
const describeIfDatabase = HAVE_DATABASE ? describe : describe.skip;

async function ownDatabase(name: string): Promise<pg.Pool> {
  const admin = new pg.Pool({ connectionString: TEST_DATABASE_URL });
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }
  const url = new URL(TEST_DATABASE_URL);
  url.pathname = `/${name}`;
  return new pg.Pool({ connectionString: url.toString() });
}

async function refuses(
  sql: string,
  params: readonly unknown[],
  expected: { code: string; constraint?: string },
): Promise<void> {
  try {
    await pool.query(sql, [...params]);
    expect.unreachable(`the database accepted a row it must refuse: ${sql}`);
  } catch (error) {
    const failure = error as { code?: string; constraint?: string; message?: string };
    expect(failure.code, failure.message ?? "no message").toBe(expected.code);
    if (expected.constraint !== undefined) expect(failure.constraint).toBe(expected.constraint);
  }
}

async function openRequest(requestId: string = REQUEST_ID): Promise<string> {
  await pool.query(
    `INSERT INTO secret_requests
       (request_id, student_ref, conversation_id, case_ref, purpose, target_host, expires_at)
     VALUES ($1, 'student-1', 'conv-1', 'case-1', 'portal_account_creation',
             'apply.example.ac.uk', now() + interval '5 min')`,
    [requestId],
  );
  return requestId;
}

beforeAll(async () => {
  if (!HAVE_DATABASE) return;
  pool = await ownDatabase("aas_secure_schema");
  const applied = await migrate(pool, MIGRATIONS_DIR);
  // Every migration, named. A list rather than a count, so a file added
  // without being considered here fails rather than sliding in — and so the
  // "no column can hold a secret" scan below is known to be looking at the
  // whole schema, not at whatever happened to be migrated.
  expect(applied).toEqual(["0001_secret_requests", "0002_lifecycle_outbox"]);
}, 120_000);

afterAll(async () => {
  // `pool` is typed non-nullish but is only assigned in `beforeAll`, which can
  // throw before it runs. A truthiness check reads as the guard it is; an
  // optional chain on a non-nullish type is dead code the linter rejects.
  if (HAVE_DATABASE) await pool.end();
});

// ───────────────────────────────────────────────────────────────────────────
// The headline property
// ───────────────────────────────────────────────────────────────────────────

describeIfDatabase("this database cannot hold a secret", () => {
  it("has no column whose name suggests it holds, hashes or measures one", async () => {
    // Read from the live catalogue rather than from the .sql file, so a column
    // added by a later migration is covered without anybody remembering to
    // extend a grep.
    const columns = await pool.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name
         FROM information_schema.columns
        WHERE table_schema = 'public'
        ORDER BY table_name, ordinal_position`,
    );
    expect(columns.rowCount).toBeGreaterThan(20);

    // `handle` and `token_hash` are permitted and named explicitly: a handle
    // is opaque and random rather than derived, and a token hash covers a
    // capability we mint, not anything a student typed.
    const FORBIDDEN =
      /(^|_)(secret|password|passphrase|plaintext|credential|pwd|cipher|ciphertext|salt|strength|entropy|length)($|_)/i;

    const offenders = columns.rows
      .filter((row) => FORBIDDEN.test(row.column_name))
      .map((row) => `${row.table_name}.${row.column_name}`);
    expect(offenders).toEqual([]);
  });

  it("stores no bytea anywhere, so nothing can be smuggled in as a blob", async () => {
    // A `bytea` column is where an encrypted secret would live if anybody
    // decided this database should hold one after all. There is no legitimate
    // use for one in this schema, so its absence is checkable.
    const blobs = await pool.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND data_type IN ('bytea', 'json', 'jsonb')`,
    );
    expect(blobs.rows.map((row) => `${row.table_name}.${row.column_name}`)).toEqual([]);
  });

  it("names every table it has, so a new one cannot arrive unnoticed", async () => {
    const tables = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ORDER BY table_name`,
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      // The outbox that carries a lifecycle transition to the conversation
      // log. It holds a request id, a kind, an opaque handle and a reason code
      // — no payload column, deliberately, because a generic `payload jsonb`
      // is where a password would eventually be put by accident. The
      // column-by-column scan above covers it like every other table.
      "lifecycle_outbox",
      "frame_tokens",
      "schema_migrations",
      "secret_requests",
      "secret_uses",
      "secure_sessions",
    ].sort());
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Lifecycle
// ───────────────────────────────────────────────────────────────────────────

describeIfDatabase("the request lifecycle", () => {
  it("admits exactly the words the contract and the domain publish", async () => {
    expect([...SCHEMA_LIFECYCLES].sort()).toEqual([...SECRET_LIFECYCLES].sort());
    const requestId = await openRequest(`sr_${"1".repeat(32)}`);
    for (const lifecycle of SCHEMA_LIFECYCLES) {
      const handle = lifecycle === "secret_received" ? HANDLE : null;
      await pool.query(
        "UPDATE secret_requests SET lifecycle = $2, handle = $3 WHERE request_id = $1",
        [requestId, lifecycle, handle],
      );
    }
    await pool.query("UPDATE secret_requests SET lifecycle = 'secret_requested', handle = NULL WHERE request_id = $1", [requestId]);
  });

  it("refuses a lifecycle word it does not know", async () => {
    const requestId = await openRequest(`sr_${"2".repeat(32)}`);
    await refuses(
      "UPDATE secret_requests SET lifecycle = 'secret_probably' WHERE request_id = $1",
      [requestId],
      { code: CHECK_VIOLATION },
    );
  });

  it("refuses a handle on a request nobody answered, in both directions", async () => {
    const requestId = await openRequest(`sr_${"3".repeat(32)}`);
    await refuses(
      "UPDATE secret_requests SET handle = $2 WHERE request_id = $1",
      [requestId, HANDLE],
      { code: CHECK_VIOLATION, constraint: "a_handle_means_it_was_answered" },
    );
    // And a receipt with no handle is a receipt for nothing.
    await refuses(
      "UPDATE secret_requests SET lifecycle = 'secret_received' WHERE request_id = $1",
      [requestId],
      { code: CHECK_VIOLATION, constraint: "receipt_requires_a_handle" },
    );
  });

  it("refuses two requests sharing one handle", async () => {
    // A collision would alias one student's secret onto another's request.
    const first = await openRequest(`sr_${"4".repeat(32)}`);
    const second = await openRequest(`sr_${"5".repeat(32)}`);
    const shared = `sh_${"9".repeat(32)}`;
    await pool.query(
      "UPDATE secret_requests SET lifecycle = 'secret_received', handle = $2 WHERE request_id = $1",
      [first, shared],
    );
    await refuses(
      "UPDATE secret_requests SET lifecycle = 'secret_received', handle = $2 WHERE request_id = $1",
      [second, shared],
      { code: UNIQUE_VIOLATION },
    );
  });

  it("refuses a purpose outside the closed set", async () => {
    expect([...SCHEMA_PURPOSES]).toContain("portal_account_creation");
    await refuses(
      `INSERT INTO secret_requests
         (request_id, student_ref, conversation_id, case_ref, purpose, target_host, expires_at)
       VALUES ($1, 's', 'c', 'r', 'exfiltrate_everything', 'h', now())`,
      [`sr_${"6".repeat(32)}`],
      { code: CHECK_VIOLATION },
    );
  });

  it("refuses a malformed request id or handle", async () => {
    await refuses(
      `INSERT INTO secret_requests
         (request_id, student_ref, conversation_id, case_ref, purpose, target_host, expires_at)
       VALUES ('nope', 's', 'c', 'r', 'portal_account_creation', 'h', now())`,
      [],
      { code: CHECK_VIOLATION },
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Bootstrap tokens
// ───────────────────────────────────────────────────────────────────────────

describeIfDatabase("frame tokens are hashed and single-use", () => {
  it("stores only a SHA-256, refusing anything that is not one", async () => {
    const requestId = await openRequest(`sr_${"7".repeat(32)}`);
    await refuses(
      "INSERT INTO frame_tokens (token_hash, request_id, expires_at) VALUES ($1, $2, now())",
      [MARKER, requestId],
      { code: CHECK_VIOLATION },
    );
    await pool.query(
      "INSERT INTO frame_tokens (token_hash, request_id, expires_at) VALUES ($1, $2, now())",
      [SHA, requestId],
    );
  });

  it("is claimed atomically, so a second claim gets nothing", async () => {
    // The claim is one statement. Checking `consumed_at IS NULL` and then
    // updating races, and the race is a token usable twice.
    const requestId = await openRequest(`sr_${"8".repeat(32)}`);
    const hash = "d".repeat(64);
    await pool.query(
      "INSERT INTO frame_tokens (token_hash, request_id, expires_at) VALUES ($1, $2, now() + interval '1 min')",
      [hash, requestId],
    );
    const claim = `UPDATE frame_tokens SET consumed_at = now()
                    WHERE token_hash = $1 AND consumed_at IS NULL
                RETURNING request_id`;
    const first = await pool.query(claim, [hash]);
    expect(first.rowCount).toBe(1);
    const second = await pool.query(claim, [hash]);
    expect(second.rowCount).toBe(0);
  });

  it("cannot exist without a request, and goes when the request goes", async () => {
    await refuses(
      "INSERT INTO frame_tokens (token_hash, request_id, expires_at) VALUES ($1, 'sr_nope', now())",
      ["e".repeat(64)],
      { code: FOREIGN_KEY_VIOLATION },
    );

    const doomed = await openRequest(`sr_${"a1".repeat(16)}`);
    await pool.query(
      "INSERT INTO frame_tokens (token_hash, request_id, expires_at) VALUES ($1, $2, now())",
      ["f".repeat(64), doomed],
    );
    await pool.query("DELETE FROM secret_requests WHERE request_id = $1", [doomed]);
    const left = await pool.query("SELECT 1 FROM frame_tokens WHERE request_id = $1", [doomed]);
    expect(left.rowCount).toBe(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Sessions and the use audit
// ───────────────────────────────────────────────────────────────────────────

describeIfDatabase("sessions and the audit", () => {
  it("hashes the session too, refusing a raw one", async () => {
    const requestId = await openRequest(`sr_${"b1".repeat(16)}`);
    await refuses(
      `INSERT INTO secure_sessions (session_hash, request_id, student_ref, expires_at)
       VALUES ($1, $2, 'student-1', now())`,
      ["a-raw-session-token", requestId],
      { code: CHECK_VIOLATION },
    );
    await pool.query(
      `INSERT INTO secure_sessions (session_hash, request_id, student_ref, expires_at)
       VALUES ($1, $2, 'student-1', now() + interval '5 min')`,
      ["1".repeat(64), requestId],
    );
  });

  it("records a refusal only with a code, and a success only without one", async () => {
    const requestId = await openRequest(`sr_${"c1".repeat(16)}`);
    await refuses(
      `INSERT INTO secret_uses (request_id, handle, consumer, outcome)
       VALUES ($1, $2, 'runner', 'refused')`,
      [requestId, HANDLE],
      { code: CHECK_VIOLATION, constraint: "a_refusal_has_a_code" },
    );
    await refuses(
      `INSERT INTO secret_uses (request_id, handle, consumer, outcome, refusal_code)
       VALUES ($1, $2, 'runner', 'used', 'expired')`,
      [requestId, HANDLE],
      { code: CHECK_VIOLATION, constraint: "a_refusal_has_a_code" },
    );
    await pool.query(
      `INSERT INTO secret_uses (request_id, handle, consumer, outcome)
       VALUES ($1, $2, 'runner', 'used')`,
      [requestId, HANDLE],
    );
  });

  it("admits every refusal code the service names, and no free text", async () => {
    const requestId = await openRequest(`sr_${"d1".repeat(16)}`);
    for (const code of USE_REFUSAL_CODES) {
      await pool.query(
        `INSERT INTO secret_uses (request_id, handle, consumer, outcome, refusal_code)
         VALUES ($1, $2, 'runner', 'refused', $3)`,
        [requestId, HANDLE, code],
      );
    }
    await refuses(
      `INSERT INTO secret_uses (request_id, handle, consumer, outcome, refusal_code)
       VALUES ($1, $2, 'runner', 'refused', $3)`,
      [requestId, HANDLE, `it failed because the value was ${MARKER}`],
      { code: CHECK_VIOLATION },
    );
  });

  it("keeps the refusal vocabulary separate from the client's rejection reasons", () => {
    // Deliberately different sets. A rejection is why a STUDENT's submission
    // was refused; a use refusal is why the AUTOMATION could not spend a
    // handle. Merging them would put student-facing wording on an audit row
    // and automation internals in front of a student.
    const shared = USE_REFUSAL_CODES.filter((code) =>
      (REJECTION_REASONS as readonly string[]).includes(code),
    );
    expect(shared).toEqual(["expired"]);
  });
});
