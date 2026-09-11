/**
 * The preview: exactly what will be submitted, and its hash.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * From the master brief, §7: the student authorises the exact content before
 * submission, and the authorisation is tied to a hash of what they were shown.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Rendered deterministically, never by a model ──────────────────────────
 *
 * The same rule as the interview's confirmation playback, and for the same
 * reason. If a model wrote the preview, the student would be approving a
 * model's summary of an application rather than the application. Every line
 * here is derived mechanically from the fill plan.
 *
 * ── What the hash covers ──────────────────────────────────────────────────
 *
 * A canonical serialisation of the CONTENT: which blueprint and mapping set,
 * every field's value, every attached document's own content hash, and which
 * fields are the student's to complete. Not the rendered prose — so improving
 * the wording of this file does not void every outstanding authorisation,
 * while changing a single character of a single answer does.
 *
 * Documents are included by their content hash rather than their name, because
 * "passport.pdf" replaced with a different passport is a change to what is
 * being submitted, and a name-based hash would not notice.
 */

import { createHash } from "node:crypto";

import type { ApplicationBlueprint } from "@askimate/aas-blueprint";
import { allFields } from "@askimate/aas-blueprint";
import { provenanceOf } from "@askimate/aas-domain";
import type { ConfirmationProvenance } from "@askimate/aas-domain";
import type { CredentialPurpose, FillPlan } from "@askimate/aas-mapping";
import {
  constantAttribution,
  constantText,
  formRefusalAttribution,
  formRefusalText,
} from "@askimate/aas-mapping";
import type { ProfileFieldKey } from "@askimate/aas-profile";

/** A document as it will be attached. */
export interface PreviewDocument {
  readonly documentId: string;
  /**
   * How the student will see it named in the preview.
   *
   * Was `filename` until P64. The vault records no filename — the page never
   * sends one, and a name the student typed is free text this system has no
   * use for — so what is shown is the document TYPE the reviewed mapping
   * named ("passport"), which is also what they were told they were sending.
   */
  readonly describedAs: string;
  /** SHA-256 of the bytes. What makes "the same passport" checkable. */
  readonly contentHash: string;
}

/** One line of the preview. */
export interface PreviewEntry {
  readonly fieldRef: string;
  readonly label: string;
  /** Exactly what will be submitted. What the hash covers. */
  readonly text: string;
  /**
   * The same value in words the student recognises, when they differ.
   *
   * A nationality dropdown submits `IR`. Asking someone to approve
   * "Nationality: IR" is asking them to approve a string they cannot check —
   * they will say yes, and the confirmation will have done nothing. The
   * preview shows both: what it means, and what is actually sent.
   *
   * Absent when the two are the same, which is most fields.
   */
  readonly displayText?: string;
  readonly attribution:
    | {
        readonly kind: "student_confirmed";
        readonly fieldKey: ProfileFieldKey;
        readonly provenance: ConfirmationProvenance;
      }
    | {
        readonly kind: "reviewed_constant";
        readonly rationale: string;
        readonly reviewedBy: string;
      };
}

export interface PreviewAttachment {
  readonly fieldRef: string;
  readonly label: string;
  readonly documentRef: string;
  readonly document: PreviewDocument;
}

export interface PreviewHandoff {
  readonly fieldRef: string;
  readonly label: string;
  readonly reason: string;
}

/**
 * A question this system did not answer, and what it entered instead (ADR-0102).
 *
 * Its own list, deliberately not an entry: an entry is an answer the student
 * gave or metadata a reviewer set, and a refusal is neither. Vahid, 2026-09-11:
 * *"Those are not the student's answer and we must never present them as one."*
 * `renderPreview` prints these under their own heading, with what was
 * entered, why, and — only when the form itself says so — the form's words.
 */
export interface PreviewFormRefusal {
  readonly fieldRef: string;
  readonly label: string;
  /** What is actually sent. */
  readonly text: string;
  /** The option's label, when the field has one. */
  readonly displayText?: string;
  /** What the student reads as the act: `ticked this box` or `entered "…"`. */
  readonly entered: string;
  readonly rationale: string;
  /** The form's own words, quoted. Absent when the form said nothing. */
  readonly formSays?: string;
  readonly reviewedBy: string;
}

/**
 * A field the Secure Plane will fill. ADR-0043.
 *
 * ── It has no `text`, and it is still in the hash ─────────────────────────
 *
 * `PreviewEntry.text` is "exactly what will be submitted", and for a credential
 * there is nothing that may go there — the value is not known to this process
 * and must never be. So a credential is a different shape, in its own list, and
 * the student sees that a password WILL be typed into this field rather than
 * seeing the password.
 *
 * The FACT is hashed even though the value is not: field reference and purpose.
 * That is what makes the authorisation mean "a password will be typed into the
 * Password field" — and it means a later change that added a third credential
 * field would change the hash, so the earlier authorisation would no longer
 * cover the application.
 */
export interface PreviewCredential {
  readonly fieldRef: string;
  readonly label: string;
  readonly purpose: CredentialPurpose;
  /** What the student is told. Never a value, and never its length. */
  readonly explanation: string;
}

export interface SubmissionPreview {
  readonly blueprintId: string;
  readonly blueprintVersion: string;
  readonly mappingSetId: string;
  readonly institutionName: string;
  /**
   * The portal host the application — and every attachment — goes to. In
   * the content hash (ADR-0098): ADR-0022's "where" is part of what the
   * student authorises, and a blueprint re-pointed at another host is a
   * different thing to say yes to.
   */
  readonly portalHost: string;
  readonly courseName: string;
  readonly intake: string;
  readonly entries: readonly PreviewEntry[];
  readonly attachments: readonly PreviewAttachment[];
  readonly handoffs: readonly PreviewHandoff[];
  /** Questions not answered on the student's behalf, and what was entered (ADR-0102). */
  readonly refusals: readonly PreviewFormRefusal[];
  /** Fields the Secure Plane fills. Never carries a value (ADR-0043). */
  readonly credentials: readonly PreviewCredential[];
  /** `sha256:…` over the canonical content. */
  readonly contentHash: string;
  readonly hashAlgorithm: "sha256";

  /**
   * Refuses serialisation. **This is the boundary, not a decoration.**
   *
   * A preview holds the student's data in plain text ON PURPOSE: it exists so
   * they can read exactly what will be sent and authorise it. Redacting it
   * would make it useless, so the control cannot be redaction — it has to be
   * *where the plaintext is allowed to go*.
   *
   * It may go to the student. It may not go to a log, an event, a trace, a
   * telemetry payload, a diagnostic dump or an audit record — and the common
   * route to all of those is `JSON.stringify`, whether called deliberately or
   * by a logger three layers down.
   *
   * So `JSON.stringify(preview)` throws. `renderPreview(preview)` is the way
   * to get the text, and its name says who it is for.
   */
  toJSON(): never;
}

/**
 * Thrown when something tries to serialise a preview.
 *
 * Named and exported so a caller can catch it deliberately — a test, or a
 * component that genuinely needs to know it hit the boundary.
 */
export class PreviewSerialisationError extends Error {
  public override readonly name = "PreviewSerialisationError";
  public constructor() {
    super(
      "A submission preview must not be serialised. It holds the student's data in plain text " +
        "because it exists to be READ BY THEM before they authorise it — that is its purpose and " +
        "it is not redacted. It must never reach a log, an event, a trace, telemetry, a " +
        "diagnostic dump or an audit record, and JSON.stringify is the usual route to all of " +
        "them. Use renderPreview() to show it to the student, or contentHash to reference it.",
    );
  }
}

/** Why a preview could not be built. */
export type PreviewRefusal =
  /** The plan still has blockers — there is no complete content to show. */
  | { readonly kind: "plan_incomplete"; readonly detail: string }
  /** The blueprint observed no URL, so there is no host to name as the destination. */
  | { readonly kind: "destination_unknown"; readonly detail: string }
  /** A mapped upload has no document behind it. */
  | { readonly kind: "document_missing"; readonly documentRef: string; readonly detail: string };

export type PreviewResult =
  | { readonly built: true; readonly preview: SubmissionPreview }
  | { readonly built: false; readonly refusal: PreviewRefusal };

/**
 * Which deployment of the portal the run is made to, when it is not the one
 * discovery observed (`CatalogueEntry.portalOrigin`, ADR-0057).
 */
export interface PreviewDeployment {
  /** The host the application — and every document — actually goes to. */
  readonly portalHost: string;
}

/**
 * Builds the preview.
 *
 * Refuses an incomplete plan rather than previewing a partial application.
 * Showing a student most of an application and asking them to authorise it
 * would make the authorisation cover something that is not what gets submitted.
 */
export function buildPreview(
  blueprint: ApplicationBlueprint,
  plan: FillPlan,
  documents: ReadonlyMap<string, PreviewDocument>,
  deployment?: PreviewDeployment,
): PreviewResult {
  if (plan.blockers.length > 0) {
    return {
      built: false,
      refusal: {
        kind: "plan_incomplete",
        detail:
          `${String(plan.blockers.length)} thing(s) are still outstanding. A student cannot ` +
          `authorise an application that is not finished.`,
      },
    };
  }

  // ── Where it is going, from what discovery actually loaded ─────────────
  //
  // The host of the first URL the blueprint's discovery run observed. Not the
  // catalogue entry's `portalAuthentication.portalHost`, which is absent for a
  // portal with no login; not a field somebody typed. A blueprint that
  // observed nothing is not executable (`isExecutable`), and a preview with
  // no destination to name is not a preview a student can authorise.
  //
  // Unless the deployment says otherwise (P74). The same reviewed blueprint
  // runs against a university's UAT environment before production
  // (`CatalogueEntry.portalOrigin`, ADR-0057), and the bytes go to THAT host.
  // The preview names where the document actually leaves to, because the
  // transmission gate refuses any other destination (ADR-0069) — a preview
  // naming the observed host over a run made to another would be an
  // authorisation the runner could never spend. The observed URL is still
  // required: a blueprint that saw nothing is no more executable for having a
  // deployment configured.
  const observed = blueprint.provenance.observedUrls[0];
  if (observed === undefined) {
    return {
      built: false,
      refusal: {
        kind: "destination_unknown",
        detail: "The blueprint observed no URL, so the preview cannot say where the application goes.",
      },
    };
  }
  const portalHost = deployment?.portalHost ?? new URL(observed).host;

  const optionLabels = optionLabelsOf(blueprint);

  // Refusals are kept OUT of the entries (ADR-0102): an entry is an answer,
  // and a refusal must never be listed as one. The switch is exhaustive, so a
  // new value kind cannot render as an ordinary answer or vanish in silence.
  const entries: PreviewEntry[] = [];
  const refusals: PreviewFormRefusal[] = [];
  for (const instruction of plan.instructions) {
    const value = instruction.value;
    switch (value.kind) {
      case "confirmed": {
        const text = unwrapText(value.value);
        const readable = optionLabels.get(instruction.fieldRef)?.get(text);
        entries.push({
          fieldRef: instruction.fieldRef,
          label: instruction.label,
          text,
          ...(readable !== undefined && readable !== text ? { displayText: readable } : {}),
          attribution: {
            kind: "student_confirmed",
            fieldKey: value.fieldKey,
            provenance: provenanceOf(value.value),
          },
        });
        break;
      }
      case "reviewed_constant": {
        const text = constantText(value.constant);
        const readable = optionLabels.get(instruction.fieldRef)?.get(text);
        entries.push({
          fieldRef: instruction.fieldRef,
          label: instruction.label,
          text,
          ...(readable !== undefined && readable !== text ? { displayText: readable } : {}),
          attribution: {
            kind: "reviewed_constant",
            rationale: constantAttribution(value.constant).rationale,
            reviewedBy: constantAttribution(value.constant).reviewedBy,
          },
        });
        break;
      }
      case "form_refusal": {
        const text = formRefusalText(value.refusal);
        const readable = optionLabels.get(instruction.fieldRef)?.get(text);
        const attribution = formRefusalAttribution(value.refusal);
        refusals.push({
          fieldRef: instruction.fieldRef,
          label: instruction.label,
          text,
          ...(readable !== undefined && readable !== text ? { displayText: readable } : {}),
          entered:
            instruction.inputType === "checkbox" && text === "true"
              ? "ticked this box"
              : `entered "${readable ?? text}"`,
          rationale: attribution.rationale,
          ...(attribution.formSays === undefined ? {} : { formSays: attribution.formSays }),
          reviewedBy: attribution.reviewedBy,
        });
        break;
      }
    }
  }

  const attachments: PreviewAttachment[] = [];
  for (const upload of plan.uploads) {
    const document = documents.get(upload.documentRef);
    if (document === undefined) {
      return {
        built: false,
        refusal: {
          kind: "document_missing",
          documentRef: upload.documentRef,
          detail:
            `The application attaches "${upload.label}" and no document has been provided for ` +
            `"${upload.documentRef}".`,
        },
      };
    }
    attachments.push({
      fieldRef: upload.fieldRef,
      label: upload.label,
      documentRef: upload.documentRef,
      document,
    });
  }

  const handoffs: PreviewHandoff[] = plan.handoffs.map((handoff) => ({
    fieldRef: handoff.fieldRef,
    label: handoff.label,
    reason: handoff.reason,
  }));

  const credentials: PreviewCredential[] = plan.credentials.map((credential) => ({
    fieldRef: credential.fieldRef,
    label: credential.label,
    purpose: credential.purpose,
    explanation:
      "Filled from the password you typed in the secure box. AskiMate cannot read it back.",
  }));

  const contentHash = hashContent({
    blueprintId: plan.blueprintId,
    blueprintVersion: plan.blueprintVersion,
    mappingSetId: plan.mappingSetId,
    portalHost,
    entries,
    attachments,
    handoffs,
    refusals,
    credentials,
  });

  return {
    built: true,
    preview: {
      blueprintId: plan.blueprintId,
      blueprintVersion: plan.blueprintVersion,
      mappingSetId: plan.mappingSetId,
      institutionName: blueprint.institutionName,
      portalHost,
      courseName: blueprint.courseName,
      intake: blueprint.intake,
      entries,
      attachments,
      handoffs,
      refusals,
      credentials,
      contentHash,
      hashAlgorithm: "sha256",
      // Non-enumerable, so it does not show up in Object.keys or a spread and
      // does not change the shape anyone reads — but JSON.stringify finds it,
      // which is the point.
      toJSON: (): never => {
        throw new PreviewSerialisationError();
      },
    },
  };
}

function unwrapText(value: unknown): string {
  return (value as { readonly value: string }).value;
}

/**
 * Canonical serialisation, then SHA-256.
 *
 * Sorted by field reference and built from explicit tuples rather than
 * `JSON.stringify` of an object graph, because object key order is a property
 * of how something was constructed and would make the hash depend on the code
 * path rather than on the content.
 */
function hashContent(content: {
  readonly blueprintId: string;
  readonly blueprintVersion: string;
  readonly mappingSetId: string;
  readonly portalHost: string;
  readonly entries: readonly PreviewEntry[];
  readonly attachments: readonly PreviewAttachment[];
  readonly handoffs: readonly PreviewHandoff[];
  readonly refusals: readonly PreviewFormRefusal[];
  readonly credentials: readonly PreviewCredential[];
}): string {
  const lines: string[] = [
    `blueprint${content.blueprintId}${content.blueprintVersion}`,
    `mapping${content.mappingSetId}`,
    // ADR-0022's "where", inside what the yes binds to (ADR-0098).
    `destination${content.portalHost}`,
  ];

  for (const entry of [...content.entries].sort(byFieldRef)) {
    lines.push(`field${entry.fieldRef}${entry.text}`);
  }
  for (const attachment of [...content.attachments].sort(byFieldRef)) {
    lines.push(
      `document${attachment.fieldRef}${attachment.documentRef}` +
        `${attachment.document.contentHash}`,
    );
  }
  for (const handoff of [...content.handoffs].sort(byFieldRef)) {
    lines.push(`handoff${handoff.fieldRef}`);
  }

  return `sha256:${createHash("sha256").update(lines.join("")).digest("hex")}`;
}

/**
 * Every select/radio field's option values, mapped back to their labels.
 *
 * From the blueprint — the university's own words for its own options, as
 * observed. Not a lookup table anyone here invented.
 */
function optionLabelsOf(
  blueprint: ApplicationBlueprint,
): ReadonlyMap<string, ReadonlyMap<string, string>> {
  const byField = new Map<string, Map<string, string>>();
  for (const field of allFields(blueprint)) {
    if (field.options === undefined) continue;
    const labels = new Map<string, string>();
    for (const option of field.options) labels.set(option.value, option.label);
    byField.set(field.fieldRef, labels);
  }
  return byField;
}

function byFieldRef(a: { fieldRef: string }, b: { fieldRef: string }): number {
  return a.fieldRef < b.fieldRef ? -1 : a.fieldRef > b.fieldRef ? 1 : 0;
}

/**
 * Renders the preview as text for the student.
 *
 * Plain and complete, in the order the portal asks. Every field the application
 * carries appears — there is no "and 14 other fields", because a summary is not
 * what they are authorising.
 */
export function renderPreview(preview: SubmissionPreview): string {
  const lines: string[] = [
    `${preview.institutionName} — ${preview.courseName}, ${preview.intake}`,
    // Where it goes, for EVERY application and not only one with documents
    // (P75). The host has been inside the hash since ADR-0098; until P75 the
    // text named it only per attachment, so a student with nothing to attach
    // said yes to a destination they could not read. ADR-0059's point is that
    // they can read what they are authorising, and the destination is part of
    // it — the whole reason it is inside the yes rather than in configuration.
    `Portal: ${preview.portalHost}`,
    "",
    "This is exactly what will be submitted.",
    "",
  ];

  for (const entry of preview.entries) {
    // What it means first, then what is actually sent — because the student
    // must be able to check it AND must not be shown something other than the
    // value that will reach the university.
    lines.push(
      entry.displayText === undefined
        ? `${entry.label}: ${entry.text}`
        : `${entry.label}: ${entry.displayText}  (sent as "${entry.text}")`,
    );
    if (entry.attribution.kind === "reviewed_constant") {
      // Marked, because it is the one thing here the student did not tell us.
      lines.push(`    (set by AskiMate: ${entry.attribution.rationale})`);
    }
  }

  if (preview.refusals.length > 0) {
    // ── ADR-0102: not answers. Said plainly, under their own heading ──────
    //
    // Vahid, 2026-09-11: *"If the student reads the preview and cannot tell
    // that a question about their health was left unanswered by us
    // deliberately, the authorisation is not informed."* So: which question,
    // that we did not answer it, what we entered, why — and the form's own
    // words about what happens next, quoted, or nothing.
    lines.push("", "We did not answer these for you:");
    for (const refusal of preview.refusals) {
      lines.push(`  ${refusal.label}`);
      lines.push(`    Not answered on your behalf. Instead we ${refusal.entered}.`);
      lines.push(`    Why: ${refusal.rationale}`);
      if (refusal.formSays !== undefined) lines.push(`    The form says: "${refusal.formSays}"`);
    }
  }

  if (preview.attachments.length > 0) {
    // ── Each attachment, plainly: which document, going where, for what ──
    //
    // ADR-0098, in Vahid's words: *"the preview must name each attachment
    // plainly — which document, going where, for what. 'Your documents will
    // be sent' is not a preview. If a student cannot tell from it exactly
    // what leaves, the single yes is not the instrument ADR-0087 meant."*
    // Deterministic, from the preview itself — the same reason no model
    // writes any line of this text.
    lines.push("", "Documents that will be sent:");
    for (const attachment of preview.attachments) {
      lines.push(
        `  ${attachment.label}: your ${attachment.document.describedAs}`,
        `    going to: ${preview.institutionName} (${preview.portalHost})`,
        `    for: this application — ${preview.courseName}, ${preview.intake}`,
      );
    }
  }

  if (preview.handoffs.length > 0) {
    lines.push("", "You will complete these yourself:");
    for (const handoff of preview.handoffs) {
      lines.push(`  ${handoff.label}`);
    }
  }

  lines.push("", `Reference: ${preview.contentHash}`);
  return lines.join("\n");
}
