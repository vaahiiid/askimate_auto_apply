/**
 * Making a run survive the process that started it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Phase 3 of the approved durable-execution plan. The constraint that shapes
 * this file: **`assess` and `nextStep` stay pure.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why purity is worth designing around ──────────────────────────────────
 *
 * `assess(state)` and `nextStep(state, model)` take a `RunState` and return a
 * decision. No I/O, no database, no browser. That is why the orchestrator has
 * 38 tests that run in 40 milliseconds and why a specialist console could
 * inspect a case without side effects.
 *
 * Persistence therefore **wraps** them rather than entering them. This file
 * has all the I/O; the decision functions are untouched, and a reader can
 * still answer "what would this run do next?" by reading one pure function.
 *
 * ── What is checkpointed, and what is emphatically not ────────────────────
 *
 * A checkpoint holds POSITION. The event log holds FACTS. So:
 *
 *   phase, fields already written, page position  →  checkpoint
 *   the student authorised this exact content     →  event log
 *   the student confirmed this answer             →  event log (by reference)
 *
 * `deriveCheckpoint` below maps a `RunStep` to a phase and nothing else. It
 * cannot put a fact in a checkpoint because `CheckpointDetail` admits only
 * primitives — and `scripts/check-boundaries.ts` fails the build if that type
 * is ever widened.
 *
 * ── The reconciliation rule ───────────────────────────────────────────────
 *
 * On resume, if the checkpoint disagrees with the event log, **the event log
 * wins and the checkpoint is discarded**. Slower, never wrong. A checkpoint
 * that claimed a page the log contradicts is a checkpoint written by a build
 * that no longer exists, or corrupted, and trusting it means acting on a
 * position that was never real.
 */

import {
  beginCheckpoint,
  isEventOfType,
  runId as makeRunId,
} from "@askimate/aas-domain";
import type {
  BlueprintVersion,
  CaseEvent,
  CaseId,
  CaseState,
  RunId,
  StudentId,
  WorkflowCheckpoint,
  WorkflowPhase,
  WorkflowRunRecord,
} from "@askimate/aas-domain";
import type { CaseStore } from "@askimate/aas-case-store";
import type { WorkflowRunStore } from "@askimate/aas-case-store/workflow";

import type { RunState, RunStep } from "./run.js";

/**
 * Which workflow phase a decision corresponds to.
 *
 * A total mapping over `RunStep["kind"]`, so a new step forces a decision
 * about where it sits rather than silently checkpointing as something else.
 * The switch is exhaustive and TypeScript enforces that.
 */
/**
 * The case states a healthy run walks, in order (ADR-0049 §1).
 *
 * An explicit spine, NOT a shortest-path search over `ALLOWED_TRANSITIONS`. A
 * graph walk would be shorter to write and would happily route a case through a
 * state nobody intended — `AWAITING_HUMAN_REVIEW` is on several paths, and
 * arriving there by pathfinding rather than by decision is exactly the kind of
 * thing that is discovered a year later in a real case.
 *
 * This list says where a healthy case goes. Anything not on it is a refusal to
 * surface, not a route to find.
 */
export const CASE_SPINE: readonly CaseState[] = [
  "INTAKE",
  "REQUIREMENTS_RESOLUTION",
  "ELIGIBILITY_REVIEW",
  "READY_TO_PREPARE",
  "PREPARING",
  "AWAITING_STUDENT_AUTHORISATION",
  "AUTHORISED",
];

/**
 * How far along the spine a run's phase belongs.
 *
 * ── Why the run authorises BEFORE it fills, and the case says otherwise ───
 *
 * The case machine reads `PREPARING` → `AWAITING_STUDENT_AUTHORISATION` →
 * `AUTHORISED` → `SUBMITTING`: fill, approve, submit. The run approves first.
 *
 * They agree once submission is out of scope (ADR-0014). What the student
 * approves is the exact content that WOULD be submitted, rendered from the
 * plan; the fill is us typing that approved content into the portal. So
 * `PREPARING` is building the plan, `AWAITING_STUDENT_AUTHORISATION` is the
 * preview in front of the student, and everything after — filling included — is
 * `AUTHORISED`. The run stops at the `AUTHORISED → SUBMITTING` edge, which is
 * where ADR-0014 says stop.
 *
 * Total over `WorkflowPhase`, so a new phase forces a decision about where it
 * sits rather than defaulting to somewhere plausible.
 */
export function caseStateFor(phase: WorkflowPhase): CaseState {
  switch (phase) {
    case "preparing_inputs":
    case "interviewing":
      // Still collecting from the student. Nothing has been prepared.
      return "INTAKE";
    case "awaiting_specialist":
      // A blueprint or mapping set a specialist must look at (ADR-0017). The
      // case is not stuck in the machine's sense; it is waiting on curation,
      // which is where `READY_TO_PREPARE` sits.
      return "READY_TO_PREPARE";
    case "awaiting_secret":
    case "creating_account":
    case "awaiting_student_handoff":
      return "PREPARING";
    case "awaiting_authorisation":
      return "AWAITING_STUDENT_AUTHORISATION";
    case "filling":
    case "ready_to_submit":
    case "handing_over":
      return "AUTHORISED";
  }
}

/**
 * The next hop toward a target, or `null` when there is nothing to do.
 *
 * Forward along the spine ONLY, one state at a time. Never backwards: a case
 * that has been authorised does not become un-prepared because a later phase
 * reads earlier, and moving it back would void an authorisation the student
 * gave (`void_authorisation` is a separate, deliberate act).
 */
export function nextCaseHop(current: CaseState, target: CaseState): CaseState | null {
  const from = CASE_SPINE.indexOf(current);
  const to = CASE_SPINE.indexOf(target);
  // A case that has left the spine — recovery, cancellation, a terminal state —
  // is not walked back onto it by this function. Whatever put it there decides.
  if (from === -1 || to === -1 || to <= from) return null;
  return CASE_SPINE[from + 1] ?? null;
}

/**
 * Where a case belongs when the run is standing at this step.
 *
 * The composition of `phaseFor` and `caseStateFor`, and it lives here rather
 * than at the call site because both halves do. `check-boundaries` bans
 * `phaseFor(` in the Run Driver for the reason it bans `step.kind`: a
 * coordinator deriving a phase would be a second implementation of a decision
 * that already has one pure home, and it would drift the first time a step's
 * phase changed.
 */
export function caseStateForStep(step: RunStep): CaseState {
  return caseStateFor(phaseFor(step));
}

export function phaseFor(step: RunStep): WorkflowPhase {
  switch (step.kind) {
    case "interview":
      return "interviewing";
    case "specialist":
      return "awaiting_specialist";
    case "fix_content":
      // Back to the student, but through the interview surface — a personal
      // statement over the limit is theirs to shorten.
      return "interviewing";
    case "request_secret":
      return "awaiting_secret";
    case "create_account":
      return "creating_account";
    case "student_handoff":
      return "awaiting_student_handoff";
    case "authorise":
      return "awaiting_authorisation";
    case "execute":
      return "filling";
    case "ready_to_submit":
      return "ready_to_submit";
    case "hand_over_account":
      return "handing_over";
  }
}

/**
 * The checkpoint for a run that has just decided what to do next.
 *
 * Position only. Note what is NOT copied from the step: no preview, no
 * `contentHash`, no `say` text, no plan. A `contentHash` in particular is
 * tempting — it is short and it identifies what was authorised — and it is a
 * business fact that already lives in `AuthorisationCaptured`. Two copies is
 * two sources of truth.
 */
export function deriveCheckpoint(input: {
  readonly previous: WorkflowCheckpoint;
  readonly step: RunStep;
  readonly fieldsCompleted?: readonly string[];
  readonly now: Date;
}): WorkflowCheckpoint {
  return {
    ...input.previous,
    phase: phaseFor(input.step),
    fieldsCompleted: input.fieldsCompleted ?? input.previous.fieldsCompleted,
    capturedAt: input.now,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Starting and resuming
// ───────────────────────────────────────────────────────────────────────────

export interface DurableStores {
  readonly cases: CaseStore;
  readonly runs: WorkflowRunStore;
}

/** Starts a run and records it, so a crash one line later is recoverable. */
export async function startRun(input: {
  readonly stores: DurableStores;
  readonly runId?: RunId;
  readonly caseId: CaseId;
  readonly studentRef: StudentId;
  /**
   * The branded blueprint version.
   *
   * `ApplicationBlueprint.version` is a plain `string`, so the caller converts
   * with `blueprintVersion(blueprint.version)`. That conversion is deliberately
   * theirs rather than done silently here: the brand asserts *this string
   * identifies a blueprint revision*, and the caller is the one in a position
   * to assert it.
   */
  readonly blueprintVersion: BlueprintVersion;
  readonly now: Date;
}): Promise<WorkflowRunRecord> {
  return input.stores.runs.start({
    runId: input.runId ?? makeRunId(`run_${input.caseId}_${String(input.now.getTime())}`),
    caseId: input.caseId,
    studentRef: input.studentRef,
    status: "running",
    checkpoint: beginCheckpoint({ blueprintVersion: input.blueprintVersion, now: input.now }),
    startedAt: input.now,
  });
}

/** Why a resume could not proceed as-is. Not errors — outcomes. */
export type ResumeConcern =
  /** The checkpoint was unreadable or contradicted the log; position re-derived. */
  | { readonly kind: "checkpoint_discarded"; readonly detail: string }
  /** The blueprint moved since the checkpoint was written. */
  | { readonly kind: "blueprint_changed"; readonly detail: string };

export interface ResumedRun {
  readonly record: WorkflowRunRecord;
  /** The events the case has, so a caller can fold them. */
  readonly events: readonly CaseEvent[];
  /** Anything the resume had to do about a checkpoint it could not trust. */
  readonly concerns: readonly ResumeConcern[];
}

/**
 * Loads a run and reconciles its checkpoint against the event log.
 *
 * **The event log wins.** Every disagreement discards the checkpoint, which
 * costs a re-derivation and never costs correctness.
 *
 * Note what this does NOT do: it does not rebuild `RunState`. `RunState`
 * carries a `ConfirmedProfile`, and `ConfirmationCaptured` events carry a
 * *reference*, not a value — a deliberate existing decision that the event log
 * is not a copy of the profile. So the profile must still be supplied by the
 * caller. **That gap is Phase 5 and is explicitly open**; pretending to close
 * it here would mean either copying profile data into the log or into a
 * checkpoint, and both are the thing this architecture forbids.
 */
export async function resumeRun(input: {
  readonly stores: DurableStores;
  readonly runId: RunId;
  readonly expectedBlueprintVersion: BlueprintVersion;
  readonly now: Date;
}): Promise<ResumedRun | null> {
  const record = await input.stores.runs.load(input.runId);
  if (record === null) return null;

  const events = await input.stores.cases.read(record.caseId);
  const concerns: ResumeConcern[] = [];

  // ── Reconciliation ──────────────────────────────────────────────────
  //
  // The store already discarded a checkpoint it could not READ. This catches
  // the subtler case: a readable checkpoint that disagrees with the log.
  let checkpoint = record.checkpoint;

  if (checkpoint.blueprintVersion !== input.expectedBlueprintVersion) {
    concerns.push({
      kind: "blueprint_changed",
      detail:
        `The checkpoint was written against blueprint ${checkpoint.blueprintVersion} and this run ` +
        `is executing ${input.expectedBlueprintVersion}. A page position from one revision means ` +
        `nothing in another, so the position is discarded and re-derived. What the student ` +
        `authorised is unaffected — that is in the event log.`,
    });
    checkpoint = beginCheckpoint({
      blueprintVersion: input.expectedBlueprintVersion,
      now: input.now,
    });
  }

  // A checkpoint claiming the run got past authorisation, with no
  // AuthorisationCaptured in the log, is a checkpoint describing something
  // that did not happen. The log is the truth about what the student agreed
  // to, so the position goes.
  const authorised = events.some((event) => isEventOfType(event, "AuthorisationCaptured"));
  const pastAuthorisation: readonly WorkflowPhase[] = ["filling", "ready_to_submit"];
  if (!authorised && pastAuthorisation.includes(checkpoint.phase)) {
    concerns.push({
      kind: "checkpoint_discarded",
      detail:
        `The checkpoint says the run reached "${checkpoint.phase}", but the event log has no ` +
        `AuthorisationCaptured. Nothing may be filled before the student authorises the exact ` +
        `content, so the checkpoint describes a position that never legitimately existed. It is ` +
        `discarded and the run re-derives from the log.`,
    });
    checkpoint = beginCheckpoint({
      blueprintVersion: checkpoint.blueprintVersion,
      now: input.now,
    });
  }

  if (checkpoint !== record.checkpoint) {
    await input.stores.runs.discardCheckpoints(input.runId);
    const reset = await input.stores.runs.load(input.runId);
    return { record: reset ?? { ...record, checkpoint }, events, concerns };
  }

  return { record, events, concerns };
}

/**
 * Records where a run has got to, after a decision.
 *
 * Called by whoever drives `nextStep`, which stays pure. Returns the new
 * revision so the caller can pass it to the next save — the same optimistic
 * concurrency the case store uses, and for the same reason.
 */
export async function checkpointAfter(input: {
  readonly stores: DurableStores;
  readonly record: WorkflowRunRecord;
  readonly step: RunStep;
  readonly fieldsCompleted?: readonly string[];
  readonly now: Date;
}): Promise<number> {
  return input.stores.runs.saveCheckpoint({
    runId: input.record.runId,
    checkpoint: deriveCheckpoint({
      previous: input.record.checkpoint,
      step: input.step,
      ...(input.fieldsCompleted === undefined ? {} : { fieldsCompleted: input.fieldsCompleted }),
      now: input.now,
    }),
    expectedRevision: input.record.revision,
  });
}

/**
 * Whether a resumed run should continue automatically.
 *
 * `uncertain` and `escalated` runs stop. A run that may have created a portal
 * account is not something to carry on with because the code path happens to
 * be open.
 */
export function mayContinue(record: WorkflowRunRecord): boolean {
  return record.status === "running" || record.status === "suspended";
}

/** A `RunState` with the resumed position attached. */
export function withCheckpoint(state: RunState, record: WorkflowRunRecord): RunState {
  return { ...state, run: { runId: record.runId, revision: record.revision, checkpoint: record.checkpoint } };
}
