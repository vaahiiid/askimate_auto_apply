/**
 * Both workflow-store implementations, against the same contract — plus the
 * hazards that only exist once there is a database.
 *
 * Without a real PostgreSQL the Postgres half SKIPS with a loud banner. "The
 * recovery test did not run" must never look like "the recovery test passed".
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import {
  beginCheckpoint,
  blueprintVersion,
  caseId as makeCaseId,
  idempotencyKeyFor,
  runId as makeRunId,
  studentId,
} from "@askimate/aas-domain";
import type { WorkflowRunRecord } from "@askimate/aas-domain";

import { InMemoryWorkflowRunStore } from "./in-memory-workflow.js";
import { PostgresWorkflowRunStore } from "./postgres-workflow.js";
import { migrate } from "./migrate.js";
import { runWorkflowStoreContract } from "./workflow-contract.js";
import { RunConcurrencyError } from "./workflow-store.js";

const DATABASE_URL =
  process.env["AAS_TEST_DATABASE_URL"] ?? "postgresql://postgres@localhost:55432/postgres";
const DATABASE_REQUIRED = process.env["AAS_REQUIRE_DATABASE"] === "1";

const NOW = new Date("2026-08-27T10:00:00Z");
const VERSION = blueprintVersion("ulster-msc-ib-v3");
const STUDENT = studentId("stu_001");
const CASE = makeCaseId("case_wf");

async function reachable(): Promise<boolean> {
  const probe = new pg.Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 2_000 });
  try {
    await probe.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await probe.end().catch(() => undefined);
  }
}

const HAVE_DATABASE = await reachable();
if (!HAVE_DATABASE) {
  const banner =
    `\n${"█".repeat(78)}\n` +
    `██  NOT CHECKED: the workflow run store's durability guarantees\n` +
    `██\n` +
    `██  No PostgreSQL at ${DATABASE_URL}\n` +
    `██  Concurrent-resume prevention and checkpoint durability are enforced\n` +
    `██  by CONSTRAINTS and transactions. They did NOT run.\n` +
    `██\n` +
    `██  To run them:   pnpm run verify:integration\n` +
    `${"█".repeat(78)}\n`;
  if (DATABASE_REQUIRED) throw new Error(banner);
  console.warn(banner);
}

const describeIfDatabase = HAVE_DATABASE ? describe : describe.skip;

let pool: pg.Pool;

async function ownDatabase(name: string): Promise<pg.Pool> {
  const admin = new pg.Pool({ connectionString: DATABASE_URL });
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }
  const url = new URL(DATABASE_URL);
  url.pathname = `/${name}`;
  return new pg.Pool({ connectionString: url.toString() });
}

beforeAll(async () => {
  if (!HAVE_DATABASE) return;
  pool = await ownDatabase("aas_workflow_store");
  await migrate(pool);
}, 120_000);

afterAll(async () => {
  if (HAVE_DATABASE) await pool.end();
});

// ───────────────────────────────────────────────────────────────────────────
// The same contract, both implementations
// ───────────────────────────────────────────────────────────────────────────

runWorkflowStoreContract("InMemoryWorkflowRunStore", () => new InMemoryWorkflowRunStore());

if (HAVE_DATABASE) {
  runWorkflowStoreContract("PostgresWorkflowRunStore", async () => {
    // A FRESH, EMPTY store, exactly as the contract documents. The CaseStore
    // contract said the same and ignoring it cost six failing tests in 0.2.0.
    // Intents first: they reference runs.
    await pool.query("TRUNCATE workflow_action_intents, workflow_runs");
    return new PostgresWorkflowRunStore(pool);
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Hazards that only exist once there is a database
// ───────────────────────────────────────────────────────────────────────────

describeIfDatabase("a checkpoint read back from JSONB", () => {
  const fresh = (id: string): Omit<WorkflowRunRecord, "revision" | "updatedAt"> => ({
    runId: makeRunId(id),
    caseId: CASE,
    studentRef: STUDENT,
    status: "running",
    checkpoint: beginCheckpoint({ blueprintVersion: VERSION, now: NOW }),
    startedAt: NOW,
  });

  it("brings its Dates back as Dates", async () => {
    await pool.query("TRUNCATE workflow_action_intents, workflow_runs");
    const store = new PostgresWorkflowRunStore(pool);
    await store.start(fresh("run_dates"));

    const loaded = await store.load(makeRunId("run_dates"));
    expect(loaded?.checkpoint.capturedAt).toBeInstanceOf(Date);
    expect(loaded?.checkpoint.capturedAt.getTime()).toBe(NOW.getTime());
  }, 60_000);

  it("DISCARDS a checkpoint written by a future build", async () => {
    // The one place untyped data enters. A checkpoint this build cannot read
    // is reset to the start, never guessed at — a half-understood resume point
    // produces confident wrong behaviour on a real application.
    await pool.query("TRUNCATE workflow_action_intents, workflow_runs");
    const store = new PostgresWorkflowRunStore(pool);
    await store.start(fresh("run_future"));

    await pool.query(
      `UPDATE workflow_runs SET checkpoint = $1::jsonb WHERE run_id = 'run_future'`,
      [JSON.stringify({ schemaVersion: 99, phase: "filling", fieldsCompleted: ["a"] })],
    );

    const loaded = await store.load(makeRunId("run_future"));
    expect(loaded).not.toBeNull();
    expect(loaded?.checkpoint.phase).toBe("preparing_inputs");
    expect(loaded?.checkpoint.fieldsCompleted).toEqual([]);
    // Identity survives — only position was lost.
    expect(loaded?.caseId).toBe(CASE);
  }, 60_000);

  it("DISCARDS a corrupt checkpoint rather than crashing", async () => {
    await pool.query("TRUNCATE workflow_action_intents, workflow_runs");
    const store = new PostgresWorkflowRunStore(pool);
    await store.start(fresh("run_corrupt"));

    for (const corrupt of ['"a string"', "42", "null", '{"nonsense": true}', "[]"]) {
      await pool.query(
        `UPDATE workflow_runs SET checkpoint = $1::jsonb WHERE run_id = 'run_corrupt'`,
        [corrupt],
      );
      const loaded = await store.load(makeRunId("run_corrupt"));
      expect(loaded, corrupt).not.toBeNull();
      expect(loaded?.checkpoint.phase, corrupt).toBe("preparing_inputs");
    }
  }, 60_000);

  it("survives a completely new connection pool — the point of the adapter", async () => {
    await pool.query("TRUNCATE workflow_action_intents, workflow_runs");
    const store = new PostgresWorkflowRunStore(pool);
    await store.start(fresh("run_restart"));
    await store.saveCheckpoint({
      runId: makeRunId("run_restart"),
      checkpoint: {
        schemaVersion: 1,
        phase: "filling",
        fieldsCompleted: ["given_name", "family_name"],
        blueprintVersion: VERSION,
        detail: { pageIndex: 2 },
        capturedAt: NOW,
      },
      expectedRevision: 0,
    });

    const url = new URL(DATABASE_URL);
    url.pathname = "/aas_workflow_store";
    const reopened = new pg.Pool({ connectionString: url.toString() });
    try {
      const after = await new PostgresWorkflowRunStore(reopened).load(makeRunId("run_restart"));
      expect(after?.checkpoint.fieldsCompleted).toEqual(["given_name", "family_name"]);
      expect(after?.checkpoint.phase).toBe("filling");
      expect(after?.revision).toBe(1);
    } finally {
      await reopened.end();
    }
  }, 60_000);

  it("gives every loser of a crowded resume a RunConcurrencyError", async () => {
    // Two can pass by luck; eight cannot — the lesson from C1, where a racing
    // claimSubmissionKey prevented the duplicate but reported a raw driver
    // error that looked transient and invited exactly the retry that must not
    // happen.
    await pool.query("TRUNCATE workflow_action_intents, workflow_runs");
    const store = new PostgresWorkflowRunStore(pool);
    await store.start(fresh("run_crowd"));

    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_unused, index) =>
        store.saveCheckpoint({
          runId: makeRunId("run_crowd"),
          checkpoint: {
            schemaVersion: 1,
            phase: "filling",
            fieldsCompleted: [`field_${String(index)}`],
            blueprintVersion: VERSION,
            detail: {},
            capturedAt: NOW,
          },
          expectedRevision: 0,
        }),
      ),
    );

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    for (const result of results) {
      if (result.status === "fulfilled") continue;
      expect(result.reason).toBeInstanceOf(RunConcurrencyError);
    }
  }, 60_000);

  it("refuses a half-written completion at the DATABASE level", async () => {
    // An outcome with no timestamp, or a timestamp with no outcome, reads as
    // certainty the system does not have. The CHECK constraint is what makes
    // that impossible rather than merely discouraged.
    await pool.query("TRUNCATE workflow_action_intents, workflow_runs");
    const store = new PostgresWorkflowRunStore(pool);
    await store.start(fresh("run_half"));
    const key = idempotencyKeyFor({
      runId: makeRunId("run_half"),
      action: "create_portal_account",
      target: "apply.example.ac.uk",
    });
    await store.recordIntent(makeRunId("run_half"), {
      idempotencyKey: key,
      action: "create_portal_account",
      target: "apply.example.ac.uk",
      startedAt: NOW,
    });

    await expect(
      pool.query(`UPDATE workflow_action_intents SET outcome = 'succeeded' WHERE run_id = 'run_half'`),
    ).rejects.toThrow(/completion_is_whole/);
  }, 60_000);
});
