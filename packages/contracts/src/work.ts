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
 */

// ───────────────────────────────────────────────────────────────────────────
// What kind of work
// ───────────────────────────────────────────────────────────────────────────

/**
 * The kinds of work a browser is needed for.
 *
 * **One member today, deliberately.** The orchestrator has a second step that
 * needs a browser — `execute` — and it is not here because its payload is a
 * `FillPlan`, whose instructions carry `ConfirmedValue<string>`. That is a
 * branded type which may only be minted inside `packages/profile` (ADR-0004,
 * enforced package-scoped), and the runner may not depend on that package.
 * Serialising a plan and rebuilding it in the runner would mint confirmed
 * values outside the one place allowed to mint them.
 *
 * So `execute` needs a decision rather than a field, and adding a member here is
 * a reviewable change to a one-member list — which is the point of writing it
 * as a closed set rather than as a string.
 */
export const WORK_KINDS = ["create_account"] as const;
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
}

/**
 * COMPILE-TIME: no field of a work item may be free text.
 *
 * The type-level form of "read the fields, then read what is absent". A `say`, a
 * `detail`, a `value` or a `password` added later stops this being `never` and
 * fails the build naming the field. It is a CONSTRAINT rather than a
 * computation, because an assertion that merely evaluates to `never` is vacuous
 * — this repository has shipped one of those and found it by regression.
 */
type OpenStrings<T> = {
  [K in keyof T]-?: NonNullable<T[K]> extends WorkKind | WorkApproach
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
        ? never
        : K
      : K;
}[keyof T];
type AssertNever<T extends never> = T;
export type NO_WORK_FIELD_IS_FREE_TEXT = AssertNever<OpenStrings<ClaimedWork>>;

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
  };
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
