/**
 * What the Secure Interaction Service must be told before it may start.
 *
 * ADR-0055. This is the process that receives a student's password, so two of
 * its rules are not conveniences:
 *
 *   **The key provider.** `assertVaultIsProductionGrade` has existed since
 *   ADR-0034 and had NO production caller — `secure-plane-deployment.md` called
 *   it the difference between advice and a control, and there was no process
 *   for it to stop. There is now.
 *
 *   **The cache.** ADR-0042 makes the Secure Service and the Fill Agent
 *   different deployables that must share it. With the in-process cache they
 *   share nothing and every handle resolves to nothing, so a production start
 *   without `AAS_ENVELOPE_CACHE_URL` is refused.
 */

import { readConfig, type Reader } from "@askimate/aas-config";

export interface SecureConfig {
  readonly port: number;
  readonly databaseUrl: string;
  readonly selfOrigin: string;
  readonly parentOrigin: string;
  readonly conversationInternalUrl: string;
  readonly conversationServiceToken: string;
  readonly serviceCertConversation: string;
  readonly serviceCertAgent: string;
  readonly cacheUrl: string | undefined;
  readonly kmsKeyId: string | undefined;
  readonly kmsRegion: string;
  readonly assetDir: string | undefined;
  readonly production: boolean;
}

/** ADR-0012 — eu-west-2 (London), unless a deployment states otherwise. */
export const DEFAULT_KMS_REGION = "eu-west-2";

export function secureConfigFrom(
  env: Readonly<Record<string, string | undefined>>,
): SecureConfig {
  return readConfig(env, (r: Reader): SecureConfig => {
    const cacheUrl = r.optionalUrl("AAS_ENVELOPE_CACHE_URL", {
      schemes: ["redis:", "rediss:"],
    });
    if (cacheUrl === undefined && r.production) {
      r.refuse(
        "AAS_ENVELOPE_CACHE_URL",
        "is required in production. This service PUTs an envelope and the fill agent TAKEs " +
          "it, and they are different processes (ADR-0042) — with the in-process cache they " +
          "share nothing and every handle resolves to nothing.",
      );
    }
    if (cacheUrl !== undefined && r.production && !cacheUrl.startsWith("rediss://")) {
      r.refuse(
        "AAS_ENVELOPE_CACHE_URL",
        "must use rediss:// in production. The envelope is ciphertext, but the connection " +
          "still carries handles and is on a network this service does not own.",
      );
    }

    const kmsKeyId = r.optionalString("AAS_SECURE_KMS_KEY_ID");
    if (kmsKeyId === undefined && r.production) {
      // Belt and braces with `assertVaultIsProductionGrade`, which throws at
      // startup for the same reason. Refusing here as well means an operator
      // learns it alongside everything else that is wrong, in one message,
      // rather than one variable at a time.
      r.refuse(
        "AAS_SECURE_KMS_KEY_ID",
        "is required in production. Without it the vault falls back to a local master key " +
          "held in this process, and one host compromise yields every ciphertext (ADR-0034).",
      );
    }

    return {
      port: r.int("AAS_PORT", { min: 1, max: 65_535 }),
      databaseUrl: r.url("AAS_SECURE_DATABASE_URL", { schemes: ["postgres:", "postgresql:"] }),
      selfOrigin: r.url("AAS_SECURE_SELF_ORIGIN", { httpsInProduction: true }),
      parentOrigin: r.url("AAS_CONVERSATION_ORIGIN", { httpsInProduction: true }),
      conversationInternalUrl: r.url("AAS_CONVERSATION_INTERNAL_URL", { httpsInProduction: true }),
      conversationServiceToken: r.string("AAS_CONVERSATION_SERVICE_TOKEN"),
      serviceCertConversation: r.string("AAS_SERVICE_CERT_CONVERSATION"),
      serviceCertAgent: r.string("AAS_SERVICE_CERT_AGENT"),
      cacheUrl,
      kmsKeyId,
      kmsRegion: r.optionalString("AAS_SECURE_KMS_REGION", DEFAULT_KMS_REGION) ?? DEFAULT_KMS_REGION,
      assetDir: r.optionalString("AAS_SECURE_ASSET_DIR"),
      production: r.production,
    };
  });
}
