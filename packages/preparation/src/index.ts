/**
 * @askimate/aas-preparation — validate, preview, authorise.
 *
 * The last three steps before submission, and the place the system stops:
 * nothing here submits anything.
 */

export type { ValidationResult, Violation } from "./validate.js";
export { isValid, validatePlan } from "./validate.js";

export type {
  PreviewAttachment,
  PreviewDocument,
  PreviewEntry,
  PreviewHandoff,
  PreviewRefusal,
  PreviewResult,
  SubmissionPreview,
} from "./preview.js";
export { buildPreview, renderPreview } from "./preview.js";

export type {
  AuthorisabilityCheck,
  AuthorisablePreview,
  AuthorisationLedger,
  AuthorisationRecord,
  AuthorisationRefusal,
} from "./authorisation.js";
export {
  AuthorisationNotFoundError,
  InMemoryAuthorisationLedger,
  checkAuthorisable,
  stillCovers,
} from "./authorisation.js";
