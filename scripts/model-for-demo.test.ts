import { afterEach, describe, expect, it } from "vitest";

import { demoModel } from "./model-for-demo.js";

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
