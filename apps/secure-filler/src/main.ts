/**
 * The Fill Agent, as a process (ADR-0042, ADR-0055).
 *
 * The credential is spent INSIDE the Secure Plane: this process takes the
 * envelope from the shared cache, decrypts it locally, and types it into the
 * runner's browser over CDP. The runner never holds it.
 */

import type { Server } from "node:http";

import { chromium } from "playwright";

import { installShutdown, reportStartupFailure, type Log } from "@askimate/aas-config";
import { RedisEnvelopeCache } from "@askimate/aas-envelope-cache-redis";
import {
  EnvelopeVault,
  InMemoryEnvelopeCache,
  type DataKeyProvider,
  type EnvelopeCache,
} from "@askimate/aas-secrets";
import { keyProviderFor } from "@askimate/aas-secrets/kms";
import { SecureLogger } from "@askimate/aas-secure-logging";

import { createFillAgentApp } from "./app.js";
import { httpUseAuthoriser } from "./authorise.js";
import { fillAgentConfigFrom, type FillAgentConfig } from "./config.js";

export interface StartOptions {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly log: Log;
}

export interface RunningAgent {
  readonly config: FillAgentConfig;
  readonly close: () => Promise<void>;
}

export async function start(options: StartOptions): Promise<RunningAgent> {
  const config = fillAgentConfigFrom(options.env);

  const keys: DataKeyProvider = keyProviderFor(
    { keyId: config.kmsKeyId, region: config.kmsRegion },
    options.env["NODE_ENV"],
  );

  let cache: EnvelopeCache & { close?: () => Promise<void> };
  if (config.cacheUrl === undefined) {
    options.log(
      "WARNING: using the IN-PROCESS envelope cache. Nothing the Secure Service put " +
        "will be visible here (ADR-0042).",
    );
    cache = new InMemoryEnvelopeCache();
  } else {
    const redis = new RedisEnvelopeCache({ url: config.cacheUrl });
    await redis.verify();
    cache = redis;
  }

  const app = createFillAgentApp({
    vault: new EnvelopeVault(keys, cache),
    authorise: httpUseAuthoriser({
      baseUrl: config.secureInternalUrl,
      serviceToken: config.secureServiceToken,
    }),
    connect: (endpoint: string) => chromium.connectOverCDP(endpoint),
    // eslint-disable-next-line no-restricted-syntax -- composition root: an entry point is where the real clock is made
    now: () => new Date(),
    logger: new SecureLogger((line) => {
      options.log(line);
    }),
    authoriseService: (req) => req.header("x-aas-service") === config.serviceCertRunner,
  });

  const server: Server = await new Promise((resolve) => {
    const listening = app.listen(config.port, () => resolve(listening));
  });
  options.log(
    `fill agent listening on ${String(config.port)} ` +
      `(keys=${keys.kind}, cache=${config.cacheUrl === undefined ? "in-process" : "shared"})`,
  );

  return {
    config,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await cache.close?.();
    },
  };
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
