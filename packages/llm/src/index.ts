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

export type { BedrockConfig, ModelWorkload } from "./bedrock-config.js";
export {
  BedrockConfigurationError,
  MODEL_WORKLOADS,
  REGION_ENV_VAR,
  WORKLOAD_ENV_VARS,
  bedrockConfigFrom,
  isBedrockConfigured,
} from "./bedrock-config.js";

export type { ReadingToolInput } from "./bedrock-reading.js";
export { clampConfidence, toProposal } from "./bedrock-reading.js";

export type { BedrockClientOptions } from "./bedrock.js";
export { BedrockEmptyResponseError, BedrockModelClient } from "./bedrock.js";
