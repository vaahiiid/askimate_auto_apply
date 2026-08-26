import { describe, expect, it } from "vitest";

import { proposeValue, studentId, unwrapConfirmed } from "@askimate/aas-domain";
import type { ConfirmedValue } from "@askimate/aas-domain";
import { applyConfirmation, isDeclined } from "@askimate/aas-profile";

import { EphemeralCredential } from "./credential.js";
import {
  checkHandoverComplete,
  mayConcludeCase,
  prepareAccountCreation,
  renderAccountCreationRequest,
  renderHandover,
  type HandoverChecklist,
  type PortalAccount,
} from "./ownership.js";

const NOW = new Date("2026-08-26T10:00:00Z");
const LATER = new Date("2026-08-26T12:00:00Z");
const STUDENT = studentId("student-1");
const OUR_DOMAINS = ["askimate.com", "universitio.com"];

/** A confirmed email, the only kind an account may use. */
function confirmedEmail(address: string): ConfirmedValue<string> {
  const result = applyConfirmation({
    key: "contact.email",
    proposed: proposeValue({
      value: address,
      origin: "conversation",
      verbatim: address,
      confidence: 0.95,
    }),
    confirmation: {
      studentRef: STUDENT,
      presentedText: `I've recorded your email as: ${address}`,
      respondedAt: NOW,
      response: { kind: "accepted" },
    },
  });
  if (isDeclined(result)) expect.unreachable("the student accepted");
  return result.value;
}

const AUTHORISATION = {
  studentRef: STUDENT,
  presentedText: renderAccountCreationRequest({
    institutionName: "Ulster University",
    portalHost: "apply.qahighereducation.com",
    email: "niloofar@example.com",
  }),
  authorisedAt: NOW,
};

function creationInput(overrides: Record<string, unknown> = {}) {
  return {
    accountId: "acct-1",
    caseId: "case-1",
    studentRef: STUDENT,
    portalHost: "apply.qahighereducation.com",
    email: confirmedEmail("niloofar@example.com"),
    authorisation: AUTHORISATION,
    ourDomains: OUR_DOMAINS,
    ...overrides,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// The temporary credential
// ───────────────────────────────────────────────────────────────────────────

describe("a temporary credential", () => {
  const credential = (): EphemeralCredential =>
    EphemeralCredential.create({
      secret: "Tmp-9f2a!Kq",
      expiresAt: LATER,
      purpose: "create the Ulster application account",
    });

  it("can be read while it is alive", () => {
    const result = credential().reveal(NOW);
    if (!result.ok) expect.unreachable("still valid");
    expect(result.secret).toBe("Tmp-9f2a!Kq");
  });

  it("REDACTS itself through JSON.stringify", () => {
    // The route that matters most: a credential on a case record, serialised
    // into an event or a log line, is a live password sitting somewhere
    // nobody is thinking about.
    const serialised = JSON.stringify({ account: "acct-1", password: credential() });
    expect(serialised).not.toContain("Tmp-9f2a");
    expect(serialised).toContain("never logged");
  });

  it("REDACTS itself in a template literal", () => {
    expect(`password is ${String(credential())}`).not.toContain("Tmp-9f2a");
  });

  it("REDACTS itself in console output", async () => {
    // Node's inspect is what console.log uses, so this is the route a
    // credential takes into a terminal, a log aggregator and a bug report.
    const { inspect } = await import("node:util");
    expect(inspect(credential())).not.toContain("Tmp-9f2a");
  });

  it("refuses to be read after it expires, and destroys itself", () => {
    const secret = credential();
    const result = secret.reveal(new Date("2026-08-26T12:00:01Z"));

    if (result.ok) expect.unreachable("expired");
    expect(result.reason.kind).toBe("expired");
    // Destroyed rather than merely refused, so a clock going backwards cannot
    // resurrect it.
    expect(secret.destroyed).toBe(true);
  });

  it("cannot be recovered once destroyed", () => {
    const secret = credential();
    secret.destroy();
    const result = secret.reveal(NOW);
    if (result.ok) expect.unreachable("destroyed");
    expect(result.reason.kind).toBe("destroyed");
  });

  it("is idempotent to destroy", () => {
    const secret = credential();
    secret.destroy();
    secret.destroy();
    expect(secret.destroyed).toBe(true);
  });

  it("counts how often it was read, as an audit signal", () => {
    const secret = credential();
    secret.reveal(NOW);
    secret.reveal(NOW);
    expect(secret.revealCount).toBe(2);
  });

  it("refuses to exist empty", () => {
    expect(() =>
      EphemeralCredential.create({ secret: "", expiresAt: LATER, purpose: "x" }),
    ).toThrow();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Whose account it is
// ───────────────────────────────────────────────────────────────────────────

describe("creating an account on the student's behalf", () => {
  it("uses the student's own confirmed email", () => {
    const check = prepareAccountCreation(creationInput());
    if (!check.permitted) expect.unreachable(`expected permitted: ${check.refusal.kind}`);
    expect(unwrapConfirmed(check.account.email)).toBe("niloofar@example.com");
    expect(check.account.createdBy).toBe("askimate_on_behalf");
  });

  it("REFUSES one of our own addresses", () => {
    // The failure this whole file exists to prevent: the university writes to
    // us instead of to them, and the student becomes a passenger in their own
    // application.
    const check = prepareAccountCreation(
      creationInput({ email: confirmedEmail("applications@askimate.com") }),
    );
    if (check.permitted) expect.unreachable("our own domain must be refused");
    expect(check.refusal.kind).toBe("email_not_students");
  });

  it("refuses a subdomain of ours too", () => {
    const check = prepareAccountCreation(
      creationInput({ email: confirmedEmail("x@universitio.com") }),
    );
    expect(check.permitted).toBe(false);
  });

  it("REFUSES without the student's specific authorisation", () => {
    const { authorisation: _none, ...withoutAuthorisation } = creationInput();
    const check = prepareAccountCreation(withoutAuthorisation);
    if (check.permitted) expect.unreachable("authorisation is required");
    expect(check.refusal.kind).toBe("not_authorised");
  });

  it("tells the student the account is theirs and how they take control", () => {
    const text = renderAccountCreationRequest({
      institutionName: "Ulster University",
      portalHost: "apply.qahighereducation.com",
      email: "niloofar@example.com",
    });

    expect(text).toContain("your own email address");
    expect(text).toContain("Forgot password");
    expect(text).toContain("only you can get in");
    expect(text).toContain("are yours");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Handing it back
// ───────────────────────────────────────────────────────────────────────────

const COMPLETE: HandoverChecklist = {
  emailVerifiedByPortal: true,
  studentInformed: true,
  passwordResetCompleted: true,
  temporaryCredentialDestroyed: true,
  studentConfirmedAccess: true,
};

function handover(checklist: HandoverChecklist) {
  return checkHandoverComplete({
    checklist,
    completedAt: LATER,
    presentedText: renderHandover({
      institutionName: "Ulster University",
      portalHost: "apply.qahighereducation.com",
      email: "niloofar@example.com",
    }),
  });
}

describe("handover", () => {
  it("completes when every item is done", () => {
    expect(handover(COMPLETE).complete).toBe(true);
  });

  it("gives NO partial credit", () => {
    // Four out of five is an account the student cannot fully control, and
    // recording that as a success is exactly the outcome to prevent.
    const check = handover({ ...COMPLETE, studentConfirmedAccess: false });
    if (check.complete) expect.unreachable("incomplete");
    expect(check.refusal.outstanding).toEqual(["the student has confirmed they can sign in"]);
  });

  it("will not call it done while we still hold a credential", () => {
    const check = handover({ ...COMPLETE, temporaryCredentialDestroyed: false });
    expect(check.complete).toBe(false);
  });

  it("will not call it done before they have set their own password", () => {
    const check = handover({ ...COMPLETE, passwordResetCompleted: false });
    if (check.complete) expect.unreachable("incomplete");
    expect(check.refusal.outstanding[0]).toContain("their own password");
  });

  it("lists everything outstanding at once, not one at a time", () => {
    const check = handover({
      emailVerifiedByPortal: false,
      studentInformed: false,
      passwordResetCompleted: false,
      temporaryCredentialDestroyed: false,
      studentConfirmedAccess: false,
    });
    if (check.complete) expect.unreachable("incomplete");
    expect(check.refusal.outstanding).toHaveLength(5);
  });

  it("tells the student how to get in without us", () => {
    const text = renderHandover({
      institutionName: "Ulster University",
      portalHost: "apply.qahighereducation.com",
      email: "niloofar@example.com",
    });

    expect(text).toContain("the account is yours");
    expect(text).toContain("Forgot password");
    expect(text).toContain("only you can read");
    expect(text).toContain("only you can get into the account");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// A case cannot quietly finish holding someone's account
// ───────────────────────────────────────────────────────────────────────────

function account(stage: PortalAccount["stage"]): PortalAccount {
  return {
    accountId: "acct-1",
    caseId: "case-1",
    studentRef: STUDENT,
    portalHost: "apply.qahighereducation.com",
    email: confirmedEmail("niloofar@example.com"),
    stage,
    createdBy: "askimate_on_behalf",
  };
}

describe("finishing a case", () => {
  it("is permitted when every account has been handed back", () => {
    expect(mayConcludeCase([account("handed_over")]).may).toBe(true);
  });

  it("is permitted when no account was ever needed", () => {
    expect(mayConcludeCase([account("not_required")]).may).toBe(true);
  });

  it("is REFUSED while an account is still active", () => {
    const result = mayConcludeCase([account("active")]);
    expect(result.may).toBe(false);
    expect(result.outstanding[0]).toContain("has not been handed back");
  });

  it("is refused when handover is merely due", () => {
    // "We meant to" is the state this check exists to catch.
    expect(mayConcludeCase([account("handover_due")]).may).toBe(false);
  });

  it("names every outstanding account, not just the first", () => {
    const result = mayConcludeCase([
      account("handed_over"),
      { ...account("active"), accountId: "acct-2" },
      { ...account("handover_due"), accountId: "acct-3" },
    ]);
    expect(result.outstanding).toHaveLength(2);
  });
});
