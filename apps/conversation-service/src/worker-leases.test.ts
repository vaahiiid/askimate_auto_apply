/**
 * The background worker's claiming mechanism (ADR-0052 §3, §13.2).
 *
 * Against a real PostgreSQL, because every property here is enforced by a
 * CONSTRAINT rather than by a check somebody wrote — a primary key, a
 * conditional `ON CONFLICT`, a `CHECK`. A fake would be re-implementing the
 * thing under test, which is the argument `with-postgres.sh` already makes
 * about `packages/case-store`.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import { migrate } from "@askimate/aas-migrate";
import { announceSkip, databaseReachable, TEST_DATABASE_URL } from "@askimate/aas-migrate/testing";

import { MIGRATIONS_DIR } from "./index.js";
import { DEFAULT_WORKER_LEASE_SECONDS, WorkerLeaseStore } from "./worker-leases.js";

const NOW = new Date("2026-09-02T10:00:00Z");

const HAVE_DATABASE = await databaseReachable();
if (!HAVE_DATABASE) announceSkip("the worker lease store");
const describeIfDatabase = HAVE_DATABASE ? describe : describe.skip;

let pool: pg.Pool;
let leases: WorkerLeaseStore;

beforeAll(async () => {
  if (!HAVE_DATABASE) return;
  const admin = new pg.Pool({ connectionString: TEST_DATABASE_URL });
  try {
    await admin.query("DROP DATABASE IF EXISTS aas_worker_leases WITH (FORCE)");
    await admin.query("CREATE DATABASE aas_worker_leases");
  } finally {
    await admin.end();
  }
  const url = new URL(TEST_DATABASE_URL);
  url.pathname = "/aas_worker_leases";
  pool = new pg.Pool({ connectionString: url.toString(), max: 6 });
  await migrate(pool, MIGRATIONS_DIR);
  leases = new WorkerLeaseStore(pool);
}, 120_000);

afterAll(async () => {
  if (HAVE_DATABASE) await pool.end();
});

describeIfDatabase("one worker holds a job at a time", () => {
  it("claims a free job", async () => {
    const held = await leases.claim({ job: "advance_runs", holder: "worker-1", now: NOW });
    expect(held).not.toBeNull();
    expect(held?.holder).toBe("worker-1");
    expect(held?.expiresAt.getTime()).toBe(
      NOW.getTime() + DEFAULT_WORKER_LEASE_SECONDS * 1000,
    );
  });

  it("REFUSES a second worker while the first still holds it", async () => {
    // ═══════════════════════════════════════════════════════════════════
    // The property this table exists for, and it is the database that
    // enforces it: both callers INSERT, `ON CONFLICT … DO UPDATE … WHERE`
    // sees a lease that has not lapsed, and the second updates no row.
    // Not a check in a handler — impossible rather than unlikely.
    // ═══════════════════════════════════════════════════════════════════
    const second = await leases.claim({ job: "advance_runs", holder: "worker-2", now: NOW });
    expect(second, "somebody else is holding it").toBeNull();

    const live = await leases.held("advance_runs", NOW);
    expect(live?.holder, "and the first is still the holder").toBe("worker-1");
  });

  it("does not confuse one job with another", async () => {
    // The key is the JOB KIND, so a worker holding `advance_runs` does not
    // block `announce_interventions`. That is the whole reason this is not
    // `work_leases`, whose key is a run.
    const other = await leases.claim({
      job: "announce_interventions",
      holder: "worker-2",
      now: NOW,
    });
    expect(other).not.toBeNull();
    expect(other?.holder).toBe("worker-2");
  });

  it("lets the SAME worker extend its own lease without waiting", async () => {
    // Every tick re-claims. A worker must be able to extend the lease it
    // already holds, or its second tick would find its own lease in the way —
    // which is what makes the no-renewal design (§13.2) work at all.
    const mine = await leases.held("advance_runs", NOW);
    const soon = new Date(NOW.getTime() + 10_000);
    const extended = await leases.claim({
      job: "advance_runs",
      holder: "worker-1",
      now: soon,
      holding: mine?.leaseId ?? "",
    });

    expect(extended, "my own lease, extended").not.toBeNull();
    expect(extended?.expiresAt.getTime()).toBe(
      soon.getTime() + DEFAULT_WORKER_LEASE_SECONDS * 1000,
    );
    expect(extended?.leaseId, "and a fresh id, as every claim mints one").not.toBe(mine?.leaseId);
  });

  it("REFUSES a worker presenting a lease id it does not hold", async () => {
    // The stale-holder case: a worker that was superseded while it worked
    // presents an id nobody holds any more. Without the `lease_id` check in
    // the WHERE, that would be a way past the lease entirely.
    const impostor = await leases.claim({
      job: "advance_runs",
      holder: "worker-3",
      now: NOW,
      holding: "wl_00000000000000000000000000000000",
    });
    expect(impostor).toBeNull();
  });

  it("lets ANOTHER worker take over once the lease has lapsed", async () => {
    // ═══════════════════════════════════════════════════════════════════
    // The whole of crash recovery (ADR-0052 §10). A worker that dies stops
    // re-claiming; its lease lapses; another takes the job. There is no
    // heartbeat, no liveness table and no renewal timer — the absence of a
    // mechanism, which is why there is nothing here to fail.
    // ═══════════════════════════════════════════════════════════════════
    const afterLapse = new Date(NOW.getTime() + (DEFAULT_WORKER_LEASE_SECONDS + 120) * 1000);
    const taken = await leases.claim({
      job: "advance_runs",
      holder: "worker-4",
      now: afterLapse,
    });

    expect(taken, "the dead worker's lease had lapsed").not.toBeNull();
    expect(taken?.holder).toBe("worker-4");
  });

  it("an EXPIRED lease is not a lease", async () => {
    const wayLater = new Date(NOW.getTime() + 86_400_000);
    expect(await leases.held("advance_runs", wayLater)).toBeNull();
  });

  it("release gives it back immediately, and only to its holder", async () => {
    // After every lease this group has taken has lapsed, so this claim is
    // about `release` and not about who happens to hold the job by now.
    const later = new Date(NOW.getTime() + 86_400_000);
    const mine = await leases.claim({ job: "advance_runs", holder: "worker-5", now: later });
    if (mine === null) expect.unreachable("every earlier lease had lapsed by now");

    // Somebody else's id releases nothing — a superseded worker must not be
    // able to hand away the lease its successor now holds.
    await leases.release("advance_runs", "wl_ffffffffffffffffffffffffffffffff");
    expect(await leases.held("advance_runs", later), "still held").not.toBeNull();

    await leases.release("advance_runs", mine.leaseId);
    expect(await leases.held("advance_runs", later), "given back").toBeNull();
  });

  it("REFUSES a job kind outside the closed set", async () => {
    // The CHECK constraint, so a typo is a failed insert rather than a lease
    // nobody notices is orphaned.
    await expect(
      pool.query(
        `INSERT INTO worker_leases (job_kind, lease_id, holder, claimed_at, expires_at)
              VALUES ('drain_the_swamp', 'wl_x', 'worker-1', $1, $2)`,
        [NOW, new Date(NOW.getTime() + 60_000)],
      ),
    ).rejects.toThrow(/worker_leases_job_kind_check/);
  });

  it("REFUSES a lease that starts already spent", async () => {
    await expect(
      pool.query(
        `INSERT INTO worker_leases (job_kind, lease_id, holder, claimed_at, expires_at)
              VALUES ('advance_runs', 'wl_y', 'worker-1', $1, $1)`,
        [NOW],
      ),
    ).rejects.toThrow(/worker_leases_cannot_start_spent/);
  });

  it("holds NO business fact — the table's columns are the whole of it", async () => {
    // ═══════════════════════════════════════════════════════════════════
    // The argument that this is not a second source of truth, asserted
    // rather than promised in a comment. If a `run_id`, a `case_id`, a
    // status or a payload ever appears here, this test fails and whoever
    // added it has to make the case in an ADR.
    // ═══════════════════════════════════════════════════════════════════
    const columns = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'worker_leases' ORDER BY column_name`,
    );
    expect(columns.rows.map((row) => row.column_name)).toEqual([
      "claimed_at",
      "expires_at",
      "holder",
      "job_kind",
      "lease_id",
    ]);
  });
});
