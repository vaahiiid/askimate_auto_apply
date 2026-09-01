/**
 * The orchestrator.
 *
 * Composes everything that has been built into one workflow, and — like the
 * interview capability it drives — **renders nothing and decides nothing on the
 * student's behalf**. It answers one question:
 *
 *     given where this case is, what happens next?
 *
 * AskiMate Chat calls it, presents whatever it says in the conversation the
 * student is already having, and calls it again.
 *
 * ── The order, and why it is this order ───────────────────────────────────
 *
 *   1. Is the blueprint executable?        reviewed, and actually observed
 *   2. Is the mapping set usable?          reviewed, pinned to that blueprint
 *   3. Plan the fill                       every blocker known before a browser
 *   4. Missing values?          → INTERVIEW ask the student, one thing at a time
 *   5. Mapping gaps?            → BLOCKED   a specialist, never the student
 *   6. Validation failures?     → FIX       usually back to the student
 *   7. Preview + authorisation  → AUTHORISE the exact content, hashed
 *   8. Execute the fill                     against the portal
 *   9. STOP                                 submission is a separate, authorised
 *                                           step and it is not this one
 *
 * Steps 1 and 2 come first because they are cheap and they invalidate
 * everything after them. There is no point asking a student for their date of
 * birth against a blueprint nobody reviewed.
 *
 * ── Who is asked for what ─────────────────────────────────────────────────
 *
 * A missing VALUE goes to the student, conversationally. A missing MAPPING goes
 * to a specialist. Confusing the two is how a student ends up being asked to
 * work out where something belongs on a form — which is the thing this system
 * exists not to do (ADR-0007).
 */

import type {
  AuthenticationApproach,
  AuthenticationPlan,
  HandoverChecklist,
  ObservedPortalAuthentication,
  PasswordDelivery,
  PortalAccount,
} from "@askimate/aas-account";
import {
  checkHandoverComplete,
  chooseApproach,
  describeSecureChannel,
  outstandingHandoverItems,
  renderAccountCreationRequest,
  renderHandover,
  studentHandoverItems,
} from "@askimate/aas-account";
import type { ApplicationBlueprint } from "@askimate/aas-blueprint";
import { allFields, checkExecutable } from "@askimate/aas-blueprint";
import type { HandoffKind, RunId, StudentId, WorkflowCheckpoint } from "@askimate/aas-domain";
import { isFieldUnavailable, unwrapConfirmed } from "@askimate/aas-domain";
import type { InterviewAction, InterviewState } from "@askimate/aas-interview";
import type {
  SecretHandle,
  SecretLifecycle,
  SecretRequest,
  SecretRequestId,
} from "@askimate/aas-secrets";
import {
  canTransition,
  isSecretHandle,
  isSecretRequestId,
  isTerminalLifecycle,
} from "@askimate/aas-secrets";
import { nextAction } from "@askimate/aas-interview";
import type { ModelClient } from "@askimate/aas-llm";
import type { FillPlan, MappingSet, UsableMappingSet } from "@askimate/aas-mapping";
import { checkUsable, planFill } from "@askimate/aas-mapping";
import type {
  AuthorisablePreview,
  AuthorisationRecord,
  PreviewDocument,
  SubmissionPreview,
  ValidationResult,
  Violation,
} from "@askimate/aas-preparation";
import { buildPreview, checkAuthorisable, renderPreview, stillCovers, validatePlan } from "@askimate/aas-preparation";
import type { ConfirmedProfile, ProfileFieldKey } from "@askimate/aas-profile";
import { resolveField } from "@askimate/aas-profile";

/** Everything a run needs. */
export interface RunInputs {
  readonly caseId: string;
  readonly studentRef: StudentId;
  readonly blueprint: ApplicationBlueprint;
  readonly mappingSet: MappingSet;
  readonly documents: ReadonlyMap<string, PreviewDocument>;
  /**
   * What discovery observed about the portal's authentication.
   *
   * Optional here and required in practice: a portal whose blueprint says
   * authentication is required cannot get past `accountStepFor` without it.
   * Optional rather than required because most of a run — the interview, the
   * mapping, the validation — has nothing to do with signing in, and a run
   * against a portal that needs no account needs none of this.
   */
  readonly portalAuthentication?: ObservedPortalAuthentication;
  /**
   * Will the student be at their keyboard when the account is created?
   *
   * The only thing separating "the student types their own password" from "we
   * generate one and hold it for a few minutes". No default — see
   * `chooseApproach`.
   */
  readonly studentPresentAtCreation?: boolean;
  /**
   * Under `student_chosen`, how the password gets from the student to the
   * portal.
   *
   * Absent means `student_types_into_portal` — the student opens the portal
   * and types it there, and AskiMate never holds it at all. The secure channel
   * is chosen deliberately or not at all: it is the option where our
   * automation holds the secret for the length of one keystroke, and a default
   * would be that happening because nobody set a field.
   */
  readonly passwordDelivery?: PasswordDelivery;
}

/** Where a run has got to. Immutable; each step returns a new one. */
export interface RunState {
  readonly inputs: RunInputs;
  readonly profile: ConfirmedProfile;
  readonly interview: InterviewState;
  /** Set once the student has authorised specific content. */
  readonly authorisation?: AuthorisationRecord;
  /** Set once the portal has actually been filled. */
  readonly filled?: boolean;
  /**
   * The portal account, where the portal needs one.
   *
   * Absent means no account has been prepared yet — which, on a portal whose
   * blueprint says authentication is required, is itself a step.
   */
  readonly account?: PortalAccount;
  /**
   * Where the student's password has got to, when the secure channel is in
   * use.
   *
   * Four words and a handle, and nothing else. Vahid: *"Orchestration state
   * may contain secret_requested / secret_received / secret_consumed /
   * secret_expired — but NEVER the password itself."* `RunState` is passed
   * around, logged in tests, and would be the obvious place to serialise a
   * case — so the type here is what stops a password ever being in one.
   */
  readonly secret?: {
    readonly requestId: SecretRequestId;
    readonly lifecycle: SecretLifecycle;
    /** Opaque. Resolves to nothing outside the secret store. */
    readonly handle?: SecretHandle;
  };
  /**
   * Where this run got to, when it is a durable one.
   *
   * OPTIONAL, deliberately. A run that does not need to survive a restart — a
   * replay against a captured portal, a test — passes no store and carries no
   * position, and every existing caller still compiles. Making it required
   * would have been a MAJOR change for no gain.
   *
   * Position only: a runId, the optimistic-concurrency revision, and a
   * checkpoint whose values are primitives by construction. No business fact
   * can be in here — see `CheckpointValue`.
   */
  readonly run?: {
    readonly runId: RunId;
    readonly revision: number;
    readonly checkpoint: WorkflowCheckpoint;
  };
}

/** What happens next. */
export type RunStep =
  /** Say this to the student, in AskiMate Chat. */
  | { readonly kind: "interview"; readonly action: InterviewAction }
  /**
   * A specialist must act. NEVER shown to the student as a question.
   *
   * An unreviewed blueprint, a mapping gap, a dropdown whose options have
   * changed — none of these is something the applicant can answer, and asking
   * them would be handing over the system's own problem.
   */
  | { readonly kind: "specialist"; readonly reason: string; readonly detail: string }
  /**
   * The content would be rejected by the portal.
   *
   * Usually back to the student — a personal statement over the limit is theirs
   * to shorten, and it must never be truncated for them.
   */
  | { readonly kind: "fix_content"; readonly violations: readonly Violation[] }
  /** Show the student exactly what will be submitted, and ask them to approve it. */
  | {
      readonly kind: "authorise";
      readonly preview: AuthorisablePreview;
      readonly presentedText: string;
    }
  /** Everything is approved. Fill the portal. */
  | { readonly kind: "execute"; readonly plan: FillPlan }
  /**
   * The portal needs an account, and the student must authorise creating one.
   *
   * An account outlives this application, so it gets its own authorisation
   * rather than riding along on any other (ADR-0020).
   */
  | {
      readonly kind: "create_account";
      readonly say: string;
      readonly portalHost: string;
      readonly email: string;
      /**
       * How we will get in, chosen from what discovery observed.
       *
       * On the step rather than only on the account, because it changes what
       * the student is told and whether they need to be present — both of
       * which the caller acts on before an account exists.
       */
      readonly approach: AuthenticationApproach;
    }
  /**
   * The student must type a password into AskiMate Chat's SECURE CONTROL.
   *
   * Not an interview question, and deliberately a different `RunStep` kind
   * from `interview`. A chat that treated this as a message to print would
   * show a heading with no input under it — visibly broken rather than
   * silently collecting a password into the transcript.
   *
   * The `request` carries metadata only: purpose, target, the explanation
   * shown to the student, single-use, expiry. There is no field on it that
   * could hold a password, in either direction.
   */
  | {
      readonly kind: "request_secret";
      readonly say: string;
      readonly request: SecretRequest;
    }
  /**
   * Only the student can do this: an emailed verification link, an MFA code,
   * a CAPTCHA.
   *
   * The run PAUSES. It does not go and look — this system has no capability to
   * read a mailbox, by design and by dependency-boundary rule.
   */
  | {
      readonly kind: "student_handoff";
      readonly reason: "email_verification" | "mfa" | "otp" | "captcha" | "payment";
      readonly say: string;
    }
  /**
   * The application is prepared, filled and authorised.
   *
   * **This is where the system stops.** Submission is Phase 6 and requires its
   * own explicit approval — from Vahid for the first real one, and from the
   * student for every one after that.
   */
  | { readonly kind: "ready_to_submit"; readonly contentHash: string }
  /**
   * The application is done and the account is still ours to give back.
   *
   * `outstanding` is what the student still has to do before we are finished
   * with it — and there is no partial credit (ADR-0020).
   */
  | {
      readonly kind: "hand_over_account";
      readonly say: string;
      readonly outstanding: readonly string[];
      /**
       * The ONE thing the student is being asked for now.
       *
       * `outstanding` is the whole list, for them to read; this is what the
       * next confirmation will be about. They are separate because the
       * checklist is all-or-nothing over INDEPENDENT facts (ADR-0020 §3), and
       * one confirmation covering two of them would record a student who
       * pressed "yes, I'm in" as having also completed a password reset they
       * never did.
       */
      readonly awaiting: HandoffKind;
    };

/** What a run looks like when nothing has happened yet. */
export function beginRun(input: {
  readonly inputs: RunInputs;
  readonly profile: ConfirmedProfile;
  readonly interview: InterviewState;
}): RunState {
  return { inputs: input.inputs, profile: input.profile, interview: input.interview };
}

/** The plan, the validation and the preview, all at once. Pure. */
export interface RunAssessment {
  readonly usable: UsableMappingSet | null;
  readonly plan: FillPlan | null;
  readonly validation: ValidationResult | null;
  readonly preview: SubmissionPreview | null;
  /** Why the assessment could not get further. */
  readonly refusal?: { readonly reason: string; readonly detail: string };
}

/**
 * Works out where the case stands, without asking anything or doing anything.
 *
 * Separate from `nextStep` so a specialist console, a status endpoint or a test
 * can inspect a case without side effects and without a model client.
 */
export function assess(state: RunState): RunAssessment {
  const empty = { usable: null, plan: null, validation: null, preview: null } as const;

  const executable = checkExecutable(state.inputs.blueprint);
  if (!executable.executable) {
    return {
      ...empty,
      refusal: { reason: "blueprint_not_executable", detail: executable.refusal.detail },
    };
  }

  const usableCheck = checkUsable(state.inputs.mappingSet, state.inputs.blueprint);
  if (!usableCheck.usable) {
    return {
      ...empty,
      refusal: { reason: "mapping_not_usable", detail: usableCheck.refusal.detail },
    };
  }

  const usable = usableCheck.mappingSet;
  const plan = planFill(state.inputs.blueprint, usable, state.profile);

  if (plan.blockers.length > 0) {
    return { ...empty, usable, plan };
  }

  const validation = validatePlan(state.inputs.blueprint, plan);
  const previewResult = buildPreview(state.inputs.blueprint, plan, state.inputs.documents);

  return {
    usable,
    plan,
    validation,
    preview: previewResult.built ? previewResult.preview : null,
    ...(previewResult.built
      ? {}
      : { refusal: { reason: "preview_refused", detail: previewResult.refusal.detail } }),
  };
}

/**
 * Decides what happens next.
 *
 * Takes a model client only because the interview needs one to compose a
 * question. Nothing else in this function consults a model, and nothing a model
 * says can change which branch is taken.
 */
export async function nextStep(state: RunState, model: ModelClient): Promise<RunStep> {
  const assessment = assess(state);

  if (assessment.refusal !== undefined && assessment.plan === null) {
    return {
      kind: "specialist",
      reason: assessment.refusal.reason,
      detail: assessment.refusal.detail,
    };
  }

  const plan = assessment.plan;
  /* c8 ignore next 3 -- unreachable: a null plan always carries a refusal */
  if (plan === null) {
    return { kind: "specialist", reason: "no_plan", detail: "The run produced no fill plan." };
  }

  // ── Blockers: who is asked depends on what kind ─────────────────────────
  const structural = plan.blockers.filter((blocker) => blocker.kind !== "value_unavailable");
  if (structural.length > 0) {
    return {
      kind: "specialist",
      reason: structural[0]?.kind ?? "mapping_gap",
      detail: structural
        .map((blocker) =>
          blocker.kind === "no_mapping"
            ? blocker.detail
            : `"${blocker.label}" could not be written: ${blocker.refusal.detail}`,
        )
        .join(" "),
    };
  }

  if (plan.blockers.length > 0) {
    // Missing values. The interview asks, one thing at a time.
    return { kind: "interview", action: await nextAction(state.interview, model) };
  }

  // ── The portal needs an account before anything can be typed into it ────
  //
  // Placed here, after the interview has the student's confirmed email and
  // before anything is filled: an account cannot be created without their
  // email, and a form cannot be filled without an account.
  const accountStep = accountStepFor(state);
  if (accountStep !== null) return accountStep;

  // ── The content is complete. Would the portal take it? ──────────────────
  const validation = assessment.validation;
  /* c8 ignore next 3 -- unreachable: a complete plan is always validated */
  if (validation === null) {
    return { kind: "specialist", reason: "not_validated", detail: "Validation did not run." };
  }
  if (validation.violations.length > 0 || validation.unknownFields.length > 0) {
    return { kind: "fix_content", violations: validation.violations };
  }

  const preview = assessment.preview;
  if (preview === null) {
    return {
      kind: "specialist",
      reason: assessment.refusal?.reason ?? "preview_refused",
      detail: assessment.refusal?.detail ?? "The preview could not be built.",
    };
  }

  // ── Authorisation ───────────────────────────────────────────────────────
  //
  // An authorisation covers a hash. If anything has changed since — a
  // correction, a replaced document — it no longer covers this content and the
  // student is asked again. That is the whole point of the hash, and the answer
  // is never to submit under the old one.
  const authorisation = state.authorisation;
  if (authorisation === undefined || !stillCovers(authorisation, preview)) {
    const check = checkAuthorisable(preview, validation);
    /* c8 ignore next 7 -- unreachable: validation is already clean here */
    if (!check.authorisable) {
      return {
        kind: "specialist",
        reason: check.refusal.kind,
        detail: check.refusal.detail,
      };
    }
    return {
      kind: "authorise",
      preview: check.preview,
      presentedText: renderPreview(check.preview),
    };
  }

  // ── Authorised. Fill it. ────────────────────────────────────────────────
  if (state.filled !== true) {
    return { kind: "execute", plan };
  }

  return { kind: "ready_to_submit", contentHash: preview.contentHash };
}

/**
 * What the account needs next, or `null` when it needs nothing.
 *
 * Ordering is not arbitrary. Email verification comes before filling because
 * many portals will not show the form until the address is verified — and
 * because a run that fills a form it then cannot save has wasted the
 * student's answers.
 */
function accountStepFor(state: RunState): RunStep | null {
  if (!state.inputs.blueprint.authentication.required) return null;

  const account = state.account;
  const portalHost =
    account?.portalHost ?? hostOf(state.inputs.blueprint.authentication.loginUrl);

  if (account === undefined || account.stage === "creation_required") {
    // Before anything else: how do we get in, and did anyone find out?
    //
    // This runs ahead of the email check because an unobserved portal is a
    // deeper problem than a missing profile field, and because the refusal
    // names work that has to happen anyway.
    const authentication = account?.authentication ?? planFor(state);
    if (!("approach" in authentication)) {
      return authentication;
    }

    const email = resolveField(state.profile, "contact.email");
    if (isFieldUnavailable(email)) {
      // Cannot create an account without the address it belongs to. The
      // interview will have asked; if it has not, the mapping does not
      // require an email and a specialist should look at that.
      return {
        kind: "specialist",
        reason: "no_confirmed_email",
        detail:
          `This portal requires an account, and the student's email is not confirmed ` +
          `(${email.reason}). The account's address must be their own confirmed email — ` +
          `product rule 7 — so there is nothing to create an account with.`,
      };
    }

    const address = unwrapConfirmed(email);

    // ── The password, where the student is providing one through us ───────
    //
    // Only under `student_chosen` with the secure channel selected. Under
    // every other approach there is no password for us to ask for: passwordless
    // has none, `portal_issued` sends one to the student's own inbox, and
    // `generated_ephemeral` generates its own and must never ask a student for
    // theirs.
    //
    // This comes BEFORE `create_account` because the automation cannot fill
    // the registration form without it, and asking afterwards would mean a
    // half-created account waiting on a password box.
    const secretStep = secretStepFor(state, authentication.approach, portalHost);
    if (secretStep !== null) return secretStep;

    return {
      kind: "create_account",
      portalHost,
      email: address,
      approach: authentication.approach,
      say: renderAccountCreationRequest({
        institutionName: state.inputs.blueprint.institutionName,
        portalHost,
        email: address,
        approach: authentication.approach,
      }),
    };
  }

  if (account.stage === "awaiting_email_verification") {
    return {
      kind: "student_handoff",
      reason: "email_verification",
      say:
        `${state.inputs.blueprint.institutionName} has emailed ` +
        `${unwrapConfirmed(account.email)} to confirm the address. Could you open it and follow ` +
        `the link? I cannot read your email, so I will wait until you tell me it is done.`,
    };
  }

  if (account.stage === "handover_due") {
    return {
      kind: "hand_over_account",
      // The STUDENT's outstanding items, not the whole gate. See
      // `studentHandoverItems` for why the two lists differ, and why the
      // difference is load-bearing rather than cosmetic.
      outstanding: studentHandoverItems(account),
      awaiting: awaitingHandoverStep(account),
      say: renderHandover({
        institutionName: state.inputs.blueprint.institutionName,
        portalHost: account.portalHost,
        email: unwrapConfirmed(account.email),
        approach: account.authentication.approach,
      }),
    };
  }

  return null;
}

/**
 * Which of the student's handover steps is being asked for now.
 *
 * The reset first where it is outstanding, then the confirmation — in that
 * order because the confirmation is about the account AFTER the reset. Asked
 * the other way round, a student would confirm they can sign in with a
 * password we chose, and then change it, and the confirmation would be about
 * a state of the account that no longer exists.
 *
 * `account_handover` is the fallback rather than a fifth branch: it is on every
 * checklist and no approach or observation drops it (ADR-0020 §3), so there is
 * always something to ask for while the account is outstanding.
 */
function awaitingHandoverStep(account: PortalAccount): HandoffKind {
  const checklist = account.handover?.checklist;
  const outstanding = outstandingHandoverItems(account);
  const resetOutstanding =
    checklist?.passwordResetCompleted !== true &&
    outstanding.some((item) => item.includes("reset flow"));
  return resetOutstanding ? "password_reset" : "account_handover";
}

/**
 * The password step, or `null` when there is no password for us to ask for.
 *
 * ── Every condition here is a refusal to ask ──────────────────────────────
 *
 * A student being shown a password box is a moment of trust, and the realistic
 * damage is not a leak — it is asking for one when we did not need it. Someone
 * who is asked for a university password by a chatbot that did not have to ask
 * has learned that being asked is normal, which is precisely the lesson a
 * phishing attempt relies on.
 *
 * So: not unless the approach is `student_chosen`, not unless the secure
 * channel was deliberately selected, and not again once one has been asked
 * for.
 */
function secretStepFor(
  state: RunState,
  approach: AuthenticationApproach,
  portalHost: string,
): RunStep | null {
  if (approach !== "student_chosen") return null;
  if (state.inputs.passwordDelivery !== "askimate_secure_channel") return null;

  const secret = state.secret;
  if (secret !== undefined && secret.lifecycle !== "secret_expired") {
    // Asked already. `secret_received` means the automation has what it needs
    // and the run should carry on to create the account; `secret_requested`
    // means we are waiting on the student and asking twice would replace a box
    // they may be typing into. Only an expiry re-opens it.
    return secret.lifecycle === "secret_requested"
      ? {
          kind: "request_secret",
          say: describeSecureChannel(portalHost),
          request: secretRequestFor(state, portalHost),
        }
      : null;
  }

  return {
    kind: "request_secret",
    say: describeSecureChannel(portalHost),
    request: secretRequestFor(state, portalHost),
  };
}

function secretRequestFor(state: RunState, portalHost: string): SecretRequest {
  return {
    studentRef: state.inputs.studentRef,
    purpose: "portal_account_creation",
    target: { host: portalHost, caseRef: state.inputs.caseId },
    explanation: describeSecureChannel(portalHost),
    singleUse: true,
    // Five minutes. Long enough to think of a password and type it twice,
    // short enough that a student who walks away does not leave one live.
    ttlSeconds: 5 * 60,
  };
}

/**
 * Turns the observations into a plan, or into a specialist step saying what is
 * missing.
 *
 * The refusals are the interesting part. A portal nobody has observed, or one
 * that cannot give an account back, is not something to work around — and
 * neither is something the student can answer, so both go to a specialist.
 */
function planFor(state: RunState): AuthenticationPlan | RunStep {
  const observed: ObservedPortalAuthentication | undefined = state.inputs.portalAuthentication;
  const host = hostOf(state.inputs.blueprint.authentication.loginUrl);

  if (observed === undefined) {
    return {
      kind: "specialist",
      reason: "portal_authentication_unobserved",
      detail:
        `This portal requires an account and nothing has been observed about how it ` +
        `authenticates (${host}). We do not guess at that: the choice between passwordless ` +
        `sign-in, the student typing their own password, and us generating one decides whether ` +
        `AskiMate ever holds a credential to this student's university account. Run discovery ` +
        `against the portal and record what it does.`,
    };
  }

  if (state.inputs.studentPresentAtCreation === undefined) {
    return {
      kind: "specialist",
      reason: "student_availability_unknown",
      detail:
        `Whether the student will be at their keyboard when the account is created has not been ` +
        `stated, and it is the only thing separating "the student types their own password" from ` +
        `"we generate one and hold it". Defaulting it would mean holding a credential because ` +
        `nobody answered, rather than because the portal required it.`,
    };
  }

  const choice = chooseApproach({
    observed,
    studentPresentAtCreation: state.inputs.studentPresentAtCreation,
  });

  if (choice.chosen) return choice.plan;

  return {
    kind: "specialist",
    reason: `authentication_${choice.refusal.kind}`,
    detail: choice.refusal.detail,
  };
}

function hostOf(url: string | undefined): string {
  if (url === undefined) return "the application portal";
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/** Records the account on the run. */
export function withAccount(state: RunState, account: PortalAccount): RunState {
  return { ...state, account };
}

/**
 * The account a successful creation produced, reconstructed from durable
 * evidence rather than carried in memory.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Without this a run loops. `accountStepFor` answers `create_account` whenever
 * `state.account` is absent, and `state.account` is absent on every request
 * because nothing rebuilds it — so a run whose account was created a second ago
 * would be told to create it again, on a real university portal, for a student
 * who already has one. That is the exact failure `workflow_action_intents` was
 * built to prevent, and this is what reads it.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Everything here is DERIVED, and that is the point ─────────────────────
 *
 * The email comes from the confirmed profile — the same `resolveField` call
 * `accountStepFor` makes, so the address on the account is the address the run
 * was told to create it with, by construction rather than by agreement. The
 * plan comes from `planFor`, the same function that chose the approach in the
 * first place. Nothing is stored and re-read, so nothing can be stored wrongly.
 *
 * ── Which stage, and why it is not "active" unconditionally ───────────────
 *
 * A portal that verifies email addresses has emailed the student, and the run
 * must wait for them — it cannot read their inbox and will never be able to.
 * So the stage after creation is `awaiting_email_verification` where discovery
 * observed that requirement and `active` where it did not. That observation is
 * a reviewed per-portal fact, not a guess.
 *
 * Returns `null` when the state cannot support an account — no plan, or no
 * confirmed email. Both are states `accountStepFor` refuses to `specialist`
 * from, and answering `null` here keeps that refusal the one that happens.
 */
/**
 * What the case log and the run's own records say about handing the account
 * back (ADR-0050).
 *
 * Every field is a FACT somebody established, never a flag a caller sets to
 * make a stage move. The handoff lists come from `fold`; the last one comes
 * from the coordinator, which is the only thing that can see whether anything
 * of ours can still reach the portal.
 */
export interface HandoverEvidence {
  /** Handoff kinds that have been put in front of the student. */
  readonly raised: readonly HandoffKind[];
  /** Handoff kinds the student has completed. */
  readonly completed: readonly HandoffKind[];
  /**
   * Nothing of ours can still reach the account: no open work lease, no live
   * secure handle, no session held anywhere.
   *
   * Established by the caller because nothing in this pure function can see a
   * lease. It is on every checklist and no approach drops it (ADR-0020 §3),
   * so a caller that cannot establish it answers `false` and the account
   * stays outstanding — which is the safe direction.
   */
  readonly askimateRetainsNoAccess: boolean;
  /**
   * The application is done — every mapped page saved.
   *
   * Passed rather than read off `state.filled`, because `withAuthorisation`
   * clears that flag and the coordinator applies the authorisation AFTER the
   * account. Reading the stale value here would leave an account `active`
   * forever on a run that had finished filling.
   */
  readonly applicationFilled: boolean;
}

/** No evidence at all — the state of a run before anything has been handed back. */
const NO_HANDOVER_EVIDENCE: HandoverEvidence = {
  raised: [],
  completed: [],
  askimateRetainsNoAccess: false,
  applicationFilled: false,
};

/**
 * The handover checklist, derived from evidence rather than assembled by a
 * caller.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Every student-side item is a COMPLETED HANDOFF — a durable case event, with
 * the text the student was shown bound to it by hash. Not a boolean somebody
 * set, which is what "we handed it over" would otherwise be.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `studentInformed` comes from the RAISE rather than a completion: raising the
 * handover handoff is what puts the account, its portal and how to get in front
 * of the student. Telling them is the act; their reply is a different item.
 */
export function handoverChecklistFrom(
  evidence: HandoverEvidence,
  plan: AuthenticationPlan,
): HandoverChecklist {
  return {
    emailVerifiedByPortal: evidence.completed.includes("email_verification"),
    studentInformed: evidence.raised.includes("account_handover"),
    passwordResetCompleted: evidence.completed.includes("password_reset"),
    // True where there was never a credential to destroy — which is three of
    // the four approaches. Read from the PLAN rather than asserted by a
    // caller: `askimateHoldsACredential` is what `chooseApproach` decided, and
    // it is the same field `mintCredentialUnder` gates on.
    //
    // Under `generated_ephemeral` this is `false` and stays `false`: nothing in
    // this service ever holds that credential — the runner mints it, uses it
    // through `useTo` and lets it expire — so nothing here can truthfully say
    // it is gone. The account stays outstanding, which is the safe direction
    // and an honest one. Closing it needs the runner to report the
    // destruction, and that is not this phase.
    temporaryCredentialDestroyed: !plan.askimateHoldsACredential,
    askimateRetainsNoAccess: evidence.askimateRetainsNoAccess,
    studentConfirmedAccess: evidence.completed.includes("account_handover"),
  };
}

/**
 * A stable handoff token for a case and a kind.
 *
 * Derived, not minted, for the reason `idempotencyKeyFor` is: the run raises a
 * handoff every time it decides, and a fresh token per decision would open a
 * second handoff on every poll. Two raises of the same thing are one handoff.
 */
export function handoffTokenFor(input: { readonly caseId: string; readonly kind: HandoffKind }): string {
  return `ho_${input.caseId}_${input.kind}`;
}

export function accountCreated(
  state: RunState,
  input: {
    readonly accountId: string;
    readonly now: Date;
    /** What has actually happened about handing it back. */
    readonly handover?: HandoverEvidence;
  },
): RunState | null {
  const plan = planFor(state);
  // Narrowed on `rejected`, not on `approach`. `planFor` answers a plan or a
  // `specialist` step, and the step union ALSO has an `approach` — so the
  // obvious discriminator lets a `create_account` step through where a plan is
  // wanted. `rejected` — the approaches this one was chosen over — belongs to
  // the plan alone.
  if (!("rejected" in plan)) return null;

  const email = resolveField(state.profile, "contact.email");
  if (isFieldUnavailable(email)) return null;

  const portalHost =
    state.account?.portalHost ?? hostOf(state.inputs.blueprint.authentication.loginUrl);
  const evidence = input.handover ?? NO_HANDOVER_EVIDENCE;
  const checklist = handoverChecklistFrom(evidence, plan);
  // The text the student is shown when the account is handed back. The same
  // string whether or not the checklist has passed: it is what they were told,
  // and an incomplete handover records what they were told just as a complete
  // one does.
  const presentedText = renderHandover({
    institutionName: state.inputs.blueprint.institutionName,
    portalHost,
    email: unwrapConfirmed(email),
    approach: plan.approach,
  });
  const handover = checkHandoverComplete({
    checklist,
    plan,
    completedAt: input.now,
    presentedText,
  });

  return withAccount(state, {
    accountId: input.accountId,
    caseId: state.inputs.caseId,
    studentRef: state.inputs.studentRef,
    portalHost,
    email,
    stage: stageFrom(plan, evidence, handover.complete),
    // Attached either way, so `outstandingHandoverItems` reports what is
    // ACTUALLY left rather than the whole list. Only the branded
    // `CompletedHandover` means it is done, and only `checkHandoverComplete`
    // can produce one.
    handover: handover.complete
      ? handover.handover
      : { checklist, approach: plan.approach, completedAt: input.now, presentedText },
    authentication: plan,
    // ADR-0020. AskiMate created it, and it is the student's — which is why
    // `handover_due` exists and why a case cannot finish before `handed_over`.
    createdBy: "askimate_on_behalf",
    createdAt: input.now,
  });
}

/**
 * Where the account stands, derived from what has happened to it (ADR-0050).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A DERIVATION, not a stored column. `AccountStage` has never been persisted
 * anywhere and must not start being: a stored stage is a second answer to
 * "where is this account", and this repository has already had two models of
 * one thing come apart (ADR-0041). Everything here comes from the confirmed
 * profile, the reviewed portal observations, the intent ledger and the case
 * log — the four things that were already authoritative.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The order of the branches is the lifecycle, and each one is a refusal to
 * move on:
 *
 *   handed_over                 the checklist passed. The only stage in which
 *                               a case may finish (ADR-0020 §4).
 *   awaiting_email_verification the portal emailed them and they have not said
 *                               they followed it. We cannot read their inbox
 *                               and never will, so this is a wait, not a poll.
 *   handover_due                the application is done and the account is
 *                               still ours to give back. `mayConcludeCase`
 *                               refuses this stage BY NAME, because "we meant
 *                               to" is exactly what it exists to catch.
 *   active                      usable for the application, and not yet theirs.
 */
function stageFrom(
  plan: AuthenticationPlan,
  evidence: HandoverEvidence,
  handoverComplete: boolean,
): PortalAccount["stage"] {
  if (handoverComplete) return "handed_over";

  // `basedOn`, not the run's own copy of the observations: the plan carries
  // the observations it was chosen from, and reading the requirement from
  // anywhere else would let the two disagree.
  const verificationRequired = plan.basedOn.emailVerificationRequired === true;
  if (verificationRequired && !evidence.completed.includes("email_verification")) {
    return "awaiting_email_verification";
  }

  // "The application is done" is the run having filled the portal. Not
  // "authorised" — an authorised run has typed nothing yet, and handing the
  // account back before the form is filled would mean asking the student to
  // change the password we are about to sign in with.
  return evidence.applicationFilled ? "handover_due" : "active";
}

/** Records the student's authorisation on the run. */
export function withAuthorisation(state: RunState, record: AuthorisationRecord): RunState {
  return { ...state, authorisation: record, filled: false };
}

/** Records that the portal has been filled. */
export function markFilled(state: RunState): RunState {
  return { ...state, filled: true };
}

/**
 * Raised when a caller tries to move a run's secret lifecycle somewhere it
 * cannot go.
 *
 * A thrown error rather than a returned refusal, because every case it catches
 * is a programming mistake rather than an outcome the product has to render:
 * the lifecycle is decided by the Secure Interaction Service, and a driver that
 * tries to walk it backwards has misread an event, not encountered a student
 * doing something unusual.
 */
export class IllegalSecretTransitionError extends Error {
  public override readonly name = "IllegalSecretTransitionError";
  public constructor(
    public readonly from: SecretLifecycle | "none",
    public readonly to: SecretLifecycle,
    detail: string,
  ) {
    super(`A run's secret cannot move from ${from} to ${to}. ${detail}`);
  }
}

/**
 * The kind of browser work this step needs done, or `null` if it needs none.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A NARROWING, like `requiresSecureRequest` below it, and here for the same
 * reason: *which steps need a browser* is a property of the step vocabulary,
 * and the step vocabulary is this package's. A list of step kinds kept in the
 * Run Driver or in an HTTP route would be a second list of the same fact, and it
 * would go silently out of date — by omission — the first time another step
 * needed one.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Two steps qualify. `execute` was absent for a phase, because a fill plan
 * could not be handed to the runner without minting `ConfirmedValue`s outside
 * the one package allowed to mint them; ADR-0046 decided how — the plan crosses
 * as text plus the provenance that confirmed it, and is reassembled through the
 * mint. Whether a PARTICULAR plan can be transported is a separate question
 * with its own refusals (`toStoredPlan`); this one is about the step vocabulary.
 */
export function browserWorkFor(step: RunStep): "create_account" | "execute" | null {
  if (step.kind === "create_account") return "create_account";
  return step.kind === "execute" ? "execute" : null;
}

/**
 * The account facts a `create_account` step carries, or `null`.
 *
 * Here rather than in the caller for the same reason `browserWorkFor` is: the
 * step vocabulary is this package's, and a coordinator that narrowed a step
 * itself would be keeping its own copy of what each kind holds — wrong the
 * first time a kind gains a field, silently, by omission. `check-boundaries`
 * bans `step.kind` in the Run Driver to keep that true.
 */
export function accountWorkOf(step: RunStep): {
  readonly portalHost: string;
  readonly email: string;
  readonly approach: AuthenticationApproach;
} | null {
  if (step.kind !== "create_account") return null;
  return { portalHost: step.portalHost, email: step.email, approach: step.approach };
}

/** The plan an `execute` step carries, or `null`. */
export function executePlanOf(step: RunStep): FillPlan | null {
  return step.kind === "execute" ? step.plan : null;
}

/**
 * Whether this step requires the Secure Interaction Service to be asked to open
 * a request before the caller may report it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A NARROWING, not a decision. `nextStep` already decided what happens next;
 * this answers the separate question a coordinator has to ask about that
 * decision — *does carrying it out require something outside this process?*
 *
 * It lives here rather than in the Conversation Service because the answer is
 * a property of the step vocabulary, and the step vocabulary is this package's.
 * A driver that wrote `step.kind === "request_secret"` itself would be keeping
 * its own list of which steps have external effects, and that list would be
 * wrong the first time a new step got one — silently, by omission, which is the
 * failure mode `scripts/check-boundaries.ts` bans `step.kind ===` in a driver
 * to prevent.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Exactly one step qualifies today. That it is one and not zero is the whole
 * reason the predicate exists; that it is one and not several is a fact about
 * this moment, not a simplification.
 */
export function requiresSecureRequest(
  step: RunStep,
): step is Extract<RunStep, { kind: "request_secret" }> {
  return step.kind === "request_secret";
}

/**
 * Whether the run is standing in front of the student with a preview, waiting
 * for the one decision only they can make (ADR-0049 §5).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A NARROWING, for the same reason as `requiresSecureRequest` above it, and
 * with the same consequence if it were written in the caller instead: the Run
 * Driver would hold its own list of which steps mean "asking", and a step added
 * later that also asks would be missed silently, by omission.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The narrowing carries the preview out with it, which is the point. A
 * coordinator that only learned *yes, it is asking* would then have to reach
 * back into the step for the hash it must compare — and reaching into a step is
 * the thing `accountWorkOf` and `executePlanOf` exist to stop.
 */
/**
 * The handoff this step is waiting on, or `null` when it is waiting on nothing
 * only the student can do.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A NARROWING, like `requiresSecureRequest` and `awaitsStudentAuthorisation`
 * beside it, and here for the sharpest version of the same reason: TWO step
 * kinds are handoffs, they carry the kind in different shapes, and a
 * coordinator matching on either would be keeping its own copy of a mapping
 * that has already gone wrong once — `student_handoff.reason` and the case
 * event's `handoffKind` were separate vocabularies until ADR-0050 joined them.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `student_handoff` names what the portal is demanding; `hand_over_account`
 * names the one thing the student is being asked for now, which walks the
 * handover checklist rather than being fixed.
 */
export function handoffFor(step: RunStep): HandoffKind | null {
  if (step.kind === "student_handoff") return step.reason;
  return step.kind === "hand_over_account" ? step.awaiting : null;
}

/** What the student is told for a handoff step. The text a hash is taken over. */
export function handoffMessageOf(step: RunStep): string | null {
  if (step.kind === "student_handoff") return step.say;
  if (step.kind !== "hand_over_account") return null;
  // The list is part of what they were shown, not decoration: the hash binds
  // the whole message, and "here is your account" without "and here is what is
  // still outstanding" is a different thing to have agreed to.
  return step.outstanding.length === 0
    ? step.say
    : `${step.say}\n\nStill to do:\n${step.outstanding.map((item) => `  \u2022 ${item}`).join("\n")}`;
}

export function awaitsStudentAuthorisation(
  step: RunStep,
): step is Extract<RunStep, { kind: "authorise" }> {
  return step.kind === "authorise";
}

/**
 * Records where the student's password has got to. The only sanctioned writer
 * of `RunState.secret`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * `RunState.secret` has existed since the secret channel was designed, and
 * until now nothing could write it: `withAccount`, `withAuthorisation`,
 * `withProfile` and `markFilled` had no counterpart, so the only way to move a
 * run past `request_secret` was to build a new `RunState` by hand. This closes
 * that, and closes it as a machine rather than an assignment.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Four words and a handle. Never a password ─────────────────────────────
 *
 * Vahid: *"Orchestration state may contain secret_requested / secret_received /
 * secret_consumed / secret_expired — but NEVER the password itself."* The
 * parameter type is what enforces that: there is no field here that could hold
 * a value, and `SecretHandle` is `sh_` plus 32 random hex digits, derived from
 * nothing.
 *
 * ── Why it refuses rather than accepts ────────────────────────────────────
 *
 * Three rules, each mirroring something the system already enforces elsewhere:
 *
 *  1. **The lifecycle moves only where `canTransition` allows.** Nothing leads
 *     out of `secret_consumed`, `secret_expired` or `secret_cancelled`, so a
 *     driver that re-read a stale event cannot resurrect a spent handle in run
 *     state and hand it to an automation that would then try to spend it again.
 *
 *  2. **A different request may only replace a settled one.** A run has one
 *     open secure step at a time; replacing a live `secret_requested` with a
 *     second request id would abandon a box the student may be typing into,
 *     which is the failure `secretStepFor` above is careful to avoid.
 *
 *  3. **A handle may only accompany a lifecycle that can have one.** The same
 *     rule the secure plane's own schema states as
 *     `a_handle_means_it_was_answered` — a handle before the student answered
 *     describes something that has not happened.
 *
 * This does NOT talk to the Secure Interaction Service, mint a request, or
 * decide when to ask. It records what the secure plane has already reported.
 */
export function withSecret(
  state: RunState,
  secret: {
    /**
     * `sr_` plus 32 hex. Taken as a plain string and validated here.
     *
     * ── Why the parameter is not the branded type ──────────────────────────
     *
     * The caller is the Conversation Service's Run Driver, reading lifecycle
     * events out of its own durable log — and that plane may not depend on
     * `@askimate/aas-secrets` at all (`scripts/check-boundaries.ts` forbids the
     * dependency AND any source file naming it, because that package holds the
     * only plaintext in the system).
     *
     * So the brand is applied HERE, at the boundary, by the package that
     * already depends on secrets — the same pattern as `caseId()` and
     * `runId()`. A malformed id is refused rather than branded, so the brand
     * still means what it says.
     */
    readonly requestId: string;
    readonly lifecycle: SecretLifecycle;
    /** Opaque. `sh_` plus 32 hex. Resolves to nothing outside the vault. */
    readonly handle?: string;
  },
): RunState {
  if (!isSecretRequestId(secret.requestId)) {
    throw new IllegalSecretTransitionError(
      state.secret?.lifecycle ?? "none",
      secret.lifecycle,
      `"${secret.requestId.slice(0, 3)}…" is not a secret request id. The brand asserts this came ` +
        `from the secure plane; a string that cannot have does not get it.`,
    );
  }
  if (secret.handle !== undefined && !isSecretHandle(secret.handle)) {
    throw new IllegalSecretTransitionError(
      state.secret?.lifecycle ?? "none",
      secret.lifecycle,
      `A handle must be "sh_" and 32 hex characters. Anything else did not come from the vault.`,
    );
  }
  const current = state.secret;

  if (current !== undefined && current.requestId !== secret.requestId) {
    if (!isTerminalLifecycle(current.lifecycle)) {
      throw new IllegalSecretTransitionError(
        current.lifecycle,
        secret.lifecycle,
        `Request ${current.requestId} is still live, so ${secret.requestId} cannot replace it. A ` +
          `run has one open secure step at a time; a second one would abandon a box the student ` +
          `may be typing into.`,
      );
    }
  } else if (current !== undefined && !canTransition(current.lifecycle, secret.lifecycle)) {
    // Re-reporting the SAME word is not a transition and is allowed: lifecycle
    // events arrive through an at-least-once outbox, so a duplicate delivery
    // must be a no-op rather than an error.
    if (current.lifecycle !== secret.lifecycle) {
      throw new IllegalSecretTransitionError(
        current.lifecycle,
        secret.lifecycle,
        `Nothing leads out of a settled secret: single-use means the handle is dead, and a run ` +
          `state that said otherwise would hand a spent handle to an automation.`,
      );
    }
  }

  if (secret.handle !== undefined && secret.lifecycle === "secret_requested") {
    throw new IllegalSecretTransitionError(
      current?.lifecycle ?? "none",
      secret.lifecycle,
      `A handle exists only once the student has answered. The secure plane's own schema says the ` +
        `same thing as a_handle_means_it_was_answered.`,
    );
  }

  return {
    ...state,
    secret: {
      // Already narrowed by the guards above: `isSecretRequestId` and
      // `isSecretHandle` are type predicates, so no cast is needed — and a cast
      // here would be one that survived their removal.
      requestId: secret.requestId,
      lifecycle: secret.lifecycle,
      ...(secret.handle === undefined ? {} : { handle: secret.handle }),
    },
  };
}

/** Replaces the profile — after a confirmation, or a specialist correction. */
export function withProfile(
  state: RunState,
  profile: ConfirmedProfile,
  interview: InterviewState,
): RunState {
  return { ...state, profile, interview };
}

/**
 * The canonical fields this application needs, derived from the portal.
 *
 * Given to the interview so it asks for what this university actually wants,
 * rather than working from a fixed list that would be wrong for the next one.
 */
export function requiredFieldsFor(
  blueprint: ApplicationBlueprint,
  mappingSet: UsableMappingSet,
): readonly ProfileFieldKey[] {
  const required = new Set(
    allFields(blueprint)
      .filter((field) => field.validations.some((validation) => validation.kind === "required"))
      .map((field) => field.fieldRef),
  );

  const keys = mappingSet.mappings
    .filter((mapping) => required.has(mapping.fieldRef) && mapping.source.kind === "profile_field")
    .map((mapping) => (mapping.source as { fieldKey: ProfileFieldKey }).fieldKey);

  return [...new Set(keys)];
}
