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

import type {
  OrdinaryFieldKey,
  ProfileFieldKey,
  ProfileFieldType,
  Qualification,
} from "@askimate/aas-profile";
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
  /**
   * Narrowed, so the constructor is not the only gate.
   *
   * `scalar()` below refuses a special-category field, but a target written as
   * a raw object literal would bypass a constructor and not a type. Both are
   * closed. The runtime companion in `plans.test.ts` closes the third case: a
   * plan assembled from data rather than written down.
   */
  readonly fieldKey: OrdinaryFieldKey;
  readonly parse: (raw: string) => unknown;
}

export interface CompositePart extends TargetCommon {
  readonly partKey: string;
}

export interface CompositeTarget {
  readonly kind: "composite";
  readonly fieldKey: OrdinaryFieldKey;
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
 * Builds a scalar target with the parse checked against the field's real type,
 * and the FIELD checked against what may be read off a document at all.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * `K extends OrdinaryFieldKey` is B1 row 2, structurally (ADR-0077).
 *
 * The determination is that no special-category field is ever extracted from a
 * national identity document. It is enforced here rather than checked
 * elsewhere, because a check runs after somebody has already written the plan
 * and a type stops them writing it: `OrdinaryFieldKey` is derived from
 * `FIELD_CATEGORY`, which is total over the profile registry, so a field that
 * has not been classified — or has been classified `special_category` or
 * `undetermined` — cannot be named here at all.
 *
 * The guarantee is broader than the determination, deliberately. The
 * determination named the national ID; this refuses the field on EVERY
 * document, because a per-type exception would be a hole with no stated
 * purpose, and no document type in scope has a reason to yield one (ADR-0021:
 * these are application requirements, not visa requirements).
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The parse check is the older half of the same argument. The plan array holds
 * heterogeneous targets, so the stored `parse` is widened to `unknown`.
 * Checking it here means a plan that parses a date into a string fails to
 * compile at the line where it is written, which is where a reader would look
 * for the mistake.
 */
function scalar<K extends OrdinaryFieldKey>(target: {
  readonly fieldKey: K;
  readonly labels: readonly string[];
  readonly hint: string;
  readonly expectedShape: string;
  readonly required: boolean;
  readonly parse: (raw: string) => ProfileFieldType<K> | null;
}): ScalarTarget {
  return { kind: "scalar", ...target };
}

/** As `scalar`, and constrained the same way and for the same reason. */
function composite<K extends OrdinaryFieldKey>(target: {
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

/**
 * A month and a year, or nothing (ADR-0112).
 *
 * Vahid, 2026-09-15, as a condition: *"Reading an award date off a certificate
 * must give month and year or nothing — never a year with a month we chose."*
 * So `12 November 2022`, `November 2022`, `Nov 2022`, `2022-11` and `11/2022`
 * read; `2022` alone does not, and nothing here supplies the month it lacks.
 */
const MONTH_NAMES = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const yearMonth = (raw: string): { readonly year: number; readonly month: number } | null => {
  const value = raw.trim();
  const named = /^(?:\d{1,2}(?:st|nd|rd|th)?\s+)?([A-Za-z]{3,9})\.?,?\s+(19\d{2}|20\d{2})$/.exec(value);
  if (named !== null) {
    const typed = (named[1] ?? "").toLowerCase();
    const index = MONTH_NAMES.findIndex((month) => month === typed || month.slice(0, 3) === typed);
    return index === -1 ? null : { year: Number(named[2]), month: index + 1 };
  }
  const numeric = /^(19\d{2}|20\d{2})-(0[1-9]|1[0-2])$/.exec(value) ?? /^(0?[1-9]|1[0-2])\/(19\d{2}|20\d{2})$/.exec(value);
  if (numeric === null) return null;
  const [year, month] = value.includes("-") ? [numeric[1], numeric[2]] : [numeric[2], numeric[1]];
  return { year: Number(year), month: Number(month) };
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
    // ADR-0117: one value — a passport read off a passport is always `held`;
    // `none` is a statement only the student makes, never a document.
    composite({
      fieldKey: "identity.passport",
      required: true,
      parts: [
        {
          partKey: "number",
          labels: ["Passport No", "Passport Number", "Document No", "Document Number"],
          hint: "the passport number, usually top right of the data page",
          expectedShape: "an alphanumeric passport number",
          required: true,
        },
        {
          partKey: "expiry",
          labels: ["Date of expiry", "Expiry", "Expiry date", "Date of Expiry"],
          hint: "the date of expiry",
          expectedShape: "a date, e.g. 01 MAR 2031",
          required: true,
        },
        {
          partKey: "issuingCountry",
          labels: ["Country of issue", "Issuing country", "Issuing authority", "Authority"],
          hint: "the issuing country or authority",
          expectedShape: "a country",
          required: false,
        },
      ],
      assemble: (parts) => {
        const number = passportNumber(parts.get("number") ?? "");
        const expiry = documentDate(parts.get("expiry") ?? "");
        if (number === null || expiry === null) return null;
        const issuingCountry = nonEmpty(parts.get("issuingCountry") ?? "");
        return {
          kind: "held",
          number,
          expiry,
          ...(issuingCountry === null ? {} : { issuingCountry }),
        };
      },
    }),
    scalar({
      fieldKey: "identity.nationality",
      labels: ["Nationality", "Citizenship"],
      hint: "the nationality field on the data page",
      expectedShape: "a nationality",
      required: true,
      parse: nonEmpty,
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
          partKey: "start",
          labels: ["Date of entry", "Start date", "Commenced", "From"],
          hint: "when the programme of study began",
          expectedShape: "a month and a year",
          required: true,
        },
        {
          partKey: "end",
          labels: ["Date of completion", "End date", "Completed", "To"],
          hint: "when the programme of study ended",
          expectedShape: "a month and a year",
          required: true,
        },
        {
          partKey: "award",
          labels: ["Date of award", "Awarded on", "Year of award"],
          hint: "the date the qualification was conferred, as the certificate states it",
          expectedShape: "a month and a year — a year alone is not an award date",
          required: false,
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
        const start = yearMonth(parts.get("start") ?? "");
        const end = yearMonth(parts.get("end") ?? "");
        // Month and year, or nothing — never a year with a month we chose
        // (ADR-0112, his condition). A "Year of award: 2022" line is read
        // and yields no award date; the qualification assembles without one.
        const award = yearMonth(parts.get("award") ?? "");

        if (
          level === undefined || subject === undefined || institution === undefined ||
          countryCode === undefined || grade === undefined || gradeScale === undefined ||
          start === null || end === null
        ) {
          return null;
        }

        // The grade is carried exactly as printed and the scale alongside it.
        // Converting 17/20 into a 2:1 here would be inventing a qualification
        // the document does not state (brief §2.9); conversion is a mapping
        // decision with its own provenance, made later and reviewably.
        // A transcript states a completion; a course still running would say
        // "expected", which no label here reads, so nothing is proposed for it.
        return {
          level, subject, institution, countryCode,
          start,
          end: { kind: "completed", date: end },
          ...(award === null ? {} : { award }),
          grade, gradeScale,
        };
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

/** Every profile field any plan would read off a document. */
export function fieldsExtractedBy(plan: ExtractionPlan): readonly ProfileFieldKey[] {
  return plan.targets
    .filter(
      (target): target is ScalarTarget | CompositeTarget => target.kind !== "document_date",
    )
    .map((target) => target.fieldKey);
}

/** Every field every configured plan would read. For the check in the tests. */
export function allExtractedFields(): readonly ProfileFieldKey[] {
  return Object.values(PLANS).flatMap((plan) => fieldsExtractedBy(plan));
}
