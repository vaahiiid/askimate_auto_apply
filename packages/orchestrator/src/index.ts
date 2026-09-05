/**
 * @askimate/aas-orchestrator — the workflow, composed.
 *
 * Answers "what happens next?" and executes a plan against a portal. Renders
 * nothing, decides nothing on the student's behalf, and cannot submit.
 */

export type { HandoverEvidence, RunAssessment, RunInputs, RunState, RunStep } from "./run.js";
export {
  IllegalSecretTransitionError,
  accountCreated,
  accountWorkOf,
  assess,
  awaitsStudentAuthorisation,
  beginRun,
  handoffFor,
  interviewActionOf,
  handoffMessageOf,
  handoffTokenFor,
  browserWorkFor,
  executePlanOf,
  markFilled,
  nextStep,
  pageFillTarget,
  pageValuesOf,
  requiredFieldsFor,
  requiresSecureRequest,
  specialistHandoverOf,
  withAccount,
  withAuthorisation,
  withProfile,
  withSecret,
} from "./run.js";

// Re-exported, not owned. `executePlan` moved to `@askimate/aas-execution`
// (ADR-0046) so the Automation Runner can run it without taking this package's
// database driver and vault into its tree. Existing callers are unaffected.
export type {
  ApplicationSession,
  AuthorisedDocument,
  DocumentSource,
  ExecutionContext,
  ExecutionOutcome,
  ExecutionReport,
} from "@askimate/aas-execution";
export { executePlan, failures } from "@askimate/aas-execution";

// ── Phase 3: durable execution ───────────────────────────────────────────
//
// Persistence WRAPS the decision functions; it does not enter them. `assess`
// and `nextStep` remain pure, which is why the orchestrator is testable with
// no browser and no database.
export type { DurableStores, ResumeConcern, ResumedRun } from "./durable.js";
export {
  checkpointAfter,
  deriveCheckpoint,
  mayContinue,
  CASE_SPINE,
  caseStateFor,
  caseStateForStep,
  nextCaseHop,
  phaseFor,
  resumeRun,
  startRun,
  withCheckpoint,
} from "./durable.js";

// ── Phase 4: consequential-action safety ─────────────────────────────────
//
// There is no exported path that retries an unverifiable consequential action.
// That absence is the safety property.
export type { ActionOutcome, PerformOnceInput, VerificationResult, Verifier } from "./consequential.js";
export { performOnce, recordCleanFailure } from "./consequential.js";
