/**
 * @askimate/aas-orchestrator — the workflow, composed.
 *
 * Answers "what happens next?" and executes a plan against a portal. Renders
 * nothing, decides nothing on the student's behalf, and cannot submit.
 */

export type { RunAssessment, RunInputs, RunState, RunStep } from "./run.js";
export {
  assess,
  beginRun,
  markFilled,
  nextStep,
  requiredFieldsFor,
  withAccount,
  withAuthorisation,
  withProfile,
} from "./run.js";

export type {
  ApplicationSession,
  AuthorisedDocument,
  DocumentSource,
  ExecutionContext,
  ExecutionOutcome,
  ExecutionReport,
} from "./execute.js";
export { executePlan, failures } from "./execute.js";

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
  phaseFor,
  resumeRun,
  startRun,
  withCheckpoint,
} from "./durable.js";
