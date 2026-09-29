import { afterAll, beforeAll, describe, expect, it } from "vitest";

import pg from "pg";

import { migrate } from "@askimate/aas-migrate";
import { announceSkip, databaseReachable, TEST_DATABASE_URL } from "@askimate/aas-migrate/testing";

import { InMemoryDocumentReadingStore, PostgresDocumentReadingStore, type DocumentReadingStore } from "./document-reading-store.js";
import { MIGRATIONS_DIR } from "./index.js";

const NOW = new Date("2026-09-28T20:00:00Z");
const LATER = new Date("2026-09-28T20:10:00Z");
const HASH = "c".repeat(64);
const HAVE_DATABASE = await databaseReachable();
if (!HAVE_DATABASE) announceSkip("the document reading store");
const describeIfDatabase = HAVE_DATABASE ? describe : describe.skip;

let pool: pg.Pool;

beforeAll(async () => {
  if (!HAVE_DATABASE) return;
  const admin = new pg.Pool({ connectionString: TEST_DATABASE_URL });
  try {
    await admin.query("DROP DATABASE IF EXISTS aas_document_readings WITH (FORCE)");
    await admin.query("CREATE DATABASE aas_document_readings");
  } finally {
    await admin.end();
  }
  const url = new URL(TEST_DATABASE_URL);
  url.pathname = "/aas_document_readings";
  pool = new pg.Pool({ connectionString: url.toString(), max: 6 });
  await migrate(pool, MIGRATIONS_DIR);
}, 120_000);

afterAll(async () => {
  if (HAVE_DATABASE) await pool.end();
});

/** The same contract, both implementations: what a reader may take and what it may say. */
function holds(name: string, make: () => DocumentReadingStore, run: (fn: (test: string) => void) => void): void {
  run((test) => {
    describe(`${name}: a CV waits, one reader holds it, and only that reader may say how it ended`, () => {
      const id = (n: number): string => `01JQREAD${String(test.length).padStart(2, "0")}${String(n).padStart(16, "0")}`.slice(0, 26).padEnd(26, "0").replace(/[^0-9A-Z]/g, "0");
      it("claims the oldest waiting document, then finds nothing more", async () => {
        const store = make();
        await store.request({ documentId: id(1), conversationId: "conv_1", studentId: "stu_1", contentHash: HASH, now: NOW });
        await store.request({ documentId: id(2), conversationId: "conv_1", studentId: "stu_1", contentHash: HASH, now: LATER });
        const first = await store.claim({ holder: "reader-a", leaseId: "rl_1", now: LATER, leaseSeconds: 300 });
        expect(first?.documentId).toBe(id(1));
        expect(first?.state).toBe("leased");
        const second = await store.claim({ holder: "reader-b", leaseId: "rl_2", now: LATER, leaseSeconds: 300 });
        expect(second?.documentId).toBe(id(2));
        expect(await store.claim({ holder: "reader-c", leaseId: "rl_3", now: LATER, leaseSeconds: 300 })).toBeNull();
      });

      it("asking twice for one document changes nothing, and a leased one is not handed out again while the lease lives", async () => {
        const store = make();
        await store.request({ documentId: id(3), conversationId: "conv_2", studentId: "stu_2", contentHash: HASH, now: NOW });
        await store.claim({ holder: "reader-a", leaseId: "rl_1", now: NOW, leaseSeconds: 300 });
        await store.request({ documentId: id(3), conversationId: "conv_9", studentId: "stu_9", contentHash: HASH, now: LATER });
        expect((await store.readingFor(id(3)))?.conversationId, "the first request stands").toBe("conv_2");
        expect(await store.claim({ holder: "reader-b", leaseId: "rl_2", now: new Date(NOW.getTime() + 60_000), leaseSeconds: 300 })).toBeNull();
      });

      it("hands a document whose lease LAPSED to the next reader, and refuses the old lease's report", async () => {
        const store = make();
        await store.request({ documentId: id(4), conversationId: "conv_3", studentId: "stu_3", contentHash: HASH, now: NOW });
        await store.claim({ holder: "reader-a", leaseId: "rl_old", now: NOW, leaseSeconds: 60 });
        const afterLapse = new Date(NOW.getTime() + 61_000);
        const taken = await store.claim({ holder: "reader-b", leaseId: "rl_new", now: afterLapse, leaseSeconds: 300 });
        expect(taken?.leaseId).toBe("rl_new");
        expect(await store.held(id(4), "rl_old", afterLapse), "the old lease is nobody's").toBeNull();
        expect(await store.complete({ documentId: id(4), leaseId: "rl_old", outcome: "read", now: afterLapse })).toBe(false);
        expect(await store.complete({ documentId: id(4), leaseId: "rl_new", outcome: "read", now: afterLapse })).toBe(true);
        const ended = await store.readingFor(id(4));
        expect(ended).toMatchObject({ state: "read", leaseId: null, holder: null, failure: null });
        expect(ended?.readAt?.toISOString()).toBe(afterLapse.toISOString());
      });

      it("records a failure by its closed word, and never hands a finished reading out again", async () => {
        const store = make();
        await store.request({ documentId: id(5), conversationId: "conv_4", studentId: "stu_4", contentHash: HASH, now: NOW });
        await store.claim({ holder: "reader-a", leaseId: "rl_1", now: NOW, leaseSeconds: 300 });
        // Reported inside the lease: a minute after the claim, not ten.
        expect(await store.complete({ documentId: id(5), leaseId: "rl_1", outcome: "failed", failure: "content_changed", now: new Date(NOW.getTime() + 60_000) })).toBe(true);
        expect((await store.readingFor(id(5)))?.failure).toBe("content_changed");
        // The table is shared across these tests in Postgres, so what a later
        // claim finds is whatever ELSE has lapsed — never this finished one.
        const later = await store.claim({ holder: "reader-a", leaseId: "rl_9", now: new Date(LATER.getTime() + 3_600_000), leaseSeconds: 300 });
        expect(later?.documentId).not.toBe(id(5));
      });
    });
  });
}

holds("in memory", () => new InMemoryDocumentReadingStore(), (fn) => fn("memory"));
holds("Postgres", () => new PostgresDocumentReadingStore(pool), (fn) => (HAVE_DATABASE ? fn("postgres") : undefined));

describeIfDatabase("a reading keeps its structure (P248, migration 0031)", () => {
  it("stores the structure a reading was read into, reads it back, and refuses one on a reading that was not read", async () => {
    const store = new PostgresDocumentReadingStore(pool);
    const now = new Date("2026-09-29T12:00:00Z");
    // Requested long before anything else this file leaves pending: a claim
    // takes the OLDEST waiting row, and the table is shared across the file.
    const long_ago = new Date("2000-01-01T00:00:00Z");
    const structure = { lists: [{ fieldKey: "employment.history", seeded: true, entries: [{ index: 1, read: ["position"], missing: ["duties"], partial: { end: ["month"] }, student: ["basis"] }], unread: 1 }] };
    await store.request({ documentId: "01JQREADSTRUCT000000000001", conversationId: "c", studentId: "s", contentHash: HASH, now: long_ago });
    const leased = await store.claim({ holder: "reader-1", leaseId: "rl_s1", now, leaseSeconds: 60 });
    expect(leased?.documentId).toBe("01JQREADSTRUCT000000000001");
    expect(await store.complete({ documentId: "01JQREADSTRUCT000000000001", leaseId: "rl_s1", outcome: "read", structure, now })).toBe(true);
    expect((await store.readingFor("01JQREADSTRUCT000000000001"))?.structure).toEqual(structure);
    // A failed reading carries a word and no structure, whatever the caller passed.
    await store.request({ documentId: "01JQREADSTRUCT000000000002", conversationId: "c", studentId: "s", contentHash: HASH, now: long_ago });
    const leasedSecond = await store.claim({ holder: "reader-1", leaseId: "rl_s2", now, leaseSeconds: 60 });
    expect(leasedSecond?.documentId).toBe("01JQREADSTRUCT000000000002");
    expect(await store.complete({ documentId: "01JQREADSTRUCT000000000002", leaseId: "rl_s2", outcome: "failed", failure: "unreadable", structure, now })).toBe(true);
    expect((await store.readingFor("01JQREADSTRUCT000000000002"))?.structure).toBeNull();
    await expect(
      pool.query("INSERT INTO document_readings (document_id, conversation_id, student_id, content_hash, state, requested_at, structure) VALUES ('01JQREADSTRUCT000000000003', 'c', 's', $1, 'pending', now(), '{}')", [HASH]),
    ).rejects.toThrow(/document_readings_only_a_reading_has_a_structure/);
  });
});

describeIfDatabase("the table refuses what the store never writes", () => {
  it("REFUSES a lease with a holder and no expiry, a failure on a reading that did not fail, and an unknown state", async () => {
    await expect(
      pool.query("INSERT INTO document_readings (document_id, conversation_id, student_id, content_hash, state, requested_at, lease_id, holder) VALUES ('01JQREADBAD000000000000001', 'c', 's', $1, 'leased', now(), 'rl', 'h')", [HASH]),
    ).rejects.toThrow(/document_readings_lease_is_whole/);
    await expect(
      pool.query("INSERT INTO document_readings (document_id, conversation_id, student_id, content_hash, state, requested_at, failure) VALUES ('01JQREADBAD000000000000002', 'c', 's', $1, 'pending', now(), 'unreadable')", [HASH]),
    ).rejects.toThrow(/document_readings_only_a_failure_says_why/);
    await expect(
      pool.query("INSERT INTO document_readings (document_id, conversation_id, student_id, content_hash, state, requested_at) VALUES ('01JQREADBAD000000000000003', 'c', 's', $1, 'reading', now())", [HASH]),
    ).rejects.toThrow(/document_readings_state_check/);
  });
});
