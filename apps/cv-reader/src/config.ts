/**
 * What the CV reader is told, and what it refuses to be told.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ADR-0092 as amended by ADR-0148 §9: a process that fetches a student's
 * document does so through a short-lived pre-signed GET after the gates,
 * holds no key, and is named in that ADR. The runner was the first; this is
 * the second. So, like the runner, it has no database URL, no KMS key and no
 * vault library — and setting one is a startup failure with a reason, rather
 * than a variable that sits in a deployment doing nothing until somebody
 * wires it up.
 *
 * It DOES hold a model client: reading is what it is for. The model is the
 * one ADR-0018 names, through the same configuration the demos use, and in
 * production the stand-in is refused — a reader that read every CV with a
 * fixed script would seed every interview with nothing, silently.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { readConfig, type Reader } from "@askimate/aas-config";
import { isBedrockConfigured, MODEL_WORKLOADS, WORKLOAD_ENV_VARS } from "@askimate/aas-llm";

export interface ReaderConfig {
  readonly conversationInternalUrl: string;
  readonly serviceToken: string;
  readonly holder: string;
  /** `bedrock` reads through the model ADR-0018 names; `stand-in` is the deterministic client, refused in production. */
  readonly model: "bedrock" | "stand-in";
  readonly idleIntervalMs: number | undefined;
  readonly busyIntervalMs: number | undefined;
  readonly leaseSeconds: number | undefined;
  readonly production: boolean;
}

export function readerConfigFrom(env: Readonly<Record<string, string | undefined>>): ReaderConfig {
  return readConfig(env, (r: Reader): ReaderConfig => {
    for (const forbidden of [
      "AAS_CONVERSATION_DATABASE_URL",
      "AAS_SECURE_DATABASE_URL",
      "AAS_SECURE_KMS_KEY_ID",
      "AAS_ENVELOPE_CACHE_URL",
      "AAS_DOCUMENT_BUCKET",
    ]) {
      if (env[forbidden] !== undefined) {
        r.refuse(
          forbidden,
          "must not be set on the CV reader. This process fetches one document at a time through " +
            "a URL the plane minted, reads it, and forgets it; it has no database and no vault by " +
            "design (ADR-0092, ADR-0148 §9).",
        );
      }
    }

    const model = env["AAS_READER_MODEL"]?.trim() === "stand-in" ? "stand-in" : "bedrock";
    const production = env["NODE_ENV"] === "production";
    if (model === "stand-in" && production) {
      r.refuse("AAS_READER_MODEL", "the deterministic stand-in reads a fixed script, not a CV; it is refused in production.");
    }
    if (model === "bedrock" && !isBedrockConfigured(env)) {
      const missing = MODEL_WORKLOADS.map((workload) => WORKLOAD_ENV_VARS[workload]).filter((variable) => (env[variable] ?? "").trim().length === 0);
      r.refuse(
        missing[0] ?? WORKLOAD_ENV_VARS.document_extraction,
        `the reader reads through Bedrock and these are unset: ${missing.join(", ")}. Run "pnpm run verify-bedrock", or set AAS_READER_MODEL=stand-in outside production.`,
      );
    }

    return {
      conversationInternalUrl: r.url("AAS_CONVERSATION_INTERNAL_URL", { httpsInProduction: true }),
      serviceToken: r.string("AAS_READER_SERVICE_TOKEN"),
      holder: r.string("AAS_READER_HOLDER"),
      model,
      idleIntervalMs: r.optionalInt("AAS_READER_IDLE_MS", 0, { min: 10 }) || undefined,
      busyIntervalMs: r.optionalInt("AAS_READER_BUSY_MS", 0, { min: 10 }) || undefined,
      leaseSeconds: r.optionalInt("AAS_READER_LEASE_SECONDS", 0, { min: 10 }) || undefined,
      production,
    };
  });
}
