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
} from "@askimate/aas-blueprint";
import type {
  FieldMapping,
  MappingSet,
  MappingSetStatus,
  ValueSource,
} from "@askimate/aas-mapping";
import { CREDENTIAL_PURPOSES } from "@askimate/aas-mapping";
import type { FormatRule, ProfileFieldKey } from "@askimate/aas-profile";
import { PROFILE_FIELD_KEYS } from "@askimate/aas-profile";
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
  "select", "multiselect", "radio", "checkbox", "file", "unknown",
];
const LOCATOR_STRATEGIES: readonly FieldLocator["strategy"][] = [
  "label", "name", "id", "css", "role", "placeholder",
];
const VALIDATION_KINDS: readonly FieldValidation["kind"][] = [
  "required", "maxlength", "minlength", "pattern", "min", "max", "accept",
];
const VALIDATION_SOURCES: readonly FieldValidation["source"][] = [
  "dom_attribute", "observed_error", "specialist_noted",
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
    label: text(source, "label", path),
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
  const mapsTo = optionalText(source, "mapsTo", path);
  return {
    fieldRef: text(source, "fieldRef", path),
    label: text(source, "label", path),
    inputType: oneOf(source, "inputType", path, INPUT_TYPES),
    locators: list(source, "locators", path, readLocator),
    validations: list(source, "validations", path, readValidation),
    ...(options === undefined ? {} : { options }),
    ...(visibleWhen === undefined ? {} : { visibleWhen }),
    ...(mapsTo === undefined ? {} : { mapsTo }),
  };
}

function readSection(value: unknown, path: string): BlueprintSection {
  const source = record(value, path);
  const visibleWhen = optionalWith(source, "visibleWhen", path, readCondition);
  return {
    sectionRef: text(source, "sectionRef", path),
    title: text(source, "title", path),
    fields: list(source, "fields", path, readField),
    ...(visibleWhen === undefined ? {} : { visibleWhen }),
  };
}

function readRequiredDocument(value: unknown, path: string): RequiredDocument {
  const source = record(value, path);
  const maxSizeBytes = optionalCount(source, "maxSizeBytes", path);
  const requiredWhen = optionalWith(source, "requiredWhen", path, readCondition);
  return {
    documentRef: text(source, "documentRef", path),
    label: text(source, "label", path),
    acceptedFormats: textList(source, "acceptedFormats", path),
    ...(maxSizeBytes === undefined ? {} : { maxSizeBytes }),
    required: flag(source, "required", path),
    ...(requiredWhen === undefined ? {} : { requiredWhen }),
  };
}

function readPage(value: unknown, path: string): BlueprintPage {
  const source = record(value, path);
  const url = optionalText(source, "url", path);
  const advanceControl = optionalWith(source, "advanceControl", path, readLocator);
  const nextPageRef = optionalText(source, "nextPageRef", path);
  return {
    pageRef: text(source, "pageRef", path),
    title: text(source, "title", path),
    ...(url === undefined ? {} : { url }),
    sections: list(source, "sections", path, readSection),
    requiredDocuments: list(source, "requiredDocuments", path, readRequiredDocument),
    ...(advanceControl === undefined ? {} : { advanceControl }),
    ...(nextPageRef === undefined ? {} : { nextPageRef }),
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

function readAuthentication(value: unknown, path: string): AuthenticationModel {
  const source = record(value, path);
  const loginUrl = optionalText(source, "loginUrl", path);
  return {
    required: flag(source, "required", path),
    ...(loginUrl === undefined ? {} : { loginUrl }),
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
    pages: list(source, "pages", path, readPage),
    handoffPoints: list(source, "handoffPoints", path, readHandoff),
    ...(submission === undefined ? {} : { submission }),
    provenance: readProvenance(source["provenance"], `${path}.provenance`),
  };
}

// ── Mapping set ────────────────────────────────────────────────────────────

function readFormatRule(value: unknown, path: string): FormatRule {
  const source = record(value, path);
  const kind = oneOf(source, "kind", path, [
    "text", "uppercase", "date", "part", "option", "number", "money_amount", "money_currency",
  ] as const);

  switch (kind) {
    case "date":
      return { kind, pattern: oneOf(source, "pattern", path, DATE_PATTERNS) };
    case "part": {
      const then = optionalWith(source, "then", path, readFormatRule);
      return { kind, path: text(source, "path", path), ...(then === undefined ? {} : { then }) };
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
    "profile_field", "document", "student_handoff", "constant", "secure_credential",
  ] as const);

  switch (kind) {
    case "profile_field": {
      const fieldKey = text(source, "fieldKey", path);
      if (!(PROFILE_FIELD_KEYS as readonly string[]).includes(fieldKey)) {
        fail(`${path}.fieldKey`, `is not a canonical profile field`);
      }
      return {
        kind,
        fieldKey: fieldKey as ProfileFieldKey,
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
