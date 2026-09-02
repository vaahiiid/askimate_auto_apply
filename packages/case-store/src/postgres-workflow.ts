/**
 * The Postgres workflow run store.
 *
 * Passes the same contract as the in-memory one. The guarantees that matter
 * are constraints, not application code — the C1 lesson, applied again:
 *
 * | Guarantee | Enforced by |
 * |---|---|
 * | a run is created once | `PRIMARY KEY (run_id)` |
 * | one intent per key | `PRIMARY KEY (run_id, idempotency_key)` |
 * | one resume wins | a conditional UPDATE on `revision`, checked by rowCount |
 * | a completion is whole | `CHECK ((outcome IS NULL) = (completed_at IS NULL))` |
 *
 * ── Where the untyped data enters ────────────────────────────────────────
 *
 * `checkpoint` is JSONB, so what comes back is `unknown`. This is the ONE
 * place in the system where a checkpoint can be something this build cannot
 * read — written by an older or newer version, or corrupted — and it is
 * therefore the only place `isReadableCheckpoint` belongs.
 *
 * An unreadable checkpoint is **discarded and the run reset to its start**,
 * never guessed at. Slower, never wrong: guessing at a half-understood resume
 * point produces confident wrong behaviour, which on a real application means
 * re-filling a form somebody has already submitted half of.
 */

import type { Pool } from "pg";

import { beginCheckpoint, blueprintVersion, canTransitionStatus, isReadableCheckpoint } from "@askimate/aas-domain";
import type {
  ActionIntent,
  CaseId,
  ConsequentialAction,
  ActionIdempotencyKey,
  IntentOutcome,
  RunId,
  StudentId,
  WorkflowCheckpoint,
  WorkflowRunRecord,
  WorkflowStatus,
} from "@askimate/aas-domain";

import { decodeEvent, encodeEvent } from "./serialisation.js";
import type { IntentRecord, WorkflowRunStore } from "./workflow-store.js";
import {
  RunAlreadyExistsError,
  RunConcurrencyError,
  RunNotFoundError,
  RunStatusError,
} from "./workflow-store.js";

const UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}

interface RunRow {
  readonly run_id: string;
  readonly case_id: string;
  readonly student_ref: string;
  readonly status: string;
  readonly revision: number;
  readonly checkpoint: unknown;
  readonly started_at: Date;
  readonly updated_at: Date;
}

/**
 * A fallback checkpoint's blueprint version when the stored one is unreadable.
 *
 * Deliberately a literal that cannot match any real blueprint, so a resume that
 * somehow proceeded on it would fail the blueprint check loudly rather than
 * quietly filling against the wrong revision.
 */
const UNKNOWN_BLUEPRINT = blueprintVersion("unreadable-checkpoint");

export class PostgresWorkflowRunStore implements WorkflowRunStore {
  public constructor(private readonly pool: Pool) {}

  public async start(
    run: Omit<WorkflowRunRecord, "revision" | "updatedAt">,
  ): Promise<WorkflowRunRecord> {
    const record: WorkflowRunRecord = { ...run, revision: 0, updatedAt: run.startedAt };
    try {
      await this.pool.query(
        `INSERT INTO workflow_runs
           (run_id, case_id, student_ref, status, revision, checkpoint, started_at, updated_at)
         VALUES ($1, $2, $3, $4, 0, $5::jsonb, $6, $7)`,
        [
          record.runId,
          record.caseId,
          record.studentRef,
          record.status,
          // The same tagged-date encoding the event log uses. A checkpoint's
          // `capturedAt` coming back as a string would compare and sort
          // wrongly, silently — see serialisation.ts.
          encodeEvent(record.checkpoint as never),
          record.startedAt,
          record.updatedAt,
        ],
      );
    } catch (error) {
      if (isUniqueViolation(error)) throw new RunAlreadyExistsError(record.runId);
      throw error;
    }
    return record;
  }

  public async load(runId: RunId): Promise<WorkflowRunRecord | null> {
    const rows = await this.pool.query<RunRow>(
      `SELECT run_id, case_id, student_ref, status, revision, checkpoint, started_at, updated_at
         FROM workflow_runs WHERE run_id = $1`,
      [runId],
    );
    const row = rows.rows[0];
    return row === undefined ? null : this.#toRecord(row);
  }

  public async saveCheckpoint(input: {
    readonly runId: RunId;
    readonly checkpoint: WorkflowCheckpoint;
    readonly expectedRevision: number;
    readonly status?: WorkflowStatus;
  }): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Locked for the duration, so the status check below cannot be made
      // against a status another transaction is in the middle of changing.
      const current = await client.query<RunRow>(
        `SELECT run_id, case_id, student_ref, status, revision, checkpoint, started_at, updated_at
           FROM workflow_runs WHERE run_id = $1 FOR UPDATE`,
        [input.runId],
      );
      const row = current.rows[0];
      if (row === undefined) {
        await client.query("ROLLBACK");
        throw new RunNotFoundError(input.runId);
      }
      if (row.revision !== input.expectedRevision) {
        await client.query("ROLLBACK");
        throw new RunConcurrencyError(input.runId, input.expectedRevision, row.revision);
      }
      const from = row.status as WorkflowStatus;
      if (input.status !== undefined && input.status !== from) {
        if (!canTransitionStatus(from, input.status)) {
          await client.query("ROLLBACK");
          throw new RunStatusError(input.runId, from, input.status);
        }
      }

      const revision = row.revision + 1;
      // Conditional on the revision as well as the lock: belt and braces, and
      // the row count is what proves exactly one writer won.
      const updated = await client.query(
        `UPDATE workflow_runs
            SET checkpoint = $1::jsonb, status = $2, revision = $3, updated_at = $4
          WHERE run_id = $5 AND revision = $6`,
        [
          encodeEvent(input.checkpoint as never),
          input.status ?? from,
          revision,
          input.checkpoint.capturedAt,
          input.runId,
          input.expectedRevision,
        ],
      );
      if (updated.rowCount !== 1) {
        await client.query("ROLLBACK");
        throw new RunConcurrencyError(input.runId, input.expectedRevision, row.revision);
      }

      await client.query("COMMIT");
      return revision;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  public async recordIntent(runId: RunId, intent: ActionIntent): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO workflow_action_intents
           (run_id, idempotency_key, action, target, started_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [runId, intent.idempotencyKey, intent.action, intent.target, intent.startedAt],
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new Error(
          `An intent for ${intent.idempotencyKey} already exists. Two intents for one key would ` +
            `make the record ambiguous, and the record is the only evidence about whether a ` +
            `consequential action happened.`,
        );
      }
      // A foreign-key violation means the run does not exist.
      if (
        typeof error === "object" &&
        error !== null &&
        (error as { code?: unknown }).code === "23503"
      ) {
        throw new RunNotFoundError(runId);
      }
      throw error;
    }
  }

  public async reopenIntent(
    runId: RunId,
    idempotencyKey: ActionIdempotencyKey,
    startedAt: Date,
  ): Promise<boolean> {
    // ONE statement, and the guard is in the WHERE rather than in a read
    // beforehand. A check-then-update would let two callers both see
    // `failed_cleanly` and both re-open — and while the work lease makes that
    // race unreachable today, the database is the right place for a rule whose
    // violation would create a second account on a real portal.
    //
    // `outcome = 'failed_cleanly'` is doing all the work: a `succeeded` row and
    // an unfinished row are both left exactly as they are, and the caller is
    // told `false`.
    const updated = await this.pool.query(
      `UPDATE workflow_action_intents
          SET started_at = $1, outcome = NULL, completed_at = NULL
        WHERE run_id = $2 AND idempotency_key = $3 AND outcome = 'failed_cleanly'`,
      [startedAt, runId, idempotencyKey],
    );
    return updated.rowCount === 1;
  }

  public async completeIntent(
    runId: RunId,
    idempotencyKey: ActionIdempotencyKey,
    outcome: IntentOutcome,
    now: Date,
  ): Promise<void> {
    // Conditional on the outcome being unset, so a completion cannot silently
    // overwrite a different one. rowCount then distinguishes "recorded" from
    // "already had one", and only the second needs a read to decide.
    const updated = await this.pool.query(
      `UPDATE workflow_action_intents
          SET outcome = $1, completed_at = $2
        WHERE run_id = $3 AND idempotency_key = $4 AND outcome IS NULL`,
      [outcome, now, runId, idempotencyKey],
    );
    if (updated.rowCount === 1) return;

    const existing = await this.findIntent(runId, idempotencyKey);
    if (existing === null) {
      throw new Error(
        `No intent for ${idempotencyKey}. A completion without an intent means the action was ` +
          `performed without first recording that it was about to be, which is the ordering the ` +
          `whole mechanism depends on.`,
      );
    }
    if (existing.completed?.outcome === outcome) return; // idempotent
    throw new Error(
      `Intent ${idempotencyKey} was already completed as ${String(existing.completed?.outcome)} ` +
        `and cannot now be ${outcome}.`,
    );
  }

  public async findIntent(
    runId: RunId,
    idempotencyKey: ActionIdempotencyKey,
  ): Promise<IntentRecord | null> {
    const rows = await this.pool.query<{
      idempotency_key: string;
      action: string;
      target: string;
      started_at: Date;
      outcome: string | null;
      completed_at: Date | null;
    }>(
      `SELECT idempotency_key, action, target, started_at, outcome, completed_at
         FROM workflow_action_intents WHERE run_id = $1 AND idempotency_key = $2`,
      [runId, idempotencyKey],
    );
    const row = rows.rows[0];
    if (row === undefined) return null;

    const intent: ActionIntent = {
      idempotencyKey: row.idempotency_key as ActionIdempotencyKey,
      action: row.action as ConsequentialAction,
      target: row.target,
      startedAt: row.started_at,
    };
    return row.outcome === null || row.completed_at === null
      ? { intent }
      : {
          intent,
          completed: { outcome: row.outcome as IntentOutcome, completedAt: row.completed_at },
        };
  }

  public async findByCase(caseId: CaseId): Promise<readonly WorkflowRunRecord[]> {
    const rows = await this.pool.query<RunRow>(
      `SELECT run_id, case_id, student_ref, status, revision, checkpoint, started_at, updated_at
         FROM workflow_runs WHERE case_id = $1 ORDER BY started_at DESC`,
      [caseId],
    );
    return rows.rows.map((row) => this.#toRecord(row));
  }

  public async discardCheckpoints(runId: RunId): Promise<void> {
    const existing = await this.load(runId);
    if (existing === null) throw new RunNotFoundError(runId);

    await this.pool.query(
      `UPDATE workflow_runs SET checkpoint = $1::jsonb, revision = revision + 1, updated_at = $2
        WHERE run_id = $3`,
      [
        encodeEvent(
          beginCheckpoint({
            blueprintVersion: existing.checkpoint.blueprintVersion,
            now: existing.updatedAt,
          }) as never,
        ),
        existing.updatedAt,
        runId,
      ],
    );
    // Intents are NOT discarded — see the port's docstring. They are evidence
    // that a consequential action may have happened, and losing one turns a
    // detectable uncertainty into a silent repeat.
  }

  #toRecord(row: RunRow): WorkflowRunRecord {
    // ── Decoding must NEVER throw here ──────────────────────────────────
    //
    // Found by the corrupt-checkpoint test, which is exactly why it exists.
    // `decodeEvent` is built for EVENTS, which are always objects, and it
    // calls `JSON.parse` on a string input. A JSONB column holding the scalar
    // `"a string"` comes back from pg as the JS string `a string`, and parsing
    // that throws — so a corrupt checkpoint CRASHED the load instead of being
    // discarded, which is the opposite of the behaviour claimed for it.
    //
    // The asymmetry is deliberate and worth stating: an unreadable EVENT is a
    // serious problem — business truth is corrupt and a crash is the right
    // answer — while an unreadable CHECKPOINT is routine, because a checkpoint
    // is disposable by design. So `decodeEvent` keeps throwing, and this call
    // site absorbs it.
    let decoded: unknown;
    try {
      decoded = decodeEvent(row.checkpoint);
    } catch {
      decoded = null;
    }

    // ── The one place an unreadable checkpoint can appear ───────────────
    //
    // JSONB comes back as `unknown`. A checkpoint written by an older or newer
    // build, or corrupted, is DISCARDED and the run reset to its start —
    // never guessed at. A half-understood resume point produces confident
    // wrong behaviour, which on a real application means re-filling a form
    // somebody has already half-submitted.
    const checkpoint: WorkflowCheckpoint = isReadableCheckpoint(decoded)
      ? decoded
      : beginCheckpoint({ blueprintVersion: UNKNOWN_BLUEPRINT, now: row.updated_at });

    return {
      runId: row.run_id as RunId,
      caseId: row.case_id as CaseId,
      studentRef: row.student_ref as StudentId,
      status: row.status as WorkflowStatus,
      revision: Number(row.revision),
      checkpoint,
      startedAt: row.started_at,
      updatedAt: row.updated_at,
    };
  }
}
