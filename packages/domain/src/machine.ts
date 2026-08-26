/**
 * The case state machine.
 *
 * Two operations, and the asymmetry between them is the design:
 *
 *   fold(events)         — derives the current case from its log. Total, pure,
 *                          and never fails: whatever is in the log is the
 *                          truth, and history is not re-litigated on read.
 *
 *   decide(case, intent) — proposes new events. This is where every rule is
 *                          enforced, and where an illegal move is refused.
 *
 * Validation belongs in `decide` and nowhere else. Once an event is in the log
 * it is a fact that happened; refusing to fold it would mean a rule change
 * could make historical cases unreadable.
 */

import type { HumanReviewRecord, ReviewTrigger } from "./escalation.js";
import { isMandatory } from "./escalation.js";
import type { CaseEvent, CaseEventPayload, EventActor, RequestEvidence } from "./events.js";
import type { CaseId, ExternalRef } from "./ids.js";
import type { SubmissionIdentity } from "./idempotency.js";
import type { ReapplicationInstruction } from "./reapplication.js";
import type { CaseState } from "./state.js";
import { isTerminal } from "./state.js";
import type { Task, TaskKind } from "./tasks.js";
import { blockingTasks } from "./tasks.js";
import type { GuardContext, TransitionRefusal } from "./transitions.js";
import { checkTransition } from "./transitions.js";

// ───────────────────────────────────────────────────────────────────────────
// The derived case
// ───────────────────────────────────────────────────────────────────────────

/**
 * A case, derived from its event log.
 *
 * Never constructed directly and never mutated — always the result of `fold`.
 */
export interface ApplicationCase {
  readonly caseId: CaseId;
  readonly state: CaseState;
  readonly submissionIdentity: SubmissionIdentity;
  readonly requestEvidence: RequestEvidence;
  /** Sequence number of the last event folded. 0 for an empty log. */
  readonly sequence: number;
  readonly tasks: readonly Task[];
  readonly activeTriggers: readonly ReviewTrigger[];
  readonly completedReviews: readonly HumanReviewRecord[];
  readonly authorisedContentHash?: string;
  readonly preparedContentHash?: string;
  /** True once a submission has been attempted with the current identity. */
  readonly submissionAttempted: boolean;
  readonly openHandoffToken?: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Thrown when a log cannot form a case at all. Not a business-rule failure. */
export class MalformedEventLogError extends Error {
  public override readonly name = "MalformedEventLogError";
}

/**
 * Derives the current case from its complete event log.
 *
 * The log must be ordered by `sequence` and must begin with `CaseOpened`.
 */
export function fold(events: readonly CaseEvent[]): ApplicationCase {
  const first = events[0];
  if (first === undefined) {
    throw new MalformedEventLogError("Cannot derive a case from an empty event log.");
  }
  if (first.type !== "CaseOpened") {
    throw new MalformedEventLogError(
      `The first event of a case must be CaseOpened, found ${first.type}.`,
    );
  }

  let state: CaseState = "INTAKE";
  let submissionIdentity: SubmissionIdentity = first.submissionIdentity;
  let authorisedContentHash: string | undefined;
  let preparedContentHash: string | undefined;
  let openHandoffToken: string | undefined;
  let submissionAttempted = false;

  const tasks = new Map<string, Task>();
  const activeTriggers = new Set<ReviewTrigger>();
  const completedReviews: HumanReviewRecord[] = [];

  let expectedSequence = 1;

  for (const event of events) {
    if (event.sequence !== expectedSequence) {
      throw new MalformedEventLogError(
        `Event log has a sequence gap: expected ${expectedSequence}, found ${event.sequence}.`,
      );
    }
    expectedSequence += 1;

    switch (event.type) {
      case "CaseOpened":
        submissionIdentity = event.submissionIdentity;
        break;

      case "CaseStateChanged":
        state = event.to;
        break;

      case "TaskRaised":
        tasks.set(event.taskId, {
          taskId: event.taskId,
          kind: event.taskKind as TaskKind,
          assignee: "student",
          description: event.description,
          blocksProgress: event.blocksProgress,
          status: "open",
          raisedAt: event.occurredAt,
        });
        break;

      case "TaskCompleted": {
        const existing = tasks.get(event.taskId);
        if (existing !== undefined) {
          tasks.set(event.taskId, {
            ...existing,
            status: event.outcome,
            completedAt: event.occurredAt,
          });
        }
        break;
      }

      case "HumanReviewRequested":
        for (const trigger of event.triggers) activeTriggers.add(trigger);
        break;

      case "HumanReviewCompleted":
        completedReviews.push(event.review);
        // Only an approving review clears its triggers. A rejection or a
        // request for changes leaves them standing, so the work goes round
        // again rather than slipping through.
        if (event.review.outcome === "approved") {
          for (const trigger of event.review.triggers) activeTriggers.delete(trigger);
        }
        break;

      case "HandoffRequired":
        openHandoffToken = event.handoffToken;
        break;

      case "HandoffCompleted":
        if (openHandoffToken === event.handoffToken) openHandoffToken = undefined;
        break;

      case "AuthorisationCaptured":
        authorisedContentHash = event.contentHash;
        // What was authorised is, by definition, what was prepared.
        preparedContentHash = event.contentHash;
        break;

      case "AuthorisationVoided":
        authorisedContentHash = undefined;
        break;

      case "SubmissionAttempted":
        submissionAttempted = true;
        break;

      case "ReapplicationInstructed":
        // The only path by which an attempt ordinal changes.
        submissionIdentity = {
          ...submissionIdentity,
          attemptOrdinal: event.newAttemptOrdinal,
        };
        // A new attempt starts clean: the previous authorisation cannot carry
        // over to a different submission.
        authorisedContentHash = undefined;
        preparedContentHash = undefined;
        submissionAttempted = false;
        break;

      // Recorded for audit; they carry no state of their own.
      case "SubmissionSucceeded":
      case "SubmissionFailed":
      case "ConfirmationCaptured":
      case "BlueprintDriftDetected":
      case "RouteFallbackTriggered":
      case "CaseCancelled":
        break;
    }
  }

  const last = events[events.length - 1];
  /* c8 ignore next -- unreachable: `first` is defined, so the array is non-empty */
  if (last === undefined) throw new MalformedEventLogError("Unreachable: non-empty log with no last event.");

  const derived: ApplicationCase = {
    caseId: first.caseId,
    state,
    submissionIdentity,
    requestEvidence: first.requestEvidence,
    sequence: last.sequence,
    tasks: [...tasks.values()],
    activeTriggers: [...activeTriggers],
    completedReviews,
    submissionAttempted,
    createdAt: first.occurredAt,
    updatedAt: last.occurredAt,
  };

  // Assembled conditionally because `exactOptionalPropertyTypes` distinguishes
  // "absent" from "present and undefined", and absent is what we mean.
  return {
    ...derived,
    ...(authorisedContentHash !== undefined ? { authorisedContentHash } : {}),
    ...(preparedContentHash !== undefined ? { preparedContentHash } : {}),
    ...(openHandoffToken !== undefined ? { openHandoffToken } : {}),
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Deciding
// ───────────────────────────────────────────────────────────────────────────

/** Something the system or a person wants to do to a case. */
export type CaseIntent =
  | { readonly kind: "transition"; readonly to: CaseState; readonly reason: string }
  | { readonly kind: "raise_task"; readonly taskId: string; readonly taskKind: TaskKind; readonly description: string; readonly blocksProgress: boolean }
  | { readonly kind: "complete_task"; readonly taskId: string; readonly outcome: "done" | "cancelled" | "superseded" }
  | { readonly kind: "request_human_review"; readonly triggers: readonly ReviewTrigger[] }
  | { readonly kind: "complete_human_review"; readonly review: HumanReviewRecord }
  | { readonly kind: "capture_authorisation"; readonly contentHash: string }
  | { readonly kind: "void_authorisation"; readonly reason: "content_changed" | "expired" | "student_revoked" }
  | { readonly kind: "attempt_submission" }
  | { readonly kind: "instruct_reapplication"; readonly instruction: ReapplicationInstruction; readonly newAttemptOrdinal: number };

export type DecisionRefusal =
  | { readonly kind: "transition_refused"; readonly refusal: TransitionRefusal }
  | { readonly kind: "case_terminal"; readonly detail: string }
  | { readonly kind: "duplicate_submission"; readonly detail: string }
  | { readonly kind: "blocked_by_tasks"; readonly detail: string; readonly taskIds: readonly string[] }
  | { readonly kind: "invalid_intent"; readonly detail: string };

export type Decision =
  | { readonly accepted: true; readonly events: readonly CaseEventPayload[] }
  | { readonly accepted: false; readonly refusal: DecisionRefusal };

function guardContextOf(applicationCase: ApplicationCase): GuardContext {
  return {
    activeTriggers: applicationCase.activeTriggers,
    completedReviews: applicationCase.completedReviews,
    ...(applicationCase.authorisedContentHash !== undefined
      ? { authorisedContentHash: applicationCase.authorisedContentHash }
      : {}),
    ...(applicationCase.preparedContentHash !== undefined
      ? { preparedContentHash: applicationCase.preparedContentHash }
      : {}),
  };
}

/**
 * Decides whether an intent is permitted, and what it produces.
 *
 * Pure: returns event payloads rather than appending them. The caller stamps
 * envelopes and persists. That keeps every rule in this file testable with no
 * database, which is what makes Phase 1 verifiable with no external systems.
 */
export function decide(applicationCase: ApplicationCase, intent: CaseIntent): Decision {
  // Nothing may be done to a concluded case — except recording a
  // re-application instruction, which is precisely a decision made *after* a
  // case has concluded (ADR-0006).
  if (isTerminal(applicationCase.state) && intent.kind !== "instruct_reapplication") {
    return {
      accepted: false,
      refusal: {
        kind: "case_terminal",
        detail: `Case is ${applicationCase.state}; no further action is possible.`,
      },
    };
  }

  switch (intent.kind) {
    case "transition": {
      const check = checkTransition(applicationCase.state, intent.to, guardContextOf(applicationCase));
      if (!check.permitted) {
        return { accepted: false, refusal: { kind: "transition_refused", refusal: check.refusal } };
      }

      // A case with open blocking tasks cannot move *forward* into execution.
      // Moving backwards to collect what is missing, or off-ramping, stays
      // available — otherwise a blocked case could never unblock itself.
      const FORWARD_INTO_EXECUTION: readonly CaseState[] = [
        "PREPARING",
        "AWAITING_STUDENT_AUTHORISATION",
        "SUBMITTING",
      ];
      if (FORWARD_INTO_EXECUTION.includes(intent.to)) {
        const blocking = blockingTasks(applicationCase.tasks);
        if (blocking.length > 0) {
          return {
            accepted: false,
            refusal: {
              kind: "blocked_by_tasks",
              detail:
                `Cannot move to ${intent.to} while ${blocking.length} blocking task(s) are open.`,
              taskIds: blocking.map((task) => task.taskId),
            },
          };
        }
      }

      return {
        accepted: true,
        events: [{ type: "CaseStateChanged", from: applicationCase.state, to: intent.to, reason: intent.reason }],
      };
    }

    case "raise_task":
      return {
        accepted: true,
        events: [
          {
            type: "TaskRaised",
            taskId: intent.taskId as Task["taskId"],
            taskKind: intent.taskKind,
            description: intent.description,
            blocksProgress: intent.blocksProgress,
          },
        ],
      };

    case "complete_task": {
      const task = applicationCase.tasks.find((candidate) => candidate.taskId === intent.taskId);
      if (task === undefined) {
        return {
          accepted: false,
          refusal: { kind: "invalid_intent", detail: `No task ${intent.taskId} on this case.` },
        };
      }
      if (task.status !== "open") {
        return {
          accepted: false,
          refusal: { kind: "invalid_intent", detail: `Task ${intent.taskId} is already ${task.status}.` },
        };
      }
      return {
        accepted: true,
        events: [{ type: "TaskCompleted", taskId: task.taskId, outcome: intent.outcome }],
      };
    }

    case "request_human_review": {
      if (intent.triggers.length === 0) {
        return {
          accepted: false,
          refusal: { kind: "invalid_intent", detail: "A human review request must carry at least one trigger." },
        };
      }
      return {
        accepted: true,
        events: [
          {
            type: "HumanReviewRequested",
            triggers: intent.triggers,
            mandatory: intent.triggers.some(isMandatory),
          },
        ],
      };
    }

    case "complete_human_review":
      return { accepted: true, events: [{ type: "HumanReviewCompleted", review: intent.review }] };

    case "capture_authorisation":
      if (applicationCase.state !== "AWAITING_STUDENT_AUTHORISATION") {
        return {
          accepted: false,
          refusal: {
            kind: "invalid_intent",
            detail:
              `Authorisation can only be captured from AWAITING_STUDENT_AUTHORISATION, ` +
              `case is ${applicationCase.state}.`,
          },
        };
      }
      return {
        accepted: true,
        events: [
          { type: "AuthorisationCaptured", contentHash: intent.contentHash, hashAlgorithm: "sha256", authorisedAt: applicationCase.updatedAt },
          { type: "CaseStateChanged", from: applicationCase.state, to: "AUTHORISED", reason: "Student authorised the prepared content." },
        ],
      };

    case "void_authorisation":
      if (applicationCase.authorisedContentHash === undefined) {
        return {
          accepted: false,
          refusal: { kind: "invalid_intent", detail: "There is no authorisation to void." },
        };
      }
      return {
        accepted: true,
        events: [
          { type: "AuthorisationVoided", previousContentHash: applicationCase.authorisedContentHash, reason: intent.reason },
        ],
      };

    case "attempt_submission": {
      // ── The duplicate-submission guard ───────────────────────────────
      //
      // The characteristic catastrophic failure of this class of system
      // (brief §4). A retry cannot produce a different submission identity, so
      // it necessarily lands here, and this is what stops it. The database
      // unique index on the submission key is the second line of defence.
      if (applicationCase.submissionAttempted) {
        return {
          accepted: false,
          refusal: {
            kind: "duplicate_submission",
            detail:
              `A submission has already been attempted for attempt ordinal ` +
              `${applicationCase.submissionIdentity.attemptOrdinal}. A retry must not create a ` +
              `second submission. A new attempt requires an explicit student instruction.`,
          },
        };
      }

      const check = checkTransition(applicationCase.state, "SUBMITTING", guardContextOf(applicationCase));
      if (!check.permitted) {
        return { accepted: false, refusal: { kind: "transition_refused", refusal: check.refusal } };
      }

      /* c8 ignore next 5 -- unreachable: checkTransition refuses SUBMITTING without an authorisation hash */
      if (applicationCase.authorisedContentHash === undefined) {
        return {
          accepted: false,
          refusal: { kind: "invalid_intent", detail: "No authorisation hash on the case." },
        };
      }

      return {
        accepted: true,
        events: [
          { type: "CaseStateChanged", from: applicationCase.state, to: "SUBMITTING", reason: "Submitting authorised content." },
          {
            type: "SubmissionAttempted",
            submissionIdentity: applicationCase.submissionIdentity,
            authorisedContentHash: applicationCase.authorisedContentHash,
          },
        ],
      };
    }

    case "instruct_reapplication": {
      if (intent.newAttemptOrdinal !== applicationCase.submissionIdentity.attemptOrdinal + 1) {
        return {
          accepted: false,
          refusal: {
            kind: "invalid_intent",
            detail:
              `An attempt ordinal may only increase by one. Current is ` +
              `${applicationCase.submissionIdentity.attemptOrdinal}, requested ` +
              `${intent.newAttemptOrdinal}.`,
          },
        };
      }
      return {
        accepted: true,
        events: [
          {
            type: "ReapplicationInstructed",
            instruction: intent.instruction,
            newAttemptOrdinal: intent.newAttemptOrdinal,
          },
        ],
      };
    }
  }
}

/**
 * Stamps decided payloads with envelopes, ready to append.
 *
 * The clock is injected rather than read from `Date.now()` so that state-machine
 * behaviour is deterministic under test — a system whose correctness depends on
 * dates (the 31-day window, handoff TTLs, revalidation deadlines) cannot be
 * verified against a clock it does not control.
 */
export function stamp(input: {
  readonly caseId: CaseId;
  readonly fromSequence: number;
  readonly payloads: readonly CaseEventPayload[];
  readonly actor: EventActor;
  readonly now: Date;
  readonly nextEventId: (index: number) => string;
}): readonly CaseEvent[] {
  return input.payloads.map((payload, index) => ({
    ...payload,
    eventId: input.nextEventId(index) as CaseEvent["eventId"],
    caseId: input.caseId,
    sequence: input.fromSequence + index + 1,
    occurredAt: input.now,
    actor: input.actor,
  }));
}

/** Builds the opening event of a new case. */
export function openCase(input: {
  readonly submissionIdentity: SubmissionIdentity;
  readonly requestEvidence: RequestEvidence;
}): CaseEventPayload {
  return {
    type: "CaseOpened",
    submissionIdentity: input.submissionIdentity,
    requestEvidence: input.requestEvidence,
  };
}

/** Convenience for the common `askimate` actor. */
export function askimateActor(externalRef: ExternalRef): EventActor {
  return { kind: "askimate", externalRef };
}
