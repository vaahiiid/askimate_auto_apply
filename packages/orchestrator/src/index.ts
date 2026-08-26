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
  withAuthorisation,
  withProfile,
} from "./run.js";

export type {
  ApplicationSession,
  DocumentSource,
  ExecutionOutcome,
  ExecutionReport,
} from "./execute.js";
export { executePlan, failures } from "./execute.js";
