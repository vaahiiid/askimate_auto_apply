/**
 * The shared InterventionStore contract.
 *
 * Every implementation must pass this, exactly as `contract.ts` does for
 * `CaseStore` and `workflow-contract.ts` for `WorkflowRunStore`. The assertions
 * are about *domain-level behaviour and error semantics*, not merely about the
 * database refusing an invalid state — because half of what matters here is
 * what the caller is told, and a store that refused correctly while reporting
 * the wrong thing would leave the driver unable to act.
 *
 * ── The two most important tests in this file ────────────────────────────
 *
 * `"raising the same stuck action twice yields one intervention"` — a run is
 * polled repeatedly, so a raise that was not idempotent would fill a
 * specialist's queue with copies of one problem and make "how many things are
 * wrong?" unanswerable.
 *
 * `"a second resolution does not overwrite the first"` — two specialists
 * disagreeing about whether an account exists is exactly the case where
 * silently keeping the later answer destroys the evidence that there was a
 * disagreement at all.
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  blueprintVersion,
  caseId as makeCaseId,
  idempotencyKeyFor,
  interventionId as makeInterventionId,
  priorityFor,
  runId as makeRunId,
} from "@askimate/aas-domain";
import type {
  InterventionContext,
  RecoveryEscalation,
  RecoveryResolution,
  ReusabilityAssessment,
  RunId,
} from "@askimate/aas-domain";

import type { InterventionStore, RaiseInput } from "./intervention-store.js";
import {
  InterventionAlreadyResolvedError,
  InterventionNotFoundError,
  ResolutionOutcomeNotImplementedError,
} from "./intervention-store.js";

const NOW = new Date("2026-09-01T10:00:00Z");
const LATER = new Date("2026-09-01T11:30:00Z");

const RUN = makeRunId("run_stuck");
const KEY = idempotencyKeyFor({
  runId: RUN,
  action: "create_portal_account",
  target: "apply.example.ac.uk",
});

function escalation(): RecoveryEscalation {
  return {
    reason: "unverified_consequential_action",
    priority: priorityFor("unverified_consequential_action"),
    encountered: "An account creation was started against apply.example.ac.uk and never finished.",
    expected: "A completion recorded against the intent, one way or the other.",
    checkpoint: {
      blueprintVersion: blueprintVersion("example-v1"),
      action: "create_portal_account",
      target: "apply.example.ac.uk",
      phase: "creating_account",
      pagesCompleted: [],
      capturedAt: NOW,
    },
    raisedAt: NOW,
  };
}

function context(): InterventionContext {
  return {
    institutionId: "inst_example" as InterventionContext["institutionId"],
    portal: "apply.example.ac.uk",
    courseId: "crs_example" as InterventionContext["courseId"],
    blueprintVersion: blueprintVersion("example-v1"),
  };
}

function raiseInput(overrides: Partial<RaiseInput> = {}): RaiseInput {
  return {
    interventionId: makeInterventionId("iv_one"),
    runId: RUN,
    idempotencyKey: KEY,
    caseId: makeCaseId("case_one"),
    studentRef: "student-1",
    escalation: escalation(),
    context: context(),
    ...overrides,
  };
}

function resolution(overrides: Partial<RecoveryResolution> = {}): RecoveryResolution {
  return {
    specialistId: "specialist_vahid",
    actionsTaken: "Signed in to the portal and confirmed no account exists for that address.",
    resolution: "The submit never reached the portal; the creation may be attempted again.",
    resolvedAt: LATER,
    outcome: "resume",
    ...overrides,
  };
}

const REUSABILITY: ReusabilityAssessment = {
  scope: "this_case_only",
  kind: "guidance",
  signature: "example:account-creation:timed-out-before-submit",
};

/**
 * @param makeStore builds an EMPTY store, plus whatever the adapter needs for
 *   a run to exist — the Postgres one has a foreign key to `workflow_runs`, so
 *   it cannot record an intervention for a run that was never started.
 */
export function runInterventionStoreContract(
  name: string,
  makeStore: () => Promise<{ store: InterventionStore; runId: RunId }>,
): void {
  describe(`InterventionStore contract: ${name}`, () => {
    let store: InterventionStore;
    let runId: RunId;

    beforeEach(async () => {
      const made = await makeStore();
      store = made.store;
      runId = made.runId;
    });

    const forThisRun = (overrides: Partial<RaiseInput> = {}): RaiseInput =>
      raiseInput({
        runId,
        idempotencyKey: idempotencyKeyFor({
          runId,
          action: "create_portal_account",
          target: "apply.example.ac.uk",
        }),
        ...overrides,
      });

    it("records an escalation and reports that it created one", async () => {
      const raised = await store.raise(forThisRun());
      expect(raised.created).toBe(true);
      const found = await store.find(raised.interventionId);
      expect(found?.escalation.reason).toBe("unverified_consequential_action");
      expect(found?.escalation.priority).toBe("critical");
      expect(found?.resolution).toBeUndefined();
    });

    it("raising the same stuck action twice yields ONE intervention", async () => {
      // A run is polled repeatedly. Without this, one stuck account creation
      // becomes a queue of identical cases and nobody can say how many things
      // are actually wrong.
      const first = await store.raise(forThisRun());
      const second = await store.raise(
        forThisRun({ interventionId: makeInterventionId("iv_different_id") }),
      );

      expect(second.created).toBe(false);
      expect(second.interventionId).toBe(first.interventionId);
      expect(await store.open()).toHaveLength(1);
    });

    it("a DIFFERENT stuck action on the same run is its own intervention", async () => {
      await store.raise(forThisRun());
      const other = await store.raise(
        forThisRun({
          interventionId: makeInterventionId("iv_two"),
          idempotencyKey: idempotencyKeyFor({
            runId,
            action: "advance_portal_page",
            target: "study",
          }),
        }),
      );

      expect(other.created).toBe(true);
      expect(await store.open()).toHaveLength(2);
    });

    it("finds the open intervention for one stuck action", async () => {
      const raised = await store.raise(forThisRun());
      const found = await store.findForAction(runId, forThisRun().idempotencyKey);
      expect(found?.interventionId).toBe(raised.interventionId);
    });

    it("dates survive the round trip as Dates", async () => {
      // JSONB returns a string where a Date belongs, and the compiler cannot
      // see it. That exact bug reached runtime once already, in P8's stored
      // provenance, so it is asserted rather than assumed.
      const raised = await store.raise(forThisRun());
      const found = await store.find(raised.interventionId);
      expect(found?.escalation.raisedAt).toBeInstanceOf(Date);
      expect(found?.escalation.checkpoint.capturedAt).toBeInstanceOf(Date);
      expect(found?.escalation.checkpoint.capturedAt.getTime()).toBe(NOW.getTime());
    });

    it("marks the student as told, once, and never moves the timestamp", async () => {
      const raised = await store.raise(forThisRun());
      expect((await store.find(raised.interventionId))?.announcedAt).toBeUndefined();

      await store.markAnnounced(raised.interventionId, NOW);
      await store.markAnnounced(raised.interventionId, LATER);

      const found = await store.find(raised.interventionId);
      expect(found?.announcedAt?.getTime()).toBe(NOW.getTime());
    });

    it("records a resolution and closes the intervention", async () => {
      const raised = await store.raise(forThisRun());
      const resolved = await store.resolve({
        interventionId: raised.interventionId,
        resolution: resolution(),
        reusability: REUSABILITY,
      });

      expect(resolved.resolution?.specialistId).toBe("specialist_vahid");
      expect(resolved.resolution?.outcome).toBe("resume");
      expect(resolved.resolution?.resolvedAt).toBeInstanceOf(Date);
      expect(await store.open()).toHaveLength(0);
    });

    it("a second resolution does NOT overwrite the first", async () => {
      const raised = await store.raise(forThisRun());
      await store.resolve({
        interventionId: raised.interventionId,
        resolution: resolution(),
        reusability: REUSABILITY,
      });

      await expect(
        store.resolve({
          interventionId: raised.interventionId,
          resolution: resolution({ specialistId: "specialist_other", outcome: "abandon" }),
          reusability: REUSABILITY,
        }),
      ).rejects.toThrow(InterventionAlreadyResolvedError);

      // And the first one is intact, which is the part that matters: two
      // specialists disagreeing is evidence, not noise to be tidied away.
      const found = await store.find(raised.interventionId);
      expect(found?.resolution?.specialistId).toBe("specialist_vahid");
      expect(found?.resolution?.outcome).toBe("resume");
    });

    it("REFUSES route_fallback rather than half-honouring it", async () => {
      // ADR-0048 §4: rejected explicitly, not partially implemented. A route
      // change needs its own decision and its own machinery.
      const raised = await store.raise(forThisRun());
      await expect(
        store.resolve({
          interventionId: raised.interventionId,
          resolution: resolution({ outcome: "route_fallback" }),
          reusability: REUSABILITY,
        }),
      ).rejects.toThrow(ResolutionOutcomeNotImplementedError);

      // Refused means UNCHANGED, not partly applied.
      const found = await store.find(raised.interventionId);
      expect(found?.resolution).toBeUndefined();
      expect(await store.open()).toHaveLength(1);
    });

    it("accepts abandon", async () => {
      const raised = await store.raise(forThisRun());
      const resolved = await store.resolve({
        interventionId: raised.interventionId,
        resolution: resolution({ outcome: "abandon" }),
        reusability: REUSABILITY,
      });
      expect(resolved.resolution?.outcome).toBe("abandon");
    });

    it("refuses to resolve an intervention that does not exist", async () => {
      await expect(
        store.resolve({
          interventionId: makeInterventionId("iv_nope"),
          resolution: resolution(),
          reusability: REUSABILITY,
        }),
      ).rejects.toThrow(InterventionNotFoundError);
    });

    it("holds NO position — the resolution carries nothing to resume from", async () => {
      // ADR-0048 §5, asserted by enumeration rather than by comment. The
      // compiler already refuses a typed position on `RecoveryResolution`;
      // this catches one smuggled in as a string or a loose object by a store
      // that stopped agreeing with the domain.
      const raised = await store.raise(forThisRun());
      await store.resolve({
        interventionId: raised.interventionId,
        resolution: resolution(),
        reusability: REUSABILITY,
      });
      const found = await store.find(raised.interventionId);
      const fields = Object.keys(found?.resolution ?? {});

      expect(fields.sort()).toEqual(
        ["actionsTaken", "outcome", "resolution", "resolvedAt", "specialistId"].sort(),
      );
      for (const forbidden of ["resumeFrom", "resumeTo", "checkpoint", "cursor", "position"]) {
        expect(fields, `a resolution must carry no position, found ${forbidden}`).not.toContain(
          forbidden,
        );
      }
    });
  });
}
