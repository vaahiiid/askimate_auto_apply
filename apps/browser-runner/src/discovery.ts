/**
 * Discovery: turning observations into a draft Application Blueprint.
 *
 * Deliberately conservative. Discovery records WHAT IT SAW and marks everything
 * it could not see. It does not infer field mappings, does not guess at
 * conditional logic it did not observe, and does not fill gaps with plausible
 * content — a blueprint that invented half its own structure is worse than an
 * obviously incomplete one, because it looks finished.
 *
 * Output is always `status: "draft"`. A specialist reviews it against the real
 * portal before it can drive anything (see `checkExecutable`).
 */

import type {
  ApplicationBlueprint,
  ApplicationRoute,
  BlueprintField,
  BlueprintPage,
  BlueprintSection,
  FieldInputType,
  FieldValidation,
} from "@askimate/aas-blueprint";

import type { ObservedField, ObservedForm, PageObservation } from "./session.js";

/** Maps an observed DOM element to a blueprint input type. */
export function inputTypeOf(field: ObservedField): FieldInputType {
  if (field.tagName === "textarea") return "textarea";
  if (field.tagName === "select") return field.options !== undefined ? "select" : "unknown";

  switch (field.type) {
    case "email":
      return "email";
    case "tel":
      return "tel";
    case "number":
      return "number";
    case "date":
      return "date";
    case "file":
      return "file";
    case "radio":
      return "radio";
    case "checkbox":
      return "checkbox";
    case "text":
    case undefined:
      return "text";
    default:
      // An unrecognised type is recorded as unknown rather than guessed at.
      // "unknown" is a finding a specialist can act on; a wrong guess is not.
      return "unknown";
  }
}

/** Extracts the validations the portal actually declares. */
export function validationsOf(field: ObservedField): readonly FieldValidation[] {
  const validations: FieldValidation[] = [];
  if (field.required) validations.push({ kind: "required", source: "dom_attribute" });
  if (field.maxLength !== undefined) {
    validations.push({ kind: "maxlength", value: String(field.maxLength), source: "dom_attribute" });
  }
  if (field.pattern !== undefined) {
    validations.push({ kind: "pattern", value: field.pattern, source: "dom_attribute" });
  }
  if (field.accept !== undefined) {
    validations.push({ kind: "accept", value: field.accept, source: "dom_attribute" });
  }
  return validations;
}

/** Locators for a field, most stable first. */
export function locatorsOf(field: ObservedField): BlueprintField["locators"] {
  const locators: BlueprintField["locators"] = [];
  const built: { strategy: "label" | "name" | "id" | "placeholder"; value: string }[] = [];

  // Label first: a portal redesign changes CSS and IDs long before it changes
  // what it asks the student.
  if (field.label !== undefined && field.label.length > 0) built.push({ strategy: "label", value: field.label });
  if (field.name !== undefined) built.push({ strategy: "name", value: field.name });
  if (field.id !== undefined) built.push({ strategy: "id", value: field.id });
  if (field.placeholder !== undefined) built.push({ strategy: "placeholder", value: field.placeholder });

  return [...locators, ...built];
}

/** Converts one observed form into a blueprint section. */
export function sectionFrom(form: ObservedForm, pageRef: string): BlueprintSection {
  const fields: BlueprintField[] = form.fields.map((field, index) => {
    const fieldRef = field.name ?? field.id ?? `${pageRef}.form${String(form.formIndex)}.field${String(index)}`;
    const blueprintField: Record<string, unknown> = {
      fieldRef,
      label: field.label ?? field.placeholder ?? fieldRef,
      inputType: inputTypeOf(field),
      locators: locatorsOf(field),
      validations: validationsOf(field),
      // NOTE: `mapsTo` is deliberately absent. Mapping a portal field to a
      // canonical profile field is a reviewed decision (Phase 4), not something
      // discovery guesses — that would put the AI back in charge of deciding
      // what goes into a form field.
    };
    if (field.options !== undefined) blueprintField["options"] = field.options;
    return blueprintField as unknown as BlueprintField;
  });

  return {
    sectionRef: `${pageRef}.form${String(form.formIndex)}`,
    title: `Form ${String(form.formIndex + 1)}`,
    fields,
  };
}

/** Converts one page observation into a blueprint page. */
export function pageFrom(observation: PageObservation, pageRef: string): BlueprintPage {
  const sections = observation.forms.map((form) => sectionFrom(form, pageRef));

  // File inputs are the portal asking for a document.
  const requiredDocuments = sections.flatMap((section) =>
    section.fields
      .filter((field) => field.inputType === "file")
      .map((field) => ({
        documentRef: field.fieldRef,
        label: field.label,
        acceptedFormats:
          field.validations
            .find((validation) => validation.kind === "accept")
            ?.value?.split(",")
            .map((format) => format.trim()) ?? [],
        required: field.validations.some((validation) => validation.kind === "required"),
      })),
  );

  const page: Record<string, unknown> = {
    pageRef,
    title: observation.title,
    url: observation.url,
    sections,
    requiredDocuments,
  };
  const advance = observation.candidateAdvanceControls[0];
  if (advance !== undefined) page["advanceControl"] = advance;

  return page as unknown as BlueprintPage;
}

/**
 * Assembles a DRAFT blueprint from what was observed.
 *
 * Always `status: "draft"`. Discovery produces a reading; a human turns a
 * reading into something executable.
 */
export function draftBlueprintFrom(input: {
  readonly blueprintId: string;
  readonly institutionName: string;
  readonly campus?: string;
  readonly courseName: string;
  readonly intake: string;
  readonly route: ApplicationRoute;
  readonly platform?: string;
  readonly observations: readonly PageObservation[];
  readonly discoveryRunId: string;
  readonly discoveredAt: Date;
  readonly unobservedClaims: readonly string[];
  readonly authenticationNotes: string;
  readonly authenticationRequired: boolean;
  readonly loginUrl?: string;
}): ApplicationBlueprint {
  const pages = input.observations.map((observation, index) =>
    pageFrom(observation, `page${String(index + 1)}`),
  );

  const blueprint: Record<string, unknown> = {
    blueprintId: input.blueprintId,
    version: "0.1.0",
    status: "draft",
    institutionName: input.institutionName,
    courseName: input.courseName,
    intake: input.intake,
    route: input.route,
    authentication: {
      required: input.authenticationRequired,
      accountCreationRequired: input.authenticationRequired,
      notes: input.authenticationNotes,
      ...(input.loginUrl !== undefined ? { loginUrl: input.loginUrl } : {}),
    },
    pages,
    // Empty because discovery cannot observe a handoff without triggering it,
    // and triggering it is exactly what discovery must not do. A specialist
    // adds these during review.
    handoffPoints: [],
    provenance: {
      discoveryRunId: input.discoveryRunId,
      discoveredAt: input.discoveredAt,
      observedUrls: input.observations.map((observation) => observation.url),
      unobservedClaims: input.unobservedClaims,
    },
  };
  if (input.campus !== undefined) blueprint["campus"] = input.campus;
  if (input.platform !== undefined) blueprint["platform"] = input.platform;

  return blueprint as unknown as ApplicationBlueprint;
}
