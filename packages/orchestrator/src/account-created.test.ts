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
import type { ObservedPortalAuthentication } from "@askimate/aas-account";
import { newInterview } from "@askimate/aas-interview";
import {
  GATED_PORTAL_BLUEPRINT,
  GATED_PORTAL_MAPPING_SET,
} from "@askimate/aas-mapping/fixtures/gated";
import { applyConfirmation, confirmField, emptyProfile, isDeclined } from "@askimate/aas-profile";
import type { ConfirmedProfile } from "@askimate/aas-profile";

import { accountCreated, beginRun } from "./run.js";
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

  it("produces NOTHING when nobody has observed how the portal signs people in", () => {
    // Without observations `chooseApproach` refuses, and "we used a password
    // because that is what the code did" must not be a reachable state.
    const after = accountCreated(stateWith({ profile: withEmail(EMAIL) }), {
      accountId: "acct-1",
      now: NOW,
    });
    expect(after).toBeNull();
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
