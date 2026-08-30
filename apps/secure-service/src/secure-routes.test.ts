/**
 * The Secure Interaction Service, against a real database and a real vault.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-28: *"Add tests that deliberately cause malformed credential
 * submissions, rejected requests, internal failures — and verify the submitted
 * secret does not appear in captured logs. Do not merely assert that normal
 * success logs are clean."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Every log assertion below runs on a FAILURE path. A success path that logs
 * cleanly proves very little: the interesting lines are written by handlers
 * that are refusing something, and by the error handler that never runs on a
 * good day.
 */

import type { Server } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import { migrate } from "@askimate/aas-migrate";
import { announceSkip, databaseReachable, TEST_DATABASE_URL } from "@askimate/aas-migrate/testing";
import {
  EnvelopeVault,
  InMemoryEnvelopeCache,
  LocalDataKeyProvider,
} from "@askimate/aas-secrets";

import { MIGRATIONS_DIR } from "./index.js";
import { SecureRequestStore } from "./requests.js";
import { LifecycleOutbox } from "./lifecycle-outbox.js";
import { SecureLogger } from "@askimate/aas-secure-logging";
import { createSecureApp } from "./app.js";
import { SECURE_SESSION_COOKIE } from "./routes.js";

const PORT = 4861;
const SELF = `http://127.0.0.1:${String(PORT)}`;
const PARENT = "http://127.0.0.1:4839";
const CERT = "conversation-service";
const NOW = new Date("2026-08-28T10:00:00Z");
const MARKER = "SUPER-SECRET-PASSWORD-MARKER-42!";
const CONVERSATION = "01JBXQ8Z9WKTQ6M4H2NPB00001";

const HAVE_DATABASE = await databaseReachable();
if (!HAVE_DATABASE) announceSkip("the Secure Interaction Service HTTP surface");
const describeIfDatabase = HAVE_DATABASE ? describe : describe.skip;

let pool: pg.Pool;
let store: SecureRequestStore;
let cache: InMemoryEnvelopeCache;
let vault: EnvelopeVault;
let server: Server;
/** Every line the service wrote, captured through the injected sink. */
let logLines: string[] = [];

/** Opens a request through the real internal route. */
async function open(
  overrides: Record<string, unknown> = {},
): Promise<{ requestId: string; frameToken: string }> {
  const response = await fetch(`${SELF}/internal/v1/secret-requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-service-cert": CERT },
    body: JSON.stringify({
      studentRef: "student-1",
      conversationId: CONVERSATION,
      caseRef: "case-1",
      purpose: "portal_account_creation",
      targetHost: "portal.example.ac.uk",
      title: "Choose a password for the university portal",
      explanation: "AskiMate will use it once and cannot read it back.",
      ttlSeconds: 300,
      ...overrides,
    }),
  });
  // Read ONCE. `expect(status, await response.text())` and then
  // `response.json()` consumes the body twice, and the second read throws
  // "Body has already been read" — which every test then reported instead of
  // whatever it was actually checking.
  const text = await response.text();
  expect(response.status, text).toBe(201);
  return JSON.parse(text) as { requestId: string; frameToken: string };
}

/** Exchanges a frame token for this plane's session cookie. */
async function bootstrap(requestId: string, frameToken: string): Promise<string | null> {
  const response = await fetch(`${SELF}/v1/frame-sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: SELF,
      "Sec-Fetch-Site": "same-origin",
    },
    body: JSON.stringify({ requestId, frameToken }),
  });
  if (response.status !== 204) return null;
  const setCookie = response.headers.get("set-cookie") ?? "";
  const value = /__Host-secure_session=([^;]+)/.exec(setCookie)?.[1];
  return value === undefined ? null : `${SECURE_SESSION_COOKIE}=${value}`;
}

async function submit(
  requestId: string,
  cookie: string | null,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<{ status: number; text: string }> {
  const response = await fetch(`${SELF}/v1/secret-requests/${requestId}/secret`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: SELF,
      "Sec-Fetch-Site": "same-origin",
      ...(cookie === null ? {} : { Cookie: cookie }),
      ...headers,
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, text: await response.text() };
}

beforeAll(async () => {
  if (!HAVE_DATABASE) return;
  const admin = new pg.Pool({ connectionString: TEST_DATABASE_URL });
  try {
    await admin.query("DROP DATABASE IF EXISTS aas_secure_routes WITH (FORCE)");
    await admin.query("CREATE DATABASE aas_secure_routes");
  } finally {
    await admin.end();
  }
  const url = new URL(TEST_DATABASE_URL);
  url.pathname = "/aas_secure_routes";
  pool = new pg.Pool({ connectionString: url.toString(), max: 8 });
  await migrate(pool, MIGRATIONS_DIR);

  store = new SecureRequestStore(pool);
  cache = new InMemoryEnvelopeCache();
  vault = new EnvelopeVault(new LocalDataKeyProvider(), cache);

  const app = createSecureApp({
    store,
    vault,
    outbox: new LifecycleOutbox(pool),
    now: () => NOW,
    selfOrigin: SELF,
    parentOrigin: PARENT,
    // Captured rather than printed, so an assertion can read every line the
    // service wrote — including the ones written while refusing.
    logger: new SecureLogger((line) => logLines.push(line)),
    authoriseService: (req) => req.header("x-service-cert") === CERT,
  });
  server = await new Promise<Server>((resolve) => {
    const listening = app.listen(PORT, "127.0.0.1", () => resolve(listening));
  });
}, 120_000);

afterAll(async () => {
  if (!HAVE_DATABASE) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

// ───────────────────────────────────────────────────────────────────────────
// The bootstrap
// ───────────────────────────────────────────────────────────────────────────

describeIfDatabase("the one-time frame bootstrap", () => {
  it("exchanges a token for a __Host- cookie with every required attribute", async () => {
    const { requestId, frameToken } = await open();
    const response = await fetch(`${SELF}/v1/frame-sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: SELF, "Sec-Fetch-Site": "same-origin" },
      body: JSON.stringify({ requestId, frameToken }),
    });
    expect(response.status).toBe(204);
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("__Host-secure_session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("Path=/");
    // No Domain: `__Host-` forbids it, and that is what stops a sibling
    // subdomain setting a session this service would honour.
    expect(setCookie).not.toMatch(/;\s*Domain=/i);
    // ── SameSite=None; Partitioned, and NOT Lax ───────────────────────
    //
    // Measured, not assumed: a `Lax` cookie is not sent on requests made from
    // inside a cross-site iframe, which is the only context this session ever
    // exists in. `Partitioned` keys it to the top-level site too, so it is not
    // a general third-party cookie.
    expect(setCookie).toContain("SameSite=None");
    expect(setCookie).toContain("Partitioned");
    expect(setCookie, "a Lax cookie is never sent inside a cross-site iframe")
      .not.toContain("SameSite=Lax");
    // 204: nothing to say that the cookie does not say, and no body a parent
    // page could ever try to read.
    expect(await response.text()).toBe("");
  }, 30_000);

  it("REFUSES a second exchange of the same token — R9", async () => {
    const { requestId, frameToken } = await open();
    expect(await bootstrap(requestId, frameToken)).not.toBeNull();
    // The claim is one atomic UPDATE. A check-then-update would race, and the
    // race is a token usable twice — a session for a request the second caller
    // was never given.
    const again = await fetch(`${SELF}/v1/frame-sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: SELF, "Sec-Fetch-Site": "same-origin" },
      body: JSON.stringify({ requestId, frameToken }),
    });
    expect(again.status).toBe(403);
  }, 30_000);

  it("refuses two SIMULTANEOUS exchanges of one token", async () => {
    const { requestId, frameToken } = await open();
    const [first, second] = await Promise.all([
      fetch(`${SELF}/v1/frame-sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: SELF, "Sec-Fetch-Site": "same-origin" },
        body: JSON.stringify({ requestId, frameToken }),
      }),
      fetch(`${SELF}/v1/frame-sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: SELF, "Sec-Fetch-Site": "same-origin" },
        body: JSON.stringify({ requestId, frameToken }),
      }),
    ]);
    const statuses = [first.status, second.status].sort((a, b) => a - b);
    expect(statuses, "both exchanges succeeded, so the claim is not atomic").toEqual([204, 403]);
  }, 30_000);

  it("refuses a cross-origin exchange", async () => {
    const { requestId, frameToken } = await open();
    const response = await fetch(`${SELF}/v1/frame-sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://evil.test",
        "Sec-Fetch-Site": "cross-site",
      },
      body: JSON.stringify({ requestId, frameToken }),
    });
    expect(response.status).toBe(403);
  }, 30_000);

  it("refuses a token belonging to a DIFFERENT request", async () => {
    const first = await open();
    const second = await open();
    const response = await fetch(`${SELF}/v1/frame-sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: SELF, "Sec-Fetch-Site": "same-origin" },
      body: JSON.stringify({ requestId: first.requestId, frameToken: second.frameToken }),
    });
    expect(response.status).toBe(403);
  }, 30_000);

  it("stores the token HASHED, so a database read yields nothing presentable", async () => {
    const { frameToken } = await open();
    const rows = await pool.query<{ token_hash: string }>("SELECT token_hash FROM frame_tokens");
    expect(rows.rows.map((row) => row.token_hash)).not.toContain(frameToken);
    expect(JSON.stringify(rows.rows)).not.toContain(frameToken);
  }, 30_000);
});

// ───────────────────────────────────────────────────────────────────────────
// The control document
// ───────────────────────────────────────────────────────────────────────────

describeIfDatabase("the control document", () => {
  it("carries the policy that makes the isolation a browser guarantee", async () => {
    const { requestId } = await open();
    const response = await fetch(`${SELF}/control/${requestId}`);
    expect(response.status).toBe(200);

    const csp = response.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self'");
    // The directive that matters most: even an injected script has no origin
    // it could send the value to.
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain(`frame-ancestors ${PARENT}`);
    expect(csp).not.toContain("unsafe-inline");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("cache-control")).toBe("no-store");

    const html = await response.text();
    // One password input, and it is not React-controlled because there is no
    // React here at all.
    expect(html).toContain('type="password"');
    expect(html).not.toContain("<script>");
    expect(html).toContain('<script src="/control.js">');
  }, 30_000);

  it("answers 404 for an unknown request, revealing nothing", async () => {
    const response = await fetch(`${SELF}/control/sr_${"0".repeat(32)}`);
    expect(response.status).toBe(404);
  }, 30_000);
});

// ───────────────────────────────────────────────────────────────────────────
// Submission — and what the logs hold on every failure path
// ───────────────────────────────────────────────────────────────────────────

describeIfDatabase("submitting the secret", () => {
  it("accepts it, returns a handle and NOTHING else", async () => {
    logLines = [];
    const { requestId, frameToken } = await open();
    const cookie = await bootstrap(requestId, frameToken);
    const { status, text } = await submit(requestId, cookie, {
      secret: MARKER,
      confirmation: MARKER,
      conversationId: CONVERSATION,
    });

    expect(status).toBe(200);
    const body = JSON.parse(text) as Record<string, unknown>;
    // A handle and a word. No echo, no hash, no length, no strength score —
    // a length is a fact about the password.
    expect(Object.keys(body).sort()).toEqual(["handle", "lifecycle", "status"]);
    expect(text).not.toContain(MARKER);
    expect(String(body["handle"])).toMatch(/^sh_[0-9a-f]{32}$/);
  }, 30_000);

  it("holds CIPHERTEXT in the vault and nothing in any database column", async () => {
    const { requestId, frameToken } = await open();
    const cookie = await bootstrap(requestId, frameToken);
    await submit(requestId, cookie, {
      secret: MARKER,
      confirmation: MARKER,
      conversationId: CONVERSATION,
    });

    // The vault holds envelopes; none contains the marker.
    expect(JSON.stringify(cache.rawEntries())).not.toContain(MARKER);
    for (const envelope of cache.rawEntries()) {
      expect(envelope.ciphertext.includes(Buffer.from(MARKER, "utf8"))).toBe(false);
    }

    // And EVERY text-ish column of EVERY table, scanned rather than listed.
    const columns = await pool.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public'
          AND data_type IN ('text','character varying','character','json','jsonb')`,
    );
    expect(columns.rowCount, "the column scan found nothing to scan").toBeGreaterThan(5);
    for (const { table_name, column_name } of columns.rows) {
      const hits = await pool.query<{ n: string }>(
        `SELECT count(*) AS n FROM "${table_name}" WHERE "${column_name}"::text LIKE $1`,
        [`%${MARKER}%`],
      );
      expect(Number(hits.rows[0]!.n), `${table_name}.${column_name}`).toBe(0);
    }
  }, 60_000);

  it("REFUSES a mismatched confirmation, and logs a CODE not a value", async () => {
    logLines = [];
    const { requestId, frameToken } = await open();
    const cookie = await bootstrap(requestId, frameToken);
    const { status, text } = await submit(requestId, cookie, {
      secret: MARKER,
      confirmation: `${MARKER}-typo`,
      conversationId: CONVERSATION,
    });

    expect(status).toBe(400);
    expect(text).toContain("confirmation_mismatch");
    // Neither value is echoed, and neither reaches a log line.
    expect(text).not.toContain(MARKER);
    expect(logLines.join("\n")).not.toContain(MARKER);
    expect(logLines.join("\n")).toContain("code=confirmation_mismatch");
  }, 30_000);

  it("REFUSES a duplicate submission — one authoritative receipt only, R12", async () => {
    logLines = [];
    const { requestId, frameToken } = await open();
    const cookie = await bootstrap(requestId, frameToken);
    const first = await submit(requestId, cookie, {
      secret: MARKER, confirmation: MARKER, conversationId: CONVERSATION,
    });
    expect(first.status).toBe(200);

    const second = await submit(requestId, cookie, {
      secret: `${MARKER}-again`, confirmation: `${MARKER}-again`, conversationId: CONVERSATION,
    });
    expect(second.status).toBe(409);
    expect(second.text).toContain("already_submitted");
    expect(second.text).not.toContain(MARKER);

    // ONE receipt in the outbox, and one handle on the request.
    const receipts = await pool.query<{ n: string }>(
      "SELECT count(*) AS n FROM lifecycle_outbox WHERE request_id = $1 AND kind = 'secret_received'",
      [requestId],
    );
    expect(Number(receipts.rows[0]!.n)).toBe(1);
    expect(logLines.join("\n")).not.toContain(MARKER);
  }, 30_000);

  it("REFUSES two SIMULTANEOUS submissions, leaving one receipt", async () => {
    const { requestId, frameToken } = await open();
    const cookie = await bootstrap(requestId, frameToken);
    const [a, b] = await Promise.all([
      submit(requestId, cookie, { secret: MARKER, confirmation: MARKER, conversationId: CONVERSATION }),
      submit(requestId, cookie, { secret: MARKER, confirmation: MARKER, conversationId: CONVERSATION }),
    ]);
    expect([a.status, b.status].sort((x, y) => x - y)).toEqual([200, 409]);

    const receipts = await pool.query<{ n: string }>(
      "SELECT count(*) AS n FROM lifecycle_outbox WHERE request_id = $1 AND kind = 'secret_received'",
      [requestId],
    );
    expect(Number(receipts.rows[0]!.n)).toBe(1);
    // And no orphaned ciphertext: the loser destroyed what it wrote.
    expect(cache.rawEntries().length).toBeLessThanOrEqual(
      (await pool.query("SELECT 1 FROM secret_requests WHERE lifecycle = 'secret_received'")).rowCount ?? 0,
    );
  }, 30_000);

  it("refuses without a session, with the wrong conversation, and cross-origin", async () => {
    logLines = [];
    const { requestId, frameToken } = await open();
    const cookie = await bootstrap(requestId, frameToken);

    const anonymous = await submit(requestId, null, {
      secret: MARKER, confirmation: MARKER, conversationId: CONVERSATION,
    });
    expect(anonymous.status).toBe(401);

    const wrongConversation = await submit(requestId, cookie, {
      secret: MARKER, confirmation: MARKER, conversationId: "01JBXQ8Z9WKTQ6M4H2NPB09999",
    });
    expect(wrongConversation.status).toBe(403);
    expect(wrongConversation.text).toContain("wrong_conversation");

    const crossOrigin = await submit(
      requestId, cookie,
      { secret: MARKER, confirmation: MARKER, conversationId: CONVERSATION },
      { Origin: "https://evil.test", "Sec-Fetch-Site": "cross-site" },
    );
    expect(crossOrigin.status).toBe(403);

    // Three refusals, three markers sent, and not one of them logged.
    expect(logLines.join("\n")).not.toContain(MARKER);
  }, 30_000);

  it("refuses a session for ANOTHER request", async () => {
    const mine = await open();
    const theirs = await open();
    const cookie = await bootstrap(mine.requestId, mine.frameToken);
    const { status, text } = await submit(theirs.requestId, cookie, {
      secret: MARKER, confirmation: MARKER, conversationId: CONVERSATION,
    });
    expect(status).toBe(403);
    expect(text).toContain("not_your_request");
  }, 30_000);

  it("refuses an oversized body WITHOUT naming its length", async () => {
    logLines = [];
    const { requestId, frameToken } = await open();
    const cookie = await bootstrap(requestId, frameToken);
    const long = `${MARKER}${"x".repeat(600)}`;
    const { status, text } = await submit(requestId, cookie, {
      secret: long, confirmation: long, conversationId: CONVERSATION,
    });
    expect(status).toBe(413);
    expect(text).not.toContain(MARKER);
    // A length is a fact about a password, so it is not in the response either.
    expect(text).not.toContain("600");
    expect(logLines.join("\n")).not.toContain(MARKER);
  }, 30_000);
});

// ───────────────────────────────────────────────────────────────────────────
// The transaction boundary the outbox depends on
// ───────────────────────────────────────────────────────────────────────────

describeIfDatabase("the receipt and its publication commit together", () => {
  it("rolls the RECEIPT back when the publication fails — R13", async () => {
    // ═════════════════════════════════════════════════════════════════════
    // WRITTEN BECAUSE A REGRESSION WAS NOT CAUGHT.
    //
    // I split the receipt and the outbox enqueue into two transactions — a
    // COMMIT between them — and every test still passed, because on the happy
    // path both succeed either way. The whole point of the outbox is what
    // happens when they DON'T, and nothing was forcing that.
    //
    // If they are separate, a receipt survives a failed publication: the
    // secure plane believes the step settled, the conversation log never
    // hears, and the composer stays shut for the whole TTL with a `handle`
    // sitting in a row that nothing will ever announce. If they share a
    // transaction, neither happened and the student simply tries again.
    // ═════════════════════════════════════════════════════════════════════
    const { requestId, frameToken } = await open();
    await bootstrap(requestId, frameToken);

    const outbox = new LifecycleOutbox(pool);
    const now = NOW;
    await expect(
      store.withTransaction(async (client) => {
        const ok = await store.recordReceipt(client, requestId, `sh_${"9".repeat(32)}`, now);
        expect(ok, "the receipt did not record, so the rollback proves nothing").toBe(true);
        await outbox.enqueue(client, {
          requestId,
          conversationId: CONVERSATION,
          // `secret_received` with NO handle violates `a_handle_means_receipt`.
          // A real failure from the real constraint, not a thrown stub.
          transition: { kind: "secret_received", handle: "" },
          now,
        });
      }),
    ).rejects.toThrow();

    // The request is UNTOUCHED. Under a split transaction it would read
    // `secret_received` with a handle nothing had published.
    const row = await store.find(requestId);
    expect(row?.lifecycle, "the receipt survived a failed publication").toBe("secret_requested");
    expect(row?.handle).toBeNull();

    const queued = await pool.query<{ n: string }>(
      "SELECT count(*) AS n FROM lifecycle_outbox WHERE request_id = $1",
      [requestId],
    );
    expect(Number(queued.rows[0]!.n)).toBe(0);
  }, 30_000);
});

// ───────────────────────────────────────────────────────────────────────────
// Logging, on the paths that actually write lines
// ───────────────────────────────────────────────────────────────────────────

describeIfDatabase("what reaches a log line", () => {
  it("writes NOTHING of a malformed JSON body — the err.body case", async () => {
    // ── The measured finding ────────────────────────────────────────────
    //
    // `body-parser` attaches the RAW REQUEST BODY to a JSON syntax error as
    // `err.body`. Any logger that serialises a caught error emits it in full,
    // and on THIS endpoint that body is a password. `SecureLogger.failure`
    // reduces the thrown value to a class name at its first statement and
    // deletes the field before anything else touches it.
    logLines = [];
    const captured: string[] = [];
    const restore = captureProcessOutput(captured);
    try {
      const { requestId, frameToken } = await open();
      const cookie = await bootstrap(requestId, frameToken);
      const response = await fetch(`${SELF}/v1/secret-requests/${requestId}/secret`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: SELF,
          "Sec-Fetch-Site": "same-origin",
          ...(cookie === null ? {} : { Cookie: cookie }),
        },
        body: `{"secret": "${MARKER}", "conversationId": "${CONVERSATION}"`,
      });
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(await response.text()).not.toContain(MARKER);
    } finally {
      restore();
    }

    expect(logLines.join("\n"), "the marker reached the service's own log").not.toContain(MARKER);
    expect(captured.join("\n"), "the marker reached stdout or stderr").not.toContain(MARKER);
  }, 30_000);

  it("writes only a CLASS NAME when the handler throws", () => {
    // A logger that took the error would take its message, and a validation
    // library's message quotes the value that failed.
    const lines: string[] = [];
    const logger = new SecureLogger((line) => lines.push(line));
    const carrier = new TypeError(`cannot read ${MARKER}`);
    (carrier as unknown as { body: string }).body = `{"secret":"${MARKER}"}`;

    logger.failure("unhandled_failure", carrier, { status: 500 });

    expect(lines.join("\n")).toContain("errorClass=TypeError");
    expect(lines.join("\n")).not.toContain(MARKER);
    // And the raw body is gone from the object itself, so a handler registered
    // after this one cannot find it either.
    expect((carrier as unknown as { body?: string }).body).toBeUndefined();
  });

  it("captures SOMETHING, so the scans above are not vacuous", () => {
    const lines: string[] = [];
    new SecureLogger((line) => lines.push(line)).log({ event: "secret_refused", code: "expired" });
    expect(lines.join("")).toContain("event=secret_refused");
    expect(lines.join("")).toContain("code=expired");
  });
});

/** Redirects stdout and stderr into an array until the returned function runs. */
function captureProcessOutput(into: string[]): () => void {
  const out = process.stdout.write.bind(process.stdout);
  const err = process.stderr.write.bind(process.stderr);
  const capture = (chunk: unknown): boolean => {
    into.push(String(chunk));
    return true;
  };
  process.stdout.write = capture;
  process.stderr.write = capture;
  return () => {
    process.stdout.write = out;
    process.stderr.write = err;
  };
}
