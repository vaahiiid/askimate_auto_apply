/**
 * Authorization Code with PKCE, and the four things a provider can say about
 * an email address.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ADR-0038 decides the protocol: Authorization Code + PKCE, no implicit flow,
 * no ROPC, provider tokens exchanged server-side and never reaching the
 * browser. ADR-0056 decides what comes out of it — identity FACTS, not tokens.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── The boundary, and what makes it real ──────────────────────────────────
 *
 * Everything about the provider is read from its **discovery document**. No
 * endpoint is hardcoded, which matters more for Cognito than it looks: its
 * authorize, token and userInfo endpoints live on a user-pool DOMAIN
 * (`https://{domain}.auth.{region}.amazoncognito.com`) and not on the issuer
 * host, and a repository that wrote those templates down would have encoded a
 * piece of vendor knowledge that is wrong for every other provider.
 *
 * The adapter returns `IdentityClaims` and nothing else. No access token, no
 * refresh token, no raw claim set. A caller cannot start depending on a token
 * that is not handed to it, which is what keeps ADR-0056 §1's decision — we do
 * not store provider tokens — from being quietly undone later.
 */

import * as client from "openid-client";

/** The scopes this system asks for, and the reason for the second one. */
export const EMAIL_SCOPE = "openid email";

/**
 * What the provider told us about this person's email address.
 *
 * A CLOSED SET rather than `{ email?: string; emailVerified?: boolean }`,
 * because an optional boolean has a fourth state nobody handles — and the
 * fourth state is the dangerous one. `undefined` reads as falsy in a hurry,
 * and "the provider did not say" is not "the provider said no"; both refuse,
 * but they are told to the student differently and they mean different things
 * in an incident.
 *
 * ADR-0056 §3. Only `verified` opens a secure step.
 */
export type IdentityClaims =
  | { readonly kind: "verified"; readonly subject: string; readonly email: string }
  | { readonly kind: "unverified"; readonly subject: string; readonly email: string }
  /** The provider returned no email address at all. */
  | { readonly kind: "no_email"; readonly subject: string }
  /** An address, and no `email_verified` claim. Absence is not verification. */
  | { readonly kind: "no_verification_claim"; readonly subject: string; readonly email: string };

/** Every outcome, for an exhaustiveness test and for a reader. */
export const IDENTITY_OUTCOMES = [
  "verified",
  "unverified",
  "no_email",
  "no_verification_claim",
] as const;

/**
 * Turns a verified claim set into the closed outcome.
 *
 * Exported and pure so the four cases can be tested directly, without standing
 * up a provider to produce each one. The protocol tests then prove that a REAL
 * provider's response reaches this function unaltered.
 *
 * `subject` is the only identifier taken (ADR-0038): email is profile data, and
 * a student who changes it must not become a different person.
 */
export function identityFromClaims(claims: {
  readonly sub: string;
  readonly email?: unknown;
  readonly email_verified?: unknown;
}): IdentityClaims {
  const subject = claims.sub;
  const email = typeof claims.email === "string" && claims.email.length > 0 ? claims.email : null;
  if (email === null) return { kind: "no_email", subject };

  // `email_verified` is a BOOLEAN in OIDC Core. Some providers send the string
  // "true"; that is not the standard and this adapter does not quietly accept
  // it — a value it cannot read is a value it has not been told, which is
  // `no_verification_claim` and a refusal. Being liberal here would mean
  // deciding a security question by string coercion.
  if (typeof claims.email_verified !== "boolean") {
    return { kind: "no_verification_claim", subject, email };
  }
  return claims.email_verified
    ? { kind: "verified", subject, email }
    : { kind: "unverified", subject, email };
}

/** What a caller must keep between the redirect out and the redirect back. */
export interface LoginStart {
  /** Where to send the browser. */
  readonly authorizationUrl: string;
  /**
   * The three transient values the callback needs.
   *
   * NOT provider tokens — a PKCE verifier, a CSRF state and a replay nonce —
   * so ADR-0038's *"provider tokens never reach browser storage"* is not
   * engaged by putting them in a short-lived signed cookie, which is where the
   * caller is expected to keep them.
   */
  readonly state: string;
  readonly nonce: string;
  readonly codeVerifier: string;
}

export interface OidcAdapter {
  /** Builds the authorization request. */
  beginLogin(): Promise<LoginStart>;
  /**
   * Exchanges the code and returns identity facts.
   *
   * Throws when the exchange fails, the signature does not verify, or `state`
   * or `nonce` do not match. Those are not outcomes a caller chooses between —
   * they mean the response is not one this system asked for.
   */
  completeLogin(input: {
    /** The full callback URL, as received. */
    readonly currentUrl: URL;
    readonly state: string;
    readonly nonce: string;
    readonly codeVerifier: string;
  }): Promise<IdentityClaims>;
}

export interface OidcAdapterOptions {
  /** The provider's issuer URL. For Cognito: `https://cognito-idp.{region}.amazonaws.com/{poolId}`. */
  readonly issuer: string;
  readonly clientId: string;
  /** A confidential client. Absent means a public client, which ADR-0038 does not use. */
  readonly clientSecret: string;
  readonly redirectUri: string;
  /**
   * Permits an `http://` issuer.
   *
   * Needed only to run against a provider on localhost, which is how the
   * protocol tests work — a real OpenID Provider, on a loopback address, with
   * no certificate. The Conversation Service refuses this in production
   * (ADR-0055's configuration layer), so the knob cannot survive a deploy.
   */
  readonly allowInsecureHttp?: boolean;
}

/**
 * Fetches the discovery document and builds an adapter from it.
 *
 * Done at STARTUP by the caller, so a provider that cannot be reached is a
 * process that refuses to start (ADR-0055) rather than a student meeting a 500
 * on the login button.
 */
export async function discoverAdapter(options: OidcAdapterOptions): Promise<OidcAdapter> {
  const config = await client.discovery(
    new URL(options.issuer),
    options.clientId,
    options.clientSecret,
    undefined,
    options.allowInsecureHttp === true ? { execute: [client.allowInsecureRequests] } : {},
  );

  return {
    beginLogin: async (): Promise<LoginStart> => {
      const codeVerifier = client.randomPKCECodeVerifier();
      const state = client.randomState();
      const nonce = client.randomNonce();
      // S256 only. Cognito supports no other method, and `plain` is not a
      // proof of anything — the verifier would travel in the clear.
      const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
      const authorizationUrl = client
        .buildAuthorizationUrl(config, {
          redirect_uri: options.redirectUri,
          scope: EMAIL_SCOPE,
          code_challenge: codeChallenge,
          code_challenge_method: "S256",
          state,
          nonce,
        })
        .href;
      return { authorizationUrl, state, nonce, codeVerifier };
    },

    completeLogin: async (input): Promise<IdentityClaims> => {
      // One call does the exchange AND the checks: the `state` must match, the
      // ID token's signature must verify against the provider's JWKS, and
      // `iss`, `aud`, `exp` and `nonce` must all be right. Delegated rather
      // than hand-rolled — every one of those is a step somebody has shipped a
      // vulnerability by skipping.
      const tokens = await client.authorizationCodeGrant(config, input.currentUrl, {
        pkceCodeVerifier: input.codeVerifier,
        expectedState: input.state,
        expectedNonce: input.nonce,
      });

      const claims = tokens.claims();
      if (claims === undefined) {
        throw new Error("the provider returned no ID token; this flow requires one");
      }

      // ═══════════════════════════════════════════════════════════════════
      // WHERE `email` ACTUALLY COMES FROM, and why there are two places.
      //
      // OIDC Core §5.4: with the Authorization Code flow, the claims a
      // `scope` asks for are returned from the **UserInfo endpoint**, not in
      // the ID token, because an access token was issued and there is
      // somewhere better to put them. A conforming provider therefore sends
      // an ID token carrying `sub` and nothing else.
      //
      // Cognito is the other common case: it puts `email` and
      // `email_verified` straight in the ID token. Both are legitimate, and a
      // client that reads only one of the two places works against roughly
      // half the providers in existence. This measured it: against a
      // certified OP the first version of this adapter reported `no_email`
      // for every student, including the verified ones.
      //
      // So: the ID token FIRST and authoritatively — it is signed, and its
      // signature has just been checked — and UserInfo consulted only for
      // claims the ID token does not carry. UserInfo can never overwrite what
      // the ID token said, and `fetchUserInfo` is given the ID token's `sub`
      // as `expectedSubject`, so a UserInfo response describing a different
      // person is rejected rather than merged.
      // ═══════════════════════════════════════════════════════════════════
      let email: unknown = claims["email"];
      let emailVerified: unknown = claims["email_verified"];

      if (
        email === undefined &&
        emailVerified === undefined &&
        config.serverMetadata().userinfo_endpoint !== undefined
      ) {
        try {
          const info = await client.fetchUserInfo(config, tokens.access_token, claims.sub);
          email = info["email"];
          emailVerified = info["email_verified"];
        } catch {
          // Deliberately not fatal, and deliberately not a retry. A UserInfo
          // call this system could not complete leaves it holding no address,
          // which `identityFromClaims` turns into `no_email` — the student is
          // still signed in, and the secure step still refuses. Failing the
          // whole login instead would turn a provider hiccup into "you cannot
          // use the product", and treating it as verified is the one thing
          // that must never happen (ADR-0056 §3).
        }
      }

      // Only the claims cross this line. `tokens` — which holds the access and
      // refresh tokens — goes out of scope here and is never returned.
      return identityFromClaims({
        sub: claims.sub,
        ...(email === undefined ? {} : { email }),
        ...(emailVerified === undefined ? {} : { email_verified: emailVerified }),
      });
    },
  };
}
