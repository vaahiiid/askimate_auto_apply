/**
 * Turning bytes into artefacts, field by field.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ADR-0057. `JSON.parse(text) as ApplicationBlueprint` is not a parse — it is
 * an assertion that the file is already what we hoped. It was measured before
 * P20 was written: a blueprint invented from JSON passed `checkExecutable` as
 * EXECUTABLE, a mapping set passed `checkUsable` as USABLE, and `authoredAt`
 * came out as a `String` while its type said `Date`.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * So every field here is read, checked and rebuilt. Nothing the parser does not
 * recognise survives into the artefact, which is what lets `canonical.ts` say
 * that the hash covers exactly what the system will act on.
 *
 * ── Refusals carry a path ─────────────────────────────────────────────────
 *
 * The repository's wire parsers answer `null`, and that is right for them: a
 * malformed request from a browser gets a 400 and the detail would only ever
 * reach a log. This parser is read by an OPERATOR fixing a file, and
 * `pages[2].sections[0].fields[7].inputType` is the difference between a
 * two-minute fix and an afternoon. So the refusal names where it stopped.
 *
 * Internally this is done by throwing and catching at the boundary. Threading
 * a result type through forty mutually recursive readers would bury the shape
 * of the data under the shape of the error handling.
 */

import type {
  ApplicationBlueprint,
  ApplicationRoute,
  AuthenticationModel,
  LoginForm,
  BlueprintField,
  BlueprintId,
  BlueprintPage,
  BlueprintSection,
  BlueprintProvenance,
  BlueprintStatus,
  FieldCondition,
  FieldInputType,
  FieldLocator,
  FieldOption,
  FieldValidation,
  HandoffPoint,
  RequiredDocument,
  SubmissionModel,
  ConsentAssertion,
  ConsentBanner,
  ConsentChoice,
  ConsentStep,
  ConsentVerification,
} from "@askimate/aas-blueprint";
import type {
  FieldMapping,
  MappingSet,
  MappingSetStatus,
  ValueSource,
} from "@askimate/aas-mapping";
import { CREDENTIAL_PURPOSES } from "@askimate/aas-mapping";
import type { FormatRule, OrdinaryFieldKey, ProfileFieldKey } from "@askimate/aas-profile";
import { LIST_VALUED_FIELD_KEYS, PROFILE_FIELD_KEYS, categoryOf } from "@askimate/aas-profile";
import type { ObservedPortalAuthentication, PasswordDelivery, PortalAuthFact } from "@askimate/aas-account";

import type { ReviewedCatalogueEntry } from "./entry.js";

/** Where a parse stopped, and what it wanted there. */
export interface ParseRefusal {
  /** A dotted path into the document, e.g. `pages[2].sections[0].fields[7]`. */
  readonly path: string;
  readonly detail: string;
}

export type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly refusal: ParseRefusal };

class ParseFailure extends Error {
  public constructor(
    public readonly path: string,
    public readonly detail: string,
  ) {
    super(`${path}: ${detail}`);
    this.name = "ParseFailure";
  }
}

function fail(path: string, detail: string): never {
  throw new ParseFailure(path, detail);
}

// ── The readers ────────────────────────────────────────────────────────────

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(path, "expected an object");
  }
  return value as Record<string, unknown>;
}

function text(source: Record<string, unknown>, key: string, path: string): string {
  const value = source[key];
  if (typeof value !== "string") fail(`${path}.${key}`, "expected a string");
  if (value.length === 0) fail(`${path}.${key}`, "expected a non-empty string");
  return value;
}

/** A string that may be absent. An EMPTY string is absent too — see below. */
function optionalText(
  source: Record<string, unknown>,
  key: string,
  path: string,
): string | undefined {
  const value = source[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") fail(`${path}.${key}`, "expected a string when present");
  // An empty optional and an absent one must canonicalise alike, or the same
  // artefact saved by two tools would hash differently.
  return value.length === 0 ? undefined : value;
}

/** A string that may be absent AND may legitimately be empty. */
function optionalTextAllowingEmpty(
  source: Record<string, unknown>,
  key: string,
  path: string,
): string | undefined {
  const value = source[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") fail(`${path}.${key}`, "expected a string when present");
  return value;
}

function flag(source: Record<string, unknown>, key: string, path: string): boolean {
  const value = source[key];
  if (typeof value !== "boolean") fail(`${path}.${key}`, "expected true or false");
  return value;
}

function optionalCount(
  source: Record<string, unknown>,
  key: string,
  path: string,
): number | undefined {
  const value = source[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    fail(`${path}.${key}`, "expected a whole number when present");
  }
  if (value < 0) fail(`${path}.${key}`, "expected a number that is not negative");
  return value;
}

/**
 * An ISO-8601 instant, coerced to a real `Date`.
 *
 * The defect this closes: a cast leaves a `String` in a field typed `Date`, and
 * everything downstream that calls `.getTime()` throws at run time — on a
 * production path, at the moment an artefact is first used.
 *
 * `new Date(...)` accepts a great deal it should not (`"2026"`, `"March"`), so
 * the shape is checked before the value is built, and the round trip confirms
 * the parse agreed with what was written.
 */
function instant(source: Record<string, unknown>, key: string, path: string): Date {
  const value = source[key];
  if (typeof value !== "string") fail(`${path}.${key}`, "expected an ISO-8601 date string");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(value)) {
    fail(`${path}.${key}`, `expected an ISO-8601 UTC instant, e.g. 2026-09-03T09:00:00Z`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) fail(`${path}.${key}`, "is not a real date");
  return parsed;
}

function optionalInstant(
  source: Record<string, unknown>,
  key: string,
  path: string,
): Date | undefined {
  return source[key] === undefined ? undefined : instant(source, key, path);
}

function oneOf<T extends string>(
  source: Record<string, unknown>,
  key: string,
  path: string,
  allowed: readonly T[],
): T {
  const value = source[key];
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    fail(`${path}.${key}`, `expected one of: ${allowed.join(", ")}`);
  }
  return value as T;
}

function optionalOneOf<T extends string>(
  source: Record<string, unknown>,
  key: string,
  path: string,
  allowed: readonly T[],
): T | undefined {
  return source[key] === undefined ? undefined : oneOf(source, key, path, allowed);
}

function list<T>(
  source: Record<string, unknown>,
  key: string,
  path: string,
  read: (item: unknown, itemPath: string) => T,
): readonly T[] {
  const value = source[key];
  if (!Array.isArray(value)) fail(`${path}.${key}`, "expected an array");
  return value.map((item, index) => read(item, `${path}.${key}[${String(index)}]`));
}

/** A required string that may not be blank — `text` already refuses a non-string. */
function title_(source: Record<string, unknown>, key: string, path: string): string {
  const held = text(source, key, path);
  if (held.trim().length === 0) fail(`${path}.${key}`, "is blank");
  return held;
}

function textList(source: Record<string, unknown>, key: string, path: string): readonly string[] {
  return list(source, key, path, (item, itemPath) => {
    if (typeof item !== "string") fail(itemPath, "expected a string");
    return item;
  });
}

function optionalWith<T>(
  source: Record<string, unknown>,
  key: string,
  path: string,
  read: (value: unknown, valuePath: string) => T,
): T | undefined {
  const value = source[key];
  return value === undefined ? undefined : read(value, `${path}.${key}`);
}

// ── Closed sets, written out so a new member forces a decision here ────────

const BLUEPRINT_STATUSES: readonly BlueprintStatus[] = ["draft", "reviewed", "superseded", "retired"];
const MAPPING_STATUSES: readonly MappingSetStatus[] = ["draft", "reviewed", "superseded", "retired"];
const ROUTES: readonly ApplicationRoute[] = ["direct_portal", "partner_portal", "assisted_manual"];
const INPUT_TYPES: readonly FieldInputType[] = [
  "text", "textarea", "email", "password", "tel", "number", "date",
  "select", "multiselect", "radio", "checkbox", "file", "typeahead", "unknown",
];
const LOCATOR_STRATEGIES: readonly FieldLocator["strategy"][] = [
  "label", "name", "id", "css", "role", "placeholder",
];
const VALIDATION_KINDS: readonly FieldValidation["kind"][] = [
  "required", "maxlength", "minlength", "pattern", "min", "max", "accept",
];
const VALIDATION_SOURCES: readonly FieldValidation["source"][] = [
  "dom_attribute", "observed_error", "observed_marker", "specialist_noted",
];
const CONDITION_OPERATORS: readonly FieldCondition["operator"][] = [
  "equals", "not_equals", "is_checked", "is_not_empty", "in",
];
const HANDOFF_KINDS: readonly HandoffPoint["kind"][] = [
  "identity_verification", "mfa", "otp", "captcha", "payment",
  "legal_declaration", "final_submission",
];
const DATE_PATTERNS = [
  "YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY", "DD-MM-YYYY", "D MMMM YYYY", "DD MMM YYYY",
  "D", "MMMM", "YYYY",
] as const;
const PASSWORD_DELIVERIES: readonly PasswordDelivery[] = [
  "student_types_into_portal", "askimate_secure_channel",
];

// ── Blueprint ──────────────────────────────────────────────────────────────

function readLocator(value: unknown, path: string): FieldLocator {
  const source = record(value, path);
  return {
    strategy: oneOf(source, "strategy", path, LOCATOR_STRATEGIES),
    value: text(source, "value", path),
  };
}

function readValidation(value: unknown, path: string): FieldValidation {
  const source = record(value, path);
  const detail = optionalText(source, "value", path);
  return {
    kind: oneOf(source, "kind", path, VALIDATION_KINDS),
    ...(detail === undefined ? {} : { value: detail }),
    source: oneOf(source, "source", path, VALIDATION_SOURCES),
  };
}

function readOption(value: unknown, path: string): FieldOption {
  const source = record(value, path);
  return {
    // A dropdown's value may legitimately be the empty string — the
    // "please select" entry. Refusing it would make a blueprint unable to
    // describe a real portal, which is the failure ADR-0017 §3 is about.
    value: optionalTextAllowingEmpty(source, "value", path) ?? fail(`${path}.value`, "expected a string"),
    // And a radio may have NO text beside it — Sheffield's education page
    // shows two such (P108). The blueprint records what the page shows; an
    // option with nothing to quote is chosen by nothing, which is the rule
    // that makes this safe, not the absence of text.
    label: optionalTextAllowingEmpty(source, "label", path) ?? fail(`${path}.label`, "expected a string"),
  };
}

function readCondition(value: unknown, path: string): FieldCondition {
  const source = record(value, path);
  const single = optionalText(source, "value", path);
  const many = source["values"] === undefined ? undefined : textList(source, "values", path);
  return {
    whenFieldRef: text(source, "whenFieldRef", path),
    operator: oneOf(source, "operator", path, CONDITION_OPERATORS),
    ...(single === undefined ? {} : { value: single }),
    ...(many === undefined ? {} : { values: many }),
  };
}

function readField(value: unknown, path: string): BlueprintField {
  const source = record(value, path);
  const options = source["options"] === undefined
    ? undefined
    : list(source, "options", path, readOption);
  const visibleWhen = optionalWith(source, "visibleWhen", path, readCondition);
  const optionsAfter = optionalWith(source, "optionsAfter", path, (held, at) => {
    const block = record(held, at);
    const press = optionalWith(block, "press", at, readLocator);
    return { fieldRef: text(block, "fieldRef", at), ...(press === undefined ? {} : { press }) };
  });
  const typeahead = optionalWith(source, "typeahead", path, (held, at) => {
    const block = record(held, at);
    const escapeValue = optionalText(block, "escapeValue", at);
    return {
      optionLocator: readLocator(block["optionLocator"], `${at}.optionLocator`),
      ...(escapeValue === undefined ? {} : { escapeValue }),
    };
  });
  const mapsTo = optionalText(source, "mapsTo", path);
  const frontedBy = optionalText(source, "frontedBy", path);
  // ADR-0102: the reviewer's classification. Optional here — a draft has none
  // — and refused absent by `checkUsable`, not by the parser.
  const dataCategory =
    source["dataCategory"] === undefined
      ? undefined
      : oneOf(source, "dataCategory", path, ["ordinary", "special_category"] as const);
  const labelSource =
    source["labelSource"] === undefined ? undefined : oneOf(source, "labelSource", path, ["row_text"] as const);
  return {
    fieldRef: text(source, "fieldRef", path),
    label: text(source, "label", path),
    ...(labelSource === undefined ? {} : { labelSource }),
    inputType: oneOf(source, "inputType", path, INPUT_TYPES),
    ...(dataCategory === undefined ? {} : { dataCategory }),
    locators: list(source, "locators", path, readLocator),
    validations: list(source, "validations", path, readValidation),
    ...(options === undefined ? {} : { options }),
    ...(visibleWhen === undefined ? {} : { visibleWhen }),
    ...(optionsAfter === undefined ? {} : { optionsAfter }),
    ...(typeahead === undefined ? {} : { typeahead }),
    ...(mapsTo === undefined ? {} : { mapsTo }),
    ...(frontedBy === undefined ? {} : { frontedBy }),
  };
}

function readSection(value: unknown, path: string): BlueprintSection {
  const source = record(value, path);
  const visibleWhen = optionalWith(source, "visibleWhen", path, readCondition);
  // ADR-0119: the portal's own words that the section may be skipped.
  const optional = optionalWith(source, "optional", path, (raw, at) => ({
    formSays: text(record(raw, at), "formSays", at),
  }));
  return {
    sectionRef: text(source, "sectionRef", path),
    title: text(source, "title", path),
    fields: list(source, "fields", path, readField),
    ...(visibleWhen === undefined ? {} : { visibleWhen }),
    ...(optional === undefined ? {} : { optional }),
  };
}

function readRequiredDocument(value: unknown, path: string): RequiredDocument {
  const source = record(value, path);
  const maxSizeBytes = optionalCount(source, "maxSizeBytes", path);
  const requiredWhen = optionalWith(source, "requiredWhen", path, readCondition);
  const companion = optionalWith(source, "companion", path, (value, at) => {
    const held = record(value, at);
    const whenAttached = text(held, "whenAttached", at);
    // ADR-0107: the defer-style value is ours to say; the refusal-style one
    // never is, and the two may not be the same option.
    const whenDeferred = optionalText(held, "whenDeferred", at);
    const whenNotProviding = optionalText(held, "whenNotProviding", at);
    if (whenDeferred !== undefined && whenDeferred === whenNotProviding) {
      fail(`${at}.whenDeferred`, `is the option that says the document will not be provided, which is never ours to say`);
    }
    if (whenDeferred !== undefined && whenDeferred === whenAttached) {
      fail(`${at}.whenDeferred`, `is the option set when a file is attached, not a deferral`);
    }
    if (whenNotProviding !== undefined && whenNotProviding === whenAttached) {
      fail(`${at}.whenNotProviding`, `is the option set when a file is attached`);
    }
    return {
      fieldRef: text(held, "fieldRef", at),
      whenAttached,
      ...(whenDeferred === undefined ? {} : { whenDeferred }),
      ...(whenNotProviding === undefined ? {} : { whenNotProviding }),
    };
  });
  // ADR-0139: the page's own name for this document, and the captured text it
  // was read out of. The reviewer's judgement is where the heading ends; the
  // words are the capture's, and the prefix check holds them to it.
  const title = optionalWith(source, "title", path, (value, at) => {
    const held = record(value, at);
    const text = title_(held, "text", at);
    const readFrom = title_(held, "readFrom", at);
    if (!readFrom.startsWith(text) || (readFrom.length > text.length && readFrom[text.length] !== " ")) {
      fail(
        `${at}.text`,
        `is not how the captured text begins — a document's name in front of a student is read from ` +
          `the page, never composed (ADR-0139)`,
      );
    }
    return { text, readFrom };
  });
  // ADR-0138: the entries this slot is asked for, on a page that repeats.
  const askedWhen = optionalWith(source, "askedWhen", path, (value, at) => {
    const held = record(value, at);
    const part = textList(held, "part", at);
    const is = textList(held, "is", at);
    // A path with no parts reads the entry itself, and an empty list of
    // answers is a slot asked for NOTHING. Both are almost certainly a
    // half-written condition, and neither may pass as a rule about a document.
    if (part.length === 0) fail(`${at}.part`, "names no part of the entry to read");
    if (part.some((step) => step.trim().length === 0)) fail(`${at}.part`, "has a blank step");
    if (is.length === 0) fail(`${at}.is`, "names no answer the form asks this slot for");
    return { part, is, because: text(held, "because", at) };
  });
  // ADR-0106: what the page shows when a file is held here.
  const recorded = optionalWith(source, "recorded", path, readLocator);
  return {
    fieldRef: text(source, "fieldRef", path),
    label: text(source, "label", path),
    acceptedFormats: textList(source, "acceptedFormats", path),
    ...(maxSizeBytes === undefined ? {} : { maxSizeBytes }),
    required: flag(source, "required", path),
    ...(requiredWhen === undefined ? {} : { requiredWhen }),
    ...(companion === undefined ? {} : { companion }),
    ...(title === undefined ? {} : { title }),
    ...(askedWhen === undefined ? {} : { askedWhen }),
    ...(recorded === undefined ? {} : { recorded }),
  };
}

function readPage(value: unknown, path: string): BlueprintPage {
  const source = record(value, path);
  const url = optionalText(source, "url", path);
  const advanceControl = optionalWith(source, "advanceControl", path, readLocator);
  const nextPageRef = optionalText(source, "nextPageRef", path);
  const repeats = optionalWith(source, "repeats", path, (held, at) => {
    const block = record(held, at);
    const fieldKey = text(block, "fieldKey", at);
    // A page may repeat only over a list-valued, ordinary field: nothing at
    // runtime could otherwise tell "once per qualification" from "once per
    // given name", and a special-category list may not reach a form at all.
    if (!(LIST_VALUED_FIELD_KEYS as readonly string[]).includes(fieldKey)) {
      fail(`${at}.fieldKey`, `is not a list-valued profile field a page can repeat over`);
    }
    if (categoryOf(fieldKey as ProfileFieldKey) !== "ordinary") {
      fail(`${at}.fieldKey`, `is not an ordinary field and may not be mapped to a form`);
    }
    const addAnother = optionalWith(block, "addAnother", at, readLocator);
    // ADR-0106: where the saved entries are listed, and what one entry is.
    const recorded = optionalWith(block, "recorded", at, (value, where) => {
      const listing = record(value, where);
      return { url: text(listing, "url", where), entryLocator: readLocator(listing["entryLocator"], `${where}.entryLocator`) };
    });
    return {
      fieldKey,
      ...(addAnother === undefined ? {} : { addAnother }),
      ...(recorded === undefined ? {} : { recorded }),
    };
  });
  const sections = list(source, "sections", path, readSection);
  const requiredDocuments = list(source, "requiredDocuments", path, readRequiredDocument);
  // ADR-0139: where a slot has a companion on this page, the text a title was
  // read out of must BE that field's captured label. A reviewer quoting a
  // capture that is not in the file is the failure this catches, and it is the
  // same class as ADR-0136's: a claim about the page, checked against the page.
  const labelOnPage = new Map(
    sections.flatMap((section) => section.fields.map((field) => [field.fieldRef, field.label] as const)),
  );
  for (const document of requiredDocuments) {
    const companionRef = document.companion?.fieldRef;
    if (document.title === undefined || companionRef === undefined) continue;
    const captured = labelOnPage.get(companionRef);
    if (captured === undefined || captured === document.title.readFrom) continue;
    fail(
      `${path}.requiredDocuments.title.readFrom`,
      `for "${document.fieldRef}" is not the captured label of "${companionRef}" on this page`,
    );
  }
  // ADR-0138: the condition is answered against the page's own entry, so on a
  // page that does not repeat there is nothing to answer it against. Refused
  // here rather than ignored at plan time: a slot carrying a rule that decides
  // nothing would read to a reviewer as a rule that decides something.
  if (repeats === undefined) {
    const conditioned = requiredDocuments.find((document) => document.askedWhen !== undefined);
    if (conditioned !== undefined) {
      fail(
        `${path}.requiredDocuments`,
        `"${conditioned.fieldRef}" is asked for only some entries, on a page that does not repeat`,
      );
    }
  }
  return {
    pageRef: text(source, "pageRef", path),
    title: text(source, "title", path),
    ...(url === undefined ? {} : { url }),
    sections,
    requiredDocuments,
    ...(advanceControl === undefined ? {} : { advanceControl }),
    ...(nextPageRef === undefined ? {} : { nextPageRef }),
    ...(repeats === undefined ? {} : { repeats }),
  };
}

function readHandoff(value: unknown, path: string): HandoffPoint {
  const source = record(value, path);
  return {
    pageRef: text(source, "pageRef", path),
    kind: oneOf(source, "kind", path, HANDOFF_KINDS),
    description: text(source, "description", path),
  };
}

function readLoginForm(value: unknown, path: string): LoginForm {
  const source = record(value, path);
  return {
    emailLocator: readLocator(source["emailLocator"], `${path}.emailLocator`),
    passwordLocator: readLocator(source["passwordLocator"], `${path}.passwordLocator`),
    submitLocator: readLocator(source["submitLocator"], `${path}.submitLocator`),
  };
}

/**
 * A consent notice on the login page (ADR-0131): its own words, and two or
 * more choices, each with the button's label, what it means in plain terms,
 * and where it is. Every string is a reviewer's, read by a student.
 */
/**
 * A string that must carry the control's own words.
 *
 * ADR-0131 as amended in P166 (Vahid): *"A button whose meaning is set by
 * configuration the student cannot see is a button nobody can be honestly
 * asked about."* Empty or whitespace is no words at all — the close control
 * every consent library ships — and P169 pushes the same rule one level in, to
 * every step of a choice's path.
 */
function words(source: Record<string, unknown>, key: string, path: string): string {
  const value = text(source, key, path);
  if (value.trim().length === 0) {
    fail(`${path}.${key}`, "expected the control's own words — a control with no words is never a choice");
  }
  return value;
}

/** One control on a choice's path: its own words, and where it is. */
function readConsentStep(value: unknown, path: string): ConsentStep {
  const source = record(value, path);
  return { label: words(source, "label", path), locator: readLocator(source["locator"], `${path}.locator`) };
}

/** One assertion about the portal's own consent record, checked after the path. */
function readConsentAssertion(value: unknown, path: string): ConsentAssertion {
  const source = record(value, path);
  const keys = textList(source, "path", path);
  if (keys.length === 0) fail(`${path}.path`, "expected at least one key to read");
  keys.forEach((key, index) => {
    if (key.trim().length === 0) fail(`${path}.path[${String(index)}]`, "expected a key");
  });
  const present = flag(source, "present", path);
  const equals = source["equals"];
  if (equals !== undefined && typeof equals !== "string" && typeof equals !== "boolean") {
    fail(`${path}.equals`, "expected a string or true or false");
  }
  // An exact value for a key that must not be there asserts two things at
  // once, and the second could never hold: refused rather than ignored.
  if (equals !== undefined && !present) fail(`${path}.equals`, "expected no value where the key must be absent");
  return {
    path: keys,
    present,
    ...(equals === undefined ? {} : { equals: equals }),
    means: words(source, "means", path),
  };
}

/**
 * The read-back: where the portal keeps its record, and what must be true of
 * it once the path has been pressed.
 *
 * A choice with no read-back is a choice we would have to trust a button for,
 * and what a consent control records is set by configuration nobody outside
 * the portal can see. So it is required, and a notice whose record cannot be
 * verified cannot be authored — which is the boundary, not an oversight.
 */
function readConsentVerification(value: unknown, path: string): ConsentVerification {
  const source = record(value, path);
  const cookie = words(source, "cookie", path);
  const mustHold = list(source, "mustHold", path, readConsentAssertion);
  if (mustHold.length === 0) fail(`${path}.mustHold`, "expected at least one assertion to check");
  return { cookie, mustHold };
}

/** One choice: what it is called, what it means, how it is made, how it is checked. */
function readConsentChoice(value: unknown, path: string): ConsentChoice {
  const source = record(value, path);
  const steps = list(source, "path", path, readConsentStep);
  if (steps.length === 0) fail(`${path}.path`, "expected at least one control to press");
  // P172: a sequence that is not self-evident from its buttons has to say what
  // it means. On a portal with no control that says no, that sentence is where
  // the student learns there is none — rather than inferring it from a path
  // that ends in "close".
  const howItIsMade = steps.length > 1 ? words(source, "howItIsMade", path) : optionalText(source, "howItIsMade", path);
  if (howItIsMade !== undefined && howItIsMade.trim().length === 0) {
    fail(`${path}.howItIsMade`, "expected words");
  }
  return {
    id: text(source, "id", path),
    label: words(source, "label", path),
    means: words(source, "means", path),
    path: steps,
    ...(howItIsMade === undefined ? {} : { howItIsMade }),
    verify: readConsentVerification(source["verify"], `${path}.verify`),
  };
}

function readConsentBanner(value: unknown, path: string): ConsentBanner {
  const source = record(value, path);
  const choices = list(source, "choices", path, readConsentChoice);
  if (choices.length < 2) fail(`${path}.choices`, "expected at least two choices");
  if (new Set(choices.map((choice) => choice.id)).size !== choices.length) {
    fail(`${path}.choices`, "expected every choice id to be distinct");
  }
  return {
    words: words(source, "words", path),
    // Required (P169): a question that cannot say what already ran would offer
    // a refusal wider than the portal can honour.
    beforeAnyChoice: words(source, "beforeAnyChoice", path),
    choices,
  };
}

function readAuthentication(value: unknown, path: string): AuthenticationModel {
  const source = record(value, path);
  const loginUrl = optionalText(source, "loginUrl", path);
  const login = optionalWith(source, "login", path, readLoginForm);
  const consent = optionalWith(source, "consent", path, readConsentBanner);
  return {
    required: flag(source, "required", path),
    ...(loginUrl === undefined ? {} : { loginUrl }),
    ...(login === undefined ? {} : { login }),
    ...(consent === undefined ? {} : { consent }),
    accountCreationRequired: flag(source, "accountCreationRequired", path),
    // Notes are free text and an empty note is a real state.
    notes: optionalTextAllowingEmpty(source, "notes", path) ?? fail(`${path}.notes`, "expected a string"),
  };
}

function readSubmission(value: unknown, path: string): SubmissionModel {
  const source = record(value, path);
  const submitControl = optionalWith(source, "submitControl", path, readLocator);
  const receiptLocator = optionalWith(source, "receiptLocator", path, readLocator);
  return {
    pageRef: text(source, "pageRef", path),
    ...(submitControl === undefined ? {} : { submitControl }),
    confirmationIndicators: textList(source, "confirmationIndicators", path),
    ...(receiptLocator === undefined ? {} : { receiptLocator }),
  };
}

function readProvenance(value: unknown, path: string): BlueprintProvenance {
  const source = record(value, path);
  const reviewedBy = optionalText(source, "reviewedBy", path);
  const reviewedAt = optionalInstant(source, "reviewedAt", path);
  return {
    discoveryRunId: text(source, "discoveryRunId", path),
    discoveredAt: instant(source, "discoveredAt", path),
    observedUrls: textList(source, "observedUrls", path),
    ...(reviewedBy === undefined ? {} : { reviewedBy }),
    ...(reviewedAt === undefined ? {} : { reviewedAt }),
    unobservedClaims: textList(source, "unobservedClaims", path),
  };
}

function readBlueprint(value: unknown, path: string): ApplicationBlueprint {
  const source = record(value, path);
  const campus = optionalText(source, "campus", path);
  const platform = optionalText(source, "platform", path);
  const submission = optionalWith(source, "submission", path, readSubmission);
  return {
    // The brand is applied HERE and only here for a loaded blueprint. That is
    // the point of a branded id: there is one sanctioned construction, and it
    // is downstream of a check.
    blueprintId: text(source, "blueprintId", path) as BlueprintId,
    version: text(source, "version", path),
    status: oneOf(source, "status", path, BLUEPRINT_STATUSES),
    institutionName: text(source, "institutionName", path),
    ...(campus === undefined ? {} : { campus }),
    courseName: text(source, "courseName", path),
    intake: text(source, "intake", path),
    route: oneOf(source, "route", path, ROUTES),
    ...(platform === undefined ? {} : { platform }),
    authentication: readAuthentication(source["authentication"], `${path}.authentication`),
    pages: uniqueFieldRefs(list(source, "pages", path, readPage), `${path}.pages`),
    handoffPoints: list(source, "handoffPoints", path, readHandoff),
    ...(submission === undefined ? {} : { submission }),
    provenance: readProvenance(source["provenance"], `${path}.provenance`),
  };
}

/**
 * A fieldRef names one field in the whole blueprint, not one per page.
 *
 * Found on the first real form rather than designed (P93): the Sheffield
 * language page and its education page both called a file input `certificate`
 * and its status radio `certificateStatus`, and the draft parsed. Every
 * consumer keys by fieldRef alone — a mapping set's `fieldRef`, the plan's
 * instructions, the preview's lines, the companion check — so a repeated one
 * is an ambiguity each would resolve silently, and not all the same way. The
 * refusal lands on the SECOND occurrence, at its own path, and names the first.
 */
function uniqueFieldRefs(pages: readonly BlueprintPage[], path: string): readonly BlueprintPage[] {
  const seen = new Map<string, string>();
  pages.forEach((page, p) => {
    page.sections.forEach((section, s) => {
      section.fields.forEach((field, f) => {
        const at = `${path}[${p}].sections[${s}].fields[${f}]`;
        const first = seen.get(field.fieldRef);
        if (first !== undefined) {
          fail(`${at}.fieldRef`, `"${field.fieldRef}" is already the fieldRef of ${first}; a fieldRef names one field in the blueprint`);
        }
        seen.set(field.fieldRef, at);
      });
    });
  });
  return pages;
}

// ── Mapping set ────────────────────────────────────────────────────────────

function readFormatRule(value: unknown, path: string): FormatRule {
  const source = record(value, path);
  const kind = oneOf(source, "kind", path, [
    "text", "uppercase", "date", "part", "join", "option", "number", "money_amount", "money_currency", "uk_postcode",
    "not_derivable",
  ] as const);

  switch (kind) {
    case "date": {
      const then = optionalWith(source, "then", path, readFormatRule);
      return { kind, pattern: oneOf(source, "pattern", path, DATE_PATTERNS), ...(then === undefined ? {} : { then }) };
    }
    case "part": {
      const then = optionalWith(source, "then", path, readFormatRule);
      const absent = readAbsent(source["absent"], `${path}.absent`);
      return {
        kind,
        path: text(source, "path", path),
        ...(then === undefined ? {} : { then }),
        ...(absent === undefined ? {} : { absent }),
      };
    }
    case "join": {
      const parts = list(source, "parts", path, (part, at) => {
        if (typeof part !== "string" || part.length === 0) fail(at, "expected a part name");
        return part;
      });
      if (parts.length === 0) fail(`${path}.parts`, "expected at least one part");
      return { kind, parts, separator: text(source, "separator", path) };
    }
    case "option": {
      const options = record(source["options"], `${path}.options`);
      const rebuilt: Record<string, string> = {};
      for (const key of Object.keys(options)) {
        const mapped = options[key];
        if (typeof mapped !== "string") fail(`${path}.options.${key}`, "expected a string");
        rebuilt[key] = mapped;
      }
      return { kind, options: rebuilt };
    }
    case "uk_postcode":
      return { kind, part: oneOf(source, "part", path, ["outward", "inward"] as const) };
    case "not_derivable": {
      // The reason is REQUIRED and must be substantial. This rule's whole
      // purpose is that whoever meets the stop reads why no mapping can be
      // right; an empty or one-word reason would leave them exactly where an
      // empty option map leaves them, which is what it replaces (blocker 71).
      const reason = text(source, "reason", path);
      if (reason.length < 40) {
        fail(
          `${path}.reason`,
          "expected a reason that says what fact is missing and why no mapping can be right — " +
            "this text is what the next person reads instead of adding rows",
        );
      }
      return { kind, reason };
    }
    case "text":
    case "uppercase":
    case "number":
    case "money_amount":
    case "money_currency":
      return { kind };
  }
}

function readValueSource(value: unknown, path: string): ValueSource {
  const source = record(value, path);
  const kind = oneOf(source, "kind", path, [
    "profile_field", "document", "student_handoff", "constant", "secure_credential", "form_refusal",
  ] as const);

  switch (kind) {
    case "profile_field": {
      const fieldKey = text(source, "fieldKey", path);
      if (!(PROFILE_FIELD_KEYS as readonly string[]).includes(fieldKey)) {
        fail(`${path}.fieldKey`, `is not a canonical profile field`);
      }
      // ADR-0102: a mapping may name only an ordinary field. Refused here so a
      // file cannot say what the type forbids.
      if (categoryOf(fieldKey as ProfileFieldKey) !== "ordinary") {
        fail(`${path}.fieldKey`, `is not an ordinary field and may not be mapped to a form`);
      }
      return {
        kind,
        fieldKey: fieldKey as OrdinaryFieldKey,
        format: readFormatRule(source["format"], `${path}.format`),
      };
    }
    case "document":
      return { kind, documentRef: text(source, "documentRef", path) };
    case "student_handoff":
      return { kind, reason: text(source, "reason", path) };
    case "constant":
      return {
        kind,
        value: optionalTextAllowingEmpty(source, "value", path) ?? fail(`${path}.value`, "expected a string"),
        // The classification is a closed set of ONE. ADR-0017: a constant must
        // be declared application metadata, and there is no other kind — so a
        // file naming a second classification is refused rather than widened.
        classification: oneOf(source, "classification", path, ["application_metadata"] as const),
        // Mandatory, and non-empty. A rationale is what a reviewer reads to
        // decide whether this really is metadata and not a student's data.
        rationale: text(source, "rationale", path),
      };
    case "secure_credential":
      return { kind, purpose: oneOf(source, "purpose", path, CREDENTIAL_PURPOSES) };
    case "form_refusal": {
      // ADR-0102. The value is what the form offers; whether the form offers
      // it is `checkUsable`'s question, against the blueprint. Rationale is
      // mandatory; `formSays` is optional and, when present, must be the
      // form's own words — also `checkUsable`'s question.
      const formSays = optionalText(source, "formSays", path);
      const covers = source["covers"] === undefined ? undefined : textList(source, "covers", path);
      return {
        kind,
        value: text(source, "value", path),
        rationale: text(source, "rationale", path),
        ...(formSays === undefined ? {} : { formSays }),
        ...(covers === undefined ? {} : { covers }),
      };
    }
  }
}

function readMapping(value: unknown, path: string): FieldMapping {
  const source = record(value, path);
  const note = optionalText(source, "note", path);
  return {
    fieldRef: text(source, "fieldRef", path),
    source: readValueSource(source["source"], `${path}.source`),
    ...(note === undefined ? {} : { note }),
  };
}

function readMappingSet(value: unknown, path: string): MappingSet {
  const source = record(value, path);
  const reviewedBy = optionalText(source, "reviewedBy", path);
  const reviewedAt = optionalInstant(source, "reviewedAt", path);
  return {
    mappingSetId: text(source, "mappingSetId", path),
    version: text(source, "version", path),
    status: oneOf(source, "status", path, MAPPING_STATUSES),
    blueprintId: text(source, "blueprintId", path),
    blueprintVersion: text(source, "blueprintVersion", path),
    mappings: list(source, "mappings", path, readMapping),
    authoredBy: text(source, "authoredBy", path),
    authoredAt: instant(source, "authoredAt", path),
    ...(reviewedBy === undefined ? {} : { reviewedBy }),
    ...(reviewedAt === undefined ? {} : { reviewedAt }),
  };
}

// ── Observed portal authentication ─────────────────────────────────────────

/**
 * `true | false | "unobserved"`, and the third member is why this is not a flag.
 *
 * A boolean would force every unknown to `false`, and `false` reads as an
 * observation. A file that omits the field is refused rather than defaulted:
 * "we did not look" has to be written down deliberately.
 */
function authFact(source: Record<string, unknown>, key: string, path: string): PortalAuthFact {
  const value = source[key];
  if (typeof value === "boolean") return value;
  if (value === "unobserved") return "unobserved";
  fail(`${path}.${key}`, 'expected true, false, or "unobserved"');
}

function readPortalAuthentication(value: unknown, path: string): ObservedPortalAuthentication {
  const source = record(value, path);
  return {
    portalHost: text(source, "portalHost", path),
    discoveryRunId: text(source, "discoveryRunId", path),
    observedAt: instant(source, "observedAt", path),
    applicantChoosesPassword: authFact(source, "applicantChoosesPassword", path),
    portalIssuesCredential: authFact(source, "portalIssuesCredential", path),
    passwordlessAvailable: authFact(source, "passwordlessAvailable", path),
    emailVerificationRequired: authFact(source, "emailVerificationRequired", path),
    mfaOrOtpRequired: authFact(source, "mfaOrOtpRequired", path),
    captchaPresent: authFact(source, "captchaPresent", path),
    passwordResetAvailable: authFact(source, "passwordResetAvailable", path),
    credentialsCanBeHandedBack: authFact(source, "credentialsCanBeHandedBack", path),
  };
}

// ── The reviewed entry ─────────────────────────────────────────────────────

function readEntry(value: unknown, path: string): ReviewedCatalogueEntry {
  const source = record(value, path);
  const portalAuthentication = optionalWith(
    source,
    "portalAuthentication",
    path,
    readPortalAuthentication,
  );
  const passwordDelivery = optionalOneOf(source, "passwordDelivery", path, PASSWORD_DELIVERIES);
  return {
    blueprint: readBlueprint(source["blueprint"], `${path}.blueprint`),
    mappingSet: readMappingSet(source["mappingSet"], `${path}.mappingSet`),
    requiredDocuments: textList(source, "requiredDocuments", path),
    institutionRef: text(source, "institutionRef", path),
    courseRef: text(source, "courseRef", path),
    // `YYYY-MM`. The submission identity, and the reason it is not derived from
    // the blueprint's `intake` label — see `CatalogueEntry.intakeRef`.
    intakeRef: intakeMonth(source, "intakeRef", path),
    ...(portalAuthentication === undefined ? {} : { portalAuthentication }),
    ...(passwordDelivery === undefined ? {} : { passwordDelivery }),
  };
}

function intakeMonth(source: Record<string, unknown>, key: string, path: string): string {
  const value = text(source, key, path);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    fail(`${path}.${key}`, "expected YYYY-MM, e.g. 2026-09");
  }
  return value;
}

// ── The boundary ───────────────────────────────────────────────────────────

function boundary<T>(read: () => T): ParseResult<T> {
  try {
    return { ok: true, value: read() };
  } catch (error) {
    if (error instanceof ParseFailure) {
      return { ok: false, refusal: { path: error.path, detail: error.detail } };
    }
    throw error;
  }
}

/** Rebuilds an `ApplicationBlueprint` from an already-decoded JSON value. */
export function parseBlueprint(value: unknown): ParseResult<ApplicationBlueprint> {
  return boundary(() => readBlueprint(value, "blueprint"));
}

/** Rebuilds a `MappingSet` from an already-decoded JSON value. */
export function parseMappingSet(value: unknown): ParseResult<MappingSet> {
  return boundary(() => readMappingSet(value, "mappingSet"));
}

/** Rebuilds a whole reviewed entry — both artefacts and the reviewed facts. */
export function parseReviewedEntry(value: unknown): ParseResult<ReviewedCatalogueEntry> {
  return boundary(() => readEntry(value, "entry"));
}

/**
 * Decodes text and parses it.
 *
 * Malformed JSON is a refusal like any other rather than a thrown
 * `SyntaxError`, because the caller is a startup path that must report every
 * problem it finds rather than crash on the first (ADR-0055).
 */
export function parseReviewedEntryText(text_: string): ParseResult<ReviewedCatalogueEntry> {
  let decoded: unknown;
  try {
    decoded = JSON.parse(text_);
  } catch {
    return { ok: false, refusal: { path: "entry", detail: "is not valid JSON" } };
  }
  return parseReviewedEntry(decoded);
}

/**
 * The `absent` clause of a `part` rule: `"leave_empty"`, or `{ typed }` — the
 * portal's own instruction for a stated absence, quoted (ADR-0117). Non-empty:
 * an empty typed text would be `leave_empty` wearing a costume.
 */
function readAbsent(value: unknown, path: string): "leave_empty" | { readonly typed: string } | undefined {
  if (value === undefined) return undefined;
  if (value === "leave_empty") return "leave_empty";
  const source = record(value, path);
  const typed = text(source, "typed", path);
  if (typed.trim().length === 0) fail(`${path}.typed`, "expected the portal's words, not an empty string");
  return { typed };
}
