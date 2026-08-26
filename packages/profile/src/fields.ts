/**
 * The canonical profile field registry.
 *
 * One typed map from field key to value type. Everything downstream —
 * resolution, mapping to portal fields, the interview's "what is still
 * missing?" question — derives from this, so a field cannot exist in one place
 * and not another.
 *
 * Note what is NOT here: anything about a specific university's form. Field
 * mapping (canonical → portal) is configuration in a later phase (brief §5).
 * This is the student, described once.
 */

/** Structured value types used by more than one field. */

export interface Money {
  readonly amountMinorUnits: number;
  /** ISO 4217, e.g. `GBP`. */
  readonly currency: string;
}

export interface Qualification {
  /** e.g. `Bachelor's degree`, `High school diploma`. */
  readonly level: string;
  readonly subject: string;
  readonly institution: string;
  readonly countryCode: string;
  readonly completionYear: number;
  /** As awarded, e.g. `2:1`, `17/20`, `3.6`. Never normalised on the way in. */
  readonly grade: string;
  /**
   * The scale the grade is on, e.g. `uk_honours`, `iran_20_point`, `gpa_4`.
   *
   * Kept alongside the raw grade because converting between scales is a
   * judgement, and a converted grade stored as if it were the original is
   * exactly the kind of quiet invention this system forbids. Conversion, when
   * it happens, is a mapping decision with its own provenance.
   */
  readonly gradeScale: string;
}

export interface LanguageTestResult {
  /** e.g. `IELTS Academic`, `TOEFL iBT`, `PTE Academic`. */
  readonly test: string;
  readonly overallScore: string;
  readonly componentScores: Readonly<Record<string, string>>;
  readonly testDate: Date;
  readonly certificateNumber?: string;
}

export interface Address {
  readonly line1: string;
  readonly line2?: string;
  readonly city: string;
  readonly region?: string;
  readonly postalCode: string;
  readonly countryCode: string;
}

/**
 * Every canonical field, and the type of its value.
 *
 * Adding a field here makes it visible to the resolver, the interview and the
 * mapping layer at once. Removing one is a compile error everywhere it is used.
 */
export interface ProfileFieldTypes {
  // ── Identity ────────────────────────────────────────────────────────────
  "identity.given_name": string;
  "identity.family_name": string;
  "identity.date_of_birth": Date;
  "identity.nationality": string;
  "identity.country_of_birth": string;
  "identity.sex": string;
  "identity.passport_number": string;
  "identity.passport_expiry": Date;
  "identity.passport_issuing_country": string;

  // ── Contact ─────────────────────────────────────────────────────────────
  /**
   * The student's own personal email.
   *
   * Product rule 7: this is the official contact on the application, on every
   * route — never an AskiMate address and never portal-only. Verified for
   * login by AskiMate is NOT the same consent as designating it here, so it is
   * confirmed separately (ADR-0002).
   */
  "contact.email": string;
  "contact.mobile": string;
  "contact.address": Address;

  // ── Education ───────────────────────────────────────────────────────────
  "education.highest_qualification": Qualification;
  "education.prior_qualifications": readonly Qualification[];
  "education.english_language_test": LanguageTestResult;

  // ── Study intent ────────────────────────────────────────────────────────
  "study.personal_statement": string;
  "study.intended_start": string;

  // ── Finance ─────────────────────────────────────────────────────────────
  "finance.available_funds": Money;
  "finance.funding_source": string;
  "finance.sponsor_name": string;

  // ── Immigration history ─────────────────────────────────────────────────
  "immigration.previous_uk_visas": readonly string[];
  "immigration.previous_visa_refusals": readonly string[];

  // ── Guardian, when the applicant is a minor ─────────────────────────────
  // Present because minors are supported (ADR-0013), collected only when a
  // determined condition actually requires them.
  "guardian.given_name": string;
  "guardian.family_name": string;
  "guardian.relationship": string;
  "guardian.email": string;
  "guardian.mobile": string;
}

export type ProfileFieldKey = keyof ProfileFieldTypes;
export type ProfileFieldType<K extends ProfileFieldKey> = ProfileFieldTypes[K];

/** Every field key, for iteration. */
export const PROFILE_FIELD_KEYS = [
  "identity.given_name",
  "identity.family_name",
  "identity.date_of_birth",
  "identity.nationality",
  "identity.country_of_birth",
  "identity.sex",
  "identity.passport_number",
  "identity.passport_expiry",
  "identity.passport_issuing_country",
  "contact.email",
  "contact.mobile",
  "contact.address",
  "education.highest_qualification",
  "education.prior_qualifications",
  "education.english_language_test",
  "study.personal_statement",
  "study.intended_start",
  "finance.available_funds",
  "finance.funding_source",
  "finance.sponsor_name",
  "immigration.previous_uk_visas",
  "immigration.previous_visa_refusals",
  "guardian.given_name",
  "guardian.family_name",
  "guardian.relationship",
  "guardian.email",
  "guardian.mobile",
] as const satisfies readonly ProfileFieldKey[];

/**
 * Fields that carry special-category or high-risk personal data.
 *
 * Used to route escalation: touching financial evidence is a mandatory human
 * review every time, regardless of confidence (brief §2.5).
 */
export const FINANCIAL_FIELDS = [
  "finance.available_funds",
  "finance.funding_source",
  "finance.sponsor_name",
] as const satisfies readonly ProfileFieldKey[];

const FINANCIAL_SET: ReadonlySet<ProfileFieldKey> = new Set<ProfileFieldKey>(FINANCIAL_FIELDS);

/** True when a field is financial evidence and therefore always escalates. */
export function isFinancialField(key: ProfileFieldKey): boolean {
  return FINANCIAL_SET.has(key);
}

/**
 * A human-readable label, for the interview and for the preview a student
 * authorises. Kept beside the registry so a new field cannot be added without
 * something sensible to call it.
 */
export const FIELD_LABELS: Readonly<Record<ProfileFieldKey, string>> = {
  "identity.given_name": "First name",
  "identity.family_name": "Last name",
  "identity.date_of_birth": "Date of birth",
  "identity.nationality": "Nationality",
  "identity.country_of_birth": "Country of birth",
  "identity.sex": "Sex as shown on your passport",
  "identity.passport_number": "Passport number",
  "identity.passport_expiry": "Passport expiry date",
  "identity.passport_issuing_country": "Passport issuing country",
  "contact.email": "Your personal email address",
  "contact.mobile": "Mobile number",
  "contact.address": "Home address",
  "education.highest_qualification": "Highest qualification",
  "education.prior_qualifications": "Previous qualifications",
  "education.english_language_test": "English language test result",
  "study.personal_statement": "Personal statement",
  "study.intended_start": "Intended start",
  "finance.available_funds": "Funds available for your studies",
  "finance.funding_source": "How your studies will be funded",
  "finance.sponsor_name": "Sponsor",
  "immigration.previous_uk_visas": "Previous UK visas",
  "immigration.previous_visa_refusals": "Previous visa refusals",
  "guardian.given_name": "Parent or guardian first name",
  "guardian.family_name": "Parent or guardian last name",
  "guardian.relationship": "Relationship to you",
  "guardian.email": "Parent or guardian email",
  "guardian.mobile": "Parent or guardian mobile",
};
