/**
 * Signing in: the redirect out, and the redirect back.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ADR-0038 (Authorization Code + PKCE, tokens exchanged server-side), ADR-0033
 * (the `__Host-` session cookie is what the browser ends up with), ADR-0056
 * (what the provider said about the email address is recorded here, once).
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── What the browser holds between the two ────────────────────────────────
 *
 * A short-lived, HttpOnly, signed cookie carrying the PKCE verifier, the CSRF
 * `state` and the replay `nonce`. Those are NOT provider tokens — ADR-0038's
 * *"provider tokens never reach browser storage"* is not engaged — and they
 * have to survive a round trip through the provider, which rules out server
 * memory in a multi-instance deployment.
 *
 * It is deleted the moment the callback consumes it, so a verifier cannot be
 * replayed against a second code.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { Router, type Request, type Response } from "express";

import type { IdentityClaims, OidcAdapter } from "@askimate/aas-oidc";

import { setSession } from "./session.js";

/** The transient cookie. `__Host-` for the same subdomain guarantee as the session. */
export const LOGIN_COOKIE = "__Host-aas-login";

/** How long a student has to finish signing in. */
const LOGIN_WINDOW_MS = 10 * 60 * 1000;

interface LoginState {
  readonly state: string;
  readonly nonce: string;
  readonly codeVerifier: string;
  readonly expiresAt: number;
}

/**
 * Signed with the session secret, and NOT encrypted.
 *
 * Nothing in it is a secret from the person holding it: the PKCE verifier is
 * theirs, and `state` and `nonce` are values they are about to send anyway.
 * What matters is that they cannot be CHANGED, which a signature gives.
 */
function seal(value: LoginState, secret: string): string {
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  const mac = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${mac}`;
}

function unseal(raw: string | undefined, secret: string, now: number): LoginState | null {
  if (raw === undefined) return null;
  const [payload, mac] = raw.split(".");
  if (payload === undefined || mac === undefined) return null;

  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  // Constant time, and length-checked first: `timingSafeEqual` throws on a
  // length mismatch, which would itself be a signal.
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const candidate = parsed as Partial<LoginState>;
  if (
    typeof candidate.state !== "string" ||
    typeof candidate.nonce !== "string" ||
    typeof candidate.codeVerifier !== "string" ||
    typeof candidate.expiresAt !== "number"
  ) {
    return null;
  }
  if (candidate.expiresAt <= now) return null;
  return candidate as LoginState;
}

/**
 * One cookie out of the header, the same way `readSession` does it.
 *
 * No `cookie-parser`: this service reads exactly two cookies and adding a
 * dependency to the plane holding student identity to do it would be a poor
 * trade (ADR-0042's supply-chain argument, one plane over).
 */
function cookieFrom(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (typeof header !== "string") return undefined;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    return part.slice(separator + 1).trim();
  }
  return undefined;
}

export interface AuthRoutesOptions {
  readonly adapter: OidcAdapter;
  readonly sessionSecret: string;
  /** Resolves a signed-in identity to this system's student. */
  readonly resolve: (claims: IdentityClaims) => Promise<{ readonly studentId: string }>;
  readonly now: () => Date;
  /** Where the browser goes once signed in. Same-origin path only. */
  readonly afterLoginPath?: string;
  readonly onFailure?: (reason: string) => void;
}

export function createAuthRoutes(options: AuthRoutesOptions): Router {
  const router = Router();
  const afterLogin = options.afterLoginPath ?? "/";

  router.get("/auth/login", (_req: Request, res: Response): void => {
    void (async (): Promise<void> => {
      const start = await options.adapter.beginLogin();
      const sealed = seal(
        {
          state: start.state,
          nonce: start.nonce,
          codeVerifier: start.codeVerifier,
          expiresAt: options.now().getTime() + LOGIN_WINDOW_MS,
        },
        options.sessionSecret,
      );
      res.setHeader(
        "set-cookie",
        `${LOGIN_COOKIE}=${sealed}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${String(
          LOGIN_WINDOW_MS / 1000,
        )}`,
      );
      // 302 rather than rendering a link: nothing here is a page, and the
      // provider's own UI is where the student types anything.
      res.redirect(302, start.authorizationUrl);
    })().catch(() => {
      options.onFailure?.("login_start_failed");
      res.status(503).type("text/plain").send("sign-in is unavailable");
    });
  });

  router.get("/auth/callback", (req: Request, res: Response): void => {
    void (async (): Promise<void> => {
      const held = unseal(
        cookieFrom(req, LOGIN_COOKIE),
        options.sessionSecret,
        options.now().getTime(),
      );
      // Consumed whatever happens, so one sign-in attempt is one verifier.
      res.setHeader("set-cookie", `${LOGIN_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);

      if (held === null) {
        options.onFailure?.("no_login_state");
        res.status(400).type("text/plain").send("sign-in could not be completed");
        return;
      }

      // The full URL as received. The adapter checks `state` against what we
      // held, verifies the ID token's signature against the provider's JWKS,
      // and checks `iss`, `aud`, `exp` and `nonce`. Nothing here re-implements
      // any of that, and nothing here reads a query parameter for a decision.
      const currentUrl = new URL(req.originalUrl, `${req.protocol}://${req.get("host") ?? ""}`);

      let claims: IdentityClaims;
      try {
        claims = await options.adapter.completeLogin({
          currentUrl,
          state: held.state,
          nonce: held.nonce,
          codeVerifier: held.codeVerifier,
        });
      } catch {
        // The reason is deliberately NOT echoed. A failed exchange can carry a
        // provider error body, and this is the response a browser renders.
        options.onFailure?.("exchange_failed");
        res.status(400).type("text/plain").send("sign-in could not be completed");
        return;
      }

      // ── Every outcome signs the student IN ───────────────────────────
      //
      // Including the three unverified ones. They ARE authenticated — the
      // provider said who they are — and refusing them a session would leave
      // them unable to reach the conversation that would explain why a secure
      // step is closed. The verification result is recorded (ADR-0056) and the
      // SECURE STEP is what refuses, which is the one thing it protects.
      const student = await options.resolve(claims);
      setSession(res, student.studentId, options.sessionSecret);
      res.redirect(302, afterLogin);
    })().catch(() => {
      options.onFailure?.("callback_failed");
      res.status(500).type("text/plain").send("sign-in could not be completed");
    });
  });

  return router;
}
