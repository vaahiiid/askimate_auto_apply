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

export type CatalogueSource = "fixtures";

export interface WorkerConfig {
  readonly databaseUrl: string;
  readonly holder: string;
  readonly secureInternalUrl: string;
  readonly secureServiceToken: string;
  readonly catalogue: CatalogueSource;
  readonly advanceIntervalMs: number | undefined;
  readonly announceIntervalMs: number | undefined;
  readonly batch: number | undefined;
  readonly production: boolean;
}

export function workerConfigFrom(
  env: Readonly<Record<string, string | undefined>>,
): WorkerConfig {
  return readConfig(env, (r: Reader): WorkerConfig => {
    // One member today, so there is nothing to compare against: EVERY value
    // this accepts is a fixture set, which is the point being refused.
    const catalogue = r.choice("AAS_CATALOGUE", ["fixtures"] as const);
    if (r.production) {
      r.refuse(
        "AAS_CATALOGUE",
        "is 'fixtures', which is the gated TEST portal. There is no production catalogue " +
          "adapter yet (docs/deployables.md), and this worker acts on real runs autonomously.",
      );
    }
    return {
      databaseUrl: r.url("AAS_CONVERSATION_DATABASE_URL", { schemes: ["postgres:", "postgresql:"] }),
      holder: r.string("AAS_WORKER_HOLDER"),
      secureInternalUrl: r.url("AAS_SECURE_INTERNAL_URL", { httpsInProduction: true }),
      secureServiceToken: r.string("AAS_SECURE_SERVICE_TOKEN"),
      catalogue,
      advanceIntervalMs: r.optionalInt("AAS_WORKER_ADVANCE_MS", 0, { min: 100 }) || undefined,
      announceIntervalMs: r.optionalInt("AAS_WORKER_ANNOUNCE_MS", 0, { min: 100 }) || undefined,
      batch: r.optionalInt("AAS_WORKER_BATCH", 0, { min: 1, max: 500 }) || undefined,
      production: r.production,
    };
  });
}
