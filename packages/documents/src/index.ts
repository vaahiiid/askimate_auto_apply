/**
 * @askimate/aas-documents — the document vault and the validity engine.
 *
 * Phase 2 ships the vault port, an in-memory implementation, and the
 * deterministic validity engine. The S3 + KMS implementation arrives with the
 * Phase 2 infrastructure and must satisfy the same contract.
 */

export type {
  DocumentDates,
  InvalidityReason,
  ValidityAssessment,
  ValidityRule,
  ValidityRuleKind,
} from "./validity.js";
export {
  assessAll,
  assessValidity,
  failures,
  isValid,
  ruleFromRequirement,
  validUntil,
} from "./validity.js";

export type {
  DocumentId,
  DocumentRecord,
  DocumentState,
  DocumentUpload,
  DocumentVault,
  StorableUpload,
  SpecialCategoryConsent,
} from "./vault.js";
export {
  DocumentNotFoundError,
  DocumentPurgedError,
  DocumentTypeNotCoveredError,
  assertStorable,
  hasContents,
  isReusable,
  storageActivityFor,
  SpecialCategoryConsentMissingError,
} from "./vault.js";

export { InMemoryDocumentVault } from "./in-memory-vault.js";

// ── The expiry rule that makes holding safe (ADR-0078, ADR-0079) ───────────
export type {
  ExpiryChoice,
  ExpiryChoiceRecord,
  ExpiryDecision,
  ExpiryThreshold,
  ExpiryWarning,
  NoWarningReason,
} from "./expiry.js";
export {
  EXPIRY_THRESHOLDS,
  decideExpiryWarning,
  provisionalThresholds,
  recordChoice,
  thresholdFor,
  undeterminedThresholds,
} from "./expiry.js";
