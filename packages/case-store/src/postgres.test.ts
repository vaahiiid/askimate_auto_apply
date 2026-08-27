/**
 * The Postgres store, against the SAME contract as the in-memory one, plus the
 * hazards that only exist once there is a database.
 *
 * ── Why this needs a real PostgreSQL and not a fake ───────────────────────
 *
 * The two guarantees that matter here are enforced by *constraints*:
 * `PRIMARY KEY (case_id, "sequence")` and `PRIMARY KEY (submission_key)`. A
 * fake, a mock, or an in-memory shim would be re-implementing the very thing
 * under test, and would pass whether or not the real schema had them.
 *
 * The contract's two `Promise.allSettled` tests — *"lets only one of two
 * concurrent writers win"* — are meaningless without a real transaction
 * manager. Those are the tests this adapter exists to satisfy.
 *
 * Without a database the suite SKIPS with a loud banner. "The durability test
 * did not run" must never look like "the durability test passed".
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import {
  caseId as makeCaseId,
  courseId,
  eventId,
  externalRef,
  institutionId,
  intake,
  openCase,
  stamp,
  studentId,
  submissionKey,
} from "@askimate/aas-domain";
import type { CaseEvent, RequestEvidence, SubmissionIdentity } from "@askimate/aas-domain";

import { runCaseStoreContract } from "./contract.js";
import { DuplicateSubmissionError } from "./store.js";
import { decodeEvent, encodeEvent } from "./serialisation.js";
import { MigrationChangedError, loadMigrations, migrate } from "./migrate.js";
import { PostgresCaseStore } from "./postgres.js";

const DATABASE_URL =
  process.env["AAS_TEST_DATABASE_URL"] ?? "postgresql://postgres@localhost:55432/postgres";
const DATABASE_REQUIRED = process.env["AAS_REQUIRE_DATABASE"] === "1";

async function reachable(): Promise<boolean> {
  const pool = new pg.Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 2_000 });
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

const HAVE_DATABASE = await reachable();
if (!HAVE_DATABASE) {
  const banner =
    `\n${"█".repeat(78)}\n` +
    `██  NOT CHECKED: the Postgres case store's durability guarantees\n` +
    `██\n` +
    `██  No PostgreSQL at ${DATABASE_URL}\n` +
    `██  Optimistic concurrency and duplicate-submission prevention are\n` +
    `██  enforced by CONSTRAINTS. They did NOT run. A green suite below does\n` +
    `██  not mean those guarantees hold.\n` +
    `██\n` +
    `██  To run them:   pnpm run verify:integration\n` +
    `${"█".repeat(78)}\n`;
  if (DATABASE_REQUIRED) throw new Error(banner);
  console.warn(banner);
}

const describeIfDatabase = HAVE_DATABASE ? describe : describe.skip;

let pool: pg.Pool;

/**
 * A database of this suite's own.
 *
 * The chat-integration tests learned this the hard way: two files sharing one
 * database and dropping each other's tables is a real, intermittent failure,
 * and an intermittent failure in a durability test is worse than no test —
 * people re-run it until it passes.
 */
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
  pool = await ownDatabase("aas_case_store");
  await migrate(pool);
}, 120_000);

afterAll(async () => {
  if (HAVE_DATABASE) await pool.end();
});

// ───────────────────────────────────────────────────────────────────────────
// The shared contract — the whole point of this adapter
// ───────────────────────────────────────────────────────────────────────────

if (HAVE_DATABASE) {
  runCaseStoreContract("PostgresCaseStore", async () => {
    // ── A FRESH, EMPTY store, exactly as the contract documents ──────────
    //
    // I first tried sharing the database without truncating, on the reasoning
    // that the contract gives every test its own case id so leftover rows are
    // harmless — and that a store which behaves correctly with other cases'
    // rows present is the stronger test.
    //
    // That reasoning was wrong, and the contract had already said so: `make`
    // is documented as returning *a FRESH, empty store*. Case ids are unique
    // per test, but the SUBMISSION KEY is derived from a fixed identity and is
    // therefore the same in every test — so a key claimed by test N was still
    // claimed in test N+1, and six tests failed.
    //
    // The "other rows present" property is worth having, and it is covered by
    // the durability tests below, which write into a database that the whole
    // contract suite has already filled.
    await pool.query("TRUNCATE case_events, submission_keys");
    return new PostgresCaseStore(pool);
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Serialisation — the hazard that only exists once there is a database
// ───────────────────────────────────────────────────────────────────────────

const IDENTITY: SubmissionIdentity = {
  studentId: studentId("stu_001"),
  institutionId: institutionId("inst_ulster"),
  courseId: courseId("crs_msc_ib"),
  intake: intake("2026-09"),
  attemptOrdinal: 1,
};

const REQUESTED_AT = new Date("2026-08-26T10:14:22Z");
const OCCURRED_AT = new Date("2026-08-26T10:15:00Z");

const EVIDENCE: RequestEvidence = {
  requestedAt: REQUESTED_AT,
  channel: "askimate_chat",
  studentStatement: "Yes, please apply to Ulster for me.",
};

function opening(): CaseEvent {
  const id = makeCaseId("case_serialisation");
  const events = stamp({
    caseId: id,
    fromSequence: 0,
    payloads: [openCase({ submissionIdentity: IDENTITY, requestEvidence: EVIDENCE })],
    actor: { kind: "askimate", externalRef: externalRef("askimate:user:1") },
    now: OCCURRED_AT,
    nextEventId: () => eventId("evt_1"),
  });
  const first = events[0];
  if (first === undefined) throw new Error("stamp produced nothing");
  return first;
}

describe("an event survives the round trip with its Dates intact", () => {
  it("brings back a Date, not a string", () => {
    // ── The bug this prevents ────────────────────────────────────────────
    //
    // `JSON.parse(JSON.stringify(event))` returns every Date as a string. It
    // typechecks (the value comes back as `unknown` and is cast), it passes a
    // shallow equality test, and then `expiresAt.getTime()` throws in
    // production — or worse, `a < b` on two ISO strings happens to work often
    // enough to hide the problem for months.
    const restored = decodeEvent(encodeEvent(opening()));

    expect(restored.occurredAt).toBeInstanceOf(Date);
    expect(restored.occurredAt.getTime()).toBe(OCCURRED_AT.getTime());

    // Nested, inside the payload the envelope is intersected with.
    const evidence = (restored as unknown as { requestEvidence: { requestedAt: unknown } })
      .requestEvidence;
    expect(evidence.requestedAt).toBeInstanceOf(Date);
    expect((evidence.requestedAt as Date).getTime()).toBe(REQUESTED_AT.getTime());
  });

  it("shows that a NAIVE round trip would have lost them — so this is not passing for free", () => {
    const naive = JSON.parse(JSON.stringify(opening())) as { occurredAt: unknown };
    expect(typeof naive.occurredAt).toBe("string");
    expect(naive.occurredAt).not.toBeInstanceOf(Date);
  });

  it("does NOT convert a string that merely looks like a date", () => {
    // ── Why tagging, rather than a "revive anything ISO-shaped" reviver ──
    //
    // This system stores `ProposedValue.verbatim` — text quoted VERBATIM from
    // a student's document. A passport date of birth quoted as "1999-04-02"
    // must come back as the string the document showed. A reviver that
    // converted it would break the grounding check that compares a reading
    // against the document text, by comparing a Date to a string.
    const restored = decodeEvent(
      encodeEvent({
        ...opening(),
        verbatim: "1999-04-02",
        alsoText: "2026-08-26T10:15:00Z",
      } as unknown as CaseEvent),
    ) as unknown as { verbatim: unknown; alsoText: unknown };

    expect(restored.verbatim).toBe("1999-04-02");
    expect(typeof restored.alsoText).toBe("string");
  });

  it("refuses to store an Invalid Date rather than writing null", () => {
    // An Invalid Date serialises to `null`, which is indistinguishable from an
    // absent field on the way back. An event log that cannot say when something
    // happened is not a record of anything.
    expect(() =>
      encodeEvent({ ...opening(), occurredAt: new Date("nonsense") }),
    ).toThrow(/Invalid Date/i);
  });

  it("handles arrays and nested structures", () => {
    const restored = decodeEvent(
      encodeEvent({
        ...opening(),
        list: [{ at: OCCURRED_AT }, { at: REQUESTED_AT }],
      } as unknown as CaseEvent),
    );
    const list = (restored as unknown as { list: { at: unknown }[] }).list;
    expect(list[0]?.at).toBeInstanceOf(Date);
    expect(list[1]?.at).toBeInstanceOf(Date);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Migrations
// ───────────────────────────────────────────────────────────────────────────

describe("the migration runner", () => {
  it("loads the numbered migrations in order", () => {
    const migrations = loadMigrations();
    expect(migrations.length).toBeGreaterThan(0);
    expect(migrations[0]?.version).toBe("0001_case_events");
    expect([...migrations].map((m) => m.version)).toEqual(
      [...migrations].map((m) => m.version).sort(),
    );
  });

  it("gives every migration a checksum of its contents", () => {
    const [first] = loadMigrations();
    expect(first?.checksum).toMatch(/^[0-9a-f]{64}$/);
  });
});

describeIfDatabase("the migration runner, against a real database", () => {
  it("applies migrations once, and is idempotent", async () => {
    const fresh = await ownDatabase("aas_migrate_once");
    try {
      const first = await migrate(fresh);
      expect(first).toContain("0001_case_events");

      // Running again applies nothing. A runner that re-ran migrations would
      // fail on the second CREATE TABLE, or worse, succeed because of
      // IF NOT EXISTS and hide that it had no idea what was applied.
      const second = await migrate(fresh);
      expect(second).toEqual([]);
    } finally {
      await fresh.end();
    }
  }, 60_000);

  it("REFUSES to run when an applied migration has been edited", async () => {
    // The failure this exists to catch: someone edits 0001 to add a column, it
    // applies cleanly on their empty laptop database, and does nothing at all
    // in every environment where 0001 already ran.
    const fresh = await ownDatabase("aas_migrate_edited");
    try {
      await migrate(fresh);
      await fresh.query("UPDATE schema_migrations SET checksum = 'tampered'");
      await expect(migrate(fresh)).rejects.toThrow(MigrationChangedError);
    } finally {
      await fresh.end();
    }
  }, 60_000);

  it("creates the constraints the guarantees actually depend on", async () => {
    // Not a re-test of the contract — a check that the SCHEMA carries the
    // guarantee, so a future migration that dropped a primary key fails here
    // rather than showing up as an intermittent duplicate submission.
    const rows = await pool.query<{ table_name: string; constraint_type: string }>(
      `SELECT table_name, constraint_type FROM information_schema.table_constraints
       WHERE table_schema = 'public' AND constraint_type = 'PRIMARY KEY'`,
    );
    const tables = rows.rows.map((row) => row.table_name);
    expect(tables).toContain("case_events");
    expect(tables).toContain("submission_keys");
  }, 60_000);
});

// ───────────────────────────────────────────────────────────────────────────
// Durability across a restart — what the in-memory store cannot do
// ───────────────────────────────────────────────────────────────────────────

describeIfDatabase("the loser of a race is told WHY it lost", () => {
  /**
   * ── The hole this closes, found by regression-testing my own tests ─────
   *
   * I deliberately rewrote `claimSubmissionKey` as the racing version —
   * SELECT, then INSERT if unheld — and **all 33 tests still passed**.
   *
   * The contract's *"lets only one of two concurrent claimants win"* counts
   * fulfilled promises, and the racing version does let exactly one win: both
   * callers see the key unheld, both INSERT, and the primary key rejects the
   * second. The duplicate really is prevented, by the constraint.
   *
   * What the racing version gets wrong is the ERROR. The loser receives a raw
   * `pg` error with `code: "23505"` instead of `DuplicateSubmissionError`, and
   * that difference decides what the caller does next. A driver error looks
   * transient — connection trouble, deadlock, something to retry — and
   * retrying a submission claim is precisely the behaviour the second line of
   * defence exists to prevent. `DuplicateSubmissionError` says *stop, someone
   * else has this*.
   *
   * So the guarantee is intact under the regression and the DIAGNOSIS is not,
   * and a caller acting on a bad diagnosis is how a duplicate submission would
   * actually happen.
   */
  it("gives the concurrent loser a DuplicateSubmissionError, not a driver error", async () => {
    await pool.query("TRUNCATE submission_keys");
    const store = new PostgresCaseStore(pool);
    const key = submissionKey({ ...IDENTITY, attemptOrdinal: 42 });

    const results = await Promise.allSettled([
      store.claimSubmissionKey(key, makeCaseId("case_racer_a")),
      store.claimSubmissionKey(key, makeCaseId("case_racer_b")),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);

    const rejected = results.find((r) => r.status === "rejected");
    expect(rejected).toBeDefined();
    const reason: unknown = (rejected as PromiseRejectedResult).reason;

    // The assertion the contract does not make.
    expect(reason).toBeInstanceOf(DuplicateSubmissionError);
    expect((reason as Error).name).toBe("DuplicateSubmissionError");
    // And it names who actually holds it, so the caller can say so.
    expect((reason as DuplicateSubmissionError).existingCaseId).toMatch(/^case_racer_[ab]$/);
    // Not a raw driver error.
    expect((reason as { code?: unknown }).code).toBeUndefined();
  }, 60_000);

  it("gives the same answer under heavier contention", async () => {
    // Two callers can pass by luck. Eight cannot.
    await pool.query("TRUNCATE submission_keys");
    const store = new PostgresCaseStore(pool);
    const key = submissionKey({ ...IDENTITY, attemptOrdinal: 43 });

    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_unused, index) =>
        store.claimSubmissionKey(key, makeCaseId(`case_crowd_${String(index)}`)),
      ),
    );

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const result of results) {
      if (result.status === "fulfilled") continue;
      expect(result.reason).toBeInstanceOf(DuplicateSubmissionError);
    }
  }, 60_000);
});

describeIfDatabase("what survives the process going away", () => {
  it("keeps a case log across a completely new connection pool", async () => {
    // The reason this adapter exists. From the repo's own analysis: in-memory
    // persistence "does not survive the applicant going away for two days to
    // find their passport — so it blocks the second run".
    const id = makeCaseId("case_restart");
    const store = new PostgresCaseStore(pool);
    await store.append(
      id,
      0,
      stamp({
        caseId: id,
        fromSequence: 0,
        payloads: [openCase({ submissionIdentity: IDENTITY, requestEvidence: EVIDENCE })],
        actor: { kind: "askimate", externalRef: externalRef("askimate:user:1") },
        now: OCCURRED_AT,
        nextEventId: () => eventId("evt_restart_1"),
      }),
    );

    // A new pool: new sockets, new server-side sessions, nothing shared with
    // the writer but the database itself.
    const url = new URL(DATABASE_URL);
    url.pathname = "/aas_case_store";
    const reopened = new pg.Pool({ connectionString: url.toString() });
    try {
      const after = new PostgresCaseStore(reopened);
      const log = await after.read(id);
      expect(log).toHaveLength(1);
      expect(await after.currentSequence(id)).toBe(1);
      // And the Dates are still Dates on the far side.
      expect(log[0]?.occurredAt).toBeInstanceOf(Date);
      expect(log[0]?.occurredAt.getTime()).toBe(OCCURRED_AT.getTime());
    } finally {
      await reopened.end();
    }
  }, 60_000);

  it("keeps a submission-key claim across a new pool", async () => {
    const id = makeCaseId("case_key_restart");
    const key = submissionKey({ ...IDENTITY, attemptOrdinal: 7 });
    await new PostgresCaseStore(pool).claimSubmissionKey(key, id);

    const url = new URL(DATABASE_URL);
    url.pathname = "/aas_case_store";
    const reopened = new pg.Pool({ connectionString: url.toString() });
    try {
      // The whole point of the second line of defence: it must survive the
      // process that made the first claim. An in-memory map does not.
      expect(await new PostgresCaseStore(reopened).findBySubmissionKey(key)).toBe(id);
    } finally {
      await reopened.end();
    }
  }, 60_000);
});
