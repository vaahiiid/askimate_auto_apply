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

export { InMemoryDocumentVault, InMemoryObjectStore } from "./in-memory-vault.js";
export type { FakePutResult } from "./in-memory-vault.js";

// ── The transport: how bytes arrive, and what is true before they do ───────
export type { DocumentIntake, DocumentLimit, IntakeId } from "./intake.js";
export {
  DOCUMENT_LIMITS,
  INTAKE_TTL_MS,
  IntakeRefusedError,
  limitFor,
  openIntake,
} from "./intake.js";

// ── The bound upload: a URL that cannot be minted unbound (ADR-0093) ───────
export type {
  BoundUploadUrl,
  ObjectReceipt,
  PreparedRetrieval,
  PreparedUpload,
  PresignRequest,
  Presigner,
  ReceivedUpload,
} from "./bound-upload.js";
export {
  CHECKSUM_HEADER,
  REQUIRED_SIGNED_HEADERS,
  SSE_HEADER,
  SSE_KEY_HEADER,
  UnboundUploadError,
  UnencryptedObjectError,
  assertBoundUploadUrl,
  checksumHeaderValue,
  mintBoundUpload,
  objectKeyFor,
  receiveUpload,
} from "./bound-upload.js";

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
