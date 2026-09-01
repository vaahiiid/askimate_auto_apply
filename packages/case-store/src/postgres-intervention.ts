/**
 * The Postgres intervention store.
 *
 * Passes the same contract as the in-memory one. As everywhere in this package,
 * the guarantees that matter are constraints rather than application code:
 *
 * | Guarantee | Enforced by |
 * |---|---|
 * | one intervention per stuck action | `UNIQUE (run_id, idempotency_key)` |
 * | a resolution is whole, or absent | `CHECK` across all six resolution columns |
 * | `route_fallback` is not implemented | `CHECK (outcome IN ('resume','abandon'))` |
 * | a second resolution cannot overwrite | a conditional UPDATE, checked by rowCount |
 *
 * The last two are worth being explicit about, because both are refusals and a
 * refusal that lives only in a parser is one caller away from being bypassed.
 *
 * ── Where the untyped data enters ────────────────────────────────────────
 *
 * `checkpoint`, `context` and `reusability` are JSONB, so what comes back is
 * `unknown`. Unlike a checkpoint, none of these drives behaviour — they are
 * read by a person (ADR-0048 §5), so an unreadable one is surfaced as it is
 * rather than discarded. There is no branch here that guesses at their shape.
 */

import type { Pool } from "pg";

import type {
  ActionIntent,
  CaseId,
  InterventionContext,
  InterventionId,
  InterventionLifecycle,
  RecoveryEscalation,
  RecoveryResolution,
  ReusabilityAssessment,
  RunId,
} from "@askimate/aas-domain";

import {
  InterventionAlreadyResolvedError,
  InterventionNotFoundError,
  ResolutionOutcomeNotImplementedError,
} from "./intervention-store.js";
import type {
  InterventionStore,
  RaiseInput,
  RaisedIntervention,
  ResolveInput,
  StoredIntervention,
} from "./intervention-store.js";

interface Row {
  readonly intervention_id: string;
  readonly run_id: string;
  readonly idempotency_key: string;
  readonly case_id: string;
  readonly student_ref: string;
  readonly reason: string;
  readonly priority: string;
  readonly encountered: string;
  readonly expected: string;
  readonly checkpoint: unknown;
  readonly context: unknown;
  readonly raised_at: Date;
  readonly announced_at: Date | null;
  readonly lifecycle: string;
  readonly specialist_id: string | null;
  readonly actions_taken: string | null;
  readonly resolution: string | null;
  readonly resolution_outcome: string | null;
  readonly resolved_at: Date | null;
  readonly reusability: unknown;
}

const COLUMNS = `intervention_id, run_id, idempotency_key, case_id, student_ref, reason, priority,
                 encountered, expected, checkpoint, context, raised_at, announced_at, lifecycle,
                 specialist_id, actions_taken, resolution, resolution_outcome, resolved_at,
                 reusability`;

/**
 * JSONB comes back with dates as strings.
 *
 * The same class of bug P8 found in stored provenance: a `Date` in the type and
 * a `string` at runtime, invisible to the compiler and a `TypeError` the first
 * time anyone calls a method on it.
 */
function checkpointFrom(value: unknown): RecoveryEscalation["checkpoint"] {
  const raw = value as RecoveryEscalation["checkpoint"] & { capturedAt: string | Date };
  return { ...raw, capturedAt: new Date(raw.capturedAt) };
}

function recordFrom(row: Row): StoredIntervention {
  const escalation: RecoveryEscalation = {
    reason: row.reason as RecoveryEscalation["reason"],
    priority: row.priority as RecoveryEscalation["priority"],
    encountered: row.encountered,
    expected: row.expected,
    checkpoint: checkpointFrom(row.checkpoint),
    raisedAt: row.raised_at,
  };
  const resolution: RecoveryResolution | undefined =
    row.resolved_at === null
      ? undefined
      : {
          specialistId: row.specialist_id ?? "",
          actionsTaken: row.actions_taken ?? "",
          resolution: row.resolution ?? "",
          resolvedAt: row.resolved_at,
          outcome: row.resolution_outcome as RecoveryResolution["outcome"],
        };
  return {
    interventionId: row.intervention_id as InterventionId,
    runId: row.run_id as RunId,
    idempotencyKey: row.idempotency_key as ActionIntent["idempotencyKey"],
    caseId: row.case_id as CaseId,
    studentRef: row.student_ref,
    escalation,
    context: row.context as InterventionContext,
    lifecycle: row.lifecycle as InterventionLifecycle,
    ...(row.announced_at === null ? {} : { announcedAt: row.announced_at }),
    ...(resolution === undefined ? {} : { resolution }),
    ...(row.reusability === null || row.reusability === undefined
      ? {}
      : { reusability: row.reusability as ReusabilityAssessment }),
  };
}

export class PostgresInterventionStore implements InterventionStore {
  public constructor(private readonly pool: Pool) {}

  public async raise(input: RaiseInput): Promise<RaisedIntervention> {
    // ON CONFLICT DO NOTHING against the uniqueness constraint, so two pollers
    // racing on one stuck run produce one intervention rather than a duplicate
    // and an error. rowCount distinguishes "I created it" from "it was already
    // there", and the caller needs that: it is the difference between telling
    // the student and having told them.
    const inserted = await this.pool.query(
      `INSERT INTO interventions
           (intervention_id, run_id, idempotency_key, case_id, student_ref, reason, priority,
            encountered, expected, checkpoint, context, raised_at, lifecycle)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12, 'captured')
       ON CONFLICT ON CONSTRAINT interventions_one_per_stuck_action DO NOTHING`,
      [
        input.interventionId,
        input.runId,
        input.idempotencyKey,
        input.caseId,
        input.studentRef,
        input.escalation.reason,
        input.escalation.priority,
        input.escalation.encountered,
        input.escalation.expected,
        JSON.stringify(input.escalation.checkpoint),
        JSON.stringify(input.context),
        input.escalation.raisedAt,
      ],
    );
    if (inserted.rowCount === 1) {
      return { interventionId: input.interventionId, created: true };
    }
    const existing = await this.findForAction(input.runId, input.idempotencyKey);
    if (existing === null) throw new InterventionNotFoundError(input.interventionId);
    return { interventionId: existing.interventionId, created: false };
  }

  public async open(): Promise<readonly StoredIntervention[]> {
    const found = await this.pool.query<Row>(
      `SELECT ${COLUMNS} FROM interventions WHERE resolved_at IS NULL ORDER BY raised_at ASC`,
    );
    return found.rows.map(recordFrom);
  }

  public async find(interventionId: InterventionId): Promise<StoredIntervention | null> {
    const found = await this.pool.query<Row>(
      `SELECT ${COLUMNS} FROM interventions WHERE intervention_id = $1`,
      [interventionId],
    );
    const row = found.rows[0];
    return row === undefined ? null : recordFrom(row);
  }

  public async findForAction(
    runId: RunId,
    idempotencyKey: ActionIntent["idempotencyKey"],
  ): Promise<StoredIntervention | null> {
    const found = await this.pool.query<Row>(
      `SELECT ${COLUMNS} FROM interventions WHERE run_id = $1 AND idempotency_key = $2`,
      [runId, idempotencyKey],
    );
    const row = found.rows[0];
    return row === undefined ? null : recordFrom(row);
  }

  public async markAnnounced(interventionId: InterventionId, now: Date): Promise<void> {
    // Conditional on it being unset, so a replay cannot move the timestamp:
    // when the student was told is a fact about the past.
    const updated = await this.pool.query(
      `UPDATE interventions SET announced_at = $1
         WHERE intervention_id = $2 AND announced_at IS NULL`,
      [now, interventionId],
    );
    if (updated.rowCount === 1) return;
    const existing = await this.find(interventionId);
    if (existing === null) throw new InterventionNotFoundError(interventionId);
  }

  public async resolve(input: ResolveInput): Promise<StoredIntervention> {
    if (input.resolution.outcome === "route_fallback") {
      // Refused before the database sees it, so the error names the decision
      // rather than a constraint. The CHECK is still there as the backstop.
      throw new ResolutionOutcomeNotImplementedError(input.resolution.outcome);
    }
    // Conditional on there being no resolution yet. A second adjudication does
    // not overwrite the first — see the error's own explanation.
    const updated = await this.pool.query(
      `UPDATE interventions
          SET specialist_id = $1, actions_taken = $2, resolution = $3,
              resolution_outcome = $4, resolved_at = $5, reusability = $6::jsonb
        WHERE intervention_id = $7 AND resolved_at IS NULL`,
      [
        input.resolution.specialistId,
        input.resolution.actionsTaken,
        input.resolution.resolution,
        input.resolution.outcome,
        input.resolution.resolvedAt,
        JSON.stringify(input.reusability),
        input.interventionId,
      ],
    );
    const after = await this.find(input.interventionId);
    if (after === null) throw new InterventionNotFoundError(input.interventionId);
    if (updated.rowCount === 1) return after;
    const held = after.resolution;
    if (held === undefined) throw new InterventionNotFoundError(input.interventionId);
    throw new InterventionAlreadyResolvedError(
      input.interventionId,
      held.specialistId,
      held.resolvedAt,
    );
  }
}
