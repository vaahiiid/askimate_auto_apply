/**
 * The conversation plane's deployment: the session, and the blind error handler.
 *
 * Written because `docs/harness-coverage-mapping.md` said this code was not
 * tested. Two of the properties below are the sort that only ever fail in
 * production, because nothing routine exercises them: an error handler that is
 * never reached on a good day, and a cookie whose attributes only matter to an
 * attacker.
 */

import type { Server } from "node:http";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import pg from "pg";

import { migrate } from "@askimate/aas-migrate";
import { announceSkip, databaseReachable, TEST_DATABASE_URL } from "@askimate/aas-migrate/testing";

import { MIGRATIONS_DIR } from "./index.js";
import { ConversationEventStore } from "./event-store.js";
import { createConversationApp } from "./app.js";
import { SESSION_COOKIE, issueSession, readSession } from "./session.js";

const PORT = 4853;
const BASE = `http://127.0.0.1:${String(PORT)}`;
const SECRET = "a-session-signing-secret-for-tests";
const MARKER = "PASSWORD-TYPED-INTO-A-BROKEN-JSON-BODY";
const NOW = new Date("2026-08-28T10:00:00Z");

const HAVE_DATABASE = await databaseReachable();
if (!HAVE_DATABASE) announceSkip("the conversation plane's session and error handler");
const describeIfDatabase = HAVE_DATABASE ? describe : describe.skip;

let pool: pg.Pool;
let server: Server;
let studentId: string;
let conversationId: string;

beforeAll(async () => {
  if (!HAVE_DATABASE) return;
  const admin = new pg.Pool({ connectionString: TEST_DATABASE_URL });
  try {
    await admin.query("DROP DATABASE IF EXISTS aas_conversation_app WITH (FORCE)");
    await admin.query("CREATE DATABASE aas_conversation_app");
  } finally {
    await admin.end();
  }
  const url = new URL(TEST_DATABASE_URL);
  url.pathname = "/aas_conversation_app";
  pool = new pg.Pool({ connectionString: url.toString(), max: 8 });
  await migrate(pool, MIGRATIONS_DIR);

  const student = await pool.query<{ id: string }>(
    "INSERT INTO students (subject, email_verified) VALUES ('oidc-app', true) RETURNING id",
  );
  studentId = student.rows[0]!.id;
  conversationId = "01JBXQ8Z9WKTQ6M4H2NPA00001";
  await pool.query("INSERT INTO conversations (id, student_id) VALUES ($1, $2)", [
    conversationId,
    studentId,
  ]);

  const app = createConversationApp({
    store: new ConversationEventStore(pool),
    sessionSecret: SECRET,
    authorise: async (subject, conversation) => {
      const owned = await pool.query(
        "SELECT 1 FROM conversations WHERE id = $1 AND student_id = $2",
        [conversation, subject],
      );
      return owned.rowCount === 1;
    },
    now: () => NOW,
    issueSessionFor: (req) => {
      const subject = (req.body as { subject?: unknown } | undefined)?.subject;
      return typeof subject === "string" ? subject : null;
    },
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
// The session cookie
// ───────────────────────────────────────────────────────────────────────────

describe("the __Host- session cookie", () => {
  it("carries every attribute the prefix requires", () => {
    // The browser REJECTS a `__Host-` cookie that is missing any of these, so
    // a regression here does not produce a weaker cookie — it produces no
    // cookie, and a silently logged-out student. Asserted rather than assumed
    // because that failure looks like an authentication bug, not a cookie bug.
    const header = issueSession("subject-1", SECRET);
    expect(header).toContain(`${SESSION_COOKIE}=`);
    expect(header).toContain("Path=/");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Secure");
    expect(header).toContain("SameSite=Lax");
    // No Domain, which is what stops a sibling subdomain setting it.
    expect(header).not.toMatch(/;\s*Domain=/i);
  });

  it("refuses a cookie whose signature does not match", () => {
    const request = { headers: { cookie: `${SESSION_COOKIE}=someone-else.not-a-signature` } };
    expect(readSession(request as never, SECRET)).toBeNull();
  });

  it("refuses a cookie signed with a different secret", () => {
    const forged = issueSession("subject-1", "a-different-secret");
    const request = { headers: { cookie: forged } };
    expect(readSession(request as never, SECRET)).toBeNull();
  });

  it("reads back the subject it signed, and only that", () => {
    const issued = issueSession("subject-1", SECRET);
    const value = issued.split(";")[0] ?? "";
    expect(readSession({ headers: { cookie: value } } as never, SECRET)).toBe("subject-1");
  });

  it("survives other cookies sitting beside it", () => {
    const value = (issueSession("subject-1", SECRET).split(";")[0] ?? "").trim();
    const cookie = `theme=dark; ${value}; consent=1`;
    expect(readSession({ headers: { cookie } } as never, SECRET)).toBe("subject-1");
  });

  it("refuses a malformed percent-escape rather than throwing", () => {
    // `decodeURIComponent("%")` throws. An exception here would become a 500 on
    // every request carrying a mangled cookie, which is a denial of service
    // anyone could trigger.
    const request = { headers: { cookie: `${SESSION_COOKIE}=%.signature` } };
    expect(() => readSession(request as never, SECRET)).not.toThrow();
    expect(readSession(request as never, SECRET)).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The blind error handler
// ───────────────────────────────────────────────────────────────────────────

describeIfDatabase("a malformed body reaches no log and no response", () => {
  it("scrubs the raw body off a JSON parse error", async () => {
    // ── The measured finding this exists for ────────────────────────────
    //
    // `body-parser` attaches the RAW REQUEST BODY to a JSON syntax error as
    // `err.body`. Any logger, reporter or APM agent that serialises a caught
    // error therefore emits it in full — and on this route that body may be a
    // password typed into the wrong box. The handler deletes the field before
    // anything else touches the error.
    const written: string[] = [];
    const capture = (chunk: unknown): boolean => {
      written.push(String(chunk));
      return true;
    };
    const outSpy = vi.spyOn(process.stdout, "write").mockImplementation(capture);
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(capture);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
      written.push(args.map((value) => String(value)).join(" "));
    });

    let body: string;
    let status: number;
    try {
      const cookie = (issueSession(studentId, SECRET).split(";")[0] ?? "").trim();
      const response = await fetch(`${BASE}/v1/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "an-idempotency-key-long-enough",
          Cookie: cookie,
        },
        // Deliberately unparseable, with the marker inside it.
        body: `{"content": "${MARKER}"`,
      });
      status = response.status;
      body = await response.text();
    } finally {
      outSpy.mockRestore();
      errSpy.mockRestore();
      consoleSpy.mockRestore();
    }

    expect(status).toBeGreaterThanOrEqual(400);
    expect(body, "the response echoed the body it could not parse").not.toContain(MARKER);
    expect(
      written.join("\n"),
      "the marker reached stdout, stderr or console",
    ).not.toContain(MARKER);
  }, 30_000);

  it("captures SOMETHING when the process writes, so the scan is not vacuous", () => {
    // Without this the assertion above would pass just as happily if the spies
    // captured nothing at all — which is how a leak scan quietly stops looking.
    const written: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args) => {
      written.push(args.map((value) => String(value)).join(" "));
    });
    console.error("a canary line");
    spy.mockRestore();
    expect(written.join("")).toContain("a canary line");
  });
});
