/**
 * `AAS_SECURE_LOCAL_MASTER_KEY` (P121): read outside production, shaped,
 * refused in production. The value is bytes for the vault, never a string
 * that could reach a log.
 */

import { describe, expect, it } from "vitest";

import { secureConfigFrom } from "./config.js";

const VALID = {
  AAS_PORT: "4001",
  AAS_SECURE_DATABASE_URL: "postgresql://postgres@127.0.0.1:5432/secure",
  AAS_SECURE_SELF_ORIGIN: "http://127.0.0.1:4001",
  AAS_CONVERSATION_ORIGIN: "http://127.0.0.1:4000",
  AAS_CONVERSATION_INTERNAL_URL: "http://127.0.0.1:4000",
  AAS_CONVERSATION_SERVICE_TOKEN: "secure-service",
  AAS_SERVICE_CERT_CONVERSATION: "conversation-service",
  AAS_SERVICE_CERT_AGENT: "secure-filler",
};
const HEX = "ab".repeat(32);

describe("the Secure Service's local master key", () => {
  it("is absent by default", () => {
    expect(secureConfigFrom(VALID).localMasterKey).toBeUndefined();
  });

  it("is read as 32 bytes from 64 hex characters", () => {
    const config = secureConfigFrom({ ...VALID, AAS_SECURE_LOCAL_MASTER_KEY: HEX });
    expect(config.localMasterKey?.length).toBe(32);
    expect(config.localMasterKey?.toString("hex")).toBe(HEX);
  });

  it("refuses a value that is not 64 hex characters", () => {
    expect(() => secureConfigFrom({ ...VALID, AAS_SECURE_LOCAL_MASTER_KEY: "not-hex" })).toThrow(/AAS_SECURE_LOCAL_MASTER_KEY/);
  });

  it("is refused in production, where KMS wraps the keys", () => {
    expect(() =>
      secureConfigFrom({
        ...VALID,
        NODE_ENV: "production",
        AAS_SECURE_LOCAL_MASTER_KEY: HEX,
      }),
    ).toThrow(/AAS_SECURE_LOCAL_MASTER_KEY/);
  });
});
