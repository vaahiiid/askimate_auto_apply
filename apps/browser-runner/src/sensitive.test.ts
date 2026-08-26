/**
 * Proof that a fill run leaks nothing, asserted against the ARTEFACTS.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid: *"Do not merely test that our code does not log the values. Test the
 * actual generated artefacts, because the previous investigation showed that
 * Playwright itself can write values into trace.trace."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * So these tests run a real fill session against a real page with the marker
 * values below, then walk **every byte of every file the run produced** and
 * assert none of them appears. A test that inspected our own code would have
 * passed before this fix, when every value was going into `trace.trace`.
 *
 * The marker values are deliberately distinctive so a substring scan cannot
 * miss them and cannot false-positive.
 */

import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium } from "playwright";

import { proposeValue, studentId, redact } from "@askimate/aas-domain";
import type { ConfirmedValue } from "@askimate/aas-domain";
import { applyConfirmation, isDeclined } from "@askimate/aas-profile";

import { PlaywrightPreparationSession, ValueNotAcceptedError, OptionNotAvailableError } from "./playwright-fill-session.js";
import { TracingForbiddenError, openSensitiveContext, tracingIsForbidden } from "./sensitive.js";

const PORT = 4701;
const BASE = `http://127.0.0.1:${String(PORT)}`;
const NOW = new Date("2026-08-26T10:00:00Z");
const STUDENT = studentId("student-1");

/** The values the artefacts must never contain. */
const MARKERS = {
  passport: "TEST-PASSPORT-987654",
  dob: "TEST-DOB-2000-01-01",
  password: "TEST-SECRET-PASSWORD-123!",
  statement: "TEST-STATEMENT-personal-essay-body",
  address: "TEST-ADDRESS-14-Example-Street",
  phone: "TEST-PHONE-07700900123",
  email: "TEST-EMAIL-student@example.test",
} as const;

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Form</title></head>
<body>
  <label for="passport">Passport</label><input id="passport" name="passport" type="text">
  <label for="dob">Date of birth</label><input id="dob" name="dob" type="text">
  <label for="pw">Password</label><input id="pw" name="pw" type="password">
  <label for="stmt">Statement</label><textarea id="stmt" name="stmt"></textarea>
  <label for="addr">Address</label><input id="addr" name="addr" type="text">
  <label for="phone">Phone</label><input id="phone" name="phone" type="text">
  <label for="email">Email</label><input id="email" name="email" type="text">
  <label for="short">Short</label><input id="short" name="short" type="text" maxlength="4">
  <label for="nat">Nationality</label><select id="nat" name="nat"><option value="GB">UK</option></select>
  <button id="next" type="button">Next</button>
</body></html>`;

let server: Server;
let runDir: string;

function confirmed(value: string): ConfirmedValue<string> {
  const result = applyConfirmation({
    key: "identity.passport_number",
    proposed: proposeValue({ value, origin: "conversation", verbatim: value, confidence: 0.95 }),
    confirmation: {
      studentRef: STUDENT,
      presentedText: "…",
      respondedAt: NOW,
      response: { kind: "accepted" },
    },
  });
  if (isDeclined(result)) expect.unreachable("accepted");
  return result.value;
}

const locator = (id: string) => ({ strategy: "css" as const, value: `#${id}` });

/**
 * Every file the run produced, with its bytes — INCLUDING inside archives.
 *
 * Expanding zips is not thoroughness for its own sake. A Playwright trace is a
 * zip, and a compressed archive hides its contents from a substring scan
 * completely: when this fix was deliberately reverted to check the tests catch
 * it, every marker-value assertion still passed and only the "no trace file"
 * assertion failed. A scan that a regression can walk past is not a proof.
 */
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
          // An archive we cannot open is itself a finding — surface it as a
          // file that exists rather than silently skipping it.
        }
      }
    }
  };
  await walk(dir, "");
  return out;
}

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" }).end(PAGE);
  });
  await new Promise<void>((resolve) => server.listen(PORT, "127.0.0.1", resolve));
  runDir = await mkdtemp(join(tmpdir(), "aas-leak-"));

  const session = await PlaywrightPreparationSession.open({
    runId: "leak-test-1",
    capability: "fillable",
    allowedHosts: ["127.0.0.1"],
    traceDir: runDir,
    clickableControls: [locator("next")],
  });

  try {
    await session.goto(`${BASE}/form`);
    await session.fill(locator("passport"), confirmed(MARKERS.passport));
    await session.fill(locator("dob"), confirmed(MARKERS.dob));
    await session.fill(locator("pw"), confirmed(MARKERS.password));
    await session.fill(locator("stmt"), confirmed(MARKERS.statement));
    await session.fill(locator("addr"), confirmed(MARKERS.address));
    await session.fill(locator("phone"), confirmed(MARKERS.phone));
    await session.fill(locator("email"), confirmed(MARKERS.email));

    // Force both error paths, because an error object is a thing that gets
    // logged, serialised and pasted into a ticket.
    await session
      .fill(locator("short"), confirmed(MARKERS.passport))
      .catch(() => undefined); // truncation → ValueNotAcceptedError
    await session
      .fill(locator("nat"), confirmed(MARKERS.address))
      .catch(() => undefined); // missing option → OptionNotAvailableError

    await session.observe();
    await session.screenshot("filled-form");
    await session.click(locator("next"));
  } finally {
    await session.close();
  }
}, 120_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(runDir, { recursive: true, force: true });
});

// ───────────────────────────────────────────────────────────────────────────
// The artefacts
// ───────────────────────────────────────────────────────────────────────────

describe("what a fill run writes to disk", () => {
  it("produces artefacts at all, so an empty scan cannot pass by accident", async () => {
    const files = await artefacts(runDir);
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((file) => file.path.endsWith(".png"))).toBe(true);
  });

  it("writes NO trace file", async () => {
    // The fix. Tracing is not stopped early or filtered — it never starts, and
    // the context refuses to start it.
    const files = await artefacts(runDir);
    expect(files.filter((file) => file.path.includes("trace"))).toEqual([]);
  });

  it("writes NO video", async () => {
    // A video of a form being filled shows every non-password value in plain
    // sight, and unlike a trace it cannot be scanned for a leak afterwards.
    const files = await artefacts(runDir);
    expect(files.filter((file) => /\.(webm|mp4)$/.test(file.path))).toEqual([]);
    await expect(stat(join(runDir, "video"))).rejects.toThrow();
  });

  for (const [name, value] of Object.entries(MARKERS)) {
    it(`contains no trace of the ${name}, in ANY file`, async () => {
      const files = await artefacts(runDir);
      const leaked = files
        .filter((file) => file.bytes.includes(value))
        .map((file) => file.path);
      expect(leaked).toEqual([]);
    });
  }

  it("contains none of the markers even as a UTF-16 or base64 encoding", async () => {
    // Cheap paranoia: a JSON escape or a data: URI would hide a substring scan.
    const files = await artefacts(runDir);
    for (const value of Object.values(MARKERS)) {
      const encodings = [
        Buffer.from(value, "utf16le"),
        Buffer.from(Buffer.from(value).toString("base64")),
        Buffer.from(encodeURIComponent(value)),
      ];
      for (const encoded of encodings) {
        const leaked = files.filter((file) => file.bytes.includes(encoded)).map((f) => f.path);
        expect(leaked).toEqual([]);
      }
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Tracing cannot be turned back on
// ───────────────────────────────────────────────────────────────────────────

describe("the sensitive context refuses tracing", () => {
  it("throws when a future developer calls tracing.start()", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await openSensitiveContext(browser, { userAgent: "test" });
      // Synchronously, not as a rejected promise: the call fails before it can
      // be awaited, so code that forgets to await still cannot enable tracing.
      expect(() => context.tracing.start({ screenshots: true })).toThrow(TracingForbiddenError);
      expect(tracingIsForbidden(context)).toBe(true);
      await context.close();
    } finally {
      await browser.close();
    }
  }, 60_000);

  it("throws on startChunk() too, which was the obvious workaround", async () => {
    // `stopChunk`/`startChunk` was tried as a mitigation and did NOT stop the
    // leak, so it must not become the way someone re-enables tracing either.
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await openSensitiveContext(browser, { userAgent: "test" });
      expect(() => context.tracing.startChunk()).toThrow(TracingForbiddenError);
      await context.close();
    } finally {
      await browser.close();
    }
  }, 60_000);

  it("leaves stop() harmless, so a shared teardown need not know the kind", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await openSensitiveContext(browser, { userAgent: "test" });
      await expect(context.tracing.stop()).resolves.toBeUndefined();
      await context.close();
    } finally {
      await browser.close();
    }
  }, 60_000);

  it("does NOT start tracing while answering the question", async () => {
    // ── The regression this pins ──────────────────────────────────────────
    //
    // `tracingIsForbidden` used to answer by CALLING `tracing.start()` and
    // reporting whether it threw. On an ordinary context that started tracing:
    // a function whose only job is to detect the leak mechanism was switching
    // it on. It surfaced as an unhandled rejection — "Tracing has been already
    // started" on the second call, which is only possible if the first one
    // succeeded.
    //
    // The proof that it no longer happens: ask twice, then start tracing for
    // real. If either question had started it, `start()` here would reject.
    const browser = await chromium.launch({ headless: true });
    try {
      const ordinary = await browser.newContext();
      expect(tracingIsForbidden(ordinary)).toBe(false);
      expect(tracingIsForbidden(ordinary)).toBe(false);

      await expect(ordinary.tracing.start({ screenshots: false })).resolves.toBeUndefined();
      await ordinary.tracing.stop();
      await ordinary.close();
    } finally {
      await browser.close();
    }
  }, 60_000);

  it("is not fooled by a context that merely throws from start()", async () => {
    // The mark is a module-private symbol, so this is the closest an outsider
    // can get to forging one: replace `start` with something that throws the
    // right error. It is not enough, and it should not be — a context whose
    // tracing throws is not the same as a context created without tracing, and
    // Playwright buffers actions across a stopped trace.
    const browser = await chromium.launch({ headless: true });
    try {
      const ordinary = await browser.newContext();
      (ordinary.tracing as unknown as Record<string, unknown>)["start"] = (): never => {
        throw new TracingForbiddenError("start");
      };
      expect(tracingIsForbidden(ordinary)).toBe(false);
      await ordinary.close();
    } finally {
      await browser.close();
    }
  }, 60_000);

  it("says WHY in the error, not just that it is forbidden", () => {
    const error = new TracingForbiddenError("start");
    expect(error.message).toContain("verbatim into trace.trace");
    expect(error.message).toContain("buffered and replayed");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Errors and diagnostics
// ───────────────────────────────────────────────────────────────────────────

describe("errors and diagnostics carry shapes, not values", () => {
  it("keeps the truncated value out of ValueNotAcceptedError, object and message", () => {
    const error = new ValueNotAcceptedError(locator("short"), MARKERS.statement, "TEST");
    expect(JSON.stringify(error)).not.toContain(MARKERS.statement);
    expect(error.message).not.toContain(MARKERS.statement);
    // But it still says what a specialist needs: it was truncated, and by how much.
    expect(error.message).toContain("truncated");
    expect(error.intended.length).toBe(MARKERS.statement.length);
    expect(error.intended.digest).toBe(redact(MARKERS.statement).digest);
  });

  it("keeps the student's answer out of OptionNotAvailableError", () => {
    const error = new OptionNotAvailableError(locator("nat"), MARKERS.address, [
      { value: "GB", label: "UK" },
    ]);
    expect(error.message).not.toContain(MARKERS.address);
    expect(JSON.stringify(error)).not.toContain(MARKERS.address);
    // The portal's OWN list is not the student's data, and naming it is what
    // makes the error actionable.
    expect(error.message).toContain("GB (UK)");
  });

  it("redacts a value's shape usefully enough to compare two values", () => {
    expect(redact("same").digest).toBe(redact("same").digest);
    expect(redact("same").digest).not.toBe(redact("different").digest);
    expect(redact(MARKERS.dob).redacted).toBe("[redacted]");
  });
});
