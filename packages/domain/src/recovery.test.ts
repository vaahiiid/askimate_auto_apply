/**
 * Tests for recovery-first escalation (ADR-0008).
 *
 * The specialist is a recovery layer, not the primary operator: the case pauses
 * at the exact point of failure, the specialist unblocks it, and the workflow
 * resumes rather than restarting.
 */

import { describe, expect, it } from "vitest";

import type { CaseEvent, CaseEventPayload, RequestEvidence } from "./events.js";
import {
  blueprintVersion,
  caseId,
  courseId,
  eventId,
  institutionId,
  intake,
  studentId,
  taskId,
} from "./ids.js";
import type { SubmissionIdentity } from "./idempotency.js";
import { decide, fold, openCase } from "./machine.js";
import type { ExecutionCheckpoint, RecoveryEscalation } from "./recovery.js";
import { RECOVERY_REASONS, priorityFor } from "./recovery.js";
import { isBlockedOnHuman, isTerminal } from "./state.js";
import { isTransitionAllowed } from "./transitions.js";

const CASE = caseId("case_001");

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

const CHECKPOINT: ExecutionCheckpoint = {
  blueprintVersion: blueprintVersion("leeds-direct-v3"),
  action: "advance_portal_page",
  target: "funding",
  page: "funding",
  phase: "filling",
  pagesCompleted: ["personal-details", "previous-education", "english-language"],
  capturedAt: new Date("2026-08-26T14:00:00Z"),
};

const ESCALATION: RecoveryEscalation = {
  reason: "unfamiliar_validation_error",
  priority: "high",
  encountered: 'Portal rejected the funding amount with "Value must match declared currency".',
  expected: "The blueprint expected a plain numeric field with no currency constraint.",
  checkpoint: CHECKPOINT,
  raisedAt: new Date("2026-08-26T14:00:00Z"),
};

function buildLog(payloads: readonly CaseEventPayload[]): CaseEvent[] {
  return payloads.map((payload, index) => ({
    ...payload,
    eventId: eventId(`evt_${String(index + 1).padStart(4, "0")}`),
    caseId: CASE,
    sequence: index + 1,
    occurredAt: new Date(Date.UTC(2026, 7, 26, 10, 15 + index)),
    actor: { kind: "system", component: "orchestrator-worker" },
  }));
}

const OPENED = openCase({ submissionIdentity: IDENTITY, requestEvidence: EVIDENCE });

/** A case that has reached PREPARING with real progress behind it. */
const PREPARING_LOG: readonly CaseEventPayload[] = [
  OPENED,
  { type: "CaseStateChanged", from: "INTAKE", to: "READY_TO_PREPARE", reason: "x" },
  { type: "CaseStateChanged", from: "READY_TO_PREPARE", to: "PREPARING", reason: "x" },
];

describe("pausing at the point of failure", () => {
  it("pauses rather than failing the application", () => {
    const preparing = fold(buildLog(PREPARING_LOG));
    const decision = decide(preparing, { kind: "escalate_for_recovery", escalation: ESCALATION });

    expect(decision.accepted).toBe(true);
    if (decision.accepted) {
      expect(decision.events[0]?.type).toBe("RecoveryEscalationRaised");
      const moved = decision.events[1];
      if (moved?.type === "CaseStateChanged") {
        expect(moved.to).toBe("AWAITING_SPECIALIST_RECOVERY");
        // The reason a specialist sees in the queue names the exact spot — in
        // the vocabulary this system actually has: which action, against what.
        // It used to name a page/section/step, two of which nothing could fill
        // truthfully (see `ExecutionCheckpoint`).
        expect(moved.reason).toContain("advance_portal_page");
        expect(moved.reason).toContain("funding");
        expect(moved.reason).toContain("high");
      }
    }
  });

  it("is not a terminal state — the case is paused, not lost", () => {
    expect(isTerminal("AWAITING_SPECIALIST_RECOVERY")).toBe(false);
  });

  it("counts as blocked on a human, not as system throughput", () => {
    expect(isBlockedOnHuman("AWAITING_SPECIALIST_RECOVERY")).toBe(true);
  });

  it("preserves everything the AI had already completed", () => {
    const paused = fold(
      buildLog([...PREPARING_LOG, { type: "RecoveryEscalationRaised", escalation: ESCALATION }]),
    );

    expect(paused.openEscalation).toBeDefined();
    expect(paused.openEscalation?.checkpoint.pagesCompleted).toEqual([
      "personal-details",
      "previous-education",
      "english-language",
    ]);
  });

  it("survives a worker restart with the checkpoint intact", () => {
    // A specialist opening the case an hour later, or a restarted worker, sees
    // exactly where it stopped — derived from the log, not from memory.
    const log = buildLog([
      ...PREPARING_LOG,
      { type: "RecoveryEscalationRaised", escalation: ESCALATION },
      { type: "CaseStateChanged", from: "PREPARING", to: "AWAITING_SPECIALIST_RECOVERY", reason: "Paused." },
    ]);

    expect(fold(log)).toEqual(fold(log));
    expect(fold(log).openEscalation?.checkpoint.target).toBe("funding");
    expect(fold(log).openEscalation?.checkpoint.action).toBe("advance_portal_page");
  });

  it("can be reached from every execution state", () => {
    // A failure can happen anywhere, so pausing must be available anywhere.
    for (const from of ["PREPARING", "VALIDATION_FAILED", "AWAITING_HANDOFF", "SUBMITTING", "AWAITING_STUDENT_AUTHORISATION"] as const) {
      expect(isTransitionAllowed(from, "AWAITING_SPECIALIST_RECOVERY")).toBe(true);
    }
  });
});

describe("resuming, not restarting", () => {
  const PAUSED_LOG: readonly CaseEventPayload[] = [
    ...PREPARING_LOG,
    { type: "RecoveryEscalationRaised", escalation: ESCALATION },
    { type: "CaseStateChanged", from: "PREPARING", to: "AWAITING_SPECIALIST_RECOVERY", reason: "Paused." },
  ];

  it("resumes into the state the specialist chose", () => {
    const paused = fold(buildLog(PAUSED_LOG));
    const decision = decide(paused, {
      kind: "resolve_recovery",
      resumeTo: "PREPARING",
      resolution: {
        specialistId: "specialist_amara",
        actionsTaken: "Set the currency dropdown to GBP before entering the amount.",
        resolution: "Currency must be selected before the amount field accepts input.",
        resolvedAt: new Date("2026-08-26T14:25:00Z"),
        outcome: "resume",
      },
    });

    expect(decision.accepted).toBe(true);
    if (decision.accepted) {
      expect(decision.events[0]?.type).toBe("RecoveryResolved");
      const moved = decision.events[1];
      if (moved?.type === "CaseStateChanged") {
        expect(moved.to).toBe("PREPARING");
        // The audit trail names WHO and WHAT THEY DECIDED — and deliberately
        // no position, because a resolution holds none (ADR-0048 §5).
        expect(moved.reason).toContain("specialist_amara");
        expect(moved.reason).toContain("resume");
      }
    }
  });

  it("does NOT send the case back to the beginning", () => {
    const paused = fold(buildLog(PAUSED_LOG));
    const decision = decide(paused, {
      kind: "resolve_recovery",
      resumeTo: "PREPARING",
      resolution: {
        specialistId: "specialist_amara",
        actionsTaken: "Unblocked.",
        resolution: "Fixed.",
        resolvedAt: new Date("2026-08-26T14:25:00Z"),
        outcome: "resume",
      },
    });

    if (decision.accepted) {
      const moved = decision.events[1];
      if (moved?.type === "CaseStateChanged") {
        // Not INTAKE, not READY_TO_PREPARE — back to where it was working.
        expect(moved.to).not.toBe("INTAKE");
        expect(moved.to).toBe("PREPARING");
      }
    }
  });

  it("clears the open escalation once resolved", () => {
    const resolved = fold(
      buildLog([
        ...PAUSED_LOG,
        {
          type: "RecoveryResolved",
          resolution: {
            specialistId: "specialist_amara",
            actionsTaken: "Unblocked.",
            resolution: "Fixed.",
            resolvedAt: new Date("2026-08-26T14:25:00Z"),
            outcome: "resume",
          },
        },
      ]),
    );

    expect(resolved.openEscalation).toBeUndefined();
  });

  it("refuses to resolve a case that is not paused", () => {
    const preparing = fold(buildLog(PREPARING_LOG));
    const decision = decide(preparing, {
      kind: "resolve_recovery",
      resumeTo: "PREPARING",
      resolution: {
        specialistId: "specialist_amara",
        actionsTaken: "x",
        resolution: "x",
        resolvedAt: new Date(),
        outcome: "resume",
      },
    });

    expect(decision.accepted).toBe(false);
  });

  it("does NOT let recovery override a mandatory human review", () => {
    // Recovery unblocks; it is not an override. A specialist resolving a
    // portal problem cannot push the case past an unreviewed bank statement.
    const paused = fold(
      buildLog([
        ...PREPARING_LOG,
        { type: "HumanReviewRequested", triggers: ["financial_evidence"], mandatory: true },
        { type: "RecoveryEscalationRaised", escalation: ESCALATION },
        { type: "CaseStateChanged", from: "PREPARING", to: "AWAITING_SPECIALIST_RECOVERY", reason: "Paused." },
      ]),
    );

    const decision = decide(paused, {
      kind: "resolve_recovery",
      resumeTo: "AWAITING_STUDENT_AUTHORISATION",
      resolution: {
        specialistId: "specialist_amara",
        actionsTaken: "Unblocked the portal issue.",
        resolution: "Fixed.",
        resolvedAt: new Date("2026-08-26T14:25:00Z"),
        outcome: "resume",
      },
    });

    expect(decision.accepted).toBe(false);
    if (!decision.accepted && decision.refusal.kind === "transition_refused") {
      expect(decision.refusal.refusal.kind).toBe("mandatory_review_outstanding");
    }
  });

  it("allows route fallback as a last resort", () => {
    // When the specialist judges the automated route unworkable for this case.
    expect(isTransitionAllowed("AWAITING_SPECIALIST_RECOVERY", "ROUTE_FALLBACK")).toBe(true);
  });
});

describe("alerting priority", () => {
  it("treats recovery as high priority by default", () => {
    // A paused application is consuming a deadline, and deadlines do not move.
    expect(priorityFor("unexpected_field")).toBe("high");
    expect(priorityFor("page_structure_changed")).toBe("high");
    expect(priorityFor("ambiguous_mapping")).toBe("high");
  });

  it("treats authentication failure as critical", () => {
    expect(priorityFor("authentication_failure")).toBe("critical");
  });

  it("assigns a priority to every reason", () => {
    for (const reason of RECOVERY_REASONS) {
      expect(["high", "critical"]).toContain(priorityFor(reason));
    }
  });

  it("covers the situations the requirement names", () => {
    // Vahid's list, kept in his words so the mapping stays checkable.
    for (const reason of [
      "unexpected_field",
      "page_structure_changed",
      "unfamiliar_validation_error",
      "new_portal_behaviour",
      "ambiguous_mapping",
      "workflow_deviation",
    ] as const) {
      expect(RECOVERY_REASONS).toContain(reason);
    }
  });
});

describe("the case is never handed back to the student", () => {
  it("keeps recovery with a specialist, never raising a student task", () => {
    // ADR-0007 reaffirmed: if human intervention is required, the AskiMate
    // specialist is the recovery layer — automation failure must never turn
    // into "here, fill in the rest yourself".
    const preparing = fold(buildLog(PREPARING_LOG));
    const decision = decide(preparing, { kind: "escalate_for_recovery", escalation: ESCALATION });

    expect(decision.accepted).toBe(true);
    if (decision.accepted) {
      const raisedStudentTask = decision.events.some(
        (event) => event.type === "TaskRaised" && event.taskKind === "provide_profile_field",
      );
      expect(raisedStudentTask).toBe(false);
    }
  });

  it("still allows a genuine handoff, which is not form-filling", () => {
    // MFA, OTP, CAPTCHA and payment remain the student's, per brief §7.
    expect(isTransitionAllowed("AWAITING_SPECIALIST_RECOVERY", "AWAITING_HANDOFF")).toBe(true);
    expect(taskId("tsk_1")).toBe("tsk_1");
  });
});
