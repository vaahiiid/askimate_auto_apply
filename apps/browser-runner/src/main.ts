/**
 * The Automation Runner, as a process (ADR-0045, ADR-0055).
 *
 * It listens on NOTHING except the CDP endpoint the fill agent dials. There is
 * no `/healthz` here, deliberately: ADR-0045 gives this process exactly one
 * inbound surface because it is *"the most likely thing in this system to be
 * compromised"*, and a health endpoint would be a second one. Liveness is the
 * process; readiness is that it started at all, and it exits non-zero when it
 * cannot.
 */

import { chromium, type Browser } from "playwright";

import { installShutdown, reportStartupFailure, type Log } from "@askimate/aas-config";

import { runnerConfigFrom, type RunnerConfig } from "./config.js";
import { createPortalAccount } from "./create-account.js";
import { startRunnerSupervisor } from "./supervisor.js";
import { httpWorkIntake } from "./work-intake.js";
import type { PerformOutcome } from "./work-intake.js";

export interface StartOptions {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly log: Log;
  /** Injected so a test can supply a browser rather than launch Chromium. */
  readonly launch?: (config: RunnerConfig) => Promise<Browser>;
}

export interface RunningRunner {
  readonly config: RunnerConfig;
  readonly close: () => Promise<void>;
}

export async function start(options: StartOptions): Promise<RunningRunner> {
  const config = runnerConfigFrom(options.env);

  const browser = await (options.launch?.(config) ??
    chromium.launch({
      ...(config.chromiumPath === undefined ? {} : { executablePath: config.chromiumPath }),
    }));

  const supervisor = startRunnerSupervisor({
    intake: httpWorkIntake({
      baseUrl: config.conversationInternalUrl,
      holder: config.holder,
      serviceToken: config.serviceToken,
      ...(config.leaseSeconds === undefined ? {} : { leaseSeconds: config.leaseSeconds }),
    }),
    perform: async (work): Promise<PerformOutcome> => {
      // Only `create_account` today. `execute` needs a fill plan to cross the
      // wire, which ADR-0046 settles and which this entry point does not
      // re-decide — a runner that guessed at a work kind it was not built for
      // would be acting on a real portal without a plan.
      if (work.kind !== "create_account") {
        return { kind: "failed", failure: "needs_the_student" };
      }
      return await createPortalAccount(work, {
        browser,
        browserEndpoint: config.browserCdpUrl,
        agentBaseUrl: config.agentInternalUrl,
        serviceToken: config.agentServiceToken,
      });
    },
    ...(config.idleIntervalMs === undefined ? {} : { idleIntervalMs: config.idleIntervalMs }),
    ...(config.busyIntervalMs === undefined ? {} : { busyIntervalMs: config.busyIntervalMs }),
    onTurn: (result) => {
      // The RESULT, never an error object. A thrown error from a browser
      // session can carry a page's text or a URL with a token in it, and this
      // is the process driving the portal.
      if (result.kind !== "idle") options.log(`turn: ${result.kind}`);
    },
  });

  options.log(`runner ${config.holder} polling ${config.conversationInternalUrl}`);

  return {
    config,
    close: async () => {
      // `stop` AWAITS the turn in flight (P16): abandoning a browser
      // mid-portal-action is the situation `assessIntent` refuses to retry.
      await supervisor.stop();
      await browser.close();
    },
  };
}

export async function main(): Promise<void> {
  const log: Log = (line) => {
    process.stdout.write(`${line}\n`);
  };
  try {
    const running = await start({ env: process.env, log });
    // A generous grace period, because `close` waits for a real browser to
    // finish typing into a real university portal.
    installShutdown({ log, close: running.close, graceMs: 60_000 });
  } catch (error) {
    reportStartupFailure(error, (line) => {
      process.stderr.write(`${line}\n`);
    });
    process.exit(1);
  }
}
