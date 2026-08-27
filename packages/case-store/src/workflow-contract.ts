/**
 * The shared WorkflowRunStore contract.
 *
 * Every implementation must pass this, exactly as `contract.ts` does for
 * `CaseStore`. That approach found a real defect in C1 — a racing
 * `claimSubmissionKey` that prevented the duplicate but reported the wrong
 * error — so it is used again here, and again the assertions are about
 * *domain-level behaviour and error semantics*, not merely about the database
 * refusing an invalid state.
 *
 * ── The most important test in this file ──────────────────────────────────
 *
 * `"losing every checkpoint loses no business fact"`. It is the executable
 * form of rule 3 of the approved architecture, and it is what stops a
 * checkpoint quietly becoming a second source of truth over the next year of
 * changes. If someone stashes a business fact in `detail` to make a resume
 * easier, that test is what notices.
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  beginCheckpoint,
  blueprintVersion,
  caseId as makeCaseId,
  idempotencyKeyFor,
  runId as makeRunId,
  studentId,
} from "@askimate/aas-domain";
import type { ActionIntent, RunId, WorkflowCheckpoint, WorkflowRunRecord } from "@askimate/aas-domain";

import type { WorkflowRunStore } from "./workflow-store.js";
import {
  RunAlreadyExistsError,
  RunConcurrencyError,
  RunNotFoundError,
  RunStatusError,
} from "./workflow-store.js";

const NOW = new Date("2026-08-27T10:00:00Z");
const VERSION = blueprintVersion("ulster-msc-ib-v3");
const STUDENT = studentId("stu_001");
const CASE = makeCaseId("case_1");

function freshRun(id: RunId): Omit<WorkflowRunRecord, "revision" | "updatedAt"> {
  return {
    runId: id,
    caseId: CASE,
    studentRef: STUDENT,
    status: "running",
    checkpoint: beginCheckpoint({ blueprintVersion: VERSION, now: NOW }),
    startedAt: NOW,
  };
}

function advanced(fields: readonly string[]): WorkflowCheckpoint {
  return {
    schemaVersion: 1,
    phase: "filling",
    fieldsCompleted: fields,
    blueprintVersion: VERSION,
    detail: { pageIndex: 2, lastFieldRef: fields[fields.length - 1] ?? null },
    capturedAt: NOW,
  };
}

/**
 * Runs the contract against a store.
 *
 * @param name Implementation name, for the describe block.
 * @param make Returns a FRESH, empty store. Called before every test.
 *
 * (`make` returning a fresh store is not decoration — the CaseStore contract
 * documents the same thing, and ignoring it cost six failing tests in 0.2.0.)
 */
export function runWorkflowStoreContract(
  name: string,
  make: () => WorkflowRunStore | Promise<WorkflowRunStore>,
): void {
  describe(`WorkflowRunStore contract — ${name}`, () => {
    let store: WorkflowRunStore;
    let id: RunId;
    let counter = 0;

    beforeEach(async () => {
      store = await make();
      counter += 1;
      id = makeRunId(`run_${String(counter)}`);
    });

    describe("starting and loading", () => {
      it("starts a run at revision 0", async () => {
        const run = await store.start(freshRun(id));
        expect(run.revision).toBe(0);
        expect(run.status).toBe("running");
        expect(run.checkpoint.phase).toBe("preparing_inputs");
      });

      it("loads it back", async () => {
        await store.start(freshRun(id));
        const loaded = await store.load(id);
        expect(loaded?.runId).toBe(id);
        expect(loaded?.caseId).toBe(CASE);
        expect(loaded?.studentRef).toBe(STUDENT);
      });

      it("returns null for a run nobody started", async () => {
        expect(await store.load(makeRunId("run_never"))).toBeNull();
      });

      it("refuses to start the same run twice", async () => {
        await store.start(freshRun(id));
        await expect(store.start(freshRun(id))).rejects.toThrow(RunAlreadyExistsError);
      });

      it("keeps Dates as Dates across a save and load", async () => {
        // The hazard that only exists once there is a database. A checkpoint
        // whose `capturedAt` came back as a string would compare and sort
        // wrongly, quietly.
        await store.start(freshRun(id));
        const loaded = await store.load(id);
        expect(loaded?.startedAt).toBeInstanceOf(Date);
        expect(loaded?.checkpoint.capturedAt).toBeInstanceOf(Date);
        expect(loaded?.checkpoint.capturedAt.getTime()).toBe(NOW.getTime());
      });

      it("finds every run for a case", async () => {
        // A case may be attempted more than once: a route fallback, or a
        // reapplication.
        await store.start(freshRun(id));
        const second = makeRunId(`${id}_b`);
        await store.start({ ...freshRun(second), runId: second });

        const runs = await store.findByCase(CASE);
        expect(runs.map((run) => run.runId).sort()).toEqual([id, second].sort());
      });
    });

    describe("checkpoints", () => {
      it("saves and returns the new revision", async () => {
        await store.start(freshRun(id));
        const revision = await store.saveCheckpoint({
          runId: id,
          checkpoint: advanced(["given_name"]),
          expectedRevision: 0,
        });
        expect(revision).toBe(1);

        const loaded = await store.load(id);
        expect(loaded?.revision).toBe(1);
        expect(loaded?.checkpoint.fieldsCompleted).toEqual(["given_name"]);
      });

      it("records real progress — not one boolean", async () => {
        // What `RunState.filled?: boolean` could not do: distinguish a run that
        // died after two fields from one that died after none.
        await store.start(freshRun(id));
        await store.saveCheckpoint({
          runId: id,
          checkpoint: advanced(["given_name", "family_name"]),
          expectedRevision: 0,
        });
        const loaded = await store.load(id);
        expect(loaded?.checkpoint.fieldsCompleted).toEqual(["given_name", "family_name"]);
        expect(loaded?.checkpoint.detail["pageIndex"]).toBe(2);
      });

      it("rejects a save against a stale revision", async () => {
        await store.start(freshRun(id));
        await store.saveCheckpoint({
          runId: id,
          checkpoint: advanced(["a"]),
          expectedRevision: 0,
        });
        await expect(
          store.saveCheckpoint({ runId: id, checkpoint: advanced(["b"]), expectedRevision: 0 }),
        ).rejects.toThrow(RunConcurrencyError);
      });

      it("lets only ONE of two concurrent resumes win", async () => {
        // The failure this exists for: two processes both resume one run.
        await store.start(freshRun(id));
        const results = await Promise.allSettled([
          store.saveCheckpoint({ runId: id, checkpoint: advanced(["a"]), expectedRevision: 0 }),
          store.saveCheckpoint({ runId: id, checkpoint: advanced(["b"]), expectedRevision: 0 }),
        ]);
        expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);

        // And the loser is told WHY — the lesson from C1's racing
        // claimSubmissionKey, which prevented the duplicate but reported a raw
        // driver error that looked transient and invited a retry.
        const rejected = results.find((result) => result.status === "rejected");
        expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(RunConcurrencyError);
      });

      it("refuses a checkpoint for a run nobody started", async () => {
        await expect(
          store.saveCheckpoint({
            runId: makeRunId("run_ghost"),
            checkpoint: advanced([]),
            expectedRevision: 0,
          }),
        ).rejects.toThrow(RunNotFoundError);
      });

      it("refuses a status move the domain forbids", async () => {
        // uncertain → completed. "We do not know whether the account was
        // created" must not become "it worked".
        await store.start(freshRun(id));
        await store.saveCheckpoint({
          runId: id,
          checkpoint: advanced([]),
          expectedRevision: 0,
          status: "uncertain",
        });
        await expect(
          store.saveCheckpoint({
            runId: id,
            checkpoint: advanced([]),
            expectedRevision: 1,
            status: "completed",
          }),
        ).rejects.toThrow(RunStatusError);
      });
    });

    // ─────────────────────────────────────────────────────────────────────
    // Rule 3, as an executable property
    // ─────────────────────────────────────────────────────────────────────

    describe("a checkpoint is operational state, not a business fact", () => {
      it("LOSING EVERY CHECKPOINT loses no business fact", async () => {
        // ── The most important test in this file ────────────────────────
        //
        // Vahid: *"Deleting all checkpoints must lose no business fact, only
        // operational recovery efficiency. This must be enforced by tests."*
        //
        // After discarding, the run must still know who it belongs to, which
        // case it is executing, and when it started — everything that answers
        // *whose application is this*. What it may lose is *where it had got
        // to*, which is re-derivable from the event log.
        //
        // If someone later stashes a business fact in `detail` to make a
        // resume easier, this is what notices: the fact vanishes here, and the
        // assertions below start mattering.
        await store.start(freshRun(id));
        await store.saveCheckpoint({
          runId: id,
          checkpoint: advanced(["given_name", "family_name", "date_of_birth"]),
          expectedRevision: 0,
        });

        await store.discardCheckpoints(id);

        const after = await store.load(id);
        expect(after).not.toBeNull();
        // Identity survives — this is the business half.
        expect(after?.runId).toBe(id);
        expect(after?.caseId).toBe(CASE);
        expect(after?.studentRef).toBe(STUDENT);
        expect(after?.startedAt.getTime()).toBe(NOW.getTime());
        // Position is gone — this is the operational half, and losing it costs
        // only a re-derivation.
        expect(after?.checkpoint.fieldsCompleted).toEqual([]);
        expect(after?.checkpoint.phase).toBe("preparing_inputs");
      });

      it("keeps intent records after checkpoints are discarded", async () => {
        // An intent record is NOT operational convenience. It is the evidence
        // that a consequential action may have happened, and discarding it
        // would turn a detectable uncertainty into a silent repeat.
        await store.start(freshRun(id));
        const key = idempotencyKeyFor({
          runId: id,
          action: "create_portal_account",
          target: "apply.example.ac.uk",
        });
        await store.recordIntent(id, {
          idempotencyKey: key,
          action: "create_portal_account",
          target: "apply.example.ac.uk",
          startedAt: NOW,
        });

        await store.discardCheckpoints(id);

        expect(await store.findIntent(id, key)).not.toBeNull();
      });
    });

    // ─────────────────────────────────────────────────────────────────────
    // Intent records
    // ─────────────────────────────────────────────────────────────────────

    describe("intent records", () => {
      const target = "apply.example.ac.uk";
      const key = (run: RunId) =>
        idempotencyKeyFor({ runId: run, action: "create_portal_account", target });
      const intent = (run: RunId): ActionIntent => ({
        idempotencyKey: key(run),
        action: "create_portal_account",
        target,
        startedAt: NOW,
      });

      it("returns null for an action nobody started", async () => {
        await store.start(freshRun(id));
        expect(await store.findIntent(id, key(id))).toBeNull();
      });

      it("records an intent, and it reads back UNCOMPLETED", async () => {
        // The uncertain state: started, never recorded as finished.
        await store.start(freshRun(id));
        await store.recordIntent(id, intent(id));

        const found = await store.findIntent(id, key(id));
        expect(found?.intent.action).toBe("create_portal_account");
        expect(found?.completed).toBeUndefined();
      });

      it("records completion", async () => {
        await store.start(freshRun(id));
        await store.recordIntent(id, intent(id));
        await store.completeIntent(id, key(id), "succeeded", NOW);

        const found = await store.findIntent(id, key(id));
        expect(found?.completed?.outcome).toBe("succeeded");
      });

      it("is idempotent for the same completion", async () => {
        // A retry of the RECORDING is fine — it is a retry of the ACTION that
        // must never happen. The two are easy to conflate.
        await store.start(freshRun(id));
        await store.recordIntent(id, intent(id));
        await store.completeIntent(id, key(id), "succeeded", NOW);
        await expect(store.completeIntent(id, key(id), "succeeded", NOW)).resolves.toBeUndefined();
      });

      it("refuses a SECOND intent for the same key", async () => {
        // Two intents for one key would make the record ambiguous, and the
        // record is the only evidence about whether an action happened.
        await store.start(freshRun(id));
        await store.recordIntent(id, intent(id));
        await expect(store.recordIntent(id, intent(id))).rejects.toThrow();
      });

      it("keeps one run's intents out of another's", async () => {
        await store.start(freshRun(id));
        const other = makeRunId(`${id}_other`);
        await store.start({ ...freshRun(other), runId: other });

        await store.recordIntent(id, intent(id));
        expect(await store.findIntent(other, key(other))).toBeNull();
      });
    });
  });
}
