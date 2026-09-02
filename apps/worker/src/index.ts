/**
 * @askimate/aas-worker — the Background Worker (ADR-0052).
 *
 * The fifth deployable. It listens on nothing, holds no durable state, and
 * carries conversation-plane credentials only — no secure-database credential,
 * no KMS grant, no route to the vault's cache.
 *
 * Its whole job is to make the system act when nobody is watching. Before it,
 * a case moved only while a student's browser was posting.
 */

export type { RunningWorker, WorkerDriver, WorkerOptions } from "./worker.js";
export {
  DEFAULT_ADVANCE_MS,
  DEFAULT_ANNOUNCE_MS,
  DEFAULT_BATCH,
  advancePass,
  startWorker,
} from "./worker.js";
