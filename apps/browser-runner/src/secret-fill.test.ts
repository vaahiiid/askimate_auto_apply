/**
 * What is left on the runner's side of the boundary, and what cannot cross it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ADR-0042 moved credential consumption into the Secure Plane. The tests that
 * proved a password reaches a real field, and reaches no artefact, moved with
 * it — they are in `apps/secure-filler/src/fill.test.ts`, where the code that
 * does the typing now lives.
 *
 * What is tested here is the half that stayed: the runner asks, and whatever
 * comes back, no value enters this process. That is asserted against a
 * DELIBERATELY HOSTILE answer, because "the agent would never send one" is a
 * claim about a different process.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { createServer, type Server } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

import { openSensitiveContext } from "./sensitive.js";
import type { SecretFillClaim } from "./secret-fill.js";
import { SecretIntoTracedContextError, fillSecret } from "./secret-fill.js";

const PORT = 4703;
const BASE = `http://127.0.0.1:${String(PORT)}`;
const MARKER = "SECRET-PASSWORD-DO-NOT-LEAK-123!";
const AGENT = "http://127.0.0.1:4999";
const ENDPOINT = "ws://127.0.0.1:4998/devtools/browser/abc";

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Register</title></head>
<body><label for="pw">Password</label><input id="pw" name="pw" type="password"></body></html>`;

const CLAIM: SecretFillClaim = {
  handle: "sh_00000000000000000000000000000001",
  studentRef: "student-1",
  caseRef: "case-1",
  purpose: "portal_account_creation",
  targetHost: "127.0.0.1",
};
const LOCATOR = { strategy: "css" as const, value: "#pw" };

let server: Server;
let browser: Browser;

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" }).end(PAGE);
  });
  await new Promise<void>((resolve) => server.listen(PORT, "127.0.0.1", resolve));
  browser = await chromium.launch({ headless: true });
}, 120_000);

afterAll(async () => {
  await browser.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function sensitivePage(): Promise<{ context: BrowserContext; page: Page }> {
  const context = await openSensitiveContext(browser, { userAgent: "test" });
  const page = await context.newPage();
  await page.goto(`${BASE}/register`);
  return { context, page };
}

/** A fetch that records what was sent and answers with whatever is given. */
function stubFetch(
  answer: { status: number; body: unknown },
  sent: { url?: string; body?: unknown }[],
): typeof globalThis.fetch {
  return ((url: string, init?: { body?: string }) => {
    sent.push({ url, body: init?.body === undefined ? undefined : JSON.parse(init.body) });
    return Promise.resolve(
      new Response(JSON.stringify(answer.body), {
        status: answer.status,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as unknown as typeof globalThis.fetch;
}

describe("the runner asks for a fill and holds nothing", () => {
  it("sends the binding, the selector and its own browser — and no more", async () => {
    const sent: { url?: string; body?: unknown }[] = [];
    const { context, page } = await sensitivePage();
    try {
      const outcome = await fillSecret({
        page,
        claim: CLAIM,
        locator: LOCATOR,
        agentBaseUrl: AGENT,
        browserEndpoint: ENDPOINT,
        fetch: stubFetch(
          { status: 200, body: { status: "filled", lifecycle: "secret_consumed" } },
          sent,
        ),
      });
      expect(outcome).toEqual({ ok: true, handleSpent: true });

      const request = sent[0];
      if (request === undefined) expect.unreachable("a request should have been sent");
      expect(request.url).toBe(`${AGENT}/internal/v1/secret-fills`);
      // The exact field set the contract declares. A field added here without
      // being added to the contract fails, and so does the reverse.
      expect(Object.keys(request.body as Record<string, unknown>).sort()).toEqual([
        "browserEndpoint",
        "caseRef",
        "consumer",
        "handle",
        "locator",
        "noDiagnosticCapture",
        "pageUrl",
        "purpose",
        "studentRef",
        "targetHost",
      ]);
      // Fail closed, always asserted rather than defaulted.
      expect((request.body as { noDiagnosticCapture: unknown }).noDiagnosticCapture).toBe(true);
    } finally {
      await context.close();
    }
  }, 60_000);

  it("drops a value the agent should never have sent", async () => {
    // A DELIBERATELY HOSTILE answer: a compromised or mis-implemented agent
    // returning the plaintext alongside a valid result. `parseSecretFillResult`
    // rebuilds the union from the fields the contract declares, so a field the
    // contract does not name has nowhere to land — it is not filtered, it is
    // never copied.
    const sent: { url?: string; body?: unknown }[] = [];
    const { context, page } = await sensitivePage();
    try {
      const outcome = await fillSecret({
        page,
        claim: CLAIM,
        locator: LOCATOR,
        agentBaseUrl: AGENT,
        browserEndpoint: ENDPOINT,
        fetch: stubFetch(
          {
            status: 200,
            body: {
              status: "filled",
              lifecycle: "secret_consumed",
              secret: MARKER,
              password: MARKER,
              detail: `the value was ${MARKER}`,
            },
          },
          sent,
        ),
      });
      expect(outcome).toEqual({ ok: true, handleSpent: true });
      expect(JSON.stringify(outcome)).not.toContain(MARKER);
      expect(Object.keys(outcome).sort()).toEqual(["handleSpent", "ok"]);
    } finally {
      await context.close();
    }
  }, 60_000);

  it("keeps the handle alive when the field was not there", async () => {
    // The refusal that must NOT cost a student a password: the agent
    // establishes the field's existence before obtaining any plaintext.
    const sent: { url?: string; body?: unknown }[] = [];
    const { context, page } = await sensitivePage();
    try {
      const outcome = await fillSecret({
        page,
        claim: CLAIM,
        locator: LOCATOR,
        agentBaseUrl: AGENT,
        browserEndpoint: ENDPOINT,
        fetch: stubFetch({ status: 200, body: { status: "refused", reason: "no_such_field" } }, sent),
      });
      expect(outcome).toEqual({ ok: false, reason: "no_such_field", handleSpent: false });
    } finally {
      await context.close();
    }
  }, 60_000);

  it("records the handle as dead when the agent settled the use", async () => {
    const sent: { url?: string; body?: unknown }[] = [];
    const { context, page } = await sensitivePage();
    try {
      const outcome = await fillSecret({
        page,
        claim: CLAIM,
        locator: LOCATOR,
        agentBaseUrl: AGENT,
        browserEndpoint: ENDPOINT,
        fetch: stubFetch(
          {
            status: 200,
            body: { status: "refused", reason: "not_accepted", lifecycle: "secret_consumed" },
          },
          sent,
        ),
      });
      expect(outcome).toEqual({ ok: false, reason: "not_accepted", handleSpent: true });
    } finally {
      await context.close();
    }
  }, 60_000);

  it("reports an unreachable agent without throwing the request into a log", async () => {
    const { context, page } = await sensitivePage();
    try {
      const outcome = await fillSecret({
        page,
        claim: CLAIM,
        locator: LOCATOR,
        agentBaseUrl: AGENT,
        browserEndpoint: ENDPOINT,
        fetch: () => Promise.reject(new Error("ECONNREFUSED")),
      });
      // A refusal, not a throw. A thrown error here would carry the request
      // object — including the handle — into whatever logs it.
      expect(outcome).toEqual({ ok: false, reason: "browser_unreachable", handleSpent: false });
    } finally {
      await context.close();
    }
  }, 60_000);
});

describe("a context that could be recording", () => {
  it("is refused locally, before a request is ever made", async () => {
    // The agent checks this too, against the live page, and its check is the
    // one that protects the secret. This one exists so a mistake on this side
    // fails as a loud local error rather than as a remote refusal.
    const sent: { url?: string; body?: unknown }[] = [];
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${BASE}/register`);
    try {
      await expect(
        fillSecret({
          page,
          claim: CLAIM,
          locator: LOCATOR,
          agentBaseUrl: AGENT,
          browserEndpoint: ENDPOINT,
          fetch: stubFetch({ status: 200, body: { status: "filled" } }, sent),
        }),
      ).rejects.toThrow(SecretIntoTracedContextError);
      expect(sent).toEqual([]);
    } finally {
      await context.close();
    }
  }, 60_000);

  it("confirms the sensitive context DOES pass the check", async () => {
    // Otherwise the test above would pass by refusing everything.
    const sent: { url?: string; body?: unknown }[] = [];
    const { context, page } = await sensitivePage();
    try {
      const outcome = await fillSecret({
        page,
        claim: CLAIM,
        locator: LOCATOR,
        agentBaseUrl: AGENT,
        browserEndpoint: ENDPOINT,
        fetch: stubFetch(
          { status: 200, body: { status: "filled", lifecycle: "secret_consumed" } },
          sent,
        ),
      });
      expect(outcome.ok).toBe(true);
      expect(sent).toHaveLength(1);
    } finally {
      await context.close();
    }
  }, 60_000);
});
