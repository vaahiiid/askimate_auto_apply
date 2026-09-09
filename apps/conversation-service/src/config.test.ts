/**
 * The document-transport configuration: all of it or none of it.
 *
 * `conversationConfigFrom` reads the whole environment, so these give it a
 * complete valid base and vary only the four document variables. The rule
 * under test is P61's (ADR-0094): a bucket with no key, or a key with no
 * schedule, is refused at startup with the missing name listed — not
 * discovered at the first declaration.
 */

import { describe, expect, it } from "vitest";

import { conversationConfigFrom } from "./config.js";

const BASE: Record<string, string> = {
  AAS_PORT: "4870",
  AAS_CONVERSATION_DATABASE_URL: "postgresql://postgres@127.0.0.1:5432/aas",
  AAS_SESSION_SECRET: "0123456789abcdef0123456789abcdef",
  AAS_SECURE_ORIGIN: "http://127.0.0.1:4871",
  AAS_SECURE_INTERNAL_URL: "http://127.0.0.1:4871",
  AAS_SECURE_SERVICE_TOKEN: "conversation-service",
  AAS_SERVICE_CERT_SECURE: "secure-service",
  AAS_SERVICE_CERT_RUNNER: "browser-runner",
  AAS_CATALOGUE: "fixtures",
};

const KEY = "arn:aws:kms:eu-west-2:123456789012:key/4f440d2b-58c3-47e2-8eb8-6ae3c40d8b13";

describe("the document transport's configuration", () => {
  it("is absent when none of its variables are set — the routes answer 503", () => {
    expect(conversationConfigFrom(BASE).documents).toBeUndefined();
  });

  it("is present when all of them are, and the region defaults to eu-west-2 (ADR-0012)", () => {
    const config = conversationConfigFrom({
      ...BASE,
      AAS_DOCUMENTS_BUCKET: "askimate-aas-vault-4471",
      AAS_DOCUMENTS_KMS_KEY_ARN: KEY,
      AAS_RETENTION_SCHEDULE_DIR: "config/retention",
    });
    expect(config.documents).toEqual({
      bucket: "askimate-aas-vault-4471",
      kmsKeyArn: KEY,
      region: "eu-west-2",
      retentionScheduleDir: "config/retention",
    });
  });

  it("REFUSES a partial configuration, naming what is missing", () => {
    expect(() =>
      conversationConfigFrom({ ...BASE, AAS_DOCUMENTS_BUCKET: "askimate-aas-vault-4471" }),
    ).toThrow(/AAS_DOCUMENTS_KMS_KEY_ARN[\s\S]*AAS_RETENTION_SCHEDULE_DIR/);
    expect(() =>
      conversationConfigFrom({ ...BASE, AAS_RETENTION_SCHEDULE_DIR: "config/retention" }),
    ).toThrow(/AAS_DOCUMENTS_BUCKET/);
  });

  it("REFUSES a key that is not an ARN — an alias or a bare id cannot be compared to what HEAD reports", () => {
    for (const bad of ["alias/aas-vault", "4f440d2b-58c3-47e2-8eb8-6ae3c40d8b13", "arn:aws:kms:eu-west-2:123456789012:alias/x"]) {
      expect(() =>
        conversationConfigFrom({
          ...BASE,
          AAS_DOCUMENTS_BUCKET: "b",
          AAS_DOCUMENTS_KMS_KEY_ARN: bad,
          AAS_RETENTION_SCHEDULE_DIR: "config/retention",
        }),
      ).toThrow(/must be the key's ARN/);
    }
  });

  it("REFUSES a region other than eu-west-2", () => {
    expect(() =>
      conversationConfigFrom({
        ...BASE,
        AAS_DOCUMENTS_BUCKET: "b",
        AAS_DOCUMENTS_KMS_KEY_ARN: KEY,
        AAS_RETENTION_SCHEDULE_DIR: "config/retention",
        AAS_DOCUMENTS_REGION: "us-east-1",
      }),
    ).toThrow(/ADR-0012/);
  });
});
