/**
 * @askimate/aas-conversation — the single domain authority for conversation
 * decisions.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Five decisions live here and nowhere else:
 *
 *   openSecretRequest    is a secure step open?
 *   composerPolicy       what may the composer do about it?
 *   decideRendering      can this client show the step at all?
 *   projectTranscript    what is drawn, and in what order?
 *   buildModelRequest    what reaches the model?
 *
 * A sixth thing lives here too, and it is not a decision but a STRUCTURE: the
 * client's `ConversationLog`, which separates events the server placed from
 * entries the browser is merely drawing. It is here rather than in a client
 * because "a rendering position is not a durable ordinal" is a rule every
 * client must obey, and a rule kept in one client is a rule the next one
 * reinvents wrongly.
 *
 * Both services and both browser bundles consume THIS implementation. The
 * client and the server cannot disagree about whether a request is open,
 * because there is one function that answers it — which is the structural fix
 * for the class of bug Phase D found twice by hand.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Depends only on `@askimate/aas-contracts`, which itself has no dependencies.
 * The split is ADR-0040's: contracts describe what may appear on the wire;
 * this package decides what to do about it.
 */

export { latestSecretRequest, openSecretRequest } from "./openness.js";

export type { ComposerPolicy } from "./composer.js";
export { composerPolicy } from "./composer.js";

export type {
  ClientCapabilities,
  RenderDecision,
  SecureStep,
  UncheckedSecureStep,
} from "./rendering.js";
export { decideRendering, refusalText } from "./rendering.js";

export type { Position, TranscriptItem } from "./transcript.js";
export { durableAt, projectEvent, projectTranscript, provisionalAt, renderKey }
  from "./transcript.js";

export type { Unpositioned, UnpositionedEvent } from "./unpositioned.js";

export type { ConversationLog, ProvisionalEntry } from "./log.js";
export {
  EMPTY_LOG,
  addProvisional,
  admitAllDurable,
  admitDurable,
  describesSame,
  durableEvents,
  durableSecretRequest,
  openSecretRequestInLog,
  projectLog,
  retireProvisional,
} from "./log.js";

export type { ModelRequest } from "./model-context.js";
export { SECURE_STEP_SENTENCE, buildModelRequest, persistableContent } from "./model-context.js";
