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

import type { ApplicationBlueprint, BlueprintField, FieldListAfter, FieldLocator } from "@askimate/aas-blueprint";
import { allFields, allRequiredDocuments, escapeOf } from "@askimate/aas-blueprint";
import type { Brand } from "@askimate/aas-domain";
import type { FormatRule, OrdinaryFieldKey } from "@askimate/aas-profile";
import { isClosedVocabulary, LIST_VALUED_FIELD_KEYS } from "@askimate/aas-profile";

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
   * The student's own act (brief §7, ADR-0104, ADR-0119): a legal declaration,
   * a document slot, or — since 2026-09-16 — any box the reviewer hands to the
   * student rather than maps. The runner types nothing in it; the preview says
   * under the page which boxes the student fills themselves and that the
   * application is not complete until they do; the yes records each one on
   * the case (ADR-0108).
   *
   * A mapping, not an omission. Recording it here means the orchestrator knows
   * this field is *deliberately* not automated — a decision somebody made —
   * rather than discovering an unmapped field at fill time and treating it as
   * a gap. The gap nobody looked at is `FillPlan.unmapped`, kept apart from
   * this on purpose. A challenge only the student can meet (MFA, OTP, CAPTCHA)
   * is not a mapping at all: the runner detects it on the page and stops
   * (ADR-0101 §6).
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
  /**
   * Who signed the set. Until ADR-0118 this could never be the author; since
   * 2026-09-16 it may be, and what that signature admits is the REGISTRY's
   * record (`Approval.ownAccountOnly`), not this field's — a single signature
   * admits the signer's own account and nothing else.
   */
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
  /**
   * An OPTION MAP naming a value the field's captured options do not hold (ADR-0136).
   *
   * The same question `form_refusal_not_offered` asks, asked of the maps that carry the
   * student's own answers rather than of a refusal. It was not asked for a year of this
   * repository's life, and the cost was eight attempts at one page: the education date maps
   * sent `Sep`, `Jun` and `Jul` while the blueprint on the same page recorded `Sept`, `June`
   * and `July` — read correctly from the very first capture, on 2026-09-10, and never compared
   * against the map authored four days later from what a month list usually looks like.
   *
   * A reviewer cannot be asked to hold twelve spellings in their head against a list they read
   * a week earlier. The build can.
   */
  | { readonly kind: "option_map_not_offered"; readonly detail: string; readonly fieldRefs: readonly string[] }
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
  | { readonly kind: "options_after_invalid"; readonly detail: string; readonly fieldRefs: readonly string[] }
  /** A typeahead field that does not say where its entries are, or entries declared on a field that is not one (gap 2). */
  | { readonly kind: "typeahead_invalid"; readonly detail: string; readonly fieldRefs: readonly string[] }
  /**
   * A mapping names a select's escape, or fills the box its escape opens
   * (P281, ADR-0109 extended): both are the student's own act.
   */
  | { readonly kind: "escape_named"; readonly detail: string; readonly fieldRefs: readonly string[] }
  /**
   * A switch's branch for a form's escape (P293, ADR-0156 §3) that the plan could not honour or
   * that rests on no read: the field whose escape it takes is not before it on its page, records
   * no usable escape, is filled by no profile mapping, or may be hidden; or its values are not
   * among the list the form showed after that escape.
   */
  | { readonly kind: "escaped_branch_invalid"; readonly detail: string; readonly fieldRefs: readonly string[] }
  /**
   * A read's record of what it was made under (P294) that names a field its list does not follow,
   * the field it is already read after, the same field twice, or a value that field does not offer —
   * or that leaves out a field its list follows which offers a choice.
   */
  | { readonly kind: "read_under_invalid"; readonly detail: string; readonly fieldRefs: readonly string[] }
  /**
   * A row on a list that follows another field directly (Sheffield's institution box after the
   * country box) whose value a read made under one value of that field holds, keyed on another or
   * on none (P294).
   */
  | { readonly kind: "read_country_mismatch"; readonly detail: string; readonly fieldRefs: readonly string[] }
  /** A typeahead row keyed on the student's words names an entry whose recorded text is other words (ADR-0153, P282). */
  | { readonly kind: "row_not_identity"; readonly detail: string; readonly fieldRefs: readonly string[] }
  /** A fronted control (P153) that is mapped, or whose `frontedBy` is not another field on the same page. */
  | { readonly kind: "fronted_field_invalid"; readonly detail: string; readonly fieldRefs: readonly string[] }
  /**
   * A repeating page that could not be filled once per item (gap 3): it repeats over a field
   * that is not a list; a mapping on it draws from anything but that list, or is not a value at
   * all (a document, a credential, a refusal — or a handoff on anything but a document slot,
   * ADR-0104); or a condition on it that looks off the page, which no item could answer.
   */
  | { readonly kind: "repeat_mapping_invalid"; readonly detail: string; readonly fieldRefs: readonly string[] };

export type MappingCheck =
  | { readonly usable: true; readonly mappingSet: UsableMappingSet }
  | { readonly usable: false; readonly refusal: MappingRefusal };

/**
 * The gate between a mapping set and a real fill.
 *
 * Four conditions, each of which has an obvious way to go wrong in practice:
 * an unreviewed set, a retired one, one pinned to a different blueprint
 * version, and one naming fields the blueprint does not have.
 *
 * A fifth used to stand here — a set whose `reviewedBy` was its `authoredBy`
 * was refused as "a draft with a signature on it". Removed by Vahid's decision
 * of 2026-09-16 (ADR-0118): those are two fields in one document, and whom a
 * signature admits is the approval registry's record, where a single
 * signature admits the signer's own account and nothing else.
 */
/**
 * Every value an option map writes into the form, anywhere in a format tree.
 *
 * A format nests — `part` then `option`, `option` alone — so this walks rather than looking at
 * the top level, which is how three of the six month maps could differ from the other three
 * without anything noticing.
 */
function optionValuesNamedBy(format: unknown): string[] {
  if (Array.isArray(format)) return format.flatMap((entry) => optionValuesNamedBy(entry));
  if (format === null || typeof format !== "object") return [];
  const node = format as Record<string, unknown>;
  const here =
    node["kind"] === "option" && typeof node["options"] === "object" && node["options"] !== null
      ? Object.values(node["options"] as Record<string, unknown>).filter(
          (value): value is string => typeof value === "string",
        )
      : [];
  return [...here, ...Object.values(node).flatMap((value) => optionValuesNamedBy(value))];
}

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
  // ── Every option map against the list the blueprint recorded (ADR-0136) ──
  //
  // Read from the CAPTURED options, never from what the value looks like. A map is a promise
  // that the portal will accept what it names, and the only thing on the record that can keep
  // that promise is the list discovery read off the page.
  //
  // Fields with no captured options are skipped rather than refused: a text box legitimately
  // has none, and a map onto one is checked by nothing here. `checkUsable` already refuses a
  // field that is not in the blueprint at all, so what is skipped is narrow and deliberate.
  const mapsNotOffered: string[] = [];
  const mapDetails: string[] = [];
  for (const mapping of mappingSet.mappings) {
    if (mapping.source.kind !== "profile_field") continue;
    const field = fieldsByRef.get(mapping.fieldRef);
    if (field === undefined || field.options === undefined || field.options.length === 0) continue;
    // A field whose options ARRIVE AFTER another is set (ADR-0103 gap 1) is
    // skipped, and this is the one exception worth spelling out.
    //
    // Its captured options are ONE observation of a list the page loads at
    // fill time — the eleven institutions one search returned, the grading
    // systems for one institution — not the list the student's own answer
    // will meet. Refusing a map against a partial observation would refuse
    // correct maps, and the `end-to-end` demo's `passport_country` is exactly
    // that: a country list the fixture portal fills after the nationality,
    // captured empty by discovery and mapped correctly by the reviewer.
    //
    // The three maps this check was built for are static selects with their
    // whole list on the page, which is why the capture is authoritative there.
    if (field.optionsAfter !== undefined) continue;
    const offered = new Set(field.options.map((option) => option.value));
    const named = [...new Set(optionValuesNamedBy(mapping.source.format))];
    const missing = named.filter((value) => !offered.has(value));
    if (missing.length === 0) continue;
    mapsNotOffered.push(mapping.fieldRef);
    mapDetails.push(`${mapping.fieldRef} names ${missing.map((v) => `"${v}"`).join(", ")}`);
  }
  if (mapsNotOffered.length > 0) {
    return {
      usable: false,
      refusal: {
        kind: "option_map_not_offered",
        fieldRefs: mapsNotOffered,
        detail:
          `An option map names a value the field's captured options do not hold: ` +
          `${mapDetails.join("; ")}. A map is a promise that the portal will accept what it ` +
          `names, and the captured list is the only thing on the record that can keep it \u2014 ` +
          `never what the value looks like (ADR-0136).`,
      },
    };
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
  //
  // ADR-0107 (blocker 23, A): a companion is mapped by nothing — ADR-0105's
  // admission of one handed with its slot is withdrawn. When the slot is the
  // student's own act, the runner sets the companion to the DEFER value the
  // reviewer named on the blueprint — "I will upload it later", a statement
  // about when — and never to the refusal-style one, which is a claim about
  // the student's intent and not ours to say, ever, on any portal. Where no
  // defer value is named, the page waits for the student: nothing on it may
  // be filled by the plan.
  const handedOff = new Set(
    mappingSet.mappings.filter((mapping) => mapping.source.kind === "student_handoff").map((mapping) => mapping.fieldRef),
  );
  const pageOf = new Map(
    blueprint.pages.flatMap((page) => page.sections.flatMap((section) => section.fields.map((field) => [field.fieldRef, page] as const))),
  );
  const badCompanions: string[] = [];
  const companionProblems: string[] = [];
  for (const document of allRequiredDocuments(blueprint)) {
    if (document.companion === undefined) continue;
    const companion = document.companion;
    const field = fieldsByRef.get(companion.fieldRef);
    if (field === undefined || !formOffers(field, companion.whenAttached)) {
      badCompanions.push(companion.fieldRef);
      companionProblems.push(`${companion.fieldRef} is not on the blueprint or does not offer "${companion.whenAttached}"`);
      continue;
    }
    const mapping = mappingFor(mappingSet, field.fieldRef);
    if (mapping !== undefined) {
      badCompanions.push(companion.fieldRef);
      const said = mapping.source.kind === "constant" ? mapping.source.value : mapping.source.kind === "form_refusal" ? mapping.source.value : null;
      companionProblems.push(
        said !== null && companion.whenNotProviding !== undefined && said === companion.whenNotProviding
          ? `${companion.fieldRef} is set to "${said}", which says the document will not be provided — a claim about the student's intent and not ours to say (ADR-0107)`
          : `${companion.fieldRef} is mapped, and a companion follows its slot: set with the attach, or to the defer value when the slot is the student's own act (ADR-0107)`,
      );
      continue;
    }
    if (companion.whenDeferred !== undefined) {
      if (companion.whenDeferred === companion.whenNotProviding) {
        badCompanions.push(companion.fieldRef);
        companionProblems.push(`${companion.fieldRef}'s defer value is the one that says the document will not be provided, which is never ours to say (ADR-0107)`);
        continue;
      }
      if (!formOffers(field, companion.whenDeferred)) {
        badCompanions.push(companion.fieldRef);
        companionProblems.push(`${companion.fieldRef} does not offer the defer value "${companion.whenDeferred}"`);
        continue;
      }
    }
    if (handedOff.has(document.fieldRef) && companion.whenDeferred === undefined) {
      // A handed slot with no defer value to set: only a page that waits for
      // the student — nothing on it filled by the plan — can carry it.
      const page = pageOf.get(document.fieldRef);
      const filled = (page?.sections ?? [])
        .flatMap((section) => section.fields)
        .filter((candidate) => {
          const source = mappingFor(mappingSet, candidate.fieldRef)?.source.kind;
          return source !== undefined && source !== "student_handoff";
        });
      if (filled.length > 0) {
        badCompanions.push(companion.fieldRef);
        companionProblems.push(
          `${document.fieldRef} is the student's own act and ${companion.fieldRef} names no defer value to set beside it, so the page waits for the student — but ${filled.map((candidate) => candidate.fieldRef).join(", ")} would be filled on it (ADR-0107)`,
        );
      }
    }
  }
  if (badCompanions.length > 0) {
    return {
      usable: false,
      refusal: {
        kind: "document_companion_invalid",
        fieldRefs: badCompanions,
        detail: `A document slot's companion may not be used as it is: ${companionProblems.join("; ")}.`,
      },
    };
  }

  // ── P153: a fronted control is set by another on its page, and mapped by nothing ──
  const frontedProblems: string[] = [];
  const frontedRefs: string[] = [];
  for (const page of blueprint.pages) {
    const onPage = new Set(page.sections.flatMap((section) => section.fields.map((field) => field.fieldRef)));
    for (const field of page.sections.flatMap((section) => section.fields)) {
      if (field.frontedBy === undefined) continue;
      if (field.frontedBy === field.fieldRef || !onPage.has(field.frontedBy)) {
        frontedRefs.push(field.fieldRef);
        frontedProblems.push(`${field.fieldRef} says it is set by "${field.frontedBy}", which is not another field on its page`);
      }
      if (mappingFor(mappingSet, field.fieldRef) !== undefined) {
        frontedRefs.push(field.fieldRef);
        frontedProblems.push(`${field.fieldRef} is mapped, but it is set by "${field.frontedBy}" — the control that fronts it is what is mapped`);
      }
    }
  }
  if (frontedProblems.length > 0) {
    return {
      usable: false,
      refusal: {
        kind: "fronted_field_invalid",
        fieldRefs: frontedRefs,
        detail: `${frontedProblems.join("; ")}. A fronted control is set by another field on the same page and is mapped by nothing (P153).`,
      },
    };
  }

  // ── ADR-0103 gap 2: a typeahead says where its entries are, and only a typeahead does ──
  const typeaheadProblems = allFields(blueprint).filter(
    (field) => (field.inputType === "typeahead") !== (field.typeahead !== undefined),
  );
  // ADR-0109: a mapping to a typeahead names the value the form submits, and
  // the field's `options` say what each value reads as. So a mapped typeahead
  // records its entries; its mapping is a constant that is one of them, or an
  // option rule whose every target is one of them; and neither may be the
  // escape — *"a mapping must never resolve to it by accident"* (Vahid).
  const namedValuesProblems: string[] = [];
  const namedValuesFields: string[] = [];
  for (const field of allFields(blueprint)) {
    if (field.inputType !== "typeahead") continue;
    const mapping = mappingFor(mappingSet, field.fieldRef);
    if (mapping === undefined) continue;
    const source = mapping.source;
    if (source.kind !== "constant" && source.kind !== "profile_field") continue;
    if (field.options === undefined || field.options.length === 0) {
      namedValuesFields.push(field.fieldRef);
      namedValuesProblems.push(`${field.fieldRef} records no entries, so no mapping to it can name a value the form submits`);
      continue;
    }
    const named: readonly string[] = source.kind === "constant" ? [source.value] : (optionTargetsOf(source.format) ?? []);
    if (source.kind === "profile_field" && optionTargetsOf(source.format) === null) {
      namedValuesFields.push(field.fieldRef);
      namedValuesProblems.push(
        `${field.fieldRef} is mapped from a profile field without an option rule onto its entries — free text is never the value a typeahead submits`,
      );
      continue;
    }
    const escape = field.typeahead?.escapeValue;
    const problems = named.flatMap((value) =>
      escape !== undefined && value === escape
        ? [`${field.fieldRef} would name "${value}", which is the form's escape, not an answer`]
        : formOffers(field, value)
          ? []
          : [`${field.fieldRef} would name "${value}", which is not among the entries the reviewer recorded`],
    );
    if (problems.length > 0) {
      namedValuesFields.push(field.fieldRef);
      namedValuesProblems.push(...problems);
    }
  }
  if (namedValuesProblems.length > 0) {
    return {
      usable: false,
      refusal: {
        kind: "typeahead_invalid",
        fieldRefs: [...new Set(namedValuesFields)],
        detail: `A typeahead is chosen by the value the form submits (ADR-0109): ${namedValuesProblems.join("; ")}.`,
      },
    };
  }

  // ── ADR-0109 extended (P281): a select's escape, and the box it opens ──
  //
  // Vahid, 2026-10-03: *"'Not in list' with the title typed is the student's
  // own act, same as the institution, and for the same reason — a free-text
  // box stating what a certificate says is a claim about their own
  // education."* The typeahead's escape is guarded above, by value; a
  // select's is guarded here the same way, and so is the box shown only when
  // the escape is chosen: a mapping that fills it would be making the claim
  // the escape exists for the student to make.
  const escapeProblems: string[] = [];
  const escapeFields: string[] = [];
  const fields = allFields(blueprint);
  for (const field of fields) {
    const mapping = mappingFor(mappingSet, field.fieldRef);
    if (mapping === undefined) continue;
    const source = mapping.source;
    if (source.kind !== "constant" && source.kind !== "profile_field") continue;
    const escape = field.inputType === "typeahead" ? undefined : escapeOf(field);
    if (escape !== undefined) {
      const named = source.kind === "constant" ? [source.value] : (optionTargetsOf(source.format) ?? []);
      if (named.includes(escape)) {
        escapeFields.push(field.fieldRef);
        escapeProblems.push(`${field.fieldRef} would name "${escape}", which is the form's escape, not an answer`);
      }
    }
    const opener = field.visibleWhen === undefined ? undefined : fields.find((other) => other.fieldRef === field.visibleWhen?.whenFieldRef);
    const opensOn = opener === undefined ? undefined : escapeOf(opener);
    if (opensOn !== undefined && field.visibleWhen?.operator === "equals" && field.visibleWhen.value === opensOn) {
      // P290, ADR-0109 amended. Vahid, 2026-10-05: *"the runner may choose
      // the form's escape entry when, and only when, the student has chosen
      // it."* And: *"ADR-0109 refused the agent, not the person."* The box the escape
      // opens is shown only then, so it may hold the student's OWN words, as
      // they gave them — a profile field rendered as it stands, through no
      // option rule — and nothing else: a constant, or words translated by a
      // row, would still be a claim made for them.
      const ownWords = source.kind === "profile_field" && (optionTargetsOf(source.format) ?? []).length === 0;
      if (!ownWords) {
        escapeFields.push(field.fieldRef);
        escapeProblems.push(
          `${field.fieldRef} is shown only when ${opener?.fieldRef ?? "?"}'s escape is chosen, so it may hold only the student's own words, as they gave them`,
        );
      }
    }
  }
  // ── ADR-0153: a typeahead row keyed on the student's words states an identity ──
  //
  // Vahid, 2026-10-03: *"For a typeahead, refuse a row whose key is not the
  // recorded text of the entry it names … it covers the case where the
  // vocabulary is the portal's own list, which is where the temptation to
  // equate is strongest."* The row he nearly wrote — *"Azad University" →
  // UNI30764*, whose text is *Islamic Azad University* — is refused here.
  // Measured before it was built (P282): the rule as first stated refused 231
  // of the signed entry's 240 typeahead rows, every one the country box's,
  // keyed on ISO codes — an identity across vocabularies, ADR-0153's own
  // exception. So a row keyed on a closed vocabulary of ours
  // (`isClosedVocabulary`) is left to review, and every other key is the
  // student's words and must be the text the reviewer recorded.
  const identityProblems: string[] = [];
  const identityFields: string[] = [];
  for (const field of fields) {
    if (field.inputType !== "typeahead") continue;
    const mapping = mappingFor(mappingSet, field.fieldRef);
    if (mapping?.source.kind !== "profile_field") continue;
    const fieldKey = mapping.source.fieldKey;
    for (const row of optionRowsOf(mapping.source.format)) {
      if (isClosedVocabulary(fieldKey, row.part)) continue;
      const text = field.options?.find((option) => option.value === row.target)?.label;
      if (text === undefined || text === row.key) continue;
      identityFields.push(field.fieldRef);
      identityProblems.push(`${field.fieldRef} maps "${row.key}" to ${row.target}, which the form reads as "${text}"`);
    }
  }
  if (identityProblems.length > 0) {
    return {
      usable: false,
      refusal: {
        kind: "row_not_identity",
        fieldRefs: [...new Set(identityFields)],
        detail:
          `A mapping row states an identity, not a resemblance (ADR-0153): ${identityProblems.join("; ")}. ` +
          `Where the student's words and the form's text differ, the student's answer is what changes.`,
      },
    };
  }

  // A branch that names the form's own escape is the ADR-0109 rule broken,
  // whatever else is wrong with it, so that refusal is reported first.
  if (escapeProblems.length > 0) {
    return {
      usable: false,
      refusal: {
        kind: "escape_named",
        fieldRefs: [...new Set(escapeFields)],
        detail: `The form's escape, and the box it opens, are the student's own act (ADR-0109, P281): ${escapeProblems.join("; ")}.`,
      },
    };
  }

  // ── P294: what a read was made under ───────────────────────────────────
  //
  // Vahid, 2026-10-09: *"Record the country a read was made under in the
  // reads record itself, and make the check refuse a mapping row whose key
  // does not match the country of the read it rests on."* A read records, in
  // `under`, what the fields its list follows held when it was made. Each
  // must be a field the list does follow, directly or through others, and a
  // value that field offers: a record of a read cannot name a dependency the
  // form does not have, or a country it does not list.
  const fieldsByRefForReads = new Map(allFields(blueprint).map((candidate) => [candidate.fieldRef, candidate]));
  const upstreamOf = (field: BlueprintField): readonly string[] => {
    const chain: string[] = [];
    for (let next = field.optionsAfter?.fieldRef; next !== undefined && !chain.includes(next); next = fieldsByRefForReads.get(next)?.optionsAfter?.fieldRef) {
      chain.push(next);
    }
    return chain;
  };
  const underProblems: string[] = [];
  const underRefs: string[] = [];
  for (const field of allFields(blueprint)) {
    const chain = upstreamOf(field);
    const reads = [
      ...(field.searches ?? []).map((search) => ({ name: `the search for "${search.word}"`, after: undefined as string | undefined, under: search.under })),
      ...(field.listsAfter ?? []).map((list) => ({ name: `the list read after "${list.fieldRef}" is "${list.value}"`, after: list.fieldRef, under: list.under })),
    ];
    // The fields a read's list follows that offer a choice — the country box,
    // the institution box — other than the one it is read after: the read
    // must record what each held, so a country is never left for someone to
    // set by hand later (P294, the review). A box the student types in, like
    // the subject's search word, offers none and is not required.
    const required = chain.filter((fieldRef) => (fieldsByRefForReads.get(fieldRef)?.options ?? []).length > 0);
    for (const read of reads) {
      const missing = required.filter((fieldRef) => fieldRef !== read.after && !(read.under ?? []).some((held) => held.fieldRef === fieldRef));
      if (missing.length > 0) {
        underProblems.push(`${field.fieldRef}: ${read.name} records no ${missing.map((fieldRef) => `"${fieldRef}"`).join(", ")}, which its list follows: a read is true only of what they held, so it records it`);
        underRefs.push(field.fieldRef);
      }
      const seen = new Set<string>();
      for (const held of read.under ?? []) {
        const upstream = fieldsByRefForReads.get(held.fieldRef);
        const problem =
          seen.has(held.fieldRef)
            ? `records "${held.fieldRef}" twice`
            : held.fieldRef === read.after
              ? `records "${held.fieldRef}", which it is already read after`
              : !chain.includes(held.fieldRef)
                ? `records "${held.fieldRef}", which its list does not follow`
                : upstream === undefined || (!(upstream.options ?? []).some((option) => option.value === held.value) && escapeOf(upstream) !== held.value)
                  ? `records "${held.fieldRef}" as "${held.value}", which that field does not offer`
                  : null;
        seen.add(held.fieldRef);
        if (problem !== null) {
          underProblems.push(`${field.fieldRef}: ${read.name} ${problem}`);
          underRefs.push(field.fieldRef);
        }
      }
    }
  }
  if (underProblems.length > 0) {
    return {
      usable: false,
      refusal: {
        kind: "read_under_invalid",
        fieldRefs: [...new Set(underRefs)],
        detail: `A read records only what the fields its list follows held when it was made (P294): ${underProblems.join("; ")}.`,
      },
    };
  }


  // ── P293, ADR-0156 §3: a branch taken only after a form's escape ────────
  //
  // Vahid, 2026-10-08: *"Build a signed mapping row "grade scale 20 → GPA 20"
  // for Sheffield from my existing read, for my signature."* A switch may carry the rule taken
  // when the plan has put the form's escape into an earlier field for the
  // same entry. Every condition below is one the plan relies on: the field is
  // before it on its page (so its value is known), has an escape that leads
  // somewhere, is filled by a profile mapping (the only way its escape is
  // chosen), and cannot be hidden (so the escape cannot be dropped after it
  // was used). The branch renders only from the student's stated answer, so
  // it carries no `absent` arm. And the values it names are the list the
  // form showed after that escape: the row rests on a read, or it is refused.
  //
  // P294: and where the escaped field's own list follows another field
  // (Sheffield's institution box follows the country box), a read is true only
  // of what that field held when it was made. The branch is then keyed on the
  // part that fills that field, and each key must render the value a read it
  // rests on was made under (`countryProblem` below).
  const escapedProblems: string[] = [];
  const escapedRefs: string[] = [];
  for (const page of blueprint.pages) {
    const order = page.sections.flatMap((section) => section.fields);
    const sectionHidden = new Set(page.sections.filter((section) => section.visibleWhen !== undefined).flatMap((section) => section.fields.map((field) => field.fieldRef)));
    order.forEach((field, index) => {
      const mapping = mappingSet.mappings.find((candidate) => candidate.fieldRef === field.fieldRef);
      if (mapping?.source.kind !== "profile_field") return;
      for (const branch of escapedBranchesOf(mapping.source.format)) {
        const at = order.findIndex((candidate) => candidate.fieldRef === branch.fieldRef);
        const opener = at === -1 ? undefined : order[at];
        const openerMapping = mappingSet.mappings.find((candidate) => candidate.fieldRef === branch.fieldRef);
        const escape = opener === undefined ? undefined : escapeOf(opener);
        const targets = optionTargetsOf(branch.then);
        // Which lists the values are checked against:
        // - the ones read after the escape, when the field's list follows the
        //   escaped field (Sheffield's grading system);
        // - when it follows ANOTHER field (the grade follows the grading
        //   system), the lists read after that field set to what its own row
        //   after the same escape renders, and read with the escape in (P294,
        //   `under`) — every one of them, since any may be the one showing;
        //   never a list read for a listed institution;
        // - the field's own options, when its list is on the page whole.
        const follows = field.optionsAfter?.fieldRef;
        const directReads = follows === branch.fieldRef ? (field.listsAfter ?? []).filter((list) => list.fieldRef === branch.fieldRef && list.value === escape) : [];
        const followedMapping = follows === undefined || follows === branch.fieldRef ? undefined : mappingSet.mappings.find((candidate) => candidate.fieldRef === follows);
        const followedBranches = followedMapping?.source.kind === "profile_field" ? escapedBranchesOf(followedMapping.source.format).filter((other) => other.fieldRef === branch.fieldRef) : [];
        const followedValues = [...new Set(followedBranches.flatMap((other) => optionTargetsOf(other.then) ?? []))];
        const readWithEscape = (list: FieldListAfter): boolean => (list.under ?? []).some((held) => held.fieldRef === branch.fieldRef && held.value === escape);
        const chainedReads = follows === undefined || follows === branch.fieldRef ? [] : (field.listsAfter ?? []).filter((list) => list.fieldRef === follows && followedValues.includes(list.value) && readWithEscape(list));
        const unreadValues = followedValues.filter((value) => !chainedReads.some((list) => list.value === value));
        // P294: the field the escaped field's own list follows, if any. The
        // country rule holds the branch only where this field's list depends
        // on the escape: read right after it, or after a field whose own row
        // after it says what it holds. A list on the page whole does not.
        const upstream = opener?.optionsAfter?.fieldRef;
        const countryApplies = upstream !== undefined && (follows === branch.fieldRef || (follows !== undefined && followedBranches.length > 0));
        const unread =
          targets === null || countryApplies
            ? []
            : follows === branch.fieldRef
              ? targets.filter((target) => !directReads.every((list) => list.entries.includes(target)))
              : follows !== undefined
                ? targets.filter((target) => !chainedReads.every((list) => list.entries.includes(target)))
                : targets.filter((target) => !(field.options ?? []).some((option) => option.value === target));
        const problem =
          opener === undefined
            ? `takes the escape of "${branch.fieldRef}", which is not on its page`
            : at >= index
              ? `takes the escape of "${branch.fieldRef}", which does not come before it`
              : escape === undefined
                ? `takes the escape of "${branch.fieldRef}", which records none`
                : opener.escapeLeadsNowhere !== undefined
                  ? `takes the escape of "${branch.fieldRef}", which is read to lead nowhere`
                  : openerMapping?.source.kind !== "profile_field" || opener.frontedBy !== undefined
                    ? `takes the escape of "${branch.fieldRef}", which no profile mapping fills, so it is never chosen`
                    : opener.visibleWhen !== undefined || sectionHidden.has(opener.fieldRef)
                      ? `takes the escape of "${branch.fieldRef}", which the form may hide, so the escape could be dropped after it was used`
                      : targets === null
                        ? `takes the escape of "${branch.fieldRef}" with a rule that names no values of the form's own`
                        : hasAbsentArm(branch.then)
                          ? `takes the escape of "${branch.fieldRef}" with an absent arm, which renders a value the student never stated`
                          : follows === branch.fieldRef && directReads.length === 0
                            ? `takes the escape of "${branch.fieldRef}", and no list was read after that escape (listsAfter)`
                            : follows !== undefined && follows !== branch.fieldRef && followedValues.length === 0
                              ? `takes the escape of "${branch.fieldRef}", but its list follows "${follows}", which has no row after that escape, so what "${follows}" then holds is not known`
                              : !countryApplies && unreadValues.length > 0
                                ? `takes the escape of "${branch.fieldRef}", but its list follows "${follows}", and no list was read after "${follows}" is ${unreadValues.map((value) => `"${value}"`).join(", ")} with "${branch.fieldRef}" escaped (listsAfter, under)`
                                : countryApplies
                                  ? countryProblem({
                                      branch,
                                      escape,
                                      upstream,
                                      chain: upstreamOf(opener),
                                      fieldKey: mapping.source.fieldKey,
                                      mappingSet,
                                      follows,
                                      directReads,
                                      chainedReads: (field.listsAfter ?? []).filter((list) => list.fieldRef === follows && readWithEscape(list)),
                                      followedBranches,
                                    })
                                  : unread.length > 0
                                    ? `names ${unread.map((value) => `"${value}"`).join(", ")}, which ${
                                        follows === branch.fieldRef
                                          ? "the list read after that escape does not hold"
                                          : follows !== undefined
                                            ? `the list read after "${follows}" is ${followedValues.map((value) => `"${value}"`).join(", ")} does not hold`
                                            : "the field's recorded options do not hold"
                                      }`
                                    : null;
        if (problem !== null) {
          escapedProblems.push(`${field.fieldRef} ${problem}`);
          escapedRefs.push(field.fieldRef);
        }
      }
    });
  }
  if (escapedProblems.length > 0) {
    return {
      usable: false,
      refusal: {
        kind: "escaped_branch_invalid",
        fieldRefs: [...new Set(escapedRefs)],
        detail: `A rule taken after a form's escape must be one the plan can honour and a read supports (P293, ADR-0156 §3): ${escapedProblems.join("; ")}.`,
      },
    };
  }

  // P294: a row on a list that follows another field — the institution box
  // after the country box — rests on the searches and lists read with that
  // field set. A list read after the field it directly follows is made under
  // that field's value; any read may record more in `under`. Where a read
  // holding a row's value records what fields of the chain held, the row must
  // be keyed for exactly that, on the parts that fill them — or a read made
  // under what it is keyed for must hold it. A list read after the followed
  // field's ESCAPE is left to the escaped branch's own check (countryProblem),
  // and a row resting on no read that records a value is not held here:
  // nothing says which country it was.
  const countryRowProblems: string[] = [];
  const countryRowRefs: string[] = [];
  for (const field of allFields(blueprint)) {
    const upstream = field.optionsAfter?.fieldRef;
    if (upstream === undefined) continue;
    const chain = upstreamOf(field);
    // A read made after an escape anywhere on the chain rests with the
    // branch taken after that escape, which `countryProblem` holds.
    const afterEscape = (held: ReadonlyMap<string, string>): boolean =>
      [...held].some(([fieldRef, value]) => {
        const chained = fieldsByRefForReads.get(fieldRef);
        return chained !== undefined && escapeOf(chained) === value;
      });
    const recorded = [
      ...(field.searches ?? []).map((search) => ({ entries: search.entries, held: heldUnder(search.under) })),
      ...(field.listsAfter ?? []).filter((list) => list.fieldRef === upstream).map((list) => ({ entries: list.entries, held: heldUnder(list.under, list) })),
    ]
      .filter((read) => !afterEscape(read.held))
      .map((read) => ({ entries: read.entries, held: new Map([...read.held].filter(([fieldRef]) => chain.includes(fieldRef))) }))
      .filter((read) => read.held.size > 0);
    if (recorded.length === 0) continue;
    const mapping = mappingSet.mappings.find((candidate) => candidate.fieldRef === field.fieldRef);
    if (mapping === undefined) continue;
    const recordedFields = chain.filter((fieldRef) => recorded.some((read) => read.held.has(fieldRef)));
    let leaves: readonly RowLeaf[];
    let parts: ChainPart[] = [];
    let unreadable: string | undefined;
    if (mapping.source.kind === "constant") {
      leaves = [{ targets: [mapping.source.value], keyedFor: new Map(), keys: new Map() }];
    } else if (mapping.source.kind === "profile_field") {
      const fieldKey = mapping.source.fieldKey;
      unreadable = recordedFields.find((fieldRef) => chainPartOf(mappingSet, fieldRef, fieldKey) === undefined);
      parts = recordedFields.flatMap((fieldRef) => {
        const part = chainPartOf(mappingSet, fieldRef, fieldKey);
        return part === undefined ? [] : [part];
      });
      leaves = leavesOf(mapping.source.format, parts, true);
    } else {
      continue;
    }
    for (const leaf of leaves) {
      if (leaf.problem !== undefined) {
        countryRowProblems.push(`${field.fieldRef} ${leaf.problem}`);
        countryRowRefs.push(field.fieldRef);
        continue;
      }
      for (const target of leaf.targets) {
        const holding = recorded.filter((read) => read.entries.includes(target));
        if (holding.length === 0) continue;
        if (holding.some((read) => [...read.held].every(([fieldRef, value]) => leaf.keyedFor.get(fieldRef) === value))) continue;
        const unkeyed = parts.find((part) => holding.some((read) => read.held.has(part.fieldRef)) && !leaf.keyedFor.has(part.fieldRef));
        // A row resting on such a read, where the field it was read under is
        // not filled by a part→option row, cannot be keyed for it at all.
        if (unreadable !== undefined && mapping.source.kind === "profile_field") {
          countryRowProblems.push(
            `${field.fieldRef} sends "${target}", resting on reads made with "${unreadable}" set, and "${unreadable}" is not filled from the same ${mapping.source.fieldKey} entry by one part through an option rule, so which "${unreadable}" a row is keyed for cannot be told`,
          );
          countryRowRefs.push(field.fieldRef);
          continue;
        }
        countryRowProblems.push(
          `${field.fieldRef} sends "${target}", which a read made with ${holding.map((read) => describeUnder([...read.held.keys()], read.held)).join(" or ")} holds, ` +
            (mapping.source.kind === "constant"
              ? "from a constant, which is keyed for nothing"
              : unkeyed !== undefined
                ? `from a row not keyed on "${unkeyed.part}", the part that sets "${unkeyed.fieldRef}"`
                : `from a row keyed for ${[...leaf.keyedFor.values()].map((value) => `"${value}"`).join(", ")}`),
        );
        countryRowRefs.push(field.fieldRef);
      }
    }
  }
  if (countryRowProblems.length > 0) {
    return {
      usable: false,
      refusal: {
        kind: "read_country_mismatch",
        fieldRefs: [...new Set(countryRowRefs)],
        detail: `A row rests on the read made under the value it is keyed for, or it is refused (P294): ${countryRowProblems.join("; ")}.`,
      },
    };
  }

  if (typeaheadProblems.length > 0) {
    return {
      usable: false,
      refusal: {
        kind: "typeahead_invalid",
        fieldRefs: typeaheadProblems.map((field) => field.fieldRef),
        detail:
          typeaheadProblems
            .map((field) =>
              field.inputType === "typeahead"
                ? `${field.fieldRef} is a typeahead that does not say where its entries are found`
                : `${field.fieldRef} is a ${field.inputType} field that declares typeahead entries`,
            )
            .join("; ") +
          ". A typeahead carries the locator of the entries it offers, and nothing else does (ADR-0103).",
      },
    };
  }

  // ── ADR-0103 gap 3: a page filled once per item draws only from its list ──
  //
  // Every mapping on a repeating page is relative to ONE item of the list the
  // page repeats over: a mapping from another field would type the same
  // given name into every qualification, a handoff or a credential has no
  // "per item", a document is mapped to a held type and not to an item, and a
  // condition on the page would be evaluated against which item nobody could
  // say. The page's own declarations decide nothing here (ADR-0066).
  const repeatProblems: string[] = [];
  const repeatRefs: string[] = [];
  for (const page of blueprint.pages) {
    if (page.repeats === undefined) continue;
    const over = page.repeats.fieldKey;
    if (!(LIST_VALUED_FIELD_KEYS as readonly string[]).includes(over)) {
      repeatProblems.push(`${page.pageRef} repeats over "${over}", which is not a list-valued profile field`);
      repeatRefs.push(page.pageRef);
    }
    const onPage = new Set(page.sections.flatMap((section) => section.fields.map((field) => field.fieldRef)));
    for (const section of page.sections) {
      for (const field of section.fields) {
        // ADR-0104: a condition inside a repeat is answered per item, against
        // that item's own values — so it may look only at the page.
        for (const condition of [field.visibleWhen, section.visibleWhen]) {
          if (condition !== undefined && !onPage.has(condition.whenFieldRef)) {
            repeatProblems.push(
              `${field.fieldRef} is shown or hidden by "${condition.whenFieldRef}", which is not on the page that repeats`,
            );
            repeatRefs.push(field.fieldRef);
          }
        }
        const mapping = mappingSet.mappings.find((candidate) => candidate.fieldRef === field.fieldRef);
        if (mapping === undefined) continue;
        if (mapping.source.kind === "profile_field") {
          if (mapping.source.fieldKey !== over) {
            repeatProblems.push(`${field.fieldRef} draws from "${mapping.source.fieldKey}" on a page that repeats over "${over}"`);
            repeatRefs.push(field.fieldRef);
          }
        } else if (mapping.source.kind === "student_handoff") {
          // ADR-0104 (B): the documents of a repeating page are the student's
          // own act, said under each entry. ADR-0119 extends the same shape to
          // any box handed to the student on a repeating page: one own act
          // per entry, said under it, recorded at the yes. The slot's
          // companion is set by the runner (ADR-0107), not handed.
        } else if (mapping.source.kind !== "constant") {
          repeatProblems.push(`${field.fieldRef} is mapped as ${mapping.source.kind} on a page that repeats`);
          repeatRefs.push(field.fieldRef);
        }
      }
    }
  }
  if (repeatProblems.length > 0) {
    return {
      usable: false,
      refusal: {
        kind: "repeat_mapping_invalid",
        fieldRefs: repeatRefs,
        detail:
          `${repeatProblems.join("; ")}. A page filled once per item draws every value from one item ` +
          `of the list it repeats over, or from a reviewed constant, or is handed to the student ` +
          `as their own act per entry; a condition on it looks only at the page ` +
          `(ADR-0103, ADR-0104, ADR-0119).`,
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
  const sameLocator = (a: FieldLocator | undefined, b: FieldLocator | undefined): boolean =>
    a !== undefined && b !== undefined && a.strategy === b.strategy && a.value === b.value;
  // Every control the blueprint knows to move the application, on any page:
  // none of them loads options, and a press may be none of them.
  const movingControls: readonly FieldLocator[] = [
    ...blueprint.pages.flatMap((page) => [page.advanceControl, page.repeats?.addAnother]),
    blueprint.submission?.submitControl,
  ].filter((control): control is FieldLocator => control !== undefined);
  for (const page of blueprint.pages) {
    const order = page.sections.flatMap((section) => section.fields);
    order.forEach((field, index) => {
      if (field.optionsAfter === undefined) return;
      // ADR-0105: a press loads options and nothing else. The controls that
      // advance, add another or submit are known to the blueprint, and a press
      // that is one of them is refused here; the runner refuses a submission
      // name and a press that leaves the page.
      const press = field.optionsAfter.press;
      if (press !== undefined && movingControls.some((control) => sameLocator(press, control))) {
        orderProblems.push(`${field.fieldRef} presses ${press.strategy}="${press.value}", which advances, adds another or submits`);
        orderRefs.push(field.fieldRef);
        return;
      }
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
  // P102: a typeahead offers entries — for what is typed, and on the first
  // real form for the earlier field too (the institution search carries the
  // chosen country). Its wait is its own, bounded, at the fill.
  return (
    field.inputType === "select" ||
    field.inputType === "multiselect" ||
    field.inputType === "radio" ||
    field.inputType === "typeahead"
  );
}

/**
 * Every row of an option rule, with the part its key is a value of — the
 * innermost `part` before the option (P282). Through `part` and `switch`.
 */
function optionRowsOf(rule: FormatRule, part?: string): readonly { readonly key: string; readonly target: string; readonly part: string | undefined }[] {
  if (rule.kind === "option") return Object.entries(rule.options).map(([key, target]) => ({ key, target, part }));
  if (rule.kind === "part") return rule.then === undefined ? [] : optionRowsOf(rule.then, rule.path);
  if (rule.kind === "switch") return branchesOf(rule).flatMap((branch) => optionRowsOf(branch, part));
  return [];
}

/**
 * A field a read may be made under, as a row can key on it (P294): the part of
 * the same profile entry that fills it, and what each value of that part
 * renders there. Sheffield's country box: `countryCode`, `IR` → `IRAN`.
 */
interface ChainPart {
  readonly fieldRef: string;
  readonly part: string;
  readonly renders: Readonly<Record<string, string>>;
}

/** The field's own part→option row, if it is filled that way from the same profile entry (P294). */
function chainPartOf(mappingSet: MappingSet, fieldRef: string, fieldKey: string): ChainPart | undefined {
  const mapping = mappingSet.mappings.find((candidate) => candidate.fieldRef === fieldRef);
  if (mapping?.source.kind !== "profile_field" || mapping.source.fieldKey !== fieldKey) return undefined;
  const format = mapping.source.format;
  if (format.kind !== "part" || format.then?.kind !== "option") return undefined;
  return { fieldRef, part: format.path, renders: format.then.options };
}

/**
 * A row's leaves (P294): each option rule in it, with the values of the chain
 * fields its enclosing switches key it for — a switch on a chain field's part,
 * at the entry itself (not under another `part`), keys its cases for what each
 * key renders there. A key that renders nothing is a problem. With
 * `skipEscaped`, a branch taken after an escape is left out: it rests on the
 * list read after that escape, which `countryProblem` holds.
 */
interface RowLeaf {
  readonly targets: readonly string[];
  readonly keyedFor: ReadonlyMap<string, string>;
  readonly keys: ReadonlyMap<string, string>;
  readonly problem?: string;
}
function leavesOf(rule: FormatRule, chain: readonly ChainPart[], skipEscaped: boolean, keyedFor: ReadonlyMap<string, string> = new Map(), keys: ReadonlyMap<string, string> = new Map(), atEntry = true): readonly RowLeaf[] {
  if (rule.kind === "option") return [{ targets: Object.values(rule.options), keyedFor, keys }];
  if (rule.kind === "part") return rule.then === undefined ? [] : leavesOf(rule.then, chain, skipEscaped, keyedFor, keys, false);
  if (rule.kind === "date") return rule.then === undefined ? [] : leavesOf(rule.then, chain, skipEscaped, keyedFor, keys, false);
  if (rule.kind !== "switch") return [];
  const link = atEntry ? chain.find((candidate) => candidate.part === rule.path) : undefined;
  if (link === undefined) {
    return (skipEscaped ? Object.values(rule.cases) : branchesOf(rule)).flatMap((branch) => leavesOf(branch, chain, skipEscaped, keyedFor, keys, atEntry));
  }
  return Object.entries(rule.cases).flatMap(([key, branch]) => {
    const value = link.renders[key];
    if (value === undefined) return [{ targets: [], keyedFor, keys, problem: `keys "${key}" on "${rule.path}", which "${link.fieldRef}"'s row does not render` }];
    // A key for a value an enclosing switch already excludes is never taken.
    if (keyedFor.has(link.fieldRef) && keyedFor.get(link.fieldRef) !== value) return [];
    return leavesOf(branch, chain, skipEscaped, new Map([...keyedFor, [link.fieldRef, value]]), new Map([...keys, [link.fieldRef, key]]), atEntry);
  });
}

/** What a read records it was made under, as a map, the field it is read after included when given. */
function heldUnder(under: readonly { readonly fieldRef: string; readonly value: string }[] | undefined, after?: { readonly fieldRef: string; readonly value: string }): ReadonlyMap<string, string> {
  return new Map([...(after === undefined ? [] : [[after.fieldRef, after.value] as const]), ...(under ?? []).map((held) => [held.fieldRef, held.value] as const)]);
}

/** "country" set to "IRAN", and the rest, for a message. */
function describeUnder(fields: readonly string[], values: ReadonlyMap<string, string>): string {
  return fields.map((fieldRef) => `"${fieldRef}" set to "${values.get(fieldRef) ?? ""}"`).join(" and ");
}

/**
 * P294: an escaped branch on a field whose list depends on the escape, where
 * the escaped field's own list follows others — Sheffield's grading system
 * after the institution box, which follows the country box. Vahid,
 * 2026-10-09: *"make the check refuse a mapping row whose key does not match
 * the country of the read it rests on."*
 *
 * The reads the branch rests on must record what the field the escaped field
 * follows held, and every one of them must record every field of that chain
 * any of them records: a read with no country is not true of every country.
 * Each such field must be filled from one part of the same entry through an
 * option rule, so a key on that part names one value. Every leaf of the branch
 * must be keyed for every recorded field, and its values held by every read
 * made under what it is keyed for. Where the list follows another field (the
 * grade after the grading system), that field's own row after the same escape
 * says what it holds for the same keys, and a list must be read after each.
 */
function countryProblem(args: {
  readonly branch: { readonly fieldRef: string; readonly then: FormatRule };
  readonly escape: string;
  readonly upstream: string;
  readonly chain: readonly string[];
  readonly fieldKey: string;
  readonly mappingSet: MappingSet;
  readonly follows: string | undefined;
  readonly directReads: readonly FieldListAfter[];
  readonly chainedReads: readonly FieldListAfter[];
  readonly followedBranches: readonly { readonly fieldRef: string; readonly then: FormatRule }[];
}): string | null {
  const { branch, upstream, chain, fieldKey, mappingSet, follows, directReads, chainedReads, followedBranches } = args;
  const opener = branch.fieldRef;
  const direct = follows === opener;
  const reads = direct ? directReads : chainedReads;
  const recordedOf = (read: FieldListAfter): ReadonlyMap<string, string> => heldUnder(read.under);
  const recordedFields = chain.filter((fieldRef) => reads.some((read) => recordedOf(read).has(fieldRef)));
  if (!recordedFields.includes(upstream)) {
    return `takes the escape of "${opener}", whose list follows "${upstream}", but rests on no read that records what "${upstream}" held (under), so the row cannot be held to the "${upstream}" it was read under`;
  }
  for (const read of reads) {
    const missing = recordedFields.filter((fieldRef) => !recordedOf(read).has(fieldRef));
    if (missing.length > 0) {
      return `takes the escape of "${opener}" and rests on a list read after "${read.fieldRef}" is "${read.value}" that records no ${missing.map((fieldRef) => `"${fieldRef}"`).join(", ")} (under), though another it rests on does: a read with none is not true of every one`;
    }
  }
  const parts: ChainPart[] = [];
  for (const fieldRef of recordedFields) {
    const part = chainPartOf(mappingSet, fieldRef, fieldKey);
    if (part === undefined) {
      return `takes the escape of "${opener}", whose list follows "${fieldRef}", and "${fieldRef}" is not filled from the same ${fieldKey} entry by one part through an option rule, so which "${fieldRef}" a key names cannot be told`;
    }
    parts.push(part);
  }
  // The followed field's own row after the same escape, leaf by leaf.
  const followedLeaves = direct ? [] : followedBranches.flatMap((other) => leavesOf(other.then, parts, false));
  for (const leaf of leavesOf(branch.then, parts, false)) {
    if (leaf.problem !== undefined) return leaf.problem;
    const unkeyed = parts.filter((part) => !leaf.keyedFor.has(part.fieldRef));
    const first = unkeyed[0];
    if (first !== undefined) {
      return `takes the escape of "${opener}", whose list follows "${upstream}", but is not keyed on "${first.part}", the part that sets "${first.fieldRef}": a read is true only of the "${first.fieldRef}" it was made under`;
    }
    const key = leaf.keys.get(upstream) ?? "";
    const value = leaf.keyedFor.get(upstream) ?? "";
    const madeUnder = (read: FieldListAfter): boolean => recordedFields.every((fieldRef) => recordedOf(read).get(fieldRef) === leaf.keyedFor.get(fieldRef));
    let underLeaf: readonly FieldListAfter[];
    if (direct) {
      underLeaf = directReads.filter(madeUnder);
      if (underLeaf.length === 0) {
        return recordedFields.length === 1
          ? `keys "${key}" ("${upstream}" is "${value}"), but no list after that escape was read with "${upstream}" set to "${value}"`
          : `keys "${key}", but no list after that escape was read with ${describeUnder(recordedFields, leaf.keyedFor)}`;
      }
    } else {
      // What the followed field holds for this leaf: its own leaves keyed
      // for the same values wherever both are keyed.
      const held = [
        ...new Set(
          followedLeaves
            .filter((other) => other.problem === undefined && [...other.keyedFor].every(([fieldRef, its]) => leaf.keyedFor.get(fieldRef) === its))
            .flatMap((other) => other.targets),
        ),
      ];
      if (held.length === 0) return `keys "${key}", but "${follows ?? ""}" has no row for "${key}" after that escape, so what it then holds is not known`;
      underLeaf = chainedReads.filter((read) => held.includes(read.value) && madeUnder(read));
      const missing = held.filter((followed) => !underLeaf.some((read) => read.value === followed));
      if (missing.length > 0) {
        return `keys "${key}", and no list was read after "${follows ?? ""}" is ${missing.map((followed) => `"${followed}"`).join(", ")} with "${opener}" escaped and ${describeUnder(recordedFields, leaf.keyedFor)}`;
      }
    }
    const unread = leaf.targets.filter((target) => !underLeaf.every((read) => read.entries.includes(target)));
    if (unread.length > 0) {
      return `names ${unread.map((target) => `"${target}"`).join(", ")} under "${key}", which the list read with ${describeUnder(recordedFields, leaf.keyedFor)} does not hold`;
    }
  }
  return null;
}

/** A switch's sub-rules: its cases, and its branch for a form's escape when it has one (P293). */
function branchesOf(rule: Extract<FormatRule, { kind: "switch" }>): readonly FormatRule[] {
  return [...Object.values(rule.cases), ...(rule.escaped === undefined ? [] : [rule.escaped.then])];
}

/** Whether a rule carries an `absent` arm anywhere: a value rendered when the student stated none (P293). */
function hasAbsentArm(rule: FormatRule): boolean {
  if (rule.kind === "part") return rule.absent !== undefined || (rule.then !== undefined && hasAbsentArm(rule.then));
  if (rule.kind === "date") return rule.then !== undefined && hasAbsentArm(rule.then);
  if (rule.kind === "switch") return rule.absent !== undefined || branchesOf(rule).some((branch) => hasAbsentArm(branch));
  return false;
}

/** Every escaped branch in a format, wherever it sits (P293). */
function escapedBranchesOf(rule: FormatRule): readonly { readonly fieldRef: string; readonly then: FormatRule }[] {
  if (rule.kind === "part") return rule.then === undefined ? [] : escapedBranchesOf(rule.then);
  if (rule.kind === "date") return rule.then === undefined ? [] : escapedBranchesOf(rule.then);
  if (rule.kind === "switch") return [...(rule.escaped === undefined ? [] : [rule.escaped]), ...branchesOf(rule).flatMap((branch) => escapedBranchesOf(branch))];
  return [];
}

/** The values an option rule can produce, or null when the rule is not one (through `part`). */
function optionTargetsOf(rule: FormatRule): readonly string[] | null {
  if (rule.kind === "option") return Object.values(rule.options);
  if (rule.kind === "part") return rule.then === undefined ? null : optionTargetsOf(rule.then);
  if (rule.kind === "switch") {
    // Every case must name its values; one case of free text is free text
    // onto the whole field (P218).
    // P293: the branch for a form's escape is one more case.
    const perCase = branchesOf(rule).map((branch) => optionTargetsOf(branch));
    if (perCase.some((targets) => targets === null)) return null;
    return perCase.flatMap((targets) => targets ?? []);
  }
  return null;
}

/** Whether the form itself offers `value` as something to choose on this field. */
function formOffers(field: BlueprintField, value: string): boolean {
  if (field.inputType === "checkbox") return value === "true";
  if (field.inputType === "select" || field.inputType === "radio" || field.inputType === "multiselect" || field.inputType === "typeahead") {
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
 * The fields of every section the portal says may be skipped (ADR-0119), with
 * the portal's words for it. A `required` marker on one of these is a mark
 * within the section, not a box the page will not save without.
 */
export function optionalSectionWords(blueprint: ApplicationBlueprint): ReadonlyMap<string, string> {
  const words = new Map<string, string>();
  for (const page of blueprint.pages) {
    for (const section of page.sections) {
      if (section.optional === undefined) continue;
      for (const field of section.fields) words.set(field.fieldRef, section.optional.formSays);
    }
  }
  return words;
}

/**
 * Whether the page will not save without this field: marked required, and not
 * inside a section the portal says may be skipped (ADR-0119).
 */
export function isRequiredToSave(blueprint: ApplicationBlueprint, field: BlueprintField): boolean {
  return isRequired(field) && !optionalSectionWords(blueprint).has(field.fieldRef);
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
    (field) => isRequiredToSave(blueprint, field) && mappingFor(mappingSet, field.fieldRef) === undefined,
  );
}

/**
 * A constant that a reviewed mapping set actually contains.
 *
 * Branded, and constructible only from a `UsableMappingSet` — which requires a
 * signed review. So a constant cannot appear in a fill plan unless a human put
 * it in a mapping set and a human signed it, which is the only control
 * available for a value that is not the student's to confirm. Whether that
 * signature was a second person's, and whom it admits, is the registry's
 * record (ADR-0118).
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
