/**
 * A password typed into a real portal by a real browser, then hunted through
 * every byte the run wrote to disk.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-26: *"Add adversarial tests proving the password never
 * appears in: … traces, trace archives, screenshots, videos … storage state."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The unit tests in `packages/secrets` cover everything reachable without a
 * browser. These are the ones that need one, and they are asserted the same
 * way the trace-leak tests are: **run it for real, then walk every file**,
 * including inside archives.
 *
 * That last part is not fussiness. When the trace fix was deliberately
 * reverted to check the tests caught it, every marker assertion still passed
 * and only "no trace file" failed — because a Playwright trace is a zip and
 * compression hides plaintext from a substring scan completely. A scan that a
 * regression can walk past is not a proof.
 */

import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

import { auditLabel, studentId } from "@askimate/aas-domain";
import { InMemorySecretStore } from "@askimate/aas-secrets";
import type { SecretClaim } from "@askimate/aas-secrets";

import { openSensitiveContext } from "./sensitive.js";
import { SecretIntoTracedContextError, fillSecret, untracedPageConsumer } from "./secret-fill.js";

const PORT = 4703;
const BASE = `http://127.0.0.1:${String(PORT)}`;
const NOW = new Date("2026-08-26T10:00:00Z");
const STUDENT = studentId("student-1");
const MARKER = "SECRET-PASSWORD-DO-NOT-LEAK-123!";
const TARGET = { host: "127.0.0.1", caseRef: "case-1" } as const;

/**
 * A registration page shaped like the real one: a password field, a
 * confirmation, and — deliberately — a `maxlength` on a decoy field, so the
 * truncation path is exercised against something.
 */
const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Register</title></head>
<body>
  <label for="email">Email</label><input id="email" name="email" type="email">
  <label for="pw">Password</label><input id="pw" name="pw" type="password">
  <label for="pw2">Confirm password</label><input id="pw2" name="pw2" type="password">
  <label for="capped">Capped</label><input id="capped" name="capped" type="password" maxlength="8">
  <button id="create" type="button">Create account</button>
</body></html>`;

const locator = (id: string) => ({ strategy: "css" as const, value: `#${id}` });

let server: Server;
let browser: Browser;
let runDir: string;

/** Every file the run produced, with its bytes — INCLUDING inside archives. */
async function artefacts(dir: string): Promise<{ path: string; bytes: Buffer }[]> {
  const out: { path: string; bytes: Buffer }[] = [];
  const walk = async (d: string, label: string): Promise<void> => {
    for (const entry of await readdir(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      const shown = label === "" ? entry.name : `${label}/${entry.name}`;
      if (entry.isDirectory()) {
        await walk(full, shown);
        continue;
      }
      out.push({ path: shown, bytes: await readFile(full) });
      if (entry.name.endsWith(".zip")) {
        const expanded = await mkdtemp(join(tmpdir(), "aas-unzip-"));
        try {
          execFileSync("unzip", ["-qo", full, "-d", expanded]);
          await walk(expanded, `${shown}!`);
        } catch {
          // An archive we cannot open is a finding in itself — it stays in the
          // list as a file that exists rather than being silently skipped.
        }
      }
    }
  };
  await walk(dir, "");
  return out;
}

/** Opens a request, answers it with the marker, and returns a spendable claim. */
function armed(store: InMemorySecretStore): SecretClaim {
  const opened = store.request(
    {
      studentRef: STUDENT,
      purpose: "portal_account_creation",
      target: TARGET,
      explanation: "I need a password to set up your application account.",
      singleUse: true,
      ttlSeconds: 300,
    },
    NOW,
  );
  if (!opened.ok) expect.unreachable("request should open");
  const submitted = store.submit(opened.prompt.requestId, MARKER, NOW);
  if (!submitted.ok) expect.unreachable("submit should be accepted");
  return {
    handle: submitted.handle,
    studentRef: STUDENT,
    purpose: "portal_account_creation",
    target: TARGET,
  };
}

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" }).end(PAGE);
  });
  await new Promise<void>((resolve) => server.listen(PORT, "127.0.0.1", resolve));
  browser = await chromium.launch({ headless: true });
  runDir = await mkdtemp(join(tmpdir(), "aas-secret-"));
}, 120_000);

afterAll(async () => {
  await browser.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(runDir, { recursive: true, force: true });
});

async function sensitivePage(): Promise<{ context: BrowserContext; page: Page }> {
  const context = await openSensitiveContext(browser, { userAgent: "test" });
  const page = await context.newPage();
  await page.goto(`${BASE}/register`);
  return { context, page };
}

// ───────────────────────────────────────────────────────────────────────────
// The artefacts
// ───────────────────────────────────────────────────────────────────────────

describe("a password typed into a real page", () => {
  it("reaches the field, and appears in NO file the run wrote", async () => {
    const dir = join(runDir, "fill");
    const store = new InMemorySecretStore();
    const claim = armed(store);
    const { context, page } = await sensitivePage();

    try {
      const outcome = await fillSecret({
        page,
        store,
        claim,
        locator: locator("pw"),
        now: NOW,
      });
      expect(outcome.ok).toBe(true);

      // It really is in the field — otherwise this test would pass by doing
      // nothing, which is the failure mode every leak test has.
      expect(await page.locator("#pw").inputValue()).toBe(MARKER);

      // Everything a run writes: a screenshot, and the storage state that a
      // session-resume feature would persist.
      await page.screenshot({
        path: join(dir, "after-fill.png"),
        fullPage: true,
        mask: await page.locator("input, textarea, select").all(),
        maskColor: "#334155",
      });
      await context.storageState({ path: join(dir, "storage-state.json") });
    } finally {
      await context.close();
    }

    const files = await artefacts(dir);
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((file) => file.path.endsWith(".png"))).toBe(true);

    const leaked = files.filter((file) => file.bytes.includes(MARKER)).map((file) => file.path);
    expect(leaked).toEqual([]);

    // And in none of the encodings that would hide it from a substring scan.
    for (const encoded of [
      Buffer.from(MARKER, "utf16le"),
      Buffer.from(Buffer.from(MARKER).toString("base64")),
      Buffer.from(encodeURIComponent(MARKER)),
    ]) {
      expect(files.filter((file) => file.bytes.includes(encoded)).map((f) => f.path)).toEqual([]);
    }

    // No trace, no video — the fix from ADR-0025, re-asserted on this path
    // because this is the path where a leak would be a live credential.
    expect(files.filter((file) => file.path.includes("trace"))).toEqual([]);
    expect(files.filter((file) => /\.(webm|mp4)$/.test(file.path))).toEqual([]);
  }, 120_000);

  it("spends the handle, so a retry needs a fresh prompt to the student", async () => {
    const store = new InMemorySecretStore();
    const claim = armed(store);
    const { context, page } = await sensitivePage();

    try {
      expect((await fillSecret({ page, store, claim, locator: locator("pw"), now: NOW })).ok).toBe(
        true,
      );
      const again = await fillSecret({ page, store, claim, locator: locator("pw2"), now: NOW });
      expect(again.ok).toBe(false);
      if (again.ok) return;
      expect(again.reason.kind).toBe("unknown_handle");
      expect(store.liveSecretCount).toBe(0);
    } finally {
      await context.close();
    }
  }, 120_000);

  it("reports a truncating field without reporting what was truncated", async () => {
    // A portal that silently caps a password at eight characters produces an
    // account whose password is not the one the student chose — and they find
    // out at the sign-in screen, days later.
    const store = new InMemorySecretStore();
    const claim = armed(store);
    const { context, page } = await sensitivePage();

    try {
      const thrown = await fillSecret({
        page,
        store,
        claim,
        locator: locator("capped"),
        now: NOW,
      }).catch((error: unknown) => error);

      expect(thrown).toBeInstanceOf(Error);
      const error = thrown as Error;
      expect(error.name).toBe("SecretNotAcceptedError");
      // Shapes, not characters. The message says what a specialist needs.
      expect(error.message).toContain("32 characters were typed and 8");
      expect(error.message).not.toContain(MARKER);
      expect(JSON.stringify(error)).not.toContain(MARKER);
      expect(error.stack ?? "").not.toContain(MARKER);
    } finally {
      await context.close();
    }
  }, 120_000);

  it("does not spend the handle when the field does not exist", async () => {
    // A locator that matches nothing is a blueprint problem, not a password
    // problem, and burning the student's secret over one would send them round
    // the whole loop again.
    const store = new InMemorySecretStore();
    const claim = armed(store);
    const { context, page } = await sensitivePage();

    try {
      await expect(
        fillSecret({ page, store, claim, locator: locator("nonexistent"), now: NOW }),
      ).rejects.toThrow("has NOT been spent");
      expect(store.liveSecretCount).toBe(1);
    } finally {
      await context.close();
    }
  }, 120_000);
});

// ───────────────────────────────────────────────────────────────────────────
// The traced context never gets one
// ───────────────────────────────────────────────────────────────────────────

describe("a context that could be recording", () => {
  it("is refused, loudly, before anything is typed", async () => {
    // An ORDINARY context — the kind `chromium.newContext()` returns, with
    // tracing available. This is what a future developer would reach for when
    // adding a login step to a script that does not already use the sensitive
    // path.
    const store = new InMemorySecretStore();
    const claim = armed(store);
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${BASE}/register`);

    try {
      await expect(
        fillSecret({ page, store, claim, locator: locator("pw"), now: NOW }),
      ).rejects.toThrow(SecretIntoTracedContextError);
      // Nothing was typed, and nothing was spent.
      expect(await page.locator("#pw").inputValue()).toBe("");
      expect(store.liveSecretCount).toBe(1);
    } finally {
      await context.close();
    }
  }, 120_000);

  it("fails the store's own check too, not only the call site's", async () => {
    // Belt and braces on purpose: the call-site check gives a loud, specific
    // error, and the store's check is the one that actually protects the
    // secret. If someone deletes the first, the second still refuses.
    const store = new InMemorySecretStore();
    const claim = armed(store);
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      const outcome = await store.use(
        claim,
        untracedPageConsumer(page, auditLabel("traced_page")),
        () => "should not run",
        NOW,
      );
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.reason.kind).toBe("consumer_may_capture");
      expect(store.liveSecretCount).toBe(1);
    } finally {
      await context.close();
    }
  }, 120_000);

  it("refuses a context recording VIDEO, even though tracing is off", async () => {
    // A video of a login shows the keystrokes and, unlike a trace, cannot be
    // scanned for a leak afterwards. `tracingIsForbidden` alone would say this
    // context is fine, so the consumer checks `page.video()` as well.
    const videoDir = join(runDir, "video-probe");
    const store = new InMemorySecretStore();
    const claim = armed(store);
    const context = await browser.newContext({ recordVideo: { dir: videoDir } });
    const page = await context.newPage();

    try {
      expect(page.video()).not.toBeNull();
      const consumer = untracedPageConsumer(page, auditLabel("recording_page"));
      expect(consumer.confirmNoDiagnosticCapture()).toBe(false);

      const outcome = await store.use(claim, consumer, () => "should not run", NOW);
      expect(outcome.ok).toBe(false);
      expect(store.liveSecretCount).toBe(1);
    } finally {
      await context.close();
      await rm(videoDir, { recursive: true, force: true });
    }
  }, 120_000);

  it("confirms the sensitive context DOES pass the check", async () => {
    // The other half. A test suite where the safe path also failed would be
    // proving nothing at all.
    const { context, page } = await sensitivePage();
    try {
      expect(untracedPageConsumer(page, auditLabel("sensitive")).confirmNoDiagnosticCapture()).toBe(
        true,
      );
    } finally {
      await context.close();
    }
  }, 120_000);
});
