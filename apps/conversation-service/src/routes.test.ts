/**
 * The HTTP surface, over a real server and a real PostgreSQL.
 *
 * The SSE tests use a real `fetch` against a listening server and read the
 * response body as a stream, because SSE's whole behaviour is in the framing
 * and the connection lifecycle. A mocked response object would let a broken
 * stream pass.
 */

import type { Server } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import pg from "pg";

import { migrate } from "@askimate/aas-migrate";
import { announceSkip, databaseReachable, TEST_DATABASE_URL } from "@askimate/aas-migrate/testing";
import type { ConversationEvent } from "@askimate/aas-contracts";

import { MIGRATIONS_DIR } from "./index.js";
import { ConversationEventStore } from "./event-store.js";
import { createConversationRoutes } from "./routes.js";

const PORT = 4821;
const BASE = `http://127.0.0.1:${String(PORT)}`;
const MARKER = "SECRET-PASSWORD-DO-NOT-LEAK-123!";
const REQUEST_ID = `sr_${"a".repeat(32)}`;
const NOW = new Date("2026-08-28T10:00:00Z");

let pool: pg.Pool;
let store: ConversationEventStore;
let server: Server;
let studentId: string;
let otherStudentId: string;
let counter = 0;

const HAVE_DATABASE = await databaseReachable();
if (!HAVE_DATABASE) announceSkip("the conversation service's routes and SSE");
const describeIfDatabase = HAVE_DATABASE ? describe : describe.skip;

async function newConversation(owner: string = studentId): Promise<string> {
  counter += 1;
  const id = `01JBXQ8Z9WKTQ6M4H2NPW${String(counter).padStart(5, "0")}`;
  await pool.query("INSERT INTO conversations (id, student_id) VALUES ($1, $2)", [id, owner]);
  return id;
}

function key(): string {
  counter += 1;
  return `idem-key-${String(counter).padStart(12, "0")}`;
}

async function send(
  conversationId: string,
  content: string,
  extra: { readonly key?: string; readonly student?: string } = {},
): Promise<{ status: number; contentType: string; body: unknown }> {
  const response = await fetch(`${BASE}/v1/conversations/${conversationId}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": extra.key ?? key(),
      "x-student": extra.student ?? studentId,
    },
    body: JSON.stringify({ content }),
  });
  return {
    status: response.status,
    // Returned, not discarded. The contract names a media type per response,
    // and a body that is right in a wrapper that is wrong is still a client
    // parsing the wrong thing.
    contentType: response.headers.get("content-type") ?? "",
    body: await response.json().catch(() => null),
  };
}

/** Reads SSE frames until `stop` says enough, then aborts the connection. */
async function readStream(
  conversationId: string,
  options: { readonly lastEventId?: string; readonly want: number },
): Promise<{ frames: string[]; ids: number[]; events: ConversationEvent[] }> {
  const controller = new AbortController();
  const headers: Record<string, string> = { "x-student": studentId };
  if (options.lastEventId !== undefined) headers["Last-Event-ID"] = options.lastEventId;

  const response = await fetch(`${BASE}/v1/conversations/${conversationId}/stream`, {
    headers,
    signal: controller.signal,
  });
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const frames: string[] = [];
  const ids: number[] = [];
  const events: ConversationEvent[] = [];
  let buffer = "";

  const deadline = Date.now() + 10_000;
  while (events.length < options.want && Date.now() < deadline) {
    const chunk = await Promise.race([
      reader.read(),
      new Promise<{ done: true; value: undefined }>((resolve) =>
        setTimeout(() => resolve({ done: true, value: undefined }), 500),
      ),
    ]);
    if (chunk.value !== undefined) buffer += decoder.decode(chunk.value, { stream: true });

    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      frames.push(frame);
      const id = /^id: (\d+)$/m.exec(frame);
      const data = /^data: (.*)$/m.exec(frame);
      if (id !== null) ids.push(Number(id[1]));
      if (id !== null && data !== null) events.push(JSON.parse(data[1]!) as ConversationEvent);
      boundary = buffer.indexOf("\n\n");
    }
  }
  controller.abort();
  return { frames, ids, events };
}

/**
 * The event out of an accepted response.
 *
 * Asserts it looks like an event rather than casting past whatever came back: a
 * problem document that reached a test expecting an acceptance should fail
 * here, naming what it actually got, rather than surface later as `undefined`
 * where an ordinal was expected.
 */
function accepted(body: unknown): ConversationEvent {
  const event = body as Partial<ConversationEvent>;
  expect(typeof event.ordinal, JSON.stringify(body)).toBe("number");
  return event as ConversationEvent;
}

beforeAll(async () => {
  if (!HAVE_DATABASE) return;
  const admin = new pg.Pool({ connectionString: TEST_DATABASE_URL });
  try {
    await admin.query("DROP DATABASE IF EXISTS aas_conversation_routes WITH (FORCE)");
    await admin.query("CREATE DATABASE aas_conversation_routes");
  } finally {
    await admin.end();
  }
  const url = new URL(TEST_DATABASE_URL);
  url.pathname = "/aas_conversation_routes";
  pool = new pg.Pool({ connectionString: url.toString(), max: 20 });
  await migrate(pool, MIGRATIONS_DIR);
  store = new ConversationEventStore(pool);

  const students = await pool.query<{ id: string }>(
    `INSERT INTO students (subject, email_verified)
     VALUES ('subject-a', true), ('subject-b', true) RETURNING id`,
  );
  studentId = students.rows[0]!.id;
  otherStudentId = students.rows[1]!.id;

  const app = express();
  app.use(express.json({ limit: "16kb" }));
  app.use(
    createConversationRoutes({
      store,
      // Stand-in for the `__Host-` cookie until ADR-0038's provider is wired.
      // Deliberately a HEADER a test sets, not a default that authenticates
      // everybody: an absent header is an absent session.
      authenticate: (req) => {
        const id = req.header("x-student");
        return id === undefined ? null : { studentId: id };
      },
      authorise: async (caller, conversationId) => {
        const rows = await pool.query(
          "SELECT 1 FROM conversations WHERE id = $1 AND student_id = $2",
          [conversationId, caller.studentId],
        );
        return rows.rowCount === 1;
      },
      authoriseService: (req) => req.header("x-service-cert") === "secure-service",
      now: () => NOW,
      pollIntervalMs: 50,
      heartbeatIntervalMs: 60_000,
    }),
  );
  server = app.listen(PORT);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
}, 120_000);

afterAll(async () => {
  if (!HAVE_DATABASE) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

// ───────────────────────────────────────────────────────────────────────────
// Sending, and the ordinal the client is TOLD
// ───────────────────────────────────────────────────────────────────────────

describeIfDatabase("sending a message", () => {
  it("returns the event the SERVER wrote, with the server's ordinal", async () => {
    const conversation = await newConversation();
    const first = await send(conversation, "when does term start?");
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({
      kind: "message", ordinal: 1, actor: "student", content: "when does term start?",
    });
    const second = await send(conversation, "and where?");
    expect(accepted(second.body).ordinal).toBe(2);
  }, 30_000);

  it("ignores an ordinal in the request body — property 4, through HTTP", async () => {
    const conversation = await newConversation();
    await send(conversation, "first");
    const response = await fetch(`${BASE}/v1/conversations/${conversation}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": key(),
        "x-student": studentId,
      },
      body: JSON.stringify({ content: "second", ordinal: 99, createdAt: "1999-01-01T00:00:00Z" }),
    });
    const written = accepted(await response.json());
    expect(written.ordinal, "the server's position, not the caller's").toBe(2);
    expect(written.createdAt).not.toContain("1999");
  }, 30_000);

  it("refuses without a session, and refuses another student's conversation", async () => {
    const conversation = await newConversation();
    const anonymous = await fetch(`${BASE}/v1/conversations/${conversation}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key() },
      body: JSON.stringify({ content: "x" }),
    });
    expect(anonymous.status).toBe(401);

    const stranger = await send(conversation, "x", { student: otherStudentId });
    // 404, never 403 — a 403 would confirm the conversation exists.
    expect(stranger.status).toBe(404);
    expect((stranger.body as { code: string }).code).toBe("not_found");
  }, 30_000);

  it("replays an idempotent retry instead of duplicating the message", async () => {
    const conversation = await newConversation();
    const shared = key();
    const first = await send(conversation, "only once", { key: shared });
    const second = await send(conversation, "only once", { key: shared });
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(accepted(second.body).ordinal).toBe(accepted(first.body).ordinal);
    const events = await store.since(conversation, 0);
    expect(events).toHaveLength(1);
  }, 30_000);

  it("names a conflict rather than hiding it when a key is reused differently", async () => {
    const conversation = await newConversation();
    const shared = key();
    await send(conversation, "original", { key: shared });
    const clash = await send(conversation, "different", { key: shared });
    expect(clash.status).toBe(409);
    expect((clash.body as { code: string }).code).toBe("idempotency_key_conflict");
  }, 30_000);
});

// ───────────────────────────────────────────────────────────────────────────
// 10. The fail-closed guard, unchanged
// ───────────────────────────────────────────────────────────────────────────

describeIfDatabase("the guard still fails closed", () => {
  it("refuses a message while a secure step is open, storing nothing", async () => {
    const conversation = await newConversation();
    await fetch(`${BASE}/internal/v1/conversations/${conversation}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-service-cert": "secure-service" },
      body: JSON.stringify({
        kind: "secret_requested", requestId: REQUEST_ID, channel: "secure_control",
        expiresAt: new Date(NOW.getTime() + 300_000).toISOString(),
      }),
    });

    const refused = await send(conversation, MARKER);
    expect(refused.status).toBe(409);
    // ── The MEDIA TYPE is part of the contract ──────────────────────────
    //
    // `conversation.v1.yaml` declares this response as
    // `application/problem+json` carrying `SecretRequestOpenProblem`, and the
    // service used to send `application/json` carrying a bespoke
    // `{ status: "refused" }` envelope. Two artefacts in `packages/contracts`
    // described one endpoint two ways and nothing compared them: the OpenAPI
    // tests check the two DOCUMENTS against each other, and nothing checked
    // either against what the service actually sends. This is that check.
    expect(refused.contentType).toContain("application/problem+json");
    expect(refused.body).toMatchObject({
      code: "secret_request_open",
      status: 409,
      requestId: REQUEST_ID,
    });
    // RFC 9457 minus `detail`: that field is where a handler interpolates the
    // failing value, which on this endpoint is the message that was refused.
    expect(refused.body).not.toHaveProperty("detail");
    // Nothing from the body is echoed — an echo is how a refused password
    // reaches a client-side log.
    expect(JSON.stringify(refused.body)).not.toContain(MARKER);

    const bodies = await pool.query<{ n: string }>(
      "SELECT count(*) AS n FROM message_bodies WHERE content LIKE $1", [`%${MARKER}%`],
    );
    expect(Number(bodies.rows[0]!.n)).toBe(0);
  }, 30_000);

  it("releases once the step settles, and a rejection does not settle it", async () => {
    const conversation = await newConversation();
    const internal = async (body: Record<string, unknown>): Promise<number> =>
      (
        await fetch(`${BASE}/internal/v1/conversations/${conversation}/events`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-service-cert": "secure-service" },
          body: JSON.stringify(body),
        })
      ).status;

    await internal({
      kind: "secret_requested", requestId: REQUEST_ID, channel: "secure_control",
      expiresAt: new Date(NOW.getTime() + 300_000).toISOString(),
    });
    await internal({ kind: "secret_rejected", requestId: REQUEST_ID, reason: "confirmation_mismatch" });
    expect((await send(conversation, "still blocked")).status).toBe(409);

    await internal({ kind: "secret_cancelled", requestId: REQUEST_ID });
    expect((await send(conversation, "free again")).status).toBe(201);
  }, 30_000);

  it("refuses an internal append without a service certificate", async () => {
    const conversation = await newConversation();
    const response = await fetch(`${BASE}/internal/v1/conversations/${conversation}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "secret_cancelled", requestId: REQUEST_ID }),
    });
    expect(response.status).toBe(403);
  }, 30_000);

  it("is idempotent on a retried lifecycle transition", async () => {
    const conversation = await newConversation();
    const post = async (): Promise<number> =>
      (
        await fetch(`${BASE}/internal/v1/conversations/${conversation}/events`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-service-cert": "secure-service" },
          body: JSON.stringify({ kind: "secret_expired", requestId: REQUEST_ID }),
        })
      ).status;
    expect(await post()).toBe(201);
    expect(await post()).toBe(200);
    expect(await store.since(conversation, 0)).toHaveLength(1);
  }, 30_000);
});

// ───────────────────────────────────────────────────────────────────────────
// 5 & 6. SSE
// ───────────────────────────────────────────────────────────────────────────

describeIfDatabase("the event stream", () => {
  it("uses the ordinal as the SSE id and sends a resume frame first", async () => {
    const conversation = await newConversation();
    for (const text of ["one", "two", "three"]) await send(conversation, text);

    const stream = await readStream(conversation, { want: 3 });
    expect(stream.frames[0]).toContain("event: conversation.resume");
    expect(stream.frames[0]).toContain('"resumingAfter":0');
    expect(stream.ids).toEqual([1, 2, 3]);
    expect(stream.events.map((event) => event.ordinal)).toEqual([1, 2, 3]);
  }, 30_000);

  it("resumes from Last-Event-ID and sends ONLY what came after", async () => {
    const conversation = await newConversation();
    for (const text of ["one", "two", "three", "four"]) await send(conversation, text);

    const stream = await readStream(conversation, { lastEventId: "2", want: 2 });
    expect(stream.frames[0]).toContain('"resumingAfter":2');
    expect(stream.ids, "a resume must not replay what the client already has").toEqual([3, 4]);
  }, 30_000);

  it("does not duplicate events across a reconnect — property 6", async () => {
    const conversation = await newConversation();
    for (const text of ["a", "b", "c"]) await send(conversation, text);

    const first = await readStream(conversation, { want: 3 });
    const resumeFrom = String(Math.max(...first.ids));
    await send(conversation, "d");
    const second = await readStream(conversation, { lastEventId: resumeFrom, want: 1 });

    const all = [...first.ids, ...second.ids];
    expect(new Set(all).size, "an ordinal delivered twice across a reconnect").toBe(all.length);
    expect(all).toEqual([1, 2, 3, 4]);
  }, 30_000);

  it("delivers a live event written AFTER the stream opened", async () => {
    const conversation = await newConversation();
    await send(conversation, "before");
    const streaming = readStream(conversation, { want: 2 });
    // Written while the stream is open: it must arrive without a reconnect.
    await new Promise((resolve) => setTimeout(resolve, 100));
    await send(conversation, "after");
    const stream = await streaming;
    expect(stream.ids).toEqual([1, 2]);
    expect(stream.events[1]).toMatchObject({ content: "after" });
  }, 30_000);

  it("gives two simultaneous readers the same ordering — property 7", async () => {
    const conversation = await newConversation();
    for (const text of ["p", "q", "r"]) await send(conversation, text);
    const [a, b] = await Promise.all([
      readStream(conversation, { want: 3 }),
      readStream(conversation, { want: 3 }),
    ]);
    expect(a.ids).toEqual(b.ids);
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
  }, 30_000);

  it("ignores a hostile Last-Event-ID rather than widening the query", async () => {
    const conversation = await newConversation();
    for (const text of ["x", "y"]) await send(conversation, text);
    // `-1` and `1; DROP` are refused by the strict parser and fall back to 0,
    // which replays from the start of a conversation already authorised. A bad
    // resume can never reach further than a good one.
    const stream = await readStream(conversation, { lastEventId: "-1", want: 2 });
    expect(stream.frames[0]).toContain('"resumingAfter":0');
    expect(stream.ids).toEqual([1, 2]);
  }, 30_000);

  it("refuses to stream a conversation that is not the caller's", async () => {
    const conversation = await newConversation(otherStudentId);
    const response = await fetch(`${BASE}/v1/conversations/${conversation}/stream`, {
      headers: { "x-student": studentId },
    });
    expect(response.status).toBe(404);
    await response.body?.cancel();
  }, 30_000);
});

// ───────────────────────────────────────────────────────────────────────────
// Paged reads
// ───────────────────────────────────────────────────────────────────────────

describeIfDatabase("reading the transcript", () => {
  it("pages from an ordinal, and reports whether more remain", async () => {
    const conversation = await newConversation();
    for (let index = 0; index < 5; index += 1) await send(conversation, `m${String(index)}`);

    const page = await fetch(
      `${BASE}/v1/conversations/${conversation}/events?after=1&limit=2`,
      { headers: { "x-student": studentId } },
    );
    const body = (await page.json()) as { events: ConversationEvent[]; hasMore: boolean };
    expect(body.events.map((event) => event.ordinal)).toEqual([2, 3]);
    expect(body.hasMore).toBe(true);
  }, 30_000);

  it("refuses a negative cursor", async () => {
    const conversation = await newConversation();
    const response = await fetch(
      `${BASE}/v1/conversations/${conversation}/events?after=-5`,
      { headers: { "x-student": studentId } },
    );
    expect(response.status).toBe(400);
  }, 30_000);
});
