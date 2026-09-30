import { afterEach, describe, expect, it } from "vitest";

import { BedrockModelClient } from "@askimate/aas-llm";

import { demoModel, destinationLine } from "./model-for-demo.js";

const VARS = [
  "AAS_BEDROCK_MODEL_INTERVIEW",
  "AAS_BEDROCK_MODEL_INTERPRETATION",
  "AAS_BEDROCK_MODEL_DOCUMENT_EXTRACTION",
  "AAS_BEDROCK_MODEL_NAVIGATION",
] as const;

function clearConfig(): void {
  for (const variable of VARS) delete process.env[variable];
  delete process.env["AAS_BEDROCK_REGION"];
}

afterEach(clearConfig);

describe("which model a demo runs against", () => {
  it("uses the deterministic stand-in by default", () => {
    clearConfig();
    const model = demoModel(["node", "demo"]);
    expect(model.live).toBe(false);
    expect(model.description).toContain("Deterministic stand-in");
  });

  it("REFUSES --live when Bedrock is not configured, rather than falling back", () => {
    // The property that matters. Someone who asked for the real model and
    // silently got the fake one would draw conclusions from the wrong thing —
    // and the conclusion they would draw is "the model handles this fine".
    clearConfig();
    expect(() => demoModel(["node", "demo", "--live"])).toThrow(/not configured/);
  });

  it("names every missing variable, so the fix is one step", () => {
    clearConfig();
    process.env["AAS_BEDROCK_MODEL_INTERVIEW"] = "some-model";

    let message = "";
    try {
      demoModel(["node", "demo", "--live"]);
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }

    expect(message).not.toContain("AAS_BEDROCK_MODEL_INTERVIEW,");
    expect(message).toContain("AAS_BEDROCK_MODEL_DOCUMENT_EXTRACTION");
    expect(message).toContain("verify-bedrock");
  });

  it("builds a live client once every workload has a model", () => {
    clearConfig();
    for (const variable of VARS) process.env[variable] = "some-model-id";

    const model = demoModel(["node", "demo", "--live"]);
    expect(model.live).toBe(true);
    // Names what is actually running, so a demo can never be mistaken for the
    // other kind.
    expect(model.description).toContain("LIVE");
    expect(model.description).toContain("eu-west-2");
  });
});

// ── The banner names the configuration; the destination is said after (P243) ──
//
// Vahid, 2026-09-28: "the banner prints the configuration rather than the
// destination. If that is it, the banner is the defect… The banner should name
// what it actually called, after the call rather than before it."

describe("what the banner may claim, and what is said after the run (P243, row 101)", () => {
  it("says before the run that nothing has been called, and where the client is built to go", () => {
    clearConfig();
    for (const variable of VARS) process.env[variable] = "eu.anthropic.claude-sonnet-4-6";
    const model = demoModel(["node", "demo", "--live"]);
    expect(model.description).toContain("nothing has been called yet");
    // P244: the InvokeModel service — the one verify-bedrock lists.
    expect(model.description).toContain("https://bedrock-runtime.eu-west-2.amazonaws.com");
    expect(model.description).toContain("verify-bedrock lists");
    // The old banner's claim. A destination is a thing that happened, not a setting.
    expect(model.description).not.toContain("LIVE — Amazon Bedrock, eu-west-2");
    expect(model.description).not.toContain("went to");
  });

  it("says after the run what actually left the client — and says so for a failed call", async () => {
    const stand = demoModel(["node", "demo"]);
    expect(destinationLine(stand)).toContain("No request left the process");

    const seen: string[] = [];
    const config = {
      region: "eu-west-2",
      models: { interview: "m", interpretation: "m", document_extraction: "m", navigation: "m" },
    };
    process.env["AWS_ACCESS_KEY_ID"] = "AKIATESTNOTREAL0000000";
    process.env["AWS_SECRET_ACCESS_KEY"] = "not-a-real-secret";
    const client = new BedrockModelClient({
      config,
      fetch: (input: string | URL | Request) => {
        seen.push(input instanceof Request ? input.url : String(input));
        return Promise.resolve(
          new Response(JSON.stringify({ type: "error", request_id: "req_x", error: { type: "not_found_error", message: "The model 'm' does not exist" } }), {
            status: 404,
            headers: { "content-type": "application/json" },
          }),
        );
      },
    });
    const live = { client, live: true, description: "" };
    expect(destinationLine(live)).toContain("No request left the client");

    await expect(client.composeQuestion({ fieldKey: "surname", label: "surname", rationale: "r", question: "What is your surname?", conversationContext: [], previousAttempts: 0 })).rejects.toThrow(/does not exist/);
    const line = destinationLine(live);
    expect(line).toContain("1 request(s) went to https://bedrock-runtime.eu-west-2.amazonaws.com/model/m/invoke");
    expect(line).toContain("bedrock-runtime");
    delete process.env["AWS_ACCESS_KEY_ID"];
    delete process.env["AWS_SECRET_ACCESS_KEY"];
  });
});
