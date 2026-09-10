/**
 * A fill plan, as it crosses to the Automation Runner.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ADR-0046. `FillInstruction.value` carries a `ConfirmedValue<string>`, which
 * only `packages/profile` may mint (ADR-0004). A plan therefore cannot simply
 * be `JSON.parse`d on the other side of a wire: the values would come back as
 * ordinary objects with the brand gone, and every consumer downstream of them
 * would stop being able to tell a value the student confirmed from one nobody
 * did.
 *
 * So a plan is taken apart into the same two halves a stored profile entry is —
 * the value and its provenance — and reassembled with `rehydrateConfirmed`,
 * which is the mint, in the package that owns it. Nothing here casts, and
 * `scripts/check-boundaries.ts` still finds `as ConfirmedValue` in exactly one
 * package.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why not send text and rebuild a provenance ────────────────────────────
 *
 * Because a provenance nobody produced is a lie about a student. `student_stated`
 * means they said it, the agent played it back, and they confirmed it (ADR-0007).
 * A plan that arrived carrying text and had a provenance attached on receipt
 * would be asserting all of that about a value whose history had been thrown
 * away one process earlier. The whole point of the brand is that it cannot be
 * obtained without the history; sending the history is what makes rebuilding it
 * honest rather than a formality.
 *
 * ── Uploads cross as REFERENCES, never as documents ───────────────────────
 *
 * Until P66 (ADR-0099) a plan with uploads was refused transport: a document is
 * bytes the student authorised us to send to one host, the gate that checks
 * that (`mayTransmit`) runs against the document's own content hash at the
 * moment of sending, and the runner is forbidden `@askimate/aas-documents`.
 * All three are still true. What crosses now is what a plan already held about
 * an upload — which box, which document the reviewed mapping named for it,
 * where the box is — and NOT the document: no bytes, no document id, no hash.
 * The runner asks the plane for each `documentRef` under its lease, and the
 * plane answers only after `authoriseDisclosure` and `mayTransmit` with the
 * case; the bytes come from a sixty-second retrieval URL the plane minted.
 */

import type { ConfirmationProvenance } from "@askimate/aas-domain";
import { unwrapConfirmed, provenanceOf } from "@askimate/aas-domain";
import { rehydrateConfirmed } from "@askimate/aas-profile";
import type { ProfileFieldKey } from "@askimate/aas-profile";

import type { FieldInputType, FieldLocator } from "@askimate/aas-blueprint";

import type {
  CredentialRequirement,
  FillInstruction,
  FillPlan,
  FillValue,
} from "./plan.js";

/** One value, taken apart into what it is and how it got confirmed. */
export type StoredFillValue =
  | {
      readonly kind: "confirmed";
      readonly fieldKey: ProfileFieldKey;
      readonly text: string;
      readonly provenance: ConfirmationProvenance;
    }
  | {
      readonly kind: "reviewed_constant";
      readonly text: string;
      readonly rationale: string;
      readonly mappingSetId: string;
      readonly reviewedBy: string;
    };

export interface StoredFillInstruction {
  readonly fieldRef: string;
  readonly label: string;
  readonly inputType: FieldInputType;
  readonly locators: readonly FieldLocator[];
  readonly value: StoredFillValue;
}

/** An upload, as a reference: which box, which document, where. No bytes, no id, no hash. */
export interface StoredUpload {
  readonly fieldRef: string;
  readonly label: string;
  readonly documentRef: string;
  readonly locators: readonly FieldLocator[];
}

export interface StoredFillPlan {
  readonly blueprintId: string;
  readonly blueprintVersion: string;
  readonly mappingSetId: string;
  readonly instructions: readonly StoredFillInstruction[];
  /** Uploads as references (ADR-0099). The runner resolves each under its lease. */
  readonly uploads: readonly StoredUpload[];
  /** Fields the Secure Plane fills. Never carries a value (ADR-0043). */
  readonly credentials: readonly CredentialRequirement[];
}

/** Why a plan cannot be sent to a runner. Every one is a refusal, not a bug. */
export type PlanTransportRefusal =
  /** The plan is not executable: a required field has no mapping, or worse. */
  | "has_blockers"
  /** A field the student must do themselves. Not automatable by definition. */
  | "has_handoffs";

/**
 * Takes a plan apart for transport, or refuses.
 *
 * Refuses rather than dropping the untransportable parts. A plan with its
 * uploads silently removed is a plan that will report itself complete having
 * attached nothing, and the student would be told their application was filled.
 */
export function toStoredPlan(
  plan: FillPlan,
): { readonly ok: true; readonly plan: StoredFillPlan } | { readonly ok: false; readonly refusal: PlanTransportRefusal } {
  if (plan.blockers.length > 0) return { ok: false, refusal: "has_blockers" };
  if (plan.handoffs.length > 0) return { ok: false, refusal: "has_handoffs" };

  return {
    ok: true,
    plan: {
      blueprintId: plan.blueprintId,
      blueprintVersion: plan.blueprintVersion,
      mappingSetId: plan.mappingSetId,
      instructions: plan.instructions.map(
        (instruction): StoredFillInstruction => ({
          fieldRef: instruction.fieldRef,
          label: instruction.label,
          inputType: instruction.inputType,
          locators: instruction.locators.map((locator) => ({
            strategy: locator.strategy,
            value: locator.value,
          })),
          value: storedValue(instruction.value),
        }),
      ),
      uploads: plan.uploads.map(
        (upload): StoredUpload => ({
          fieldRef: upload.fieldRef,
          label: upload.label,
          documentRef: upload.documentRef,
          locators: upload.locators.map((locator) => ({
            strategy: locator.strategy,
            value: locator.value,
          })),
        }),
      ),
      credentials: plan.credentials.map((credential) => ({ ...credential })),
    },
  };
}

function storedValue(value: FillValue): StoredFillValue {
  if (value.kind === "confirmed") {
    return {
      kind: "confirmed",
      fieldKey: value.fieldKey,
      text: unwrapConfirmed(value.value),
      provenance: provenanceOf(value.value),
    };
  }
  const constant = value.constant as unknown as {
    readonly text: string;
    readonly rationale: string;
    readonly mappingSetId: string;
    readonly reviewedBy: string;
  };
  return {
    kind: "reviewed_constant",
    text: constant.text,
    rationale: constant.rationale,
    mappingSetId: constant.mappingSetId,
    reviewedBy: constant.reviewedBy,
  };
}

/**
 * Rebuilds a plan on the other side of the wire.
 *
 * The confirmed values are reassembled through `rehydrateConfirmed` — the same
 * mint `rehydrateProfile` uses, with the same provenance the student's
 * confirmation produced. A reviewed constant is rebuilt as a constant and stays
 * distinguishable from a confirmed value all the way to the keyboard, because
 * `executePlan` calls `fill` for one and `fillConstant` for the other and no
 * fabricated provenance is invented for either.
 *
 * `handoffs` and `blockers` come back EMPTY, and they are empty because
 * `toStoredPlan` refuses any plan that had them — not because they were
 * dropped here. `uploads` come back as the references that crossed.
 */
export function rehydratePlan(stored: StoredFillPlan): FillPlan {
  return {
    blueprintId: stored.blueprintId,
    blueprintVersion: stored.blueprintVersion,
    mappingSetId: stored.mappingSetId,
    instructions: stored.instructions.map(
      (instruction): FillInstruction => ({
        fieldRef: instruction.fieldRef,
        label: instruction.label,
        inputType: instruction.inputType,
        locators: instruction.locators.map((locator) => ({
          strategy: locator.strategy,
          value: locator.value,
        })),
        value: rebuiltValue(instruction.value),
      }),
    ),
    uploads: stored.uploads.map((upload) => ({
      fieldRef: upload.fieldRef,
      label: upload.label,
      documentRef: upload.documentRef,
      locators: upload.locators.map((locator) => ({
        strategy: locator.strategy,
        value: locator.value,
      })),
    })),
    handoffs: [],
    credentials: stored.credentials.map((credential) => ({ ...credential })),
    blockers: [],
  };
}

function rebuiltValue(stored: StoredFillValue): FillValue {
  if (stored.kind === "confirmed") {
    return {
      kind: "confirmed",
      fieldKey: stored.fieldKey,
      value: rehydrateConfirmed({ value: stored.text, provenance: stored.provenance }),
    };
  }
  // Rebuilt as the branded constant it was. The brand's guarantee is that a
  // constant passed through `checkUsable`, which it did — on the plane that
  // built this plan, which is the only place a mapping set is reviewed.
  return {
    kind: "reviewed_constant",
    constant: {
      text: stored.text,
      rationale: stored.rationale,
      mappingSetId: stored.mappingSetId,
      reviewedBy: stored.reviewedBy,
    } as unknown as Extract<FillValue, { kind: "reviewed_constant" }>["constant"],
  };
}
