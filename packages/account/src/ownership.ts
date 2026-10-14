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

import type { AuthenticationApproach, AuthenticationPlan, PasswordResetSends } from "./authentication.js";
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
  /**
   * Created by us with the student's own password, on a portal that never
   * verifies the address, and the student has not yet said whether the
   * portal's registration e-mail reached them (ADR-0159 O3, P306). Nothing is
   * filled until they answer.
   */
  | "awaiting_registration_email"
  /**
   * The student said the registration e-mail did NOT arrive. Vahid,
   * 2026-10-13: *"If not, stop for a person before any press."* A person
   * looks; the run fills nothing meanwhile.
   */
  | "registration_email_not_received"
  /** Usable for the application. Still not the student's to control. */
  | "active"
  /** The application is done; control has not yet gone back. */
  | "handover_due"
  /**
   * It exists, and nothing about it can be planned (P300, row 170): the
   * portal's authentication facts no longer settle how we get in — one reads
   * `"unobserved"`, say — so there is no plan to hand it back by. It is still
   * the student's, still owed, and a person looks at it. Never concludes.
   *
   * Vahid, 2026-10-12: *"A run that holds an account must never lose sight of
   * it because an auth fact reads "unobserved"."* Until P300 such an account
   * had no stage to be in, and vanished.
   */
  | "unplanned"
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
   * How we get in, and why that way, carrying the observations it was chosen
   * from. A plan cannot exist without discovery having answered the eight
   * questions — so "we used a password because that is what the code did" is
   * not a reachable state.
   *
   * `null` exactly when `stage` is `"unplanned"` (P300, row 170). Until P300
   * this said an account could not exist without a plan. It can: one created
   * under facts that were observed then, read under facts that are not now.
   * Making that unrepresentable made the account disappear, and a stop then
   * closed the case as owing nothing.
   */
  readonly authentication: AuthenticationPlan | null;
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
   * The student SAID the portal's registration e-mail reached them (ADR-0159
   * O3, P306).
   *
   * The proof of receipt for an account we made with the student's own
   * password on a portal that never verifies the address. Vahid, 2026-10-13:
   * *"No password reset before submission"*, and O3: *"The student confirms in
   * chat that Sheffield's registration e-mail arrived. If not, stop for a
   * person before any press."* A statement, not an observation, and weaker
   * than the reset it replaces there; the ADR says so.
   */
  readonly studentConfirmedRegistrationEmail: boolean;
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
  studentConfirmedRegistrationEmail: "the student has said the portal's registration e-mail reached them",
  passwordResetCompleted: "the student has set their own password via the portal's reset flow",
  temporaryCredentialDestroyed: "any temporary credential we held has been destroyed",
  askimateRetainsNoAccess:
    "AskiMate retains no operational access — no live session, no stored token, no second factor",
  studentConfirmedAccess: "the student has confirmed they can sign in",
};

/**
 * Which items apply, given the approach and what the portal actually does.
 *
 * ── Why this is not a weakening ───────────────────────────────────────────
 *
 * "Some items do not apply" is exactly the shape of a loophole, so the way it
 * is reached matters. Neither input here is a string a caller picks: the
 * approach comes from `chooseApproach`, and `portalVerifiesEmail` is one of
 * the eight discovery questions, every one of which must be observed before an
 * account may be created at all. So dropping an item requires discovery to
 * have *found* a portal where it does not apply — you cannot claim
 * inapplicability, you have to have observed it.
 *
 * Two items are on every list and no input can drop them: the student
 * confirming they are in, and AskiMate retaining no access. Those are the
 * outcome; the rest is mechanism.
 *
 * ── The one PROPERTY behind two mechanisms ────────────────────────────────
 *
 * `emailVerifiedByPortal` is not really about verification. It is the only
 * external proof that **the student can receive mail at the account's
 * address** — the recovery route, without which "the account is theirs" is a
 * claim rather than a fact.
 *
 * On a portal that does not verify email addresses there is no such
 * verification to have, and the item could never become true: under the first
 * version of this function, no account on such a portal could EVER be handed
 * over, and no case involving one could ever conclude. That is a deadlock, not
 * a safety property.
 *
 * Where it bites is narrower than it looks, and worth tracing, because three
 * of the four approaches already prove receipt by other means:
 *
 *   `passwordless`         they sign in with an emailed link or code
 *   `portal_issued`        the portal emails them the credential
 *   `generated_ephemeral`  `passwordResetCompleted` is already required
 *   `student_chosen`       nothing in the flow is CHECKED to reach them  ← the gap
 *
 * (Written first as "nothing in the flow ever emails them". Sheffield's
 * registration sends an e-mail (its AUTH 4); what was missing was a check that
 * it arrived, not the e-mail.)
 *
 * So on a non-verifying portal this substitutes the portal's own password
 * reset for the portal's own verification. Vahid decided that, 2026-09-01, over
 * the alternatives of dropping the item outright (which removes the check while
 * leaving the risk) and leaving the deadlock in place. See ADR-0050.
 *
 * For `student_chosen` his decision of 2026-10-13 (ADR-0159, decision 1, O3)
 * replaces the reset with the student's word that the registration e-mail
 * arrived: *"No password reset before submission."* On Sheffield a reset
 * replaces the password the student chose (his AUTH 7), so the reset could no
 * longer be the proof for the password he decided the student keeps. The
 * count of proofs stays at one; it is now a statement, not the portal's own
 * e-mail observed doing its work. `generated_ephemeral` keeps its reset (O11):
 * there is still a password of ours to displace. `passwordless` and
 * `portal_issued` are unchanged (outside O11, and unreachable on the one entry
 * there is).
 */
function applicableItems(input: {
  readonly approach: AuthenticationApproach;
  /**
   * ADR-0110 — Vahid, 2026-09-14: *"waive it for an account the student
   * created themselves. Asking someone to reset their own password to prove
   * they can receive mail at an address they chose and already signed in
   * with is a check that proves nothing and costs them a real password. Keep
   * it for an account we created on their behalf, where the address was never
   * tested."* Read as covering both address proofs — the reset, and the
   * portal's own verification — because both establish what the student's
   * signing in with that address already establishes.
   */
  readonly createdBy?: PortalAccount["createdBy"];
  /**
   * Did discovery observe that this portal verifies the email address?
   *
   * From `ObservedPortalAuthentication.emailVerificationRequired`, which cannot
   * be `"unobserved"` in an account's PLAN — `chooseApproach` refuses on any
   * unobserved question, so no plan is made from one. An account can still
   * exist when a fact reads `"unobserved"` (P300, row 170): it is `"unplanned"`,
   * has no plan, and never reaches here — `outstandingKeys` holds every item
   * against it instead. Until P300 this said "by the time an account exists",
   * the latent constraint row 170 made reachable.
   */
  readonly portalVerifiesEmail: boolean;
}): readonly (keyof HandoverChecklist)[] {
  const always: (keyof HandoverChecklist)[] = [
    "studentInformed",
    "askimateRetainsNoAccess",
    "studentConfirmedAccess",
  ];

  if (input.createdBy === "student" && input.approach !== "generated_ephemeral") return always;

  const items: (keyof HandoverChecklist)[] = input.portalVerifiesEmail
    ? ["emailVerifiedByPortal", ...always]
    : // The substitution. Not an exemption: an item is REPLACED, not removed.
      input.approach === "student_chosen"
      ? ["studentConfirmedRegistrationEmail", ...always]
      : ["passwordResetCompleted", ...always];

  // Only the approach where we held a secret has a secret to displace and
  // destroy. `passwordResetCompleted` may already be present by substitution,
  // in which case requiring it twice is requiring it once.
  if (input.approach !== "generated_ephemeral") return items;
  return [
    ...new Set<keyof HandoverChecklist>([
      ...items,
      "passwordResetCompleted",
      "temporaryCredentialDestroyed",
    ]),
  ];
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
  /**
   * The account's whole plan, not its approach.
   *
   * Same reason `mintCredentialUnder` takes one (ADR-0020 §2): a boolean — or
   * an approach — is something a caller passes, and a plan is something a
   * caller has to have. It also carries `basedOn`, so which items apply is
   * decided from the discovery observations themselves rather than from two
   * arguments a caller could pass inconsistently.
   */
  readonly plan: AuthenticationPlan;
  readonly completedAt: Date;
  readonly presentedText: string;
  /** Who made the account; absent means us (ADR-0110). */
  readonly createdBy?: PortalAccount["createdBy"];
}): HandoverCheck {
  const outstanding = applicableItems({
    approach: input.plan.approach,
    portalVerifiesEmail: input.plan.basedOn.emailVerificationRequired === true,
    ...(input.createdBy === undefined ? {} : { createdBy: input.createdBy }),
  })
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
      approach: input.plan.approach,
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
  return outstandingKeys(account).map((key) => CHECKLIST_LABELS[key]);
}

/** The applicable items this account has not satisfied, as keys. */
function outstandingKeys(account: PortalAccount): readonly (keyof HandoverChecklist)[] {
  // An account with no plan (P300) cannot say which items apply, so every
  // item does: the strictest reading, never the most convenient one.
  const applicable =
    account.authentication === null
      ? (Object.keys(CHECKLIST_LABELS) as (keyof HandoverChecklist)[])
      : applicableItems({
          approach: account.authentication.approach,
          portalVerifiesEmail: account.authentication.basedOn.emailVerificationRequired === true,
          createdBy: account.createdBy,
        });
  const checklist = account.handover?.checklist;
  if (checklist === undefined) return applicable;
  return applicable.filter((key) => !checklist[key]);
}

/**
 * The items on that list that the STUDENT can do something about.
 *
 * ── Why this is a separate list rather than the same one ──────────────────
 *
 * The full list is the gate: it includes our items — that we have told them,
 * that we retain no access, that anything we held is destroyed — and a case
 * cannot finish while any of them is outstanding.
 *
 * Showing them that list would be showing somebody a to-do list containing
 * "the student has been told the account exists", which is nonsense at best.
 * It is also unstable in a way that matters: telling them is what makes
 * `studentInformed` true, so the message would change the moment it was sent,
 * and a confirmation is bound by a hash of exactly what they were shown
 * (ADR-0050). The message a student confirms has to be the message they read.
 */
export function studentHandoverItems(account: PortalAccount): readonly string[] {
  const theirs: readonly (keyof HandoverChecklist)[] = [
    "emailVerifiedByPortal",
    "studentConfirmedRegistrationEmail",
    "passwordResetCompleted",
    "studentConfirmedAccess",
  ];
  return outstandingKeys(account)
    .filter((key) => theirs.includes(key))
    .map((key) => CHECKLIST_LABELS[key]);
}

/**
 * The applicable items this account has not satisfied, as keys (P306).
 *
 * For a reader that must choose by item rather than by label: matching a
 * label's words is how "reset flow" came to decide which handoff was next.
 */
export function outstandingHandoverKeys(account: PortalAccount): readonly (keyof HandoverChecklist)[] {
  return outstandingKeys(account);
}

/**
 * Does an account made under this plan owe the student's word that the
 * registration e-mail arrived (ADR-0159 O3)?
 *
 * Read from `applicableItems`, so the rule stays in one place (ADR-0041).
 */
export function owesRegistrationEmail(
  plan: AuthenticationPlan,
  createdBy: PortalAccount["createdBy"],
): boolean {
  return applicableItems({
    approach: plan.approach,
    createdBy,
    portalVerifiesEmail: plan.basedOn.emailVerificationRequired === true,
  }).includes("studentConfirmedRegistrationEmail");
}

/**
 * The question asked right after we create an account with the student's own
 * password on a portal that never verifies the address (ADR-0159 O1, O3; P306).
 *
 * His words are the instruction and the advice (O1: *"Tell the student not to
 * change the password as soon as the account exists"*; decision 1: *"advises
 * them to change it after"*) and the question (O3). The sentences are mine.
 * "I will not fill in anything until you answer" is a promise, and a test
 * holds it: the run hands out no page while this is asked.
 */
export function renderRegistrationEmailQuestion(input: {
  readonly institutionName: string;
  readonly portalHost: string;
  readonly email: string;
}): string {
  return (
    `I have created your account on ${input.institutionName}'s application portal ` +
    `(${input.portalHost}), registered to your e-mail address, ${input.email}. The account is yours.\n\n` +
    `Please do not change its password until you have submitted your application. After that, we ` +
    `advise you to change it, because the password passed through our system on its way to the portal.\n\n` +
    `One question before I fill in anything: has an e-mail from ${input.institutionName}'s ` +
    `application portal reached ${input.email} since I created the account? If you cannot see it, ` +
    `please look in your spam or junk folder too. I will not fill in anything until you answer.`
  );
}

/**
 * What the student hears after answering that the registration e-mail did not
 * arrive (ADR-0159 O3, P306). Said with the stop for a person, once.
 *
 * Promises nothing of a person beyond what is done when it is said: the stop
 * raises the intervention before this is appended.
 */
export function renderRegistrationEmailNotReceived(input: {
  readonly institutionName: string;
  readonly email: string;
}): string {
  return (
    `Thank you for telling me. Without that e-mail I cannot be sure that what ${input.institutionName} ` +
    `sends to ${input.email} reaches you, and that address is your way back into the account if you ` +
    `ever lose its password. So I have stopped here, and a member of the team has been asked to look ` +
    `at it. The account stays yours; please do not change its password in the meantime. Nothing has ` +
    `been submitted.`
  );
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
    .map((account) =>
      // An account with no plan (P300) is owed, but "has not been handed back"
      // would say more than is known: there is nothing to check a handover
      // against, and the case log may say the student already holds it (the
      // P300 review). What is known is that it cannot be shown.
      account.stage === "unplanned"
        ? `${account.accountId} on ${account.portalHost} is "unplanned": there is no plan to check ` +
          `its handover against, so it cannot be shown to have been handed back`
        : `${account.accountId} on ${account.portalHost} is "${account.stage}" and has not been ` +
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
  /** What this portal's reset was seen to send (P301's review); absent, nothing is said of it. */
  readonly passwordResetSends?: PasswordResetSends;
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
  readonly passwordResetSends?: PasswordResetSends;
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
        `own password using the portal's "Forgot password"${resetBeforeCreation(input.passwordResetSends)} — ` +
        `after that only you can get in.`
      );
  }
}

/**
 * What the creation request says a reset does, as it was seen and no more
 * (P301's review: it called every portal's reset "a link").
 */
function resetBeforeCreation(sends: PasswordResetSends | undefined): string {
  if (sends === "new_password_in_plain_text") {
    return `, which on this portal replaces the password at once and e-mails you a new one, in plain text, to change straight away`;
  }
  if (sends === "reset_link") return `, which on this portal e-mails you a link`;
  return "";
}

/**
 * What the handover says about a reset, read off the plan the account was
 * made under and who made it (P301 and its review), so every place that
 * renders the handover says the same.
 *
 * `resetStillToDo` is ADR-0050's substitution: an account we made, on a portal
 * that never e-mailed the student, is not handed back until the portal's reset
 * has shown its e-mail reaches them. Said as owed now, because the list sent
 * with the text asks for it now — not as something for a lost password.
 * Whether that requirement should stand on a portal whose reset replaces the
 * password is Vahid's (state-of-the-system row 177); this only makes the text
 * agree with the list.
 */
export function resetWordsFor(
  plan: AuthenticationPlan,
  createdBy: PortalAccount["createdBy"],
  /**
   * The checklist as it stands, where there is one (P306): the words read
   * what is still owed, not only what the plan says applies, so an answered
   * question is not asked again in the text.
   */
  checklist?: HandoverChecklist,
): {
  readonly passwordResetSends?: PasswordResetSends;
  readonly passwordResetSeenNotToWork?: true;
  readonly resetStillToDo?: true;
  readonly madeWithYourPassword?: true;
  readonly registrationEmailStillToDo?: true;
} {
  const owed =
    plan.approach !== "generated_ephemeral" &&
    applicableItems({
      approach: plan.approach,
      createdBy,
      portalVerifiesEmail: plan.basedOn.emailVerificationRequired === true,
    }).includes("passwordResetCompleted");
  return {
    ...(plan.basedOn.passwordResetSends === undefined ? {} : { passwordResetSends: plan.basedOn.passwordResetSends }),
    ...(plan.basedOn.passwordResetAvailable === false ? { passwordResetSeenNotToWork: true as const } : {}),
    ...(owed ? { resetStillToDo: true as const } : {}),
    // ADR-0159 (P306): an account we made with the password the student chose.
    ...(plan.approach === "student_chosen" && createdBy !== "student" ? { madeWithYourPassword: true as const } : {}),
    ...(owesRegistrationEmail(plan, createdBy) && checklist?.studentConfirmedRegistrationEmail !== true
      ? { registrationEmailStillToDo: true as const }
      : {}),
  };
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
  /**
   * What the student attaches themselves before submitting (ADR-0104): the
   * document slots of a repeating page, each named with its entry. Said here
   * as well as in the preview, because this is the message they act on.
   */
  readonly leftToStudent?: readonly { readonly text: string; readonly toldLater: boolean }[];
  /**
   * What this portal's "Forgot password" sends, where someone has tried it
   * (P301; `ObservedPortalAuthentication.passwordResetSends`). Absent, the
   * text says nothing of what a reset does.
   */
  readonly passwordResetSends?: PasswordResetSends;
  /** The portal's reset was tried and did not work (`passwordResetAvailable: false`). */
  readonly passwordResetSeenNotToWork?: true;
  /** The reset is still owed before the handover is complete (`resetWordsFor`). */
  readonly resetStillToDo?: true;
  /** We made the account with the password the student chose (`resetWordsFor`, P306). */
  readonly madeWithYourPassword?: true;
  /** The student has not yet said the registration e-mail arrived (`resetWordsFor`, P306). */
  readonly registrationEmailStillToDo?: true;
  /**
   * A person recorded that the application was submitted by hand (ADR-0159
   * O10, P307): the date it was submitted on, `YYYY-MM-DD`, as stated (P308).
   * The words are then for an application already submitted, and say that the
   * student submitted it, on that date. Nothing is said to be done "before
   * you submit".
   */
  readonly applicationSubmittedOn?: string;
}): string {
  const left = input.leftToStudent ?? [];
  // ADR-0108, in Vahid's words: *"the student must be able to tell that we
  // are not watching this and nobody will remind them. If the honest version
  // of that sentence makes the product look worse, that is the product, not
  // the sentence."* And an application with something owed is not complete.
  const ownActs =
    left.length === 0
      ? ""
      : input.applicationSubmittedOn !== undefined
        ? // P307: too late to say "before you submit", and nothing here knows
          // whether they were attached before it was. Said as what is known.
          `I did not attach these, and I cannot tell whether they were attached before you ` +
          `submitted it:\n${left.map((act) => `  - ${act.text}`).join("\n")}\n\n` +
          `If they were not, ${input.institutionName}'s admissions office can tell you how to send them.\n\n`
      : `Before you submit, attach these yourself on the portal — I did not attach them:\n` +
        `${left.map((act) => `  - ${act.text}`).join("\n")}\n\n` +
        `${left.some((act) => act.toldLater) ? `${input.institutionName} has been told these are coming later. ` : ""}` +
        `Nobody is watching this, and nobody will remind you. If you do not attach them, ` +
        `${input.institutionName} will treat the application as incomplete, and I will not know. ` +
        `When you have attached one, tell me here and I will record it.\n\n`;
  const state =
    input.applicationSubmittedOn !== undefined
      ? // P308, his D7 addition: submitted, by the student, on that date.
        `You submitted your application to ${input.institutionName} on the university's website on ` +
        `${dayInWords(input.applicationSubmittedOn)}, and the account is yours.`
      : left.length === 0
      ? `Your application to ${input.institutionName} is complete, and the account is yours.`
      : `Your application to ${input.institutionName} is filled as far as I can take it, and the account is yours.`;
  return (
    `${state}\n\n` +
    `Sign in at ${input.portalHost} with ${input.email}.\n\n` +
    `${ownActs}` +
    `${handoverMiddle(input)}\n\n` +
    (input.registrationEmailStillToDo === true && input.madeWithYourPassword === true
      ? `Tell me with the buttons below whether it has arrived.`
      : input.resetStillToDo === true && input.approach !== "generated_ephemeral"
        ? `Tell me when you have done that and you are in, and I will close this off.`
        : `Tell me when you are in, and I will close this off.`)
  );
}

/** `YYYY-MM-DD` in words, "14 October 2026": the date as stated, never moved by a zone (P308). */
function dayInWords(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * What a reset does, said as it was observed on this portal and no more (P301).
 *
 * Vahid, 2026-10-12 (docs/run-a/p301-his-auth7-as-sent.txt): *"If a student
 * loses their password, the handover message must tell them that resetting
 * replaces their password at once and the new one arrives by e-mail."* Said
 * where it was observed — Sheffield's reset sends no link — and only there:
 * a portal whose reset sends a link is told that, and one nobody has tried is
 * told nothing about what a reset does.
 *
 * Two things it never says, though it said both until P301:
 *   - "which only you can read". Nothing here can know who reads an inbox;
 *   - the profile's address as where the mail goes. The mail goes to the
 *     address the ACCOUNT is registered with, and that is not always the
 *     profile's: his own reads' account signs in with an address that is not
 *     his profile's (docs/run-a/p301-his-account-as-sent.txt).
 */
function whatAResetDoes(sends: PasswordResetSends | undefined): string {
  if (sends === "new_password_in_plain_text") {
    return (
      `resetting it with "Forgot password" on that page replaces your password at once, and the ` +
      `new one arrives by e-mail, in plain text, at the address the account is registered with. ` +
      `Sign in with it and change it straight away, as that e-mail asks you to.`
    );
  }
  if (sends === "reset_link") {
    return (
      `"Forgot password" on that page sends a link to the address the account is registered with, ` +
      `and your password stays as it is until you use the link.`
    );
  }
  return `use "Forgot password" on that page.`;
}

/** What a reset owed now does on this portal, as it was seen; nothing where nobody has tried it. */
function whatTheOwedResetDoes(sends: PasswordResetSends | undefined): string {
  if (sends === "new_password_in_plain_text") {
    return (
      ` On this portal it replaces your password at once, and the new one arrives by e-mail, in ` +
      `plain text, at the address the account is registered with: sign in with it and change it ` +
      `straight away, as that e-mail asks you to.`
    );
  }
  if (sends === "reset_link") {
    return (
      ` On this portal it sends a link to the address the account is registered with, and your ` +
      `password stays as it is until you use the link.`
    );
  }
  return "";
}

function handoverMiddle(input: {
  readonly institutionName: string;
  readonly approach: AuthenticationApproach;
  readonly email: string;
  readonly passwordResetSends?: PasswordResetSends;
  readonly passwordResetSeenNotToWork?: true;
  readonly resetStillToDo?: true;
  readonly madeWithYourPassword?: true;
  readonly registrationEmailStillToDo?: true;
  readonly applicationSubmittedOn?: string;
}): string {
  if (input.approach === "generated_ephemeral") {
    return (
      `Please set your own password now: ${whatAResetDoes(input.passwordResetSends)} Once you ` +
      `have done that, the temporary password I used is gone and only you can get into the account.`
    );
  }

  // ── An account we made with the password the student chose (ADR-0159, P306) ──
  //
  // "I have never had a password … you sign in the same way you have been" is
  // untrue of it: the student has never signed in, and the password passed
  // through us to make the account. Vahid, 2026-10-13: *"The handover tells
  // the student not to change their password until every submission is done,
  // and advises them to change it after."* The words are mine.
  if (input.madeWithYourPassword === true) {
    const lost =
      input.passwordResetSeenNotToWork === true
        ? `If you ever lose your password, this portal's "Forgot password" was not seen to work, so ` +
          `${input.institutionName}'s admissions office is the way back in.`
        : `If you ever lose your password, ${whatAResetDoes(input.passwordResetSends)}`;
    // P307: his rule applied to a submission already recorded. "Until every
    // submission is done" is over, so the advice is "after": now.
    const when =
      input.applicationSubmittedOn !== undefined
        ? `You have submitted your application, so we advise you to change the password now, ` +
          `because it passed through our system on its way to the portal.`
        : `Please do not change the password until you have submitted your application. After ` +
          `that, we advise you to change it, because it passed through our system on its way to the ` +
          `portal.`;
    const kept =
      `I do not keep your password, and I have closed the session I was using, so from here it is ` +
      `only you. ${when} ${lost}`;
    return input.registrationEmailStillToDo === true
      ? `${kept}\n\nOne thing is left before I can close this off: has an e-mail from ` +
          `${input.institutionName}'s application portal reached ${input.email} since I created the ` +
          `account? If you cannot see it, please look in your spam or junk folder too.`
      : kept;
  }

  const neverHeld =
    `I have never had a password for this account and I do not have one now — you sign in the ` +
    `same way you have been. I have closed the session I was using, so from here it is only you.`;
  // P301's review: the list sent with this text asks for the reset now, so the
  // text says it is owed now, not that it is for a lost password.
  if (input.resetStillToDo === true) {
    return (
      `${neverHeld}\n\nOne thing is left before I can close this off. ${input.institutionName}'s ` +
      `portal has not yet shown that its e-mail reaches you, and the way it shows it is its ` +
      `"Forgot password": please use it once on that page.${whatTheOwedResetDoes(input.passwordResetSends)}`
    );
  }
  // A passwordless student has no password to lose: the way back is the link.
  if (input.approach === "passwordless") {
    return `${neverHeld} If you ever lose access, ask that page for a new sign-in link; it goes to the address the account is registered with.`;
  }
  // A reset tried and seen not to work is not offered as the way back.
  if (input.passwordResetSeenNotToWork === true) {
    return (
      `${neverHeld} If you ever lose your password, this portal's "Forgot password" was not seen ` +
      `to work, so ${input.institutionName}'s admissions office is the way back in.`
    );
  }
  return `${neverHeld} If you ever lose your password, ${whatAResetDoes(input.passwordResetSends)}`;
}
