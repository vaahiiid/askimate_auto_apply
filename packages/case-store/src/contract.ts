/**
 * The shared CaseStore contract suite.
 *
 * Every implementation must pass this. The in-memory store runs it in Phase 1;
 * the Postgres store must run the identical suite in Phase 2.
 *
 * This exists because the durability guarantees in brief §4 — append-only, no
 * gaps, optimistic concurrency, unique submission keys — are easy to weaken
 * accidentally when swapping an in-memory map for a database, and very hard to
 * notice by reading code. Making both implementations pass the same assertions
 * is the only way to know the guarantee actually transferred.
 *
 * Exported as a function rather than a test file so a future package can import
 * and run it against its own implementation.
 */

import type { CaseEvent, CaseId, RequestEvidence, SubmissionIdentity, SubmissionKey } from "@askimate/aas-domain";
import {
  caseId as makeCaseId,
  courseId,
  eventId,
  externalRef,
  fold,
  institutionId,
  intake,
  openCase,
  stamp,
  studentId,
  submissionKey,
} from "@askimate/aas-domain";
import { describe, expect, it, beforeEach } from "vitest";

import type { CaseStore } from "./store.js";
import { ConcurrencyConflictError, DuplicateSubmissionError } from "./store.js";

const IDENTITY: SubmissionIdentity = {
  studentId: studentId("stu_001"),
  institutionId: institutionId("inst_leeds"),
  courseId: courseId("crs_msc_data_science"),
  intake: intake("2027-09"),
  attemptOrdinal: 1,
};

const EVIDENCE: RequestEvidence = {
  requestedAt: new Date("2026-08-26T10:14:22Z"),
  channel: "askimate_chat",
  studentStatement: "Yes, please apply to Leeds for me.",
};

function openingEvents(id: CaseId): readonly CaseEvent[] {
  return stamp({
    caseId: id,
    fromSequence: 0,
    payloads: [openCase({ submissionIdentity: IDENTITY, requestEvidence: EVIDENCE })],
    actor: { kind: "askimate", externalRef: externalRef("askimate:user:4812") },
    now: new Date("2026-08-26T10:15:00Z"),
    nextEventId: (index) => `evt_open_${index}`,
  });
}

function transitionEvent(id: CaseId, sequence: number): CaseEvent {
  return {
    type: "CaseStateChanged",
    from: "INTAKE",
    to: "DOCUMENTS_PENDING",
    reason: "Need a passport.",
    eventId: eventId(`evt_${sequence}`),
    caseId: id,
    sequence,
    occurredAt: new Date("2026-08-26T10:20:00Z"),
    actor: { kind: "system", component: "orchestrator-worker" },
  };
}

/**
 * Runs the contract against a store.
 *
 * @param name  Implementation name, for the describe block.
 * @param make  Returns a FRESH, empty store. Called before every test.
 */
export function runCaseStoreContract(name: string, make: () => CaseStore | Promise<CaseStore>): void {
  describe(`CaseStore contract — ${name}`, () => {
    let store: CaseStore;
    let id: CaseId;
    let counter = 0;

    beforeEach(async () => {
      store = await make();
      counter += 1;
      id = makeCaseId(`case_${counter}`);
    });

    describe("append and read", () => {
      it("starts a case at sequence 0", async () => {
        expect(await store.currentSequence(id)).toBe(0);
        expect(await store.read(id)).toEqual([]);
      });

      it("appends the opening event", async () => {
        await store.append(id, 0, openingEvents(id));

        expect(await store.currentSequence(id)).toBe(1);
        const log = await store.read(id);
        expect(log).toHaveLength(1);
        expect(log[0]?.type).toBe("CaseOpened");
      });

      it("returns events in sequence order", async () => {
        await store.append(id, 0, openingEvents(id));
        await store.append(id, 1, [transitionEvent(id, 2)]);

        const log = await store.read(id);
        expect(log.map((event) => event.sequence)).toEqual([1, 2]);
      });

      it("produces a log that folds into a case", async () => {
        // The point of the store: what goes in must come back out well enough
        // to derive state from, across a process boundary.
        await store.append(id, 0, openingEvents(id));
        await store.append(id, 1, [transitionEvent(id, 2)]);

        const derived = fold(await store.read(await Promise.resolve(id)));
        expect(derived.state).toBe("DOCUMENTS_PENDING");
        expect(derived.sequence).toBe(2);
      });

      it("accepts an empty append as a no-op", async () => {
        await store.append(id, 0, []);
        expect(await store.currentSequence(id)).toBe(0);
      });

      it("keeps cases isolated from each other", async () => {
        const other = makeCaseId(`case_other_${counter}`);
        await store.append(id, 0, openingEvents(id));

        expect(await store.currentSequence(other)).toBe(0);
        expect(await store.read(other)).toEqual([]);
      });
    });

    describe("append-only — history cannot be rewritten", () => {
      it("has no operation that updates or deletes an event", () => {
        // The contract surface itself is the guarantee. If someone adds an
        // `update` or `delete` to CaseStore, this fails and forces the
        // conversation about why.
        const surface = Object.getOwnPropertyNames(Object.getPrototypeOf(store) as object);
        expect(surface).not.toContain("update");
        expect(surface).not.toContain("delete");
        expect(surface).not.toContain("remove");
        expect(surface).not.toContain("truncate");
      });

      it("does not let a caller mutate the stored log through the returned array", async () => {
        await store.append(id, 0, openingEvents(id));

        const log = await store.read(id);
        (log as CaseEvent[]).length = 0; // a caller behaving badly

        expect(await store.read(id)).toHaveLength(1);
      });

      it("rejects an append whose events are not consecutive", async () => {
        await store.append(id, 0, openingEvents(id));
        // Claims to follow sequence 1 but is numbered 5.
        await expect(store.append(id, 1, [transitionEvent(id, 5)])).rejects.toThrow(/consecutive|gap/i);
      });

      it("rejects an event belonging to a different case", async () => {
        const foreign = transitionEvent(makeCaseId("case_elsewhere"), 1);
        await expect(store.append(id, 0, [foreign])).rejects.toThrow();
      });
    });

    describe("optimistic concurrency", () => {
      it("rejects an append against a stale sequence", async () => {
        await store.append(id, 0, openingEvents(id));

        // A second worker still believes the case is at 0.
        await expect(store.append(id, 0, [transitionEvent(id, 1)])).rejects.toThrow(ConcurrencyConflictError);
      });

      it("rejects an append against a sequence ahead of the store", async () => {
        await expect(store.append(id, 7, [transitionEvent(id, 8)])).rejects.toThrow(ConcurrencyConflictError);
      });

      it("lets only one of two concurrent writers win", async () => {
        // FAILURE SCENARIO (brief §10): two workers act on the same case at
        // once. Exactly one must succeed.
        await store.append(id, 0, openingEvents(id));

        const results = await Promise.allSettled([
          store.append(id, 1, [transitionEvent(id, 2)]),
          store.append(id, 1, [transitionEvent(id, 2)]),
        ]);

        const fulfilled = results.filter((result) => result.status === "fulfilled");
        expect(fulfilled).toHaveLength(1);
        expect(await store.currentSequence(id)).toBe(2);
      });

      it("writes nothing when an append is rejected", async () => {
        await store.append(id, 0, openingEvents(id));
        await expect(store.append(id, 0, [transitionEvent(id, 1)])).rejects.toThrow();

        // Atomicity: a rejected append leaves the log exactly as it was.
        expect(await store.currentSequence(id)).toBe(1);
        expect(await store.read(id)).toHaveLength(1);
      });
    });

    describe("submission keys — the second line of defence", () => {
      const key: SubmissionKey = submissionKey(IDENTITY);

      it("claims an unheld key", async () => {
        await store.claimSubmissionKey(key, id);
        expect(await store.findBySubmissionKey(key)).toBe(id);
      });

      it("returns null for an unclaimed key", async () => {
        expect(await store.findBySubmissionKey(key)).toBeNull();
      });

      it("refuses a claim by a different case", async () => {
        // THE guarantee. Even if two workers both decide to submit from stale
        // reads, only one can claim the key — the other is refused at write
        // time. Application-level checks race; this does not.
        await store.claimSubmissionKey(key, id);

        const other = makeCaseId(`case_duplicate_${counter}`);
        await expect(store.claimSubmissionKey(key, other)).rejects.toThrow(DuplicateSubmissionError);
      });

      it("treats a re-claim by the same case as a no-op", async () => {
        // So an idempotent retry of the claim itself does not fail.
        await store.claimSubmissionKey(key, id);
        await expect(store.claimSubmissionKey(key, id)).resolves.toBeUndefined();
        expect(await store.findBySubmissionKey(key)).toBe(id);
      });

      it("lets only one of two concurrent claimants win", async () => {
        const other = makeCaseId(`case_racer_${counter}`);

        const results = await Promise.allSettled([
          store.claimSubmissionKey(key, id),
          store.claimSubmissionKey(key, other),
        ]);

        expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      });

      it("allows a different attempt ordinal to claim its own key", async () => {
        // ADR-0006: a re-application is a genuinely different submission and
        // must not be blocked by the first attempt's key.
        await store.claimSubmissionKey(key, id);

        const secondAttempt = submissionKey({ ...IDENTITY, attemptOrdinal: 2 });
        const reapplication = makeCaseId(`case_attempt2_${counter}`);

        await expect(store.claimSubmissionKey(secondAttempt, reapplication)).resolves.toBeUndefined();
      });

      it("allows a different intake to claim its own key", async () => {
        await store.claimSubmissionKey(key, id);

        const laterIntake = submissionKey({ ...IDENTITY, intake: intake("2028-09") });
        const otherCase = makeCaseId(`case_2028_${counter}`);

        await expect(store.claimSubmissionKey(laterIntake, otherCase)).resolves.toBeUndefined();
      });
    });
  });
}
