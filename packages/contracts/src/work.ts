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
export const WORK_KINDS = ["create_account", "sign_in", "execute"] as const;
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

/**
 * Where the login form is and which boxes to type into — the resume path
 * (ADR-0101 §3, P72).
 *
 * The same shape and the same rules as `RegistrationTargets`: blueprint facts
 * only, on the bound host, with ONE password box. A login form asks for the
 * password once, and a second locator here would be a second guess about where
 * a credential goes.
 */
export interface LoginTargets {
  /** The page to open. Must be on `ClaimedWork.portalHost`; the runner re-checks. */
  readonly url: string;
  readonly emailLocator: FillLocator;
  readonly passwordLocator: FillLocator;
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
   * Where the login form is. Present for `sign_in`, absent otherwise.
   *
   * A `sign_in` item also carries `secretHandle`: the password the student
   * typed once more, for this one sign-in, spent by the fill agent and gone.
   */
  readonly login?: LoginTargets;
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
    }
  /** ADR-0102: the refusal the form offers. Never an answer; the runner enters it as a refusal. */
  | {
      readonly kind: "form_refusal";
      readonly text: string;
      readonly rationale: string;
      readonly formSays?: string;
      /** The other controls of the same question, left untouched (ADR-0102). */
      readonly covers: readonly string[];
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
/**
 * An upload, as a REFERENCE (ADR-0099): which box, which document the reviewed
 * mapping named for it, where the box is. No bytes, no document id, no hash —
 * the runner asks the plane for each one under its lease, and the plane
 * answers only after the disclosure gates have run with the case.
 */
export interface TransportedUpload {
  readonly fieldRef: string;
  readonly label: string;
  readonly documentRef: string;
  readonly locators: readonly FillLocator[];
  /** The attach's second act (ADR-0103, gap 4): the control set beside the slot, and its value. */
  readonly companion?: {
    readonly fieldRef: string;
    readonly label: string;
    readonly locators: readonly FillLocator[];
    readonly text: string;
  };
}

export interface TransportedPlan {
  readonly blueprintId: string;
  readonly blueprintVersion: string;
  readonly mappingSetId: string;
  readonly instructions: readonly TransportedInstruction[];
  readonly uploads: readonly TransportedUpload[];
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
      NonNullable<T[K]> extends RegistrationTargets | LoginTargets | TransportedPlan | FillLocator
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
/** The same door, closed for the login form: a URL and three locators, nothing else. */
export type LOGIN_CARRIES_ONLY_TARGETS = AssertNever<NonTargetFields<LoginTargets>>;

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
  /**
   * The portal presented a CAPTCHA where the plan expected none. ADR-0101 §6.
   *
   * Its own code rather than `needs_the_student`, on Vahid's word: *"it must
   * stop and say which it met, not fail as a fill error. That refusal is the
   * signal that moves C from deferred to needed."* The plane stops the run on
   * this and says so; a specialist reads which.
   */
  "captcha_met",
  /**
   * The portal asked for a one-time code or another second factor where the
   * plan expected none. ADR-0101 §6. When the action was account creation the
   * account may already exist — the intervention says so.
   */
  "second_factor_met",
] as const;
export type WorkFailure = (typeof WORK_FAILURES)[number];

/**
 * The failures after which the runner's signed-in session for the run is gone
 * (ADR-0101 §2, §3).
 *
 * ONE list, read by both ends: the runner releases its held context on these,
 * and the plane records the session as lost on the same report — so the two
 * cannot disagree about whether a run needs the resume path. The run has
 * stopped (a challenge), or the runner has nothing it can do with the session
 * it holds (the student is needed, the password was not there). Every other
 * failure keeps the session: a refused page may be offered again, signed in.
 */
export const SESSION_ENDING_FAILURES: readonly WorkFailure[] = [
  "captcha_met",
  "second_factor_met",
  "needs_the_student",
  "secret_unavailable",
];

/**
 * One document that LEFT — attached to the portal by the runner — as the
 * record the audit trail keeps (ADR-0069's third layer, P73).
 *
 * Identifiers and a hash, never contents (brief §8). `fieldRef` names the
 * box it went into, which with the page the lease names is the identity of
 * the `attach_document` intent the plane opened at the claim; `documentId`
 * and `contentHash` say which document, so a report cannot close an intent
 * for a file the runner did not attach. Produced by the executor at the
 * moment of attaching (`recordTransmission`), not reconstructed afterwards.
 */
export interface WireTransmission {
  readonly fieldRef: string;
  readonly disclosureId: string;
  readonly documentId: string;
  /** SHA-256, lowercase hex. */
  readonly contentHash: string;
  readonly toHost: string;
  readonly institutionName: string;
  readonly caseId: string;
  /** RFC 3339. */
  readonly transmittedAt: string;
}

/** A page carries at most this many uploads. A bound, not a policy. */
export const MAX_TRANSMISSIONS_PER_REPORT = 20;

export interface WorkReport {
  readonly leaseId: string;
  readonly outcome: WorkOutcome;
  /** Present exactly when the outcome is not `succeeded`. */
  readonly failure?: WorkFailure;
  /**
   * Every document the runner attached to the page it saved. Present only
   * with `succeeded`: an attachment on a page that was not saved is a file in
   * a form the portal discarded, and a report that listed it would record a
   * disclosure that did not happen.
   */
  readonly transmissions?: readonly WireTransmission[];
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

  const login = kind === "sign_in" ? parseLogin(record["login"]) : null;
  if (kind === "sign_in" && login === null) return null;

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
    ...(login === null ? {} : { login }),
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
  if (record["kind"] === "form_refusal") {
    for (const field of ["text", "rationale", "mappingSetId", "reviewedBy"]) {
      if (typeof record[field] !== "string") return null;
    }
    const formSays = record["formSays"];
    if (formSays !== undefined && typeof formSays !== "string") return null;
    const covers = record["covers"];
    if (!Array.isArray(covers) || !covers.every((entry) => typeof entry === "string")) return null;
    return {
      kind: "form_refusal",
      text: record["text"] as string,
      rationale: record["rationale"] as string,
      ...(formSays === undefined ? {} : { formSays }),
      covers: covers,
      mappingSetId: record["mappingSetId"] as string,
      reviewedBy: record["reviewedBy"] as string,
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

/** A companion as sent, or `undefined` when absent, or `false` when malformed. */
function parseCompanion(value: unknown): TransportedUpload["companion"] | undefined | false {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null) return false;
  const held = value as Record<string, unknown>;
  if (!nonEmpty(held["fieldRef"]) || typeof held["label"] !== "string" || typeof held["text"] !== "string") return false;
  const locatorList = held["locators"];
  if (!Array.isArray(locatorList) || locatorList.length === 0) return false;
  const locators: FillLocator[] = [];
  for (const candidate of locatorList as readonly unknown[]) {
    const locator = parseLocator(candidate);
    if (locator === null) return false;
    locators.push(locator);
  }
  return { fieldRef: held["fieldRef"], label: held["label"], locators, text: held["text"] };
}

function parseTransportedPlan(value: unknown): TransportedPlan | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  for (const field of ["blueprintId", "blueprintVersion", "mappingSetId"]) {
    if (!nonEmpty(record[field])) return null;
  }
  const raw = record["instructions"];
  // A page may carry nothing to type and one thing to attach — the documents
  // page of a real portal (P74) — so an empty list is refused only when the
  // uploads are empty too, below.
  if (!Array.isArray(raw)) return null;

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

  const uploads: TransportedUpload[] = [];
  const rawUploads = record["uploads"];
  if (rawUploads !== undefined) {
    if (!Array.isArray(rawUploads)) return null;
    for (const entry of rawUploads as readonly unknown[]) {
      if (typeof entry !== "object" || entry === null) return null;
      const held = entry as Record<string, unknown>;
      if (!nonEmpty(held["fieldRef"]) || typeof held["label"] !== "string") return null;
      if (!nonEmpty(held["documentRef"])) return null;
      const locatorList = held["locators"];
      if (!Array.isArray(locatorList) || locatorList.length === 0) return null;
      const locators: FillLocator[] = [];
      for (const candidate of locatorList as readonly unknown[]) {
        const locator = parseLocator(candidate);
        if (locator === null) return null;
        locators.push(locator);
      }
      // Exactly these fields, plus a companion when the slot has one (gap 4).
      // A plane that sent a `documentId`, a `contentHash` or bytes beside them
      // is answering a question the runner did not ask, and the runner has
      // nowhere to put the answer.
      const companion = parseCompanion(held["companion"]);
      if (companion === false) return null;
      uploads.push({
        fieldRef: held["fieldRef"],
        label: held["label"],
        documentRef: held["documentRef"],
        locators,
        ...(companion === undefined ? {} : { companion }),
      });
    }
  }

  if (instructions.length === 0 && uploads.length === 0) return null;
  return {
    blueprintId: record["blueprintId"] as string,
    blueprintVersion: record["blueprintVersion"] as string,
    mappingSetId: record["mappingSetId"] as string,
    instructions,
    uploads,
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

function parseLogin(value: unknown): LoginTargets | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (!nonEmpty(record["url"])) return null;
  const emailLocator = parseLocator(record["emailLocator"]);
  const passwordLocator = parseLocator(record["passwordLocator"]);
  const submitLocator = parseLocator(record["submitLocator"]);
  if (emailLocator === null || passwordLocator === null || submitLocator === null) return null;
  return { url: record["url"], emailLocator, passwordLocator, submitLocator };
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
  const transmissions = record["transmissions"];
  if (outcome === "succeeded") {
    if (failure !== undefined) return null;
    if (transmissions === undefined) return { leaseId: record["leaseId"], outcome };
    const parsed = parseTransmissions(transmissions);
    if (parsed === null) return null;
    return { leaseId: record["leaseId"], outcome, transmissions: parsed };
  }
  if (!isMember(WORK_FAILURES, failure)) return null;
  // A transmission on a page that was not saved is a disclosure that did
  // not happen; the half-written record is refused rather than stored.
  if (transmissions !== undefined) return null;
  return { leaseId: record["leaseId"], outcome, failure };
}

function parseTransmissions(value: unknown): readonly WireTransmission[] | null {
  if (!Array.isArray(value) || value.length > MAX_TRANSMISSIONS_PER_REPORT) return null;
  const out: WireTransmission[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) return null;
    const record = item as Record<string, unknown>;
    for (const field of [
      "fieldRef",
      "disclosureId",
      "documentId",
      "contentHash",
      "toHost",
      "institutionName",
      "caseId",
      "transmittedAt",
    ]) {
      if (!nonEmpty(record[field])) return null;
    }
    if (!/^[0-9a-f]{64}$/.test(record["contentHash"] as string)) return null;
    if (Number.isNaN(Date.parse(record["transmittedAt"] as string))) return null;
    out.push({
      fieldRef: record["fieldRef"] as string,
      disclosureId: record["disclosureId"] as string,
      documentId: record["documentId"] as string,
      contentHash: record["contentHash"] as string,
      toHost: record["toHost"] as string,
      institutionName: record["institutionName"] as string,
      caseId: record["caseId"] as string,
      transmittedAt: record["transmittedAt"] as string,
    });
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// ADR-0099: a document, handed to the runner under its lease — after the gates
// ───────────────────────────────────────────────────────────────────────────

/**
 * What the runner sends to be handed a document: the lease it holds. The
 * `documentRef` is in the path; the capability is in the body, for the reason
 * `reportWork` gives.
 */
export interface WorkDocumentRequest {
  readonly leaseId: string;
  readonly holder: string;
}

/**
 * The disclosure record the plane's gate ran, on the wire.
 *
 * The runner re-runs `authoriseDisclosure` over this and `mayTransmit` at the
 * moment of attaching — the gate twice, on two machines, same inputs. The
 * determination travels as its ID: the runner holds the same register in code
 * and refuses a record naming one it does not hold.
 */
export interface WireDisclosure {
  readonly disclosureId: string;
  readonly subject: {
    readonly documentId: string;
    readonly documentType: string;
    readonly contentHash: string;
    readonly caseId: string;
    readonly requestedFor: string;
  };
  readonly destination: {
    readonly institutionName: string;
    readonly portalHost: string;
    readonly processorName?: string;
  };
  readonly determinationId: string;
  readonly studentAuthorisation: {
    readonly studentRef: string;
    /** The preview the student authorised, verbatim (ADR-0098). */
    readonly presentedText: string;
    /** RFC 3339. */
    readonly authorisedAt: string;
    readonly method: "chat_affirmation" | "signed_form" | "specialist_recorded";
  };
}

export interface WorkDocument {
  readonly documentId: string;
  readonly documentType: string;
  /** SHA-256, lowercase hex. The runner hashes what it fetched and refuses a mismatch. */
  readonly contentHash: string;
  readonly contentType: string;
  /** A short-lived GET the plane minted. The runner fetches it once. */
  readonly retrieval: {
    readonly url: string;
    readonly method: "GET";
    /** RFC 3339. */
    readonly expiresAt: string;
  };
  readonly disclosure: WireDisclosure;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

/** Bytes from the network to a document hand-over, or `null`. The runner's side. */
export function parseWorkDocument(value: unknown): WorkDocument | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  for (const field of ["documentId", "documentType", "contentHash", "contentType"]) {
    if (!nonEmpty(record[field])) return null;
  }
  if (!/^[0-9a-f]{64}$/.test(record["contentHash"] as string)) return null;

  const retrieval = record["retrieval"];
  if (typeof retrieval !== "object" || retrieval === null) return null;
  const r = retrieval as Record<string, unknown>;
  if (!nonEmpty(r["url"]) || r["method"] !== "GET" || !nonEmpty(r["expiresAt"])) return null;
  if (!(r["url"]).startsWith("https://")) return null;

  const disclosure = record["disclosure"];
  if (typeof disclosure !== "object" || disclosure === null) return null;
  const d = disclosure as Record<string, unknown>;
  if (!nonEmpty(d["disclosureId"]) || !nonEmpty(d["determinationId"])) return null;
  const rawSubject = d["subject"];
  const rawDestination = d["destination"];
  const rawAuthorisation = d["studentAuthorisation"];
  if (
    typeof rawSubject !== "object" || rawSubject === null ||
    typeof rawDestination !== "object" || rawDestination === null ||
    typeof rawAuthorisation !== "object" || rawAuthorisation === null
  ) {
    return null;
  }
  const subject = rawSubject as Record<string, unknown>;
  const destination = rawDestination as Record<string, unknown>;
  const authorisation = rawAuthorisation as Record<string, unknown>;
  for (const field of ["documentId", "documentType", "contentHash", "caseId", "requestedFor"]) {
    if (!isString(subject[field])) return null;
  }
  if (!nonEmpty(destination["institutionName"]) || !nonEmpty(destination["portalHost"])) return null;
  if (destination["processorName"] !== undefined && !isString(destination["processorName"])) return null;
  for (const field of ["studentRef", "presentedText", "authorisedAt"]) {
    if (!nonEmpty(authorisation[field])) return null;
  }
  const method = authorisation["method"];
  if (method !== "chat_affirmation" && method !== "signed_form" && method !== "specialist_recorded") {
    return null;
  }
  // The document the plane says it is handing over must be the one the
  // disclosure was checked for. A mismatch is the plane contradicting itself.
  if (subject["documentId"] !== record["documentId"] || subject["contentHash"] !== record["contentHash"]) {
    return null;
  }

  return {
    documentId: record["documentId"] as string,
    documentType: record["documentType"] as string,
    contentHash: record["contentHash"] as string,
    contentType: record["contentType"] as string,
    retrieval: { url: r["url"], method: "GET", expiresAt: r["expiresAt"] },
    disclosure: {
      disclosureId: d["disclosureId"],
      subject: {
        documentId: subject["documentId"] as string,
        documentType: subject["documentType"] as string,
        contentHash: subject["contentHash"] as string,
        caseId: subject["caseId"] as string,
        requestedFor: subject["requestedFor"] as string,
      },
      destination: {
        institutionName: destination["institutionName"],
        portalHost: destination["portalHost"],
        ...(destination["processorName"] === undefined ? {} : { processorName: destination["processorName"] }),
      },
      determinationId: d["determinationId"],
      studentAuthorisation: {
        studentRef: authorisation["studentRef"] as string,
        presentedText: authorisation["presentedText"] as string,
        authorisedAt: authorisation["authorisedAt"] as string,
        method,
      },
    },
  };
}
