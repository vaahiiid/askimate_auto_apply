/**
 * The task model.
 *
 * A task is a unit of work the case is waiting on. Tasks are how "the system
 * stops and asks the student" (brief §3.1) becomes something observable rather
 * than a comment in a log file.
 *
 * Like case state, the task list is derived from the event log, never stored as
 * mutable rows that could drift from it.
 */

import type { TaskId } from "./ids.js";
import type { UnavailableReason } from "./values.js";

/** Who has to do something. */
export type TaskAssignee = "student" | "specialist" | "system";

export type TaskStatus = "open" | "done" | "cancelled" | "superseded";

/**
 * What kind of work a task represents.
 *
 * A closed union rather than free text, so the orchestrator can route tasks
 * without string matching and so a new kind forces a routing decision.
 */
export type TaskKind =
  /** A required profile field has no confirmed source. */
  | "provide_profile_field"
  /** A required document is missing. */
  | "provide_document"
  /** Extracted data needs the student's confirmation before it can be stored. */
  | "confirm_extracted_data"
  /** A document expired or fell outside its validity window. */
  | "replace_expired_document"
  /** Two confirmed sources disagree. */
  | "resolve_conflict"
  /** A human specialist must review the case. */
  | "human_review"
  /** Something only the student can do in the portal. */
  | "complete_handoff"
  /** The student must approve the exact content to be submitted. */
  | "authorise_submission"
  /** Requirement data is stale and must be revalidated against its source. */
  | "revalidate_requirement";

export interface Task {
  readonly taskId: TaskId;
  readonly kind: TaskKind;
  readonly assignee: TaskAssignee;
  readonly description: string;
  /** True when the case cannot progress until this is resolved. */
  readonly blocksProgress: boolean;
  readonly status: TaskStatus;
  readonly raisedAt: Date;
  readonly completedAt?: Date;
  /** For field tasks, why the field was unavailable. */
  readonly unavailableReason?: UnavailableReason;
}

/** Who a task kind belongs to. Centralised so routing cannot drift per call site. */
const ASSIGNEE_BY_KIND: Readonly<Record<TaskKind, TaskAssignee>> = {
  provide_profile_field: "student",
  provide_document: "student",
  confirm_extracted_data: "student",
  replace_expired_document: "student",
  resolve_conflict: "student",
  human_review: "specialist",
  complete_handoff: "student",
  authorise_submission: "student",
  revalidate_requirement: "system",
};

export function assigneeFor(kind: TaskKind): TaskAssignee {
  return ASSIGNEE_BY_KIND[kind];
}

/**
 * Task kinds that block progress by their nature.
 *
 * `revalidate_requirement` is the one that does not: stale requirement data is
 * worth refreshing, but the case can keep preparing while it happens. Every
 * other kind is something without which the application would be incomplete or
 * unauthorised.
 */
const NON_BLOCKING: ReadonlySet<TaskKind> = new Set<TaskKind>(["revalidate_requirement"]);

export function blocksProgressByDefault(kind: TaskKind): boolean {
  return !NON_BLOCKING.has(kind);
}

/** Only open tasks. */
export function openTasks(tasks: readonly Task[]): readonly Task[] {
  return tasks.filter((task) => task.status === "open");
}

/** Open tasks that are actually blocking the case. */
export function blockingTasks(tasks: readonly Task[]): readonly Task[] {
  return tasks.filter((task) => task.status === "open" && task.blocksProgress);
}

/** True when nothing open is blocking progress. */
export function isUnblocked(tasks: readonly Task[]): boolean {
  return blockingTasks(tasks).length === 0;
}
