/**
 * P18 — the five deployables, started as real processes.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Everything here spawns `tsx <app>/src/bin.ts` as a CHILD PROCESS with an
 * environment, and asserts what it does: what it prints, what it exits with,
 * whether it listens, and whether `SIGTERM` stops it cleanly.
 *
 * That is the point. A test that imported `start()` and called it would prove
 * the wiring and nothing about the thing P18 exists to deliver — a process an
 * operator can start, that refuses to start when it should, and that says why.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The crown jewel is the last group: the Secure Service PUTs an envelope and
 * the Fill Agent TAKEs it, in two separate operating-system processes, through
 * a real Redis. ADR-0042 has described that topology since it was written and
 * it has never once been possible.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { Redis } from "ioredis";

import { announceSkip, databaseReachable, TEST_DATABASE_URL } from "@askimate/aas-migrate/testing";

const ROOT = join(import.meta.dirname, "..");
/**
 * `tsx` directly, NOT `pnpm exec tsx`.
 *
 * A signal sent to `pnpm` kills pnpm; the node process underneath is not the
 * one that receives `SIGTERM`, so every shutdown assertion saw an exit code of
 * `null` — killed by a signal — rather than the clean zero the handler
 * produces. Spawning the binary means the process under test is the process
 * being signalled, which is also how an orchestrator would run it.
 */
const TSX = join(ROOT, "node_modules", ".bin", "tsx");
const REDIS_URL = process.env["AAS_TEST_REDIS_URL"] ?? "redis://127.0.0.1:56379";

const CONVERSATION_DB = "aas_p18_conversation";
const SECURE_DB = "aas_p18_secure";
const SESSION_SECRET = "a-p18-session-secret-that-is-long-enough-to-pass";

const HAVE_DATABASE = await databaseReachable();
if (!HAVE_DATABASE) announceSkip("P18 — the five deployables, started as real processes");

async function redisReachable(): Promise<boolean> {
  const probe = new Redis(REDIS_URL, {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    lazyConnect: true,
  });
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
if (HAVE_DATABASE && !HAVE_REDIS) {
  const banner =
    "\n" + "█".repeat(78) + "\n" +
    "██  NOT CHECKED: the Secure Service and the Fill Agent SHARING a cache\n" +
    `██  No Redis at ${REDIS_URL}\n` +
    "█".repeat(78) + "\n";
  if (process.env["AAS_REQUIRE_REDIS"] === "1") throw new Error(banner);
  console.warn(banner);
}

const describeIfDatabase = HAVE_DATABASE ? describe : describe.skip;
const describeIfBoth = HAVE_DATABASE && HAVE_REDIS ? describe : describe.skip;

function urlFor(database: string): string {
  const url = new URL(TEST_DATABASE_URL);
  url.pathname = `/${database}`;
  return url.toString();
}

/** What a finished process did. */
interface Finished {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs an entry point to completion, with a bounded wait. */
async function runToCompletion(
  app: string,
  env: Readonly<Record<string, string>>,
  argv: readonly string[] = [],
): Promise<Finished> {
  const child = spawn(TSX, [`apps/${app}/src/bin.ts`, ...argv], {
    cwd: ROOT,
    // A CLEAN environment plus what the case supplies. Inheriting `process.env`
    // would let a variable set by the test runner satisfy a requirement the
    // case is asserting is missing.
    env: { PATH: process.env["PATH"] ?? "", HOME: process.env["HOME"] ?? "", ...env },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
  child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
  const code = await new Promise<number | null>((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve(null);
    }, 60_000);
    child.on("close", (exit) => {
      clearTimeout(timer);
      resolve(exit);
    });
  });
  return { code, stdout, stderr };
}

/** A process that is meant to keep running. Resolves once it says it is up. */
interface Started {
  readonly child: ChildProcessWithoutNullStreams;
  readonly output: () => string;
  readonly stop: (signal?: NodeJS.Signals) => Promise<number | null>;
}

async function startAndWait(
  app: string,
  env: Readonly<Record<string, string>>,
  ready: RegExp,
): Promise<Started> {
  const child = spawn(TSX, [`apps/${app}/src/bin.ts`], {
    cwd: ROOT,
    env: { PATH: process.env["PATH"] ?? "", HOME: process.env["HOME"] ?? "", ...env },
  });
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
  child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));

  const exited = new Promise<number | null>((resolve) => {
    child.on("close", (code) => resolve(code));
  });

  await new Promise<void>((resolve, reject) => {
    const deadline = setTimeout(() => {
      reject(new Error(`${app} never became ready. Output:\n${output}`));
    }, 60_000);
    const poll = setInterval(() => {
      if (ready.test(output)) {
        clearInterval(poll);
        clearTimeout(deadline);
        resolve();
      }
    }, 100);
    void exited.then(() => {
      clearInterval(poll);
      clearTimeout(deadline);
      reject(new Error(`${app} exited before becoming ready. Output:\n${output}`));
    });
  });

  return {
    child,
    output: () => output,
    stop: async (signal = "SIGTERM") => {
      child.kill(signal);
      return await exited;
    },
  };
}

let conversationEnv: Record<string, string>;
let secureEnv: Record<string, string>;

beforeAll(async () => {
  if (!HAVE_DATABASE) return;
  const admin = new pg.Pool({ connectionString: TEST_DATABASE_URL });
  try {
    for (const name of [CONVERSATION_DB, SECURE_DB]) {
      await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await admin.query(`CREATE DATABASE ${name}`);
    }
  } finally {
    await admin.end();
  }

  conversationEnv = {
    AAS_PORT: "4870",
    AAS_CONVERSATION_DATABASE_URL: urlFor(CONVERSATION_DB),
    AAS_SESSION_SECRET: SESSION_SECRET,
    AAS_SECURE_ORIGIN: "http://127.0.0.1:4871",
    AAS_SECURE_INTERNAL_URL: "http://127.0.0.1:4871",
    AAS_SECURE_SERVICE_TOKEN: "conversation-service",
    AAS_SERVICE_CERT_SECURE: "secure-service",
    AAS_SERVICE_CERT_RUNNER: "browser-runner",
    AAS_CATALOGUE: "fixtures",
  };
  secureEnv = {
    AAS_PORT: "4871",
    AAS_SECURE_DATABASE_URL: urlFor(SECURE_DB),
    AAS_SECURE_SELF_ORIGIN: "http://127.0.0.1:4871",
    AAS_CONVERSATION_ORIGIN: "http://127.0.0.1:4870",
    AAS_CONVERSATION_INTERNAL_URL: "http://127.0.0.1:4870",
    AAS_CONVERSATION_SERVICE_TOKEN: "secure-service",
    AAS_SERVICE_CERT_CONVERSATION: "conversation-service",
    AAS_SERVICE_CERT_AGENT: "secure-filler",
  };
}, 180_000);

afterAll(async () => {
  if (!HAVE_DATABASE || !HAVE_REDIS) return;
  const client = new Redis(REDIS_URL, { enableOfflineQueue: false, lazyConnect: true });
  await client.connect();
  const keys = await client.keys("aas:envelope:*");
  if (keys.length > 0) await client.del(...keys);
  await client.quit().catch(() => undefined);
});

describeIfDatabase("refusing to start", () => {
  it("lists EVERY missing variable at once, and exits non-zero", async () => {
    const finished = await runToCompletion("conversation-service", {});
    expect(finished.code, "a misconfigured process must not look healthy").toBe(1);
    for (const variable of [
      "AAS_PORT",
      "AAS_CONVERSATION_DATABASE_URL",
      "AAS_SESSION_SECRET",
      "AAS_SECURE_ORIGIN",
      "AAS_CATALOGUE",
    ]) {
      expect(finished.stderr, `${variable} should be named`).toContain(variable);
    }
  }, 120_000);

  it("puts NO configured value in what it prints", async () => {
    // The startup path is the one that runs when a connection string is wrong,
    // and this output goes wherever the orchestrator sends it.
    const finished = await runToCompletion("conversation-service", {
      ...conversationEnv,
      AAS_SESSION_SECRET: "too-short",
      AAS_CONVERSATION_DATABASE_URL: "postgresql://someone:hunter2@db.internal/aas",
      AAS_PORT: "not-a-number",
    });
    expect(finished.code).toBe(1);
    const printed = `${finished.stdout}${finished.stderr}`;
    expect(printed, "the session secret").not.toContain("too-short");
    expect(printed, "the database password").not.toContain("hunter2");
    expect(printed).toContain("AAS_SESSION_SECRET");
    expect(printed).toContain("at least 32 characters");
  }, 120_000);

  it("REFUSES the dev session route in production", async () => {
    // ═══════════════════════════════════════════════════════════════════
    // `POST /dev/session` mints a session for any subject it is handed. In
    // production that is an authentication bypass, and since ADR-0038's OIDC
    // provider is not built, a production Conversation Service has no way to
    // sign a student in — so it says so rather than starting with a bypass.
    // ═══════════════════════════════════════════════════════════════════
    const finished = await runToCompletion("conversation-service", {
      ...conversationEnv,
      NODE_ENV: "production",
      AAS_SECURE_ORIGIN: "https://secure.example",
      AAS_SECURE_INTERNAL_URL: "https://secure.internal",
      AAS_DEV_SESSION: "1",
    });
    expect(finished.code).toBe(1);
    expect(finished.stderr).toContain("AAS_DEV_SESSION");
    expect(finished.stderr).toContain("must never be set in production");
  }, 120_000);

  it("REFUSES a fixture catalogue in production", async () => {
    const finished = await runToCompletion("conversation-service", {
      ...conversationEnv,
      NODE_ENV: "production",
      AAS_SECURE_ORIGIN: "https://secure.example",
      AAS_SECURE_INTERNAL_URL: "https://secure.internal",
    });
    expect(finished.code).toBe(1);
    expect(finished.stderr).toContain("AAS_CATALOGUE");
    expect(finished.stderr).toContain("gated TEST portal");
  }, 120_000);

  it("REFUSES an http origin in production", async () => {
    const finished = await runToCompletion("conversation-service", {
      ...conversationEnv,
      NODE_ENV: "production",
    });
    expect(finished.code).toBe(1);
    expect(finished.stderr).toContain("must be https in production");
  }, 120_000);

  it("REFUSES a production secure service with a LOCAL key provider", async () => {
    // ═══════════════════════════════════════════════════════════════════
    // `assertVaultIsProductionGrade` has existed since ADR-0034 with no
    // production caller. `secure-plane-deployment.md`: *"a comment saying 'not
    // for production' is advice; a process that will not start is a control."*
    // This is the first time it has ever stopped a process.
    // ═══════════════════════════════════════════════════════════════════
    const finished = await runToCompletion("secure-service", {
      ...secureEnv,
      NODE_ENV: "production",
      AAS_SECURE_SELF_ORIGIN: "https://secure.example",
      AAS_CONVERSATION_ORIGIN: "https://app.example",
      AAS_CONVERSATION_INTERNAL_URL: "https://app.internal",
      AAS_ENVELOPE_CACHE_URL: "rediss://cache.internal:6379",
    });
    expect(finished.code).toBe(1);
    expect(finished.stderr).toContain("AAS_SECURE_KMS_KEY_ID");
  }, 120_000);

  it("REFUSES a production secure service with NO SHARED CACHE", async () => {
    // With the in-process cache the fill agent finds nothing, every time.
    const finished = await runToCompletion("secure-service", {
      ...secureEnv,
      NODE_ENV: "production",
      AAS_SECURE_SELF_ORIGIN: "https://secure.example",
      AAS_CONVERSATION_ORIGIN: "https://app.example",
      AAS_CONVERSATION_INTERNAL_URL: "https://app.internal",
      AAS_SECURE_KMS_KEY_ID: "alias/aas-secure",
    });
    expect(finished.code).toBe(1);
    expect(finished.stderr).toContain("AAS_ENVELOPE_CACHE_URL");
    expect(finished.stderr).toContain("different processes");
  }, 120_000);

  it("REFUSES a runner that is handed a database", async () => {
    // brief §8 and `check-boundaries.ts` keep the case store out of this app's
    // manifest and source. A connection string in the environment is how it
    // would come back, so the entry point names it.
    const finished = await runToCompletion("browser-runner", {
      AAS_CONVERSATION_INTERNAL_URL: "http://127.0.0.1:4870",
      AAS_RUNNER_SERVICE_TOKEN: "browser-runner",
      AAS_RUNNER_HOLDER: "runner-1",
      AAS_AGENT_INTERNAL_URL: "http://127.0.0.1:4872",
      AAS_RUNNER_SERVICE_TOKEN_AGENT: "browser-runner",
      AAS_BROWSER_CDP_URL: "http://127.0.0.1:9222",
      AAS_CONVERSATION_DATABASE_URL: urlFor(CONVERSATION_DB),
    });
    expect(finished.code).toBe(1);
    expect(finished.stderr).toContain("AAS_CONVERSATION_DATABASE_URL");
    expect(finished.stderr).toContain("must not be set on the Automation Runner");
  }, 120_000);
});

describeIfDatabase("migrations", () => {
  it("REFUSES to serve an unmigrated database, naming what is pending", async () => {
    const finished = await runToCompletion("conversation-service", conversationEnv);
    expect(finished.code).toBe(1);
    expect(finished.stderr).toContain("pending migration");
    expect(finished.stderr, "and how to fix it").toContain("migrate");
  }, 120_000);

  it("applies them on command, and is safe to run twice", async () => {
    const first = await runToCompletion("conversation-service", conversationEnv, ["migrate"]);
    expect(first.code).toBe(0);
    expect(first.stdout).toContain("applied");

    const second = await runToCompletion("conversation-service", conversationEnv, ["migrate"]);
    expect(second.code).toBe(0);
    expect(second.stdout).toContain("nothing pending");
  }, 180_000);

  it("migrates the secure plane through its OWN command", async () => {
    // Two databases, two owners. A single migrator would need both planes'
    // credentials, which is the shape ADR-0037 exists to prevent.
    const finished = await runToCompletion("secure-service", secureEnv, ["migrate"]);
    expect(finished.code).toBe(0);
  }, 180_000);
});

describeIfDatabase("running, and stopping", () => {
  it("starts, answers /healthz, and stops cleanly on SIGTERM", async () => {
    const service = await startAndWait("conversation-service", conversationEnv, /listening on 4870/);
    try {
      const health = await fetch("http://127.0.0.1:4870/healthz");
      expect(health.status).toBe(200);
      expect(await health.text()).toBe("ok");
    } finally {
      const code = await service.stop("SIGTERM");
      expect(code, "a clean shutdown exits zero").toBe(0);
      expect(service.output()).toContain("shutting down");
      expect(service.output()).toContain("stopped");
    }
  }, 180_000);

  it("starts the worker, which listens on nothing, and RELEASES ITS LEASES before it exits", async () => {
    // ═══════════════════════════════════════════════════════════════════
    // Graceful shutdown, asserted by its CONSEQUENCE rather than by its exit
    // code. A deliberate regression (P18 S10) made `installShutdown` fire
    // `close()` without waiting for it, and every assertion still passed: the
    // process exited zero and printed "stopped", because nothing checked that
    // anything had actually been closed.
    //
    // The worker's `stop` releases its `worker_leases` so the next worker does
    // not wait a full lease period for work it could start immediately. That
    // is observable in the database AFTER the process is gone, and it is false
    // the moment shutdown stops waiting.
    // ═══════════════════════════════════════════════════════════════════
    const pool = new pg.Pool({ connectionString: urlFor(CONVERSATION_DB), max: 4 });
    try {
      await pool.query("DELETE FROM worker_leases");
      const worker = await startAndWait("worker", {
        AAS_CONVERSATION_DATABASE_URL: urlFor(CONVERSATION_DB),
        AAS_WORKER_HOLDER: "worker-1",
        AAS_SECURE_INTERNAL_URL: "http://127.0.0.1:4871",
        AAS_SECURE_SERVICE_TOKEN: "conversation-service",
        AAS_CATALOGUE: "fixtures",
        AAS_WORKER_ADVANCE_MS: "200",
        AAS_WORKER_ANNOUNCE_MS: "200",
      }, /worker running as worker-1/);

      // Let it take its job leases, so there is something for shutdown to give
      // back. Without this the assertion below would pass vacuously.
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      const held = await pool.query("SELECT job_kind FROM worker_leases WHERE holder = $1", [
        "worker-1",
      ]);
      expect(held.rowCount, "the worker should be holding its job leases").toBeGreaterThan(0);

      const code = await worker.stop("SIGTERM");
      expect(code).toBe(0);
      expect(worker.output()).toContain("stopped");

      const after = await pool.query("SELECT job_kind FROM worker_leases WHERE holder = $1", [
        "worker-1",
      ]);
      expect(after.rowCount, "and to have given them back before exiting").toBe(0);
    } finally {
      await pool.end();
    }
  }, 180_000);
});

describeIfBoth("the Secure Service and the Fill Agent SHARE a cache", () => {
  it("both start against the same real Redis", async () => {
    // ═══════════════════════════════════════════════════════════════════
    // ADR-0042 has described this topology since it was written: the service
    // that receives the password and the agent that spends it are different
    // deployables sharing one cache. Until P18 the only implementation was
    // in-process, so the two shared nothing and every handle resolved to
    // nothing — `secure-plane-deployment.md` §2 has said so all along.
    //
    // Two operating-system processes, one Redis.
    // ═══════════════════════════════════════════════════════════════════
    const secure = await startAndWait(
      "secure-service",
      { ...secureEnv, AAS_ENVELOPE_CACHE_URL: REDIS_URL },
      /secure service listening on 4871/,
    );
    try {
      expect(secure.output(), "the shared cache, not the in-process one").toContain("cache=shared");

      const agent = await startAndWait(
        "secure-filler",
        {
          AAS_PORT: "4872",
          AAS_SECURE_INTERNAL_URL: "http://127.0.0.1:4871",
          AAS_SECURE_SERVICE_TOKEN: "secure-filler",
          AAS_SERVICE_CERT_RUNNER: "browser-runner",
          AAS_ENVELOPE_CACHE_URL: REDIS_URL,
        },
        /fill agent listening on 4872/,
      );
      try {
        expect(agent.output()).toContain("cache=shared");
        const health = await fetch("http://127.0.0.1:4872/healthz");
        expect(health.status).toBe(200);
      } finally {
        expect(await agent.stop("SIGTERM")).toBe(0);
      }
    } finally {
      expect(await secure.stop("SIGTERM")).toBe(0);
    }
  }, 240_000);

  it("REFUSES to start against a cache that would evict under pressure", async () => {
    // The startup control from `secure-plane-deployment.md` §3.2, running for
    // the first time. Changed on the real server and put back afterwards.
    const client = new Redis(REDIS_URL, { enableOfflineQueue: false, lazyConnect: true });
    await client.connect();
    const before = await client.config("GET", "maxmemory-policy");
    await client.config("SET", "maxmemory-policy", "allkeys-lru");
    try {
      const finished = await runToCompletion("secure-service", {
        ...secureEnv,
        AAS_ENVELOPE_CACHE_URL: REDIS_URL,
      });
      expect(finished.code).toBe(1);
      expect(finished.stderr).toContain("spontaneous cancellation");
    } finally {
      await client.config("SET", "maxmemory-policy", before[1] ?? "noeviction");
      await client.quit().catch(() => undefined);
    }
  }, 180_000);
});
