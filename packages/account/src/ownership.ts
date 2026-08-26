/**
 * Who owns the university account, and how it gets handed back.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE APPLICATION BELONGS TO THE STUDENT.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Vahid, 2026-08-26 — the whole principle, in his words:
 *
 *   *"The application belongs to the student. The student's own email remains
 *   the account owner/contact. We may assist with account creation and
 *   application completion where authorised, but control must ultimately be
 *   handed back to the student."*
 *
 * Everything in this file follows from that sentence. The interesting design
 * question is not how to create an account — it is how to make **not giving it
 * back** something the system cannot do quietly.
 *
 * ── The failure this prevents ─────────────────────────────────────────────
 *
 * A consultancy creates a portal account with an address it controls, keeps
 * the password, and thereafter the student cannot see their own application,
 * cannot respond to the university directly, and cannot leave. That is not a
 * hypothetical failure mode in this industry; it is a well-known one.
 *
 * Two properties make it structurally hard here:
 *
 *   1. **The account email must be the student's own confirmed email.** Not a
 *      value someone typed — the `ConfirmedValue` from their profile, which
 *      exists only because they confirmed it. There is no other constructor.
 *
 *   2. **A case cannot finish while an account is outstanding.** Handover is a
 *      checklist with no partial credit, and `checkHandoverComplete` is a gate
 *      the closing path has to pass.
 *
 * ── What we never do ──────────────────────────────────────────────────────
 *
 * Never intercept, suppress or bypass MFA, email verification, or password
 * recovery. Concretely, that means **this system has no capability to read the
 * student's mailbox** — not a disabled one, none. Every verification code and
 * every reset link goes to them and is theirs to act on. Where a code is
 * needed, the run pauses and asks; it does not go and look.
 */

import type { Brand, StudentId } from "@askimate/aas-domain";
import { unwrapConfirmed } from "@askimate/aas-domain";
import type { ConfirmedValue } from "@askimate/aas-domain";

import type { AuthenticationApproach, AuthenticationPlan } from "./authentication.js";
import type { EphemeralCredential } from "./credential.js";

/** Where an account stands. */
export type AccountStage =
  /** The portal needs no account, or the student already has one. */
  | "not_required"
  /** An account is needed and does not exist yet. */
  | "creation_required"
  /**
   * Created, and the portal has emailed the student to verify the address.
   *
   * The run waits. It does not read their email — see the file header.
   */
  | "awaiting_email_verification"
  /** Usable for the application. Still not the student's to control. */
  | "active"
  /** The application is done; control has not yet gone back. */
  | "handover_due"
  /** Verified handed back. The only state in which a case may finish. */
  | "handed_over";

/**
 * An account, and whose it is.
 *
 * `email` is a `ConfirmedValue`, which is the point: it can only have come
 * from the student confirming it (ADR-0004). There is no path that puts an
 * AskiMate address here, because there is no path that gets one confirmed as
 * the student's own email.
 */
export interface PortalAccount {
  readonly accountId: string;
  readonly caseId: string;
  readonly studentRef: StudentId;
  /** The portal this account is on. */
  readonly portalHost: string;
  /**
   * The account's email — the student's own, confirmed by them.
   *
   * Product rule 7: this is the official contact on the application, on every
   * route. Never an AskiMate address and never portal-only.
   */
  readonly email: ConfirmedValue<string>;
  readonly stage: AccountStage;
  /**
   * How we get in, and why that way.
   *
   * Required, and it carries the observations it was chosen from. An account
   * cannot exist here without a plan, and a plan cannot exist without
   * discovery having answered the eight questions — so "we used a password
   * because that is what the code did" is not a reachable state.
   */
  readonly authentication: AuthenticationPlan;
  /** Who created it — AskiMate on the student's behalf, or the student. */
  readonly createdBy: "askimate_on_behalf" | "student";
  readonly createdAt?: Date;
  /**
   * The temporary credential, while one exists.
   *
   * Absent once handover destroys it. Absent from the moment the student sets
   * their own password, which this system never learns.
   */
  readonly temporaryCredential?: EphemeralCredential;
  readonly handover?: HandoverRecord;
}

// ───────────────────────────────────────────────────────────────────────────
// Handover
// ───────────────────────────────────────────────────────────────────────────

/**
 * What must be true before AskiMate's involvement with an account ends.
 *
 * Vahid: *"We must make sure the student has clear access to the account and
 * recovery route before we consider our operational involvement finished."*
 *
 * Every item is a fact about the student's ability to get in without us — not
 * about what we did. "We sent them an email" is not on this list; "they can
 * reset their password" is.
 */
export interface HandoverChecklist {
  /**
   * The account's email is the student's own, and they can receive at it.
   *
   * Demonstrated by the portal's own verification having succeeded — which
   * they completed, because we cannot.
   */
  readonly emailVerifiedByPortal: boolean;
  /** The student has been told the account exists, where it is, and how to get in. */
  readonly studentInformed: boolean;
  /**
   * The student has used the portal's own password reset and set their own
   * password.
   *
   * The route back to control, and applicable only where we held a credential
   * — under `passwordless`, `student_chosen` and `portal_issued` there is no
   * password of ours to displace. Deliberately the portal's own mechanism
   * rather than anything of ours: it reaches their email, and we are not in it.
   */
  readonly passwordResetCompleted: boolean;
  /** Any temporary credential we held has been destroyed. */
  readonly temporaryCredentialDestroyed: boolean;
  /**
   * AskiMate retains no operational access — no live session, no stored token,
   * no second factor pointing at us, no agent relationship on the account.
   *
   * Vahid: *"After successful handover, AskiMate must not retain operational
   * access to the account."* Applies under every approach, including the ones
   * where we never held a password: a signed-in browser session is
   * operational access whether or not a credential was involved.
   */
  readonly askimateRetainsNoAccess: boolean;
  /**
   * The student confirmed they can sign in.
   *
   * The one item that cannot be inferred. Everything else can be observed from
   * the outside; this is the student saying "yes, I'm in".
   */
  readonly studentConfirmedAccess: boolean;
}

export interface HandoverRecord {
  readonly checklist: HandoverChecklist;
  /** The approach this handover was checked against, so the applicable set is auditable. */
  readonly approach: AuthenticationApproach;
  readonly completedAt: Date;
  /** What the student was told, verbatim. */
  readonly presentedText: string;
}

/**
 * A handover that actually happened.
 *
 * Branded, so "we handed it over" is a fact established by the checklist
 * rather than a flag someone set.
 */
export type CompletedHandover = Brand<HandoverRecord, "CompletedHandover">;

export type HandoverRefusal = {
  readonly kind: "incomplete";
  readonly outstanding: readonly string[];
  readonly detail: string;
};

export type HandoverCheck =
  | { readonly complete: true; readonly handover: CompletedHandover }
  | { readonly complete: false; readonly refusal: HandoverRefusal };

const CHECKLIST_LABELS: Readonly<Record<keyof HandoverChecklist, string>> = {
  emailVerifiedByPortal: "the portal has verified the student's own email address",
  studentInformed: "the student has been told the account exists and where it is",
  passwordResetCompleted: "the student has set their own password via the portal's reset flow",
  temporaryCredentialDestroyed: "any temporary credential we held has been destroyed",
  askimateRetainsNoAccess:
    "AskiMate retains no operational access — no live session, no stored token, no second factor",
  studentConfirmedAccess: "the student has confirmed they can sign in",
};

/**
 * Which items apply under which approach.
 *
 * ── Why this is not a weakening ───────────────────────────────────────────
 *
 * "Some items do not apply" is exactly the shape of a loophole, so the way it
 * is reached matters. An approach is not a string a caller picks: it comes
 * from `chooseApproach`, which refuses without observations. So dropping
 * `passwordResetCompleted` requires discovery to have *observed* a portal with
 * passwordless sign-in — you cannot claim the item is inapplicable, you have
 * to have found a portal where it is.
 *
 * Two items are on every list and cannot be dropped by any approach: the
 * student confirming they are in, and AskiMate retaining no access. Those are
 * the outcome; the rest are mechanism.
 */
function applicableItems(
  approach: AuthenticationApproach,
): readonly (keyof HandoverChecklist)[] {
  const always: (keyof HandoverChecklist)[] = [
    "emailVerifiedByPortal",
    "studentInformed",
    "askimateRetainsNoAccess",
    "studentConfirmedAccess",
  ];

  // Only the approach where we held a secret has a secret to displace and
  // destroy.
  return approach === "generated_ephemeral"
    ? [...always, "passwordResetCompleted", "temporaryCredentialDestroyed"]
    : always;
}

/**
 * The gate. No partial credit.
 *
 * Deliberately all-or-nothing. All but one is an account the student cannot
 * fully control, and calling that "handed over" would be the exact outcome
 * this design exists to prevent — recorded as a success.
 */
export function checkHandoverComplete(input: {
  readonly checklist: HandoverChecklist;
  /** From the account's `authentication.approach`, not chosen here. */
  readonly approach: AuthenticationApproach;
  readonly completedAt: Date;
  readonly presentedText: string;
}): HandoverCheck {
  const outstanding = applicableItems(input.approach)
    .filter((key) => !input.checklist[key])
    .map((key) => CHECKLIST_LABELS[key]);

  if (outstanding.length > 0) {
    return {
      complete: false,
      refusal: {
        kind: "incomplete",
        outstanding,
        detail:
          `The account has not been handed back. Outstanding: ${outstanding.join("; ")}. ` +
          `An account the student cannot fully control is not handed over, however much of the ` +
          `process is done.`,
      },
    };
  }

  return {
    complete: true,
    handover: {
      checklist: input.checklist,
      approach: input.approach,
      completedAt: input.completedAt,
      presentedText: input.presentedText,
    } as CompletedHandover,
  };
}

/**
 * What the student still has to do before we are finished with the account.
 *
 * Derived from `checkHandoverComplete` rather than reimplementing it, so the
 * list a student is shown and the gate that lets a case close cannot drift
 * apart — including when the approach changes which items apply.
 */
export function outstandingHandoverItems(account: PortalAccount): readonly string[] {
  const checklist = account.handover?.checklist;
  if (checklist === undefined) {
    return applicableItems(account.authentication.approach).map((key) => CHECKLIST_LABELS[key]);
  }

  const check = checkHandoverComplete({
    checklist,
    approach: account.authentication.approach,
    completedAt: account.handover?.completedAt ?? new Date(0),
    presentedText: account.handover?.presentedText ?? "",
  });

  return check.complete ? [] : check.refusal.outstanding;
}

/**
 * May this case finish?
 *
 * The rule that makes handover non-optional. A case with an outstanding
 * account is not finished, whatever the application's own state says.
 */
export function mayConcludeCase(accounts: readonly PortalAccount[]): {
  readonly may: boolean;
  readonly outstanding: readonly string[];
} {
  const outstanding = accounts
    .filter((account) => account.stage !== "handed_over" && account.stage !== "not_required")
    .map(
      (account) =>
        `${account.accountId} on ${account.portalHost} is "${account.stage}" and has not been ` +
        `handed back`,
    );

  return { may: outstanding.length === 0, outstanding };
}

// ───────────────────────────────────────────────────────────────────────────
// Creating an account on the student's behalf
// ───────────────────────────────────────────────────────────────────────────

export type AccountCreationRefusal =
  | { readonly kind: "email_not_students"; readonly detail: string }
  | { readonly kind: "not_authorised"; readonly detail: string };

/**
 * The student's specific authorisation to create an account for them.
 *
 * Separate from the disclosure authorisation and from the submission
 * authorisation, because it is a different thing to agree to: an account in
 * their name, at a university, that will exist after we are gone.
 */
export interface AccountCreationAuthorisation {
  readonly studentRef: StudentId;
  readonly presentedText: string;
  readonly authorisedAt: Date;
}

export type AccountCreationCheck =
  | { readonly permitted: true; readonly account: PortalAccount }
  | { readonly permitted: false; readonly refusal: AccountCreationRefusal };

/**
 * Prepares an account for creation.
 *
 * Two checks, and the first is the load-bearing one: the address must be the
 * student's own confirmed email. Anything else — an AskiMate alias, a
 * catch-all, a specialist's address — means the university writes to us
 * instead of to them, and the student is a passenger in their own application.
 */
export function prepareAccountCreation(input: {
  readonly accountId: string;
  readonly caseId: string;
  readonly studentRef: StudentId;
  readonly portalHost: string;
  /** From the profile. Confirmed by the student, or it does not exist. */
  readonly email: ConfirmedValue<string>;
  /**
   * How we will get in, chosen from what discovery observed.
   *
   * Required. An account cannot be prepared before the approach is settled,
   * which means it cannot be prepared before the portal has been observed.
   */
  readonly authentication: AuthenticationPlan;
  readonly authorisation?: AccountCreationAuthorisation;
  /** Domains that are ours. An account must never use one. */
  readonly ourDomains: readonly string[];
}): AccountCreationCheck {
  const address = unwrapConfirmed(input.email).toLowerCase();
  const ours = input.ourDomains.some((domain) => address.endsWith(`@${domain.toLowerCase()}`));

  if (ours) {
    return {
      permitted: false,
      refusal: {
        kind: "email_not_students",
        detail:
          `"${address}" is one of our own domains. The account's email must be the student's own, ` +
          `so the university writes to them rather than to us — product rule 7. This is not a ` +
          `configuration choice.`,
      },
    };
  }

  if (input.authorisation === undefined) {
    return {
      permitted: false,
      refusal: {
        kind: "not_authorised",
        detail:
          `Creating a university account in the student's name needs their specific ` +
          `authorisation, and none is recorded. An account outlives this application.`,
      },
    };
  }

  return {
    permitted: true,
    account: {
      accountId: input.accountId,
      caseId: input.caseId,
      studentRef: input.studentRef,
      portalHost: input.portalHost,
      email: input.email,
      stage: "creation_required",
      authentication: input.authentication,
      createdBy: "askimate_on_behalf",
    },
  };
}

/**
 * What the student is told before an account is created for them.
 *
 * Rendered deterministically, and it says the part that matters most — that
 * the account is theirs, and that they will take control of it. Written to be
 * true rather than reassuring, which is why the middle paragraph differs by
 * approach: telling a student we will set a temporary password when we will
 * not is a small lie that makes the handover text later make no sense.
 */
export function renderAccountCreationRequest(input: {
  readonly institutionName: string;
  readonly portalHost: string;
  readonly email: string;
  readonly approach: AuthenticationApproach;
}): string {
  return (
    `To apply to ${input.institutionName} you need an account on their application portal ` +
    `(${input.portalHost}).\n\n` +
    `I can create it for you using your own email address, ${input.email}, so the university ` +
    `writes to you directly about your application.\n\n` +
    `${creationMiddle(input)}\n\n` +
    `The account and the application are yours. Shall I create it?`
  );
}

function creationMiddle(input: {
  readonly approach: AuthenticationApproach;
  readonly email: string;
}): string {
  switch (input.approach) {
    case "passwordless":
      return (
        `This portal signs you in with a link it emails to you, so there is no password for me ` +
        `to set or to know. Each time I need to get in, I will ask you to open the email and ` +
        `tell me when you have.`
      );

    case "student_chosen":
      return (
        `This portal asks you to choose your own password when the account is created. You type ` +
        `it, not me — I never see it, and I do not want to. I will ask you to be at your ` +
        `keyboard for that step.`
      );

    case "portal_issued":
      return (
        `This portal sends its own first password to ${input.email} when the account is created. ` +
        `I cannot read your email, so you will need to open it and sign in yourself the first ` +
        `time.`
      );

    case "generated_ephemeral":
      return (
        `This portal requires a password to create the account, so I will generate a long random ` +
        `one. Nobody at AskiMate sees it, it is never written down anywhere, and it stops ` +
        `working shortly afterwards. When the application is finished I will ask you to set your ` +
        `own password using the portal's "Forgot password" link, which goes to your email — ` +
        `after that only you can get in.`
      );
  }
}

/**
 * What the student is told at handover.
 *
 * The last thing this system says about the account, so it says how to get in
 * without us and does not assume they will remember any of it.
 */
export function renderHandover(input: {
  readonly institutionName: string;
  readonly portalHost: string;
  readonly email: string;
  readonly approach: AuthenticationApproach;
}): string {
  return (
    `Your application to ${input.institutionName} is complete, and the account is yours.\n\n` +
    `Sign in at ${input.portalHost} with ${input.email}.\n\n` +
    `${handoverMiddle(input)}\n\n` +
    `Tell me when you are in, and I will close this off.`
  );
}

function handoverMiddle(input: {
  readonly approach: AuthenticationApproach;
  readonly email: string;
}): string {
  if (input.approach === "generated_ephemeral") {
    return (
      `Please set your own password now using the "Forgot password" link on that page. It sends ` +
      `a reset link to ${input.email}, which only you can read. Once you have done that, the ` +
      `temporary password I used is gone and only you can get into the account.`
    );
  }

  return (
    `I have never had a password for this account and I do not have one now — you sign in the ` +
    `same way you have been. I have closed the session I was using, so from here it is only ` +
    `you. If you ever lose access, use the "Forgot password" or sign-in link on that page; it ` +
    `goes to ${input.email}, which only you can read.`
  );
}
