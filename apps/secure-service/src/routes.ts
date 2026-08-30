/**
 * The Secure Interaction Service's HTTP surface. Implements `secure.v1.yaml`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE ONE SERVICE IN ASKIMATE THAT RECEIVES A PASSWORD.
 *
 * Seven operations, and exactly one of them has a body containing a secret.
 * That one is `POST /v1/secret-requests/{id}/secret`, and everything about it
 * is arranged so the plaintext dies in the handler: read from the body,
 * envelope-encrypted with a per-secret KMS data key, ciphertext into a cache
 * with persistence disabled. It is never assigned to anything that outlives the
 * call, never written to a column, never logged, and never returned.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── What each check is for ────────────────────────────────────────────────
 *
 * `Origin` and `Sec-Fetch-Site` on the two state-changing endpoints. These are
 * what make the exchange and the submission same-origin-only, and
 * `Sec-Fetch-Site` is set by the browser and cannot be spoofed from script.
 *
 * They carry MORE weight here than they would elsewhere, because this plane's
 * session cookie is `SameSite=None` — see the exchange below — and therefore
 * provides no CSRF protection of its own. The headers are the whole of it.
 *
 * Ownership is checked HERE and again when the handle is spent, because the two
 * failures are different: this one is someone answering a prompt that was not
 * theirs; that one is a handle being spent somewhere it should not be.
 */

import type { NextFunction, Request, Response, Router } from "express";
import { Router as makeRouter } from "express";

import type { EnvelopeVault } from "@askimate/aas-secrets";
import { confirmationMatches } from "@askimate/aas-secrets";

import { controlDocument } from "./control-document.js";
import type { LifecycleOutbox } from "./lifecycle-outbox.js";
import type { SecureLogger } from "./logger.js";
import type { SecretRequestRow, SecureRequestStore, SubmitRefusalCode } from "./requests.js";
import { newHandle } from "./requests.js";

/** ADR-0033. `__Host-` is browser-enforced: Secure, Path=/, and no Domain. */
export const SECURE_SESSION_COOKIE = "__Host-secure_session";

export interface SecureRoutesOptions {
  readonly store: SecureRequestStore;
  readonly vault: EnvelopeVault;
  readonly outbox: LifecycleOutbox;
  readonly logger: SecureLogger;
  readonly now: () => Date;
  /** This service's own origin, e.g. `https://secure.askimate.com`. */
  readonly selfOrigin: string;
  /** The conversation plane's origin, the only permitted frame ancestor. */
  readonly parentOrigin: string;
  /** True when the caller presented a permitted service certificate (mTLS). */
  readonly authoriseService?: (req: Request) => boolean;
  /** Largest secret accepted, per the contract's `maxLength`. */
  readonly maxSecretLength?: number;
}

const MAX_SECRET_LENGTH = 512;

const TITLES: Readonly<Record<string, string>> = {
  unauthenticated: "No valid secure session",
  forbidden: "Not permitted",
  not_found: "Unknown request",
  validation_failed: "The request did not satisfy the schema",
  rate_limited: "Too many attempts",
  secret_rejected: "The submission was refused",
};

function problem(
  res: Response,
  status: number,
  code: string,
  extra: Record<string, string> = {},
): void {
  // RFC 9457 minus `detail`. `detail` is where a handler interpolates the
  // failing value, and on this service the failing value is a password.
  res
    .status(status)
    .type("application/problem+json")
    .json({
      type: `https://askimate.com/problems/${code}`,
      title: TITLES[code] ?? "Refused",
      status,
      code,
      ...extra,
    });
}

/** Reads a named cookie without a parser dependency. */
function cookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (typeof header !== "string") return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return null;
}

/**
 * Same-origin, on the browser's word rather than ours.
 *
 * `Sec-Fetch-Site: same-origin` is set by the browser and is not settable from
 * script, which is what makes it worth checking. `Origin` is checked too
 * because an older browser may not send `Sec-Fetch-Site`, and the pair fails
 * closed: an absent `Origin` on a state-changing request is refused.
 */
function isSameOrigin(req: Request, selfOrigin: string): boolean {
  const site = req.header("Sec-Fetch-Site");
  if (site !== undefined && site !== "same-origin") return false;
  return req.header("Origin") === selfOrigin;
}

function stateOf(row: SecretRequestRow): Record<string, unknown> {
  return {
    requestId: row.requestId,
    lifecycle: row.lifecycle,
    expiresAt: row.expiresAt.toISOString(),
    requiresConfirmation: row.requiresConfirmation,
  };
}

export function createSecureRoutes(options: SecureRoutesOptions): Router {
  const router = makeRouter();
  const maxSecret = options.maxSecretLength ?? MAX_SECRET_LENGTH;

  function reject(res: Response, status: number, reason: SubmitRefusalCode): void {
    problem(res, status, "secret_rejected", { reason });
  }

  /** The session, or null. Never distinguishes "expired" from "never existed". */
  const session = async (
    req: Request,
  ): Promise<{ requestId: string; studentRef: string } | null> => {
    const value = cookie(req, SECURE_SESSION_COOKIE);
    return value === null ? null : await options.store.readSession(value, options.now());
  };

  // ── GET /control/{requestId} ────────────────────────────────────────────
  //
  // Unauthenticated, and reveals nothing: the prompt text it displays is
  // fetched only after the bootstrap exchange establishes who is asking.
  router.get("/control/:requestId", (req: Request, res: Response, next: NextFunction): void => {
    void (async (): Promise<void> => {
      const requestId = String(req.params["requestId"]);
      const row = await options.store.find(requestId);
      if (row === null) {
        // The same answer as "not yours" and "already settled". Telling them
        // apart would confirm that some other student had been asked for a
        // password.
        problem(res, 404, "not_found");
        return;
      }
      res
        .status(200)
        .type("text/html")
        .send(
          controlDocument({
            requestId,
            parentOrigin: options.parentOrigin,
            conversationId: row.conversationId,
          }),
        );
    })().catch(next);
  });

  // ── POST /v1/frame-sessions ─────────────────────────────────────────────
  //
  // Step 5 of the bootstrap. The token arrived by postMessage — never a URL —
  // so it appears in no Referer header, no history entry, no access log and no
  // screenshot. This endpoint consumes it.
  router.post("/v1/frame-sessions", (req: Request, res: Response, next: NextFunction): void => {
    void (async (): Promise<void> => {
      if (!isSameOrigin(req, options.selfOrigin)) {
        options.logger.log({ event: "frame_session_refused", code: "forbidden" });
        problem(res, 403, "forbidden");
        return;
      }
      const body = req.body as { requestId?: unknown; frameToken?: unknown } | undefined;
      const requestId = typeof body?.requestId === "string" ? body.requestId : null;
      const frameToken = typeof body?.frameToken === "string" ? body.frameToken : null;
      if (requestId === null || frameToken === null) {
        problem(res, 400, "validation_failed");
        return;
      }

      const claimed = await options.store.claimFrameToken(frameToken, options.now());
      // Unknown, already used, expired: one answer. The token is single-use and
      // the claim is atomic, so a second exchange of the same token lands here.
      if (claimed === null || claimed.requestId !== requestId) {
        options.logger.log({ event: "frame_session_refused", requestId, code: "forbidden" });
        problem(res, 403, "forbidden");
        return;
      }

      const value = await options.store.createSession(claimed, options.now());
      // ── SameSite=None; Partitioned, and this was a CORRECTION ──────────
      //
      // The contract said `SameSite=Lax`, and I measured that it cannot work:
      // a `Lax` cookie is NOT sent on requests made from inside a CROSS-SITE
      // IFRAME, which is the only context this session is ever used in. The
      // frame would set the cookie, then be refused by its own service on the
      // very next fetch. `Lax` and ADR-0030 are mutually exclusive.
      //
      // `Partitioned` (CHIPS) rather than bare `None`: the cookie is keyed to
      // the TOP-LEVEL site as well as this one, so it exists only while
      // embedded by the conversation plane and is not a general third-party
      // cookie that any other site could cause to be sent. With `__Host-` —
      // no Domain, Path=/, Secure — that is the strongest arrangement a
      // cross-origin frame session can have.
      //
      // The CSRF protection `Lax` would have given is replaced by the `Origin`
      // and `Sec-Fetch-Site` checks above, which are stricter: they refuse a
      // cross-site POST outright rather than merely withholding a cookie.
      res.append(
        "Set-Cookie",
        [
          `${SECURE_SESSION_COOKIE}=${value}`,
          "Path=/",
          "HttpOnly",
          "Secure",
          "SameSite=None",
          "Partitioned",
        ].join("; "),
      );
      options.logger.log({ event: "frame_session_established", requestId });
      // 204: there is nothing to say that the cookie does not say. A body here
      // would be a body a parent page might one day try to read.
      res.status(204).end();
    })().catch(next);
  });

  // ── GET /v1/secret-requests/{requestId} ─────────────────────────────────
  router.get(
    "/v1/secret-requests/:requestId",
    (req: Request, res: Response, next: NextFunction): void => {
      void (async (): Promise<void> => {
        const caller = await session(req);
        if (caller === null) {
          problem(res, 401, "unauthenticated");
          return;
        }
        const requestId = String(req.params["requestId"]);
        if (caller.requestId !== requestId) {
          problem(res, 404, "not_found");
          return;
        }
        const row = await options.store.find(requestId);
        if (row === null) {
          problem(res, 404, "not_found");
          return;
        }
        // The lifecycle word, the expiry, and whether a confirmation is
        // required. Nothing derived from the secret, because nothing derived
        // from the secret exists. The title and explanation are served here
        // too — inside the secure plane, which is the only place they may be.
        res.status(200).json({
          ...stateOf(row),
          title: row.title,
          explanation: row.explanation,
          targetHost: row.targetHost,
        });
      })().catch(next);
    },
  );

  // ── DELETE /v1/secret-requests/{requestId} ──────────────────────────────
  router.delete(
    "/v1/secret-requests/:requestId",
    (req: Request, res: Response, next: NextFunction): void => {
      void (async (): Promise<void> => {
        const caller = await session(req);
        const requestId = String(req.params["requestId"]);
        if (caller === null || caller.requestId !== requestId) {
          problem(
            res,
            caller === null ? 401 : 404,
            caller === null ? "unauthenticated" : "not_found",
          );
          return;
        }
        const row = await options.store.find(requestId);
        if (row === null) {
          problem(res, 404, "not_found");
          return;
        }
        if (row.lifecycle === "secret_received") {
          // The automation may already be spending the handle. A cancellation
          // racing a consumption would be a lie in one direction or the other.
          problem(res, 409, "forbidden");
          return;
        }
        if (row.lifecycle !== "secret_requested") {
          // Idempotent: already cancelled returns the same body.
          res.status(200).json(stateOf(row));
          return;
        }

        const now = options.now();
        await options.store.withTransaction(async (client) => {
          await options.store.settle(client, requestId, "secret_cancelled", now);
          // ADR-0032, and the outbox in the SAME transaction as the lifecycle
          // change: the conversation log learns this happened, or nothing did.
          await options.outbox.enqueue(client, {
            requestId,
            conversationId: row.conversationId,
            transition: { kind: "secret_cancelled" },
            now,
          });
        });
        await options.vault.destroy(row.handle ?? requestId);
        options.logger.log({ event: "request_cancelled", requestId, code: "secret_cancelled" });

        const updated = await options.store.find(requestId);
        res.status(200).json(stateOf(updated ?? row));
      })().catch(next);
    },
  );

  // ── POST /v1/secret-requests/{requestId}/secret ─────────────────────────
  //
  // THE ONE OPERATION THAT ACCEPTS A SECRET.
  router.post(
    "/v1/secret-requests/:requestId/secret",
    (req: Request, res: Response, next: NextFunction): void => {
      void (async (): Promise<void> => {
        const requestId = String(req.params["requestId"]);

        // ── Every check that does not need the value, first ───────────────
        //
        // Ordered deliberately: by the time `secret` is read out of the body,
        // the caller is authenticated, the request is theirs, it is open, and
        // it has not expired. A refusal path that had already pulled the
        // plaintext into a variable would be a variable holding a password on
        // a path that ends in an error response.
        if (!isSameOrigin(req, options.selfOrigin)) {
          problem(res, 403, "forbidden");
          return;
        }
        const caller = await session(req);
        if (caller === null) {
          problem(res, 401, "unauthenticated");
          return;
        }
        if (caller.requestId !== requestId) {
          reject(res, 403, "not_your_request");
          return;
        }
        const row = await options.store.find(requestId);
        if (row === null) {
          problem(res, 404, "not_found");
          return;
        }
        const now = options.now();
        if (row.lifecycle !== "secret_requested") {
          reject(res, 409, "already_submitted");
          options.logger.log({ event: "secret_refused", requestId, code: "already_submitted" });
          return;
        }
        if (row.expiresAt.getTime() <= now.getTime()) {
          reject(res, 409, "expired");
          options.logger.log({ event: "secret_refused", requestId, code: "expired" });
          return;
        }

        const body = req.body as
          | { secret?: unknown; confirmation?: unknown; conversationId?: unknown }
          | undefined;
        if (typeof body?.conversationId !== "string" || body.conversationId !== row.conversationId) {
          reject(res, 403, "wrong_conversation");
          options.logger.log({ event: "secret_refused", requestId, code: "wrong_conversation" });
          return;
        }

        const secret = typeof body.secret === "string" ? body.secret : null;
        if (secret === null || secret.length === 0) {
          reject(res, 400, "empty");
          options.logger.log({ event: "secret_refused", requestId, code: "empty" });
          return;
        }
        if (secret.length > maxSecret) {
          // 413, and NOT a message naming the length. A length is a fact about
          // a password.
          problem(res, 413, "validation_failed");
          options.logger.log({ event: "secret_refused", requestId, status: 413 });
          return;
        }
        if (row.requiresConfirmation) {
          const confirmation = typeof body.confirmation === "string" ? body.confirmation : "";
          // Compared HERE, on the server, in constant time. A browser-side
          // comparison alone would mean accepting whatever single value the
          // page chose to send.
          if (!confirmationMatches(secret, confirmation)) {
            reject(res, 400, "confirmation_mismatch");
            options.logger.log({
              event: "secret_refused",
              requestId,
              code: "confirmation_mismatch",
            });
            return;
          }
        }

        // ── The value leaves scope here ──────────────────────────────────
        //
        // Encrypted before it is assigned to anything that outlives this call.
        // The handle is minted first so the vault key and the receipt agree
        // even if the write below fails: an orphaned ciphertext expires on its
        // own TTL, whereas a receipt with no ciphertext would be a handle the
        // automation could never spend.
        const handle = newHandle();
        await options.vault.put(handle, secret, row.expiresAt, now);

        const recorded = await options.store.withTransaction(async (client) => {
          const ok = await options.store.recordReceipt(client, requestId, handle, now);
          if (!ok) return false;
          // The lifecycle transition and the intent to publish it, in ONE
          // transaction. The conversation log learns the step settled, or the
          // receipt did not happen either.
          await options.outbox.enqueue(client, {
            requestId,
            conversationId: row.conversationId,
            transition: { kind: "secret_received", handle },
            now,
          });
          return true;
        });

        if (!recorded) {
          // Two submissions raced and the other won. The vault entry this call
          // wrote is destroyed rather than left: it is unreachable, because the
          // receipt names the other handle.
          await options.vault.destroy(handle);
          reject(res, 409, "already_submitted");
          return;
        }

        options.logger.log({ event: "secret_submitted", requestId, code: "secret_received" });
        // A handle and a word. No echo, no hash, no length, no strength score.
        res.status(200).json({ status: "accepted", handle, lifecycle: "secret_received" });
      })().catch(next);
    },
  );

  // ── POST /internal/v1/secret-requests ───────────────────────────────────
  router.post(
    "/internal/v1/secret-requests",
    (req: Request, res: Response, next: NextFunction): void => {
      void (async (): Promise<void> => {
        if (options.authoriseService?.(req) !== true) {
          problem(res, 403, "forbidden");
          return;
        }
        const input = parseOpen(req.body as Record<string, unknown> | undefined);
        if (input === null) {
          problem(res, 400, "validation_failed");
          return;
        }

        const { row, frameToken } = await options.store.open(input, options.now());
        // The prompt's title, explanation and host are stored HERE and are NOT
        // returned: the conversation plane never receives text a model wrote
        // about a password, so its event log has nothing to hold.
        options.logger.log({
          event: "request_opened",
          requestId: row.requestId,
          conversationId: row.conversationId,
        });
        res.status(201).json({
          requestId: row.requestId,
          expiresAt: row.expiresAt.toISOString(),
          frameToken,
          requiresConfirmation: row.requiresConfirmation,
        });
      })().catch(next);
    },
  );

  // ── POST /internal/v1/secret-requests/{id}/frame-tokens ─────────────────
  //
  // A fresh bootstrap capability for a request that is already open. Called by
  // the Conversation Service when a page mounts the frame — including after a
  // refresh, which is why a new one is minted rather than the original reissued.
  router.post(
    "/internal/v1/secret-requests/:requestId/frame-tokens",
    (req: Request, res: Response, next: NextFunction): void => {
      void (async (): Promise<void> => {
        if (options.authoriseService?.(req) !== true) {
          problem(res, 403, "forbidden");
          return;
        }
        const requestId = String(req.params["requestId"]);
        const frameToken = await options.store.mintFrameToken(requestId, options.now());
        if (frameToken === null) {
          // Unknown, settled or expired: one answer, as everywhere else.
          problem(res, 404, "not_found");
          return;
        }
        res.status(201).json({ requestId, frameToken });
      })().catch(next);
    },
  );

  // ── POST /internal/v1/secret-uses ───────────────────────────────────────
  router.post(
    "/internal/v1/secret-uses",
    (req: Request, res: Response, next: NextFunction): void => {
      void (async (): Promise<void> => {
        if (options.authoriseService?.(req) !== true) {
          problem(res, 403, "forbidden");
          return;
        }
        const body = req.body as Record<string, unknown> | undefined;
        const handle = typeof body?.["handle"] === "string" ? body["handle"] : null;
        if (handle === null) {
          problem(res, 400, "validation_failed");
          return;
        }
        // ADR-0025, fail closed: a false or absent assertion is refused rather
        // than warned about.
        if (body?.["noDiagnosticCapture"] !== true) {
          problem(res, 403, "forbidden");
          return;
        }

        const row = await options.store.findByHandle(handle);
        if (row === null) {
          // 409 for a handle that WAS spent, 404 for one that never existed.
          // The contract distinguishes them on this internal API and the
          // implementation collapsed both to 404 — caught by a test that
          // expected the contract's answer. "Already spent, do not retry" and
          // "you have the wrong id" are different instructions to a runner.
          const spentFor = await options.store.wasSpent(handle);
          if (spentFor === null) {
            problem(res, 404, "not_found");
            return;
          }
          // Audited as well as refused. A second attempt on a dead handle is
          // either a retry that should stop or a capability being used
          // somewhere it should not be, and both are worth a row.
          await options.store.withTransaction(async (client) => {
            await options.store.recordUse(client, {
              requestId: spentFor,
              handle,
              consumer: typeof body["consumer"] === "string" ? body["consumer"] : "unknown",
              outcome: "refused",
              refusalCode: "already_spent",
            });
          });
          options.logger.log({ event: "secret_use_refused", requestId: spentFor });
          problem(res, 409, "forbidden");
          return;
        }
        // The binding, re-checked: student, case, purpose and target must all
        // match what the request was opened for.
        const bound =
          body["studentRef"] === row.studentRef &&
          body["caseRef"] === row.caseRef &&
          body["purpose"] === row.purpose &&
          body["targetHost"] === row.targetHost;
        if (!bound) {
          problem(res, 403, "forbidden");
          options.logger.log({ event: "secret_use_refused", requestId: row.requestId });
          return;
        }

        const now = options.now();
        // The vault hands the plaintext to a callback and returns the CALLBACK's
        // result. There is no shape in which the value travels back over this
        // boundary — the callback here returns `true`, and that is what the
        // response carries.
        const used = await options.vault.use(handle, () => true, now);
        const consumer = typeof body["consumer"] === "string" ? body["consumer"] : "unknown";
        if (!used.ok) {
          await options.store.withTransaction(async (client) => {
            await options.store.recordUse(client, {
              requestId: row.requestId,
              handle,
              consumer,
              outcome: "refused",
              refusalCode: "unknown_handle",
            });
          });
          problem(res, 409, "forbidden");
          return;
        }

        await options.store.withTransaction(async (client) => {
          await options.store.settle(client, row.requestId, "secret_consumed", now);
          await options.store.recordUse(client, {
            requestId: row.requestId,
            handle,
            consumer,
            outcome: "used",
          });
          await options.outbox.enqueue(client, {
            requestId: row.requestId,
            conversationId: row.conversationId,
            transition: { kind: "secret_consumed" },
            now,
          });
        });
        options.logger.log({
          event: "secret_spent",
          requestId: row.requestId,
          code: "secret_consumed",
        });
        res.status(200).json({ status: "used", lifecycle: "secret_consumed" });
      })().catch(next);
    },
  );

  return router;
}

function parseOpen(
  body: Record<string, unknown> | undefined,
): Parameters<SecureRequestStore["open"]>[0] | null {
  if (body === undefined) return null;
  const text = (key: string, max: number): string | null => {
    const value = body[key];
    return typeof value === "string" && value.length > 0 && value.length <= max ? value : null;
  };
  const studentRef = text("studentRef", 128);
  const conversationId = text("conversationId", 128);
  const caseRef = text("caseRef", 128);
  const targetHost = text("targetHost", 253);
  const purpose = body["purpose"];
  const ttlSeconds = body["ttlSeconds"];
  if (studentRef === null || conversationId === null || caseRef === null || targetHost === null) {
    return null;
  }
  // Closed set. `purpose` comes from the case and the blueprint, never from
  // model output — a prompt-injected model can ask for *a* password; it cannot
  // choose whose, or for which portal.
  if (purpose !== "portal_account_creation" && purpose !== "portal_password_reset") return null;
  // The contract's bounds, enforced. ADR-0034's ceiling is five minutes.
  if (typeof ttlSeconds !== "number" || !Number.isInteger(ttlSeconds)) return null;
  if (ttlSeconds < 60 || ttlSeconds > 300) return null;

  return {
    studentRef,
    conversationId,
    caseRef,
    targetHost,
    purpose,
    ttlSeconds,
    requiresConfirmation: body["requiresConfirmation"] !== false,
    ...(typeof body["title"] === "string" ? { title: body["title"].slice(0, 200) } : {}),
    ...(typeof body["explanation"] === "string"
      ? { explanation: body["explanation"].slice(0, 1000) }
      : {}),
  };
}
