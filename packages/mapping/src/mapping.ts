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
import { allFields, allRequiredDocuments } from "@askimate/aas-blueprint";
import type { Brand } from "@askimate/aas-domain";
import type { FormatRule, OrdinaryFieldKey } from "@askimate/aas-profile";

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
      /**
       * `OrdinaryFieldKey`, not `ProfileFieldKey` (ADR-0102 §"two channels").
       *
       * ADR-0077 closed extraction against special-category fields and left
       * this channel and the interview's `ask` typed by the whole registry.
       * Found while costing blocker 20, closed while both were still empty:
       * a field classified `special_category` in `FIELD_CATEGORY` cannot be
       * named by a mapping, so no reviewed set can route such data to a form.
       */
      readonly fieldKey: OrdinaryFieldKey;
      readonly format: FormatRule;
    }
  /**
   * A document upload. The vault supplies the bytes; nothing is typed.
   *
   * THE declaration that decides (ADR-0066). Two other reviewed fields carry
   * the word "document" — the blueprint page's record of the file inputs
   * discovery saw, and the catalogue entry's student-facing list — and neither
   * plans anything. This one becomes `plan.uploads`, which `buildPreview`
   * refuses on when no document was provided and which `executePlan` puts
   * through ADR-0022's transmission gate.
   *
   * It carries that weight because of how it is made: authored by a specialist,
   * reviewed by a second person, and pinned to a blueprint version (ADR-0017).
   */
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
   * The refusal the form itself offers, on a field that asks what this system
   * cannot hold (ADR-0102).
   *
   * Vahid, 2026-09-11, on Sheffield's equal-opportunities page: *"Those are
   * not the student's answer and we must never present them as one. They are
   * a stated refusal to route Article 9 data through us, made on a form that
   * offers exactly that option and tells the student where the real answer
   * belongs."* And the general rule: *"this decision is 'use the refusal the
   * form offers', not 'answer Article 9 fields with a safe default'."*
   *
   * So this is NOT a constant. A constant is application metadata; this is a
   * declined question. It is the only source `checkUsable` accepts on a
   * `special_category` field, and it is accepted only where the form offers
   * it: `value` must be an option the field's captured `options` list holds,
   * or `"true"` on a checkbox — a text box offers no refusal, and a
   * special-category field with no refusal mapped stops the plan
   * (`special_category_unhandled`) rather than being passed over.
   *
   * `formSays` is the form's OWN words about what happens to the question —
   * Sheffield: *"if you go on to register on a course you will have another
   * opportunity to answer later"* — and it must appear verbatim in the
   * field's captured label or option labels, or be omitted. *"Quote or omit,
   * never compose."* The preview prints it as the portal's statement.
   *
   * The preview never lists a refusal among the answers (`refusals`, not
   * `entries`), and says what was not answered, what was entered, and why.
   */
  | {
      readonly kind: "form_refusal";
      readonly value: string;
      readonly rationale: string;
      readonly formSays?: string;
      /**
       * The other controls of the SAME question, left untouched.
       *
       * Found while writing the first real set (2026-09-11): Sheffield's
       * disability question is twelve checkboxes and *Prefer not to say* is
       * one of them. Ticking it answers the question; the other eleven are
       * neither answered nor blockers. Each covered field must be
       * special-category, in the blueprint, mapped by nothing, and covered
       * once — `checkUsable` refuses otherwise — and the preview names them.
       */
      readonly covers?: readonly string[];
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
export const CREDENTIAL_PURPOSES = ["portal_account_creation", "portal_sign_in"] as const;
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
  | { readonly kind: "credential_source_misused"; readonly detail: string; readonly fieldRefs: readonly string[] }
  // ── ADR-0102: what a special-category field may and may not be mapped to ──
  /** A field the reviewer has not classified. Absent is not ordinary. */
  | { readonly kind: "unclassified_fields"; readonly detail: string; readonly fieldRefs: readonly string[] }
  /** A special-category field mapped to anything but the refusal the form offers. */
  | { readonly kind: "special_category_mismapped"; readonly detail: string; readonly fieldRefs: readonly string[] }
  /** `form_refusal` on a field that is not special-category. */
  | { readonly kind: "form_refusal_misused"; readonly detail: string; readonly fieldRefs: readonly string[] }
  /** A refusal value the field's options do not hold, or a field with no options to refuse with. */
  | { readonly kind: "form_refusal_not_offered"; readonly detail: string; readonly fieldRefs: readonly string[] }
  /** A `formSays` the form's captured text does not contain. */
  | { readonly kind: "form_refusal_composed"; readonly detail: string; readonly fieldRefs: readonly string[] }
  /** A cover naming a field that is not special-category, not in the blueprint, mapped, or covered twice. */
  | { readonly kind: "form_refusal_cover_invalid"; readonly detail: string; readonly fieldRefs: readonly string[] }
  /** A document slot's companion that is not on the blueprint, does not offer the value, or is mapped as well (gap 4). */
  | { readonly kind: "document_companion_invalid"; readonly detail: string; readonly fieldRefs: readonly string[] }
  /**
   * A field whose options follow another that the fill could not honour (gap 1): the earlier
   * field is not on the same page before it, the dependent offers no options, or the earlier
   * field is mapped by nothing while the dependent is — its option could never arrive.
   */
  | { readonly kind: "options_after_invalid"; readonly detail: string; readonly fieldRefs: readonly string[] };

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

  // ── ADR-0102: special-category fields take the refusal the form offers ──
  //
  // Here and not at fill time. Vahid, 2026-09-11: *"refused at mapping, not
  // checked at fill."* A portal's fields are discovered data, so there is no
  // compile error to be had; what there is is this branded check, which
  // `planFill` requires, so nothing downstream can see a set that failed it.
  const fieldsByRef = new Map(allFields(blueprint).map((field) => [field.fieldRef, field]));

  const unclassified = allFields(blueprint)
    .filter((field) => field.dataCategory === undefined)
    .map((field) => field.fieldRef);
  if (unclassified.length > 0) {
    return {
      usable: false,
      refusal: {
        kind: "unclassified_fields",
        fieldRefs: unclassified,
        detail:
          `${String(unclassified.length)} field(s) carry no data category: ${unclassified.slice(0, 8).join(", ")}` +
          `${unclassified.length > 8 ? ", …" : ""}. A reviewed entry classifies every field, because ` +
          `absent is not ordinary: one omission would turn a health question into a field with ` +
          `nothing to notice (ADR-0102, ADR-0077).`,
      },
    };
  }

  const special = new Set(
    allFields(blueprint)
      .filter((field) => field.dataCategory === "special_category")
      .map((field) => field.fieldRef),
  );

  const specialMismapped = mappingSet.mappings
    .filter((mapping) => special.has(mapping.fieldRef) && mapping.source.kind !== "form_refusal")
    .map((mapping) => mapping.fieldRef);
  if (specialMismapped.length > 0) {
    return {
      usable: false,
      refusal: {
        kind: "special_category_mismapped",
        fieldRefs: specialMismapped,
        detail:
          `${specialMismapped.join(", ")} ask${specialMismapped.length === 1 ? "s" : ""} what this ` +
          `system cannot hold (special category). The only mapping accepted is ` +
          `{ kind: "form_refusal" } naming the refusal the form itself offers — not a constant, ` +
          `not a profile field, not a handoff (ADR-0102).`,
      },
    };
  }

  const refusalMisused = mappingSet.mappings
    .filter((mapping) => mapping.source.kind === "form_refusal" && !special.has(mapping.fieldRef))
    .map((mapping) => mapping.fieldRef);
  if (refusalMisused.length > 0) {
    return {
      usable: false,
      refusal: {
        kind: "form_refusal_misused",
        fieldRefs: refusalMisused,
        detail:
          `${refusalMisused.join(", ")} ${refusalMisused.length === 1 ? "is" : "are"} not ` +
          `special-category, so { kind: "form_refusal" } does not belong there. A refusal is for ` +
          `a question this system cannot answer; an ordinary field is answered or left (ADR-0102).`,
      },
    };
  }

  const notOffered: string[] = [];
  const composed: string[] = [];
  const badCovers: string[] = [];
  const mapped = new Set(mappingSet.mappings.map((mapping) => mapping.fieldRef));
  const coveredOnce = new Set<string>();
  for (const mapping of mappingSet.mappings) {
    if (mapping.source.kind !== "form_refusal") continue;
    const field = fieldsByRef.get(mapping.fieldRef);
    if (field === undefined) continue; // unknown refs were refused above
    if (!formOffers(field, mapping.source.value)) notOffered.push(mapping.fieldRef);
    if (mapping.source.formSays !== undefined && !formSays(field, mapping.source.formSays)) {
      composed.push(mapping.fieldRef);
    }
    for (const covered of mapping.source.covers ?? []) {
      const target = fieldsByRef.get(covered);
      const invalid =
        target === undefined ||
        target.dataCategory !== "special_category" ||
        mapped.has(covered) ||
        covered === mapping.fieldRef ||
        coveredOnce.has(covered);
      if (invalid) badCovers.push(covered);
      coveredOnce.add(covered);
    }
  }
  if (notOffered.length > 0) {
    return {
      usable: false,
      refusal: {
        kind: "form_refusal_not_offered",
        fieldRefs: notOffered,
        detail:
          `The form offers no such refusal on ${notOffered.join(", ")}: the value is not among ` +
          `the field's captured options, or the field has no options to refuse with (a text box ` +
          `has none). "Use the refusal the form offers" — and with none, the fill stops (ADR-0102).`,
      },
    };
  }
  if (badCovers.length > 0) {
    return {
      usable: false,
      refusal: {
        kind: "form_refusal_cover_invalid",
        fieldRefs: badCovers,
        detail:
          `A refusal covers ${badCovers.join(", ")}, which it may not: a covered field must be in ` +
          `the blueprint, special-category, mapped by nothing, and covered by one refusal only — ` +
          `it is the other controls of the same question, left untouched (ADR-0102).`,
      },
    };
  }
  if (composed.length > 0) {
    return {
      usable: false,
      refusal: {
        kind: "form_refusal_composed",
        fieldRefs: composed,
        detail:
          `formSays on ${composed.join(", ")} is not in the form's own text — not in the field's ` +
          `captured label or option labels. Quote or omit, never compose (ADR-0102).`,
      },
    };
  }

  // ── ADR-0103 gap 4: a slot's companion follows the attach, and nothing else ──
  const badCompanions: string[] = [];
  for (const document of allRequiredDocuments(blueprint)) {
    if (document.companion === undefined) continue;
    const field = fieldsByRef.get(document.companion.fieldRef);
    if (field === undefined || !formOffers(field, document.companion.whenAttached) || mapped.has(field.fieldRef)) {
      badCompanions.push(document.companion.fieldRef);
    }
  }
  if (badCompanions.length > 0) {
    return {
      usable: false,
      refusal: {
        kind: "document_companion_invalid",
        fieldRefs: badCompanions,
        detail:
          `A document slot names ${badCompanions.join(", ")} as the control set beside it when a ` +
          `file is attached, which it may not be: a companion must be on the blueprint, offer the ` +
          `value the slot names, and be mapped by nothing — it follows the attach (ADR-0103).`,
      },
    };
  }

  // ── ADR-0103 gap 1: a field whose options arrive after another is set ──
  //
  // Fill order is the blueprint's field order, and a wait is only as good as
  // the thing it waits for. So the earlier field must sit before the dependent
  // on the same page; the dependent must be one that has options to wait for;
  // and if the dependent is mapped, the earlier field must be too — a mapping
  // that names an option the earlier field would never cause to appear is a
  // fill that fails on every run, and it is refused here rather than there.
  const orderProblems: string[] = [];
  const orderRefs: string[] = [];
  for (const page of blueprint.pages) {
    const order = page.sections.flatMap((section) => section.fields);
    order.forEach((field, index) => {
      if (field.optionsAfter === undefined) return;
      const earlierIndex = order.findIndex((candidate) => candidate.fieldRef === field.optionsAfter?.fieldRef);
      const problem =
        earlierIndex === -1
          ? `follows "${field.optionsAfter.fieldRef}", which is not on its page`
          : earlierIndex === index
            ? "follows itself"
            : earlierIndex > index
              ? `follows "${field.optionsAfter.fieldRef}", which comes after it`
              : !hasOptions(field)
                ? `is a ${field.inputType} field, which offers no options to wait for`
                : mapped.has(field.fieldRef) && !mapped.has(field.optionsAfter.fieldRef)
                  ? `is mapped while "${field.optionsAfter.fieldRef}", which its options follow, is mapped by nothing`
                  : null;
      if (problem !== null) {
        orderProblems.push(`${field.fieldRef} ${problem}`);
        orderRefs.push(field.fieldRef);
      }
    });
  }
  if (orderProblems.length > 0) {
    return {
      usable: false,
      refusal: {
        kind: "options_after_invalid",
        fieldRefs: orderRefs,
        detail:
          `${orderProblems.join("; ")}. A field's options may follow only a field before it on the ` +
          `same page, it must offer options, and the field it follows must be mapped whenever it is ` +
          `(ADR-0103).`,
      },
    };
  }

  return { usable: true, mappingSet: mappingSet as UsableMappingSet };
}

/** Whether a field is one whose options a runner could wait for. */
function hasOptions(field: BlueprintField): boolean {
  return field.inputType === "select" || field.inputType === "multiselect" || field.inputType === "radio";
}

/** Whether the form itself offers `value` as something to choose on this field. */
function formOffers(field: BlueprintField, value: string): boolean {
  if (field.inputType === "checkbox") return value === "true";
  if (field.inputType === "select" || field.inputType === "radio" || field.inputType === "multiselect") {
    return (field.options ?? []).some((option) => option.value === value);
  }
  return false;
}

/** Whether `words` appear verbatim in the form's captured text for this field. */
function formSays(field: BlueprintField, words: string): boolean {
  const norm = (text: string): string => text.replace(/\s+/g, " ").trim().toLowerCase();
  const wanted = norm(words);
  if (wanted.length === 0) return false;
  return [field.label, ...(field.options ?? []).map((option) => option.label)].some((text) =>
    norm(text).includes(wanted),
  );
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

/**
 * A refusal the form offers, as a reviewed mapping set actually contains it
 * (ADR-0102). Branded exactly as `ReviewedConstant` is, and for the same
 * reason: constructible only from a `UsableMappingSet`, which `checkUsable`
 * mints only when the field is special-category, the value is offered, and
 * the form's words are its own.
 */
export type ReviewedFormRefusal = Brand<
  {
    readonly text: string;
    readonly rationale: string;
    readonly formSays?: string;
    readonly covers: readonly string[];
    readonly mappingSetId: string;
    readonly reviewedBy: string;
  },
  "ReviewedFormRefusal"
>;

/** Mints a `ReviewedFormRefusal`. The `UsableMappingSet` parameter is the whole point. */
export function reviewedFormRefusal(
  mappingSet: UsableMappingSet,
  source: Extract<ValueSource, { kind: "form_refusal" }>,
): ReviewedFormRefusal {
  return {
    text: source.value,
    rationale: source.rationale,
    ...(source.formSays === undefined ? {} : { formSays: source.formSays }),
    covers: [...(source.covers ?? [])],
    mappingSetId: mappingSet.mappingSetId,
    reviewedBy: mappingSet.reviewedBy ?? "",
  } as unknown as ReviewedFormRefusal;
}

/** The text a refusal will enter — an option value, or "true" for a ticked box. */
export function formRefusalText(refusal: ReviewedFormRefusal): string {
  return refusal.text;
}

/** Who stands behind a refusal and what the form said, for the preview and the record. */
export function formRefusalAttribution(refusal: ReviewedFormRefusal): {
  readonly rationale: string;
  readonly formSays?: string;
  readonly covers: readonly string[];
  readonly mappingSetId: string;
  readonly reviewedBy: string;
} {
  return refusal;
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
