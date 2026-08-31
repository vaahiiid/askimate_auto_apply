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
  ObservedPortalAuthentication,
  PasswordDelivery,
  PortalAccount,
} from "@askimate/aas-account";
import {
  chooseApproach,
  describeSecureChannel,
  outstandingHandoverItems,
  renderAccountCreationRequest,
  renderHandover,
} from "@askimate/aas-account";
import type { ApplicationBlueprint } from "@askimate/aas-blueprint";
import { allFields, checkExecutable } from "@askimate/aas-blueprint";
import type { RunId, StudentId, WorkflowCheckpoint } from "@askimate/aas-domain";
import { isFieldUnavailable, unwrapConfirmed } from "@askimate/aas-domain";
import type { InterviewAction, InterviewState } from "@askimate/aas-interview";
import type {
  SecretHandle,
  SecretLifecycle,
  SecretRequest,
  SecretRequestId,
} from "@askimate/aas-secrets";
import { canTransition, isTerminalLifecycle } from "@askimate/aas-secrets";
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
      outstanding: outstandingHandoverItems(account),
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
    readonly requestId: SecretRequestId;
    readonly lifecycle: SecretLifecycle;
    /** Opaque. Resolves to nothing outside the vault. */
    readonly handle?: SecretHandle;
  },
): RunState {
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
