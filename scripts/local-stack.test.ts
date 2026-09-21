/**
 * The local-stack runbook, proved (P120): `scripts/local-stack.sh` stands the
 * five deployables up as REAL child processes on one machine against a real
 * Postgres and a real Redis, migrated; the three services answer `/healthz`,
 * the runner's browser answers at the CDP endpoint the Fill Agent would dial,
 * the worker reports itself running; and `stop` brings all five down.
 *
 * Against the fixture catalogue here. The same script with
 * `AAS_LOCAL_CATALOGUE=registry` and a reviewed entry is the Sheffield variant
 * (docs/runbook-local-stack.md), which this repository cannot run.
 */

import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";
import pg from "pg";
import { Redis } from "ioredis";

import { announceSkip, databaseReachable, TEST_DATABASE_URL } from "@askimate/aas-migrate/testing";

const ROOT = join(import.meta.dirname, "..");
const REDIS_URL = process.env["AAS_TEST_REDIS_URL"] ?? "redis://127.0.0.1:56379";
// 4950–4959: a range no other suite listens on. 4880 collided with two suites
// on 4881 and 4882 when the whole census ran at once (found in P121).
const PORT_BASE = 4950;
const PREFIX = "aas_localstack_test";

const HAVE_DATABASE = await databaseReachable();
if (!HAVE_DATABASE) announceSkip("P120 — the local stack, started by its own script");

async function redisReachable(): Promise<boolean> {
  const probe = new Redis(REDIS_URL, { enableOfflineQueue: false, maxRetriesPerRequest: 1, lazyConnect: true });
  try {
    await probe.connect();
    await probe.ping();
    return true;
  } catch {
    return false;
  } finally {
    await probe.quit().catch(() => undefined);
  }
}
const HAVE_REDIS = HAVE_DATABASE ? await redisReachable() : false;
if (HAVE_DATABASE && !HAVE_REDIS && process.env["AAS_REQUIRE_REDIS"] === "1") {
  throw new Error(`P120 needs a Redis at ${REDIS_URL}: the Secure Service and the Fill Agent share one`);
}
const describeIfBoth = HAVE_DATABASE && HAVE_REDIS ? describe : describe.skip;

interface Finished {
  readonly code: number | null;
  readonly output: string;
}

function script(command: string, dir: string, ...rest: readonly string[]): Promise<Finished> {
  return new Promise((resolve) => {
    const child = spawn("bash", ["scripts/local-stack.sh", command, ...rest], {
      cwd: ROOT,
      env: {
        PATH: process.env["PATH"] ?? "",
        HOME: process.env["HOME"] ?? "",
        ...(process.env["PLAYWRIGHT_BROWSERS_PATH"] === undefined ? {} : { PLAYWRIGHT_BROWSERS_PATH: process.env["PLAYWRIGHT_BROWSERS_PATH"] }),
        AAS_LOCAL_DIR: dir,
        AAS_LOCAL_ADMIN_DATABASE_URL: TEST_DATABASE_URL,
        AAS_LOCAL_REDIS_URL: REDIS_URL,
        AAS_LOCAL_PORT_BASE: String(PORT_BASE),
        AAS_LOCAL_DB_PREFIX: PREFIX,
      },
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
    const timer = setTimeout(() => child.kill("SIGKILL"), 240_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}

async function status(url: string): Promise<number> {
  try {
    return (await fetch(url)).status;
  } catch {
    return 0;
  }
}

let dir = "";

afterAll(async () => {
  if (dir.length > 0) {
    await script("stop", dir).catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  }
  if (!HAVE_DATABASE) return;
  const admin = new pg.Pool({ connectionString: TEST_DATABASE_URL });
  try {
    for (const name of [`${PREFIX}_conversation`, `${PREFIX}_secure`]) {
      await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    }
  } finally {
    await admin.end();
  }
});

describeIfBoth("the local stack, started by its own script", () => {
  it("creates and migrates both databases, starts the five processes, and each answers where the script says", async () => {
    dir = await mkdtemp(join(tmpdir(), "aas-local-stack-"));
    const started = await script("start", dir);
    expect(started.code, started.output).toBe(0);
    expect(started.output).toContain("up:");
    // Nothing configured is printed: not the admin URL, not the secret.
    expect(started.output).not.toContain(TEST_DATABASE_URL);
    expect(started.output).not.toMatch(/AAS_SESSION_SECRET|[0-9a-f]{64}/);

    expect(await status(`http://127.0.0.1:${String(PORT_BASE)}/healthz`)).toBe(200);
    expect(await status(`http://127.0.0.1:${String(PORT_BASE + 1)}/healthz`)).toBe(200);
    expect(await status(`http://127.0.0.1:${String(PORT_BASE + 2)}/healthz`)).toBe(200);
    // The runner's browser listens where the Fill Agent will dial (P120's
    // finding: the entry point did not open this port before).
    const version = await fetch(`http://127.0.0.1:${String(PORT_BASE + 9)}/json/version`);
    expect(version.status).toBe(200);
    // P121's finding: the API answering is not the stack being usable. The
    // student's page and the secure control the frame runs are built into the
    // state directory and served — without them no password could be taken.
    const page = await fetch(`http://127.0.0.1:${String(PORT_BASE)}/`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("journey.js");
    expect(await status(`http://127.0.0.1:${String(PORT_BASE + 1)}/control.js`)).toBe(200);

    const checked = await script("status", dir);
    expect(checked.code, checked.output).toBe(0);
    for (const app of ["conversation-service", "secure-service", "secure-filler", "browser-runner", "worker"]) {
      expect(checked.output).toContain(`${app}: running`);
    }
  }, 300_000);

  it("runs the P159 repair through the REAL command, and refuses what it cannot name", async () => {
    // ═══════════════════════════════════════════════════════════════════
    // ADR-0126, and the P80 lesson: a command is proved by running the
    // command. Everything the repair needs is built before it can act — the
    // env file is read, the pool opens, the catalogue resolves, the driver is
    // constructed — and any one of those failing would show up here and
    // nowhere else, because the repair's own behaviour is tested against the
    // driver, not against this binary.
    //
    // A conversation that does not exist, deliberately: what this asserts is
    // the WIRING and the refusal, and staging a stopped case inside the
    // stack's own database would test the driver a second time instead.
    // ═══════════════════════════════════════════════════════════════════
    const missing = await script("finish-stopped", dir, "01JBXQ8Z9WKTQ6M4H2NPNOSUCH0");
    expect(missing.code, missing.output).toBe(1);
    expect(missing.output).toContain("unknown_conversation");
    expect(missing.output).toContain("Nothing was done");
    // The env file carries the database URL and the session secret. Neither is
    // this command's to print, the same rule `start` is held to above.
    expect(missing.output).not.toContain(TEST_DATABASE_URL);
    expect(missing.output).not.toMatch(/AAS_SESSION_SECRET|[0-9a-f]{64}/);

    const noArgument = await script("finish-stopped", dir);
    expect(noArgument.code, "a repair with no target does nothing").toBe(2);
    expect(noArgument.output).toContain("usage:");
  }, 120_000);

  it("runs the P177 repair through the REAL command, and refuses what it cannot name", async () => {
    // Blocker 48's repair, wired and proved the same way as P159's above and
    // for the same reason: its behaviour is tested against the driver, and
    // what this asserts is that the binary reaches it at all.
    const missing = await script("raise-missing", dir, "01JBXQ8Z9WKTQ6M4H2NPNOSUCH0");
    expect(missing.code, missing.output).toBe(1);
    expect(missing.output).toContain("unknown_conversation");
    expect(missing.output).toContain("Nothing was done");
    expect(missing.output).not.toContain(TEST_DATABASE_URL);
    expect(missing.output).not.toMatch(/AAS_SESSION_SECRET|[0-9a-f]{64}/);

    const noArgument = await script("raise-missing", dir);
    expect(noArgument.code, "a repair with no target does nothing").toBe(2);
    expect(noArgument.output).toContain("usage:");
  }, 120_000);

  it("stops all five on request, and nothing answers afterwards", async () => {
    const stopped = await script("stop", dir);
    expect(stopped.code, stopped.output).toBe(0);
    expect(await status(`http://127.0.0.1:${String(PORT_BASE)}/healthz`)).toBe(0);
    expect(await status(`http://127.0.0.1:${String(PORT_BASE + 1)}/healthz`)).toBe(0);
    expect(await status(`http://127.0.0.1:${String(PORT_BASE + 9)}/json/version`)).toBe(0);
    const after = await script("status", dir);
    expect(after.code).not.toBe(0);
  }, 120_000);
});
