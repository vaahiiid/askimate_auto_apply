/**
 * The account a successful creation produced, reconstructed from the record
 * that it happened.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * These tests exist because the P7 journey did not catch a single one of the
 * regressions aimed at this function. The journey walks the happy path — a
 * confirmed email, an observation that says no verification is needed, a
 * creation that succeeded — so every variant this function decides was
 * unexercised, and changing any of them broke nothing.
 *
 * An end-to-end journey proves the pieces fit. It is not where the pieces are
 * checked.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from "vitest";

import { proposeValue, studentId, unwrapConfirmed } from "@askimate/aas-domain";
import { mayConcludeCase, outstandingHandoverItems } from "@askimate/aas-account";
import type { ObservedPortalAuthentication } from "@askimate/aas-account";
import { newInterview } from "@askimate/aas-interview";
import {
  GATED_PORTAL_BLUEPRINT,
  GATED_PORTAL_MAPPING_SET,
} from "@askimate/aas-mapping/fixtures/gated";
import { applyConfirmation, confirmField, emptyProfile, isDeclined } from "@askimate/aas-profile";
import type { ConfirmedProfile } from "@askimate/aas-profile";

import { accountCreated, accountDeclared, beginRun } from "./run.js";
import type { HandoverEvidence, RunState } from "./run.js";

const NOW = new Date("2026-08-31T10:00:00Z");
const STUDENT = studentId("student-1");
const EMAIL = "niloofar@example.test";

const OBSERVED: ObservedPortalAuthentication = {
  portalHost: "gated.portal.test",
  discoveryRunId: "run-gated-1",
  observedAt: new Date("2026-08-30T09:00:00Z"),
  applicantChoosesPassword: true,
  portalIssuesCredential: false,
  passwordlessAvailable: false,
  emailVerificationRequired: false,
  mfaOrOtpRequired: false,
  captchaPresent: false,
  passwordResetAvailable: true,
  credentialsCanBeHandedBack: true,
};

/** A profile with the student's email confirmed, the way the interview confirms it. */
function withEmail(address: string): ConfirmedProfile {
  const result = applyConfirmation({
    key: "contact.email",
    proposed: proposeValue({
      value: address,
      origin: "conversation",
      verbatim: address,
      confidence: 1,
    }),
    confirmation: {
      studentRef: STUDENT,
      presentedText: "Is that right?",
      response: { kind: "accepted" },
      respondedAt: NOW,
    },
  });
  if (isDeclined(result)) expect.unreachable("the email should have been accepted");
  return confirmField(emptyProfile(STUDENT, NOW), result, NOW);
}

function stateWith(input: {
  readonly profile: ConfirmedProfile;
  readonly observed?: ObservedPortalAuthentication;
}): RunState {
  return beginRun({
    inputs: {
      caseId: "case-1",
      studentRef: STUDENT,
      blueprint: GATED_PORTAL_BLUEPRINT,
      mappingSet: GATED_PORTAL_MAPPING_SET,
      documents: new Map(),
      studentPresentAtCreation: true,
      ...(input.observed === undefined ? {} : { portalAuthentication: input.observed }),
      passwordDelivery: "askimate_secure_channel",
    },
    profile: input.profile,
    interview: newInterview({
      studentRef: STUDENT,
      profile: input.profile,
      requiredFields: [],
      requiredDocuments: [],
    }),
  });
}

describe("the account a creation produced", () => {
  it("takes its email from the CONFIRMED profile, not from anywhere else", () => {
    // ADR-0004 and product rule 7 together: the account's address is the
    // student's own, confirmed by them. `PortalAccount.email` is a
    // `ConfirmedValue`, so there is no path that puts an AskiMate address here
    // — but a path that put SOMEONE ELSE'S confirmed address here would type
    // check perfectly, and this is what rules it out.
    const state = stateWith({ profile: withEmail(EMAIL), observed: OBSERVED });
    const after = accountCreated(state, { accountId: "acct-1", now: NOW });
    if (after?.account === undefined) expect.unreachable("an account should have been produced");

    expect(unwrapConfirmed(after.account.email)).toBe(EMAIL);
    expect(after.account.createdBy).toBe("askimate_on_behalf");
    expect(after.account.createdAt).toEqual(NOW);
    expect(after.account.caseId).toBe("case-1");
    expect(after.account.studentRef).toBe(STUDENT);
  });

  it("waits for the student where the portal verifies the address first", () => {
    // A portal that emails a verification link has emailed the STUDENT, and
    // this system has no mailbox capability and never will. Marking such an
    // account `active` would send a run on to fill a form the portal will not
    // show it — and the student would never be asked to click the link.
    const verifying: ObservedPortalAuthentication = {
      ...OBSERVED,
      emailVerificationRequired: true,
    };
    const after = accountCreated(
      stateWith({ profile: withEmail(EMAIL), observed: verifying }),
      { accountId: "acct-1", now: NOW },
    );
    expect(after?.account?.stage).toBe("awaiting_email_verification");

    // And where discovery observed it is not needed, the account is usable.
    const straight = accountCreated(
      stateWith({ profile: withEmail(EMAIL), observed: OBSERVED }),
      { accountId: "acct-1", now: NOW },
    );
    expect(straight?.account?.stage).toBe("active");
  });

  it("produces NOTHING without a confirmed email", () => {
    // `accountStepFor` refuses this to `specialist / no_confirmed_email`, and
    // answering `null` here is what keeps that refusal the one that happens
    // rather than being pre-empted by an account with an invented address.
    const after = accountCreated(
      stateWith({ profile: emptyProfile(STUDENT, NOW), observed: OBSERVED }),
      { accountId: "acct-1", now: NOW },
    );
    expect(after).toBeNull();
  });

  it("keeps an account the ledger says exists in view, with NO plan, when nobody has observed how the portal signs people in (P300)", () => {
    // Without observations `chooseApproach` refuses, and "we used a password
    // because that is what the code did" must not be a reachable state — so
    // there is no plan. Until P300 there was no account either, and a run
    // that held one lost sight of it (row 170). The account is a fact of the
    // ledger, not of the plan.
    const after = accountCreated(stateWith({ profile: withEmail(EMAIL) }), {
      accountId: "acct-1",
      now: NOW,
    });
    if (after?.account === undefined) expect.unreachable("the account is still there");
    expect(after.account.stage).toBe("unplanned");
    expect(after.account.authentication).toBeNull();
  });

  // Vahid, 2026-10-12: "A run that holds an account must never lose sight of
  // it because an auth fact reads "unobserved". A stop or abandon must never
  // close a case as owing the student nothing while an account created in
  // their name has not been handed back."
  it.each([
    ["created in the student's name", (state: RunState) => accountCreated(state, { accountId: "acct-1", now: NOW })],
    ["declared by the student", (state: RunState) => accountDeclared(state, { accountId: "acct-1", declaredAt: NOW, now: NOW })],
  ] as const)("an account %s stays in view, owed and unplanned, when a fact reads unobserved (P300, row 170)", (_whose, derive) => {
    const unobserved: ObservedPortalAuthentication = { ...OBSERVED, passwordResetAvailable: "unobserved" };
    const after = derive(stateWith({ profile: withEmail(EMAIL), observed: unobserved }));
    if (after?.account === undefined) expect.unreachable("the account is still there");
    expect(after.account.stage).toBe("unplanned");
    expect(after.account.authentication).toBeNull();
    expect(unwrapConfirmed(after.account.email)).toBe(EMAIL);
    // Owed: it may not conclude, and every handover item is outstanding.
    const conclusion = mayConcludeCase([after.account]);
    expect(conclusion.may).toBe(false);
    // "Cannot be shown", not "has not" (the P300 review): with no plan there
    // is nothing to check a handover against.
    expect(conclusion.outstanding.join(" ")).toContain("cannot be shown to have been handed back");
    expect(outstandingHandoverItems(after.account).length).toBeGreaterThan(0);
    // That the run then stops for a person, told which account, is the
    // driver's test (run-driver.test.ts, P300, row 170), on the real step.
  });

  it("an account the evidence shows handed back is held open, and not said to be unreturned, when a fact then reads unobserved (the P300 review)", () => {
    // The review ran this: handed back under the facts as observed, then one
    // fact unobserved. The account is held open — every item, the strictest
    // reading, because with no plan nothing says which items applied — and
    // whether evidence without a plan may close it is Vahid's to say (row
    // 172). What it must not do is state as fact that it was not handed back.
    const handedBack: HandoverEvidence = {
      raised: ["account_handover"],
      completed: ["account_handover", "email_verification", "password_reset"],
      askimateRetainsNoAccess: true,
      applicationFilled: true,
      runStopped: true,
    };
    const observed = accountCreated(stateWith({ profile: withEmail(EMAIL), observed: OBSERVED }), { accountId: "acct-1", now: NOW, handover: handedBack });
    expect(observed?.account?.stage, "handed back, under the facts as observed").toBe("handed_over");
    const unobserved: ObservedPortalAuthentication = { ...OBSERVED, passwordResetAvailable: "unobserved" };
    const after = accountCreated(stateWith({ profile: withEmail(EMAIL), observed: unobserved }), { accountId: "acct-1", now: NOW, handover: handedBack });
    if (after?.account === undefined) expect.unreachable("the account is still there");
    expect(after.account.stage).toBe("unplanned");
    const conclusion = mayConcludeCase([after.account]);
    expect(conclusion.may, "held open").toBe(false);
    const said = conclusion.outstanding.join(" ");
    expect(said).toContain("cannot be shown to have been handed back");
    expect(said, "never stated as fact").not.toContain("has not been handed back");
  });

  it.each([
    ["created in the student's name", (state: RunState) => accountCreated(state, { accountId: "acct-1", now: NOW })],
    ["declared by the student", (state: RunState) => accountDeclared(state, { accountId: "acct-1", declaredAt: NOW, now: NOW })],
  ] as const)("the handover of an account %s says what the portal's reset does, from the portal's own record (P301)", (_whose, derive) => {
    // Vahid, 2026-10-12: "If a student loses their password, the handover
    // message must tell them that resetting replaces their password at once
    // and the new one arrives by e-mail." Read from the plan's observations,
    // so the text the student is shown is the text recorded and hashed.
    const sheffield: ObservedPortalAuthentication = { ...OBSERVED, passwordResetSends: "new_password_in_plain_text" };
    const told = derive(stateWith({ profile: withEmail(EMAIL), observed: sheffield }))?.account?.handover?.presentedText ?? "";
    expect(told).toContain("replaces your password at once");
    expect(told).toContain("the new one arrives by e-mail");
    const untried = derive(stateWith({ profile: withEmail(EMAIL), observed: OBSERVED }))?.account?.handover?.presentedText ?? "";
    expect(untried, "a portal nobody has tried is told nothing of it").not.toContain("replaces your password");
  });

  it("the handover of an account we made, on a portal that never e-mailed the student, says the reset is owed now — as the list beside it does (P301's review)", () => {
    // ADR-0050 §4 asks for the portal's reset before such an account is
    // handed back. The text said it was for a lost password while the list
    // sent with it asked for it now. Whether the requirement should stand on
    // Sheffield is Vahid's (row 177); the text and the list now agree.
    const sheffield: ObservedPortalAuthentication = { ...OBSERVED, passwordResetSends: "new_password_in_plain_text" };
    const created = accountCreated(stateWith({ profile: withEmail(EMAIL), observed: sheffield }), { accountId: "acct-1", now: NOW });
    const told = created?.account?.handover?.presentedText ?? "";
    expect(outstandingHandoverItems(created?.account ?? expect.unreachable("an account")).join(" ")).toContain("reset");
    expect(told).toContain("One thing is left before I can close this off");
    expect(told).toContain("replaces your password at once");
    expect(told).not.toContain("If you ever lose your password");
    // The student's own account owes no reset (ADR-0110), and is not told one is owed.
    const declared = accountDeclared(stateWith({ profile: withEmail(EMAIL), observed: sheffield }), { accountId: "acct-1", declaredAt: NOW, now: NOW });
    const theirs = declared?.account?.handover?.presentedText ?? "";
    expect(theirs).not.toContain("One thing is left");
    expect(theirs).toContain("If you ever lose your password");
  });

  it("does not mutate the state it was given", () => {
    const before = stateWith({ profile: withEmail(EMAIL), observed: OBSERVED });
    const after = accountCreated(before, { accountId: "acct-1", now: NOW });
    expect(before.account).toBeUndefined();
    expect(after).not.toBe(before);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// P12 — the stage, derived from what has happened (ADR-0050)
// ───────────────────────────────────────────────────────────────────────────

describe("where the account stands", () => {
  const evidence = (over: Partial<HandoverEvidence> = {}): HandoverEvidence => ({
    raised: [],
    completed: [],
    askimateRetainsNoAccess: false,
    applicationFilled: false,
    ...over,
  });

  const stageWith = (
    handover: HandoverEvidence,
    observed: ObservedPortalAuthentication = OBSERVED,
  ): string | undefined =>
    accountCreated(stateWith({ profile: withEmail(EMAIL), observed }), {
      accountId: "acct-1",
      now: NOW,
      handover,
    })?.account?.stage;

  const VERIFYING: ObservedPortalAuthentication = {
    ...OBSERVED,
    emailVerificationRequired: true,
  };

  it("stays with the verification until the student says they did it", () => {
    expect(stageWith(evidence(), VERIFYING)).toBe("awaiting_email_verification");
    expect(stageWith(evidence({ completed: ["email_verification"] }), VERIFYING)).toBe("active");
  });

  it("becomes handover_due when the application is done, not before", () => {
    // ═══════════════════════════════════════════════════════════════════
    // `handover_due` — "we meant to give it back" — is the stage
    // `mayConcludeCase` refuses BY NAME, and it exists because the moment a
    // case is finished is the moment it is tempting to stop. Reaching it
    // early would be worse: handing the account back before the form is
    // filled means asking the student to change the password we are about to
    // sign in with.
    // ═══════════════════════════════════════════════════════════════════
    expect(stageWith(evidence({ applicationFilled: false }))).toBe("active");
    expect(stageWith(evidence({ applicationFilled: true }))).toBe("handover_due");
  });

  it("reaches handed_over only when every applicable item is a FACT", () => {
    // This portal does not verify email, so the proof of receipt is the
    // portal's own password reset (ADR-0050). Three of the four items are
    // student-side and each is a completed handoff.
    const nearly = evidence({
      applicationFilled: true,
      raised: ["account_handover"],
      completed: ["password_reset"],
      askimateRetainsNoAccess: true,
    });
    expect(stageWith(nearly), "they have not said they are in").toBe("handover_due");

    expect(
      stageWith({ ...nearly, completed: ["password_reset", "account_handover"] }),
    ).toBe("handed_over");
  });

  it("will NOT hand over while a lease is still open", () => {
    // A runner holding this run is a browser somewhere that can still reach
    // the portal. That is operational access whether or not a credential was
    // involved, and it is on every checklist (ADR-0020 §3).
    const held = evidence({
      applicationFilled: true,
      raised: ["account_handover"],
      completed: ["password_reset", "account_handover"],
      askimateRetainsNoAccess: false,
    });
    expect(stageWith(held)).toBe("handover_due");
  });

  it("will NOT hand over on a verifying portal until the address is verified", () => {
    // The other half of the substitution: where the portal DOES verify, the
    // reset is not a stand-in for anything.
    const done = evidence({
      applicationFilled: true,
      raised: ["account_handover"],
      completed: ["password_reset", "account_handover"],
      askimateRetainsNoAccess: true,
    });
    expect(stageWith(done, VERIFYING), "unverified, and not asked yet either").toBe(
      "awaiting_email_verification",
    );
    expect(
      stageWith({ ...done, completed: [...done.completed, "email_verification"] }, VERIFYING),
    ).toBe("handed_over");
  });

  it("answers the same for the same evidence, however often it is asked", () => {
    // The stage is a DERIVATION and nothing stores it. A function that
    // answered differently on a second call would be the stored stage this
    // deliberately is not.
    const facts = evidence({
      applicationFilled: true,
      raised: ["account_handover"],
      completed: ["password_reset", "account_handover"],
      askimateRetainsNoAccess: true,
    });
    expect(stageWith(facts)).toBe(stageWith(facts));
  });
});

describe("the account the student declared (ADR-0110)", () => {
  const DECLARED_AT = new Date("2026-09-14T09:00:00Z");

  it("is theirs, made by them, active from the declaration, with the confirmed e-mail", () => {
    const state = stateWith({ profile: withEmail(EMAIL), observed: OBSERVED });
    const after = accountDeclared(state, { accountId: "acct-1", declaredAt: DECLARED_AT, now: NOW });
    if (after?.account === undefined) expect.unreachable("an account should have been derived");
    expect(after.account.createdBy).toBe("student");
    expect(after.account.createdAt).toEqual(DECLARED_AT);
    expect(after.account.stage).toBe("active");
    expect(unwrapConfirmed(after.account.email)).toBe(EMAIL);
    expect(after.account.authentication?.approach).toBe("student_chosen");
  });

  it("does not wait for the portal's e-mail verification: they sign in with the address, so it works", () => {
    const verifying: ObservedPortalAuthentication = { ...OBSERVED, emailVerificationRequired: true };
    const after = accountDeclared(
      stateWith({ profile: withEmail(EMAIL), observed: verifying }),
      { accountId: "acct-1", declaredAt: DECLARED_AT, now: NOW },
    );
    expect(after?.account?.stage).toBe("active");
  });

  it("owes no address proof at handover — Vahid's waiver, 2026-09-14", () => {
    // *"waive it for an account the student created themselves ... Keep it for
    // an account we created on their behalf, where the address was never tested."*
    for (const observed of [OBSERVED, { ...OBSERVED, emailVerificationRequired: true }]) {
      const after = accountDeclared(
        stateWith({ profile: withEmail(EMAIL), observed }),
        { accountId: "acct-1", declaredAt: DECLARED_AT, now: NOW },
      );
      if (after?.account === undefined) expect.unreachable("an account should have been derived");
      const outstanding = outstandingHandoverItems(after.account);
      expect(outstanding.join("; ")).not.toContain("reset flow");
      expect(outstanding.join("; ")).not.toContain("verified the student's own email");
      expect(outstanding.join("; ")).toContain("confirmed they can sign in");
    }
    // And an account WE made still owes the substitute proof (ADR-0050 stands).
    const ours = accountCreated(stateWith({ profile: withEmail(EMAIL), observed: OBSERVED }), { accountId: "acct-2", now: NOW });
    if (ours?.account === undefined) expect.unreachable("an account should have been produced");
    expect(outstandingHandoverItems(ours.account).join("; ")).toContain("reset flow");
  });

  it("is due back once the application is filled, as any account is", () => {
    const after = accountDeclared(stateWith({ profile: withEmail(EMAIL), observed: OBSERVED }), {
      accountId: "acct-1",
      declaredAt: DECLARED_AT,
      now: NOW,
      handover: { raised: [], completed: [], askimateRetainsNoAccess: false, applicationFilled: true, runStopped: false },
    });
    expect(after?.account?.stage).toBe("handover_due");
  });

  it("cannot be declared without a confirmed e-mail, exactly as it could not be created", () => {
    expect(accountDeclared(stateWith({ profile: emptyProfile(STUDENT, NOW), observed: OBSERVED }), { accountId: "acct-1", declaredAt: DECLARED_AT, now: NOW })).toBeNull();
  });
});
