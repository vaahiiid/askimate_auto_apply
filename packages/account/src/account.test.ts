import { describe, expect, it } from "vitest";

import { proposeValue, studentId, unwrapConfirmed } from "@askimate/aas-domain";
import type { ConfirmedValue } from "@askimate/aas-domain";
import { applyConfirmation, isDeclined } from "@askimate/aas-profile";

import {
  authenticationQuestions,
  chooseApproach,
  describePlan,
  mintCredentialUnder,
  type AuthenticationPlan,
  type ObservedPortalAuthentication,
} from "./authentication.js";
import { EphemeralCredential } from "./credential.js";
import {
  checkHandoverComplete,
  mayConcludeCase,
  outstandingHandoverItems,
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
    approach: "generated_ephemeral",
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
    authentication: EPHEMERAL_PLAN(),
    authorisation: AUTHORISATION,
    ourDomains: OUR_DOMAINS,
    ...overrides,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Fixtures: portals, as observed
// ───────────────────────────────────────────────────────────────────────────

const PROVENANCE = {
  portalHost: "apply.qahighereducation.com",
  discoveryRunId: "disc-2026-08-26-1",
  observedAt: NOW,
} as const;

/** A portal that requires a password we choose. The last-resort case. */
const PASSWORD_PORTAL: ObservedPortalAuthentication = {
  ...PROVENANCE,
  applicantChoosesPassword: true,
  portalIssuesCredential: false,
  passwordlessAvailable: false,
  emailVerificationRequired: true,
  mfaOrOtpRequired: false,
  captchaPresent: true,
  passwordResetAvailable: true,
  credentialsCanBeHandedBack: true,
};

/** The same portal, but it offers a magic link. */
const PASSWORDLESS_PORTAL: ObservedPortalAuthentication = {
  ...PASSWORD_PORTAL,
  passwordlessAvailable: true,
};

function planFor(
  observed: ObservedPortalAuthentication,
  studentPresentAtCreation = false,
): AuthenticationPlan {
  const choice = chooseApproach({ observed, studentPresentAtCreation });
  if (!choice.chosen) expect.unreachable(`expected a plan: ${choice.refusal.kind}`);
  return choice.plan;
}

const EPHEMERAL_PLAN = (): AuthenticationPlan => planFor(PASSWORD_PORTAL);
const PASSWORDLESS_PLAN = (): AuthenticationPlan => planFor(PASSWORDLESS_PORTAL);

// ───────────────────────────────────────────────────────────────────────────
// The temporary credential
// ───────────────────────────────────────────────────────────────────────────

describe("a temporary credential", () => {
  const credential = (): EphemeralCredential =>
    EphemeralCredential.generate({
      expiresAt: LATER,
      purpose: "create the Ulster application account",
    });

  /** Reads the secret out, which only a test has any business doing. */
  const secretOf = (held: EphemeralCredential, at: Date = NOW): string => {
    const used = held.useTo(at, "read it in a test", (secret) => secret);
    if (!used.ok) expect.unreachable(`expected it to be usable: ${used.reason.kind}`);
    return used.result;
  };

  it("is GENERATED — there is no way to supply a secret", () => {
    // The load-bearing property, and a compile-time test rather than a runtime
    // one. A password a person chose — typed into a config, pasted into an
    // issue, reused from somewhere else — cannot enter the system, because no
    // function accepts one. If a `create({ secret })` were added, the
    // directive below would go unused and the build would fail.
    // @ts-expect-error there is no way to supply a secret.
    type _NoSuppliedSecret = typeof EphemeralCredential.create;

    // And nothing else on the static side takes one either.
    expect(Object.getOwnPropertyNames(EphemeralCredential)).not.toContain("create");
  });

  it("generates something long and unguessable", () => {
    expect(secretOf(credential()).length).toBeGreaterThanOrEqual(32);
  });

  it("generates a different secret every time", () => {
    const seen = new Set(Array.from({ length: 50 }, () => secretOf(credential())));
    expect(seen.size).toBe(50);
  });

  it("satisfies the usual portal rules by construction, not by retrying", () => {
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const secret = secretOf(credential());
      expect(secret).toMatch(/[a-z]/);
      expect(secret).toMatch(/[A-Z]/);
      expect(secret).toMatch(/[0-9]/);
      expect(secret).toMatch(/[^a-zA-Z0-9]/);
    }
  });

  it("does not leave the class-per-position seeding visible", () => {
    // Without the shuffle the first four characters would always be
    // lower/upper/digit/symbol in that order, which is a real weakness and an
    // easy one to ship by accident.
    const firsts = new Set(Array.from({ length: 40 }, () => secretOf(credential()).charAt(0)));
    expect(firsts.size).toBeGreaterThan(4);
  });

  it("can be used while it is alive", () => {
    const held = credential();
    const used = held.useTo(NOW, "sign in", (secret) => secret.length);
    if (!used.ok) expect.unreachable("still valid");
    expect(used.result).toBeGreaterThan(0);
  });

  it("REDACTS itself through JSON.stringify", () => {
    // The route that matters most: a credential on a case record, serialised
    // into an event or a log line, is a live password sitting somewhere
    // nobody is thinking about.
    const held = credential();
    const secret = secretOf(held);
    const serialised = JSON.stringify({ account: "acct-1", password: held });
    expect(serialised).not.toContain(secret);
    expect(serialised).toContain("never logged");
  });

  it("REDACTS itself in a template literal", () => {
    const held = credential();
    expect(`password is ${String(held)}`).not.toContain(secretOf(held));
  });

  it("REDACTS itself in console output", async () => {
    // Node's inspect is what console.log uses, so this is the route a
    // credential takes into a terminal, a log aggregator and a bug report.
    const { inspect } = await import("node:util");
    const held = credential();
    expect(inspect(held)).not.toContain(secretOf(held));
  });

  it("is not retrievable as a property, only through useTo", () => {
    // An operator reading a case record, an export, or a debugger's object
    // view finds nothing. `useTo` is the only door and its call sites are
    // countable.
    const held = credential();
    expect(Object.keys(held)).toHaveLength(0);
    expect(JSON.parse(JSON.stringify({ held }))).toEqual({
      held: "[temporary credential — generated, never logged, never retrievable]",
    });
  });

  it("refuses to be used after it expires, and destroys itself", () => {
    const held = credential();
    const used = held.useTo(new Date("2026-08-26T12:00:01Z"), "sign in", (secret) => secret);

    if (used.ok) expect.unreachable("expired");
    expect(used.reason.kind).toBe("expired");
    // Destroyed rather than merely refused, so a clock going backwards cannot
    // resurrect it.
    expect(held.destroyed).toBe(true);
  });

  it("does not run the task at all once it is unusable", () => {
    const held = credential();
    held.destroy();
    let ran = false;
    held.useTo(NOW, "sign in", () => {
      ran = true;
      return null;
    });
    expect(ran).toBe(false);
  });

  it("cannot be recovered once destroyed", () => {
    const held = credential();
    held.destroy();
    const used = held.useTo(NOW, "sign in", (secret) => secret);
    if (used.ok) expect.unreachable("destroyed");
    expect(used.reason.kind).toBe("destroyed");
  });

  it("is idempotent to destroy", () => {
    const held = credential();
    held.destroy();
    held.destroy();
    expect(held.destroyed).toBe(true);
  });

  it("counts how often it was used, as an audit signal", () => {
    const held = credential();
    held.useTo(NOW, "create the account", () => null);
    held.useTo(NOW, "sign in", () => null);
    expect(held.useCount).toBe(2);
  });

  it("insists on a stated purpose — it is the only thing written down", () => {
    expect(() => EphemeralCredential.generate({ expiresAt: LATER, purpose: "  " })).toThrow();
  });

  it("REFUSES a portal cap that would make it weak, rather than honouring it", () => {
    // A portal that caps passwords at eight characters is a fact a specialist
    // should see. Quietly generating an eight-character credential is how a
    // weak one gets created with nobody having chosen to.
    expect(() =>
      EphemeralCredential.generate({
        expiresAt: LATER,
        purpose: "x",
        policy: { maxLength: 8, observedFrom: "the portal's stated policy" },
      }),
    ).toThrow(/floor/);
  });

  it("honours a cap that is still safe", () => {
    const held = EphemeralCredential.generate({
      expiresAt: LATER,
      purpose: "x",
      policy: { maxLength: 20, observedFrom: "the portal rejected a longer one" },
    });
    expect(secretOf(held)).toHaveLength(20);
  });

  it("refuses a policy that excludes a whole character class", () => {
    expect(() =>
      EphemeralCredential.generate({
        expiresAt: LATER,
        purpose: "x",
        policy: { excludedCharacters: "!#$%*+-=?@^_", observedFrom: "observed rejections" },
      }),
    ).toThrow(/character class/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Which approach, and why
// ───────────────────────────────────────────────────────────────────────────

describe("choosing an authentication approach", () => {
  it("prefers the student typing their own password when they are there to", () => {
    // The portal is identical. The only difference is that the student is at
    // their keyboard — and that is the whole difference between a password we
    // hold and one we never learn.
    const plan = planFor(PASSWORD_PORTAL, true);
    expect(plan.approach).toBe("student_chosen");
    expect(plan.askimateHoldsACredential).toBe(false);
  });

  it("says so plainly when the student's absence is what put us on a password", () => {
    const plan = EPHEMERAL_PLAN();
    const why = plan.rejected.find((entry) => entry.approach === "student_chosen")?.because;
    expect(why).toContain("will not be present");
  });

  it("PREFERS passwordless when the portal offers it", () => {
    const plan = PASSWORDLESS_PLAN();
    expect(plan.approach).toBe("passwordless");
    expect(plan.askimateHoldsACredential).toBe(false);
  });

  it("falls to a generated credential only when the portal makes us set one", () => {
    const plan = EPHEMERAL_PLAN();
    expect(plan.approach).toBe("generated_ephemeral");
    expect(plan.askimateHoldsACredential).toBe(true);
  });

  it("records why every better approach was unavailable", () => {
    // So "why are we holding a password for this student" has an answer made
    // of observations rather than of nobody having looked.
    const plan = EPHEMERAL_PLAN();
    expect(plan.rejected.map((entry) => entry.approach)).toEqual([
      "passwordless",
      "student_chosen",
      "portal_issued",
    ]);
    expect(plan.rejected[0]?.because).toContain("no passwordless");
  });

  it("prefers the portal issuing its own credential over generating one", () => {
    const plan = planFor({
      ...PASSWORD_PORTAL,
      applicantChoosesPassword: false,
      portalIssuesCredential: true,
    });
    expect(plan.approach).toBe("portal_issued");
    expect(plan.askimateHoldsACredential).toBe(false);
    expect(plan.studentMustBePresent).toBe(true);
  });

  it("REFUSES to choose while any question is unobserved", () => {
    // The load-bearing rule. An unobserved answer is not a "no" — treating it
    // as one is exactly how the password path wins by default.
    const choice = chooseApproach({
      observed: { ...PASSWORD_PORTAL, passwordlessAvailable: "unobserved" },
      studentPresentAtCreation: false,
    });
    if (choice.chosen) expect.unreachable("must refuse without observations");
    expect(choice.refusal.kind).toBe("unobserved");
    if (choice.refusal.kind !== "unobserved") expect.unreachable("narrowing");
    expect(choice.refusal.questions).toEqual([
      "Does the portal offer passwordless sign-in — a magic link, an emailed code, or similar?",
    ]);
  });

  it("names every unobserved question at once", () => {
    const choice = chooseApproach({
      observed: {
        ...PASSWORD_PORTAL,
        passwordlessAvailable: "unobserved",
        mfaOrOtpRequired: "unobserved",
        passwordResetAvailable: "unobserved",
      },
      studentPresentAtCreation: false,
    });
    if (choice.chosen) expect.unreachable("must refuse");
    if (choice.refusal.kind !== "unobserved") expect.unreachable("narrowing");
    expect(choice.refusal.questions).toHaveLength(3);
  });

  it("STOPS before anything else if the account cannot be handed back", () => {
    // Asked before the approach, because a portal we cannot hand back from is
    // not one to create an account on however convenient its login is.
    const choice = chooseApproach({
      observed: { ...PASSWORDLESS_PORTAL, credentialsCanBeHandedBack: false },
      studentPresentAtCreation: false,
    });
    if (choice.chosen) expect.unreachable("must refuse");
    expect(choice.refusal.kind).toBe("handover_impossible");
  });

  it("refuses handover-impossible even while other questions are unobserved", () => {
    const choice = chooseApproach({
      observed: {
        ...PASSWORD_PORTAL,
        credentialsCanBeHandedBack: false,
        passwordlessAvailable: "unobserved",
      },
      studentPresentAtCreation: false,
    });
    if (choice.chosen) expect.unreachable("must refuse");
    expect(choice.refusal.kind).toBe("handover_impossible");
  });

  it("refuses when the applicant creates no account at all", () => {
    const choice = chooseApproach({
      observed: {
        ...PASSWORD_PORTAL,
        applicantChoosesPassword: false,
        portalIssuesCredential: false,
        passwordlessAvailable: false,
      },
      studentPresentAtCreation: true,
    });
    if (choice.chosen) expect.unreachable("must refuse");
    expect(choice.refusal.kind).toBe("no_workable_approach");
  });

  it("carries the discovery run it was decided from", () => {
    expect(EPHEMERAL_PLAN().basedOn.discoveryRunId).toBe("disc-2026-08-26-1");
  });

  it("lists the handoffs the portal forces", () => {
    expect(EPHEMERAL_PLAN().handoffs).toEqual(["email_verification", "captcha"]);
  });

  it("describes itself, leading with whether we hold anything", () => {
    const described = describePlan(EPHEMERAL_PLAN());
    expect(described).toContain("AskiMate HOLDS a generated credential");
    expect(describePlan(PASSWORDLESS_PLAN())).toContain("holds no credential");
  });

  it("publishes the questions discovery has to answer", () => {
    expect(authenticationQuestions()).toHaveLength(8);
  });
});

describe("minting a credential", () => {
  it("is permitted under the approach that requires one", () => {
    const mint = mintCredentialUnder(EPHEMERAL_PLAN(), { expiresAt: LATER, purpose: "sign in" });
    expect(mint.minted).toBe(true);
  });

  it("is REFUSED under an approach that does not", () => {
    // Without this gate the ranking is advice: a caller could choose
    // passwordless, ignore it, and generate a password anyway.
    const mint = mintCredentialUnder(PASSWORDLESS_PLAN(), {
      expiresAt: LATER,
      purpose: "sign in",
    });
    if (mint.minted) expect.unreachable("must be refused");
    expect(mint.refusal.kind).toBe("not_permitted_by_approach");
    expect(mint.refusal.detail).toContain("passwordless");
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

  it("REFUSES without a chosen authentication approach", () => {
    // Not a runtime check — a type one. An account cannot be prepared before
    // the approach is settled, and the approach cannot be settled before the
    // portal has been observed.
    const { authentication: _none, ...withoutPlan } = creationInput();
    // @ts-expect-error `authentication` is required, and making it optional
    // would make this directive unused and fail the build.
    prepareAccountCreation(withoutPlan);
  });

  it("carries the plan onto the account, with its observations", () => {
    const check = prepareAccountCreation(creationInput());
    if (!check.permitted) expect.unreachable("permitted");
    expect(check.account.authentication.approach).toBe("generated_ephemeral");
    expect(check.account.authentication.basedOn.discoveryRunId).toBe("disc-2026-08-26-1");
  });

  it("tells the student the account is theirs and how they take control", () => {
    const text = renderAccountCreationRequest({
      institutionName: "Ulster University",
      portalHost: "apply.qahighereducation.com",
      email: "niloofar@example.com",
      approach: "generated_ephemeral",
    });

    expect(text).toContain("your own email address");
    expect(text).toContain("Forgot password");
    expect(text).toContain("only you can get in");
    expect(text).toContain("are yours");
  });

  it("does NOT promise a temporary password where there will not be one", () => {
    // Telling a student we will set a password when we will not is a small
    // lie that makes the handover text later make no sense.
    const text = renderAccountCreationRequest({
      institutionName: "Ulster University",
      portalHost: "apply.qahighereducation.com",
      email: "niloofar@example.com",
      approach: "passwordless",
    });

    expect(text).not.toContain("temporary");
    expect(text).toContain("no password for me to set or to know");
    expect(text).toContain("link it emails to you");
    expect(text).toContain("are yours");
  });

  it("says plainly that the student types their own password where they do", () => {
    const text = renderAccountCreationRequest({
      institutionName: "Ulster University",
      portalHost: "apply.qahighereducation.com",
      email: "niloofar@example.com",
      approach: "student_chosen",
    });
    expect(text).toContain("I never see it");
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
  askimateRetainsNoAccess: true,
  studentConfirmedAccess: true,
};

const NOTHING_DONE: HandoverChecklist = {
  emailVerifiedByPortal: false,
  studentInformed: false,
  passwordResetCompleted: false,
  temporaryCredentialDestroyed: false,
  askimateRetainsNoAccess: false,
  studentConfirmedAccess: false,
};

/**
 * A plan with a chosen approach, on a portal that DOES verify email.
 *
 * Built through `chooseApproach` where the observations reach it, and stamped
 * otherwise: three of the four approaches are unreachable from the two portal
 * fixtures above, and the point of these tests is the checklist rather than
 * the ranking (which `chooseApproach`'s own tests cover).
 */
function planWith(
  approach: AuthenticationPlan["approach"],
  observed: ObservedPortalAuthentication = PASSWORD_PORTAL,
): AuthenticationPlan {
  return { ...planFor(observed), approach, basedOn: observed };
}

function handover(
  checklist: HandoverChecklist,
  approach: AuthenticationPlan["approach"] = "generated_ephemeral",
  observed: ObservedPortalAuthentication = PASSWORD_PORTAL,
) {
  return checkHandoverComplete({
    checklist,
    plan: planWith(approach, observed),
    completedAt: LATER,
    presentedText: renderHandover({
      institutionName: "Ulster University",
      portalHost: "apply.qahighereducation.com",
      email: "niloofar@example.com",
      approach,
    }),
  });
}

describe("handover", () => {
  it("completes when every item is done", () => {
    expect(handover(COMPLETE).complete).toBe(true);
  });

  it("gives NO partial credit", () => {
    // All but one is an account the student cannot fully control, and
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

  it("will not call it done while we still have operational access", () => {
    // A signed-in browser session is operational access whether or not a
    // credential was involved, so this applies under every approach.
    expect(handover({ ...COMPLETE, askimateRetainsNoAccess: false }).complete).toBe(false);
    expect(
      handover({ ...COMPLETE, askimateRetainsNoAccess: false }, "passwordless").complete,
    ).toBe(false);
  });

  it("lists everything outstanding at once, not one at a time", () => {
    const check = handover(NOTHING_DONE);
    if (check.complete) expect.unreachable("incomplete");
    expect(check.refusal.outstanding).toHaveLength(6);
  });

  it("drops the password items only where there was never a password", () => {
    // "Some items do not apply" is the shape of a loophole, so what matters is
    // how it is reached: the approach comes from `chooseApproach`, which
    // refuses without observations. You cannot CLAIM the item is
    // inapplicable — you have to have found a portal where it is.
    const check = handover(
      { ...NOTHING_DONE, emailVerifiedByPortal: true, studentInformed: true },
      "passwordless",
    );
    if (check.complete) expect.unreachable("incomplete");
    expect(check.refusal.outstanding).toEqual([
      "AskiMate retains no operational access — no live session, no stored token, no second factor",
      "the student has confirmed they can sign in",
    ]);
  });

  it("substitutes the reset flow where the portal does not verify the address", () => {
    // ═══════════════════════════════════════════════════════════════════
    // ADR-0050. `emailVerifiedByPortal` is the only external proof the student
    // can RECEIVE at the account's address. A portal that never verifies has
    // no such proof to give, and under the first version of `applicableItems`
    // no account on one could ever be handed over — a deadlock, not a safety
    // property.
    //
    // The substitution keeps the property and changes the mechanism: the
    // portal's own password reset also reaches their inbox. One proof either
    // way, and it is the portal's email that provides it.
    // ═══════════════════════════════════════════════════════════════════
    const nonVerifying: ObservedPortalAuthentication = {
      ...PASSWORD_PORTAL,
      emailVerificationRequired: false,
    };

    // Verification cannot be the proof here, and saying it happened does not
    // help: the item is not on the list at all.
    const claimed = handover(
      { ...NOTHING_DONE, emailVerifiedByPortal: true, studentInformed: true,
        askimateRetainsNoAccess: true, studentConfirmedAccess: true },
      "student_chosen",
      nonVerifying,
    );
    if (claimed.complete) expect.unreachable("the reset has not happened");
    expect(claimed.refusal.outstanding).toEqual([
      "the student has set their own password via the portal's reset flow",
    ]);

    // And with the reset done it completes, with no verification anywhere.
    const done = handover(
      { ...NOTHING_DONE, passwordResetCompleted: true, studentInformed: true,
        askimateRetainsNoAccess: true, studentConfirmedAccess: true },
      "student_chosen",
      nonVerifying,
    );
    expect(done.complete, "the reset stands in for the verification").toBe(true);
  });

  it("does NOT drop the verification where the portal DOES verify", () => {
    // The other half. A substitution that fired everywhere would be the
    // exemption this deliberately is not.
    const check = handover(
      { ...NOTHING_DONE, passwordResetCompleted: true, studentInformed: true,
        askimateRetainsNoAccess: true, studentConfirmedAccess: true },
      "student_chosen",
      PASSWORD_PORTAL,
    );
    if (check.complete) expect.unreachable("the address is unverified");
    expect(check.refusal.outstanding).toEqual([
      "the portal has verified the student's own email address",
    ]);
  });

  it("asks for the reset ONCE where it is both substituted and held", () => {
    // `generated_ephemeral` on a non-verifying portal reaches
    // `passwordResetCompleted` twice — by substitution and because we held a
    // credential. A duplicated item would report the same outstanding line
    // twice to a student.
    const check = handover(NOTHING_DONE, "generated_ephemeral", {
      ...PASSWORD_PORTAL,
      emailVerificationRequired: false,
    });
    if (check.complete) expect.unreachable("nothing is done");
    const resets = check.refusal.outstanding.filter((line) => line.includes("reset flow"));
    expect(resets).toHaveLength(1);
  });

  it("still requires the student to confirm access under every approach", () => {
    for (const approach of [
      "passwordless",
      "student_chosen",
      "portal_issued",
      "generated_ephemeral",
    ] as const) {
      expect(handover({ ...COMPLETE, studentConfirmedAccess: false }, approach).complete).toBe(
        false,
      );
    }
  });

  it("tells the student how to get in without us", () => {
    const text = renderHandover({
      institutionName: "Ulster University",
      portalHost: "apply.qahighereducation.com",
      email: "niloofar@example.com",
      approach: "generated_ephemeral",
    });

    expect(text).toContain("the account is yours");
    expect(text).toContain("Forgot password");
    expect(text).toContain("only you can read");
    expect(text).toContain("only you can get into the account");
  });

  it("does not claim to have destroyed a password it never held", () => {
    const text = renderHandover({
      institutionName: "Ulster University",
      portalHost: "apply.qahighereducation.com",
      email: "niloofar@example.com",
      approach: "passwordless",
    });

    expect(text).toContain("never had a password for this account");
    expect(text).toContain("closed the session");
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
    authentication: EPHEMERAL_PLAN(),
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

  it("lists what is outstanding on an account nobody has started handing back", () => {
    expect(outstandingHandoverItems(account("handover_due"))).toHaveLength(6);
  });

  it("derives that list from the same gate that closes the case", () => {
    // So the list a student is shown and the check that lets a case close
    // cannot drift apart — including when the approach changes which apply.
    const handed: PortalAccount = {
      ...account("handover_due"),
      authentication: PASSWORDLESS_PLAN(),
      handover: {
        checklist: { ...COMPLETE, askimateRetainsNoAccess: false },
        approach: "passwordless",
        completedAt: LATER,
        presentedText: "",
      },
    };
    expect(outstandingHandoverItems(handed)).toEqual([
      "AskiMate retains no operational access — no live session, no stored token, no second factor",
    ]);
  });
});
