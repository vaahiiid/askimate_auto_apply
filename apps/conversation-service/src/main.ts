/**
 * The Conversation Service, as a process.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ADR-0055. Before P18 this deployable had no entry point at all: `createConversationApp`
 * was a factory only tests ever called `.listen()` on. Five deployables existed
 * and none could be started by a person.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   aas-conversation-service            start and serve
 *   aas-conversation-service migrate    apply pending migrations, then exit
 *
 * The two are separate on purpose (see `@askimate/aas-migrate/production`): a
 * service that migrated on boot would move the schema under the previous
 * version still serving during a rolling deploy.
 */

import type { Server } from "node:http";

import pg from "pg";

import { installShutdown, reportStartupFailure, type Log } from "@askimate/aas-config";
import { migrateExclusive, pendingMigrations } from "@askimate/aas-migrate";
import { MIGRATIONS_DIR as CASE_MIGRATIONS } from "@askimate/aas-case-store";

import { discoverAdapter } from "@askimate/aas-oidc";

import { createConversationApp } from "./app.js";
import { conversationConfigFrom, type ConversationConfig } from "./config.js";
import { MIGRATIONS_DIR } from "./index.js";
import { StudentIdentityStore } from "./identity-store.js";
import { httpSecureRequestOpener } from "./secure-requests.js";
import { buildRunDriver, conversationStore, resolveCatalogue } from "./wiring.js";

/**
 * Both schemas, in the order they must be applied.
 *
 * The case store's tables and this service's own live in ONE database — the
 * conversation plane's — and the registry is keyed by filename, so the two sets
 * coexist. Listing them here is what makes "is this database ready?" a question
 * with one answer.
 */
const MIGRATION_SETS: readonly string[] = [CASE_MIGRATIONS, MIGRATIONS_DIR];

export interface StartOptions {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly argv: readonly string[];
  readonly log: Log;
  readonly exit: (code: number) => void;
}

/** What a started service holds, so a test can stop it without signals. */
export interface RunningService {
  readonly config: ConversationConfig;
  readonly port: number;
  readonly close: () => Promise<void>;
}

export async function start(options: StartOptions): Promise<RunningService | null> {
  const config = conversationConfigFrom(options.env);
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });

  try {
    if (options.argv[0] === "migrate") {
      for (const directory of MIGRATION_SETS) {
        const applied = await migrateExclusive(pool, directory);
        options.log(
          applied.length === 0
            ? `migrate: nothing pending in ${directory}`
            : `migrate: applied ${applied.join(", ")}`,
        );
      }
      await pool.end();
      options.exit(0);
      return null;
    }

    // ── The database is reachable, and is what this build expects ─────────
    //
    // Checked BEFORE listening, so a service that cannot work never accepts a
    // request. A pending migration is a refusal rather than a warning: a build
    // running against a schema it was not written for fails later, on a
    // student's case, naming a column instead of naming the deploy step.
    for (const directory of MIGRATION_SETS) {
      const pending = await pendingMigrations(pool, directory);
      if (pending.length > 0) {
        throw new Error(
          `the conversation database has ${String(pending.length)} pending migration(s): ` +
            `${pending.join(", ")}. Run "aas-conversation-service migrate" first.`,
        );
      }
    }

    const store = conversationStore(pool);
    const secureRequests = httpSecureRequestOpener({
      baseUrl: config.secureInternalUrl,
      serviceToken: config.secureServiceToken,
    });
    const identities = new StudentIdentityStore(pool);
    // Resolved ONCE and shared: the driver executes against it and the offer
    // path lists from it, so a target a student can be offered and a target a
    // run can execute are the same set by construction (ADR-0041).
    const catalogue = await resolveCatalogue({
      source: config.catalogue,
      ...(config.catalogueDir === undefined ? {} : { directory: config.catalogueDir }),
      portalOrigins: config.portalOrigins,
    });
    const driver = buildRunDriver(
      {
        pool,
        catalogue,
        secureRequests,
        identities,
        // eslint-disable-next-line no-restricted-syntax -- composition root: an entry point is where the real clock is made
        now: () => new Date(),
      },
      store,
    );

    // ── The provider, reached at STARTUP ─────────────────────────────────
    //
    // Its discovery document is fetched here, so a provider that cannot be
    // reached is a process that refuses to start rather than a student meeting
    // a 500 on the sign-in button (ADR-0055). Every endpoint comes from that
    // document; nothing in this repository writes a Cognito URL down.
    const auth =
      config.oidc === undefined
        ? undefined
        : {
            adapter: await discoverAdapter({
              issuer: config.oidc.issuer,
              clientId: config.oidc.clientId,
              clientSecret: config.oidc.clientSecret,
              redirectUri: config.oidc.redirectUri,
              allowInsecureHttp: config.oidc.allowInsecureHttp,
            }),
            sessionSecret: config.sessionSecret,
            resolve: async (claims: Parameters<StudentIdentityStore["resolve"]>[0]) =>
              await identities.resolve(claims),
            // eslint-disable-next-line no-restricted-syntax -- composition root: an entry point is where the real clock is made
            now: (): Date => new Date(),
            onFailure: (reason: string): void => {
              // A WORD, never the error: a failed exchange can carry a
              // provider error body, and this line reaches the log.
              options.log(`sign-in failed: ${reason}`);
            },
          };

    const app = createConversationApp({
      store,
      sessionSecret: config.sessionSecret,
      // The conversation belongs to the student who owns it. One query, and the
      // database is the authority — not a claim in a cookie.
      authorise: async (studentId, conversationId) => {
        const owned = await pool.query(
          "SELECT 1 FROM conversations WHERE id = $1 AND student_id = $2",
          [conversationId, studentId],
        );
        return owned.rowCount === 1;
      },
      // Gate 1 (ADR-0058): the SAME catalogue the driver executes against, so
      // "what a student may be offered" and "what a run may execute" cannot
      // diverge.
      targets: catalogue,
      // Two certificates, each for its own endpoints (ADR-0037, ADR-0045).
      // Written as one predicate because the per-endpoint split belongs to the
      // deployment's mesh policy rather than to this app.
      authoriseService: (req) => {
        const presented = req.header("x-service-cert");
        return presented === config.serviceCertSecure || presented === config.serviceCertRunner;
      },
      // eslint-disable-next-line no-restricted-syntax -- composition root: an entry point is where the real clock is made
      now: () => new Date(),
      runs: driver,
      secureRequests,
      secureOrigin: config.secureOrigin,
      ...(auth === undefined ? {} : { auth }),
      ...(config.publicDir === undefined ? {} : { publicDir: config.publicDir }),
      // PROVISIONAL and refused in production by `conversationConfigFrom`.
      ...(config.devSession
        ? { issueSessionFor: (req: { body?: unknown }): string | null => {
            const body = req.body as { subject?: unknown } | undefined;
            return typeof body?.subject === "string" ? body.subject : null;
          } }
        : {}),
    });

    const server: Server = await new Promise((resolve) => {
      const listening = app.listen(config.port, () => resolve(listening));
    });
    options.log(
      `conversation service listening on ${String(config.port)} ` +
        `(catalogue=${config.catalogue}, dev-session=${String(config.devSession)}, ` +
        `identity=${config.oidc === undefined ? "none" : "oidc"})`,
    );

    const close = async (): Promise<void> => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await pool.end();
    };
    return { config, port: config.port, close };
  } catch (error) {
    await pool.end().catch(() => undefined);
    throw error;
  }
}

/** The real process. Separated from `start` so a test can drive one without the other. */
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
