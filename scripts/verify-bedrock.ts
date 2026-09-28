/**
 * What can this AWS account actually use?
 *
 *   pnpm run verify-bedrock
 *
 * ── Why this script exists ────────────────────────────────────────────────
 *
 * Vahid, 2026-08-26: *"Do not assume a model is available. Verify the available
 * options when the relevant AWS access exists."*
 *
 * Bedrock model availability is not a fact about Claude — it is a fact about
 * one AWS account in one region at one moment. It varies by region, by whether
 * the account has requested access to a model family, and by whether the model
 * is reachable directly or only through an inference profile. Writing a model
 * ID into the code from memory is a guess that fails at run time, on a real
 * student's case.
 *
 * So this reads the answer out of the account and prints it. It picks nothing.
 *
 * ── It is read-only ───────────────────────────────────────────────────────
 *
 * Three calls, all `List`/`Get`: STS caller identity, ListFoundationModels,
 * ListInferenceProfiles. It requests no model access, invokes no model, and
 * costs nothing.
 *
 * ── This lists the service the client calls, and checks the configuration against it ──
 *
 * P243, row 101: two services answer to "Bedrock". This script's two `List`
 * calls are the InvokeModel service's (`bedrock-runtime`); the client had been
 * calling the other one, and an id listed here as ACTIVE was answered "does not
 * exist" there. P244, on Vahid's word — *"verify-bedrock and the client must
 * read the same list"* — the client calls the InvokeModel service, and section
 * 4 checks each configured id against the lists just read, by identity.
 */

import {
  BedrockClient,
  ListFoundationModelsCommand,
  ListInferenceProfilesCommand,
  type FoundationModelSummary,
  type InferenceProfileSummary,
} from "@aws-sdk/client-bedrock";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";

import {
  MODEL_WORKLOADS,
  REGION_ENV_VAR,
  WORKLOAD_ENV_VARS,
  bedrockRuntimeBaseURL,
  listedAs,
  type ModelWorkload,
} from "@askimate/aas-llm";

const DIM = "[2m";
const BOLD = "[1m";
const GREEN = "[32m";
const AMBER = "[33m";
const RED = "[31m";
const RESET = "[0m";

/**
 * What each workload needs from a model.
 *
 * Written down so the choice is a judgement made against stated criteria rather
 * than a preference. When the real list arrives, these are what it is read
 * against.
 */
const WORKLOAD_CRITERIA: Readonly<Record<ModelWorkload, readonly string[]>> = {
  interview: [
    "Long context — the whole conversation so far, plus what the application needs",
    "Careful phrasing; picks up on what a student half-said and asks the better next question",
    "Latency is visible to the student, so it must be quick enough to feel like a conversation",
  ],
  interpretation: [
    "Strict tool use / structured outputs — the reading must validate against a schema",
    "Short prompts, high volume: this runs on every student reply",
    "Cost matters most here, because it is the most frequent call in the system",
  ],
  document_extraction: [
    "Strict tool use / structured outputs",
    "Tolerates OCR noise without smoothing it over — a misread digit must read as a misread",
    "Copies spans EXACTLY (ADR-0016 discards a reading whose quoted span is not in the document,",
    "  so a model that paraphrases its quotes will simply fail every extraction)",
    "Long context — a transcript can be several pages",
  ],
  navigation: [
    "Reasoning about a page's structure and an unexpected validation error",
    "The only workload where model output never goes near a form field, so the bar is capability",
    "  rather than caution",
  ],
};

function heading(title: string): void {
  console.log(`\n${BOLD}${title}${RESET}\n${DIM}${"─".repeat(74)}${RESET}`);
}

async function main(): Promise<void> {
  const region = process.env[REGION_ENV_VAR]?.trim() ?? process.env["AWS_REGION"]?.trim() ?? "eu-west-2";

  console.log(`\n${BOLD}Bedrock availability check${RESET}`);
  console.log(`${DIM}Region: ${region} · read-only · nothing is requested, invoked or changed${RESET}`);

  // ── Whose account is this? ──────────────────────────────────────────────
  heading("1 · Identity");

  let account = "unknown";
  try {
    const identity = await new STSClient({ region }).send(new GetCallerIdentityCommand({}));
    account = identity.Account ?? "unknown";
    console.log(`  ${GREEN}✓${RESET} Account ${BOLD}${account}${RESET}`);
    console.log(`  ${DIM}${identity.Arn ?? ""}${RESET}`);
  } catch (error) {
    console.log(`  ${RED}✗${RESET} Could not identify the caller: ${messageOf(error)}`);
    console.log(
      `\n  ${AMBER}No usable AWS credentials.${RESET} Nothing below can be verified, and nothing\n` +
        `  should be configured on the basis of what a model family is ${DIM}usually${RESET} called.\n` +
        `\n  Set credentials for the AskiMate AWS account and run this again.\n`,
    );
    process.exitCode = 1;
    return;
  }

  // ── What is available? ──────────────────────────────────────────────────
  heading("2 · Anthropic models this account can see — on the InvokeModel service (bedrock-runtime)");
  console.log(
    `  ${DIM}This list and the next are the InvokeModel service's, which is the service the client\n` +
      `  calls (${bedrockRuntimeBaseURL(region)}). Section 4 checks the configuration against them.${RESET}\n`,
  );

  const bedrock = new BedrockClient({ region });

  let models: readonly FoundationModelSummary[] = [];
  try {
    const response = await bedrock.send(
      new ListFoundationModelsCommand({ byProvider: "Anthropic" }),
    );
    models = response.modelSummaries ?? [];
  } catch (error) {
    console.log(`  ${RED}✗${RESET} ListFoundationModels failed: ${messageOf(error)}`);
    process.exitCode = 1;
    return;
  }

  if (models.length === 0) {
    console.log(
      `  ${AMBER}None.${RESET} Either no Anthropic models are enabled for this account in\n` +
        `  ${region}, or model access has not been requested. Both are answers — neither is a\n` +
        `  reason to guess an ID.`,
    );
  }

  for (const model of models) {
    const streaming = model.responseStreamingSupported === true ? "streaming" : "no streaming";
    const modalities = (model.inputModalities ?? []).join("+") || "?";
    const lifecycle = model.modelLifecycle?.status ?? "?";
    const flag = lifecycle === "ACTIVE" ? `${GREEN}✓${RESET}` : `${AMBER}·${RESET}`;
    console.log(`  ${flag} ${BOLD}${model.modelId ?? "?"}${RESET}`);
    console.log(`    ${DIM}${model.modelName ?? ""} · ${modalities} in · ${streaming} · ${lifecycle}${RESET}`);
  }

  // ── Inference profiles ──────────────────────────────────────────────────
  heading("3 · Inference profiles — on the InvokeModel service");
  console.log(
    `  ${DIM}Newer models are often reachable only through a profile ID rather than a bare\n` +
      `  model ID. If a model above will not invoke, its profile is usually why.${RESET}\n`,
  );

  let profiles: readonly InferenceProfileSummary[] = [];
  try {
    const response = await bedrock.send(new ListInferenceProfilesCommand({}));
    profiles = (response.inferenceProfileSummaries ?? []).filter((profile) =>
      (profile.inferenceProfileId ?? "").toLowerCase().includes("anthropic"),
    );
  } catch (error) {
    console.log(`  ${AMBER}·${RESET} ListInferenceProfiles failed: ${messageOf(error)}`);
  }

  if (profiles.length === 0) {
    console.log(`  ${DIM}(none carrying "anthropic" in the id)${RESET}`);
  }
  for (const profile of profiles) {
    console.log(`  ${GREEN}✓${RESET} ${BOLD}${profile.inferenceProfileId ?? "?"}${RESET}`);
    console.log(`    ${DIM}${profile.inferenceProfileName ?? ""} · ${profile.status ?? "?"}${RESET}`);
  }

  // ── The configuration, against the lists just read ──────────────────────
  heading("4 · What is configured, against the lists above");
  console.log(
    `  ${BOLD}${bedrockRuntimeBaseURL(region)}${RESET}\n` +
      `  ${DIM}The client calls this — the InvokeModel service — so the two lists above are its list.\n` +
      `  Each configured id is looked up in them by identity; nothing is inferred from its shape.${RESET}\n`,
  );
  const listed = {
    models: models.map((model) => model.modelId ?? "").filter((id) => id.length > 0),
    profiles: profiles.map((profile) => profile.inferenceProfileId ?? "").filter((id) => id.length > 0),
  };
  for (const workload of MODEL_WORKLOADS) {
    const variable = WORKLOAD_ENV_VARS[workload];
    const value = process.env[variable]?.trim();
    if (value === undefined || value.length === 0) {
      console.log(`  ${DIM}·${RESET} ${variable} ${DIM}unset${RESET}`);
      continue;
    }
    const where = listedAs(value, listed);
    const verdict =
      where === "model"
        ? `${GREEN}✓${RESET} listed in section 2 (a model this account can see)`
        : where === "profile"
          ? `${GREEN}✓${RESET} listed in section 3 (an inference profile this account can see)`
          : `${RED}✗${RESET} NOT LISTED — the account returned no model and no profile with this id`;
    console.log(`  ${verdict}\n    ${DIM}${variable}=${value}${RESET}`);
  }

  // ── What to choose against ──────────────────────────────────────────────
  heading("5 · What each workload needs");

  for (const workload of MODEL_WORKLOADS) {
    console.log(`  ${BOLD}${workload}${RESET}  ${DIM}${WORKLOAD_ENV_VARS[workload]}${RESET}`);
    for (const criterion of WORKLOAD_CRITERIA[workload]) {
      console.log(`    · ${criterion}`);
    }
    console.log();
  }

  // ── The configuration to write ──────────────────────────────────────────
  heading("6 · What to set once you have chosen");

  console.log(
    `  ${DIM}Deliberately not filled in. Choose from section 2/3 against the criteria in\n` +
      `  section 5, then record the choice and the reasoning in ADR-0018.${RESET}\n`,
  );
  console.log(`  export ${REGION_ENV_VAR}=${region}`);
  for (const workload of MODEL_WORKLOADS) {
    console.log(`  export ${WORKLOAD_ENV_VARS[workload]}=<an id from section 2 or 3>`);
  }

  console.log(
    `\n  ${DIM}Then: pnpm run interview-demo --live   (a real conversation, against Bedrock)${RESET}\n`,
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

await main();
