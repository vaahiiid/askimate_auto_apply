/**
 * The agent's word to the Secure Service (P121).
 *
 * The header is the one the Secure Service reads. Before P121 the authoriser
 * sent `x-aas-service`, the Secure Service read `x-service-cert`, and the two
 * real processes could never authorise a use — every in-process test added the
 * right header in a fetch wrapper. Asserted here on the wire, with no wrapper.
 */

import { describe, expect, it } from "vitest";

import { SERVICE_CERTIFICATE_HEADER, type SecretFillRequest } from "@askimate/aas-contracts";

import { httpUseAuthoriser } from "./authorise.js";

const request: SecretFillRequest = {
  handle: "h_1",
  studentRef: "student_1",
  caseRef: "case_1",
  purpose: "portal_account_creation",
  targetHost: "portal.example",
  consumer: "agent-test",
  noDiagnosticCapture: true,
  browserEndpoint: "ws://127.0.0.1:1/devtools/browser/x",
  locators: [{ strategy: "name", value: "password" }],
};

describe("httpUseAuthoriser", () => {
  it("presents the agent's certificate under the header the Secure Service reads", async () => {
    let seen: Record<string, string> = {};
    const authorise = httpUseAuthoriser({
      baseUrl: "http://secure.test",
      serviceToken: "secure-filler",
      fetch: ((_input: string, init?: RequestInit) => {
        seen = init?.headers as Record<string, string>;
        return Promise.resolve(new Response("{}", { status: 200 }));
      }) as unknown as typeof globalThis.fetch,
    });
    expect(await authorise(request)).toEqual({ ok: true });
    expect(SERVICE_CERTIFICATE_HEADER).toBe("x-service-cert");
    expect(seen[SERVICE_CERTIFICATE_HEADER]).toBe("secure-filler");
    expect(seen["x-aas-service"], "the old spelling is gone").toBeUndefined();
  });

  it("reads a 403 as not authorised, and says nothing more", async () => {
    const authorise = httpUseAuthoriser({
      baseUrl: "http://secure.test",
      serviceToken: "secure-filler",
      fetch: () => Promise.resolve(new Response('{"type":"forbidden"}', { status: 403 })),
    });
    expect(await authorise(request)).toEqual({ ok: false, reason: "not_authorised" });
  });
});
