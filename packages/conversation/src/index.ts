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

export { openSecretRequest } from "./openness.js";

export type { ComposerPolicy } from "./composer.js";
export { composerPolicy } from "./composer.js";

export type {
  ClientCapabilities,
  RenderDecision,
  SecureStep,
  UncheckedSecureStep,
} from "./rendering.js";
export { decideRendering, refusalText } from "./rendering.js";

export type { TranscriptItem } from "./transcript.js";
export { projectTranscript } from "./transcript.js";

export type { ModelRequest } from "./model-context.js";
export { SECURE_STEP_SENTENCE, buildModelRequest, persistableContent } from "./model-context.js";
