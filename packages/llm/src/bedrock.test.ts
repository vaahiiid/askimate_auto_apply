import { describe, expect, it } from "vitest";

import { unwrapProposed } from "@askimate/aas-domain";

import {
  BedrockConfigurationError,
  MODEL_WORKLOADS,
  WORKLOAD_ENV_VARS,
  bedrockConfigFrom,
  isBedrockConfigured,
} from "./bedrock-config.js";
import { clampConfidence, toProposal } from "./bedrock-reading.js";
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
