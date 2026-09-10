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

import type { ConversationEvent, PriorOutcome, ProblemCode } from "@askimate/aas-contracts";
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
  parsePriorOutcome,
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
  RetentionSchedule,
  WaitRecommendation,
} from "@askimate/aas-domain";
import { caseId as makeCaseId, isReviewTrigger } from "@askimate/aas-domain";
import { interventionId as makeInterventionId } from "@askimate/aas-domain";
import type { StoredIntervention } from "@askimate/aas-case-store/interventions";
import {
  InterventionAlreadyResolvedError,
  InterventionNotFoundError,
  ResolutionOutcomeNotImplementedError,
} from "@askimate/aas-case-store/interventions";

import type { ReviewedTarget } from "@askimate/aas-catalogue";
import { ambiguousGroups, isAmbiguous } from "@askimate/aas-catalogue";
import type { DocumentRecord, DocumentUpload, StorableUpload } from "@askimate/aas-documents";
import {
  DOCUMENT_LIMITS,
  DocumentTypeNotCoveredError,
  IntakeRefusedError,
  UnboundUploadError,
  UnencryptedObjectError,
  assertStorable,
  limitFor,
  openIntake,
} from "@askimate/aas-documents";
import { DeterminationDecidedAgainstError, NoLawfulBasisError } from "@askimate/aas-disclosure";
import { RetentionPolicyMissingError, RetentionRequirementUnresolvedError } from "@askimate/aas-domain";
import type { DocumentIntakePort } from "./document-intake-store.js";
import { ulid } from "./ulid.js";

import { makeOffer, verifyRequest } from "./target-offers.js";
import { encodeCursor, type ConversationRecord } from "./event-store.js";

import type { AppendableEvent, ConversationEventStore } from "./event-store.js";
import type { RunOutcome, RunReading, RunRefusal, WorkDocumentRefusal } from "./run-driver.js";
import type { WorkDocument } from "@askimate/aas-contracts";
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
/**
 * The reviewed targets a student may be offered, and nothing else.
 *
 * GATE 1 (ADR-0058). A narrow port: this path never needs a blueprint or a
 * mapping set, and one that could hand it either would invite the offer to
 * describe things a student cannot check.
 *
 * Optional on the routes, and its absence is a REFUSAL rather than a bypass —
 * the same shape as ADR-0056's identity guard. A deployment without a
 * directory cannot offer a target, so it cannot open a case.
 */
export interface TargetDirectoryPort {
  targets(): readonly ReviewedTarget[];
}

export interface RunCoordinator {
  start(input: {
    readonly conversationId: string;
    /**
     * The blueprint the ACCEPTED OFFER named.
     *
     * An internal implementation identity since ADR-0058, not a student-facing
     * authority: the route resolves it from a verified offer hash and a
     * student-supplied `blueprintId` cannot reach it. `p21-target-selection`
     * proves there is no second path.
     */
     readonly blueprintId: string;
    readonly studentStatement: string;
  }): Promise<RunOutcome>;
  /**
   * Shows the wait recommendation for a second attempt, and records that it
   * was shown. ADR-0006 rule 4.
   *
   * The target is NOT a parameter: it comes from the conversation's own
   * binding, which was made when the student asked to apply and was refused.
   */
  adviseReapplication(input: {
    readonly conversationId: string;
    readonly priorOutcome: PriorOutcome;
  }): Promise<
    | { readonly ok: true; readonly advice: WaitRecommendation; readonly priorCaseId: string }
    | { readonly ok: false; readonly refusal: RunRefusal }
  >;
  /** Opens a SECOND application on the student's explicit instruction. ADR-0006 §3. */
  reapply(input: {
    readonly conversationId: string;
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
    /** The runs the runner is signed in to (ADR-0101 §2). Required on the wire. */
    readonly sessions: readonly string[];
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
  /**
   * Where this conversation's run stands and what it is waiting for, or `null`
   * when there is no run. ADR-0060, ADR-0061.
   *
   * A READ. It does not advance the run, append an event or write a
   * checkpoint — so a client can render the journey without acting on it, and
   * without keeping its own copy of where the journey has got to.
   */
  runFor(conversationId: string): Promise<RunReading | null>;
  /**
   * What the student is being asked to authorise, and its hash. ADR-0059.
   *
   * `null` when this run is not standing at the authorisation gate — there is
   * nothing to show, which is not the same fact as an empty application.
   *
   * Both halves come from ONE read of the orchestrator's `authorise` step, so
   * the text the student sees and the hash they send back cannot come from two
   * different renderings.
   */
  previewFor(
    runId: string,
    conversationId: string,
  ): Promise<{ readonly contentHash: string; readonly presentedText: string } | null>;
  /** Records a decision only the student can make. ADR-0049. */
  recordDecision(input: {
    readonly conversationId: string;
    readonly runId: string;
    readonly decision: StudentDecision;
  }): Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: string }>;
  /** Hands a runner one document for one upload of the work it holds, after the gates. ADR-0099. */
  documentForWork(input: {
    readonly runId: string;
    readonly leaseId: string;
    readonly holder: string;
    readonly documentRef: string;
  }): Promise<{ readonly ok: true; readonly document: WorkDocument } | { readonly ok: false; readonly refusal: WorkDocumentRefusal }>;
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
  /**
   * The reviewed targets a student may be offered (ADR-0058, Gate 1).
   *
   * Absent means no target can be offered and therefore no case can open —
   * a refusal, not a bypass.
   */
  readonly targets?: TargetDirectoryPort;
  /**
   * The document transport (ADR-0090, ADR-0092).
   *
   * Absent means no document can be supplied and the two routes answer
   * `service_unavailable` — a refusal, not a bypass, and the same shape
   * `targets` uses for the same reason. A deployment that has not configured
   * a bucket must not mint upload URLs into one that is not there.
   */
  readonly documents?: DocumentIntakePort;
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

/**
 * The 409 that names the application already holding this submission identity.
 *
 * Its own helper because the two extension members are not optional decoration:
 * `AlreadyApplyingProblem` requires both, and a `problem(res, "already_applying")`
 * with the wrong extras would type-check and publish a document `parseProblem`
 * refuses. One place that assembles it, and one shape it can be.
 */
function alreadyApplying(res: Response, existingCaseId: string, concluded: boolean): void {
  problem(res, "already_applying", { existingCaseId, concluded });
}

/**
 * How a re-application refusal reaches the student.
 *
 * Enumerated over the WHOLE of `RunRefusal` rather than the members these two
 * routes can produce, because "which refusals can this path produce?" is a
 * claim that goes stale: `start` and `reapply` share `#openAndStart`, so a
 * refusal added for one is reachable from the other the moment they diverge
 * less than they look like they do.
 */
function reapplicationProblem(res: Response, refusal: RunRefusal): void {
  switch (refusal.kind) {
    case "no_prior_application":
      // There is nothing to re-apply to. A 404 rather than a 409: the student
      // has no application for this target, which is the same answer they
      // would get for a conversation that is not theirs.
      problem(res, "not_found");
      return;
    case "recommendation_not_shown":
      // ADR-0006 rule 4, and the client's remedy is to do the first half:
      // ask the student what happened, and let the system advise. A 409
      // because the request is well-formed and the exchange is incomplete.
      problem(res, "content_changed");
      return;
    case "reapplication_refused":
      // The domain refused it — an unconcluded prior case, an empty statement,
      // a recommendation shown after the fact, a case that already has a
      // successor. The detail names a case and quotes a rule, so it stays out
      // of the body (there is nowhere on the wire for a sentence, by design).
      problem(res, "forbidden");
      return;
    case "already_applying":
      // Reachable through `reapply`'s own `#openAndStart`: the ordinal it
      // derived is already claimed, which means somebody else's request opened
      // that attempt between the derivation and the claim.
      alreadyApplying(res, refusal.existingCaseId, refusal.concluded);
      return;
    case "unknown_conversation":
    case "unknown_blueprint":
      problem(res, "not_found");
      return;
    case "case_not_bindable":
      problem(res, "forbidden");
      return;
    case "email_not_verified":
      problem(res, "email_not_verified");
      return;
    case "held_for_specialist":
      problem(res, "specialist_reviewing");
      return;
    case "secure_plane_unavailable":
    case "purpose_not_supported":
    case "unusable_mapping_set":
      problem(res, "service_unavailable");
      return;
  }
}

/**
 * The storage gate's refusal, as one of three published codes (ADR-0098).
 *
 * Retention first, lawful basis second, matching the order the gate runs
 * them. Anything else is not a gate refusal and answers null, so the caller
 * treats it as the defect it is rather than as `forbidden`.
 */
function gateRefusalCode(
  error: unknown,
): "document_not_retainable" | "document_basis_undetermined" | "document_type_refused" | null {
  if (error instanceof RetentionPolicyMissingError || error instanceof RetentionRequirementUnresolvedError) {
    return "document_not_retainable";
  }
  if (error instanceof DeterminationDecidedAgainstError) return "document_type_refused";
  if (error instanceof NoLawfulBasisError || error instanceof DocumentTypeNotCoveredError) {
    return "document_basis_undetermined";
  }
  return null;
}

/**
 * The one purpose the governing schedule holds for a document type, or null.
 *
 * Null for none and for several alike: either way the declaration cannot say
 * why the document would be held without a caller stating it.
 */
function purposeFor(schedule: RetentionSchedule, documentType: string): string | null {
  const purposes = [
    ...new Set(schedule.policies.filter((p) => p.documentType === documentType).map((p) => p.purpose)),
  ];
  return purposes.length === 1 ? (purposes[0] ?? null) : null;
}

/** A stored document in the published shape (`StoredDocument`), and no wider. */
function renderDocument(record: DocumentRecord): Record<string, unknown> {
  return {
    documentId: record.documentId,
    documentType: record.documentType,
    state: record.state,
    contentHash: record.contentHash,
    contentType: record.contentType,
    sizeBytes: record.sizeBytes,
    uploadedAt: record.uploadedAt.toISOString(),
    retentionPolicyReference: record.retentionPolicyReference,
  };
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

  /** Authenticates only. For a surface that is not about one conversation. */
  async function session(req: Request, res: Response): Promise<Caller | null> {
    const authenticated = await options.authenticate(req);
    if (authenticated === null) {
      problem(res, "unauthenticated");
      return null;
    }
    return authenticated;
  }

  /** One conversation, in the published shape and no wider. */
  function renderConversation(record: ConversationRecord): Record<string, unknown> {
    return {
      id: record.id,
      title: record.title,
      createdAt: record.createdAt.toISOString(),
      lastOrdinal: record.lastOrdinal,
    };
  }

  // ── POST /v1/conversations ──────────────────────────────────────────────
  //
  // ═══════════════════════════════════════════════════════════════════════
  // ADR-0060. The first step of the journey, and until now there was no code
  // that took it: `conversation.v1.yaml` has published this operation since
  // the contract was written, and every conversation in this repository was an
  // `INSERT` in a test.
  // ═══════════════════════════════════════════════════════════════════════
  //
  // No request body. A conversation is opened, not described — a title, if one
  // is ever wanted, is something the conversation earns later. Taking a body
  // here would mean a field on the first request of the journey with nothing
  // to validate it against.
  //
  // `Idempotency-Key` is OPTIONAL and is a pure replay guard: with no body,
  // two requests carrying one key cannot disagree, so there is no conflict to
  // report. Without a key a retried create leaves a second empty conversation
  // — untidy, and not consequential: an empty conversation has no case, no run
  // and nothing typed.
  router.post(
    "/v1/conversations",
    (req: Request, res: Response, next: NextFunction): void => {
      void (async (): Promise<void> => {
        const who = await session(req, res);
        if (who === null) return;

        const key = req.header("Idempotency-Key");
        if (key !== undefined && (key.length < 16 || key.length > 128)) {
          problem(res, "validation_failed", { pointers: ["/headers/Idempotency-Key"] });
          return;
        }

        const opened = await options.store.createConversation({
          studentId: who.studentId,
          ...(key === undefined ? {} : { key }),
          now: options.now(),
        });
        // 201 for the one that was created, 200 for a replay — the same way
        // the run route distinguishes a start from a resume, so a client can
        // tell whether its retry did anything.
        res.status(opened.created ? 201 : 200).json(renderConversation(opened.conversation));
      })().catch(next);
    },
  );

  // ── GET /v1/conversations ───────────────────────────────────────────────
  //
  // This student's conversations, newest first. Scoped by the query itself
  // rather than filtered afterwards, so there is no arrangement of cursor and
  // limit that reaches another student's row.
  router.get(
    "/v1/conversations",
    (req: Request, res: Response, next: NextFunction): void => {
      void (async (): Promise<void> => {
        const who = await session(req, res);
        if (who === null) return;

        const raw = req.query["limit"];
        const limit = raw === undefined ? 25 : Number(raw);
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
          problem(res, "validation_failed", { pointers: ["/limit"] });
          return;
        }
        const cursor = typeof req.query["cursor"] === "string" ? req.query["cursor"] : undefined;
        if (cursor !== undefined && cursor.length > 256) {
          problem(res, "validation_failed", { pointers: ["/cursor"] });
          return;
        }

        const page = await options.store.listConversations({
          studentId: who.studentId,
          limit,
          ...(cursor === undefined ? {} : { cursor }),
        });
        const last = page.conversations.at(-1);
        res.status(200).json({
          conversations: page.conversations.map(renderConversation),
          // Present only when there IS another page. A cursor handed back on
          // the last page invites a client to fetch an empty one forever.
          nextCursor: page.hasMore && last !== undefined ? encodeCursor(last) : null,
          hasMore: page.hasMore,
        });
      })().catch(next);
    },
  );

  // ── GET /v1/conversations/:id ───────────────────────────────────────────
  router.get(
    "/v1/conversations/:conversationId",
    (req: Request, res: Response, next: NextFunction): void => {
      void (async (): Promise<void> => {
        const who = await session(req, res);
        if (who === null) return;

        // Read scoped to the owner, so "not yours" and "does not exist" are one
        // query and one answer — 404 either way, never a 403, because a 403
        // confirms the conversation exists.
        const found = await options.store.findConversation(
          String(req.params["conversationId"]),
          who.studentId,
        );
        if (found === null) {
          problem(res, "not_found");
          return;
        }
        res.status(200).json(renderConversation(found));
      })().catch(next);
    },
  );

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

  // ── GET /v1/application-targets ─────────────────────────────────────────
  //
  // What this system can actually apply to. GATE 1 (ADR-0058).
  //
  // A read-only view over artefacts an approval registry already vouched for:
  // P20's loader runs `checkExecutable` and `checkUsable` on every entry and
  // refuses to START if any fails, so this list cannot contain an unreviewed,
  // retired, superseded or unusable target. **Listing an approved artefact
  // neither creates nor implies approval**, and there is no second, unreviewed
  // catalogue anywhere for a target to arrive from.
  //
  // Authenticated, because it is part of a student's journey rather than public
  // reference data, and because an unauthenticated reader could enumerate which
  // institutions this system has relationships with.
  router.get(
    "/v1/application-targets",
    (req: Request, res: Response, next: NextFunction): void => {
      void (async (): Promise<void> => {
        const who = await session(req, res);
        if (who === null) return;
        if (options.targets === undefined) {
          problem(res, "service_unavailable");
          return;
        }
        const targets = options.targets.targets();
        const ambiguous = ambiguousGroups(targets);
        res.status(200).json({
          targets: targets.map((target) => ({
            blueprintId: target.blueprintId,
            institutionName: target.institutionName,
            ...(target.campus === undefined ? {} : { campus: target.campus }),
            courseName: target.courseName,
            intake: target.intake,
            intakeRef: target.intakeRef,
            route: target.route,
            portalHost: target.portalHost,
            requiredDocuments: target.requiredDocuments,
            // So a client can present the choice rather than pick one.
            needsDisambiguation: isAmbiguous(target, targets),
          })),
          ambiguousCount: ambiguous.size,
        });
      })().catch(next);
    },
  );

  // ── POST /v1/conversations/:id/target-offers ────────────────────────────
  //
  // The server resolves a chosen reviewed target and puts it to the student.
  //
  // NOT consequential: no case, no run, nothing the student is committed to.
  // What it produces is an offer — a deterministic rendering of exactly what
  // would be applied for, and the hash that a later explicit request must name.
  //
  // The body carries a `blueprintId`, and that is a LOOKUP KEY rather than an
  // authority: every field of the offer is taken from the catalogue entry it
  // resolves to, so a client sending a different id gets a different offer
  // rather than an offer it authored.
  router.post(
    "/v1/conversations/:conversationId/target-offers",
    (req: Request, res: Response, next: NextFunction): void => {
      void (async (): Promise<void> => {
        const conversationId = String(req.params["conversationId"]);
        const who = await caller(req, res, conversationId);
        if (who === null) return;
        if (options.targets === undefined) {
          problem(res, "service_unavailable");
          return;
        }

        const blueprintId = readString(req.body, "blueprintId");
        if (blueprintId === null) {
          problem(res, "validation_failed", { pointers: ["/blueprintId"] });
          return;
        }
        const disambiguated = req.body !== null && typeof req.body === "object"
          ? (req.body as Record<string, unknown>)["disambiguated"] === true
          : false;

        const made = makeOffer({
          directory: options.targets,
          chosenBlueprintId: blueprintId,
          studentId: who.studentId,
          conversationId,
          ...(disambiguated ? { disambiguated: true } : {}),
        });

        if (!made.ok) {
          if (made.refusal.kind === "unknown_target") {
            // Honest, and deliberately NOT a case. An unavailable target does
            // not become an application (ADR-0058); the student's message and
            // this reply are already the durable record of the demand.
            problem(res, "not_found");
            return;
          }
          // Ambiguity is a 409: the request is well-formed and the state of the
          // world is what prevents it, and the body names the alternatives so
          // the student can choose one.
          res.status(409).type("application/problem+json").json({
            type: "about:blank",
            title: "Several reviewed targets match",
            status: 409,
            code: "validation_failed",
            candidates: made.refusal.candidates.map((candidate) => ({
              blueprintId: candidate.blueprintId,
              route: candidate.route,
              portalHost: candidate.portalHost,
            })),
          });
          return;
        }

        // Durable, in the conversation the offer was made in. This is the audit
        // — evidence that this target was put to this student, and of which
        // reviewed content supported it — not the authority the request checks
        // against. See `verifyRequest`.
        await options.store.append({
          conversationId,
          event: {
            kind: "target_offered",
            offerHash: made.offer.offerHash,
            targetBlueprintId: made.offer.target.blueprintId,
            targetContentHash: made.offer.target.contentHash,
          },
        });
        // The prose the student reads, as an ordinary message beside it.
        await options.store.append({
          conversationId,
          event: { kind: "message", actor: "assistant", content: made.rendered },
        });

        res.status(201).json({
          offerHash: made.offer.offerHash,
          rendered: made.rendered,
          target: {
            blueprintId: made.offer.target.blueprintId,
            institutionName: made.offer.target.institutionName,
            ...(made.offer.target.campus === undefined
              ? {}
              : { campus: made.offer.target.campus }),
            courseName: made.offer.target.courseName,
            intake: made.offer.target.intake,
            intakeRef: made.offer.target.intakeRef,
            route: made.offer.target.route,
            portalHost: made.offer.target.portalHost,
          },
        });
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

        if (options.targets === undefined) {
          // A deployment with no target directory cannot have made an offer,
          // so it cannot verify one. A REFUSAL, not a bypass — the same shape
          // as ADR-0056's identity guard.
          problem(res, "service_unavailable");
          return;
        }

        // ══════════════════════════════════════════════════════════════
        // GATE 2 (ADR-0058). The body carries an OFFER HASH, never a
        // `blueprintId`: an identifier alone is exactly what must not open a
        // case, because nothing about receiving one proves the student was
        // shown what it means.
        //
        // `blueprintId` is deliberately NOT read here. A caller that sends one
        // is answered as if it sent nothing, so the old contract cannot
        // survive as a second path around this gate.
        // ══════════════════════════════════════════════════════════════
        const offerHash = readString(req.body, "offerHash");
        const statement = readString(req.body, "studentStatement");
        if (offerHash === null || !/^sha256:[0-9a-f]{64}$/.test(offerHash)) {
          problem(res, "validation_failed", { pointers: ["/offerHash"] });
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

        // Every offer THIS conversation's log says was made. Gate 2's first
        // condition: a request may only accept an offer that was actually put
        // to this student here. Read from the log rather than trusted from the
        // body, and scoped to this conversation by the query itself.
        const exchange = await options.store.targetExchange(conversationId);
        const stored = exchange
          .filter((event) => event.kind === "target_offered")
          .map((event) => event.offerHash);
        const alreadyRequested = exchange.some(
          (event) => event.kind === "target_requested" && event.offerHash === offerHash,
        );

        const verified = verifyRequest({
          directory: options.targets,
          offerHash,
          studentId: who.studentId,
          conversationId,
          stored,
        });
        if (!verified.ok) {
          // 409 for an offer that WAS made and no longer holds: the request is
          // well-formed and the world moved. 404 for one that names nothing
          // here — the same answer another student's conversation gets, so a
          // probe cannot tell "wrong owner" from "no such offer".
          if (verified.refusal.kind === "offer_no_longer_valid") {
            res.status(409).type("application/problem+json").json({
              type: "about:blank",
              title: "That offer no longer describes an available target",
              status: 409,
              code: "content_changed",
            });
          } else {
            problem(res, "not_found");
          }
          return;
        }

        // ── The student's explicit act, in the log, BEFORE the case exists ──
        //
        // Written once per offer, not once per call. This route is deliberately
        // idempotent — a conversation owns at most one case, so a client that
        // retries a timed-out start is asking the same question — and a log
        // that grew a `target_requested` on every retry would say the student
        // asked to apply five times when they asked once.
        //
        // Keyed on the OFFER, not on "has anything been requested here": a
        // request naming a DIFFERENT offer is a different fact and is recorded,
        // even though the conversation's existing case is what comes back. That
        // the log then shows a request the system did not act on is the point
        // — one case per conversation is a real constraint, and a student
        // running into it should be visible rather than silently dropped.
        if (!alreadyRequested) {
          await options.store.append({
            conversationId,
            event: { kind: "target_requested", offerHash },
          });
        }

        const outcome = await options.runs.start({
          conversationId,
          // From the VERIFIED offer, never from the request body.
          blueprintId: verified.target.blueprintId,
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
            case "email_not_verified":
              // ADR-0038's guard, ADR-0056's semantics. The student is signed
              // in; their address is not verified, or the provider gave us no
              // address or no answer. All three are stored as `false` and all
              // three are cleared the same way: verify, then sign in again.
              problem(res, "email_not_verified");
              return;
            case "unusable_mapping_set":
              // A specialist's problem, not the student's, and the detail names
              // fields of a university's form — so it stays out of the body.
              problem(res, "service_unavailable");
              return;
            case "already_applying":
              // ADR-0006, armed in P38. Not a 403 and not a 404: the student is
              // permitted and the target exists — there is already an
              // application of THEIRS for this institution, course and intake,
              // and a second one is the duplicate the brief calls
              // characteristic and catastrophic.
              //
              // It names the case, and whether it has concluded, because the
              // refusal is otherwise a dead end: a concluded application is one
              // the student may instruct a second attempt at, and a client that
              // could not tell could not offer them that.
              alreadyApplying(res, outcome.refusal.existingCaseId, outcome.refusal.concluded);
              return;
            case "held_for_specialist":
              // Unreachable from `start`, which RETURNS a held run rather than
              // refusing it (P40) — but answered correctly rather than as an
              // internal error, so that a future path reaching it tells the
              // student the true thing instead of a false one.
              problem(res, "specialist_reviewing");
              return;
            case "no_prior_application":
            case "recommendation_not_shown":
            case "reapplication_refused":
              // Unreachable from `start`, which never instructs a
              // re-application. Enumerated rather than defaulted so that
              // widening `RunRefusal` again fails the build here instead of
              // quietly rendering a new refusal as an existing one.
              problem(res, "internal_error");
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

  // ── POST /v1/conversations/:id/reapplication/prior-outcome ─────────────
  //
  // ═══════════════════════════════════════════════════════════════════════
  // The first half of ADR-0006's exchange, and it exists because rule 4 makes
  // the wait recommendation "advisory in effect but MANDATORY in presentation:
  // the system must show it before accepting the instruction, and must record
  // that it did".
  //
  // Two calls, therefore, and not as an accident of REST: the student says what
  // happened to their previous application, the system advises, and only then
  // can they instruct. Collapsing it into one would be building the thing the
  // decision forbids.
  //
  // What the student sends is the OUTCOME and nothing else. The advice is
  // composed by the driver from `recommendWait`, so there is no field through
  // which a client could claim to have shown advice it invented.
  // ═══════════════════════════════════════════════════════════════════════
  router.post(
    "/v1/conversations/:conversationId/reapplication/prior-outcome",
    (req: Request, res: Response, next: NextFunction): void => {
      void (async (): Promise<void> => {
        const conversationId = String(req.params["conversationId"]);
        const who = await caller(req, res, conversationId);
        if (who === null) return;

        if (options.runs === undefined) {
          problem(res, "service_unavailable");
          return;
        }

        const outcome = parsePriorOutcome(readString(req.body, "priorOutcome"));
        if (outcome === null) {
          problem(res, "validation_failed", { pointers: ["/priorOutcome"] });
          return;
        }

        const advised = await options.runs.adviseReapplication({
          conversationId,
          priorOutcome: outcome,
        });
        if (!advised.ok) {
          reapplicationProblem(res, advised.refusal);
          return;
        }

        res.status(200).json({
          priorCaseId: advised.priorCaseId,
          advice: advised.advice.advice,
          ...(advised.advice.suggestedIntake !== undefined
            ? { suggestedIntake: advised.advice.suggestedIntake }
            : {}),
          rationale: advised.advice.rationale,
          shownAt: advised.advice.shownAt.toISOString(),
        });
      })().catch(next);
    },
  );

  // ── POST /v1/conversations/:id/reapplication ───────────────────────────
  //
  // The second half: the student's explicit instruction, in their own words.
  //
  // It carries the statement and NOTHING else. Not the prior case — the
  // submission-key chain says which application this target already has. Not
  // the attempt ordinal — `decideReapplication` derives it. Not the outcome or
  // the recommendation — both are read back from the advice event this
  // conversation's log holds. Every one of those was a field a caller could
  // have disagreed with the system about, and ADR-0006's whole subject is the
  // one number that may only increase by one.
  router.post(
    "/v1/conversations/:conversationId/reapplication",
    (req: Request, res: Response, next: NextFunction): void => {
      void (async (): Promise<void> => {
        const conversationId = String(req.params["conversationId"]);
        const who = await caller(req, res, conversationId);
        if (who === null) return;

        if (options.runs === undefined) {
          problem(res, "service_unavailable");
          return;
        }

        const statement = readString(req.body, "studentStatement");
        if (statement === null || statement.length === 0 || statement.length > 2000) {
          problem(res, "validation_failed", { pointers: ["/studentStatement"] });
          return;
        }

        const outcome = await options.runs.reapply({ conversationId, studentStatement: statement });
        if (!outcome.ok) {
          reapplicationProblem(res, outcome.refusal);
          return;
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
        res.status(run.resumed ? 200 : 201).json(run);
      })().catch(next);
    },
  );

  // ── GET /v1/secure-origin ───────────────────────────────────────────────
  //
  // Where the secure plane is, and NOTHING else. ADR-0100.
  //
  // The bootstrap below is the mint: asking it is asking the secure service
  // to write a one-time capability. But the page has a decision to make
  // BEFORE it asks — can this page show the step at all — and one of the
  // three things that decision turns on is whether the secure origin answers.
  // The page cannot probe an origin it has not been told, and until this
  // route the only thing that told it was the mint itself. So a page that
  // could not show the step still minted a token for a frame that never
  // mounted. This read carries no capability, stores nothing and is safe to
  // answer as often as it is asked.
  router.get("/v1/secure-origin", (req: Request, res: Response, next: NextFunction): void => {
    void (async (): Promise<void> => {
      const who = await session(req, res);
      if (who === null) return;
      const origin = options.secureOrigin;
      if (origin === undefined || origin === "") {
        problem(res, "service_unavailable");
        return;
      }
      res.status(200).json({ secureOrigin: origin });
    })().catch(next);
  });

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
        // Required, not defaulted (ADR-0101 §2): a runner that did not say
        // which runs it is signed in to would be handed fills it cannot do.
        const sessions = record["sessions"];
        if (
          !Array.isArray(sessions) ||
          sessions.length > 50 ||
          !sessions.every(
            (runId) => typeof runId === "string" && runId.length > 0 && runId.length <= 64,
          )
        ) {
          problem(res, "validation_failed", { pointers: ["/sessions"] });
          return;
        }

        const work = await options.runs.claimWork({
          holder,
          leaseSeconds,
          sessions: sessions as string[],
        });
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
    // ── GET /v1/conversations/:id/runs ──────────────────────────────────────
  //
  // ═══════════════════════════════════════════════════════════════════════
  // ADR-0060. Where the application has got to, WITHOUT doing anything to it.
  //
  // Before this, `POST .../runs` was the only way to learn a run's position,
  // and it needs an `offerHash` — so a client that reloaded had to keep the
  // run id, the step and the offer hash in browser storage to know what to
  // draw. That would make the client a durable holder of workflow identity,
  // which is the one thing a client of this service must never be.
  // ═══════════════════════════════════════════════════════════════════════
  //
  // `{ run: null }` is a real answer — "you have not started one" — and a
  // different fact from 404, which stays reserved for a conversation that is
  // not yours. Same `ConversationRun` shape the POST returns, from the same
  // coordinator, so there is one projection rather than two that can drift.
  router.get(
    "/v1/conversations/:conversationId/runs",
    (req: Request, res: Response, next: NextFunction): void => {
      void (async (): Promise<void> => {
        const conversationId = String(req.params["conversationId"]);
        if ((await caller(req, res, conversationId)) === null) return;
        if (options.runs === undefined) {
          problem(res, "service_unavailable");
          return;
        }
        const reading = await options.runs.runFor(conversationId);
        // The student's position, not their data: four closed-set words, three
        // identifiers and a number. Cacheable by nothing, because it changes
        // whenever the run does.
        res.setHeader("Cache-Control", "no-store");
        res.status(200).json({
          run: reading?.run ?? null,
          // ADR-0061. What the run is waiting for the student to DO, and the
          // hash that decision must carry — so a client never computes one.
          // `null` when the run is working and nothing is being asked of them.
          pending: reading?.pending ?? null,
        });
      })().catch(next);
    },
  );

  // ── GET /v1/conversations/:id/runs/:runId/preview ───────────────────────
  //
  // ═══════════════════════════════════════════════════════════════════════
  // ADR-0059. What the student is about to authorise, in the words they will
  // read, with the hash that binds their approval to it.
  //
  // The gate this serves is the most consequential one in the system, and
  // until now it had no surface at all: the orchestrator rendered the preview,
  // the driver could read it, and no route published either — so the only code
  // that could complete an authorisation was a test that REBUILT the preview
  // from the blueprint, the mapping set and the plan. A browser holds none of
  // those and must not.
  // ═══════════════════════════════════════════════════════════════════════
  //
  // ── Why this is a projection and not a stored message ─────────────────
  //
  // `SubmissionPreview.toJSON()` throws on purpose: the plaintext may go to the
  // student and to no log, event, trace or audit record. A conversation event
  // is an event. So the preview is computed for this request and written
  // nowhere, `no-store`, and the response body is never logged.
  //
  // It also cannot go stale. `recordDecision` compares the hash against the
  // preview the orchestrator would render NOW, so a copy stored yesterday
  // would be read by a student whose approval is then refused for a mismatch
  // they cannot see. Reading and hashing are one act here.
  router.get(
    "/v1/conversations/:conversationId/runs/:runId/preview",
    (req: Request, res: Response, next: NextFunction): void => {
      void (async (): Promise<void> => {
        const conversationId = String(req.params["conversationId"]);
        if ((await caller(req, res, conversationId)) === null) return;
        if (options.runs === undefined) {
          problem(res, "service_unavailable");
          return;
        }
        const preview = await options.runs.previewFor(
          String(req.params["runId"]),
          conversationId,
        );
        // 404 for "this run is not asking you to approve anything" as well as
        // for "no such run". Deliberately the same answer: a client that could
        // tell them apart could probe which of another student's runs exist,
        // and a student has nothing to do differently in either case.
        if (preview === null) {
          problem(res, "not_found");
          return;
        }
        // The student's own data in plain text, by design (it is what they are
        // checking). It gets the same posture as the secure bootstrap: not
        // cached, not stored, not shared.
        res.setHeader("Cache-Control", "no-store");
        res.status(200).json({
          contentHash: preview.contentHash,
          hashAlgorithm: "sha256",
          presentedText: preview.presentedText,
        });
      })().catch(next);
    },
  );

  // ── POST /v1/conversations/:id/runs/:runId/decision ──────────────────────
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
        // ── Two answers a client can act on, and one that says nothing ────
        //
        // `content_changed`: the preview they showed has changed, so re-render
        // and ask again rather than retry.
        //
        // `held_for_specialist` (P40): a person is checking something, and the
        // run resumes on its own when they are done. The student was told this
        // in the conversation when it happened; a 404 here would contradict
        // that with a dead end, for a state that clears itself.
        //
        // Everything else is a 404, which tells the caller nothing about
        // another student's case.
        if (recorded.reason === "content_changed") {
          problem(res, "content_changed");
        } else if (recorded.reason === "held_for_specialist") {
          problem(res, "specialist_reviewing");
        } else {
          problem(res, "not_found");
        }
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

  // ── POST /internal/v1/work/:runId/documents/:documentRef ─────────────────
  //
  // ADR-0099. The runner holds work whose plan names an upload as a REFERENCE
  // and asks for the document. The answer is a sixty-second retrieval URL and
  // the disclosure record the gates ran over — or a refusal, in a closed set.
  // Nothing here reads a byte: the bucket hands the bytes to the runner.
  //
  // The lease travels in the body, not the URL, for the reason `report` gives.
  router.post(
    "/internal/v1/work/:runId/documents/:documentRef",
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
        const leaseId = readString(req.body, "leaseId");
        const holder = readString(req.body, "holder");
        if (leaseId === null || holder === null) {
          problem(res, "validation_failed", { pointers: ["/leaseId", "/holder"] });
          return;
        }
        const handed = await options.runs.documentForWork({
          runId: String(req.params["runId"]),
          leaseId,
          holder,
          documentRef: String(req.params["documentRef"]),
        });
        if (handed.ok) {
          res.status(200).json(handed.document);
          return;
        }
        // A closed set to a closed set. The runner reads the code and reports
        // the work as needing a person; WHY is the plane's to know, and the
        // route tests read it off the driver.
        switch (handed.refusal) {
          case "no_disclosure_port":
            problem(res, "service_unavailable");
            return;
          case "no_such_run":
          case "no_such_upload":
            problem(res, "not_found");
            return;
          case "content_changed":
            problem(res, "content_changed");
            return;
          case "not_holder":
          case "not_executing":
          case "not_authorised":
          case "disclosure_refused":
          case "transmission_refused":
            problem(res, "forbidden");
            return;
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


  // ═══════════════════════════════════════════════════════════════════════
  // The document transport (ADR-0090, ADR-0092, ADR-0093) — B4, answered
  // ═══════════════════════════════════════════════════════════════════════
  //
  // TWO STEPS, and the split is the control. `POST .../documents` declares
  // what is coming and runs the storage gates on it, and answers with a
  // pre-signed upload the browser sends the bytes on — STRAIGHT TO THE
  // BUCKET. No route on this service reads a document body any more: the
  // bytes never enter a process this repository runs (ADR-0092). The second
  // step, `POST .../documents/{intakeId}/confirm`, asks the bucket what it
  // holds and records the document only if it is exactly what was declared.
  //
  // The URL the declaration hands out is a `BoundUploadUrl`, which only
  // `mintBoundUpload` produces, and it produces one only when the signature
  // covers the checksum header (ADR-0093). An unbound URL has no path to a
  // browser: the type does not admit one.
  //
  // This is also the first production caller `assertStorable` has ever had.
  // It has been in the reachability register as declared-but-unreachable since
  // P39, because every policy blocker in front of it was open. They are all
  // answered now (ADR-0078, ADR-0087, ADR-0088, ADR-0089).

  router.post(
    "/v1/conversations/:conversationId/documents",
    (req: Request, res: Response, next: NextFunction): void => {
      void (async (): Promise<void> => {
        const conversationId = String(req.params["conversationId"]);
        const who = await caller(req, res, conversationId);
        if (who === null) return;

        const documents = options.documents;
        if (documents === undefined) {
          // No vault configured. A refusal, not a bypass — the same answer
          // `targets` gives, for the same reason.
          problem(res, "service_unavailable");
          return;
        }

        const documentType = readString(req.body, "documentType");
        const statedPurpose = readString(req.body, "purpose");
        const contentType = readString(req.body, "contentType");
        const contentHash = readString(req.body, "contentHash");
        const sizeBytes = (req.body as Record<string, unknown> | undefined)?.["sizeBytes"];

        if (documentType === null || !(documentType in DOCUMENT_LIMITS)) {
          problem(res, "validation_failed", { pointers: ["/documentType"] });
          return;
        }
        // ── The purpose is the controller's, not the student's ──────────
        //
        // A retention purpose keys a lawful-basis determination (ADR-0087):
        // it is why THIS SYSTEM holds the document, which is a decision Vahid
        // made per row, not something a person choosing a file should be
        // asked. So when the declaration does not state one, the governing
        // schedule supplies it — the one policy row for the type. A type with
        // no row, or more than one, cannot be derived and the caller is told
        // so rather than guessed for. A caller that DOES state a purpose is
        // taken at its word and the gates judge it, exactly as before.
        const purpose = statedPurpose ?? purposeFor(documents.schedule, documentType);
        if (purpose === null) {
          // No sentence on the wire (ADR-0098): the pointer says which field,
          // and the contract's description says what a caller must do.
          problem(res, "validation_failed", { pointers: ["/purpose"] });
          return;
        }
        if (contentType === null) {
          problem(res, "validation_failed", { pointers: ["/contentType"] });
          return;
        }
        if (contentHash === null) {
          problem(res, "validation_failed", { pointers: ["/contentHash"] });
          return;
        }
        if (typeof sizeBytes !== "number") {
          problem(res, "validation_failed", { pointers: ["/sizeBytes"] });
          return;
        }

        const upload = {
          studentId: who.studentId,
          documentType,
          purpose,
          contentType,
          sizeBytes,
          contentHash,
          dates: {},
        } as unknown as DocumentUpload;

        let storable: StorableUpload;
        try {
          // ── THE GATES, before any body exists ─────────────────────────
          //
          // Retention (ADR-0010, ADR-0023) and lawful basis (ADR-0022), and
          // the message is the one the gate wrote. It names the document type,
          // the activity and what is missing, because a refusal a person
          // cannot act on is a defect (ADR-0075).
          storable = assertStorable({
            schedule: documents.schedule,
            register: documents.register,
            upload,
          });
        } catch (error) {
          // ── A closed set, not the gate's sentence (ADR-0098) ───────────
          //
          // The gate writes its reason for a person, and the route tests
          // read it off the error. It does not go on the wire: `Problem`
          // carries no free text by decision, and each gate refusal is one
          // of three codes the page has words for. A gate that threw
          // something else is a defect in this mapping, and `next` makes it
          // a 500 rather than a quiet `forbidden`.
          const code = gateRefusalCode(error);
          if (code === null) {
            next(error);
            return;
          }
          problem(res, code);
          return;
        }

        try {
          const now = options.now();
          const intake = openIntake({
            intakeId: ulid(now),
            conversationId,
            upload: storable,
            contentType,
            declaredSizeBytes: sizeBytes,
            now,
          });
          // Minted BEFORE the intake is recorded: a mint that throws leaves
          // nothing behind, and an intake with no upload URL is not something
          // a confirm should ever find.
          const upload = await documents.vault.prepareUpload(intake, now);
          await documents.open(intake);

          const limit = limitFor(intake.upload.documentType);
          res.status(201).json({
            intakeId: intake.intakeId,
            expiresAt: intake.expiresAt.toISOString(),
            // The upload itself: the URL, and the headers without which the
            // bucket refuses it. STATED, because the run proved omitting or
            // altering any of them is refused (ADR-0092 §4, E6 and E7).
            upload: {
              url: upload.url,
              method: upload.method,
              headers: upload.headers,
              expiresAt: upload.expiresAt.toISOString(),
            },
            // The constraints, stated rather than guessed at.
            maxBytes: limit.maxBytes,
            acceptedContentTypes: limit.contentTypes,
            contentHash: intake.declaredHash,
            retentionPolicyReference: storable.policyReference,
          });
        } catch (error) {
          if (error instanceof IntakeRefusedError) {
            problem(res, error.code);
            return;
          }
          if (error instanceof UnboundUploadError) {
            // The presigner produced a URL that does not bind the body to the
            // hash. Not handed out; the student is told the transport is
            // unavailable, and the message names what happened for whoever
            // reads the log. A refusal, not a bypass (ADR-0093).
            problem(res, "service_unavailable");
            return;
          }
          next(error);
        }
      })().catch(next);
    },
  );

  router.post(
    "/v1/conversations/:conversationId/documents/:intakeId/confirm",
    // ── No body is read here either ──────────────────────────────────────
    //
    // `PUT …/content` used to be the one route on this service that read a
    // non-JSON body. It is gone (ADR-0092). This route takes an intake id and
    // asks the BUCKET what it holds; the browser's word that the upload
    // happened is not taken, and the browser's bytes never came this way.
    (req: Request, res: Response, next: NextFunction): void => {
      void (async (): Promise<void> => {
        const conversationId = String(req.params["conversationId"]);
        const intakeId = String(req.params["intakeId"]);
        const who = await caller(req, res, conversationId);
        if (who === null) return;

        const documents = options.documents;
        if (documents === undefined) {
          problem(res, "service_unavailable");
          return;
        }

        // Taken and removed in one operation: an intake is permission to
        // confirm one document once, and a read-then-delete leaves a window
        // in which two concurrent confirms both see it open. A confirm that
        // then finds nothing in the bucket has still spent the intake — the
        // student declares again, and the checks re-run, which is the point.
        const intake = await documents.take(conversationId, intakeId);
        if (intake === null) {
          problem(res, "intake_not_open");
          return;
        }

        try {
          const record = await documents.vault.confirmUpload(intake, options.now());
          res.status(201).json(renderDocument(record));
        } catch (error) {
          if (error instanceof IntakeRefusedError) {
            problem(res, error.code);
            return;
          }
          if (error instanceof UnencryptedObjectError) {
            // The object is there and is not under the customer-managed key.
            // A bucket fault, not the student's; the document is not
            // recorded, and the message says which key S3 reported.
            problem(res, "service_unavailable");
            return;
          }
          next(error);
        }
      })().catch(next);
    },
  );

  // ── What is held, so the page can be reloaded and still be right ─────────
  //
  // ADR-0060's rule for every screen: nothing the page shows is remembered by
  // the page. A document the student sent a minute ago is shown from THIS
  // read, not from the confirm's answer, and a reload shows the same list
  // because the list was never the page's. Per student, not per conversation:
  // documents are held for reuse across applications (B5, ADR-0078), so what
  // a student holds is the same list from every conversation they own.
  //
  // `documentTypes` is what the governing schedule has a row for — the types
  // this system can be GIVEN. It is not a promise the gates will pass: a type
  // whose determination was decided against (ADR-0088) is listed here and
  // refused at declaration, in the gate's words. The page has no vocabulary
  // of its own to draw the choice from, and must not grow one.
  router.get(
    "/v1/conversations/:conversationId/documents",
    (req: Request, res: Response, next: NextFunction): void => {
      void (async (): Promise<void> => {
        const conversationId = String(req.params["conversationId"]);
        const who = await caller(req, res, conversationId);
        if (who === null) return;

        const documents = options.documents;
        if (documents === undefined) {
          problem(res, "service_unavailable");
          return;
        }

        const held = await documents.vault.listForStudent(who.studentId);
        const documentTypes = [...new Set(documents.schedule.policies.map((p) => p.documentType))];
        res.status(200).json({ documents: held.map(renderDocument), documentTypes });
      })().catch(next);
    },
  );

  return router;
}
