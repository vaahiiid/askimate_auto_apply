/**
 * What the Conversation Service must be told before it may start.
 *
 * ADR-0055. Every value here used to be a constructor argument supplied by a
 * test, which is why this deployable existed and no person could start it.
 *
 * ── The two rules that only apply in production ───────────────────────────
 *
 * Both are development conveniences that would be dangerous if they survived a
 * deploy, and both are refused by CONFIGURATION rather than by a comment:
 *
 *   `AAS_DEV_SESSION`  mounts a route that mints a session for any subject it
 *                      is handed. In production that is an authentication
 *                      bypass, and ADR-0038 says identity comes from a managed
 *                      OIDC provider — which is not built yet, so a production
 *                      Conversation Service has no way to sign a student in and
 *                      MUST NOT pretend otherwise.
 *
 *   `AAS_CATALOGUE`    `fixtures` serves the gated test portal. There is no
 *                      production catalogue adapter yet (see
 *                      `docs/deployables.md`), so this refuses rather than
 *                      quietly serving a fixture to a real student.
 */

import { readConfig, type Reader } from "@askimate/aas-config";

export type CatalogueSource = "fixtures";

export interface ConversationConfig {
  readonly port: number;
  readonly databaseUrl: string;
  readonly sessionSecret: string;
  readonly secureOrigin: string;
  readonly secureInternalUrl: string;
  readonly secureServiceToken: string;
  readonly serviceCertSecure: string;
  readonly serviceCertRunner: string;
  readonly catalogue: CatalogueSource;
  readonly publicDir: string | undefined;
  readonly devSession: boolean;
  readonly production: boolean;
}

/**
 * A session secret shorter than this is not a secret.
 *
 * Thirty-two characters is the HMAC's own output width in hex terms; a shorter
 * key is the weakest part of a signature that guards every conversation.
 */
export const MIN_SESSION_SECRET = 32;

export function conversationConfigFrom(
  env: Readonly<Record<string, string | undefined>>,
): ConversationConfig {
  return readConfig(env, (r: Reader): ConversationConfig => {
    const devSession = r.flag("AAS_DEV_SESSION");
    if (devSession && r.production) {
      r.refuse(
        "AAS_DEV_SESSION",
        "mints a session for any subject and must never be set in production. " +
          "ADR-0038 delegates identity to a managed OIDC provider, which is not built yet — " +
          "so there is no way to sign a student in, and this service must say so rather " +
          "than start with a bypass mounted.",
      );
    }

    // One member today, so there is nothing to compare against: EVERY value
    // this accepts is a fixture set, which is the point being refused.
    const catalogue = r.choice("AAS_CATALOGUE", ["fixtures"] as const);
    if (r.production) {
      r.refuse(
        "AAS_CATALOGUE",
        "is 'fixtures', which serves the gated TEST portal. There is no production " +
          "catalogue adapter yet (docs/deployables.md), so a production start would offer a " +
          "real student a fixture.",
      );
    }

    return {
      port: r.int("AAS_PORT", { min: 1, max: 65_535 }),
      databaseUrl: r.url("AAS_CONVERSATION_DATABASE_URL", { schemes: ["postgres:", "postgresql:"] }),
      sessionSecret: r.string("AAS_SESSION_SECRET", { minLength: MIN_SESSION_SECRET }),
      secureOrigin: r.url("AAS_SECURE_ORIGIN", { httpsInProduction: true }),
      secureInternalUrl: r.url("AAS_SECURE_INTERNAL_URL", { httpsInProduction: true }),
      secureServiceToken: r.string("AAS_SECURE_SERVICE_TOKEN"),
      serviceCertSecure: r.string("AAS_SERVICE_CERT_SECURE"),
      serviceCertRunner: r.string("AAS_SERVICE_CERT_RUNNER"),
      catalogue,
      publicDir: r.optionalString("AAS_PUBLIC_DIR"),
      devSession,
      production: r.production,
    };
  });
}
