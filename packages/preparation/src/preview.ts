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
import type { FillPlan } from "@askimate/aas-mapping";
import { constantAttribution, constantText } from "@askimate/aas-mapping";
import type { ProfileFieldKey } from "@askimate/aas-profile";

/** A document as it will be attached. */
export interface PreviewDocument {
  readonly documentId: string;
  readonly filename: string;
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

export interface SubmissionPreview {
  readonly blueprintId: string;
  readonly blueprintVersion: string;
  readonly mappingSetId: string;
  readonly institutionName: string;
  readonly courseName: string;
  readonly intake: string;
  readonly entries: readonly PreviewEntry[];
  readonly attachments: readonly PreviewAttachment[];
  readonly handoffs: readonly PreviewHandoff[];
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
  /** A mapped upload has no document behind it. */
  | { readonly kind: "document_missing"; readonly documentRef: string; readonly detail: string };

export type PreviewResult =
  | { readonly built: true; readonly preview: SubmissionPreview }
  | { readonly built: false; readonly refusal: PreviewRefusal };

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

  const optionLabels = optionLabelsOf(blueprint);

  const entries: PreviewEntry[] = plan.instructions.map((instruction) => {
    const text =
      instruction.value.kind === "confirmed"
        ? unwrapText(instruction.value.value)
        : constantText(instruction.value.constant);
    const readable = optionLabels.get(instruction.fieldRef)?.get(text);

    return {
    fieldRef: instruction.fieldRef,
    label: instruction.label,
    text,
    ...(readable !== undefined && readable !== text ? { displayText: readable } : {}),
    attribution:
      instruction.value.kind === "confirmed"
        ? {
            kind: "student_confirmed",
            fieldKey: instruction.value.fieldKey,
            provenance: provenanceOf(instruction.value.value),
          }
        : {
            kind: "reviewed_constant",
            rationale: constantAttribution(instruction.value.constant).rationale,
            reviewedBy: constantAttribution(instruction.value.constant).reviewedBy,
          },
    };
  });

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

  const contentHash = hashContent({
    blueprintId: plan.blueprintId,
    blueprintVersion: plan.blueprintVersion,
    mappingSetId: plan.mappingSetId,
    entries,
    attachments,
    handoffs,
  });

  return {
    built: true,
    preview: {
      blueprintId: plan.blueprintId,
      blueprintVersion: plan.blueprintVersion,
      mappingSetId: plan.mappingSetId,
      institutionName: blueprint.institutionName,
      courseName: blueprint.courseName,
      intake: blueprint.intake,
      entries,
      attachments,
      handoffs,
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
  readonly entries: readonly PreviewEntry[];
  readonly attachments: readonly PreviewAttachment[];
  readonly handoffs: readonly PreviewHandoff[];
}): string {
  const lines: string[] = [
    `blueprint${content.blueprintId}${content.blueprintVersion}`,
    `mapping${content.mappingSetId}`,
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

  if (preview.attachments.length > 0) {
    lines.push("", "Documents attached:");
    for (const attachment of preview.attachments) {
      lines.push(`  ${attachment.label}: ${attachment.document.filename}`);
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
