/**
 * @askimate/aas-profile — the canonical student profile.
 *
 * THE ONLY PLACE IN THE SYSTEM THAT MINTS A ConfirmedValue (ADR-0004).
 * Every value that ever reaches a university form field passes through
 * `applyConfirmation` in ./confirmation.ts.
 */

export type {
  Address,
  LanguageTestResult,
  Money,
  ProfileFieldKey,
  ProfileFieldType,
  ProfileFieldTypes,
  Qualification,
} from "./fields.js";
export type { ListValuedFieldKey } from "./fields.js";
export {
  FIELD_LABELS,
  FINANCIAL_FIELDS,
  LIST_VALUED_FIELD_KEYS,
  PROFILE_FIELD_KEYS,
  isFinancialField,
} from "./fields.js";

// ── B1 row 2, made structural (ADR-0077) ───────────────────────────────────
export type { DataCategory, OrdinaryFieldKey } from "./categories.js";
export {
  ARTICLE_9_CATEGORIES,
  CLASSIFIED_FIELD_KEYS,
  FIELD_CATEGORY,
  categoryOf,
  isExtractable,
  unextractableFields,
} from "./categories.js";

export type {
  ConfirmationDeclined,
  ConfirmationResponse,
  ConfirmationResult,
  ConfirmedField,
  StudentConfirmation,
} from "./confirmation.js";
export { applyConfirmation, isDeclined, renderForConfirmation } from "./confirmation.js";

export type { DatePattern, FormatRule, RenderRefusal, RenderResult } from "./format.js";
export { isRenderRefused, renderConfirmed, renderConfirmedItem } from "./format.js";

export type { ConfirmedProfile } from "./profile.js";
export {
  confirmField,
  confirmedFieldKeys,
  emptyProfile,
  hasField,
  missingFields,
  resolveField,
  resolveFieldWithValidity,
  revisionOf,
} from "./profile.js";

// ── ADR-0044: the confirmed profile has its own store ───────────────────────
export type { ConfirmedProfileStore, StoredProfileEntry } from "./persistence.js";
export {
  InMemoryConfirmedProfileStore,
  decodeValue,
  encodeValue,
  rehydrateConfirmed,
  rehydrateProfile,
  toStoredEntry,
} from "./persistence.js";
