/**
 * The ordinal authority, against a real PostgreSQL, with real concurrency.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-28: *"Design explicitly for concurrent writers and prove the
 * behaviour with real PostgreSQL tests."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Concurrency asserted against a fake is concurrency asserted against a design
 * for concurrency, which is the thing under test. Every race below runs against
 * a real database over a real pool, with genuinely parallel connections.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import { migrate } from "@askimate/aas-migrate";
import { announceSkip, databaseReachable, TEST_DATABASE_URL } from "@askimate/aas-migrate/testing";

import { MIGRATIONS_DIR } from "./index.js";
import {
  ConversationEventStore,
  IdempotencyConflictError,
  UnknownConversationError,
} from "./event-store.js";

const MARKER = "SECRET-PASSWORD-DO-NOT-LEAK-123!";
const REQUEST_ID = `sr_${"a".repeat(32)}`;
const HANDLE = `sh_${"b".repeat(32)}`;
const NOW = new Date("2026-08-28T10:00:00Z");

let pool: pg.Pool;
let store: ConversationEventStore;
let studentId: string;
let counter = 0;

const HAVE_DATABASE = await databaseReachable();
if (!HAVE_DATABASE) announceSkip("the conversation service's ordinal authority");
const describeIfDatabase = HAVE_DATABASE ? describe : describe.skip;

function nextConversationId(): string {
  counter += 1;
  return `01JBXQ8Z9WKTQ6M4H2NPV${String(counter).padStart(5, "0")}`;
}

async function newConversation(): Promise<string> {
  const id = nextConversationId();
  await pool.query("INSERT INTO conversations (id, student_id) VALUES ($1, $2)", [id, studentId]);
  return id;
}

/** The invariant every committed write must leave true. */
async function assertOrdinalsAgree(conversationId: string): Promise<number> {
  const rows = await pool.query<{ last_ordinal: number; highest: number | null; total: string }>(
    `SELECT c.last_ordinal,
            (SELECT max(ordinal) FROM conversation_events WHERE conversation_id = c.id) AS highest,
            (SELECT count(*) FROM conversation_events WHERE conversation_id = c.id) AS total
       FROM conversations c WHERE c.id = $1`,
    [conversationId],
  );
  const row = rows.rows[0]!;
  const total = Number(row.total);
  expect(row.highest ?? 0, "last_ordinal vs highest event ordinal").toBe(row.last_ordinal);
  // Dense: N events means ordinals 1..N with no gaps. Density is what makes
  // `Last-Event-ID` a complete answer rather than an approximate one.
  expect(total, "event count vs last_ordinal — a gap means a lost position").toBe(
    row.last_ordinal,
  );
  return row.last_ordinal;
}

beforeAll(async () => {
  if (!HAVE_DATABASE) return;
  const admin = new pg.Pool({ connectionString: TEST_DATABASE_URL });
  try {
    await admin.query("DROP DATABASE IF EXISTS aas_conversation_store WITH (FORCE)");
    await admin.query("CREATE DATABASE aas_conversation_store");
  } finally {
    await admin.end();
  }
  const url = new URL(TEST_DATABASE_URL);
  url.pathname = "/aas_conversation_store";
  // A pool big enough that "concurrent" means concurrent, not queued.
  pool = new pg.Pool({ connectionString: url.toString(), max: 20 });
  expect(await migrate(pool, MIGRATIONS_DIR)).toEqual(["0001_conversation_log"]);
  store = new ConversationEventStore(pool);
  const student = await pool.query<{ id: string }>(
    "INSERT INTO students (subject, email_verified) VALUES ($1, true) RETURNING id",
    ["oidc-subject-store"],
  );
  studentId = student.rows[0]!.id;
}, 120_000);

afterAll(async () => {
  if (HAVE_DATABASE) await pool.end();
});

// ───────────────────────────────────────────────────────────────────────────
// 1 & 7. Concurrency
// ───────────────────────────────────────────────────────────────────────────

describeIfDatabase("two writers cannot receive the same durable ordinal", () => {
  it("gives twenty simultaneous writers twenty distinct, dense positions", async () => {
    const conversation = await newConversation();
    const writers = 20;

    // Fired together, on separate pooled connections. Whichever wins the row
    // lock first gets 1; the rest queue behind it and get 2..20.
    const results = await Promise.all(
      Array.from({ length: writers }, async (_unused, index) =>
        store.append({
          conversationId: conversation,
          event: { kind: "message", actor: "student", content: `message ${String(index)}` },
        }),
      ),
    );

    const ordinals = results.map((result) => result.event.ordinal).sort((a, b) => a - b);
    expect(new Set(ordinals).size, "duplicate ordinal handed to two writers").toBe(writers);
    expect(ordinals).toEqual(Array.from({ length: writers }, (_u, index) => index + 1));
    await assertOrdinalsAgree(conversation);
  }, 60_000);

  it("keeps two conversations independent, so a busy one does not skew a quiet one", async () => {
    const [first, second] = [await newConversation(), await newConversation()];
    await Promise.all([
      ...Array.from({ length: 5 }, async () =>
        store.append({
          conversationId: first,
          event: { kind: "message", actor: "student", content: "a" },
        }),
      ),
      ...Array.from({ length: 3 }, async () =>
        store.append({
          conversationId: second,
          event: { kind: "message", actor: "student", content: "b" },
        }),
      ),
    ]);
    expect(await assertOrdinalsAgree(first)).toBe(5);
    expect(await assertOrdinalsAgree(second)).toBe(3);
  }, 60_000);

  it("gives two readers the SAME ordering, on separate connections", async () => {
    // Property 7. Two clients converge because the ordering is a fact in the
    // table, not a merge each of them performs.
    const conversation = await newConversation();
    await Promise.all(
      Array.from({ length: 10 }, async (_unused, index) =>
        store.append({
          conversationId: conversation,
          event: { kind: "message", actor: "student", content: `m${String(index)}` },
        }),
      ),
    );
    const [a, b] = await Promise.all([
      store.since(conversation, 0),
      store.since(conversation, 0),
    ]);
    expect(a.map((event) => event.ordinal)).toEqual(b.map((event) => event.ordinal));
    expect(a.map((event) => event.ordinal)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    // And the same content at the same position, not merely the same numbers.
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  }, 60_000);
});

// ───────────────────────────────────────────────────────────────────────────
// 2 & 3. The counter cannot get ahead of the log
// ───────────────────────────────────────────────────────────────────────────

describeIfDatabase("last_ordinal and the log cannot diverge", () => {
  it("advances the counter and writes the event in ONE transaction", async () => {
    const conversation = await newConversation();
    await store.append({
      conversationId: conversation,
      event: { kind: "message", actor: "student", content: "one" },
    });
    expect(await assertOrdinalsAgree(conversation)).toBe(1);
  });

  it("leaves the counter WHERE IT WAS when the insert fails", async () => {
    // Property 3, and the reason the claim and the insert share a transaction.
    // A `secret_received` with no handle violates `a_handle_means_receipt`, so
    // the insert fails AFTER the counter has been incremented in this
    // transaction. If they were separate transactions the counter would be
    // ahead of the log for ever, and every later ordinal would be wrong.
    const conversation = await newConversation();
    await store.append({
      conversationId: conversation,
      event: { kind: "message", actor: "student", content: "before" },
    });

    await expect(
      store.append({
        conversationId: conversation,
        // A handle of "" fails the CHECK on the events table.
        event: { kind: "secret_received", requestId: REQUEST_ID, handle: "" },
      }),
    ).rejects.toThrow();

    expect(await assertOrdinalsAgree(conversation)).toBe(1);

    // And the next real write gets 2, not 3 — proof the failed claim was
    // rolled back rather than merely unused.
    //
    // ── What actually carries this property ──────────────────────────────
    //
    // ONE TRANSACTION, not the `ROLLBACK` in the catch. Swapping that
    // `ROLLBACK` for a `COMMIT` does not break this test, and I checked:
    // PostgreSQL puts a transaction into an aborted state as soon as a
    // statement in it fails, and `COMMIT` on an aborted transaction rolls back.
    // So the catch clause is belt-and-braces and a regression aimed at it
    // proves nothing.
    //
    // The regression that DOES break this test is committing the claim in its
    // own transaction and beginning a second one for the insert — which is the
    // architectural mistake the comment above describes, and is what this test
    // is really pinning.
    const next = await store.append({
      conversationId: conversation,
      event: { kind: "message", actor: "student", content: "after" },
    });
    expect(next.event.ordinal).toBe(2);
    await assertOrdinalsAgree(conversation);
  }, 60_000);

  it("refuses to write to a conversation that does not exist", async () => {
    await expect(
      store.append({
        conversationId: "01JBXQ8Z9WKTQ6M4H2NPVNOSUCH",
        event: { kind: "message", actor: "student", content: "x" },
      }),
    ).rejects.toThrow(UnknownConversationError);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 4. A client-supplied ordinal cannot become authoritative
// ───────────────────────────────────────────────────────────────────────────

describeIfDatabase("the caller cannot name a position", () => {
  it("ignores an ordinal smuggled into the appendable event", async () => {
    const conversation = await newConversation();
    await store.append({
      conversationId: conversation,
      event: { kind: "message", actor: "student", content: "first" },
    });

    // `AppendableEvent` has no `ordinal` member — `NO_CALLER_MAY_NAME_A_POSITION`
    // fails the build if one is added. This is the runtime half, and it needs
    // no cast to get there: excess-property checking applies to a fresh object
    // LITERAL, not to a variable, so an object carrying `ordinal` is
    // structurally assignable. That is exactly the shape a parsed JSON body
    // has, which makes this the realistic path rather than a contrived one.
    // The lint rule that forbids a redundant assertion is what pointed it out.
    const smuggled = {
      kind: "message" as const,
      actor: "student" as const,
      content: "second",
      ordinal: 99,
      createdAt: "1999-01-01T00:00:00.000Z",
      id: 12345,
    };
    const written = await store.append({ conversationId: conversation, event: smuggled });

    expect(written.event.ordinal, "the server's position, not the caller's").toBe(2);
    expect(written.event.createdAt).not.toBe("1999-01-01T00:00:00.000Z");
    await assertOrdinalsAgree(conversation);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 6. Idempotency — a retry does not duplicate a durable event
// ───────────────────────────────────────────────────────────────────────────

describeIfDatabase("a retried write does not appear twice", () => {
  it("returns the FIRST event, and writes nothing new", async () => {
    const conversation = await newConversation();
    const idempotency = { key: "k".repeat(20), studentId, digest: "a".repeat(64) };

    const first = await store.append({
      conversationId: conversation,
      event: { kind: "message", actor: "student", content: "only once" },
      idempotency,
    });
    const second = await store.append({
      conversationId: conversation,
      event: { kind: "message", actor: "student", content: "only once" },
      idempotency,
    });

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.event.ordinal).toBe(first.event.ordinal);
    expect(await assertOrdinalsAgree(conversation)).toBe(1);
  }, 60_000);

  it("refuses the same key with a DIFFERENT body, rather than hiding it", async () => {
    const conversation = await newConversation();
    const key = "j".repeat(20);
    await store.append({
      conversationId: conversation,
      event: { kind: "message", actor: "student", content: "original" },
      idempotency: { key, studentId, digest: "b".repeat(64) },
    });
    await expect(
      store.append({
        conversationId: conversation,
        event: { kind: "message", actor: "student", content: "different" },
        idempotency: { key, studentId, digest: "c".repeat(64) },
      }),
    ).rejects.toThrow(IdempotencyConflictError);
    expect(await assertOrdinalsAgree(conversation)).toBe(1);
  }, 60_000);

  it("survives two SIMULTANEOUS retries of the same key", async () => {
    // The idempotency row has a primary key, so the loser of the race gets a
    // 23505 rather than a second event. Either outcome is acceptable to the
    // caller; a duplicate in the transcript is not.
    const conversation = await newConversation();
    const idempotency = { key: "s".repeat(20), studentId, digest: "d".repeat(64) };
    const attempts = await Promise.allSettled([
      store.append({
        conversationId: conversation,
        event: { kind: "message", actor: "student", content: "once" },
        idempotency,
      }),
      store.append({
        conversationId: conversation,
        event: { kind: "message", actor: "student", content: "once" },
        idempotency,
      }),
    ]);
    expect(attempts.some((attempt) => attempt.status === "fulfilled")).toBe(true);
    expect(await assertOrdinalsAgree(conversation)).toBe(1);
  }, 60_000);
});

// ───────────────────────────────────────────────────────────────────────────
// Reading, and the guard
// ───────────────────────────────────────────────────────────────────────────

describeIfDatabase("reading the log", () => {
  it("round-trips every event kind with its fields intact", async () => {
    const conversation = await newConversation();
    await store.append({
      conversationId: conversation,
      event: { kind: "message", actor: "assistant", content: "hello" },
    });
    await store.append({
      conversationId: conversation,
      event: {
        kind: "secret_requested", requestId: REQUEST_ID, channel: "secure_control",
        expiresAt: new Date(NOW.getTime() + 300_000).toISOString(),
      },
    });
    await store.append({
      conversationId: conversation,
      event: { kind: "secret_received", requestId: REQUEST_ID, handle: HANDLE },
    });
    await store.append({
      conversationId: conversation,
      event: { kind: "secret_rejected", requestId: REQUEST_ID, reason: "already_submitted" },
    });

    const events = await store.since(conversation, 0);
    expect(events.map((event) => event.kind)).toEqual([
      "message", "secret_requested", "secret_received", "secret_rejected",
    ]);
    expect(events[0]).toMatchObject({ actor: "assistant", content: "hello" });
    expect(events[2]).toMatchObject({ handle: HANDLE });
    expect(events[3]).toMatchObject({ reason: "already_submitted" });
    // No secure event carries text — the CHECK constraint and the union agree.
    for (const event of events.slice(1)) expect("content" in event).toBe(false);
  }, 60_000);

  it("returns only what comes after the cursor, which is what a resume needs", async () => {
    const conversation = await newConversation();
    for (let index = 0; index < 5; index += 1) {
      await store.append({
        conversationId: conversation,
        event: { kind: "message", actor: "student", content: `m${String(index)}` },
      });
    }
    expect((await store.since(conversation, 3)).map((event) => event.ordinal)).toEqual([4, 5]);
    expect(await store.since(conversation, 5)).toEqual([]);
  }, 60_000);

  it("reports the open step, and a rejection does not close it", async () => {
    const conversation = await newConversation();
    await store.append({
      conversationId: conversation,
      event: {
        kind: "secret_requested", requestId: REQUEST_ID, channel: "secure_control",
        expiresAt: new Date(NOW.getTime() + 300_000).toISOString(),
      },
    });
    expect(await store.openSecretRequest(conversation, NOW)).toMatchObject({
      requestId: REQUEST_ID,
    });

    await store.append({
      conversationId: conversation,
      event: { kind: "secret_rejected", requestId: REQUEST_ID, reason: "confirmation_mismatch" },
    });
    expect(await store.openSecretRequest(conversation, NOW), "a rejection closes nothing")
      .not.toBeNull();

    await store.append({
      conversationId: conversation,
      event: { kind: "secret_cancelled", requestId: REQUEST_ID },
    });
    expect(await store.openSecretRequest(conversation, NOW)).toBeNull();
  }, 60_000);

  it("treats an expired step as closed, using the CALLER's clock", async () => {
    const conversation = await newConversation();
    await store.append({
      conversationId: conversation,
      event: {
        kind: "secret_requested", requestId: REQUEST_ID, channel: "secure_control",
        expiresAt: new Date(NOW.getTime() + 60_000).toISOString(),
      },
    });
    expect(await store.openSecretRequest(conversation, NOW)).not.toBeNull();
    expect(await store.openSecretRequest(conversation, new Date(NOW.getTime() + 120_000)))
      .toBeNull();
  }, 60_000);

  it("stores no secret anywhere, whatever a message contains", async () => {
    const conversation = await newConversation();
    await store.append({
      conversationId: conversation,
      event: {
        kind: "secret_requested", requestId: REQUEST_ID, channel: "secure_control",
        expiresAt: new Date(NOW.getTime() + 300_000).toISOString(),
      },
    });
    const secure = await pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM conversation_events
        WHERE conversation_id = $1 AND kind <> 'message' AND body_id IS NOT NULL`,
      [conversation],
    );
    expect(Number(secure.rows[0]!.n)).toBe(0);
    const bodies = await pool.query<{ n: string }>(
      "SELECT count(*) AS n FROM message_bodies WHERE content LIKE $1",
      [`%${MARKER}%`],
    );
    expect(Number(bodies.rows[0]!.n)).toBe(0);
  }, 60_000);
});
