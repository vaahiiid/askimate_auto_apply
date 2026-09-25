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

/** A month of a year, for a date that has no day — a job's or a qualification's start, end or award. */
export interface YearMonth {
  readonly year: number;
  /** 1 to 12. */
  readonly month: number;
}

/**
 * A qualification (ADR-0112). Its dates are a start and an end as month and
 * year — a qualification has no meaningful day, as a job has none — and an
 * award date held on its own.
 *
 * `end` always carries a date, and the KIND is the student's own claim about
 * it: finished, still studying with an expected end, or left before finishing.
 * The third kind was read off the portal rather than imagined: Sheffield's
 * education page says *"Please also add any qualifications that you did not
 * complete or failed"* and its grade list carries *Failed to complete course*.
 *
 * `award` is the date the certificate carries, and the one date on a form most
 * likely to be compared against a document — which is what an admissions
 * office does with the claim. It is never derived from `end` (June finished,
 * November conferred), and it is optional because an absent award date claims
 * nothing: the portal's boxes are left empty.
 *
 * There is no completion year beside these. Vahid, 2026-09-15: *"beside an end
 * date it would be a second truth about one fact, and two fields that can
 * disagree is what this system refuses."*
 */
export interface Qualification {
  /** e.g. `Bachelor's degree`, `High school diploma`. */
  readonly level: string;
  /**
   * The title as awarded, e.g. `BSc`, `BA`, `BEng`, `MSc` — STATED BY THE
   * STUDENT, and distinct from `level` (ADR-0142, closing blocker 71).
   *
   * A level does not determine a title: a BA and a BSc are both bachelor's
   * degrees, and a map from the level wrote `BSc` for every one of them
   * until 2026-09-25. A portal that asks for the title reads this part and
   * nothing else; absent, the box refuses rather than guesses. Optional
   * because a qualification may carry no title at all — a school
   * certificate — and an absent title claims nothing.
   */
  readonly awardTitle?: string;
  readonly subject: string;
  readonly institution: string;
  readonly countryCode: string;
  readonly start: YearMonth;
  readonly end: { readonly kind: "completed" | "expected" | "discontinued"; readonly date: YearMonth };
  readonly award?: YearMonth;
  /** As awarded, e.g. `2:1`, `17/20`, `3.6`. Never normalised on the way in. */
  readonly grade: string;
  /**
   * The scale the grade is on, e.g. `uk_honours`, `twenty_point`, `gpa_4`.
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

/**
 * One job (ADR-0111). Designed for the general case rather than one portal:
 * Sheffield asks a start date, a title, the employer's name and address and
 * the duties; others ask an end date, whether it was full or part time, and a
 * reference contact.
 *
 * `end` is never a blank. Vahid, 2026-09-14: *"A student who leaves a field
 * empty has told us nothing, and treating that as 'still working there' is
 * exactly the silent inference this system exists not to make."* A job that
 * continues is the student's statement, `{ kind: "current" }`.
 *
 * `referee` is a third party's personal data, held only when the student gives
 * it, with `guardian.*` as the precedent — and by his word only a name and a
 * role: *"do not collect [email and phone] at all until a portal we actually
 * support asks for them… Hold what we need when we need it."*
 */
export interface EmploymentEntry {
  readonly employer: string;
  /** As the student gives it; a portal that wants it split asks through a mapping, never through us. */
  readonly employerAddress: string;
  readonly position: string;
  readonly startDate: YearMonth;
  readonly end: { readonly kind: "ended"; readonly date: YearMonth } | { readonly kind: "current" };
  readonly basis?: "full_time" | "part_time";
  /** The student's own words, confirmed verbatim; a portal's cap is the field's `maxlength`, never a trim here. */
  readonly duties: string;
  readonly referee?: { readonly name: string; readonly role?: string };
}

/**
 * One period of residence (ADR-0115): a country, from a month, to a month or
 * "current" — the shape of a job's dates (ADR-0111). A period that continues
 * is the student's statement, never a blank read as one.
 */
export interface ResidencePeriod {
  readonly countryCode: string;
  readonly from: YearMonth;
  readonly to: { readonly kind: "ended"; readonly date: YearMonth } | { readonly kind: "current" };
}

/**
 * Seven claims about the student's standing in the UK (ADR-0115), each stated
 * by them and none derived — not from the passport's issuing country, not from
 * the address. Vahid: *"a wrong yes opens a document slot the student must
 * refuse or fill."*
 */
export interface UkStatusClaims {
  readonly british_passport: boolean;
  readonly indefinite_leave: boolean;
  readonly refugee_status: boolean;
  readonly migrant_worker: boolean;
  readonly spouse_of_uk_citizen: boolean;
  readonly eu_passport: boolean;
  readonly spouse_of_eu_citizen: boolean;
}

/** The level of a student's previous study in the UK, in the registry's words. */
export type UkStudyLevel =
  | "english_language"
  | "school"
  | "foundation"
  | "study_abroad_or_exchange"
  | "university"
  | "other";

/**
 * Previous study in the UK (ADR-0115): none, or studied — with whether it was
 * on a student visa, the highest level, the qualification in the student's
 * words, the time spent on the visa, and the current visa's expiry when they
 * are studying now. `none` is a statement, as an empty list is (ADR-0113).
 *
 * The expiry is a full date: it is read off the visa, which carries one. The
 * derivation from a UK qualification is a PROPOSAL the student confirms,
 * never an answer (the `derived` origin); until the interview raises it, the
 * field is asked outright.
 */
export type UkStudy =
  | { readonly kind: "none" }
  | {
      readonly kind: "studied";
      readonly onStudentVisa: boolean;
      readonly highestLevel: UkStudyLevel;
      readonly qualification?: string;
      readonly timeOnVisa?: { readonly years: number; readonly months: number };
      readonly currentVisaExpiry?: Date;
    };

/**
 * The student's passport, or the statement that they have none (ADR-0117).
 *
 * One value, so the number, the expiry and the issuing country cannot
 * disagree and cannot each go missing on their own. Vahid, 2026-09-15: *"a
 * student who does not have a thing has three empty values and nothing
 * anywhere saying why. Fold them."* `none` is the student's statement, the
 * shape of a job's end and a qualification's end. What a portal wants typed
 * for `none` is the portal's instruction — Sheffield's is *"no passport"* —
 * and it lives in the reviewed mapping, never here.
 */
export type Passport =
  | {
      readonly kind: "held";
      readonly number: string;
      readonly expiry: Date;
      readonly issuingCountry?: string;
    }
  | { readonly kind: "none" };

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
  /** ADR-0117: held with its details, or stated as none. */
  "identity.passport": Passport;

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

  // ── Employment (ADR-0111) ────────────────────────────────────────────────
  "employment.history": readonly EmploymentEntry[];

  // ── Study intent ────────────────────────────────────────────────────────
  "study.personal_statement": string;
  "study.intended_start": string;

  // ── Finance ─────────────────────────────────────────────────────────────
  "finance.available_funds": Money;
  "finance.funding_source": string;
  "finance.sponsor_name": string;

  // ── Residence (ADR-0115) ────────────────────────────────────────────────
  /** The country of permanent residence — a statement, not the address's country. */
  "residence.country": string;
  /** Asked, never read off the history. */
  "residence.in_uk_now": boolean;
  /**
   * When the student entered the UK, as month and year. Vahid, 2026-09-15:
   * *"Sheffield asks a day because it asks a day, not because anyone knows
   * it… Holding a Date means the profile carries a day that in almost every
   * case will be invented at the point of asking."* A portal that insists on
   * a day asks the student for it, as any unavailable value.
   */
  "residence.uk_entry_date": YearMonth;
  /** Where they have lived, one period each; may be confirmed empty. */
  "residence.history": readonly ResidencePeriod[];
  /**
   * The three claims a form asks beside the history — asked, not computed
   * from it. Vahid: *"The history is what they remembered; the answer is what
   * they claim. Those are different, and only one of them is signed at the
   * bottom of an application."*
   *
   * Two are about the country of PERMANENT RESIDENCE, not the UK — renamed
   * once, from Sheffield's own script (P142): the page fills *"Have you always
   * lived in the …?"* and *"…living outside of … during the last 3 years?"*
   * with the permanent-residence country's name, *"the UK"* only when that
   * country is the United Kingdom. Vahid: *"it is asking a different question
   * and recording the answer to ours."*
   */
  "residence.always_in_residence_country": boolean;
  "residence.always_in_eu": boolean;
  "residence.outside_residence_country_last_three_years": boolean;

  // ── Immigration history ─────────────────────────────────────────────────
  "immigration.previous_uk_visas": readonly string[];
  "immigration.previous_visa_refusals": readonly string[];
  /** Seven claims, all asked, none derived (ADR-0115). */
  "immigration.uk_status": UkStatusClaims;
  /** Previous study in the UK (ADR-0115). */
  "immigration.uk_study": UkStudy;

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

/**
 * The fields whose value is a LIST — the ones a form page may repeat over
 * (ADR-0103, gap 3). Named here, beside the types, because nothing at runtime
 * can otherwise tell a list-valued key from any other, and a blueprint page
 * that repeats over a name must be refused at the parse if it is not one.
 */
export const LIST_VALUED_FIELD_KEYS = [
  "education.prior_qualifications",
  "employment.history",
  "residence.history",
  "immigration.previous_uk_visas",
  "immigration.previous_visa_refusals",
] as const satisfies readonly ProfileFieldKey[];
export type ListValuedFieldKey = (typeof LIST_VALUED_FIELD_KEYS)[number];

/**
 * The fields whose value is an ISO 3166-1 alpha-2 CODE from the reviewed table
 * (ADR-0141), not a country's name in the student's words.
 *
 * Named here for the same reason the list-valued keys are: nothing at runtime
 * can otherwise tell one of these from any other string field, and two places
 * need to — the interview, which must read what the student wrote through the
 * table, and the confirmation, which must show them a country rather than a
 * code they never typed.
 *
 * `contact.address` is NOT here: its country lives in a part (`countryCode`),
 * already read through the table since P195, and a composite is confirmed
 * part by part.
 */
export const COUNTRY_FIELD_KEYS = [
  "identity.nationality",
  "identity.country_of_birth",
  "residence.country",
] as const satisfies readonly ProfileFieldKey[];
export type CountryFieldKey = (typeof COUNTRY_FIELD_KEYS)[number];

export function isCountryField(key: ProfileFieldKey): key is CountryFieldKey {
  return (COUNTRY_FIELD_KEYS as readonly ProfileFieldKey[]).includes(key);
}
export type ProfileFieldType<K extends ProfileFieldKey> = ProfileFieldTypes[K];

/** Every field key, for iteration. */
export const PROFILE_FIELD_KEYS = [
  "identity.given_name",
  "identity.family_name",
  "identity.date_of_birth",
  "identity.nationality",
  "identity.country_of_birth",
  "identity.sex",
  "identity.passport",
  "contact.email",
  "contact.mobile",
  "contact.address",
  "education.highest_qualification",
  "education.prior_qualifications",
  "education.english_language_test",
  "employment.history",
  "study.personal_statement",
  "study.intended_start",
  "finance.available_funds",
  "finance.funding_source",
  "finance.sponsor_name",
  "residence.country",
  "residence.in_uk_now",
  "residence.uk_entry_date",
  "residence.history",
  "residence.always_in_residence_country",
  "residence.always_in_eu",
  "residence.outside_residence_country_last_three_years",
  "immigration.previous_uk_visas",
  "immigration.previous_visa_refusals",
  "immigration.uk_status",
  "immigration.uk_study",
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
  "identity.passport": "Passport",
  "contact.email": "Your personal email address",
  "contact.mobile": "Mobile number",
  "contact.address": "Home address",
  "education.highest_qualification": "Highest qualification",
  "education.prior_qualifications": "Previous qualifications",
  "education.english_language_test": "English language test result",
  "employment.history": "Employment history",
  "study.personal_statement": "Personal statement",
  "study.intended_start": "Intended start",
  "finance.available_funds": "Funds available for your studies",
  "finance.funding_source": "How your studies will be funded",
  "finance.sponsor_name": "Sponsor",
  "residence.country": "Country of permanent residence",
  "residence.in_uk_now": "Currently living in the UK",
  "residence.uk_entry_date": "When you entered the UK",
  "residence.history": "Where you have lived",
  "residence.always_in_residence_country": "Always lived in your country of permanent residence",
  "residence.always_in_eu": "Always lived in the EU",
  "residence.outside_residence_country_last_three_years": "Lived outside your country of permanent residence in the last three years",
  "immigration.previous_uk_visas": "Previous UK visas",
  "immigration.previous_visa_refusals": "Previous visa refusals",
  "immigration.uk_status": "Your status in the UK",
  "immigration.uk_study": "Previous study in the UK",
  "guardian.given_name": "Parent or guardian first name",
  "guardian.family_name": "Parent or guardian last name",
  "guardian.relationship": "Relationship to you",
  "guardian.email": "Parent or guardian email",
  "guardian.mobile": "Parent or guardian mobile",
};
