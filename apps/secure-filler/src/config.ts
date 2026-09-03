/**
 * What the Fill Agent must be told before it may start.
 *
 * ADR-0055. It holds NO DATABASE and accepts no database configuration — that
 * absence is ADR-0042's boundary, and the entry point is exactly where it would
 * be eroded by somebody adding "just a small table".
 *
 * Its cache and its KMS key must be the SAME as the Secure Service's. That is a
 * deployment fact this process cannot verify from the inside: it can only
 * refuse to run without them, and say why.
 */

import { readConfig, type Reader } from "@askimate/aas-config";

export interface FillAgentConfig {
  readonly port: number;
  readonly secureInternalUrl: string;
  readonly secureServiceToken: string;
  readonly serviceCertRunner: string;
  readonly cacheUrl: string | undefined;
  readonly kmsKeyId: string | undefined;
  readonly kmsRegion: string;
  readonly production: boolean;
}

export const DEFAULT_KMS_REGION = "eu-west-2";

export function fillAgentConfigFrom(
  env: Readonly<Record<string, string | undefined>>,
): FillAgentConfig {
  return readConfig(env, (r: Reader): FillAgentConfig => {
    const cacheUrl = r.optionalUrl("AAS_ENVELOPE_CACHE_URL", { schemes: ["redis:", "rediss:"] });
    if (cacheUrl === undefined && r.production) {
      r.refuse(
        "AAS_ENVELOPE_CACHE_URL",
        "is required in production, and must be the SAME cache the Secure Service uses. " +
          "That service PUTs the envelope and this one TAKEs it (ADR-0042); with the " +
          "in-process cache this agent would find nothing, every time.",
      );
    }
    if (cacheUrl !== undefined && r.production && !cacheUrl.startsWith("rediss://")) {
      r.refuse("AAS_ENVELOPE_CACHE_URL", "must use rediss:// in production");
    }

    const kmsKeyId = r.optionalString("AAS_SECURE_KMS_KEY_ID");
    if (kmsKeyId === undefined && r.production) {
      r.refuse(
        "AAS_SECURE_KMS_KEY_ID",
        "is required in production, and must be the SAME key the Secure Service wraps with. " +
          "A different key cannot unwrap what that service put in the cache.",
      );
    }

    return {
      port: r.int("AAS_PORT", { min: 1, max: 65_535 }),
      secureInternalUrl: r.url("AAS_SECURE_INTERNAL_URL", { httpsInProduction: true }),
      secureServiceToken: r.string("AAS_SECURE_SERVICE_TOKEN"),
      serviceCertRunner: r.string("AAS_SERVICE_CERT_RUNNER"),
      cacheUrl,
      kmsKeyId,
      kmsRegion: r.optionalString("AAS_SECURE_KMS_REGION", DEFAULT_KMS_REGION) ?? DEFAULT_KMS_REGION,
      production: r.production,
    };
  });
}
