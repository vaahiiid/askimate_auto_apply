/**
 * The authorisation ledger.
 *
 * Brief §7: the student authorises the exact content before submission, and
 * that authorisation is recorded. The domain already holds the *state* —
 * `AuthorisationCaptured`, `AuthorisationVoided`, and the transition guard that
 * refuses `SUBMITTING` when the prepared content no longer matches the
 * authorised hash. What is here is the **record**.
 *
 * ── Why the ledger stores the rendered text, not only the hash ────────────
 *
 * A hash proves the content has not changed. It cannot answer the question that
 * actually gets asked six months later, by a student, a university, or the ICO:
 *
 *     "What exactly did I approve?"
 *
 * By then the blueprint may be at version 3, the mapping set may have been
 * revised, and the profile may have been corrected. Re-rendering the preview
 * from current data would produce a plausible document that is **not what they
 * saw**, and would be indistinguishable from one that is. So the text is stored
 * verbatim at the moment of authorisation.
 *
 * ── Why authorisation cannot be captured from an arbitrary preview ────────
 *
 * `AuthorisablePreview` is branded and obtainable only from `checkAuthorisable`,
 * which requires a complete plan and a clean validation. A student cannot
 * authorise an application that is still missing answers or that the portal
 * would reject — and "cannot" is enforced by the type, not by call order.
 */

import type { Brand, StudentId } from "@askimate/aas-domain";

import type { SubmissionPreview } from "./preview.js";
import { renderPreview } from "./preview.js";
import type { ValidationResult } from "./validate.js";
import { isValid } from "./validate.js";

/** A preview that a student may be asked to authorise. */
export type AuthorisablePreview = Brand<SubmissionPreview, "AuthorisablePreview">;

export type AuthorisationRefusal =
  | { readonly kind: "validation_failed"; readonly detail: string; readonly violations: readonly string[] }
  | { readonly kind: "unknown_fields"; readonly detail: string; readonly fieldRefs: readonly string[] };

export type AuthorisabilityCheck =
  | { readonly authorisable: true; readonly preview: AuthorisablePreview }
  | { readonly authorisable: false; readonly refusal: AuthorisationRefusal };

/**
 * The gate between a preview and asking a student to approve it.
 *
 * Deliberately refuses on validation failure rather than warning. Asking a
 * student to authorise content the portal will reject wastes the one moment
 * they are paying close attention, and the second ask — after a change — is
 * where authorisation fatigue starts.
 */
export function checkAuthorisable(
  preview: SubmissionPreview,
  validation: ValidationResult,
): AuthorisabilityCheck {
  if (validation.unknownFields.length > 0) {
    return {
      authorisable: false,
      refusal: {
        kind: "unknown_fields",
        fieldRefs: validation.unknownFields,
        detail:
          `The plan fills fields the blueprint does not have: ` +
          `${validation.unknownFields.join(", ")}. Something is out of step.`,
      },
    };
  }

  if (!isValid(validation)) {
    return {
      authorisable: false,
      refusal: {
        kind: "validation_failed",
        violations: validation.violations.map((violation) => violation.detail),
        detail:
          `${String(validation.violations.length)} thing(s) would be rejected by the portal. ` +
          `Fix them before asking the student to approve anything.`,
      },
    };
  }

  return { authorisable: true, preview: preview as AuthorisablePreview };
}

/** What the student was shown, and what they said. */
export interface AuthorisationRecord {
  readonly authorisationId: string;
  readonly caseId: string;
  readonly studentRef: StudentId;
  readonly contentHash: string;
  readonly hashAlgorithm: "sha256";
  /** The preview text, verbatim, exactly as it was shown. */
  readonly presentedText: string;
  readonly blueprintId: string;
  readonly blueprintVersion: string;
  readonly mappingSetId: string;
  readonly authorisedAt: Date;
  /** Set when the authorisation stopped being valid. */
  readonly voidedAt?: Date;
  readonly voidReason?: "content_changed" | "expired" | "student_revoked";
}

/**
 * Storage for authorisations.
 *
 * Append-only, like the event log: an authorisation that was later voided is
 * marked, never deleted. "The student authorised this, then the content
 * changed, so we asked again" is exactly the history that has to survive.
 */
export interface AuthorisationLedger {
  record(entry: {
    readonly authorisationId: string;
    readonly caseId: string;
    readonly studentRef: StudentId;
    readonly preview: AuthorisablePreview;
    readonly authorisedAt: Date;
  }): Promise<AuthorisationRecord>;

  /** Every authorisation for a case, oldest first. */
  historyFor(caseId: string): Promise<readonly AuthorisationRecord[]>;

  /** The current, un-voided authorisation, if any. */
  currentFor(caseId: string): Promise<AuthorisationRecord | null>;

  void(
    authorisationId: string,
    reason: "content_changed" | "expired" | "student_revoked",
    at: Date,
  ): Promise<AuthorisationRecord>;
}

export class AuthorisationNotFoundError extends Error {
  public override readonly name = "AuthorisationNotFoundError";
  public constructor(public readonly authorisationId: string) {
    super(`No authorisation ${authorisationId}.`);
  }
}

/**
 * Whether a captured authorisation still covers this content.
 *
 * The check the state machine's submission guard exists to enforce. Kept here
 * as well so a caller can ask *before* attempting to submit, and get an answer
 * rather than a refusal.
 */
export function stillCovers(
  record: AuthorisationRecord,
  preview: SubmissionPreview,
): boolean {
  return record.voidedAt === undefined && record.contentHash === preview.contentHash;
}

/** An in-memory ledger. Satisfies the port; not durable. */
export class InMemoryAuthorisationLedger implements AuthorisationLedger {
  readonly #records = new Map<string, AuthorisationRecord>();

  public record(entry: {
    readonly authorisationId: string;
    readonly caseId: string;
    readonly studentRef: StudentId;
    readonly preview: AuthorisablePreview;
    readonly authorisedAt: Date;
  }): Promise<AuthorisationRecord> {
    const record: AuthorisationRecord = {
      authorisationId: entry.authorisationId,
      caseId: entry.caseId,
      studentRef: entry.studentRef,
      contentHash: entry.preview.contentHash,
      hashAlgorithm: "sha256",
      // Rendered and frozen here, so the question "what did I approve?" has an
      // answer that does not depend on what anything looks like today.
      presentedText: renderPreview(entry.preview),
      blueprintId: entry.preview.blueprintId,
      blueprintVersion: entry.preview.blueprintVersion,
      mappingSetId: entry.preview.mappingSetId,
      authorisedAt: entry.authorisedAt,
    };
    this.#records.set(record.authorisationId, record);
    return Promise.resolve(record);
  }

  public historyFor(caseId: string): Promise<readonly AuthorisationRecord[]> {
    return Promise.resolve(
      [...this.#records.values()]
        .filter((record) => record.caseId === caseId)
        .sort((a, b) => a.authorisedAt.getTime() - b.authorisedAt.getTime()),
    );
  }

  public currentFor(caseId: string): Promise<AuthorisationRecord | null> {
    const live = [...this.#records.values()]
      .filter((record) => record.caseId === caseId && record.voidedAt === undefined)
      .sort((a, b) => b.authorisedAt.getTime() - a.authorisedAt.getTime());
    return Promise.resolve(live[0] ?? null);
  }

  public void(
    authorisationId: string,
    reason: "content_changed" | "expired" | "student_revoked",
    at: Date,
  ): Promise<AuthorisationRecord> {
    const existing = this.#records.get(authorisationId);
    if (existing === undefined) {
      return Promise.reject(new AuthorisationNotFoundError(authorisationId));
    }
    const voided: AuthorisationRecord = { ...existing, voidedAt: at, voidReason: reason };
    this.#records.set(authorisationId, voided);
    return Promise.resolve(voided);
  }
}
