/**
 * In-memory `InterventionStore`.
 *
 * Passes the same `runInterventionStoreContract` suite as the Postgres
 * adapter — the discipline every port in this package follows, so a guarantee
 * proved against one is proved against both.
 */

import type { ActionIntent, InterventionId, RunId } from "@askimate/aas-domain";
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

function copy(record: StoredIntervention): StoredIntervention {
  return {
    ...record,
    escalation: {
      ...record.escalation,
      checkpoint: {
        ...record.escalation.checkpoint,
        pagesCompleted: [...record.escalation.checkpoint.pagesCompleted],
        capturedAt: new Date(record.escalation.checkpoint.capturedAt.getTime()),
      },
      raisedAt: new Date(record.escalation.raisedAt.getTime()),
    },
    context: { ...record.context },
    ...(record.announcedAt === undefined
      ? {}
      : { announcedAt: new Date(record.announcedAt.getTime()) }),
    ...(record.resolution === undefined
      ? {}
      : {
          resolution: {
            ...record.resolution,
            resolvedAt: new Date(record.resolution.resolvedAt.getTime()),
          },
        }),
    ...(record.reusability === undefined ? {} : { reusability: { ...record.reusability } }),
  };
}

export class InMemoryInterventionStore implements InterventionStore {
  readonly #byId = new Map<string, StoredIntervention>();
  /** `${runId} ${idempotencyKey}` to interventionId. The uniqueness constraint. */
  readonly #byAction = new Map<string, string>();

  static #actionKey(runId: RunId, key: ActionIntent["idempotencyKey"]): string {
    return `${runId} ${key}`;
  }

  public async raise(input: RaiseInput): Promise<RaisedIntervention> {
    await Promise.resolve();
    const actionKey = InMemoryInterventionStore.#actionKey(input.runId, input.idempotencyKey);
    const existing = this.#byAction.get(actionKey);
    if (existing !== undefined) {
      return { interventionId: existing as InterventionId, created: false };
    }
    const record: StoredIntervention = {
      interventionId: input.interventionId,
      runId: input.runId,
      idempotencyKey: input.idempotencyKey,
      caseId: input.caseId,
      studentRef: input.studentRef,
      escalation: input.escalation,
      context: input.context,
      lifecycle: "captured",
    };
    this.#byId.set(input.interventionId, copy(record));
    this.#byAction.set(actionKey, input.interventionId);
    return { interventionId: input.interventionId, created: true };
  }

  public async open(): Promise<readonly StoredIntervention[]> {
    await Promise.resolve();
    return [...this.#byId.values()]
      .filter((record) => record.resolution === undefined)
      .sort((a, b) => a.escalation.raisedAt.getTime() - b.escalation.raisedAt.getTime())
      .map(copy);
  }

  public async find(interventionId: InterventionId): Promise<StoredIntervention | null> {
    await Promise.resolve();
    const found = this.#byId.get(interventionId);
    return found === undefined ? null : copy(found);
  }

  public async findForAction(
    runId: RunId,
    idempotencyKey: ActionIntent["idempotencyKey"],
  ): Promise<StoredIntervention | null> {
    const id = this.#byAction.get(InMemoryInterventionStore.#actionKey(runId, idempotencyKey));
    return id === undefined ? null : this.find(id as InterventionId);
  }

  public async markAnnounced(interventionId: InterventionId, now: Date): Promise<void> {
    await Promise.resolve();
    const found = this.#byId.get(interventionId);
    if (found === undefined) throw new InterventionNotFoundError(interventionId);
    // Once. A second call is a no-op rather than a moved timestamp: when the
    // student was told is a fact about the past.
    if (found.announcedAt !== undefined) return;
    this.#byId.set(interventionId, { ...found, announcedAt: new Date(now.getTime()) });
  }

  public async resolve(input: ResolveInput): Promise<StoredIntervention> {
    await Promise.resolve();
    const found = this.#byId.get(input.interventionId);
    if (found === undefined) throw new InterventionNotFoundError(input.interventionId);
    if (found.resolution !== undefined) {
      throw new InterventionAlreadyResolvedError(
        input.interventionId,
        found.resolution.specialistId,
        found.resolution.resolvedAt,
      );
    }
    if (input.resolution.outcome === "route_fallback") {
      throw new ResolutionOutcomeNotImplementedError(input.resolution.outcome);
    }
    const resolved: StoredIntervention = {
      ...found,
      resolution: input.resolution,
      reusability: input.reusability,
      lifecycle: "captured",
    };
    this.#byId.set(input.interventionId, copy(resolved));
    return copy(resolved);
  }
}
