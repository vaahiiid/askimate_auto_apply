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

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import jwt from "jsonwebtoken";
import pg from "pg";

import { InMemorySecretStore } from "@askimate/aas-secrets";
import type { SecretRequestId } from "@askimate/aas-secrets";

import { createChatApp } from "./app.js";
import { DatabaseSecretBindingStore } from "./bindings.js";
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

  it("treats an EXPIRED request as closed, so a student is never stuck", async () => {
    const requestId = await openSecretRequest();
    // Read the world from a moment after the TTL rather than mutating the row:
    // a student whose request lapsed must not be left with a dead composer,
    // and expiry is a fact about time, not about a write having happened.
    const afterTtl = new Date(NOW.getTime() + 6 * 60 * 1000);

    expect(await bindings.openRequestFor(CONVERSATION_ID, afterTtl)).toBeNull();

    store.discard(requestId);
    await bindings.record(requestId, { lifecycle: "secret_expired" });
  });

  it("scopes the guard to ONE conversation", async () => {
    const requestId = await openSecretRequest();
    // A password request in one conversation must not close the message path
    // in another — that would be a denial of service triggered by any open
    // request anywhere.
    expect(await bindings.openRequestFor(CONVERSATION_ID + 1, NOW)).toBeNull();
    expect(await bindings.openRequestFor(CONVERSATION_ID, NOW)).not.toBeNull();

    store.discard(requestId);
    await bindings.record(requestId, { lifecycle: "secret_expired" });
  });

  it("requires authentication before it decides anything", async () => {
    const response = await fetch(`${BASE}/api/askimate/ai`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId: CONVERSATION_ID, content: MARKER }),
    });
    expect(response.status).toBe(401);
  });
});
