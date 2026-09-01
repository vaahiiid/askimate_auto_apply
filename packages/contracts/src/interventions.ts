/**
 * The wire shape of a specialist intervention (ADR-0048).
 *
 * ── What crosses, and what deliberately does not ──────────────────────────
 *
 * An intervention is read by a PERSON who is about to open a real portal and
 * look. So it carries enough to find the thing — which run, which action,
 * against what, since when — and nothing that would let a caller drive the run
 * from the outside.
 *
 * Absent by construction:
 *
 *   - any position, cursor or "resume from" (ADR-0048 §5). Where a run picks up
 *     is derived from the intent ledger; a field here that something might
 *     honour is the second source of truth ADR-0041 forbids, and
 *     `A_RESOLUTION_CARRIES_NO_POSITION` in the domain makes adding one fail to
 *     compile.
 *   - any confirmed value, any credential, any student answer. A specialist
 *     resolving a stuck account creation needs to know an account creation is
 *     stuck, not what the student typed.
 *   - `route_fallback` as an accepted outcome. ADR-0048 §4 rejects it
 *     explicitly rather than half-implementing it, so it is absent from the
 *     closed set below and the parser refuses it.
 */

import { closedSetParser } from "./vocabulary.js";

/**
 * Outcomes a resolution may carry ON THE WIRE.
 *
 * Note this is NOT the domain's `RESOLUTION_OUTCOMES`, which still names
 * `route_fallback` because the domain models the decision ADR-0008 described.
 * The wire admits only what is implemented. `contract-drift.test.ts` asserts
 * that this is a strict subset, so the day route switching is built the drift
 * test is what notices the two have to be reconciled.
 */
export const WIRE_RESOLUTION_OUTCOMES = ["resume", "abandon"] as const;
export type WireResolutionOutcome = (typeof WIRE_RESOLUTION_OUTCOMES)[number];

export const parseWireResolutionOutcome = closedSetParser(WIRE_RESOLUTION_OUTCOMES);

/** One open intervention, as a specialist sees it. */
export interface OpenIntervention {
  readonly interventionId: string;
  readonly runId: string;
  readonly caseId: string;
  readonly studentRef: string;
  /** `high` or `critical` — what routes an alert, once there is one. */
  readonly priority: string;
  readonly reason: string;
  /** The consequential action that was in flight. */
  readonly action: string;
  /** What it acted on: a portal host, a page reference. Never a value. */
  readonly target: string;
  readonly portal: string;
  readonly phase: string;
  /** In the words a specialist can act on. */
  readonly encountered: string;
  readonly expected: string;
  readonly raisedAt: string;
  /** Whether the student has been told. */
  readonly announced: boolean;
}

/** What a specialist submits. */
export interface ResolutionSubmission {
  /**
   * The named individual. ASSERTED, not authenticated (ADR-0048 §3).
   *
   * The service admits this call on the internal service credential, so this
   * records who CLAIMED to resolve it. Vahid approved that for the current
   * single-operator model and named what ends it: a second specialist existing
   * at all, at which point authenticated individual identity is a required
   * capability and a release blocker, not a deferred improvement.
   */
  readonly specialistId: string;
  readonly actionsTaken: string;
  readonly resolution: string;
  readonly outcome: WireResolutionOutcome;
  /**
   * What the specialist ESTABLISHED: did the action actually happen?
   *
   * The whole question. `assessIntent` stopped the run because it could not
   * answer it, and this is the answer going back into the one place that holds
   * it. Not a suggestion and not a preference — a person opened the portal and
   * looked.
   */
  readonly didHappen: boolean;
  /** How widely the fix applies. Narrow by default. */
  readonly scope: string;
  readonly kind: string;
  readonly signature: string;
}

function readString(body: unknown, field: string): string | null {
  if (typeof body !== "object" || body === null) return null;
  const value = (body as Record<string, unknown>)[field];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Parses a submission, or refuses it.
 *
 * Everything against a closed set or a non-empty string. Deliberately absent
 * from every branch: any field a caller might send for the intervention's id,
 * the run, the resolution time, or a position. They are not read, so they
 * cannot become authoritative — the same rule `parseSecureAppend` follows.
 */
export function parseResolutionSubmission(body: unknown): ResolutionSubmission | null {
  const specialistId = readString(body, "specialistId");
  const actionsTaken = readString(body, "actionsTaken");
  const resolution = readString(body, "resolution");
  const signature = readString(body, "signature");
  const scope = readString(body, "scope");
  const kind = readString(body, "kind");
  const outcome = parseWireResolutionOutcome(
    (body as Record<string, unknown> | null)?.["outcome"],
  );
  const didHappen = (body as Record<string, unknown> | null)?.["didHappen"];

  if (
    specialistId === null ||
    actionsTaken === null ||
    resolution === null ||
    signature === null ||
    scope === null ||
    kind === null ||
    outcome === null ||
    typeof didHappen !== "boolean"
  ) {
    return null;
  }
  return {
    specialistId,
    actionsTaken,
    resolution,
    outcome,
    didHappen,
    scope,
    kind,
    signature,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Compile-time constraints
// ───────────────────────────────────────────────────────────────────────────

type AssertNever<T extends never> = T;

/**
 * A CONSTRAINT, not a computation.
 *
 * `route_fallback` must not become a wire outcome without a decision. ADR-0048
 * §4 rejects it explicitly, and adding it to `WIRE_RESOLUTION_OUTCOMES` makes
 * this line red rather than quietly admitting a route change nothing
 * implements.
 */
export type ROUTE_FALLBACK_IS_NOT_ON_THE_WIRE = AssertNever<
  Extract<WireResolutionOutcome, "route_fallback">
>;

/**
 * No field of an open intervention is a position.
 *
 * Written by name rather than by shape because a cursor smuggled onto this type
 * would be a string like any other. The name is the specification.
 */
export type AN_OPEN_INTERVENTION_CARRIES_NO_POSITION = AssertNever<
  Extract<keyof OpenIntervention, "resumeFrom" | "resumeTo" | "cursor" | "position" | "checkpoint">
>;
