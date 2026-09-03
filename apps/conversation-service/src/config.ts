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
 *   `AAS_CATALOGUE`    `fixtures` serves the gated TEST portal and is refused in
 *                      production. `registry` loads reviewed entries from
 *                      `AAS_CATALOGUE_DIR`, and serves only those an approval
 *                      registry independently vouches for (ADR-0057).
 *
 *   `AAS_CATALOGUE_DIR`      required by `registry`. Holds `approvals.json` and
 *                            `entries/*.json`.
 *   `AAS_PORTAL_ORIGINS`     optional `blueprintId=origin` pairs, comma
 *                            separated. A DEPLOYMENT fact — which instance of a
 *                            portal to run against — deliberately outside the
 *                            reviewed artefact and outside its hash, so the
 *                            same approved entry runs against a university's
 *                            UAT environment without being rewritten.
 */

import { readConfig, type Reader } from "@askimate/aas-config";
import { readCatalogueConfig, type CatalogueSource } from "@askimate/aas-catalogue";

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
  /** Where reviewed entries and their approvals live. Required by `registry`. */
  readonly catalogueDir?: string;
  /** `blueprintId` → the deployment origin to run it against. Not reviewed data. */
  readonly portalOrigins: Readonly<Record<string, string>>;
  /** ADR-0038's provider. Absent means this deployment has no way to sign in. */
  readonly oidc:
    | {
        readonly issuer: string;
        readonly clientId: string;
        readonly clientSecret: string;
        readonly redirectUri: string;
        readonly allowInsecureHttp: boolean;
      }
    | undefined;
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

    const catalogueConfig = readCatalogueConfig(r);

    // ── Identity (ADR-0038) ────────────────────────────────────────────
    //
    // All four together or none: a half-configured provider is a login button
    // that fails at the redirect rather than at startup. `issuer` is the only
    // one that names Cognito, and only because a Cognito issuer URL contains
    // the pool id — every endpoint is read from its discovery document.
    const issuer = r.optionalUrl("AAS_OIDC_ISSUER", { httpsInProduction: true });
    const clientId = r.optionalString("AAS_OIDC_CLIENT_ID");
    const clientSecret = r.optionalString("AAS_OIDC_CLIENT_SECRET");
    const redirectUri = r.optionalUrl("AAS_OIDC_REDIRECT_URI", { httpsInProduction: true });
    const allowInsecureHttp = r.flag("AAS_OIDC_ALLOW_INSECURE_HTTP");
    const supplied = [issuer, clientId, clientSecret, redirectUri].filter(
      (value) => value !== undefined,
    ).length;
    if (supplied > 0 && supplied < 4) {
      r.refuse(
        "AAS_OIDC_ISSUER",
        "identity needs AAS_OIDC_ISSUER, AAS_OIDC_CLIENT_ID, AAS_OIDC_CLIENT_SECRET and " +
          "AAS_OIDC_REDIRECT_URI together. A partial configuration is a sign-in button that " +
          "fails at the redirect instead of at startup.",
      );
    }
    if (supplied === 0 && r.production) {
      r.refuse(
        "AAS_OIDC_ISSUER",
        "is required in production. Without an identity provider there is no way for a student " +
          "to sign in, and AAS_DEV_SESSION is refused here (ADR-0038).",
      );
    }
    if (allowInsecureHttp && r.production) {
      r.refuse(
        "AAS_OIDC_ALLOW_INSECURE_HTTP",
        "permits an http:// issuer and must never be set in production. It exists so the " +
          "protocol tests can run against a real provider on loopback.",
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
      ...catalogueConfig,
      oidc:
        issuer !== undefined &&
        clientId !== undefined &&
        clientSecret !== undefined &&
        redirectUri !== undefined
          ? { issuer, clientId, clientSecret, redirectUri, allowInsecureHttp }
          : undefined,
      publicDir: r.optionalString("AAS_PUBLIC_DIR"),
      devSession,
      production: r.production,
    };
  });
}
