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
import { DuplicateSubmissionError } from "@askimate/aas-case-store";
import type {
  InterventionStore,
  StoredIntervention,
} from "@askimate/aas-case-store/interventions";
import { InterventionNotFoundError } from "@askimate/aas-case-store/interventions";
import {
  askimateActor,
  blueprintVersion,
  openReapplication,
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
  isHeldByAPerson,
  isTerminal,
  recommendWait,
  submissionKey,
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
  ReapplicationInstructed,
  RequestEvidence,
  RunId,
  StudentId,
  WaitRecommendation,
  WorkflowPhase,
  WorkflowRunRecord,
  WorkflowStatus,
  RecoveryReason,
  OwnAct,
} from "@askimate/aas-domain";
import { noticeFor } from "@askimate/aas-notify";
import type { SpecialistNotifier } from "@askimate/aas-notify";
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
import type { DocumentRecord, DocumentVault } from "@askimate/aas-documents";
import type { LawfulBasisRegister } from "@askimate/aas-disclosure";
import { DISCLOSURE_ACTIVITY, authoriseDisclosure, determinationOf, mayTransmit } from "@askimate/aas-disclosure";
import type { DisclosureRequestRecord } from "@askimate/aas-disclosure";
import { buildPreview, renderPreview } from "@askimate/aas-preparation";
import type { PreviewAttachment, PreviewDeployment } from "@askimate/aas-preparation";
import type { WorkDocument,
  OwnActReading,
} from "@askimate/aas-contracts";
import type { FillPlan, MappingSet, StoredFillPlan } from "@askimate/aas-mapping";
import {
  accountCreated,
  accountWorkOf,
  attachmentIntentTarget,
  awaitsStudentAuthorisation,
  beginRun,
  handoffFor,
  handoffMessageOf,
  interviewActionOf,
  pageAttachmentsOf,
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
  specialistHandoverOf,
  resumeRun,
  startRun,
  withAuthorisation,
  withCheckpoint,
  withSecret,
  withSession,
} from "@askimate/aas-orchestrator";
import type {
  DurableStores,
  HandoverEvidence,
  ResumeConcern,
  RunState,
  RunStep,
  PageAttachment,
} from "@askimate/aas-orchestrator";
import { FIELD_LABELS, isFinancialField, resolveField } from "@askimate/aas-profile";
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
import { AUTOMATABLE_STATUSES } from "@askimate/aas-domain";
import { SESSION_ENDING_FAILURES, WORK_APPROACHES } from "@askimate/aas-contracts";
import type { LoginTargets, PriorOutcome } from "@askimate/aas-contracts";

import type { ApplicationBindingStore } from "./application-store.js";
import type { ConversationEvent } from "@askimate/aas-contracts";
import type { ProposedValue } from "@askimate/aas-domain";

import type { ConversationEventStore } from "./event-store.js";
import type { SecureRequestOpener } from "./secure-requests.js";
import type { WorkLease, WorkLeaseStore } from "./work-store.js";
import type { RunSessionStore } from "./session-store.js";
import type { TransmissionStore } from "./transmission-store.js";

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
  /**
   * Domain document TYPES the application needs, e.g. `["passport"]`.
   *
   * ADVISORY (ADR-0066). It reaches the student's offer and `InterviewState`,
   * and nothing plans, blocks or executes from it. An upload is planned from a
   * reviewed MAPPING instead. The comment here used to say "must collect",
   * which was never true of any code path.
   */
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
   * name.
   *
   * `SecretPurpose` in `@askimate/aas-secrets` and `OpenSecretRequest.purpose`
   * in `secure.v1.yaml` are two closed sets that AGREE since P72 (ADR-0101
   * §3): `portal_account_creation | portal_sign_in`. They differed on one
   * member from P27 to P71, and this refusal is what kept the difference
   * honest — a purpose the published contract does not name is refused here
   * rather than cast into the wire. It stays for the next member.
   */
  | { readonly kind: "purpose_not_supported" }
  /**
   * The student's email address is not verified, so a secure step is refused.
   *
   * ADR-0038 required this guard and ADR-0056 decides where the answer comes
   * from: `students.email_verified`, established at login from a
   * signature-verified ID token. Every ambiguous case — no address, no claim —
   * is stored as `false`, so this refusal covers all three.
   *
   * It is a refusal rather than a pause: nothing is stuck, and the student can
   * clear it themselves by verifying and signing in again.
   */
  | { readonly kind: "email_not_verified" }
  | { readonly kind: "unknown_blueprint" }
  | { readonly kind: "unusable_mapping_set"; readonly detail: string }
  | { readonly kind: "unknown_conversation" }
  | { readonly kind: "case_not_bindable" }
  /**
   * This student already has an application for this institution, course and
   * intake (ADR-0006).
   *
   * ── The hole this closes, and how long it was open ────────────────────
   *
   * `claimSubmissionKey` has existed since Phase 1, ADR-0006 calls the
   * database's unique key "the second line of defence", and until P38 NOTHING
   * IN PRODUCTION CALLED IT. Its only caller in the repository was the
   * walkthrough. A student could open a second conversation, request the same
   * target, and receive a second case with the same
   * (studentId, institutionId, courseId, intake, attemptOrdinal: 1) — the
   * duplicate the brief names as "the characteristic catastrophic failure of
   * this class of system", with nothing between it and a live portal but the
   * fact that nothing submits yet.
   *
   * `existingCaseId` is always an application of the CALLER'S OWN: the student
   * is part of the submission identity, so a collision cannot be with anybody
   * else's case. That is a property of `submissionKey` rather than a check made
   * here.
   */
  | {
      readonly kind: "already_applying";
      readonly existingCaseId: string;
      /** True when it has finished, so `reapply` is available to them. */
      readonly concluded: boolean;
    }
  /**
   * A re-application was instructed where there is no prior application.
   *
   * The mirror of `already_applying`: that refusal means an identity is held,
   * this one means it is not. A client reaching this has offered the student a
   * second attempt at something they never applied to.
   */
  | { readonly kind: "no_prior_application" }
  /**
   * The wait recommendation was never shown in this conversation.
   *
   * ADR-0006 rule 4: advisory in effect, MANDATORY in presentation — the system
   * must show it before accepting the instruction, and must record that it did.
   * The record is a `reapplication_advised` event, and this is what its absence
   * means. It is not a client error to route around; it is the missing half of
   * the exchange.
   */
  | { readonly kind: "recommendation_not_shown" }
  /**
   * A specialist is holding this run, so nothing automatic may move it.
   *
   * Not an error and not a dead end: the run RESUMES when the specialist
   * adjudicates, and the student was told so at the moment it stopped. What
   * this refuses is an ADVANCE — asking to start again returns the run where
   * it is, and stopping the application is still available (ADR-0053).
   */
  | { readonly kind: "held_for_specialist" }
  /**
   * The domain refused the instruction. Carries the gate's own words.
   *
   * `decideReapplication`'s four rules — an automatic origin, a prior case that
   * has not concluded, no statement in the student's own words, a
   * recommendation shown after the fact — plus "this case already has a
   * successor". They are one refusal here because the caller's remedy is the
   * same for all of them: read what the domain said.
   */
  | { readonly kind: "reapplication_refused"; readonly detail: string };

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

/**
 * What the run is waiting for the student to do, and the hash it must carry.
 *
 * ADR-0061. A closed set of three, because those are the three prompted
 * decisions: `cancel` is always available and carries no hash, so it is not a
 * thing a run WAITS for.
 */
export interface PendingDecision {
  readonly decision: "confirm_value" | "authorise" | "confirm_handoff";
  /** `sha256:<hex>`, from the same source the decision route compares against. */
  readonly contentHash: string;
}

/** A read of a run: where it stands, and what it is waiting for. */
export interface RunReading {
  readonly run: RunPosition;
  readonly pending: PendingDecision | null;
  /**
   * What the student owes the portal, from the case's own record (ADR-0108):
   * recorded at the yes, closed only by their word, and read here so the
   * student and a specialist see the same list.
   */
  readonly ownActs: readonly OwnActReading[];
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
 * How far up the attempt chain `#latestAttempt` will walk.
 *
 * A bound, not a policy: nothing refuses a twentieth attempt, and if a student
 * ever reaches one the walk stops rather than the request hanging. An unbounded
 * loop over a table that grows by one row per case is a way to turn a
 * re-application into a request that never returns.
 */
const MAX_ATTEMPTS = 20;

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
 * Which challenge a report names, or `null` for every other outcome.
 *
 * Total over the two codes and nothing else: a failure that is not one of
 * them is what it always was, and the intent ledger already recorded it.
 */
function challengeOf(report: WorkReport): "captcha" | "second_factor" | null {
  if (report.outcome === "succeeded") return null;
  if (report.failure === "captcha_met") return "captcha";
  if (report.failure === "second_factor_met") return "second_factor";
  return null;
}

/**
 * What the student reads when the portal asked for something only a person
 * can pass (ADR-0101 §6). Two fixed sentences, one per challenge, chosen by
 * code — never composed from anything the page said.
 */
function challengeMessage(entry: CatalogueEntry, challenge: "captcha" | "second_factor"): string {
  const institution = entry.blueprint.institutionName;
  if (challenge === "captcha") {
    return (
      `${institution}'s application portal asked me to prove I am not a robot before it would ` +
      `go on. That is something only a person can do, so I have stopped there and passed your ` +
      `application to a member of the team. Nothing you have given me is lost, and nothing has ` +
      `been submitted.`
    );
  }
  return (
    `${institution}'s application portal asked for a code sent to you — a second sign-in step ` +
    `that only you can complete. I have stopped there and passed your application to a member ` +
    `of the team, who will arrange it with you. Nothing you have given me is lost, and nothing ` +
    `has been submitted.`
  );
}

/**
 * What the specialist is told: which challenge, during which action, against
 * which page, and what discovery had recorded — so the contradiction is on
 * the record rather than in somebody's memory. For a creation met by a second
 * factor, that the account may already exist: the one fact that stops a
 * second one being made.
 */
function challengeEncountered(
  entry: CatalogueEntry,
  challenge: "captcha" | "second_factor",
  action: ConsequentialAction,
  target: string,
): string {
  const observed = entry.portalAuthentication;
  const recorded =
    observed === undefined
      ? "no observation of this portal's authentication is on the entry"
      : challenge === "captcha"
        ? `the reviewed observation (${observed.discoveryRunId}) records captchaPresent as ` +
          `${String(observed.captchaPresent)}`
        : `the reviewed observation (${observed.discoveryRunId}) records mfaOrOtpRequired as ` +
          `${String(observed.mfaOrOtpRequired)}`;
  const met =
    challenge === "captcha"
      ? `The portal presented a CAPTCHA during "${action}" at ${target}. The runner did not ` +
        `attempt it and typed nothing into that page.`
      : `The portal asked for a one-time code or another second factor during "${action}" at ` +
        `${target}.` +
        (action === "create_portal_account"
          ? ` The registration form was accepted before the code was asked for, so the account ` +
            `MAY ALREADY EXIST: verify on the portal before creating another.`
          : action === "sign_in_to_portal"
            ? ` The sign-in on the resume path (ADR-0101 §3) was not completed; the password the ` +
              `student typed for it is single-use and is gone either way.`
            : ` The page was not filled.`);
  return `${met} Discovery: ${recorded}. Vahid, ADR-0101 §6: this refusal is the signal that moves the second-factor plan (§5) from deferred to needed.`;
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
 * What the student reads when their run has been handed to a specialist.
 *
 * ONE sentence whatever the reason, and deliberately so. The `detail` behind a
 * `specialist` step names artefacts a specialist works with — a field ref, a
 * mapping, a document ref — and reading those to a student explains nothing and
 * invites them to try to fix it. What they need is the truth: a person has it,
 * nothing they gave is lost, and nothing has been sent.
 *
 * It does NOT name the missing document even when that is the reason. Doing so
 * would mean the step carrying `documentRef` structurally, which is a change to
 * the orchestrator's published `RunStep` — and the specialist, who can act on
 * it, already has it in `encountered`. Recorded in ADR-0065 rather than done.
 */
function specialistMessage(entry: CatalogueEntry): string {
  return (
    `I have had to pass your ${entry.blueprint.institutionName} application to a member of the ` +
    `team. There is something about it I cannot complete on my own, and I would rather a person ` +
    `looked at it than guess. Nothing you have given me is lost, and nothing has been submitted.`
  );
}

/**
 * What the student reads when the interview has run out of ways to ask.
 *
 * Deliberately NOT `reviewMessage`. That one says "this is a rule we apply
 * every time, not something that has gone wrong" — which would be a lie here.
 * Something did go wrong: we asked as many times as the interview allows and
 * still could not read an answer. Saying so is the honest thing, and it is also
 * what stops the student answering into a void.
 */
function unobtainableMessage(entry: CatalogueEntry, what: string): string {
  return (
    `I have not been able to get your ${what} from our conversation, and I have asked as many ` +
    `times as I should. Rather than guess at something your ${entry.blueprint.institutionName} ` +
    `application depends on, I have passed this to a member of the team to sort out with you. ` +
    `Nothing you have already given me is lost, and your application has not been submitted.`
  );
}

/**
 * What the student reads when a document is required.
 *
 * ADR-0022 governs disclosure before a document is sent anywhere and ADR-0023
 * requires a retention period to be determined rather than invented — and that
 * determination is UNAPPROVED, so this system cannot accept a document at all.
 * Saying "please upload your passport" would be asking for something there is
 * nowhere to put. It names what is needed and hands the case to a person, which
 * is the only honest move available.
 */
function documentNeededMessage(entry: CatalogueEntry, documentType: string): string {
  const label = documentType.replace(/_/g, " ");
  return (
    `Your ${entry.blueprint.institutionName} application needs your ${label}. I am not able to ` +
    `take documents in this conversation, so I have passed this to a member of the team, who ` +
    `will arrange it with you directly. Nothing you have already given me is lost, and your ` +
    `application has not been submitted.`
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
 * The question outstanding on this log, or `null`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ADR-0062. The last `value_asked` with nothing after it that answers or
 * supersedes it. The same reading `openProposal` makes, and the same reading
 * the `open_value_questions` view makes in SQL — derived here as well because
 * `#situation` already holds every event and a second round trip would answer
 * the same question more slowly.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A student MESSAGE closes it, even one nothing could be read from. They
 * answered; the reading failed; they are owed a fresh question rather than the
 * same one standing open for ever with the service silent.
 */
export function openQuestion(events: readonly ConversationEvent[]): { fieldKey: string } | null {
  let open: { fieldKey: string } | null = null;
  for (const event of events) {
    if (event.kind === "value_asked") {
      open = { fieldKey: event.fieldKey };
      continue;
    }
    if (
      event.kind === "value_proposed" ||
      event.kind === "value_confirmed" ||
      event.kind === "value_rejected" ||
      (event.kind === "message" && event.actor === "student")
    ) {
      open = null;
    }
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
export type DecisionRefusalReason =
  | "no_case"
  | "not_asked"
  | "content_changed"
  | "refused"
  /**
   * A specialist is holding the run, so it cannot be advanced yet (P40).
   *
   * Refuses `authorise` and `confirm_handoff` — the two decisions that MOVE
   * the application. `cancel` is deliberately not among them: ADR-0053 says a
   * stop button that only worked at certain steps would not be one, and a
   * student who wants out while a person is looking is exactly somebody a stop
   * button is for. `confirm_value` is not among them either — answering a
   * question about their own details is not advancing an application.
   */
  | "held_for_specialist";

/** Why a runner was not handed a document. A closed set; the route maps each to a code. */
export type WorkDocumentRefusal =
  | "no_disclosure_port"
  | "not_holder"
  | "no_such_run"
  | "not_executing"
  | "no_such_upload"
  | "not_authorised"
  | "content_changed"
  | "disclosure_refused"
  | "transmission_refused";

/** The one question the driver asks the vault's metadata: what does this student hold? */
export interface HeldDocuments {
  listForStudent(studentId: string): Promise<readonly DocumentRecord[]>;
}

/**
 * The preview's document map, from what the student holds.
 *
 * Keyed by document TYPE, because that is what a reviewed mapping's
 * `documentRef` names (ADR-0069: "what a reviewer decided AskiMate calls the
 * document"). One document per type: the latest usable one, where usable is a
 * record that is neither purged nor superseded. A superseded passport is one
 * the student replaced, and attaching it would be sending the document they
 * withdrew.
 */
export function previewDocumentsOf(
  held: readonly DocumentRecord[],
): Map<string, { readonly documentId: string; readonly describedAs: string; readonly contentHash: string }> {
  const usable = held.filter((r) => r.state !== "purged" && r.state !== "superseded" && r.supersededBy === undefined);
  const byType = new Map<string, DocumentRecord>();
  for (const record of usable) {
    const current = byType.get(record.documentType);
    if (current === undefined || record.uploadedAt.getTime() > current.uploadedAt.getTime()) {
      byType.set(record.documentType, record);
    }
  }
  return new Map(
    [...byType].map(([type, record]) => [
      type,
      { documentId: record.documentId, describedAs: type, contentHash: record.contentHash },
    ]),
  );
}

export interface RunDriverOptions {
  readonly stores: DurableStores;
  readonly bindings: ApplicationBindingStore;
  readonly catalogue: ApplicationCatalogue;
  /**
   * Where the trusted email-verification state is read from (ADR-0056).
   *
   * OPTIONAL, and its absence is a refusal rather than a bypass: see
   * `#openSecureStep`. A driver wired without it cannot open a secure step at
   * all, which is the safe direction for a guard that protects the one place a
   * student types a password.
   */
  readonly identities?: {
    verificationOf(studentId: string): Promise<boolean | null>;
  };
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
   * Who last reported a run's signed-in session live, and until when it can
   * still be (ADR-0101 §2, §3). Written from runner reports, read to decide
   * whether a run fills or resumes. Optional for the reason `leases` is; absent,
   * the session is not tracked and the run fills as it always did.
   */
  readonly sessions?: RunSessionStore;
  /**
   * What left: the audit record of every document a runner attached
   * (ADR-0022, ADR-0069 — P73), written from the report that settles the
   * attachment's intent. Optional for the reason `leases` is; absent, the
   * intent is still settled and only the audit row is not written.
   */
  readonly transmissions?: TransmissionStore;
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
   * What the student holds in the vault, by type. ADR-0097 (P64).
   *
   * The preview names every attachment and the authorisation binds to it
   * (ADR-0057, ADR-0069), so the documents it names must be the ones the
   * student actually holds: this is read at every plan, never remembered.
   * OPTIONAL, and absent means the student holds nothing — a plan that
   * attaches a document then stops at `document_missing`, exactly as every
   * run did before P64. The metadata store only; no byte is read here.
   */
  readonly heldDocuments?: HeldDocuments;
  /**
   * What a runner is handed a document THROUGH (ADR-0099): the lawful-basis
   * register the disclosure determination is read from, and the vault that
   * mints a retrieval URL. Absent in a deployment without the document
   * transport — and in the Worker, which builds this driver and hands out no
   * documents — so `documentForWork` answers `no_disclosure_port` there
   * rather than pretending. Never a byte: the vault is asked for a URL.
   */
  readonly disclosure?: {
    readonly register: LawfulBasisRegister;
    readonly vault: DocumentVault;
  };
  /**
   * Where a stopped run is announced to a PERSON who can unstick it (ADR-0071).
   *
   * Optional, and its absence is the pre-P36 behaviour: an intervention is
   * raised, the student is told their application is paused, and the specialist
   * queue fills up silently until somebody runs the CLI. That was the state for
   * twenty-six phases, so it must remain a valid deployment rather than a
   * startup failure — but it is now a CHOICE, made by not configuring a
   * destination, rather than the only thing the system could do.
   *
   * Held by the Background Worker, not by the Conversation Service. Noticing
   * that something needs a person, and telling them, is autonomous progression,
   * and ADR-0052 puts autonomous progression in the worker.
   */
  readonly notifier?: SpecialistNotifier;
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
    /**
     * The reviewed target, already resolved and verified by Gate 2.
     *
     * ── Why this is not a `blueprintId` any more (ADR-0058) ─────────────
     *
     * It was, and an identifier alone is exactly what must not be able to open
     * a case: `bp-gated-portal` is not something a student can consent to, and
     * nothing about receiving one proves they were shown what it means.
     *
     * The caller resolves an offer the student accepted and passes the
     * blueprint that offer named. The catalogue is still consulted here — this
     * is the driver, and it needs the entry — but the DECISION about which
     * target this case is for was made and audited before this call.
     */
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

    return await this.#openAndStart({
      conversationId: input.conversationId,
      blueprintId: input.blueprintId,
      studentStatement: input.studentStatement,
      entry,
      attempt: { kind: "first" },
    });
  }

  /**
   * Binds a conversation to a case, opens the case, and starts its run.
   *
   * Shared by `start` and `reapply`, which differ in exactly one thing: which
   * ATTEMPT the case is. Everything else — the critical section, the submission
   * key, the resume-rather-than-restart rule, the first event — is identical,
   * and two copies of it would be two chances for a second attempt to skip a
   * guard a first attempt keeps.
   */
  async #openAndStart(input: {
    readonly conversationId: string;
    readonly blueprintId: string;
    readonly studentStatement: string;
    readonly entry: CatalogueEntry;
    /**
     * Which attempt this case is — and, for a second one, what it follows.
     *
     * ── Why this is a union and not an ordinal ──────────────────────────
     *
     * An ordinal is a number, and a number is something a caller can be wrong
     * about. This carries the PRIOR CASE and the instruction the gate
     * accepted, so `openReapplication` derives the identity — student,
     * institution, course, intake from the prior case, ordinal from the
     * instruction — and there is no field here through which a second attempt
     * at a different target, or at an ordinal nobody decided, could be
     * expressed. ADR-0006 §3 names that constructor as the only one; this is
     * what makes the naming true rather than documentation.
     */
    readonly attempt:
      | { readonly kind: "first" }
      | {
          readonly kind: "reapplication";
          readonly priorCase: ApplicationCase;
          readonly instructed: ReapplicationInstructed;
        };
  }): Promise<RunOutcome> {
    const entry = input.entry;
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
          const live = existing.find((record) => AUTOMATABLE_STATUSES.includes(record.status));
          if (live !== undefined) return { record: live, caseId, studentRef, resumed: true };

          // ── A run a PERSON holds is returned, not restarted (P40) ────────
          //
          // Vahid: "when a specialist reviews a case, there is no handoff to a
          // separate conversation or a different person. The student stays
          // where they were."
          //
          // Before this, `uncertain` and `escalated` fell through the live
          // check above and reached `startRun`, which refused a run id that
          // already existed — so a student whose application had stopped for a
          // specialist, and who came back and asked to carry on, got a 500.
          // The one thing they were promised ("I will tell you as soon as it
          // moves again") arrived as an error.
          //
          // Returned WITHOUT deciding. The orchestrator's answer would be about
          // where the run stands, and where it stands is with a person —
          // `#heldPosition` says that, and re-deriving would move a case whose
          // next move is somebody else's.
          const held = existing.find((record) => isHeldByAPerson(record.status));
          if (held !== undefined) return this.#heldPosition(held, input.conversationId);

          // ── The case's first event ────────────────────────────────────
          //
          // Written before the run, because a run whose case has no log is a
          // run against nothing. `openCase` refuses to build without request
          // evidence, so this is where "the student asked" stops being an
          // assumption.
          const sequence = await this.#options.stores.cases.currentSequence(caseId);
          if (sequence === 0) {
            const requestEvidence: RequestEvidence = {
              requestedAt: now,
              // The surface this request actually arrived on (ADR-0058).
              channel: "aas_conversation",
              conversationRef: externalRef(input.conversationId),
              studentStatement: input.studentStatement,
            };

            // ── The event first, and the KEY from the event ──────────────
            //
            // One construction, not two. The identity the submission key is
            // claimed for is literally the identity written into the log, so
            // they cannot disagree — ADR-0041's reason, applied to the one
            // pair where a disagreement would mean a case whose key describes
            // a different application than its own first event does.
            const opening =
              input.attempt.kind === "first"
                ? openCase({
                    submissionIdentity: {
                      studentId: studentRef,
                      institutionId: makeInstitutionId(entry.institutionRef),
                      courseId: makeCourseId(entry.courseRef),
                      intake: makeIntake(entry.intakeRef),
                      attemptOrdinal: 1,
                    },
                    requestEvidence,
                  })
                : openReapplication({
                    priorCase: input.attempt.priorCase,
                    instructed: input.attempt.instructed,
                    requestEvidence,
                  });
            if (opening.type !== "CaseOpened") {
              throw new Error("a case must open with CaseOpened");
            }
            const identity = opening.submissionIdentity;

            // ── The second line of defence, finally armed (P38) ──────────
            //
            // BEFORE the log, not after. The claim names this case, and
            // re-claiming for the same case is a no-op — so a retry of a start
            // that crashed between the two arrives here, sees its own claim,
            // and goes on to write the log it did not write last time. The
            // other order leaves a case log with no key, which is a duplicate
            // waiting to be created by the next caller.
            //
            // ADR-0006 has called this "the second line of defence" since
            // Phase 1. Until now there was no first line: nothing in production
            // called `claimSubmissionKey` at all.
            try {
              await this.#options.stores.cases.claimSubmissionKey(
                submissionKey(identity),
                caseId,
              );
            } catch (error: unknown) {
              if (error instanceof DuplicateSubmissionError) {
                return {
                  ok: false,
                  refusal: {
                    kind: "already_applying",
                    existingCaseId: error.existingCaseId,
                    concluded: await this.#hasConcluded(error.existingCaseId),
                  },
                };
              }
              throw error;
            }

            const events = stamp({
              caseId,
              fromSequence: 0,
              payloads: [opening],
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

  /** True when a case exists and has reached a terminal state. */
  async #hasConcluded(existingCaseId: string): Promise<boolean> {
    const events = await this.#options.stores.cases.read(makeCaseId(existingCaseId));
    if (events.length === 0) return false;
    return isTerminal(fold(events).state);
  }

  /**
   * The application that holds this conversation's target, and which attempt
   * a new case would be.
   *
   * ═══════════════════════════════════════════════════════════════════════
   * Walks the chain from ordinal 1 upward, asking the submission-key table who
   * holds each. The LAST holder is the latest attempt, and the next ordinal is
   * one above it.
   *
   * That is what "derived from the prior chain, never proposed by a caller"
   * means in practice. The alternative — reading `attemptOrdinal` off the case
   * a caller named — would trust a number to describe the world; this asks the
   * one table that is authoritative about which identities exist, and it is
   * authoritative because a claim on it is what creates a case at all.
   * ═══════════════════════════════════════════════════════════════════════
   *
   * Bounded, because an unbounded loop over a table anybody can add rows to is
   * a way to hang a request. Twenty attempts at one course and intake is not a
   * re-application pattern; it is something else, and it should stop.
   */
  async #latestAttempt(input: {
    readonly studentRef: StudentId;
    readonly entry: CatalogueEntry;
  }): Promise<{ readonly caseId: CaseId; readonly ordinal: number } | null> {
    let found: { caseId: CaseId; ordinal: number } | null = null;
    for (let ordinal = 1; ordinal <= MAX_ATTEMPTS; ordinal += 1) {
      const holder = await this.#options.stores.cases.findBySubmissionKey(
        submissionKey({
          studentId: input.studentRef,
          institutionId: makeInstitutionId(input.entry.institutionRef),
          courseId: makeCourseId(input.entry.courseRef),
          intake: makeIntake(input.entry.intakeRef),
          attemptOrdinal: ordinal,
        }),
      );
      if (holder === null) return found;
      found = { caseId: holder, ordinal };
    }
    return found;
  }

  /**
   * Shows the wait recommendation, and records that it was shown.
   *
   * ADR-0006 rule 4 is advisory in EFFECT and mandatory in PRESENTATION, so
   * this is half of the re-application exchange rather than a convenience: it
   * writes `reapplication_advised` to the conversation log, and `reapply`
   * refuses an instruction that has no such event before it.
   *
   * The recommendation is composed HERE, by `recommendWait`, from the student's
   * asserted outcome. The caller states what happened and nothing else — there
   * is no field through which a client could supply the advice it claims to
   * have shown, which is what makes the record worth having.
   */
  public async adviseReapplication(input: {
    readonly conversationId: string;
    readonly priorOutcome: PriorOutcome;
  }): Promise<
    | { readonly ok: true; readonly advice: WaitRecommendation; readonly priorCaseId: string }
    | { readonly ok: false; readonly refusal: RunRefusal }
  > {
    const bound = await this.#options.bindings.caseFor(input.conversationId);
    if (bound === null || bound.blueprintId === null) {
      return { ok: false, refusal: { kind: "unknown_conversation" } };
    }
    // ── The target comes from the BINDING, not from the caller ──────────
    //
    // ADR-0058's reasoning, one step further on. The conversation reached this
    // route by asking to apply to a verified offer and being refused, and the
    // binding records which target that was. Taking a `blueprintId` here would
    // reopen the gate that decides which application a student is talking
    // about, on a route whose whole subject is one they already have.
    const entry = await this.#options.catalogue.find(bound.blueprintId);
    if (entry === null) return { ok: false, refusal: { kind: "unknown_blueprint" } };

    const latest = await this.#latestAttempt({
      studentRef: makeStudentId(bound.studentId),
      entry,
    });
    if (latest === null) return { ok: false, refusal: { kind: "no_prior_application" } };

    // ── No `nextIntake`, and that is deliberate ─────────────────────────
    //
    // `recommendWait` advises a specific later intake when it is given one, and
    // this service has no way to know that one is open: the catalogue port here
    // resolves a blueprint by id and does not list. Advising a student to wait
    // for the 2028 intake of a course whose 2028 intake nobody has reviewed
    // would be the system inventing a fact about the world, which is the one
    // thing this repository does not do. `six_months` is what we can say
    // truthfully, so it is what we say.
    const advice: WaitRecommendation = {
      ...recommendWait({
        priorOutcome: {
          outcome: input.priorOutcome,
          assertedBy: "student",
          assertedAt: this.#options.now(),
        },
        currentIntake: makeIntake(entry.intakeRef),
      }),
      shownAt: this.#options.now(),
    };

    // The structured record, then the words. Both, in that order, for the
    // reason the value exchange writes `value_asked` before its question: the
    // fact that we advised must survive a crash between the two, and an
    // assistant message with no record of what it was is prose nobody can act
    // on.
    await this.#options.conversations.append({
      conversationId: input.conversationId,
      event: {
        kind: "reapplication_advised",
        priorCaseId: latest.caseId,
        priorOutcome: input.priorOutcome,
        advice: advice.advice,
        ...(advice.suggestedIntake !== undefined
          ? { suggestedIntake: advice.suggestedIntake }
          : {}),
      },
    });
    await this.#options.conversations.append({
      conversationId: input.conversationId,
      event: { kind: "message", actor: "assistant", content: advice.rationale },
    });

    return { ok: true, advice, priorCaseId: latest.caseId };
  }

  /**
   * Opens a SECOND application, on the student's explicit instruction.
   *
   * ═══════════════════════════════════════════════════════════════════════
   * ADR-0006 §3, as amended in P38: a re-application is a NEW case that
   * references the prior one, not a new attempt ordinal on a concluded case.
   *
   * A second attempt is genuinely a different application — different intake,
   * different deadline, possibly changed entry requirements, and a separate
   * authorisation from the student — and one case holding two sets of each
   * could not state precisely what the student agreed to. It is also the only
   * shape that works: `CONFIRMED` is terminal, terminal states have no outgoing
   * transitions, and a case whose ordinal was bumped in place had no first move.
   *
   * Since a conversation owns at most one case, the new case lives in a NEW
   * conversation — which is exactly where the student already is when they meet
   * `already_applying`.
   * ═══════════════════════════════════════════════════════════════════════
   */
  public async reapply(input: {
    readonly conversationId: string;
    /** The student's own words. ADR-0006 rule 3 refuses an empty one. */
    readonly studentStatement: string;
  }): Promise<RunOutcome> {
    const bound = await this.#options.bindings.caseFor(input.conversationId);
    if (bound === null || bound.blueprintId === null) {
      return { ok: false, refusal: { kind: "unknown_conversation" } };
    }
    // From the binding, for the reason `adviseReapplication` reads it there.
    const entry = await this.#options.catalogue.find(bound.blueprintId);
    if (entry === null) return { ok: false, refusal: { kind: "unknown_blueprint" } };
    const studentRef = makeStudentId(bound.studentId);

    const latest = await this.#latestAttempt({ studentRef, entry });
    if (latest === null) return { ok: false, refusal: { kind: "no_prior_application" } };

    // ── The recommendation, read back rather than taken from the caller ──
    //
    // The one this conversation was actually shown, for THIS prior case. A
    // client cannot supply it: there is no field for it on this method, so
    // "the system must record that it showed the recommendation" cannot be
    // satisfied by a client asserting that it did.
    const shown = await this.#options.conversations.adviceFor(
      input.conversationId,
      latest.caseId,
    );
    if (shown === null) return { ok: false, refusal: { kind: "recommendation_not_shown" } };

    // ── Reconstituted from the log, not carried on the wire ─────────────
    //
    // The advice and the outcome are the log's; the rationale is recomposed by
    // `recommendWait` from them, because it is a pure function of them and a
    // second stored copy of the same sentence is a place for the record and the
    // words to disagree. `shownAt` is the row's own `created_at`, so the domain
    // gate compares the instruction against when the database says we advised.
    const recommendation: WaitRecommendation = {
      ...recommendWait({
        priorOutcome: {
          outcome: shown.priorOutcome,
          assertedBy: "student",
          assertedAt: shown.shownAt,
        },
        currentIntake: makeIntake(entry.intakeRef),
      }),
      shownAt: shown.shownAt,
    };

    const priorEvents = await this.#options.stores.cases.read(latest.caseId);
    if (priorEvents.length === 0) return { ok: false, refusal: { kind: "no_prior_application" } };
    const priorCase = fold(priorEvents);

    const now = this.#options.now();
    const newCaseId = makeCaseId(
      this.#options.newCaseId?.(input.conversationId) ??
        `case_${input.conversationId.toLowerCase()}`,
    );

    const decision = decide(priorCase, {
      kind: "instruct_reapplication",
      // ADR-0006 rule 1. This method is reached only from an authenticated
      // student's own route; nothing else may call it, and the actor is
      // written here rather than passed so that no caller can be another one.
      actor: "student",
      newCaseId,
      instruction: {
        priorOutcome: {
          outcome: shown.priorOutcome,
          // Never a fact this system established (brief §2.8, ADR-0006).
          assertedBy: "student",
          assertedAt: shown.shownAt,
        },
        studentStatement: input.studentStatement,
        instructedAt: now,
        recommendationShown: recommendation,
        // DERIVED, not passed. "Did they proceed despite our advice?" is
        // answered by what we advised and the fact that they instructed one
        // anyway — the same reasoning that makes `priorCaseConcluded` derived
        // rather than a caller's opinion (ADR-0072).
        proceededDespiteRecommendation: recommendation.advice !== "none",
      },
    });
    if (!decision.accepted) {
      const { refusal } = decision;
      return {
        ok: false,
        refusal: {
          kind: "reapplication_refused",
          detail:
            "detail" in refusal ? refusal.detail : `${refusal.refusal.kind}: ${refusal.refusal.detail}`,
        },
      };
    }

    // The instruction goes on the PRIOR case — it is a decision made about that
    // application — and the prior case stays terminal at its own ordinal.
    const instructed = decision.events[0];
    if (instructed?.type !== "ReapplicationInstructed") {
      throw new Error("instruct_reapplication produced something other than its own event");
    }
    await this.#options.stores.cases.append(
      latest.caseId,
      priorCase.sequence,
      stamp({
        caseId: latest.caseId,
        fromSequence: priorCase.sequence,
        payloads: [instructed],
        actor: askimateActor(externalRef(input.conversationId)),
        now,
        nextEventId: (index) => `evt_${latest.caseId}_r${String(priorCase.sequence + index + 1)}`,
      }),
    );

    return await this.#openAndStart({
      conversationId: input.conversationId,
      blueprintId: bound.blueprintId,
      studentStatement: input.studentStatement,
      entry,
      attempt: { kind: "reapplication", priorCase, instructed },
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

    // ── `advance` deliberately has NO held-run guard ────────────────────
    //
    // Measured before it was written, and the measurement is why it is not
    // here: adding one failed five tests that RE-ADVANCE a stopped run on
    // purpose. That is how "the pause is idempotent" is proved — advancing a
    // stopped run raises nothing new (`idempotencyKeyFor`), announces nothing
    // new (`announcedAt`), and stops it again — and how the interview's
    // attempt limit is proved durable.
    //
    // So re-deriving a held run is already a no-op that re-stops it, and the
    // rule that nothing automatic PICKS one up lives where the picking
    // happens: `dueRuns` and `WorkLeaseStore.candidates`, both filtering on
    // `AUTOMATABLE_STATUSES`. What P40 refuses is a STUDENT advancing their
    // application, and that is `recordDecision`'s to refuse.
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

  /**
   * Where a run stands when a PERSON is holding it.
   *
   * The orchestrator is not asked. It answers "what should this run do next"
   * from the profile, the plan and the case — and none of those is why the run
   * stopped, so its answer would name a step the run is not going to take.
   * `specialist` is what is true, and it is the same substitution `runFor`
   * makes for the same reason.
   *
   * `resumed: true`, always. Nothing was created; the student came back to
   * something that was already theirs.
   */
  #heldPosition(
    record: Awaited<ReturnType<WorkflowRunStore["load"]>> & object,
    conversationId: string,
  ): RunOutcome {
    return {
      ok: true,
      position: {
        runId: record.runId,
        caseId: record.caseId,
        conversationId,
        status: record.status,
        phase: record.checkpoint.phase,
        step: "specialist",
        revision: record.revision,
        resumed: true,
        concerns: [],
      },
    };
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
    const deployment = deploymentOf(input.entry);

    const base: RunState = withCheckpoint(
      beginRun({
        inputs: {
          caseId: input.caseId,
          studentRef: input.studentRef,
          blueprint: input.entry.blueprint,
          mappingSet: input.entry.mappingSet,
          // Where the run is actually made to, when the entry names a
          // deployment (P74). The preview's destination, and so part of the
          // hash the student's authorisation covers.
          ...(deployment === undefined ? {} : { portalHost: deployment.portalHost }),
          // What the student holds, named in the preview they authorise
          // (ADR-0097). Read now, from the metadata store, and never kept.
          documents: previewDocumentsOf(
            this.#options.heldDocuments === undefined
              ? []
              : await this.#options.heldDocuments.listForStudent(input.studentRef),
          ),
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
    const withTheSecret: RunState =
      secret === null
        ? base
        : withSecret(base, { ...secret, ...requestedAtOf(events, secret.requestId) });

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
    const filledOrNot: RunState = await this.#markFilledIfDone(
      authorised,
      input.record.runId,
      input.entry,
    );

    // ── And whether a runner still holds its session (ADR-0101 §2, §3) ───
    //
    // The fourth of the same shape. From the runners' reports and the one
    // ceiling, not from any runner's memory; absent a session store the run
    // is not tracked and fills as before.
    const state: RunState = await this.#withSessionIfTracked(
      filledOrNot,
      input.record.runId,
      now,
    );

    // THE decision. Made by the orchestrator, on a pure function, from state
    // this service loaded and did not interpret.
    const step: RunStep = await nextStep(state, this.#options.model);

    return { ok: true, step, now, secret, account: state.account, state };
  }

  /** What the session store says, applied through the orchestrator's one writer. */
  async #withSessionIfTracked(state: RunState, runId: RunId, now: Date): Promise<RunState> {
    const sessions = this.#options.sessions;
    if (sessions === undefined) return state;
    return withSession(state, { signedIn: await sessions.signedIn(runId, now) });
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
      // When it came to be, from the ledger's own completion — what tells a
      // sign-in's request from the creation's (ADR-0101 §3).
      ...(found?.completed === undefined ? {} : { createdAt: found.completed.completedAt }),
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
  ): Promise<{
    action: ConsequentialAction;
    target: string;
    verdict: "verify_first" | "escalate";
  } | null> {
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
        return { action: ACTION_FOR_WORK[kind], target, verdict: verdict.kind };
      }
    }
    // And one intent PER ATTACHMENT (ADR-0069's third layer, P73). A file
    // whose attaching may or may not have landed is a disclosure nobody can
    // account for, and the same stop applies.
    if (kind === "execute") {
      for (const target of await this.#attachmentTargets(runId, entry)) {
        const verdict = await this.#verdictFor(runId, "attach_document", target);
        if (verdict.kind === "verify_first" || verdict.kind === "escalate") {
          return { action: "attach_document", target, verdict: verdict.kind };
        }
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
      // Announced off the HOP, below, once it is accepted and written.
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
        // The hop was somebody else's. Theirs to announce, not this caller's.
        continue;
      }

      // ── The one pause that used to say nothing ────────────────────────
      //
      // ADR-0059. Every other stop in this system announces itself —
      // `pauseMessage`, `resumeMessage`, `reviewMessage`, a handoff's own
      // message, an interview question. The authorisation gate did not, so a
      // student watching the conversation saw it fall silent at the single
      // moment it needed them.
      //
      // Hung off the ACCEPTED HOP rather than off the step, because the hop
      // into this state happens exactly once: a re-advance finds `hop === null`
      // and returns above, and a lost race `continue`s without announcing. That
      // is what makes this idempotent without a marker column.
      //
      // It carries NO preview content. The preview is a live projection served
      // by its own route and written nowhere — putting it in a message is the
      // act `SubmissionPreview.toJSON()` throws to prevent.
      if (hop === "AWAITING_STUDENT_AUTHORISATION") {
        await this.#options.conversations.append({
          conversationId: input.conversationId,
          event: {
            kind: "message",
            actor: "assistant",
            content: READY_TO_APPROVE,
          },
        });
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
        // The page for a page; the WHOLE target for an attachment, because
        // `page/field=documentId@hash` is the identity a specialist verifies
        // against the portal (ADR-0069), and the hash is the half that says
        // which version of the file.
        target: input.action === "advance_portal_page" ? pageOf(input.target) : input.target,
        phase: input.record.checkpoint.phase,
        pagesCompleted: [],
        capturedAt: now,
        ...(input.action === "advance_portal_page" ? { page: input.target } : {}),
        ...(input.action === "attach_document"
          ? { page: input.target.slice(0, Math.max(0, input.target.indexOf("/"))) }
          : {}),
      },
      raisedAt: now,
    };
  }

  /**
   * Where this conversation's run stands. A READ, and only a read.
   *
   * ═══════════════════════════════════════════════════════════════════════
   * ADR-0060. Until this existed, `POST .../runs` was the only way to learn a
   * run's position — and it needs an `offerHash`. So a client that reloaded
   * the page had to keep the run id, the step and the offer hash in browser
   * storage to know what to draw, which would make the CLIENT a durable holder
   * of workflow identity. This removes the reason to cache any of it.
   * ═══════════════════════════════════════════════════════════════════════
   *
   * ── It does not advance the run ──────────────────────────────────────
   *
   * No checkpoint is saved, no case hop is walked, no event is appended and no
   * message is announced. `#situation` computes from the durable record, the
   * confirmed profile and the conversation log, and writes nothing — which is
   * what `previewFor` already depends on. A `GET` that advanced a run would
   * make LOOKING at an application a consequential act.
   *
   * `null` means this conversation has no run yet. A real answer, and a
   * different one from "not your conversation" — which the route reports as a
   * 404 before ever reaching here.
   */
  public async runFor(conversationId: string): Promise<RunReading | null> {
    const bound = await this.#options.bindings.caseFor(conversationId);
    if (bound === null || bound.blueprintId === null) return null;
    const entry = await this.#options.catalogue.find(bound.blueprintId);
    if (entry === null) return null;
    const held = await this.#options.stores.runs.findByCase(makeCaseId(bound.caseId));
    const record = held[0];
    if (record === undefined) return null;

    // ONE situation, for both halves of the answer. Computing it twice — once
    // for the position and once for what the run is waiting for — would be two
    // derivations able to disagree with each other between the two calls.
    const situation = await this.#situation({
      entry,
      record,
      conversationId,
      caseId: record.caseId,
      studentRef: record.studentRef,
    });
    const pending = situation.ok
      ? await this.#pendingDecision(record.caseId, conversationId, situation.step)
      : null;
    const run: RunPosition = {
      runId: record.runId,
      caseId: record.caseId,
      conversationId,
      status: record.status,
      phase: record.checkpoint.phase,
      // The orchestrator's answer where there is one. The only way to refuse
      // here is an unusable mapping set, which is a specialist's problem and
      // has the orchestrator's own word for it — the same reading the run
      // route gives that refusal when it answers 503. Reporting the last step
      // instead would say the run is somewhere it is not.
      // ── One answer about where a run is (P40) ────────────────────────
      //
      // A run a PERSON holds reports `specialist` whatever the orchestrator
      // would say, because the orchestrator answers "what should this run do
      // next" from the profile, the plan and the case — none of which is why
      // it stopped. `start` makes the same substitution through
      // `#heldPosition`, so the read and the start cannot disagree about a
      // student's own application.
      //
      // The refusal case reports it too, for the reason it always has: an
      // unusable mapping set is a specialist's problem.
      step: isHeldByAPerson(record.status) || !situation.ok ? "specialist" : situation.step.kind,
      revision: record.revision,
      // Never `false`. This read did not start anything, and a client that
      // saw `resumed: false` from a GET could reasonably conclude it had.
      resumed: true,
      concerns: [],
    };
    // ADR-0108: what is owed, from the case log — the same record a
    // specialist reads, and the one the student's word closes.
    const events = await this.#options.stores.cases.read(record.caseId);
    const ownActs = events.length === 0 ? [] : ownActReadingsOf(fold(events).ownActs);
    return { run, pending, ownActs };
  }

  /**
   * What the run is waiting for the student to do, and the hash that decision
   * must carry. ADR-0061.
   *
   * ═══════════════════════════════════════════════════════════════════════
   * Every hash here comes from the SAME source the decision route validates
   * against, and that is the whole design:
   *
   *   confirm_value     `openProposal(log).playbackHash` — the hash written
   *                     when the reading was put to them, which is what
   *                     `#confirmValue` compares against. Never a re-render:
   *                     a re-render asks the model again and could differ
   *                     from what they read.
   *   authorise         `step.preview.contentHash` — the same field
   *                     `#authorisationIntent` compares against.
   *   confirm_handoff   `hashOfText(handoffMessageOf(step))` — the same
   *                     derivation `#handoffIntent` makes, under the same two
   *                     conditions: the case has an open handoff token AND the
   *                     step is asking for one.
   * ═══════════════════════════════════════════════════════════════════════
   *
   * ── Why the server publishes this at all ────────────────────────────────
   *
   * `confirm_handoff`'s hash is over a message the ORCHESTRATOR renders, not
   * over anything in the log. A client could only produce it by
   * re-implementing `handoffMessageOf` and `hashOfText` and then guessing
   * which message in the transcript was the handoff one. That is a client
   * holding workflow logic, and it gets the answer wrong the moment any other
   * message arrives after the handoff — which one now does, because the
   * authorisation announcement (ADR-0059) is also an assistant message.
   *
   * This replaced `handoffHashFor`, which was public, said in its own comment
   * that *"the client needs the same number to send back"*, had one caller —
   * a test — and no route. It also omitted the open-token check, so it could
   * answer with a hash for a handoff the case was not waiting on.
   *
   * `cancel` is deliberately absent: ADR-0053 makes it available at every
   * step and it carries no hash, so it is not something the run is *waiting*
   * for. A client offers it always, not because a read said so.
   */
  async #pendingDecision(
    caseId: CaseId,
    conversationId: string,
    step: RunStep,
  ): Promise<PendingDecision | null> {
    if (awaitsStudentAuthorisation(step)) {
      return { decision: "authorise", contentHash: step.preview.contentHash };
    }

    if (handoffFor(step) !== null) {
      // ── BOTH conditions, exactly as `#handoffIntent` requires them ────
      //
      // The token says the case is waiting on something; the message says what
      // the student is looking at.
      //
      // MEASURED: the second condition is currently unreachable on its own.
      // Removing the token check broke no test, because the account's handoff
      // stage is DERIVED from `HandoffCompleted` — close the token and the
      // step stops asking in the same breath (`does NOT ask again after a
      // restart` is the test that says so). Probing it directly confirmed it:
      // completing the handoff in the case log moved the step straight to
      // `authorise` without the run being advanced at all.
      //
      // It is kept anyway, and not as decoration. This read must agree with
      // the validator BY CONSTRUCTION rather than by the coincidence that two
      // things happen to move together today; a step that ever became sticky —
      // cached on the checkpoint, say — would make the two diverge, and the
      // symptom would be a client offered a decision the route refuses
      // `not_asked`. `handoffHashFor` omitted it and got away with it for the
      // same reason, which is not a reason.
      const events = await this.#options.stores.cases.read(caseId);
      const open = events.length === 0 ? undefined : fold(events).openHandoffToken;
      const message = handoffMessageOf(step);
      if (open !== undefined && message !== null) {
        return { decision: "confirm_handoff", contentHash: hashOfText(message) };
      }
      return null;
    }

    // An open reading outranks nothing else: it can only exist while the run
    // is interviewing, and the two above are later steps.
    const open = openProposal(await this.#options.conversations.since(conversationId, 0));
    return open === null
      ? null
      : { decision: "confirm_value", contentHash: open.playbackHash };
  }

  /**
   * What this run would show the student right now, and its hash — or `null`.
   *
   * ═══════════════════════════════════════════════════════════════════════
   * ADR-0059. The read behind `GET .../runs/{runId}/preview`, and the reason
   * it returns BOTH halves from ONE call: `presentedText` and `contentHash`
   * come off the same `authorise` step, so what the student reads and what
   * they authorise cannot come from two different renderings.
   *
   * It was `previewHashFor`, returning the hash alone. Nothing in production
   * called it — only tests — and the tests that completed an authorisation
   * did so by REBUILDING the preview themselves from the blueprint, the
   * mapping set and the plan. A browser holds none of those and must not, so
   * the gate was passable by the test suite and by nothing else.
   * ═══════════════════════════════════════════════════════════════════════
   *
   * `presentedText` is the orchestrator's own `renderPreview` output, carried
   * on the step. This method renders nothing: a second rendering here is
   * exactly the drift the single-call shape exists to prevent.
   *
   * `null` means there is nothing to show — no case, no run, or a run that is
   * not standing at the authorisation gate. Callers report that as a 404
   * rather than an empty preview, because "there is nothing to approve" and
   * "here is an empty application" are different facts.
   */
  /**
   * Hands a runner ONE document for ONE upload of the work it holds — after
   * the gates. ADR-0099, slice c of the attachment path.
   *
   * ═══════════════════════════════════════════════════════════════════════
   * The order is the argument, and every step is a refusal rather than a
   * fallback:
   *
   *   1. the caller holds the lease on this run (ADR-0045);
   *   2. the run is at `execute`, and the plan names this `documentRef`;
   *   3. the case carries a captured, un-voided authorisation, and the
   *      preview the orchestrator would render NOW hashes to it — so what was
   *      said yes to is what is about to leave (ADR-0057, ADR-0059);
   *   4. a `DisclosureRequestRecord` is built from what the student actually
   *      saw — the preview text, the document it named, the destination it
   *      named, the case — and `authoriseDisclosure` runs (ADR-0022,
   *      ADR-0087 determination 3, ADR-0098);
   *   5. `mayTransmit` runs WITH THE CASE (ADR-0069);
   *   6. only then is a sixty-second retrieval URL minted.
   *
   * The runner re-runs 4 and 5 on its own machine before attaching. Nothing
   * here reads a byte: the vault is asked for a URL, and the bytes go from the
   * bucket to the runner's browser.
   * ═══════════════════════════════════════════════════════════════════════
   */
  public async documentForWork(input: {
    readonly runId: string;
    readonly leaseId: string;
    readonly holder: string;
    readonly documentRef: string;
  }): Promise<{ readonly ok: true; readonly document: WorkDocument } | { readonly ok: false; readonly refusal: WorkDocumentRefusal }> {
    const leases = this.#options.leases;
    const disclosure = this.#options.disclosure;
    if (leases === undefined || disclosure === undefined) return { ok: false, refusal: "no_disclosure_port" };
    const now = this.#options.now();

    // 1 · The lease. The capability, not the run id.
    const held = await leases.held(input.runId, now);
    if (held === null || held.leaseId !== input.leaseId || held.holder !== input.holder) {
      return { ok: false, refusal: "not_holder" };
    }

    const record = await this.#options.stores.runs.load(makeRunId(input.runId));
    if (record === null) return { ok: false, refusal: "no_such_run" };
    const conversationId = await this.#options.bindings.conversationForCase(record.caseId);
    if (conversationId === null) return { ok: false, refusal: "no_such_run" };
    const bound = await this.#options.bindings.caseFor(conversationId);
    if (bound === null || bound.blueprintId === null) return { ok: false, refusal: "no_such_run" };
    const entry = await this.#options.catalogue.find(bound.blueprintId);
    if (entry === null) return { ok: false, refusal: "no_such_run" };

    // 2 · The work, as the orchestrator sees it now.
    const situation = await this.#situation({
      entry,
      record,
      conversationId,
      caseId: record.caseId,
      studentRef: record.studentRef,
    });
    if (!situation.ok) return { ok: false, refusal: "not_executing" };
    // The orchestrator's narrowing, not a comparison on a step's kind here
    // (`check-boundaries`): execute work is what `executePlanOf` says it is.
    const plan = executePlanOf(situation.step);
    if (plan === null) return { ok: false, refusal: "not_executing" };
    const upload = plan.uploads.find((u) => u.documentRef === input.documentRef);
    if (upload === undefined) return { ok: false, refusal: "no_such_upload" };

    // 3 · The yes, and that it still covers what would leave.
    //
    // A SECOND reading of that fact. `#situation` above already refused a run
    // whose yes no longer matches — the orchestrator's step is `authorise`,
    // not `execute`, and step 2 answered `not_executing`. The comparison
    // below reads the same log and builds the same preview, so it can only
    // disagree with the orchestrator in a race between the two reads. The
    // P77 audit removed it and no test could tell (M10); it is kept as the
    // belt to that brace, and this comment is the honest record of what it
    // adds: nothing a test can see, and one more place a substitution has
    // to get past.
    const events = await this.#options.stores.cases.read(record.caseId);
    let captured: { contentHash: string; authorisedAt: Date } | null = null;
    for (const event of events) {
      if (event.type === "AuthorisationCaptured") {
        captured = { contentHash: event.contentHash, authorisedAt: event.authorisedAt };
      } else if (event.type === "AuthorisationVoided" && captured?.contentHash === event.previousContentHash) {
        captured = null;
      }
    }
    if (captured === null) return { ok: false, refusal: "not_authorised" };
    const held_documents = await this.#options.heldDocuments?.listForStudent(record.studentRef);
    const preview = buildPreview(
      entry.blueprint,
      plan,
      previewDocumentsOf(held_documents ?? []),
      deploymentOf(entry),
    );
    if (!preview.built) return { ok: false, refusal: "content_changed" };
    if (preview.preview.contentHash !== captured.contentHash) return { ok: false, refusal: "content_changed" };
    const attachment = preview.preview.attachments.find((a) => a.documentRef === input.documentRef);
    if (attachment === undefined) return { ok: false, refusal: "no_such_upload" };
    const stored = (held_documents ?? []).find((r) => r.documentId === attachment.document.documentId);
    if (stored === undefined) return { ok: false, refusal: "content_changed" };

    // 4 · The disclosure, from what the student saw.
    const determination = disclosure.register.forActivity(DISCLOSURE_ACTIVITY);
    if (determination === undefined) return { ok: false, refusal: "disclosure_refused" };
    const caseState = events.length === 0 ? null : fold(events);
    const request: DisclosureRequestRecord = {
      disclosureId: `disc_${input.runId}_${upload.fieldRef}`,
      subject: {
        documentId: attachment.document.documentId,
        documentType: attachment.document.describedAs,
        contentHash: attachment.document.contentHash,
        caseId: record.caseId,
        requestedFor: upload.label,
      },
      destination: {
        institutionName: preview.preview.institutionName,
        portalHost: preview.preview.portalHost,
      },
      determination,
      studentAuthorisation: {
        studentRef: record.studentRef,
        presentedText: renderPreview(preview.preview),
        authorisedAt: captured.authorisedAt,
        method: "chat_affirmation",
      },
      // A case a minor-safeguarding trigger is holding has conditions nobody
      // has determined yet: an EMPTY set, which `authoriseDisclosure` refuses
      // as undetermined rather than reading as "none apply" (ADR-0011).
      ...(caseState?.activeTriggers.includes("involves_minor") === true ? { minorConditions: [] } : {}),
    };
    const authorised = authoriseDisclosure(request);
    if (!authorised.authorised) return { ok: false, refusal: "disclosure_refused" };

    // 5 · The transmission gate, with the case.
    const permission = mayTransmit({
      authorisation: authorised.authorisation,
      forCase: record.caseId,
      documentId: attachment.document.documentId,
      contentHash: attachment.document.contentHash,
      toHost: preview.preview.portalHost,
      // Nothing produces a WithdrawalRecord yet: a student's "I have changed
      // my mind" voids the fill authorisation (AuthorisationVoided), which
      // step 3 already refuses on. Recorded here so the gap is visible.
      withdrawals: [],
    });
    if (!permission.permitted) return { ok: false, refusal: "transmission_refused" };

    // 6 · The URL. Sixty seconds, one GET, minted only now.
    const retrieval = await disclosure.vault.prepareRetrieval(attachment.document.documentId, now);
    return {
      ok: true,
      document: {
        documentId: attachment.document.documentId,
        documentType: stored.documentType,
        contentHash: attachment.document.contentHash,
        contentType: stored.contentType,
        retrieval: { url: retrieval.url, method: "GET", expiresAt: retrieval.expiresAt.toISOString() },
        disclosure: {
          disclosureId: request.disclosureId,
          subject: request.subject,
          destination: request.destination,
          determinationId: determinationOf(determination).determinationId,
          studentAuthorisation: {
            studentRef: String(record.studentRef),
            presentedText: request.studentAuthorisation?.presentedText ?? "",
            authorisedAt: captured.authorisedAt.toISOString(),
            method: "chat_affirmation",
          },
        },
      },
    };
  }

  public async previewFor(
    runId: string,
    conversationId: string,
  ): Promise<{ readonly contentHash: string; readonly presentedText: string } | null> {
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
    return {
      contentHash: situation.step.preview.contentHash,
      presentedText: situation.step.presentedText,
    };
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

    // ── The student's word on something they owe (ADR-0108) ──────────────
    //
    // Before the run's situation is asked, because the situation is about
    // what the run does next and this is not that: an act recorded at the
    // yes is closable whatever the run is doing, including after it has
    // finished and the account is theirs. Only the case log is consulted; a
    // key the case never recorded is refused, and a second word is one.
    if (input.decision.kind === "attached_myself") {
      const log = await this.#options.stores.cases.read(record.caseId);
      if (log.length === 0) return { ok: false, reason: "no_case" };
      const owed = fold(log);
      const item = input.decision.item;
      const act = owed.ownActs.find((candidate) => candidate.key === item);
      if (act === undefined) return { ok: false, reason: "not_asked" };
      if (act.doneAt !== undefined) return { ok: true };
      await this.#appendToCase(
        record.caseId,
        owed.sequence,
        [{ type: "OwnActDone", key: act.key, doneAt: this.#options.now() }],
        { conversationId: input.conversationId, caseId: record.caseId },
        this.#options.now(),
      );
      return { ok: true };
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
    //
    // BEFORE the specialist guard below, and that order is the decision: a
    // student who wants out while a person is looking at their application is
    // exactly who a stop button is for.
    if (input.decision.kind === "cancel") {
      return await this.#cancel(input.conversationId, record, held);
    }

    const intent =
      input.decision.kind === "authorise"
        ? this.#authorisationIntent(situation.step, input.decision)
        : this.#handoffIntent(situation.step, held, input.decision);
    if (!intent.ok) return this.#refusal(intent.reason, record.status);

    const decided = decide(held, intent.intent);
    if (!decided.accepted) return this.#refusal("refused", record.status);

    // ADR-0108: with the yes, what the student owes goes on the record — from
    // the preview they authorised, which is the one thing the hash binds.
    const owed: CaseEventPayload[] =
      input.decision.kind === "authorise" && situation.step.kind === "authorise"
        ? situation.step.preview.handoffs.map((handoff) => ({
            type: "OwnActRecorded",
            key: ownActKeyOf(handoff),
            label: handoff.label,
            ...(handoff.item === undefined ? {} : { page: handoff.item.title, entry: { index: handoff.item.index, count: handoff.item.count } }),
            ...(handoff.deferred === undefined
              ? {}
              : {
                  told: {
                    fieldRef: handoff.deferred.fieldRef,
                    text: handoff.deferred.text,
                    ...(handoff.deferred.displayText === undefined ? {} : { displayText: handoff.deferred.displayText }),
                  },
                }),
          }))
        : [];
    await this.#appendToCase(
      record.caseId,
      held.sequence,
      [...decided.events, ...owed],
      { conversationId: input.conversationId, caseId: record.caseId },
      this.#options.now(),
    );
    return { ok: true };
  }

  /**
   * Names a refusal for the caller, WITHOUT changing who made it.
   *
   * ═══════════════════════════════════════════════════════════════════════
   * P40. Vahid: "The student cannot advance the application while the
   * escalation is open. Advancing intents are refused with a stated reason,
   * not an error."
   *
   * The reason was already there and the caller could not read it. Both
   * `not_asked` and `refused` reached the route as a **404**, which tells a
   * student their application does not exist — for a state that clears itself
   * when a person finishes looking, and that they were told about in the
   * conversation when it started.
   * ═══════════════════════════════════════════════════════════════════════
   *
   * This does NOT decide the refusal. `decide` refuses a mandatory review, and
   * that has to stay true: `recordDecision`'s `!decided.accepted` branch is
   * reachable in exactly one case — the run standing at `authorise` while the
   * financial-evidence or minor guard holds the case — and P11's regression
   * pass found that swallowing the domain's refusal changed nothing precisely
   * because nothing else reached it. A guard placed BEFORE the domain would
   * take that back, and would make this coordinator the thing that refuses a
   * mandatory-review approval. It is not, and must not become it.
   *
   * What it changes is the NAME the caller gets, when the true and useful
   * thing to say is "a person is looking at this". The domain's own detail is
   * not publishable — there is nowhere on the wire for a sentence (ADR-0031) —
   * so the choice is between a fact the student can act on and a 404.
   *
   * `content_changed` keeps its own name whatever is holding the run: it is
   * the one refusal a client can fix by itself, by re-rendering and asking
   * again.
   */
  #refusal(
    reason: DecisionRefusalReason,
    status: WorkflowStatus,
  ): { readonly ok: false; readonly reason: DecisionRefusalReason } {
    if (reason === "content_changed" || !isHeldByAPerson(status)) {
      return { ok: false, reason };
    }
    return { ok: false, reason: "held_for_specialist" };
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
    // The field is settled, so the interview wants the next one. Asked here
    // rather than left to the next advance, because a client that has just
    // confirmed a reading does not advance the run — it re-READS it (ADR-0060),
    // and a read must not append. Without this the journey stalls on a screen
    // that says `interviewing` and asks nothing.
    await this.#askAfterWriting(conversationId);
    return { ok: true };
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
   * Tells a SPECIALIST that a run is waiting for one (ADR-0071).
   *
   * ═══════════════════════════════════════════════════════════════════════
   * The gap this closes: every part of the recovery design — stop at the
   * failure point, record what was encountered and expected, adjudicate,
   * resume from the intent ledger — was built and tested, and it all waited on
   * somebody thinking to run a CLI. A stopped run was durable and discoverable
   * and it told nobody who could act on it.
   * ═══════════════════════════════════════════════════════════════════════
   *
   * Deliberately parallel to `announcePending` in shape and different in every
   * particular: a different audience, a different channel, a different marker,
   * and a payload that carries none of what the student's message carries.
   *
   * ── Send first, mark second ─────────────────────────────────────────────
   *
   * The order `announcePending` uses, for the same reason: a crash between them
   * pages somebody twice, which is a much smaller failure than a stopped run
   * nobody hears about. `markNotified` is idempotent, so the duplicate does not
   * move the recorded time.
   *
   * ── One failure does not stop the batch ─────────────────────────────────
   *
   * A notifier that throws leaves THAT intervention unmarked and the loop
   * carries on. The alternative — abandoning the pass — would let one
   * intervention whose delivery always fails permanently suppress every notice
   * behind it, which is the original failure with an extra step.
   */
  public async notifyPending(limit = 25): Promise<{ readonly notified: number }> {
    const interventions = this.#options.interventions;
    const notifier = this.#options.notifier;
    if (interventions === undefined || notifier === undefined) return { notified: 0 };

    let notified = 0;
    for (const held of (await interventions.open()).slice(0, limit)) {
      if (held.notifiedAt !== undefined) continue;
      try {
        await notifier.notify(noticeFor(held));
      } catch {
        // Left unmarked on purpose: the next pass tries again. The error is not
        // logged here because this method has no logger and inventing one in
        // the driver would put an outbound endpoint's message into a log line
        // this file does not own. The worker reports the failed job.
        continue;
      }
      await interventions.markNotified(held.interventionId, this.#options.now());
      notified += 1;
    }
    return { notified };
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
      // Not read at all. Nothing is written about the ANSWER, because nothing
      // was understood — but the student is owed the question again, composed
      // fresh with the attempt count `nextAction` can see. Their message closed
      // the outstanding one (ADR-0062), so this asks rather than no-ops.
      await this.#askTheStudent(input.conversationId, situated.step);
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

  /**
   * Puts the outstanding question to the student (ADR-0062).
   *
   * ═══════════════════════════════════════════════════════════════════════
   * `nextAction` composed this question during step derivation and the step
   * carries it. Before ADR-0062 the driver threw it away, so a student at
   * `interviewing` saw a screen with nothing on it to answer: the interview
   * was a conversation with one voice.
   *
   * The text is the STEP's own. Composing a second one here would risk asking
   * a different question from the one the step is waiting on — the drift
   * ADR-0059 refused for the preview and ADR-0051 refused for the playback.
   * ═══════════════════════════════════════════════════════════════════════
   *
   * Two writes, in the order `#putToTheStudent` uses: the structured record
   * first, then the words. A crash between them leaves a `value_asked` with no
   * message, which the next advance cannot re-ask — so the marker is written
   * only where the message is about to be, and the reverse order would leave a
   * question the log does not know was asked.
   *
   * Under the conversation's row lock with the log re-read INSIDE it, for the
   * reason `#openSecureStep` takes that lock: two callers advancing the same
   * conversation can both hold a valid run revision — the second loads the
   * record after the first has checkpointed, so the optimistic lock never
   * fires — and both would otherwise find no open question and both ask.
   */
  async #askTheStudent(conversationId: string, step: RunStep): Promise<void> {
    const action = interviewActionOf(step);
    if (action === null || action.kind !== "ask") return;

    await this.#options.bindings.withConversationLock(conversationId, async (): Promise<null> => {
      const events = await this.#options.conversations.since(conversationId, 0);
      // A question already stands, or a reading is waiting to be confirmed.
      // Either way this run is not short of something for the student to do,
      // and asking again would be the service talking over itself.
      if (openQuestion(events) !== null || openProposal(events) !== null) return null;

      await this.#options.conversations.append({
        conversationId,
        event: { kind: "value_asked", fieldKey: action.fieldKey },
      });
      await this.#options.conversations.append({
        conversationId,
        event: { kind: "message", actor: "assistant", content: action.say },
      });
      return null;
    });
  }

  /**
   * Re-derives where the interview stands and asks, if it is asking.
   *
   * For the two callers that have just WRITTEN something the interview turns
   * on — a confirmed reading, or a student message that could not be read. The
   * step they were handed is the one from before that write, so it has to be
   * derived again or the question would be about the field just finished.
   */
  async #askAfterWriting(conversationId: string): Promise<void> {
    const situated = await this.#interviewSituation(conversationId);
    if (situated === null) return;
    // ── Ask, or STOP. Never neither (ADR-0064) ─────────────────────────
    //
    // The interview's next move is one of five kinds and only `ask` is a
    // question. If it has decided it cannot obtain something, the run stops
    // HERE — on the message path — because a client that has just sent a
    // message re-READS the run rather than advancing it (ADR-0060), so a stop
    // noticed only while advancing would never fire in the journey a student
    // actually walks.
    const stopped = await this.#stopIfTheInterviewGaveUp(
      {
        entry: situated.entry,
        record: situated.record,
        conversationId,
        caseId: situated.record.caseId,
      },
      situated.step,
      this.#options.now(),
    );
    if (stopped) return;
    await this.#askTheStudent(conversationId, situated.step);
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
    if (outcome.kind !== "corrected") {
      // A rejection is what `attemptsFrom` counts, so THIS is the write that
      // can exhaust a field. Re-deriving here turns the third refusal into a
      // stop rather than into silence.
      await this.#askAfterWriting(conversationId);
      return;
    }

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
   * Stops a run the interview cannot carry any further (ADR-0064).
   *
   * ═══════════════════════════════════════════════════════════════════════
   * `nextAction` returns five kinds. `ask` is asked (ADR-0062), `confirm` is
   * played back (ADR-0051), and `complete` lets the step move on. The other
   * two — `escalate` and `request_document` — WERE DROPPED, silently, by a
   * driver that only ever looked for `ask`.
   *
   * `escalate` is reachable today: three rejected readings of the last
   * outstanding field and `nextAction` decides a specialist must look. Nothing
   * happened. No message, no intervention, no status change — and because
   * `interviewAsk` also only matches `ask`, everything the student said
   * afterwards was ignored too. The run sat at `interview` for ever.
   * ═══════════════════════════════════════════════════════════════════════
   *
   * Both stop the run the same way, because both are one fact: this system
   * cannot obtain something the application needs. That is the literal
   * definition of `information_unobtainable` — "the agent interviewed the
   * student and still cannot obtain what is required" — a reason the domain has
   * carried since P10 with nothing ever raising it.
   *
   * `high`, not `critical`: a stopped application is consuming a deadline, and
   * `recovery.ts` reserves `critical` for one that is imminent. This driver does
   * not know the deadline, so it does not claim to.
   */
  async #stopForUnobtainable(
    input: {
      readonly entry: CatalogueEntry;
      readonly record: Awaited<ReturnType<WorkflowRunStore["start"]>>;
      readonly conversationId: string;
      readonly caseId: CaseId;
      readonly concerns: readonly ResumeConcern[];
      readonly resumed: boolean;
    },
    step: RunStep,
    now: Date,
  ): Promise<RunOutcome | null> {
    const stopped = await this.#stopIfTheInterviewGaveUp(input, step, now);
    if (!stopped) return null;
    return {
      ok: true,
      position: {
        runId: input.record.runId,
        caseId: input.caseId,
        conversationId: input.conversationId,
        status: "escalated",
        phase: input.record.checkpoint.phase,
        step: step.kind,
        revision: input.record.revision,
        resumed: input.resumed,
        concerns: input.concerns,
      },
    };
  }

  /**
   * The stop itself. `true` when this run has been stopped for a person.
   *
   * Separate from the wrapper above because TWO paths reach it and only one is
   * producing a `RunOutcome`. The other is the MESSAGE path: a client that has
   * just sent a message re-READS the run (ADR-0060) rather than advancing it,
   * so an escalation noticed only while advancing would never fire in the
   * journey a student actually walks — the gap ADR-0062 found for the question,
   * one action kind further on.
   *
   * The status is written whether or not an intervention store is configured. A
   * deployment without one must still not leave a run being advanced for ever
   * into a step it can never leave.
   */
  async #stopIfTheInterviewGaveUp(
    input: {
      readonly entry: CatalogueEntry;
      readonly record: Awaited<ReturnType<WorkflowRunStore["start"]>>;
      readonly conversationId: string;
      readonly caseId: CaseId;
    },
    step: RunStep,
    now: Date,
  ): Promise<boolean> {
    const action = interviewActionOf(step);
    if (action === null) return false;
    if (action.kind !== "escalate" && action.kind !== "request_document") return false;

    // `fieldKey` is OPTIONAL on an escalate. Both branches of `nextAction` that
    // produce one set it today, but the type permits its absence and a driver
    // that indexed a label map with `undefined` would crash on the one path
    // that most needs to work. Absent, the stop is still recorded — it just
    // cannot name the field, and says so rather than inventing one.
    const field = action.kind === "escalate" ? action.fieldKey : undefined;
    // What could not be obtained, as a stable identifier a specialist can act
    // on. Never the model's prose: `target` is part of the idempotency key, so
    // a sentence that varied between calls would raise a second intervention
    // for the same stuck field.
    const target =
      action.kind === "escalate"
        ? `interview:${field ?? "unspecified"}`
        : `document:${action.documentType}`;

    await this.#raiseForSpecialist({
      entry: input.entry,
      record: input.record,
      conversationId: input.conversationId,
      caseId: input.caseId,
      priority: "high",
      target,
      encountered: action.reason,
      expected:
        action.kind === "escalate"
          ? `A usable answer for ${field ?? "the outstanding field"}, obtained in conversation ` +
            `with the student.`
          : `The student's ${action.documentType}. THIS SYSTEM CANNOT ACCEPT ONE: there is no ` +
            `upload path, and the disclosure (ADR-0022) and retention (ADR-0023) decisions it ` +
            `depends on are not approved. A person must arrange it outside this service.`,
      message:
        action.kind === "escalate"
          ? unobtainableMessage(
              input.entry,
              field === undefined ? "some of what I need" : FIELD_LABELS[field].toLowerCase(),
            )
          : documentNeededMessage(input.entry, action.documentType),
      now,
    });

    if (input.record.status === "running") {
      await this.#options.stores.runs.saveCheckpoint({
        runId: input.record.runId,
        checkpoint: input.record.checkpoint,
        expectedRevision: input.record.revision,
        status: "escalated",
      });
    }
    return true;
  }

  /**
   * Stops a run the orchestrator has handed to a specialist (ADR-0065).
   *
   * ═══════════════════════════════════════════════════════════════════════
   * `nextStep` returns `{ kind: "specialist", reason, detail }` from TEN
   * places, seven of them reachable, in five kinds of situation: an artefact
   * `assess` refused, a structural blocker the student cannot answer, a
   * validation that did not run, a PREVIEW THAT COULD NOT BE BUILT, and an
   * account step that could not be planned. Every one of them means the same
   * thing — this run cannot go on until a person looks at it.
   *
   * The driver did nothing with any of them. Measured through the real driver
   * on the shipped fixture entry, whose blueprint asks for a passport:
   *
   *     step: specialist   status: running   phase: awaiting_specialist
   *     interventions: 0   last message: ""  still due for the worker: true
   *
   * So the run sat at `specialist` with nobody told and the worker advancing
   * it for ever, deriving the same answer every time and acting on none of it.
   * The same shape as the interview actions ADR-0064 wired up, one level out.
   * ═══════════════════════════════════════════════════════════════════════
   *
   * ── Why this is NOT document handling ────────────────────────────────
   *
   * A required document is one of those routes in — `buildPreview` refuses
   * with `document_missing` when a plan attaches something no document was
   * provided for, and the run driver provides none. Stopping on that refusal
   * needs no document: nothing is accepted, stored, transmitted or retained,
   * so ADR-0022's disclosure determination and ADR-0023's retention basis are
   * not engaged. They govern HOLDING and SENDING a document; this only ever
   * declines to proceed without one.
   *
   * `reason` and `detail` come from the orchestrator and name artefacts — a
   * field ref, a document ref, a label, a violation count. Never a value the
   * student gave, which is why `detail` can go to a specialist as `encountered`
   * exactly as `#pauseForReview` already sends one.
   *
   * The step is recognised by `specialistHandoverOf`, the orchestrator's own
   * narrowing, and not by a comparison here. `specialist` is one kind
   * answering all of them; an eleventh site would have to reach this stop
   * without anyone remembering to widen a condition in the coordinator.
   */
  async #stopForSpecialist(
    input: {
      readonly entry: CatalogueEntry;
      readonly record: Awaited<ReturnType<WorkflowRunStore["start"]>>;
      readonly conversationId: string;
      readonly caseId: CaseId;
      readonly concerns: readonly ResumeConcern[];
      readonly resumed: boolean;
    },
    step: RunStep,
    now: Date,
  ): Promise<RunOutcome | null> {
    const handover = specialistHandoverOf(step);
    if (handover === null) return null;

    await this.#raiseForSpecialist({
      entry: input.entry,
      record: input.record,
      conversationId: input.conversationId,
      caseId: input.caseId,
      priority: "high",
      // Stable, and one intervention per REASON: a run stuck for two different
      // reasons is two things to look at, and a run re-advanced for the same
      // reason is not a second one.
      target: `specialist:${handover.reason}`,
      encountered: handover.detail,
      expected:
        `A specialist reviews the case and the reviewed artefacts behind it, and either supplies ` +
        `what is missing or stops the application. This run cannot proceed on its own.`,
      message: specialistMessage(input.entry),
      now,
    });

    if (input.record.status === "running") {
      await this.#options.stores.runs.saveCheckpoint({
        runId: input.record.runId,
        checkpoint: input.record.checkpoint,
        expectedRevision: input.record.revision,
        status: "escalated",
      });
    }

    return {
      ok: true,
      position: {
        runId: input.record.runId,
        caseId: input.caseId,
        conversationId: input.conversationId,
        status: "escalated",
        phase: input.record.checkpoint.phase,
        step: step.kind,
        revision: input.record.revision,
        resumed: input.resumed,
        concerns: input.concerns,
      },
    };
  }

  /**
   * Raises an intervention a specialist can pick up, and tells the student once.
   *
   * ═══════════════════════════════════════════════════════════════════════
   * ONE mechanism, two callers. A mandatory review and an interview that has
   * run out of ways to obtain something stop a run for different reasons and
   * say different things, but "a run is waiting for a person" is a single fact
   * with a single home — ADR-0048's intervention store. A second construction
   * of it would be a second way for a run to be waiting, and the two could
   * disagree about which runs those are.
   * ═══════════════════════════════════════════════════════════════════════
   *
   * Idempotent by `idempotencyKeyFor`, so re-advancing a stopped run raises
   * nothing new, and announced at most once — `announcedAt` is the guard, the
   * same one `announcePending` uses.
   *
   * The caller owns the run's STATUS. This writes the intervention and the
   * message; it does not decide what the run becomes, because the two callers
   * differ on that and hiding the difference here would make it invisible.
   */
  async #raiseForSpecialist(input: {
    readonly entry: CatalogueEntry;
    readonly record: Awaited<ReturnType<WorkflowRunStore["start"]>>;
    readonly conversationId: string;
    readonly caseId: CaseId;
    readonly priority: "high" | "critical";
    /** What could not be obtained. Also the idempotency key's target. */
    readonly target: string;
    readonly encountered: string;
    readonly expected: string;
    readonly message: string;
    readonly now: Date;
  }): Promise<void> {
    const interventions = this.#options.interventions;
    if (interventions === undefined) return;
    const runId = input.record.runId;
    const idempotencyKey = idempotencyKeyFor({
      runId,
      action: "advance_portal_page",
      target: input.target,
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
        priority: input.priority,
        encountered: input.encountered,
        expected: input.expected,
        checkpoint: {
          blueprintVersion: blueprintVersion(input.entry.blueprint.version),
          action: "advance_portal_page",
          target: input.target,
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
        event: { kind: "message", actor: "assistant", content: input.message },
      });
      await interventions.markAnnounced(raised.interventionId, input.now);
    }
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
      await this.#raiseForSpecialist({
        entry: input.entry,
        record: input.record,
        conversationId: input.conversationId,
        caseId: input.caseId,
        priority: "critical",
        target: `review:${input.triggers.join(",")}`,
        encountered: input.detail,
        expected:
          `An approving human review recorded against every mandatory trigger, before the ` +
          `student is asked to authorise anything.`,
        message: reviewMessage(input.entry),
        now: input.now,
      });
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

  /**
   * Records that a consequential action is about to be attempted.
   *
   * ADR-0054. Three states, and the middle one is why this is a method rather
   * than a call to `recordIntent`:
   *
   *   nothing recorded      → record it. The ordinary first attempt.
   *   completed cleanly     → re-open it. ADR-0047 decided that
   *                           `already_done` + `failed_cleanly` is offered
   *                           again, and the ledger must then say an attempt
   *                           is in flight rather than keep describing the one
   *                           before it. The store refuses to re-open anything
   *                           else, so this cannot resurrect a `succeeded`.
   *   anything else         → `false`. Unreachable through `claimWork`, which
   *                           consults `#unfinishedAction` first — so reaching
   *                           it means a race, and a race is not a licence.
   *
   * The row is ONE per (run, action, target), unchanged: it is the ledger's
   * primary key and what `interventions.idempotency_key` pairs with, so a
   * second attempt cannot become a second row without making it possible to
   * raise a second intervention for one stuck action.
   */
  async #beginIntent(input: {
    readonly runId: RunId;
    readonly action: ConsequentialAction;
    readonly target: string;
    readonly now: Date;
  }): Promise<boolean> {
    const key = idempotencyKeyFor({
      runId: input.runId,
      action: input.action,
      target: input.target,
    });
    const found = await this.#options.stores.runs.findIntent(input.runId, key);
    if (found === null) {
      await this.#options.stores.runs.recordIntent(input.runId, {
        idempotencyKey: key,
        action: input.action,
        target: input.target,
        startedAt: input.now,
      });
      return true;
    }
    return await this.#options.stores.runs.reopenIntent(input.runId, key, input.now);
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
  /**
   * The attachments the run's preview resolves — the documents the student
   * authorised, by identity (ADR-0098). The same resolution `documentForWork`
   * hands a document over by, so the identity in a page's key and in an
   * attachment's intent is the identity the gates ran over.
   */
  async #heldAttachments(
    entry: CatalogueEntry,
    plan: FillPlan,
    studentRef: string,
  ): Promise<readonly PreviewAttachment[]> {
    const held = await this.#options.heldDocuments?.listForStudent(studentRef);
    const preview = buildPreview(entry.blueprint, plan, previewDocumentsOf(held ?? []), deploymentOf(entry));
    return preview.built ? preview.preview.attachments : [];
  }

  /** The `attach_document` targets of every page, for the unfinished-action check. */
  async #attachmentTargets(runId: RunId, entry: CatalogueEntry): Promise<readonly string[]> {
    const usable = checkUsable(entry.mappingSet, entry.blueprint);
    if (!usable.usable) return [];
    const record = await this.#options.stores.runs.load(runId);
    const studentRef = record?.studentRef ?? "";
    const profile = await this.#options.profiles.load(studentRef, this.#options.now());
    const plan = planFill(entry.blueprint, usable.mappingSet, profile);
    const attachments = await this.#heldAttachments(entry, plan, studentRef);
    return entry.blueprint.pages.flatMap((page) =>
      pageAttachmentsOf(
        attachments,
        new Set(page.sections.flatMap((s) => s.fields.map((f) => f.fieldRef))),
      ).map((attachment) => attachmentIntentTarget({ pageRef: page.pageRef, attachment })),
    );
  }

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
    const attachments = await this.#heldAttachments(
      entry,
      plan,
      (await this.#options.stores.runs.load(runId))?.studentRef ?? "",
    );
    return entry.blueprint.pages.map((page) => {
      const fields = new Set(page.sections.flatMap((s) => s.fields.map((f) => f.fieldRef)));
      return pageFillTarget({
        pageRef: page.pageRef,
        values: pageValuesOf(plan, fields),
        attachments: pageAttachmentsOf(attachments, fields),
      });
    });
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
  /** Whether any item of a repeating page is recorded saved (ADR-0103, gap 3). */
  async #anyItemSaved(runId: RunId, entry: CatalogueEntry, plan: FillPlan): Promise<boolean> {
    for (const page of entry.blueprint.pages) {
      if (page.repeats === undefined) continue;
      const fields = new Set(page.sections.flatMap((section) => section.fields.map((f) => f.fieldRef)));
      const count = plan.repeats.find((repeat) => repeat.pageRef === page.pageRef)?.count ?? 0;
      for (let index = 0; index < count; index++) {
        const verdict = await this.#verdictFor(
          runId,
          "advance_portal_page",
          pageFillTarget({ pageRef: page.pageRef, values: pageValuesOf(plan, fields, { index }), item: { index, count } }),
        );
        if (verdict.kind === "already_done" && verdict.outcome === "succeeded") return true;
      }
    }
    return false;
  }

  async #nextPage(
    runId: RunId,
    entry: CatalogueEntry,
    plan: FillPlan,
    attachments: readonly PreviewAttachment[],
  ): Promise<NextPage | null> {
    // A page with something to fill OR something to attach. Until P73 an
    // upload-only page was skipped as having no fields — the documents page
    // of a real portal is exactly that page, and it was never offered.
    const wanted = new Set([
      ...plan.instructions.map((instruction) => instruction.fieldRef),
      ...plan.uploads.map((upload) => upload.fieldRef),
    ]);
    const credentialFields = new Set(plan.credentials.map((credential) => credential.fieldRef));

    for (const page of entry.blueprint.pages) {
      const fields = page.sections.flatMap((section) => section.fields);
      // A page with a credential field is a registration page: the Secure Plane
      // filled the password and account creation submitted it, so it is done
      // before `execute` is ever reached and is not the fill's to do.
      if (fields.some((field) => credentialFields.has(field.fieldRef))) continue;
      if (!fields.some((field) => wanted.has(field.fieldRef))) continue;

      const onThisPage = new Set(fields.map((f) => f.fieldRef));

      // ── ADR-0103 gap 3: a repeating page, once per item ──────────────────
      //
      // Each item is its own target in the ledger: saved once, and the next
      // item is offered until every item is. A page that repeats carries no
      // document slot (`checkUsable` refused one), so its items have no
      // attachments to check.
      if (page.repeats !== undefined) {
        const count = plan.repeats.find((repeat) => repeat.pageRef === page.pageRef)?.count ?? 0;
        for (let index = 0; index < count; index++) {
          const item = { index, count };
          const verdict = await this.#verdictFor(
            runId,
            "advance_portal_page",
            pageFillTarget({ pageRef: page.pageRef, values: pageValuesOf(plan, onThisPage, item), item }),
          );
          if (verdict.kind === "already_done" && verdict.outcome === "succeeded") continue;
          return { page, item };
        }
        continue;
      }

      const attached = pageAttachmentsOf(attachments, onThisPage);
      const verdict = await this.#verdictFor(
        runId,
        "advance_portal_page",
        pageFillTarget({
          pageRef: page.pageRef,
          values: pageValuesOf(plan, onThisPage),
          // In the key (ADR-0069, P73): a replaced document makes this a
          // page not yet saved, and it is offered again.
          attachments: attached,
        }),
      );
      // A page is done only when every document it carries is recorded as
      // attached. A page saved with an attachment the report did not name
      // is offered again — and the claim stops on the open intent, which is
      // the uncertain case a person adjudicates, not a page to skip past.
      if (verdict.kind === "already_done" && verdict.outcome === "succeeded") {
        let attachmentsDone = true;
        for (const attachment of attached) {
          const attachVerdict = await this.#verdictFor(
            runId,
            "attach_document",
            attachmentIntentTarget({ pageRef: page.pageRef, attachment }),
          );
          if (attachVerdict.kind !== "already_done" || attachVerdict.outcome !== "succeeded") {
            attachmentsDone = false;
            break;
          }
        }
        if (!attachmentsDone) return { page };
      }
      // `failed_cleanly` is a claim that nothing happened out there, so the page
      // is offered again. `already_done` + `succeeded` is skipped. The unfinished
      // verdicts never reach here — `#unfinishedAction` stopped the run.
      if (verdict.kind === "already_done" && verdict.outcome === "succeeded") continue;
      return { page };
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
    const attachments = await this.#heldAttachments(entry, plan, state.inputs.studentRef);
    if ((await this.#nextPage(runId, entry, plan, attachments)) !== null) return false;
    // A repeating page's items are their own targets (ADR-0103, gap 3) — one
    // saved item is one saved page for this question's purpose.
    if (await this.#anyItemSaved(runId, entry, plan)) return true;

    // Nothing left to fill — but "nothing left" is also true of a run that
    // never had a fillable page. `markFilled` only means something once at
    // least one page has actually been saved.
    const saved = await Promise.all(
      entry.blueprint.pages.map(async (page) => {
        const fields = new Set(
          page.sections.flatMap((section) => section.fields.map((f) => f.fieldRef)),
        );
        return this.#verdictFor(
          runId,
          "advance_portal_page",
          pageFillTarget({
            pageRef: page.pageRef,
            values: pageValuesOf(plan, fields),
            attachments: pageAttachmentsOf(attachments, fields),
          }),
        );
      }),
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

    // ── The other thing only the student can do (ADR-0062) ───────────────
    //
    // The interview's question, put to them in the conversation. Beside the
    // handoff and for the same reasons: after the case walk, and idempotent by
    // what the log already holds, so the ordinary case — a poll of a run
    // already waiting on an answer — writes nothing.
    await this.#askTheStudent(input.conversationId, step);

    // ── The interview's own decision to STOP (ADR-0064) ──────────────────
    //
    // After the ask, because a step that is asking is not stuck. This returns a
    // position rather than falling through to `checkpointAfter`, for the reason
    // `#pauseForReview` does — and NOT the one P28 first wrote here. That said
    // the ordinary checkpoint would put the status back to `running`; it would
    // not. `saveCheckpoint` writes `input.status ?? from`, so omitting the
    // status PRESERVES it (`postgres-workflow.ts:166`). Corrected in P29 after
    // R3 measured it.
    //
    // The real reason is the revision. The stop has already saved at
    // `input.record.revision`, so `checkpointAfter` below — which passes that
    // same, now stale, revision — raises `RunConcurrencyError` and sends
    // `#decide` round its retry loop. The outcome still comes out right, since
    // the retry re-reads and the raise is idempotent, but every stop would
    // spend an attempt from a budget that exists for two clicks racing.
    //
    // Kept even though the message path below reaches the same stop first in
    // the ordinary case: `#correct` appends the rejection and THEN re-derives,
    // so a process that dies between those two leaves an exhausted log and a
    // run still marked `running`. This advance is what stops it.
    const stuck = await this.#stopForUnobtainable(input, step, now);
    if (stuck !== null) return stuck;

    // ── And the step that says a PERSON must look (ADR-0065) ─────────────
    //
    // `specialist` is the orchestrator's answer for an artefact it could not
    // use, a structural blocker, a validation that did not run, a preview it
    // could not produce — including because a document is required and none was
    // provided — and an account step it could not plan. The driver acted on
    // none of them, so the run stayed `running`, the worker advanced it for
    // ever, and the student was told nothing at all.
    //
    // Returns a position rather than falling through, for the revision reason
    // spelled out above the stop before it.
    const handed = await this.#stopForSpecialist(input, step, now);
    if (handed !== null) return handed;

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

    // ── The guard ADR-0038 described and nothing implemented ─────────────
    //
    // Until P19 this method checked the request purpose and whether the Secure
    // Plane was reachable, and nothing at all about the student — while
    // ADR-0038 and the `students.email_verified` column comment both said a
    // verified email was required. The one place a student types a password
    // had no verification gate and two accepted documents said it had one.
    //
    // The value is the one established at login from a signature-verified ID
    // token (ADR-0056). It is NOT re-read from the provider here, deliberately,
    // and it is `false` for every ambiguous case — so this single comparison
    // covers "unverified", "no address" and "the provider did not say".
    //
    // A missing store is a REFUSAL, not a skip. A guard that disappears when
    // its dependency is absent is not a guard.
    const identities = this.#options.identities;
    if (identities === undefined) {
      return { ok: false, refusal: { kind: "email_not_verified" } };
    }
    if ((await identities.verificationOf(input.studentRef)) !== true) {
      return { ok: false, refusal: { kind: "email_not_verified" } };
    }

    // Narrowed, not cast. The domain's purposes and the contract's agreed
    // from P72 (ADR-0101 §3), and `scripts/contract-drift.test.ts` asserts
    // that they do; this guard stays so a member added to one side without
    // the other is refused here rather than cast into the wire.
    const purpose: string = step.request.purpose;
    if (purpose !== "portal_account_creation" && purpose !== "portal_sign_in") {
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
      title:
        purpose === "portal_sign_in"
          ? `Enter your password for ${input.entry.blueprint.institutionName}`
          : `Choose a password for ${input.entry.blueprint.institutionName}`,
      explanation: step.request.explanation,
      ttlSeconds: step.request.ttlSeconds,
      // Typed once on a sign-in: the portal is the check. Twice on a
      // creation, where a typo becomes an account nobody can get into.
      ...(purpose === "portal_sign_in" ? { requiresConfirmation: false } : {}),
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
    /**
     * The runs this runner holds a signed-in browser context for (ADR-0101
     * §2). `execute` work goes only to a runner that names the run, and such
     * a runner is offered that run first. Absent — an in-process caller, which
     * is this file's tests — nothing is withheld; the route requires it, so a
     * deployed runner always says.
     */
    readonly sessions?: readonly string[];
  }): Promise<ClaimedWork | null> {
    const leases = this.#options.leases;
    if (leases === undefined) return null;

    const now = this.#options.now();
    const found = await leases.candidates({
      phases: BROWSER_PHASES,
      now,
      limit: input.limit ?? 10,
    });
    // The holder of a run's session is offered that run before any other:
    // a fill that goes to the runner signed in to it is a fill that needs no
    // second sign-in (ADR-0101 §2). Stable, so the ordering among the rest is
    // the store's.
    const sessions = input.sessions;
    const candidates =
      sessions === undefined
        ? found
        : [
            ...found.filter((candidate) => sessions.includes(candidate.runId)),
            ...found.filter((candidate) => !sessions.includes(candidate.runId)),
          ];

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
      // A fill needs the session the account was created in. A runner that
      // does not hold it is not handed the page — the run waits for the one
      // that does, or for the resume path (ADR-0101 §3) to sign one in.
      if (kind === "execute" && sessions !== undefined && !sessions.includes(candidate.runId)) {
        continue;
      }

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
      const unfinished = LEDGERED_WORK.has(kind)
        ? await this.#unfinishedAction(record.runId, kind, entry)
        : null;
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
          action: unfinished.action,
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
      const attachments =
        plan === null ? [] : await this.#heldAttachments(entry, plan, record.studentRef);
      const payload = workPayloadFor(
        entry,
        {
          kind,
          account,
          plan,
          page:
            plan === null ? null : await this.#nextPage(record.runId, entry, plan, attachments),
          attachments,
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

      // ── The intent is durable BEFORE the work is handed out ─────────────
      //
      // ADR-0054, and the ordering the whole mechanism depends on. Until P17
      // this row was written when the REPORT arrived, which meant a runner
      // killed mid-action — SIGKILL, OOM, a rolling deploy — left nothing at
      // all: the lease lapsed, the run went back in the pool, and the next
      // runner was handed it as new work. On `create_account` that is a second
      // account, on a real portal, in a student's name.
      //
      // Written AFTER the lease deliberately. The lease is what makes "one
      // attempt at a time" true, so an intent written before it could be
      // written for work this runner then loses the race for — an unfinished
      // action nobody ever attempted, and a specialist called out for it.
      //
      // No transaction spans the two, and none is needed. The only window that
      // could hurt anybody is *work handed out with no durable intent*, and it
      // does not exist: this returns after the write. The other order of
      // failure — a lease taken and the intent write lost — hands out nothing,
      // lapses on its own, and is retried.
      // A sign-in writes no row: see `LEDGERED_WORK`.
      const began =
        !LEDGERED_WORK.has(kind) ||
        (await this.#beginIntent({
          runId: makeRunId(candidate.runId),
          action: ACTION_FOR_WORK[kind],
          target: intentTargetOf(candidate.runId, payload),
          now,
        }));
      if (!began) {
        // The ledger will not have it. Something finished this action between
        // `#unfinishedAction` above and here — a race the lease normally
        // prevents — so give the lease back rather than hand out work whose
        // attempt is unrecorded. Refusing costs a poll; proceeding costs an
        // action nobody could later account for.
        await leases.release({ runId: candidate.runId, leaseId: lease.leaseId, now });
        continue;
      }

      // ── One intent PER ATTACHMENT, before the page is handed out ─────────
      //
      // ADR-0069's third layer (P73). The page's intent says the page was
      // saved with this content; these say which DOCUMENT went into which box
      // — `page/field=documentId@hash` — so an attachment that may or may not
      // have landed is a row a specialist can read, and the audit record the
      // report writes names the file that left. Opened after the lease and
      // before the hand-out, as the page's is, and for the same reason.
      let attachmentsOpened = true;
      for (const attachment of payload.attachments ?? []) {
        if (payload.pageRef === undefined) break;
        const opened = await this.#beginIntent({
          runId: makeRunId(candidate.runId),
          action: "attach_document",
          target: attachmentIntentTarget({ pageRef: payload.pageRef, attachment }),
          now,
        });
        if (!opened) {
          attachmentsOpened = false;
          break;
        }
      }
      if (!attachmentsOpened) {
        await leases.release({ runId: candidate.runId, leaseId: lease.leaseId, now });
        continue;
      }

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

    // ── The evidence, COMPLETED here and opened at the claim ─────────────
    //
    // ADR-0008 for the mechanism, ADR-0054 for the ordering. Until P17 this
    // method also RECORDED the intent, which meant nothing was durable until a
    // runner came back to say so — and a runner that never came back left no
    // trace of having tried. `claimWork` now opens the row before the work is
    // handed out, so by the time a report arrives the row is already there and
    // all that is left is to say how it ended.
    //
    // `completeIntent` has always refused a completion with no intent, calling
    // it *"the ordering the whole mechanism depends on"*. That sentence
    // describes the system now; before P17 this method was the reason it did
    // not have to be true.
    const runId = makeRunId(input.runId);
    const action = ACTION_FOR_WORK[held.kind];
    // The PAGE for a fill, the run for anything else — from the LEASE, and
    // through the same function the claim used, so the two cannot drift.
    const target = intentTargetOf(held.runId, held);
    const key = idempotencyKeyFor({ runId, action, target });

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
    if (input.report.outcome !== "uncertain" && LEDGERED_WORK.has(held.kind)) {
      await this.#options.stores.runs.completeIntent(
        runId,
        key,
        input.report.outcome === "succeeded" ? "succeeded" : "failed_cleanly",
        now,
      );
    }

    // ── The attachments this page carried (ADR-0069, P73) ────────────────
    await this.#settleAttachments({ runId, held, report: input.report, now });

    // ── The session, as this report evidences it (ADR-0101 §2, §3) ──────
    await this.#recordSession(held, input.report, now);

    // ADR-0101 §6. A CAPTCHA or a second factor is not a fill error: the run
    // stops, says which, and is never offered again until a person has looked.
    const challenge = challengeOf(input.report);
    if (challenge !== null) {
      await this.#stopForChallenge({ runId, challenge, action, target, now });
    }

    return await leases.release({ runId: input.runId, leaseId: input.report.leaseId, now });
  }

  /**
   * Settles the page's `attach_document` intents from the report, and writes
   * the audit record of what left (ADR-0022, ADR-0069 — P73).
   *
   * Listed from the ledger — what is OPEN for this page — rather than
   * re-derived from the documents held now, which may not be the documents
   * that were current at the claim. Then, per intent:
   *
   *   the page was saved, and the report names this document in this box
   *       → succeeded, and the transmission is recorded
   *   the page was saved, and the report does not name it
   *       → left OPEN. The runner saved a page it did not say it attached this
   *         file to; that is the uncertain case, and the next claim stops on it
   *   the page was not saved (`failed`)
   *       → failed cleanly, as the page: the portal kept nothing
   *   uncertain
   *       → untouched, as the page
   *
   * A transmission is recorded only for an intent this plane opened, so a
   * report cannot write a disclosure the plane never gated; and only for this
   * run's case, so it cannot record one for another application.
   */
  async #settleAttachments(input: {
    readonly runId: RunId;
    readonly held: WorkLease;
    readonly report: WorkReport;
    readonly now: Date;
  }): Promise<void> {
    const pageRef = input.held.pageRef;
    if (input.held.kind !== "execute" || pageRef === undefined) return;
    if (input.report.outcome === "uncertain") return;
    const runs = this.#options.stores.runs;
    const open = (await runs.listIntents(input.runId, "attach_document")).filter(
      (record) => record.completed === undefined && record.intent.target.startsWith(`${pageRef}/`),
    );
    if (open.length === 0) return;
    const record = await runs.load(input.runId);
    if (record === null) return;

    for (const intent of open) {
      const key = intent.intent.idempotencyKey;
      if (input.report.outcome !== "succeeded") {
        await runs.completeIntent(input.runId, key, "failed_cleanly", input.now);
        continue;
      }
      const match = (input.report.transmissions ?? []).find(
        (transmission) =>
          intent.intent.target ===
            attachmentIntentTarget({
              pageRef,
              attachment: {
                fieldRef: transmission.fieldRef,
                documentId: transmission.documentId,
                contentHash: transmission.contentHash,
              },
            }) && transmission.caseId === String(record.caseId),
      );
      if (match === undefined) continue;
      await runs.completeIntent(input.runId, key, "succeeded", input.now);
      await this.#options.transmissions?.record({
        runId: String(input.runId),
        intentKey: String(key),
        caseId: String(record.caseId),
        disclosureId: match.disclosureId,
        documentId: match.documentId,
        contentHash: match.contentHash,
        toHost: match.toHost,
        institutionName: match.institutionName,
        transmittedAt: new Date(match.transmittedAt),
        now: input.now,
      });
    }
  }

  /**
   * Records what a report says about the run's signed-in session.
   *
   * A success of any kind came from a signed-in browser — an account created
   * signs the runner in, a sign-in does by definition, a page saved needed one
   * — so the holder is on record until the ceiling. A failure ends the
   * session exactly when the runner lets its context go: on the contract's
   * `SESSION_ENDING_FAILURES` for a fill, and on any failure of the two kinds
   * whose whole point was the session. Every other failure of a fill keeps
   * it, so a refused page is offered to the same signed-in runner again.
   */
  async #recordSession(held: WorkLease, report: WorkReport, now: Date): Promise<void> {
    const sessions = this.#options.sessions;
    if (sessions === undefined) return;
    if (report.outcome === "succeeded") {
      await sessions.record({ runId: held.runId, holder: held.holder, now });
      return;
    }
    const ends =
      held.kind !== "execute" ||
      (report.failure !== undefined && SESSION_ENDING_FAILURES.includes(report.failure));
    if (ends) await sessions.lost(held.runId);
  }

  /**
   * Stops a run that met a CAPTCHA or a second factor, and says which.
   *
   * ═══════════════════════════════════════════════════════════════════════
   * ADR-0101 §6 — Vahid: *"If a runner meets a CAPTCHA or a second factor
   * where A expects neither, it must stop and say which it met, not fail as a
   * fill error. That refusal is the signal that moves C from deferred to
   * needed."*
   *
   * Before this, `reportWork` recorded every failure as `failed_cleanly` and
   * discarded the code. A challenged registration would have been offered
   * again on the next poll, met the same challenge, and gone round — the
   * confusing failure he asked not to have. Now the code has a home: an
   * intervention naming the challenge, the action and the page, with the
   * reviewed observation it contradicts; one honest message to the student;
   * and the status `escalated`, which `claimWork` never offers.
   * ═══════════════════════════════════════════════════════════════════════
   *
   * The same mechanism as every other stop (ADR-0048, ADR-0065): one
   * intervention store, one announcement, one status. Idempotent by the
   * action's own key, so a second report of the same challenge raises nothing
   * new. The reason is the domain's: a CAPTCHA is `new_portal_behaviour` (the
   * observation said none), a second factor is `authentication_failure` (we
   * could not sign in, and it is not a handoff the student completes on their
   * own device — ADR-0101 §5 is the plan for it).
   */
  async #stopForChallenge(input: {
    readonly runId: RunId;
    readonly challenge: "captcha" | "second_factor";
    readonly action: ConsequentialAction;
    readonly target: string;
    readonly now: Date;
  }): Promise<void> {
    const interventions = this.#options.interventions;
    if (interventions === undefined) return;
    const record = await this.#options.stores.runs.load(input.runId);
    if (record === null) return;
    const conversationId = await this.#options.bindings.conversationForCase(record.caseId);
    if (conversationId === null) return;
    const bound = await this.#options.bindings.caseFor(conversationId);
    if (bound === null || bound.blueprintId === null) return;
    const entry = await this.#options.catalogue.find(bound.blueprintId);
    if (entry === null) return;

    const runId = record.runId;
    const idempotencyKey = idempotencyKeyFor({ runId, action: input.action, target: input.target });
    const reason: RecoveryReason =
      input.challenge === "captcha" ? "new_portal_behaviour" : "authentication_failure";
    const raised = await interventions.raise({
      interventionId: makeInterventionId(
        this.#options.newInterventionId?.(runId, idempotencyKey, input.now) ??
          `iv_${randomUUID().replace(/-/g, "")}`,
      ),
      runId,
      idempotencyKey,
      caseId: record.caseId,
      studentRef: record.studentRef,
      escalation: {
        reason,
        priority: priorityFor(reason),
        encountered: challengeEncountered(entry, input.challenge, input.action, input.target),
        expected:
          `No CAPTCHA and no second factor at registration, sign-in or the form: the ` +
          `assumption the one-sitting design rests on (ADR-0101 §1–§2), and what the reviewed ` +
          `observation for this portal records. A person decides whether this portal is served ` +
          `through the plan in ADR-0101 §5, or as a handoff route.`,
        checkpoint: {
          blueprintVersion: blueprintVersion(entry.blueprint.version),
          action: input.action,
          target: input.target,
          phase: record.checkpoint.phase,
          pagesCompleted: [],
          capturedAt: input.now,
        },
        raisedAt: input.now,
      },
      context: {
        institutionId: makeInstitutionId(entry.institutionRef),
        portal: portalOf(entry),
        courseId: makeCourseId(entry.courseRef),
        blueprintVersion: blueprintVersion(entry.blueprint.version),
        ...(input.action === "advance_portal_page" ? { page: pageOf(input.target) } : {}),
      },
    });

    const held = await interventions.find(raised.interventionId);
    if (held !== null && held.announcedAt === undefined) {
      await this.#options.conversations.append({
        conversationId,
        event: {
          kind: "message",
          actor: "assistant",
          content: challengeMessage(entry, input.challenge),
        },
      });
      await interventions.markAnnounced(raised.interventionId, input.now);
    }

    if (record.status !== "running") return;
    await this.#options.stores.runs.saveCheckpoint({
      runId,
      checkpoint: record.checkpoint,
      expectedRevision: record.revision,
      status: "escalated",
    });
  }
}

/**
 * The ledger target for a unit of work: the PAGE for a fill, the run otherwise.
 *
 * One function, used by both ends. `claimWork` derives it from the payload it
 * is about to hand out and `reportWork` from the lease that comes back, and if
 * those two ever disagreed the report would complete a different intent from
 * the one the claim opened — leaving one row unfinished for ever and raising an
 * intervention for an action that in fact completed.
 *
 * Deliberately NOT re-derived from a plan at report time: a plan that changed
 * in between would key the intent to a page the runner never touched
 * (ADR-0047, ADR-0051 §6).
 */
function intentTargetOf(
  runId: string,
  page: { readonly pageRef?: string; readonly pageVersion?: string },
): string {
  if (page.pageRef === undefined) return runId;
  return page.pageVersion === undefined ? page.pageRef : `${page.pageRef}@${page.pageVersion}`;
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
  // The resume path (ADR-0101 §3). In the map so a stop during a sign-in names
  // what was happening; NOT in `LEDGERED_WORK` below.
  sign_in: "sign_in_to_portal",
  // Filling advances the portal, which may create a draft application visible
  // to admissions — which is why it is consequential at all, and why it gets an
  // intent rather than being treated as a read.
  execute: "advance_portal_page",
};

/**
 * The kinds of work that open an intent at claim and complete it at report
 * (ADR-0054). A sign-in does not: the one thing it spends is the handle, and
 * the Secure Plane's own lifecycle already records that consumption where it
 * happens — a second row for the same fact would be two models of one thing
 * (ADR-0041) — and a sign-in that may or may not have happened is simply done
 * again with a fresh password, creating nothing on the portal either way. Its
 * durable trace is `run_sessions`, written from the report.
 */
const LEDGERED_WORK: ReadonlySet<WorkKind> = new Set<WorkKind>(["create_account", "execute"]);

/**
 * When a request was opened, from the log's own timestamp, for `withSecret`.
 * The one reading by which a sign-in's request is told from a creation's
 * (ADR-0101 §3); nothing if the log has no such request.
 */
function requestedAtOf(
  events: readonly ConversationEvent[],
  requestId: string,
): { readonly requestedAt?: Date } {
  const opened = events.find(
    (event) => event.kind === "secret_requested" && event.requestId === requestId,
  );
  return opened === undefined ? {} : { requestedAt: new Date(opened.createdAt) };
}

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
/**
 * Where the login form is and which boxes to type into, from the reviewed
 * blueprint — the resume path (ADR-0101 §3). The origin is swapped for the
 * deployment's and the path kept, exactly as `registrationFrom` does and for
 * the same reason. `null` when the blueprint records no login form; the
 * orchestrator refuses that case by name before it gets here.
 */
function loginFrom(entry: CatalogueEntry): LoginTargets | null {
  const form = entry.blueprint.authentication.login;
  const loginUrl = entry.blueprint.authentication.loginUrl;
  if (form === undefined || loginUrl === undefined) return null;
  const url = atOrigin(loginUrl, entry.portalOrigin);
  if (url === null) return null;
  return {
    url,
    emailLocator: { strategy: form.emailLocator.strategy, value: form.emailLocator.value },
    passwordLocator: { strategy: form.passwordLocator.strategy, value: form.passwordLocator.value },
    submitLocator: { strategy: form.submitLocator.strategy, value: form.submitLocator.value },
  };
}

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
 * What the student is told when their application is ready for them to approve.
 *
 * A pointer, not a copy. It says where to look and what the decision is; the
 * application itself is fetched from `GET .../runs/{runId}/preview` and lives
 * nowhere else (ADR-0059).
 *
 * Deliberately plain about what happens next, because this is the last moment
 * before anything is typed into a university's form and a student should not
 * have to infer that from a cheerful sentence.
 */
const READY_TO_APPROVE =
  "Your application is ready. Before anything is entered on the university's website, please " +
  "read it through and check every answer is right — it is exactly what will be sent. Nothing " +
  "is submitted by this system either way; approving it lets me fill the form in for you.";

/**
 * Why a hop happened, for the case log a person reads later.
 *
 * Keyed on the SPINE rather than on every case state, because only the spine is
 * walked here. A `Record` over the spine's members rather than a switch with a
 * default: a default would quietly give a new spine state a stub reason, and
 * the reason is what somebody reads in a year when they ask why a case moved.
 */
const HOP_REASONS: Readonly<Record<string, string>> = {
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

/**
 * The deployment the preview names as the destination, or `undefined` for the
 * one the blueprint observed (P74).
 *
 * The same resolution `deployedHost` gives every step's host, handed to the
 * preview so the destination the student authorises is the one the runner's
 * transmission gate is asked about (`mayTransmit`, ADR-0069). Three call
 * sites build a preview — the run's inputs, the hash check at authorisation
 * and the hand-over — and this is the one reading, so they cannot name
 * different hosts and refuse each other.
 */
function deploymentOf(entry: CatalogueEntry): PreviewDeployment | undefined {
  if (entry.portalOrigin === undefined) return undefined;
  const host = hostOf(entry.portalOrigin);
  return host === null ? undefined : { portalHost: host };
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
    /** Which page to hand out — and which item of it — decided from the ledger by `#nextPage`. */
    readonly page: NextPage | null;
    /** The run's attachments as the preview resolves them (ADR-0069, P73). */
    readonly attachments: readonly PreviewAttachment[];
  },
  fromBlueprint: string,
):
  | {
      readonly portalHost: string;
      readonly pageRef?: string;
      readonly pageVersion?: string;
      /** The attachments on THIS page, one `attach_document` intent each. */
      readonly attachments?: readonly PageAttachment[];
      readonly carries: Partial<
        Pick<ClaimedWork, "registration" | "login" | "plan" | "formUrl" | "advanceLocator" | "repeat">
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

  if (input.kind === "sign_in") {
    // The resume path (ADR-0101 §3): the login form, on the bound host, and
    // nothing of the plan — the runner signs in and reports; the page comes
    // as the next item, to the runner now holding the session (§2).
    const login = loginFrom(entry);
    if (login === null) return null;
    if (hostOf(login.url) !== portalHost) return null;
    return { portalHost, carries: { login } };
  }

  const plan = input.plan;
  if (plan === null) return null;

  // ── Taken apart for transport, or refused ─────────────────────────────
  //
  // `toStoredPlan` refuses a plan with handoffs or blockers rather than
  // trimming them: a plan with a part silently removed would report itself
  // complete having done less than the student was told. A refused plan means
  // this run is not work — it is waiting on something else, and `nextStep`
  // says what on the next advance. Uploads cross as references (ADR-0099):
  // the runner asks the plane for each under its lease, after the gates.
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
  if (input.page === null) return null;
  const { page, item } = input.page;
  const at = atOrigin(page.url ?? "", entry.portalOrigin);
  if (at === null || hostOf(at) !== portalHost) return null;
  // ADR-0106: a repeating page's listing is a page of the same portal, rebased
  // onto the deployed origin exactly as the form is; one elsewhere is not work.
  const listingAt =
    page.repeats?.recorded === undefined ? null : atOrigin(page.repeats.recorded.url, entry.portalOrigin);
  if (page.repeats?.recorded !== undefined && (listingAt === null || hostOf(listingAt) !== portalHost)) return null;

  // The control that saves this page. A blueprint page with fields to fill and
  // no way to save them is a blueprint a specialist should look at, not a page
  // to type into and abandon.
  const advance = page.advanceControl;
  if (advance === undefined) return null;

  const onThisPage = new Set(
    page.sections.flatMap((section) => section.fields.map((field) => field.fieldRef)),
  );
  const instructions = transported.plan.instructions.filter(
    (instruction) =>
      onThisPage.has(instruction.fieldRef) &&
      // On a repeating page, THIS item's instructions and no other's (gap 3).
      (item === undefined ? instruction.item === undefined : instruction.item?.index === item.index),
  );
  // The uploads on THIS page, by the same rule as the fields. A page whose
  // only box is a file input is still a page to fill (ADR-0099).
  const uploads = transported.plan.uploads.filter((upload) => onThisPage.has(upload.fieldRef));
  if (instructions.length === 0 && uploads.length === 0) return null;

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
      attachments: pageAttachmentsOf(input.attachments, onThisPage),
      ...(item === undefined ? {} : { item }),
    }).slice(page.pageRef.length + 1),
    attachments: pageAttachmentsOf(input.attachments, onThisPage),
    carries: {
      plan: toWirePlan({ ...transported.plan, instructions, uploads }),
      formUrl: at,
      advanceLocator: { strategy: advance.strategy, value: advance.value },
      // Which item this is, and how the runner reaches a fresh entry (gap 3).
      ...(item === undefined || page.repeats === undefined
        ? {}
        : {
            repeat: {
              index: item.index,
              count: item.count,
              ...(page.repeats.addAnother === undefined
                ? {}
                : { addAnother: { strategy: page.repeats.addAnother.strategy, value: page.repeats.addAnother.value } }),
              // ADR-0106: where the saved entries are listed, so the runner can
              // see that this one exists after its save.
              ...(page.repeats.recorded === undefined || listingAt === null
                ? {}
                : {
                    recorded: {
                      url: listingAt,
                      entryLocator: {
                        strategy: page.repeats.recorded.entryLocator.strategy,
                        value: page.repeats.recorded.entryLocator.value,
                      },
                    },
                  }),
            },
          }),
    },
  };
}

/** A page to hand out, and which item of it when the page repeats (ADR-0103, gap 3). */
interface NextPage {
  readonly page: ApplicationBlueprint["pages"][number];
  readonly item?: { readonly index: number; readonly count: number };
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
      ...(instruction.optionsAfter === undefined
        ? {}
        : {
            optionsAfter: {
              fieldRef: instruction.optionsAfter.fieldRef,
              ...(instruction.optionsAfter.press === undefined
                ? {}
                : { press: { strategy: instruction.optionsAfter.press.strategy, value: instruction.optionsAfter.press.value } }),
            },
          }),
      ...(instruction.typeahead === undefined
        ? {}
        : {
            typeahead: {
              optionLocator: {
                strategy: instruction.typeahead.optionLocator.strategy,
                value: instruction.typeahead.optionLocator.value,
              },
            },
          }),
      ...(instruction.item === undefined ? {} : { item: { index: instruction.item.index, count: instruction.item.count } }),
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
          : instruction.value.kind === "form_refusal"
            ? {
                kind: "form_refusal" as const,
                text: instruction.value.text,
                rationale: instruction.value.rationale,
                ...(instruction.value.formSays === undefined
                  ? {}
                  : { formSays: instruction.value.formSays }),
                covers: [...instruction.value.covers],
                mappingSetId: instruction.value.mappingSetId,
                reviewedBy: instruction.value.reviewedBy,
              }
            : {
                kind: "reviewed_constant" as const,
                text: instruction.value.text,
                rationale: instruction.value.rationale,
                mappingSetId: instruction.value.mappingSetId,
                reviewedBy: instruction.value.reviewedBy,
              },
    })),
    // References only (ADR-0099): the runner asks for each under its lease.
    uploads: stored.uploads.map((upload) => ({
      fieldRef: upload.fieldRef,
      label: upload.label,
      documentRef: upload.documentRef,
      locators: upload.locators.map((locator) => ({ strategy: locator.strategy, value: locator.value })),
      ...(upload.companion === undefined
        ? {}
        : {
            companion: {
              fieldRef: upload.companion.fieldRef,
              label: upload.companion.label,
              locators: upload.companion.locators.map((locator) => ({ strategy: locator.strategy, value: locator.value })),
              text: upload.companion.text,
            },
          }),
      ...(upload.recorded === undefined ? {} : { recorded: { strategy: upload.recorded.strategy, value: upload.recorded.value } }),
    })),
  };
}

/** The key an own act is recorded and closed under: the slot, and the entry when the page repeats (ADR-0108). */
function ownActKeyOf(handoff: { readonly fieldRef: string; readonly item?: { readonly index: number } }): string {
  return handoff.item === undefined ? handoff.fieldRef : `${handoff.fieldRef}#${String(handoff.item.index)}`;
}

/** The case's own acts, as the run reads them out: the record's words, and whether the student said they did it. */
function ownActReadingsOf(acts: readonly OwnAct[]): readonly OwnActReading[] {
  return acts.map((act) => ({
    key: act.key,
    label: act.label,
    ...(act.page === undefined ? {} : { page: act.page }),
    ...(act.entry === undefined ? {} : { entry: { index: act.entry.index, count: act.entry.count } }),
    ...(act.told === undefined ? {} : { told: { text: act.told.text, ...(act.told.displayText === undefined ? {} : { displayText: act.told.displayText }) } }),
    done: act.doneAt !== undefined,
  }));
}
