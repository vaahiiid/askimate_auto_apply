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
  YearMonth,
  ProfileFieldKey,
  ProfileFieldType,
  ProfileFieldTypes,
  Qualification,
  UkStatusClaims,
  UkStudy,
  UkStudyLevel,
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

/**
 * The reviewed ISO 3166-1 alpha-2 table (blocker 61, decided by Vahid 2026-09-23).
 *
 * Registry vocabulary: the set of values a country-typed field may hold. In
 * this package rather than beside the catalogue's hashing because the
 * catalogue already depends on this one, and the other direction is a cycle.
 */
export type { Country } from "./countries.data.js";
export { COUNTRIES, NOT_ASSIGNED } from "./countries.data.js";
export {
  CountryTableChangedError,
  REVIEWED_COUNTRIES_HASH,
  assertCountriesUnchanged,
  canonicalCountries,
  countriesHash,
  readCountry,
} from "./countries.js";
