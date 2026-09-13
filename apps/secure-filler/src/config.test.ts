/**
 * `AAS_SECURE_LOCAL_MASTER_KEY` (P121): the same reading as the Secure
 * Service's, because the two must hold the same bytes.
 */

import { describe, expect, it } from "vitest";

import { fillAgentConfigFrom } from "./config.js";

const VALID = {
  AAS_PORT: "4002",
  AAS_SECURE_INTERNAL_URL: "http://127.0.0.1:4001",
  AAS_SECURE_SERVICE_TOKEN: "secure-filler",
  AAS_SERVICE_CERT_RUNNER: "browser-runner",
};
const HEX = "cd".repeat(32);

describe("the Fill Agent's local master key", () => {
  it("is absent by default", () => {
    expect(fillAgentConfigFrom(VALID).localMasterKey).toBeUndefined();
  });

  it("is read as 32 bytes from 64 hex characters", () => {
    expect(fillAgentConfigFrom({ ...VALID, AAS_SECURE_LOCAL_MASTER_KEY: HEX }).localMasterKey?.toString("hex")).toBe(HEX);
  });

  it("refuses a value that is not 64 hex characters", () => {
    expect(() => fillAgentConfigFrom({ ...VALID, AAS_SECURE_LOCAL_MASTER_KEY: HEX.slice(1) })).toThrow(/AAS_SECURE_LOCAL_MASTER_KEY/);
  });

  it("is refused in production", () => {
    expect(() => fillAgentConfigFrom({ ...VALID, NODE_ENV: "production", AAS_SECURE_LOCAL_MASTER_KEY: HEX })).toThrow(/AAS_SECURE_LOCAL_MASTER_KEY/);
  });
});
