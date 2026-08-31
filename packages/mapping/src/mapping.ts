/**
 * Field mapping: canonical profile field → this portal's field.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * MAPPING IS REVIEWED DATA. IT IS NEVER INFERRED AT RUN TIME.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Discovery deliberately does not fill in `mapsTo` on a blueprint field
 * (see `packages/blueprint`), because a blueprint that guessed its own mappings
 * would put the AI back in the business of deciding what goes in a form field.
 * This package is where a human's decision about that is recorded.
 *
 * The two artefacts and what each is:
 *
 *   BLUEPRINT     what the portal IS       — discovered, then reviewed
 *   MAPPING SET   what goes WHERE          — authored by a specialist, reviewed
 *
 * Both are versioned data. Neither is code, and adding the second university
 * changes neither the orchestrator nor this package.
 *
 * ── Why a mapping set is pinned to a blueprint version ────────────────────
 *
 * A mapping says "the student's date of birth goes in field `dob_1`". That is
 * only true of the blueprint it was reviewed against. If the portal changes and
 * a new blueprint version renumbers its fields, the old mapping is not merely
 * stale — it is a set of confident instructions to type real student data into
 * the wrong boxes. So the pin is checked, and a mismatch refuses.
 */

import type { ApplicationBlueprint, BlueprintField, FieldLocator } from "@askimate/aas-blueprint";
import { allFields } from "@askimate/aas-blueprint";
import type { Brand } from "@askimate/aas-domain";
import type { FormatRule, ProfileFieldKey } from "@askimate/aas-profile";

/** Where a portal field's value comes from. */
export type ValueSource =
  /**
   * The student's confirmed profile. The ordinary case.
   *
   * `format` says how the confirmed value becomes this portal's notation. The
   * rule is data, not a function — see `renderConfirmed` for why that matters.
   */
  | {
      readonly kind: "profile_field";
      readonly fieldKey: ProfileFieldKey;
      readonly format: FormatRule;
    }
  /** A document upload. The vault supplies the bytes; nothing is typed. */
  | { readonly kind: "document"; readonly documentRef: string }
  /**
   * Only the student can do this (brief §7): MFA, OTP, CAPTCHA, payment, a
   * legal declaration, identity verification.
   *
   * A mapping, not an omission. Recording it here means the orchestrator knows
   * this field is *deliberately* not automated, rather than discovering an
   * unmapped field at fill time and treating it as a gap.
   */
  | { readonly kind: "student_handoff"; readonly reason: string }
  /**
   * A fixed value that is not the student's data — a course code, the intake
   * term, an agent reference.
   *
   * ── The one honest weak point in this file ──────────────────────────────
   *
   * A constant is a human typing a value into a university application, which
   * is exactly what ADR-0004 restricts. The controls are: the value must be
   * classified `application_metadata` by the author, a rationale is mandatory,
   * the whole set must be reviewed by a second person, and every constant
   * appears in the preview the student authorises.
   *
   * That is a review control, not a compile-time wall, and it is worth being
   * plain about why no wall is possible: "this string is course metadata and
   * not a student's personal data" is a fact about the world, and no type can
   * decide it. What the type CAN do is make every constant conspicuous, which
   * is what the classification field is for.
   *
   * A constant must never carry a student's personal information. If a value
   * varies per student, it is not a constant — it is a profile field that has
   * not been collected yet.
   */
  | {
      readonly kind: "constant";
      readonly value: string;
      readonly classification: "application_metadata";
      readonly rationale: string;
    }
  /**
   * The Secure Plane fills this. A MARKER, and nothing else (ADR-0043).
   *
   * ── The one source that says no value comes from here ───────────────────
   *
   * Every other member answers *where a value comes from*. This one answers
   * that none does: the field is filled by the Secure Plane's fill agent, out
   * of the vault, and the plan learns only that the field exists and needs one.
   *
   * It has no `value`, no `fieldKey`, no `format` and no `documentRef` — and
   * `NO_CREDENTIAL_SOURCE_FIELD_CAN_HOLD_A_VALUE` below fails the build if one
   * is added. "It must never contain plaintext" is therefore a property of the
   * type rather than a rule a reviewer has to remember.
   *
   * A mapping set using this is still reviewed by a second person (ADR-0017),
   * but what they review is "yes, the Secure Plane fills this, for this
   * purpose" — not a data route.
   */
  | { readonly kind: "secure_credential"; readonly purpose: CredentialPurpose };

/**
 * What a credential is for.
 *
 * The same two words the secure plane uses, written again rather than imported:
 * `packages/mapping` must not depend on `@askimate/aas-secrets`, which holds the
 * only plaintext in the system. `scripts/contract-drift.test.ts` compares the
 * two lists in both directions, exactly as it does for the lifecycle words.
 */
export const CREDENTIAL_PURPOSES = ["portal_account_creation", "portal_password_reset"] as const;
export type CredentialPurpose = (typeof CREDENTIAL_PURPOSES)[number];

/**
 * COMPILE-TIME: a credential source may hold nothing but its two closed-set
 * words.
 *
 * A `value`, a `fieldKey`, a `hint` or a `length` added later makes this stop
 * being `never` and fails the build naming the field. A CONSTRAINT, not a
 * computation — an assertion that merely evaluates to `never` on failure is
 * vacuous.
 */
type CredentialSource = Extract<ValueSource, { kind: "secure_credential" }>;
type NotClosedWords<T> = {
  [K in keyof T]-?: NonNullable<T[K]> extends "secure_credential" | CredentialPurpose ? never : K;
}[keyof T];
type AssertNever<T extends never> = T;
export type NO_CREDENTIAL_SOURCE_FIELD_CAN_HOLD_A_VALUE = AssertNever<
  NotClosedWords<CredentialSource>
>;

/** One portal field, and where its value comes from. */
export interface FieldMapping {
  /** The blueprint field this maps. */
  readonly fieldRef: string;
  readonly source: ValueSource;
  /** Why this mapping is right, for the reviewer and for the audit trail. */
  readonly note?: string;
}

export type MappingSetStatus =
  /** Authored, not yet checked by anyone else. NOT usable. */
  | "draft"
  /** A second specialist checked it against the blueprint. Usable. */
  | "reviewed"
  | "superseded"
  | "retired";

export interface MappingSet {
  readonly mappingSetId: string;
  readonly version: string;
  readonly status: MappingSetStatus;
  /** The blueprint this was reviewed against. Both are checked before use. */
  readonly blueprintId: string;
  readonly blueprintVersion: string;
  readonly mappings: readonly FieldMapping[];
  readonly authoredBy: string;
  readonly authoredAt: Date;
  /** Never the author. A mapping checked only by the person who wrote it is a draft. */
  readonly reviewedBy?: string;
  readonly reviewedAt?: Date;
}

/**
 * A mapping set that may drive a real fill.
 *
 * Branded for the same reason `ExecutableBlueprint` is: the check must be
 * unskippable rather than a convention. There is no constructor — `checkUsable`
 * is the only way to obtain one.
 */
export type UsableMappingSet = Brand<MappingSet, "UsableMappingSet">;

export type MappingRefusal =
  | { readonly kind: "not_reviewed"; readonly detail: string }
  | { readonly kind: "retired"; readonly detail: string }
  | { readonly kind: "reviewed_by_author"; readonly detail: string }
  | { readonly kind: "blueprint_mismatch"; readonly detail: string }
  | { readonly kind: "unknown_field_refs"; readonly detail: string; readonly fieldRefs: readonly string[] }
  | { readonly kind: "duplicate_mappings"; readonly detail: string; readonly fieldRefs: readonly string[] }
  /**
   * A password field is mapped to something other than the Secure Plane.
   *
   * The one route from a profile to a credential field that ADR-0026 exists to
   * prevent, refused at review time rather than discovered at fill time.
   */
  | { readonly kind: "credential_field_mismapped"; readonly detail: string; readonly fieldRefs: readonly string[] }
  /**
   * `secure_credential` is used on a field that is not a credential field.
   *
   * The other direction, and it is not symmetry for its own sake: without it
   * the marker becomes a way to say "the Secure Plane fills this" about a name
   * box, and the fill agent's masked-field check would refuse it at the last
   * moment instead of the mapping being refused at review time.
   */
  | { readonly kind: "credential_source_misused"; readonly detail: string; readonly fieldRefs: readonly string[] };

export type MappingCheck =
  | { readonly usable: true; readonly mappingSet: UsableMappingSet }
  | { readonly usable: false; readonly refusal: MappingRefusal };

/**
 * The gate between a mapping set and a real fill.
 *
 * Five conditions, each of which has an obvious way to go wrong in practice:
 * an unreviewed set, a retired one, one rubber-stamped by its own author, one
 * pinned to a different blueprint version, and one naming fields the blueprint
 * does not have.
 */
export function checkUsable(
  mappingSet: MappingSet,
  blueprint: ApplicationBlueprint,
): MappingCheck {
  if (mappingSet.status === "retired" || mappingSet.status === "superseded") {
    return {
      usable: false,
      refusal: {
        kind: "retired",
        detail: `Mapping set ${mappingSet.mappingSetId} is ${mappingSet.status}.`,
      },
    };
  }

  if (mappingSet.status !== "reviewed" || mappingSet.reviewedBy === undefined) {
    return {
      usable: false,
      refusal: {
        kind: "not_reviewed",
        detail:
          `Mapping set ${mappingSet.mappingSetId} has not been reviewed. A mapping decides what ` +
          `student data goes in which university form field; it does not run unchecked.`,
      },
    };
  }

  if (mappingSet.reviewedBy === mappingSet.authoredBy) {
    return {
      usable: false,
      refusal: {
        kind: "reviewed_by_author",
        detail:
          `Mapping set ${mappingSet.mappingSetId} was reviewed by its own author ` +
          `(${mappingSet.authoredBy}). That is a draft with a signature on it.`,
      },
    };
  }

  if (
    mappingSet.blueprintId !== String(blueprint.blueprintId) ||
    mappingSet.blueprintVersion !== blueprint.version
  ) {
    return {
      usable: false,
      refusal: {
        kind: "blueprint_mismatch",
        detail:
          `Mapping set ${mappingSet.mappingSetId} was reviewed against blueprint ` +
          `${mappingSet.blueprintId}@${mappingSet.blueprintVersion}, but the blueprint in hand is ` +
          `${String(blueprint.blueprintId)}@${blueprint.version}. Field references are only ` +
          `meaningful within the version they were checked against.`,
      },
    };
  }

  const known = new Set(allFields(blueprint).map((field) => field.fieldRef));
  const unknown = mappingSet.mappings
    .map((mapping) => mapping.fieldRef)
    .filter((fieldRef) => !known.has(fieldRef));
  if (unknown.length > 0) {
    return {
      usable: false,
      refusal: {
        kind: "unknown_field_refs",
        fieldRefs: unknown,
        detail: `The mapping set names fields the blueprint does not have: ${unknown.join(", ")}.`,
      },
    };
  }

  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const mapping of mappingSet.mappings) {
    if (seen.has(mapping.fieldRef)) duplicated.add(mapping.fieldRef);
    seen.add(mapping.fieldRef);
  }
  if (duplicated.size > 0) {
    return {
      usable: false,
      refusal: {
        kind: "duplicate_mappings",
        fieldRefs: [...duplicated],
        detail:
          `Two mappings target the same field: ${[...duplicated].join(", ")}. Which one wins ` +
          `would depend on ordering, which is not a decision anyone reviewed.`,
      },
    };
  }

  // ── ADR-0043: credential fields and credential sources, both ways ───────
  //
  // Checked here, in the domain authority, rather than only at the build:
  // `planFill` takes a `UsableMappingSet`, so a set that breaks either
  // direction cannot reach it. The signature does the work.
  const credentialFields = new Set(
    allFields(blueprint)
      .filter((field) => field.inputType === "password")
      .map((field) => field.fieldRef),
  );

  const mismapped = mappingSet.mappings
    .filter(
      (mapping) =>
        credentialFields.has(mapping.fieldRef) && mapping.source.kind !== "secure_credential",
    )
    .map((mapping) => mapping.fieldRef);
  if (mismapped.length > 0) {
    return {
      usable: false,
      refusal: {
        kind: "credential_field_mismapped",
        fieldRefs: mismapped,
        detail:
          `${mismapped.join(", ")} ${mismapped.length === 1 ? "is a" : "are"} credential field` +
          `${mismapped.length === 1 ? "" : "s"}, and may only be mapped with ` +
          `{ kind: "secure_credential" }. A password is not the student's profile data and never ` +
          `becomes a ConfirmedValue: it reaches its field through the Secure Plane's fill agent ` +
          `and nothing else (ADR-0026, ADR-0042, ADR-0043).`,
      },
    };
  }

  const misused = mappingSet.mappings
    .filter(
      (mapping) =>
        mapping.source.kind === "secure_credential" && !credentialFields.has(mapping.fieldRef),
    )
    .map((mapping) => mapping.fieldRef);
  if (misused.length > 0) {
    return {
      usable: false,
      refusal: {
        kind: "credential_source_misused",
        fieldRefs: misused,
        detail:
          `${misused.join(", ")} ${misused.length === 1 ? "is" : "are"} not a credential field, ` +
          `so { kind: "secure_credential" } does not belong there. The marker means the Secure ` +
          `Plane types a password into this field; on any other field that is a password typed ` +
          `somewhere it can be read (ADR-0043).`,
      },
    };
  }

  return { usable: true, mappingSet: mappingSet as UsableMappingSet };
}

export function isMappingRefused(check: MappingCheck): check is { usable: false; refusal: MappingRefusal } {
  return !check.usable;
}

/** The mapping for one field, if any. */
export function mappingFor(
  mappingSet: MappingSet,
  fieldRef: string,
): FieldMapping | undefined {
  return mappingSet.mappings.find((mapping) => mapping.fieldRef === fieldRef);
}

/** Whether the blueprint marks this field as required. */
export function isRequired(field: BlueprintField): boolean {
  return field.validations.some((validation) => validation.kind === "required");
}

/**
 * Required blueprint fields with no mapping.
 *
 * The list that says whether this mapping set is finished. A required field
 * with no mapping is not something to discover at fill time on a live portal.
 */
export function unmappedRequiredFields(
  blueprint: ApplicationBlueprint,
  mappingSet: MappingSet,
): readonly BlueprintField[] {
  return allFields(blueprint).filter(
    (field) => isRequired(field) && mappingFor(mappingSet, field.fieldRef) === undefined,
  );
}

/**
 * A constant that a reviewed mapping set actually contains.
 *
 * Branded, and constructible only from a `UsableMappingSet` — which requires a
 * second person's review. So a constant cannot appear in a fill plan unless a
 * human put it in a mapping set and another human checked it, which is the only
 * control available for a value that is not the student's to confirm.
 */
export type ReviewedConstant = Brand<
  {
    readonly text: string;
    readonly rationale: string;
    readonly mappingSetId: string;
    readonly reviewedBy: string;
  },
  "ReviewedConstant"
>;

/**
 * Mints a `ReviewedConstant`.
 *
 * The `UsableMappingSet` parameter is the whole point: it cannot be obtained
 * without passing `checkUsable`, so there is no route to a constant that
 * bypasses review.
 */
export function reviewedConstant(
  mappingSet: UsableMappingSet,
  source: Extract<ValueSource, { kind: "constant" }>,
): ReviewedConstant {
  return {
    text: source.value,
    rationale: source.rationale,
    mappingSetId: mappingSet.mappingSetId,
    // `checkUsable` refuses a set without a reviewer, so this is always present
    // by the time a UsableMappingSet exists.
    reviewedBy: mappingSet.reviewedBy ?? "",
  } as ReviewedConstant;
}

/** The text a constant will type. */
export function constantText(constant: ReviewedConstant): string {
  return constant.text;
}

/** Who stands behind a constant, for the preview and the audit trail. */
export function constantAttribution(
  constant: ReviewedConstant,
): { readonly rationale: string; readonly mappingSetId: string; readonly reviewedBy: string } {
  return constant;
}

/** Every constant in the set, so a reviewer can read them all in one place. */
export function constantsIn(
  mappingSet: MappingSet,
): readonly { readonly fieldRef: string; readonly value: string; readonly rationale: string }[] {
  return mappingSet.mappings
    .filter(
      (mapping): mapping is FieldMapping & { source: Extract<ValueSource, { kind: "constant" }> } =>
        mapping.source.kind === "constant",
    )
    .map((mapping) => ({
      fieldRef: mapping.fieldRef,
      value: mapping.source.value,
      rationale: mapping.source.rationale,
    }));
}

/** Locators for a field, most stable first. Re-exported shape for convenience. */
export type { FieldLocator };
