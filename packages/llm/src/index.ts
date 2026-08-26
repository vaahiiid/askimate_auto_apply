/**
 * @askimate/aas-llm — the ONLY package permitted to call a language model.
 *
 * Everything it returns is either `ModelText` (written by the model, shown to a
 * human, never submitted) or `ProposedValue` (the model's interpretation of
 * something a human said, which must be confirmed before it enters the
 * profile). Neither can become a `ConfirmedValue`.
 */

export type {
  DocumentRequest,
  ExtractionRequest,
  InterpretationRequest,
  ModelClient,
  ModelUsage,
  NotUnderstood,
  QuestionRequest,
} from "./client.js";
export { MeteredModelClient, isNotUnderstood } from "./client.js";
export { DeterministicModelClient } from "./deterministic.js";
