/**
 * @askimate/aas-contracts — the wire contract, and nothing else.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * This package has NO dependencies, deliberately.
 *
 * It is consumed by two services and two browser bundles. A dependency here is
 * a dependency in all four, and one of the four is the secure control — the one
 * place in the system whose supply chain must stay inspectable by reading it.
 *
 * It also holds no behaviour. Deciding what to render, what to send the model,
 * or whether the composer may send is `packages/conversation`'s job (ADR-0039).
 * This package answers only "what may appear on the wire, and is this bytes
 * from the network a legal instance of it?".
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The OpenAPI documents in ./openapi/ are the published contract. Everything
 * here mirrors them, and `openapi.test.ts` fails the build if the two drift in
 * either direction.
 */

export type {
  Actor,
  EventKind,
  FrameInboundKind,
  FrameOutboundKind,
  ProblemCode,
  RejectionReason,
  SecretChannel,
  SecretLifecycleWord,
  TerminalLifecycle,
} from "./vocabulary.js";
export {
  ACTORS,
  EVENT_KINDS,
  FRAME_INBOUND_KINDS,
  FRAME_OUTBOUND_KINDS,
  FRAME_PROTOCOL_VERSION,
  PROBLEM_CODES,
  REJECTION_REASONS,
  SECRET_CHANNELS,
  SECRET_LIFECYCLES,
  PROPOSAL_EVENT_KINDS,
  SECURE_EVENT_KINDS,
  TARGET_EVENT_KINDS,
  TERMINAL_LIFECYCLES,
  isTerminalLifecycleWord,
  parseActor,
  isSecureEventKind,
  parseEventKind,
  parseFrameInboundKind,
  parseFrameOutboundKind,
  parseProblemCode,
  parseRejectionReason,
  parseSecretChannel,
  parseSecretLifecycle,
} from "./vocabulary.js";

export type {
  ConversationEvent,
  MessageEvent,
  Ordinal,
  SecretReceivedEvent,
  SecretRejectedEvent,
  ValueAskedEvent,
  ValueConfirmedEvent,
  ValueProposedEvent,
  ValueRejectedEvent,
  SecretRequestedEvent,
  SecretSettledEvent,
} from "./events.js";
// `openSecretRequest` and `persistableContent` used to be here. They are
// DECISIONS — is the step open, what do we store — and ADR-0040 puts decisions
// in `@askimate/aas-conversation`. What stays is the model and its parser:
// what may appear on the wire, and whether these bytes are an instance of it.
export { eventCarriesContent, parseConversationEvent } from "./events.js";

export type { ChatSendResponse } from "./chat.js";

export type {
  PlainProblem,
  Problem,
  RateLimitedProblem,
  SecretRequestOpenProblem,
  ValidationProblem,
} from "./problems.js";
export {
  PROBLEM_STATUS,
  PROBLEM_TITLES,
  PROBLEM_TYPE_BASE,
  parseProblem,
  problemTypeFor,
} from "./problems.js";

export type {
  FrameBootstrapMessage,
  FrameCancelledMessage,
  FrameEnvelope,
  FrameExpectation,
  FrameInboundMessage,
  FrameOutboundMessage,
  FrameReadyMessage,
  FrameResizeMessage,
  FrameSecretRejectedMessage,
  FrameSecretStatusMessage,
} from "./frame.js";
export { parseFrameInbound, parseFrameOutbound } from "./frame.js";

export type { SseResumeFrame } from "./sse.js";
export {
  SSE_EVENT_NAME,
  SSE_HEARTBEAT_INTERVAL_MS,
  SSE_HEARTBEAT_LINE,
  SSE_RESPONSE_HEADERS,
  SSE_RESUME_EVENT_NAME,
  parseLastEventId,
  renderSseFrame,
  renderSseResumeFrame,
} from "./sse.js";

export {
  API_VERSION,
  BREAKING_CHANGES,
  CLIENT_OBLIGATIONS,
  DEPRECATION_HEADERS,
  NON_BREAKING_CHANGES,
} from "./versioning.js";

export type {
  FillLocator,
  FillLocatorStrategy,
  FillPurpose,
  FillRefusalReason,
  NO_FILL_RESULT_FIELD_CAN_HOLD_A_VALUE,
  SecretFillRequest,
  SecretFillResult,
} from "./fill.js";
export {
  FILL_LOCATOR_STRATEGIES,
  FILL_PURPOSES,
  FILL_REFUSAL_REASONS,
  MAX_FILL_LOCATORS,
  REFUSALS_BEFORE_SPENDING,
  parseSecretFillRequest,
  parseSecretFillResult,
} from "./fill.js";

export type {
  ConversationRun,
  RunPreview,
  NO_RUN_FIELD_IS_FREE_TEXT,
  RunPhase,
  RunRefusalCode,
  RunStatus,
  RunStepKind,
} from "./runs.js";
export {
  RUN_PHASES,
  RUN_REFUSALS,
  RUN_STATUSES,
  RUN_STEP_KINDS,
  parseConversationRun,
  parseRunPreview,
} from "./runs.js";

// ── ADR-0045: the internal work API the Automation Runner pulls from ───────
export type {
  ClaimedWork,
  NO_WORK_FIELD_IS_FREE_TEXT,
  REGISTRATION_CARRIES_ONLY_TARGETS,
  RegistrationTargets,
  TransportedInstruction,
  TransportedPlan,
  TransportedProvenance,
  TransportedValue,
  WorkProvenanceSource,
  A_CONFIRMED_VALUE_CARRIES_ITS_PROVENANCE,
  WorkApproach,
  WorkFailure,
  WorkKind,
  WorkOutcome,
  WorkReport,
} from "./work.js";
export {
  WORK_APPROACHES,
  WORK_FAILURES,
  WORK_KINDS,
  WORK_PROVENANCE_SOURCES,
  WORK_OUTCOMES,
  parseClaimedWork,
  parseWorkReport,
} from "./work.js";

// ── Specialist interventions (ADR-0048) ──────────────────────────────────
export type {
  OpenIntervention,
  ResolutionSubmission,
  WireResolutionOutcome,
} from "./interventions.js";
export {
  WIRE_RESOLUTION_OUTCOMES,
  parseResolutionSubmission,
  parseWireResolutionOutcome,
} from "./interventions.js";

// ── A decision only the student can make (ADR-0049) ──────────────────────
export type { StudentDecision, StudentDecisionKind } from "./decisions.js";
export {
  STUDENT_DECISIONS,
  parseStudentDecision,
  parseStudentDecisionKind,
} from "./decisions.js";
