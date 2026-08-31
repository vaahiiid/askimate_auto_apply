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
import type { RunState } from "./run.js";

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
