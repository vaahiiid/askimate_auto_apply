import { describe, expect, it } from "vitest";

import { readerConfigFrom } from "./config.js";

const BEDROCK = {
  AAS_BEDROCK_REGION: "eu-west-2",
  AAS_BEDROCK_MODEL_INTERVIEW: "eu.anthropic.claude-sonnet-4-6",
  AAS_BEDROCK_MODEL_INTERPRETATION: "eu.anthropic.claude-sonnet-4-6",
  AAS_BEDROCK_MODEL_DOCUMENT_EXTRACTION: "eu.anthropic.claude-sonnet-4-6",
  AAS_BEDROCK_MODEL_NAVIGATION: "eu.anthropic.claude-sonnet-4-6",
};

const COMPLETE = {
  AAS_CONVERSATION_INTERNAL_URL: "http://127.0.0.1:4801",
  AAS_READER_SERVICE_TOKEN: "reader",
  AAS_READER_HOLDER: "reader-local-1",
  ...BEDROCK,
};

describe("what the CV reader is told, and what it refuses (ADR-0092, ADR-0148 §9)", () => {
  it("reads a complete configuration, through Bedrock", () => {
    const config = readerConfigFrom(COMPLETE);
    expect(config).toMatchObject({ holder: "reader-local-1", model: "bedrock", production: false });
  });

  it("REFUSES a database URL, a KMS key, an envelope cache and a bucket — this process holds no key and reaches no store", () => {
    for (const forbidden of ["AAS_CONVERSATION_DATABASE_URL", "AAS_SECURE_DATABASE_URL", "AAS_SECURE_KMS_KEY_ID", "AAS_ENVELOPE_CACHE_URL", "AAS_DOCUMENT_BUCKET"]) {
      expect(() => readerConfigFrom({ ...COMPLETE, [forbidden]: "set" }), forbidden).toThrow(/must not be set on the CV reader/);
    }
  });

  it("takes the stand-in outside production, and REFUSES it in production", () => {
    expect(readerConfigFrom({ ...COMPLETE, AAS_READER_MODEL: "stand-in" }).model).toBe("stand-in");
    expect(() => readerConfigFrom({ ...COMPLETE, AAS_READER_MODEL: "stand-in", NODE_ENV: "production", AAS_CONVERSATION_INTERNAL_URL: "https://plane.internal" })).toThrow(/refused in production/);
  });

  it("REFUSES Bedrock unconfigured, naming what is unset and the way out", () => {
    const { AAS_BEDROCK_MODEL_DOCUMENT_EXTRACTION: _dropped, ...without } = COMPLETE;
    void _dropped;
    expect(() => readerConfigFrom(without)).toThrow(/AAS_BEDROCK_MODEL_DOCUMENT_EXTRACTION/);
    expect(() => readerConfigFrom(without)).toThrow(/verify-bedrock/);
  });

  it("requires the plane's URL, the certificate and a holder", () => {
    for (const required of ["AAS_CONVERSATION_INTERNAL_URL", "AAS_READER_SERVICE_TOKEN", "AAS_READER_HOLDER"]) {
      const { [required]: _dropped, ...without } = COMPLETE as Record<string, string>;
      void _dropped;
      expect(() => readerConfigFrom(without), required).toThrow(new RegExp(required));
    }
  });
});
