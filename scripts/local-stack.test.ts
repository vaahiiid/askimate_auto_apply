/**
 * The local-stack runbook, proved (P120): `scripts/local-stack.sh` stands the
 * deployables up as REAL child processes on one machine against a real
 * Postgres and a real Redis, migrated; the three services answer `/healthz`,
 * the runner's browser answers at the CDP endpoint the Fill Agent would dial,
 * the worker reports itself running, the CV reader reports itself polling
 * (P248, row 103: six since then, five before); and `stop` brings all down.
 *
 * Against the fixture catalogue here. The same script with
 * `AAS_LOCAL_CATALOGUE=registry` and a reviewed entry is the Sheffield variant
 * (docs/runbook-local-stack.md), which this repository cannot run.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
  return scriptWith({}, command, dir, ...rest);
}

function scriptWith(extra: Readonly<Record<string, string>>, command: string, dir: string, ...rest: readonly string[]): Promise<Finished> {
  return new Promise((resolve) => {
    const child = spawn("bash", ["scripts/local-stack.sh", command, ...rest], {
      cwd: ROOT,
      env: {
        ...extra,
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

describe("the stack announces what its processes SAY they came up with, and refuses a gap (P250)", () => {
  // Vahid, 2026-09-29, on a start given AAS_LOCAL_DOCUMENTS=vault that came
  // up with documents=none and announced six services: *"the vault option
  // was accepted silently and produced nothing… a start that is given
  // AAS_LOCAL_DOCUMENTS=vault and comes up with documents=none should
  // refuse, not proceed. Announcing six services while the one thing I
  // asked for is absent is the same class as the banner that said Bedrock
  // and called somewhere else."*
  const VAULT = { AAS_LOCAL_DOCUMENTS: "vault", AAS_DOCUMENTS_BUCKET: "b", AAS_DOCUMENTS_KMS_KEY_ARN: "arn:aws:kms:eu-west-2:000000000000:key/00000000-0000-0000-0000-000000000000" };

  it("verify exits 2 when the service's own line says documents=none though the vault was asked, and when the reader's says stand-in though bedrock was", async () => {
    // Made to fail on purpose: fabricated logs in which each process says the opposite of what was asked.
    const scratch = await mkdtemp(join(tmpdir(), "aas-local-stack-verify-"));
    try {
      await writeFile(join(scratch, "conversation-service.log"), "conversation service listening on 4970 (catalogue=fixtures, dev-session=true, identity=none, documents=none)\n");
      await writeFile(join(scratch, "cv-reader.log"), "cv reader reader-local-1 polling http://127.0.0.1:4970 — model: the deterministic stand-in (not for production)\n");
      const refused = await scriptWith({ ...VAULT, AAS_LOCAL_READER_MODEL: "bedrock" }, "verify", scratch);
      expect(refused.code).toBe(2);
      expect(refused.output).toContain("REFUSED: AAS_LOCAL_DOCUMENTS=vault was asked");
      expect(refused.output).toContain("documents=none");
      expect(refused.output).toContain("REFUSED: AAS_LOCAL_READER_MODEL=bedrock was asked");
      expect(refused.output).toContain("stand-in");
      // Nothing asked beyond the defaults: the same logs verify.
      const fine = await scriptWith({}, "verify", scratch);
      expect(fine.code, fine.output).toBe(0);
      expect(fine.output).toContain("verified: documents=none, cv reader model=stand-in");
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }, 60_000);

  it("refuses an exported AAS_LOCAL_* it does not read, rather than ignoring it", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "aas-local-stack-unknown-"));
    try {
      const refused = await scriptWith({ AAS_LOCAL_DOCUMENT: "vault" }, "start", scratch);
      expect(refused.code).toBe(2);
      expect(refused.output).toContain("AAS_LOCAL_DOCUMENT is exported and this script does not read it");
      expect(existsSync(join(scratch, "conversation-service.env"))).toBe(false);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("the local stack refuses a document vault it was not told enough about (P249)", () => {
  it("exits 2 naming the missing variable, before creating a database or starting a process", async () => {
    const scratch = await mkdtemp(join(tmpdir(), "aas-local-stack-vault-"));
    try {
      const refused = await scriptWith({ AAS_LOCAL_DOCUMENTS: "vault" }, "start", scratch);
      expect(refused.code).toBe(2);
      expect(refused.output).toContain("AAS_DOCUMENTS_BUCKET");
      expect(refused.output, "nothing was started").not.toContain("up:");
      expect(existsSync(join(scratch, "conversation-service.pid"))).toBe(false);
      expect(existsSync(join(scratch, "conversation-service.env"))).toBe(false);
      const wrong = await scriptWith({ AAS_LOCAL_DOCUMENTS: "sometimes" }, "start", scratch);
      expect(wrong.code).toBe(2);
      expect(wrong.output).toContain("AAS_LOCAL_DOCUMENTS");
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }, 60_000);
});

describeIfBoth("the local stack, started by its own script", () => {
  it("creates and migrates both databases, starts the five processes, and each answers where the script says", async () => {
    dir = await mkdtemp(join(tmpdir(), "aas-local-stack-"));
    // Asked for the vault with a bucket nothing will be sent to: the service
    // builds its transport without touching AWS, and the summary must carry
    // the service's OWN word for it (P250), not the shell's.
    const started = await scriptWith(
      { AAS_LOCAL_DOCUMENTS: "vault", AAS_DOCUMENTS_BUCKET: "aas-local-stack-test-bucket", AAS_DOCUMENTS_KMS_KEY_ARN: "arn:aws:kms:eu-west-2:000000000000:key/00000000-0000-0000-0000-000000000000" },
      "start",
      dir,
    );
    expect(started.code, started.output).toBe(0);
    expect(started.output).toContain("up: (each line is what the process itself said");
    expect(started.output).toContain("documents             s3 (bucket aas-local-stack-test-bucket");
    expect(started.output).toContain("model: stand-in");
    const verified = await scriptWith({ AAS_LOCAL_DOCUMENTS: "vault", AAS_DOCUMENTS_BUCKET: "aas-local-stack-test-bucket", AAS_DOCUMENTS_KMS_KEY_ARN: "arn:aws:kms:eu-west-2:000000000000:key/00000000-0000-0000-0000-000000000000" }, "verify", dir);
    expect(verified.code, verified.output).toBe(0);
    expect(verified.output).toContain("verified: documents=s3, cv reader model=stand-in");
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
    expect(started.output, "the sixth process, the CV reader (P248)").toContain("cv reader");
    for (const app of ["conversation-service", "secure-service", "secure-filler", "browser-runner", "worker", "cv-reader"]) {
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

  it("runs the P263 repair through the REAL command, and refuses what it cannot name", async () => {
    const orphan = await script("say-again", dir, "01JBXQ8Z9WKTQ6M4H2NPNOSUCH0");
    expect(orphan.code, orphan.output).toBe(1);
    expect(orphan.output).toContain("unknown_conversation");
    expect(orphan.output).toContain("Nothing was done");
    expect(orphan.output).not.toContain(TEST_DATABASE_URL);
    const noArgument = await script("say-again", dir);
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
