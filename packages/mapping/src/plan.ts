/**
 * Turning a blueprint, a mapping set and a confirmed profile into a fill plan.
 *
 * This is where the system decides what it is going to type into a university
 * application, and it happens **entirely before a browser is opened**. That
 * ordering is deliberate: a plan can be reviewed, previewed, diffed and
 * authorised, and a sequence of live keystrokes cannot.
 *
 *   blueprint  ─┐
 *   mapping set ─┼→  fill plan  →  preview  →  student authorises  →  execution
 *   profile    ─┘        │
 *                        └─ every blocker known here, not discovered mid-form
 *
 * ── The property that matters ─────────────────────────────────────────────
 *
 * Every instruction carrying STUDENT DATA carries a `ConfirmedValue<string>`,
 * and there is no other way to obtain one: it comes from `renderConfirmed`,
 * which requires a `ConfirmedValue` to start from, which only
 * `applyConfirmation` can mint, which requires a student's confirmation record.
 *
 * The only other thing an instruction can carry is a `ReviewedConstant`, which
 * requires a reviewed mapping set to construct and is reported separately
 * everywhere it appears.
 *
 * So "the AI never sources a form field value" is not a rule the planner
 * follows. It is a property of what the planner is able to construct.
 */

import type {
  ApplicationBlueprint,
  BlueprintField,
  FieldCondition,
  FieldInputType,
  FieldLocator,
} from "@askimate/aas-blueprint";
import { allFields, allRequiredDocuments } from "@askimate/aas-blueprint";
import type { ConfirmedValue, UnavailableReason } from "@askimate/aas-domain";
import { isFieldUnavailable, unwrapConfirmed } from "@askimate/aas-domain";
import type { ConfirmedProfile, OrdinaryFieldKey, ProfileFieldKey, RenderRefusal } from "@askimate/aas-profile";
import { renderConfirmed, renderConfirmedItem, resolveField } from "@askimate/aas-profile";

import type { CredentialPurpose, ReviewedConstant, ReviewedFormRefusal, UsableMappingSet } from "./mapping.js";
import {
  constantText,
  formRefusalText,
  isRequired,
  mappingFor,
  reviewedConstant,
  reviewedFormRefusal,
} from "./mapping.js";

/**
 * What is about to be typed into one field.
 *
 * Two shapes, kept apart on purpose.
 *
 *   confirmed          the student's data. Carries the ConfirmedValue, with
 *                      the provenance of their confirmation intact.
 *
 *   reviewed_constant  application metadata a specialist configured — a course
 *                      code, an intake term. NOT student data, and NOT dressed
 *                      up as it.
 *
 * The tempting shortcut is to give a constant a fabricated `ConfirmedValue`
 * with `student_entered` provenance so everything downstream has one type to
 * handle. That would mean the system holding a record saying a student
 * confirmed something they have never seen — a lie in the audit trail, told for
 * the convenience of the code that reads it. A union is a small price.
 */
export type FillValue =
  | { readonly kind: "confirmed"; readonly value: ConfirmedValue<string>; readonly fieldKey: ProfileFieldKey }
  | { readonly kind: "reviewed_constant"; readonly constant: ReviewedConstant }
  /** The refusal the form offers on a question this system cannot answer (ADR-0102). */
  | { readonly kind: "form_refusal"; readonly refusal: ReviewedFormRefusal };

/** One thing to type into one field. */
export interface FillInstruction {
  readonly fieldRef: string;
  readonly label: string;
  readonly inputType: FieldInputType;
  readonly locators: readonly FieldLocator[];
  readonly value: FillValue;
  /**
   * This field's options are loaded by the portal after `fieldRef` is set
   * (ADR-0103, gap 1). The runner waits a bounded time for the option it is
   * told to select before selecting; the field it follows precedes this one in
   * the plan, because `checkUsable` refused any other order.
   */
  readonly optionsAfter?: { readonly fieldRef: string };
  /**
   * Where the entries of a typeahead are found (ADR-0103, gap 2). The runner
   * types the text, waits for the one entry that reads exactly it, and
   * chooses that entry — a fill, not an advance.
   */
  readonly typeahead?: { readonly optionLocator: FieldLocator };
  /**
   * Which item of a repeating page this instruction belongs to (ADR-0103,
   * gap 3): the page is filled `count` times, and this is fill `index`. Absent
   * off a repeating page.
   */
  readonly item?: { readonly index: number; readonly count: number };
}

/** A page filled once per item of a list (ADR-0103, gap 3), and how many times. */
export interface RepeatedPage {
  readonly pageRef: string;
  readonly title: string;
  readonly fieldKey: string;
  /** Zero when the list is unconfirmed and nothing on the page is required. */
  readonly count: number;
}

/** The text a fill instruction will type, whichever kind it is. */
export function textOf(value: FillValue): string {
  switch (value.kind) {
    case "confirmed":
      return unwrapConfirmed(value.value);
    case "reviewed_constant":
      return constantText(value.constant);
    case "form_refusal":
      return formRefusalText(value.refusal);
  }
}

/** A document to attach. */
export interface UploadInstruction {
  readonly fieldRef: string;
  readonly label: string;
  readonly documentRef: string;
  readonly locators: readonly FieldLocator[];
  /** The attach's second act (ADR-0103, gap 4): the control set beside the slot, and its value. */
  readonly companion?: {
    readonly fieldRef: string;
    readonly label: string;
    readonly locators: readonly FieldLocator[];
    readonly text: string;
  };
}

/**
 * A field the Secure Plane fills. ADR-0043.
 *
 * Deliberately NOT a `FillInstruction`. A `FillInstruction` carries a
 * `FillValue`, and there is no `FillValue` that could hold a credential — so
 * keeping these in their own list means every existing consumer of
 * `instructions` (the preview, the validator, the executor) continues to see
 * only things that have values, and cannot accidentally treat a credential as
 * one.
 *
 * There is no `value` field here, and there is nowhere for one to go.
 */
export interface CredentialRequirement {
  readonly fieldRef: string;
  readonly label: string;
  readonly purpose: CredentialPurpose;
  readonly locators: readonly FieldLocator[];
}

/** A point where the student must act (brief §7). Never automated, never bypassed. */
export interface HandoffRequirement {
  readonly fieldRef: string;
  readonly label: string;
  readonly reason: string;
  /**
   * What the field is. A handoff on a document slot (`file`) is the student's
   * own act on a page the runner still fills, and does not refuse transport
   * (ADR-0104); a handoff on anything else still does.
   */
  readonly inputType: FieldInputType;
  /** Which entry of a repeating page this belongs to (ADR-0104). */
  readonly item?: { readonly index: number; readonly count: number };
}

/** Something that stops the plan being complete. */
export type FillBlocker =
  /** A required field nobody mapped. A mapping-set gap, not a student gap. */
  | { readonly kind: "no_mapping"; readonly fieldRef: string; readonly label: string; readonly detail: string }
  /**
   * A special-category field with no refusal mapped — required or not (ADR-0102).
   *
   * Structural, so the orchestrator asks a specialist rather than the interview:
   * there is nothing a student could say that this system may hold. The general
   * rule in Vahid's words: *"If a future portal has no equivalent opt-out, the
   * fill must stop rather than pick something."*
   */
  | { readonly kind: "special_category_unhandled"; readonly fieldRef: string; readonly label: string; readonly detail: string }
  /**
   * The mapping is right and the student has not supplied the value.
   *
   * The ordinary, expected blocker, and the one that drives the interview: it
   * says exactly which canonical field to go and ask about.
   */
  | {
      readonly kind: "value_unavailable";
      readonly fieldRef: string;
      readonly label: string;
      readonly fieldKey: OrdinaryFieldKey;
      readonly reason: UnavailableReason;
    }
  /** The value exists and cannot be written in this portal's notation. */
  | {
      readonly kind: "render_refused";
      readonly fieldRef: string;
      readonly label: string;
      readonly fieldKey: OrdinaryFieldKey;
      readonly refusal: RenderRefusal;
    };

/**
 * A field the form does not show for these answers (P90).
 *
 * The blueprint records `visibleWhen` — "UK postcode, when the country is the
 * United Kingdom" — and until P90 nothing read it: both postcode boxes were
 * planned, one of them hidden on the page, and a hidden required field with
 * no mapping blocked a plan the form would never have asked for. Evaluated
 * here, at plan time, against the plan's own values, so the preview and the
 * fill see only what the student would.
 */
export interface HiddenField {
  readonly fieldRef: string;
  readonly label: string;
  /** The field whose planned value hides this one. */
  readonly whenFieldRef: string;
  /** On a repeating page, WHICH entry hides it — the condition is answered per item (ADR-0104). */
  readonly item?: { readonly index: number; readonly count: number };
}

export interface FillPlan {
  readonly blueprintId: string;
  readonly blueprintVersion: string;
  readonly mappingSetId: string;
  readonly instructions: readonly FillInstruction[];
  readonly uploads: readonly UploadInstruction[];
  readonly handoffs: readonly HandoffRequirement[];
  /** Fields the Secure Plane fills. Never carries a value (ADR-0043). */
  readonly credentials: readonly CredentialRequirement[];
  readonly blockers: readonly FillBlocker[];
  /** Fields the form hides for these answers: neither filled nor missing (P90). */
  readonly hidden: readonly HiddenField[];
  /** Pages filled once per item, with how many times each (ADR-0103, gap 3). */
  readonly repeats: readonly RepeatedPage[];
}

/**
 * Builds the plan.
 *
 * Note it takes a `UsableMappingSet`, not a `MappingSet`. An unreviewed mapping
 * set cannot reach this function, so "was it reviewed?" is answered by the
 * signature rather than by a check someone has to remember to call.
 */
export function planFill(
  blueprint: ApplicationBlueprint,
  mappingSet: UsableMappingSet,
  profile: ConfirmedProfile,
): FillPlan {
  const instructions: FillInstruction[] = [];
  const uploads: UploadInstruction[] = [];
  const handoffs: HandoffRequirement[] = [];
  const credentials: CredentialRequirement[] = [];
  const blockers: FillBlocker[] = [];

  // ADR-0102: the other controls of a question one refusal answers. Left
  // untouched, and not blockers — `checkUsable` has held each is
  // special-category and mapped by nothing.
  const covered = new Set(
    mappingSet.mappings.flatMap((mapping) =>
      mapping.source.kind === "form_refusal" ? [...(mapping.source.covers ?? [])] : [],
    ),
  );

  // ADR-0103 gap 4: which slots have a companion, and which fields are one.
  const fieldsByRef = new Map(allFields(blueprint).map((field) => [field.fieldRef, field]));
  const companionOf = new Map(
    allRequiredDocuments(blueprint)
      .filter((document) => document.companion !== undefined)
      .map((document) => [document.fieldRef, document.companion] as const),
  );
  const companionFields = new Set(
    [...companionOf.entries()]
      .filter(([slot]) => mappingFor(mappingSet, slot)?.source.kind === "document")
      .map(([, companion]) => companion?.fieldRef ?? ""),
  );

  // ADR-0103 gap 3: the fields of a page filled once per item are planned
  // below, per item, and not here.
  const repeated = new Set(
    blueprint.pages
      .filter((page) => page.repeats !== undefined)
      .flatMap((page) => page.sections.flatMap((section) => section.fields.map((field) => field.fieldRef))),
  );

  for (const field of allFields(blueprint)) {
    if (repeated.has(field.fieldRef)) continue;
    const mapping = mappingFor(mappingSet, field.fieldRef);

    if (mapping === undefined) {
      if (covered.has(field.fieldRef)) continue;
      // A companion of an attached slot is set by the attach, not mapped.
      if (companionFields.has(field.fieldRef)) continue;
      // A special-category field is never passed over, required or not: with
      // no refusal mapped the fill STOPS (ADR-0102). Checked before the
      // optional rule below, which would otherwise make silence the default.
      if (field.dataCategory === "special_category") {
        blockers.push({
          kind: "special_category_unhandled",
          fieldRef: field.fieldRef,
          label: field.label,
          detail:
            `"${field.label}" asks what this system cannot hold, and no refusal the form offers ` +
            `is mapped for it. The fill stops rather than picking something: use the refusal the ` +
            `form offers, and if the form offers none, a person decides (ADR-0102).`,
        });
        continue;
      }
      // An OPTIONAL unmapped field is not a problem: portals carry fields no
      // applicant needs to complete, and leaving one blank is the correct
      // behaviour rather than a gap to fill.
      if (isRequired(field)) {
        blockers.push({
          kind: "no_mapping",
          fieldRef: field.fieldRef,
          label: field.label,
          detail:
            `Required field "${field.label}" has no mapping. A specialist decides what belongs ` +
            `here — it is not something to work out while a form is open.`,
        });
      }
      continue;
    }

    switch (mapping.source.kind) {
      case "form_refusal":
        // Not an answer. Planned as its own kind so the preview can say so and
        // the runner can enter it — `checkUsable` has already held that the
        // field is special-category and the form offers this value.
        instructions.push({
          ...instructionShape(field),
          value: { kind: "form_refusal", refusal: reviewedFormRefusal(mappingSet, mapping.source) },
        });
        break;

      case "student_handoff":
        handoffs.push({
          fieldRef: field.fieldRef,
          label: field.label,
          reason: mapping.source.reason,
          inputType: field.inputType,
        });
        break;

      // ADR-0043. Nothing is read from the profile, nothing is rendered, and
      // no `FillValue` is built — because there is none that could hold this.
      case "secure_credential":
        credentials.push({
          fieldRef: field.fieldRef,
          label: field.label,
          purpose: mapping.source.purpose,
          locators: field.locators,
        });
        break;

      case "document": {
        const companion = companionOf.get(field.fieldRef);
        const companionField = companion === undefined ? undefined : fieldsByRef.get(companion.fieldRef);
        uploads.push({
          fieldRef: field.fieldRef,
          label: field.label,
          documentRef: mapping.source.documentRef,
          locators: field.locators,
          ...(companion === undefined || companionField === undefined
            ? {}
            : {
                companion: {
                  fieldRef: companionField.fieldRef,
                  label: companionField.label,
                  locators: companionField.locators,
                  text: companion.whenAttached,
                },
              }),
        });
        break;
      }

      case "constant":
        instructions.push({
          ...instructionShape(field),
          value: {
            kind: "reviewed_constant",
            constant: reviewedConstant(mappingSet, mapping.source),
          },
        });
        break;

      case "profile_field": {
        const { fieldKey, format } = mapping.source;
        const resolution = resolveField(profile, fieldKey);

        if (isFieldUnavailable(resolution)) {
          blockers.push({
            kind: "value_unavailable",
            fieldRef: field.fieldRef,
            label: field.label,
            fieldKey,
            reason: resolution.reason,
          });
          break;
        }

        const rendered = renderConfirmed(resolution, format);
        if (!rendered.rendered) {
          blockers.push({
            kind: "render_refused",
            fieldRef: field.fieldRef,
            label: field.label,
            fieldKey,
            refusal: rendered.refusal,
          });
          break;
        }

        instructions.push({
          ...instructionShape(field),
          value: { kind: "confirmed", value: rendered.value, fieldKey },
        });
        break;
      }
    }
  }

  // ── ADR-0103 gap 3: a page filled once per item of a list ───────────────
  //
  // The list is resolved once; each item is rendered through the mapping's
  // rule, relative to the item, with the list's provenance. An unconfirmed
  // list fills an optional block zero times and asks for nothing — a student
  // with no prior qualifications has none to add — unless a mapped field on
  // the page is required, in which case it asks, as any required field does.
  const repeats: RepeatedPage[] = [];
  const itemHidden: HiddenField[] = [];
  for (const page of blueprint.pages) {
    if (page.repeats === undefined) continue;
    const fields = page.sections.flatMap((section) => section.fields);
    // `checkUsable` held that this names a list-valued ordinary field.
    const fieldKey = page.repeats.fieldKey as OrdinaryFieldKey;
    const resolution = resolveField(profile, fieldKey);

    for (const field of fields) {
      if (mappingFor(mappingSet, field.fieldRef) === undefined && isRequired(field)) {
        blockers.push({
          kind: "no_mapping",
          fieldRef: field.fieldRef,
          label: field.label,
          detail:
            `Required field "${field.label}" has no mapping. A specialist decides what belongs ` +
            `here — it is not something to work out while a form is open.`,
        });
      }
    }

    if (isFieldUnavailable(resolution)) {
      for (const field of fields) {
        if (mappingFor(mappingSet, field.fieldRef)?.source.kind !== "profile_field" || !isRequired(field)) continue;
        blockers.push({
          kind: "value_unavailable",
          fieldRef: field.fieldRef,
          label: field.label,
          fieldKey,
          reason: resolution.reason,
        });
      }
      repeats.push({ pageRef: page.pageRef, title: page.title, fieldKey, count: 0 });
      continue;
    }

    const list = unwrapConfirmed(resolution);
    const count = Array.isArray(list) ? list.length : 0;
    const governedOnPage = conditionsOf({ ...blueprint, pages: [page] }).filter((entry) => entry.conditions.length > 0);
    for (let index = 0; index < count; index++) {
      const item = { index, count };
      const itemInstructions: FillInstruction[] = [];
      const itemHandoffs: HandoffRequirement[] = [];
      const itemBlockers: FillBlocker[] = [];
      for (const field of fields) {
        const mapping = mappingFor(mappingSet, field.fieldRef);
        if (mapping === undefined) continue;
        if (mapping.source.kind === "constant") {
          itemInstructions.push({
            ...instructionShape(field),
            value: { kind: "reviewed_constant", constant: reviewedConstant(mappingSet, mapping.source) },
            item,
          });
          continue;
        }
        if (mapping.source.kind === "student_handoff") {
          // ADR-0104 (B): the student's own act, once per entry, said under it.
          itemHandoffs.push({
            fieldRef: field.fieldRef,
            label: field.label,
            reason: mapping.source.reason,
            inputType: field.inputType,
            item,
          });
          continue;
        }
        if (mapping.source.kind !== "profile_field") continue; // refused by checkUsable
        const rendered = renderConfirmedItem(resolution, index, mapping.source.format);
        if (!rendered.rendered) {
          itemBlockers.push({
            kind: "render_refused",
            fieldRef: field.fieldRef,
            label: field.label,
            fieldKey,
            refusal: rendered.refusal,
          });
          continue;
        }
        itemInstructions.push({
          ...instructionShape(field),
          value: { kind: "confirmed", value: rendered.value, fieldKey },
          item,
        });
      }
      // ADR-0104: a condition inside a repeat is answered PER ITEM, against
      // this item's own values — shown for the qualification it applies to,
      // hidden for the other, and recorded as hidden for that entry.
      const hiddenHere = hiddenAmong(
        governedOnPage,
        new Map(itemInstructions.map((instruction) => [instruction.fieldRef, textOf(instruction.value)])),
      );
      const shownHere = (fieldRef: string): boolean => !hiddenHere.has(fieldRef);
      instructions.push(...itemInstructions.filter((instruction) => shownHere(instruction.fieldRef)));
      handoffs.push(...itemHandoffs.filter((handoff) => shownHere(handoff.fieldRef)));
      blockers.push(...itemBlockers.filter((blocker) => shownHere(blocker.fieldRef)));
      for (const hiddenField of hiddenHere.values()) itemHidden.push({ ...hiddenField, item });
    }
    repeats.push({ pageRef: page.pageRef, title: page.title, fieldKey, count });
  }

  // ── P90: what the form hides for these answers ─────────────────────────
  //
  // A condition is evaluated against the plan's own values — the text this
  // plan will put in the controlling field. A field the form does not show
  // is neither filled nor missing: its instruction, its blockers and its
  // upload are dropped and it is listed under `hidden`, so the preview and
  // the fill see what the student would. A field whose controller is itself
  // hidden is hidden too, which is why this runs to a fixed point.
  // The fields of a repeating page were answered per item above and are not
  // evaluated again here, where one text per field reference would be wrong.
  const hidden = hiddenFields(blueprint, instructions, repeated);
  const shown = (fieldRef: string): boolean => repeated.has(fieldRef) || !hidden.has(fieldRef);

  return {
    blueprintId: String(blueprint.blueprintId),
    blueprintVersion: blueprint.version,
    mappingSetId: mappingSet.mappingSetId,
    instructions: instructions.filter((instruction) => shown(instruction.fieldRef)),
    uploads: uploads.filter((upload) => shown(upload.fieldRef)),
    handoffs,
    credentials,
    blockers: blockers.filter((blocker) => shown(blocker.fieldRef)),
    hidden: [...hidden.values(), ...itemHidden],
    repeats,
  };
}

/** Every field with the conditions that govern it: its own, and its section's. */
function conditionsOf(
  blueprint: ApplicationBlueprint,
): readonly { readonly field: BlueprintField; readonly conditions: readonly FieldCondition[] }[] {
  return blueprint.pages.flatMap((page) =>
    page.sections.flatMap((section) =>
      section.fields.map((field) => ({
        field,
        conditions: [section.visibleWhen, field.visibleWhen].filter(
          (condition): condition is FieldCondition => condition !== undefined,
        ),
      })),
    ),
  );
}

/** Whether a condition holds, given the text the plan puts in its controlling field. */
function holds(condition: FieldCondition, text: string | undefined): boolean {
  switch (condition.operator) {
    case "equals":
      return text !== undefined && text === condition.value;
    case "not_equals":
      return text !== condition.value;
    case "is_checked":
      return text === "true";
    case "is_not_empty":
      return text !== undefined && text.trim().length > 0;
    case "in":
      return text !== undefined && (condition.values ?? []).includes(text);
  }
}

function hiddenFields(
  blueprint: ApplicationBlueprint,
  instructions: readonly FillInstruction[],
  except: ReadonlySet<string>,
): Map<string, HiddenField> {
  const texts = new Map(
    instructions.filter((instruction) => !except.has(instruction.fieldRef)).map((instruction) => [instruction.fieldRef, textOf(instruction.value)]),
  );
  const governed = conditionsOf(blueprint).filter(
    (entry) => entry.conditions.length > 0 && !except.has(entry.field.fieldRef),
  );
  return hiddenAmong(governed, texts);
}

/** The fixed point of "hidden": a field whose condition fails, or whose controlling field is itself hidden. */
function hiddenAmong(
  governed: readonly { readonly field: BlueprintField; readonly conditions: readonly FieldCondition[] }[],
  texts: ReadonlyMap<string, string>,
): Map<string, HiddenField> {
  const hidden = new Map<string, HiddenField>();
  for (let changed = true; changed; ) {
    changed = false;
    for (const { field, conditions } of governed) {
      if (hidden.has(field.fieldRef)) continue;
      const failing = conditions.find(
        (condition) => hidden.has(condition.whenFieldRef) || !holds(condition, texts.get(condition.whenFieldRef)),
      );
      if (failing === undefined) continue;
      hidden.set(field.fieldRef, { fieldRef: field.fieldRef, label: field.label, whenFieldRef: failing.whenFieldRef });
      changed = true;
    }
  }
  return hidden;
}

function instructionShape(
  field: BlueprintField,
): Pick<FillInstruction, "fieldRef" | "label" | "inputType" | "locators" | "optionsAfter" | "typeahead"> {
  return {
    fieldRef: field.fieldRef,
    label: field.label,
    inputType: field.inputType,
    locators: field.locators,
    ...(field.optionsAfter === undefined ? {} : { optionsAfter: { fieldRef: field.optionsAfter.fieldRef } }),
    ...(field.typeahead === undefined
      ? {}
      : { typeahead: { optionLocator: { strategy: field.typeahead.optionLocator.strategy, value: field.typeahead.optionLocator.value } } }),
  };
}

/** Whether the plan can proceed to a fill. */
export function isComplete(plan: FillPlan): boolean {
  return plan.blockers.length === 0;
}

/** The canonical fields the interview should go and ask about. */
export function fieldsToCollect(plan: FillPlan): readonly OrdinaryFieldKey[] {
  const keys = plan.blockers
    .filter(
      (blocker): blocker is Extract<FillBlocker, { kind: "value_unavailable" }> =>
        blocker.kind === "value_unavailable",
    )
    .map((blocker) => blocker.fieldKey);
  return [...new Set(keys)];
}
