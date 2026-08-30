/**
 * The Secure Plane fill agent's wire contract — `POST /internal/v1/secret-fills`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ADR-0042: the component that consumes a credential runs inside the Secure
 * Plane's trust boundary. The runner asks for a field to be filled and is told
 * whether it was. It receives no value, holds no vault, and has no credential
 * that could decrypt one.
 *
 * These types live in the contract package for the reason ADR-0040 gives: the
 * runner is now an HTTP CLIENT of the Secure Plane, and a client that imported
 * its request shape from `@askimate/aas-secrets` would be importing the module
 * that holds plaintext in order to describe a message that carries none. The
 * boundary check enforces the absence of that dependency; this file is what
 * makes the absence possible.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── The shape of the answer is the security property ──────────────────────
 *
 * `SecretFillResult` has three fields and none of them can hold a value, a
 * length, or free text. `reason` is a closed set, and every member names a fact
 * about the PAGE (`field_not_masked`, `host_mismatch`) or about the HANDLE
 * (`secret_unavailable`) rather than about the secret. `openapi.test.ts` walks
 * every response schema in both documents and fails if any property name looks
 * secret-bearing; this type is written to survive that walk by construction
 * rather than by review.
 */

/** How the blueprint names a field. Mirrors `FieldLocator` in the spec. */
export const FILL_LOCATOR_STRATEGIES = [
  "label",
  "placeholder",
  "name",
  "id",
  "css",
  "role",
] as const;
export type FillLocatorStrategy = (typeof FILL_LOCATOR_STRATEGIES)[number];

export interface FillLocator {
  readonly strategy: FillLocatorStrategy;
  readonly value: string;
}

/** The purposes a secret request can be opened for. Mirrors the spec's enum. */
export const FILL_PURPOSES = ["portal_account_creation", "portal_password_reset"] as const;
export type FillPurpose = (typeof FILL_PURPOSES)[number];

/**
 * Why the agent did not type.
 *
 * `no_such_field` is the one that carries an obligation: it means the handle was
 * NOT spent, because the field's existence is established before any plaintext
 * is obtained. A blueprint mistake must not cost a student their single-use
 * password.
 */
export const FILL_REFUSAL_REASONS = [
  "no_such_field",
  "field_not_masked",
  "host_mismatch",
  "diagnostic_capture_detected",
  "browser_unreachable",
  "not_authorised",
  "secret_unavailable",
  "not_accepted",
] as const;
export type FillRefusalReason = (typeof FILL_REFUSAL_REASONS)[number];

/** Whether a refusal happened before the authority to spend was granted. */
export const REFUSALS_BEFORE_SPENDING: readonly FillRefusalReason[] = [
  "no_such_field",
  "field_not_masked",
  "host_mismatch",
  "diagnostic_capture_detected",
  "browser_unreachable",
  "not_authorised",
];

export interface SecretFillRequest {
  readonly handle: string;
  readonly studentRef: string;
  readonly caseRef: string;
  readonly purpose: FillPurpose;
  readonly targetHost: string;
  readonly consumer: string;
  readonly noDiagnosticCapture: true;
  /** The runner's browser, as a CDP WebSocket URL on the private network. */
  readonly browserEndpoint: string;
  /** Which page, when the browser has more than one. Matched exactly. */
  readonly pageUrl?: string;
  readonly locator: FillLocator;
}

export type SecretFillResult =
  | { readonly status: "filled"; readonly lifecycle: "secret_consumed" }
  | {
      readonly status: "refused";
      readonly reason: FillRefusalReason;
      /** Present when the use was settled before the refusal happened. */
      readonly lifecycle?: "secret_consumed";
    };

/**
 * COMPILE-TIME: no field of a fill result may be anything but a closed-set
 * string.
 *
 * This is the type-level form of the assertion `openapi.test.ts` makes about
 * the document. A `length?: number`, a `detail?: string` or a `value` added
 * later makes this stop being `never` and fails the build naming the field.
 */
type ClosedStringsOnly<T> = T extends unknown
  ? {
      [K in keyof T]-?: NonNullable<T[K]> extends
        | "filled"
        | "refused"
        | "secret_consumed"
        | FillRefusalReason
        ? never
        : K;
    }[keyof T]
  : never;
type AssertNever<T extends never> = T;
/**
 * Distributive, so BOTH members of the union are examined. A plain mapped type
 * over a union collapses to the keys they have in common, which would leave a
 * field added to only one branch unchecked — the same trap `Unpositioned<T>` in
 * `packages/conversation` exists to avoid.
 *
 * And note it is a CONSTRAINT (`T extends never`), not a computation: an
 * assertion that merely evaluates to `never` on failure is vacuous, which is how
 * `ONLY_MESSAGES_CARRY_CONTENT` was green while proving nothing.
 */
export type NO_FILL_RESULT_FIELD_CAN_HOLD_A_VALUE = AssertNever<
  ClosedStringsOnly<SecretFillResult>
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isMember<T extends string>(members: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (members as readonly string[]).includes(value);
}

/**
 * Bytes from the network to a request, or `null`.
 *
 * `null` rather than a thrown error carrying the input: on this plane a
 * validation error that quotes what failed is how a value reaches a log.
 */
export function parseSecretFillRequest(value: unknown): SecretFillRequest | null {
  if (!isRecord(value)) return null;
  const locator = value["locator"];
  if (!isRecord(locator)) return null;
  if (!isMember(FILL_LOCATOR_STRATEGIES, locator["strategy"])) return null;
  if (typeof locator["value"] !== "string" || locator["value"].length === 0) return null;

  const strings = ["handle", "studentRef", "caseRef", "targetHost", "consumer", "browserEndpoint"];
  for (const field of strings) {
    const held = value[field];
    if (typeof held !== "string" || held.length === 0) return null;
  }
  if (!isMember(FILL_PURPOSES, value["purpose"])) return null;
  // Fail closed: absent, false, or the string "true" are all refusals.
  if (value["noDiagnosticCapture"] !== true) return null;
  const pageUrl = value["pageUrl"];
  if (pageUrl !== undefined && typeof pageUrl !== "string") return null;

  return {
    handle: value["handle"] as string,
    studentRef: value["studentRef"] as string,
    caseRef: value["caseRef"] as string,
    purpose: value["purpose"],
    targetHost: value["targetHost"] as string,
    consumer: value["consumer"] as string,
    noDiagnosticCapture: true,
    browserEndpoint: value["browserEndpoint"] as string,
    ...(pageUrl === undefined ? {} : { pageUrl }),
    locator: { strategy: locator["strategy"], value: locator["value"] },
  };
}

/** Bytes from the network to a result, or `null`. Used by the runner's client. */
export function parseSecretFillResult(value: unknown): SecretFillResult | null {
  if (!isRecord(value)) return null;
  if (value["status"] === "filled") {
    return value["lifecycle"] === "secret_consumed"
      ? { status: "filled", lifecycle: "secret_consumed" }
      : null;
  }
  if (value["status"] !== "refused") return null;
  if (!isMember(FILL_REFUSAL_REASONS, value["reason"])) return null;
  return value["lifecycle"] === "secret_consumed"
    ? { status: "refused", reason: value["reason"], lifecycle: "secret_consumed" }
    : { status: "refused", reason: value["reason"] };
}
