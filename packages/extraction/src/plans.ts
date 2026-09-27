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
import { readCountryCode } from "@askimate/aas-profile";
import type { EmploymentEntry } from "@askimate/aas-profile";
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

/** One part of one entry of a list, read by its label inside the entry's own lines. */
export interface ListEntryPart extends TargetCommon {
  readonly partKey: string;
}

/**
 * A list of things read off a document — the jobs on a CV, the
 * qualifications (ADR-0148 §1, stage two). The document is cut into a
 * section under one of `headings` and into entries at the FIRST part's
 * labels (`sections.ts`); each part of each entry is read on its own and
 * grounded in the whole document; an entry a required part is missing from
 * is dropped and said so, and the rest are kept. Never required: a CV may
 * list none, and that is not a gap.
 */
export interface ListTarget {
  readonly kind: "list";
  readonly fieldKey: OrdinaryFieldKey;
  readonly headings: readonly string[];
  readonly parts: readonly ListEntryPart[];
  readonly assemble: (parts: ReadonlyMap<string, string>) => unknown;
  readonly required: false;
}

export type ExtractionTarget = ScalarTarget | CompositeTarget | DocumentDateTarget | ListTarget;

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
    // ── P201, blocker 68: a passport's nationality reaches the registry
    // through the reviewed table, or it does not reach it at all ──────────
    //
    // This read `parse: nonEmpty` until 2026-09-23, so a data page printing
    // `IRANIAN` put the string `IRANIAN` into `identity.nationality` — a
    // field every reviewed mapping keys by ISO alpha-2. It went in looking
    // fine and failed at the portal, which is the shape of defect this
    // repository keeps finding.
    //
    // The gate is the same one the interview uses, and it is the CONSTRAINT
    // half of Vahid's decision: *"a model may help us read, never decide what
    // is stored."* A model reads the data page and returns text; only text
    // the reviewed table resolves becomes a value. A passport that says
    // `IRANIAN` and a model that answers `Iran` gives `IR`; a model that
    // answers `Atlantis`, or invents a plausible code, gives nothing — and
    // the document's own span is still quoted verbatim beside it, so the
    // student confirms what the passport said next to what will be stored.
    scalar({
      fieldKey: "identity.nationality",
      labels: ["Nationality", "Citizenship"],
      hint: "the nationality field on the data page",
      expectedShape: "the country this person is a national of, e.g. Iran or IR — the country rather than the nationality",
      required: true,
      parse: readCountryCode,
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

// ───────────────────────────────────────────────────────────────────────────
// A CV (ADR-0148 §1, §9; stage two)
// ───────────────────────────────────────────────────────────────────────────
//
// Two lists, read entry by entry. The words a CV uses for the closed
// vocabularies the profile holds are read here into the profile's own tokens
// — the same tokens the interview's parsers produce for a typed answer, so
// a value read off a CV and a value typed into the chat are the same value.
// PROVEN AGAINST THE DETERMINISTIC CLIENT ONLY: that client reads a line
// labelled "Position:", and a real CV has no such line; whether the Bedrock
// client reads prose into these parts is not shown by any test here.

const trimmed = (raw: string): string | null => {
  const value = raw.trim();
  return value.length > 0 && value.length <= 2000 ? value : null;
};

/** "Present", "current", "to date", "now", "ongoing" — a job not yet ended — or a month and a year. */
const endOfJob = (raw: string): string | null => {
  const value = raw.trim();
  if (/^(present|current|currently|to date|to present|now|ongoing|-)$/i.test(value)) return "current";
  return yearMonth(value) === null ? null : value;
};

const QUALIFICATION_LEVELS: Readonly<Record<string, string>> = {
  "bachelor's degree": "Bachelor's degree",
  "bachelors degree": "Bachelor's degree",
  bachelor: "Bachelor's degree",
  "master's degree": "Master's degree",
  "masters degree": "Master's degree",
  master: "Master's degree",
  doctorate: "Doctorate",
  phd: "Doctorate",
  diploma: "Diploma",
  certificate: "Certificate",
  "high school diploma": "High school diploma",
};

const GRADE_SCALES: Readonly<Record<string, string>> = {
  "uk honours": "uk_honours",
  "20-point": "twenty_point",
  "20 point": "twenty_point",
  "out of 20": "twenty_point",
  "gpa out of 4": "gpa_4",
  "gpa 4": "gpa_4",
  gpa: "gpa_4",
  percentage: "percentage",
  "out of 100": "percentage",
};

const EMPLOYMENT_BASIS: Readonly<Record<string, string>> = {
  "full time": "full_time",
  "full-time": "full_time",
  "part time": "part_time",
  "part-time": "part_time",
};

const oneOf =
  (options: Readonly<Record<string, string>>) =>
  (raw: string): string | null =>
    options[raw.trim().toLowerCase().replace(/\s+/g, " ")] ?? null;

/**
 * "Completed, June 2019" / "Expected June 2027" / "Discontinued March 2020",
 * or a bare month and year, which a CV states as a completion. Kept as the
 * kind and the date in one string for `assemble` to split.
 */
const endOfQualification = (raw: string): string | null => {
  const value = raw.trim();
  const kinded = /^(completed|expected|discontinued|finished|graduated|left)[\s,:-]*(.+)$/i.exec(value);
  const kind = kinded === null ? "completed" : { finished: "completed", graduated: "completed", left: "discontinued" }[kinded[1]?.toLowerCase() ?? ""] ?? (kinded[1]?.toLowerCase() ?? "completed");
  const date = kinded === null ? value : (kinded[2] ?? "");
  return yearMonth(date) === null ? null : `${kind}|${date}`;
};

const CV: ExtractionPlan = {
  documentType: "cv",
  targets: [
    {
      kind: "list",
      fieldKey: "employment.history",
      headings: ["employment", "employment history", "work experience", "work history", "experience", "professional experience", "career", "career history"],
      required: false,
      parts: [
        { partKey: "position", labels: ["Position", "Job title", "Title", "Role"], hint: "the job title of one job", expectedShape: "a job title", required: true },
        { partKey: "employer", labels: ["Employer", "Company", "Organisation", "Organization"], hint: "who the job was with", expectedShape: "an employer's name", required: true },
        { partKey: "employerAddress", labels: ["Employer address", "Address", "Location"], hint: "where the employer is", expectedShape: "an address or a place", required: true },
        { partKey: "startDate", labels: ["Start", "Start date", "From"], hint: "when the job began, as a month and a year", expectedShape: "a month and a year", required: true },
        { partKey: "end", labels: ["End", "End date", "To", "Until"], hint: "when the job ended, or that it has not", expectedShape: "a month and a year, or 'Present'", required: true },
        { partKey: "duties", labels: ["Duties", "Responsibilities", "Description", "Summary"], hint: "what the job involved, in the student's words", expectedShape: "a description", required: true },
        { partKey: "basis", labels: ["Basis", "Type", "Hours"], hint: "full-time or part-time", expectedShape: "full-time or part-time", required: false },
      ],
      assemble: (parts): EmploymentEntry | null => {
        const position = trimmed(parts.get("position") ?? "");
        const employer = trimmed(parts.get("employer") ?? "");
        const employerAddress = trimmed(parts.get("employerAddress") ?? "");
        const startDate = yearMonth(parts.get("startDate") ?? "");
        const endRead = endOfJob(parts.get("end") ?? "");
        const duties = trimmed(parts.get("duties") ?? "");
        const basis = oneOf(EMPLOYMENT_BASIS)(parts.get("basis") ?? "");
        if (position === null || employer === null || employerAddress === null || startDate === null || endRead === null || duties === null) return null;
        const endDate = endRead === "current" ? null : yearMonth(endRead);
        if (endRead !== "current" && endDate === null) return null;
        return {
          employer,
          employerAddress,
          position,
          startDate,
          end: endDate === null ? { kind: "current" } : { kind: "ended", date: endDate },
          ...(basis === "full_time" || basis === "part_time" ? { basis } : {}),
          duties,
        };
      },
    },
    {
      kind: "list",
      fieldKey: "education.prior_qualifications",
      headings: ["education", "education and qualifications", "qualifications", "academic history", "academic qualifications", "academic background"],
      required: false,
      parts: [
        { partKey: "awardTitle", labels: ["Qualification", "Award", "Degree"], hint: "the title as awarded, e.g. BSc", expectedShape: "a qualification's title", required: true },
        { partKey: "subject", labels: ["Subject", "Course", "Field"], hint: "the subject studied", expectedShape: "a subject", required: true },
        { partKey: "institution", labels: ["Institution", "University", "School", "College"], hint: "where it was studied", expectedShape: "an institution's name", required: true },
        { partKey: "countryCode", labels: ["Country"], hint: "the country of the institution", expectedShape: "a country", required: true },
        { partKey: "level", labels: ["Level"], hint: "the level: bachelor's degree, master's degree, doctorate, diploma, certificate", expectedShape: "a level of qualification", required: true },
        { partKey: "start", labels: ["Start", "Start date", "From"], hint: "when it began, as a month and a year", expectedShape: "a month and a year", required: true },
        { partKey: "end", labels: ["End", "End date", "To", "Until", "Completed"], hint: "when it ended, or is expected to", expectedShape: "a month and a year, with 'expected' or 'discontinued' where so", required: true },
        { partKey: "grade", labels: ["Grade", "Result", "Classification"], hint: "the grade as printed", expectedShape: "a grade", required: true },
        { partKey: "gradeScale", labels: ["Grade scale", "Scale"], hint: "the scale the grade is on", expectedShape: "UK honours, 20-point, GPA out of 4, or percentage", required: true },
      ],
      assemble: (parts): Qualification | null => {
        const awardTitle = trimmed(parts.get("awardTitle") ?? "");
        const subject = trimmed(parts.get("subject") ?? "");
        const institution = trimmed(parts.get("institution") ?? "");
        const countryCode = readCountryCode(parts.get("countryCode") ?? "");
        const level = oneOf(QUALIFICATION_LEVELS)(parts.get("level") ?? "");
        const start = yearMonth(parts.get("start") ?? "");
        const endRead = endOfQualification(parts.get("end") ?? "");
        const grade = trimmed(parts.get("grade") ?? "");
        const gradeScale = oneOf(GRADE_SCALES)(parts.get("gradeScale") ?? "");
        if (awardTitle === null || subject === null || institution === null || countryCode === null || level === null || start === null || endRead === null || grade === null || gradeScale === null) return null;
        const [kind, endText] = endRead.split("|");
        const endDate = yearMonth(endText ?? "");
        if (endDate === null || (kind !== "completed" && kind !== "expected" && kind !== "discontinued")) return null;
        return { level, awardTitle, subject, institution, countryCode, start, end: { kind, date: endDate }, grade, gradeScale };
      },
    },
  ],
};

const PLANS: Readonly<Partial<Record<DocumentType, ExtractionPlan>>> = {
  passport: PASSPORT,
  bank_statement: BANK_STATEMENT,
  academic_transcript: ACADEMIC_TRANSCRIPT,
  cv: CV,
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
      (target): target is ScalarTarget | CompositeTarget | ListTarget => target.kind !== "document_date",
    )
    .map((target) => target.fieldKey);
}

/** Every field every configured plan would read. For the check in the tests. */
export function allExtractedFields(): readonly ProfileFieldKey[] {
  return Object.values(PLANS).flatMap((plan) => fieldsExtractedBy(plan));
}
