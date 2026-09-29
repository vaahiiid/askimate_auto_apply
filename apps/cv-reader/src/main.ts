/**
 * The CV reader, as a process (ADR-0148 §9, ADR-0092 as amended).
 *
 * It listens on nothing. Like the runner it pulls its work from the plane,
 * and a process that fetches students' documents has no inbound surface at
 * all. Liveness is the process; readiness is that it started, and it exits
 * non-zero when it cannot.
 */

import { installShutdown, reportStartupFailure, type Log } from "@askimate/aas-config";
import type { ModelClient } from "@askimate/aas-llm";
import { BedrockModelClient, DeterministicModelClient, bedrockConfigFrom } from "@askimate/aas-llm";

import { readerConfigFrom, type ReaderConfig } from "./config.js";
import { httpReadingIntake } from "./intake.js";
import { readDocument } from "./read.js";
import { startReaderSupervisor } from "./supervisor.js";

export interface StartOptions {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly log: Log;
  /** Injected so a test can stand in for the plane and the bucket. */
  readonly fetch?: typeof globalThis.fetch;
}

export interface RunningReader {
  readonly config: ReaderConfig;
  readonly close: () => Promise<void>;
}

function modelFor(config: ReaderConfig, env: Readonly<Record<string, string | undefined>>): ModelClient {
  if (config.model === "stand-in") return new DeterministicModelClient();
  return new BedrockModelClient({ config: bedrockConfigFrom(env) });
}

export function start(options: StartOptions): Promise<RunningReader> {
  const config = readerConfigFrom(options.env);
  const model = modelFor(config, options.env);
  const intake = httpReadingIntake({
    baseUrl: config.conversationInternalUrl,
    holder: config.holder,
    serviceToken: config.serviceToken,
    ...(config.leaseSeconds === undefined ? {} : { leaseSeconds: config.leaseSeconds }),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });

  const supervisor = startReaderSupervisor({
    intake,
    perform: (claim) => readDocument({ claim, model, ...(options.fetch === undefined ? {} : { fetch: options.fetch }) }),
    ...(config.idleIntervalMs === undefined ? {} : { idleIntervalMs: config.idleIntervalMs }),
    ...(config.busyIntervalMs === undefined ? {} : { busyIntervalMs: config.busyIntervalMs }),
    holdProcess: true,
    onTurn: (result) => {
      // The outcome in the contract's closed words, and counts. Never a
      // value, never a span: this process has just read a student's CV.
      if (result.kind === "idle") return;
      if (result.kind === "report_refused") {
        options.log(`reading ${result.documentId}: report refused — the lease lapsed`);
        return;
      }
      const { report } = result;
      options.log(
        report.outcome === "read"
          ? `reading ${result.documentId}: read — ${(report.lists ?? []).map((list) => `${list.fieldKey} ${String(list.entries.length)} entries, ${String(list.dropped)} dropped`).join("; ")}` +
              (report.usage === undefined ? "" : ` (${String(report.usage.calls)} calls)`)
          : `reading ${result.documentId}: failed — ${report.failure ?? "reader_fault"}`,
      );
    },
  });

  options.log(
    `cv reader ${config.holder} polling ${config.conversationInternalUrl} — model: ${
      model instanceof BedrockModelClient ? `${model.destination.service} at ${model.destination.baseURL}` : "the deterministic stand-in (not for production)"
    }`,
  );

  return Promise.resolve({
    config,
    close: async () => {
      // Waits for the turn in flight: a reading half-reported is a lease
      // that lapses and a document read twice, which costs money and nothing
      // else — but there is no reason to pay it.
      await supervisor.stop();
    },
  });
}

export async function main(): Promise<void> {
  const log: Log = (line) => {
    process.stdout.write(`${line}\n`);
  };
  try {
    const running = await start({ env: process.env, log });
    installShutdown({ log, close: running.close, graceMs: 30_000 });
  } catch (error) {
    reportStartupFailure(error, (line) => {
      process.stderr.write(`${line}\n`);
    });
    process.exit(1);
  }
}
