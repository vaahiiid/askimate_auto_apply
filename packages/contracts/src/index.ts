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
  SECURE_EVENT_KINDS,
  TERMINAL_LIFECYCLES,
  isTerminalLifecycleWord,
  parseActor,
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
  SecretRequestedEvent,
  SecretSettledEvent,
} from "./events.js";
export {
  eventCarriesContent,
  openSecretRequest,
  parseConversationEvent,
  persistableContent,
} from "./events.js";

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
