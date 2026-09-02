/**
 * The Run Driver: the first production connection between a conversation and
 * the orchestrator.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Before this file, `nextStep` had exactly one caller in the entire repository
 * — `scripts/end-to-end.ts`, a demo. The orchestrator was complete, tested and
 * unreachable from anything a student could do.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── The division of responsibility, and why it is worth stating ───────────
 *
 *   **The Conversation Service coordinates. The Orchestrator decides.**
 *
 * Nothing in this file works out what a run should do next. It loads state,
 * calls `nextStep`, and writes down where the answer put the run. Every branch
 * on `RunStep["kind"]` that could have crept in here — "if it wants a secret,
 * do X; if it wants authorisation, do Y" — is absent on purpose: a second
 * implementation of the decision would be a second opinion about it, and the
 * pure one in `packages/orchestrator` would stop being the answer.
 *
 * The mapping from a decision to a durable phase already exists too
 * (`phaseFor` / `deriveCheckpoint` in the orchestrator's `durable.ts`), so this
 * file does not write one. It calls `checkpointAfter`.
 *
 * ── What is durable after P1, and what is honestly not ────────────────────
 *
 * Durable, and proved against a real PostgreSQL across a process restart:
 *
 *   • the case's identity and its owner        `cases`
 *   • the conversation ↔ case binding          `conversations.case_id`
 *   • the run's identity and its case          `workflow_runs`
 *   • the checkpoint, and its revision         `workflow_runs.checkpoint`
 *   • what was agreed and what happened        `case_events`
 *
 * NOT durable yet, and stated here rather than discovered later: the
 * `ConfirmedProfile` and the `InterviewState`. `resumeRun` says so in its own
 * documentation — `ConfirmationCaptured` carries a *reference* rather than a
 * value, deliberately, so the event log is not a copy of the profile. A resumed
 * run therefore re-derives an empty profile and a fresh interview from the
 * catalogue. For P1 that is correct and sufficient: the brief's durability list
 * is case identity, run identity, durable run state, checkpoint state and the
 * conversation binding, and every one of those survives. Restoring answers a
 * student already gave is a later phase and needs a decision about where a
 * confirmed value lives, not a line of code here.
 */

import { randomUUID } from "node:crypto";

import type { ObservedPortalAuthentication, PasswordDelivery } from "@askimate/aas-account";
import { mayConcludeCase } from "@askimate/aas-account";
import type { ApplicationBlueprint } from "@askimate/aas-blueprint";
import type { WorkflowRunStore } from "@askimate/aas-case-store/workflow";
import type {
  InterventionStore,
  StoredIntervention,
} from "@askimate/aas-case-store/interventions";
import { InterventionNotFoundError } from "@askimate/aas-case-store/interventions";
import {
  askimateActor,
  blueprintVersion,
  caseId as makeCaseId,
  courseId as makeCourseId,
  externalRef,
  assessIntent,
  idempotencyKeyFor,
  institutionId as makeInstitutionId,
  intake as makeIntake,
  interventionId as makeInterventionId,
  priorityFor,
  fold,
  isFieldUnavailable,
  decide,
  suggestsMinority,
  openCase,
  runId as makeRunId,
  stamp,
  studentId as makeStudentId,
  unwrapConfirmed,
} from "@askimate/aas-domain";
import type {
  ApplicationCase,
  CaseIntent,
  CaseEventPayload,
  CaseState,
  CaseId,
  ConsequentialAction,
  HumanReviewRecord,
  DecisionRefusal,
  MandatoryReviewTrigger,
  InterventionId,
  RecoveryEscalation,
  RecoveryResolution,
  ReusabilityAssessment,
  RunId,
  StudentId,
  WorkflowPhase,
  WorkflowRunRecord,
  WorkflowStatus,
} from "@askimate/aas-domain";
import type { InterviewState } from "@askimate/aas-interview";
import {
  newInterview,
  nextAction,
  receiveAnswer,
  receiveConfirmation,
} from "@askimate/aas-interview";
import { createHash } from "node:crypto";

import type { ModelClient } from "@askimate/aas-llm";
import { checkUsable, planFill, toStoredPlan } from "@askimate/aas-mapping";
import type { FillPlan, MappingSet, StoredFillPlan } from "@askimate/aas-mapping";
import {
  accountCreated,
  accountWorkOf,
  awaitsStudentAuthorisation,
  beginRun,
  handoffFor,
  handoffMessageOf,
  interviewActionOf,
  pageFillTarget,
  pageValuesOf,
  handoffTokenFor,
  browserWorkFor,
  caseStateForStep,
  executePlanOf,
  nextCaseHop,
  markFilled,
  checkpointAfter,
  nextStep,
  requiredFieldsFor,
  requiresSecureRequest,
  resumeRun,
  startRun,
  withAuthorisation,
  withCheckpoint,
  withSecret,
} from "@askimate/aas-orchestrator";
import type {
  DurableStores,
  HandoverEvidence,
  ResumeConcern,
  RunState,
  RunStep,
} from "@askimate/aas-orchestrator";
import { isFinancialField, resolveField } from "@askimate/aas-profile";
import type {
  ConfirmedProfile,
  ConfirmedProfileStore,
  ProfileFieldKey,
} from "@askimate/aas-profile";
import { toStoredEntry } from "@askimate/aas-profile";

import { latestSecretRequest } from "@askimate/aas-conversation";

import type {
  ClaimedWork,
  FillLocator,
  RegistrationTargets,
  StudentDecision,
  TransportedPlan,
  WorkApproach,
  WorkKind,
  WorkReport,
} from "@askimate/aas-contracts";
import { WORK_APPROACHES } from "@askimate/aas-contracts";

import type { ApplicationBindingStore } from "./application-store.js";
import type { ConversationEvent } from "@askimate/aas-contracts";
import type { ProposedValue } from "@askimate/aas-domain";

import type { ConversationEventStore } from "./event-store.js";
import type { SecureRequestOpener } from "./secure-requests.js";
import type { WorkLeaseStore } from "./work-store.js";

/**
 * A reviewed blueprint and its reviewed mapping set, by id.
 *
 * A PORT, not a table. Which portals AskiMate can apply to is decided by
 * discovery and two-person review (ADR-0017), and a database table of
 * blueprints would be a place for an unreviewed one to arrive. The catalogue is
 * supplied by whoever composes the service, and for now that is a fixture.
 */
export interface CatalogueEntry {
  readonly blueprint: ApplicationBlueprint;
  readonly mappingSet: MappingSet;
  /** Document kinds the interview must collect, e.g. `["passport"]`. */
  readonly requiredDocuments: readonly string[];

  /**
   * Stable identifiers for the submission identity. NOT derived from prose.
   *
   * ── A seam found while wiring this up, and worth stating ───────────────
   *
   * `ApplicationBlueprint` already carries `institutionName`, `courseName` and
   * `intake` — and every one of them is a HUMAN LABEL. `intake` is
   * `"September 2026"`; the domain's `Intake` is a branded, validated
   * `YYYY-MM`, because it goes into the submission key that stops a student
   * being applied for twice.
   *
   * The obvious shortcut is to parse the label. That would make this
   * coordinator derive a business fact from prose, and derive it wrongly the
   * first time a blueprint says "Autumn 2026" or "Sept 26" — silently, into the
   * key that prevents duplicate submissions.
   *
   * So the catalogue states them. Which institution, which course and which
   * intake a blueprint is FOR is part of what a specialist reviews (ADR-0017),
   * not something to be recovered from a display string afterwards.
   */
  readonly institutionRef: string;
  readonly courseRef: string;
  /** `YYYY-MM`. The blueprint's own `intake` is a label; this is the identity. */
  readonly intakeRef: string;

  /**
   * What discovery observed about this portal's authentication.
   *
   * Optional in `RunInputs` and required in practice: a portal whose blueprint
   * says authentication is required cannot get past `accountStepFor` without
   * it, and answers `specialist` instead — which is the correct refusal, since
   * "how does this portal's sign-in work?" is a question a run must not guess
   * at while a form is open.
   *
   * It belongs in the catalogue for the same reason `institutionRef` does: it
   * is a reviewed per-portal fact with a discovery run behind it, not something
   * to derive.
   */
  readonly portalAuthentication?: ObservedPortalAuthentication;

  /**
   * Where this blueprint's portal actually is, when that is not where the
   * blueprint says.
   *
   * ═════════════════════════════════════════════════════════════════════
   * A blueprint records the PATHS of a portal — `/register`, `/apply` — and an
   * origin it was discovered against. The same reviewed blueprint is run
   * against a university's UAT or sandbox environment before it is ever run
   * against production (see `docs/qa-higher-education-sandbox-request.md`), and
   * rewriting the blueprint to point at the sandbox would mean running a
   * blueprint nobody reviewed.
   * ═════════════════════════════════════════════════════════════════════
   *
   * So the ORIGIN is a deployment fact and lives here, and the paths stay in the
   * reviewed artefact where they belong. Absent means the blueprint's own
   * origin, which is the production case.
   */
  readonly portalOrigin?: string;

  /**
   * How the student's password gets from them to the portal, when they choose
   * their own.
   *
   * A per-portal decision that ADR-0020 ranks and a specialist records, not a
   * default. Absent means `student_types_into_portal` — the student opens the
   * portal themselves and AskiMate never holds a password at all. Naming
   * `askimate_secure_channel` is the deliberate choice to use the Secure Plane,
   * and it is the only value for which any of ADR-0026, ADR-0030, ADR-0034 or
   * ADR-0042 applies.
   */
  readonly passwordDelivery?: PasswordDelivery;
}

export interface ApplicationCatalogue {
  find(blueprintId: string): Promise<CatalogueEntry | null>;
}

/** Why a start could not proceed. Outcomes, not exceptions. */
export type RunRefusal =
  /** The run needs a secure step and this deployment has no route to one. */
  | { readonly kind: "secure_plane_unavailable" }
  /**
   * The orchestrator asked for a purpose the Secure Plane's contract does not
   * accept.
   *
   * A latent drift, found by wiring the two together: `SecretPurpose` in
   * `@askimate/aas-secrets` is `portal_account_creation | portal_sign_in`, and
   * `OpenSecretRequest.purpose` in `secure.v1.yaml` is `portal_account_creation
   * | portal_password_reset`. They share one member and differ on the other.
   *
   * Nothing reachable is broken — `secretRequestFor` only ever asks for
   * `portal_account_creation`, which both accept. This refusal is what keeps it
   * that way: a purpose the published contract does not name is refused here
   * rather than cast into it, so a future change to either closed set fails
   * loudly instead of opening a request the secure service will reject.
   */
  | { readonly kind: "purpose_not_supported" }
  | { readonly kind: "unknown_blueprint" }
  | { readonly kind: "unusable_mapping_set"; readonly detail: string }
  | { readonly kind: "unknown_conversation" }
  | { readonly kind: "case_not_bindable" };

/**
 * Where a run stands, as this service reports it.
 *
 * Position and identity. There is no field here carrying what a step *said*:
 * `RunStep` branches hold prompts, previews and plans, and a driver that copied
 * them into its return value would be putting business content on a wire that
 * P1 has no need to put it on.
 */
export interface RunPosition {
  readonly runId: string;
  readonly caseId: string;
  readonly conversationId: string;
  readonly status: WorkflowStatus;
  readonly phase: WorkflowPhase;
  /** The decision's kind only. A closed set from `RunStep`. */
  readonly step: RunStep["kind"];
  readonly revision: number;
  /** True when this call resumed an existing run rather than creating one. */
  readonly resumed: boolean;
  readonly concerns: readonly ResumeConcern[];
}

export type RunOutcome =
  | { readonly ok: true; readonly position: RunPosition }
  | { readonly ok: false; readonly refusal: RunRefusal };

/**
 * The durable phases from which browser work can exist.
 *
 * A cheap NARROWING of which runs to ask the orchestrator about, not an answer
 * — `browserWorkFor` gives the answer, and a run in one of these phases is
 * routinely found to have nothing to do. Kept as phases rather than step kinds
 * because the checkpoint is what the claim query can filter on in SQL, and a
 * checkpoint holds a phase.
 *
 * One entry per work kind, and they are checked against each other: a work kind
 * whose phase is missing here is work that exists and is never handed out —
 * silently, because a candidate query that returns nothing looks exactly like
 * an idle system. `phaseFor` in the orchestrator is what maps a step to its
 * phase, and the drift test compares the two lists.
 */
const BROWSER_PHASES: readonly string[] = ["creating_account", "filling"];

/**
 * Whether a secret lifecycle is finished with.
 *
 * A settled step is one the student can no longer answer, so the run may ask
 * again. `secret_requested` and `secret_received` are both LIVE: the first is a
 * box on screen, and the second is a handle the automation has not spent yet.
 */
function isSettled(lifecycle: string): boolean {
  return (
    lifecycle === "secret_consumed" ||
    lifecycle === "secret_expired" ||
    lifecycle === "secret_cancelled"
  );
}

/** What the critical section hands back: a run, and whether it already existed. */
interface StartedRun {
  readonly record: WorkflowRunRecord;
  readonly caseId: CaseId;
  readonly studentRef: StudentId;
  readonly resumed: boolean;
}

/**
 * What the student is told when their run pauses.
 *
 * Honest and useless to act on, deliberately. It names no portal field, no
 * validation error and no specialist — a student can do nothing with any of
 * them, and `routes.ts` already takes that position for a mapping-set refusal.
 * What it does NOT do is pretend the run is still progressing: a paused
 * application that looks busy is how a deadline gets missed quietly.
 */
function pauseMessage(entry: CatalogueEntry): string {
  return (
    `I have paused your ${entry.blueprint.institutionName} application. Something happened on ` +
    `their system that I could not confirm one way or the other, and rather than risk repeating ` +
    `a step you may already have completed, I have stopped and asked a person to check it. ` +
    `Nothing you have given me is lost, and you do not need to do anything — I will tell you as ` +
    `soon as it moves again.`
  );
}

/**
 * What the student is told when they stop.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ADR-0053 §4, Vahid: *"completely honest and explicit … Do not imply that an
 * existing portal account, already submitted data, or previously completed
 * portal actions have been undone or erased when they have not."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Three things stopping does NOT do, and every one of them is easy to imply by
 * omission:
 *
 *   - it does not un-create the portal account. It exists in the student's
 *     name and is theirs (ADR-0020);
 *   - it does not un-fill a page. What was typed into their form is in their
 *     form, and nothing here reaches back through a browser to remove it;
 *   - it is not erasure. That is a different request with a different lawful
 *     basis, bound up with a retention schedule that is not approved — so the
 *     message NAMES it as separate rather than letting "stopped" be heard as
 *     "deleted", which would be the most damaging thing this phase could ship.
 *
 * The account sentence is conditional because the claim must be true: a student
 * who stops before any account exists must not be told one does.
 */
function cancellationMessage(entry: CatalogueEntry, hasAccount: boolean): string {
  const institution = entry.blueprint.institutionName;
  const account = hasAccount
    ? `The account at ${institution} was created in your name and still exists — it is yours, and ` +
      `I will help you take control of it before we finish. Anything I already filled in on their ` +
      `form is still saved there; I cannot remove it, and you can change it yourself once you have ` +
      `the account. `
    : ``;
  return (
    `I have stopped work on your ${institution} application, and I will not start anything new ` +
    `on it. ${account}Nothing was submitted. If you want your data deleted rather than just ` +
    `stopped, tell me — that is a separate request and I will pass it to a person.`
  );
}

/**
 * What the student is told when their case needs a human review first.
 *
 * Honest about the CAUSE without naming the trigger. "Because you are under
 * 18" or "because of your bank statement" is true and is not this system's to
 * volunteer in a chat window; what the student needs is that a person is
 * looking and that nothing is lost.
 */
function reviewMessage(entry: CatalogueEntry): string {
  return (
    `Before I show you your ${entry.blueprint.institutionName} application to approve, a member ` +
    `of the team needs to check it over. That is a rule we apply every time for applications ` +
    `like yours, not something that has gone wrong. Nothing you have given me is lost, and I ` +
    `will come back to you as soon as it has been looked at.`
  );
}

/**
 * How far out a handoff's `expiresAt` is set.
 *
 * A hundred years. `HandoffRequired.expiresAt` is required by the event and
 * nothing in this phase reads it, and the honest way to say "this does not
 * expire" in a required Date field is a date so far out that nobody mistakes it
 * for a deadline somebody chose. A plausible-looking one — 48 hours, say —
 * would read as a policy, and there is no policy: a student who has not
 * followed a verification link by Friday has not lost the right to.
 */
const NEVER_MIND_THE_CLOCK_MS = 100 * 365 * 24 * 60 * 60 * 1000;

/**
 * The field an `interview` step is asking about, or `null`.
 *
 * A NARROWING, for the reason `requiresSecureRequest` and `handoffFor` are:
 * the step vocabulary is the orchestrator's, and a coordinator matching on
 * `step.kind` would keep its own copy of it. This one reaches one level
 * further in, to the `InterviewAction` the step carries, because only an `ask`
 * has a field for the student to answer — `confirm`, `complete` and `escalate`
 * are not questions about a value.
 */
function interviewAsk(step: RunStep): ProfileFieldKey | null {
  const action = interviewActionOf(step);
  return action !== null && action.kind === "ask" ? action.fieldKey : null;
}

/**
 * The interview, rebuilt from the conversation log (ADR-0051).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * This used to be `newInterview(…)` on every request, which meant `pending`,
 * `attempts` and `transcript` were ALWAYS EMPTY. Two consequences, and the
 * second is the worse one: a pending confirmation could not survive the
 * request that created it, and `MAX_ATTEMPTS_PER_FIELD` could never be
 * reached — so the `information_unobtainable` escalation ADR-0007 requires had
 * never once fired.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Derived, not stored, like everything else this driver reconstructs
 * (ADR-0041, ADR-0047). The profile comes from its own store; the rest comes
 * from the log the exchange happened in.
 */
function interviewFrom(input: {
  readonly studentRef: StudentId;
  readonly profile: ConfirmedProfile;
  readonly requiredFields: readonly ProfileFieldKey[];
  readonly requiredDocuments: readonly string[];
  readonly events: readonly ConversationEvent[];
}): InterviewState {
  const base = newInterview({
    studentRef: input.studentRef,
    profile: input.profile,
    requiredFields: input.requiredFields,
    requiredDocuments: input.requiredDocuments,
  });

  const open = openProposal(input.events);
  return {
    ...base,
    attempts: attemptsFrom(input.events),
    // The last few turns, so a re-asked question fits the conversation. Only
    // messages: a proposal is not something anybody said.
    transcript: input.events
      .filter((event) => event.kind === "message" && event.content !== null)
      .slice(-6)
      .map((event) => `${event.kind === "message" ? event.actor : "system"}: ${
        event.kind === "message" ? (event.content ?? "") : ""
      }`),
    ...(open === null
      ? {}
      : {
          pending: {
            fieldKey: open.fieldKey as ProfileFieldKey,
            proposed: open.proposal as ProposedValue<unknown>,
          },
        }),
  };
}

/**
 * The open proposal on this log, or `null`.
 *
 * The last `value_proposed` with no `value_confirmed` or `value_rejected`
 * after it — the same reading `latestSecretRequest` makes of the secure
 * lifecycle, and the same reading the `open_value_proposals` view makes in SQL.
 * Derived here as well as in the view because `#situation` already holds every
 * event and a second round trip would answer the same question more slowly.
 */
export function openProposal(
  events: readonly ConversationEvent[],
): { fieldKey: string; proposal: unknown; playbackHash: string } | null {
  let open: { fieldKey: string; proposal: unknown; playbackHash: string } | null = null;
  for (const event of events) {
    if (event.kind === "value_proposed") {
      open = {
        fieldKey: event.fieldKey,
        proposal: event.proposal,
        playbackHash: event.playbackHash,
      };
      continue;
    }
    if (event.kind === "value_confirmed" || event.kind === "value_rejected") open = null;
  }
  return open;
}

/**
 * How many times each field has been read and not accepted.
 *
 * ── What this counts, and what it does not ────────────────────────────────
 *
 * A proposal that was superseded or rejected is a failed attempt. An answer
 * the model could not read AT ALL leaves no event, so it does not count —
 * which makes the escalation less eager than `MAX_ATTEMPTS_PER_FIELD` intends.
 *
 * Stated rather than hidden. Recording an unreadable answer would need a
 * fourth event kind whose only purpose is a counter, and the escalation now
 * fires on the case that matters — three readings a student kept saying no to
 * — where before it fired on nothing at all.
 */
function attemptsFrom(events: readonly ConversationEvent[]): ReadonlyMap<ProfileFieldKey, number> {
  const attempts = new Map<ProfileFieldKey, number>();
  const bump = (key: string): void => {
    const field = key as ProfileFieldKey;
    attempts.set(field, (attempts.get(field) ?? 0) + 1);
  };
  let outstanding: string | null = null;
  for (const event of events) {
    if (event.kind === "value_proposed") {
      // A second proposal for a field replaces the first: the first was read
      // and did not become a confirmed value.
      if (outstanding !== null) bump(outstanding);
      outstanding = event.fieldKey;
      continue;
    }
    if (event.kind === "value_rejected") {
      bump(event.fieldKey);
      outstanding = null;
      continue;
    }
    if (event.kind === "value_confirmed") outstanding = null;
  }
  return attempts;
}

/**
 * The page an `advance_portal_page` target names, without its content version.
 *
 * A target is `page-ref@sha256:…` since ADR-0051 §6, because one intent per
 * page could not answer "was the CORRECTED value written?". The hash belongs
 * in the ledger, which identifies actions; it does not belong in front of a
 * specialist, who has to open a portal and look at a page.
 */
function pageOf(target: string): string {
  const at = target.indexOf("@");
  return at === -1 ? target : target.slice(0, at);
}

/**
 * The hash of a message the student is asked to confirm.
 *
 * `sha256:` prefixed and hex, matching `buildPreview`'s `contentHash` exactly
 * — one shape of hash in the system, so a reader comparing an authorisation
 * and a handover confirmation in the case log is comparing like with like.
 * Deliberately NOT reusing `buildPreview`: that hashes a rendered application,
 * field by field, and pointing it at a sentence would be borrowing a function
 * for a job it does not do.
 */
function hashOfText(text: string): string {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

/** What the student is told when it moves again. */
function resumeMessage(entry: CatalogueEntry): string {
  return (
    `Good news — someone has checked your ${entry.blueprint.institutionName} application and ` +
    `it is moving again. I am picking up exactly where I stopped, so nothing will be repeated.`
  );
}

/** Why a student's decision was not recorded. A closed set, for the wire. */
export type DecisionRefusalReason = "no_case" | "not_asked" | "content_changed" | "refused";

export interface RunDriverOptions {
  readonly stores: DurableStores;
  readonly bindings: ApplicationBindingStore;
  readonly catalogue: ApplicationCatalogue;
  /** The interview's model. Injected; this service decides nothing with it. */
  readonly model: ModelClient;
  /**
   * Where confirmed values live between requests. ADR-0044.
   *
   * The gap `resumeRun` documented and could not close: a `ConfirmedProfile` is
   * not reconstructible from the event log by design, because
   * `ConfirmationCaptured` carries a reference rather than a value. It is
   * reconstructible from HERE, which is why a restarted process now resumes an
   * interview where it left off rather than at the beginning.
   */
  readonly profiles: ConfirmedProfileStore;
  /**
   * The conversation's own durable log. ADR-0031.
   *
   * The driver reads it for one thing and writes it for one thing: where the
   * last secure step got to, and that a new one has been opened. It is not a
   * second home for run state — the checkpoint and the case log already have
   * that between them.
   */
  readonly conversations: ConversationEventStore;
  /**
   * How a secure step is opened. Absent in a deployment that carries no Secure
   * Plane, and a run that needs one is then refused rather than skipped.
   */
  readonly secureRequests?: SecureRequestOpener;
  /**
   * Who is holding which run's browser work. ADR-0045.
   *
   * Optional, and absent means this deployment hands out no work — the claim
   * route then answers "nothing to do" rather than failing to start. A
   * deployment that carries conversations and no runners is a real shape: it is
   * what every test of the conversation surface runs as.
   */
  readonly leases?: WorkLeaseStore;
  /**
   * Where a stopped run's adjudication lives. ADR-0048.
   *
   * Optional for the same reason `leases` is: a deployment that hands out no
   * browser work cannot get a run stuck on a consequential action, so it needs
   * no specialist queue. Where it is absent the run still stops — that is the
   * ledger's doing, not this store's — it simply stops silently, exactly as it
   * did before P10.
   */
  readonly interventions?: InterventionStore;
  /**
   * Intervention ids, injected so a test can make one predictable.
   *
   * Given the idempotency key as well as the run, because a run can be stuck on
   * more than one action over its life — a page-two save and, later, a page-
   * three save. An id derived from the run alone collides on the second.
   */
  readonly newInterventionId?: (runId: string, idempotencyKey: string, now: Date) => string;
  /** Lease ids, injected so a test can make a claim predictable. */
  readonly newLeaseId?: (runId: string, now: Date) => string;
  readonly now: () => Date;
  /** Ids, injected so a test can make a run's identity predictable. */
  readonly newCaseId?: (conversationId: string) => string;
  readonly newRunId?: (caseId: string, now: Date) => string;
}

export class RunDriver {
  readonly #options: RunDriverOptions;

  public constructor(options: RunDriverOptions) {
    this.#options = options;
  }

  /**
   * Starts a run for a conversation, or returns the one it already has.
   *
   * Idempotent through the binding rather than through a header: a conversation
   * owns at most one case, so a client that retries a timed-out start is asking
   * the same question, not making a second request. `bind` takes a row lock, so
   * two simultaneous starts cannot produce two cases.
   */
  public async start(input: {
    readonly conversationId: string;
    readonly blueprintId: string;
    /**
     * What the student actually said.
     *
     * Required, and it goes into `CaseOpened.requestEvidence`. Product rule 1 —
     * explicit request before consequential action, silence is not consent — is
     * a structural precondition of the domain: a case cannot be opened without
     * it.
     */
    readonly studentStatement: string;
  }): Promise<RunOutcome> {
    const entry = await this.#options.catalogue.find(input.blueprintId);
    if (entry === null) return { ok: false, refusal: { kind: "unknown_blueprint" } };

    const now = this.#options.now();
    const proposed =
      this.#options.newCaseId?.(input.conversationId) ??
      `case_${input.conversationId.toLowerCase()}`;

    // ── One critical section: bind, open the case, start the run ─────────
    //
    // Held across all three because a lock around the binding alone is not
    // enough — two simultaneous starts agreed on one case and then raced to
    // open its event log, and the loser saw a ConcurrencyConflictError. A
    // student retrying a timed-out request must not be able to produce that.
    let outcome: StartedRun | RunOutcome;
    try {
      outcome = await this.#options.bindings.withBinding(
        {
          conversationId: input.conversationId,
          caseId: proposed,
          blueprintId: input.blueprintId,
          now,
        },
        async (bound): Promise<StartedRun | RunOutcome> => {
          const caseId = makeCaseId(bound.caseId);
          const studentRef = makeStudentId(bound.studentId);

          // An existing run for this case is resumed, never restarted. A second
          // would give the case two positions, and the older one would still be
          // "running" — which is how a student ends up with two automations.
          const existing = await this.#options.stores.runs.findByCase(caseId);
          const live = existing.find(
            (record) => record.status === "running" || record.status === "suspended",
          );
          if (live !== undefined) return { record: live, caseId, studentRef, resumed: true };

          // ── The case's first event ────────────────────────────────────
          //
          // Written before the run, because a run whose case has no log is a
          // run against nothing. `openCase` refuses to build without request
          // evidence, so this is where "the student asked" stops being an
          // assumption.
          const sequence = await this.#options.stores.cases.currentSequence(caseId);
          if (sequence === 0) {
            const events = stamp({
              caseId,
              fromSequence: 0,
              payloads: [
                openCase({
                  submissionIdentity: {
                    studentId: studentRef,
                    institutionId: makeInstitutionId(entry.institutionRef),
                    courseId: makeCourseId(entry.courseRef),
                    intake: makeIntake(entry.intakeRef),
                    attemptOrdinal: 1,
                  },
                  requestEvidence: {
                    requestedAt: now,
                    channel: "askimate_chat",
                    conversationRef: externalRef(input.conversationId),
                    studentStatement: input.studentStatement,
                  },
                }),
              ],
              actor: askimateActor(externalRef(input.conversationId)),
              now,
              nextEventId: (index) => `evt_${bound.caseId}_${String(index + 1)}`,
            });
            await this.#options.stores.cases.append(caseId, 0, events);
          }

          const record = await startRun({
            stores: this.#options.stores,
            // Derived from the case, not random. The same reasoning as
            // `idempotencyKeyFor`: a random id regenerated after a restart
            // would not match the one written before the crash, so the
            // mechanism would silently do nothing. The trailing ordinal is
            // there because a case MAY be attempted more than once — a recovery
            // or a reapplication — and P1 only ever writes the first.
            runId: makeRunId(
              this.#options.newRunId?.(bound.caseId, now) ?? `run_${bound.caseId}_1`,
            ),
            caseId,
            studentRef,
            blueprintVersion: blueprintVersion(entry.blueprint.version),
            now,
          });
          return { record, caseId, studentRef, resumed: false };
        },
      );
    } catch (error: unknown) {
      if (error instanceof Error && error.name === "UnknownConversationBindingError") {
        return { ok: false, refusal: { kind: "unknown_conversation" } };
      }
      if (error instanceof Error && error.name === "CaseBindingRefusedError") {
        return { ok: false, refusal: { kind: "case_not_bindable" } };
      }
      throw error;
    }
    if ("ok" in outcome) return outcome;
    const { record, caseId, studentRef, resumed } = outcome;

    return await this.#decide({
      entry,
      record,
      conversationId: input.conversationId,
      caseId,
      studentRef,
      concerns: [],
      resumed,
    });
  }

  /**
   * Resumes a run and advances it by one decision.
   *
   * This is what a restarted process calls. `resumeRun` reconciles the
   * checkpoint against the event log — and the log wins every disagreement,
   * which costs a re-derivation and never costs correctness.
   */
  public async advance(input: {
    readonly runId: string;
    readonly conversationId: string;
  }): Promise<RunOutcome> {
    const runId = makeRunId(input.runId);
    const record = await this.#options.stores.runs.load(runId);
    if (record === null) return { ok: false, refusal: { kind: "unknown_conversation" } };

    const bound = await this.#options.bindings.caseFor(input.conversationId);
    if (bound === null || bound.caseId !== record.caseId) {
      // The run does not belong to this conversation. Reported as "unknown"
      // rather than "forbidden", for the same reason the routes answer 404 on a
      // conversation somebody else owns: a 403 confirms it exists.
      return { ok: false, refusal: { kind: "unknown_conversation" } };
    }

    // Identified by the case's blueprint id, not by the checkpoint's VERSION.
    // A version is only unique within a blueprint, so two blueprints at 1.0.0
    // are indistinguishable by it — which is exactly what happened the moment a
    // second one was written (migration 0004).
    if (bound.blueprintId === null) {
      return { ok: false, refusal: { kind: "unknown_blueprint" } };
    }
    const entry = await this.#options.catalogue.find(bound.blueprintId);
    if (entry === null) return { ok: false, refusal: { kind: "unknown_blueprint" } };

    const resumed = await resumeRun({
      stores: this.#options.stores,
      runId,
      expectedBlueprintVersion: blueprintVersion(entry.blueprint.version),
      now: this.#options.now(),
    });
    if (resumed === null) return { ok: false, refusal: { kind: "unknown_conversation" } };

    return await this.#decide({
      entry,
      record: resumed.record,
      conversationId: input.conversationId,
      caseId: resumed.record.caseId,
      studentRef: resumed.record.studentRef,
      concerns: resumed.concerns,
      resumed: true,
    });
  }

  /** The run a conversation currently has, without advancing it. */
  public async currentFor(conversationId: string): Promise<RunOutcome | null> {
    const bound = await this.#options.bindings.caseFor(conversationId);
    if (bound === null) return null;
    const runs = await this.#options.stores.runs.findByCase(makeCaseId(bound.caseId));
    const record = runs[0];
    if (record === undefined) return null;
    return await this.advance({ runId: record.runId, conversationId });
  }

  // ── The one place `nextStep` is called ────────────────────────────────

  /**
   * Decides, and re-decides if another process got there first.
   *
   * ═════════════════════════════════════════════════════════════════════════
   * `withBinding` serialises bind → open case → start run, and then releases.
   * Two callers that raced to start the SAME conversation therefore both leave
   * the critical section holding a record at the same revision, and both go on
   * to write a checkpoint against it. One wins; `saveCheckpoint` refuses the
   * other with a `RunConcurrencyError` whose own message says what to do —
   * *"re-load and decide again"*.
   *
   * This is that. The re-decision is not a repeat of the first: it re-reads the
   * conversation log and the run record, so it sees whatever the winner just
   * wrote — including a secure request the winner opened, which is what stops
   * the loser opening a second one.
   * ═════════════════════════════════════════════════════════════════════════
   *
   * Bounded at three attempts, and it does not sleep between them. One
   * conversation belongs to one student, so contention here is two clicks or a
   * double-submitted form, not a queue. A run that genuinely could not be
   * checkpointed after three re-reads is a fault to surface, not to absorb.
   */
  async #decide(input: {
    readonly entry: CatalogueEntry;
    readonly record: Awaited<ReturnType<WorkflowRunStore["start"]>>;
    readonly conversationId: string;
    readonly caseId: CaseId;
    readonly studentRef: StudentId;
    readonly concerns: readonly ResumeConcern[];
    readonly resumed: boolean;
  }): Promise<RunOutcome> {
    let record = input.record;
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.#decideOnce({ ...input, record });
      } catch (error: unknown) {
        // By name, not by class: the error is raised in @askimate/aas-case-store
        // and matching on the constructor would couple this file to that
        // package's identity across a bundling boundary.
        if (attempt >= 2 || !(error instanceof Error) || error.name !== "RunConcurrencyError") {
          throw error;
        }
        const fresh = await this.#options.stores.runs.load(input.record.runId);
        if (fresh === null) throw error;
        record = fresh;
      }
    }
  }

  /**
   * What the orchestrator says about this run right now, and the facts the
   * decision was made from.
   *
   * Extracted because TWO callers need it and neither may re-derive it. The
   * decide path acts on the step; the claim path (ADR-0045) reads the step to
   * build a unit of work. A claim path that reconstructed the state itself
   * would be a second answer to "what happens next", which is the failure
   * ADR-0041 and `check-boundaries` exist to prevent.
   *
   * It writes nothing. Everything durable — the checkpoint, the secure request,
   * the lease — is the caller's to do, so a caller that only wanted to LOOK
   * cannot move the run by looking.
   */
  async #situation(input: {
    readonly entry: CatalogueEntry;
    readonly record: Awaited<ReturnType<WorkflowRunStore["start"]>>;
    readonly conversationId: string;
    readonly caseId: CaseId;
    readonly studentRef: StudentId;
  }): Promise<
    | { readonly ok: false; readonly refusal: RunRefusal }
    | {
        readonly ok: true;
        readonly step: RunStep;
        readonly now: Date;
        /** The state the decision was made from, for the case walk. */
        readonly state: RunState;
        readonly secret: ReturnType<typeof latestSecretRequest>;
        /** The account the run is carrying, once one has been created. */
        readonly account: RunState["account"];
      }
  > {
    const usable = checkUsable(input.entry.mappingSet, input.entry.blueprint);
    if (!usable.usable) {
      return {
        ok: false,
        refusal: { kind: "unusable_mapping_set", detail: usable.refusal.detail },
      };
    }

    const now = this.#options.now();
    // Loaded, not invented. Before ADR-0044 this was `emptyProfile(...)` on
    // every call, so a run could never leave `interviewing`: each request
    // re-derived a profile with nothing in it and `planFill` reported the same
    // blockers it had reported the request before.
    const profile = await this.#options.profiles.load(input.studentRef, now);
    // ── Where the last secure step got to, from the durable log ──────────
    //
    // `RunState.secret` is not persisted anywhere of its own, and it does not
    // need to be: the conversation log already records every lifecycle word the
    // Secure Plane published, and `latestSecretRequest` is the one reading of it
    // (ADR-0041). Rebuilding it here is what stops a second call re-opening a
    // step the student is already looking at.
    const events = await this.#options.conversations.since(input.conversationId, 0);
    const secret = latestSecretRequest(events);

    const base: RunState = withCheckpoint(
      beginRun({
        inputs: {
          caseId: input.caseId,
          studentRef: input.studentRef,
          blueprint: input.entry.blueprint,
          mappingSet: input.entry.mappingSet,
          documents: new Map(),
          ...(input.entry.portalAuthentication === undefined
            ? {}
            : { portalAuthentication: input.entry.portalAuthentication }),
          ...(input.entry.passwordDelivery === undefined
            ? {}
            : { passwordDelivery: input.entry.passwordDelivery }),
          // ── Not an assumption, and worth saying why ────────────────────
          //
          // `chooseApproach` uses this to decide between the student picking
          // their own password and one being generated for them, so getting it
          // wrong would change what happens to a credential.
          //
          // It is true because of the ORDER, not because of optimism: the
          // account is created after the secure step, and the secure step
          // cannot complete unless the student typed a password into the
          // secure control. A run therefore cannot reach account creation
          // without the student having been present — the step enforces it.
          studentPresentAtCreation: true,
        },
        profile,
        interview: interviewFrom({
          studentRef: input.studentRef,
          profile,
          requiredFields: requiredFieldsFor(input.entry.blueprint, usable.mappingSet),
          requiredDocuments: input.entry.requiredDocuments,
          events,
        }),
      }),
      input.record,
    );

    // `withSecret` is the sanctioned writer, and it refuses a move the Secure
    // Plane could not have made — a spent handle coming back to life, a second
    // request replacing a live one. A log that said either of those would be a
    // log this driver declines to act on rather than one it believes.
    const withTheSecret: RunState = secret === null ? base : withSecret(base, secret);

    // ── The account, from the durable record that it was created ──────────
    //
    // `state.account` lives in memory and this process holds none between
    // requests. Without rebuilding it here, `accountStepFor` would answer
    // `create_account` on EVERY request — and a run whose account was created a
    // second ago would be told to create it again, on a real university portal,
    // for a student who already has one.
    //
    // The evidence is `workflow_action_intents`, which exists for exactly this
    // (ADR-0008), and `assessIntent` is the one function that reads a verdict
    // out of it. `already_done` with `succeeded` is the only verdict that
    // produces an account: `verify_first` and `escalate` both mean somebody has
    // to go and look, and neither is a thing to assume through.
    // ── Whether the application is done, BEFORE the account is derived ────
    //
    // The account's stage turns on it (ADR-0050) and `withAuthorisation`
    // clears the flag below, so the question is asked once, here, and the
    // answer is used twice.
    const filled = await this.#hasFilled(withTheSecret, input.record.runId, input.entry);
    const handover = await this.#handoverEvidence({
      caseId: input.caseId,
      record: input.record,
      filled,
      now,
    });
    const withAccount_: RunState = await this.#withAccountIfCreated(
      withTheSecret,
      { record: input.record, handover },
      now,
    );

    // ── The authorisation, from the case's own log ────────────────────────
    //
    // Same shape as the account above, and the same reason: `state.authorisation`
    // lives in memory and this process holds none between requests. Without it a
    // student who has approved a preview is asked to approve it again on every
    // request, and the run never reaches `execute`.
    //
    // `AuthorisationCaptured` is a CASE event — a business fact, in the log that
    // holds business facts (ADR-0031, rule 3) — so the record is durable
    // already and this only reads it.
    const authorised: RunState = await this.#withAuthorisationIfCaptured(
      withAccount_,
      input.caseId,
      input.entry,
    );

    // ── And that the portal was filled ────────────────────────────────────
    //
    // The third of the same shape, and the last one this phase needs.
    // `markFilled` is memory too, so without reading the record a run whose
    // form was filled a second ago is offered to a runner again — which would
    // re-type a student's answers into a page they are already on, and press
    // save a second time.
    const state: RunState = await this.#markFilledIfDone(
      authorised,
      input.record.runId,
      input.entry,
    );

    // THE decision. Made by the orchestrator, on a pure function, from state
    // this service loaded and did not interpret.
    const step: RunStep = await nextStep(state, this.#options.model);

    return { ok: true, step, now, secret, account: state.account, state };
  }

  /**
   * Applies the account to the state when the durable record says one exists.
   *
   * Reads the intent ledger and nothing else. `assessIntent` owns the verdict —
   * including the deliberate absence of a "retry it" branch, which is what
   * stops an unverifiable half-creation becoming a second university account.
   */
  async #withAccountIfCreated(
    state: RunState,
    input: { readonly record: WorkflowRunRecord; readonly handover: HandoverEvidence },
    now: Date,
  ): Promise<RunState> {
    const runId = input.record.runId;
    const found = await this.#options.stores.runs.findIntent(
      runId,
      idempotencyKeyFor({ runId, action: "create_portal_account", target: runId }),
    );
    const verdict = assessIntent({
      ...(found?.intent === undefined ? {} : { intent: found.intent }),
      ...(found?.completed === undefined ? {} : { completed: found.completed }),
    });
    if (verdict.kind !== "already_done" || verdict.outcome !== "succeeded") return state;

    // Derived from the case, not random — the same reasoning as the run id and
    // the case id. A random account id regenerated on the next request would
    // describe a different account from the one the last request described.
    const created = accountCreated(state, {
      accountId: `acct_${runId}`,
      now,
      handover: input.handover,
    });
    return created ?? state;
  }

  /**
   * What has actually happened about handing this account back (ADR-0050).
   *
   * Three sources, and not one of them is a flag this service set:
   *
   *   the CASE LOG      which handoffs were put in front of the student, and
   *                     which they completed. Business facts, in the log that
   *                     holds business facts (ADR-0031 rule 3).
   *   the LEASE TABLE   whether a runner is still holding this run. An open
   *                     lease is a browser somewhere that can still reach the
   *                     portal, which is operational access whether or not a
   *                     credential was involved (ADR-0020 §3).
   *   the INTENT LEDGER whether every mapped page is saved.
   *
   * `askimateRetainsNoAccess` answers `false` when there is no lease store at
   * all, rather than `true`. A deployment that cannot see its leases cannot
   * see whether anything is still holding the account, and "we could not check"
   * must never read as "nothing is holding it".
   */
  async #handoverEvidence(input: {
    readonly caseId: CaseId;
    readonly record: WorkflowRunRecord;
    readonly filled: boolean;
    readonly now: Date;
  }): Promise<HandoverEvidence> {
    const events = await this.#options.stores.cases.read(input.caseId);
    const held = events.length === 0 ? null : fold(events);
    const leases = this.#options.leases;
    const openLease =
      leases === undefined ? "unknown" : await leases.held(input.record.runId, input.now);
    return {
      raised: held?.raisedHandoffs ?? [],
      completed: held?.completedHandoffs ?? [],
      askimateRetainsNoAccess: openLease === null,
      applicationFilled: input.filled,
      // ADR-0053. Read from the CASE, which is where "the student stopped" is
      // a durable fact, rather than from the run's status — the run stays
      // `running` while it winds down, because handing the account back is
      // real work it is still doing.
      runStopped: held?.state === "WINDING_DOWN" || held?.state === "CANCELLED",
    };
  }

  /**
   * The consequential action that was started and never finished, if there is
   * one.
   *
   * Returns the target AND the verdict rather than a boolean, because P10 needs
   * both: the target is what a specialist is told to look at, and the verdict
   * decides whether the run is `uncertain` (someone could establish this by
   * looking programmatically, if a verifier existed) or `escalated` (only a
   * person can). They remain identical in what this coordinator may do, which
   * is nothing — that has not changed and must not.
   */
  async #unfinishedAction(
    runId: RunId,
    kind: WorkKind,
    entry: CatalogueEntry,
  ): Promise<{ target: string; verdict: "verify_first" | "escalate" } | null> {
    // A fill has one intent PER PAGE (ADR-0047), and an unfinished one anywhere
    // stops the whole run — not just that page. Pages are ordered and a later
    // one is often unreachable until an earlier one is saved, so skipping past
    // a page whose save may or may not have landed would be acting on a portal
    // state nobody knows.
    const targets =
      kind === "execute" ? await this.#pageTargets(runId, entry) : [runId as string];
    for (const target of targets) {
      const verdict = await this.#verdictFor(runId, ACTION_FOR_WORK[kind], target);
      if (verdict.kind === "verify_first" || verdict.kind === "escalate") {
        return { target, verdict: verdict.kind };
      }
    }
    return null;
  }

  // ── ADR-0049: the case machine, driven ────────────────────────────────

  /**
   * Walks the case toward where the run has got to.
   *
   * One hop at a time along `CASE_SPINE`, each through `decide`, so
   * `checkTransition` runs on every one. This coordinator never appends a
   * `CaseStateChanged` itself — the whole point of ADR-0049 is that the
   * machine's guards are the thing deciding, not this file.
   *
   * Returns the refusal when the case CANNOT legitimately get there. That is
   * not an error to swallow: the case most likely to be refused is one
   * carrying financial evidence or involving a minor, and the refusal is the
   * guard doing exactly what it was written for.
   */
  async #advanceCase(input: {
    readonly caseId: CaseId;
    readonly conversationId: string;
    readonly step: RunStep;
    readonly state: RunState;
    readonly now: Date;
  }): Promise<{ ok: true } | { ok: false; detail: string; triggers: readonly string[] }> {
    const target = caseStateForStep(input.step);

    // Bounded, because two requests can advance one conversation at the same
    // instant and both walk the case. The loop re-reads every iteration, so a
    // lost race is not an error to surface — the winner made the hop and this
    // caller finds it already made. Bounded rather than unbounded so a genuine
    // repeated conflict fails loudly instead of spinning.
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const events = await this.#options.stores.cases.read(input.caseId);
      if (events.length === 0) return { ok: true };
      const held = fold(events);

      // The triggers first, and BEFORE the hop that is guarded on them. Raised
      // late they would be raised after the gate they exist to close.
      //
      // The `continue` is an efficiency, not the safety. Deleting it during the
      // P11 regression pass changed no test and no outcome: deciding against
      // the `held` we already have would append at a sequence the trigger write
      // has just taken, the store refuses it, and the loop re-reads anyway. The
      // guard is the sequence check; this only avoids paying for a conflict we
      // can see coming.
      const raised = await this.#raiseMandatoryTriggers(held, input);
      if (raised) continue;

      const hop = nextCaseHop(held.state, target);
      if (hop === null) return { ok: true };

      const decision = decide(held, {
        kind: "transition",
        to: hop,
        reason: reasonFor(hop),
      });
      if (!decision.accepted) {
        return {
          ok: false,
          detail: detailOf(decision.refusal),
          triggers: triggersOf(decision.refusal),
        };
      }
      try {
        await this.#appendToCase(input.caseId, held.sequence, decision.events, input, input.now);
      } catch (error: unknown) {
        // By NAME, not by class: raised in @askimate/aas-case-store, and
        // matching the constructor would couple this file to that package's
        // identity across a bundling boundary — the same reason `#decide`
        // matches `RunConcurrencyError` by name.
        if (!(error instanceof Error) || error.name !== "ConcurrencyConflictError") throw error;
      }
    }
    return { ok: true };
  }

  /**
   * Raises the mandatory review triggers this case actually carries.
   *
   * From real data or not at all. A guard that never sees a trigger passes
   * every time, and `transitions.ts` is explicit that this one is not a
   * convention: financial evidence and minors are reviewed EVERY time,
   * "regardless of confidence", and no flag changes it.
   *
   * Returns `true` when it wrote something, so the caller re-reads rather than
   * deciding against a case it has just changed.
   */
  async #raiseMandatoryTriggers(
    held: ApplicationCase,
    input: {
      readonly caseId: CaseId;
      readonly conversationId: string;
      readonly state: RunState;
      readonly now: Date;
    },
  ): Promise<boolean> {
    const wanted = mandatoryTriggersOf(input.state, input.now).filter(
      (trigger) => !held.activeTriggers.includes(trigger),
    );
    if (wanted.length === 0) return false;

    const decision = decide(held, { kind: "request_human_review", triggers: wanted });
    if (!decision.accepted) return false;
    await this.#appendToCase(input.caseId, held.sequence, decision.events, input, input.now);
    return true;
  }

  /**
   * Records a specialist's review of a case, through the domain's own intent.
   *
   * The counterpart to raising a trigger. Without it, raising one would
   * deadlock every case involving a minor or money — a worse failure than the
   * one ADR-0049 fixes — so the two ship together.
   *
   * Reached through the SAME internal plane and the same operator identity as
   * an intervention (ADR-0048 §3), deliberately: a review and an intervention
   * are both "a named human looked and said what they found", and two
   * interfaces would be two places to build the authentication that becomes a
   * release blocker the moment a second specialist exists.
   */
  public async completeReview(input: {
    readonly caseId: CaseId;
    readonly review: HumanReviewRecord;
  }): Promise<{ ok: true } | { ok: false; detail: string }> {
    const events = await this.#options.stores.cases.read(input.caseId);
    if (events.length === 0) return { ok: false, detail: `No case ${input.caseId}.` };
    const held = fold(events);
    const decision = decide(held, { kind: "complete_human_review", review: input.review });
    if (!decision.accepted) return { ok: false, detail: detailOf(decision.refusal) };
    await this.#appendToCase(
      input.caseId,
      held.sequence,
      decision.events,
      { conversationId: "", caseId: input.caseId },
      this.#options.now(),
    );
    return { ok: true };
  }

  /** Stamps and appends decided payloads. The one place case events are written. */
  async #appendToCase(
    caseId: CaseId,
    fromSequence: number,
    payloads: readonly CaseEventPayload[],
    input: { readonly conversationId: string; readonly caseId: CaseId },
    now: Date,
  ): Promise<void> {
    const stamped = stamp({
      caseId,
      fromSequence,
      payloads,
      actor: askimateActor(externalRef(input.conversationId === "" ? String(caseId) : input.conversationId)),
      now,
      nextEventId: (index) => `evt_${caseId}_${String(fromSequence + index + 1)}`,
    });
    await this.#options.stores.cases.append(caseId, fromSequence, stamped);
  }

  // ── ADR-0048: a run that stops says so, and can be picked up ───────────

  /**
   * Records that a run stopped, tells the student, and moves its status.
   *
   * Three writes, in this order and for a reason. Nothing here is transactional
   * across them — they are in two stores — so each step is written to be safe
   * to repeat, and the ORDER is chosen so that a crash between any two leaves a
   * state the next pass repairs rather than one nobody notices:
   *
   *   1. raise      idempotent per (run, stuck action). A crash after this
   *                 leaves an intervention on a run still marked `running`,
   *                 which the next poll finds and finishes.
   *   2. announce   guarded by `announcedAt`, so a crash before it leaves a
   *                 paused run the next poll still tells the student about.
   *                 This is why the flag is on the record rather than inferred
   *                 from "did we just create it".
   *   3. status     last, because it is the step that takes the run out of the
   *                 poll's reach. Doing it first would strand steps 1 and 2.
   */
  async #pause(input: {
    readonly record: WorkflowRunRecord;
    readonly entry: CatalogueEntry;
    readonly conversationId: string;
    readonly action: ConsequentialAction;
    readonly target: string;
    readonly verdict: "verify_first" | "escalate";
  }): Promise<void> {
    const interventions = this.#options.interventions;
    if (interventions === undefined) return;

    const now = this.#options.now();
    const runId = input.record.runId;
    const idempotencyKey = idempotencyKeyFor({ runId, action: input.action, target: input.target });

    const raised = await interventions.raise({
      interventionId: makeInterventionId(
        this.#options.newInterventionId?.(runId, idempotencyKey, now) ??
          `iv_${randomUUID().replace(/-/g, "")}`,
      ),
      runId,
      idempotencyKey,
      caseId: input.record.caseId,
      studentRef: input.record.studentRef,
      escalation: this.#escalationFor(input, now),
      context: {
        institutionId: makeInstitutionId(input.entry.institutionRef),
        portal: portalOf(input.entry),
        courseId: makeCourseId(input.entry.courseRef),
        blueprintVersion: blueprintVersion(input.entry.blueprint.version),
        ...(input.action === "advance_portal_page" ? { page: pageOf(input.target) } : {}),
      },
    });

    const held = await interventions.find(raised.interventionId);
    if (held !== null && held.announcedAt === undefined) {
      await this.#options.conversations.append({
        conversationId: input.conversationId,
        event: { kind: "message", actor: "assistant", content: pauseMessage(input.entry) },
      });
      await interventions.markAnnounced(raised.interventionId, now);
    }

    const status = statusForVerdict(input.verdict);
    if (input.record.status === status) return;
    // Only from `running`. A run already paused is not moved again — the
    // transition table would refuse `uncertain → uncertain` and there would be
    // nothing to gain from asking it to.
    if (input.record.status !== "running") return;
    await this.#options.stores.runs.saveCheckpoint({
      runId,
      checkpoint: input.record.checkpoint,
      expectedRevision: input.record.revision,
      status,
    });
  }

  /** What the specialist is told, in the vocabulary the system actually has. */
  #escalationFor(
    input: {
      readonly record: WorkflowRunRecord;
      readonly entry: CatalogueEntry;
      readonly action: ConsequentialAction;
      readonly target: string;
      readonly verdict: "verify_first" | "escalate";
    },
    now: Date,
  ): RecoveryEscalation {
    return {
      reason: "unverified_consequential_action",
      priority: priorityFor("unverified_consequential_action"),
      encountered:
        `A "${input.action}" was started against ${input.target} and no completion was ever ` +
        `recorded. This process cannot tell a crash BEFORE the action from a crash AFTER it, ` +
        `and it will not guess: repeating it could create a second account, or re-save a page ` +
        `a student has already had accepted.`,
      expected: `A completion recorded against the intent, one way or the other.`,
      checkpoint: {
        blueprintVersion: blueprintVersion(input.entry.blueprint.version),
        action: input.action,
        // The PAGE, not the content version. The ledger identifies the action
        // it is about; this tells a PERSON where to look, and
        // `page-application@sha256:c544…` is not somewhere anybody can look
        // (ADR-0048 §5 — a checkpoint records a position the system can
        // truthfully state, for a specialist to read).
        target: pageOf(input.target),
        phase: input.record.checkpoint.phase,
        pagesCompleted: [],
        capturedAt: now,
        ...(input.action === "advance_portal_page" ? { page: input.target } : {}),
      },
      raisedAt: now,
    };
  }

  /**
   * The hash of what this run would show the student right now, or `null`.
   *
   * A read, for a surface that has to render the preview and send the hash
   * back. It computes nothing of its own: the hash is the orchestrator's, off
   * the same `AuthorisablePreview` the step carries, so what is rendered and
   * what is authorised cannot come from two different renderings.
   */
  public async previewHashFor(runId: string, conversationId: string): Promise<string | null> {
    const bound = await this.#options.bindings.caseFor(conversationId);
    if (bound === null || bound.blueprintId === null) return null;
    const entry = await this.#options.catalogue.find(bound.blueprintId);
    const record = await this.#options.stores.runs.load(makeRunId(runId));
    if (entry === null || record === null) return null;
    const situation = await this.#situation({
      entry,
      record,
      conversationId,
      caseId: record.caseId,
      studentRef: record.studentRef,
    });
    if (!situation.ok || !awaitsStudentAuthorisation(situation.step)) return null;
    return situation.step.preview.contentHash;
  }

  /**
   * Records a decision only the student can make (ADR-0049 §5).
   *
   * The authorisation is captured through the domain's own
   * `capture_authorisation` intent, which refuses unless the case is in
   * `AWAITING_STUDENT_AUTHORISATION`. That refusal is the point: a student
   * cannot approve content the case has not legitimately reached the point of
   * showing them, and this coordinator does not get to decide otherwise.
   *
   * The hash is compared against the preview the orchestrator would render NOW.
   * A mismatch is refused rather than recorded, because an authorisation of
   * content that has since changed is exactly what `void_authorisation` and the
   * `SUBMITTING` guard exist to catch — and catching it here, before it is
   * written, is better than writing it and catching it later.
   */
  public async recordDecision(input: {
    readonly conversationId: string;
    readonly runId: string;
    readonly decision: StudentDecision;
  }): Promise<
    { readonly ok: true } | { readonly ok: false; readonly reason: DecisionRefusalReason }
  > {
    const bound = await this.#options.bindings.caseFor(input.conversationId);
    if (bound === null || bound.blueprintId === null) {
      return { ok: false, reason: "no_case" };
    }
    const entry = await this.#options.catalogue.find(bound.blueprintId);
    const record = await this.#options.stores.runs.load(makeRunId(input.runId));
    if (entry === null || record === null || record.caseId !== bound.caseId) {
      return { ok: false, reason: "no_case" };
    }

    const situation = await this.#situation({
      entry,
      record,
      conversationId: input.conversationId,
      caseId: record.caseId,
      studentRef: record.studentRef,
    });
    if (!situation.ok) return { ok: false, reason: "no_case" };

    const events = await this.#options.stores.cases.read(record.caseId);
    if (events.length === 0) return { ok: false, reason: "no_case" };
    const held = fold(events);

    // What the run is asking for, and the text it asked with. Both from the
    // orchestrator and the case — never from the decision, which carries a
    // hash and a kind and nothing else (ADR-0050).
    // ── A confirmed reading is not a case event ─────────────────────────
    //
    // It ends in the confirmed profile, through `applyConfirmation` — the one
    // minter of a `ConfirmedValue` — and in the conversation log that recorded
    // the exchange. Nothing about it belongs in the case log, so it returns
    // before `decide` is reached (ADR-0051 §5).
    if (input.decision.kind === "confirm_value") {
      return await this.#confirmValue(input.conversationId, situation.state, input.decision);
    }

    // ── A stop is answered wherever the run happens to be ────────────────
    //
    // ADR-0053. Every other decision asks "is the run at the step that was
    // waiting for this?" and refuses `not_asked` if it is not. A cancellation
    // never asks: the student did not have to be prompted to want to stop, and
    // a stop button that only worked at certain steps would not be one.
    if (input.decision.kind === "cancel") {
      return await this.#cancel(input.conversationId, record, held);
    }

    const intent =
      input.decision.kind === "authorise"
        ? this.#authorisationIntent(situation.step, input.decision)
        : this.#handoffIntent(situation.step, held, input.decision);
    if (!intent.ok) return intent;

    const decided = decide(held, intent.intent);
    if (!decided.accepted) return { ok: false, reason: "refused" };

    await this.#appendToCase(
      record.caseId,
      held.sequence,
      decided.events,
      { conversationId: input.conversationId, caseId: record.caseId },
      this.#options.now(),
    );
    return { ok: true };
  }

  /**
   * The authorisation intent, or why the decision is not one.
   *
   * The narrowing comes from the orchestrator, which owns the step vocabulary,
   * and it carries the preview out with it — so the hash is read from the step
   * the orchestrator handed over rather than dug out of it here.
   */
  #authorisationIntent(
    step: RunStep,
    decision: Extract<StudentDecision, { contentHash: string }>,
  ):
    | { readonly ok: true; readonly intent: CaseIntent }
    | { readonly ok: false; readonly reason: DecisionRefusalReason } {
    if (!awaitsStudentAuthorisation(step)) return { ok: false, reason: "not_asked" };
    if (step.preview.contentHash !== decision.contentHash) {
      return { ok: false, reason: "content_changed" };
    }
    return { ok: true, intent: { kind: "capture_authorisation", contentHash: decision.contentHash } };
  }

  /**
   * The handoff-completion intent, or why the decision is not one.
   *
   * ═══════════════════════════════════════════════════════════════════════
   * WHAT was confirmed is not in the decision and cannot be. The token comes
   * from the case's open handoff, and the hash is compared against the message
   * the orchestrator would render NOW for the step the run is standing on.
   * A client that could name the handoff could confirm a password reset the
   * student never did (ADR-0050).
   * ═══════════════════════════════════════════════════════════════════════
   *
   * The two checks are not redundant. The token says the case is waiting on
   * something; the hash says the student was looking at THAT something when
   * they pressed the button. A stale page passes the first and fails the
   * second, which is exactly the case worth catching.
   */
  #handoffIntent(
    step: RunStep,
    held: ApplicationCase,
    decision: Extract<StudentDecision, { contentHash: string }>,
  ):
    | { readonly ok: true; readonly intent: CaseIntent }
    | { readonly ok: false; readonly reason: DecisionRefusalReason } {
    const open = held.openHandoffToken;
    const asked = handoffFor(step);
    if (open === undefined || asked === null) return { ok: false, reason: "not_asked" };

    const message = handoffMessageOf(step);
    if (message === null || hashOfText(message) !== decision.contentHash) {
      return { ok: false, reason: "content_changed" };
    }
    return { ok: true, intent: { kind: "complete_handoff", handoffToken: open } };
  }

  /**
   * Records the student's agreement to a reading (ADR-0051).
   *
   * ═══════════════════════════════════════════════════════════════════════
   * The hash is compared against the OPEN PROPOSAL's playback hash, which the
   * service wrote when it put the reading to them. Not against a re-render: a
   * re-render would ask the model again and could differ from what they read,
   * and then they would have agreed to one thing and another would be stored.
   * ═══════════════════════════════════════════════════════════════════════
   *
   * The value goes in through `receiveConfirmation`, which calls
   * `applyConfirmation` — the only function that mints a `ConfirmedValue`. This
   * coordinator does not construct one and could not: the boundary check
   * forbids the cast outside `packages/profile`.
   */
  /**
   * What a cancelled case still owes the student (ADR-0053 §1).
   *
   * ── Why this is NOT `mayConclude` ────────────────────────────────────────
   *
   * `mayConclude` answers a different question and answers it correctly:
   * a HEALTHY run that has not created an account yet is not finished, so it
   * returns `may: false` with nothing named. Reusing it here would mean a
   * student who stopped during the interview — before any account existed —
   * could never conclude, and would sit in WINDING_DOWN for ever with nothing
   * outstanding to point at.
   *
   * For a cancellation the question is only "is anything owed?", and no account
   * means nothing owed. Two questions, two derivations, one source of truth
   * underneath — the account is derived by `#situation` in both.
   */
  async #outstandingObligations(input: {
    readonly record: WorkflowRunRecord;
    readonly entry: CatalogueEntry;
    readonly conversationId: string;
  }): Promise<readonly string[]> {
    const situation = await this.#situation({
      entry: input.entry,
      record: input.record,
      conversationId: input.conversationId,
      caseId: input.record.caseId,
      studentRef: input.record.studentRef,
    });
    if (!situation.ok) return [];
    const account = situation.account;
    return account === undefined ? [] : mayConcludeCase([account]).outstanding;
  }

  /** The accounts this run holds, for a message that must not claim one exists. */
  async #accountsOn(record: WorkflowRunRecord, entry: CatalogueEntry): Promise<readonly unknown[]> {
    const bound = await this.#options.bindings.conversationForCase(record.caseId);
    if (bound === null) return [];
    const situation = await this.#situation({
      entry,
      record,
      conversationId: bound,
      caseId: record.caseId,
      studentRef: record.studentRef,
    });
    return situation.ok && situation.account !== undefined ? [situation.account] : [];
  }

  /**
   * The student stopped (ADR-0053).
   *
   * ═══════════════════════════════════════════════════════════════════════
   * Three properties, and all three are the point:
   *
   *   IMMEDIATE — `cancel_case` is refused by nothing. Entering WINDING_DOWN
   *     is unguarded, and `claimWork` stops offering this run any browser work
   *     the moment the case is in it. No further consequential action.
   *   DURABLE — the fact is a case event, not a flag. It survives the request,
   *     the process and the database restart, like every other business fact
   *     in this system.
   *   IDEMPOTENT — a second cancellation of a case already winding down is
   *     refused by the transition table (WINDING_DOWN goes one place only) and
   *     answers `refused` rather than appending a second CaseCancelled.
   * ═══════════════════════════════════════════════════════════════════════
   *
   * What it does NOT do is conclude the case. That waits until nothing is owed
   * — see `#concludeCancellation`, and the guard in `checkTransition` that
   * makes the ordering a rule rather than a habit.
   */
  async #cancel(
    conversationId: string,
    record: WorkflowRunRecord,
    held: ApplicationCase,
  ): Promise<
    { readonly ok: true } | { readonly ok: false; readonly reason: DecisionRefusalReason }
  > {
    const now = this.#options.now();
    const decided = decide(held, {
      kind: "cancel_case",
      // Their own words are not available here: a decision carries a kind and
      // (for the others) a hash, and nothing else — deliberately, so a client
      // cannot put text into the case log. The conversation log holds what they
      // actually said, and this names where to find it.
      reason: `The student stopped the application in conversation ${conversationId}.`,
    });
    if (!decided.accepted) return { ok: false, reason: "refused" };

    await this.#appendToCase(
      record.caseId,
      held.sequence,
      decided.events,
      { conversationId, caseId: record.caseId },
      now,
    );

    // Told after the case has recorded it, and for the ordering reason every
    // other announcement in this driver follows: a crash between the two leaves
    // a stopped case whose student was not told, which the next pass corrects.
    // The other order would tell somebody their application had stopped when it
    // had not.
    const bound = await this.#options.bindings.caseFor(conversationId);
    const entry =
      bound?.blueprintId === undefined || bound.blueprintId === null
        ? null
        : await this.#options.catalogue.find(bound.blueprintId);
    if (entry !== null) {
      const accounts = await this.#accountsOn(record, entry);
      await this.#options.conversations.append({
        conversationId,
        event: {
          kind: "message",
          actor: "assistant",
          content: cancellationMessage(entry, accounts.length > 0),
        },
      });
    }
    return { ok: true };
  }

  async #confirmValue(
    conversationId: string,
    state: RunState,
    decision: Extract<StudentDecision, { contentHash: string }>,
  ): Promise<
    { readonly ok: true } | { readonly ok: false; readonly reason: DecisionRefusalReason }
  > {
    const events = await this.#options.conversations.since(conversationId, 0);
    const open = openProposal(events);
    if (open === null) return { ok: false, reason: "not_asked" };
    if (open.playbackHash !== decision.contentHash) {
      return { ok: false, reason: "content_changed" };
    }

    const outcome = receiveConfirmation(state.interview, { agreed: true }, this.#options.now());
    if (outcome.kind !== "confirmed") return { ok: false, reason: "refused" };

    const fieldKey = open.fieldKey as ProfileFieldKey;
    await this.#persist(outcome.state, fieldKey);
    await this.#options.conversations.append({
      conversationId,
      event: { kind: "value_confirmed", fieldKey, playbackHash: open.playbackHash },
    });
    return { ok: true };
  }

  /**
   * The hash of the message a student is being asked to confirm.
   *
   * Public because the client needs the same number to send back, and it must
   * come from the SERVICE: a client that computed its own would be hashing
   * whatever it decided to display.
   */
  public async handoffHashFor(runId: string, conversationId: string): Promise<string | null> {
    const bound = await this.#options.bindings.caseFor(conversationId);
    if (bound === null || bound.blueprintId === null) return null;
    const entry = await this.#options.catalogue.find(bound.blueprintId);
    const record = await this.#options.stores.runs.load(makeRunId(runId));
    if (entry === null || record === null || record.caseId !== bound.caseId) return null;
    const situation = await this.#situation({
      entry,
      record,
      conversationId,
      caseId: record.caseId,
      studentRef: record.studentRef,
    });
    if (!situation.ok) return null;
    const message = handoffMessageOf(situation.step);
    return message === null ? null : hashOfText(message);
  }

  /**
   * The runs the Background Worker should advance, oldest first (ADR-0052 §6).
   *
   * ═══════════════════════════════════════════════════════════════════════
   * Derived, never queued. There is no table of pending work and there must
   * never be one: the run's own status and checkpoint already say what is
   * live, and a queue here would be a second opinion able to disagree with
   * them (ADR-0041).
   * ═══════════════════════════════════════════════════════════════════════
   *
   * `running` and `suspended` — the exact set `WorkLeaseStore.candidates`
   * selects for runner work, deliberately. The worker must not hold a second
   * opinion about which runs are live.
   *
   *   `uncertain` and `escalated` wait for a PERSON by design. Advancing one
   *   would be the blind retry `assessIntent` refuses, and they leave those
   *   states when a specialist adjudicates the intent (ADR-0048).
   *   `completed` and `abandoned` are terminal.
   *
   * A run currently leased to a runner is excluded: the runner is mid-operation
   * against a real portal, and deciding underneath it would decide from a
   * position that is about to change.
   *
   * Lives here rather than in the worker so the worker holds no SQL of its own
   * — a second query answering "which runs are live" is the thing this comment
   * exists to prevent.
   */
  public async dueRuns(
    limit = 25,
  ): Promise<readonly { readonly runId: string; readonly conversationId: string }[]> {
    const leases = this.#options.leases;
    if (leases === undefined) return [];
    return await leases.dueForWorker({ now: this.#options.now(), limit });
  }

  /**
   * Tells students about interventions raised but never announced (ADR-0052 §7).
   *
   * ═══════════════════════════════════════════════════════════════════════
   * `announced_at`'s own column comment has said since P10: *"NULL means they
   * have not been, and the next pass will tell them — so a crash between
   * raising and announcing cannot leave a paused run whose student never hears
   * about it."* There was no next pass. `markAnnounced` is reached from
   * `#pause`, which is reached from `claimWork`, which only runs when a runner
   * polls — and no runner process loops. This is that pass.
   * ═══════════════════════════════════════════════════════════════════════
   *
   * The message is `pauseMessage`, the same function `#pause` uses. Composing a
   * second one in the worker would be two implementations of one conversation
   * decision, which ADR-0041 exists to prevent — and the student would be told
   * two different things depending on which path got there first.
   *
   * Idempotent by `announcedAt`: an intervention already announced is skipped,
   * so a worker crash between the message and the mark costs one repeated
   * message rather than a student who is never told.
   */
  public async announcePending(limit = 25): Promise<{ readonly announced: number }> {
    const interventions = this.#options.interventions;
    if (interventions === undefined) return { announced: 0 };

    let announced = 0;
    for (const held of (await interventions.open()).slice(0, limit)) {
      if (held.announcedAt !== undefined) continue;
      const conversationId = await this.#options.bindings.conversationForCase(held.caseId);
      if (conversationId === null) continue;
      const bound = await this.#options.bindings.caseFor(conversationId);
      if (bound === null || bound.blueprintId === null) continue;
      const entry = await this.#options.catalogue.find(bound.blueprintId);
      if (entry === null) continue;

      // Message first, mark second — the order `#pause` uses, and for the same
      // reason: a crash between them re-tells somebody, which is a much smaller
      // failure than a paused run whose student never hears.
      await this.#options.conversations.append({
        conversationId,
        event: { kind: "message", actor: "assistant", content: pauseMessage(entry) },
      });
      await interventions.markAnnounced(held.interventionId, this.#options.now());
      announced += 1;
    }
    return { announced };
  }

  /**
   * Answers a student's message by interviewing them (ADR-0051).
   *
   * ═══════════════════════════════════════════════════════════════════════
   * THE LOOP THAT WAS NEVER CLOSED.
   *
   * `applyConfirmation` and `ConfirmedProfileStore.save` had no production
   * caller before this. The orchestrator composed questions and the run driver
   * threw them away; every test seeded the profile from the test process. No
   * real student could put one field into this system.
   * ═══════════════════════════════════════════════════════════════════════
   *
   * Wired to the existing `answer` hook, on the existing message route. There
   * is no second student-facing surface, and there must never be one: a
   * separate interview endpoint is a form with an HTTP shape, which is the
   * thing ADR-0007 and ADR-0015 both refuse.
   *
   * Silent on anything that is not a student's message on a conversation with
   * a run that is asking. A student talking during a secure step, or before
   * they have started an application, is not answering an interview question.
   */
  public async answerStudent(input: {
    readonly conversationId: string;
    readonly event: ConversationEvent;
  }): Promise<void> {
    const said = input.event;
    if (said.kind !== "message" || said.actor !== "student" || said.content === null) return;

    const situated = await this.#interviewSituation(input.conversationId);
    if (situated === null) return;
    const now = this.#options.now();

    // ── A pending reading makes this a CORRECTION, not a new answer ──────
    //
    // "no, it's the 3rd" is not agreement and is not a fresh field. It goes
    // through `receiveConfirmation`'s corrected branch, which produces a new
    // proposal that must itself be confirmed — a correction is never a
    // confirmation of something else.
    const open = openProposal(await this.#options.conversations.since(input.conversationId, 0));
    if (open !== null) {
      await this.#correct(input.conversationId, situated.state.interview, said.content, now);
      return;
    }

    const asking = interviewAsk(situated.step);
    if (asking === null) return;

    const outcome = await receiveAnswer(
      situated.state.interview,
      asking,
      said.content,
      this.#options.model,
    );
    if (outcome.kind !== "understood") {
      // Not read at all. The next decide re-asks — `nextAction` composes a
      // fresh question with the attempt count it can see. Nothing is written,
      // because nothing was understood.
      return;
    }
    await this.#putToTheStudent(input.conversationId, outcome.state);
  }

  /**
   * Everything `answerStudent` and `recordDecision` need about a conversation,
   * or `null` when it is not in an interview at all.
   */
  async #interviewSituation(conversationId: string): Promise<{
    readonly entry: CatalogueEntry;
    readonly record: WorkflowRunRecord;
    readonly state: RunState;
    readonly step: RunStep;
  } | null> {
    const bound = await this.#options.bindings.caseFor(conversationId);
    if (bound === null || bound.blueprintId === null) return null;
    const entry = await this.#options.catalogue.find(bound.blueprintId);
    if (entry === null) return null;
    // The conversation's own run. A conversation owns at most one case and a
    // case at most one run, so the first is the only.
    const runs = await this.#options.stores.runs.findByCase(makeCaseId(bound.caseId));
    const record = runs[0];
    if (record === undefined) return null;
    const situation = await this.#situation({
      entry,
      record,
      conversationId,
      caseId: record.caseId,
      studentRef: record.studentRef,
    });
    if (!situation.ok) return null;
    return { entry, record, state: situation.state, step: situation.step };
  }

  /**
   * Puts a reading to the student, deterministically.
   *
   * Two writes: the structured proposal, so the confirmation can apply exactly
   * what was shown, and the playback message, which is what they read. In that
   * order, so a crash between them leaves a proposal with no playback — which
   * the next decide re-plays rather than a playback nothing can confirm.
   */
  async #putToTheStudent(conversationId: string, state: InterviewState): Promise<void> {
    const pending = state.pending;
    if (pending === undefined) return;
    const action = await nextAction(state, this.#options.model);
    if (action.kind !== "confirm") return;

    await this.#options.conversations.append({
      conversationId,
      event: {
        kind: "value_proposed",
        fieldKey: pending.fieldKey,
        proposal: pending.proposed,
        playbackHash: hashOfText(action.say),
      },
    });
    await this.#options.conversations.append({
      conversationId,
      event: { kind: "message", actor: "assistant", content: action.say },
    });
  }

  /** The student said the reading was wrong. Their words are the correction. */
  async #correct(
    conversationId: string,
    state: InterviewState,
    correction: string,
    now: Date,
  ): Promise<void> {
    const pending = state.pending;
    if (pending === undefined) return;
    const outcome = receiveConfirmation(state, { agreed: false, correction }, now);
    // The old reading is closed either way: it was put to them and they did
    // not agree to it. What happens next depends on whether the correction
    // could be read.
    await this.#options.conversations.append({
      conversationId,
      event: { kind: "value_rejected", fieldKey: pending.fieldKey },
    });
    if (outcome.kind !== "corrected") return;

    // A corrected value IS confirmed — the student supplied it themselves —
    // so it is already in `outcome.state.profile`. Persist it and say so.
    await this.#persist(outcome.state, pending.fieldKey);
    await this.#options.conversations.append({
      conversationId,
      event: {
        kind: "value_confirmed",
        fieldKey: pending.fieldKey,
        playbackHash: hashOfText(correction),
      },
    });
  }

  /** Writes one confirmed field through the sanctioned store. */
  async #persist(state: InterviewState, fieldKey: ProfileFieldKey): Promise<void> {
    const entry = state.profile.entries.get(fieldKey);
    if (entry === undefined) return;
    await this.#options.profiles.save(state.studentRef, toStoredEntry(fieldKey, entry));
  }

  /**
   * May this case finish? (ADR-0020 §4, ADR-0050.)
   *
   * ═══════════════════════════════════════════════════════════════════════
   * `mayConcludeCase` has existed since the account model was written and
   * NOTHING HAS EVER CALLED IT. It could not be: it takes the accounts on a
   * case, and no account could reach `handed_over` because nothing moved an
   * account's stage at all. This is the first caller, and it is the whole
   * point of the phase — the rule that makes handover non-optional is only a
   * rule once something asks it.
   * ═══════════════════════════════════════════════════════════════════════
   *
   * It asks the ACCOUNT THE RUN DERIVES, not a stored one, so the answer comes
   * from the same evidence every other decision about this run comes from: the
   * intent ledger, the case log, the confirmed profile and the reviewed portal
   * observations. There is no second record to disagree with.
   *
   * `may: false` with an empty `outstanding` means there is no account at all —
   * a run that has not got that far, or a portal that needs none. Those are
   * different from an account that is outstanding, and the caller can tell.
   */
  public async mayConclude(
    runId: string,
    conversationId: string,
  ): Promise<{ readonly may: boolean; readonly outstanding: readonly string[] }> {
    const bound = await this.#options.bindings.caseFor(conversationId);
    if (bound === null || bound.blueprintId === null) return { may: false, outstanding: [] };
    const entry = await this.#options.catalogue.find(bound.blueprintId);
    const record = await this.#options.stores.runs.load(makeRunId(runId));
    if (entry === null || record === null || record.caseId !== bound.caseId) {
      return { may: false, outstanding: [] };
    }
    const situation = await this.#situation({
      entry,
      record,
      conversationId,
      caseId: record.caseId,
      studentRef: record.studentRef,
    });
    if (!situation.ok) return { may: false, outstanding: [] };
    const account = situation.account;
    // No account is not the same as an account that is fine. A portal that
    // needs none is `not_required` and `mayConcludeCase` says so; a run that
    // has not created one yet has nothing to ask about.
    return account === undefined ? { may: false, outstanding: [] } : mayConcludeCase([account]);
  }

  /**
   * Stops a run whose case cannot legitimately reach the student.
   *
   * Reuses P10's machinery exactly (ADR-0048): an intervention a specialist can
   * pick up, one honest message to the student, and a durable status. It is
   * `escalated` rather than `uncertain` — nothing is uncertain here, and no
   * amount of looking at the portal would settle it. A person has to review the
   * case, which is a different job from establishing what happened.
   */
  async #pauseForReview(input: {
    readonly entry: CatalogueEntry;
    readonly record: Awaited<ReturnType<WorkflowRunStore["start"]>>;
    readonly conversationId: string;
    readonly caseId: CaseId;
    readonly step: RunStep;
    readonly detail: string;
    readonly triggers: readonly string[];
    readonly now: Date;
  }): Promise<RunOutcome> {
    const interventions = this.#options.interventions;
    const runId = input.record.runId;

    if (interventions !== undefined) {
      const idempotencyKey = idempotencyKeyFor({
        runId,
        action: "advance_portal_page",
        target: `review:${input.triggers.join(",")}`,
      });
      const raised = await interventions.raise({
        interventionId: makeInterventionId(
          this.#options.newInterventionId?.(runId, idempotencyKey, input.now) ??
            `iv_${randomUUID().replace(/-/g, "")}`,
        ),
        runId,
        idempotencyKey,
        caseId: input.caseId,
        studentRef: input.record.studentRef,
        escalation: {
          reason: "information_unobtainable",
          priority: "critical",
          encountered: input.detail,
          expected:
            `An approving human review recorded against every mandatory trigger, before the ` +
            `student is asked to authorise anything.`,
          checkpoint: {
            blueprintVersion: blueprintVersion(input.entry.blueprint.version),
            action: "advance_portal_page",
            target: `review:${input.triggers.join(",")}`,
            phase: input.record.checkpoint.phase,
            pagesCompleted: [],
            capturedAt: input.now,
          },
          raisedAt: input.now,
        },
        context: {
          institutionId: makeInstitutionId(input.entry.institutionRef),
          portal: portalOf(input.entry),
          courseId: makeCourseId(input.entry.courseRef),
          blueprintVersion: blueprintVersion(input.entry.blueprint.version),
        },
      });
      const held = await interventions.find(raised.interventionId);
      if (held !== null && held.announcedAt === undefined) {
        await this.#options.conversations.append({
          conversationId: input.conversationId,
          event: {
            kind: "message",
            actor: "assistant",
            content: reviewMessage(input.entry),
          },
        });
        await interventions.markAnnounced(raised.interventionId, input.now);
      }
      if (input.record.status === "running") {
        await this.#options.stores.runs.saveCheckpoint({
          runId,
          checkpoint: input.record.checkpoint,
          expectedRevision: input.record.revision,
          status: "escalated",
        });
      }
    }

    return {
      ok: true,
      position: {
        runId,
        caseId: input.caseId,
        conversationId: input.conversationId,
        status: "escalated",
        phase: input.record.checkpoint.phase,
        step: input.step.kind,
        revision: input.record.revision,
        resumed: false,
        concerns: [],
      },
    };
  }

  /** Every intervention waiting for a specialist, oldest first. */
  public async openInterventions(): Promise<readonly StoredIntervention[]> {
    return (await this.#options.interventions?.open()) ?? [];
  }

  /**
   * Records a specialist's adjudication, and lets the run continue.
   *
   * The order is the mirror of `#pause`, and again chosen so a crash repairs:
   *
   *   1. resolve   the adjudication. Refuses a second one rather than
   *                overwriting — two specialists disagreeing is evidence.
   *   2. complete  THE FACT. `did it happen` becomes an outcome in the intent
   *                ledger, which is what actually un-sticks the run: the next
   *                `assessIntent` returns `already_done` instead of
   *                `verify_first`, with no code anywhere saying "resume".
   *   3. status    back to `running`, so the poll can see it again.
   *
   * Note what step 2 does NOT do: it sets no position. Where the run picks up
   * falls out of the ledger — `#nextPage` returns the first page with no
   * successful intent — which is why a resolution carries no cursor and why
   * ADR-0048 §5 could remove the one an earlier draft proposed.
   */
  public async resolveIntervention(input: {
    readonly interventionId: InterventionId;
    readonly resolution: RecoveryResolution;
    readonly reusability: ReusabilityAssessment;
    /** What the specialist established: did the action happen? */
    readonly didHappen: boolean;
  }): Promise<StoredIntervention> {
    const interventions = this.#options.interventions;
    if (interventions === undefined) {
      throw new InterventionNotFoundError(input.interventionId);
    }
    const held = await interventions.find(input.interventionId);
    if (held === null) throw new InterventionNotFoundError(input.interventionId);

    const resolved = await interventions.resolve({
      interventionId: input.interventionId,
      resolution: input.resolution,
      reusability: input.reusability,
    });

    // ── The fact, in the one place that holds facts ────────────────────
    //
    // `succeeded` when the specialist found the action HAD landed, so the run
    // moves past it. `failed_cleanly` when they established it had not — which
    // is not "try again now": `assessIntent` returns `already_done` for both,
    // and there is deliberately no verdict meaning retry. A run whose account
    // creation cleanly did not happen needs a new attempt somebody decides to
    // make, not one this code makes on their behalf.
    await this.#options.stores.runs.completeIntent(
      held.runId,
      held.idempotencyKey,
      input.didHappen ? "succeeded" : "failed_cleanly",
      input.resolution.resolvedAt,
    );

    const record = await this.#options.stores.runs.load(held.runId);
    if (record !== null && record.status !== "running") {
      const next: WorkflowStatus = input.resolution.outcome === "abandon" ? "abandoned" : "running";
      await this.#options.stores.runs.saveCheckpoint({
        runId: held.runId,
        checkpoint: record.checkpoint,
        expectedRevision: record.revision,
        status: next,
      });
    }

    // Told last, and only for a run that will actually continue. A student who
    // hears "it is moving again" about an abandoned application has been
    // misled, which is worse than not being told at all.
    if (input.resolution.outcome !== "abandon") {
      await this.#announceResumed(held);
    }
    return resolved;
  }

  /**
   * Voids an authorisation the content has outgrown, and puts the case back.
   *
   * Idempotent by construction: once voided, `fold` clears
   * `authorisedContentHash`, so a second pass finds nothing to void and
   * `decide` refuses — which is why the refusal is not an error here.
   */
  async #voidOutgrownAuthorisation(
    caseId: CaseId,
    conversationId: string,
    step: RunStep,
    now: Date,
  ): Promise<void> {
    if (!awaitsStudentAuthorisation(step)) return;
    const events = await this.#options.stores.cases.read(caseId);
    if (events.length === 0) return;
    const held = fold(events);
    if (held.authorisedContentHash === undefined) return;

    const decision = decide(held, { kind: "void_authorisation", reason: "content_changed" });
    if (!decision.accepted) return;
    await this.#appendToCase(caseId, held.sequence, decision.events, { conversationId, caseId }, now);
  }

  /**
   * Raises the handoff this step is waiting on, and tells the student once.
   *
   * ═══════════════════════════════════════════════════════════════════════
   * The system CANNOT do these things and will never be able to. It has no
   * capability to read a mailbox — not a disabled one, none (ADR-0020 §5) — so
   * a verification link, a reset email and "can you actually sign in?" all end
   * the same way: the run asks and waits. This is the asking.
   * ═══════════════════════════════════════════════════════════════════════
   *
   * Two writes, in this order and for the same reason `#pause` orders its
   * three: the case event is idempotent by token, so a crash between them
   * leaves a raised handoff the next decide re-raises as a no-op and re-tells
   * the student about. Telling somebody twice is a much smaller failure than a
   * run that waits forever on something nobody asked for.
   *
   * The message is appended only when the raise CREATED the handoff — `decide`
   * answers with no events when the token is already open, and that is what
   * makes the poll silent.
   */
  async #raiseHandoff(input: {
    readonly caseId: CaseId;
    readonly conversationId: string;
    readonly step: RunStep;
    readonly now: Date;
  }): Promise<void> {
    const kind = handoffFor(input.step);
    if (kind === null) return;

    const events = await this.#options.stores.cases.read(input.caseId);
    if (events.length === 0) return;
    const held = fold(events);
    const decision = decide(held, {
      kind: "require_handoff",
      handoffKind: kind,
      handoffToken: handoffTokenFor({ caseId: input.caseId, kind }),
      // The handoff does not expire in this phase. A student who has not
      // followed a verification link in a week has not lost the right to; what
      // an expiry would buy is a way to stop asking, and stopping asking is a
      // product decision nobody has made. The field is required by the event,
      // so it carries a date far enough out to be obviously not a deadline.
      expiresAt: new Date(input.now.getTime() + NEVER_MIND_THE_CLOCK_MS),
      });
    if (!decision.accepted || decision.events.length === 0) return;

    await this.#appendToCase(input.caseId, held.sequence, decision.events, input, input.now);

    const message = handoffMessageOf(input.step);
    if (message === null) return;
    await this.#options.conversations.append({
      conversationId: input.conversationId,
      event: { kind: "message", actor: "assistant", content: message },
    });
  }

  /** Tells the student their run is moving again, when there is one to tell. */
  async #announceResumed(held: StoredIntervention): Promise<void> {
    const conversationId = await this.#options.bindings.conversationForCase(held.caseId);
    if (conversationId === null) return;
    const bound = await this.#options.bindings.caseFor(conversationId);
    if (bound === null || bound.blueprintId === null) return;
    const entry = await this.#options.catalogue.find(bound.blueprintId);
    if (entry === null) return;
    await this.#options.conversations.append({
      conversationId,
      event: { kind: "message", actor: "assistant", content: resumeMessage(entry) },
    });
  }

  /** What the ledger says about one consequential action on one target. */
  async #verdictFor(
    runId: RunId,
    action: ConsequentialAction,
    target: string,
  ): Promise<ReturnType<typeof assessIntent>> {
    const found = await this.#options.stores.runs.findIntent(
      runId,
      idempotencyKeyFor({ runId, action, target }),
    );
    return assessIntent({
      ...(found?.intent === undefined ? {} : { intent: found.intent }),
      ...(found?.completed === undefined ? {} : { completed: found.completed }),
    });
  }

  /**
   * Every page's CURRENT content target, in blueprint order (ADR-0051 §6).
   *
   * Built from the plan the run has now. A page whose content changed since it
   * was filled therefore has a target with no successful intent — which is how
   * a stale page becomes visible at all, and why an unfinished-action check
   * that used bare page refs could not see one.
   */
  async #pageTargets(runId: RunId, entry: CatalogueEntry): Promise<readonly string[]> {
    const usable = checkUsable(entry.mappingSet, entry.blueprint);
    if (!usable.usable) return [];
    const profile = await this.#options.profiles.load(
      // The run's own student. `findByCase` is not needed: the ledger is keyed
      // by run and the plan by profile, and both belong to the same student.
      (await this.#options.stores.runs.load(runId))?.studentRef ?? "",
      this.#options.now(),
    );
    const plan = planFill(entry.blueprint, usable.mappingSet, profile);
    return entry.blueprint.pages.map((page) =>
      pageFillTarget({
        pageRef: page.pageRef,
        values: pageValuesOf(
          plan,
          new Set(page.sections.flatMap((s) => s.fields.map((f) => f.fieldRef))),
        ),
      }),
    );
  }

  /**
   * The page this run should fill next, or `null` because none remains.
   *
   * ADR-0047. The first page in BLUEPRINT order that has fields to fill, has no
   * credential field, and has no successful `advance_portal_page` intent.
   *
   * One derivation, used twice: `claimWork` asks it what to hand out, and
   * `#markFilledIfDone` asks it whether anything is left. A counter would be a
   * second answer to the same question, able to disagree with the ledger.
   */
  async #nextPage(
    runId: RunId,
    entry: CatalogueEntry,
    plan: FillPlan,
  ): Promise<ApplicationBlueprint["pages"][number] | null> {
    const wanted = new Set(plan.instructions.map((instruction) => instruction.fieldRef));
    const credentialFields = new Set(plan.credentials.map((credential) => credential.fieldRef));

    for (const page of entry.blueprint.pages) {
      const fields = page.sections.flatMap((section) => section.fields);
      // A page with a credential field is a registration page: the Secure Plane
      // filled the password and account creation submitted it, so it is done
      // before `execute` is ever reached and is not the fill's to do.
      if (fields.some((field) => credentialFields.has(field.fieldRef))) continue;
      if (!fields.some((field) => wanted.has(field.fieldRef))) continue;

      const verdict = await this.#verdictFor(
        runId,
        "advance_portal_page",
        pageFillTarget({
          pageRef: page.pageRef,
          values: pageValuesOf(plan, new Set(fields.map((f) => f.fieldRef))),
        }),
      );
      // `failed_cleanly` is a claim that nothing happened out there, so the page
      // is offered again. `already_done` + `succeeded` is skipped. The unfinished
      // verdicts never reach here — `#unfinishedAction` stopped the run.
      if (verdict.kind === "already_done" && verdict.outcome === "succeeded") continue;
      return page;
    }
    return null;
  }

  /**
   * Applies the student's authorisation when the case log records one.
   *
   * The LATEST one wins, and a voided one does not count: `AuthorisationVoided`
   * exists because content that changed after approval is content nobody
   * approved, and treating a voided authorisation as live would fill a form
   * with values the student never saw.
   */
  async #withAuthorisationIfCaptured(
    state: RunState,
    caseId: CaseId,
    entry: CatalogueEntry,
  ): Promise<RunState> {
    const events = await this.#options.stores.cases.read(caseId);
    let captured: { contentHash: string; authorisedAt: Date } | null = null;
    for (const event of events) {
      if (event.type === "AuthorisationCaptured") {
        captured = { contentHash: event.contentHash, authorisedAt: event.authorisedAt };
        continue;
      }
      if (event.type === "AuthorisationVoided" && captured?.contentHash === event.previousContentHash) {
        captured = null;
      }
    }
    if (captured === null) return state;

    return withAuthorisation(state, {
      authorisationId: `auth_${caseId}`,
      caseId,
      studentRef: state.inputs.studentRef,
      contentHash: captured.contentHash,
      hashAlgorithm: "sha256",
      // Not stored on the event and not invented here. The preview's text is
      // shown to the student by the conversation surface and is not a fact this
      // coordinator holds; what makes the authorisation binding is the CONTENT
      // HASH, which is on the event and is compared against the plan.
      presentedText: "",
      blueprintId: entry.blueprint.blueprintId,
      blueprintVersion: entry.blueprint.version,
      mappingSetId: entry.mappingSet.mappingSetId,
      authorisedAt: captured.authorisedAt,
    });
  }

  /**
   * Marks the run filled when the durable record says the page was saved.
   *
   * `advance_portal_page` is the consequential action a fill performs, and its
   * completion is the only durable evidence that the portal kept anything.
   * `verify_first` and `escalate` are deliberately NOT treated as filled: an
   * action that may or may not have landed is not one to build on, and
   * `claimWork` refuses to re-offer it for the same reason.
   */
  async #markFilledIfDone(
    state: RunState,
    runId: RunId,
    entry: CatalogueEntry,
  ): Promise<RunState> {
    // Filled means EVERY page is saved, which is the same question `#nextPage`
    // answers with `null`. Asked of the plan the run actually has, so a plan
    // that grew a page — a corrected answer that made another field mappable —
    // un-fills the run rather than leaving it claiming to be done.
    return (await this.#hasFilled(state, runId, entry)) ? markFilled(state) : state;
  }

  /**
   * Whether every mapped page of this run is saved.
   *
   * Split out of `#markFilledIfDone` because TWO things need the answer and
   * only one of them can read it off the state: the account's stage depends on
   * whether the application is done (ADR-0050), and `withAuthorisation` clears
   * `state.filled` — so by the time the flag exists, the account has already
   * been derived without it.
   */
  async #hasFilled(state: RunState, runId: RunId, entry: CatalogueEntry): Promise<boolean> {
    // Filled means EVERY page is saved, which is the same question `#nextPage`
    // answers with `null`.
    const usable = checkUsable(entry.mappingSet, entry.blueprint);
    if (!usable.usable) return false;
    const plan = planFill(entry.blueprint, usable.mappingSet, state.profile);
    if ((await this.#nextPage(runId, entry, plan)) !== null) return false;

    // Nothing left to fill — but "nothing left" is also true of a run that
    // never had a fillable page. `markFilled` only means something once at
    // least one page has actually been saved.
    const saved = await Promise.all(
      entry.blueprint.pages.map(async (page) =>
        this.#verdictFor(
          runId,
          "advance_portal_page",
          pageFillTarget({
            pageRef: page.pageRef,
            values: pageValuesOf(
              plan,
              new Set(page.sections.flatMap((section) => section.fields.map((f) => f.fieldRef))),
            ),
          }),
        ),
      ),
    );
    return saved.some(
      (verdict) => verdict.kind === "already_done" && verdict.outcome === "succeeded",
    );
  }

  /**
   * What a stopped case does instead of advancing (ADR-0053).
   *
   * ═══════════════════════════════════════════════════════════════════════
   * `null` means "this case is not stopped, carry on". Anything else is the
   * whole of what a stopped case does, and it is deliberately short:
   *
   *   - it does not walk the spine — `nextCaseHop` is never reached;
   *   - it does not open a secure step, raise a handoff for anything new, or
   *     void an outgrown authorisation;
   *   - it DOES let the outstanding account handover finish, because ADR-0050
   *     made that non-optional and stopping must not become a way around it;
   *   - it concludes, once nothing is owed.
   * ═══════════════════════════════════════════════════════════════════════
   *
   * The handover itself still runs through the ordinary machinery below —
   * `#raiseHandoff` and the student's `confirm_handoff` — because a cancelled
   * student getting their account back is the same act as any other student
   * getting theirs back. What changes is that nothing ELSE happens.
   */
  async #windDown(
    input: {
      readonly entry: CatalogueEntry;
      readonly conversationId: string;
      readonly caseId: CaseId;
      readonly record: Awaited<ReturnType<WorkflowRunStore["start"]>>;
    },
    situation: { readonly state: RunState; readonly step: RunStep; readonly now: Date },
  ): Promise<RunOutcome | null> {
    const stoppedAt = (status: WorkflowStatus): RunOutcome => ({
      ok: true,
      position: {
        runId: input.record.runId,
        caseId: input.caseId,
        conversationId: input.conversationId,
        status,
        phase: input.record.checkpoint.phase,
        step: situation.step.kind,
        revision: input.record.revision,
        resumed: false,
        concerns: [],
      },
    });

    const events = await this.#options.stores.cases.read(input.caseId);
    if (events.length === 0) return null;
    const held = fold(events);
    if (held.state !== "WINDING_DOWN") {
      // A concluded cancellation stops here too, and says so rather than
      // pretending the run is still going anywhere.
      return held.state === "CANCELLED" ? stoppedAt("abandoned") : null;
    }

    const outstanding = await this.#outstandingObligations({
      record: input.record,
      entry: input.entry,
      conversationId: input.conversationId,
    });

    if (outstanding.length > 0) {
      // `situation.step` is already the account's — `#situation` substitutes
      // it for a stopped run, so every reader agrees about what is left.
      await this.#raiseHandoff({
        caseId: input.caseId,
        conversationId: input.conversationId,
        step: situation.step,
        now: situation.now,
      });
      return stoppedAt(input.record.status);
    }

    // Nothing owed. The guard in `checkTransition` agrees, and this is the
    // first terminal state this system has ever been able to reach.
    const decided = decide(held, {
      kind: "transition",
      to: "CANCELLED",
      reason: "The student stopped it, and nothing is outstanding.",
    });
    if (decided.accepted) {
      await this.#appendToCase(
        input.caseId,
        held.sequence,
        decided.events,
        { conversationId: input.conversationId, caseId: input.caseId },
        situation.now,
      );
      // The run is `abandoned` only now. Leaving it `running` while winding
      // down is the honest word: the automation IS still working, on the one
      // thing it still owes. There is no "winding down" run status and this
      // does not invent one — the CASE log says why, which is where the reason
      // belongs.
      await this.#options.stores.runs.saveCheckpoint({
        runId: input.record.runId,
        checkpoint: input.record.checkpoint,
        expectedRevision: input.record.revision,
        status: "abandoned",
      });
    }
    return stoppedAt("abandoned");
  }

  async #decideOnce(input: {
    readonly entry: CatalogueEntry;
    readonly record: Awaited<ReturnType<WorkflowRunStore["start"]>>;
    readonly conversationId: string;
    readonly caseId: CaseId;
    readonly studentRef: StudentId;
    readonly concerns: readonly ResumeConcern[];
    readonly resumed: boolean;
  }): Promise<RunOutcome> {
    const situation = await this.#situation(input);
    if (!situation.ok) return situation;
    const { step, now } = situation;

    // ── A stopped case does not walk the spine ───────────────────────────
    //
    // ADR-0053. Before anything else, because everything below this line is
    // "what should this case do next" and a cancelled case's answer is
    // "nothing new". The only thing left is to finish what is owed, and to
    // conclude once it is.
    const stopped = await this.#windDown(input, situation);
    if (stopped !== null) return stopped;

    // ── The one place a student is asked for a password ──────────────────
    //
    // Only when the orchestrator asks, and only when the log does not already
    // hold a live request. The driver decides NOTHING about whether to ask —
    // `secretStepFor` has three refusals of its own and this is downstream of
    // all of them.
    //
    // Under the conversation's row lock, and the log is re-read INSIDE it. The
    // read above fed `withSecret` and the decision; this one decides whether to
    // ask, and it has to be the one that cannot be stale. Two callers advancing
    // the same conversation can both hold a valid run revision — the second
    // loads the record after the first has checkpointed, so the optimistic lock
    // never fires — and would otherwise both find an empty log and both ask.
    if (requiresSecureRequest(step)) {
      const opened = await this.#options.bindings.withConversationLock(
        input.conversationId,
        async (): Promise<RunOutcome | null> => {
          const live = latestSecretRequest(
            await this.#options.conversations.since(input.conversationId, 0),
          );
          if (live !== null && !isSettled(live.lifecycle)) return null;
          return await this.#openSecureStep(input, step);
        },
      );
      if (opened !== null) return opened;
    }

    // ── The case walks to where the run has got to (ADR-0049) ────────────
    //
    // AFTER the secure step and before the checkpoint, so that a run which
    // REFUSED has not moved its case. `#openSecureStep` answers `null` when it
    // opened the step and a refusal when it could not reach the Secure Plane;
    // on that refusal `#decideOnce` returns here, and the case is left where
    // the run actually is. Walking first would record a hop for a run that got
    // nowhere — the case state is a claim about the real world, and a run that
    // could not ask for a password has made none of the progress the hop would
    // assert.
    //
    // In `#decideOnce` rather than `#situation`, because this is the path that
    // ADVANCES a run — `#situation` is also how the claim path LOOKS, and a
    // look that moved a case state would make polling a mutation.
    //
    // The refusal is not swallowed. The case most likely to be refused is one
    // carrying financial evidence or a minor, and that refusal is the guard in
    // `transitions.ts` doing what it says: reviewed every time, and confidence
    // does not override it. The run then stops the way P10 stops one.
    const walked = await this.#advanceCase({
      caseId: input.caseId,
      conversationId: input.conversationId,
      step,
      state: situation.state,
      now,
    });
    if (!walked.ok) {
      return await this.#pauseForReview({
        ...input,
        step,
        detail: walked.detail,
        triggers: walked.triggers,
        now,
      });
    }

    // ── An approval the content outgrew (ADR-0051 §7) ────────────────────
    //
    // The run is standing at `authorise` while the case still holds one. The
    // orchestrator decided that — `stillCovers` is its function, and this
    // coordinator only observes the step it was handed. Voiding is what puts
    // the case back where a corrected preview can be approved; without it the
    // student is refused forever, because `capture_authorisation` requires
    // AWAITING_STUDENT_AUTHORISATION and the spine cannot walk backwards.
    await this.#voidOutgrownAuthorisation(input.caseId, input.conversationId, step, now);

    // ── The one thing only the student can do (ADR-0050) ─────────────────
    //
    // AFTER the case walk, so the handoff is raised on a case that has reached
    // the state it belongs in, and after the secure step for the same reason
    // the walk is. Raising is idempotent by token, so the ordinary case — a
    // poll of a run already waiting on the student — writes nothing.
    await this.#raiseHandoff({
      caseId: input.caseId,
      conversationId: input.conversationId,
      step,
      now,
    });

    const revision = await checkpointAfter({
      stores: this.#options.stores,
      record: input.record,
      step,
      now,
    });

    return {
      ok: true,
      position: {
        runId: input.record.runId,
        caseId: input.caseId,
        conversationId: input.conversationId,
        status: input.record.status,
        // Read back from the store rather than recomputed here: the checkpoint
        // that was WRITTEN is the one to report, and `deriveCheckpoint` owns
        // what it contains.
        phase:
          (await this.#options.stores.runs.load(input.record.runId))?.checkpoint.phase ??
          input.record.checkpoint.phase,
        step: step.kind,
        revision,
        resumed: input.resumed,
        concerns: input.concerns,
      },
    };
  }
  /**
   * Opens a secure step and records it in the conversation's own log.
   *
   * Returns a refusal when the plane is unreachable, and `null` when the step
   * was opened — the caller then reports the position `nextStep` already
   * decided, which is `request_secret` either way.
   */
  async #openSecureStep(
    input: {
      readonly entry: CatalogueEntry;
      readonly conversationId: string;
      readonly caseId: CaseId;
      readonly studentRef: StudentId;
    },
    step: Extract<RunStep, { kind: "request_secret" }>,
  ): Promise<RunOutcome | null> {
    const opener = this.#options.secureRequests;
    if (opener === undefined) {
      return { ok: false, refusal: { kind: "secure_plane_unavailable" } };
    }

    // Narrowed, not cast. See `purpose_not_supported` above for the drift this
    // guards, and `scripts/contract-drift.test.ts` for the assertion that keeps
    // both closed sets honest about it.
    // Compared as a string, deliberately. TypeScript knows the two unions do
    // not overlap on `portal_sign_in` and would call the check unintentional —
    // which is exactly the drift being guarded, and a compile error here would
    // mean deleting the guard rather than fixing the drift.
    const purpose: string = step.request.purpose;
    if (purpose !== "portal_account_creation" && purpose !== "portal_password_reset") {
      return { ok: false, refusal: { kind: "purpose_not_supported" } };
    }

    const opened = await opener.open({
      studentRef: input.studentRef,
      conversationId: input.conversationId,
      caseRef: input.caseId,
      purpose,
      // The DEPLOYED host, for the same reason the work item carries it: the
      // handle is bound at this host and the fill agent checks the live page
      // against it. Opening against the blueprint's host and then typing into
      // a sandbox would be refused by the agent — correctly, and much later.
      targetHost: deployedHost(input.entry, step.request.target.host) ?? step.request.target.host,
      // Read inside the FRAME, on the secure origin, and stored there. The
      // contract does not return either of them, so no text about a password
      // reaches this plane's log.
      title: `Choose a password for ${input.entry.blueprint.institutionName}`,
      explanation: step.request.explanation,
      ttlSeconds: step.request.ttlSeconds,
    });
    if (opened === null) {
      return { ok: false, refusal: { kind: "secure_plane_unavailable" } };
    }

    // The authoritative event. Four fields, and none of them is text: an id,
    // the channel, and when it lapses. The frame token is NOT among them — a
    // one-time capability at rest in a durable log is a capability that
    // outlives the page it was minted for.
    await this.#options.conversations.append({
      conversationId: input.conversationId,
      event: {
        kind: "secret_requested",
        requestId: opened.requestId,
        channel: "secure_control",
        expiresAt: opened.expiresAt,
      },
    });
    return null;
  }

  // ── ADR-0045: the work the Automation Runner pulls ─────────────────────

  /**
   * Leases one unit of browser work to a runner, or answers `null`.
   *
   * ═══════════════════════════════════════════════════════════════════════
   * `null` is the ordinary answer. Most polls find nothing, because most runs
   * at any instant are waiting for a student rather than for a browser — and
   * that is why it is `null` rather than a refusal: "there is no work" is not
   * a failure and must not be logged, retried or alerted on as one.
   * ═══════════════════════════════════════════════════════════════════════
   *
   * ── The order of the three questions ──────────────────────────────────
   *
   *  1. Which runs MIGHT need a browser? — the durable checkpoint's phase,
   *     narrowing cheaply, because deriving `nextStep` for every run in the
   *     database would load a blueprint, a mapping set and a profile per row.
   *  2. What does the orchestrator actually say? — `#situation`, the same
   *     path the decide route takes. The phase is a hint; this is the answer.
   *  3. Can this runner have it? — the lease, decided by the database.
   *
   * Two and three in that order, deliberately. Taking the lease first would
   * mean holding a run while asking a question that usually answers "no", and
   * a poll that leased and released every candidate would keep the pool
   * churning through runs it was never going to work.
   */
  public async claimWork(input: {
    readonly holder: string;
    readonly leaseSeconds: number;
    readonly limit?: number;
  }): Promise<ClaimedWork | null> {
    const leases = this.#options.leases;
    if (leases === undefined) return null;

    const now = this.#options.now();
    const candidates = await leases.candidates({
      phases: BROWSER_PHASES,
      now,
      limit: input.limit ?? 10,
    });

    for (const candidate of candidates) {
      const conversationId = await this.#options.bindings.conversationForCase(candidate.caseId);
      if (conversationId === null) continue;

      const bound = await this.#options.bindings.caseFor(conversationId);
      if (bound === null || bound.blueprintId === null) continue;
      const entry = await this.#options.catalogue.find(bound.blueprintId);
      if (entry === null) continue;

      const record = await this.#options.stores.runs.load(makeRunId(candidate.runId));
      if (record === null) continue;

      const situation = await this.#situation({
        entry,
        record,
        conversationId,
        caseId: record.caseId,
        studentRef: record.studentRef,
      });
      if (!situation.ok) continue;

      // ── A stopped case is offered to nobody ──────────────────────────
      //
      // ADR-0053, and this is where "stop further consequential work
      // IMMEDIATELY" is actually enforced. `execute` and `create_account` are
      // the two things this system does to the outside world, and both arrive
      // through here. A case winding down or concluded is skipped before its
      // step is even consulted — so the moment `cancel_case` commits, the next
      // runner to poll is offered nothing for this run.
      //
      // Read from the CASE, not from the run's status: the run stays `running`
      // while it winds down, because the handover it still owes is real work.
      const caseEvents = await this.#options.stores.cases.read(record.caseId);
      const caseState = caseEvents.length === 0 ? null : fold(caseEvents).state;
      if (caseState === "WINDING_DOWN" || caseState === "CANCELLED") continue;

      // The orchestrator's answer, not the checkpoint's hint and not a list of
      // step kinds kept here — see `browserWorkFor`.
      const kind = browserWorkFor(situation.step);
      if (kind === null) continue;

      // ── An action that may already have happened is not work ────────────
      //
      // `assessIntent` has no branch that returns "retry it", and that absence
      // is the safety property: a `create_portal_account` that was started and
      // never completed may have created an account on a real portal, and
      // handing it out again would create a second one for a student who
      // already has one.
      //
      // The verdict is `verify_first` — look before acting — and nothing in
      // this system can look yet. So the run stops here, visibly: its position
      // stays `creating_account` and no runner is offered it, which is what
      // "a specialist looks at the portal and says which it was" means while
      // there is no verification capability to automate it.
      const unfinished = await this.#unfinishedAction(record.runId, kind, entry);
      if (unfinished !== null) {
        // P10: the run stops, and now it SAYS SO. Before this it simply fell
        // out of the work pool with its status still `running` — safe, and
        // indistinguishable from a run with nothing to do. Pausing is
        // idempotent, so a poller hitting the same stuck run every few seconds
        // raises one intervention and tells the student once.
        await this.#pause({
          record,
          entry,
          conversationId,
          action: ACTION_FOR_WORK[kind],
          target: unfinished.target,
          verdict: unfinished.verdict,
        });
        continue;
      }
      // Both narrowings come from the orchestrator; this file reads their
      // results and never a step's kind.
      const account = accountWorkOf(situation.step);
      const detail = accountDetail(account, situation.account);
      if (detail === null) continue;

      const plan = executePlanOf(situation.step);
      const payload = workPayloadFor(
        entry,
        {
          kind,
          account,
          plan,
          page: plan === null ? null : await this.#nextPage(record.runId, entry, plan),
        },
        detail.portalHost,
      );
      if (payload === null) continue;
      const { portalHost } = payload;

      const leaseId =
        this.#options.newLeaseId?.(candidate.runId, now) ?? `wl_${randomUUID().replace(/-/g, "")}`;
      const lease = await leases.claim({
        runId: candidate.runId,
        leaseId,
        kind,
        holder: input.holder,
        // The lease names the page it holds, so the report keys the right
        // intent without re-deriving a plan that may have changed (ADR-0047).
        ...(payload.pageRef === undefined ? {} : { pageRef: payload.pageRef }),
        // ...and the CONTENT version of it (ADR-0051 §6), so the report
        // completes the intent for what the runner actually typed rather than
        // for whatever the page holds by the time it answers.
        ...(payload.pageVersion === undefined ? {} : { pageVersion: payload.pageVersion }),
        now,
        leaseSeconds: input.leaseSeconds,
      });
      // Somebody else took it between the candidate query and here. Ordinary;
      // try the next one rather than failing the poll.
      if (lease === null) continue;

      return {
        leaseId: lease.leaseId,
        expiresAt: lease.expiresAt.toISOString(),
        runId: candidate.runId,
        caseId: record.caseId,
        studentRef: record.studentRef,
        kind,
        portalHost,
        email: detail.email,
        approach: detail.approach,
        // Present only when the student has actually typed one. A handle is
        // opaque and resolves to nothing outside a live vault (ADR-0026), which
        // is why the component that may hold no secrets may hold this.
        ...(situation.secret?.handle === undefined
          ? {}
          : { secretHandle: situation.secret.handle }),
        ...payload.carries,
      };
    }
    return null;
  }

  /**
   * Records how a unit of work ended, and gives the lease back.
   *
   * ── What this deliberately does NOT do ────────────────────────────────
   *
   * It does not move the run. A report is evidence about the world — an account
   * exists, a portal refused us, a browser died — and what a run does next is
   * `nextStep`'s to decide from that evidence, on the next advance. A report
   * handler that set a phase would be the second implementation of the decision
   * that ADR-0041 and the boundary check exist to prevent, and it would be one
   * written by the least trusted process in the system.
   *
   * `false` means the caller does not hold this lease — it expired and somebody
   * took over, or the work was already reported. Refused rather than applied,
   * because a slow runner must not be able to close out work the current holder
   * is in the middle of.
   */
  public async reportWork(input: {
    readonly runId: string;
    readonly report: WorkReport;
  }): Promise<boolean> {
    const leases = this.#options.leases;
    if (leases === undefined) return false;
    const now = this.#options.now();

    const held = await leases.held(input.runId, now);
    if (held === null || held.leaseId !== input.report.leaseId) return false;

    // ── The evidence, written where evidence about this goes ─────────────
    //
    // ADR-0008. `recordIntent`/`completeIntent` is the existing mechanism for
    // "a consequential action may have happened", and creating a real account
    // on a real university portal is its first-named example. The key comes
    // from the domain's own `idempotencyKeyFor` rather than being assembled
    // here, so a second writer of the same fact cannot format it differently
    // and record a second half-action.
    const runId = makeRunId(input.runId);
    const action = ACTION_FOR_WORK[held.kind];
    // The PAGE for a fill, the run for anything else. One intent per page is
    // what makes "which pages are done" answerable at all (ADR-0047), and the
    // page comes from the lease rather than from a re-derived plan — a plan
    // that changed in between would complete an intent for a page the runner
    // never touched.
    const target =
      held.pageRef === undefined
        ? held.runId
        : held.pageVersion === undefined
          ? held.pageRef
          : `${held.pageRef}@${held.pageVersion}`;
    const key = idempotencyKeyFor({ runId, action, target });

    // The intent is written on REPORT rather than on claim, and the difference
    // is what it would mean: an intent written at claim time says "this was
    // attempted" about work a runner might never have started, which reads as
    // more uncertainty than there is. Written here it says "a runner did this
    // and here is how it ended" — and `startedAt` is when the lease was taken,
    // which is when it actually began.
    if ((await this.#options.stores.runs.findIntent(runId, key)) === null) {
      await this.#options.stores.runs.recordIntent(runId, {
        idempotencyKey: key,
        action,
        target,
        startedAt: held.claimedAt,
      });
    }

    // ── Why `uncertain` completes nothing ────────────────────────────────
    //
    // Because `IntentOutcome` has two members and neither of them means "we do
    // not know". The schema says it with a constraint: an intent with no
    // completion is the uncertain case, and the gap between `started_at` and a
    // completion that never came is exactly the uncertainty window. Inventing a
    // third outcome word would destroy that distinction at the only point where
    // it is still recoverable.
    //
    // So a runner that cannot tell whether the portal accepted must report
    // `uncertain`, not `failed`. `failed_cleanly` is a claim — that nothing
    // happened out there — and only the runner is in a position to make it.
    if (input.report.outcome !== "uncertain") {
      await this.#options.stores.runs.completeIntent(
        runId,
        key,
        input.report.outcome === "succeeded" ? "succeeded" : "failed_cleanly",
        now,
      );
    }

    return await leases.release({ runId: input.runId, leaseId: input.report.leaseId, now });
  }
}

/**
 * Which consequential action a unit of work performs.
 *
 * A total map over `WorkKind` rather than a switch, so adding a work kind is a
 * compile error here — the alternative is a `default` that silently records the
 * wrong action for a new kind, in the one record an incident review reads.
 */
const ACTION_FOR_WORK: Readonly<Record<WorkKind, ConsequentialAction>> = {
  create_account: "create_portal_account",
  // Filling advances the portal, which may create a draft application visible
  // to admissions — which is why it is consequential at all, and why it gets an
  // intent rather than being treated as a read.
  execute: "advance_portal_page",
};

/**
 * Where the registration form is and which boxes to type into, from the
 * reviewed blueprint.
 *
 * ── Why the ORIGIN is swapped and the PATHS are not ───────────────────────
 *
 * A blueprint records paths and the origin it was discovered against. The same
 * reviewed blueprint runs against a university's sandbox before it ever runs
 * against production, and rewriting it to point at the sandbox would mean
 * running a blueprint nobody reviewed. So `CatalogueEntry.portalOrigin` — a
 * deployment fact — replaces the origin, and the paths come through untouched.
 *
 * `null` when the blueprint has no registration page, or names no control to
 * press, or names no password box. Every one of those is a blueprint that says
 * an account is required and does not say how to create one — a specialist's
 * problem, and not something to guess at with a form open.
 */
function registrationFrom(entry: CatalogueEntry): RegistrationTargets | null {
  const page = entry.blueprint.pages.find((candidate) =>
    candidate.sections.some((section) =>
      section.fields.some((field) => field.inputType === "password"),
    ),
  );
  if (page === undefined) return null;

  const fields = page.sections.flatMap((section) => section.fields);
  const email = fields.find((field) => field.inputType === "email");
  const passwords = fields.filter((field) => field.inputType === "password");
  if (email === undefined || passwords.length === 0) return null;

  const emailLocator = email.locators[0];
  const submit = page.advanceControl;
  if (emailLocator === undefined || submit === undefined) return null;

  const passwordLocators: FillLocator[] = [];
  for (const field of passwords) {
    // The FIRST locator only, and never a fallback list. On an ordinary field a
    // second locator is a helpful alternative; on a password box it is a second
    // guess about where a credential goes, and the blueprint fixture's own
    // comment records the ambiguous-label bug that motivated `name` locators
    // here in the first place.
    const locator = field.locators[0];
    if (locator === undefined) return null;
    passwordLocators.push({ strategy: locator.strategy, value: locator.value });
  }

  if (page.url === undefined) return null;
  const url = atOrigin(page.url, entry.portalOrigin);
  if (url === null) return null;

  return {
    url,
    emailLocator: { strategy: emailLocator.strategy, value: emailLocator.value },
    passwordLocators,
    submitLocator: { strategy: submit.strategy, value: submit.value },
  };
}

/** A blueprint URL moved onto the deployment's origin, or `null` if it is not a URL. */
function atOrigin(url: string, origin: string | undefined): string | null {
  try {
    const parsed = new URL(url);
    if (origin === undefined) return parsed.toString();
    const target = new URL(origin);
    parsed.protocol = target.protocol;
    parsed.host = target.host;
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Where this portal actually is, for this deployment.
 *
 * `CatalogueEntry.portalOrigin` moves the blueprint's paths onto another origin
 * — a university's sandbox, typically. It has to move EVERY use of the portal's
 * location together, or the parts disagree: the secure request would bind a
 * handle to the blueprint's host and the runner would type into the sandbox,
 * and the fill agent would refuse the page as `host_mismatch` — correctly, and
 * a long way from the configuration that caused it.
 */
/**
 * The confirmed date of birth as a Date, or `null` when there is not one yet.
 *
 * Parsed strictly. A date this cannot read is `null` — which raises the minor
 * trigger through `requires_identity_check` rather than passing as an adult,
 * because ADR-0013 says a missing or ambiguous date of birth is never assumed
 * absent.
 */
function confirmedDateOfBirth(state: RunState): Date | null {
  // Through `resolveField`, which is typed: `identity.date_of_birth` is a
  // `Date`, not a string. A first draft of this parsed it as an ISO string and
  // would have returned `null` every time — the minor trigger silently never
  // firing, which is the worst possible failure for this particular check.
  const held = resolveField(state.profile, "identity.date_of_birth");
  if (isFieldUnavailable(held)) return null;
  const value = unwrapConfirmed(held);
  return Number.isNaN(value.getTime()) ? null : value;
}

/**
 * Why a hop happened, for the case log a person reads later.
 *
 * Keyed on the SPINE rather than on every case state, because only the spine is
 * walked here. A `Record` over the spine's members rather than a switch with a
 * default: a default would quietly give a new spine state a stub reason, and
 * the reason is what somebody reads in a year when they ask why a case moved.
 */
const HOP_REASONS: Readonly<Record<string, string>> = {
  REQUIREMENTS_RESOLUTION:
    "Requirements come from the reviewed blueprint this run was started against (ADR-0017).",
  ELIGIBILITY_REVIEW: "The blueprint and mapping set were checked usable for this student.",
  READY_TO_PREPARE: "Everything needed to prepare is present.",
  PREPARING: "Preparing the application from the confirmed profile.",
  AWAITING_STUDENT_AUTHORISATION:
    "The exact content has been rendered and shown to the student.",
  AUTHORISED: "The student authorised the prepared content.",
};

function reasonFor(to: CaseState): string {
  return HOP_REASONS[to] ?? `Moved to ${to}.`;
}

/** A refusal's own words, whichever shape it is. */
function detailOf(refusal: DecisionRefusal): string {
  return refusal.kind === "transition_refused" ? refusal.refusal.detail : refusal.detail;
}

/**
 * The triggers a refusal named, when it named any.
 *
 * Only `mandatory_review_outstanding` carries them, and that is the refusal
 * this phase exists to be able to hit — so it is read by name rather than by a
 * shape that would also match some future refusal with a `triggers` field.
 */
function triggersOf(refusal: DecisionRefusal): readonly string[] {
  if (refusal.kind !== "transition_refused") return [];
  return refusal.refusal.kind === "mandatory_review_outstanding" ? refusal.refusal.triggers : [];
}

/**
 * The mandatory review triggers this run's own data carries.
 *
 * From real data or not at all (ADR-0049 §3). Two rules, both from the domain
 * rather than restated here:
 *
 *   involves_minor     `suggestsMinority` on the CONFIRMED date of birth.
 *                      NOT `determineAge`, which returns
 *                      `requires_identity_check` for any merely stated date of
 *                      birth — correct for the question it answers, and it
 *                      raised this trigger on every case in the system when
 *                      used here.
 *   financial_evidence any field the plan fills that the profile says is
 *                      financial evidence.
 */
function mandatoryTriggersOf(state: RunState, now: Date): readonly MandatoryReviewTrigger[] {
  const triggers: MandatoryReviewTrigger[] = [];

  const dob = confirmedDateOfBirth(state);
  if (dob !== null && suggestsMinority({ level: "stated", value: dob }, now)) {
    // `suggestsMinority`, NOT `determineAge`. A first version used the latter,
    // and `determineAge` returns `requires_identity_check` for ANY merely
    // stated date of birth — which is its safety property and is right, and
    // which raised this trigger on every case in the system. The two answer
    // different questions: "can we conclude adulthood" versus "does what we
    // hold suggest a minor". Only the second is what this trigger is about.
    triggers.push("involves_minor");
  }

  if ([...state.profile.entries.keys()].some((key) => isFinancialField(key))) {
    triggers.push("financial_evidence");
  }
  return triggers;
}

/**
 * The status a stopped run takes, from the verdict that stopped it.
 *
 *   verify_first → `uncertain`  somebody COULD establish this by looking, and
 *                               one day a verifier will do it automatically
 *   escalate     → `escalated`  only a person can; there is nothing to look at
 *
 * Both stop the run. The difference is what it would take to un-stop it, and
 * `NEXT_STATUS` treats them differently for that reason — `uncertain` may
 * become `escalated`, never the reverse.
 *
 * ── Honestly: `escalated` is not reachable from `claimWork` today ─────────
 *
 * `assessIntent` returns `escalate` only for an action `isVerifiable` says
 * cannot be checked, and both actions a runner performs — `create_portal_
 * account` and `advance_portal_page` — are verifiable. The unverifiable ones
 * are `consume_secret` and `submit_application`, and neither is work a runner
 * is ever handed (submission is out of scope by ADR-0014).
 *
 * So the branch is real, correct and currently unexercised by the integration
 * path. It is a pure function and enumerated in the tests for exactly that
 * reason: the alternative was leaving it untested and saying nothing.
 */
export function statusForVerdict(verdict: "verify_first" | "escalate"): WorkflowStatus {
  return verdict === "verify_first" ? "uncertain" : "escalated";
}

/**
 * Which portal an intervention is about, for a person to read.
 *
 * The deployed origin when the catalogue names one, else the host of the first
 * page the blueprint actually observed a URL for, else the institution
 * reference. Never a guess dressed as a host: the last fallback is plainly an
 * institution reference rather than something shaped like a domain, because a
 * specialist reading "inst_leeds" knows to go and look, while a fabricated
 * "leeds.ac.uk" would send them somewhere the run never touched.
 */
function portalOf(entry: CatalogueEntry): string {
  if (entry.portalOrigin !== undefined) {
    const host = hostOf(entry.portalOrigin);
    if (host !== null) return host;
  }
  for (const page of entry.blueprint.pages) {
    if (page.url === undefined) continue;
    const host = hostOf(page.url);
    if (host !== null) return host;
  }
  return entry.institutionRef;
}

function deployedHost(entry: CatalogueEntry, fromBlueprint: string): string | null {
  return entry.portalOrigin === undefined ? fromBlueprint : hostOf(entry.portalOrigin);
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/**
 * The email, host and approach every unit of work carries.
 *
 * For `create_account` they come from the step the orchestrator narrowed. For
 * `execute` there is no such step — the account already exists by then — so the
 * portal's host comes from the reviewed blueprint, which is where the account's
 * host came from originally, and the address is left to the account itself
 * rather than restated on the wire.
 */
function accountDetail(
  step: ReturnType<typeof accountWorkOf>,
  existing: RunState["account"],
): { portalHost: string; email: string; approach: WorkApproach } | null {
  // Before the account exists, the step says who it is for.
  if (step !== null) {
    if (!(WORK_APPROACHES as readonly string[]).includes(step.approach)) return null;
    return {
      portalHost: step.portalHost,
      email: step.email,
      approach: step.approach,
    };
  }
  // After it exists, the ACCOUNT does — and it is the same address, because
  // `accountCreated` took it from the same confirmed profile the step did.
  // Reading it from the account rather than re-deriving it is what stops the
  // two ever disagreeing about whose application this is.
  if (existing === undefined) return null;
  if (!(WORK_APPROACHES as readonly string[]).includes(existing.authentication.approach)) {
    return null;
  }
  return {
    portalHost: existing.portalHost,
    email: unwrapConfirmed(existing.email),
    approach: existing.authentication.approach,
  };
}

/**
 * What a unit of work carries, and the host it is bound to — or `null` because
 * this run is not work after all.
 *
 * ── The check both kinds share ────────────────────────────────────────────
 *
 * The page must be on the bound host. `portalHost` is what the secure request
 * binds a handle to and what the fill agent checks the live page against, so a
 * page elsewhere would be a run acting on a host nobody bound it to. Both sides
 * move together when a deployment moves the origin, so what this catches is a
 * BLUEPRINT whose pages disagree with its sign-in — a portal fact a specialist
 * should have looked at, not something to proceed through.
 */
function workPayloadFor(
  entry: CatalogueEntry,
  input: {
    readonly kind: WorkKind;
    readonly account: ReturnType<typeof accountWorkOf>;
    readonly plan: FillPlan | null;
    /** Which page to hand out, decided from the ledger by `#nextPage`. */
    readonly page: ApplicationBlueprint["pages"][number] | null;
  },
  fromBlueprint: string,
):
  | {
      readonly portalHost: string;
      readonly pageRef?: string;
      readonly pageVersion?: string;
      readonly carries: Partial<
        Pick<ClaimedWork, "registration" | "plan" | "formUrl" | "advanceLocator">
      >;
    }
  | null {
  const portalHost = deployedHost(entry, fromBlueprint);
  if (portalHost === null) return null;

  // Branching on the WORK KIND — a word from the wire contract — and never on a
  // step's kind. The orchestrator narrowed the step already; a second narrowing
  // here would be this file keeping its own copy of what each step holds.
  if (input.kind === "create_account") {
    if (input.account === null) return null;
    // A blueprint that says an account is needed and does not say how to make
    // one is a specialist's problem, not a runner's.
    const registration = registrationFrom(entry);
    if (registration === null) return null;
    if (hostOf(registration.url) !== portalHost) return null;
    return { portalHost, carries: { registration } };
  }

  const plan = input.plan;
  if (plan === null) return null;

  // ── Taken apart for transport, or refused ─────────────────────────────
  //
  // `toStoredPlan` refuses a plan with uploads, handoffs or blockers rather
  // than trimming them: a plan with its uploads removed would report itself
  // complete having attached nothing, and the student would be told their
  // application was filled. A refused plan means this run is not work — it is
  // waiting on something else, and `nextStep` says what on the next advance.
  const transported = toStoredPlan(plan);
  if (!transported.ok) return null;

  // ── A unit of fill work is ONE PAGE ───────────────────────────────────
  //
  // A plan covers the whole application, and an application is paginated. A
  // runner handed all of it would navigate to one page and time out on the
  // other's fields — which is exactly what happened the first time this ran.
  //
  // WHICH page is `#nextPage`'s answer, from the intent ledger (ADR-0047), so
  // a page already saved is never handed out twice.
  const page = input.page;
  if (page === null) return null;
  const at = atOrigin(page.url ?? "", entry.portalOrigin);
  if (at === null || hostOf(at) !== portalHost) return null;

  // The control that saves this page. A blueprint page with fields to fill and
  // no way to save them is a blueprint a specialist should look at, not a page
  // to type into and abandon.
  const advance = page.advanceControl;
  if (advance === undefined) return null;

  const onThisPage = new Set(
    page.sections.flatMap((section) => section.fields.map((field) => field.fieldRef)),
  );
  const instructions = transported.plan.instructions.filter((instruction) =>
    onThisPage.has(instruction.fieldRef),
  );
  if (instructions.length === 0) return null;

  return {
    portalHost,
    pageRef: page.pageRef,
    // The SAME target the ledger check builds, from the plan as transported.
    // `StoredFillValue.text` and `textOf` are the same string by construction,
    // so the two sides cannot disagree about what this page holds.
    pageVersion: pageFillTarget({
      pageRef: page.pageRef,
      values: instructions.map((instruction) => ({
        fieldRef: instruction.fieldRef,
        text: instruction.value.text,
      })),
    }).slice(page.pageRef.length + 1),
    carries: {
      plan: toWirePlan({ ...transported.plan, instructions }),
      formUrl: at,
      advanceLocator: { strategy: advance.strategy, value: advance.value },
    },
  };
}

/**
 * The transport form, as the WIRE declares it.
 *
 * Rebuilt field by field rather than passed through. `StoredFillPlan` and
 * `TransportedPlan` are the same shape held by two packages that may not depend
 * on each other — `@askimate/aas-contracts` has no dependencies at all — and
 * this is where the two meet. `scripts/contract-drift.test.ts` takes a real plan
 * through both and requires the round trip to be lossless, so the duplication
 * cannot drift unnoticed.
 */
function toWirePlan(stored: StoredFillPlan): TransportedPlan {
  return {
    blueprintId: stored.blueprintId,
    blueprintVersion: stored.blueprintVersion,
    mappingSetId: stored.mappingSetId,
    instructions: stored.instructions.map((instruction) => ({
      fieldRef: instruction.fieldRef,
      label: instruction.label,
      inputType: instruction.inputType,
      locators: instruction.locators.map((locator) => ({
        strategy: locator.strategy,
        value: locator.value,
      })),
      value:
        instruction.value.kind === "confirmed"
          ? {
              kind: "confirmed" as const,
              fieldKey: instruction.value.fieldKey,
              text: instruction.value.text,
              provenance: {
                source: instruction.value.provenance.source,
                confirmedAt: instruction.value.provenance.confirmedAt.toISOString(),
                ...(instruction.value.provenance.sourceExcerpt === undefined
                  ? {}
                  : { sourceExcerpt: instruction.value.provenance.sourceExcerpt }),
                ...(instruction.value.provenance.documentId === undefined
                  ? {}
                  : { documentId: instruction.value.provenance.documentId }),
              },
            }
          : {
              kind: "reviewed_constant" as const,
              text: instruction.value.text,
              rationale: instruction.value.rationale,
              mappingSetId: instruction.value.mappingSetId,
              reviewedBy: instruction.value.reviewedBy,
            },
    })),
  };
}
