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
  InterventionId,
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
  interventionId,
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
  InterventionCaptured,
  InterventionLifecycleChanged,
  RecoveryEscalationRaised,
  RecoveryResolved,
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
  HandoffKind,
  HandoffRequired,
  HumanReviewCompleted,
  HumanReviewRequested,
  ReapplicationInstructed,
  RequestChannel,
  RequestEvidence,
  RouteFallbackTriggered,
  SubmissionAttempted,
  SubmissionFailed,
  SubmissionSucceeded,
  TaskCompleted,
  TaskRaised,
} from "./events.js";
export { HANDOFF_KINDS, REQUEST_CHANNELS, isEventOfType } from "./events.js";

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

export type {
  EscalationPriority,
  ExecutionCheckpoint,
  RecoveryEscalation,
  RecoveryReason,
  RecoveryResolution,
  ResolutionOutcome,
} from "./recovery.js";
export { RECOVERY_REASONS, RESOLUTION_OUTCOMES, priorityFor } from "./recovery.js";
export { REVIEW_TRIGGERS, isReviewTrigger } from "./escalation.js";

export type {
  InterventionContext,
  InterventionLifecycle,
  InterventionRecord,
  ResolutionKind,
  ReusabilityAssessment,
  ReusabilityScope,
  ReusableResolution,
} from "./learning.js";
export {
  NON_USABLE_LIFECYCLE_STATES,
  asReusable,
  canTransitionLifecycle,
  failurePointOf,
  reusableOnly,
} from "./learning.js";

export type {
  CuratedEvidence,
  OfficialEvidence,
  Requirement,
  RequirementCriticality,
  RequirementEvidence,
  RequirementScope,
  RequirementUnusableReason,
  RequirementUsability,
  VerificationStatus,
  VerifiedRequirement,
} from "./requirements.js";
export {
  DEFAULT_REVALIDATION_DAYS,
  assessUsability,
  blocksApplication,
  channelsAgree,
  inScope,
  officialSourceChanged,
  usableOnly,
  verificationStatusOf,
  verifiedRequirement,
} from "./requirements.js";

export type {
  AgeDetermination,
  ApplicationStage,
  ConditionSatisfaction,
  DateOfBirthRecord,
  DobVerificationLevel,
  MinorCondition,
  MinorConditionSet,
  MinorGateResult,
} from "./minors.js";
export { APPLICATION_STAGES, checkMinorGate, determineAge, isMinor, requiresIdentityCheck, stageReached, suggestsMinority } from "./minors.js";

export type {
  DocumentType,
  LegalHold,
  PostRetentionAction,
  RetentionDecision,
  RetentionBasis,
  RetentionBasisKind,
  RetentionPolicy,
  RetentionScheduleHistory,
  UnresolvedRetentionRequirement,
  RetentionPurpose,
  RetentionSchedule,
  RetentionTrigger,
} from "./retention.js";
export {
  RetentionPolicyMissingError,
  RetentionRequirementUnresolvedError,
  blockedByRetention,
  effectiveFor,
  decideRetention,
  findPolicy,
  requirePolicy,
  validateSchedule,
} from "./retention.js";

export type { AuditAction, AuditEntry, AuditOutcome, AuditSafeText, RedactedDetail } from "./audit.js";
export { AuditRedactionError, auditEntry, auditLabel, auditRef } from "./audit.js";

export type { RedactedValue } from "./redaction.js";
export { describeRedacted, redact, sameRedacted } from "./redaction.js";

export type {
  ActionIntent,
  CheckpointDetail,
  CheckpointValue,
  ConsequentialAction,
  ActionIdempotencyKey,
  IntentOutcome,
  IntentVerdict,
  RunId,
  WorkflowCheckpoint,
  WorkflowPhase,
  WorkflowRunRecord,
  WorkflowStatus,
} from "./workflow.js";
export {
  CHECKPOINT_SCHEMA_VERSION,
  CONSEQUENTIAL_ACTIONS,
  WORKFLOW_PHASES,
  WORKFLOW_STATUSES,
  assessIntent,
  beginCheckpoint,
  canTransitionStatus,
  idempotencyKeyFor,
  isReadableCheckpoint,
  isTerminalStatus as isTerminalWorkflowStatus,
  isVerifiable,
  runId,
} from "./workflow.js";
