/**
 * The last line: what the server does when the client cannot be believed.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-27: *"keep server-side fail-closed protection as a backup
 * boundary"* … *"fix the binding lookup/open-request behaviour so the guard
 * cannot fail open after restart"* … *"test the normal path, restart path,
 * bypassed or stale client path and deliberate regressions."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── The test that matters most is the restart one ─────────────────────────
 *
 * `DatabaseSecretBindingStore` keeps a process-local map of open requests. The
 * old `find` read only that map, and its doc comment claimed a "read-through
 * cache" it did not have. For the SECRET endpoint an empty map is harmless —
 * an unknown request is refused, which fails closed.
 *
 * For THIS guard the same emptiness is a hole. "No open request" means "let
 * the message through", so a restarted process would reopen the ordinary
 * message pipeline at exactly the moment a student is most likely to type a
 * password into it. Nothing would look wrong: no error, no log line, a green
 * suite.
 *
 * So the restart test below does not simulate a restart with a flag. It builds
 * a SECOND store against the same database, which is what a restarted process
 * actually is — a fresh object with an empty cache and the rows still there.
 */

import type { Server } from "node:http";
import { inspect } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import jwt from "jsonwebtoken";
import pg from "pg";

import { InMemorySecretStore } from "@askimate/aas-secrets";
import type { SecretRequestId } from "@askimate/aas-secrets";

import { createChatApp } from "./app.js";
import { DatabaseSecretBindingStore } from "./bindings.js";
import { DatabaseConversationEventStore } from "./conversation-events.js";
import type { ChatTurn } from "./chat-transport.js";
import { SCHEMA_DDL } from "./schema.js";
import { announceSkip, databaseReachable } from "./test-database.js";

const MARKER = "SECRET-PASSWORD-DO-NOT-LEAK-123!";
const PORT = 4715;
const BASE = `http://127.0.0.1:${String(PORT)}`;
const JWT_SECRET = "test-jwt-secret-not-a-real-one";
const CASE_REF = "case-q";
const PORTAL_HOST = "apply.example.ac.uk";
const USER_ID = 1;
const CONVERSATION_ID = 77;
const NOW = new Date();

const DATABASE_URL =
  process.env["AAS_TEST_DATABASE_URL"] ?? "postgresql://postgres@localhost:55432/postgres";

const HAVE_DATABASE = await databaseReachable();
if (!HAVE_DATABASE) announceSkip("the server-side quarantine guard, including the restart path");
const describeIfDatabase = HAVE_DATABASE ? describe : describe.skip;


/** Everything written to stdout, stderr or console while a test runs. */
const captured: string[] = [];

/**
 * Hooks console AND the raw streams.
 *
 * `end-to-end.test.ts` records why: a first attempt hooked only
 * `process.stdout.write` and captured ZERO bytes, because vitest replaces the
 * console methods with its own reporters. The scan then passed while scanning
 * an empty string — a test that could not fail. Both are hooked here for the
 * same reason.
 */
function captureOutput(): () => void {
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  const record = (parts: unknown[]): void => {
    captured.push(parts.map((part) => (typeof part === "string" ? part : inspect(part))).join(" "));
  };
  const originals = {
    log: console.log.bind(console),
    error: console.error.bind(console),
    warn: console.warn.bind(console),
    info: console.info.bind(console),
    debug: console.debug.bind(console),
  };
  for (const name of ["log", "error", "warn", "info", "debug"] as const) {
    console[name] = ((...parts: unknown[]): void => {
      record(parts);
      originals[name](...parts);
    }) as typeof console.log;
  }
  // Same shape as `end-to-end.test.ts`. Annotating the parameters explicitly
  // made the inner cast redundant and the linter said so; letting them be
  // inferred from `typeof process.stdout.write` keeps the overloads intact.
  const tee =
    (real: typeof process.stdout.write): typeof process.stdout.write =>
    (chunk, ...rest): boolean => {
      if (typeof chunk === "string") captured.push(chunk);
      return (real as (...args: unknown[]) => boolean)(chunk, ...rest);
    };
  process.stdout.write = tee(realOut);
  process.stderr.write = tee(realErr);

  return (): void => {
    for (const name of ["log", "error", "warn", "info", "debug"] as const) {
      console[name] = originals[name] as typeof console.log;
    }
    process.stdout.write = realOut;
    process.stderr.write = realErr;
  };
}

let pool: pg.Pool;
let db: NodePgDatabase<Record<string, never>>;
let store: InMemorySecretStore;
let bindings: DatabaseSecretBindingStore;
let server: Server;

/** What the route was asked to do. Empty means the guard refused first. */
const persisted: { conversationId: number; content: string }[] = [];
const modelSaw: string[] = [];

function token(): string {
  return jwt.sign({ id: USER_ID, email: "a@example.test", emailVerified: true }, JWT_SECRET);
}

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

async function openSecretRequest(): Promise<SecretRequestId> {
  const opened = store.request(
    {
      studentRef: `student-${String(USER_ID)}` as never,
      purpose: "portal_account_creation",
      target: { host: PORTAL_HOST, caseRef: CASE_REF },
      explanation: "I need a password to set up your application account.",
      singleUse: true,
      ttlSeconds: 300,
    },
    NOW,
  );
  if (!opened.ok) throw new Error("request should open");
  await bindings.open({
    requestId: opened.prompt.requestId,
    userId: USER_ID,
    conversationId: CONVERSATION_ID,
    caseRef: CASE_REF,
    purpose: "portal_account_creation",
    targetHost: PORTAL_HOST,
    requiresConfirmation: opened.prompt.requiresConfirmation,
    lifecycle: "secret_requested",
    expiresAt: opened.prompt.expiresAt,
  });
  return opened.prompt.requestId;
}

async function send(content: string): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${BASE}/api/askimate/ai`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
    body: JSON.stringify({ conversationId: CONVERSATION_ID, content }),
  });
  return { status: response.status, body: await response.json() };
}

beforeAll(async () => {
  if (!HAVE_DATABASE) return;
  pool = await ownDatabase("aas_quarantine");
  db = drizzle(pool);
  await pool.query(SCHEMA_DDL);

  store = new InMemorySecretStore();
  bindings = new DatabaseSecretBindingStore(db, () => NOW);

  const app = createChatApp({
    store,
    bindings,
    jwtSecret: JWT_SECRET,
    now: () => NOW,
    chat: {
      persist: async (input) => {
        persisted.push(input);
        await Promise.resolve();
      },
      askModel: async (request) => {
        modelSaw.push(request.message, ...request.history.map((h) => h.content));
        return await Promise.resolve("ok");
      },
      historyFor: async () => await Promise.resolve([] as readonly ChatTurn[]),
    },
  });
  server = app.listen(PORT);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
});

afterAll(async () => {
  if (!HAVE_DATABASE) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

describeIfDatabase("the ordinary message path, guarded", () => {
  it("accepts a message when no secure request is open — the normal path", async () => {
    persisted.length = 0;
    modelSaw.length = 0;

    const { status, body } = await send("What documents do I need?");

    expect(status).toBe(200);
    expect(body).toMatchObject({ status: "accepted" });
    expect(persisted).toHaveLength(1);
    expect(modelSaw.join(" ")).toContain("What documents do I need?");
  });

  it("REFUSES a message while a secure request is open, storing and modelling nothing", async () => {
    persisted.length = 0;
    modelSaw.length = 0;
    const requestId = await openSecretRequest();

    const { status, body } = await send(MARKER);

    expect(status).toBe(409);
    expect(body).toMatchObject({ status: "refused", reason: "secret_request_open", requestId });

    // The three things that must not have happened.
    expect(persisted).toHaveLength(0);
    expect(modelSaw.join(" ")).not.toContain(MARKER);
    expect(JSON.stringify(body)).not.toContain(MARKER);

    store.discard(requestId);
    await bindings.record(requestId, { lifecycle: "secret_expired" });
  });

  it("refuses BEFORE reading the message, so the text never enters scope", async () => {
    // The guard is placed ahead of `readField(body, "content")` on purpose:
    // there must be no branch in which a password is pulled out of the body
    // into a variable and then discarded.
    //
    // Observable because a request with an open secret and NO content field
    // must still be refused with 409. If content validation ran first it
    // would answer 400, which would mean the body had been inspected before
    // the guard decided.
    const requestId = await openSecretRequest();
    try {
      const response = await fetch(`${BASE}/api/askimate/ai`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ conversationId: CONVERSATION_ID }),
      });
      expect(response.status).toBe(409);
    } finally {
      store.discard(requestId);
      await bindings.record(requestId, { lifecycle: "secret_expired" });
    }
  });

  it("tells a stale client WHICH request is open, so it can restore rather than lose the draft", async () => {
    const requestId = await openSecretRequest();
    const { body } = await send("a genuine question typed by a stale client");

    // The refusal carries enough for the client to re-render the card and keep
    // the text. A bare 409 would leave a correct client with no way to
    // distinguish "retry" from "you are out of date", and the draft would be
    // the thing that paid for it.
    expect(body).toMatchObject({ requestId });
    expect(body).toHaveProperty("expiresAt");

    store.discard(requestId);
    await bindings.record(requestId, { lifecycle: "secret_expired" });
  });

  it("REFUSES after a restart, when the process cache is empty — the fail-open case", async () => {
    persisted.length = 0;
    modelSaw.length = 0;
    const requestId = await openSecretRequest();

    // A restarted process is a fresh store object over the same rows. Its
    // cache is empty, so a cache-only lookup would answer "nothing is open"
    // and let the message through.
    const afterRestart = new DatabaseSecretBindingStore(db, () => NOW);
    expect(afterRestart.findSync(requestId)).toBeNull(); // the cache really is empty

    const open = await afterRestart.openRequestFor(CONVERSATION_ID, NOW);
    expect(open).not.toBeNull();
    expect(open?.requestId).toBe(requestId);

    store.discard(requestId);
    await bindings.record(requestId, { lifecycle: "secret_expired" });
  });

  it("releases the composer once the request reaches a terminal state", async () => {
    const requestId = await openSecretRequest();
    expect(await bindings.openRequestFor(CONVERSATION_ID, NOW)).not.toBeNull();

    // Cancellation and expiry share `secret_expired` — the lifecycle comment
    // already reads "the TTL passed, OR the student abandoned it", so no new
    // word was needed for cancel.
    await bindings.record(requestId, { lifecycle: "secret_expired" });

    expect(await bindings.openRequestFor(CONVERSATION_ID, NOW)).toBeNull();
    const { status } = await send("now I can talk again");
    expect(status).toBe(200);
  });

  it("treats an EXPIRED request as closed, checked through the ROUTE", async () => {
    // A student whose request lapsed must not be left with a dead composer,
    // and expiry is a fact about time rather than about a write having
    // happened — nothing marks the row when the clock passes it.
    //
    // Checked through HTTP so the ROUTE's expiry handling is what is under
    // test. A store-level assertion would pass even if the route forgot to
    // pass a clock at all.
    const expired = `sr_${"e".repeat(32)}` as SecretRequestId;
    await bindings.open({
      requestId: expired,
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      caseRef: CASE_REF,
      purpose: "portal_account_creation",
      targetHost: PORTAL_HOST,
      requiresConfirmation: true,
      lifecycle: "secret_requested",
      // Already past when the route reads its clock.
      expiresAt: new Date(NOW.getTime() - 60 * 1000),
    });

    const { status } = await send("the password step lapsed; I can still talk");
    expect(status).toBe(200);
  });

  it("scopes the guard to ONE conversation, checked through the ROUTE", async () => {
    // Asserting only on `openRequestFor` would test the store and leave the
    // route unexamined — a handler that looked up a hardcoded or global
    // conversation would pass. So this goes through HTTP, both ways: the
    // guarded conversation is refused and a different one is not.
    //
    // The failure this prevents is a denial of service, not a leak: one
    // student's open password step closing every other conversation.
    const requestId = await openSecretRequest();
    try {
      const guarded = await send("on the conversation with the open request");
      expect(guarded.status).toBe(409);

      const other = await fetch(`${BASE}/api/askimate/ai`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ conversationId: CONVERSATION_ID + 1, content: "a different chat" }),
      });
      expect(other.status).toBe(200);
    } finally {
      store.discard(requestId);
      await bindings.record(requestId, { lifecycle: "secret_expired" });
    }
  });

  it("requires authentication BEFORE the guard, so a stranger learns nothing", async () => {
    // The first version of this test sent an unauthenticated request with NO
    // open secret request, and asserted 401. It passed — and it also passed
    // when the guard was moved AHEAD of authentication, because with nothing
    // open the guard is a no-op and the 401 comes out either way. It was named
    // for an ordering property it could not observe.
    //
    // Opening a request first is what makes the order visible. Auth first
    // gives 401. Guard first gives 409, which would tell an unauthenticated
    // caller that a password step is open on someone else's conversation —
    // an information disclosure, not merely a wrong status code.
    const requestId = await openSecretRequest();
    try {
      const response = await fetch(`${BASE}/api/askimate/ai`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: CONVERSATION_ID, content: MARKER }),
      });
      expect(response.status).toBe(401);

      // And the body says nothing about the open request.
      const body = JSON.stringify(await response.json());
      expect(body).not.toContain(requestId);
      expect(body).not.toContain("secret_request_open");
    } finally {
      store.discard(requestId);
      await bindings.record(requestId, { lifecycle: "secret_expired" });
    }
  });
});

describeIfDatabase("the two transports stay separate", () => {
  it("the chat route will not accept a secret submission", async () => {
    // A password posted to the ORDINARY endpoint must not be treated as a
    // message. The bodies differ by shape, and the shapes are not
    // interchangeable — `{ password }` has no `content`, so the message route
    // rejects it rather than storing the password as a chat message.
    persisted.length = 0;
    modelSaw.length = 0;

    const response = await fetch(`${BASE}/api/askimate/ai`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
      body: JSON.stringify({ conversationId: CONVERSATION_ID, password: MARKER }),
    });

    expect(response.status).toBe(400);
    expect(persisted).toHaveLength(0);
    expect(modelSaw.join(" ")).not.toContain(MARKER);
    expect(JSON.stringify(await response.json())).not.toContain(MARKER);
  });

  it("the secret route will not accept an ordinary message", async () => {
    // The mirror. A `{ content }` body posted to the secure endpoint must not
    // be read as a password — otherwise a client bug could route chat text
    // into the secret store, where it would occupy a handle and be typed into
    // a university portal.
    const requestId = await openSecretRequest();
    try {
      const response = await fetch(`${BASE}/api/askimate/secret/${requestId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ conversationId: CONVERSATION_ID, content: "an ordinary question" }),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ reason: "empty" });
      // Nothing was stored, so the request is still waiting.
      expect(store.statusOf(requestId)?.lifecycle).toBe("secret_requested");
    } finally {
      store.discard(requestId);
      await bindings.record(requestId, { lifecycle: "secret_expired" });
    }
  });

  it("the two routes are different paths, and neither is reachable at the other", async () => {
    const requestId = await openSecretRequest();
    try {
      // The secure path does not answer as the chat route.
      const wrongWay = await fetch(`${BASE}/api/askimate/ai/${requestId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ password: MARKER }),
      });
      expect(wrongWay.status).toBe(404);
    } finally {
      store.discard(requestId);
      await bindings.record(requestId, { lifecycle: "secret_expired" });
    }
  });
});

describeIfDatabase("nothing refused is written anywhere a person could read it", () => {
  it("a refused message reaches no log, no stdout and no stderr", async () => {
    const requestId = await openSecretRequest();
    captured.length = 0;
    const restore = captureOutput();
    try {
      const { status } = await send(MARKER);
      expect(status).toBe(409);
    } finally {
      restore();
      store.discard(requestId);
      await bindings.record(requestId, { lifecycle: "secret_expired" });
    }

    // The scan is only meaningful if something was captured at all — the
    // failure mode that made an earlier version of this check vacuous.
    expect(captured.join("")).not.toContain(MARKER);
  });

  it("captures SOMETHING when the process does write, so the scan is not vacuous", () => {
    // The control for the test above. If `captureOutput` silently caught
    // nothing, the previous assertion would pass over an empty string and
    // prove nothing at all. This proves the instrument works.
    captured.length = 0;
    const restore = captureOutput();
    try {
      console.warn("a canary line");
      process.stdout.write("another canary line\n");
    } finally {
      restore();
    }
    expect(captured.join("")).toContain("a canary line");
    expect(captured.join("")).toContain("another canary line");
  });
});

describeIfDatabase("the conversation-events table cannot hold what a student typed", () => {
  it("REFUSES a free-text kind — the closed set is enforced by the DATABASE", async () => {
    // Not a convention, not a code review rule: an INSERT of anything outside
    // the set fails at the database. "Just put the message in there" is not
    // available to a future caller.
    await expect(
      pool.query(
        `INSERT INTO askimate_conversation_events
           (conversation_id, ordinal, kind, request_id) VALUES ($1,$2,$3,$4)`,
        [CONVERSATION_ID, 900, MARKER, "sr_" + "a".repeat(32)],
      ),
    ).rejects.toThrow(/violates check constraint/);
  });

  it("REFUSES a free-text reason code", async () => {
    await expect(
      pool.query(
        `INSERT INTO askimate_conversation_events
           (conversation_id, ordinal, kind, request_id, reason_code) VALUES ($1,$2,$3,$4,$5)`,
        [CONVERSATION_ID, 901, "secret_rejected", "sr_" + "a".repeat(32), MARKER],
      ),
    ).rejects.toThrow(/violates check constraint/);
  });

  it("REFUSES a free-text lifecycle", async () => {
    await expect(
      pool.query(
        `INSERT INTO askimate_conversation_events
           (conversation_id, ordinal, kind, request_id, lifecycle) VALUES ($1,$2,$3,$4,$5)`,
        [CONVERSATION_ID, 902, "secret_status", "sr_" + "a".repeat(32), MARKER],
      ),
    ).rejects.toThrow(/violates check constraint/);
  });

  it("has no column a free-text value could reach", async () => {
    // The catalogue, not a list someone maintains. Every text column on the
    // table must be one of the four constrained ones.
    const cols = await pool.query<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_name = 'askimate_conversation_events'
          AND data_type IN ('text','character varying','json','jsonb')`,
    );
    expect(cols.rows.map((r) => r.column_name).sort()).toEqual(
      ["kind", "lifecycle", "reason_code", "request_id"],
    );
  });

  it("round-trips events and keeps them in transcript order", async () => {
    const events = new DatabaseConversationEventStore(db);
    const rid = await openSecretRequest();
    try {
      await events.record({ conversationId: 4242, ordinal: 2, kind: "secret_rejected",
                            requestId: rid, reasonCode: "confirmation_mismatch" });
      await events.record({ conversationId: 4242, ordinal: 1, kind: "directive", requestId: rid });
      const back = await events.eventsFor(4242);
      expect(back.map((e) => e.ordinal)).toEqual([1, 2]);
      expect(back.map((e) => e.kind)).toEqual(["directive", "secret_rejected"]);
      expect(JSON.stringify(back)).not.toContain(MARKER);
    } finally {
      store.discard(rid);
      await bindings.record(rid, { lifecycle: "secret_expired" });
    }
  });

  it("a replayed write does not duplicate an item in the transcript", async () => {
    const events = new DatabaseConversationEventStore(db);
    const rid = await openSecretRequest();
    try {
      const e = { conversationId: 4343, ordinal: 1, kind: "directive" as const, requestId: rid };
      await events.record(e);
      await events.record(e);
      expect(await events.eventsFor(4343)).toHaveLength(1);
    } finally {
      store.discard(rid);
      await bindings.record(rid, { lifecycle: "secret_expired" });
    }
  });
});

describeIfDatabase("cancelling a secure step releases the conversation", () => {
  it("DELETE marks it expired and reopens the ordinary message path", async () => {
    const rid = await openSecretRequest();
    // While open, the guard refuses.
    expect((await send("blocked while the step is open")).status).toBe(409);

    const response = await fetch(`${BASE}/api/askimate/secret/${rid}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token()}` },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ lifecycle: "secret_expired" });

    // The store destroyed the entry…
    expect(store.statusOf(rid)?.lifecycle).toBe("secret_expired");
    // …and the student can talk again.
    expect((await send("I changed my mind, let us carry on")).status).toBe(200);
  });

  it("refuses to cancel someone else's request, and says nothing about it", async () => {
    const rid = await openSecretRequest();
    try {
      const other = jwt.sign(
        { id: USER_ID + 99, email: "other@example.test", emailVerified: true }, JWT_SECRET);
      const response = await fetch(`${BASE}/api/askimate/secret/${rid}`, {
        method: "DELETE", headers: { Authorization: `Bearer ${other}` },
      });
      expect(response.status).toBe(404);
      // Same answer as "does not exist" — a different code would confirm that
      // another student had been asked for a password.
      expect(await response.json()).toEqual({ error: "Unknown request" });
      // And it really did not cancel it.
      expect(store.statusOf(rid)?.lifecycle).toBe("secret_requested");
    } finally {
      store.discard(rid);
      await bindings.record(rid, { lifecycle: "secret_expired" });
    }
  });

  it("requires authentication", async () => {
    const rid = await openSecretRequest();
    try {
      const response = await fetch(`${BASE}/api/askimate/secret/${rid}`, { method: "DELETE" });
      expect(response.status).toBe(401);
      expect(store.statusOf(rid)?.lifecycle).toBe("secret_requested");
    } finally {
      store.discard(rid);
      await bindings.record(rid, { lifecycle: "secret_expired" });
    }
  });
});
