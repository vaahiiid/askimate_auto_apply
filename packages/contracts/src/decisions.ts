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
 * ── Why it is a closed set ───────────────────────────────────────────────
 *
 * It shipped with one member and the note that `student_handoff` and
 * `hand_over_account` "need exactly this mechanism pointed at the account
 * lifecycle, and they are the next phase". They did, and it cost one member
 * rather than a second mechanism — which is what ADR-0041 exists to prevent.
 *
 * ── Why `confirm_handoff` does not name WHAT was confirmed ────────────────
 *
 * The obvious shape is a member per thing: `confirm_email_verified`,
 * `confirm_password_reset`, `confirm_account_access`. Every one of those puts
 * the SUBJECT of the confirmation in the client's hands, and the subject is
 * exactly what must not come from there: a client that could name the handoff
 * could confirm a password reset the student never did.
 *
 * A case has at most one open handoff — `decide` refuses a second — so what
 * was confirmed is already a fact the SERVER holds. The student's message is
 * "I have done the thing you asked", the case says what was asked, and the
 * hash binds the text they were shown while asking. That is the same rule
 * `parseSecureAppend` and `parseResolutionSubmission` follow, applied to the
 * one field somebody would otherwise have been tempted to send.
 *
 * It also means `mfa`, `otp`, `captcha` and `payment` need no new member when
 * their turn comes. They are already reachable.
 *
 * ── `confirm_value` follows the same rule, one level down ────────────────
 *
 * ADR-0051. The student agrees to a READING the agent understood from what
 * they said, and the hash names the deterministic playback they were shown.
 * What was read, and which field it was about, come from the open proposal on
 * the conversation log — never from the client, for the same reason: a client
 * that could name the field could confirm a date of birth the student never
 * gave.
 */

import { closedSetParser } from "./vocabulary.js";

export const STUDENT_DECISIONS = ["authorise", "confirm_handoff", "confirm_value"] as const;
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
   *
   * A `confirm_handoff` carries the hash of the message the student was shown
   * when they were asked, for the same reason and with the same comparison. A
   * handover message names the account, the portal and what is still
   * outstanding; confirming one they cannot see any more is confirming
   * something else.
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
