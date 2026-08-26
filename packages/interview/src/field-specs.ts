/**
 * Field specifications: how to ask for a field, and how to read the answer.
 *
 * Two things per field:
 *
 *   rationale     — why the application needs it. The question explains itself,
 *                   because "what is your date of birth?" out of nowhere is
 *                   interrogation, not conversation.
 *
 *   parse         — turns a raw string into the field's type, or returns null.
 *                   DETERMINISTIC. The model reads the utterance; this decides
 *                   whether the reading is usable. Null means ask again — never
 *                   store an approximation.
 *
 * Note what `parse` does NOT do: it never coerces a doubtful value into a
 * plausible one. An ambiguous date is null, not a guess.
 */

import type { ProfileFieldKey, ProfileFieldTypes } from "@askimate/aas-profile";

export interface FieldSpec<T> {
  readonly rationale: string;
  /** Describes the shape wanted, for the model to target. */
  readonly expectedShape: string;
  readonly parse: (raw: string) => T | null;
}

const trimmed = (raw: string): string | null => {
  const value = raw.trim();
  return value.length > 0 ? value : null;
};

/** A name: non-empty, no digits. */
const name = (raw: string): string | null => {
  const value = raw.trim();
  if (value.length === 0 || value.length > 100) return null;
  if (/\d/.test(value)) return null;
  return value;
};

/**
 * A date. ISO-8601 only, plus a small set of unambiguous written forms.
 *
 * Deliberately strict, and deliberately refuses `02/04/1999`: that is April 2nd
 * in Britain and February 4th in America, and there is no way to tell which the
 * student meant. Date of birth drives minor detection (ADR-0011), so a wrong
 * reading here has legal consequences. Ambiguity resolves to "ask again".
 */
const isoDate = (raw: string): Date | null => {
  const value = raw.trim();

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (iso !== null) {
    const parsed = new Date(`${value}T00:00:00Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  // "2 April 1999" / "2nd April 1999" — unambiguous because the month is named.
  const written = /^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})$/.exec(value);
  if (written !== null) {
    const [, day, monthName, year] = written;
    const months = [
      "january", "february", "march", "april", "may", "june",
      "july", "august", "september", "october", "november", "december",
    ];
    const monthIndex = months.indexOf((monthName ?? "").toLowerCase());
    if (monthIndex === -1) return null;
    const parsed = new Date(
      Date.UTC(Number(year), monthIndex, Number(day)),
    );
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
};

const email = (raw: string): string | null => {
  const value = raw.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null;
};

/** Specs for the fields the first end-to-end run needs. */
export const FIELD_SPECS: Partial<{
  [K in ProfileFieldKey]: FieldSpec<ProfileFieldTypes[K]>;
}> = {
  "identity.given_name": {
    rationale: "The university needs your name exactly as it appears on your passport.",
    expectedShape: "a person's first name",
    parse: name,
  },
  "identity.family_name": {
    rationale: "The university needs your name exactly as it appears on your passport.",
    expectedShape: "a person's family name",
    parse: name,
  },
  "identity.date_of_birth": {
    rationale: "The university needs your date of birth to confirm your identity.",
    expectedShape: "a date of birth, e.g. 1999-04-02 or 2 April 1999",
    parse: isoDate,
  },
  "identity.nationality": {
    rationale: "Your nationality determines which entry requirements and visa rules apply.",
    expectedShape: "a nationality or country",
    parse: trimmed,
  },
  "contact.email": {
    rationale:
      "The university will send everything about your application to this address, so it needs to " +
      "be your own personal email rather than anyone else's.",
    expectedShape: "an email address",
    parse: email,
  },
  "contact.mobile": {
    rationale: "The university may need to contact you about your application.",
    expectedShape: "a phone number",
    parse: (raw) => {
      const value = raw.replace(/[\s()-]/g, "");
      return /^\+?\d{7,15}$/.test(value) ? value : null;
    },
  },
  "study.personal_statement": {
    rationale: "The application asks why you want to study this course.",
    expectedShape: "a paragraph of prose",
    parse: (raw) => {
      const value = raw.trim();
      // Too short is not a personal statement; better to ask for more than to
      // submit two words into a field a human will read.
      return value.length >= 50 ? value : null;
    },
  },
};
