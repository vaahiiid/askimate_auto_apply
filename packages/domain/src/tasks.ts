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

/**
 * Who is RESPONSIBLE for closing the task.
 *
 * Note this is deliberately not "who has the information". Under ADR-0007 the
 * agent owns every information-gathering task and must obtain what it needs by
 * interviewing the student — the student is the *source*, never the assignee of
 * a form to fill in.
 *
 *   agent      — the agent must obtain this, by asking or by looking it up
 *   specialist — a named human reviewer must act
 *   student    — ONLY the student can do this. See STUDENT_OWNED_KINDS below;
 *                the set is exactly two, and a test asserts it never grows.
 */
export type TaskOwner = "agent" | "specialist" | "student";

/**
 * Where the information behind an information-gathering task comes from.
 *
 * Separate from ownership. The agent owns obtaining it; this says where from.
 */
export type InformationSource = "student_conversation" | "student_document" | "external_source";

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
  readonly owner: TaskOwner;
  /** For information-gathering tasks, where the agent must obtain it from. */
  readonly source?: InformationSource;
  readonly description: string;
  /** True when the case cannot progress until this is resolved. */
  readonly blocksProgress: boolean;
  readonly status: TaskStatus;
  readonly raisedAt: Date;
  readonly completedAt?: Date;
  /** For field tasks, why the field was unavailable. */
  readonly unavailableReason?: UnavailableReason;
}

/**
 * The ONLY task kinds a student may own (ADR-0007).
 *
 * Both are things brief §7 explicitly requires of the student and forbids
 * automating: a handoff (identity verification, MFA, OTP, CAPTCHA, payment, a
 * legal declaration) and the final authorisation of exactly what will be
 * submitted.
 *
 * Neither is "completing an application form" — one is an action only the
 * student can legitimately perform, the other is reviewing and approving.
 *
 * This set is asserted by test. If a future change tries to add a third, that
 * test fails and forces the conversation, rather than the product quietly
 * drifting back towards making students fill in forms.
 */
export const STUDENT_OWNED_KINDS = ["complete_handoff", "authorise_submission"] as const satisfies readonly TaskKind[];

/** Who a task kind belongs to. Centralised so routing cannot drift per call site. */
const OWNER_BY_KIND: Readonly<Record<TaskKind, TaskOwner>> = {
  // ── Agent-owned: the agent must obtain these by interviewing the student ──
  provide_profile_field: "agent",
  provide_document: "agent",
  confirm_extracted_data: "agent",
  replace_expired_document: "agent",
  resolve_conflict: "agent",
  revalidate_requirement: "agent",
  // ── Specialist-owned ──
  human_review: "specialist",
  // ── Student-owned: only these two, and only because §7 requires them ──
  complete_handoff: "student",
  authorise_submission: "student",
};

/** Where the agent must obtain the information, for gathering tasks. */
const SOURCE_BY_KIND: Readonly<Partial<Record<TaskKind, InformationSource>>> = {
  provide_profile_field: "student_conversation",
  provide_document: "student_document",
  confirm_extracted_data: "student_conversation",
  replace_expired_document: "student_document",
  resolve_conflict: "student_conversation",
  revalidate_requirement: "external_source",
};

export function ownerFor(kind: TaskKind): TaskOwner {
  return OWNER_BY_KIND[kind];
}

export function sourceFor(kind: TaskKind): InformationSource | undefined {
  return SOURCE_BY_KIND[kind];
}

/**
 * True when the agent must obtain this by asking the student in conversation.
 *
 * The interview engine (Phase 2) drives off this: these become questions, not
 * form fields.
 */
export function isConversationalAsk(kind: TaskKind): boolean {
  return SOURCE_BY_KIND[kind] === "student_conversation";
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
