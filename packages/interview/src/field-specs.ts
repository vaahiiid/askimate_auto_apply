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

import type {
  Money,
  ProfileFieldKey,
  ProfileFieldTypes,
  UkStatusClaims,
  UkStudyLevel,
  YearMonth,
} from "@askimate/aas-profile";
import { readCountry } from "@askimate/aas-profile";

/**
 * A field the student answers in one utterance.
 *
 * `parse` turns what they said into the field's type, or returns null. Null
 * means ask again — never store an approximation.
 */
export interface ScalarFieldSpec<T> {
  readonly rationale: string;
  /** Describes the shape wanted, for the model to target. */
  readonly expectedShape: string;
  readonly parse: (raw: string) => T | null;
}

/**
 * One part of a field whose value has several.
 *
 * ── Why a composite is not a `parse` ─────────────────────────────────────
 *
 * `ScalarFieldSpec.parse` is `(raw: string) => T | null`: one utterance, one
 * whole value. An `Address` has six parts and a `Passport` is either a
 * statement or three facts, so a `parse` for either would have to invent the
 * parts the student did not say. That is the rule Vahid stated on 2026-09-23,
 * generalising from the money parser: *"a value the student did not state is
 * never supplied by us, however obvious the default looks from where we sit."*
 *
 * So each part is its own question, with its own reason for being asked and
 * its own parser, and the student confirms ONCE at the end — against the whole
 * value, because the whole value is what enters the profile.
 */
export interface FieldPart<P> {
  /** Names this part within the field. Matches the key `assemble` reads. */
  readonly partKey: string;
  /** Why the application needs this part specifically. */
  readonly rationale: string;
  readonly expectedShape: string;
  readonly parse: (raw: string) => P | null;
  /**
   * Asked only when the parts already answered make it applicable.
   *
   * ADR-0117's `none` arm is the case: a student who has just said they have
   * no passport must not then be asked for its number.
   */
  readonly askWhen?: (answered: PartAnswers) => boolean;
  /**
   * The registry allows this part to be absent.
   *
   * An optional part is still ASKED — silence is not an answer — but the
   * student may say there is none, and then there is none. Nothing is invented
   * to fill the shape.
   */
  readonly optional?: boolean;
}

/** The parts answered so far, by `partKey`. An omitted optional part holds {@link OMITTED}. */
export type PartAnswers = ReadonlyMap<string, unknown>;

/**
 * An optional part the student said there is none of.
 *
 * A distinct value rather than `undefined`, so "asked and there is none" and
 * "not yet asked" cannot be confused — the difference decides whether the
 * interview asks again.
 */
export const OMITTED: unique symbol = Symbol("omitted");

/** A field whose value the student gives in several answers. */
export interface CompositeFieldSpec<T> {
  readonly rationale: string;
  /** Asked in this order, skipping any part `askWhen` says does not apply. */
  readonly parts: readonly FieldPart<unknown>[];
  /**
   * Builds the whole value from the answered parts, or returns null.
   *
   * Null is a defect in the spec rather than in the student's answers — every
   * part was readable — so the interview says so rather than storing a value
   * with a part nobody gave it.
   */
  readonly assemble: (answered: PartAnswers) => T | null;
}

export type FieldSpec<T> = ScalarFieldSpec<T> | CompositeFieldSpec<T>;

export function isComposite<T>(spec: FieldSpec<T>): spec is CompositeFieldSpec<T> {
  return "parts" in spec;
}

/**
 * What a student says to leave an optional part out.
 *
 * Deliberately a closed set, and deliberately small: the question for an
 * optional part says what to say if there is none, so this reads an answer
 * rather than guessing at silence. Nothing here is applied to a required part.
 */
const OMISSION_WORDS: ReadonlySet<string> = new Set([
  "-", "--", "none", "no", "n/a", "na", "not applicable", "nothing", "there isn't one", "there is none",
]);

/**
 * The parser the interview actually runs for a part.
 *
 * For a required part it is the part's own. For an optional one it first reads
 * the student's "there is none" — which is an ANSWER, and moves the interview
 * on — and otherwise defers to the part's parser.
 */
export function partParser(part: FieldPart<unknown>): (raw: string) => unknown {
  if (part.optional !== true) return part.parse;
  return (raw) => (OMISSION_WORDS.has(raw.trim().toLowerCase()) ? OMITTED : part.parse(raw));
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

/** A phone number, as digits with an optional country prefix. */
const phoneNumber = (raw: string): string | null => {
  const value = raw.replace(/[\s()-]/g, "");
  return /^\+?\d{7,15}$/.test(value) ? value : null;
};

/**
 * Whether the student holds the thing, or has none (ADR-0117).
 *
 * Reads only statements that say one or the other. *"I might be able to find
 * it"* is neither, and is asked again rather than resolved in whichever
 * direction moves the form along — which would be us supplying the answer.
 */
const heldOrNone = (raw: string): "held" | "none" | null => {
  const value = raw.trim().toLowerCase().replace(/[.!]+$/, "");
  if (/^(yes|yeah|yep|y|true)\b/.test(value)) return "held";
  if (/^(no|nope|n|false)\b/.test(value)) return "none";
  if (/^i (have|'ve got|have got|do have|do)\b/.test(value)) return "held";
  if (/^i (don'?t|do not) have\b/.test(value)) return "none";
  return null;
};

/**
 * A passport number, as printed.
 *
 * Letters and digits, nothing normalised — not upper-cased, not stripped of a
 * hyphen the document prints. A passport number that we have tidied is a
 * passport number the student did not give us, and the portal compares it
 * against the document.
 *
 * At least one digit, and at least five characters. A judgement rather than a
 * standard: passport numbers are not issued in one format, but every issuing
 * country's runs to digits and a length. Without it `soon` reads as a passport
 * number, which is how an answer to a question the student was not asked ends
 * up on an application. Refusing a real number is recoverable — the student is
 * asked again — and accepting a word is not.
 */
const passportNumber = (raw: string): string | null => {
  const value = raw.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{4,19}$/.test(value)) return null;
  return /\d/.test(value) ? value : null;
};

/** A line of an address. Non-empty, and short enough to be a line. */
const addressLine = (raw: string): string | null => {
  const value = raw.trim();
  return value.length > 0 && value.length <= 120 ? value : null;
};

/**
 * A country, as the reviewed ISO 3166-1 alpha-2 table holds it.
 *
 * ── What changed in P195, and why it is not a softening ──────────────────
 *
 * P192 refused *"Iran"*. Turning a country's name into `IR` was a lookup, and
 * there was no reviewed table to do it with — so the honest choices were a
 * refusal or a half-table that works for some students and fails invisibly for
 * others. It refused, and said so.
 *
 * Blocker 61 built the table (Vahid, 2026-09-23: *"the list itself reviewed
 * and hashed like a blueprint, and refuse anything not in it"*), so the lookup
 * is now an artefact somebody can check rather than a guess. A name resolves;
 * nothing else does. **Membership is checked, not shape**: `ZZ` is a
 * well-formed code that nobody is assigned and it is refused, which is exactly
 * what a regular expression could not do.
 */
const countryCodeIso2 = (raw: string): string | null => readCountry(raw)?.code ?? null;

/**
 * A score, exactly as the certificate writes it.
 *
 * NOT parsed to a number, deliberately. IELTS reports 7.5, TOEFL iBT reports
 * 102, PTE reports 65 and the CEFR reports B2 — four scales, and a number
 * would make 7.5 and 102 the same kind of thing while losing what either
 * means. The portal is told what the certificate says; the comparing is the
 * university's.
 */
const score = (raw: string): string | null => {
  const value = raw.trim();
  return value.length > 0 && value.length <= 20 ? value : null;
};

/**
 * The component scores, as pairs the student read off their certificate.
 *
 * ── Never inferred from the overall ──────────────────────────────────────
 *
 * An IELTS 7.5 overall says nothing about the listening score: it is a mean,
 * and a dozen component sets produce it. A system that filled one in from the
 * other would be inventing a number that goes on an application — the exact
 * shape of Vahid's rule, on the part that most invites breaking it.
 *
 * One part rather than four, because the components differ by test — IELTS has
 * four skills, some tests report more — and a fixed set of four would be a
 * half-table for every test that is not IELTS. The student names them.
 */
const componentScores = (raw: string): Readonly<Record<string, string>> | null => {
  const pairs = raw
    .split(/[,;\n]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (pairs.length === 0) return null;

  const read: Record<string, string> = {};
  for (const pair of pairs) {
    // `Listening 7.5`, `Listening: 7.5`, `Listening - 7.5`. The NAME is the
    // student's; nothing is renamed to a vocabulary of ours.
    const match = /^(.+?)\s*[:–—-]?\s+([A-Za-z0-9.+]{1,10})$/.exec(pair);
    if (match === null) return null;
    const name = (match[1] ?? "").trim();
    const value = (match[2] ?? "").trim();
    if (name.length === 0 || value.length === 0) return null;
    read[name] = value;
  }
  return read;
};

/** The six levels the registry holds, as the question lists them to the student. */
const UK_STUDY_LEVELS: Readonly<Record<string, UkStudyLevel>> = {
  "english language": "english_language",
  school: "school",
  foundation: "foundation",
  "study abroad or exchange": "study_abroad_or_exchange",
  "study abroad": "study_abroad_or_exchange",
  exchange: "study_abroad_or_exchange",
  university: "university",
  other: "other",
};

/**
 * One of the six levels, read from the options the question named.
 *
 * A closed set the registry already holds, and the question lists it — so
 * matching what the student picked is READING their choice, not guessing at
 * it. Anything off the list is asked again: *"a masters"* is not one of the
 * six, and deciding it means `university` would be us answering.
 */
const ukStudyLevel = (raw: string): UkStudyLevel | null =>
  UK_STUDY_LEVELS[raw.trim().toLowerCase().replace(/\s+/g, " ")] ?? null;

/**
 * A length of time on a visa, in years and months.
 *
 * **"about 3 years" is refused**, and so is a bare `3`. The Home Office counts
 * this period exactly; an approximation of it is a number we made up, which is
 * the Sep/Sept rule and the money rule in their third setting.
 */
const yearsAndMonths = (raw: string): { years: number; months: number } | null => {
  const value = raw.trim().toLowerCase();
  if (/\b(about|around|roughly|approx|approximately|or so|ish)\b/.test(value)) return null;

  const both = /^(\d{1,2})\s*years?\s+(\d{1,2})\s*months?$/.exec(value);
  if (both !== null) return { years: Number(both[1]), months: Number(both[2]) };

  const years = /^(\d{1,2})\s*years?$/.exec(value);
  if (years !== null) return { years: Number(years[1]), months: 0 };

  const months = /^(\d{1,3})\s*months?$/.exec(value);
  if (months !== null) return { years: 0, months: Number(months[1]) };

  return null;
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
    parse: phoneNumber,
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

  // ── P192: the fields whose value has several parts ─────────────────────
  //
  // Each is asked part by part and confirmed once, against the whole value.
  // See `FieldPart` for why a composite cannot be one `parse`.

  "identity.passport": {
    rationale:
      "Universities ask for your passport details because that is the identity your application " +
      "is checked against. If you do not have one, that is an answer too — I will record it " +
      "rather than leaving the question blank.",
    parts: [
      {
        partKey: "kind",
        rationale: "Whether you have a passport at all decides what else the form asks you.",
        expectedShape: "yes or no",
        parse: heldOrNone,
      },
      {
        partKey: "number",
        rationale: "The number as printed on your passport.",
        expectedShape: "a passport number, exactly as printed",
        parse: passportNumber,
        askWhen: (answered) => answered.get("kind") === "held",
      },
      {
        partKey: "expiry",
        rationale:
          "Universities and the visa route both check that your passport is valid for the whole " +
          "of your course, so they ask when it expires.",
        expectedShape: "a date, e.g. 2031-04-02 or 2 April 2031",
        parse: isoDate,
        askWhen: (answered) => answered.get("kind") === "held",
      },
      {
        partKey: "issuingCountry",
        rationale:
          "The form asks which country issued the passport. It is often the same as your " +
          "nationality, but I do not assume that — I take it from the passport.",
        expectedShape: "the country that issued it, or none if it does not say",
        parse: trimmed,
        optional: true,
        askWhen: (answered) => answered.get("kind") === "held",
      },
    ],
    // ADR-0117: `none` is the student's statement, not three empty values.
    assemble: (answered) => {
      const kind = answered.get("kind");
      if (kind === "none") return { kind: "none" };
      if (kind !== "held") return null;

      const number = answered.get("number");
      const expiry = answered.get("expiry");
      if (typeof number !== "string" || !(expiry instanceof Date)) return null;

      const issuing = answered.get("issuingCountry");
      return typeof issuing === "string"
        ? { kind: "held", number, expiry, issuingCountry: issuing }
        : { kind: "held", number, expiry };
    },
  },

  "contact.address": {
    rationale:
      "The university writes to this address, and your fee status is assessed partly on where " +
      "you live. I will take it one line at a time.",
    parts: [
      {
        partKey: "line1",
        rationale: "The first line of your address — the number and street.",
        expectedShape: "the first line of an address",
        parse: addressLine,
      },
      {
        partKey: "line2",
        rationale: "A second line, if your address has one.",
        expectedShape: "a second address line, or none if there isn't one",
        parse: addressLine,
        optional: true,
      },
      {
        partKey: "city",
        rationale: "The town or city.",
        expectedShape: "a town or city",
        parse: addressLine,
      },
      {
        partKey: "region",
        rationale: "The county, state or province, if your address uses one.",
        expectedShape: "a county, state or province, or none if your address has none",
        parse: addressLine,
        optional: true,
      },
      {
        partKey: "postalCode",
        // The registry makes this REQUIRED, and a good many countries do not
        // issue postcodes. Raised rather than worked around: see
        // `docs/where-we-are.md` — a student in one of those countries cannot
        // complete an address today, and the fix is a registry change.
        rationale: "The postcode or ZIP code.",
        expectedShape: "a postcode or ZIP code",
        parse: addressLine,
      },
      {
        partKey: "countryCode",
        rationale:
          "The country. Its name or its two-letter code both work — Iran or IR, the United " +
          "Kingdom or GB. If I do not recognise what you tell me I will say so and ask again, " +
          "rather than putting a country on your application that you did not name.",
        expectedShape: "a country, by name or by its two-letter code, e.g. Iran or IR",
        parse: countryCodeIso2,
      },
    ],
    assemble: (answered) => {
      const line1 = answered.get("line1");
      const city = answered.get("city");
      const postalCode = answered.get("postalCode");
      const countryCode = answered.get("countryCode");
      if (
        typeof line1 !== "string" ||
        typeof city !== "string" ||
        typeof postalCode !== "string" ||
        typeof countryCode !== "string"
      ) {
        return null;
      }
      const line2 = answered.get("line2");
      const region = answered.get("region");
      return {
        line1,
        ...(typeof line2 === "string" ? { line2 } : {}),
        city,
        ...(typeof region === "string" ? { region } : {}),
        postalCode,
        countryCode,
      };
    },
  },

  // ── The guardian fields, and what a mandatory-review category means ─────
  //
  // These are reachable only when the date of birth DETERMINES that the
  // student is a minor (ADR-0011). Three things follow, and they change how
  // the questions are worded rather than only who reviews them:
  //
  //   1. Minority is determined, never asked. There is no "are you under 18?"
  //      question here, and there must not be one: the answer that matters is
  //      the one the date of birth gives, and asking invites a student to
  //      answer around a safeguard.
  //
  //   2. The answers feed a STOP, not a continuation. Under ADR-0013 being a
  //      minor blocks nothing by itself, and under the brief §2.5 anything
  //      involving a minor is a mandatory human review — every time,
  //      regardless of confidence. So collecting these does not release the
  //      case; it gives the person doing the review something to work with.
  //      The questions say so, because a student who is told "this will go to
  //      a person" is not surprised later by the wait.
  //
  //   3. This is a THIRD PARTY'S personal data, given by someone who is not in
  //      the conversation. The guardian has not consented to anything here and
  //      cannot be asked through this chat. ADR-0013's B2 determination
  //      (`MINOR_ROUTE`) rests on the guardian's consent, which means the
  //      guardian must at some point be reached — and nothing in this system
  //      reaches them.
  //
  // ═══════════════════════════════════════════════════════════════════════
  // THESE QUESTIONS EXISTING DOES NOT MAKE A MINOR SERVICEABLE.
  //
  // Vahid, 2026-09-23, deciding blocker 62: *"a minor is not served until the
  // guardian route is real. Not a stop-for-a-person, not a message in the
  // student's chat — no application is prepared for a minor until there is a
  // way for the guardian to be reached, told, and to consent in their own
  // right. … A mandatory review with nobody to review to is worse than no
  // route."*
  //
  // It is a PRODUCT PRECONDITION, recorded beside the second-reviewer one
  // (blocker 62, beside blocker 2), and it would take a second conversation, a
  // separate identity for the guardian, and a consent record that is their own
  // act. Written here, where the questions are, so nobody reads "the guardian
  // fields are built" as "a minor can use this".
  // ═══════════════════════════════════════════════════════════════════════
  "guardian.given_name": {
    rationale:
      "Because you are under 18, the university asks for a parent or guardian's details, and a " +
      "person here checks everything on that part of your application before it goes anywhere.",
    expectedShape: "a person's first name",
    parse: name,
  },
  "guardian.family_name": {
    rationale:
      "The same parent or guardian's last name. A person here checks this part of your " +
      "application rather than it going straight through.",
    expectedShape: "a person's family name",
    parse: name,
  },
  "guardian.relationship": {
    rationale:
      "The form asks how this person is related to you — your mother, father, or another legal " +
      "guardian. Whatever you tell me is what goes in the box.",
    expectedShape: "how they are related to you, e.g. mother, father, legal guardian",
    parse: trimmed,
  },
  "guardian.email": {
    rationale:
      "The university may need to contact your parent or guardian about your application. " +
      "This is their address, not yours, so please give one they actually use.",
    expectedShape: "an email address",
    parse: email,
  },
  "guardian.mobile": {
    rationale:
      "A phone number for your parent or guardian, for the same reason. Theirs, not yours.",
    expectedShape: "a phone number",
    parse: phoneNumber,
  },

  // ── P197: the three remaining composites ────────────────────────────────

  "education.english_language_test": {
    rationale:
      "Universities set an English language condition, and they need the test you took, what you " +
      "scored and when. I take it straight from your certificate — I do not work any part of it " +
      "out from any other part.",
    parts: [
      {
        partKey: "test",
        rationale: "Which test you took, as the certificate names it.",
        expectedShape: "the test's name, e.g. IELTS Academic, TOEFL iBT, PTE Academic",
        parse: trimmed,
      },
      {
        partKey: "overallScore",
        rationale: "Your overall result, exactly as the certificate prints it.",
        expectedShape: "an overall score, e.g. 7.5 or 102 or B2",
        parse: score,
      },
      {
        partKey: "componentScores",
        // The rule's hardest case: an overall is a mean, and a dozen component
        // sets produce the same one. Nothing here is derived from it.
        rationale:
          "The score for each part of the test, as your certificate lists them. Universities set " +
          "a minimum for each part separately, so I need them from you — the overall score does " +
          "not tell me what they were.",
        expectedShape: "each part and its score, e.g. Listening 7.5, Reading 8, Writing 6.5, Speaking 7",
        parse: componentScores,
      },
      {
        partKey: "testDate",
        rationale:
          "Most universities only accept a test taken within the last two years, so they ask when " +
          "you sat it.",
        expectedShape: "a date, e.g. 2025-06-14 or 14 June 2025",
        parse: isoDate,
      },
      {
        partKey: "certificateNumber",
        rationale:
          "Some universities use this to verify the result with the test provider. If your " +
          "certificate does not show one, say none.",
        expectedShape: "the certificate or test report number, or none",
        parse: trimmed,
        optional: true,
      },
    ],
    assemble: (answered) => {
      const test = answered.get("test");
      const overallScore = answered.get("overallScore");
      const components = answered.get("componentScores");
      const testDate = answered.get("testDate");
      if (
        typeof test !== "string" ||
        typeof overallScore !== "string" ||
        components === undefined ||
        components === OMITTED ||
        typeof components !== "object" ||
        !(testDate instanceof Date)
      ) {
        return null;
      }
      const certificateNumber = answered.get("certificateNumber");
      return {
        test,
        overallScore,
        componentScores: components as Readonly<Record<string, string>>,
        testDate,
        ...(typeof certificateNumber === "string" ? { certificateNumber } : {}),
      };
    },
  },

  // ADR-0115: seven CLAIMS, each asked and none derived. `british_passport`
  // is NOT read off `identity.passport.issuingCountry` and `eu_passport` is
  // NOT read off nationality — *"The history is what they remembered; the
  // answer is what they claim. Those are different, and only one of them is
  // signed at the bottom of an application."*
  "immigration.uk_status": {
    rationale:
      "The form asks a short list of questions about your status in the UK. Each one is your own " +
      "answer — I do not work any of them out from your passport or your nationality.",
    parts: (
      [
        ["british_passport", "whether you hold a British passport"],
        ["indefinite_leave", "whether you have indefinite leave to remain or enter"],
        ["refugee_status", "whether you have refugee status in the UK"],
        ["migrant_worker", "whether you are in the UK as a migrant worker"],
        ["spouse_of_uk_citizen", "whether you are the spouse or civil partner of a UK citizen"],
        ["eu_passport", "whether you hold an EU passport"],
        ["spouse_of_eu_citizen", "whether you are the spouse or civil partner of an EU citizen"],
      ] as const
    ).map(([partKey, asks]) => ({
      partKey,
      rationale: `The form asks ${asks}. This is your own answer to that question.`,
      expectedShape: "yes or no",
      parse: yesNo,
    })),
    assemble: (answered) => {
      const claims: Record<string, boolean> = {};
      for (const key of [
        "british_passport", "indefinite_leave", "refugee_status", "migrant_worker",
        "spouse_of_uk_citizen", "eu_passport", "spouse_of_eu_citizen",
      ]) {
        const claim = answered.get(key);
        if (typeof claim !== "boolean") return null;
        claims[key] = claim;
      }
      return claims as unknown as UkStatusClaims;
    },
  },

  "immigration.uk_study": {
    rationale:
      "The form asks whether you have studied in the UK before, because previous study affects " +
      "both the application and the visa route. If you have not, that is the whole answer.",
    parts: [
      {
        partKey: "kind",
        rationale: "Whether you have studied in the UK before at all.",
        expectedShape: "yes or no",
        parse: heldOrNone,
      },
      {
        partKey: "onStudentVisa",
        rationale:
          "Whether that study was on a student visa. The visa route counts time already spent " +
          "studying here, so it is asked separately from the study itself.",
        expectedShape: "yes or no",
        parse: yesNo,
        askWhen: (answered) => answered.get("kind") === "held",
      },
      {
        partKey: "highestLevel",
        rationale: "The highest level you studied at here.",
        expectedShape:
          "one of: English language, school, foundation, study abroad or exchange, university, other",
        parse: ukStudyLevel,
        askWhen: (answered) => answered.get("kind") === "held",
      },
      {
        partKey: "qualification",
        rationale: "What the qualification was called, if it had a name. If it did not, say none.",
        expectedShape: "the qualification's name, or none",
        parse: trimmed,
        optional: true,
        askWhen: (answered) => answered.get("kind") === "held",
      },
      {
        partKey: "timeOnVisa",
        rationale:
          "How long you spent here on that visa. The visa route counts it exactly, so tell me the " +
          "years and months rather than a rough figure — if you are not sure, say none and a " +
          "person will go through it with you.",
        expectedShape: "years and months, e.g. 2 years 3 months, or 18 months, or none",
        parse: yearsAndMonths,
        optional: true,
        askWhen: (answered) => answered.get("kind") === "held",
      },
      {
        partKey: "currentVisaExpiry",
        rationale: "When your current UK visa expires, if you hold one now. If you do not, say none.",
        expectedShape: "a date, e.g. 2028-09-30, or none",
        parse: isoDate,
        optional: true,
        askWhen: (answered) => answered.get("kind") === "held",
      },
    ],
    assemble: (answered) => {
      const kind = answered.get("kind");
      if (kind === "none") return { kind: "none" };
      if (kind !== "held") return null;

      const onStudentVisa = answered.get("onStudentVisa");
      const highestLevel = answered.get("highestLevel");
      if (typeof onStudentVisa !== "boolean" || typeof highestLevel !== "string") return null;

      const qualification = answered.get("qualification");
      const timeOnVisa = answered.get("timeOnVisa");
      const currentVisaExpiry = answered.get("currentVisaExpiry");
      return {
        kind: "studied",
        onStudentVisa,
        highestLevel: highestLevel as UkStudyLevel,
        ...(typeof qualification === "string" ? { qualification } : {}),
        ...(timeOnVisa !== undefined && timeOnVisa !== OMITTED
          ? { timeOnVisa: timeOnVisa as { years: number; months: number } }
          : {}),
        ...(currentVisaExpiry instanceof Date ? { currentVisaExpiry } : {}),
      };
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
