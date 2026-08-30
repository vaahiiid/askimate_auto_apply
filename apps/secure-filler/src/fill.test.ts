/**
 * A password typed into a real page by a process that does not own the browser.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-30: *"The runner component that actually consumes and fills
 * the secret must execute within the Secure Plane's trust boundary … the
 * plaintext must be obtained and consumed locally, without appearing in an
 * inter-service response payload."*
 *
 * This suite runs the real arrangement: a real Chromium owned by something
 * else, reached over the real Chrome DevTools Protocol, with the ciphertext
 * taken from a cache that TWO separate vault instances share — which is what
 * one Valkey and two ECS tasks look like from the code's point of view.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── The two vaults are the point, not a convenience ───────────────────────
 *
 * `submissionVault` stands for the secure service and only ever calls `put`.
 * `agentVault` stands for this process and only ever calls `use`. They share an
 * `EnvelopeCache` and a `DataKeyProvider` and NOTHING else — no function call,
 * no object reference, no HTTP response. If the agent could not decrypt what
 * the secure service stored, every test here would fail, and the design would
 * be the one Vahid rejected.
 */

import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

import type { SecretFillRequest } from "@askimate/aas-contracts";
import {
  EnvelopeVault,
  InMemoryEnvelopeCache,
  LocalDataKeyProvider,
} from "@askimate/aas-secrets";
import { SecureLogger } from "@askimate/aas-secure-logging";

import type { UseAuthorisation } from "./authorise.js";
import { performSecretFill } from "./fill.js";

const PAGE_PORT = 4881;
const CDP_PORT = 4882;
const BASE = `http://127.0.0.1:${String(PAGE_PORT)}`;
const MARKER = "SECRET-PASSWORD-DO-NOT-LEAK-123!";
const NOW = new Date("2026-08-30T10:00:00Z");

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Register</title></head>
<body>
  <label for="email">Email</label><input id="email" name="email" type="email">
  <label for="pw">Password</label><input id="pw" name="pw" type="password">
  <label for="capped">Capped</label><input id="capped" name="capped" type="password" maxlength="8">
</body></html>`;

let pageServer: Server;
/** The RUNNER's browser. This suite stands in for the runner when it uses it. */
let runnerBrowser: Browser;
let cdpEndpoint: string;
let runDir: string;

/** One cache, two vaults: the production arrangement, in one process. */
let cache: InMemoryEnvelopeCache;
let submissionVault: EnvelopeVault;
let agentVault: EnvelopeVault;
let logLines: string[];
let authorisations: SecretFillRequest[];
let authoriseAnswer: UseAuthorisation;

beforeAll(async () => {
  pageServer = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" }).end(PAGE);
  });
  await new Promise<void>((resolve) => pageServer.listen(PAGE_PORT, "127.0.0.1", resolve));
  runnerBrowser = await chromium.launch({
    headless: true,
    // The runner exposes its browser to the fill agent and to nothing else. In
    // production this is a private-subnet address behind a security group; here
    // it is loopback, which is the same property with a shorter blast radius.
    args: [`--remote-debugging-port=${String(CDP_PORT)}`, "--remote-debugging-address=127.0.0.1"],
  });
  const version = (await (
    await fetch(`http://127.0.0.1:${String(CDP_PORT)}/json/version`)
  ).json()) as { webSocketDebuggerUrl: string };
  cdpEndpoint = version.webSocketDebuggerUrl;
  runDir = await mkdtemp(join(tmpdir(), "aas-agent-"));
}, 120_000);

afterAll(async () => {
  await runnerBrowser.close();
  await new Promise<void>((resolve) => pageServer.close(() => resolve()));
  await rm(runDir, { recursive: true, force: true });
});

beforeEach(() => {
  cache = new InMemoryEnvelopeCache();
  const keys = new LocalDataKeyProvider();
  submissionVault = new EnvelopeVault(keys, cache);
  agentVault = new EnvelopeVault(keys, cache);
  logLines = [];
  authorisations = [];
  authoriseAnswer = { ok: true };
});

/** What the secure service does when the student submits. Nothing else. */
async function submitted(handle: string, secret = MARKER): Promise<void> {
  await submissionVault.put(handle, secret, new Date(NOW.getTime() + 120_000), NOW);
}

function request(over: Partial<SecretFillRequest> = {}): SecretFillRequest {
  return {
    handle: "sh_00000000000000000000000000000001",
    studentRef: "student-1",
    caseRef: "case-1",
    purpose: "portal_account_creation",
    targetHost: `127.0.0.1:${String(PAGE_PORT)}`,
    consumer: "portal_account_creation_fill",
    noDiagnosticCapture: true,
    browserEndpoint: cdpEndpoint,
    locator: { strategy: "css", value: "#pw" },
    ...over,
  };
}

function deps(): Parameters<typeof performSecretFill>[1] {
  return {
    vault: agentVault,
    authorise: (input: SecretFillRequest): Promise<UseAuthorisation> => {
      authorisations.push(input);
      return Promise.resolve(authoriseAnswer);
    },
    connect: (endpoint: string) => chromium.connectOverCDP(endpoint),
    now: () => NOW,
    logger: new SecureLogger((line) => logLines.push(line)),
  };
}

/**
 * Opens the page the way the runner would, and makes sure it is the ONLY page
 * in the browser so `selectPage` has an unambiguous answer.
 */
async function runnerPage(options: { readonly traced?: boolean } = {}): Promise<{
  context: BrowserContext;
  page: Page;
}> {
  const context = await runnerBrowser.newContext();
  if (options.traced === true) {
    await context.tracing.start({ screenshots: true, snapshots: true });
  }
  const page = await context.newPage();
  await page.goto(`${BASE}/register`);
  return { context, page };
}

/** Every file a run produced, with its bytes — INCLUDING inside archives. */
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
          // An archive we cannot open stays in the list as a file that exists,
          // rather than being silently skipped.
        }
      }
    }
  };
  await walk(dir, "");
  return out;
}

// ───────────────────────────────────────────────────────────────────────────

describe("the fill agent types into a browser it does not own", () => {
  it("fills the field, from a vault the runner has no way to reach", async () => {
    await submitted(request().handle);
    const { context, page } = await runnerPage();
    try {
      const result = await performSecretFill(request(), deps());
      expect(result).toEqual({ status: "filled", lifecycle: "secret_consumed" });

      // It really is in the field. Read through the RUNNER's handle, because
      // that is the arrangement being proved: the agent typed, and the value
      // arrived in a page it does not own.
      expect(await page.locator("#pw").inputValue()).toBe(MARKER);

      // And the agent's own answer says nothing about it.
      expect(JSON.stringify(result)).not.toContain(MARKER);
    } finally {
      await context.close();
    }
  }, 60_000);

  it("obtains the plaintext from the SHARED CACHE, never from a response", async () => {
    // The ciphertext is put by one vault instance and used by another. Nothing
    // is passed between them: the only thing they have in common is the cache
    // and the key provider, which in production are Valkey and KMS.
    await submitted(request().handle);
    expect(cache.rawEntries()).toHaveLength(1);

    // What sits in the cache is not the password, in any encoding.
    const entry = cache.rawEntries()[0];
    if (entry === undefined) expect.unreachable("an envelope should be cached");
    expect(entry.ciphertext.toString("utf8")).not.toContain(MARKER);
    expect(entry.ciphertext.toString("latin1")).not.toContain(MARKER);

    const { context, page } = await runnerPage();
    try {
      expect((await performSecretFill(request(), deps())).status).toBe("filled");
      expect(await page.locator("#pw").inputValue()).toBe(MARKER);
      // Taken, not copied: the cache is empty afterwards.
      expect(cache.rawEntries()).toHaveLength(0);
    } finally {
      await context.close();
    }
  }, 60_000);

  it("appears in NO artefact the run wrote, including inside archives", async () => {
    const dir = join(runDir, "artefacts");
    await submitted(request().handle);
    const { context, page } = await runnerPage();
    try {
      expect((await performSecretFill(request(), deps())).status).toBe("filled");

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
    const encodings = [
      Buffer.from(MARKER, "utf8"),
      Buffer.from(MARKER, "utf16le"),
      Buffer.from(Buffer.from(MARKER, "utf8").toString("base64"), "utf8"),
      Buffer.from(encodeURIComponent(MARKER), "utf8"),
    ];
    for (const file of files) {
      for (const needle of encodings) {
        expect(file.bytes.includes(needle), `${file.path} contains the secret`).toBe(false);
      }
    }

    // The log lines the agent wrote are artefacts too, and the closed field set
    // is what makes them safe. Checked rather than assumed.
    expect(logLines.join("\n")).not.toContain(MARKER);
  }, 60_000);
});

describe("single use survives the process boundary", () => {
  it("refuses a second fill of the same handle", async () => {
    await submitted(request().handle);
    const { context } = await runnerPage();
    try {
      expect((await performSecretFill(request(), deps())).status).toBe("filled");
      const second = await performSecretFill(request(), deps());
      expect(second).toEqual({
        status: "refused",
        reason: "secret_unavailable",
        lifecycle: "secret_consumed",
      });
    } finally {
      await context.close();
    }
  }, 60_000);

  it("does NOT spend the handle when the field does not exist", async () => {
    // The property that costs a student a password if it breaks. The field's
    // existence is established before anything is decrypted, so a blueprint
    // mistake is a blueprint mistake and the same handle still works.
    await submitted(request().handle);
    const { context, page } = await runnerPage();
    try {
      const missing = await performSecretFill(
        request({ locator: { strategy: "css", value: "#nope" } }),
        deps(),
      );
      expect(missing).toEqual({ status: "refused", reason: "no_such_field" });
      // Not merely "no lifecycle field": the authority was never even asked for.
      expect(authorisations).toEqual([]);
      expect(cache.rawEntries()).toHaveLength(1);

      // And the corrected blueprint spends it, with no new prompt to the student.
      expect((await performSecretFill(request(), deps())).status).toBe("filled");
      expect(await page.locator("#pw").inputValue()).toBe(MARKER);
    } finally {
      await context.close();
    }
  }, 60_000);

  it("spends the handle when the portal truncates, and says so without saying what", async () => {
    await submitted(request().handle);
    const { context } = await runnerPage();
    try {
      const result = await performSecretFill(
        request({ locator: { strategy: "css", value: "#capped" } }),
        deps(),
      );
      expect(result).toEqual({
        status: "refused",
        reason: "not_accepted",
        lifecycle: "secret_consumed",
      });
      // A wrong password is a spent password. Asking again is the honest answer.
      expect(cache.rawEntries()).toHaveLength(0);
      expect(JSON.stringify(result)).not.toContain(MARKER);
      // Not even the length, which is a fact about a password.
      expect(JSON.stringify(result)).not.toContain(String(MARKER.length));
    } finally {
      await context.close();
    }
  }, 60_000);
});

describe("what the agent verifies against the live page, rather than trusting", () => {
  it("refuses a page that is not on the bound host, before asking for authority", async () => {
    await submitted(request().handle);
    const { context } = await runnerPage();
    try {
      const result = await performSecretFill(
        request({ targetHost: "apply.somewhere-else.ac.uk" }),
        deps(),
      );
      expect(result).toEqual({ status: "refused", reason: "host_mismatch" });
      expect(authorisations).toEqual([]);
      expect(cache.rawEntries()).toHaveLength(1);
    } finally {
      await context.close();
    }
  }, 60_000);

  it("refuses a field the browser does not render masked", async () => {
    // The blunt failure this catches: a locator that has drifted onto the email
    // box. The subtle one: video, which the agent cannot detect remotely and
    // which shows dots for a masked field and characters for an unmasked one.
    await submitted(request().handle);
    const { context } = await runnerPage();
    try {
      const result = await performSecretFill(
        request({ locator: { strategy: "css", value: "#email" } }),
        deps(),
      );
      expect(result).toEqual({ status: "refused", reason: "field_not_masked" });
      expect(authorisations).toEqual([]);
      expect(cache.rawEntries()).toHaveLength(1);
    } finally {
      await context.close();
    }
  }, 60_000);

  it("detects a snapshot-streaming tracer in the runner's context and refuses", async () => {
    // The control that replaces `confirmNoDiagnosticCapture` across a process
    // boundary — and improves on it, because it is performed by the process
    // that holds the plaintext rather than by the one being checked.
    await submitted(request().handle);
    const { context, page } = await runnerPage({ traced: true });
    try {
      const result = await performSecretFill(request(), deps());
      expect(result).toEqual({ status: "refused", reason: "diagnostic_capture_detected" });
      expect(authorisations).toEqual([]);
      expect(cache.rawEntries()).toHaveLength(1);
      // Nothing was typed, so there is nothing for the trace to have captured.
      expect(await page.locator("#pw").inputValue()).toBe("");
      expect(logLines.join("\n")).toContain("code=diagnostic_capture_detected");
    } finally {
      await context.tracing.stop();
      await context.close();
    }
  }, 60_000);

  it("refuses when the browser cannot be reached, and spends nothing", async () => {
    await submitted(request().handle);
    const result = await performSecretFill(
      request({ browserEndpoint: "ws://127.0.0.1:1/devtools/browser/nope" }),
      deps(),
    );
    expect(result).toEqual({ status: "refused", reason: "browser_unreachable" });
    expect(authorisations).toEqual([]);
    expect(cache.rawEntries()).toHaveLength(1);
  }, 60_000);
});

describe("the authority to spend comes from the secure service", () => {
  it("types nothing when the use is refused, and leaves the handle alive", async () => {
    await submitted(request().handle);
    authoriseAnswer = { ok: false, reason: "not_authorised" };
    const { context, page } = await runnerPage();
    try {
      const result = await performSecretFill(request(), deps());
      expect(result).toEqual({ status: "refused", reason: "not_authorised" });
      expect(await page.locator("#pw").inputValue()).toBe("");
      expect(cache.rawEntries()).toHaveLength(1);

      // The refusal is not a dead end for a legitimate retry: the secure
      // service decides, and if it grants the authority the same handle works.
      authoriseAnswer = { ok: true };
      expect((await performSecretFill(request(), deps())).status).toBe("filled");
    } finally {
      await context.close();
    }
  }, 60_000);

  it("sends the binding and NOTHING that could carry a value", async () => {
    await submitted(request().handle);
    const { context } = await runnerPage();
    try {
      await performSecretFill(request(), deps());
      const sent = authorisations[0];
      if (sent === undefined) expect.unreachable("the authority should have been requested");
      expect(sent.handle).toBe(request().handle);
      expect(sent.targetHost).toBe(request().targetHost);
      expect(JSON.stringify(sent)).not.toContain(MARKER);
    } finally {
      await context.close();
    }
  }, 60_000);
});
