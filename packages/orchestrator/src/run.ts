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

import type { PortalAccount } from "@askimate/aas-account";
import { renderAccountCreationRequest, renderHandover } from "@askimate/aas-account";
import type { ApplicationBlueprint } from "@askimate/aas-blueprint";
import { allFields, checkExecutable } from "@askimate/aas-blueprint";
import type { StudentId } from "@askimate/aas-domain";
import { isFieldUnavailable, unwrapConfirmed } from "@askimate/aas-domain";
import type { InterviewAction, InterviewState } from "@askimate/aas-interview";
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
    return {
      kind: "create_account",
      portalHost,
      email: address,
      say: renderAccountCreationRequest({
        institutionName: state.inputs.blueprint.institutionName,
        portalHost,
        email: address,
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
      }),
    };
  }

  return null;
}

function outstandingHandoverItems(account: PortalAccount): readonly string[] {
  const checklist = account.handover?.checklist;
  if (checklist === undefined) {
    return ["the handover has not been started"];
  }
  return Object.entries(checklist)
    .filter(([, done]) => !done)
    .map(([item]) => item);
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
