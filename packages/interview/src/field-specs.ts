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

import type { Money, ProfileFieldKey, ProfileFieldTypes, YearMonth } from "@askimate/aas-profile";

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


const MONTH_NAMES = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
] as const;

/**
 * Yes or no, and nothing in between.
 *
 * ADR-0115: the three residence claims and the UK-now question are CLAIMS the
 * student makes, asked and never derived from the history. Vahid: *"The history
 * is what they remembered; the answer is what they claim. Those are different,
 * and only one of them is signed at the bottom of an application."*
 *
 * So *maybe*, *sometimes* and *I think so* are null rather than a lean. The
 * model reads the utterance; this decides whether the reading is usable, and a
 * hedge is not a usable reading of a question a student signs.
 */
const yesNo = (raw: string): boolean | null => {
  const value = raw.trim().toLowerCase();
  if (["yes", "y", "yeah", "yep", "true"].includes(value)) return true;
  if (["no", "n", "nope", "false"].includes(value)) return false;
  return null;
};

/**
 * A month and a year, never a day.
 *
 * ADR-0115, in his words: Sheffield asks for a day *"because it asks a day, not
 * because anyone knows it… Holding a Date means the profile carries a day that
 * in almost every case will be invented at the point of asking."* The registry
 * holds `YearMonth`, so this reads month and year and nothing manufactures the
 * rest. A portal that insists on a day asks the student for it.
 *
 * `09/08` is refused for `isoDate`'s reason: it is September 2008 to one reader
 * and August 2009 to another, and there is no way to tell which was meant.
 */
const yearMonth = (raw: string): YearMonth | null => {
  const value = raw.trim().toLowerCase();

  const numeric = /^(\d{4})-(\d{1,2})$/.exec(value);
  if (numeric !== null) {
    const year = Number(numeric[1]);
    const month = Number(numeric[2]);
    return month >= 1 && month <= 12 ? { year, month } : null;
  }

  // "September 2019" / "sept 2019" — unambiguous because the month is named.
  const written = /^([a-z]+)\s+(\d{4})$/.exec(value);
  if (written !== null) {
    const name_ = written[1] ?? "";
    const index = MONTH_NAMES.findIndex((month) => month === name_ || month.startsWith(name_) && name_.length >= 3);
    return index === -1 ? null : { year: Number(written[2]), month: index + 1 };
  }

  return null;
};

/** Symbols this reads. A symbol nobody listed is asked again, never assumed. */
const CURRENCY_SYMBOLS: Readonly<Record<string, string>> = { "£": "GBP", $: "USD", "€": "EUR" };

/**
 * An amount of money, with the currency the student named.
 *
 * **A bare number is refused.** The same rule as ADR-0112's award date: a value
 * with a part we chose is worse than no value. `20000` is not an amount until
 * the student says of what, and defaulting it to sterling because the
 * university is British is precisely the assumption-written-down-as-a-fact that
 * ADR-0136 was written about.
 *
 * Held in minor units, because a float cannot hold £20,000.10 and a form that
 * rounds a student's funds is a form that has changed their answer.
 */
const money = (raw: string): Money | null => {
  const value = raw.trim();
  if (value.length === 0) return null;

  const symbol = /^([£$€])\s*([\d,]+(?:\.\d{1,2})?)$/.exec(value);
  const before = /^([A-Za-z]{3})\s+([\d,]+(?:\.\d{1,2})?)$/.exec(value);
  const after = /^([\d,]+(?:\.\d{1,2})?)\s*([A-Za-z]{3})$/.exec(value);

  const read =
    symbol !== null
      ? { currency: CURRENCY_SYMBOLS[symbol[1] ?? ""], amount: symbol[2] ?? "" }
      : before !== null
        ? { currency: (before[1] ?? "").toUpperCase(), amount: before[2] ?? "" }
        : after !== null
          ? { currency: (after[2] ?? "").toUpperCase(), amount: after[1] ?? "" }
          : null;
  if (read === null || read.currency === undefined) return null;

  const [whole, fraction = ""] = read.amount.replace(/,/g, "").split(".");
  const minor = Number(`${whole ?? ""}${fraction.padEnd(2, "0")}`);
  return Number.isSafeInteger(minor) ? { amountMinorUnits: minor, currency: read.currency } : null;
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
  // ── P191: the registry's scalar fields ──────────────────────────────────
  //
  // Each of these was a field a person edited into a file by hand. The
  // rationale is what the student is told, and it says what the APPLICATION
  // needs it for — never "the form has a box".

  "identity.country_of_birth": {
    rationale: "Applications ask where you were born separately from your nationality, because the two are often different.",
    expectedShape: "a country",
    parse: trimmed,
  },
  "identity.sex": {
    rationale:
      "The application form asks for this, and universities report it to the UK higher education statistics agency. " +
      "Whatever you tell me is what goes in the box — I do not work it out from anything else.",
    expectedShape: "however you answer that question",
    parse: trimmed,
  },
  "study.intended_start": {
    rationale: "Courses run to fixed intakes, so the university needs to know which one you are applying for.",
    expectedShape: "a month and year, or a named intake, e.g. September 2027",
    parse: trimmed,
  },

  "finance.funding_source": {
    rationale: "Universities ask how the course will be paid for as part of assessing the application.",
    expectedShape: "who is paying, e.g. self-funded, family, an employer, a government scholarship",
    parse: trimmed,
  },
  "finance.sponsor_name": {
    rationale: "If someone other than you is paying, the university asks who.",
    expectedShape: "the name of the person or organisation paying",
    parse: trimmed,
  },
  "finance.available_funds": {
    rationale:
      "Applications and visa rules both ask what funds you have available for the course. " +
      "Tell me the currency as well as the amount — I will not assume one.",
    expectedShape: "an amount with its currency, e.g. £20,000 or 25000 EUR",
    parse: money,
  },

  // ADR-0115: the residence claims are ASKED, never read off the history.
  // *"The history is what they remembered; the answer is what they claim.
  // Those are different, and only one of them is signed at the bottom of an
  // application."*
  "residence.country": {
    rationale: "Your country of permanent residence decides which fee status and entry requirements apply to you.",
    expectedShape: "a country",
    parse: trimmed,
  },
  "residence.in_uk_now": {
    rationale: "Whether you are in the UK right now changes what the application asks you next.",
    expectedShape: "yes or no",
    parse: yesNo,
  },
  "residence.always_in_residence_country": {
    rationale:
      "The form asks whether you have always lived in your country of permanent residence. " +
      "This is your own answer to that question, not something I work out from the places you list.",
    expectedShape: "yes or no",
    parse: yesNo,
  },
  "residence.always_in_eu": {
    rationale:
      "The form asks whether you have always lived in the EU. " +
      "This is your own answer to that question, not something I work out from the places you list.",
    expectedShape: "yes or no",
    parse: yesNo,
  },
  "residence.outside_residence_country_last_three_years": {
    rationale:
      "The form asks whether you have lived outside your country of permanent residence in the last three years. " +
      "This is your own answer to that question, not something I work out from the places you list.",
    expectedShape: "yes or no",
    parse: yesNo,
  },
  "residence.uk_entry_date": {
    rationale:
      "If you are in the UK, the application asks when you arrived. " +
      "A month and a year is enough — I will not invent a day you did not give me.",
    expectedShape: "a month and a year, e.g. September 2019 or 2019-09",
    parse: yearMonth,
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
