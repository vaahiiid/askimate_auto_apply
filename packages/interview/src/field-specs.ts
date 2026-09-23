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
 * A two-letter ISO-3166 country code, and nothing else.
 *
 * **"Iran" is refused.** Turning a country name into `IR` is a lookup, and the
 * only honest ways to do one are a reviewed table or a refusal (Vahid,
 * 2026-09-23: *"a value the student did not state is never supplied by us"*).
 * A half-table would work for some students and silently fail for others,
 * which is worse than a refusal because the failure is invisible.
 *
 * There is no reviewed country table in this repository yet. Until there is,
 * this asks for the code and says so — see `docs/where-we-are.md` for the gap
 * this leaves, which also covers the three free-text country fields.
 *
 * The shape is checked, not the membership: `ZZ` is a well-formed code that no
 * country holds, and refusing it would need the table this does not have.
 */
const countryCodeIso2 = (raw: string): string | null => {
  const value = raw.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(value) ? value : null;
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
          "The country, as its two-letter code — IR for Iran, GB for the United Kingdom. " +
          "I ask for the code rather than working it out from the country's name, because " +
          "guessing it wrong would put the wrong country on your application.",
        expectedShape: "a two-letter country code, e.g. IR or GB",
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
