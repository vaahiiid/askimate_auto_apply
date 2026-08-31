/**
 * What the Automation Runner is given to do — the internal work API.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ADR-0045. The runner PULLS: it claims a unit of work from the Application
 * Plane and reports how it ended. Nothing calls into the runner, because
 * ADR-0037 gives it exactly one inbound port — a CDP endpoint reachable by the
 * fill agent alone — and a control API would be a second.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Read the fields, then read what is absent ─────────────────────────────
 *
 * Identifiers, four closed-set words, a portal host, the student's own email
 * address, and an opaque handle. There is no password, no profile, no fill
 * value, no document, and no database credential — the runner is the component
 * that loads pages we do not control, and every one of those would be a thing a
 * compromised page's process could go looking for.
 *
 * The handle is the one that looks like it should not be here and is. A
 * `SecretHandle` is `sh_` plus 32 random hex digits, derived from nothing, and
 * it resolves to a value only inside a live vault the runner has no vault, no
 * KMS grant and no service certificate to reach (ADR-0026, ADR-0042, and the
 * dependency rules in `scripts/check-boundaries.ts`). The runner hands it to the
 * fill agent, which resolves it inside the Secure Plane. Seeing one confers
 * nothing, which is the whole reason handles exist.
 *
 * ── Why this package and not a route file ─────────────────────────────────
 *
 * ADR-0040. `@askimate/aas-contracts` has no dependencies at all, so a wire type
 * declared here cannot quietly acquire a `ConfirmedValue`, a `FillPlan` or a
 * `SecretHandle` by importing one — the compiler enforces the omission above,
 * not a reviewer.
 *
 * The one import is a SIBLING in this package — `FillLocator`, the shape the
 * fill agent already takes. Not a dependency: the same file, the same package,
 * the same "no dependencies at all" guarantee.
 */

import type { FillLocator } from "./fill.js";
import { FILL_LOCATOR_STRATEGIES, MAX_FILL_LOCATORS } from "./fill.js";

// ───────────────────────────────────────────────────────────────────────────
// What kind of work
// ───────────────────────────────────────────────────────────────────────────

/**
 * The kinds of work a browser is needed for.
 *
 * ── How `execute` got here ────────────────────────────────────────────────
 *
 * It was deliberately absent for a phase. A `FillPlan`'s instructions carry
 * `ConfirmedValue<string>`, which only `packages/profile` may mint (ADR-0004),
 * and `JSON.parse` on the far side would produce ordinary objects with the
 * brand gone — so every consumer downstream would stop being able to tell a
 * value the student confirmed from one nobody did.
 *
 * ADR-0046 decided it: the plan crosses as its two halves — the text and the
 * provenance the student's confirmation produced — and is reassembled through
 * the mint, in the package that owns it. Nothing outside `packages/profile`
 * casts, and a provenance is carried rather than invented, because a provenance
 * nobody produced is a lie about a student.
 */
export const WORK_KINDS = ["create_account", "execute"] as const;
export type WorkKind = (typeof WORK_KINDS)[number];

/**
 * How the account will be signed into, chosen from what discovery observed.
 *
 * Re-declared rather than imported from `@askimate/aas-account`, for the reason
 * in this file's header and the one in `runs.ts`: this package has no
 * dependencies, and `scripts/contract-drift.test.ts` compares the two sets in
 * both directions so the duplication cannot drift unnoticed.
 */
export const WORK_APPROACHES = [
  "passwordless",
  "student_chosen",
  "portal_issued",
  "generated_ephemeral",
] as const;
export type WorkApproach = (typeof WORK_APPROACHES)[number];

// ───────────────────────────────────────────────────────────────────────────
// A claimed unit of work
// ───────────────────────────────────────────────────────────────────────────

/**
 * One unit of work, leased to one runner.
 *
 * The lease is what makes two runners safe. `work_leases.run_id` is a PRIMARY
 * KEY, so a second claim on the same run is refused by the database rather than
 * by a handler that remembers to look.
 */
/**
 * Where the registration form is and which boxes to type into.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Blueprint facts, and blueprint facts only: a URL, three or four selectors,
 * and a control to press. Not a student's answer, not a value, not a mapping.
 * The reviewed blueprint lives in the Application Plane's catalogue and stays
 * there; what crosses is the four locators this one page needs.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why send them rather than give the runner the blueprint ───────────────
 *
 * Because two copies of a reviewed blueprint is two things to keep in step, and
 * the one in the runner would be the one nobody reviewed. The plane holds the
 * blueprint; the runner is told which four boxes are on the page in front of it.
 *
 * ── The honest note about `FillLocator.value` ─────────────────────────────
 *
 * A selector is freer text than anything else in this payload. It is reviewed
 * blueprint data rather than model output, and the identical shape already
 * crosses to the fill agent in `SecretFillRequest` — so this is not a new
 * exposure. It is called out because the free-text assertion below exempts it,
 * and an exemption nobody wrote down is an exemption nobody notices.
 */
export interface RegistrationTargets {
  /** The page to open. Must be on `ClaimedWork.portalHost`; the runner re-checks. */
  readonly url: string;
  readonly emailLocator: FillLocator;
  /**
   * Every password box on the form, in order.
   *
   * Plural, and one secret fills all of them in a single use of one handle
   * (P1: *"never ask the student twice"*). The runner passes this straight to
   * the Secure Plane's fill agent, which is the only thing that types into
   * them.
   */
  readonly passwordLocators: readonly FillLocator[];
  /** The control that submits the form. */
  readonly submitLocator: FillLocator;
}

export interface ClaimedWork {
  readonly leaseId: string;
  /** When the lease lapses and this run becomes claimable again. RFC 3339. */
  readonly expiresAt: string;
  readonly runId: string;
  readonly caseId: string;
  readonly studentRef: string;
  readonly kind: WorkKind;
  /** The host the account is being created on. Bound; not a suggestion. */
  readonly portalHost: string;
  /** The student's own email address — the account being created is theirs. */
  readonly email: string;
  readonly approach: WorkApproach;
  /**
   * The opaque reference to the password the student typed into the secure
   * control, present only when one exists and the portal needs it.
   *
   * `sh_` plus 32 hex. See this file's header for why a component that may hold
   * no secrets may hold this.
   */
  readonly secretHandle?: string;
  /**
   * Where the form is and which boxes to type into. Blueprint facts only.
   *
   * Present for `create_account`, absent for `execute` — the application form
   * is reached from the plan's own locators, and an account has already been
   * created by the time a run gets there.
   */
  readonly registration?: RegistrationTargets;
  /**
   * The fill plan, taken apart for transport. ADR-0046.
   *
   * Present for `execute`, absent for `create_account`. `text` and `provenance`
   * rather than a `ConfirmedValue`, because the brand cannot survive a wire —
   * and the provenance is CARRIED rather than rebuilt on arrival, so what is
   * reassembled is the value the student actually confirmed.
   */
  readonly plan?: TransportedPlan;
  /** The page the plan's fields are on. Must be on `portalHost`. */
  readonly formUrl?: string;
  /**
   * The control that saves this page and moves to the next.
   *
   * ═════════════════════════════════════════════════════════════════════
   * Filling a form types into boxes; a portal does not KEEP any of it until
   * the page is saved. So the fill is not done when the last field is typed,
   * and a runner that stopped there would report success over an application
   * the university has no record of.
   *
   * This is `advance_portal_page` — consequential, and modelled as such: it may
   * create a draft visible to admissions. It is NOT the submit control, and it
   * never can be: the runner's click guard admits exactly the locators it is
   * given, and it is given this one (ADR-0014).
   * ═════════════════════════════════════════════════════════════════════
   */
  readonly advanceLocator?: FillLocator;
}

/** How a value reached the profile. Mirrors `ConfirmationProvenance`. */
export const WORK_PROVENANCE_SOURCES = [
  "student_stated",
  "student_entered",
  "document_extracted",
  "student_corrected",
] as const;
export type WorkProvenanceSource = (typeof WORK_PROVENANCE_SOURCES)[number];

export interface TransportedProvenance {
  readonly source: WorkProvenanceSource;
  /** RFC 3339. When the student confirmed it. */
  readonly confirmedAt: string;
  /** The student's own words, where the value came from conversation. */
  readonly sourceExcerpt?: string;
  readonly documentId?: string;
}

export type TransportedValue =
  | {
      readonly kind: "confirmed";
      readonly fieldKey: string;
      readonly text: string;
      readonly provenance: TransportedProvenance;
    }
  | {
      readonly kind: "reviewed_constant";
      readonly text: string;
      readonly rationale: string;
      readonly mappingSetId: string;
      readonly reviewedBy: string;
    };

export interface TransportedInstruction {
  readonly fieldRef: string;
  readonly label: string;
  readonly inputType: string;
  readonly locators: readonly FillLocator[];
  readonly value: TransportedValue;
}

/**
 * A plan on the wire.
 *
 * No `uploads`, no `handoffs`, no `blockers` — and they are absent because a
 * plan that had any of them is REFUSED for transport rather than trimmed. A
 * plan with its uploads silently removed would report itself complete having
 * attached nothing, and the student would be told their application was filled.
 */
export interface TransportedPlan {
  readonly blueprintId: string;
  readonly blueprintVersion: string;
  readonly mappingSetId: string;
  readonly instructions: readonly TransportedInstruction[];
}

/**
 * COMPILE-TIME: no field of a work item is free text the student did not write.
 *
 * ── The claim this makes, and how it changed ──────────────────────────────
 *
 * It used to say "no field is free text", and that was true while the payload
 * carried only identifiers. ADR-0046 made it false: an `execute` work item
 * carries the student's own confirmed answers, because those answers are what
 * gets typed into the university's form.
 *
 * So the claim is narrower and still worth enforcing. Every string here is one
 * of: a closed-set word, an identifier, a URL, a locator, or a value the student
 * confirmed — travelling with the provenance that confirmed it. A `say`, a
 * `detail`, a `portalMessage` or a `password` added later still stops this being
 * `never` and still fails the build naming the field.
 *
 * A CONSTRAINT rather than a computation: an assertion that merely evaluates to
 * `never` on failure is vacuous, which this repository has shipped once and
 * found by regression.
 */
type OpenStrings<T> = {
  [K in keyof T]-?: NonNullable<T[K]> extends WorkKind | WorkApproach
    ? never
    : // Two exemptions, both named here so they are visible rather than
      // implied. `registration` carries a URL and selectors from a REVIEWED
      // blueprint; `plan` carries confirmed answers, and its own assertion
      // below closes the door this one opens.
      NonNullable<T[K]> extends RegistrationTargets | TransportedPlan | FillLocator
      ? never
      : NonNullable<T[K]> extends string
        ? K extends
            | "leaseId"
            | "expiresAt"
            | "runId"
            | "caseId"
            | "studentRef"
            | "portalHost"
            | "email"
            | "secretHandle"
            | "formUrl"
          ? never
          : K
        : K;
}[keyof T];
type AssertNever<T extends never> = T;
export type NO_WORK_FIELD_IS_FREE_TEXT = AssertNever<OpenStrings<ClaimedWork>>;

/**
 * COMPILE-TIME: the exemption above cannot be widened by widening what it
 * exempts.
 *
 * `OpenStrings` lets `registration` through as a whole, so without this a
 * `defaultPassword` or a `portalMessage` added to `RegistrationTargets` would
 * ride in behind the exemption. This closes it: every member must be a URL, a
 * locator, or a list of locators.
 */
type NonTargetFields<T> = {
  [K in keyof T]-?: NonNullable<T[K]> extends FillLocator | readonly FillLocator[]
    ? never
    : K extends "url"
      ? never
      : K;
}[keyof T];
export type REGISTRATION_CARRIES_ONLY_TARGETS = AssertNever<NonTargetFields<RegistrationTargets>>;

/**
 * COMPILE-TIME: a confirmed value cannot travel without its provenance.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * The load-bearing half of ADR-0046. A `ConfirmedValue` cannot survive a wire,
 * so the plan crosses as text plus the provenance that confirmed it and is
 * reassembled through the mint. If the provenance became optional — or were
 * dropped in a "simplification" — the far side would have text with nothing to
 * rebuild from, and the only way to produce a value would be to INVENT a
 * provenance: an assertion that a student said something, made by a process
 * that has no idea whether they did.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Distributive, so both branches of the union are examined: a plain mapped type
 * over a union collapses to the keys they share, and `provenance` is on one
 * branch only — which is exactly the shape this has to check.
 */
type ConfirmedWithoutProvenance<T> = T extends { readonly kind: "confirmed" }
  ? T extends { readonly provenance: TransportedProvenance }
    ? never
    : "confirmed"
  : never;
export type A_CONFIRMED_VALUE_CARRIES_ITS_PROVENANCE = AssertNever<
  ConfirmedWithoutProvenance<TransportedValue>
>;

// ───────────────────────────────────────────────────────────────────────────
// How it ended
// ───────────────────────────────────────────────────────────────────────────

/**
 * How a unit of work ended.
 *
 * `uncertain` is a first-class member rather than a kind of failure. A process
 * can always die between an external success and our recording of it, and a
 * vocabulary that forced that into either `succeeded` or `failed` would destroy
 * the distinction at the only point where it is still recoverable — which is
 * what `workflow_action_intents` exists to preserve (ADR-0008).
 */
export const WORK_OUTCOMES = ["succeeded", "failed", "uncertain"] as const;
export type WorkOutcome = (typeof WORK_OUTCOMES)[number];

/**
 * Why a unit of work did not succeed, as a closed set.
 *
 * Free text here would be a channel from a page we do not control into this
 * plane's durable records — a portal's error message, rendered by a site that
 * can put anything in it, arriving as a string somebody logs.
 */
export const WORK_FAILURES = [
  /** The portal's form was not where the blueprint said it was. */
  "portal_drift",
  /** The portal refused what we sent — a validation rule we do not model. */
  "portal_refused",
  /** An account with this email already exists there. */
  "already_exists",
  /** The Secure Plane declined or could not spend the handle. */
  "secret_unavailable",
  /** The portal asked for something only the student can do. */
  "needs_the_student",
  /** The browser or the network gave out. */
  "runner_fault",
] as const;
export type WorkFailure = (typeof WORK_FAILURES)[number];

export interface WorkReport {
  readonly leaseId: string;
  readonly outcome: WorkOutcome;
  /** Present exactly when the outcome is not `succeeded`. */
  readonly failure?: WorkFailure;
}

// ───────────────────────────────────────────────────────────────────────────
// Bytes from the network
// ───────────────────────────────────────────────────────────────────────────

function isMember<T extends string>(members: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (members as readonly string[]).includes(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** `sh_` plus 32 lowercase hex. The same pattern the secure schema's CHECK uses. */
const HANDLE_PATTERN = /^sh_[0-9a-f]{32}$/;

/**
 * Bytes from the network to a work item, or `null`.
 *
 * Rebuilt field by field rather than cast. A plane that answered with an extra
 * field — a `password`, a `value`, a rendered portal message — has nowhere to
 * put it, so the omissions above hold on this side of the wire too and not only
 * on the side that wrote them.
 */
export function parseClaimedWork(value: unknown): ClaimedWork | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  for (const field of [
    "leaseId",
    "expiresAt",
    "runId",
    "caseId",
    "studentRef",
    "portalHost",
    "email",
  ]) {
    if (!nonEmpty(record[field])) return null;
  }
  if (!isMember(WORK_KINDS, record["kind"])) return null;
  if (!isMember(WORK_APPROACHES, record["approach"])) return null;

  const handle = record["secretHandle"];
  if (handle !== undefined && (typeof handle !== "string" || !HANDLE_PATTERN.test(handle))) {
    return null;
  }

  // Each work kind carries what IT needs, and refusing the other shape is what
  // stops an `execute` item arriving with registration targets and no plan.
  const kind = record["kind"];
  const registration =
    kind === "create_account" ? parseRegistration(record["registration"]) : null;
  if (kind === "create_account" && registration === null) return null;

  const plan = kind === "execute" ? parseTransportedPlan(record["plan"]) : null;
  const formUrl = record["formUrl"];
  const advanceLocator = kind === "execute" ? parseLocator(record["advanceLocator"]) : null;
  if (kind === "execute") {
    if (plan === null || advanceLocator === null) return null;
    if (typeof formUrl !== "string" || formUrl.length === 0) return null;
  }

  return {
    leaseId: record["leaseId"] as string,
    expiresAt: record["expiresAt"] as string,
    runId: record["runId"] as string,
    caseId: record["caseId"] as string,
    studentRef: record["studentRef"] as string,
    kind: record["kind"],
    portalHost: record["portalHost"] as string,
    email: record["email"] as string,
    approach: record["approach"],
    ...(handle === undefined ? {} : { secretHandle: handle }),
    ...(registration === null ? {} : { registration }),
    ...(plan === null ? {} : { plan }),
    ...(typeof formUrl === "string" && formUrl.length > 0 ? { formUrl } : {}),
    ...(advanceLocator === null ? {} : { advanceLocator }),
  };
}

function parseProvenance(value: unknown): TransportedProvenance | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (!isMember(WORK_PROVENANCE_SOURCES, record["source"])) return null;
  if (!nonEmpty(record["confirmedAt"])) return null;
  const excerpt = record["sourceExcerpt"];
  const documentId = record["documentId"];
  if (excerpt !== undefined && typeof excerpt !== "string") return null;
  if (documentId !== undefined && typeof documentId !== "string") return null;
  return {
    source: record["source"],
    confirmedAt: record["confirmedAt"],
    ...(excerpt === undefined ? {} : { sourceExcerpt: excerpt }),
    ...(documentId === undefined ? {} : { documentId }),
  };
}

function parseTransportedValue(value: unknown): TransportedValue | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record["kind"] === "confirmed") {
    const provenance = parseProvenance(record["provenance"]);
    // ── The refusal that matters ────────────────────────────────────────
    //
    // A confirmed value with no provenance cannot be rebuilt without inventing
    // one, and an invented provenance asserts that a student said something
    // when nobody knows whether they did. Refused at the boundary rather than
    // patched up after it.
    if (provenance === null) return null;
    if (!nonEmpty(record["fieldKey"]) || typeof record["text"] !== "string") return null;
    return {
      kind: "confirmed",
      fieldKey: record["fieldKey"],
      text: record["text"],
      provenance,
    };
  }
  if (record["kind"] !== "reviewed_constant") return null;
  for (const field of ["text", "rationale", "mappingSetId", "reviewedBy"]) {
    if (typeof record[field] !== "string") return null;
  }
  return {
    kind: "reviewed_constant",
    text: record["text"] as string,
    rationale: record["rationale"] as string,
    mappingSetId: record["mappingSetId"] as string,
    reviewedBy: record["reviewedBy"] as string,
  };
}

function parseTransportedPlan(value: unknown): TransportedPlan | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  for (const field of ["blueprintId", "blueprintVersion", "mappingSetId"]) {
    if (!nonEmpty(record[field])) return null;
  }
  const raw = record["instructions"];
  if (!Array.isArray(raw) || raw.length === 0) return null;

  const instructions: TransportedInstruction[] = [];
  for (const entry of raw as readonly unknown[]) {
    if (typeof entry !== "object" || entry === null) return null;
    const held = entry as Record<string, unknown>;
    if (!nonEmpty(held["fieldRef"]) || typeof held["label"] !== "string") return null;
    if (!nonEmpty(held["inputType"])) return null;

    const locatorList = held["locators"];
    if (!Array.isArray(locatorList) || locatorList.length === 0) return null;
    const locators: FillLocator[] = [];
    for (const candidate of locatorList as readonly unknown[]) {
      const locator = parseLocator(candidate);
      if (locator === null) return null;
      locators.push(locator);
    }

    const parsed = parseTransportedValue(held["value"]);
    if (parsed === null) return null;
    instructions.push({
      fieldRef: held["fieldRef"],
      label: held["label"],
      inputType: held["inputType"],
      locators,
      value: parsed,
    });
  }

  return {
    blueprintId: record["blueprintId"] as string,
    blueprintVersion: record["blueprintVersion"] as string,
    mappingSetId: record["mappingSetId"] as string,
    instructions,
  };
}

function parseLocator(value: unknown): FillLocator | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const strategy = record["strategy"];
  const held = record["value"];
  if (!(FILL_LOCATOR_STRATEGIES as readonly string[]).includes(strategy as string)) return null;
  if (typeof held !== "string" || held.length === 0) return null;
  return { strategy: strategy as FillLocator["strategy"], value: held };
}

function parseRegistration(value: unknown): RegistrationTargets | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const url = record["url"];
  if (typeof url !== "string" || url.length === 0) return null;

  const emailLocator = parseLocator(record["emailLocator"]);
  const submitLocator = parseLocator(record["submitLocator"]);
  if (emailLocator === null || submitLocator === null) return null;

  const raw = record["passwordLocators"];
  // Bounded here as well as in `SecretFillRequest`, because this is where the
  // list is first believed. A plane that sent forty would otherwise get forty
  // as far as the fill agent's own boundary before anything refused it.
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_FILL_LOCATORS) return null;
  const passwordLocators: FillLocator[] = [];
  for (const entry of raw as readonly unknown[]) {
    const locator = parseLocator(entry);
    if (locator === null) return null;
    passwordLocators.push(locator);
  }

  return { url, emailLocator, passwordLocators, submitLocator };
}

/** Bytes from the network to a report, or `null`. The plane's side of the wire. */
export function parseWorkReport(value: unknown): WorkReport | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (!nonEmpty(record["leaseId"])) return null;
  if (!isMember(WORK_OUTCOMES, record["outcome"])) return null;

  const failure = record["failure"];
  const outcome = record["outcome"];
  // Symmetric, so a half-written report is refused rather than stored. A
  // `failed` with no reason and a `succeeded` with one are both records that
  // read as more or less certainty than the runner actually reported.
  if (outcome === "succeeded") {
    if (failure !== undefined) return null;
    return { leaseId: record["leaseId"], outcome };
  }
  if (!isMember(WORK_FAILURES, failure)) return null;
  return { leaseId: record["leaseId"], outcome, failure };
}
