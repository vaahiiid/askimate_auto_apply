/**
 * The canonical profile, and the typed field resolver.
 *
 * Confirmed-only storage: a value enters the profile through `confirmField`,
 * which accepts only the output of `applyConfirmation`. There is no setter that
 * takes a raw value, so "confirmed-only writes" is a property of the API rather
 * than a rule someone follows.
 *
 * "Fill once, apply to many" (brief §2.2): one profile per student, reused
 * across every application. Nothing here is per-case.
 */

import type { ConfirmedValue, FieldResolution, StudentId } from "@askimate/aas-domain";
import { fieldUnavailable, provenanceOf } from "@askimate/aas-domain";

import type { ConfirmedField } from "./confirmation.js";
import type { ProfileFieldKey, ProfileFieldType } from "./fields.js";
import { PROFILE_FIELD_KEYS } from "./fields.js";

/** An entry in the profile. Always confirmed — there is no other kind. */
interface ProfileEntry {
  readonly value: ConfirmedValue<unknown>;
  /** Bumped on every re-confirmation, so corrections are countable. */
  readonly revision: number;
}

/**
 * A student's canonical profile.
 *
 * Immutable. Every write returns a new profile, which keeps the case's derived
 * state honest — a profile cannot change under a decision that already read it.
 */
export interface ConfirmedProfile {
  readonly studentId: StudentId;
  readonly entries: ReadonlyMap<ProfileFieldKey, ProfileEntry>;
  readonly updatedAt: Date;
}

/** An empty profile. */
export function emptyProfile(studentId: StudentId, now: Date): ConfirmedProfile {
  return { studentId, entries: new Map(), updatedAt: now };
}

/**
 * Writes a confirmed field into the profile.
 *
 * The ONLY way in. It takes a `ConfirmedField`, which only
 * `applyConfirmation` produces, which in turn requires a `StudentConfirmation`.
 * The chain from "student said yes" to "stored" is unbroken and enforced by
 * types at every link.
 */
export function confirmField<K extends ProfileFieldKey>(
  profile: ConfirmedProfile,
  field: ConfirmedField<K>,
  now: Date,
): ConfirmedProfile {
  const entries = new Map(profile.entries);
  const existing = entries.get(field.key);
  entries.set(field.key, {
    value: field.value,
    revision: (existing?.revision ?? 0) + 1,
  });
  return { ...profile, entries, updatedAt: now };
}

/**
 * Resolves one field.
 *
 * The typed resolver ADR-0004 specifies. Returns either a `ConfirmedValue` of
 * exactly the right type, or `FieldUnavailable` — never a guess, never a
 * default, never an empty string standing in for "we don't know".
 *
 * Asking for `identity.date_of_birth` gives `ConfirmedValue<Date>`; asking for
 * `contact.email` gives `ConfirmedValue<string>`. Mixing them up is a compile
 * error rather than a runtime surprise on a submitted application.
 */
export function resolveField<K extends ProfileFieldKey>(
  profile: ConfirmedProfile,
  key: K,
): FieldResolution<ProfileFieldType<K>> {
  const entry = profile.entries.get(key);
  if (entry === undefined) {
    return fieldUnavailable(key, "not_collected");
  }
  return entry.value as ConfirmedValue<ProfileFieldType<K>>;
}

/**
 * Resolves a field, marking it unavailable when its source document is no
 * longer valid.
 *
 * Brief §2.4: a document is offered for reuse only if it is still genuinely
 * valid. A value confirmed six months ago from a bank statement is still
 * *confirmed* — but the statement behind it may now be outside its recency
 * window, and the deterministic validity engine is what decides that.
 *
 * `invalidDocumentIds` comes from `@askimate/aas-documents`, which runs plain
 * date logic BEFORE any AI confidence system is involved.
 */
export function resolveFieldWithValidity<K extends ProfileFieldKey>(
  profile: ConfirmedProfile,
  key: K,
  invalidDocumentIds: ReadonlySet<string>,
): FieldResolution<ProfileFieldType<K>> {
  const resolution = resolveField(profile, key);
  const unavailable = (resolution as { kind?: unknown }).kind === "field_unavailable";
  if (unavailable) return resolution;

  const provenance = provenanceOf(resolution as ConfirmedValue<ProfileFieldType<K>>);
  if (provenance.documentId !== undefined && invalidDocumentIds.has(provenance.documentId)) {
    return fieldUnavailable(key, "source_expired");
  }
  return resolution;
}

/** True when a field has a confirmed value. */
export function hasField(profile: ConfirmedProfile, key: ProfileFieldKey): boolean {
  return profile.entries.has(key);
}

/** Which of the required fields are still missing. Drives the interview. */
export function missingFields(
  profile: ConfirmedProfile,
  required: readonly ProfileFieldKey[],
): readonly ProfileFieldKey[] {
  return required.filter((key) => !profile.entries.has(key));
}

/** Every field that has been confirmed. */
export function confirmedFieldKeys(profile: ConfirmedProfile): readonly ProfileFieldKey[] {
  return PROFILE_FIELD_KEYS.filter((key) => profile.entries.has(key));
}

/** How many times a field has been confirmed. 0 when never. */
export function revisionOf(profile: ConfirmedProfile, key: ProfileFieldKey): number {
  return profile.entries.get(key)?.revision ?? 0;
}
