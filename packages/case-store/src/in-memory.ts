/**
 * In-memory case store.
 *
 * The Phase 1 reference implementation. Real enough to develop and test the
 * whole orchestration loop against, with no database, which is what makes
 * Phase 1 "fully testable with no external systems" (brief §11).
 *
 * NOT for production: it holds everything in process memory and loses it on
 * restart, which is precisely the property the brief's §4 durability
 * requirement rules out. The Postgres implementation arrives in Phase 2 and
 * must pass the same contract suite.
 */

import type { CaseEvent, CaseId, SubmissionKey } from "@askimate/aas-domain";

import type { CaseStore } from "./store.js";
import { ConcurrencyConflictError, DuplicateSubmissionError } from "./store.js";

export class InMemoryCaseStore implements CaseStore {
  readonly #logs = new Map<CaseId, CaseEvent[]>();
  readonly #submissionKeys = new Map<SubmissionKey, CaseId>();

  public append(caseId: CaseId, expectedSequence: number, events: readonly CaseEvent[]): Promise<void> {
    const existing = this.#logs.get(caseId) ?? [];
    const actualSequence = existing.length === 0 ? 0 : (existing[existing.length - 1]?.sequence ?? 0);

    if (actualSequence !== expectedSequence) {
      return Promise.reject(new ConcurrencyConflictError(caseId, expectedSequence, actualSequence));
    }

    if (events.length === 0) return Promise.resolve();

    // Validate the whole batch BEFORE writing any of it. A partial write would
    // leave a sequence gap, which `fold` refuses to read — so a non-atomic
    // append corrupts the case rather than merely failing.
    let nextSequence = expectedSequence + 1;
    for (const event of events) {
      if (event.caseId !== caseId) {
        return Promise.reject(
          new Error(`Event ${event.eventId} belongs to case ${event.caseId}, not ${caseId}.`),
        );
      }
      if (event.sequence !== nextSequence) {
        return Promise.reject(
          new Error(
            `Event ${event.eventId} has sequence ${event.sequence}, expected ${nextSequence}. ` +
              `Events must be consecutive with no gaps.`,
          ),
        );
      }
      nextSequence += 1;
    }

    // Copy on write so a caller mutating its array cannot reach into the store.
    this.#logs.set(caseId, [...existing, ...events]);
    return Promise.resolve();
  }

  public read(caseId: CaseId): Promise<readonly CaseEvent[]> {
    // Defensive copy: the log is append-only, and handing out the live array
    // would let a caller splice it.
    return Promise.resolve([...(this.#logs.get(caseId) ?? [])]);
  }

  public currentSequence(caseId: CaseId): Promise<number> {
    const log = this.#logs.get(caseId);
    if (log === undefined || log.length === 0) return Promise.resolve(0);
    return Promise.resolve(log[log.length - 1]?.sequence ?? 0);
  }

  public claimSubmissionKey(key: SubmissionKey, caseId: CaseId): Promise<void> {
    const holder = this.#submissionKeys.get(key);

    if (holder !== undefined) {
      // Re-claiming for the same case is a no-op, so an idempotent retry of the
      // claim does not fail. A different case is a genuine duplicate.
      if (holder === caseId) return Promise.resolve();
      return Promise.reject(new DuplicateSubmissionError(key, holder));
    }

    this.#submissionKeys.set(key, caseId);
    return Promise.resolve();
  }

  public findBySubmissionKey(key: SubmissionKey): Promise<CaseId | null> {
    return Promise.resolve(this.#submissionKeys.get(key) ?? null);
  }

  /** Test helper. Not part of the `CaseStore` contract. */
  public reset(): void {
    this.#logs.clear();
    this.#submissionKeys.clear();
  }
}
