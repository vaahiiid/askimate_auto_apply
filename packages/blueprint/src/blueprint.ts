/**
 * The Application Blueprint.
 *
 * From the master brief, §3.2:
 *
 *   "The first time the system meets a university portal, it runs in discovery
 *    mode and produces a machine-readable Application Blueprint: pages,
 *    sections, fields, field types, validation rules, conditional logic,
 *    required documents, and submission steps. The blueprint is a versioned,
 *    reviewable data artefact. Execution runs deterministically against the
 *    blueprint. The AI handles only deviations, and any deviation is logged as
 *    a blueprint drift event."
 *
 * This is a DATA artefact, not code. No university's flow is hard-coded into
 * the orchestration engine, which is what makes adding the second university a
 * data exercise rather than a rewrite (brief §3.2, Phase 7).
 *
 * ── A note on premature generalisation ────────────────────────────────────
 *
 * Vahid, 2026-08-26: *"Do not generalise prematurely. First understand this
 * specific application end to end, then identify which parts should become
 * reusable abstractions."*
 *
 * So this schema is deliberately DESCRIPTIVE — it records what a portal
 * actually does — rather than prescriptive about what portals in general look
 * like. Where the first real discovery finds something this schema cannot
 * express, the schema is what changes.
 */

import type { Brand } from "@askimate/aas-domain";

export type BlueprintId = Brand<string, "BlueprintId">;

/** How the application is reached. */
export type ApplicationRoute = "direct_portal" | "partner_portal" | "assisted_manual";

/**
 * A blueprint's confidence in itself.
 *
 * A blueprint produced by discovery is a *reading* of a portal, and readings
 * can be wrong. Execution against an unreviewed blueprint is how a wrong
 * reading becomes a wrong application.
 */
export type BlueprintStatus =
  /** Discovery ran but a human has not looked at it. NOT executable. */
  | "draft"
  /** A specialist reviewed it against the real portal. Executable. */
  | "reviewed"
  /** Superseded by a newer version. */
  | "superseded"
  /** Known to be wrong. Kept for the record, never executed. */
  | "retired";

/**
 * What kind of input a field takes.
 *
 * ── `password` is here so a blueprint can be HONEST ───────────────────────
 *
 * It was absent until a blueprint had to describe a portal whose form is gated
 * behind registration. Leaving it out did not stop a password field existing on
 * a real page — it only stopped the blueprint saying so, which made the
 * document quietly wrong about the one field that matters most.
 *
 * Naming it also makes a rule checkable that was previously only a convention:
 * `scripts/check-boundaries.ts` fails the build if a MAPPING SET targets a
 * field of this type. A password is not profile data, never becomes a
 * `ConfirmedValue`, and reaches its field through the Secure Plane's fill agent
 * and nothing else (ADR-0026, ADR-0042). Before this member existed there was
 * no way for a check to tell which field a reviewer must never map.
 */
export type FieldInputType =
  | "text"
  | "textarea"
  | "email"
  | "password"
  | "tel"
  | "number"
  | "date"
  | "select"
  | "multiselect"
  | "radio"
  | "checkbox"
  | "file"
  /**
   * A box the applicant types into, which offers entries as they type; one is
   * chosen (ADR-0103, gap 2). Never produced by discovery — a typeahead reads
   * as a text input — the reviewer sets it, with `typeahead.optionLocator`.
   */
  | "typeahead"
  | "unknown";

/**
 * What a field asks for, for the purpose of deciding whether this system may
 * hold an answer to it (ADR-0102).
 *
 *   ordinary          not within UK GDPR Article 9(1).
 *   special_category  within it — health, ethnic origin, religion, and the
 *                     rest of the statute's list. This system holds no answer
 *                     to such a question; the only mapping it accepts is the
 *                     refusal the form itself offers, and with none offered
 *                     the fill stops.
 *
 * SET BY THE REVIEWER, NEVER BY DISCOVERY. A regex reading a label is not a
 * determination, so `draftBlueprintFrom` leaves this absent on every field.
 * And ABSENT IS NOT ORDINARY: a reviewed entry is refused while any field is
 * unclassified (`checkUsable`, `unclassified_fields`), because the state that
 * looks decided is the dangerous one (ADR-0077). Vahid, 2026-09-11: *"If
 * absent means ordinary, one reviewer's omission turns a health question into
 * an ordinary field with nothing to notice."*
 */
export type FieldDataCategory = "ordinary" | "special_category";

/** A validation rule the portal enforces, as observed. */
export interface FieldValidation {
  readonly kind: "required" | "maxlength" | "minlength" | "pattern" | "min" | "max" | "accept";
  readonly value?: string;
  /**
   * Where this came from.
   *
   *   dom_attribute    — read off the element. Reliable.
   *   observed_error   — inferred from an error the portal produced. Reliable.
   *   specialist_noted — a human recorded it during review.
   *
   * No `inferred_by_model` member exists. A validation rule the AI guessed at
   * is not a validation rule.
   */
  readonly source: "dom_attribute" | "observed_error" | "specialist_noted";
}

/** One field on one page. */
export interface BlueprintField {
  /** Stable key within the blueprint. */
  readonly fieldRef: string;
  /** The label the student sees. Used to explain what is being asked. */
  readonly label: string;
  readonly inputType: FieldInputType;
  /** The reviewer's classification. Absent on a draft; refused absent at review (ADR-0102). */
  readonly dataCategory?: FieldDataCategory;
  /**
   * How to find it. Several strategies, most stable first — a portal that
   * changes its DOM often breaks a CSS selector long before it breaks a label.
   */
  readonly locators: readonly FieldLocator[];
  readonly validations: readonly FieldValidation[];
  /** Options for select/radio, as observed. */
  readonly options?: readonly FieldOption[];
  /** Only present when this condition holds. */
  readonly visibleWhen?: FieldCondition;
  /**
   * This field's options are loaded by the portal AFTER `fieldRef` is set
   * (ADR-0103, gap 1) — a grading system's list after the institution, a
   * passport's country after the nationality. Fill order follows the
   * blueprint's field order, so `checkUsable` refuses a dependent field that
   * precedes the one it follows; the runner waits a bounded time for the
   * option it was told to select, and never chooses among what arrives.
   * Recorded by the reviewer from a capture taken with the earlier field set;
   * discovery does not infer it.
   */
  readonly optionsAfter?: { readonly fieldRef: string };
  /**
   * Where a typeahead's entries are found as the applicant types (ADR-0103,
   * gap 2). Required when `inputType` is `typeahead`, refused otherwise. The
   * runner types the mapped text, waits a bounded time for the ONE entry whose
   * text equals it exactly, and chooses that entry; no entry, or more than
   * one, fails with what was offered. Choosing is a fill, not an advance.
   */
  readonly typeahead?: { readonly optionLocator: FieldLocator };
  /**
   * The canonical profile field this maps to.
   *
   * DELIBERATELY OPTIONAL and deliberately not filled in by discovery. Mapping
   * is a separate, reviewed decision (brief §5, Phase 4) — a blueprint that
   * guessed its own mappings would put the AI back in the business of deciding
   * what goes in a form field.
   */
  readonly mapsTo?: string;
}

export interface FieldLocator {
  readonly strategy: "label" | "name" | "id" | "css" | "role" | "placeholder";
  readonly value: string;
}

export interface FieldOption {
  readonly value: string;
  readonly label: string;
}

/** Conditional logic, as observed on the portal. */
export interface FieldCondition {
  readonly whenFieldRef: string;
  readonly operator: "equals" | "not_equals" | "is_checked" | "is_not_empty" | "in";
  readonly value?: string;
  readonly values?: readonly string[];
}

/** A group of fields. */
export interface BlueprintSection {
  readonly sectionRef: string;
  readonly title: string;
  readonly fields: readonly BlueprintField[];
  readonly visibleWhen?: FieldCondition;
}

/**
 * A file input discovery SAW on a page.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ADR-0066. This is an OBSERVATION, not an instruction, and it decides
 * nothing. `pageFrom` builds one from every `<input type="file">` it finds.
 * `required` is whether the portal's own markup said so.
 *
 * ── Why the key is `fieldRef` (ADR-0070) ──────────────────────────────────
 *
 * It was `documentRef` until P35, which is the same name the reviewed mapping
 * uses for a DOMAIN document key — and the two are different layers. This one
 * has only ever held `field.fieldRef`, the name attribute of the file input,
 * so it is a portal identifier and is now named like one. The repository
 * contained BOTH readings of the old name: discovery wrote the portal's field
 * name into it while the fixture wrote "passport" where the input is
 * "passport_upload", and nothing could tell you which was intended.
 *
 * Nothing in the planning path reads it. What turns a file field into an
 * upload is a reviewed MAPPING whose source is `{kind:"document"}` (ADR-0017),
 * and `check-boundaries` keeps it that way. Measured in both directions in
 * "which declaration actually decides": removing this list does not stop the
 * upload being planned, and adding one does not cause an upload to be planned.
 *
 * It is kept because it is the honest record of what the portal asked for, and
 * because a specialist authoring a mapping set needs to see it —
 * `scripts/inspect-discovery.ts` is what prints it.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export interface RequiredDocument {
  /**
   * The portal's own name for the file input. Never a domain document type.
   *
   * Identical in kind to `BlueprintField.fieldRef`, and equal to it for the
   * field this observation came from — `pageFrom` copies it across.
   */
  readonly fieldRef: string;
  readonly label: string;
  /** Accepted file types, as the portal states them. */
  readonly acceptedFormats: readonly string[];
  readonly maxSizeBytes?: number;
  readonly required: boolean;
  readonly requiredWhen?: FieldCondition;
  /**
   * The control the portal expects set beside this slot when a file is placed
   * in it, and the value it must hold (ADR-0103, gap 4).
   *
   * Sheffield, 2026-09-11: every one of seventeen slots has a status radio —
   * *upload now / later / not providing* — and on sixteen the file input's own
   * script ticks *now*; on the seventeenth nothing does. Attaching is two acts.
   * The plan carries the second act with the upload, the runner performs it
   * after the attach and reads it back, and the preview says what was marked.
   * The companion field is never mapped and never a blocker: it follows the
   * document, and with no document mapped it is left as the form has it.
   */
  readonly companion?: { readonly fieldRef: string; readonly whenAttached: string };
}

/** One page in the flow. */
export interface BlueprintPage {
  readonly pageRef: string;
  readonly title: string;
  readonly url?: string;
  readonly sections: readonly BlueprintSection[];
  readonly requiredDocuments: readonly RequiredDocument[];
  /** The control that advances to the next page. */
  readonly advanceControl?: FieldLocator;
  /** Where advancing leads. */
  readonly nextPageRef?: string;
  /**
   * The page is filled once per item of a list-valued profile field
   * (ADR-0103, gap 3) — one qualification, one previous visa. Mappings on it
   * draw from that field and are relative to the item; the plan carries the
   * page's instructions once per item; the walk comes back to the page's URL
   * for each, pressing `addAnother` first when the page has one; the preview
   * lists each entry. `advanceControl` saves ONE item.
   */
  readonly repeats?: { readonly fieldKey: string; readonly addAnother?: FieldLocator };
}

/** A point where only the student can act (brief §7). */
export interface HandoffPoint {
  readonly pageRef: string;
  readonly kind:
    | "identity_verification"
    | "mfa"
    | "otp"
    | "captcha"
    | "payment"
    | "legal_declaration"
    | "final_submission";
  readonly description: string;
}

/**
 * How authentication works on this portal.
 *
 * Note the absence of anything resembling a credential field. Brief §8 forbids
 * storing student portal passwords; authentication happens through session
 * handoff, so a blueprint records only *that* a login exists and where.
 */
export interface AuthenticationModel {
  readonly required: boolean;
  readonly loginUrl?: string;
  /**
   * The login form's three controls, when a reviewer has recorded them.
   *
   * ADR-0101 §3 (P72): the resume path signs in with a password the student
   * types once more, and the Secure Plane's fill agent needs to be told which
   * box is the password. Still no credential field — locators are where a
   * credential GOES, recorded by a person from the page `loginUrl` names.
   * Absent, a run that loses its session cannot resume by this path and says
   * so rather than guessing at a login form with a password in hand.
   */
  readonly login?: LoginForm;
  readonly accountCreationRequired: boolean;
  readonly notes: string;
}

/** The three controls a sign-in needs. One password box: a login asks once. */
export interface LoginForm {
  readonly emailLocator: FieldLocator;
  readonly passwordLocator: FieldLocator;
  readonly submitLocator: FieldLocator;
}

/** The submission step. Recorded, never executed by discovery. */
export interface SubmissionModel {
  readonly pageRef: string;
  readonly submitControl?: FieldLocator;
  /** How a successful submission is recognised. */
  readonly confirmationIndicators: readonly string[];
  /** Where the receipt or reference number appears. */
  readonly receiptLocator?: FieldLocator;
}

/** Where a blueprint's content came from. */
export interface BlueprintProvenance {
  /** The run that produced it. */
  readonly discoveryRunId: string;
  readonly discoveredAt: Date;
  /** URLs actually loaded. Empty means nothing was observed first-hand. */
  readonly observedUrls: readonly string[];
  /** The specialist who reviewed it, once reviewed. */
  readonly reviewedBy?: string;
  readonly reviewedAt?: Date;
  /**
   * Anything recorded WITHOUT first-hand observation.
   *
   * Exists so a blueprint can be honest about the difference between "we saw
   * this" and "we were told this". A blueprint with entries here has not really
   * been discovered.
   */
  readonly unobservedClaims: readonly string[];
}

/** The artefact. */
export interface ApplicationBlueprint {
  readonly blueprintId: BlueprintId;
  /** Semantic version. Bumped on every change. */
  readonly version: string;
  readonly status: BlueprintStatus;

  readonly institutionName: string;
  readonly campus?: string;
  readonly courseName: string;
  readonly intake: string;
  readonly route: ApplicationRoute;
  /** The portal platform, when known — e.g. `salesforce_experience_cloud`. */
  readonly platform?: string;

  readonly authentication: AuthenticationModel;
  readonly pages: readonly BlueprintPage[];
  readonly handoffPoints: readonly HandoffPoint[];
  readonly submission?: SubmissionModel;
  readonly provenance: BlueprintProvenance;
}

/**
 * Whether a blueprint may be executed against.
 *
 * Only a `reviewed` blueprint with at least one observed URL. A draft is a
 * machine's reading of a portal that no human has checked, and a blueprint with
 * no observed URLs was never really discovered — executing either is how a
 * wrong reading becomes a wrong application.
 */
export type ExecutableBlueprint = Brand<ApplicationBlueprint, "ExecutableBlueprint">;

export type ExecutabilityRefusal =
  | { readonly kind: "not_reviewed"; readonly detail: string }
  | { readonly kind: "nothing_observed"; readonly detail: string }
  | { readonly kind: "retired"; readonly detail: string };

export type ExecutabilityCheck =
  | { readonly executable: true; readonly blueprint: ExecutableBlueprint }
  | { readonly executable: false; readonly refusal: ExecutabilityRefusal };

/** The gate between a blueprint and a real application run. */
export function checkExecutable(blueprint: ApplicationBlueprint): ExecutabilityCheck {
  if (blueprint.status === "retired" || blueprint.status === "superseded") {
    return {
      executable: false,
      refusal: {
        kind: "retired",
        detail: `Blueprint ${blueprint.blueprintId} is ${blueprint.status} and must not be executed.`,
      },
    };
  }

  if (blueprint.status !== "reviewed") {
    return {
      executable: false,
      refusal: {
        kind: "not_reviewed",
        detail:
          `Blueprint ${blueprint.blueprintId} is a draft. A specialist must review it against the ` +
          `real portal before it can drive an application.`,
      },
    };
  }

  if (blueprint.provenance.observedUrls.length === 0) {
    return {
      executable: false,
      refusal: {
        kind: "nothing_observed",
        detail:
          `Blueprint ${blueprint.blueprintId} records no observed URLs. It was assembled without ` +
          `first-hand observation of the portal and must not drive an application.`,
      },
    };
  }

  return { executable: true, blueprint: blueprint as ExecutableBlueprint };
}

/** Every field across every page, flattened. */
export function allFields(blueprint: ApplicationBlueprint): readonly BlueprintField[] {
  return blueprint.pages.flatMap((page) => page.sections.flatMap((section) => section.fields));
}

/** Fields with no canonical mapping yet. Drives the Phase 4 mapping work. */
export function unmappedFields(blueprint: ApplicationBlueprint): readonly BlueprintField[] {
  return allFields(blueprint).filter((field) => field.mapsTo === undefined);
}

/** Every document the portal asks for. */
export function allRequiredDocuments(blueprint: ApplicationBlueprint): readonly RequiredDocument[] {
  return blueprint.pages.flatMap((page) => page.requiredDocuments);
}

/** Fields the reviewer has not classified. A reviewed entry with any is refused (ADR-0102). */
export function unclassifiedFields(blueprint: ApplicationBlueprint): readonly BlueprintField[] {
  return allFields(blueprint).filter((field) => field.dataCategory === undefined);
}

/** Fields that ask what this system cannot hold (ADR-0102). */
export function specialCategoryFields(blueprint: ApplicationBlueprint): readonly BlueprintField[] {
  return allFields(blueprint).filter((field) => field.dataCategory === "special_category");
}
