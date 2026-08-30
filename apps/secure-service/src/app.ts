/**
 * The Secure Interaction Service, as a deployable app.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠  THE ONE PROCESS IN ASKIMATE THAT RECEIVES A PASSWORD.
 *
 * Everything registered here is registered in an order that matters, and the
 * things that are NOT registered matter more: there is no request logger, no
 * APM agent, no error reporter and no third-party middleware of any kind. Each
 * of those serialises a caught error, and `body-parser` attaches the raw
 * request body to a JSON parse error as `err.body`.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `scripts/check-boundaries.ts` enforces the absence of every such package by
 * name, so this comment is not the control — the build is.
 */

import express from "express";
import type { Express, NextFunction, Request, Response } from "express";

import type { EnvelopeVault } from "@askimate/aas-secrets";

import { controlHeaders } from "./control-document.js";
import type { LifecycleOutbox } from "./lifecycle-outbox.js";
import { SecureLogger } from "@askimate/aas-secure-logging";
import type { SecureRequestStore } from "./requests.js";
import { createSecureRoutes } from "./routes.js";

export interface SecureAppOptions {
  readonly store: SecureRequestStore;
  readonly vault: EnvelopeVault;
  readonly outbox: LifecycleOutbox;
  readonly now: () => Date;
  readonly selfOrigin: string;
  readonly parentOrigin: string;
  readonly logger?: SecureLogger;
  readonly authoriseService?: (req: Request) => boolean;
  /** Where `control.js` and `control.css` are served from. */
  readonly assetDir?: string;
}

export function createSecureApp(options: SecureAppOptions): Express {
  const app = express();
  const logger = options.logger ?? new SecureLogger();
  app.set("trust proxy", 1);
  app.disable("x-powered-by");
  // Express echoes the URL in its default 404 body. Off, because a URL on this
  // service should never be reflected anywhere for any reason.
  app.set("query parser", "simple");

  app.get("/healthz", (_req, res) => {
    res.type("text/plain").send("ok");
  });

  // ── The security headers, on EVERY response ─────────────────────────────
  //
  // Including the JSON ones. A policy applied only to the HTML document would
  // leave the endpoints that actually carry the secret without it, and
  // `connect-src 'self'` is the directive that means an injected script has
  // nowhere to send the value.
  app.use((_req, res, next) => {
    for (const [header, value] of Object.entries(controlHeaders(options.parentOrigin))) {
      res.setHeader(header, value);
    }
    next();
  });

  // 8 KiB. The contract caps a secret at 512 characters; this is the envelope
  // around it and nothing on this service legitimately needs more. A smaller
  // limit means less of a hostile body ever enters memory.
  app.use(express.json({ limit: "8kb" }));

  app.use(
    createSecureRoutes({
      store: options.store,
      vault: options.vault,
      outbox: options.outbox,
      logger,
      now: options.now,
      selfOrigin: options.selfOrigin,
      parentOrigin: options.parentOrigin,
      ...(options.authoriseService === undefined
        ? {}
        : { authoriseService: options.authoriseService }),
    }),
  );

  if (options.assetDir !== undefined) {
    // `control.js` and `control.css`. Static, same-origin, and covered by
    // `script-src 'self'` — which is why the script is a file rather than the
    // inline block that would have been one fewer request.
    app.use(express.static(options.assetDir, { index: false, dotfiles: "deny" }));
  }

  // ── The blind error handler ─────────────────────────────────────────────
  //
  // Four arguments, because Express identifies an error handler by arity and a
  // three-argument function here would silently never run.
  //
  // `logger.failure` reduces the thrown value to a CLASS NAME at its first
  // statement and deletes `err.body` before anything else touches it. Nothing
  // downstream holds the error, so nothing downstream can serialise it.
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction): void => {
    logger.failure("unhandled_failure", error, { status: 500 });
    if (res.headersSent) return;
    res.status(500).type("application/problem+json").json({
      type: "https://askimate.com/problems/internal_error",
      title: "Something went wrong",
      status: 500,
      code: "internal_error",
    });
  });

  return app;
}
