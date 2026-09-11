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

import type { FlowSignal } from "./observe-script.js";
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
    case "password":
      // P91: the one type the schema names so a blueprint can be HONEST about
      // a credential field (see `FieldInputType`), and the switch had no case
      // for it — Sheffield's entry page came back with three "unknown"s.
      return "password";
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
  // P88: radio inputs sharing a name are ONE question. The first real form's
  // draft carried one field per input, none with the value it would submit,
  // and the curation had to merge them by hand. Grouped here, in the first
  // input's place, each option carrying the value observed — "on" when the
  // markup declares none, which is what the browser submits.
  const groups = new Map<string, { field: Record<string, unknown>; required: boolean }>();
  const fields: BlueprintField[] = [];
  form.fields.forEach((field, index) => {
    if (field.type === "radio" && field.name !== undefined) {
      const value = field.value ?? "on";
      const option = { value, label: field.label ?? value };
      const group = groups.get(field.name);
      if (group !== undefined) {
        (group.field["options"] as { value: string; label: string }[]).push(option);
        group.required = group.required || field.required;
        group.field["validations"] = validationsOf({ ...field, required: group.required });
        return;
      }
      const grouped: Record<string, unknown> = {
        fieldRef: field.name,
        label: field.name,
        inputType: "radio",
        locators: [{ strategy: "name", value: field.name }],
        validations: validationsOf({ ...field, required: field.required }),
        options: [option],
      };
      groups.set(field.name, { field: grouped, required: field.required });
      fields.push(grouped as unknown as BlueprintField);
      return;
    }
    fields.push(fieldFrom(field, index, form, pageRef));
  });

  return {
    sectionRef: `${pageRef}.form${String(form.formIndex)}`,
    title: `Form ${String(form.formIndex + 1)}`,
    fields,
  };
}

function fieldFrom(field: ObservedField, index: number, form: ObservedForm, pageRef: string): BlueprintField {
  {
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
  }
}

/** Converts one page observation into a blueprint page. */
export function pageFrom(observation: PageObservation, pageRef: string): BlueprintPage {
  const sections = observation.forms.map((form) => sectionFrom(form, pageRef));

  // File inputs are the portal asking for a document.
  const requiredDocuments = sections.flatMap((section) =>
    section.fields
      .filter((field) => field.inputType === "file")
      .map((field) => ({
        fieldRef: field.fieldRef,
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
  // P88: never a locator with nothing to find it by, and an id over a label
  // — the first real form's draft had a blank label on five pages.
  const candidates = observation.candidateAdvanceControls.filter((c) => c.value.trim().length > 0);
  const advance = candidates.find((c) => c.strategy === "id") ?? candidates[0];
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

  const signals = input.observations.flatMap((observation) =>
    observation.signals.map((signal) => ({ ...signal, url: observation.url })),
  );
  const has = (kind: FlowSignal["kind"]): boolean => signals.some((signal) => signal.kind === kind);

  const blueprint: Record<string, unknown> = {
    blueprintId: input.blueprintId,
    version: "0.1.0",
    status: "draft",
    institutionName: input.institutionName,
    courseName: input.courseName,
    intake: input.intake,
    route: input.route,
    authentication: {
      // Evidenced where the pages evidence it, and falling back to what the
      // caller stated only where they do not. A password field is a stronger
      // claim about authentication than anything a target file can assert.
      required: has("login") || has("account_creation") || input.authenticationRequired,
      accountCreationRequired: has("account_creation") || input.authenticationRequired,
      notes: describeAuthentication(signals, input.authenticationNotes),
      ...(input.loginUrl !== undefined ? { loginUrl: input.loginUrl } : {}),
    },
    pages,
    // Handoff points the pages themselves EVIDENCE.
    //
    // Discovery still cannot observe a handoff by going through it — that is
    // exactly what it must not do. But a reCAPTCHA script tag, a
    // one-time-code input and a "verify your email" line are things the page
    // shows without being touched, and recording them is the difference
    // between a specialist reviewing evidence and a specialist guessing.
    //
    // Still a DRAFT. The specialist decides which are real.
    handoffPoints: handoffPointsFrom(input.observations),
    provenance: {
      discoveryRunId: input.discoveryRunId,
      discoveredAt: input.discoveredAt,
      observedUrls: input.observations.map((observation) => observation.url),
      unobservedClaims: input.unobservedClaims,
    },
    // Not part of the blueprint schema — carried alongside it so a reviewer
    // sees the raw evidence next to the reading taken from it.
    observedSignals: signals,
  };
  if (input.campus !== undefined) blueprint["campus"] = input.campus;
  if (input.platform !== undefined) blueprint["platform"] = input.platform;

  return blueprint as unknown as ApplicationBlueprint;
}


/**
 * Turns evidenced signals into draft handoff points.
 *
 * Each is a point where brief §7 says only the student may act. Recorded from
 * what a page SHOWS, never from going through it — and marked draft, because
 * deciding a reCAPTCHA badge on the landing page means the application form
 * has a CAPTCHA is an inference, and inferences belong to the reviewer.
 */
export function handoffPointsFrom(
  observations: readonly PageObservation[],
): readonly {
  readonly pageRef: string;
  readonly kind: "captcha" | "mfa" | "otp" | "payment" | "identity_verification" | "final_submission" | "legal_declaration";
  readonly description: string;
}[] {
  const points: {
    pageRef: string;
    kind: "captcha" | "mfa" | "otp" | "payment" | "identity_verification" | "final_submission" | "legal_declaration";
    description: string;
  }[] = [];

  for (const [index, observation] of observations.entries()) {
    const pageRef = `page-${String(index + 1)}`;
    for (const signal of observation.signals) {
      const mapped = HANDOFF_KINDS[signal.kind];
      if (mapped === undefined) continue;
      if (points.some((point) => point.pageRef === pageRef && point.kind === mapped)) continue;
      points.push({
        pageRef,
        kind: mapped,
        // The evidence travels with it, so review is checking rather than
        // trusting.
        description: `Observed: ${signal.evidence}`,
      });
    }
  }

  return points;
}

const HANDOFF_KINDS: Readonly<
  Partial<Record<FlowSignal["kind"], "captcha" | "mfa" | "otp" | "payment" | "final_submission">>
> = {
  captcha: "captcha",
  mfa_or_otp: "mfa",
  payment: "payment",
  submission: "final_submission",
};

/**
 * Describes what the pages showed about authentication.
 *
 * Prose for a human, assembled from evidence rather than asserted. The
 * caller's own note is kept, because "we could not test the login" is itself
 * worth recording.
 */
function describeAuthentication(
  signals: readonly (FlowSignal & { readonly url: string })[],
  callerNotes: string,
): string {
  const lines: string[] = [];
  const kinds: readonly FlowSignal["kind"][] = [
    "login",
    "account_creation",
    "email_verification",
    "mfa_or_otp",
    "captcha",
  ];

  for (const kind of kinds) {
    const matching = signals.filter((signal) => signal.kind === kind);
    if (matching.length === 0) continue;
    lines.push(
      `${kind}: ${String(matching.length)} signal(s) — e.g. ${matching[0]?.evidence ?? ""} ` +
        `(${matching[0]?.url ?? ""})`,
    );
  }

  if (lines.length === 0) {
    lines.push("No authentication signals were observed on the pages visited.");
  }

  return `${lines.join("\n")}\n\nReviewer's note from the run: ${callerNotes}`;
}
