/**
 * Validating a fill plan against the portal's own rules.
 *
 * Every rule applied here was **observed on the portal** and recorded in the
 * blueprint — a `required` attribute, a `maxlength`, a `pattern`, an error the
 * portal itself produced, or something a specialist noted during review. There
 * is no `inferred_by_model` provenance for a validation rule, by design: a rule
 * the AI guessed at is not a rule, and enforcing one would mean blocking a
 * student over a constraint the university does not have.
 *
 * ── Why validate before the browser, when the portal will validate anyway ──
 *
 * Because of what failing late costs. A portal that rejects a 4,200-character
 * personal statement on page four does so after an account exists, a draft
 * exists, and a partly-completed application is sitting in a real admissions
 * system. Catching it here costs nothing and the student is asked one more
 * question in a conversation they are already having.
 *
 * This does not replace the portal's own validation, and is not trusted over
 * it. If the portal rejects something this passed, that is blueprint drift and
 * is logged as such (brief §3.2).
 */

import type { ApplicationBlueprint, BlueprintField, FieldValidation } from "@askimate/aas-blueprint";
import { allFields } from "@askimate/aas-blueprint";
import type { FillPlan } from "@askimate/aas-mapping";
import { textOf } from "@askimate/aas-mapping";

/** One rule this plan does not satisfy. */
export interface Violation {
  readonly fieldRef: string;
  readonly label: string;
  readonly rule: FieldValidation;
  /** What is wrong, in terms a specialist or the student can act on. */
  readonly detail: string;
  /**
   * The rule's provenance, carried through.
   *
   * A violation of a `dom_attribute` rule is a fact about the portal. One of a
   * `specialist_noted` rule is a human's recollection of the portal. Worth
   * being able to tell apart when a violation looks wrong.
   */
  readonly source: FieldValidation["source"];
}

export interface ValidationResult {
  readonly violations: readonly Violation[];
  /** Fields the plan fills that the blueprint says are not on the page. */
  readonly unknownFields: readonly string[];
}

export function isValid(result: ValidationResult): boolean {
  return result.violations.length === 0 && result.unknownFields.length === 0;
}

/**
 * Checks the plan against the blueprint.
 *
 * Note what is NOT checked: whether the values are *true*. That is not a
 * question a validator can answer, and the system's answer to it is elsewhere
 * entirely — every value came from a student's confirmation or a grounded
 * document reading.
 */
export function validatePlan(
  blueprint: ApplicationBlueprint,
  plan: FillPlan,
): ValidationResult {
  const violations: Violation[] = [];
  const unknownFields: string[] = [];

  const fields = new Map(allFields(blueprint).map((field) => [field.fieldRef, field]));
  const filled = new Map(plan.instructions.map((i) => [i.fieldRef, textOf(i.value)]));
  const uploaded = new Set(plan.uploads.map((upload) => upload.fieldRef));
  const handedOff = new Set(plan.handoffs.map((handoff) => handoff.fieldRef));

  for (const fieldRef of filled.keys()) {
    if (!fields.has(fieldRef)) unknownFields.push(fieldRef);
  }

  for (const field of fields.values()) {
    const value = filled.get(fieldRef(field));

    for (const rule of field.validations) {
      const violation = checkRule(field, rule, value, {
        uploaded: uploaded.has(field.fieldRef),
        handedOff: handedOff.has(field.fieldRef),
      });
      if (violation !== null) violations.push(violation);
    }
  }

  return { violations, unknownFields };
}

function fieldRef(field: BlueprintField): string {
  return field.fieldRef;
}

interface FieldContext {
  readonly uploaded: boolean;
  readonly handedOff: boolean;
}

function checkRule(
  field: BlueprintField,
  rule: FieldValidation,
  value: string | undefined,
  context: FieldContext,
): Violation | null {
  const violation = (detail: string): Violation => ({
    fieldRef: field.fieldRef,
    label: field.label,
    rule,
    detail,
    source: rule.source,
  });

  switch (rule.kind) {
    case "required": {
      // A field satisfied by an upload or reserved for the student is not
      // empty — it is filled by something other than typing. Reporting those
      // as violations would bury the real ones.
      if (context.uploaded || context.handedOff) return null;
      if (value !== undefined && value.trim().length > 0) return null;
      return violation(`"${field.label}" is required and the plan has nothing for it.`);
    }

    case "maxlength": {
      const limit = numeric(rule.value);
      if (value === undefined || limit === null || value.length <= limit) return null;
      return violation(
        `"${field.label}" is ${String(value.length)} characters; the portal allows ` +
          `${String(limit)}. The student should be asked to shorten it — it must not be truncated ` +
          `on their behalf.`,
      );
    }

    case "minlength": {
      const limit = numeric(rule.value);
      if (value === undefined || limit === null || value.length >= limit) return null;
      return violation(
        `"${field.label}" is ${String(value.length)} characters; the portal requires at least ` +
          `${String(limit)}.`,
      );
    }

    case "pattern": {
      if (value === undefined || rule.value === undefined) return null;
      let expression: RegExp;
      try {
        expression = new RegExp(`^(?:${rule.value})$`);
      } catch {
        // A pattern the blueprint recorded but this engine cannot compile. Say
        // so rather than silently passing the field.
        return violation(
          `"${field.label}" has a recorded pattern that could not be compiled: ${rule.value}`,
        );
      }
      return expression.test(value)
        ? null
        : violation(
            `"${field.label}" is "${value}", which does not match the format the portal enforces ` +
              `(${rule.value}).`,
          );
    }

    case "min":
    case "max": {
      const bound = numeric(rule.value);
      if (value === undefined || bound === null) return null;
      const asNumber = Number(value);
      if (Number.isNaN(asNumber)) {
        return violation(`"${field.label}" is "${value}", which the portal expects to be a number.`);
      }
      if (rule.kind === "min" && asNumber < bound) {
        return violation(`"${field.label}" is below the portal's minimum of ${String(bound)}.`);
      }
      if (rule.kind === "max" && asNumber > bound) {
        return violation(`"${field.label}" is above the portal's maximum of ${String(bound)}.`);
      }
      return null;
    }

    case "accept":
      // File-type acceptance is checked against the actual document at upload
      // time, where the file exists. Nothing useful to check here.
      return null;
  }
}

function numeric(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}
