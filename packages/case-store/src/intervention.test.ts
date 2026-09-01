/**
 * Both intervention-store implementations, against the same contract — plus
 * the constraints that only exist once there is a database.
 *
 * Without a real PostgreSQL the Postgres half SKIPS with a loud banner, for the
 * reason the sibling suites give: "the refusal test did not run" must never
 * look like "the refusal test passed".
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import {
  beginCheckpoint,
  blueprintVersion,
  caseId as makeCaseId,
  runId as makeRunId,
  studentId,
} from "@askimate/aas-domain";

import { InMemoryInterventionStore } from "./in-memory-intervention.js";
import { PostgresInterventionStore } from "./postgres-intervention.js";
import { PostgresWorkflowRunStore } from "./postgres-workflow.js";
import { migrate } from "@askimate/aas-migrate";
import { MIGRATIONS_DIR } from "./migrations-dir.js";
import { runInterventionStoreContract } from "./intervention-contract.js";

const DATABASE_URL =
  process.env["AAS_TEST_DATABASE_URL"] ?? "postgresql://postgres@localhost:55432/postgres";
const DATABASE_REQUIRED = process.env["AAS_REQUIRE_DATABASE"] === "1";

const NOW = new Date("2026-09-01T10:00:00Z");
const VERSION = blueprintVersion("example-v1");
const STUDENT = studentId("stu_iv");
const CASE = makeCaseId("case_iv");
const RUN = makeRunId("run_stuck");

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
    `██  NOT CHECKED: the intervention store's guarantees (ADR-0048)\n` +
    `██\n` +
    `██  No PostgreSQL at ${DATABASE_URL}\n` +
    `██  "one intervention per stuck action", "a resolution is whole", and\n` +
    `██  "route_fallback is not implemented" are enforced by CONSTRAINTS.\n` +
    `██  They did NOT run.\n` +
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

/** The run an intervention hangs off. The Postgres adapter has a FK to it. */
async function seedRun(): Promise<void> {
  const runs = new PostgresWorkflowRunStore(pool);
  await runs.start({
    runId: RUN,
    caseId: CASE,
    studentRef: STUDENT,
    status: "running",
    checkpoint: beginCheckpoint({ blueprintVersion: VERSION, now: NOW }),
    startedAt: NOW,
  });
}

beforeAll(async () => {
  if (!HAVE_DATABASE) return;
  pool = await ownDatabase("aas_intervention_store");
  await migrate(pool, MIGRATIONS_DIR);
}, 120_000);

afterAll(async () => {
  if (HAVE_DATABASE) await pool.end();
});

// ───────────────────────────────────────────────────────────────────────────
// The same contract, both implementations
// ───────────────────────────────────────────────────────────────────────────

runInterventionStoreContract("InMemoryInterventionStore", () =>
  Promise.resolve({ store: new InMemoryInterventionStore(), runId: RUN }),
);

if (HAVE_DATABASE) {
  runInterventionStoreContract("PostgresInterventionStore", async () => {
    // A FRESH, EMPTY store, exactly as the contract documents. Interventions
    // first: they reference runs.
    await pool.query("TRUNCATE interventions, workflow_action_intents, workflow_runs");
    await seedRun();
    return { store: new PostgresInterventionStore(pool), runId: RUN };
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Constraints that only exist once there is a database
// ───────────────────────────────────────────────────────────────────────────

describeIfDatabase("the interventions schema", () => {
  /** Full statement, no clever composition — the first draft of this helper
   *  produced an unbalanced paren and every test "failed" on a syntax error
   *  rather than on the constraint it was written to prove. A refusal test
   *  that passes for the wrong reason is worse than no test. */
  const insert = (sql: string): Promise<unknown> => pool.query(sql);

  const HEAD = `INSERT INTO interventions
        (intervention_id, run_id, idempotency_key, case_id, student_ref, reason, priority,
         encountered, expected, checkpoint, context, raised_at, lifecycle`;
  const OPEN = `'unverified_consequential_action', 'critical', 'e', 'x',
                '{}'::jsonb, '{}'::jsonb, now(), 'captured'`;

  beforeAll(async () => {
    await pool.query("TRUNCATE interventions, workflow_action_intents, workflow_runs");
    await seedRun();
  });

  it("REFUSES a half-written resolution", async () => {
    // A resolution with a specialist but no time reads as certainty nobody
    // supplied.
    await expect(
      insert(`${HEAD}, specialist_id)
              VALUES ('iv_half', '${RUN}', 'k_half', 'case_iv', 'stu_iv', ${OPEN}, 'someone')`),
    ).rejects.toThrow(/interventions_resolution_is_whole/);
  });

  it("REFUSES route_fallback at the database, not only at the parser", async () => {
    // ADR-0048 §4. A refusal that lives only in application code is one caller
    // away from being bypassed.
    await expect(
      insert(`${HEAD}, specialist_id, actions_taken, resolution, resolution_outcome,
                     resolved_at, reusability)
              VALUES ('iv_rf', '${RUN}', 'k_rf', 'case_iv', 'stu_iv', ${OPEN},
                      's', 'a', 'r', 'route_fallback', now(), '{}'::jsonb)`),
    ).rejects.toThrow(/interventions_route_fallback_is_not_implemented/);
  });

  it("ACCEPTS resume and abandon, so the CHECK is not simply refusing everything", async () => {
    // The other half of a refusal test. A constraint that rejected every
    // outcome would pass both tests above while breaking the feature.
    for (const [id, outcome] of [
      ["iv_ok_resume", "resume"],
      ["iv_ok_abandon", "abandon"],
    ] as const) {
      await insert(`${HEAD}, specialist_id, actions_taken, resolution, resolution_outcome,
                           resolved_at, reusability)
                    VALUES ('${id}', '${RUN}', 'k_${id}', 'case_iv', 'stu_iv', ${OPEN},
                            's', 'a', 'r', '${outcome}', now(), '{}'::jsonb)`);
    }
    const found = await pool.query<{ n: string }>(
      "SELECT count(*) AS n FROM interventions WHERE resolution_outcome IN ('resume','abandon')",
    );
    expect(found.rows[0]?.n).toBe("2");
  });

  it("REFUSES a second intervention for one stuck action", async () => {
    await insert(`${HEAD})
                  VALUES ('iv_first', '${RUN}', 'k_dup', 'case_iv', 'stu_iv', ${OPEN})`);
    await expect(
      insert(`${HEAD})
              VALUES ('iv_second', '${RUN}', 'k_dup', 'case_iv', 'stu_iv', ${OPEN})`),
    ).rejects.toThrow(/interventions_one_per_stuck_action/);
  });

  it("REFUSES an intervention for a run that does not exist", async () => {
    await expect(
      insert(`${HEAD})
              VALUES ('iv_orphan', 'run_never', 'k_orphan', 'case_iv', 'stu_iv', ${OPEN})`),
    ).rejects.toThrow(/foreign key/i);
  });
});
