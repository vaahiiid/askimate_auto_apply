/**
 * Tests for the state machine: `fold` (derive) and `decide` (propose).
 *
 * Covers the failure scenarios brief §10 requires that are expressible in the
 * domain core: missing document, conflicting information, timeout and retry,
 * duplicate submission attempt, partial submission, and recovery after a worker
 * crash mid-run.
 *
 * Authentication failure, portal layout change and stale requirement data are
 * partly domain-level (blueprint drift, review triggers) and partly Phase 3/4
 * concerns; the domain-level halves are covered here.
 */

import { describe, expect, it } from "vitest";

import type { CaseEvent, CaseEventPayload, RequestEvidence } from "./events.js";
import { caseId, courseId, eventId, externalRef, institutionId, intake, studentId, taskId } from "./ids.js";
import type { SubmissionIdentity } from "./idempotency.js";
import type { ApplicationCase, CaseIntent } from "./machine.js";
import { MalformedEventLogError, askimateActor, decide, fold, openCase, stamp } from "./machine.js";

const CASE = caseId("case_001");
const ACTOR = askimateActor(externalRef("askimate:user:4812"));

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
  conversationRef: externalRef("askimate:conversation:9931"),
  studentStatement: "Yes, please apply to Leeds for me.",
};

/** Builds a log by stamping payloads in order, as the orchestrator would. */
function buildLog(payloads: readonly CaseEventPayload[], startAt = new Date("2026-08-26T10:15:00Z")): CaseEvent[] {
  return payloads.map((payload, index) => ({
    ...payload,
    eventId: eventId(`evt_${String(index + 1).padStart(4, "0")}`),
    caseId: CASE,
    sequence: index + 1,
    occurredAt: new Date(startAt.getTime() + index * 60_000),
    actor: ACTOR,
  }));
}

const OPENED = openCase({ submissionIdentity: IDENTITY, requestEvidence: EVIDENCE });

/** A case that has been prepared, reviewed where needed, and authorised. */
function authorisedCase(hash = "sha256:content-v1"): ApplicationCase {
  return fold(
    buildLog([
      OPENED,
      { type: "CaseStateChanged", from: "INTAKE", to: "REQUIREMENTS_RESOLUTION", reason: "Gathering requirements." },
      { type: "CaseStateChanged", from: "REQUIREMENTS_RESOLUTION", to: "ELIGIBILITY_REVIEW", reason: "Requirements resolved." },
      { type: "CaseStateChanged", from: "ELIGIBILITY_REVIEW", to: "READY_TO_PREPARE", reason: "Eligible." },
      { type: "CaseStateChanged", from: "READY_TO_PREPARE", to: "PREPARING", reason: "Filling." },
      { type: "CaseStateChanged", from: "PREPARING", to: "AWAITING_STUDENT_AUTHORISATION", reason: "Rendered for review." },
      { type: "AuthorisationCaptured", contentHash: hash, hashAlgorithm: "sha256", authorisedAt: new Date("2026-08-26T11:00:00Z") },
      { type: "CaseStateChanged", from: "AWAITING_STUDENT_AUTHORISATION", to: "AUTHORISED", reason: "Student authorised." },
    ]),
  );
}

describe("fold — deriving a case from its log", () => {
  it("derives the opening state", () => {
    const derived = fold(buildLog([OPENED]));

    expect(derived.caseId).toBe(CASE);
    expect(derived.state).toBe("INTAKE");
    expect(derived.sequence).toBe(1);
    expect(derived.submissionIdentity.attemptOrdinal).toBe(1);
  });

  it("preserves the student's own words as the reason the case exists", () => {
    // Product rule 1: a case cannot exist without evidence a student asked.
    const derived = fold(buildLog([OPENED]));
    expect(derived.requestEvidence.studentStatement).toBe("Yes, please apply to Leeds for me.");
    expect(derived.requestEvidence.channel).toBe("askimate_chat");
  });

  it("rejects an empty log", () => {
    expect(() => fold([])).toThrow(MalformedEventLogError);
  });

  it("rejects a log that does not begin with CaseOpened", () => {
    const bad = buildLog([{ type: "CaseCancelled", reason: "nope" }]);
    expect(() => fold(bad)).toThrow(MalformedEventLogError);
  });

  it("rejects a log with a sequence gap", () => {
    // A gap means events were lost. Deriving state from a partial log would
    // silently produce a wrong answer, so we refuse loudly instead.
    const log = buildLog([OPENED, { type: "CaseStateChanged", from: "INTAKE", to: "DOCUMENTS_PENDING", reason: "x" }]);
    const second = log[1];
    if (second === undefined) throw new Error("fixture");
    const gapped: CaseEvent[] = [log[0] as CaseEvent, { ...second, sequence: 5 }];

    expect(() => fold(gapped)).toThrow(/sequence gap/i);
  });

  it("tracks open and completed tasks", () => {
    const derived = fold(
      buildLog([
        OPENED,
        { type: "TaskRaised", taskId: taskId("tsk_1"), taskKind: "provide_document", description: "Passport", blocksProgress: true },
        { type: "TaskRaised", taskId: taskId("tsk_2"), taskKind: "provide_profile_field", description: "DOB", blocksProgress: true },
        { type: "TaskCompleted", taskId: taskId("tsk_1"), outcome: "done" },
      ]),
    );

    expect(derived.tasks).toHaveLength(2);
    expect(derived.tasks.find((t) => t.taskId === "tsk_1")?.status).toBe("done");
    expect(derived.tasks.find((t) => t.taskId === "tsk_2")?.status).toBe("open");
  });

  it("clears a review trigger only on approval", () => {
    const derived = fold(
      buildLog([
        OPENED,
        { type: "HumanReviewRequested", triggers: ["financial_evidence"], mandatory: true },
        {
          type: "HumanReviewCompleted",
          review: { reviewerId: "spec_1", reviewedAt: new Date(), triggers: ["financial_evidence"], outcome: "changes_requested" },
        },
      ]),
    );

    expect(derived.activeTriggers).toContain("financial_evidence");
    expect(derived.completedReviews).toHaveLength(1);
  });

  it("voids an authorisation when the log says so", () => {
    const derived = fold(
      buildLog([
        OPENED,
        { type: "AuthorisationCaptured", contentHash: "sha256:v1", hashAlgorithm: "sha256", authorisedAt: new Date() },
        { type: "AuthorisationVoided", previousContentHash: "sha256:v1", reason: "content_changed" },
      ]),
    );

    expect(derived.authorisedContentHash).toBeUndefined();
  });

  it("tracks an open handoff and clears it on completion", () => {
    const withHandoff = fold(
      buildLog([
        OPENED,
        { type: "HandoffRequired", handoffKind: "mfa", handoffToken: "ho_abc", expiresAt: new Date("2026-08-26T12:00:00Z") },
      ]),
    );
    expect(withHandoff.openHandoffToken).toBe("ho_abc");

    const resumed = fold(
      buildLog([
        OPENED,
        { type: "HandoffRequired", handoffKind: "mfa", handoffToken: "ho_abc", expiresAt: new Date("2026-08-26T12:00:00Z") },
        { type: "HandoffCompleted", handoffToken: "ho_abc", handoffKind: "mfa" },
      ]),
    );
    expect(resumed.openHandoffToken).toBeUndefined();
  });

  it("is deterministic — folding twice gives the same result", () => {
    const log = buildLog([OPENED, { type: "CaseStateChanged", from: "INTAKE", to: "DOCUMENTS_PENDING", reason: "x" }]);
    expect(fold(log)).toEqual(fold(log));
  });
});

describe("FAILURE SCENARIO — recovery after a worker crash mid-run (brief §10)", () => {
  it("reconstructs identical state from the log after a crash", () => {
    // A worker dies partway through. A new worker picks the case up with
    // nothing but the event log — no in-memory state, no checkpoint file.
    const log = buildLog([
      OPENED,
      { type: "CaseStateChanged", from: "INTAKE", to: "REQUIREMENTS_RESOLUTION", reason: "Gathering." },
      { type: "TaskRaised", taskId: taskId("tsk_1"), taskKind: "provide_document", description: "Bank statement", blocksProgress: true },
      { type: "HumanReviewRequested", triggers: ["financial_evidence"], mandatory: true },
      // ← worker crashes here
    ]);

    const beforeCrash = fold(log);
    const afterRestart = fold(log); // fresh process, same log

    expect(afterRestart).toEqual(beforeCrash);
    expect(afterRestart.state).toBe("REQUIREMENTS_RESOLUTION");
    expect(afterRestart.activeTriggers).toContain("financial_evidence");
    expect(afterRestart.tasks.filter((t) => t.status === "open")).toHaveLength(1);
  });

  it("resumes correctly when the crash happened mid-submission", () => {
    // FAILURE SCENARIO: partial submission. The case recorded an attempt but
    // never a result. The restarted worker must see the attempt and refuse to
    // start a second one.
    const log = buildLog([
      OPENED,
      { type: "CaseStateChanged", from: "INTAKE", to: "REQUIREMENTS_RESOLUTION", reason: "x" },
      { type: "CaseStateChanged", from: "REQUIREMENTS_RESOLUTION", to: "ELIGIBILITY_REVIEW", reason: "x" },
      { type: "CaseStateChanged", from: "ELIGIBILITY_REVIEW", to: "READY_TO_PREPARE", reason: "x" },
      { type: "CaseStateChanged", from: "READY_TO_PREPARE", to: "PREPARING", reason: "x" },
      { type: "CaseStateChanged", from: "PREPARING", to: "AWAITING_STUDENT_AUTHORISATION", reason: "x" },
      { type: "AuthorisationCaptured", contentHash: "sha256:v1", hashAlgorithm: "sha256", authorisedAt: new Date() },
      { type: "CaseStateChanged", from: "AWAITING_STUDENT_AUTHORISATION", to: "AUTHORISED", reason: "x" },
      { type: "CaseStateChanged", from: "AUTHORISED", to: "SUBMITTING", reason: "x" },
      { type: "SubmissionAttempted", submissionIdentity: IDENTITY, authorisedContentHash: "sha256:v1" },
      // ← crash. Did it reach the university? We do not know.
    ]);

    const recovered = fold(log);
    expect(recovered.state).toBe("SUBMITTING");
    expect(recovered.submissionAttempted).toBe(true);

    // The restarted worker must NOT submit again.
    const retry = decide(recovered, { kind: "attempt_submission" });
    expect(retry.accepted).toBe(false);
    if (!retry.accepted) expect(retry.refusal.kind).toBe("duplicate_submission");
  });
});

describe("FAILURE SCENARIO — duplicate submission (brief §4, §10)", () => {
  it("refuses a second submission attempt on the same identity", () => {
    const authorised = authorisedCase();

    const first = decide(authorised, { kind: "attempt_submission" });
    expect(first.accepted).toBe(true);

    const afterAttempt = fold([
      ...buildLog([
        OPENED,
        { type: "CaseStateChanged", from: "INTAKE", to: "REQUIREMENTS_RESOLUTION", reason: "x" },
        { type: "CaseStateChanged", from: "REQUIREMENTS_RESOLUTION", to: "ELIGIBILITY_REVIEW", reason: "x" },
        { type: "CaseStateChanged", from: "ELIGIBILITY_REVIEW", to: "READY_TO_PREPARE", reason: "x" },
        { type: "CaseStateChanged", from: "READY_TO_PREPARE", to: "PREPARING", reason: "x" },
        { type: "CaseStateChanged", from: "PREPARING", to: "AWAITING_STUDENT_AUTHORISATION", reason: "x" },
        { type: "AuthorisationCaptured", contentHash: "sha256:content-v1", hashAlgorithm: "sha256", authorisedAt: new Date() },
        { type: "CaseStateChanged", from: "AWAITING_STUDENT_AUTHORISATION", to: "AUTHORISED", reason: "x" },
        { type: "CaseStateChanged", from: "AUTHORISED", to: "SUBMITTING", reason: "x" },
        { type: "SubmissionAttempted", submissionIdentity: IDENTITY, authorisedContentHash: "sha256:content-v1" },
      ]),
    ]);

    const second = decide(afterAttempt, { kind: "attempt_submission" });
    expect(second.accepted).toBe(false);
    if (!second.accepted && second.refusal.kind === "duplicate_submission") {
      expect(second.refusal.detail).toContain("explicit student instruction");
    } else {
      expect.unreachable("a second submission attempt must be refused as a duplicate");
    }
  });

  it("refuses submission that was never authorised", () => {
    const prepared = fold(
      buildLog([
        OPENED,
        { type: "CaseStateChanged", from: "INTAKE", to: "REQUIREMENTS_RESOLUTION", reason: "x" },
        { type: "CaseStateChanged", from: "REQUIREMENTS_RESOLUTION", to: "ELIGIBILITY_REVIEW", reason: "x" },
        { type: "CaseStateChanged", from: "ELIGIBILITY_REVIEW", to: "READY_TO_PREPARE", reason: "x" },
        { type: "CaseStateChanged", from: "READY_TO_PREPARE", to: "PREPARING", reason: "x" },
      ]),
    );

    const decision = decide(prepared, { kind: "attempt_submission" });
    expect(decision.accepted).toBe(false);
  });

  it("refuses submission when content changed after authorisation", () => {
    const authorised = authorisedCase("sha256:content-v1");
    const drifted: ApplicationCase = { ...authorised, preparedContentHash: "sha256:content-v2" };

    const decision = decide(drifted, { kind: "attempt_submission" });
    expect(decision.accepted).toBe(false);
    if (!decision.accepted && decision.refusal.kind === "transition_refused") {
      expect(decision.refusal.refusal.kind).toBe("authorisation_stale");
    }
  });
});

describe("FAILURE SCENARIO — missing document blocks progress (brief §10)", () => {
  it("refuses to move into preparation while a blocking task is open", () => {
    const blocked = fold(
      buildLog([
        OPENED,
        { type: "CaseStateChanged", from: "INTAKE", to: "DOCUMENTS_PENDING", reason: "Need a passport." },
        { type: "TaskRaised", taskId: taskId("tsk_1"), taskKind: "provide_document", description: "Passport", blocksProgress: true },
        { type: "CaseStateChanged", from: "DOCUMENTS_PENDING", to: "REQUIREMENTS_RESOLUTION", reason: "x" },
        { type: "CaseStateChanged", from: "REQUIREMENTS_RESOLUTION", to: "ELIGIBILITY_REVIEW", reason: "x" },
        { type: "CaseStateChanged", from: "ELIGIBILITY_REVIEW", to: "READY_TO_PREPARE", reason: "x" },
      ]),
    );

    const decision = decide(blocked, { kind: "transition", to: "PREPARING", reason: "Try to fill anyway." });

    expect(decision.accepted).toBe(false);
    if (!decision.accepted && decision.refusal.kind === "blocked_by_tasks") {
      expect(decision.refusal.taskIds).toEqual(["tsk_1"]);
    }
  });

  it("still allows moving BACK to collect what is missing", () => {
    // A blocked case must be able to unblock itself, or it would be stranded.
    const blocked = fold(
      buildLog([
        OPENED,
        { type: "CaseStateChanged", from: "INTAKE", to: "REQUIREMENTS_RESOLUTION", reason: "x" },
        { type: "CaseStateChanged", from: "REQUIREMENTS_RESOLUTION", to: "ELIGIBILITY_REVIEW", reason: "x" },
        { type: "CaseStateChanged", from: "ELIGIBILITY_REVIEW", to: "READY_TO_PREPARE", reason: "x" },
        { type: "TaskRaised", taskId: taskId("tsk_1"), taskKind: "provide_document", description: "Passport", blocksProgress: true },
      ]),
    );

    const decision = decide(blocked, { kind: "transition", to: "DOCUMENTS_PENDING", reason: "Ask the student." });
    expect(decision.accepted).toBe(true);
  });

  it("allows cancellation even while blocked", () => {
    const blocked = fold(
      buildLog([
        OPENED,
        { type: "TaskRaised", taskId: taskId("tsk_1"), taskKind: "provide_document", description: "Passport", blocksProgress: true },
      ]),
    );

    expect(decide(blocked, { kind: "transition", to: "CANCELLED", reason: "Student stopped." }).accepted).toBe(true);
  });

  it("does not block on a non-blocking task", () => {
    const withNonBlocking = fold(
      buildLog([
        OPENED,
        { type: "CaseStateChanged", from: "INTAKE", to: "REQUIREMENTS_RESOLUTION", reason: "x" },
        { type: "CaseStateChanged", from: "REQUIREMENTS_RESOLUTION", to: "ELIGIBILITY_REVIEW", reason: "x" },
        { type: "CaseStateChanged", from: "ELIGIBILITY_REVIEW", to: "READY_TO_PREPARE", reason: "x" },
        { type: "TaskRaised", taskId: taskId("tsk_1"), taskKind: "revalidate_requirement", description: "Refresh", blocksProgress: false },
      ]),
    );

    expect(decide(withNonBlocking, { kind: "transition", to: "PREPARING", reason: "Fill." }).accepted).toBe(true);
  });
});

describe("FAILURE SCENARIO — conflicting information and stale data (brief §10)", () => {
  it("routes conflicting information to a human review", () => {
    const derived = fold(buildLog([OPENED]));
    const decision = decide(derived, { kind: "request_human_review", triggers: ["conflicting_information"] });

    expect(decision.accepted).toBe(true);
    if (decision.accepted) {
      const [event] = decision.events;
      expect(event?.type).toBe("HumanReviewRequested");
      if (event?.type === "HumanReviewRequested") {
        // Discretionary, so not mandatory — but still escalated.
        expect(event.mandatory).toBe(false);
      }
    }
  });

  it("marks financial evidence as a mandatory escalation", () => {
    const derived = fold(buildLog([OPENED]));
    const decision = decide(derived, { kind: "request_human_review", triggers: ["stale_requirement_data", "financial_evidence"] });

    expect(decision.accepted).toBe(true);
    if (decision.accepted) {
      const [event] = decision.events;
      if (event?.type === "HumanReviewRequested") {
        expect(event.mandatory).toBe(true);
      }
    }
  });

  it("refuses an empty review request", () => {
    const derived = fold(buildLog([OPENED]));
    const decision = decide(derived, { kind: "request_human_review", triggers: [] });
    expect(decision.accepted).toBe(false);
  });
});

describe("FAILURE SCENARIO — portal layout change (brief §10)", () => {
  it("records blueprint drift without losing case state", () => {
    // Drift is logged as a fact (brief §3.2) and does not by itself derail the
    // case — the AI handles the deviation, the log records it.
    const derived = fold(
      buildLog([
        OPENED,
        { type: "CaseStateChanged", from: "INTAKE", to: "REQUIREMENTS_RESOLUTION", reason: "x" },
        { type: "BlueprintDriftDetected", blueprintVersion: "leeds-direct-v3" as never, description: "Funding section moved to step 4." },
      ]),
    );

    expect(derived.state).toBe("REQUIREMENTS_RESOLUTION");
    expect(derived.sequence).toBe(3);
  });
});

describe("decide — authorisation", () => {
  it("captures authorisation and moves to AUTHORISED in one step", () => {
    const awaiting = fold(
      buildLog([
        OPENED,
        { type: "CaseStateChanged", from: "INTAKE", to: "REQUIREMENTS_RESOLUTION", reason: "x" },
        { type: "CaseStateChanged", from: "REQUIREMENTS_RESOLUTION", to: "ELIGIBILITY_REVIEW", reason: "x" },
        { type: "CaseStateChanged", from: "ELIGIBILITY_REVIEW", to: "READY_TO_PREPARE", reason: "x" },
        { type: "CaseStateChanged", from: "READY_TO_PREPARE", to: "PREPARING", reason: "x" },
        { type: "CaseStateChanged", from: "PREPARING", to: "AWAITING_STUDENT_AUTHORISATION", reason: "x" },
      ]),
    );

    const decision = decide(awaiting, { kind: "capture_authorisation", contentHash: "sha256:v1" });
    expect(decision.accepted).toBe(true);
    if (decision.accepted) {
      expect(decision.events).toHaveLength(2);
      expect(decision.events[0]?.type).toBe("AuthorisationCaptured");
      expect(decision.events[1]?.type).toBe("CaseStateChanged");
    }
  });

  it("refuses to capture authorisation from the wrong state", () => {
    const derived = fold(buildLog([OPENED]));
    const decision = decide(derived, { kind: "capture_authorisation", contentHash: "sha256:v1" });
    expect(decision.accepted).toBe(false);
  });

  it("refuses to void an authorisation that does not exist", () => {
    const derived = fold(buildLog([OPENED]));
    const decision = decide(derived, { kind: "void_authorisation", reason: "content_changed" });
    expect(decision.accepted).toBe(false);
  });

  it("voids an existing authorisation", () => {
    const authorised = authorisedCase();
    const decision = decide(authorised, { kind: "void_authorisation", reason: "content_changed" });

    expect(decision.accepted).toBe(true);
    if (decision.accepted) {
      const [event] = decision.events;
      if (event?.type === "AuthorisationVoided") {
        expect(event.previousContentHash).toBe("sha256:content-v1");
      }
    }
  });

  // ── Voiding is the counterpart to capture, not a flag ──────────────────
  //
  // `capture_authorisation` emits the approval AND the move to AUTHORISED. If
  // voiding emitted only the void, the case would sit in AUTHORISED claiming an
  // approval its own log says is gone, and `capture_authorisation` — which only
  // accepts from AWAITING_STUDENT_AUTHORISATION — could never be asked again.
  // That deadlock is what ADR-0051 §7 exists to fix.
  it("PUTS THE CASE BACK, so the student can be asked again", () => {
    const decision = decide(authorisedCase(), { kind: "void_authorisation", reason: "content_changed" });

    expect(decision.accepted).toBe(true);
    if (!decision.accepted) return;
    expect(decision.events.map((event) => event.type)).toEqual([
      "AuthorisationVoided",
      "CaseStateChanged",
    ]);
    const [, moved] = decision.events;
    if (moved?.type === "CaseStateChanged") {
      expect(moved.from).toBe("AUTHORISED");
      expect(moved.to).toBe("AWAITING_STUDENT_AUTHORISATION");
    }
  });

  // ── The guards must not become decorative ──────────────────────────────
  //
  // The whole point of routing the way back through `checkTransition`. A
  // correction that raises a mandatory trigger — financial evidence, a minor —
  // must be reviewed again BEFORE the student is asked to approve the corrected
  // content. A shortcut that let the case slide back to
  // AWAITING_STUDENT_AUTHORISATION without the gate would skip that review,
  // which is exactly the check ADR-0002 §2.5 makes unconditional.
  it("REFUSES to put the case back while a mandatory review is outstanding", () => {
    const raised = fold(
      buildLog([
        OPENED,
        { type: "CaseStateChanged", from: "INTAKE", to: "REQUIREMENTS_RESOLUTION", reason: "Gathering requirements." },
        { type: "CaseStateChanged", from: "REQUIREMENTS_RESOLUTION", to: "ELIGIBILITY_REVIEW", reason: "Requirements resolved." },
        { type: "CaseStateChanged", from: "ELIGIBILITY_REVIEW", to: "READY_TO_PREPARE", reason: "Eligible." },
        { type: "CaseStateChanged", from: "READY_TO_PREPARE", to: "PREPARING", reason: "Filling." },
        { type: "CaseStateChanged", from: "PREPARING", to: "AWAITING_STUDENT_AUTHORISATION", reason: "Rendered for review." },
        {
          type: "AuthorisationCaptured",
          contentHash: "sha256:content-v1",
          hashAlgorithm: "sha256",
          authorisedAt: new Date("2026-08-26T11:00:00Z"),
        },
        { type: "CaseStateChanged", from: "AWAITING_STUDENT_AUTHORISATION", to: "AUTHORISED", reason: "Student authorised." },
        // The correction brought financial evidence into the application.
        { type: "HumanReviewRequested", triggers: ["financial_evidence"], mandatory: true },
      ]),
    );

    const decision = decide(raised, { kind: "void_authorisation", reason: "content_changed" });

    expect(decision.accepted).toBe(false);
    if (!decision.accepted) {
      expect(decision.refusal.kind).toBe("transition_refused");
      if (decision.refusal.kind === "transition_refused") {
        expect(decision.refusal.refusal.kind).toBe("mandatory_review_outstanding");
      }
    }
  });
});

describe("decide — tasks", () => {
  it("raises a task", () => {
    const derived = fold(buildLog([OPENED]));
    const decision = decide(derived, {
      kind: "raise_task",
      taskId: "tsk_new",
      taskKind: "provide_document",
      description: "Passport",
      blocksProgress: true,
    });
    expect(decision.accepted).toBe(true);
  });

  it("refuses to complete an unknown task", () => {
    const derived = fold(buildLog([OPENED]));
    const decision = decide(derived, { kind: "complete_task", taskId: "tsk_missing", outcome: "done" });
    expect(decision.accepted).toBe(false);
    if (!decision.accepted) expect(decision.refusal.kind).toBe("invalid_intent");
  });

  it("refuses to complete an already-completed task", () => {
    const derived = fold(
      buildLog([
        OPENED,
        { type: "TaskRaised", taskId: taskId("tsk_1"), taskKind: "provide_document", description: "Passport", blocksProgress: true },
        { type: "TaskCompleted", taskId: taskId("tsk_1"), outcome: "done" },
      ]),
    );

    const decision = decide(derived, { kind: "complete_task", taskId: "tsk_1", outcome: "done" });
    expect(decision.accepted).toBe(false);
  });
});

describe("decide — terminal cases", () => {
  it("refuses any ordinary action on a concluded case", () => {
    const cancelled = fold(
      buildLog([OPENED, { type: "CaseStateChanged", from: "INTAKE", to: "CANCELLED", reason: "Student stopped." }]),
    );

    const intents: CaseIntent[] = [
      { kind: "transition", to: "PREPARING", reason: "x" },
      { kind: "attempt_submission" },
      { kind: "raise_task", taskId: "t", taskKind: "provide_document", description: "d", blocksProgress: true },
    ];

    for (const intent of intents) {
      const decision = decide(cancelled, intent);
      expect(decision.accepted).toBe(false);
      if (!decision.accepted) expect(decision.refusal.kind).toBe("case_terminal");
    }
  });

  it("still accepts a re-application instruction on a concluded case", () => {
    // ADR-0006: re-applying is by definition a decision made after a case ends.
    const cancelled = fold(
      buildLog([OPENED, { type: "CaseStateChanged", from: "INTAKE", to: "CANCELLED", reason: "Withdrawn." }]),
    );

    const decision = decide(cancelled, {
      kind: "instruct_reapplication",
      newAttemptOrdinal: 2,
      instruction: {
        priorOutcome: { outcome: "withdrawn", assertedBy: "student", assertedAt: new Date("2026-09-01T09:00:00Z") },
        studentStatement: "I'd like to try again.",
        instructedAt: new Date("2026-09-01T10:00:00Z"),
        recommendationShown: { advice: "none", rationale: "No wait needed.", shownAt: new Date("2026-09-01T09:59:00Z") },
        proceededDespiteRecommendation: false,
      },
    });

    expect(decision.accepted).toBe(true);
  });

  it("refuses an attempt ordinal that skips ahead", () => {
    const cancelled = fold(
      buildLog([OPENED, { type: "CaseStateChanged", from: "INTAKE", to: "CANCELLED", reason: "x" }]),
    );

    const decision = decide(cancelled, {
      kind: "instruct_reapplication",
      newAttemptOrdinal: 5, // current is 1
      instruction: {
        priorOutcome: { outcome: "rejected", assertedBy: "student", assertedAt: new Date() },
        studentStatement: "Again please.",
        instructedAt: new Date("2026-09-01T10:00:00Z"),
        recommendationShown: { advice: "six_months", rationale: "Consider waiting.", shownAt: new Date("2026-09-01T09:00:00Z") },
        proceededDespiteRecommendation: true,
      },
    });

    expect(decision.accepted).toBe(false);
    if (!decision.accepted) expect(decision.refusal.kind).toBe("invalid_intent");
  });

  it("resets authorisation and attempt state when a new attempt begins", () => {
    // A previous authorisation must never carry over to a different submission.
    const derived = fold(
      buildLog([
        OPENED,
        { type: "AuthorisationCaptured", contentHash: "sha256:v1", hashAlgorithm: "sha256", authorisedAt: new Date() },
        { type: "SubmissionAttempted", submissionIdentity: IDENTITY, authorisedContentHash: "sha256:v1" },
        { type: "CaseStateChanged", from: "INTAKE", to: "CANCELLED", reason: "Rejected by university." },
        {
          type: "ReapplicationInstructed",
          newAttemptOrdinal: 2,
          instruction: {
            priorOutcome: { outcome: "rejected", assertedBy: "student", assertedAt: new Date() },
            studentStatement: "Try again.",
            instructedAt: new Date("2026-09-01T10:00:00Z"),
            recommendationShown: { advice: "six_months", rationale: "Consider waiting.", shownAt: new Date("2026-09-01T09:00:00Z") },
            proceededDespiteRecommendation: true,
          },
        },
      ]),
    );

    expect(derived.submissionIdentity.attemptOrdinal).toBe(2);
    expect(derived.authorisedContentHash).toBeUndefined();
    expect(derived.submissionAttempted).toBe(false);
  });
});

describe("stamp — envelope construction", () => {
  it("numbers events consecutively from the current sequence", () => {
    const stamped = stamp({
      caseId: CASE,
      fromSequence: 7,
      payloads: [
        { type: "CaseStateChanged", from: "INTAKE", to: "DOCUMENTS_PENDING", reason: "x" },
        { type: "TaskRaised", taskId: taskId("tsk_9"), taskKind: "provide_document", description: "Passport", blocksProgress: true },
      ],
      actor: ACTOR,
      now: new Date("2026-08-26T12:00:00Z"),
      nextEventId: (index) => `evt_${index}`,
    });

    expect(stamped.map((event) => event.sequence)).toEqual([8, 9]);
    expect(stamped.every((event) => event.caseId === CASE)).toBe(true);
  });

  it("uses the injected clock rather than reading the ambient one", () => {
    // Determinism matters here: correctness depends on dates (the 31-day
    // window, handoff TTLs), so tests must control the clock.
    const now = new Date("2020-01-01T00:00:00Z");
    const stamped = stamp({
      caseId: CASE,
      fromSequence: 0,
      payloads: [OPENED],
      actor: ACTOR,
      now,
      nextEventId: () => "evt_1",
    });

    expect(stamped[0]?.occurredAt).toEqual(now);
  });

  it("produces a log that folds back to the expected case", () => {
    // Round trip: stamp → fold.
    const stamped = stamp({
      caseId: CASE,
      fromSequence: 0,
      payloads: [OPENED],
      actor: ACTOR,
      now: new Date("2026-08-26T10:15:00Z"),
      nextEventId: (index) => `evt_${index + 1}`,
    });

    const derived = fold(stamped);
    expect(derived.state).toBe("INTAKE");
    expect(derived.caseId).toBe(CASE);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Handoffs — the things only the student can do (ADR-0050)
// ───────────────────────────────────────────────────────────────────────────

describe("decide — handoffs", () => {
  const LATER = new Date("2126-08-26T10:15:00Z");
  const TOKEN = "ho_case_email_verification";

  const raise = (kind: "email_verification" | "password_reset" | "account_handover", token = TOKEN) =>
    ({ kind: "require_handoff", handoffKind: kind, handoffToken: token, expiresAt: LATER }) as const;

  it("raises one, and records what it is waiting for", () => {
    const opened = fold(buildLog([OPENED]));
    const decision = decide(opened, raise("email_verification"));
    if (!decision.accepted) expect.unreachable(`refused: ${decision.refusal.kind}`);
    expect(decision.events).toHaveLength(1);
    expect(decision.events[0]).toMatchObject({
      type: "HandoffRequired",
      handoffKind: "email_verification",
      handoffToken: TOKEN,
    });
  });

  it("is IDEMPOTENT by token — a second raise writes nothing", () => {
    // ═══════════════════════════════════════════════════════════════════
    // The run raises a handoff every time it decides, because deciding is what
    // it does on every poll. "Already open" is therefore the ORDINARY case,
    // and an event per poll would make the log a record of how often somebody
    // refreshed rather than of what was asked.
    // ═══════════════════════════════════════════════════════════════════
    const waiting = fold(
      buildLog([
        OPENED,
        { type: "HandoffRequired", handoffKind: "email_verification", handoffToken: TOKEN, expiresAt: LATER },
      ]),
    );
    const decision = decide(waiting, raise("email_verification"));
    if (!decision.accepted) expect.unreachable(`refused: ${decision.refusal.kind}`);
    expect(decision.events, "accepted, and nothing to say").toEqual([]);
  });

  it("REFUSES a second, different handoff while one is open", () => {
    // Two things only the student can do, one of which the system has forgotten
    // it asked for, is how somebody ends up waiting on something nobody is
    // going to tell them about.
    const waiting = fold(
      buildLog([
        OPENED,
        { type: "HandoffRequired", handoffKind: "email_verification", handoffToken: TOKEN, expiresAt: LATER },
      ]),
    );
    const decision = decide(waiting, raise("account_handover", "ho_case_account_handover"));
    if (decision.accepted) expect.unreachable("one at a time");
    expect(decision.refusal.kind).toBe("invalid_intent");
  });

  it("completes the OPEN one, and names the kind from the case", () => {
    // The kind is not on the intent. What was confirmed is a fact the case
    // holds, and a caller that could name it could confirm something else.
    const waiting = fold(
      buildLog([
        OPENED,
        { type: "HandoffRequired", handoffKind: "password_reset", handoffToken: TOKEN, expiresAt: LATER },
      ]),
    );
    const decision = decide(waiting, { kind: "complete_handoff", handoffToken: TOKEN });
    if (!decision.accepted) expect.unreachable(`refused: ${decision.refusal.kind}`);
    expect(decision.events[0]).toEqual({
      type: "HandoffCompleted",
      handoffToken: TOKEN,
      handoffKind: "password_reset",
    });
  });

  it("REFUSES a completion for a handoff the case is not waiting on", () => {
    // The realistic cause is a stale client: the student is looking at a page
    // for a step the run has moved past. Accepting it would close the handoff
    // that IS open with evidence about a different one.
    const waiting = fold(
      buildLog([
        OPENED,
        { type: "HandoffRequired", handoffKind: "email_verification", handoffToken: TOKEN, expiresAt: LATER },
      ]),
    );
    const decision = decide(waiting, { kind: "complete_handoff", handoffToken: "ho_something_else" });
    if (decision.accepted) expect.unreachable("not this one");
    expect(decision.refusal.kind).toBe("invalid_intent");
  });

  it("REFUSES a completion when nothing is open", () => {
    const decision = decide(fold(buildLog([OPENED])), {
      kind: "complete_handoff",
      handoffToken: TOKEN,
    });
    expect(decision.accepted).toBe(false);
  });

  it("remembers what was completed after the handoff has closed", () => {
    // The account stage is derived from this: "has the student verified their
    // email?" is a question about the whole log, and an account that stopped
    // being `awaiting_email_verification` must not go back to it the moment
    // the handoff closes.
    const done = fold(
      buildLog([
        OPENED,
        { type: "HandoffRequired", handoffKind: "email_verification", handoffToken: TOKEN, expiresAt: LATER },
        { type: "HandoffCompleted", handoffToken: TOKEN, handoffKind: "email_verification" },
      ]),
    );
    expect(done.openHandoffToken, "closed").toBeUndefined();
    expect(done.raisedHandoffs).toEqual(["email_verification"]);
    expect(done.completedHandoffs, "and remembered").toEqual(["email_verification"]);
  });

  it("allows the NEXT handoff once the first is closed", () => {
    const done = fold(
      buildLog([
        OPENED,
        { type: "HandoffRequired", handoffKind: "password_reset", handoffToken: TOKEN, expiresAt: LATER },
        { type: "HandoffCompleted", handoffToken: TOKEN, handoffKind: "password_reset" },
      ]),
    );
    const decision = decide(done, raise("account_handover", "ho_case_account_handover"));
    expect(decision.accepted).toBe(true);
  });
});
