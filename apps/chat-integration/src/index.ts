/**
 * @askimate/aas-chat-integration — the boundary between AskiMate Chat and a
 * password.
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

export type { SecretBinding, SecretBindingStore } from "./bindings.js";
export { DatabaseSecretBindingStore } from "./bindings.js";

export type { ChatTurn, ModelRequest } from "./chat-transport.js";
export { buildModelRequest, persistableContent } from "./chat-transport.js";

export type { ClientCapabilities, RenderDecision } from "./render-decision.js";
export { chatInputEnabled, decideRendering } from "./render-decision.js";

export type { AskimateUserPayload, SecretRoutesOptions, SecretSubmitResponse } from "./secret-routes.js";
export { SUBMIT_LIMIT, createSecretRoutes } from "./secret-routes.js";

export { FREE_TEXT_COLUMNS, SCHEMA_DDL } from "./schema.js";
export {
  askimateConversations,
  askimateMessages,
  askimateSecretRequests,
  askimateUsers,
} from "./schema.js";
