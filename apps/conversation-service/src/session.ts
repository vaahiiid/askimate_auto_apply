/**
 * The conversation plane's session: a `__Host-` HttpOnly cookie, and nothing else.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ADR-0033 — sessions are HttpOnly cookies.
 * Vahid, 2026-08-28: *"Authentication must use the approved separate `__Host-`
 * HttpOnly cookie model. The secure-plane bootstrap must not place bearer
 * capabilities in URLs."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why the cookie is not merely a preference here ────────────────────────
 *
 * The browser test for this phase is what turned the ADR into a constraint I
 * could not have worked around. `EventSource` — the browser's own SSE client —
 * **takes no request headers.** There is no `EventSource(url, {headers})`. So a
 * bearer token in an `Authorization` header, which is what the provisional app
 * uses, cannot authenticate a stream at all. The alternatives are:
 *
 *   1. put the token in the URL — forbidden, and rightly: a URL reaches the
 *      access log, the `Referer` header, the proxy, the browser history and
 *      any error report that names the request;
 *   2. reimplement SSE over `fetch` so headers become possible — throwing away
 *      the browser's automatic reconnect and its `Last-Event-ID` handling, the
 *      two things ADR-0035 depends on;
 *   3. a cookie, which the browser attaches to an `EventSource` request by
 *      itself.
 *
 * Only the third keeps both properties. The approved model was already the
 * right one; the stream is what makes it the ONLY one.
 *
 * ── Why `__Host-` ─────────────────────────────────────────────────────────
 *
 * The prefix is enforced by the browser, not by us. A cookie named `__Host-…`
 * is rejected unless it is `Secure`, has `Path=/`, and has NO `Domain`
 * attribute — which means no sibling subdomain can set it. `secure.askimate.com`
 * cannot write a session cookie that `app.askimate.com` would honour, and
 * neither can anything else that gets a subdomain. That is a guarantee a
 * same-named cookie without the prefix simply does not have.
 *
 * ── What is in it ─────────────────────────────────────────────────────────
 *
 * An opaque, signed pair: the subject, and an HMAC over it. No claims, no
 * expiry arithmetic a client could edit, nothing readable. It is deliberately
 * NOT a JWT: a JWT invites putting things in it, and everything that has ever
 * gone wrong with one went wrong because somebody put something in it.
 *
 * PROVISIONAL: ADR-0038 delegates identity to a managed OIDC provider, and the
 * real session will be minted from that provider's callback and stored
 * server-side. This is the cookie shape, verified end to end in a real browser;
 * it is not the identity system.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import type { Request, Response } from "express";

/**
 * The one name. `__Host-` is a browser-enforced prefix, so this string is not
 * cosmetic — renaming it to something without the prefix silently drops the
 * subdomain guarantee described above.
 */
export const SESSION_COOKIE = "__Host-aas-session";

/** Everything a `__Host-` cookie must carry, and one thing more. */
const ATTRIBUTES = [
  "Path=/",
  "HttpOnly",
  "Secure",
  // Not `Strict`: a student following a link back into a conversation from an
  // email would arrive logged out, and a logged-out conversation view is the
  // state most likely to end with someone re-typing a credential somewhere.
  // `Lax` still withholds the cookie from cross-site POSTs, which is the case
  // that matters for CSRF.
  "SameSite=Lax",
] as const;

function sign(subject: string, secret: string): string {
  return createHmac("sha256", secret).update(subject).digest("base64url");
}

/** The `Set-Cookie` value for a session. */
export function issueSession(subject: string, secret: string): string {
  const value = `${encodeURIComponent(subject)}.${sign(subject, secret)}`;
  return [`${SESSION_COOKIE}=${value}`, ...ATTRIBUTES].join("; ");
}

/**
 * Reads the cookie back, or refuses it.
 *
 * Compared with `timingSafeEqual` rather than `===`. The comparison is against
 * an HMAC, so a byte-at-a-time leak is the classic way a signature check
 * becomes forgeable given enough attempts — and the lengths are compared first
 * because `timingSafeEqual` throws on a mismatch rather than returning false.
 */
export function readSession(req: Request, secret: string): string | null {
  const header = req.headers.cookie;
  if (typeof header !== "string") return null;

  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== SESSION_COOKIE) continue;

    const raw = part.slice(separator + 1).trim();
    const dot = raw.lastIndexOf(".");
    if (dot <= 0) return null;

    let subject: string;
    try {
      subject = decodeURIComponent(raw.slice(0, dot));
    } catch {
      // A malformed percent-escape is a malformed cookie, not a subject.
      return null;
    }
    const presented = Buffer.from(raw.slice(dot + 1));
    const expected = Buffer.from(sign(subject, secret));
    if (presented.length !== expected.length) return null;
    return timingSafeEqual(presented, expected) ? subject : null;
  }
  return null;
}

/** Sets the session cookie on a response. */
export function setSession(res: Response, subject: string, secret: string): void {
  res.append("Set-Cookie", issueSession(subject, secret));
}
