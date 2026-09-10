/**
 * What the Background Worker must be told before it may start.
 *
 * ADR-0055. One rule here is a boundary rather than a preference:
 *
 *   **It reads a CONVERSATION-plane database URL and there is no variable for a
 *   secure-plane one.** ADR-0052 §13.0 is binding — the Secure Service drains
 *   its own outbox in-process precisely so that no process holds both planes'
 *   credentials, and a worker that could be handed the secure database would be
 *   the single process whose compromise yields both.
 *
 * The absence of that variable is the enforcement. `check-boundaries.ts`
 * already forbids this app `@askimate/aas-secrets` and `@askimate/aas-secure-service`
 * in its manifest and its source; this is the same rule at the configuration
 * layer, where it would otherwise be reintroduced by a connection string.
 */

import { readConfig, type Reader } from "@askimate/aas-config";
import { readCatalogueConfig, type CatalogueConfig } from "@askimate/aas-catalogue";

export interface WorkerConfig extends CatalogueConfig {
  readonly databaseUrl: string;
  readonly holder: string;
  readonly secureInternalUrl: string;
  readonly secureServiceToken: string;
  readonly advanceIntervalMs: number | undefined;
  readonly announceIntervalMs: number | undefined;
  readonly notifyIntervalMs: number | undefined;
  readonly sweepIntervalMs: number | undefined;
  /**
   * Where a stopped run is announced to a person who can unstick it (ADR-0071).
   *
   * Optional, and its absence means the notify job does not run — a deployment
   * with no destination behaves exactly as every deployment did before P36.
   * That is a CHOICE now rather than the only possibility, and an operator who
   * has not made it can see so: the worker says on startup whether it is
   * notifying.
   *
   * Validated as a URL here and again by `WebhookNotifier`, which additionally
   * refuses a non-loopback `http:` destination. Both at startup, so a bad
   * destination stops the process rather than failing on the first stopped run.
   */
  readonly specialistWebhookUrl: string | undefined;
  readonly batch: number | undefined;
  readonly production: boolean;
}

export function workerConfigFrom(
  env: Readonly<Record<string, string | undefined>>,
): WorkerConfig {
  return readConfig(env, (r: Reader): WorkerConfig => {
    // Read by the SHARED reader, so this worker and the Conversation Service
    // cannot hold two opinions about which artefacts exist (ADR-0041).
    const catalogueConfig = readCatalogueConfig(r);
    return {
      databaseUrl: r.url("AAS_CONVERSATION_DATABASE_URL", { schemes: ["postgres:", "postgresql:"] }),
      holder: r.string("AAS_WORKER_HOLDER"),
      secureInternalUrl: r.url("AAS_SECURE_INTERNAL_URL", { httpsInProduction: true }),
      secureServiceToken: r.string("AAS_SECURE_SERVICE_TOKEN"),
      ...catalogueConfig,
      advanceIntervalMs: r.optionalInt("AAS_WORKER_ADVANCE_MS", 0, { min: 100 }) || undefined,
      announceIntervalMs: r.optionalInt("AAS_WORKER_ANNOUNCE_MS", 0, { min: 100 }) || undefined,
      notifyIntervalMs: r.optionalInt("AAS_WORKER_NOTIFY_MS", 0, { min: 100 }) || undefined,
      sweepIntervalMs: r.optionalInt("AAS_WORKER_SWEEP_MS", 0, { min: 100 }) || undefined,
      specialistWebhookUrl: r.optionalUrl("AAS_SPECIALIST_WEBHOOK_URL"),
      batch: r.optionalInt("AAS_WORKER_BATCH", 0, { min: 1, max: 500 }) || undefined,
      production: r.production,
    };
  });
}
