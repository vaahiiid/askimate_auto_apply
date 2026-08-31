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
import type { ApplicationBlueprint } from "@askimate/aas-blueprint";
import type { WorkflowRunStore } from "@askimate/aas-case-store/workflow";
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
  openCase,
  runId as makeRunId,
  stamp,
  studentId as makeStudentId,
  unwrapConfirmed,
} from "@askimate/aas-domain";
import type {
  CaseId,
  ConsequentialAction,
  RunId,
  StudentId,
  WorkflowPhase,
  WorkflowRunRecord,
  WorkflowStatus,
} from "@askimate/aas-domain";
import { newInterview } from "@askimate/aas-interview";
import type { ModelClient } from "@askimate/aas-llm";
import { checkUsable, toStoredPlan } from "@askimate/aas-mapping";
import type { FillPlan, MappingSet, StoredFillPlan } from "@askimate/aas-mapping";
import {
  accountCreated,
  accountWorkOf,
  beginRun,
  browserWorkFor,
  executePlanOf,
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
import type { DurableStores, ResumeConcern, RunState, RunStep } from "@askimate/aas-orchestrator";
import type { ConfirmedProfileStore } from "@askimate/aas-profile";

import { latestSecretRequest } from "@askimate/aas-conversation";

import type {
  ClaimedWork,
  FillLocator,
  RegistrationTargets,
  TransportedPlan,
  WorkApproach,
  WorkKind,
  WorkReport,
} from "@askimate/aas-contracts";
import { WORK_APPROACHES } from "@askimate/aas-contracts";

import type { ApplicationBindingStore } from "./application-store.js";
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
        interview: newInterview({
          studentRef: input.studentRef,
          profile,
          requiredFields: requiredFieldsFor(input.entry.blueprint, usable.mappingSet),
          requiredDocuments: input.entry.requiredDocuments,
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
    const withAccount_: RunState = await this.#withAccountIfCreated(withTheSecret, input, now);

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
    const state: RunState = await this.#markFilledIfDone(authorised, input.record.runId);

    // THE decision. Made by the orchestrator, on a pure function, from state
    // this service loaded and did not interpret.
    const step: RunStep = await nextStep(state, this.#options.model);
    return { ok: true, step, now, secret, account: state.account };
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
    input: { readonly record: WorkflowRunRecord },
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
    const created = accountCreated(state, { accountId: `acct_${runId}`, now });
    return created ?? state;
  }

  /**
   * Whether this run has a consequential action that was started and never
   * finished.
   *
   * `true` for both unfinished verdicts. `verify_first` and `escalate` differ
   * in what a HUMAN should do about them; they are identical in what this
   * coordinator may do, which is nothing.
   */
  async #actionMayBeUnfinished(runId: RunId, kind: WorkKind): Promise<boolean> {
    const found = await this.#options.stores.runs.findIntent(
      runId,
      idempotencyKeyFor({ runId, action: ACTION_FOR_WORK[kind], target: runId }),
    );
    const verdict = assessIntent({
      ...(found?.intent === undefined ? {} : { intent: found.intent }),
      ...(found?.completed === undefined ? {} : { completed: found.completed }),
    });
    return verdict.kind === "verify_first" || verdict.kind === "escalate";
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
  async #markFilledIfDone(state: RunState, runId: RunId): Promise<RunState> {
    const found = await this.#options.stores.runs.findIntent(
      runId,
      idempotencyKeyFor({ runId, action: "advance_portal_page", target: runId }),
    );
    const verdict = assessIntent({
      ...(found?.intent === undefined ? {} : { intent: found.intent }),
      ...(found?.completed === undefined ? {} : { completed: found.completed }),
    });
    if (verdict.kind !== "already_done" || verdict.outcome !== "succeeded") return state;
    return markFilled(state);
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
      if (await this.#actionMayBeUnfinished(record.runId, kind)) continue;
      // Both narrowings come from the orchestrator; this file reads their
      // results and never a step's kind.
      const account = accountWorkOf(situation.step);
      const detail = accountDetail(account, situation.account);
      if (detail === null) continue;

      const payload = workPayloadFor(
        entry,
        { kind, account, plan: executePlanOf(situation.step) },
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
    const key = idempotencyKeyFor({ runId, action, target: held.runId });

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
        target: held.runId,
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
  },
  fromBlueprint: string,
):
  | {
      readonly portalHost: string;
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
  // A plan covers the whole application, and an application is paginated: the
  // gated blueprint's own plan spans the registration page and the form. A
  // runner handed all of it would navigate to one page and time out on the
  // other's fields — which is exactly what happened the first time this ran.
  const page = formPageFor(entry, plan);
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
    carries: {
      plan: toWirePlan({ ...transported.plan, instructions }),
      formUrl: at,
      advanceLocator: { strategy: advance.strategy, value: advance.value },
    },
  };
}

/**
 * The page this unit of fill work is for.
 *
 * ── The rule, and why it is this one ──────────────────────────────────────
 *
 * The first page in blueprint order that has fields to type and NO credential
 * field. A page with a credential field is a registration page: the Secure
 * Plane fills the password there and account creation submits it, so by the
 * time a run reaches `execute` that page is done — including its email, which
 * `createPortalAccount` typed.
 *
 * Blueprint order, not plan order: which page comes first is a fact about the
 * portal that a specialist reviewed, and the plan's instruction order is an
 * artefact of how `planFill` walks fields.
 *
 * ── The limitation, stated ────────────────────────────────────────────────
 *
 * One page per unit of work, and no way yet to advance to the next: a portal
 * with two application pages gets its first one filled and then has nothing
 * more offered, because nothing records which pages are done. The gated
 * blueprint has one, so the journey completes; a two-page portal needs a phase
 * that makes page progress durable, and it should not be faked here.
 */
function formPageFor(entry: CatalogueEntry, plan: FillPlan): ApplicationBlueprint["pages"][number] | null {
  const wanted = new Set(plan.instructions.map((instruction) => instruction.fieldRef));
  const credentialFields = new Set(plan.credentials.map((credential) => credential.fieldRef));
  return (
    entry.blueprint.pages.find((page) => {
      const fields = page.sections.flatMap((section) => section.fields);
      if (fields.some((field) => credentialFields.has(field.fieldRef))) return false;
      return fields.some((field) => wanted.has(field.fieldRef));
    }) ?? null
  );
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
