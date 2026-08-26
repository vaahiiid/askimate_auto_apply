/**
 * @askimate/aas-domain — the domain core.
 *
 * Pure. Zero I/O. No database, no network, no filesystem, no clock read from
 * ambient state. Everything here is testable with no external systems, which is
 * what makes Phase 1 verifiable on a laptop (brief §11, Phase 1).
 *
 * NOTE ON WHAT IS DELIBERATELY NOT EXPORTED:
 *
 *   `Unbrand` from ./brand.js is internal. Exporting it would hand every
 *   consumer a way to strip a brand, which is exactly the control ADR-0004
 *   exists to provide. If you need a value out of a ConfirmedValue, use
 *   `unwrapConfirmed`.
 *
 *   There is NO function anywhere that turns ModelText into ConfirmedValue.
 *   That absence is the feature.
 */

export type { Brand } from "./brand.js";

export type {
  BlueprintVersion,
  CaseId,
  CourseId,
  EventId,
  ExternalRef,
  InstitutionId,
  Intake,
  StudentId,
  TaskId,
} from "./ids.js";
export {
  blueprintVersion,
  caseId,
  courseId,
  eventId,
  externalRef,
  institutionId,
  intake,
  isIntake,
  studentId,
  taskId,
} from "./ids.js";

export type {
  ConfirmationProvenance,
  ConfirmedValue,
  ExtractionOrigin,
  FieldResolution,
  FieldUnavailable,
  ModelText,
  ProposedValue,
  ProposedValueFields,
  UnavailableReason,
} from "./values.js";
export {
  fieldUnavailable,
  isConfirmed,
  isFieldUnavailable,
  modelText,
  proposeValue,
  provenanceOf,
  unwrapConfirmed,
  unwrapProposed,
} from "./values.js";

export type { CaseState, TerminalState } from "./state.js";
export {
  BLOCKED_STATES,
  CASE_STATES,
  TERMINAL_STATES,
  hasAttemptedSubmission,
  isBlockedOnHuman,
  isTerminal,
} from "./state.js";

export type {
  DiscretionaryReviewTrigger,
  HumanReviewRecord,
  MandatoryReviewTrigger,
  ReviewTrigger,
} from "./escalation.js";
export { MANDATORY_REVIEW_TRIGGERS, isMandatory, unclearedMandatoryTriggers } from "./escalation.js";

export type { IdempotencyKey, SubmissionIdentity, SubmissionKey } from "./idempotency.js";
export {
  idempotencyKey,
  identityForRetry,
  isIdempotencyKey,
  isSameSubmission,
  submissionKey,
} from "./idempotency.js";

export type {
  PriorOutcomeAssertion,
  ReapplicationActor,
  ReapplicationDecision,
  ReapplicationInstruction,
  ReapplicationRejection,
  WaitRecommendation,
} from "./reapplication.js";
export { decideReapplication, recommendWait } from "./reapplication.js";

export type {
  AuthorisationCaptured,
  AuthorisationVoided,
  BlueprintDriftDetected,
  CaseCancelled,
  CaseEvent,
  CaseEventPayload,
  CaseEventType,
  CaseOpened,
  CaseStateChanged,
  ConfirmationCaptured,
  EventActor,
  EventEnvelope,
  HandoffCompleted,
  HandoffRequired,
  HumanReviewCompleted,
  HumanReviewRequested,
  ReapplicationInstructed,
  RequestEvidence,
  RouteFallbackTriggered,
  SubmissionAttempted,
  SubmissionFailed,
  SubmissionSucceeded,
  TaskCompleted,
  TaskRaised,
} from "./events.js";
export { isEventOfType } from "./events.js";

export type { InformationSource, Task, TaskKind, TaskOwner, TaskStatus } from "./tasks.js";
export {
  STUDENT_OWNED_KINDS,
  blockingTasks,
  blocksProgressByDefault,
  isConversationalAsk,
  isUnblocked,
  openTasks,
  ownerFor,
  sourceFor,
} from "./tasks.js";

export type { GuardContext, TransitionCheck, TransitionRefusal } from "./transitions.js";
export { ALLOWED_TRANSITIONS, checkTransition, isTransitionAllowed, nextStates } from "./transitions.js";

export type { ApplicationCase, CaseIntent, Decision, DecisionRefusal } from "./machine.js";
export { MalformedEventLogError, askimateActor, decide, fold, openCase, stamp } from "./machine.js";

export type { AuditAction, AuditEntry, AuditOutcome, RedactedDetail } from "./audit.js";
export { AuditRedactionError, auditEntry } from "./audit.js";
