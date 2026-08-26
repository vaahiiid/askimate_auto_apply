/**
 * Browser session capabilities.
 *
 * The type-level half of the discovery/execution separation (ADR-0014). A
 * `DiscoverySession` has no `fill`, no `click`, no `submit`. Not "must not
 * call" — there is nothing to call.
 *
 * The three capability levels are deliberately nested, so each step up is an
 * explicit, visible decision in the code that requests it:
 *
 *   ReadOnlySession    navigate, read, screenshot        ← discovery
 *   FillableSession    + fill confirmed values, click    ← preparation
 *   SubmittableSession + submit with an authorisation    ← Phase 6 only
 *
 * Note what `fill` accepts: `ConfirmedValue`, and nothing else. The wall from
 * ADR-0004 reaches all the way to the keyboard.
 */

import type { ConfirmedValue } from "@askimate/aas-domain";
import type { FieldLocator } from "@askimate/aas-blueprint";

/** What was found on a page. The raw material of a blueprint. */
export interface ObservedForm {
  readonly formIndex: number;
  readonly action?: string;
  readonly method?: string;
  readonly fields: readonly ObservedField[];
}

export interface ObservedField {
  readonly name?: string;
  readonly id?: string;
  readonly label?: string;
  readonly tagName: string;
  readonly type?: string;
  readonly required: boolean;
  readonly placeholder?: string;
  readonly maxLength?: number;
  readonly pattern?: string;
  readonly accept?: string;
  readonly options?: readonly { readonly value: string; readonly label: string }[];
}

export interface PageObservation {
  readonly url: string;
  readonly title: string;
  readonly forms: readonly ObservedForm[];
  /** Links that look like they advance an application flow. */
  readonly candidateAdvanceControls: readonly FieldLocator[];
  readonly observedAt: Date;
}

/**
 * Read-only browsing. The only capability discovery gets.
 *
 * Everything here is a safe, idempotent read. There is deliberately no method
 * that types into a field, clicks a control, or sends a form.
 */
export interface ReadOnlySession {
  /** Loads a page. Blocked by the guard if the host is not allow-listed. */
  goto(url: string): Promise<void>;
  /** Reads the page's structure. */
  observe(): Promise<PageObservation>;
  /** Absolute in-page links. Reads hrefs; does not click anything. */
  links(): Promise<readonly string[]>;
  /** Captures a screenshot into the run's trace directory. */
  screenshot(name: string): Promise<string>;
  currentUrl(): Promise<string>;
  /** State-changing requests the guard refused. Part of the discovery output. */
  blockedRequests(): readonly { readonly method: string; readonly url: string }[];
  close(): Promise<void>;
}

/**
 * Adds filling and clicking. Phase 5.
 *
 * `fill` takes a `ConfirmedValue<string>` — a value the student confirmed.
 * There is no overload taking a plain string, so the last step before a value
 * reaches a real form field is still type-checked.
 */
export interface FillableSession extends ReadOnlySession {
  fill(locator: FieldLocator, value: ConfirmedValue<string>): Promise<void>;
  click(locator: FieldLocator): Promise<void>;
  /** Uploads a document by vault ID. The runner never sees the vault itself. */
  attach(locator: FieldLocator, documentId: string, contents: Uint8Array): Promise<void>;
  /**
   * Reads what a field currently holds.
   *
   * Not a convenience. A portal can silently truncate a value at its maxlength,
   * strip characters it does not like, or reject input without saying so — and
   * a personal statement quietly cut off at 4,000 characters would otherwise be
   * submitted that way. Reading back is how the run knows what the portal
   * actually took.
   */
  readValue(locator: FieldLocator): Promise<string>;
}

/**
 * Adds submission. Phase 6, and never before.
 *
 * `submit` requires an `AuthorisationToken`, which can only be built from a
 * captured student authorisation. A submission cannot be attempted without the
 * student having approved exactly what is being sent (brief §7).
 */
export interface SubmittableSession extends FillableSession {
  submit(locator: FieldLocator, authorisation: AuthorisationToken): Promise<SubmissionOutcome>;
}

/**
 * Proof that the student authorised this exact content.
 *
 * Deliberately opaque and deliberately not constructible here. Phase 6 builds
 * it from the authorisation ledger; there is no constructor in this package, so
 * the browser runner cannot manufacture its own permission to submit.
 */
export interface AuthorisationToken {
  readonly caseId: string;
  readonly contentHash: string;
  readonly issuedAt: Date;
}

export interface SubmissionOutcome {
  readonly submitted: boolean;
  readonly receiptRef?: string;
  readonly confirmationText?: string;
}

/** How a session was configured, for the audit record. */
export interface SessionMode {
  readonly capability: "read_only" | "fillable" | "submittable";
  readonly allowedHosts: readonly string[];
  readonly runId: string;
  readonly traceDir: string;
  /**
   * The clock.
   *
   * Injected rather than read from ambient state, so an observation's timestamp
   * is controllable under test — the same discipline the domain core uses,
   * because provenance dates end up in the blueprint and eventually in a
   * requirement's freshness calculation.
   */
  readonly now?: () => Date;
}
