/**
 * Sending a student's document somewhere.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A DOCUMENT BEING IN THE VAULT IS NOT A REASON TO SEND IT ANYWHERE.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Vahid, 2026-08-26: *"The system must not upload a document to a university
 * merely because the document exists in the vault. The application context,
 * destination, purpose and authorisation must be known before a document is
 * transmitted."*
 *
 * That is a sentence about a failure that is very easy to build. The obvious
 * implementation of "attach the passport" is `vault.retrieve(id)` followed by
 * `session.attach(...)`, and every one of the four things above is missing
 * from it — silently, and in a way no code review would necessarily catch,
 * because the code looks like it is doing exactly what was asked.
 *
 * So the upload path does not take a document ID. It takes a
 * `DisclosureAuthorisation`, which cannot be constructed without all four.
 *
 * ── The four things, and why each is separate ─────────────────────────────
 *
 *   WHAT         which document, by ID and content hash. The hash matters:
 *                the student authorised THIS passport, not whatever is under
 *                that ID later.
 *
 *   WHERE        the institution and the portal host. "Send my transcript to
 *                Ulster" is not permission to send it to a different portal
 *                that happens to be in the blueprint.
 *
 *   WHY          the application it belongs to, and what the university asked
 *                it for. Recorded so an audit can answer "why did this leave
 *                our systems?" without inference.
 *
 *   AUTHORITY    a lawful basis determination AND, where that determination
 *                says so, the student's specific affirmative authorisation.
 *                Two different questions — see ./lawful-basis.ts.
 *
 * ── Withdrawal ────────────────────────────────────────────────────────────
 *
 * A student can withdraw. A withdrawn authorisation stops authorising
 * immediately, and is marked rather than deleted — "they authorised it, then
 * withdrew" is exactly the history that has to survive a subject access
 * request.
 */

import type { Brand, StudentId } from "@askimate/aas-domain";

import type { LawfulBasisDetermination } from "./lawful-basis.js";
import { determinationOf } from "./lawful-basis.js";

/** Where a document is going. */
export interface DisclosureDestination {
  /** e.g. `Ulster University (Birmingham) / QA Higher Education`. */
  readonly institutionName: string;
  /**
   * The portal host that will receive it.
   *
   * Checked against the session's allow-list at upload time, so an
   * authorisation for one portal cannot be spent on another.
   */
  readonly portalHost: string;
  /** Who the receiving organisation is, when it is not the university itself. */
  readonly processorName?: string;
}

/** What is being sent, and for what. */
export interface DisclosureSubject {
  readonly documentId: string;
  readonly documentType: string;
  /** SHA-256 of the bytes the student authorised. */
  readonly contentHash: string;
  /** The case this belongs to. */
  readonly caseId: string;
  /** What the university asked it for, in the university's own words. */
  readonly requestedFor: string;
}

/**
 * The student's affirmative, specific authorisation.
 *
 * Not a checkbox in a settings screen and not an acceptance of terms. A
 * specific act, in response to being told exactly what was going where and
 * why, recorded with the words they were shown.
 */
export interface StudentDisclosureAuthorisation {
  readonly studentRef: StudentId;
  /**
   * The exact text the student saw.
   *
   * Stored verbatim for the same reason the submission preview is: months
   * later, "what were they actually told?" must have an answer that does not
   * depend on what the wording looks like today.
   */
  readonly presentedText: string;
  readonly authorisedAt: Date;
  /**
   * How they said yes.
   *
   * `chat_affirmation` is the ordinary route — the student says yes in the
   * AskiMate conversation. It is affirmative and specific because the text
   * above named this document, this university and this purpose.
   */
  readonly method: "chat_affirmation" | "signed_form" | "specialist_recorded";
}

/** Everything a disclosure needs, before it is checked. */
export interface DisclosureRequestRecord {
  readonly disclosureId: string;
  readonly subject: DisclosureSubject;
  readonly destination: DisclosureDestination;
  readonly determination: LawfulBasisDetermination;
  /** Present when the determination requires it. */
  readonly studentAuthorisation?: StudentDisclosureAuthorisation;
  /**
   * Conditions that apply because the applicant is a minor.
   *
   * Determined per case through the ordinary requirements process (ADR-0011);
   * this records that they were determined and satisfied, not what they are.
   * `undefined` means the applicant is not a minor. An EMPTY ARRAY means the
   * conditions have not been determined yet, which is not the same thing and
   * does not authorise anything.
   */
  readonly minorConditions?: readonly MinorConditionCheck[];
}

export interface MinorConditionCheck {
  readonly condition: string;
  readonly satisfied: boolean;
  readonly evidence?: string;
}

/**
 * Permission to transmit one document, once, to one destination.
 *
 * Branded, and constructible only by `authoriseDisclosure`. The upload path
 * takes this type, so "the document exists" is not a thing the type system
 * will accept as a reason to send it.
 */
export type DisclosureAuthorisation = Brand<DisclosureRequestRecord, "DisclosureAuthorisation">;

export type DisclosureRefusal =
  | { readonly kind: "authorisation_required"; readonly detail: string }
  | { readonly kind: "authorisation_not_specific"; readonly detail: string }
  | { readonly kind: "minor_conditions_undetermined"; readonly detail: string }
  | { readonly kind: "minor_conditions_unsatisfied"; readonly detail: string; readonly outstanding: readonly string[] }
  | { readonly kind: "wrong_activity"; readonly detail: string };

export type DisclosureCheck =
  | { readonly authorised: true; readonly authorisation: DisclosureAuthorisation }
  | { readonly authorised: false; readonly refusal: DisclosureRefusal };

/** The activity a disclosure determination must cover. */
export const DISCLOSURE_ACTIVITY = "disclose_document_to_institution";

/**
 * The gate between a document and a university.
 *
 * Five checks. The third and fourth are about minors, and they are separate
 * because "we have not worked out what this minor's application requires" and
 * "we worked it out and it is not satisfied" call for different responses:
 * the first is a task for a specialist, the second is a task for the student
 * or their guardian.
 */
export function authoriseDisclosure(
  request: DisclosureRequestRecord,
): DisclosureCheck {
  const determination = determinationOf(request.determination);

  if (determination.activity.activity !== DISCLOSURE_ACTIVITY) {
    return {
      authorised: false,
      refusal: {
        kind: "wrong_activity",
        detail:
          `The lawful basis cited covers "${determination.activity.activity}", not ` +
          `"${DISCLOSURE_ACTIVITY}". A basis for holding a document is not a basis for sending it.`,
      },
    };
  }

  if (determination.requiresStudentAuthorisation) {
    const authorisation = request.studentAuthorisation;
    if (authorisation === undefined) {
      return {
        authorised: false,
        refusal: {
          kind: "authorisation_required",
          detail:
            `The lawful basis for this disclosure requires the student's specific authorisation, ` +
            `and none is recorded. Ask them.`,
        },
      };
    }

    // Specific means specific. The text they saw must name what is going
    // where — otherwise "yes" answered a different question from the one
    // being relied on.
    const specific = mentionsAll(authorisation.presentedText, [
      request.subject.documentType,
      request.destination.institutionName,
    ]);
    if (!specific) {
      return {
        authorised: false,
        refusal: {
          kind: "authorisation_not_specific",
          detail:
            `The student's authorisation does not name both the document ` +
            `("${request.subject.documentType}") and the destination ` +
            `("${request.destination.institutionName}"). A general agreement is not specific ` +
            `authorisation for this disclosure.`,
        },
      };
    }
  }

  if (request.minorConditions !== undefined) {
    if (request.minorConditions.length === 0) {
      return {
        authorised: false,
        refusal: {
          kind: "minor_conditions_undetermined",
          detail:
            `The applicant is a minor and no conditions have been determined for this disclosure. ` +
            `An empty set is not an absence of requirements — it means nobody has looked yet ` +
            `(ADR-0011).`,
        },
      };
    }

    const outstanding = request.minorConditions
      .filter((condition) => !condition.satisfied)
      .map((condition) => condition.condition);

    if (outstanding.length > 0) {
      return {
        authorised: false,
        refusal: {
          kind: "minor_conditions_unsatisfied",
          outstanding,
          detail:
            `The applicant is a minor and these conditions are not satisfied: ` +
            `${outstanding.join(", ")}.`,
        },
      };
    }
  }

  return { authorised: true, authorisation: request as DisclosureAuthorisation };
}

function mentionsAll(text: string, required: readonly string[]): boolean {
  const haystack = text.toLowerCase();
  return required.every((needle) => haystack.includes(needle.toLowerCase()));
}

/** Reads an authorisation, for the audit trail and the upload check. */
export function disclosureOf(
  authorisation: DisclosureAuthorisation,
): DisclosureRequestRecord {
  return authorisation;
}

// ───────────────────────────────────────────────────────────────────────────
// Spending an authorisation
// ───────────────────────────────────────────────────────────────────────────

export type TransmissionRefusal =
  | { readonly kind: "wrong_document"; readonly detail: string }
  | { readonly kind: "content_changed"; readonly detail: string }
  | { readonly kind: "wrong_destination"; readonly detail: string }
  | { readonly kind: "withdrawn"; readonly detail: string };

export interface WithdrawalRecord {
  readonly disclosureId: string;
  readonly withdrawnAt: Date;
  readonly reason: string;
}

/**
 * May this authorisation be spent on THIS transmission?
 *
 * Checked at the moment of upload, against what is actually about to be sent
 * — not against what was intended when the authorisation was captured. The
 * content hash is the important one: a student who authorised one passport
 * scan has not authorised whatever replaced it.
 */
export function mayTransmit(input: {
  readonly authorisation: DisclosureAuthorisation;
  readonly documentId: string;
  readonly contentHash: string;
  readonly toHost: string;
  readonly withdrawals: readonly WithdrawalRecord[];
}): { readonly permitted: true } | { readonly permitted: false; readonly refusal: TransmissionRefusal } {
  const record = disclosureOf(input.authorisation);

  const withdrawal = input.withdrawals.find((entry) => entry.disclosureId === record.disclosureId);
  if (withdrawal !== undefined) {
    return {
      permitted: false,
      refusal: {
        kind: "withdrawn",
        detail:
          `The student withdrew this authorisation on ` +
          `${withdrawal.withdrawnAt.toISOString().slice(0, 10)}: ${withdrawal.reason}`,
      },
    };
  }

  if (record.subject.documentId !== input.documentId) {
    return {
      permitted: false,
      refusal: {
        kind: "wrong_document",
        detail:
          `This authorisation covers document ${record.subject.documentId}, and ` +
          `${input.documentId} is about to be sent. An authorisation is not transferable.`,
      },
    };
  }

  if (record.subject.contentHash !== input.contentHash) {
    return {
      permitted: false,
      refusal: {
        kind: "content_changed",
        detail:
          `The document's contents have changed since the student authorised it. They agreed to ` +
          `send one file; this is a different one. Ask again.`,
      },
    };
  }

  if (!hostMatches(record.destination.portalHost, input.toHost)) {
    return {
      permitted: false,
      refusal: {
        kind: "wrong_destination",
        detail:
          `This authorisation is for ${record.destination.portalHost}, and the upload is going to ` +
          `${input.toHost}. "Send it to my university" is not permission to send it anywhere else.`,
      },
    };
  }

  return { permitted: true };
}

function hostMatches(authorised: string, actual: string): boolean {
  const a = authorised.toLowerCase();
  const b = actual.toLowerCase();
  return a === b || b.endsWith(`.${a}`);
}

/** What actually left, recorded for the audit trail. */
export interface TransmissionRecord {
  readonly disclosureId: string;
  readonly documentId: string;
  readonly contentHash: string;
  readonly toHost: string;
  readonly institutionName: string;
  readonly caseId: string;
  readonly transmittedAt: Date;
}

/**
 * The record of a transmission that happened.
 *
 * Note what it does NOT contain: the document. Audit records reference
 * document IDs and hashes, never contents (brief §8).
 */
export function recordTransmission(
  authorisation: DisclosureAuthorisation,
  at: Date,
  toHost: string,
): TransmissionRecord {
  const record = disclosureOf(authorisation);
  return {
    disclosureId: record.disclosureId,
    documentId: record.subject.documentId,
    contentHash: record.subject.contentHash,
    toHost,
    institutionName: record.destination.institutionName,
    caseId: record.subject.caseId,
    transmittedAt: at,
  };
}

/**
 * The text a student is shown before being asked to authorise.
 *
 * Rendered deterministically from the disclosure itself, for the same reason
 * the submission preview is: if a model wrote it, the student would be
 * agreeing to a model's description of a disclosure rather than the
 * disclosure. It names all four things, because the check above requires the
 * text to name them — the wording cannot drift away from what is verified.
 */
export function renderDisclosureRequest(request: DisclosureRequestRecord): string {
  const { subject, destination } = request;
  const processor =
    destination.processorName === undefined
      ? ""
      : `\n\nThe portal is operated by ${destination.processorName} on the university's behalf.`;

  return (
    `To continue your application I need to send your ${subject.documentType} to ` +
    `${destination.institutionName}.\n\n` +
    `What is being sent:  your ${subject.documentType}\n` +
    `Where it is going:   ${destination.institutionName} (${destination.portalHost})\n` +
    `Why:                 ${subject.requestedFor}\n` +
    `Which application:   ${subject.caseId}${processor}\n\n` +
    `You can change your mind later, and I will tell you if anything about this changes.\n\n` +
    `Is that alright?`
  );
}
