/**
 * The Background Worker, as a process (ADR-0052, ADR-0055).
 *
 * It listens on NOTHING. There is no `/healthz` here and that is deliberate:
 * ADR-0052 gives this deployable no inbound surface, and a health endpoint
 * would be one. Liveness is the process; readiness is that it started at all,
 * and it exits non-zero when it cannot.
 */

import pg from "pg";

import { installShutdown, reportStartupFailure, type Log } from "@askimate/aas-config";
import { MIGRATIONS_DIR as CASE_MIGRATIONS } from "@askimate/aas-case-store";
import {
  MIGRATIONS_DIR as CONVERSATION_MIGRATIONS,
  StudentIdentityStore,
  buildRunDriver,
  conversationStore,
  resolveCatalogue,
  httpSecureRequestOpener,
} from "@askimate/aas-conversation-service";
import { pendingMigrations } from "@askimate/aas-migrate";

import { workerConfigFrom, type WorkerConfig } from "./config.js";
import { startWorker } from "./worker.js";

export interface StartOptions {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly log: Log;
}

export interface RunningProcess {
  readonly config: WorkerConfig;
  readonly close: () => Promise<void>;
}

export async function start(options: StartOptions): Promise<RunningProcess> {
  const config = workerConfigFrom(options.env);
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 6 });

  try {
    // It does not MIGRATE — the Conversation Service owns this schema, and two
    // owners would be two answers to "what version is this database". It only
    // refuses to run against one it was not built for.
    for (const directory of [CASE_MIGRATIONS, CONVERSATION_MIGRATIONS]) {
      const pending = await pendingMigrations(pool, directory);
      if (pending.length > 0) {
        throw new Error(
          `the conversation database has ${String(pending.length)} pending migration(s): ` +
            `${pending.join(", ")}. Run "aas-conversation-service migrate" first.`,
        );
      }
    }

    const store = conversationStore(pool);
    const driver = buildRunDriver(
      {
        pool,
        catalogue: await resolveCatalogue({
          source: config.catalogue,
          ...(config.catalogueDir === undefined ? {} : { directory: config.catalogueDir }),
          portalOrigins: config.portalOrigins,
        }),
        secureRequests: httpSecureRequestOpener({
          baseUrl: config.secureInternalUrl,
          serviceToken: config.secureServiceToken,
        }),
        // The same guard the service applies. A worker advancing a run past a
        // secure step the service would refuse is the second opinion ADR-0041
        // exists to prevent (ADR-0056).
        identities: new StudentIdentityStore(pool),
        // eslint-disable-next-line no-restricted-syntax -- composition root: an entry point is where the real clock is made
        now: () => new Date(),
      },
      store,
    );

    const worker = startWorker({
      pool,
      driver,
      holder: config.holder,
      // eslint-disable-next-line no-restricted-syntax -- composition root: an entry point is where the real clock is made
      now: () => new Date(),
      ...(config.advanceIntervalMs === undefined ? {} : { advanceIntervalMs: config.advanceIntervalMs }),
      ...(config.announceIntervalMs === undefined ? {} : { announceIntervalMs: config.announceIntervalMs }),
      ...(config.batch === undefined ? {} : { batch: config.batch }),
      onFailure: (job) => {
        options.log(`worker job failed: ${job}`);
      },
    });

    options.log(`worker running as ${config.holder} (catalogue=${config.catalogue})`);
    return {
      config,
      close: async () => {
        // Releases its job leases, so the next worker does not wait a full
        // lease period for work it could start immediately.
        await worker.stop();
        await pool.end();
      },
    };
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
    const running = await start({ env: process.env, log });
    installShutdown({ log, close: running.close });
  } catch (error) {
    reportStartupFailure(error, (line) => {
      process.stderr.write(`${line}\n`);
    });
    process.exit(1);
  }
}
