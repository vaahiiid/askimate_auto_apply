/**
 * Which model runs which workload, on Amazon Bedrock.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THERE IS NO DEFAULT MODEL, AND THAT IS DELIBERATE.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Vahid's instruction, 2026-08-26: *"Do not assume a model is available.
 * Verify the available options when the relevant AWS access exists."*
 *
 * A hardcoded model ID is exactly that assumption, written down. Bedrock model
 * availability varies by region, by account, and by whether the account has
 * requested access to a given model family — so an ID that works in one place
 * fails in another, and it fails at run time, on a real student's case.
 *
 * So configuration is REQUIRED and unresolved configuration throws at start-up
 * rather than mid-application. Run `pnpm run verify-bedrock` against an account
 * with real credentials to find out what that account can actually use.
 *
 * ── Four workloads, not one ───────────────────────────────────────────────
 *
 * They have genuinely different requirements, so they are configured
 * separately — and may well end up on different models:
 *
 *   interview            long conversational context, careful phrasing,
 *                        picking up on what a student half-said
 *   interpretation       turning one utterance into one structured value;
 *                        short, high-volume, latency-visible in a chat
 *   document_extraction  reading a passport or transcript, quoting spans
 *                        exactly; OCR noise tolerance matters most
 *   navigation           reasoning about a page — the only workload where
 *                        the model's output is never near a form field
 *
 * Setting all four to the same ID is a perfectly reasonable starting position.
 * Having to write it four times is the point: it is a choice, not a default.
 */

/** The four things this system asks a model to do. */
export type ModelWorkload =
  | "interview"
  | "interpretation"
  | "document_extraction"
  | "navigation";

export const MODEL_WORKLOADS: readonly ModelWorkload[] = [
  "interview",
  "interpretation",
  "document_extraction",
  "navigation",
];

/** Where each workload's model ID comes from. */
export const WORKLOAD_ENV_VARS: Readonly<Record<ModelWorkload, string>> = {
  interview: "AAS_BEDROCK_MODEL_INTERVIEW",
  interpretation: "AAS_BEDROCK_MODEL_INTERPRETATION",
  document_extraction: "AAS_BEDROCK_MODEL_DOCUMENT_EXTRACTION",
  navigation: "AAS_BEDROCK_MODEL_NAVIGATION",
};

export const REGION_ENV_VAR = "AAS_BEDROCK_REGION";

export interface BedrockConfig {
  /** AWS region. eu-west-2 (London) per ADR-0012, unless overridden. */
  readonly region: string;
  /** Bedrock model ID per workload. */
  readonly models: Readonly<Record<ModelWorkload, string>>;
}

export class BedrockConfigurationError extends Error {
  public override readonly name = "BedrockConfigurationError";
}

/**
 * Reads the configuration, or explains precisely what is missing.
 *
 * Deliberately loud. A silent fallback to some plausible model ID would make
 * "which model produced this reading?" unanswerable in an audit — and every
 * value a model touches in this system is auditable by design.
 */
export function bedrockConfigFrom(
  env: Readonly<Record<string, string | undefined>>,
): BedrockConfig {
  const missing: string[] = [];
  const models: Partial<Record<ModelWorkload, string>> = {};

  for (const workload of MODEL_WORKLOADS) {
    const variable = WORKLOAD_ENV_VARS[workload];
    const value = env[variable]?.trim();
    if (value === undefined || value.length === 0) {
      missing.push(variable);
    } else {
      models[workload] = value;
    }
  }

  if (missing.length > 0) {
    throw new BedrockConfigurationError(
      `No Bedrock model is configured for: ${missing.join(", ")}.\n\n` +
        `There is no default, on purpose: a hardcoded model ID is an assumption ` +
        `about what an AWS account can reach, and it fails at run time on a real ` +
        `student's case rather than at start-up.\n\n` +
        `Run "pnpm run verify-bedrock" against the account to see what it can ` +
        `actually use, then set these variables.`,
    );
  }

  return {
    // ADR-0012 — eu-west-2 (London). Overridable, because a model family may
    // not be available in London and the choice is then a real one, made and
    // recorded rather than silently defaulted.
    region: env[REGION_ENV_VAR]?.trim() ?? "eu-west-2",
    models: models as Record<ModelWorkload, string>,
  };
}

/**
 * The shape of a model id — a fact about the string, and nothing more.
 *
 * P243, row 101. Two AWS services answer to the word "Bedrock", and they take
 * different ids:
 *
 *   invoke_model   the InvokeModel / Converse service (`bedrock-runtime`), whose
 *                  ids carry a version suffix (`…-v1:0`), an inference-profile
 *                  prefix (`eu.`, `us.`, `global.`, …) or an ARN. This is the
 *                  service `verify-bedrock` lists.
 *   messages_api   the Messages-API endpoint ("Claude in Amazon Bedrock",
 *                  `bedrock-mantle`), whose documented ids are `anthropic.<model>`
 *                  with no prefix and no version. This is the service the
 *                  client calls.
 *
 * A shape says which service documents ids of that form. It does NOT say the id
 * is served: `anthropic.claude-sonnet-4-6` has the second shape and the endpoint
 * answered "does not exist" to it on 2026-09-28. Availability is measured by a
 * call; this only stops an id of one service being handed to the other without
 * a word.
 */
export type ModelIdShape = "invoke_model" | "messages_api" | "unknown";

/**
 * Where the Messages-API endpoint's model list lives. It has no list call —
 * its Models API is not served (ADR-0018) — so the documentation is the list,
 * and a call is the only proof.
 */
export const MESSAGES_API_MODELS_PAGE =
  "https://platform.claude.com/docs/en/build-with-claude/claude-in-amazon-bedrock#supported-models";

export function modelIdShape(id: string): ModelIdShape {
  const trimmed = id.trim();
  if (trimmed.startsWith("arn:aws:bedrock:")) return "invoke_model";
  if (/^(global|us|eu|apac|jp|au)\.anthropic\./.test(trimmed)) return "invoke_model";
  if (/-v\d+(:\d+)?$/.test(trimmed) || /:\d+$/.test(trimmed)) return "invoke_model";
  if (/^anthropic\.claude-[a-z0-9-]+$/.test(trimmed)) return "messages_api";
  return "unknown";
}

/** True when the environment carries a complete configuration. */
export function isBedrockConfigured(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  return MODEL_WORKLOADS.every((workload) => {
    const value = env[WORKLOAD_ENV_VARS[workload]]?.trim();
    return value !== undefined && value.length > 0;
  });
}
