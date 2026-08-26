/**
 * The case store port.
 *
 * Defines what persistence must guarantee, without saying how. Phase 1 ships an
 * in-memory implementation that satisfies the contract exactly; Phase 2 adds a
 * Postgres implementation that must satisfy the *same* contract, verified by the
 * same shared test suite (`contract.ts`).
 *
 * That is deliberate. The rules below — append-only, no gaps, optimistic
 * concurrency, unique submission keys — are the durability guarantees the brief
 * requires in §4, and they must be provably identical in both implementations.
 * A Postgres adapter that quietly weakened one of them would be very hard to
 * notice by reading code alone.
 */

import type { CaseEvent, CaseId, SubmissionKey } from "@askimate/aas-domain";

/**
 * Raised when a concurrent writer already advanced the case.
 *
 * The caller should re-read, re-derive, and re-decide. It must NOT simply retry
 * the append: the decision that produced these events was made against a case
 * state that no longer holds.
 */
export class ConcurrencyConflictError extends Error {
  public override readonly name = "ConcurrencyConflictError";
  public constructor(
    public readonly caseId: CaseId,
    public readonly expectedSequence: number,
    public readonly actualSequence: number,
  ) {
    super(
      `Concurrent modification of case ${caseId}: expected sequence ${expectedSequence}, ` +
        `store is at ${actualSequence}. Re-read the case and decide again.`,
    );
  }
}

/**
 * Raised when a submission key is already claimed.
 *
 * The second line of defence against duplicate submission. The domain refuses a
 * duplicate at decision time; this refuses it at write time, which is what
 * protects against two workers deciding simultaneously on stale reads.
 *
 * Application-level checks race. A unique constraint does not.
 */
export class DuplicateSubmissionError extends Error {
  public override readonly name = "DuplicateSubmissionError";
  public constructor(
    public readonly submissionKey: SubmissionKey,
    public readonly existingCaseId: CaseId,
  ) {
    super(
      `Submission key already claimed by case ${existingCaseId}. ` +
        `A duplicate submission was prevented.`,
    );
  }
}

export class CaseNotFoundError extends Error {
  public override readonly name = "CaseNotFoundError";
  public constructor(public readonly caseId: CaseId) {
    super(`No case ${caseId}.`);
  }
}

/**
 * Persistence for cases.
 *
 * There is deliberately no `update`, no `delete`, and no way to rewrite
 * history. The only mutation is `append`. Everything else reads.
 */
export interface CaseStore {
  /**
   * Appends events to a case's log.
   *
   * `expectedSequence` is the sequence the caller believes the case is at. If
   * the store disagrees, the append is rejected with `ConcurrencyConflictError`
   * and nothing is written — two workers cannot both win.
   *
   * The append is atomic: either every event lands or none does. A partially
   * written log would produce a sequence gap, which `fold` refuses to read, so
   * a non-atomic implementation would corrupt the case rather than merely fail.
   */
  append(caseId: CaseId, expectedSequence: number, events: readonly CaseEvent[]): Promise<void>;

  /** Reads a case's complete log, ordered by sequence. Empty if unknown. */
  read(caseId: CaseId): Promise<readonly CaseEvent[]>;

  /** The current sequence of a case. 0 when the case does not exist. */
  currentSequence(caseId: CaseId): Promise<number>;

  /**
   * Claims a submission key for a case.
   *
   * Must be atomic and must fail with `DuplicateSubmissionError` if the key is
   * already held by a different case. In Postgres this is a UNIQUE index; in
   * memory it is a map check. The guarantee is what matters, not the mechanism.
   *
   * Claiming for the SAME case again is a no-op, so an idempotent retry of the
   * claim itself does not fail.
   */
  claimSubmissionKey(key: SubmissionKey, caseId: CaseId): Promise<void>;

  /** Which case holds a submission key, if any. */
  findBySubmissionKey(key: SubmissionKey): Promise<CaseId | null>;
}
