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
  idempotencyKeyFor,
  institutionId as makeInstitutionId,
  intake as makeIntake,
  openCase,
  runId as makeRunId,
  stamp,
  studentId as makeStudentId,
} from "@askimate/aas-domain";
import type {
  CaseId,
  ConsequentialAction,
  StudentId,
  WorkflowPhase,
  WorkflowRunRecord,
  WorkflowStatus,
} from "@askimate/aas-domain";
import { newInterview } from "@askimate/aas-interview";
import type { ModelClient } from "@askimate/aas-llm";
import { checkUsable } from "@askimate/aas-mapping";
import type { MappingSet } from "@askimate/aas-mapping";
import {
  beginRun,
  browserWorkFor,
  checkpointAfter,
  nextStep,
  requiredFieldsFor,
  requiresSecureRequest,
  resumeRun,
  startRun,
  withCheckpoint,
  withSecret,
} from "@askimate/aas-orchestrator";
import type { DurableStores, ResumeConcern, RunState, RunStep } from "@askimate/aas-orchestrator";
import type { ConfirmedProfileStore } from "@askimate/aas-profile";

import { latestSecretRequest } from "@askimate/aas-conversation";

import type { ClaimedWork, WorkApproach, WorkKind, WorkReport } from "@askimate/aas-contracts";
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
 */
const BROWSER_PHASES: readonly string[] = ["creating_account"];

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
    const state: RunState = secret === null ? base : withSecret(base, secret);

    // THE decision. Made by the orchestrator, on a pure function, from state
    // this service loaded and did not interpret.
    const step: RunStep = await nextStep(state, this.#options.model);
    return { ok: true, step, now, secret };
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
      targetHost: step.request.target.host,
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
      const detail = accountWorkFrom(situation.step);
      if (detail === null) continue;

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
        portalHost: detail.portalHost,
        email: detail.email,
        approach: detail.approach,
        // Present only when the student has actually typed one. A handle is
        // opaque and resolves to nothing outside a live vault (ADR-0026), which
        // is why the component that may hold no secrets may hold this.
        ...(situation.secret?.handle === undefined
          ? {}
          : { secretHandle: situation.secret.handle }),
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
};

/**
 * The account facts a `create_account` step carries, or `null`.
 *
 * Narrowed rather than cast, and separate from `browserWorkFor` because the two
 * answer different questions: the orchestrator owns *which steps need a
 * browser*, and this file owns *how this step's fields become a wire payload*.
 * A step that gains a browser but no account details fails here rather than
 * producing a work item with empty strings in it.
 */
function accountWorkFrom(
  step: RunStep,
): { portalHost: string; email: string; approach: WorkApproach } | null {
  if (step.kind !== "create_account") return null;
  if (!(WORK_APPROACHES as readonly string[]).includes(step.approach)) return null;
  return {
    portalHost: step.portalHost,
    email: step.email,
    approach: step.approach,
  };
}
