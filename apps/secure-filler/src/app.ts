/**
 * The Secure Plane fill agent, as a deployable app.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠  A SECURE PLANE PROCESS. It holds a KMS grant, it reads the vault's cache,
 *    and for one stack frame per request it holds a password.
 *
 * Everything `apps/secure-service/src/app.ts` refuses to register is refused
 * here for the same reasons and enforced by the same boundary check: no request
 * logger, no APM agent, no error reporter, no third-party middleware. Each of
 * those serialises a caught error, and `body-parser` attaches the raw request
 * body to a JSON parse error as `err.body`.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── What is deliberately NOT here ─────────────────────────────────────────
 *
 * No browser document, no session cookie, no CORS, no public route. This
 * service is reachable only from the runner, over mTLS, on a private subnet.
 * It serves ONE operation, and the operation is the reason the service exists.
 *
 * It is also not the secure service. Vahid, 2026-08-30: *"Option (c) creates
 * unnecessary coupling between the Secure Service and browser automation."* So
 * the browser automation lives here, and `apps/secure-service` has no
 * production dependency on Playwright — a rule the boundary check enforces
 * rather than a habit this comment asks for.
 */

import { parseSecretFillRequest } from "@askimate/aas-contracts";
import { SecureLogger } from "@askimate/aas-secure-logging";
import express from "express";
import type { Express, NextFunction, Request, Response } from "express";

import type { FillAgentDeps } from "./fill.js";
import { performSecretFill } from "./fill.js";

export interface FillAgentAppOptions extends Omit<FillAgentDeps, "logger"> {
  readonly logger?: SecureLogger;
  /** mTLS in production. A port here so a test can present an identity. */
  readonly authoriseService?: (req: Request) => boolean;
}

export function createFillAgentApp(options: FillAgentAppOptions): Express {
  const app = express();
  const logger = options.logger ?? new SecureLogger();
  app.disable("x-powered-by");
  app.set("query parser", "simple");

  app.get("/healthz", (_req, res) => {
    res.type("text/plain").send("ok");
  });

  // 4 KiB. This body carries identifiers and a selector. There is no field in
  // it that can be long, and a smaller limit means less of a hostile body ever
  // enters the memory of a process that holds a KMS grant.
  app.use(express.json({ limit: "4kb" }));

  app.post(
    "/internal/v1/secret-fills",
    (req: Request, res: Response, next: NextFunction): void => {
      void (async (): Promise<void> => {
        if (options.authoriseService?.(req) !== true) {
          res.status(403).json(problem(403, "forbidden"));
          return;
        }
        const request = parseSecretFillRequest(req.body);
        if (request === null) {
          // No `detail`, and nothing echoed. RFC 9457's `detail` is where a
          // handler interpolates the failing value, and on this plane that is
          // the one field that must not exist.
          res.status(400).json(problem(400, "validation_failed"));
          return;
        }
        const result = await performSecretFill(request, { ...options, logger });
        res.status(200).json(result);
      })().catch(next);
    },
  );

  // The last handler. It never sees a body, and it reduces whatever was thrown
  // to a class name before anything else touches it.
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction): void => {
    logger.failure("unhandled_failure", error, { status: 500 });
    if (!res.headersSent) res.status(500).json(problem(500, "internal_error"));
  });

  return app;
}

function problem(
  status: number,
  code: "forbidden" | "validation_failed" | "internal_error",
): Record<string, unknown> {
  return {
    type: `https://askimate.com/problems/${code}`,
    title: code.replace(/_/g, " "),
    status,
    code,
    instance: "/internal/v1/secret-fills",
  };
}
