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
} from "./vault.js";
export {
  DocumentNotFoundError,
  DocumentPurgedError,
  DocumentTypeNotCoveredError,
  assertStorable,
  hasContents,
  isReusable,
  storageActivityFor,
} from "./vault.js";

export { InMemoryDocumentVault } from "./in-memory-vault.js";
