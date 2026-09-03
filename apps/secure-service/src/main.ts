/**
 * The Secure Interaction Service, as a process.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ADR-0055. The one service that receives a student's password, and until P18
 * it had no entry point — so two controls the deployment document described as
 * load-bearing had never run:
 *
 *   `assertVaultIsProductionGrade` — *"a comment saying 'not for production' is
 *   advice; a process that will not start is a control."* There was no process.
 *
 *   the SHARED cache — ADR-0042 makes this service and the fill agent separate
 *   deployables, and the only implementation was in-process.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   aas-secure-service            start and serve
 *   aas-secure-service migrate    apply pending migrations, then exit
 */

import type { Server } from "node:http";

import pg from "pg";

import { installShutdown, reportStartupFailure, type Log } from "@askimate/aas-config";
import { RedisEnvelopeCache } from "@askimate/aas-envelope-cache-redis";
import { migrateExclusive, pendingMigrations } from "@askimate/aas-migrate";
import {
  EnvelopeVault,
  InMemoryEnvelopeCache,
  type DataKeyProvider,
  type EnvelopeCache,
} from "@askimate/aas-secrets";
// Its own entry point, so importing the vault does not pull the AWS SDK into a
// bundle that will never call it.
import { keyProviderFor } from "@askimate/aas-secrets/kms";
import { SecureLogger } from "@askimate/aas-secure-logging";

import { createSecureApp } from "./app.js";
import { startSecureBackground } from "./background.js";
import { secureConfigFrom, type SecureConfig } from "./config.js";
import { MIGRATIONS_DIR } from "./index.js";
import { internalAppend } from "./internal-append.js";
import { LifecycleOutbox } from "./lifecycle-outbox.js";
import { SecureRequestStore } from "./requests.js";

export interface StartOptions {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly argv: readonly string[];
  readonly log: Log;
  readonly exit: (code: number) => void;
}

export interface RunningService {
  readonly config: SecureConfig;
  readonly close: () => Promise<void>;
}

export async function start(options: StartOptions): Promise<RunningService | null> {
  const config = secureConfigFrom(options.env);
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });
  let cache: EnvelopeCache & { close?: () => Promise<void> };

  try {
    if (options.argv[0] === "migrate") {
      const applied = await migrateExclusive(pool, MIGRATIONS_DIR);
      options.log(
        applied.length === 0 ? "migrate: nothing pending" : `migrate: applied ${applied.join(", ")}`,
      );
      await pool.end();
      options.exit(0);
      return null;
    }

    // ── The control that has always been described and never run ─────────
    //
    // Before the database, before the cache, before anything listens: a
    // production deployment with a local master key stops here.
    const keys: DataKeyProvider = keyProviderFor(
      { keyId: config.kmsKeyId, region: config.kmsRegion },
      options.env["NODE_ENV"],
    );

    // ── The cache, and whether it is safe to put ciphertext in ───────────
    if (config.cacheUrl === undefined) {
      // Only reachable outside production — `secureConfigFrom` refuses it there.
      options.log(
        "WARNING: using the IN-PROCESS envelope cache. The fill agent is a different " +
          "process and will not see anything put here (ADR-0042).",
      );
      cache = new InMemoryEnvelopeCache();
    } else {
      const redis = new RedisEnvelopeCache({ url: config.cacheUrl });
      // Reachable, `noeviction`, and not writing ciphertext to disk. Refusing
      // here rather than discovering it when a student's step silently lapses.
      await redis.verify();
      cache = redis;
    }

    const pending = await pendingMigrations(pool, MIGRATIONS_DIR);
    if (pending.length > 0) {
      throw new Error(
        `the secure database has ${String(pending.length)} pending migration(s): ` +
          `${pending.join(", ")}. Run "aas-secure-service migrate" first.`,
      );
    }

    const store = new SecureRequestStore(pool);
    const outbox = new LifecycleOutbox(pool);
    const logger = new SecureLogger((line) => {
      options.log(line);
    });

    const app = createSecureApp({
      store,
      vault: new EnvelopeVault(keys, cache),
      outbox,
      // eslint-disable-next-line no-restricted-syntax -- composition root: an entry point is where the real clock is made
      now: () => new Date(),
      selfOrigin: config.selfOrigin,
      parentOrigin: config.parentOrigin,
      logger,
      authoriseService: (req) => {
        const presented = req.header("x-service-cert");
        return (
          presented === config.serviceCertConversation || presented === config.serviceCertAgent
        );
      },
      ...(config.assetDir === undefined ? {} : { assetDir: config.assetDir }),
    });

    const server: Server = await new Promise((resolve) => {
      const listening = app.listen(config.port, () => resolve(listening));
    });

    // ── P14's loops, started for the first time by a real process ────────
    const background = startSecureBackground({
      pool,
      store,
      outbox,
      deliver: internalAppend({
        baseUrl: config.conversationInternalUrl,
        serviceCertificate: config.conversationServiceToken,
      }),
      // eslint-disable-next-line no-restricted-syntax -- composition root: an entry point is where the real clock is made
      now: () => new Date(),
      onFailure: (job) => {
        // A WORD, never an error object: this is the one service where an
        // error's message might carry a fragment of a request body.
        options.log(`background job failed: ${job}`);
      },
    });

    options.log(
      `secure service listening on ${String(config.port)} ` +
        `(keys=${keys.kind}, cache=${config.cacheUrl === undefined ? "in-process" : "shared"})`,
    );

    const close = async (): Promise<void> => {
      background.stop();
      // One last drain, so a transition already committed here is delivered
      // rather than waiting for the next instance's first tick.
      await background.runOnce().catch(() => undefined);
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await pool.end();
      await cache.close?.();
    };
    return { config, close };
  } catch (error) {
    await pool.end().catch(() => undefined);
    throw error;
  }
}

export async function main(): Promise<void> {
  const log: Log = (line) => {
    process.stdout.write(`${line}\n`);
  };
  try {
    const running = await start({
      env: process.env,
      argv: process.argv.slice(2),
      log,
      exit: (code) => process.exit(code),
    });
    if (running === null) return;
    installShutdown({ log, close: running.close });
  } catch (error) {
    reportStartupFailure(error, (line) => {
      process.stderr.write(`${line}\n`);
    });
    process.exit(1);
  }
}
