/**
 * The append-only event log.
 *
 * From the master brief, §4:
 *
 *   "The event log is append-only. State is derived, events are the record."
 *   "Every case can answer, from stored data alone: what did the agent do, why,
 *    what information did it use, what happened, and what is the current state."
 *
 * Events are immutable facts about things that already happened. They are never
 * updated and never deleted. Case state is a fold over them (see `machine.ts`),
 * which is what lets a case survive process restarts, deployments and
 * multi-week waits — the brief's §4 durability requirement.
 *
 * Naming is past tense throughout, because an event that reads like a command
 * invites code that treats it as one.
 */

import type { HumanReviewRecord, ReviewTrigger } from "./escalation.js";
import type { BlueprintVersion, CaseId, EventId, ExternalRef, TaskId } from "./ids.js";
import type { ReapplicationInstruction } from "./reapplication.js";
import type { CaseState } from "./state.js";
import type { SubmissionIdentity } from "./idempotency.js";

/** Fields carried by every event. */
export interface EventEnvelope {
  readonly eventId: EventId;
  readonly caseId: CaseId;
  /**
   * Position in this case's log, starting at 1 and strictly increasing with no
   * gaps.
   *
   * Doubles as an optimistic-concurrency token: an append asserts the sequence
   * it expects, so two workers acting on the same case cannot both win. It is
   * also what AskiMate uses to discard out-of-order webhook deliveries
   * (ADR-0001).
   */
  readonly sequence: number;
  /** When the thing happened. Supplied by an injected clock, never `new Date()` inline. */
  readonly occurredAt: Date;
  /** Who or what caused it. */
  readonly actor: EventActor;
}

/**
 * The cause of an event.
 *
 * A closed union rather than a free-text string, because "who did this?" is one
 * of the five questions §4 requires every case to answer, and free text cannot
 * be relied on to answer it.
 */
export type EventActor =
  | { readonly kind: "student"; readonly externalRef: ExternalRef }
  | { readonly kind: "specialist"; readonly reviewerId: string }
  | { readonly kind: "system"; readonly component: string }
  | { readonly kind: "askimate"; readonly externalRef: ExternalRef };

// ───────────────────────────────────────────────────────────────────────────
// Event payloads
// ───────────────────────────────────────────────────────────────────────────

/**
 * A case was opened. Always the first event in a log.
 *
 * `requestEvidence` is required, which is how product rule 1 — *explicit
 * request before consequential action; silence is not consent* — becomes a
 * structural precondition rather than a policy. A case cannot exist without
 * evidence that a student asked for it.
 */
export interface CaseOpened {
  readonly type: "CaseOpened";
  readonly submissionIdentity: SubmissionIdentity;
  readonly requestEvidence: RequestEvidence;
}

/** Proof that the student explicitly asked to apply (brief §2.1). */
export interface RequestEvidence {
  readonly requestedAt: Date;
  readonly channel: "askimate_chat" | "askimate_ui" | "specialist_recorded";
  /** The conversation the request was made in, for traceability back to AskiMate. */
  readonly conversationRef?: ExternalRef;
  readonly messageRef?: ExternalRef;
  /**
   * What the student actually said.
   *
   * Not a boolean. When someone asks "why did you apply to Leeds for this
   * student?", the answer should be their own sentence.
   */
  readonly studentStatement: string;
}

/** The case moved. The single source of state change. */
export interface CaseStateChanged {
  readonly type: "CaseStateChanged";
  readonly from: CaseState;
  readonly to: CaseState;
  /** Why, in terms a human reading the audit trail can follow. */
  readonly reason: string;
}

/** Work was raised for a person or the system. */
export interface TaskRaised {
  readonly type: "TaskRaised";
  readonly taskId: TaskId;
  readonly taskKind: string;
  readonly description: string;
  readonly blocksProgress: boolean;
}

export interface TaskCompleted {
  readonly type: "TaskCompleted";
  readonly taskId: TaskId;
  readonly outcome: "done" | "cancelled" | "superseded";
}

/** A human review was requested (either layer — see `escalation.ts`). */
export interface HumanReviewRequested {
  readonly type: "HumanReviewRequested";
  readonly triggers: readonly ReviewTrigger[];
  /**
   * True when at least one trigger is mandatory, i.e. financial evidence or a
   * minor. Denormalised deliberately: it makes "was this escalation
   * mandatory?" answerable by reading one field of one event, without
   * re-deriving the rule that produced it.
   */
  readonly mandatory: boolean;
}

/** A human review concluded. */
export interface HumanReviewCompleted {
  readonly type: "HumanReviewCompleted";
  readonly review: HumanReviewRecord;
}

/** Execution paused for something only the student can do. */
export interface HandoffRequired {
  readonly type: "HandoffRequired";
  readonly handoffKind:
    | "identity_verification"
    | "mfa"
    | "otp"
    | "captcha"
    | "payment"
    | "legal_declaration"
    | "final_submission";
  /** Opaque token identifying the resumable session. Never a credential. */
  readonly handoffToken: string;
  readonly expiresAt: Date;
}

export interface HandoffCompleted {
  readonly type: "HandoffCompleted";
  readonly handoffToken: string;
}

/**
 * The student authorised submission of specific content.
 *
 * `contentHash` is a hash of exactly what they were shown. If the prepared
 * content later differs from this hash the authorisation is void and must be
 * obtained again (brief §7) — an engineering control for reversibility, not a
 * formality.
 */
export interface AuthorisationCaptured {
  readonly type: "AuthorisationCaptured";
  readonly contentHash: string;
  readonly hashAlgorithm: "sha256";
  readonly authorisedAt: Date;
}

/** A previously captured authorisation stopped being valid. */
export interface AuthorisationVoided {
  readonly type: "AuthorisationVoided";
  readonly previousContentHash: string;
  readonly reason: "content_changed" | "expired" | "student_revoked";
}

/** A submission was attempted. Carries the identity that makes it unique. */
export interface SubmissionAttempted {
  readonly type: "SubmissionAttempted";
  readonly submissionIdentity: SubmissionIdentity;
  readonly authorisedContentHash: string;
}

export interface SubmissionSucceeded {
  readonly type: "SubmissionSucceeded";
  readonly receiptRef: string;
}

export interface SubmissionFailed {
  readonly type: "SubmissionFailed";
  readonly reason: string;
  readonly recoverable: boolean;
}

/** Confirmation captured from the portal. Terminal for MVP purposes. */
export interface ConfirmationCaptured {
  readonly type: "ConfirmationCaptured";
  readonly confirmationRef: string;
}

/**
 * The student explicitly instructed a new application after a rejection or
 * withdrawal (ADR-0006).
 *
 * The ONLY event that may increment an attempt ordinal.
 */
export interface ReapplicationInstructed {
  readonly type: "ReapplicationInstructed";
  readonly instruction: ReapplicationInstruction;
  readonly newAttemptOrdinal: number;
}

/** Execution deviated from the blueprint (brief §3.2). */
export interface BlueprintDriftDetected {
  readonly type: "BlueprintDriftDetected";
  readonly blueprintVersion: BlueprintVersion;
  readonly description: string;
}

/** An automated route failed; falling back to assisted-manual (brief §6). */
export interface RouteFallbackTriggered {
  readonly type: "RouteFallbackTriggered";
  readonly fromRoute: "direct_portal" | "partner_portal";
  readonly reason: string;
}

/** The student stopped the application. */
export interface CaseCancelled {
  readonly type: "CaseCancelled";
  readonly reason: string;
}

/** The union of every event payload. */
export type CaseEventPayload =
  | CaseOpened
  | CaseStateChanged
  | TaskRaised
  | TaskCompleted
  | HumanReviewRequested
  | HumanReviewCompleted
  | HandoffRequired
  | HandoffCompleted
  | AuthorisationCaptured
  | AuthorisationVoided
  | SubmissionAttempted
  | SubmissionSucceeded
  | SubmissionFailed
  | ConfirmationCaptured
  | ReapplicationInstructed
  | BlueprintDriftDetected
  | RouteFallbackTriggered
  | CaseCancelled;

export type CaseEventType = CaseEventPayload["type"];

/** A complete event: envelope plus payload. */
export type CaseEvent = EventEnvelope & CaseEventPayload;

/** Narrows a `CaseEvent` to one payload type. */
export function isEventOfType<TType extends CaseEventType>(
  event: CaseEvent,
  type: TType,
): event is CaseEvent & Extract<CaseEventPayload, { type: TType }> {
  return event.type === type;
}
