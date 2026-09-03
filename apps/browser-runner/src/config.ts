/**
 * What the Automation Runner must be told before it may start.
 *
 * ADR-0055. Two absences here are the architecture rather than an oversight:
 *
 *   **No database URL, of any plane.** `check-boundaries.ts` forbids this app
 *   the case store in its manifest AND its source, because browser automation
 *   executes untrusted page content (brief §8). A connection string in the
 *   environment is how that would come back.
 *
 *   **No secret, credential or vault configuration.** ADR-0042 spends the
 *   credential inside the Secure Plane; this process asks the fill agent to
 *   type it and never holds it. `AAS_AGENT_INTERNAL_URL` is where it asks.
 */

import { readConfig, type Reader } from "@askimate/aas-config";

export interface RunnerConfig {
  readonly conversationInternalUrl: string;
  readonly serviceToken: string;
  readonly holder: string;
  readonly agentInternalUrl: string;
  readonly agentServiceToken: string;
  readonly browserCdpUrl: string;
  readonly chromiumPath: string | undefined;
  readonly idleIntervalMs: number | undefined;
  readonly busyIntervalMs: number | undefined;
  readonly leaseSeconds: number | undefined;
  readonly production: boolean;
}

export function runnerConfigFrom(env: Readonly<Record<string, string | undefined>>): RunnerConfig {
  return readConfig(env, (r: Reader): RunnerConfig => {
    // Named explicitly so that setting one is a startup failure with a reason,
    // rather than a variable that sits in a deployment doing nothing until
    // somebody wires it up "because it was already there".
    for (const forbidden of [
      "AAS_CONVERSATION_DATABASE_URL",
      "AAS_SECURE_DATABASE_URL",
      "AAS_SECURE_KMS_KEY_ID",
      "AAS_ENVELOPE_CACHE_URL",
    ]) {
      if (env[forbidden] !== undefined) {
        r.refuse(
          forbidden,
          "must not be set on the Automation Runner. This process drives a browser over " +
            "untrusted pages and has no database and no vault by design (brief §8, ADR-0042).",
        );
      }
    }

    return {
      conversationInternalUrl: r.url("AAS_CONVERSATION_INTERNAL_URL", { httpsInProduction: true }),
      serviceToken: r.string("AAS_RUNNER_SERVICE_TOKEN"),
      holder: r.string("AAS_RUNNER_HOLDER"),
      agentInternalUrl: r.url("AAS_AGENT_INTERNAL_URL", { httpsInProduction: true }),
      agentServiceToken: r.string("AAS_RUNNER_SERVICE_TOKEN_AGENT"),
      browserCdpUrl: r.string("AAS_BROWSER_CDP_URL"),
      chromiumPath: r.optionalString("AAS_CHROMIUM_PATH"),
      idleIntervalMs: r.optionalInt("AAS_RUNNER_IDLE_MS", 0, { min: 10 }) || undefined,
      busyIntervalMs: r.optionalInt("AAS_RUNNER_BUSY_MS", 0, { min: 10 }) || undefined,
      leaseSeconds: r.optionalInt("AAS_RUNNER_LEASE_SECONDS", 0, { min: 10 }) || undefined,
      production: r.production,
    };
  });
}
