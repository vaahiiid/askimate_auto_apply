/**
 * The Conversation Service's HTTP surface.
 *
 * Implements `packages/contracts/openapi/conversation.v1.yaml`. The contract is
 * the source of the shape (ADR-0005); this file is what answers.
 *
 * ── The guard, and where it sits ──────────────────────────────────────────
 *
 * `POST /messages` checks for an open secure step BEFORE the body is read for
 * any purpose. There is deliberately no branch in which the text is pulled out
 * of the body, held in a variable and then discarded — on the refused path the
 * value never enters scope at all. A refusal names the OPEN REQUEST and never
 * anything from the body, because an echo is how a refused password reaches a
 * log.
 *
 * ── Where ordinals come from ──────────────────────────────────────────────
 *
 * Here, and only here. No route accepts one, `AppendableEvent` has no field for
 * one, and the accepted response returns the EVENT the server wrote — so a
 * client learns its position rather than proposing it.
 */

import type { NextFunction, Request, Response, Router } from "express";
import { Router as makeRouter } from "express";
import { createHash } from "node:crypto";

import type { ConversationEvent, ProblemCode } from "@askimate/aas-contracts";
import {
  PROBLEM_STATUS,
  PROBLEM_TITLES,
  isSecureEventKind,
  SSE_HEARTBEAT_LINE,
  SSE_RESPONSE_HEADERS,
  parseLastEventId,
  parseRejectionReason,
  problemTypeFor,
  renderSseFrame,
  parseWorkReport,
  parseResolutionSubmission,
  parseStudentDecision,
  renderSseResumeFrame,
} from "@askimate/aas-contracts";

import type {
  ClaimedWork,
  ConversationRun,
  OpenIntervention,
  StudentDecision,
  WorkReport,
} from "@askimate/aas-contracts";
import type {
  CaseId,
  HumanReviewRecord,
  ReviewTrigger,
  InterventionId,
  RecoveryResolution,
  ReusabilityAssessment,
} from "@askimate/aas-domain";
import { caseId as makeCaseId, isReviewTrigger } from "@askimate/aas-domain";
import { interventionId as makeInterventionId } from "@askimate/aas-domain";
import type { StoredIntervention } from "@askimate/aas-case-store/interventions";
import {
  InterventionAlreadyResolvedError,
  InterventionNotFoundError,
  ResolutionOutcomeNotImplementedError,
} from "@askimate/aas-case-store/interventions";

import type { AppendableEvent, ConversationEventStore } from "./event-store.js";
import type { RunOutcome } from "./run-driver.js";
import { IdempotencyConflictError, UnknownConversationError } from "./event-store.js";

/** Who is calling. Resolved by the host, so identity stays ADR-0038's problem. */
export interface Caller {
  readonly studentId: string;
}

/**
 * The part of the Run Driver these routes use.
 *
 * Narrower than `RunDriver` on purpose: the routes may start a run and read
 * where one got to, and there is deliberately no method here that could make a
 * run skip a step, change its status or set its phase directly. What a run does
 * next is the orchestrator's decision, reached through `nextStep`.
 */
export interface RunCoordinator {
  start(input: {
    readonly conversationId: string;
    readonly blueprintId: string;
    readonly studentStatement: string;
  }): Promise<RunOutcome>;
  /**
   * Leases one unit of browser work, or `null` because there is none. ADR-0045.
   *
   * `null` is the ordinary answer and must not be treated as a failure: most
   * polls find nothing, because most runs at any instant are waiting for a
   * student rather than for a browser.
   */
  claimWork(input: {
    readonly holder: string;
    readonly leaseSeconds: number;
  }): Promise<ClaimedWork | null>;
  /** Records how a unit of work ended. `false` when the caller is not the holder. */
  reportWork(input: {
    readonly runId: string;
    readonly report: WorkReport;
  }): Promise<boolean>;
  /**
   * Interviews the student in answer to their message. ADR-0051.
   *
   * Returns nothing and refuses nothing: a message that is not an answer to an
   * outstanding question is an ordinary message, and the route has already
   * durably placed it. This is the capability the conversation calls, not a
   * second surface it goes through.
   */
  answerStudent(input: {
    readonly conversationId: string;
    readonly event: ConversationEvent;
  }): Promise<void>;
  /** Records a decision only the student can make. ADR-0049. */
  recordDecision(input: {
    readonly conversationId: string;
    readonly runId: string;
    readonly decision: StudentDecision;
  }): Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: string }>;
  /** Records a specialist's review of a case. ADR-0049 §4. */
  completeReview(input: {
    readonly caseId: CaseId;
    readonly review: HumanReviewRecord;
  }): Promise<{ readonly ok: true } | { readonly ok: false; readonly detail: string }>;
  /** Everything waiting for a specialist, oldest first. ADR-0048. */
  openInterventions(): Promise<readonly StoredIntervention[]>;
  /** Records a specialist's adjudication and lets the run continue. ADR-0048. */
  resolveIntervention(input: {
    readonly interventionId: InterventionId;
    readonly resolution: RecoveryResolution;
    readonly reusability: ReusabilityAssessment;
    readonly didHappen: boolean;
  }): Promise<StoredIntervention>;
}

/**
 * How long a runner may hold a unit of work before it returns to the pool.
 *
 * Bounded here rather than taken from the request, because the lease duration
 * is the Application Plane's risk and not the runner's: a runner that asked for
 * an hour would be a runner that could strand a student's application for an
 * hour by crashing. Five minutes is long enough to create an account on a slow
 * portal and short enough that a dead runner is not a long outage.
 */
const MAX_LEASE_SECONDS = 300;
const DEFAULT_LEASE_SECONDS = 120;

export interface ConversationRoutesOptions {
  readonly store: ConversationEventStore;
  /** Reads the `__Host-` session cookie. Null when there is no valid session. */
  readonly authenticate: (req: Request) => Promise<Caller | null> | Caller | null;
  /** True when this student may read and write this conversation. */
  readonly authorise: (caller: Caller, conversationId: string) => Promise<boolean>;
  /** True when the caller presented a permitted service certificate (mTLS). */
  readonly authoriseService?: (req: Request) => boolean;
  readonly now: () => Date;
  /** Answers a message. Replies arrive as events on the stream, not inline. */
  readonly answer?: (input: {
    readonly conversationId: string;
    readonly event: ConversationEvent;
  }) => Promise<void>;
  /**
   * Fetches a one-time bootstrap capability for an open secure request.
   *
   * ═════════════════════════════════════════════════════════════════════
   * The conversation plane never holds a secret, and it does not hold this
   * for long either: it asks the Secure Interaction Service over the internal
   * API at the moment a page mounts the frame, and hands the answer straight
   * to that page. Nothing is stored here — there is no column for it, and a
   * capability at rest in the conversation plane's database would be a
   * capability in the one place ADR-0037 keeps free of them.
   * ═════════════════════════════════════════════════════════════════════
   *
   * Returns null when the request is unknown, settled or expired.
   */
  readonly mintFrameToken?: (requestId: string) => Promise<string | null>;
  /** The secure plane's origin, handed to the page so it can check messages. */
  readonly secureOrigin?: string;
  /**
   * Starts and advances application runs (P1).
   *
   * A PORT, and optional, so every existing composition of these routes still
   * works: a deployment that only carries conversations answers 503 on the run
   * endpoint rather than failing to start. The driver COORDINATES; the
   * orchestrator decides — see `run-driver.ts` for why nothing in this file
   * branches on what a run should do next.
   */
  readonly runs?: RunCoordinator;
  /** How often the stream re-reads the log to catch another instance's writes. */
  readonly pollIntervalMs?: number;
  readonly heartbeatIntervalMs?: number;
  /**
   * How long one stream connection may live before the server closes it.
   *
   * ═════════════════════════════════════════════════════════════════════
   * Vahid, 2026-08-28 (contract phase): *"Assume multiple service instances
   * and rolling deployments."*
   * ═════════════════════════════════════════════════════════════════════
   *
   * An SSE connection is open indefinitely by design, and that is exactly what
   * stops an instance from draining: a rolling deployment cannot retire a pod
   * that is holding streams no one will ever close. Load balancers cap
   * connection age for the same reason, and a connection the balancer cuts is
   * indistinguishable to the client from one this closes.
   *
   * So the server closes them itself, on a schedule it controls, and the
   * browser reconnects with `Last-Event-ID`. Nothing is lost, because the
   * ordinal the client last saw is exactly where the next connection resumes —
   * which is the property ADR-0035 exists to provide, and this is what makes it
   * a routine event rather than an exceptional one.
   */
  readonly maxStreamMs?: number;
}

const DEFAULT_POLL_MS = 1_000;
const DEFAULT_HEARTBEAT_MS = 15_000;
/**
 * Five minutes. Long enough that a reconnect is rare, short enough that a
 * rolling deployment drains an instance in a bounded time rather than waiting
 * on whichever client happens to close last.
 */
const DEFAULT_MAX_STREAM_MS = 300_000;

function problem(res: Response, code: ProblemCode, extra: Record<string, unknown> = {}): void {
  res
    .status(PROBLEM_STATUS[code])
    .type("application/problem+json")
    .json({
      type: problemTypeFor(code),
      title: PROBLEM_TITLES[code],
      status: PROBLEM_STATUS[code],
      code,
      instance: String(res.getHeader("x-request-id") ?? "unknown"),
      ...extra,
    });
}

function readString(body: unknown, key: string): string | null {
  if (typeof body !== "object" || body === null) return null;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

/**
 * Turns an internal append request into an appendable event, or refuses it.
 *
 * Everything is parsed against a closed set. Deliberately absent from every
 * branch: any field the caller might have sent for `ordinal`, `createdAt` or
 * `id`. They are not read, so they cannot become authoritative.
 */
function parseSecureAppend(body: unknown): AppendableEvent | null {
  const kind = readString(body, "kind");
  const requestId = readString(body, "requestId");
  if (kind === null || requestId === null) return null;

  switch (kind) {
    case "secret_requested": {
      const expiresAt = readString(body, "expiresAt");
      const channel = readString(body, "channel");
      if (expiresAt === null || channel !== "secure_control") return null;
      return { kind, requestId, channel: "secure_control", expiresAt };
    }
    case "secret_received": {
      const handle = readString(body, "handle");
      return handle === null ? null : { kind, requestId, handle };
    }
    case "secret_rejected": {
      const reason = parseRejectionReason((body as Record<string, unknown>)["reason"]);
      return reason === null ? null : { kind, requestId, reason };
    }
    case "secret_consumed":
    case "secret_expired":
    case "secret_cancelled":
      return { kind, requestId };
    default:
      return null;
  }
}

/**
 * A specialist's review, from bytes, or a refusal.
 *
 * Everything against a closed set. `reviewedAt` is the SERVICE's clock, never
 * the caller's: a review whose time a client could choose is a review that
 * could be backdated to before the trigger it clears.
 *
 * `reviewerId` is asserted, not authenticated, exactly as ADR-0048 §3 records
 * for a resolution — and the domain says of this same field that it must be *a
 * named individual, never a shared account*. Both statements are true at once
 * today, and the second one is why the first has a condition that ends it: a
 * second specialist existing at all.
 */
function parseReview(body: unknown, now: Date): HumanReviewRecord | null {
  const reviewerId = readString(body, "reviewerId");
  const outcomeRaw = (body as Record<string, unknown> | null)?.["outcome"];
  const outcome =
    outcomeRaw === "approved" || outcomeRaw === "rejected" || outcomeRaw === "changes_requested"
      ? outcomeRaw
      : null;
  const triggersRaw = (body as Record<string, unknown> | null)?.["triggers"];
  if (reviewerId === null || outcome === null || !Array.isArray(triggersRaw)) return null;

  const triggers: ReviewTrigger[] = [];
  for (const candidate of triggersRaw) {
    if (!isReviewTrigger(candidate)) return null;
    triggers.push(candidate);
  }
  if (triggers.length === 0) return null;

  const notes = readString(body, "notes");
  return {
    reviewerId,
    reviewedAt: now,
    triggers,
    outcome,
    ...(notes === null ? {} : { notes }),
  };
}

/**
 * An intervention as a specialist reads it.
 *
 * A projection, not the record. What is dropped is the point: the stored
 * `context` and the resolution's prose stay on the server, and nothing shaped
 * like a position is here to be honoured by a caller (ADR-0048 §5).
 */
function onTheWire(record: StoredIntervention): OpenIntervention {
  return {
    interventionId: record.interventionId,
    runId: record.runId,
    caseId: record.caseId,
    studentRef: record.studentRef,
    priority: record.escalation.priority,
    reason: record.escalation.reason,
    action: record.escalation.checkpoint.action,
    target: record.escalation.checkpoint.target,
    portal: record.context.portal,
    phase: record.escalation.checkpoint.phase,
    encountered: record.escalation.encountered,
    expected: record.escalation.expected,
    raisedAt: record.escalation.raisedAt.toISOString(),
    announced: record.announcedAt !== undefined,
  };
}

export function createConversationRoutes(options: ConversationRoutesOptions): Router {
  const router = makeRouter();
  const pollMs = options.pollIntervalMs ?? DEFAULT_POLL_MS;
  const heartbeatMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_MS;
  const maxStreamMs = options.maxStreamMs ?? DEFAULT_MAX_STREAM_MS;

  /** Authenticates, then authorises. Returns null having already answered. */
  async function caller(req: Request, res: Response, conversationId: string): Promise<Caller | null> {
    const authenticated = await options.authenticate(req);
    if (authenticated === null) {
      problem(res, "unauthenticated");
      return null;
    }
    if (!(await options.authorise(authenticated, conversationId))) {
      // 404, never 403. A 403 confirms the conversation exists, which is a
      // fact about another student.
      problem(res, "not_found");
      return null;
    }
    return authenticated;
  }

  // ── POST /v1/conversations/:id/messages ─────────────────────────────────
  router.post(
    "/v1/conversations/:conversationId/messages",
    (req: Request, res: Response, next: NextFunction): void => {
      void (async (): Promise<void> => {
        const conversationId = String(req.params["conversationId"]);
        const who = await caller(req, res, conversationId);
        if (who === null) return;

        const key = req.header("Idempotency-Key");
        if (key === undefined || key.length < 16 || key.length > 128) {
          problem(res, "validation_failed", { pointers: ["/headers/Idempotency-Key"] });
          return;
        }

        // ── THE GUARD ───────────────────────────────────────────────────
        //
        // Ahead of reading `content`. The refused path never has the text in
        // scope, so there is no variable holding a mistyped password to be
        // logged, echoed or serialised into an error.
        const open = await options.store.openSecretRequest(conversationId, options.now());
        if (open !== null) {
          // ── problem+json, because the CONTRACT says so ─────────────────
          //
          // This route used to answer a 409 with its own envelope —
          // `{ status: "refused", … }` as `application/json` — while
          // `conversation.v1.yaml` declared `SecretRequestOpenProblem` as
          // `application/problem+json`. Two artefacts in `packages/contracts`
          // describing one endpoint two ways, with nothing comparing them: the
          // OpenAPI tests check the two DOCUMENTS against each other and
          // against the vocabulary, and no test compared either with what the
          // service actually sends. See the note in `routes.test.ts`.
          //
          // The contract wins (ADR-0005 is contract-first), and it is also the
          // better answer: every other failure on this service is RFC 9457, and
          // one endpoint with a bespoke error envelope is a client that needs
          // two error paths. The extension members are the ones the contract
          // names — the open request and its expiry, and nothing from the body.
          problem(res, "secret_request_open", {
            requestId: open.requestId,
            expiresAt: open.expiresAt,
          });
          return;
        }

        const content = readString(req.body, "content");
        if (content === null || content.length === 0 || content.length > 8000) {
          problem(res, "validation_failed", { pointers: ["/content"] });
          return;
        }

        try {
          const written = await options.store.append({
            conversationId,
            event: { kind: "message", actor: "student", content },
            idempotency: {
              key,
              studentId: who.studentId,
              // Covers a body already held in plaintext in `message_bodies`,
              // so it reveals nothing the database does not already hold. And
              // it is only ever computed on the ACCEPTED path — the guard above
              // returns before there is a body to digest.
              digest: createHash("sha256").update(content).digest("hex"),
            },
          });

          // The EVENT, bare, exactly as `conversation.v1.yaml` declares it.
          // 201 the first time; 200 when an idempotent retry replayed a write
          // that already happened. Either way the body is the same event at the
          // same ordinal, which is what makes the retry safe to repeat.
          res.status(written.replayed ? 200 : 201).json(written.event);

          if (!written.replayed && options.answer !== undefined) {
            await options.answer({ conversationId, event: written.event });
          }
        } catch (error) {
          if (error instanceof IdempotencyConflictError) {
            problem(res, "idempotency_key_conflict");
            return;
          }
          if (error instanceof UnknownConversationError) {
            problem(res, "not_found");
            return;
          }
          throw error;
        }
      })().catch(next);
    },
  );

  // ── POST /v1/conversations/:id/runs ─────────────────────────────────────
  //
  // The student's starting action: "apply to this, for me". It creates the case
  // the conversation owns, starts a durable run against it, and asks the
  // orchestrator what happens next.
  //
  // ── No Idempotency-Key, and that is not an oversight ──────────────────
  //
  // The messages route requires one because two identical messages are two
  // different facts. This one does not, because a conversation owns AT MOST ONE
  // case — the schema says so, with a partial unique index and a composite
  // foreign key — so a client that retries a timed-out start is asking the same
  // question, not making a second request. `ApplicationBindingStore.bind` takes
  // a row lock, so two simultaneous starts cannot produce two cases either.
  // `resumed` in the response is how a caller tells which it got.
  router.post(
    "/v1/conversations/:conversationId/runs",
    (req: Request, res: Response, next: NextFunction): void => {
      void (async (): Promise<void> => {
        const conversationId = String(req.params["conversationId"]);
        // Ownership first, and through the SAME helper every other route uses:
        // 401 with no session, 404 — never 403 — for someone else's
        // conversation, because a 403 confirms it exists.
        const who = await caller(req, res, conversationId);
        if (who === null) return;

        if (options.runs === undefined) {
          problem(res, "service_unavailable");
          return;
        }

        const blueprintId = readString(req.body, "blueprintId");
        const statement = readString(req.body, "studentStatement");
        if (blueprintId === null || blueprintId.length === 0) {
          problem(res, "validation_failed", { pointers: ["/blueprintId"] });
          return;
        }
        // Required, because `openCase` refuses to build a case without request
        // evidence. Product rule 1 — explicit request before consequential
        // action, silence is not consent — is a structural precondition of the
        // domain, and this is where it stops being an assumption.
        if (statement === null || statement.length === 0 || statement.length > 2000) {
          problem(res, "validation_failed", { pointers: ["/studentStatement"] });
          return;
        }

        const outcome = await options.runs.start({
          conversationId,
          blueprintId,
          studentStatement: statement,
        });

        if (!outcome.ok) {
          switch (outcome.refusal.kind) {
            case "unknown_blueprint":
              problem(res, "not_found");
              return;
            case "unknown_conversation":
              problem(res, "not_found");
              return;
            case "case_not_bindable":
              // The conversation's student does not own that case, or another
              // conversation already does. Reported as a conflict rather than a
              // 404: the conversation exists and is theirs; the binding is what
              // cannot be made.
              problem(res, "forbidden");
              return;
            case "purpose_not_supported":
              // A specialist's problem: the orchestrator and the published
              // contract disagree about what a password may be asked for. The
              // student can do nothing with that, so it is not their 400.
              problem(res, "service_unavailable");
              return;
            case "secure_plane_unavailable":
              // The run needs a secure step and this deployment has no route to
              // one. Refused rather than skipped: a run that carried on past a
              // password it could not ask for would create an account it could
              // not sign in to.
              problem(res, "service_unavailable");
              return;
            case "unusable_mapping_set":
              // A specialist's problem, not the student's, and the detail names
              // fields of a university's form — so it stays out of the body.
              problem(res, "service_unavailable");
              return;
          }
        }

        const run: ConversationRun = {
          runId: outcome.position.runId,
          caseId: outcome.position.caseId,
          conversationId: outcome.position.conversationId,
          status: outcome.position.status,
          phase: outcome.position.phase,
          step: outcome.position.step,
          revision: outcome.position.revision,
          resumed: outcome.position.resumed,
        };
        // 201 when this call created the run, 200 when it resumed one. The
        // difference is what makes the retry story readable in a log.
        res.status(run.resumed ? 200 : 201).json(run);
      })().catch(next);
    },
  );

  // ── GET /v1/conversations/:id/secure-requests/:requestId/bootstrap ──────
  //
  // The capability that lets a page start the secure frame. Delivered in a
  // RESPONSE BODY over an authenticated same-origin fetch — never in a URL,
  // where it would reach the Referer header, browser history, an access log and
  // any shared screenshot.
  //
  // Three checks before it is minted: the caller owns the conversation, the
  // request is OPEN IN THIS CONVERSATION'S OWN LOG, and the secure service
  // still considers it live. The middle one matters most: without it a student
  // could ask for a bootstrap into someone else's secure step by naming its id.
  router.get(
    "/v1/conversations/:conversationId/secure-requests/:requestId/bootstrap",
    (req: Request, res: Response, next: NextFunction): void => {
      void (async (): Promise<void> => {
        const conversationId = String(req.params["conversationId"]);
        if ((await caller(req, res, conversationId)) === null) return;

        const requestId = String(req.params["requestId"]);
        const open = await options.store.openSecretRequest(conversationId, options.now());
        if (open === null || open.requestId !== requestId) {
          problem(res, "not_found");
          return;
        }
        if (options.mintFrameToken === undefined) {
          problem(res, "service_unavailable");
          return;
        }
        const frameToken = await options.mintFrameToken(requestId);
        if (frameToken === null) {
          problem(res, "not_found");
          return;
        }
        // `no-store`, because a capability in a cache is a capability that
        // outlives the page that asked for it.
        res.setHeader("Cache-Control", "no-store");
        res.status(200).json({
          requestId,
          frameToken,
          secureOrigin: options.secureOrigin ?? "",
          expiresAt: open.expiresAt,
        });
      })().catch(next);
    },
  );

  // ── GET /v1/conversations/:id/events ────────────────────────────────────
  router.get(
    "/v1/conversations/:conversationId/events",
    (req: Request, res: Response, next: NextFunction): void => {
      void (async (): Promise<void> => {
        const conversationId = String(req.params["conversationId"]);
        if ((await caller(req, res, conversationId)) === null) return;

        const after = Number(req.query["after"] ?? 0);
        if (!Number.isSafeInteger(after) || after < 0) {
          problem(res, "validation_failed", { pointers: ["/after"] });
          return;
        }
        const limit = Math.min(Number(req.query["limit"] ?? 200) || 200, 500);
        const events = await options.store.since(conversationId, after, limit + 1);
        res.status(200).json({
          events: events.slice(0, limit),
          hasMore: events.length > limit,
        });
      })().catch(next);
    },
  );

  // ── GET /v1/conversations/:id/stream ────────────────────────────────────
  router.get(
    "/v1/conversations/:conversationId/stream",
    (req: Request, res: Response, next: NextFunction): void => {
      void (async (): Promise<void> => {
        const conversationId = String(req.params["conversationId"]);
        if ((await caller(req, res, conversationId)) === null) return;

        // ── Resumption ───────────────────────────────────────────────────
        //
        // `Last-Event-ID` is the browser's own header, sent automatically on
        // reconnect, carrying the last `id:` it saw. Because the log is
        // append-only with DENSE ordinals, it maps onto the query with nothing
        // in between: `WHERE ordinal > $cursor`. No cursor table, no opaque
        // token, nothing that can disagree with the log.
        //
        // Client-supplied and therefore untrusted: parsed strictly, and used
        // ONLY as a lower bound inside a conversation already authorised above.
        // A hostile value cannot widen the query.
        // Header first, query second. The header is the browser's own account
        // of what THIS connection received and is sent automatically on an
        // EventSource reconnect; the query parameter is the only way a FRESH
        // EventSource — one made after a page refresh — can say where it got
        // to, because the browser API accepts no request headers. Preferring
        // the header means a live reconnect is never overridden by a stale
        // value the page computed before the connection existed.
        //
        // Both are client-supplied and both go through the same strict parse,
        // and both are used only as a lower bound inside a conversation
        // authorised above, so neither can widen the query.
        const resumeFrom =
          parseLastEventId(req.header("Last-Event-ID")) ??
          parseLastEventId(typeof req.query["lastEventId"] === "string"
            ? req.query["lastEventId"]
            : undefined) ??
          0;

        for (const [header, value] of Object.entries(SSE_RESPONSE_HEADERS)) {
          res.setHeader(header, value);
        }
        res.flushHeaders();
        res.write(renderSseResumeFrame({ resumingAfter: resumeFrom }));

        // The cursor is the highest ordinal SENT. Everything below advances it
        // and nothing else does, so no event can be delivered twice: a reconnect
        // starts from the client's cursor and the tail starts from ours.
        let cursor = resumeFrom;
        let closed = false;

        const send = (event: ConversationEvent): void => {
          if (closed || event.ordinal <= cursor) return;
          cursor = event.ordinal;
          res.write(renderSseFrame(event));
        };

        const drain = async (): Promise<void> => {
          if (closed) return;
          for (const event of await options.store.since(conversationId, cursor)) send(event);
        };

        // Backfill first, THEN subscribe — and the `ordinal <= cursor` guard in
        // `send` is what makes the overlap safe. Subscribing first would risk a
        // live event arriving before the backfill that precedes it, and
        // ordering is the one thing this stream must not get wrong.
        await drain();
        const unsubscribe = options.store.subscribe(conversationId, (event) => {
          // A live event out of order still cannot skip the queue: it is only
          // sent when it is the next one, and the poll fills any gap.
          if (event.ordinal === cursor + 1) send(event);
        });

        const poll = setInterval(() => void drain(), pollMs);
        // The drain, then the close. Ending the response with events still
        // unsent would make a client wait for the reconnect to see them, and a
        // scheduled close must not cost latency it did not have to.
        const lifetime = setTimeout(() => {
          void drain().then(() => {
            stop();
            res.end();
          });
        }, maxStreamMs);
        const heartbeat = setInterval(() => {
          if (!closed) res.write(`${SSE_HEARTBEAT_LINE}\n\n`);
        }, heartbeatMs);

        const stop = (): void => {
          closed = true;
          clearInterval(poll);
          clearInterval(heartbeat);
          clearTimeout(lifetime);
          unsubscribe();
        };
        req.on("close", stop);
        res.on("close", stop);
      })().catch(next);
    },
  );

  // ── POST /internal/v1/conversations/:id/events ──────────────────────────
  //
  // The Secure Interaction Service records a lifecycle transition. Behind
  // mutual TLS on a private subnet: with separate databases (ADR-0037) the
  // conversation service cannot read `secret_requests`, so the guard reads its
  // OWN log and the secure service keeps that log truthful.
  router.post(
    "/internal/v1/conversations/:conversationId/events",
    (req: Request, res: Response, next: NextFunction): void => {
      void (async (): Promise<void> => {
        if (options.authoriseService?.(req) !== true) {
          problem(res, "forbidden");
          return;
        }
        const conversationId = String(req.params["conversationId"]);
        const event = parseSecureAppend(req.body);
        if (event === null) {
          problem(res, "validation_failed", { pointers: ["/kind", "/requestId"] });
          return;
        }

        try {
          // Idempotent on (conversation, request, kind): the secure service may
          // retry, and a retried transition must not appear twice in a
          // transcript. Keyed on the transition itself rather than on a
          // client-generated key, because the secure service has no reason to
          // invent one and the transition is already unique.
          // `event` is narrowed to the secure kinds by `parseSecureAppend`,
          // but TypeScript keeps the whole union here. Asked through
          // `isSecureEventKind` rather than as "not a message": that
          // complement was correct only while every non-message kind was a
          // secure one, and ADR-0051 added three that are not.
          const requestId = isSecureEventKind(event.kind) && "requestId" in event
            ? event.requestId
            : null;
          const already =
            requestId === null
              ? undefined
              : (await options.store.since(conversationId, 0)).find(
                  (candidate) =>
                    candidate.kind === event.kind &&
                    "requestId" in candidate &&
                    candidate.requestId === requestId,
                );
          if (already !== undefined) {
            res.status(200).json(already);
            return;
          }
          const written = await options.store.append({ conversationId, event });
          res.status(201).json(written.event);
        } catch (error) {
          if (error instanceof UnknownConversationError) {
            problem(res, "not_found");
            return;
          }
          throw error;
        }
      })().catch(next);
    },
  );

  // ── POST /internal/v1/work/claims ───────────────────────────────────────
  //
  // ADR-0045. The Automation Runner asks for something to do. Behind mutual TLS
  // on a private subnet, and the runner has no session, no cookie and no
  // student identity — it is not acting for anybody, it is a component of this
  // system doing what the orchestrator decided.
  //
  // `204 No Content` for "nothing to do", not `404` and not an empty `200`
  // body. A poll that found no work is a successful poll, and giving it a
  // status a monitoring system reads as an error would make an idle system look
  // like a broken one.
  router.post(
    "/internal/v1/work/claims",
    (req: Request, res: Response, next: NextFunction): void => {
      void (async (): Promise<void> => {
        if (options.authoriseService?.(req) !== true) {
          problem(res, "forbidden");
          return;
        }
        if (options.runs === undefined) {
          problem(res, "service_unavailable");
          return;
        }
        const body: unknown = req.body;
        const record = (typeof body === "object" && body !== null ? body : {}) as Record<
          string,
          unknown
        >;
        const holder = record["holder"];
        if (typeof holder !== "string" || holder.length === 0 || holder.length > 128) {
          problem(res, "validation_failed", { pointers: ["/holder"] });
          return;
        }
        const asked = record["leaseSeconds"];
        const leaseSeconds =
          typeof asked === "number" && Number.isInteger(asked) && asked > 0
            ? Math.min(asked, MAX_LEASE_SECONDS)
            : DEFAULT_LEASE_SECONDS;

        const work = await options.runs.claimWork({ holder, leaseSeconds });
        if (work === null) {
          res.status(204).end();
          return;
        }
        // A lease is a capability with a deadline. Caching one would be caching
        // permission to act on a student's application after that deadline.
        res.setHeader("Cache-Control", "no-store");
        res.status(200).json(work);
      })().catch(next);
    },
  );

  // ── POST /v1/conversations/{id}/runs/{runId}/decision ──────────────────
  //
  // The one decision that is the student's alone (ADR-0049 §5).
  //
  // On the STUDENT's own authenticated session, deliberately — not the internal
  // service plane the runner and the operator use. Admitting an authorisation
  // on a service credential would make approving a real university application
  // something the operator could do on the student's behalf, which is the
  // opposite of what the authorisation ledger is for.
  router.post(
    "/v1/conversations/:conversationId/runs/:runId/decision",
    (req: Request, res: Response, next: NextFunction): void => {
      void (async (): Promise<void> => {
        const conversationId = String(req.params["conversationId"]);
        if ((await caller(req, res, conversationId)) === null) return;
        if (options.runs === undefined) {
          problem(res, "service_unavailable");
          return;
        }
        const decision = parseStudentDecision(req.body);
        if (decision === null) {
          problem(res, "validation_failed", { pointers: ["/kind", "/contentHash"] });
          return;
        }
        const recorded = await options.runs.recordDecision({
          conversationId,
          runId: String(req.params["runId"]),
          decision,
        });
        if (recorded.ok) {
          res.status(204).end();
          return;
        }
        // `content_changed` is its own answer rather than a generic refusal: a
        // client that showed a preview which has since changed must re-render
        // and ask again, not retry. Everything else is a 404 or a plain
        // refusal, and neither tells the caller anything about another
        // student's case.
        problem(res, recorded.reason === "content_changed" ? "content_changed" : "not_found");
      })().catch(next);
    },
  );

  // ── POST /internal/v1/cases/{caseId}/review ────────────────────────────
  //
  // A specialist's review, through the plane and the identity ADR-0048
  // established. Ships with the trigger-raising in ADR-0049 §4 because raising
  // a mandatory trigger with no way to clear it would deadlock every case
  // involving a minor or money — a worse failure than the one being fixed.
  router.post(
    "/internal/v1/cases/:caseId/review",
    (req: Request, res: Response, next: NextFunction): void => {
      void (async (): Promise<void> => {
        if (options.authoriseService?.(req) !== true) {
          problem(res, "forbidden");
          return;
        }
        if (options.runs === undefined) {
          problem(res, "service_unavailable");
          return;
        }
        const review = parseReview(req.body, options.now());
        if (review === null) {
          problem(res, "validation_failed", {
            pointers: ["/reviewerId", "/outcome", "/triggers", "/notes"],
          });
          return;
        }
        const done = await options.runs.completeReview({
          caseId: makeCaseId(String(req.params["caseId"])),
          review,
        });
        if (done.ok) {
          res.status(204).end();
          return;
        }
        problem(res, "validation_failed", { pointers: ["/outcome"] });
      })().catch(next);
    },
  );

  // ── GET /internal/v1/interventions ─────────────────────────────────────
  //
  // What is waiting for a specialist. ADR-0048 §1.
  //
  // Pull, not push: "open" is DERIVED from the store rather than from anything
  // a notification did or did not deliver, so no case can be lost by an alert
  // that never arrived. The alerting transport is the other half of ADR-0008
  // and is not built; when it is, it reads this.
  router.get(
    "/internal/v1/interventions",
    (req: Request, res: Response, next: NextFunction): void => {
      void (async (): Promise<void> => {
        if (options.authoriseService?.(req) !== true) {
          problem(res, "forbidden");
          return;
        }
        if (options.runs === undefined) {
          problem(res, "service_unavailable");
          return;
        }
        const open = await options.runs.openInterventions();
        res.status(200).json({ interventions: open.map(onTheWire) });
      })().catch(next);
    },
  );

  // ── POST /internal/v1/interventions/:id/resolution ─────────────────────
  //
  // A specialist's adjudication. ADR-0048 §3.
  //
  // Behind `authoriseService`, alongside the runner's routes, on the internal
  // plane ADR-0045 established. So `specialistId` is ASSERTED, not
  // authenticated: this records who CLAIMED to resolve it. Vahid approved that
  // for the current single-operator model and named the condition that ends
  // it — a second specialist existing at all, at which point authenticated
  // individual identity is a required capability and a release blocker, not a
  // deferred improvement. The route's shape does not change then; only who is
  // allowed to call it.
  router.post(
    "/internal/v1/interventions/:interventionId/resolution",
    (req: Request, res: Response, next: NextFunction): void => {
      void (async (): Promise<void> => {
        if (options.authoriseService?.(req) !== true) {
          problem(res, "forbidden");
          return;
        }
        if (options.runs === undefined) {
          problem(res, "service_unavailable");
          return;
        }
        const submission = parseResolutionSubmission(req.body);
        if (submission === null) {
          // `route_fallback` lands here too, and that is correct: it is absent
          // from the wire's closed set because ADR-0048 §4 rejects it rather
          // than implementing it partly.
          problem(res, "validation_failed", {
            pointers: ["/specialistId", "/actionsTaken", "/resolution", "/outcome", "/didHappen"],
          });
          return;
        }

        const resolution: RecoveryResolution = {
          specialistId: submission.specialistId,
          actionsTaken: submission.actionsTaken,
          resolution: submission.resolution,
          resolvedAt: options.now(),
          outcome: submission.outcome,
        };
        const reusability = {
          scope: submission.scope,
          kind: submission.kind,
          signature: submission.signature,
        } as ReusabilityAssessment;

        try {
          const resolved = await options.runs.resolveIntervention({
            interventionId: makeInterventionId(String(req.params["interventionId"])),
            resolution,
            reusability,
            didHappen: submission.didHappen,
          });
          res.status(200).json({ intervention: onTheWire(resolved) });
        } catch (error) {
          if (error instanceof InterventionNotFoundError) {
            problem(res, "not_found");
            return;
          }
          if (error instanceof InterventionAlreadyResolvedError) {
            // A 409, not a `forbidden`: the caller was allowed to ask, and
            // somebody answered first. A second adjudication is not discarded
            // silently — two specialists disagreeing is evidence.
            problem(res, "intervention_already_resolved");
            return;
          }
          if (error instanceof ResolutionOutcomeNotImplementedError) {
            problem(res, "validation_failed", { pointers: ["/outcome"] });
            return;
          }
          throw error;
        }
      })().catch(next);
    },
  );

  // ── POST /internal/v1/work/:runId/report ────────────────────────────────
  //
  // How it ended. The report does NOT move the run: what happens next is
  // `nextStep`'s decision on the next advance, from the evidence this writes.
  // A report handler that set a phase would be a second implementation of that
  // decision, written by the least trusted process in the system.
  router.post(
    "/internal/v1/work/:runId/report",
    (req: Request, res: Response, next: NextFunction): void => {
      void (async (): Promise<void> => {
        if (options.authoriseService?.(req) !== true) {
          problem(res, "forbidden");
          return;
        }
        if (options.runs === undefined) {
          problem(res, "service_unavailable");
          return;
        }
        const report = parseWorkReport(req.body);
        if (report === null) {
          problem(res, "validation_failed", { pointers: ["/leaseId", "/outcome", "/failure"] });
          return;
        }
        const accepted = await options.runs.reportWork({
          runId: String(req.params["runId"]),
          report,
        });
        if (!accepted) {
          // Not the holder: the lease expired and somebody took over, or this
          // work was already reported. `forbidden` rather than a new problem
          // code, because that is exactly what it is — the caller does not hold
          // the capability it is trying to spend. A runner reading this knows to
          // stop and poll again rather than to retry the report.
          problem(res, "forbidden");
          return;
        }
        res.status(204).end();
      })().catch(next);
    },
  );

  return router;
}
