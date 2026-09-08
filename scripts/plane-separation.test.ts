/**
 * The two planes are different services, and neither answers for the other.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * These four properties were asserted in `apps/chat-integration/src/
 * two-origin.test.ts` and nowhere else. That app is a research build against a
 * codebase now ten weeks stale, removed in P53 — but the properties are not
 * about it. They are about the TWO DEPLOYABLES: `createConversationApp` and
 * `createSecureApp`, imported here exactly as they were there.
 *
 * Vahid, 2026-09-08, on removing the research build: *"Its value was evidence
 * that the secure channel works on AskiMate's real stack shape, and that
 * evidence is recorded in the ADR trail."* True of the React client and its
 * browser proof. NOT true of these: an ADR saying "we demonstrated this once"
 * is not a check that fails the day it stops being true, and that difference is
 * this repository's whole method (ADR-0072, ADR-0073).
 *
 * So they moved rather than went. What is deliberately NOT here is anything
 * needing a browser — see the note at the foot of this file.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why `scripts/` ────────────────────────────────────────────────────────
 *
 * It is where this repository already keeps a test that boots MORE THAN ONE
 * service: `journey.test.ts`, `runner-supervisor.test.ts`, `p18-startup`,
 * `p19-identity`, `p20-catalogue`, `p21-target-selection`. A test that asserts
 * a property OF THE BOUNDARY between two deployables belongs to neither of
 * them, and putting it inside one would make that one's suite the owner of the
 * other's behaviour.
 *
 * ── It launches no browser ────────────────────────────────────────────────
 *
 * All four are HTTP. That is worth stating because the file they came from is
 * one of the seventeen in the serialised chromium lane (ADR-0081), and these
 * four cost that lane nothing now.
 */

import type { Server } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import { migrate } from "@askimate/aas-migrate";
import { announceSkip, databaseReachable, TEST_DATABASE_URL } from "@askimate/aas-migrate/testing";
import {
  ConversationEventStore,
  MIGRATIONS_DIR as CONVERSATION_MIGRATIONS,
  createConversationApp,
} from "@askimate/aas-conversation-service";
import {
  LifecycleOutbox,
  MIGRATIONS_DIR as SECURE_MIGRATIONS,
  SecureLogger,
  SecureRequestStore,
  createSecureApp,
} from "@askimate/aas-secure-service";
import {
  EnvelopeVault,
  InMemoryEnvelopeCache,
  LocalDataKeyProvider,
} from "@askimate/aas-secrets";

const CHAT_PORT = 4881;
const SECURE_PORT = 4882;
const CHAT = `http://127.0.0.1:${String(CHAT_PORT)}`;
const SECURE = `http://localhost:${String(SECURE_PORT)}`;
const SESSION_SECRET = "plane-separation-session-secret";
const CERT = "conversation-service";
const clock = (): Date => new Date();

/** The credential a real browser would type into the Secure Plane. */
const PASSWORD = "Tr0ub4dor-and-3-HORSE-battery!";

/**
 * A conversation used only by tests that talk to the services directly.
 *
 * It never gets a page, so it needs no row in the conversation plane — the
 * secure plane stores the id as an opaque string and cannot read that database
 * anyway, which is the separation ADR-0037 requires.
 */
const CONVERSATION_FOR_DIRECT_TESTS = "01JBXQ8Z9WKTQ6M4H2NPT99999";

const HAVE_DATABASE = await databaseReachable();
if (!HAVE_DATABASE) announceSkip("plane separation between the two services");
const describeIfDatabase = HAVE_DATABASE ? describe : describe.skip;

let chatPool: pg.Pool;
let securePool: pg.Pool;
let conversationStore: ConversationEventStore;
let secureStore: SecureRequestStore;
let chatServer: Server;
let secureServer: Server;
let studentId: string;

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
  return new pg.Pool({ connectionString: url.toString(), max: 10 });
}

let counter = 0;
async function newConversation(): Promise<string> {
  counter += 1;
  const id = `01JBXQ8Z9WKTQ6M4H2NPS${String(counter).padStart(5, "0")}`;
  await chatPool.query("INSERT INTO conversations (id, student_id) VALUES ($1, $2)", [
    id,
    studentId,
  ]);
  return id;
}

/** Opens a secure request the way the orchestrator does, over the internal API. */
async function openSecureRequest(
  conversationId: string = CONVERSATION_FOR_DIRECT_TESTS,
): Promise<{ requestId: string; frameToken: string }> {
  const response = await fetch(`${SECURE}/internal/v1/secret-requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-service-cert": CERT },
    body: JSON.stringify({
      studentRef: studentId,
      conversationId,
      caseRef: "case-1",
      purpose: "portal_account_creation",
      targetHost: "portal.example.ac.uk",
      ttlSeconds: 300,
    }),
  });
  const text = await response.text();
  expect(response.status, text).toBe(201);
  return JSON.parse(text) as { requestId: string; frameToken: string };
}

/** Opens a request AND records the durable event, so the composer is held shut. */
async function openSecureStep(conversationId: string): Promise<string> {
  const opened = await fetch(`${SECURE}/internal/v1/secret-requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-service-cert": CERT },
    body: JSON.stringify({
      studentRef: studentId,
      conversationId,
      caseRef: "case-1",
      purpose: "portal_account_creation",
      targetHost: "portal.example.ac.uk",
      title: "Choose a password for the university portal",
      explanation: "AskiMate uses it once and can never read it back.",
      ttlSeconds: 300,
    }),
  });
  expect(opened.status).toBe(201);
  const { requestId, expiresAt } = (await opened.json()) as {
    requestId: string;
    expiresAt: string;
  };
  await conversationStore.append({
    conversationId,
    event: { kind: "secret_requested", requestId, channel: "secure_control", expiresAt },
  });
  return requestId;
}

/** This plane's session cookie, as a `Cookie` header value. */
async function secureSessionCookie(requestId: string, frameToken: string): Promise<string> {
  const response = await fetch(`${SECURE}/v1/frame-sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: SECURE, "Sec-Fetch-Site": "same-origin" },
    body: JSON.stringify({ requestId, frameToken }),
  });
  expect(response.status).toBe(204);
  const value = /__Host-secure_session=([^;]+)/.exec(response.headers.get("set-cookie") ?? "")?.[1];
  expect(value, "no secure session cookie was set").toBeDefined();
  return `__Host-secure_session=${String(value)}`;
}

/** The conversation plane's session cookie, as a `Cookie` header value. */
async function chatSessionCookie(): Promise<string> {
  const response = await fetch(`${CHAT}/dev/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subject: studentId }),
  });
  expect(response.status).toBe(204);
  const value = /__Host-aas-session=([^;]+)/.exec(response.headers.get("set-cookie") ?? "")?.[1];
  expect(value, "no conversation session cookie was set").toBeDefined();
  return `__Host-aas-session=${String(value)}`;
}

beforeAll(async () => {
  if (!HAVE_DATABASE) return;
  chatPool = await freshDatabase("aas_plane_separation_chat");
  securePool = await freshDatabase("aas_plane_separation_secure");
  await migrate(chatPool, CONVERSATION_MIGRATIONS);
  await migrate(securePool, SECURE_MIGRATIONS);

  conversationStore = new ConversationEventStore(chatPool);
  secureStore = new SecureRequestStore(securePool);

  const student = await chatPool.query<{ id: string }>(
    "INSERT INTO students (subject, email_verified) VALUES ('oidc-plane-separation', true) RETURNING id",
  );
  studentId = student.rows[0]!.id;

  // No `assetDir` contents and no client build: nothing here fetches the control
  // document or a page. The apps are the real ones; only the browser is absent.
  const secureApp = createSecureApp({
    store: secureStore,
    vault: new EnvelopeVault(new LocalDataKeyProvider(), new InMemoryEnvelopeCache()),
    outbox: new LifecycleOutbox(securePool),
    now: clock,
    selfOrigin: SECURE,
    parentOrigin: CHAT,
    logger: new SecureLogger(() => {
      /* the log's contents are asserted by the secure service's own suite */
    }),
    authoriseService: (req) => req.header("x-service-cert") === CERT,
  });
  secureServer = await new Promise<Server>((resolve) => {
    const listening = secureApp.listen(SECURE_PORT, "127.0.0.1", () => resolve(listening));
  });

  const chatApp = createConversationApp({
    store: conversationStore,
    sessionSecret: SESSION_SECRET,
    authorise: async (subject, conversationId) => {
      const owned = await chatPool.query(
        "SELECT 1 FROM conversations WHERE id = $1 AND student_id = $2",
        [conversationId, subject],
      );
      return owned.rowCount === 1;
    },
    now: clock,
    pollIntervalMs: 150,
    heartbeatIntervalMs: 5_000,
    maxStreamMs: 30_000,
    secureOrigin: SECURE,
    authoriseService: (req) => req.header("x-service-cert") === "secure-service",
    mintFrameToken: async (requestId) => await secureStore.mintFrameToken(requestId, clock()),
    issueSessionFor: (req) => {
      const subject = (req.body as { subject?: unknown } | undefined)?.subject;
      return typeof subject === "string" ? subject : null;
    },
  });
  chatServer = await new Promise<Server>((resolve) => {
    const listening = chatApp.listen(CHAT_PORT, "127.0.0.1", () => resolve(listening));
  });
}, 240_000);

afterAll(async () => {
  if (!HAVE_DATABASE) return;
  await new Promise<void>((resolve) => chatServer.close(() => resolve()));
  await new Promise<void>((resolve) => secureServer.close(() => resolve()));
  await chatPool.end();
  await securePool.end();
});

describeIfDatabase("plane separation", () => {
  it("the Conversation Service has NO route that accepts a secret", async () => {
    const conversation = await newConversation();
    const cookie = await chatSessionCookie();

    // Every shape the secure endpoint accepts, offered to the conversation
    // plane at the secure plane's paths. All 404: the routes do not exist here.
    for (const path of [
      `/v1/secret-requests/sr_${"a".repeat(32)}/secret`,
      "/v1/frame-sessions",
      `/control/sr_${"a".repeat(32)}`,
    ]) {
      const response = await fetch(`${CHAT}${path}`, {
        method: path.startsWith("/control") ? "GET" : "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        ...(path.startsWith("/control")
          ? {}
          : { body: JSON.stringify({ secret: PASSWORD, conversationId: conversation }) }),
      });
      expect(response.status, `${path} answered ${String(response.status)}`).toBe(404);
      expect(await response.text()).not.toContain(PASSWORD);
    }

    // And the ONE route it does have refuses a body with a `secret` field: the
    // schema is closed, so the field is simply not read. What is stored is the
    // `content`, and nothing else in the body reaches a column.
    const smuggled = await fetch(`${CHAT}/v1/conversations/${conversation}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "smuggling-a-secret-field-01",
        Cookie: cookie,
      },
      body: JSON.stringify({ content: "an ordinary message", secret: PASSWORD }),
    });
    expect(smuggled.status).toBe(201);
    expect(await smuggled.text()).not.toContain(PASSWORD);

    // Every text-ish column of the whole conversation plane, scanned. A field
    // the schema ignored could still have reached a jsonb blob somewhere.
    const columns = await chatPool.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public'
          AND data_type IN ('text','character varying','character','json','jsonb')`,
    );
    expect(columns.rowCount).toBeGreaterThan(5);
    for (const { table_name, column_name } of columns.rows) {
      const hits = await chatPool.query<{ n: string }>(
        `SELECT count(*) AS n FROM "${table_name}" WHERE "${column_name}"::text LIKE $1`,
        [`%${PASSWORD}%`],
      );
      expect(Number(hits.rows[0]!.n), `${table_name}.${column_name}`).toBe(0);
    }
  }, 60_000);

  it("the Secure Service has NO route that accepts an ordinary message", async () => {
    const conversation = await newConversation();
    for (const path of [
      `/v1/conversations/${conversation}/messages`,
      `/v1/conversations/${conversation}/events`,
      `/v1/conversations/${conversation}/stream`,
    ]) {
      const response = await fetch(`${SECURE}${path}`, {
        method: path.endsWith("/messages") ? "POST" : "GET",
        headers: { "Content-Type": "application/json" },
        ...(path.endsWith("/messages")
          ? { body: JSON.stringify({ content: "an ordinary message" }) }
          : {}),
      });
      expect(response.status, `${path} answered ${String(response.status)}`).toBe(404);
    }
  }, 60_000);

  it("keeps the two sessions apart: neither cookie works on the other plane", async () => {
    // Both are named `__Host-…` and both are HttpOnly, and they are DIFFERENT
    // cookies on different origins. A browser will not send one to the other,
    // and neither service would accept it if it did.
    const { requestId, frameToken } = await openSecureRequest();
    const secureCookie = await secureSessionCookie(requestId, frameToken);
    const conversation = await newConversation();

    const withSecureCookie = await fetch(`${CHAT}/v1/conversations/${conversation}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "wrong-plane-cookie-key-1",
        Cookie: secureCookie,
      },
      body: JSON.stringify({ content: "using the wrong plane's session" }),
    });
    expect(withSecureCookie.status).toBe(401);

    const chatCookie = await chatSessionCookie();
    const withChatCookie = await fetch(`${SECURE}/v1/secret-requests/${requestId}`, {
      headers: { Cookie: chatCookie },
    });
    expect(withChatCookie.status).toBe(401);
  }, 60_000);

  it("refuses a client that POSTs directly while a secure step is open", async () => {
    // ── Bypassing the UI is the point ────────────────────────────────────
    //
    // The page holds the composer shut while a secure step is open, and a page
    // is not a control. This asserts the SERVICE refuses it — a student whose
    // client is stale, or scripted, or simply reloaded into an old bundle,
    // cannot type a password into the ordinary message box and have it stored.
    //
    // In `two-origin.test.ts` this ran inside the browser to borrow the page's
    // cookie. Nothing about the property needs a browser: the cookie is
    // obtainable over HTTP, and what is asserted is the service's answer.
    const conversation = await newConversation();
    await openSecureStep(conversation);
    const cookie = await chatSessionCookie();

    const refused = await fetch(`${CHAT}/v1/conversations/${conversation}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "bypassing-the-ui-key",
        Cookie: cookie,
      },
      body: JSON.stringify({ content: "A-PASSWORD-TYPED-INTO-THE-WRONG-BOX" }),
    });

    expect(refused.status).toBe(409);
    const body = await refused.text();
    expect(body, "the refusal echoed what was typed").not.toContain(
      "A-PASSWORD-TYPED-INTO-THE-WRONG-BOX",
    );

    const stored = await chatPool.query<{ n: string }>(
      "SELECT count(*) AS n FROM message_bodies WHERE content LIKE '%WRONG-BOX%'",
    );
    expect(Number(stored.rows[0]!.n), "it was refused and stored anyway").toBe(0);
  }, 60_000);
});

// ───────────────────────────────────────────────────────────────────────────
// What did NOT come across, and why (P53)
//
// Two properties from `two-origin.test.ts` need a real browser and a real
// secure frame, and they are NOT here:
//
//   "keeps the password out of every postMessage that crosses the boundary"
//   "NEVER fetches a bootstrap capability it cannot use"
//
// Both are about the CLIENT's behaviour, and the client they were written for
// is the React research build being removed. The production client is
// `apps/conversation-service/src/client/journey.ts`, which mounts its own
// cross-origin frame and posts its own handshake — a different implementation
// of the same design, so the assertions do not transfer by moving a file.
//
// Rebuilding them against `journey.ts` needs a two-origin browser harness that
// does not exist yet: `student-client.test.ts` configures a `secureOrigin` with
// nothing listening on it. That is a phase, and it is recorded as one rather
// than pretended away here.
// ───────────────────────────────────────────────────────────────────────────
