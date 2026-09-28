import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrapProposed } from "@askimate/aas-domain";

import {
  BedrockConfigurationError,
  MODEL_WORKLOADS,
  WORKLOAD_ENV_VARS,
  bedrockConfigFrom,
  isBedrockConfigured,
  listedAs,
} from "./bedrock-config.js";
import { clampConfidence, toProposal } from "./bedrock-reading.js";
import { BedrockModelClient, bedrockRuntimeBaseURL } from "./bedrock.js";
import { isNotUnderstood } from "./client.js";

const COMPLETE_ENV = {
  AAS_BEDROCK_MODEL_INTERVIEW: "model-a",
  AAS_BEDROCK_MODEL_INTERPRETATION: "model-b",
  AAS_BEDROCK_MODEL_DOCUMENT_EXTRACTION: "model-c",
  AAS_BEDROCK_MODEL_NAVIGATION: "model-d",
};

describe("Bedrock configuration", () => {
  it("reads a model for every workload", () => {
    const config = bedrockConfigFrom(COMPLETE_ENV);
    expect(config.models.interview).toBe("model-a");
    expect(config.models.document_extraction).toBe("model-c");
  });

  it("defaults to eu-west-2, the approved region", () => {
    expect(bedrockConfigFrom(COMPLETE_ENV).region).toBe("eu-west-2");
  });

  it("allows the region to be overridden, because a model may not be in London", () => {
    expect(
      bedrockConfigFrom({ ...COMPLETE_ENV, AAS_BEDROCK_REGION: "us-east-1" }).region,
    ).toBe("us-east-1");
  });

  it("REFUSES rather than falling back to a plausible model id", () => {
    // The whole point. A hardcoded default is an assumption about what an AWS
    // account can reach, and it fails at run time on a real student's case.
    expect(() => bedrockConfigFrom({})).toThrow(BedrockConfigurationError);
  });

  it("names every variable that is missing, so the fix is one step", () => {
    let message = "";
    try {
      bedrockConfigFrom({ AAS_BEDROCK_MODEL_INTERVIEW: "model-a" });
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }

    expect(message).not.toContain("AAS_BEDROCK_MODEL_INTERVIEW");
    expect(message).toContain("AAS_BEDROCK_MODEL_INTERPRETATION");
    expect(message).toContain("AAS_BEDROCK_MODEL_DOCUMENT_EXTRACTION");
    expect(message).toContain("AAS_BEDROCK_MODEL_NAVIGATION");
    expect(message).toContain("verify-bedrock");
  });

  it("treats whitespace as unset", () => {
    expect(() => bedrockConfigFrom({ ...COMPLETE_ENV, AAS_BEDROCK_MODEL_NAVIGATION: "   " })).toThrow(
      BedrockConfigurationError,
    );
  });

  it("has an env var for every workload, and no orphans", () => {
    expect(Object.keys(WORKLOAD_ENV_VARS).sort()).toEqual([...MODEL_WORKLOADS].sort());
  });

  it("reports whether the environment is complete without throwing", () => {
    expect(isBedrockConfigured(COMPLETE_ENV)).toBe(true);
    expect(isBedrockConfigured({})).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Reading a model's structured answer
// ───────────────────────────────────────────────────────────────────────────

/** Refuses an ambiguous date, exactly as the real field spec does. */
const parseUnambiguousDate = (raw: string): Date | null => {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  return iso === null ? null : new Date(`${raw.trim()}T00:00:00Z`);
};

describe("turning a model's answer into a proposal", () => {
  it("accepts a reading the parser accepts", () => {
    const result = toProposal({
      reading: { understood: true, value: "1999-04-02", verbatim: "2 April 1999", confidence: 0.9 },
      parse: parseUnambiguousDate,
      origin: "conversation",
      fallbackVerbatim: "…",
    });

    if (isNotUnderstood(result)) expect.unreachable("this parses");
    expect(unwrapProposed(result).value).toEqual(new Date("1999-04-02T00:00:00Z"));
    expect(unwrapProposed(result).verbatim).toBe("2 April 1999");
  });

  it("REFUSES a reading the parser rejects, at confidence 1.0", () => {
    // The failure mode that matters. A model is perfectly confident reading
    // 02/04/1999 — and April 2nd and February 4th are different days.
    const result = toProposal({
      reading: { understood: true, value: "02/04/1999", verbatim: "02/04/1999", confidence: 1 },
      parse: parseUnambiguousDate,
      origin: "conversation",
      fallbackVerbatim: "…",
    });

    if (!isNotUnderstood(result)) expect.unreachable("an ambiguous date must be refused");
    expect(result.reason).toContain("refused rather than approximated");
  });

  it("passes the model's own reason through when it could not read", () => {
    const result = toProposal({
      reading: { understood: false, reason: "The student said they would check later." },
      parse: parseUnambiguousDate,
      origin: "conversation",
      fallbackVerbatim: "…",
    });

    if (!isNotUnderstood(result)) expect.unreachable("not understood");
    expect(result.reason).toBe("The student said they would check later.");
  });

  it("treats a null value as not understood, however confident", () => {
    const result = toProposal({
      reading: { understood: true, value: null, confidence: 1 },
      parse: parseUnambiguousDate,
      origin: "conversation",
      fallbackVerbatim: "…",
    });
    expect(isNotUnderstood(result)).toBe(true);
  });

  it("keeps the model's quoted span, because grounding checks it", () => {
    const result = toProposal({
      reading: {
        understood: true,
        value: "1999-04-02",
        verbatim: "Date of birth: 02 APR 1999",
        confidence: 0.95,
      },
      parse: parseUnambiguousDate,
      origin: "document",
      fallbackVerbatim: "the whole document",
      documentId: "doc-1",
    });

    if (isNotUnderstood(result)) expect.unreachable("this parses");
    // ADR-0016 tests this span against the document. Substituting our own
    // fallback here would make the grounding check vacuous.
    expect(unwrapProposed(result).verbatim).toBe("Date of birth: 02 APR 1999");
    expect(unwrapProposed(result).documentId).toBe("doc-1");
  });

  it("falls back only when the model quoted nothing at all", () => {
    const result = toProposal({
      reading: { understood: true, value: "1999-04-02", verbatim: "", confidence: 0.9 },
      parse: parseUnambiguousDate,
      origin: "document",
      fallbackVerbatim: "the whole document",
    });

    if (isNotUnderstood(result)) expect.unreachable("this parses");
    expect(unwrapProposed(result).verbatim).toBe("the whole document");
  });

  it("never produces a confirmed value — only the profile package can", () => {
    const result = toProposal({
      reading: { understood: true, value: "1999-04-02", verbatim: "x", confidence: 1 },
      parse: parseUnambiguousDate,
      origin: "conversation",
      fallbackVerbatim: "…",
    });
    if (isNotUnderstood(result)) expect.unreachable("this parses");

    // A ProposedValue, and there is no conversion. Verified at compile time in
    // packages/domain/src/values.test.ts; asserted here so the Bedrock path is
    // visibly the same path as every other.
    expect(unwrapProposed(result).origin).toBe("conversation");
  });
});

describe("confidence from a model that misbehaves", () => {
  it("clamps out-of-range figures instead of failing the extraction", () => {
    expect(clampConfidence(1.4)).toBe(1);
    expect(clampConfidence(-2)).toBe(0);
  });

  it("uses a neutral figure when there is none", () => {
    expect(clampConfidence(undefined)).toBe(0.5);
    expect(clampConfidence(null)).toBe(0.5);
    expect(clampConfidence(Number.NaN)).toBe(0.5);
  });

  it("keeps a sane figure untouched", () => {
    expect(clampConfidence(0.87)).toBe(0.87);
  });
});

// ── Where the client's requests actually go (P243, row 101; P244) ────────
//
// Vahid's `--live` run of 2026-09-28 printed "LIVE — Amazon Bedrock, eu-west-2"
// and then a 404 in the Claude API's own error shape, with a `req_…` id. His
// guess was an environment variable routing the client away from Bedrock. The
// tests here hold two things: no environment variable can move the destination,
// and the client can say, AFTER a call, what it actually called — including a
// call that failed, because that is the one whose destination matters.
//
// P244, on his word: the service is the InvokeModel one, `bedrock-runtime`,
// the one `verify-bedrock` lists — *"verify-bedrock and the client must read
// the same list."*

const CONFIG = {
  region: "eu-west-2",
  models: {
    interview: "some-model",
    interpretation: "some-model",
    document_extraction: "some-model",
    navigation: "some-model",
  },
} as const;

const NOT_FOUND = {
  type: "error",
  request_id: "req_test",
  error: { type: "not_found_error", message: "The model 'some-model' does not exist" },
};

/** A fetch that never touches a network: it records the URL and answers as Bedrock did for him. */
function recordingFetch(seen: string[], body: unknown, status: number): typeof globalThis.fetch {
  return (input: string | URL | Request): Promise<Response> => {
    seen.push(input instanceof Request ? input.url : String(input));
    return Promise.resolve(
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
    );
  };
}

describe("where the Bedrock client's requests go (P243)", () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const name of ["ANTHROPIC_BEDROCK_BASE_URL", "ANTHROPIC_BEDROCK_MANTLE_BASE_URL", "ANTHROPIC_BASE_URL", "ANTHROPIC_API_KEY", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"]) {
      saved[name] = process.env[name];
    }
    // Signing needs a credential; these are not credentials of anything. No
    // request leaves the process: the fetch below is the only one the client has.
    process.env["AWS_ACCESS_KEY_ID"] = "AKIATESTNOTREAL0000000";
    process.env["AWS_SECRET_ACCESS_KEY"] = "not-a-real-secret";
    delete process.env["AWS_SESSION_TOKEN"];
  });
  afterEach(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("is built for the InvokeModel service of Amazon Bedrock, in the configured region — the service verify-bedrock lists", () => {
    const client = new BedrockModelClient({ config: CONFIG });
    expect(client.destination.service).toBe("bedrock-runtime");
    expect(client.destination.baseURL).toBe("https://bedrock-runtime.eu-west-2.amazonaws.com");
    expect(bedrockRuntimeBaseURL("us-east-1")).toBe("https://bedrock-runtime.us-east-1.amazonaws.com");
    // Nothing has been called: the record says so rather than the banner guessing.
    expect(client.destination.requests).toEqual([]);
  });

  it("CANNOT be moved by an environment variable — his first guess, closed", () => {
    // The SDK reads the first of these when no base URL is given. The client gives one.
    process.env["ANTHROPIC_BEDROCK_BASE_URL"] = "https://api.anthropic.com";
    process.env["ANTHROPIC_BEDROCK_MANTLE_BASE_URL"] = "https://api.anthropic.com";
    process.env["ANTHROPIC_BASE_URL"] = "https://api.anthropic.com";
    process.env["ANTHROPIC_API_KEY"] = "sk-ant-not-real";
    const client = new BedrockModelClient({ config: CONFIG });
    expect(client.destination.baseURL).toBe("https://bedrock-runtime.eu-west-2.amazonaws.com");
  });

  it("records what it actually called, after the call, INCLUDING a call that failed", async () => {
    const seen: string[] = [];
    const client = new BedrockModelClient({ config: CONFIG, fetch: recordingFetch(seen, NOT_FOUND, 404) });

    await expect(
      client.interpretAnswer({
        fieldKey: "surname",
        label: "surname",
        utterance: "Mohammadi",
        expectedShape: "a surname",
        parse: (text: string) => text,
      }),
    ).rejects.toThrow(/does not exist/);

    // The request left the client and went where it was built to go — the
    // InvokeModel path, with the model id in it — and the record survives the
    // failure, which is the one time it is evidence.
    expect(seen).toEqual(["https://bedrock-runtime.eu-west-2.amazonaws.com/model/some-model/invoke"]);
    expect(client.destination.requests).toEqual(seen);
    // No response was counted: usage says what came back, the record says what went out.
    expect(client.usage.calls).toBe(0);
  });

  it("puts the configured id in the path, so the id verify-bedrock listed is the id called", async () => {
    const seen: string[] = [];
    const config = { ...CONFIG, models: { ...CONFIG.models, document_extraction: "eu.anthropic.claude-sonnet-4-6" } };
    const client = new BedrockModelClient({ config, fetch: recordingFetch(seen, NOT_FOUND, 404) });
    await expect(
      client.extractFromDocument({
        documentId: "doc-1",
        documentType: "cv",
        fieldKey: "employment.history",
        documentText: "text",
        hint: "h",
        labels: ["L"],
        expectedShape: "s",
        parse: (text: string) => text,
        requireVerbatimSpan: true,
      }),
    ).rejects.toThrow();
    expect(seen).toEqual(["https://bedrock-runtime.eu-west-2.amazonaws.com/model/eu.anthropic.claude-sonnet-4-6/invoke"]);
  });
});

describe("a configured id against the list the account returned (P244)", () => {
  // His words: "verify-bedrock and the client must read the same list." The
  // check is identity against the two lists the account itself gave back.
  const LISTED = {
    models: ["anthropic.claude-sonnet-4-6", "anthropic.claude-haiku-4-5-20251001-v1:0"],
    profiles: ["eu.anthropic.claude-sonnet-4-6", "global.anthropic.claude-sonnet-4-6"],
  };

  it("says which list carries the id", () => {
    expect(listedAs("eu.anthropic.claude-sonnet-4-6", LISTED)).toBe("profile");
    expect(listedAs("anthropic.claude-sonnet-4-6", LISTED)).toBe("model");
    expect(listedAs(" eu.anthropic.claude-sonnet-4-6 ", LISTED)).toBe("profile");
  });

  it("says NOT LISTED for anything the account did not return — and infers nothing from a shape", () => {
    expect(listedAs("anthropic.claude-sonnet-5", LISTED)).toBe("not_listed");
    expect(listedAs("us.anthropic.claude-sonnet-4-6", LISTED)).toBe("not_listed");
    expect(listedAs("", LISTED)).toBe("not_listed");
  });
});
