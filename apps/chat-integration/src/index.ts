/**
 * @askimate/aas-chat-integration — the boundary between AskiMate Chat and a
 * password.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠  RESEARCH BUILD — NOT THE PRODUCTION INTEGRATION.
 *
 * Built against the ARCHIVED AskiMate codebase (`archive/askimate/` in
 * vaahiiid/Universitio), which is AskiMate as of 2026-06-18. The current
 * production source for askimate.com is NOT accessible from this session —
 * see docs/production-repository-audit.md and this app's README.
 *
 * Nothing here supports a claim that production is secure, that the production
 * integration is complete, or that anything is ready for deployment.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * NOTE ON WHAT IS DELIBERATELY NOT EXPORTED:
 *
 *   Nothing here returns, holds, or can be asked for a plaintext password. The
 *   secure endpoint receives one, hands it to `SecretStore.submit`, and the
 *   call frame ends. There is no accessor, no cache and no queue.
 *
 *   `RenderDecision` has no `chat_message` member. The fallback that would
 *   send a password as an ordinary chat message is not a branch someone forgot
 *   to remove — it is a value that does not exist.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export type { ChatAppOptions } from "./app.js";
export { createChatApp, scrubParseErrorBody } from "./app.js";

export type { ConversationEventStore, StoredSecureRecord } from "./conversation-events.js";
export { DatabaseConversationEventStore, replayEvents } from "./conversation-events.js";

export type { ChatRoutesOptions } from "./chat-routes.js";
export { createChatRoutes } from "./chat-routes.js";

export type { SecretBinding, SecretBindingStore } from "./bindings.js";
export { DatabaseSecretBindingStore } from "./bindings.js";

// The decisions moved to @askimate/aas-conversation and the wire model to
// @askimate/aas-contracts during the Phase-E extraction. Re-exported here so
// this app's consumers keep one import site while it is retired.
// `ChatSendResponse` is re-exported from the CONTRACT package, not from the
// route module that used to declare it. See the note in `chat-routes.ts`.
export type { ChatSendResponse, ConversationEvent, RejectionReason }
  from "@askimate/aas-contracts";
export { REJECTION_REASONS, parseConversationEvent, parseRejectionReason }
  from "@askimate/aas-contracts";
export type {
  ClientCapabilities,
  ComposerPolicy,
  ConversationLog,
  ModelRequest,
  Position,
  RenderDecision,
  TranscriptItem,
  UnpositionedEvent,
} from "@askimate/aas-conversation";
export {
  EMPTY_LOG,
  admitDurable,
  buildModelRequest,
  composerPolicy,
  decideRendering,
  openSecretRequest,
  openSecretRequestInLog,
  persistableContent,
  projectLog,
  projectTranscript,
  renderKey,
} from "@askimate/aas-conversation";


// ── The React client ──────────────────────────────────────────────────────
//
// Exported so the browser tests build the same modules the page builds, and so
// there is one client rather than the two that let a rule drift.
export type { SecureControlProps } from "./SecureControl.js";
export { SecureControl } from "./SecureControl.js";
export type { ChatViewProps } from "./ChatView.js";
export { ChatView, DRAFT_KEY } from "./ChatView.js";
export type {
  ReceivedTurn,
  SecureTurnInput,
  SecureTurnState,
  SecureTurnTransport,
  SendOutcome,
} from "./useSecureTurn.js";
export { browserTransport, parseIncomingTurn, useSecureTurn } from "./useSecureTurn.js";


export type { AskimateUserPayload, SecretRoutesOptions, SecretSubmitResponse } from "./secret-routes.js";
export { SUBMIT_LIMIT, createSecretRoutes } from "./secret-routes.js";

export { FREE_TEXT_COLUMNS, SCHEMA_DDL } from "./schema.js";
export {
  askimateConversationEvents,
  askimateConversations,
  askimateMessages,
  askimateSecretRequests,
  askimateUsers,
} from "./schema.js";
