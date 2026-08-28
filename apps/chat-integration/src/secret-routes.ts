/**
 * The secure endpoint. The only place in AskiMate a password crosses the wire.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-27: *"Implement the actual endpoint used by the AskiMate Chat
 * UI. Audit the real framework configuration and prove that request bodies
 * containing secrets are not written to access logs, application logs, request
 * logs, error logs, telemetry, analytics, tracing, debugging middleware,
 * database records. Do not assume the framework defaults are safe."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Written to match the real thing, not to replace it ────────────────────
 *
 * The auth here is AskiMate's own: a `Bearer` JWT verified with `JWT_SECRET`,
 * carrying `{ id, email, emailVerified }` — transcribed from `getUser` in
 * `archive/askimate/backend/routes/askimate-ai.ts`. The route prefix, the
 * error shapes (`{ error: "EMAIL_NOT_VERIFIED" }`), and the rate-limit style
 * all follow the existing routes so this drops into `routes/index.ts` beside
 * them rather than arriving as a foreign object.
 *
 * ── The four rules this route follows that the others do not ──────────────
 *
 *  1. **Nothing from the body is ever interpolated into a string.** Not into a
 *     log line, not into an error message, not into a response. The existing
 *     routes log freely — `console.log(`[FORGOT-PW] User found: … email="…"`)`
 *     is real code in `askimate-auth.ts` — and that habit is exactly what
 *     would put a password in a log here.
 *
 *  2. **The response never echoes the body.** Express's default error handler
 *     does not either, but a route that returned `{ received: req.body }` for
 *     debugging would, so the response shapes are closed unions.
 *
 *  3. **The error handler is explicit and body-blind.** Registered by
 *     `createChatApp`, so a throw inside JSON parsing — a malformed body
 *     containing a half-typed password — cannot reach Express's default
 *     handler, which in development sends the stack to the client.
 *
 *  4. **The comparison happens here.** Vahid: *"The comparison must happen in
 *     the secure UI/backend path. The two plaintext values must never enter
 *     the model context."* Both values die with this call frame; the model is
 *     told `secret_received` or `secret_rejected` and nothing else.
 */

import type { NextFunction, Request, Response, Router } from "express";
import { Router as makeRouter } from "express";
import { rateLimit } from "express-rate-limit";
import jwt from "jsonwebtoken";

import type { SecretHandle, SecretStore } from "@askimate/aas-secrets";
import { parseSecretRequestId } from "@askimate/aas-secrets";

import type { SecretBindingStore } from "./bindings.js";
import type { SecretRejectionReason } from "./chat-transport.js";

/** What AskiMate's JWT carries. Transcribed from the real route. */
export interface AskimateUserPayload {
  readonly id: number;
  readonly email: string;
  readonly emailVerified?: boolean;
}

/**
 * What the student's browser gets back.
 *
 * A closed union with no free-text field. `secret_rejected` carries a *reason
 * code*, not a message assembled from the input — a message is where a value
 * ends up when someone is being helpful.
 */
export type SecretSubmitResponse =
  | { readonly status: "secret_received"; readonly handle: SecretHandle }
  | {
      readonly status: "secret_rejected";
      readonly reason:
        | "confirmation_mismatch"
        | "empty"
        | "unknown_request"
        | "expired"
        | "already_submitted"
        | "not_your_request"
        | "wrong_conversation";
    };

/**
 * COMPILE-TIME ASSERTION: the endpoint's rejection reasons and the turn's
 * rejection reasons must stay the same set.
 *
 * These are two unions in two files, and they will drift the moment someone
 * adds a reason to the route without adding it to the transport. The drift is
 * silent — the route returns a code the client cannot represent, so the client
 * falls back to "unknown" and the model is told something vaguer than what
 * actually happened.
 *
 * `Exclude` in both directions turns that into a build failure naming the
 * missing member.
 */
type ServerReason = Extract<SecretSubmitResponse, { status: "secret_rejected" }>["reason"];
type AssertNever<T extends never> = T;
export type SERVER_REASONS_ALL_REPRESENTABLE = AssertNever<
  Exclude<ServerReason, SecretRejectionReason>
>;

export interface SecretRoutesOptions {
  readonly store: SecretStore;
  readonly bindings: SecretBindingStore;
  readonly jwtSecret: string;
  /** Injected so tests can pin it. The real app passes `() => new Date()`. */
  readonly now: () => Date;
  /**
   * Submissions allowed per IP per hour. Defaults to the production value.
   *
   * Configurable only so a test that exercises nine failure scenarios does not
   * spend the whole hour's budget proving the first three. `SUBMIT_LIMIT` below
   * is what a deployment gets when this is omitted, and a test asserts the
   * default actually engages.
   */
  readonly submitLimit?: number;
}

/**
 * Ten an hour, per IP.
 *
 * A student using the control needs one, or two with a mistyped confirmation.
 * Ten leaves room for a bad afternoon and still makes an online guessing attack
 * against the endpoint pointless — though note the endpoint does not verify
 * anything, so there is nothing to guess: this limits abuse of the *store*, not
 * of a credential.
 */
export const SUBMIT_LIMIT = 10;

/**
 * Reads the caller's identity.
 *
 * Note what is NOT here: no fallback to a query parameter, no cookie, no
 * `x-user-id` header. A password endpoint that could be addressed on behalf of
 * someone else by setting a header is not a password endpoint.
 */
function getUser(req: Request, jwtSecret: string): AskimateUserPayload | null {
  const authHeader = req.headers.authorization;
  if (typeof authHeader !== "string" || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  if (token.length === 0) return null;
  try {
    return jwt.verify(token, jwtSecret) as AskimateUserPayload;
  } catch {
    // Deliberately silent. The existing routes are silent here too, and a log
    // line naming a rejected token is a log line naming a credential.
    return null;
  }
}

/** Strict rate limit, in the style of `passwordResetRateLimit` in the real app. */
function makeSubmitRateLimit(limit: number): ReturnType<typeof rateLimit> {
  return rateLimit({
    windowMs: 60 * 60 * 1000,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many password submissions. Please try again later." },
  });
}

export function createSecretRoutes(options: SecretRoutesOptions): Router {
  const router = makeRouter();
  const submitRateLimit = makeSubmitRateLimit(options.submitLimit ?? SUBMIT_LIMIT);

  // ── POST /askimate/secret/:requestId ────────────────────────────────────
  //
  // The one endpoint that receives plaintext. Everything about it is arranged
  // so the plaintext dies in this function.
  router.post(
    "/askimate/secret/:requestId",
    submitRateLimit,
    (req: Request, res: Response, next: NextFunction): void => {
      void (async (): Promise<void> => {
        const user = getUser(req, options.jwtSecret);
        if (user === null) {
          res.status(401).json({ error: "Authentication required" });
          return;
        }
        if (user.emailVerified === false) {
          res.status(403).json({ error: "EMAIL_NOT_VERIFIED" });
          return;
        }

        const requestId = parseSecretRequestId(oneParam(req.params["requestId"]));
        if (requestId === null) {
          res.status(400).json({ status: "secret_rejected", reason: "unknown_request" });
          return;
        }

        // ── The two plaintext values ────────────────────────────────────
        //
        // From here to the end of this function is the entire lifetime of the
        // password inside the web tier. They are read out of the body, used,
        // and never assigned to anything that outlives the call.
        const body = req.body as unknown;
        const password = readField(body, "password");
        const confirmation = readField(body, "confirmation");

        if (password === null || password.length === 0) {
          res.status(400).json({ status: "secret_rejected", reason: "empty" });
          return;
        }

        const binding = options.bindings.findSync(requestId);
        if (binding === null) {
          res.status(404).json({ status: "secret_rejected", reason: "unknown_request" });
          return;
        }

        // ── Session binding ─────────────────────────────────────────────
        //
        // Vahid: *"A SecretHandle must not be usable by another student,
        // conversation or case."* The student and conversation are checked
        // HERE, at submission; the case, purpose and target are checked again
        // by the store at consumption. Both ends, because the two failures are
        // different: this one is someone answering a prompt that was not
        // theirs, and that one is a handle being spent somewhere it should not.
        if (binding.userId !== user.id) {
          res.status(403).json({ status: "secret_rejected", reason: "not_your_request" });
          return;
        }
        const conversationId = readNumber(body, "conversationId");
        if (conversationId !== null && conversationId !== binding.conversationId) {
          res.status(403).json({ status: "secret_rejected", reason: "wrong_conversation" });
          return;
        }

        // ── The comparison, in the backend path ─────────────────────────
        //
        // Not in the browser. A browser-only comparison would mean the server
        // accepting whatever single value the page chose to send, and "the UI
        // checked it" is not a property the server has.
        if (binding.requiresConfirmation && confirmation !== password) {
          // The mismatch is reported as a code. Neither value is named, and
          // neither is echoed — a "did you mean …?" here would be a password
          // in an HTTP response body.
          res.status(400).json({ status: "secret_rejected", reason: "confirmation_mismatch" });
          return;
        }

        const submitted = options.store.submit(requestId, password, options.now());
        if (!submitted.ok) {
          const reason =
            submitted.reason.kind === "unknown_request"
              ? "unknown_request"
              : submitted.reason.kind === "expired"
                ? "expired"
                : submitted.reason.kind === "already_submitted"
                  ? "already_submitted"
                  : "empty";
          await options.bindings.record(requestId, {
            lifecycle: reason === "expired" ? "secret_expired" : "secret_requested",
          });
          res.status(409).json({ status: "secret_rejected", reason });
          return;
        }

        await options.bindings.record(requestId, {
          lifecycle: "secret_received",
          handle: submitted.handle,
        });

        const response: SecretSubmitResponse = {
          status: "secret_received",
          handle: submitted.handle,
        };
        res.status(200).json(response);
      })().catch(next);
    },
  );

  // ── DELETE /askimate/secret/:requestId ──────────────────────────────────
  //
  // The student abandons the step. Without this, a request stays open until
  // its TTL expires — and while it is open the composer's send is blocked and
  // the server refuses ordinary messages. A student who changes their mind
  // would be locked out of their own conversation for up to five minutes with
  // no way to say so.
  //
  // No new lifecycle word is needed. `discard` destroys the entry and marks it
  // `secret_expired`, whose meaning already reads "the TTL passed, OR the
  // student abandoned it".
  router.delete(
    "/askimate/secret/:requestId",
    (req: Request, res: Response, next: NextFunction): void => {
      void (async (): Promise<void> => {
        const user = getUser(req, options.jwtSecret);
        if (user === null) {
          res.status(401).json({ error: "Authentication required" });
          return;
        }
        const requestId = parseSecretRequestId(oneParam(req.params["requestId"]));
        if (requestId === null) {
          res.status(404).json({ error: "Unknown request" });
          return;
        }
        const binding = options.bindings.findSync(requestId);
        // Same answer for "does not exist" and "not yours", as the GET does:
        // distinguishing them would confirm that another student had been
        // asked for a password.
        if (binding === null || binding.userId !== user.id) {
          res.status(404).json({ error: "Unknown request" });
          return;
        }

        options.store.discard(requestId);
        await options.bindings.record(requestId, { lifecycle: "secret_expired" });
        res.status(200).json({ status: "secret_cancelled", lifecycle: "secret_expired" });
      })().catch(next);
    },
  );

  // ── GET /askimate/secret/:requestId ─────────────────────────────────────
  //
  // What a page that has just been refreshed asks. Returns the lifecycle word
  // and the binding — never anything derived from the password, because
  // nothing derived from the password exists.
  router.get(
    "/askimate/secret/:requestId",
    (req: Request, res: Response, next: NextFunction): void => {
      void (async (): Promise<void> => {
        const user = getUser(req, options.jwtSecret);
        if (user === null) {
          res.status(401).json({ error: "Authentication required" });
          return;
        }
        const requestId = parseSecretRequestId(oneParam(req.params["requestId"]));
        if (requestId === null) {
          res.status(404).json({ error: "Unknown request" });
          return;
        }
        const binding = options.bindings.findSync(requestId);
        if (binding === null || binding.userId !== user.id) {
          // Same answer for "does not exist" and "not yours". Distinguishing
          // them would confirm that another student had been asked for a
          // password.
          res.status(404).json({ error: "Unknown request" });
          return;
        }
        await Promise.resolve();
        res.status(200).json({
          requestId,
          lifecycle: binding.lifecycle,
          conversationId: binding.conversationId,
          purpose: binding.purpose,
          portalHost: binding.targetHost,
          requiresConfirmation: binding.requiresConfirmation,
          expiresAt: binding.expiresAt.toISOString(),
        });
      })().catch(next);
    },
  );

  return router;
}

/**
 * Express 5 types a route parameter as `string | string[]`, because a pattern
 * can repeat. This one cannot, but the array case still has to be handled —
 * and it is handled by refusing rather than by taking the first element, since
 * an array arriving here means the route matched something unexpected.
 */
function oneParam(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

/**
 * Reads one string field, without letting the shape of the body matter.
 *
 * Returns null rather than throwing, and never includes the value or the body
 * in anything it returns. A validation library would be the idiomatic choice
 * and would also be a library that formats offending values into error
 * messages — which is the one thing this endpoint must not do.
 */
function readField(body: unknown, key: string): string | null {
  if (typeof body !== "object" || body === null) return null;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

function readNumber(body: unknown, key: string): number | null {
  if (typeof body !== "object" || body === null) return null;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
