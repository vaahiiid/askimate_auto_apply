import { afterAll, beforeAll, describe, expect, it } from "vitest";

import pg from "pg";

import { migrate } from "@askimate/aas-migrate";
import { announceSkip, databaseReachable, TEST_DATABASE_URL } from "@askimate/aas-migrate/testing";

import { DataDeletionRequestStore } from "./data-deletion-request-store.js";
import { MIGRATIONS_DIR } from "./index.js";

const NOW = new Date("2026-10-03T12:00:00Z");
const LATER = new Date("2026-10-04T12:00:00Z");
const HAVE_DATABASE = await databaseReachable();
if (!HAVE_DATABASE) announceSkip("the data deletion request store");
const describeIfDatabase = HAVE_DATABASE ? describe : describe.skip;

let pool: pg.Pool;

beforeAll(async () => {
  if (!HAVE_DATABASE) return;
  const admin = new pg.Pool({ connectionString: TEST_DATABASE_URL });
  try {
    await admin.query("DROP DATABASE IF EXISTS aas_data_deletion_requests WITH (FORCE)");
    await admin.query("CREATE DATABASE aas_data_deletion_requests");
  } finally {
    await admin.end();
  }
  const url = new URL(TEST_DATABASE_URL);
  url.pathname = "/aas_data_deletion_requests";
  pool = new pg.Pool({ connectionString: url.toString(), max: 4 });
  await migrate(pool, MIGRATIONS_DIR);
}, 120_000);

afterAll(async () => {
  if (HAVE_DATABASE) await pool.end();
});

describeIfDatabase("a request to delete the confirmed details: raised once, read by a person, closed whole (P275, row 130)", () => {
  it("raises a request, and a second while it is open answers with the first rather than queueing two", async () => {
    const store = new DataDeletionRequestStore(pool);
    const first = await store.raise({ requestId: "ddr_1", conversationId: "conv_1", studentId: "stu_1", caseId: "case_1", now: NOW });
    expect(first.raised).toBe(true);
    const again = await store.raise({ requestId: "ddr_2", conversationId: "conv_1", studentId: "stu_1", caseId: "case_1", now: LATER });
    expect(again.raised, "raised once").toBe(false);
    expect(again.request.requestId).toBe("ddr_1");
    expect(again.request.raisedAt).toEqual(NOW);
    expect((await store.open()).map((request) => request.requestId)).toEqual(["ddr_1"]);
  });

  it("closes once: a second closing is not recorded, and the first stands", async () => {
    const store = new DataDeletionRequestStore(pool);
    await store.raise({ requestId: "ddr_3", conversationId: "conv_3", studentId: "stu_3", caseId: "case_3", now: NOW });
    const closed = await store.close({ requestId: "ddr_3", closedBy: "vahid", outcome: "deleted", reason: null, now: LATER });
    expect(closed?.closedNow).toBe(true);
    expect(closed?.request.closed).toEqual({ closedAt: LATER, closedBy: "vahid", outcome: "deleted", reason: null });
    const twice = await store.close({ requestId: "ddr_3", closedBy: "someone else", outcome: "declined", reason: "no", now: LATER });
    expect(twice?.closedNow).toBe(false);
    expect(twice?.request.closed?.closedBy, "the first closing stands").toBe("vahid");
    expect(await store.close({ requestId: "ddr_missing", closedBy: "vahid", outcome: "deleted", reason: null, now: LATER })).toBeNull();
    // Closed, a new request may be raised.
    expect((await store.raise({ requestId: "ddr_4", conversationId: "conv_3", studentId: "stu_3", caseId: "case_3", now: LATER })).raised).toBe(true);
  });

  it("refuses at the database a closing that is not whole, and a refusal that does not say why", async () => {
    await expect(
      pool.query("INSERT INTO data_deletion_requests (request_id, conversation_id, student_id, case_id, raised_at, closed_at) VALUES ('ddr_x1', 'c', 's_x1', 'k', now(), now())"),
    ).rejects.toThrow(/data_deletion_requests_a_closing_is_whole/);
    await expect(
      pool.query("INSERT INTO data_deletion_requests (request_id, conversation_id, student_id, case_id, raised_at, closed_at, closed_by, outcome) VALUES ('ddr_x2', 'c', 's_x2', 'k', now(), now(), 'vahid', 'declined')"),
    ).rejects.toThrow(/data_deletion_requests_a_refusal_says_why/);
    await expect(
      pool.query("INSERT INTO data_deletion_requests (request_id, conversation_id, student_id, case_id, raised_at) VALUES ('ddr_x3', 'c', 'stu_1', 'k', now())"),
    ).rejects.toThrow(/data_deletion_requests_one_open_per_student/);
  });
});
