/**
 * Identifiers.
 *
 * Every id is branded, so a `CaseId` cannot be passed where a `StudentId` is
 * expected even though both are strings at runtime. In a system where the
 * catastrophic failure mode is "the right operation applied to the wrong
 * record", that swap is exactly the bug worth making impossible.
 */

import type { Brand } from "./brand.js";

export type StudentId = Brand<string, "StudentId">;
export type CaseId = Brand<string, "CaseId">;
export type TaskId = Brand<string, "TaskId">;
export type EventId = Brand<string, "EventId">;
export type InstitutionId = Brand<string, "InstitutionId">;
export type CourseId = Brand<string, "CourseId">;
export type BlueprintVersion = Brand<string, "BlueprintVersion">;
export type InterventionId = Brand<string, "InterventionId">;

/**
 * An external reference supplied by AskiMate, e.g. `askimate:user:4812`.
 * Opaque to AAS: we never parse it, only store and echo it.
 */
export type ExternalRef = Brand<string, "ExternalRef">;

/**
 * An intake, as `YYYY-MM` (e.g. `2027-09`).
 *
 * Month granularity is deliberate. Intakes are named by month in every
 * prospectus we will meet ("September 2027 entry"); a day component would imply
 * a precision that does not exist and would silently split one intake into many
 * distinct idempotency keys — which would defeat the duplicate-submission
 * guarantee in ADR-0006.
 */
export type Intake = Brand<string, "Intake">;

const INTAKE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Type guard for `Intake`. */
export function isIntake(value: string): value is Intake {
  return INTAKE_PATTERN.test(value);
}

const NON_EMPTY = /\S/;

function requireNonEmpty(value: string, label: string): void {
  if (!NON_EMPTY.test(value)) {
    throw new RangeError(`${label} must not be empty or whitespace-only`);
  }
}

/*
 * Constructors.
 *
 * These are the only sanctioned way to mint an id. They validate, then brand.
 * They are cheap on purpose — the point is not heavy validation, it is that
 * there is exactly one place per id type where a raw string becomes a typed one,
 * so that place can be audited.
 */

export function studentId(value: string): StudentId {
  requireNonEmpty(value, "studentId");
  return value as StudentId;
}

export function caseId(value: string): CaseId {
  requireNonEmpty(value, "caseId");
  return value as CaseId;
}

export function taskId(value: string): TaskId {
  requireNonEmpty(value, "taskId");
  return value as TaskId;
}

export function eventId(value: string): EventId {
  requireNonEmpty(value, "eventId");
  return value as EventId;
}

export function institutionId(value: string): InstitutionId {
  requireNonEmpty(value, "institutionId");
  return value as InstitutionId;
}

export function courseId(value: string): CourseId {
  requireNonEmpty(value, "courseId");
  return value as CourseId;
}

export function blueprintVersion(value: string): BlueprintVersion {
  requireNonEmpty(value, "blueprintVersion");
  return value as BlueprintVersion;
}

export function interventionId(value: string): InterventionId {
  requireNonEmpty(value, "interventionId");
  return value as InterventionId;
}

export function externalRef(value: string): ExternalRef {
  requireNonEmpty(value, "externalRef");
  return value as ExternalRef;
}

export function intake(value: string): Intake {
  if (!isIntake(value)) {
    throw new RangeError(`intake must be formatted YYYY-MM (e.g. "2027-09"), received: ${value}`);
  }
  return value;
}
