/**
 * Which model client a demo should use.
 *
 *   pnpm run interview-demo            the deterministic stand-in
 *   pnpm run interview-demo --live     the real thing, through Bedrock
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * The deterministic client makes the loop testable with no credentials, which
 * is what let everything downstream be built before the provider decision. But
 * it tells you nothing about whether a real model is any good at this — its
 * phrasing is a stand-in, and its readings are literal by construction.
 *
 * So the demos take `--live`, and the moment credentials and model IDs exist,
 * judging the real thing is one flag rather than a code change.
 *
 * ── The first thing to test ───────────────────────────────────────────────
 *
 *   pnpm run extraction-demo --live
 *
 * ADR-0016 discards any reading whose quoted span is not in the document. A
 * model that paraphrases its own quotations — "Surname: HOSSEINI" echoed back
 * as "the surname is HOSSEINI" — will fail EVERY extraction, and it will fail
 * silently as far as the student is concerned, because a discarded reading
 * simply becomes a question. Cheap to check, and the most likely surprise.
 */

import {
  BedrockModelClient,
  DeterministicModelClient,
  MODEL_WORKLOADS,
  WORKLOAD_ENV_VARS,
  bedrockConfigFrom,
  isBedrockConfigured,
  type ModelClient,
} from "@askimate/aas-llm";

const AMBER = "[33m";
const DIM = "[2m";
const RESET = "[0m";

export interface DemoModel {
  readonly client: ModelClient;
  readonly live: boolean;
  /** One line describing what is actually running, for the demo to print. */
  readonly description: string;
}

/**
 * Resolves the client from the command line and the environment.
 *
 * `--live` with an incomplete configuration is an ERROR, not a quiet fallback
 * to the stand-in. Someone who asked for the real model and silently got the
 * fake one would draw conclusions from the wrong thing.
 */
export function demoModel(argv: readonly string[] = process.argv): DemoModel {
  const live = argv.includes("--live");

  if (!live) {
    return {
      client: new DeterministicModelClient(),
      live: false,
      description:
        `${DIM}Deterministic stand-in — no credentials, no network, same output every time.\n` +
        `Pass --live to run this against Bedrock.${RESET}`,
    };
  }

  if (!isBedrockConfigured(process.env)) {
    const missing = MODEL_WORKLOADS.map((workload) => WORKLOAD_ENV_VARS[workload]).filter(
      (variable) => (process.env[variable] ?? "").trim().length === 0,
    );
    throw new Error(
      `${AMBER}--live was requested and Bedrock is not configured.${RESET}\n\n` +
        `Missing: ${missing.join(", ")}\n\n` +
        `Run "pnpm run verify-bedrock" to see what this AWS account can actually use, then set ` +
        `them. Falling back to the stand-in here would let you draw conclusions about a real ` +
        `model from a fake one, so it does not.`,
    );
  }

  const config = bedrockConfigFrom(process.env);
  const client = new BedrockModelClient({ config });

  return {
    client,
    live: true,
    description:
      `${AMBER}LIVE${RESET} — Amazon Bedrock, ${config.region}\n` +
      MODEL_WORKLOADS.map(
        (workload) => `${DIM}  ${workload.padEnd(20)} ${config.models[workload]}${RESET}`,
      ).join("\n"),
  };
}

/** Real usage, when the client reports it. */
export function usageLine(model: DemoModel): string {
  if (!model.live) return `${DIM}No model was called — the stand-in is local.${RESET}`;
  const client = model.client as BedrockModelClient;
  const usage = client.usage;
  return (
    `${String(usage.calls)} call(s) · ${String(usage.inputTokens)} in · ` +
    `${String(usage.outputTokens)} out · ${String(usage.cacheReadTokens)} from cache ` +
    `${DIM}(the provider's own figures, not estimates)${RESET}`
  );
}
