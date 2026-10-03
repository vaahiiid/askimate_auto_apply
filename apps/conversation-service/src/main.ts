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

import { SERVICE_CERTIFICATE_HEADER } from "@askimate/aas-contracts";
import type { Server } from "node:http";

import pg from "pg";

import { installShutdown, reportStartupFailure, type Log } from "@askimate/aas-config";
import { migrateExclusive, pendingMigrations } from "@askimate/aas-migrate";
import { MIGRATIONS_DIR as CASE_MIGRATIONS } from "@askimate/aas-case-store";
import type { StoredIntervention } from "@askimate/aas-case-store/interventions";

import { discoverAdapter } from "@askimate/aas-oidc";

import { createConversationApp } from "./app.js";
import { conversationConfigFrom, type ConversationConfig } from "./config.js";
import { MIGRATIONS_DIR } from "./index.js";
import { StudentIdentityStore } from "./identity-store.js";
import { httpSecureRequestOpener } from "./secure-requests.js";
import { buildDocumentPort, buildRunDriver, conversationStore, loadGoverningSchedule, resolveCatalogue } from "./wiring.js";
import { WorkerLeaseStore } from "./worker-leases.js";
import type { RetentionSchedule } from "@askimate/aas-domain";

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
    // ── The document transport, if configured (ADR-0092, ADR-0094) ─────
    //
    // Built here, at the composition root, and REFUSED here if any part of
    // it is in memory: intakes and records in this database, bytes in the
    // bucket. Absent, the document routes answer service_unavailable — a
    // refusal, not a bypass.
    const documents =
      config.documents === undefined
        ? undefined
        : await buildDocumentPort({
            pool,
            bucket: config.documents.bucket,
            kmsKeyArn: config.documents.kmsKeyArn,
            region: config.documents.region,
            retentionScheduleDir: config.documents.retentionScheduleDir,
            environment: options.env["NODE_ENV"],
            // eslint-disable-next-line no-restricted-syntax -- composition root: an entry point is where the real clock is made
            now: () => new Date(),
          });

    const driver = buildRunDriver(
      {
        pool,
        catalogue,
        secureRequests,
        identities,
        // ADR-0099: the driver hands a runner a document only through the
        // transport's own register and vault. Absent, it refuses.
        ...(documents === undefined ? {} : { disclosure: { register: documents.register, vault: documents.vault } }),
        // eslint-disable-next-line no-restricted-syntax -- composition root: an entry point is where the real clock is made
        now: () => new Date(),
      },
      store,
    );

    // ── The repair, as a subcommand of the service that owns the driver ───
    //
    // ADR-0126. Here rather than in a script of its own, because the repair
    // needs the SAME driver the service runs — the same catalogue, the same
    // stores, the same guard. A separate script would be a second composition
    // root, and a second composition root is a second set of rules about which
    // catalogue a case is judged against (ADR-0041).
    //
    // Above the provider block deliberately: a stopped case can be finished
    // without an identity provider being reachable, and an operator repairing
    // a case should not be blocked by something no part of the repair uses.
    if (options.argv[0] === "finish-stopped") {
      const conversationId = options.argv[1];
      if (conversationId === undefined) {
        options.log("finish-stopped: give the CONVERSATION id of the stopped case");
        await pool.end();
        options.exit(2);
        return null;
      }
      const outcome = await driver.finishStoppedCase(conversationId);
      if (!outcome.ok) {
        options.log(
          outcome.reason === "not_stopped"
            ? `finish-stopped: ${conversationId} is at ${outcome.state}, not stopped. ` +
              `Nothing was done — this repair acts on WINDING_DOWN and nothing else.`
            : `finish-stopped: ${conversationId} — ${outcome.reason}. Nothing was done.`,
        );
      } else if (outcome.concluded) {
        options.log(`finish-stopped: ${conversationId} is CONCLUDED. The case is closed.`);
      } else {
        options.log(
          `finish-stopped: ${conversationId} is NOT concluded, and that is the guard ` +
            `working. Still owed: ${outcome.outstanding.join("; ")}. Finish the handover ` +
            `and run this again.`,
        );
      }
      await pool.end();
      options.exit(outcome.ok && outcome.concluded ? 0 : 1);
      return null;
    }

    // ── The second repair, and the same shape as the first ───────────────
    //
    // Blocker 48. A run held by a person with no intervention behind it is
    // invisible: no queue shows it and no poll reaches it. This raises the
    // one that was swallowed, through the driver's own pause path — see
    // `raiseMissingIntervention`, which refuses everything else.
    if (options.argv[0] === "raise-missing") {
      const conversationId = options.argv[1];
      if (conversationId === undefined) {
        options.log("raise-missing: give the CONVERSATION id of the stopped run");
        await pool.end();
        options.exit(2);
        return null;
      }
      const outcome = await driver.raiseMissingIntervention(conversationId);
      if (outcome.ok) {
        options.log(
          `raise-missing: raised ${outcome.interventionId} for "${outcome.action}" on ` +
            `${outcome.target}. It is in the specialist listing now, and the student has ` +
            `been told. Resolve it the way you would any other.`,
        );
      } else if (outcome.reason === "already_open") {
        options.log(
          `raise-missing: ${conversationId} already has an open intervention ` +
            `(${outcome.interventionId}). Nothing was done — a person can see this one.`,
        );
      } else if (outcome.reason === "not_held") {
        options.log(
          `raise-missing: ${conversationId} is at ${outcome.status ?? "no run"}, not held by ` +
            `a person. Nothing was done — this repair acts on uncertain and escalated only.`,
        );
      } else if (outcome.reason === "nothing_unfinished") {
        options.log(
          `raise-missing: ${conversationId} has no unfinished action in the ledger, so ` +
            `there is nothing to raise an intervention ABOUT. Nothing was done: the run is ` +
            `held for some other reason, and inventing a fault to explain it would be worse ` +
            `than leaving it.`,
        );
      } else {
        options.log(`raise-missing: ${conversationId} — ${outcome.reason}. Nothing was done.`);
      }
      await pool.end();
      options.exit(outcome.ok ? 0 : 1);
      return null;
    }

    // ── The third repair: the words a proposal lost (P263) ───────────────
    if (options.argv[0] === "say-again") {
      const conversationId = options.argv[1];
      if (conversationId === undefined) {
        options.log("say-again: give the CONVERSATION id whose confirmation shows buttons over nothing");
        await pool.end();
        options.exit(2);
        return null;
      }
      const outcome = await driver.sayAgain(conversationId);
      if (outcome.ok) {
        options.log(
          `say-again: said the playback for ${outcome.fieldKey} in ${String(outcome.messages)} message(s), ` +
            `and put a fresh proposal bound to those words. The page shows them now; the buttons are the same.`,
        );
      } else if (outcome.reason === "words_present") {
        options.log(`say-again: ${conversationId}'s open proposal already has its words. Nothing was done.`);
      } else if (outcome.reason === "nothing_open") {
        options.log(`say-again: ${conversationId} has no open proposal. Nothing was done.`);
      } else {
        options.log(`say-again: ${conversationId} — ${outcome.reason}. Nothing was done.`);
      }
      await pool.end();
      options.exit(outcome.ok ? 0 : 1);
      return null;
    }

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
        const presented = req.header(SERVICE_CERTIFICATE_HEADER);
        return (
          presented === config.serviceCertSecure ||
          presented === config.serviceCertRunner ||
          (config.serviceCertReader !== undefined && presented === config.serviceCertReader)
        );
      },
      // eslint-disable-next-line no-restricted-syntax -- composition root: an entry point is where the real clock is made
      now: () => new Date(),
      runs: driver,
      secureRequests,
      secureOrigin: config.secureOrigin,
      ...(auth === undefined ? {} : { auth }),
      ...(documents === undefined ? {} : { documents }),
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
        `identity=${config.oidc === undefined ? "none" : "oidc"}, ` +
        `documents=${config.documents === undefined ? "none" : "s3"})`,
    );
    // eslint-disable-next-line no-restricted-syntax -- composition root: an entry point is where the real clock is made
    await sayWhatHasWaited(driver, options.log, new Date());
    const sweeper =
      config.documents === undefined
        ? (options.log("retention sweep: off — no document store, so there is nothing to delete"), undefined)
        : await startRetentionSweep({
            driver,
            leases: new WorkerLeaseStore(pool),
            // eslint-disable-next-line no-restricted-syntax -- composition root: an entry point is where the real clock is made
            schedule: await loadGoverningSchedule(config.documents.retentionScheduleDir, new Date()),
            log: options.log,
            // eslint-disable-next-line no-restricted-syntax -- composition root: an entry point is where the real clock is made
            now: () => new Date(),
          });

    const close = async (): Promise<void> => {
      await sweeper?.stop();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await pool.end();
    };
    return { config, port: config.port, close };
  } catch (error) {
    await pool.end().catch(() => undefined);
    throw error;
  }
}

/**
 * The retention sweep (P274, row 128): once at the start, then hourly, under
 * the `sweep_retention` lease so two instances of the service cannot both
 * delete a document and both tell its student.
 *
 * It says what it did at the start — how many it deleted, or that it could not
 * run and why — and afterwards only when it deleted something or failed: an
 * hourly line that says nothing happened is noise, but the start line must say
 * the sweep is there, because a sweep that reports nothing is indistinguishable
 * from a sweep that does not run.
 */
async function startRetentionSweep(input: {
  readonly driver: { sweepRetention(input: { readonly schedule: RetentionSchedule; readonly batch: number }): Promise<{ readonly purged: readonly string[] }> };
  readonly leases: WorkerLeaseStore;
  readonly schedule: RetentionSchedule;
  readonly log: Log;
  readonly now: () => Date;
}): Promise<{ readonly stop: () => Promise<void> }> {
  const holder = `conversation-service-${String(process.pid)}`;
  let holding: string | undefined;
  const once = async (): Promise<number | null> => {
    const lease = await input.leases.claim({ job: "sweep_retention", holder, now: input.now(), leaseSeconds: 300, ...(holding === undefined ? {} : { holding }) });
    if (lease === null) return null;
    holding = lease.leaseId;
    return (await input.driver.sweepRetention({ schedule: input.schedule, batch: 100 })).purged.length;
  };
  try {
    const purged = await once();
    input.log(purged === null ? "retention sweep: hourly; another instance holds it now" : `retention sweep: hourly; ${String(purged)} deleted on start`);
  } catch (error) {
    input.log(`retention sweep: hourly; could not run on start — ${error instanceof Error ? error.message : String(error)}`);
  }
  const timer = setInterval(() => {
    once()
      .then((purged) => {
        if (purged !== null && purged > 0) input.log(`retention sweep: ${String(purged)} deleted`);
      })
      .catch((error: unknown) => {
        input.log(`retention sweep: could not run — ${error instanceof Error ? error.message : String(error)}`);
      });
  }, 60 * 60 * 1000);
  timer.unref();
  return {
    stop: async () => {
      clearInterval(timer);
      if (holding !== undefined) await input.leases.release("sweep_retention", holding).catch(() => undefined);
    },
  };
}

/**
 * Names, at the start, every open intervention older than a day — with its age
 * (P260, row 113).
 *
 * Vahid, on two stops from 18 September that were open twelve days before
 * anyone noticed: *"the service's start line names every open intervention
 * older than a day with its age. Not a second notice — a notice nobody reads
 * twice is noise, and the start line is the thing I see every time I bring
 * the stack up."* ADR-0071 tells a specialist once, when the stop is raised;
 * the listing carries `raisedAt`; nothing read the age back.
 *
 * Three outcomes, each with its own line, because a line that prints nothing
 * when nothing is wrong prints nothing when something is: the aged ones named
 * one per line; `none`; or that the reading failed, with why. No value of the
 * student's is on any of them — an id, a run, a reference, a reason, an
 * action and its target, and the age.
 */
async function sayWhatHasWaited(
  driver: { openInterventions(): Promise<readonly StoredIntervention[]> },
  log: Log,
  now: Date,
): Promise<void> {
  const aDay = 24 * 60 * 60 * 1000;
  try {
    const aged = (await driver.openInterventions()).filter(
      (held) => now.getTime() - held.escalation.raisedAt.getTime() >= aDay,
    );
    if (aged.length === 0) {
      log("open interventions older than a day: none");
      return;
    }
    for (const held of aged) {
      const days = Math.floor((now.getTime() - held.escalation.raisedAt.getTime()) / aDay);
      const { checkpoint } = held.escalation;
      log(
        `open intervention ${held.interventionId} on run ${held.runId} (student ${held.studentRef}): ` +
          `${held.escalation.reason}, ${held.escalation.priority} — ${checkpoint.action} on ${checkpoint.target}, ` +
          `raised ${String(days)} day${days === 1 ? "" : "s"} ago, unresolved`,
      );
    }
  } catch (error) {
    log(`open interventions older than a day: could not be read — ${error instanceof Error ? error.message : String(error)}`);
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
