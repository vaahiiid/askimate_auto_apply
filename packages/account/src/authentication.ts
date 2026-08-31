/**
 * How we get into the portal — in order of preference, and chosen from what
 * the portal was observed to do rather than from what we hoped it would do.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-26:
 *
 *   *"The principle is that AskiMate should never become the long-term
 *   credential holder for a student's university account."*
 *
 *   1. *"If the university portal supports passwordless authentication, email
 *      verification, magic links, or another official mechanism that does not
 *      require us to know the student's permanent password, prefer that."*
 *   2. *"If the portal requires a password during account creation… the
 *      password should be automatically generated as a strong random
 *      credential… Treat it as an ephemeral credential only if the portal
 *      technically requires it."*
 *   3. *"The student must regain full control of the account… After successful
 *      handover, AskiMate must not retain operational access."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why this is a type and not a paragraph in a runbook ───────────────────
 *
 * "Prefer passwordless" is easy to write and easy to lose. The realistic way
 * it gets lost is not that someone disagrees with it — it is that the
 * passwordless path is more work, the password path already exists, and the
 * password path is what gets used because it is the one that is written down.
 *
 * So the ordering is data (`RANKED`), the choice is a function over observed
 * facts, and the function **refuses** rather than falls through. There is no
 * default approach, because a default would be the second-best one winning
 * every time nobody looked.
 *
 * ── The load-bearing part: "unobserved" is not "no" ───────────────────────
 *
 * Vahid: *"Do not guess any portal behaviour that has not been observed."*
 *
 * Each fact about the portal is `true | false | "unobserved"`, and
 * `"unobserved"` blocks. If discovery has not established whether the portal
 * offers a magic link, we do not get to conclude it does not — that is exactly
 * the reasoning that would put us on the password path by default.
 */

import { EphemeralCredential } from "./credential.js";
import type { PasswordPolicy } from "./credential.js";

// ───────────────────────────────────────────────────────────────────────────
// What the portal does
// ───────────────────────────────────────────────────────────────────────────

/**
 * A fact about a portal.
 *
 * The third case is the point. A boolean would force every unknown to be
 * `false`, and `false` reads as an observation.
 */
export type PortalAuthFact = true | false | "unobserved";

/**
 * What discovery must establish about a portal's authentication, one field per
 * question Vahid listed.
 *
 * Provenance is required. A record of portal behaviour with no run behind it
 * is someone's recollection, and this whole design turns on the difference.
 */
export interface ObservedPortalAuthentication {
  readonly portalHost: string;
  /** The discovery run these observations came from. */
  readonly discoveryRunId: string;
  readonly observedAt: Date;

  /** Does the applicant choose their own password at account creation? */
  readonly applicantChoosesPassword: PortalAuthFact;
  /** Does the portal generate a credential and send it to the applicant? */
  readonly portalIssuesCredential: PortalAuthFact;
  /** Magic link, emailed code, or another sign-in with no password at all. */
  readonly passwordlessAvailable: PortalAuthFact;
  /** Must the email be verified before the application form is reachable? */
  readonly emailVerificationRequired: PortalAuthFact;
  /** MFA or a one-time code, at any point. */
  readonly mfaOrOtpRequired: PortalAuthFact;
  readonly captchaPresent: PortalAuthFact;
  /** A working "Forgot password" that sends to the account's own address. */
  readonly passwordResetAvailable: PortalAuthFact;
  /**
   * Can control be returned cleanly — no lingering session, no second factor
   * bound to us, no admin or agent relationship that survives?
   */
  readonly credentialsCanBeHandedBack: PortalAuthFact;
}

// ───────────────────────────────────────────────────────────────────────────
// The ranked approaches
// ───────────────────────────────────────────────────────────────────────────

export type AuthenticationApproach =
  /**
   * No password exists for us to hold. A magic link or emailed code, which
   * reaches the student's own inbox and which we never read.
   *
   * **First choice, in Vahid's words.** Also the only approach under which the
   * question "what happened to the password" has no answer to get wrong.
   */
  | "passwordless"
  /**
   * The student chooses and types their own password. We never learn it.
   *
   * Requires them present at account creation. Strictly better than anything
   * where we hold a secret, and it needs no mechanism from us at all.
   */
  | "student_chosen"
  /**
   * The portal generates a credential and emails it to the student.
   *
   * We never read that email (this system has no mailbox capability at all),
   * so the student relays it or signs in themselves. Requires them present.
   */
  | "portal_issued"
  /**
   * We generate a strong random credential, hold it for minutes, and destroy
   * it at handover.
   *
   * **Last resort, and only where the portal technically requires a password
   * at account creation.** It is the only approach in which AskiMate ever
   * holds a secret to a student's university account, which is why it is last
   * and why `EphemeralCredential` is built the way it is.
   */
  | "generated_ephemeral";

/**
 * Preference order. Index 0 wins.
 *
 * Ranked by the principle Vahid stated — *never become the long-term
 * credential holder* — which means: how much of a credential do we ever hold?
 * Passwordless holds none and needs nobody present. The middle two hold none
 * but need the student present, so they cost availability rather than safety.
 * The last holds one for minutes.
 *
 * **Note for the record:** Vahid named the first and the last explicitly. The
 * middle two are derived from the same principle rather than dictated, and
 * they are flagged as such in ADR-0020 — both are cases where the portal or
 * the student already does the thing and we simply must not get in the way.
 */
export const AUTHENTICATION_APPROACHES: readonly AuthenticationApproach[] = [
  "passwordless",
  "student_chosen",
  "portal_issued",
  "generated_ephemeral",
];

/**
 * The same four, as the preference order. Index 0 wins.
 *
 * A separate name from `AUTHENTICATION_APPROACHES` even though the members are
 * identical today, because they answer different questions — *which approaches
 * exist* and *which do we prefer* — and a caller that wanted the set should not
 * be silently depending on the order, nor a caller that wanted the order be
 * broken by somebody sorting the set.
 */
const RANKED: readonly AuthenticationApproach[] = [
  "passwordless",
  "student_chosen",
  "portal_issued",
  "generated_ephemeral",
];

/** Human-readable, for the ADR, the plan and the refusal text. */
const APPROACH_DESCRIPTION: Readonly<Record<AuthenticationApproach, string>> = {
  passwordless:
    "sign in with a link or code the portal emails to the student — no password exists for " +
    "anyone to hold",
  student_chosen:
    "the student chooses and types their own password; we never learn it",
  portal_issued:
    "the portal issues a credential to the student's own email; we never read that email, so the " +
    "student signs in or relays it",
  generated_ephemeral:
    "we generate a strong random password, use it for minutes, and destroy it at handover — the " +
    "only approach in which we ever hold a secret",
};

/** Whether the student has to be at their keyboard for this approach to work. */
const NEEDS_STUDENT_PRESENT: Readonly<Record<AuthenticationApproach, boolean>> = {
  passwordless: true, // they open the link
  student_chosen: true,
  portal_issued: true,
  generated_ephemeral: false,
};

/** Whether AskiMate ever holds a secret under this approach. */
const WE_HOLD_A_SECRET: Readonly<Record<AuthenticationApproach, boolean>> = {
  passwordless: false,
  student_chosen: false,
  portal_issued: false,
  generated_ephemeral: true,
};

// ───────────────────────────────────────────────────────────────────────────
// Choosing
// ───────────────────────────────────────────────────────────────────────────

/**
 * The chosen approach, with the reasoning that produced it.
 *
 * `rejected` is not decoration. When a specialist asks "why are we holding a
 * password for this student", the answer has to be a list of the better
 * approaches and the observation that ruled each one out.
 */
export interface AuthenticationPlan {
  readonly portalHost: string;
  readonly approach: AuthenticationApproach;
  readonly description: string;
  /** Better approaches, and the observation that ruled each one out. */
  readonly rejected: readonly { readonly approach: AuthenticationApproach; readonly because: string }[];
  readonly studentMustBePresent: boolean;
  readonly askimateHoldsACredential: boolean;
  /** Handoffs the portal forces, drawn from the observations. */
  readonly handoffs: readonly ("email_verification" | "mfa_or_otp" | "captcha")[];
  /** The observations this was decided from. */
  readonly basedOn: ObservedPortalAuthentication;
}

export type AuthenticationRefusal =
  /** Not enough was observed to choose. Name the questions discovery must answer. */
  | { readonly kind: "unobserved"; readonly questions: readonly string[]; readonly detail: string }
  /** Everything was observed, and none of the approaches is available. */
  | { readonly kind: "no_workable_approach"; readonly detail: string }
  /** The portal cannot give the account back. That is a stop, not a trade-off. */
  | { readonly kind: "handover_impossible"; readonly detail: string };

export type AuthenticationChoice =
  | { readonly chosen: true; readonly plan: AuthenticationPlan }
  | { readonly chosen: false; readonly refusal: AuthenticationRefusal };

/** The question each fact answers, phrased for a person running discovery. */
const QUESTIONS: Readonly<
  Record<keyof Omit<ObservedPortalAuthentication, "portalHost" | "discoveryRunId" | "observedAt">, string>
> = {
  applicantChoosesPassword: "Does the applicant choose their own password at account creation?",
  portalIssuesCredential: "Does the portal generate a credential and send it to the applicant?",
  passwordlessAvailable:
    "Does the portal offer passwordless sign-in — a magic link, an emailed code, or similar?",
  emailVerificationRequired:
    "Must the email address be verified before the application form is reachable?",
  mfaOrOtpRequired: "Is MFA or a one-time code required at any point?",
  captchaPresent: "Is a CAPTCHA present, and on which pages?",
  passwordResetAvailable:
    "Does 'Forgot password' work, and does the reset go to the account's own address?",
  credentialsCanBeHandedBack:
    "Can control be handed back cleanly — no lingering session, no second factor bound to us?",
};

/**
 * Chooses the approach.
 *
 * Walks `RANKED` in order and takes the first the portal supports. Refuses
 * where the observations do not settle it.
 *
 * The ordering of the checks matters more than it looks. `handover_impossible`
 * is checked **first**, before any approach is considered, because a portal we
 * cannot hand the account back from is not a portal we should be creating an
 * account on — however convenient its authentication turns out to be.
 */
export function chooseApproach(input: {
  readonly observed: ObservedPortalAuthentication;
  /**
   * Will the student be at their keyboard when the account is created?
   *
   * A fact about the RUN, not about the portal, and the only thing separating
   * `student_chosen` from `generated_ephemeral` — both apply to a portal that
   * asks for a password, and the difference is entirely whether the student is
   * there to type it.
   *
   * No default. `false` is a real answer with a real consequence (we end up
   * holding a secret), and a default would make that consequence arrive
   * without anyone choosing it.
   */
  readonly studentPresentAtCreation: boolean;
}): AuthenticationChoice {
  const { observed } = input;
  // ── Can we give it back? Asked before anything else. ─────────────────────
  if (observed.credentialsCanBeHandedBack === false) {
    return {
      chosen: false,
      refusal: {
        kind: "handover_impossible",
        detail:
          `Discovery found that an account on ${observed.portalHost} cannot be handed back to ` +
          `the student cleanly. Creating one would make AskiMate the long-term holder of access ` +
          `to their university account, which is the single thing this design exists to prevent. ` +
          `The student creates their own account on this portal, or we do not use it. This is ` +
          `not a trade-off to weigh against convenience.`,
      },
    };
  }

  const unobserved = unobservedQuestions(observed);
  if (unobserved.length > 0) {
    return {
      chosen: false,
      refusal: {
        kind: "unobserved",
        questions: unobserved,
        detail:
          `The authentication approach for ${observed.portalHost} cannot be chosen: ` +
          `${String(unobserved.length)} question(s) about the portal are unobserved. An ` +
          `unobserved answer is not a "no" — treating it as one is how the password path wins ` +
          `by default. Run discovery against the portal and record what it does.`,
      },
    };
  }

  const supports: Readonly<Record<AuthenticationApproach, boolean>> = {
    passwordless: observed.passwordlessAvailable === true,
    // The portal asks for a password AND the student is there to type it. Then
    // the password is theirs and we never learn it.
    student_chosen: observed.applicantChoosesPassword === true && input.studentPresentAtCreation,
    portal_issued: observed.portalIssuesCredential === true,
    // We may generate one only where the portal actually makes us set a
    // password. "The portal accepts a password" is not the same as "the portal
    // requires one from us", and this is the distinction Vahid drew with
    // *"only if the portal technically requires it"*.
    generated_ephemeral:
      observed.applicantChoosesPassword === true && observed.passwordlessAvailable === false,
  };

  const rejected: { approach: AuthenticationApproach; because: string }[] = [];

  for (const approach of RANKED) {
    if (!supports[approach]) {
      rejected.push({
        approach,
        because: whyNot(approach, observed, input.studentPresentAtCreation),
      });
      continue;
    }

    return {
      chosen: true,
      plan: {
        portalHost: observed.portalHost,
        approach,
        description: APPROACH_DESCRIPTION[approach],
        rejected,
        studentMustBePresent: NEEDS_STUDENT_PRESENT[approach],
        askimateHoldsACredential: WE_HOLD_A_SECRET[approach],
        handoffs: handoffsFrom(observed),
        basedOn: observed,
      },
    };
  }

  return {
    chosen: false,
    refusal: {
      kind: "no_workable_approach",
      detail:
        `No authentication approach fits what was observed on ${observed.portalHost}: the portal ` +
        `offers no passwordless sign-in, the applicant does not choose a password, and the ` +
        `portal does not issue one either. That usually means accounts are created by the ` +
        `institution rather than by applicants. A specialist should look at the capture — it is ` +
        `a different flow, not a harder version of this one.`,
    },
  };
}

function unobservedQuestions(observed: ObservedPortalAuthentication): readonly string[] {
  return (Object.keys(QUESTIONS) as (keyof typeof QUESTIONS)[])
    .filter((key) => observed[key] === "unobserved")
    .map((key) => QUESTIONS[key]);
}

function whyNot(
  approach: AuthenticationApproach,
  observed: ObservedPortalAuthentication,
  studentPresentAtCreation: boolean,
): string {
  switch (approach) {
    case "passwordless":
      return "the portal offers no passwordless sign-in";
    case "student_chosen":
      return observed.applicantChoosesPassword === true && !studentPresentAtCreation
        ? "the portal does let the applicant choose their own password, but the student will not " +
            "be present at account creation to type it"
        : "the portal does not let the applicant choose a password at account creation";
    case "portal_issued":
      return "the portal does not issue a credential to the applicant";
    case "generated_ephemeral":
      return observed.passwordlessAvailable === true
        ? "passwordless sign-in is available, so generating a password would be holding a secret we do not need"
        : "the portal does not require a password to be set at account creation";
  }
}

function handoffsFrom(
  observed: ObservedPortalAuthentication,
): readonly ("email_verification" | "mfa_or_otp" | "captcha")[] {
  const handoffs: ("email_verification" | "mfa_or_otp" | "captcha")[] = [];
  if (observed.emailVerificationRequired === true) handoffs.push("email_verification");
  if (observed.mfaOrOtpRequired === true) handoffs.push("mfa_or_otp");
  if (observed.captchaPresent === true) handoffs.push("captcha");
  return handoffs;
}

// ───────────────────────────────────────────────────────────────────────────
// Minting, under the plan
// ───────────────────────────────────────────────────────────────────────────

export type CredentialRefusal = {
  readonly kind: "not_permitted_by_approach";
  readonly detail: string;
};

export type CredentialMint =
  | { readonly minted: true; readonly credential: EphemeralCredential }
  | { readonly minted: false; readonly refusal: CredentialRefusal };

/**
 * Mints a credential, if — and only if — the plan says we may hold one.
 *
 * The gate that makes the ranking mean something at runtime. Without it,
 * `chooseApproach` would be advice: a caller could pick `passwordless`, ignore
 * it, and generate a password anyway. With it, holding a secret requires a
 * plan that says the portal forced us to, and that plan requires observations.
 *
 * Deliberately takes the whole plan rather than a boolean. A boolean argument
 * is something a caller passes; a plan is something a caller has to have.
 */
export function mintCredentialUnder(
  plan: AuthenticationPlan,
  input: {
    readonly expiresAt: Date;
    readonly purpose: string;
    /** The portal's own rule, where one has been observed. */
    readonly policy?: PasswordPolicy;
  },
): CredentialMint {
  if (!plan.askimateHoldsACredential) {
    return {
      minted: false,
      refusal: {
        kind: "not_permitted_by_approach",
        detail:
          `The approach for ${plan.portalHost} is "${plan.approach}" — ` +
          `${APPROACH_DESCRIPTION[plan.approach]}. Generating a password under that approach ` +
          `would mean holding a secret the portal never asked us for. If the portal has since ` +
          `changed, re-run discovery and re-choose; do not mint against a stale plan.`,
      },
    };
  }

  return {
    minted: true,
    credential: EphemeralCredential.generate({
      expiresAt: input.expiresAt,
      purpose: input.purpose,
      ...(input.policy !== undefined ? { policy: input.policy } : {}),
    }),
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Saying it out loud
// ───────────────────────────────────────────────────────────────────────────

/**
 * The plan, in prose, for a specialist reviewing it and for the ADR.
 *
 * Leads with whether we hold a secret, because that is the question the whole
 * design is about and it should not be three lines down.
 */
export function describePlan(plan: AuthenticationPlan): string {
  const lines = [
    `${plan.portalHost}: ${plan.approach} — ${plan.description}.`,
    plan.askimateHoldsACredential
      ? `AskiMate HOLDS a generated credential for this account. It expires, it is never logged, ` +
        `and it is destroyed at handover.`
      : `AskiMate holds no credential for this account at any point.`,
    plan.studentMustBePresent
      ? `The student must be present — the run pauses and waits for them.`
      : `The run can proceed without the student present, up to any handoff below.`,
  ];

  if (plan.handoffs.length > 0) {
    lines.push(`Handoffs the portal forces: ${plan.handoffs.join(", ")}. None is bypassed.`);
  }

  for (const { approach, because } of plan.rejected) {
    lines.push(`Preferred but unavailable — ${approach}: ${because}.`);
  }

  lines.push(
    `Observed by discovery run ${plan.basedOn.discoveryRunId} on ` +
      `${plan.basedOn.observedAt.toISOString()}.`,
  );

  return lines.join("\n");
}

/** The eight questions, for the runbook and for `inspect-discovery`. */
export function authenticationQuestions(): readonly string[] {
  return Object.values(QUESTIONS);
}

// ───────────────────────────────────────────────────────────────────────────
// How the student's own password reaches the portal
// ───────────────────────────────────────────────────────────────────────────

/**
 * Under `student_chosen`, the route the password takes.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-26: *"Could AskiMate ask the student in the chat to
 * enter/generate a password, and then pass that password directly to the
 * browser automation layer as an opaque secret, without the AI model ever
 * being able to read, interpret, store, log, or retrieve the actual
 * password?"*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why this is a delivery mechanism and not a fifth approach ─────────────
 *
 * The obvious move was to add `student_chosen_via_secure_channel` to `RANKED`
 * between `portal_issued` and `generated_ephemeral`. It is wrong, and the
 * reason is worth writing down because it is not obvious until you try it.
 *
 * `RANKED` is walked in order and the first supported approach wins. But the
 * secure channel and bare `student_chosen` have the SAME precondition — the
 * student is present and the portal lets an applicant choose a password — so a
 * fifth rank below `student_chosen` could never be reached, and one above it
 * would silently replace the safer option everywhere. The two are not two
 * points on one scale. They are two answers to a different question: once we
 * know the student chooses their own password, **who types it into the
 * portal's form?**
 *
 *   `student_types_into_portal` — they do. They leave the conversation, open
 *       the portal themselves, and type it there. AskiMate never holds it at
 *       all, not for an instant. Strictly safer, and it costs a handoff:
 *       the student has to go and drive a university website.
 *
 *   `askimate_secure_channel` — they type it into AskiMate Chat's secure
 *       control; our automation types it into the portal once and destroys it.
 *       The model never sees it. AskiMate's browser process holds it for the
 *       duration of one `fill()`, which is more than never.
 *
 * ── The default, and why it is the cautious one ───────────────────────────
 *
 * `student_types_into_portal`. Where a student is willing to open the portal
 * and type a password into its own form, that is better than any mechanism we
 * could build, because the best mechanism still holds the secret for a moment
 * and this holds it for none. The secure channel exists for the case the
 * product is actually built around — the student stays in the conversation —
 * and choosing it is a decision someone makes, not a default they inherit.
 */
export type PasswordDelivery = "student_types_into_portal" | "askimate_secure_channel";

/**
 * Whether AskiMate's automation ever holds a secret, given both decisions.
 *
 * `WE_HOLD_A_SECRET` above answers this for the approach alone and is still
 * correct for the four ranks. This is the fuller answer, and the reason it is
 * a separate function is that `student_chosen` is the one approach where the
 * answer depends on something other than the approach.
 */
export function holdsASecret(
  approach: AuthenticationApproach,
  delivery: PasswordDelivery,
): boolean {
  if (approach === "student_chosen") return delivery === "askimate_secure_channel";
  return WE_HOLD_A_SECRET[approach];
}

/**
 * What the student is told when the secure channel will be used.
 *
 * Separate from `creationMiddle`'s `student_chosen` text, which promises *"You
 * type it, not me — I never see it"*. That promise is true when they type into
 * the portal and would be a lie here: our automation does type it. So this
 * says what actually happens, including the part a student would want to know
 * — that the password is theirs afterwards and we do not keep it.
 */
export function describeSecureChannel(portalHost: string): string {
  return (
    `This portal asks you to choose your own password. I will show you a password box in this ` +
    `chat — not an ordinary message, a proper password field — and what you type there goes ` +
    `straight to the part of me that fills in forms. It is used once, to set up your account on ` +
    `${portalHost}, and then it is gone: it is not saved, not written to any log, and the part ` +
    `of me you are talking to right now never gets to see it. The password stays yours, and you ` +
    `sign in with it afterwards.`
  );
}
