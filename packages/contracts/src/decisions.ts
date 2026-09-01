/**
 * A decision only the student can make (ADR-0049 §5).
 *
 * ── Why this is not a chat message ────────────────────────────────────────
 *
 * The obvious shape is: the student types "yes, go ahead" and a model reads it.
 * The existing design already rules that out, and not as a matter of taste.
 *
 * The authorisation ledger stores the presented text VERBATIM and binds a
 * content hash, and says why: *"What exactly did I approve?" … Re-rendering the
 * preview from current data would produce a plausible document that is not what
 * they saw.* A free-text "yes" supplies neither the hash nor the text. And
 * `AuthorisablePreview` is branded and obtainable only from `checkAuthorisable`,
 * so there is no preview to approve that has not passed validation.
 *
 * Underneath that is the same rule as ADR-0004 and ADR-0016: a model must not
 * decide a fact about a real application. Inventing a value into one and
 * deciding that a student approved one are the same class of act.
 *
 * ── Why it is a closed set with one member ───────────────────────────────
 *
 * `student_handoff` and `hand_over_account` need exactly this mechanism pointed
 * at the account lifecycle, and they are the next phase. A closed set means
 * that is adding a member rather than building the mechanism twice, which is
 * what ADR-0041 exists to prevent.
 */

import { closedSetParser } from "./vocabulary.js";

export const STUDENT_DECISIONS = ["authorise"] as const;
export type StudentDecisionKind = (typeof STUDENT_DECISIONS)[number];

export const parseStudentDecisionKind = closedSetParser(STUDENT_DECISIONS);

/** What the student decided, and about exactly what. */
export interface StudentDecision {
  readonly kind: StudentDecisionKind;
  /**
   * The hash of the content they were shown.
   *
   * Not optional, and not defaulted. An authorisation that does not name what
   * was authorised is the thing the ledger exists to make impossible: six
   * months later the blueprint may be at version 3 and the profile corrected,
   * and "they approved it" without a hash cannot be checked against anything.
   *
   * The service compares it against the preview it would render NOW, and
   * refuses on a mismatch rather than recording an approval of something else.
   */
  readonly contentHash: string;
}

function readString(body: unknown, field: string): string | null {
  if (typeof body !== "object" || body === null) return null;
  const value = (body as Record<string, unknown>)[field];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Parses a decision, or refuses it.
 *
 * Deliberately absent from every branch: any field a caller might send for the
 * run, the student, the time, or the outcome. They are not read, so they cannot
 * become authoritative — the rule `parseSecureAppend` and
 * `parseResolutionSubmission` both follow.
 */
export function parseStudentDecision(body: unknown): StudentDecision | null {
  const kind = parseStudentDecisionKind((body as Record<string, unknown> | null)?.["kind"]);
  const contentHash = readString(body, "contentHash");
  if (kind === null || contentHash === null) return null;
  return { kind, contentHash };
}

// ───────────────────────────────────────────────────────────────────────────
// Compile-time constraints
// ───────────────────────────────────────────────────────────────────────────

type AssertNever<T extends never> = T;

/**
 * A CONSTRAINT, not a computation.
 *
 * A decision must never carry the content itself, a rendered preview, or a
 * confirmed value. What the student saw is the SERVICE's record; a client that
 * sent the text back could send different text, and the ledger would store the
 * client's version of what it showed them.
 */
export type A_DECISION_CARRIES_A_HASH_NOT_THE_CONTENT = AssertNever<
  Extract<keyof StudentDecision, "presentedText" | "preview" | "content" | "values">
>;
