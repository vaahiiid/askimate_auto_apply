/**
 * The in-memory workflow run store.
 *
 * Passes the same contract as the Postgres one. Used by tests and by any run
 * that genuinely does not need to survive a restart — a replay against a
 * captured portal, for instance.
 *
 * Everything is deep-copied on the way in and out. A caller that keeps a
 * reference to a checkpoint and mutates it must not thereby edit the store,
 * because the Postgres implementation cannot be edited that way and the two
 * must behave identically or the contract is measuring different things.
 */

import { beginCheckpoint, canTransitionStatus } from "@askimate/aas-domain";
import type {
  ActionIntent,
  CaseId,
  IntentOutcome,
  RunId,
  WorkflowCheckpoint,
  WorkflowRunRecord,
  WorkflowStatus,
} from "@askimate/aas-domain";

import type { IntentRecord, WorkflowRunStore } from "./workflow-store.js";
import {
  RunAlreadyExistsError,
  RunConcurrencyError,
  RunNotFoundError,
  RunStatusError,
} from "./workflow-store.js";

interface Held {
  record: WorkflowRunRecord;
  readonly intents: Map<string, IntentRecord>;
}

function copyCheckpoint(checkpoint: WorkflowCheckpoint): WorkflowCheckpoint {
  return {
    ...checkpoint,
    fieldsCompleted: [...checkpoint.fieldsCompleted],
    detail: { ...checkpoint.detail },
    capturedAt: new Date(checkpoint.capturedAt.getTime()),
    ...(checkpoint.portal === undefined
      ? {}
      : {
          portal: {
            ...checkpoint.portal,
            completedSections: [...checkpoint.portal.completedSections],
            capturedAt: new Date(checkpoint.portal.capturedAt.getTime()),
          },
        }),
  };
}

function copyRun(record: WorkflowRunRecord): WorkflowRunRecord {
  return {
    ...record,
    checkpoint: copyCheckpoint(record.checkpoint),
    startedAt: new Date(record.startedAt.getTime()),
    updatedAt: new Date(record.updatedAt.getTime()),
  };
}

export class InMemoryWorkflowRunStore implements WorkflowRunStore {
  readonly #runs = new Map<RunId, Held>();

  public async start(
    run: Omit<WorkflowRunRecord, "revision" | "updatedAt">,
  ): Promise<WorkflowRunRecord> {
    await Promise.resolve();
    if (this.#runs.has(run.runId)) throw new RunAlreadyExistsError(run.runId);
    const record: WorkflowRunRecord = { ...run, revision: 0, updatedAt: run.startedAt };
    this.#runs.set(run.runId, { record: copyRun(record), intents: new Map() });
    return copyRun(record);
  }

  public async load(runId: RunId): Promise<WorkflowRunRecord | null> {
    await Promise.resolve();
    const held = this.#runs.get(runId);
    if (held === undefined) return null;

    // ── No schema-version check here, deliberately ──────────────────────
    //
    // I first wrote one, so both implementations would "behave identically".
    // TypeScript narrowed it to `never` and was right to: this store holds a
    // typed `WorkflowCheckpoint` that never left the process, so there is no
    // way for it to contain something this build cannot read.
    //
    // Adding the check anyway would be fake symmetry — dead code that looks
    // like a safeguard. The check belongs where untyped data actually enters,
    // which is the Postgres adapter reading JSONB, and that is where it is.
    return copyRun(held.record);
  }

  public async saveCheckpoint(input: {
    readonly runId: RunId;
    readonly checkpoint: WorkflowCheckpoint;
    readonly expectedRevision: number;
    readonly status?: WorkflowStatus;
  }): Promise<number> {
    await Promise.resolve();
    const held = this.#runs.get(input.runId);
    if (held === undefined) throw new RunNotFoundError(input.runId);
    if (held.record.revision !== input.expectedRevision) {
      throw new RunConcurrencyError(input.runId, input.expectedRevision, held.record.revision);
    }
    if (input.status !== undefined && input.status !== held.record.status) {
      if (!canTransitionStatus(held.record.status, input.status)) {
        throw new RunStatusError(input.runId, held.record.status, input.status);
      }
    }

    const revision = held.record.revision + 1;
    held.record = copyRun({
      ...held.record,
      checkpoint: input.checkpoint,
      status: input.status ?? held.record.status,
      revision,
      updatedAt: input.checkpoint.capturedAt,
    });
    return revision;
  }

  public async recordIntent(runId: RunId, intent: ActionIntent): Promise<void> {
    await Promise.resolve();
    const held = this.#runs.get(runId);
    if (held === undefined) throw new RunNotFoundError(runId);
    if (held.intents.has(intent.idempotencyKey)) {
      throw new Error(
        `An intent for ${intent.idempotencyKey} already exists. Two intents for one key would ` +
          `make the record ambiguous, and the record is the only evidence about whether a ` +
          `consequential action happened.`,
      );
    }
    held.intents.set(intent.idempotencyKey, {
      intent: { ...intent, startedAt: new Date(intent.startedAt.getTime()) },
    });
  }

  public async completeIntent(
    runId: RunId,
    idempotencyKey: ActionIntent["idempotencyKey"],
    outcome: IntentOutcome,
    now: Date,
  ): Promise<void> {
    await Promise.resolve();
    const held = this.#runs.get(runId);
    if (held === undefined) throw new RunNotFoundError(runId);
    const record = held.intents.get(idempotencyKey);
    if (record === undefined) {
      throw new Error(
        `No intent for ${idempotencyKey}. A completion without an intent means the action was ` +
          `performed without first recording that it was about to be, which is the ordering the ` +
          `whole mechanism depends on.`,
      );
    }
    if (record.completed !== undefined) {
      if (record.completed.outcome === outcome) return; // idempotent
      throw new Error(
        `Intent ${idempotencyKey} was already completed as ${record.completed.outcome} and ` +
          `cannot now be ${outcome}.`,
      );
    }
    held.intents.set(idempotencyKey, {
      ...record,
      completed: { outcome, completedAt: new Date(now.getTime()) },
    });
  }

  public async findIntent(
    runId: RunId,
    idempotencyKey: ActionIntent["idempotencyKey"],
  ): Promise<IntentRecord | null> {
    await Promise.resolve();
    return this.#runs.get(runId)?.intents.get(idempotencyKey) ?? null;
  }

  public async findByCase(caseId: CaseId): Promise<readonly WorkflowRunRecord[]> {
    await Promise.resolve();
    return [...this.#runs.values()]
      .filter((held) => held.record.caseId === caseId)
      .sort((left, right) => right.record.startedAt.getTime() - left.record.startedAt.getTime())
      .map((held) => copyRun(held.record));
  }

  public async discardCheckpoints(runId: RunId): Promise<void> {
    await Promise.resolve();
    const held = this.#runs.get(runId);
    if (held === undefined) throw new RunNotFoundError(runId);
    held.record = copyRun({
      ...held.record,
      checkpoint: beginCheckpoint({
        blueprintVersion: held.record.checkpoint.blueprintVersion,
        now: held.record.updatedAt,
      }),
    });
    // Intents are NOT discarded. They are evidence that a consequential action
    // may have happened, not operational convenience — throwing one away would
    // turn a detectable uncertainty into a silent repeat.
  }
}
