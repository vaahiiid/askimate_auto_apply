/**
 * @askimate/aas-secrets — a password the model can ask for and never see.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * NOTE ON WHAT IS DELIBERATELY NOT EXPORTED — read before adding to this file.
 *
 *   There is NO `getSecret(handle): string`, and there must never be one.
 *   `SecretStore.use` hands the plaintext to a callback and never returns it.
 *   A getter would put a live password into a caller's scope, and from there
 *   into their closures, error objects and stack traces — which is the entire
 *   class of problem this package exists to remove.
 *
 *   `SecretEntry` is not exported. It is the only object that holds plaintext,
 *   and it is reachable only through the store.
 *
 *   There is no conversion between `SecretHandle` and `ConfirmedValue`, in
 *   either direction. A password is not application content: it must never
 *   appear in a submission preview, never enter the profile, and never be
 *   unwrapped by `unwrapConfirmed`. A compile-time test asserts the absence.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export type {
  SecretClaim,
  SecretHandle,
  SecretLifecycle,
  SecretPurpose,
  SecretRequestId,
  SecretTarget,
} from "./handle.js";
export {
  SECRET_LIFECYCLE,
  canTransition,
  isSecretHandle,
  isSecretRequestId,
  isTerminalLifecycle,
  parseSecretHandle,
  parseSecretRequestId,
} from "./handle.js";

export type { SecretPrompt, SecretRequest, SecretRequestRefusal } from "./request.js";
export { MAX_TTL_SECONDS, MIN_TTL_SECONDS, buildSecretPrompt } from "./request.js";

export type {
  SecretConsumer,
  SecretStatus,
  SecretStore,
  SecretUnavailable,
  SecretUse,
  SubmitRefusal,
} from "./store.js";
export { InMemorySecretStore, describeSecretUse } from "./store.js";


// ── The ephemeral encrypted vault (ADR-0034) ──────────────────────────────

export type {
  DataKey,
  DataKeyProvider,
  Envelope,
  EnvelopeCache,
  VaultRefusal,
  VaultUse,
} from "./vault.js";
export {
  EnvelopeVault,
  InMemoryEnvelopeCache,
  LocalDataKeyProvider,
  VAULT_TTL_CEILING_SECONDS,
  assertVaultIsProductionGrade,
  confirmationMatches,
} from "./vault.js";

// The production key provider is exported from its own entry point so that
// importing `@askimate/aas-secrets` does not pull the AWS SDK into a bundle
// that will never call it.

export { SECRET_PURPOSES } from "./handle.js";
