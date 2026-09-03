/**
 * The four things a provider can say about an email address.
 *
 * Tested directly on the pure function, so each case is stated once and
 * plainly. `scripts/p19-identity.test.ts` then proves that a REAL provider's
 * response reaches this function unaltered — the two together are the claim.
 */

import { describe, expect, it } from "vitest";

import { IDENTITY_OUTCOMES, identityFromClaims } from "./adapter.js";

describe("what the provider said about the email address (ADR-0056 §3)", () => {
  it("VERIFIED — an address, and the provider says it is verified", () => {
    expect(identityFromClaims({ sub: "s-1", email: "a@b.test", email_verified: true })).toEqual({
      kind: "verified",
      subject: "s-1",
      email: "a@b.test",
    });
  });

  it("UNVERIFIED — an address, and the provider says it is not", () => {
    expect(identityFromClaims({ sub: "s-1", email: "a@b.test", email_verified: false })).toEqual({
      kind: "unverified",
      subject: "s-1",
      email: "a@b.test",
    });
  });

  it("NO EMAIL — the provider returned no address at all", () => {
    // Distinct from "unverified" on purpose: there is nothing to verify, and
    // the student is told something different.
    expect(identityFromClaims({ sub: "s-1", email_verified: true })).toEqual({
      kind: "no_email",
      subject: "s-1",
    });
    expect(identityFromClaims({ sub: "s-1", email: "" })).toEqual({
      kind: "no_email",
      subject: "s-1",
    });
  });

  it("NO VERIFICATION CLAIM — an address, and the provider did not say", () => {
    // ═══════════════════════════════════════════════════════════════════
    // The case that decides whether "fail safe" is true. An `email_verified`
    // that is simply absent must never read as `true`, and must not read as a
    // plain `false` either — the student is told something different, and an
    // incident review needs to know the provider was silent rather than
    // negative.
    // ═══════════════════════════════════════════════════════════════════
    expect(identityFromClaims({ sub: "s-1", email: "a@b.test" })).toEqual({
      kind: "no_verification_claim",
      subject: "s-1",
      email: "a@b.test",
    });
  });

  it("refuses a NON-BOOLEAN email_verified rather than coercing it", () => {
    // Some providers send the string "true". That is not OIDC Core, and
    // accepting it would mean deciding a security question by string
    // coercion. A value this adapter cannot read is a value it was not told.
    for (const value of ["true", "false", 1, 0, null, {}, []]) {
      const result = identityFromClaims({ sub: "s-1", email: "a@b.test", email_verified: value });
      expect(result.kind, `email_verified=${JSON.stringify(value)}`).toBe("no_verification_claim");
    }
  });

  it("takes the SUBJECT as identity and never the email", () => {
    // ADR-0038: `sub` is the only identifier persisted, so a student who
    // changes their address does not become a different person.
    const first = identityFromClaims({ sub: "s-1", email: "old@b.test", email_verified: true });
    const second = identityFromClaims({ sub: "s-1", email: "new@b.test", email_verified: true });
    expect(first.subject).toBe(second.subject);
  });

  it("has exactly four outcomes, and they are the ones enumerated", () => {
    // An enumeration test, so adding a fifth without deciding what a secure
    // step does about it fails here rather than defaulting somewhere.
    expect([...IDENTITY_OUTCOMES].sort()).toEqual([
      "no_email",
      "no_verification_claim",
      "unverified",
      "verified",
    ]);
  });
});
