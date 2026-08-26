/**
 * Extraction plans: what to look for on each kind of document.
 *
 * A plan is DATA. Adding a document type means adding a plan, in the same way
 * that adding a university means adding a target file (brief §3.2).
 *
 * ── Three kinds of target ─────────────────────────────────────────────────
 *
 *   scalar         one span of the document yields one profile field
 *
 *   composite      several spans, each quoted and GROUNDED SEPARATELY, then
 *                  assembled by code into one structured field
 *
 *   document_date  a date the validity engine needs (a passport's expiry, a
 *                  bank statement's closing date) rather than a profile field
 *
 * The composite case is the interesting one. A transcript's qualification is
 * institution, subject, year and grade, and asking a model to emit the whole
 * object in one go means one unquotable answer covering four separate facts —
 * exactly the shape grounding cannot check. Quoting each part separately means
 * every fact is individually traceable to a line of the document, and the
 * assembly is arithmetic rather than inference.
 */

import type { ProfileFieldKey, ProfileFieldType, Qualification } from "@askimate/aas-profile";
import type { DocumentType } from "@askimate/aas-domain";

/** Which date on the document this is, in the validity engine's terms. */
export type DocumentDateKind = "issuedAt" | "expiresAt" | "coversFrom" | "coversTo";

interface TargetCommon {
  /** Where on this kind of document the value lives. Given to the model. */
  readonly hint: string;
  /**
   * The labels this value is printed under.
   *
   * Label-first, matching the blueprint's locator strategy: a label is what the
   * document shows a reader, and it survives a change of layout that a position
   * would not. Several, because documents disagree about wording — a passport
   * says "Surname", a national ID may say "Family name".
   */
  readonly labels: readonly string[];
  /** The shape wanted back. */
  readonly expectedShape: string;
  /** Whether the application cannot proceed without it. */
  readonly required: boolean;
}

export interface ScalarTarget extends TargetCommon {
  readonly kind: "scalar";
  readonly fieldKey: ProfileFieldKey;
  readonly parse: (raw: string) => unknown;
}

export interface CompositePart extends TargetCommon {
  readonly partKey: string;
}

export interface CompositeTarget {
  readonly kind: "composite";
  readonly fieldKey: ProfileFieldKey;
  readonly parts: readonly CompositePart[];
  /** Assembles the confirmed-shape value from the grounded parts. Null if it cannot. */
  readonly assemble: (parts: ReadonlyMap<string, string>) => unknown;
  readonly required: boolean;
}

export interface DocumentDateTarget extends TargetCommon {
  readonly kind: "document_date";
  readonly dateKind: DocumentDateKind;
  readonly parse: (raw: string) => Date | null;
}

export type ExtractionTarget = ScalarTarget | CompositeTarget | DocumentDateTarget;

export interface ExtractionPlan {
  readonly documentType: DocumentType;
  readonly targets: readonly ExtractionTarget[];
}

/**
 * Builds a scalar target with the parse checked against the field's real type.
 *
 * The plan array holds heterogeneous targets, so the stored `parse` is widened
 * to `unknown`. Checking it here means a plan that parses a date into a string
 * fails to compile at the line where it is written, which is where a reader
 * would look for the mistake.
 */
function scalar<K extends ProfileFieldKey>(target: {
  readonly fieldKey: K;
  readonly labels: readonly string[];
  readonly hint: string;
  readonly expectedShape: string;
  readonly required: boolean;
  readonly parse: (raw: string) => ProfileFieldType<K> | null;
}): ScalarTarget {
  return { kind: "scalar", ...target };
}

function composite<K extends ProfileFieldKey>(target: {
  readonly fieldKey: K;
  readonly required: boolean;
  readonly parts: readonly CompositePart[];
  readonly assemble: (parts: ReadonlyMap<string, string>) => ProfileFieldType<K> | null;
}): CompositeTarget {
  return { kind: "composite", ...target };
}

// ───────────────────────────────────────────────────────────────────────────
// Parsers
// ───────────────────────────────────────────────────────────────────────────

const nonEmpty = (raw: string): string | null => {
  const value = raw.trim();
  return value.length > 0 && value.length <= 200 ? value : null;
};

const MONTHS: Readonly<Record<string, number>> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/**
 * A date as documents print them.
 *
 * Accepts ISO and the named-month forms passports and statements use
 * (`02 APR 1999`, `2 April 1999`, `Apr 2, 1999`). Refuses `02/04/1999` for the
 * same reason the conversational parser does: that is the 2nd of April here and
 * the 4th of February in America, and nothing on the page says which.
 *
 * Note this is NOT the conversational parser reimplemented. A passport prints
 * dates in a small set of standard forms that a person would never say aloud,
 * and a student never types `02 APR 1999` into a chat. The two accept different
 * things because they read different sources.
 */
const documentDate = (raw: string): Date | null => {
  const value = raw.trim();

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (iso !== null) {
    const parsed = new Date(`${value}T00:00:00Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  // 02 APR 1999 / 2 April 1999
  const dayFirst = /^(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})$/.exec(value);
  if (dayFirst !== null) {
    const [, day, month, year] = dayFirst;
    return fromParts(Number(year), month ?? "", Number(day));
  }

  // Apr 2, 1999 / April 2 1999
  const monthFirst = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(value);
  if (monthFirst !== null) {
    const [, month, day, year] = monthFirst;
    return fromParts(Number(year), month ?? "", Number(day));
  }

  return null;
};

function fromParts(year: number, monthName: string, day: number): Date | null {
  const monthIndex = MONTHS[monthName.slice(0, 3).toLowerCase()];
  if (monthIndex === undefined) return null;
  const parsed = new Date(Date.UTC(year, monthIndex, day));
  // Rejects 31 February rather than rolling it forward into March.
  if (parsed.getUTCMonth() !== monthIndex || parsed.getUTCDate() !== day) return null;
  return parsed;
}

/** A four-digit year within a plausible range for an academic award. */
const awardYear = (raw: string): number | null => {
  const match = /\b(19\d{2}|20\d{2})\b/.exec(raw.trim());
  if (match === null) return null;
  return Number(match[1]);
};

/**
 * A passport number.
 *
 * Alphanumeric, 6–12 characters, no spaces. Deliberately does not "clean up"
 * a value that does not fit: a passport number the system has quietly modified
 * is worse than one it refused to read.
 */
const passportNumber = (raw: string): string | null => {
  const value = raw.trim().toUpperCase();
  return /^[A-Z0-9]{6,12}$/.test(value) ? value : null;
};

// ───────────────────────────────────────────────────────────────────────────
// The plans
// ───────────────────────────────────────────────────────────────────────────

const PASSPORT: ExtractionPlan = {
  documentType: "passport",
  targets: [
    scalar({
      fieldKey: "identity.given_name",
      labels: ["Given names", "Given name", "Forenames", "First name"],
      hint: "the holder's given names, as printed on the biographical data page",
      expectedShape: "one or more given names",
      required: true,
      parse: nonEmpty,
    }),
    scalar({
      fieldKey: "identity.family_name",
      labels: ["Surname", "Family name", "Last name"],
      hint: "the holder's surname, as printed on the biographical data page",
      expectedShape: "a family name",
      required: true,
      parse: nonEmpty,
    }),
    scalar({
      fieldKey: "identity.date_of_birth",
      labels: ["Date of birth", "Date of Birth", "DOB", "Born"],
      hint: "the date of birth on the biographical data page",
      expectedShape: "a date, e.g. 02 APR 1999",
      required: true,
      parse: documentDate,
    }),
    scalar({
      fieldKey: "identity.passport_number",
      labels: ["Passport No", "Passport Number", "Document No", "Document Number"],
      hint: "the passport number, usually top right of the data page",
      expectedShape: "an alphanumeric passport number",
      required: true,
      parse: passportNumber,
    }),
    scalar({
      fieldKey: "identity.nationality",
      labels: ["Nationality", "Citizenship"],
      hint: "the nationality field on the data page",
      expectedShape: "a nationality",
      required: true,
      parse: nonEmpty,
    }),
    scalar({
      fieldKey: "identity.passport_issuing_country",
      labels: ["Country of issue", "Issuing country", "Issuing authority", "Authority"],
      hint: "the issuing country or authority",
      expectedShape: "a country",
      required: false,
      parse: nonEmpty,
    }),
    scalar({
      fieldKey: "identity.passport_expiry",
      labels: ["Date of expiry", "Expiry", "Expiry date", "Date of Expiry"],
      hint: "the date of expiry",
      expectedShape: "a date, e.g. 01 MAR 2031",
      required: true,
      parse: documentDate,
    }),
    {
      kind: "document_date",
      dateKind: "expiresAt",
      labels: ["Date of expiry", "Expiry", "Expiry date", "Date of Expiry"],
      hint: "the date of expiry",
      expectedShape: "a date",
      required: true,
      parse: documentDate,
    },
    {
      kind: "document_date",
      dateKind: "issuedAt",
      labels: ["Date of issue", "Issued", "Issue date"],
      hint: "the date of issue",
      expectedShape: "a date",
      required: false,
      parse: documentDate,
    },
  ],
};

/**
 * A bank statement.
 *
 * The closing date of the covered period is what the UK Student visa's recency
 * window is measured from, so it is `required` — a statement whose period end
 * could not be read cannot be assessed for validity at all, and the correct
 * response to that is to ask, not to assume the statement is fresh.
 */
const BANK_STATEMENT: ExtractionPlan = {
  documentType: "bank_statement",
  targets: [
    {
      kind: "document_date",
      dateKind: "coversFrom",
      labels: ["Statement period from", "Period from", "From"],
      hint: "the first date of the statement period",
      expectedShape: "a date",
      required: false,
      parse: documentDate,
    },
    {
      kind: "document_date",
      dateKind: "coversTo",
      labels: ["Statement period to", "Period to", "Closing date", "To"],
      hint: "the last date of the statement period — the closing date",
      expectedShape: "a date",
      required: true,
      parse: documentDate,
    },
  ],
};

const ACADEMIC_TRANSCRIPT: ExtractionPlan = {
  documentType: "academic_transcript",
  targets: [
    composite({
      fieldKey: "education.highest_qualification",
      required: true,
      parts: [
        {
          partKey: "level",
          labels: ["Award", "Qualification", "Degree", "Programme of study"],
          hint: "the award or degree title, e.g. Bachelor of Science",
          expectedShape: "a qualification level",
          required: true,
        },
        {
          partKey: "subject",
          labels: ["Subject", "Field of study", "Major", "Course"],
          hint: "the subject or programme of study",
          expectedShape: "a subject",
          required: true,
        },
        {
          partKey: "institution",
          labels: ["Institution", "University", "Awarding body", "Awarding institution"],
          hint: "the awarding institution's name",
          expectedShape: "an institution name",
          required: true,
        },
        {
          partKey: "countryCode",
          labels: ["Country"],
          hint: "the country the institution is in",
          expectedShape: "a country",
          required: true,
        },
        {
          partKey: "completionYear",
          labels: ["Year of award", "Date of award", "Completed", "Year"],
          hint: "the year the qualification was awarded or completed",
          expectedShape: "a four-digit year",
          required: true,
        },
        {
          partKey: "grade",
          labels: ["Overall grade", "Grade", "Classification", "Final average", "Average"],
          hint: "the overall grade, classification or average, exactly as printed",
          expectedShape: "a grade as printed",
          required: true,
        },
        {
          partKey: "gradeScale",
          labels: ["Grading scale", "Scale", "Grading system"],
          hint: "the scale that grade is on, e.g. a 20-point scale or UK honours",
          expectedShape: "a grading scale",
          required: true,
        },
      ],
      assemble: (parts): Qualification | null => {
        const level = parts.get("level");
        const subject = parts.get("subject");
        const institution = parts.get("institution");
        const countryCode = parts.get("countryCode");
        const grade = parts.get("grade");
        const gradeScale = parts.get("gradeScale");
        const year = awardYear(parts.get("completionYear") ?? "");

        if (
          level === undefined || subject === undefined || institution === undefined ||
          countryCode === undefined || grade === undefined || gradeScale === undefined ||
          year === null
        ) {
          return null;
        }

        // The grade is carried exactly as printed and the scale alongside it.
        // Converting 17/20 into a 2:1 here would be inventing a qualification
        // the document does not state (brief §2.9); conversion is a mapping
        // decision with its own provenance, made later and reviewably.
        return { level, subject, institution, countryCode, completionYear: year, grade, gradeScale };
      },
    }),
  ],
};

const PLANS: Readonly<Partial<Record<DocumentType, ExtractionPlan>>> = {
  passport: PASSPORT,
  bank_statement: BANK_STATEMENT,
  academic_transcript: ACADEMIC_TRANSCRIPT,
};

/**
 * The plan for a document type, or `undefined`.
 *
 * Undefined means "we do not know how to read this" — which the caller must
 * treat as a reason to ask a human, not as "there was nothing to find".
 */
export function planFor(documentType: DocumentType): ExtractionPlan | undefined {
  return PLANS[documentType];
}

export const DOCUMENT_TYPES_WITH_PLANS: readonly DocumentType[] = Object.keys(
  PLANS,
) as readonly DocumentType[];
