/**
 * Idempotency and submission identity (ADR-0006).
 *
 * From the master brief, §4:
 *
 *   "Every submission attempt carries an idempotency key. Duplicate submission
 *    is the characteristic catastrophic failure of this class of system and
 *    must be structurally impossible, not merely unlikely."
 *
 * The identity of a submission is:
 *
 *     (studentId, institutionId, courseId, intake, attemptOrdinal)
 *
 * `attemptOrdinal` starts at 1 and can be incremented by EXACTLY ONE thing: an
 * explicit instruction from the student, recorded as a `ReapplicationInstructed`
 * event. Not a retry. Not a specialist. Not an operator. Not the orchestrator.
 *
 * That is what makes duplication structurally impossible rather than merely
 * unlikely: a retry has no way to produce a different key, so it necessarily
 * collides with the attempt already recorded, and the collision is what stops
 * it. There is no flag to set and no branch to take.
 */

import type { Brand } from "./brand.js";
import type { CourseId, InstitutionId, Intake, StudentId } from "./ids.js";

/**
 * The canonical identity of one submission attempt.
 *
 * Two attempts with equal keys are the same submission, and the second must
 * never reach a university.
 */
export interface SubmissionIdentity {
  readonly studentId: StudentId;
  readonly institutionId: InstitutionId;
  readonly courseId: CourseId;
  readonly intake: Intake;
  /** 1 for the first attempt. Only `ReapplicationInstructed` may increase it. */
  readonly attemptOrdinal: number;
}

/** The serialised, comparable form of a `SubmissionIdentity`. */
export type SubmissionKey = Brand<string, "SubmissionKey">;

/**
 * Serialises a submission identity into a stable, comparable key.
 *
 * Used as a UNIQUE constraint in the case store, so the database is the final
 * arbiter. Application-level checks race; a unique index does not. Belt and
 * braces, with the braces in Postgres.
 *
 * The separator is a unit separator (U+001F) rather than a printable character,
 * so no id containing a colon or a slash can forge a collision with a different
 * identity.
 */
export function submissionKey(identity: SubmissionIdentity): SubmissionKey {
  assertValidOrdinal(identity.attemptOrdinal);
  const parts = [
    identity.studentId,
    identity.institutionId,
    identity.courseId,
    identity.intake,
    String(identity.attemptOrdinal),
  ];
  return parts.join("") as SubmissionKey;
}

/** True when two identities denote the same submission. */
export function isSameSubmission(a: SubmissionIdentity, b: SubmissionIdentity): boolean {
  return submissionKey(a) === submissionKey(b);
}

/**
 * The identity a *retry* must use: the same one. Always.
 *
 * Exists as a named function so that "retrying" is a call to something that
 * visibly returns the identity unchanged, rather than an opportunity for a
 * future engineer to construct a fresh key "so the retry goes through".
 */
export function identityForRetry(identity: SubmissionIdentity): SubmissionIdentity {
  return identity;
}

function assertValidOrdinal(ordinal: number): void {
  if (!Number.isInteger(ordinal) || ordinal < 1) {
    throw new RangeError(`attemptOrdinal must be an integer >= 1, received: ${ordinal}`);
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Request-level idempotency (the AskiMate → AAS boundary)
// ───────────────────────────────────────────────────────────────────────────

/**
 * An `Idempotency-Key` header value on `POST /v1/application-cases`.
 *
 * Distinct from `SubmissionKey`, and the distinction matters:
 *
 *   IdempotencyKey — stops a double-clicked or retried *API call* from opening
 *                    two cases. Caller-supplied, short-lived.
 *
 *   SubmissionKey  — stops a duplicate *application* from reaching a
 *                    university. System-derived, permanent.
 *
 * The first is a convenience. The second is the safety property.
 */
export type IdempotencyKey = Brand<string, "IdempotencyKey">;

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._~-]{16,128}$/;

export function isIdempotencyKey(value: string): value is IdempotencyKey {
  return IDEMPOTENCY_KEY_PATTERN.test(value);
}

export function idempotencyKey(value: string): IdempotencyKey {
  if (!isIdempotencyKey(value)) {
    throw new RangeError(
      "Idempotency-Key must be 16-128 characters of [A-Za-z0-9._~-]. " +
        "A UUID is the expected form.",
    );
  }
  return value;
}
