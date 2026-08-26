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

import type { ApplicationBlueprint, BlueprintField, FieldInputType, FieldLocator } from "@askimate/aas-blueprint";
import { allFields } from "@askimate/aas-blueprint";
import type { ConfirmedValue, UnavailableReason } from "@askimate/aas-domain";
import { isFieldUnavailable, unwrapConfirmed } from "@askimate/aas-domain";
import type { ConfirmedProfile, ProfileFieldKey, RenderRefusal } from "@askimate/aas-profile";
import { renderConfirmed, resolveField } from "@askimate/aas-profile";

import type { ReviewedConstant, UsableMappingSet } from "./mapping.js";
import { constantText, isRequired, mappingFor, reviewedConstant } from "./mapping.js";

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
  | { readonly kind: "reviewed_constant"; readonly constant: ReviewedConstant };

/** One thing to type into one field. */
export interface FillInstruction {
  readonly fieldRef: string;
  readonly label: string;
  readonly inputType: FieldInputType;
  readonly locators: readonly FieldLocator[];
  readonly value: FillValue;
}

/** The text a fill instruction will type, whichever kind it is. */
export function textOf(value: FillValue): string {
  return value.kind === "confirmed" ? unwrapConfirmed(value.value) : constantText(value.constant);
}

/** A document to attach. */
export interface UploadInstruction {
  readonly fieldRef: string;
  readonly label: string;
  readonly documentRef: string;
  readonly locators: readonly FieldLocator[];
}

/** A point where the student must act (brief §7). Never automated, never bypassed. */
export interface HandoffRequirement {
  readonly fieldRef: string;
  readonly label: string;
  readonly reason: string;
}

/** Something that stops the plan being complete. */
export type FillBlocker =
  /** A required field nobody mapped. A mapping-set gap, not a student gap. */
  | { readonly kind: "no_mapping"; readonly fieldRef: string; readonly label: string; readonly detail: string }
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
      readonly fieldKey: ProfileFieldKey;
      readonly reason: UnavailableReason;
    }
  /** The value exists and cannot be written in this portal's notation. */
  | {
      readonly kind: "render_refused";
      readonly fieldRef: string;
      readonly label: string;
      readonly fieldKey: ProfileFieldKey;
      readonly refusal: RenderRefusal;
    };

export interface FillPlan {
  readonly blueprintId: string;
  readonly blueprintVersion: string;
  readonly mappingSetId: string;
  readonly instructions: readonly FillInstruction[];
  readonly uploads: readonly UploadInstruction[];
  readonly handoffs: readonly HandoffRequirement[];
  readonly blockers: readonly FillBlocker[];
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
  const blockers: FillBlocker[] = [];

  for (const field of allFields(blueprint)) {
    const mapping = mappingFor(mappingSet, field.fieldRef);

    if (mapping === undefined) {
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
      case "student_handoff":
        handoffs.push({
          fieldRef: field.fieldRef,
          label: field.label,
          reason: mapping.source.reason,
        });
        break;

      case "document":
        uploads.push({
          fieldRef: field.fieldRef,
          label: field.label,
          documentRef: mapping.source.documentRef,
          locators: field.locators,
        });
        break;

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

  return {
    blueprintId: String(blueprint.blueprintId),
    blueprintVersion: blueprint.version,
    mappingSetId: mappingSet.mappingSetId,
    instructions,
    uploads,
    handoffs,
    blockers,
  };
}

function instructionShape(
  field: BlueprintField,
): Pick<FillInstruction, "fieldRef" | "label" | "inputType" | "locators"> {
  return {
    fieldRef: field.fieldRef,
    label: field.label,
    inputType: field.inputType,
    locators: field.locators,
  };
}

/** Whether the plan can proceed to a fill. */
export function isComplete(plan: FillPlan): boolean {
  return plan.blockers.length === 0;
}

/** The canonical fields the interview should go and ask about. */
export function fieldsToCollect(plan: FillPlan): readonly ProfileFieldKey[] {
  const keys = plan.blockers
    .filter(
      (blocker): blocker is Extract<FillBlocker, { kind: "value_unavailable" }> =>
        blocker.kind === "value_unavailable",
    )
    .map((blocker) => blocker.fieldKey);
  return [...new Set(keys)];
}
