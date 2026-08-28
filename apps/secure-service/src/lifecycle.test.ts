/**
 * The lifecycle push, between two real services and two real databases.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-28: *"Implement the real caller from the Secure Interaction
 * Service to the already-existing authenticated internal append endpoint…
 * Idempotency must be proven against the real database and real internal
 * route."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   Secure Service (this database)
 *     → authenticated internal append (real HTTP, real route)
 *       → Conversation Service (a SEPARATE database)
 *         → durable event log → the fail-closed guard
 *
 * Two PostgreSQL databases, deliberately: `aas_secure_lifecycle` and
 * `aas_conversation_lifecycle`. A single database would let a test pass that
 * only works because both planes could see the same rows, which is exactly the
 * separation ADR-0037 requires and exactly what this push exists to bridge.
 */

import type { Server } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import pg from "pg";

import { migrate } from "@askimate/aas-migrate";
import { announceSkip, databaseReachable, TEST_DATABASE_URL } from "@askimate/aas-migrate/testing";
import {
  ConversationEventStore,
  MIGRATIONS_DIR as CONVERSATION_MIGRATIONS,
  createConversationRoutes,
} from "@askimate/aas-conversation-service";

import { MIGRATIONS_DIR } from "./index.js";
import { LifecycleOutbox, backoffSeconds } from "./lifecycle-outbox.js";
import type { DeliverTransition, OutboxRow } from "./lifecycle-outbox.js";
import { internalAppend } from "./internal-append.js";

const PORT = 4847;
const BASE = `http://127.0.0.1:${String(PORT)}`;
const CERT = "secure-service";
const NOW = new Date("2026-08-28T10:00:00Z");
const REQUEST = `sr_${"a".repeat(32)}`;
const HANDLE = `sh_${"b".repeat(32)}`;

const HAVE_DATABASE = await databaseReachable();
if (!HAVE_DATABASE) announceSkip("the Secure Service → Conversation Service lifecycle push");
const describeIfDatabase = HAVE_DATABASE ? describe : describe.skip;

let securePool: pg.Pool;
let conversationPool: pg.Pool;
let outbox: LifecycleOutbox;
let conversationStore: ConversationEventStore;
let server: Server;
let studentId: string;
/** Flipped by a test to make the conversation plane unreachable. */
let planeDown = false;
let serverErrors = 0;

async function freshDatabase(name: string): Promise<pg.Pool> {
  const admin = new pg.Pool({ connectionString: TEST_DATABASE_URL });
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }
  const url = new URL(TEST_DATABASE_URL);
  url.pathname = `/${name}`;
  return new pg.Pool({ connectionString: url.toString(), max: 8 });
}

let counter = 0;
async function newConversation(): Promise<string> {
  counter += 1;
  // Crockford base32, which is what `conversations_id_check` enforces: the
  // alphabet excludes I, L, O and U so a ULID cannot be misread aloud. My first
  // attempt used an L and every insert was refused — the constraint doing
  // exactly its job.
  const id = `01JBXQ8Z9WKTQ6M4H2NPR${String(counter).padStart(5, "0")}`;
  await conversationPool.query(
    "INSERT INTO conversations (id, student_id) VALUES ($1, $2)",
    [id, studentId],
  );
  return id;
}

/** A secret request in THIS plane's database, so the outbox FK is satisfied. */
async function newSecretRequest(conversationId: string, requestId = REQUEST): Promise<string> {
  await securePool.query(
    `INSERT INTO secret_requests
       (request_id, student_ref, conversation_id, case_ref, purpose, target_host, expires_at)
     VALUES ($1, 'student-1', $2, 'case-1', 'portal_account_creation', 'portal.example.ac.uk', $3)`,
    [requestId, conversationId, new Date(NOW.getTime() + 300_000)],
  );
  return requestId;
}

/**
 * Enqueues in a transaction, the way a real lifecycle change does.
 *
 * The `BEGIN`/`COMMIT` is not ceremony: `enqueue` takes a client precisely so
 * the transition and the intent to publish it commit together, and a test that
 * called it on a pool would be exercising a different guarantee.
 */
async function enqueue(
  requestId: string,
  conversationId: string,
  transition: Parameters<LifecycleOutbox["enqueue"]>[1]["transition"],
): Promise<void> {
  const client = await securePool.connect();
  try {
    await client.query("BEGIN");
    await outbox.enqueue(client, { requestId, conversationId, transition, now: NOW });
    await client.query("COMMIT");
  } finally {
    client.release();
  }
}

/** The real HTTP caller, wrapped so a test can sever the connection. */
const deliver: DeliverTransition = async (row: OutboxRow) => {
  if (planeDown) {
    // Points at a port nothing is listening on. A real connection failure, not
    // a stubbed rejection — the classification under test is what the client
    // does with a genuine `fetch` error.
    return await internalAppend({
      baseUrl: "http://127.0.0.1:1",
      serviceCertificate: CERT,
      timeoutMs: 750,
    })(row);
  }
  return await internalAppend({ baseUrl: BASE, serviceCertificate: CERT })(row);
};

beforeAll(async () => {
  if (!HAVE_DATABASE) return;
  securePool = await freshDatabase("aas_secure_lifecycle");
  conversationPool = await freshDatabase("aas_conversation_lifecycle");
  await migrate(securePool, MIGRATIONS_DIR);
  await migrate(conversationPool, CONVERSATION_MIGRATIONS);

  outbox = new LifecycleOutbox(securePool);
  conversationStore = new ConversationEventStore(conversationPool);

  const student = await conversationPool.query<{ id: string }>(
    "INSERT INTO students (subject, email_verified) VALUES ('oidc-lifecycle', true) RETURNING id",
  );
  studentId = student.rows[0]!.id;

  const app = express();
  app.use(express.json());
  // A 500 the test can turn on, ahead of the routes: the retryable branch has
  // to be exercised against a real 5xx response, not a simulated one.
  app.use((req, res, next) => {
    if (serverErrors > 0 && req.path.startsWith("/internal/")) {
      serverErrors -= 1;
      res.status(503).json({ code: "service_unavailable" });
      return;
    }
    next();
  });
  app.use(
    createConversationRoutes({
      store: conversationStore,
      authenticate: (req) => {
        const subject = req.header("x-student");
        return subject === undefined ? null : { studentId: subject };
      },
      authorise: async (caller, conversationId) => {
        const owned = await conversationPool.query(
          "SELECT 1 FROM conversations WHERE id = $1 AND student_id = $2",
          [conversationId, caller.studentId],
        );
        return owned.rowCount === 1;
      },
      // The mTLS stand-in the internal route already expects.
      authoriseService: (req) => req.header("x-service-cert") === CERT,
      now: () => NOW,
    }),
  );
  server = await new Promise<Server>((resolve) => {
    const listening = app.listen(PORT, "127.0.0.1", () => resolve(listening));
  });
}, 180_000);

afterAll(async () => {
  if (!HAVE_DATABASE) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await securePool.end();
  await conversationPool.end();
});

/** Sends a message as the owning student, and reports the status. */
async function sendMessage(conversationId: string, content: string): Promise<number> {
  const response = await fetch(`${BASE}/v1/conversations/${conversationId}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": `key-${String(Math.random()).slice(2)}-padding`,
      "x-student": studentId,
    },
    body: JSON.stringify({ content }),
  });
  return response.status;
}

async function eventKinds(conversationId: string): Promise<string[]> {
  return (await conversationStore.since(conversationId, 0)).map((event) => event.kind);
}

// ───────────────────────────────────────────────────────────────────────────
// The happy path, across the plane boundary
// ───────────────────────────────────────────────────────────────────────────

describeIfDatabase("a lifecycle transition reaches the conversation log", () => {
  it("publishes a request and a receipt, and the guard follows the LOG", async () => {
    const conversation = await newConversation();
    const request = await newSecretRequest(conversation, `sr_${"1".repeat(32)}`);

    await enqueue(request, conversation, {
      kind: "secret_requested",
      channel: "secure_control",
      expiresAt: new Date(NOW.getTime() + 300_000),
    });
    expect(await outbox.publish(deliver, { now: NOW })).toEqual({ delivered: 1, failed: 0 });

    // The OTHER database now holds the event, and its guard refuses messages.
    expect(await eventKinds(conversation)).toEqual(["secret_requested"]);
    expect(await sendMessage(conversation, "while the step is open")).toBe(409);

    await enqueue(request, conversation, { kind: "secret_received", handle: HANDLE });
    expect(await outbox.publish(deliver, { now: NOW })).toEqual({ delivered: 1, failed: 0 });

    expect(await eventKinds(conversation)).toEqual(["secret_requested", "secret_received"]);
    // Released, and released BY THE LOG — no client told it anything.
    expect(await sendMessage(conversation, "now I can carry on")).toBe(201);
  }, 60_000);
});

// ───────────────────────────────────────────────────────────────────────────
// Failure, retry, and fail-closed
// ───────────────────────────────────────────────────────────────────────────

describeIfDatabase("when the push fails", () => {
  it("keeps the composer SHUT while the transition is undelivered", async () => {
    // ── The property this whole phase exists for ────────────────────────
    //
    // The browser believes the step settled: the student submitted, the secure
    // endpoint answered, the card closed. But the transition has NOT reached
    // the conversation log, so that service still sees an open request and
    // refuses. A composer that opened here would open on the browser's opinion.
    const conversation = await newConversation();
    const request = await newSecretRequest(conversation, `sr_${"2".repeat(32)}`);

    await enqueue(request, conversation, {
      kind: "secret_requested",
      channel: "secure_control",
      expiresAt: new Date(NOW.getTime() + 300_000),
    });
    await outbox.publish(deliver, { now: NOW });
    expect(await sendMessage(conversation, "blocked")).toBe(409);

    // The receipt is enqueued and the other plane is unreachable.
    await enqueue(request, conversation, { kind: "secret_received", handle: HANDLE });
    planeDown = true;
    try {
      expect(await outbox.publish(deliver, { now: NOW })).toEqual({ delivered: 0, failed: 1 });
    } finally {
      planeDown = false;
    }

    expect(await eventKinds(conversation)).toEqual(["secret_requested"]);
    expect(
      await sendMessage(conversation, "STILL blocked, and that is correct"),
      "the guard released on a transition the log never received",
    ).toBe(409);
    expect(await outbox.isDelivered(request, "secret_received")).toBe(false);

    // ── Recovery ────────────────────────────────────────────────────────
    //
    // The plane comes back and the SAME row is delivered. Nothing was lost,
    // because the transition and the intent to publish it committed together.
    const later = new Date(NOW.getTime() + 600_000);
    expect(await outbox.publish(deliver, { now: later })).toEqual({ delivered: 1, failed: 0 });
    expect(await eventKinds(conversation)).toEqual(["secret_requested", "secret_received"]);
    expect(await sendMessage(conversation, "released now")).toBe(201);
  }, 60_000);

  it("retries a 5xx and gives up on a refused credential", async () => {
    const conversation = await newConversation();
    const request = await newSecretRequest(conversation, `sr_${"3".repeat(32)}`);
    await enqueue(request, conversation, { kind: "secret_cancelled" });

    // One real 503 from the real route stack.
    serverErrors = 1;
    expect(await outbox.publish(deliver, { now: NOW })).toEqual({ delivered: 0, failed: 1 });
    expect(serverErrors, "the 503 was never actually served").toBe(0);
    expect(await eventKinds(conversation)).toEqual([]);

    // Backed off, so it is NOT due immediately — a retry loop that ignored the
    // backoff would hammer a service that just said it was overloaded.
    expect(await outbox.publish(deliver, { now: NOW })).toEqual({ delivered: 0, failed: 0 });

    const later = new Date(NOW.getTime() + backoffSeconds(1) * 1000 + 1_000);
    expect(await outbox.publish(deliver, { now: later })).toEqual({ delivered: 1, failed: 0 });
    expect(await eventKinds(conversation)).toEqual(["secret_cancelled"]);
  }, 60_000);

  it("treats a refused service credential as permanent, and does NOT mark it delivered", async () => {
    const conversation = await newConversation();
    const request = await newSecretRequest(conversation, `sr_${"4".repeat(32)}`);
    await enqueue(request, conversation, { kind: "secret_expired" });

    const wrongCertificate: DeliverTransition = async (row) =>
      await internalAppend({ baseUrl: BASE, serviceCertificate: "not-the-cert" })(row);
    expect(await outbox.publish(wrongCertificate, { now: NOW })).toEqual({
      delivered: 0,
      failed: 1,
    });

    expect(await eventKinds(conversation)).toEqual([]);
    // Still pending. Giving up must not look like success: "delivered" is what
    // tells a later reader the log heard about this.
    expect(await outbox.isDelivered(request, "secret_expired")).toBe(false);
    expect((await outbox.pending()).map((row) => row.requestId)).toContain(request);
  }, 60_000);
});

// ───────────────────────────────────────────────────────────────────────────
// Idempotency, against the real database and the real route
// ───────────────────────────────────────────────────────────────────────────

describeIfDatabase("a retry cannot duplicate a durable lifecycle event", () => {
  it("enqueues once, however many times the transition is recorded", async () => {
    const conversation = await newConversation();
    const request = await newSecretRequest(conversation, `sr_${"5".repeat(32)}`);

    await enqueue(request, conversation, { kind: "secret_received", handle: HANDLE });
    await enqueue(request, conversation, { kind: "secret_received", handle: HANDLE });
    await enqueue(request, conversation, { kind: "secret_received", handle: HANDLE });

    const rows = await securePool.query<{ n: string }>(
      "SELECT count(*) AS n FROM lifecycle_outbox WHERE request_id = $1 AND kind = 'secret_received'",
      [request],
    );
    expect(Number(rows.rows[0]!.n), "one_row_per_transition did not hold").toBe(1);

    await outbox.publish(deliver, { now: NOW });
    expect(await eventKinds(conversation)).toEqual(["secret_received"]);
  }, 60_000);

  it("appends once when a delivery SUCCEEDS but its response is lost", async () => {
    // The realistic duplicate: the conversation service wrote the event and the
    // reply never came back, so this service retries a transition that already
    // landed. The outbox cannot help — as far as it knows the attempt failed.
    // The internal route's idempotency on (conversation, request, kind) is what
    // stops the second copy.
    const conversation = await newConversation();
    const request = await newSecretRequest(conversation, `sr_${"6".repeat(32)}`);
    await enqueue(request, conversation, { kind: "secret_cancelled" });

    let attempts = 0;
    const losesTheFirstResponse: DeliverTransition = async (row) => {
      attempts += 1;
      const outcome = await deliver(row);
      // The write happened; the answer did not arrive. Reported as retryable,
      // which is exactly what a client sees when a connection drops after the
      // request was processed.
      return attempts === 1 ? { delivered: false, retry: true, code: "unreachable" } : outcome;
    };

    expect(await outbox.publish(losesTheFirstResponse, { now: NOW })).toEqual({
      delivered: 0,
      failed: 1,
    });
    // The event IS already there, from the attempt whose response was lost.
    expect(await eventKinds(conversation)).toEqual(["secret_cancelled"]);

    const later = new Date(NOW.getTime() + 600_000);
    expect(await outbox.publish(losesTheFirstResponse, { now: later })).toEqual({
      delivered: 1,
      failed: 0,
    });
    expect(attempts, "the retry never happened, so nothing was proven").toBe(2);

    // ONE event, after two deliveries of the same transition.
    expect(await eventKinds(conversation)).toEqual(["secret_cancelled"]);
    const stored = await conversationStore.since(conversation, 0);
    expect(stored.map((event) => event.ordinal)).toEqual([1]);
  }, 60_000);

  it("survives a Conversation Service restart mid-flight", async () => {
    const conversation = await newConversation();
    const request = await newSecretRequest(conversation, `sr_${"7".repeat(32)}`);
    await enqueue(request, conversation, { kind: "secret_consumed" });

    // Down. Not a flag — the listener is actually closed, so the delivery meets
    // a refused connection rather than a mocked rejection.
    await new Promise<void>((resolve) => server.close(() => resolve()));
    expect(await outbox.publish(deliver, { now: NOW })).toEqual({ delivered: 0, failed: 1 });
    expect(await outbox.isDelivered(request, "secret_consumed")).toBe(false);

    // Back up, on the same port, against the same database — which is what a
    // rolling deployment looks like from here.
    server = await new Promise<Server>((resolve) => {
      const listening = serverApp().listen(PORT, "127.0.0.1", () => resolve(listening));
    });

    const later = new Date(NOW.getTime() + 600_000);
    expect(await outbox.publish(deliver, { now: later })).toEqual({ delivered: 1, failed: 0 });
    expect(await eventKinds(conversation)).toEqual(["secret_consumed"]);
  }, 60_000);

  it("does not deliver the same row twice when two publishers run at once", async () => {
    // Several instances of this service all run the publisher. `FOR UPDATE SKIP
    // LOCKED` is what stops two of them claiming one row; without it both would
    // deliver, and only the conversation service's idempotency would save the
    // transcript.
    const conversation = await newConversation();
    const request = await newSecretRequest(conversation, `sr_${"8".repeat(32)}`);
    await enqueue(request, conversation, { kind: "secret_cancelled" });

    let deliveries = 0;
    const counting: DeliverTransition = async (row) => {
      deliveries += 1;
      return await deliver(row);
    };

    const [first, second] = await Promise.all([
      outbox.publish(counting, { now: NOW }),
      outbox.publish(counting, { now: NOW }),
    ]);

    expect(first.delivered + second.delivered).toBe(1);
    expect(deliveries, "two publishers both delivered the same row").toBe(1);
    expect(await eventKinds(conversation)).toEqual(["secret_cancelled"]);
  }, 60_000);
});

/** The conversation plane's app, rebuilt exactly as `beforeAll` builds it. */
function serverApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    if (serverErrors > 0 && req.path.startsWith("/internal/")) {
      serverErrors -= 1;
      res.status(503).json({ code: "service_unavailable" });
      return;
    }
    next();
  });
  app.use(
    createConversationRoutes({
      store: conversationStore,
      authenticate: (req) => {
        const subject = req.header("x-student");
        return subject === undefined ? null : { studentId: subject };
      },
      authorise: async (caller, conversationId) => {
        const owned = await conversationPool.query(
          "SELECT 1 FROM conversations WHERE id = $1 AND student_id = $2",
          [conversationId, caller.studentId],
        );
        return owned.rowCount === 1;
      },
      authoriseService: (req) => req.header("x-service-cert") === CERT,
      now: () => NOW,
    }),
  );
  return app;
}
