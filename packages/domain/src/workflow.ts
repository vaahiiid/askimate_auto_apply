/**
 * The workflow run: one attempt to execute a case, and where it got to.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-27, approving direction B+:
 *
 *   1. The Event Log is the source of truth for business history and auditable
 *      domain decisions.
 *   2. The durable execution checkpoint exists to support operational recovery
 *      and workflow resumption.
 *   3. A checkpoint must NOT become a second competing source of truth for
 *      business facts.
 *   4. Transient implementation details should remain transient unless they
 *      are genuinely required to resume execution.
 *   5. The system must be able to distinguish business state from execution
 *      state.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── What is here, and what deliberately is not ────────────────────────────
 *
 * `ExecutionCheckpoint` (./recovery.ts) already existed before this file and
 * is **reused unchanged**. It models position inside the PORTAL — page,
 * section, step, completed sections — and its own comment says it exists so
 * that *"resume" has somewhere to resume to*.
 *
 * What it does not model is position inside the WORKFLOW: interviewing,
 * authorising, filling, handing over. Those are two different axes and a
 * resume needs both — you can be on page 3 of the portal, or you can be
 * waiting for a student to approve a preview, and neither describes the other.
 *
 * So `WorkflowCheckpoint` composes the existing portal checkpoint with a
 * workflow phase. Nothing about `ExecutionCheckpoint` changes.
 *
 * ── Rule 3 is enforced by the TYPES, not by discipline ────────────────────
 *
 * A checkpoint may hold **position**, never **facts**. The distinction is not
 * a guideline here: `CheckpointValue` admits only strings, numbers, booleans
 * and null, so a `ConfirmedValue`, a `PreviewDocument`, a `SecretHandle` or a
 * profile entry cannot be put into one. A compile-time test asserts each.
 *
 * The reason for going this far: a checkpoint is written constantly and read
 * after a crash, which makes it exactly the place where someone under time
 * pressure would stash "just one more thing to make resume easier". The first
 * such thing is a business fact, and then there are two sources of truth.
 */

import type { BlueprintVersion, CaseId, StudentId } from "./ids.js";
import type { ExecutionCheckpoint } from "./recovery.js";
import type { Brand } from "./brand.js";

// ───────────────────────────────────────────────────────────────────────────
// Identity
// ───────────────────────────────────────────────────────────────────────────

/**
 * One attempt to execute a case.
 *
 * A case may have several runs. `RecoveryResolution` with
 * `outcome: "route_fallback"` explicitly switches route, and a reapplication
 * increments `attemptOrdinal` — in both cases the case is the same
 * application and the run is a new attempt at it.
 */
export type RunId = Brand<string, "RunId">;

export function runId(value: string): RunId {
  if (value.trim().length === 0) {
    throw new Error("A runId must not be empty. It is how a crashed run is found again.");
  }
  return value as RunId;
}

/**
 * The key that makes a consequential action at-most-once.
 *
 * Derived by the caller from the action and its target — never random, because
 * a random key regenerated after a restart would not match the intent record
 * written before the crash, which is the whole mechanism.
 */
export type IdempotencyKey = Brand<string, "WorkflowIdempotencyKey">;

export function idempotencyKeyFor(input: {
  readonly runId: RunId;
  readonly action: ConsequentialAction;
  /** What it acts on: a portal host, a field ref, a document id. */
  readonly target: string;
}): IdempotencyKey {
  return `${input.runId}:${input.action}:${input.target}` as IdempotencyKey;
}

// ───────────────────────────────────────────────────────────────────────────
// Where a run is, in the workflow
// ───────────────────────────────────────────────────────────────────────────

/**
 * The orchestrator's own axis of progress.
 *
 * Mirrors the order in `nextStep`, which is deliberate: a phase that did not
 * correspond to a real branch of the orchestrator would be a label nobody
 * could act on.
 */
export type WorkflowPhase =
  | "preparing_inputs"
  | "interviewing"
  | "awaiting_specialist"
  | "awaiting_secret"
  | "creating_account"
  | "awaiting_student_handoff"
  | "awaiting_authorisation"
  | "filling"
  | "ready_to_submit"
  | "handing_over";

export const WORKFLOW_PHASES: readonly WorkflowPhase[] = [
  "preparing_inputs",
  "interviewing",
  "awaiting_specialist",
  "awaiting_secret",
  "creating_account",
  "awaiting_student_handoff",
  "awaiting_authorisation",
  "filling",
  "ready_to_submit",
  "handing_over",
];

/**
 * What a run is doing right now.
 *
 * `uncertain` is the one that matters and the one a simpler design would omit.
 * It is not "failed" — a failed run can be retried, and retrying a run that may
 * already have created a portal account is the accident this whole phase
 * exists to prevent. See `ActionIntent`.
 */
export type WorkflowStatus =
  | "running"
  | "suspended"
  | "uncertain"
  | "escalated"
  | "completed"
  | "abandoned";

export const WORKFLOW_STATUSES: readonly WorkflowStatus[] = [
  "running",
  "suspended",
  "uncertain",
  "escalated",
  "completed",
  "abandoned",
];

/**
 * Which status moves are possible.
 *
 * `completed` and `abandoned` are terminal. `uncertain` may only be left for
 * `escalated` (a human will look) or `running` (verification established what
 * happened) — never straight to `completed`, because "we do not know" cannot
 * become "it worked" without somebody finding out.
 */
const NEXT_STATUS: Readonly<Record<WorkflowStatus, readonly WorkflowStatus[]>> = {
  running: ["suspended", "uncertain", "escalated", "completed", "abandoned"],
  suspended: ["running", "escalated", "abandoned"],
  uncertain: ["running", "escalated", "abandoned"],
  escalated: ["running", "abandoned"],
  completed: [],
  abandoned: [],
};

export function canTransitionStatus(from: WorkflowStatus, to: WorkflowStatus): boolean {
  return NEXT_STATUS[from].includes(to);
}

export function isTerminalStatus(status: WorkflowStatus): boolean {
  return NEXT_STATUS[status].length === 0;
}

// ───────────────────────────────────────────────────────────────────────────
// What a checkpoint may hold — enforced structurally
// ───────────────────────────────────────────────────────────────────────────

/**
 * The ONLY value types a checkpoint may contain.
 *
 * Primitives. Not `unknown`, not `object`, not a generic — because each of
 * those would admit a `ConfirmedValue`, a document, a profile entry or a
 * secret, and rule 3 would then rest on nobody doing it.
 */
export type CheckpointValue = string | number | boolean | null;

/**
 * Free-form position data a phase needs to resume.
 *
 * Deliberately narrow. If something does not fit in a primitive, that is a
 * strong signal it is a fact rather than a position — and facts belong in the
 * event log.
 */
export type CheckpointDetail = Readonly<Record<string, CheckpointValue>>;

/**
 * Where a run got to, durably.
 *
 * Everything here answers *where was it* and nothing answers *what is true*.
 * Deleting every checkpoint in the system must lose no business fact — only
 * the efficiency of not having to re-derive position. That is rule 3 stated as
 * a property, and it is tested.
 */
export interface WorkflowCheckpoint {
  /**
   * The shape of this checkpoint.
   *
   * A checkpoint written by an older or newer version is DISCARDED, never
   * guessed at: a half-understood resume point is worse than none, because it
   * produces confident wrong behaviour instead of an obvious restart.
   */
  readonly schemaVersion: 1;
  readonly phase: WorkflowPhase;
  /**
   * Position inside the portal, when the run is filling one.
   *
   * The EXISTING `ExecutionCheckpoint`, reused unchanged. Absent in phases
   * that are not touching a portal — interviewing has no page.
   */
  readonly portal?: ExecutionCheckpoint;
  /**
   * Field refs already written to the portal AND read back successfully.
   *
   * Refs, never values. This is what replaces `RunState.filled?: boolean`,
   * which recorded a run that died after 40 of 60 fields identically to one
   * that died after none.
   */
  readonly fieldsCompleted: readonly string[];
  /** The blueprint this position refers to. A different one invalidates it. */
  readonly blueprintVersion: BlueprintVersion;
  /** Per-phase position. Primitives only. */
  readonly detail: CheckpointDetail;
  readonly capturedAt: Date;
}

// ───────────────────────────────────────────────────────────────────────────
// Consequential actions and the intent record
// ───────────────────────────────────────────────────────────────────────────

/**
 * Actions with effects outside this system that cannot simply be repeated.
 *
 * A closed union, because "is this consequential?" must be answered when the
 * action is written rather than guessed at recovery time. Filling a field is
 * absent deliberately: it is idempotent by value and verifiable by read-back,
 * so it needs no intent record.
 */
export type ConsequentialAction =
  /** Creates a real account on a real university portal. */
  | "create_portal_account"
  /** Uploads a document to an application. Duplicates are visible to admissions. */
  | "attach_document"
  /** Advances the portal. May create a draft application. */
  | "advance_portal_page"
  /** Single-use by construction; a spent handle is simply gone. */
  | "consume_secret"
  /** Present for completeness. Submission is out of scope and stays so. */
  | "submit_application";

export const CONSEQUENTIAL_ACTIONS: readonly ConsequentialAction[] = [
  "create_portal_account",
  "attach_document",
  "advance_portal_page",
  "consume_secret",
  "submit_application",
];

/**
 * Whether an action's outcome can be established afterwards by looking.
 *
 * This decides what a resume may do with an uncertain action, so it is data
 * rather than a judgement made in the moment:
 *
 *   verifiable  → look first, act only if it did not happen
 *   not         → **escalate**. Never repeat, never assume.
 *
 * `consume_secret` is the hard one and the reason this table exists. A spent
 * handle leaves no trace to inspect: the store destroyed it, and the portal
 * cannot tell us whether the password it received came from us. So a run that
 * may have spent a secret asks the student again rather than guessing.
 */
const VERIFIABLE: Readonly<Record<ConsequentialAction, boolean>> = {
  // Attempting a sign-in establishes whether the account exists.
  create_portal_account: true,
  // The application page lists its attachments.
  attach_document: true,
  // The current URL says which page we are on.
  advance_portal_page: true,
  // Nothing to look at. The handle is destroyed and the portal will not say.
  consume_secret: false,
  // Out of scope, and it would be the most consequential of all.
  submit_application: false,
};

export function isVerifiable(action: ConsequentialAction): boolean {
  return VERIFIABLE[action];
}

/**
 * A record that an action is ABOUT to happen.
 *
 * Written durably **before** the action, completed durably **after**. The gap
 * between them is the uncertainty window, and the record is what makes that
 * window detectable — which is the most any system can do, since a process can
 * always die between an external success and our recording of it.
 */
export interface ActionIntent {
  readonly idempotencyKey: IdempotencyKey;
  readonly action: ConsequentialAction;
  /** What it acts on. A host, a field ref, a document id. Never a value. */
  readonly target: string;
  readonly startedAt: Date;
}

export type IntentOutcome = "succeeded" | "failed_cleanly";

/**
 * What a resume must do about an action it finds unfinished.
 *
 * Returned by `assessIntent` so the decision is one function with one test,
 * rather than a branch repeated at every call site — which is how "just retry
 * it" gets added in one place and not noticed.
 */
export type IntentVerdict =
  /** No intent record. It provably did not happen. */
  | { readonly kind: "not_started" }
  /** Completed and recorded. Do not repeat. */
  | { readonly kind: "already_done"; readonly outcome: IntentOutcome }
  /** Started, no completion, and it can be checked. Look before acting. */
  | { readonly kind: "verify_first"; readonly action: ConsequentialAction }
  /** Started, no completion, and nothing can establish what happened. */
  | { readonly kind: "escalate"; readonly action: ConsequentialAction; readonly why: string };

/**
 * Decides what to do about an action found unfinished after a restart.
 *
 * **There is no branch that returns "retry it".** That absence is the safety
 * property: an unverifiable consequential action that may already have
 * happened is handed to a human, because the alternative is creating a second
 * university account for a student who already has one.
 */
export function assessIntent(input: {
  readonly intent?: ActionIntent;
  readonly completed?: { readonly outcome: IntentOutcome };
}): IntentVerdict {
  if (input.intent === undefined) return { kind: "not_started" };
  if (input.completed !== undefined) {
    return { kind: "already_done", outcome: input.completed.outcome };
  }
  const { action } = input.intent;
  if (isVerifiable(action)) return { kind: "verify_first", action };
  return {
    kind: "escalate",
    action,
    why:
      `A "${action}" was started and no completion was recorded. It cannot be checked ` +
      `afterwards, so whether it happened is unknowable from here. Repeating it could act twice ` +
      `on a real university application; assuming it failed could lose work. A specialist looks ` +
      `at the portal and says which it was.`,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// The run record
// ───────────────────────────────────────────────────────────────────────────

/**
 * One attempt to execute a case, as persisted.
 *
 * Note what is NOT here: no profile, no documents, no blueprint, no mapping
 * set, no secret. Those are business facts or large reviewed artefacts, and
 * they belong to the event log, the vault and the reviewed-artefact store
 * respectively. A run record is an operational pointer.
 */
export interface WorkflowRunRecord {
  readonly runId: RunId;
  readonly caseId: CaseId;
  readonly studentRef: StudentId;
  readonly status: WorkflowStatus;
  readonly checkpoint: WorkflowCheckpoint;
  /**
   * Optimistic-concurrency token, incremented on every checkpoint save.
   *
   * The same mechanism as `CaseStore.append`'s `expectedSequence`, for the
   * same reason: two processes resuming one run must not both win.
   */
  readonly revision: number;
  readonly startedAt: Date;
  readonly updatedAt: Date;
}

/** A fresh checkpoint for a run that has just started. */
export function beginCheckpoint(input: {
  readonly blueprintVersion: BlueprintVersion;
  readonly now: Date;
}): WorkflowCheckpoint {
  return {
    schemaVersion: 1,
    phase: "preparing_inputs",
    fieldsCompleted: [],
    blueprintVersion: input.blueprintVersion,
    detail: {},
    capturedAt: input.now,
  };
}

/** The schema version this build writes and can read. */
export const CHECKPOINT_SCHEMA_VERSION = 1;

/**
 * Whether a checkpoint read from storage can be trusted by this build.
 *
 * Anything else is DISCARDED and the run re-derives its position from the
 * event log. Slower, never wrong — and the alternative, guessing at a
 * half-understood checkpoint, produces confident wrong behaviour.
 */
export function isReadableCheckpoint(value: unknown): value is WorkflowCheckpoint {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate["schemaVersion"] !== CHECKPOINT_SCHEMA_VERSION) return false;
  if (typeof candidate["phase"] !== "string") return false;
  if (!WORKFLOW_PHASES.includes(candidate["phase"] as WorkflowPhase)) return false;
  if (!Array.isArray(candidate["fieldsCompleted"])) return false;
  if (!candidate["fieldsCompleted"].every((entry) => typeof entry === "string")) return false;
  if (typeof candidate["blueprintVersion"] !== "string") return false;
  if (!(candidate["capturedAt"] instanceof Date)) return false;
  return true;
}
