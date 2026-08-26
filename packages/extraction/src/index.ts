/**
 * @askimate/aas-extraction — reading student documents.
 *
 * Produces `ProposedValue`s and nothing else. The route from a document to an
 * application field passes through the student's confirmation, because only the
 * profile package can mint a `ConfirmedValue` (ADR-0004).
 *
 * The guarantee this package adds: a reading whose quoted span is not in the
 * document is DISCARDED. See ./grounding.ts.
 */

export type { DocumentText, DocumentTextExtractor, TextSource } from "./text.js";
export { PlainTextExtractor, fullText } from "./text.js";

export type { GroundingResult } from "./grounding.js";
export { MIN_EXCERPT_LENGTH, checkGrounding, isGrounded, normaliseForComparison } from "./grounding.js";

export type {
  CompositePart,
  CompositeTarget,
  DocumentDateKind,
  DocumentDateTarget,
  ExtractionPlan,
  ExtractionTarget,
  ScalarTarget,
} from "./plans.js";
export { DOCUMENT_TYPES_WITH_PLANS, planFor } from "./plans.js";

export type { ExtractionOutcome, ExtractionReport } from "./extract.js";
export {
  extractDocument,
  extracted,
  missingRequired,
  proposedFields,
  targetKeyOf,
  ungrounded,
} from "./extract.js";

export type { ConfirmedDocumentDates } from "./dates.js";
export { NO_DATES, documentDatesFrom } from "./dates.js";
