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
import type {
  CaseEvent,
  CaseEventPayload,
  EventActor,
  HandoffKind,
  ReapplicationInstructed,
  RequestEvidence, OwnAct } from "./events.js";
import type { CaseId, ExternalRef } from "./ids.js";
import type { SubmissionIdentity } from "./idempotency.js";
import { decideReapplication } from "./reapplication.js";
import type { ReapplicationActor, ReapplicationInstruction } from "./reapplication.js";
import type { RecoveryEscalation, RecoveryResolution } from "./recovery.js";
import type { CaseState } from "./state.js";
import { isTerminal } from "./state.js";
import type { Task, TaskKind } from "./tasks.js";
import { blockingTasks, ownerFor, sourceFor } from "./tasks.js";
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
  /**
   * The concluded case this one is a second attempt at (ADR-0006 §3).
   *
   * Set exactly when `submissionIdentity.attemptOrdinal` is above 1.
   */
  readonly priorCaseId?: CaseId;
  /**
   * The successor this case's own re-application instruction opened.
   *
   * Present once, at most: a case has one successor, so the chain of attempts
   * is a chain rather than a tree. `decide` refuses a second
   * `instruct_reapplication` on the strength of this field, because two
   * successors would be two applications claiming the same attempt ordinal —
   * the duplicate submission ADR-0006 exists to make impossible, one level up.
   */
  readonly reapplication?: {
    readonly newCaseId: CaseId;
    readonly newAttemptOrdinal: number;
  };
  /** Sequence number of the last event folded. 0 for an empty log. */
  readonly sequence: number;
  readonly tasks: readonly Task[];
  readonly activeTriggers: readonly ReviewTrigger[];
  readonly completedReviews: readonly HumanReviewRecord[];
  readonly authorisedContentHash?: string;
  readonly preparedContentHash?: string;
  /** True once a submission has been attempted with the current identity. */
  readonly submissionAttempted: boolean;
  /**
   * What the student owes the portal, as a record (ADR-0108): each slot left
   * to them at the yes, what the portal was told about it, and whether they
   * have said they did it. Empty for a case that deferred nothing.
   */
  readonly ownActs: readonly OwnAct[];
  readonly openHandoffToken?: string;
  /**
   * What the open handoff is waiting for.
   *
   * Beside the token rather than derivable from it, because a token is opaque
   * on purpose — it identifies a resumable session and says nothing about what
   * the student has to do.
   */
  readonly openHandoffKind?: HandoffKind;
  /**
   * Every handoff that has been RAISED, in order.
   *
   * "Has the student been told this account exists?" is answered by the raise
   * rather than by the completion: raising a handover handoff is what puts the
   * message in front of them (ADR-0050).
   */
  readonly raisedHandoffs: readonly HandoffKind[];
  /**
   * Every handoff the student has COMPLETED, in order.
   *
   * The account stage is derived from this (ADR-0050): "has the student
   * verified their email?" is a question about the whole log, not about what
   * is open now, and an account that stopped being `awaiting_email_verification`
   * must not go back to it the moment the handoff closes.
   */
  readonly completedHandoffs: readonly HandoffKind[];
  /**
   * The unresolved recovery escalation, if the case is paused on one.
   *
   * Carries the checkpoint, so a restarted worker or a specialist opening the
   * case knows exactly where the AI stopped and what it had already done
   * (ADR-0008).
   */
  readonly openEscalation?: RecoveryEscalation;
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
  let openHandoffKind: HandoffKind | undefined;
  const raisedHandoffs: HandoffKind[] = [];
  const completedHandoffs: HandoffKind[] = [];
  let openEscalation: RecoveryEscalation | undefined;
  let submissionAttempted = false;
  let priorCaseId: CaseId | undefined = first.priorCaseId;
  let reapplication: ApplicationCase["reapplication"];
  const ownActs = new Map<string, OwnAct>();

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
        priorCaseId = event.priorCaseId;
        break;

      case "CaseStateChanged":
        state = event.to;
        break;

      case "TaskRaised": {
        // Ownership is derived from the kind, never carried on the event.
        // A stored owner could drift from the routing table; a derived one
        // cannot, so ADR-0007's "the agent asks, the student never fills in a
        // form" holds for every task in every log, including old ones.
        const kind = event.taskKind as TaskKind;
        const source = sourceFor(kind);
        tasks.set(event.taskId, {
          taskId: event.taskId,
          kind,
          owner: ownerFor(kind),
          ...(source !== undefined ? { source } : {}),
          description: event.description,
          blocksProgress: event.blocksProgress,
          status: "open",
          raisedAt: event.occurredAt,
        });
        break;
      }

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
        openHandoffKind = event.handoffKind;
        raisedHandoffs.push(event.handoffKind);
        break;

      case "HandoffCompleted":
        // Recorded whether or not it matches the open token. The completion is
        // a fact about the student either way, and dropping it because the
        // bookkeeping disagrees would lose the evidence rather than the
        // inconsistency.
        completedHandoffs.push(event.handoffKind);
        if (openHandoffToken === event.handoffToken) {
          openHandoffToken = undefined;
          openHandoffKind = undefined;
        }
        break;

      case "RecoveryEscalationRaised":
        openEscalation = event.escalation;
        break;

      case "RecoveryResolved":
        // The escalation is closed. The checkpoint survives in the log, which
        // is what makes "everything already completed remains available and
        // auditable" true months later.
        openEscalation = undefined;
        break;

      case "AuthorisationCaptured":
        authorisedContentHash = event.contentHash;
        // What was authorised is, by definition, what was prepared.
        preparedContentHash = event.contentHash;
        break;

      case "AuthorisationVoided":
        authorisedContentHash = undefined;
        break;

      case "OwnActRecorded": {
        // Re-authorising records the same debt again: the label and what was
        // told are refreshed, and a word already given is not taken back.
        const before = ownActs.get(event.key);
        ownActs.set(event.key, {
          key: event.key,
          label: event.label,
          ...(event.page === undefined ? {} : { page: event.page }),
          ...(event.entry === undefined ? {} : { entry: { ...event.entry } }),
          ...(event.told === undefined ? {} : { told: { ...event.told } }),
          ...(before?.doneAt === undefined ? {} : { doneAt: before.doneAt }),
        });
        break;
      }

      case "OwnActDone": {
        // The student's word, once: a key the case never recorded invents
        // nothing, and a second word keeps the first's time.
        const act = ownActs.get(event.key);
        if (act !== undefined && act.doneAt === undefined) ownActs.set(event.key, { ...act, doneAt: event.doneAt });
        break;
      }

      case "SubmissionAttempted":
        submissionAttempted = true;
        break;

      case "ReapplicationInstructed":
        // ── This used to increment the ordinal ON THIS CASE (P38) ───────
        //
        // It cleared the authorisation and the submission marker too, so the
        // case read as a fresh attempt. It could never act as one: every
        // terminal state has an empty transition list and `checkTransition`
        // refuses from a terminal state before it looks at anything else, so
        // what the fold produced was a CONFIRMED case at ordinal 2 that can
        // never transition again. The drift was here, and it was invisible
        // because nothing in production could reach the intent.
        //
        // The prior case is not the new attempt and never was. It stays
        // terminal, at its own ordinal, with its own authorisation intact —
        // which is what makes "what exactly did the student agree to, in
        // which application?" answerable per case. All this event does to
        // the case it lives on is record what the student decided next.
        reapplication = {
          newCaseId: event.newCaseId,
          newAttemptOrdinal: event.newAttemptOrdinal,
        };
        break;

      // Recorded for audit; they carry no state of their own.
      case "SubmissionSucceeded":
      case "SubmissionFailed":
      case "ConfirmationCaptured":
      case "InterventionCaptured":
      case "InterventionLifecycleChanged":
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
    raisedHandoffs,
    completedHandoffs,
    completedReviews,
    submissionAttempted,
    // ADR-0108: what the student owes, in the order it was recorded.
    ownActs: [...ownActs.values()],
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
    ...(openHandoffKind !== undefined ? { openHandoffKind } : {}),
    ...(openEscalation !== undefined ? { openEscalation } : {}),
    ...(priorCaseId !== undefined ? { priorCaseId } : {}),
    ...(reapplication !== undefined ? { reapplication } : {}),
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
  | {
      readonly kind: "require_handoff";
      readonly handoffKind: HandoffKind;
      /** Stable for a given (run, kind), so raising twice is one handoff. */
      readonly handoffToken: string;
      readonly expiresAt: Date;
    }
  | { readonly kind: "complete_handoff"; readonly handoffToken: string }
  | { readonly kind: "capture_authorisation"; readonly contentHash: string }
  | { readonly kind: "void_authorisation"; readonly reason: "content_changed" | "expired" | "student_revoked" }
  | { readonly kind: "attempt_submission" }
  | {
      readonly kind: "instruct_reapplication";
      readonly instruction: ReapplicationInstruction;
      /**
       * Who is asking. ADR-0006 rule 1 — only a student may ever succeed.
       *
       * Carried rather than assumed, because the whole point of the rule is
       * that an automatic retry, a specialist and an operator are all refused,
       * and a caller that did not have to say which it was would be a caller
       * that could be any of them.
       *
       * The ordinal is deliberately NOT carried: `decideReapplication` returns
       * it. A caller that proposed one would be a second opinion about the one
       * thing ADR-0006 says may only increase by one.
       */
      readonly actor: ReapplicationActor;
      /**
       * The identifier the new case will be opened under.
       *
       * An IDENTIFIER, which the domain cannot mint and has no opinion about —
       * unlike the ordinal, which it derives and will not accept from anyone.
       * The two are deliberately different: `newCaseId` says WHERE the second
       * application lives, and `newAttemptOrdinal` says WHICH attempt it is,
       * and only the second is a rule.
       */
      readonly newCaseId: CaseId;
    }
  | { readonly kind: "escalate_for_recovery"; readonly escalation: RecoveryEscalation }
  | { readonly kind: "resolve_recovery"; readonly resolution: RecoveryResolution; readonly resumeTo: CaseState }
  /**
   * The student stopped it (ADR-0053).
   *
   * Carries their own words, for the reason `CaseOpened.requestEvidence` does:
   * when somebody asks "why did this application stop?", the answer should be
   * the student's sentence rather than a boolean. Product rule 1 is enforced
   * at the start of a case; this is its counterpart at the end.
   */
  | { readonly kind: "cancel_case"; readonly reason: string };

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

    case "require_handoff": {
      // Idempotent by token. The run raises a handoff every time it decides,
      // because deciding is what it does on every poll — so "already open" is
      // the ordinary case and must not append a second event. An event per
      // poll would also make `openHandoffToken` answer about the latest raise
      // rather than about the open handoff.
      if (applicationCase.openHandoffToken === intent.handoffToken) {
        return { accepted: true, events: [] };
      }
      // A DIFFERENT handoff already open is a refusal rather than a silent
      // replacement. Two things only the student can do, one of which the
      // system has forgotten it asked for, is how a student ends up waiting on
      // something nobody is going to tell them about.
      if (applicationCase.openHandoffToken !== undefined) {
        return {
          accepted: false,
          refusal: {
            kind: "invalid_intent",
            detail:
              `Handoff ${applicationCase.openHandoffToken} is already open on this case; ` +
              `${intent.handoffToken} cannot replace it. Complete the open one first.`,
          },
        };
      }
      return {
        accepted: true,
        events: [
          {
            type: "HandoffRequired",
            handoffKind: intent.handoffKind,
            handoffToken: intent.handoffToken,
            expiresAt: intent.expiresAt,
          },
        ],
      };
    }

    case "complete_handoff": {
      const open = applicationCase.openHandoffToken;
      if (open === undefined) {
        return {
          accepted: false,
          refusal: { kind: "invalid_intent", detail: "There is no open handoff to complete." },
        };
      }
      if (open !== intent.handoffToken) {
        // Completing a handoff the case is not waiting on. The realistic cause
        // is a stale client: the student is looking at a page for a step the
        // run has moved past, and accepting it would close the handoff that IS
        // open with evidence about a different one.
        return {
          accepted: false,
          refusal: {
            kind: "invalid_intent",
            detail: `This case is waiting on handoff ${open}, not ${intent.handoffToken}.`,
          },
        };
      }
      const kind = applicationCase.openHandoffKind;
      /* c8 ignore next 6 -- unreachable: `fold` sets the token and the kind from
         the same event, so an open token without a kind cannot exist. */
      if (kind === undefined) {
        return {
          accepted: false,
          refusal: { kind: "invalid_intent", detail: `No record of handoff ${open} on this case.` },
        };
      }
      return {
        accepted: true,
        events: [{ type: "HandoffCompleted", handoffToken: open, handoffKind: kind }],
      };
    }

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

    case "void_authorisation": {
      if (applicationCase.authorisedContentHash === undefined) {
        return {
          accepted: false,
          refusal: { kind: "invalid_intent", detail: "There is no authorisation to void." },
        };
      }
      const voided: CaseEventPayload = {
        type: "AuthorisationVoided",
        previousContentHash: applicationCase.authorisedContentHash,
        reason: intent.reason,
      };

      // ── The counterpart to capture, and why it moves the case ─────────
      //
      // ═══════════════════════════════════════════════════════════════════
      // `capture_authorisation` emits the approval AND the transition to
      // AUTHORISED in one decided act. Voiding is its mirror: the approval is
      // gone, so the case is no longer authorised, and leaving it in
      // AUTHORISED would mean a case that claims an approval its own log says
      // was voided.
      //
      // This is also the ONLY way back. `nextCaseHop` walks the spine forward
      // only (ADR-0049 §1) and must keep doing so — a healthy case does not go
      // backwards. Invalidation is not a healthy case going backwards; it is a
      // separate, deliberate act, which ADR-0049 §1 named and nothing
      // performed until ADR-0051.
      // ═══════════════════════════════════════════════════════════════════
      //
      // Through `checkTransition`, so every guard runs on the way back — the
      // mandatory-review guard included. A correction that introduces
      // financial evidence, or that reveals a minor, is reviewed again before
      // the student can be asked. That is the difference between this and any
      // shortcut that let `capture_authorisation` accept from AUTHORISED.
      if (applicationCase.state !== "AUTHORISED") {
        return { accepted: true, events: [voided] };
      }
      const back = checkTransition(
        applicationCase.state,
        "AWAITING_STUDENT_AUTHORISATION",
        guardContextOf(applicationCase),
      );
      if (!back.permitted) {
        return { accepted: false, refusal: { kind: "transition_refused", refusal: back.refusal } };
      }
      return {
        accepted: true,
        events: [
          voided,
          {
            type: "CaseStateChanged",
            from: applicationCase.state,
            to: "AWAITING_STUDENT_AUTHORISATION",
            reason: `The approved content changed (${intent.reason}); the authorisation no longer covers it.`,
          },
        ],
      };
    }

    case "cancel_case": {
      // ═══════════════════════════════════════════════════════════════════
      // A STOP THAT CANNOT BE REFUSED, AND CANNOT STRAND AN ACCOUNT.
      //
      // ADR-0053. Until P14 the client was the scheduler, so closing the tab
      // WAS a stop — undesigned and unrecorded, but real. P14 gave the system
      // its own clock and removed it. `CaseCancelled` has existed since the
      // domain was written and nothing has ever produced one.
      // ═══════════════════════════════════════════════════════════════════
      //
      // Entering WINDING_DOWN is deliberately unguarded beyond the transition
      // table: a stop button with a precondition is not a stop button. The
      // guard that matters is on the way OUT, in `checkTransition` — a
      // cancellation concludes only once nothing is owed.
      const moving = checkTransition(
        applicationCase.state,
        "WINDING_DOWN",
        guardContextOf(applicationCase),
      );
      if (!moving.permitted) {
        return { accepted: false, refusal: { kind: "transition_refused", refusal: moving.refusal } };
      }

      const events: CaseEventPayload[] = [
        { type: "CaseCancelled", reason: intent.reason },
      ];

      // ── The void, WITHOUT the return transition ─────────────────────────
      //
      // `void_authorisation` emits the void AND the move back to
      // AWAITING_STUDENT_AUTHORISATION, because on a healthy case the point of
      // voiding is to ask the student again (ADR-0051 §7). Here there is
      // nothing to ask: they have stopped. So the void is emitted directly and
      // the transition in this act goes to WINDING_DOWN.
      //
      // `student_revoked` has been a declared void reason since the domain was
      // written and nothing has ever issued one. This is its writer, and
      // ADR-0053 §2 makes it the authoritative reason for a void on
      // cancellation — never `expired`, never `content_changed`.
      if (applicationCase.authorisedContentHash !== undefined) {
        events.push({
          type: "AuthorisationVoided",
          previousContentHash: applicationCase.authorisedContentHash,
          reason: "student_revoked",
        });
      }

      events.push({
        type: "CaseStateChanged",
        from: applicationCase.state,
        to: "WINDING_DOWN",
        reason: "The student stopped the application.",
      });
      return { accepted: true, events };
    }

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

    case "escalate_for_recovery": {
      // Pause at the exact point of failure (ADR-0008). The case does NOT
      // unwind and does NOT fail — everything already done is preserved, and
      // the checkpoint records where to resume from.
      const check = checkTransition(applicationCase.state, "AWAITING_SPECIALIST_RECOVERY", guardContextOf(applicationCase));
      if (!check.permitted) {
        return { accepted: false, refusal: { kind: "transition_refused", refusal: check.refusal } };
      }
      return {
        accepted: true,
        events: [
          { type: "RecoveryEscalationRaised", escalation: intent.escalation },
          {
            type: "CaseStateChanged",
            from: applicationCase.state,
            to: "AWAITING_SPECIALIST_RECOVERY",
            reason:
              `Paused during ${intent.escalation.checkpoint.action} against ` +
              `${intent.escalation.checkpoint.target}: ${intent.escalation.reason}. ` +
              `Specialist alerted (${intent.escalation.priority}).`,
          },
        ],
      };
    }

    case "resolve_recovery": {
      if (applicationCase.state !== "AWAITING_SPECIALIST_RECOVERY") {
        return {
          accepted: false,
          refusal: {
            kind: "invalid_intent",
            detail: `Recovery can only be resolved from AWAITING_SPECIALIST_RECOVERY, case is ${applicationCase.state}.`,
          },
        };
      }
      if (applicationCase.openEscalation === undefined) {
        return {
          accepted: false,
          refusal: { kind: "invalid_intent", detail: "There is no open escalation to resolve." },
        };
      }

      // The resume target still goes through the full guard check. A specialist
      // unblocking a case cannot, for example, push it past a mandatory review
      // that has not happened — recovery is not an override.
      const check = checkTransition(applicationCase.state, intent.resumeTo, guardContextOf(applicationCase));
      if (!check.permitted) {
        return { accepted: false, refusal: { kind: "transition_refused", refusal: check.refusal } };
      }

      return {
        accepted: true,
        events: [
          { type: "RecoveryResolved", resolution: intent.resolution },
          {
            type: "CaseStateChanged",
            from: applicationCase.state,
            to: intent.resumeTo,
            // No position in this sentence, deliberately (ADR-0048 §5). Where
            // the run resumes is derived from the intent ledger, and a reason
            // string quoting a cursor would be quoting one that does not exist.
            reason: `Resolved by ${intent.resolution.specialistId} (${intent.resolution.outcome}).`,
          },
        ],
      };
    }

    case "instruct_reapplication": {
      // ── ONE gate, not two (ADR-0072) ─────────────────────────────────
      //
      // `decideReapplication`'s own doc comment has said "the single gate;
      // `machine.ts` calls this" since Phase 1, and until P37 this file
      // imported only the TYPE. What stood here checked one of the five rules
      // — that the ordinal increases by one — and accepted everything else, so
      // an `automatic_retry`, a `specialist` and an `operator` could all emit
      // `ReapplicationInstructed`, as could an instruction with no student
      // statement or a recommendation shown after the fact.
      //
      // Four of ADR-0006's rules were enforced only by a function nothing
      // called. That is ADR-0041's failure inside the domain: two
      // implementations of one decision, with the weaker one on the path.
      //
      // `priorCaseConcluded` is DERIVED rather than passed. The guard at the
      // top of `decide` already refuses every other intent on a terminal case,
      // so the case's own state is the honest answer and a caller cannot
      // disagree with it.
      // ── One successor, so the chain is a chain ────────────────────────
      //
      // Checked before the gate because it is a fact about this case rather
      // than about the instruction: a case that already opened a second
      // application cannot open another at the same ordinal. Without it the
      // only thing standing between a double-tap and two live applications
      // for one attempt would be the submission key — which would refuse the
      // second, correctly, and with a message about a duplicate rather than
      // about the decision that produced it.
      const already = applicationCase.reapplication;
      if (already !== undefined) {
        return {
          accepted: false,
          refusal: {
            kind: "invalid_intent",
            detail:
              `This application already led to a second one (${already.newCaseId}, attempt ` +
              `${String(already.newAttemptOrdinal)}). A further attempt is instructed against ` +
              `that case, not against this one.`,
          },
        };
      }

      const permitted = decideReapplication({
        actor: intent.actor,
        currentAttemptOrdinal: applicationCase.submissionIdentity.attemptOrdinal,
        priorCaseConcluded: isTerminal(applicationCase.state),
        instruction: intent.instruction,
      });
      if (!permitted.allowed) {
        return {
          accepted: false,
          refusal: { kind: "invalid_intent", detail: permitted.rejection.detail },
        };
      }
      return {
        accepted: true,
        events: [
          {
            type: "ReapplicationInstructed",
            instruction: intent.instruction,
            newAttemptOrdinal: permitted.nextAttemptOrdinal,
            newCaseId: intent.newCaseId,
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

/**
 * Builds the opening event of a new case.
 *
 * Refuses an attempt ordinal above 1 without the prior case it is counting
 * from, and a prior case at ordinal 1. `openReapplication` is the only thing
 * that supplies either, and it derives both from the prior case's own log —
 * so "the ordinal is never proposed by a caller" holds at the one place a case
 * can come into existence, rather than at each of its callers.
 */
export function openCase(input: {
  readonly submissionIdentity: SubmissionIdentity;
  readonly requestEvidence: RequestEvidence;
  readonly priorCaseId?: CaseId;
}): CaseEventPayload {
  const ordinal = input.submissionIdentity.attemptOrdinal;
  if (ordinal > 1 && input.priorCaseId === undefined) {
    throw new MalformedEventLogError(
      `A case at attempt ${String(ordinal)} must name the case it follows. An ordinal above 1 ` +
        `asserts that an earlier application exists; without the prior case there is nothing ` +
        `to check that against (ADR-0006 §3).`,
    );
  }
  if (ordinal === 1 && input.priorCaseId !== undefined) {
    throw new MalformedEventLogError(
      `A first attempt cannot follow a prior case; ${input.priorCaseId} was named at ordinal 1.`,
    );
  }
  return {
    type: "CaseOpened",
    submissionIdentity: input.submissionIdentity,
    requestEvidence: input.requestEvidence,
    ...(input.priorCaseId !== undefined ? { priorCaseId: input.priorCaseId } : {}),
  };
}

/**
 * Builds the opening event of the case a re-application instruction produced.
 *
 * The ONE constructor for a second attempt, and the reason it exists is that
 * every field of the new case's identity is derived rather than passed:
 *
 *   student, institution, course, intake   from the prior case's identity —
 *                                          a second attempt at a DIFFERENT
 *                                          target is not a re-application, it
 *                                          is an application
 *   attemptOrdinal                         from the instruction the gate
 *                                          accepted, never from a caller
 *   priorCaseId                            the case the instruction was
 *                                          decided against
 *
 * What a caller supplies is what a caller must supply: the student's own words
 * and the surface they arrived on. `instructed` is the event `decide` returned,
 * so this cannot be reached without the gate having run.
 */
export function openReapplication(input: {
  readonly priorCase: ApplicationCase;
  readonly instructed: ReapplicationInstructed;
  readonly requestEvidence: RequestEvidence;
}): CaseEventPayload {
  return openCase({
    submissionIdentity: {
      ...input.priorCase.submissionIdentity,
      attemptOrdinal: input.instructed.newAttemptOrdinal,
    },
    requestEvidence: input.requestEvidence,
    priorCaseId: input.priorCase.caseId,
  });
}

/** Convenience for the common `askimate` actor. */
export function askimateActor(externalRef: ExternalRef): EventActor {
  return { kind: "askimate", externalRef };
}
