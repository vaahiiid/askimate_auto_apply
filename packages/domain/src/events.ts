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
import type { BlueprintVersion, CaseId, EventId, ExternalRef, InterventionId, TaskId } from "./ids.js";
import type { ReusabilityAssessment } from "./learning.js";
import type { RecoveryEscalation, RecoveryResolution } from "./recovery.js";
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

/**
 * The closed set of things only the student can do.
 *
 * Two members were added when the account lifecycle was first driven for real
 * (ADR-0050), and the omissions are worth naming because both were reachable
 * in the run vocabulary and unrepresentable here:
 *
 *   `email_verification`  the portal emailed them to confirm the address. Not
 *                         `identity_verification` — proving you receive mail at
 *                         an address is not proving who you are, and recording
 *                         one as the other would put a claim about identity in
 *                         the audit log that nobody made.
 *   `password_reset`      they set their own password through the PORTAL's own
 *                         reset flow. Required where we held a credential, and
 *                         also where the portal never verified the address —
 *                         there it is the only proof they receive mail at it
 *                         (ADR-0050).
 *   `account_handover`    they confirmed they can sign in, which is the one
 *                         handover item that cannot be observed from outside
 *                         (ADR-0020 §3).
 */
export const HANDOFF_KINDS = [
  "email_verification",
  "identity_verification",
  "mfa",
  "otp",
  "captcha",
  "payment",
  "legal_declaration",
  "password_reset",
  "account_handover",
  "final_submission",
] as const;

export type HandoffKind = (typeof HANDOFF_KINDS)[number];

/** Execution paused for something only the student can do. */
export interface HandoffRequired {
  readonly type: "HandoffRequired";
  readonly handoffKind: HandoffKind;
  /**
   * Opaque token identifying the resumable session. Never a credential.
   *
   * Derived from the run and the kind rather than minted, so raising the same
   * handoff twice is the same token — which is what makes a second raise a
   * no-op instead of a second open handoff nobody closes.
   */
  readonly handoffToken: string;
  readonly expiresAt: Date;
}

export interface HandoffCompleted {
  readonly type: "HandoffCompleted";
  readonly handoffToken: string;
  /**
   * The kind that was completed.
   *
   * On the event as well as on the raise, so a fold can answer "has the student
   * verified their email?" from the completion alone. Without it the question
   * needs the matching `HandoffRequired`, and a reader that has one event and
   * not the other gets no answer — which is exactly the position the account
   * stage derivation is in (ADR-0050).
   */
  readonly handoffKind: HandoffKind;
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

/**
 * The AI could not safely proceed. The case pauses at the exact point of
 * failure and a specialist is alerted (ADR-0008).
 *
 * Carries the full escalation — what was encountered, what was expected, and
 * the checkpoint — because that is both what the specialist needs to act and
 * what the learning loop later consumes.
 */
export interface RecoveryEscalationRaised {
  readonly type: "RecoveryEscalationRaised";
  readonly escalation: RecoveryEscalation;
}

/**
 * A specialist unblocked the case.
 *
 * The case resumes from `resolution.resumeFrom` — it does not restart, and the
 * specialist does not take over the application.
 */
export interface RecoveryResolved {
  readonly type: "RecoveryResolved";
  readonly resolution: RecoveryResolution;
}

/**
 * The intervention was recorded for the learning loop (ADR-0008).
 *
 * Capture is automatic. Use is NOT: the record starts at lifecycle `captured`
 * and cannot influence production behaviour until a human has validated and
 * published it.
 */
export interface InterventionCaptured {
  readonly type: "InterventionCaptured";
  readonly interventionId: InterventionId;
  readonly reusability: ReusabilityAssessment;
}

/**
 * A human reviewed a captured intervention and moved it along its lifecycle.
 *
 * This is the control Vahid required: the AI never changes its own production
 * behaviour without a human in this loop.
 */
export interface InterventionLifecycleChanged {
  readonly type: "InterventionLifecycleChanged";
  readonly interventionId: InterventionId;
  readonly from: string;
  readonly to: string;
  /** The named human who made the decision. Never a shared account. */
  readonly decidedBy: string;
  readonly note?: string;
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
  | RecoveryEscalationRaised
  | RecoveryResolved
  | InterventionCaptured
  | InterventionLifecycleChanged
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
