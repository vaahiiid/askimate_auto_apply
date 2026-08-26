/**
 * @askimate/aas-interview — application-aware questioning INSIDE AskiMate Chat.
 *
 * A capability, not an interface (ADR-0015). Nothing here renders anything: it
 * returns what to say, and AskiMate Chat presents it in the conversation the
 * student is already having.
 */

export type { InterviewAction, InterviewState, ReplyOutcome } from "./interview.js";
export {
  MAX_ATTEMPTS_PER_FIELD,
  newInterview,
  nextAction,
  receiveAnswer,
  receiveConfirmation,
  receiveExtractedValue,
  recordDocument,
} from "./interview.js";

export type { FieldSpec } from "./field-specs.js";
export { FIELD_SPECS } from "./field-specs.js";
