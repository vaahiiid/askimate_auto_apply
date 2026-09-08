/**
 * B2 — the four lawful-basis determinations, as Vahid made them.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ADR-0022 said someone must determine and register a lawful basis for each
 * storing and disclosing activity, and named nobody. That blocker stood from
 * P31 to P54 and was, since ADR-0078, the ONLY policy blocker on documents.
 *
 * Answered by Vahid Mohammadi on 2026-09-08, review in twelve months. These
 * are his determinations, transcribed — not a reading of the law by this
 * repository, which ADR-0023 forbids it from making.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why consent is deliberately NOT the basis for 1, 2 and 3 ─────────────
 *
 * Vahid, 2026-09-08, and it is the part that matters:
 *
 *   "Consent must be freely given, and a student who cannot get their
 *    application submitted without agreeing has not freely given anything. A
 *    record claiming consent in that situation looks like compliance and is
 *    not. Contract is both the honest description and the stronger position."
 *
 * That is ADR-0022's own reasoning, now acted on. `determineLawfulBasis`
 * already refuses a determination naming consent while claiming no
 * authorisation is needed; these three avoid the trap by not naming consent.
 *
 * ── Storing and sending are different acts ────────────────────────────────
 *
 * Determination 3 carries the same Article 6 basis as 1 and 2 and ALSO
 * requires specific student authorisation. The preview, the authorisation text
 * and the content hash were built for exactly this (ADR-0059, ADR-0057), and
 * this registers them as **required rather than optional**.
 */

import type {
  Article6Basis,
  Article9Condition,
  LawfulBasisDeterminationRecord,
} from "./lawful-basis.js";
import { LawfulBasisRegister, determineLawfulBasis } from "./lawful-basis.js";
import { DISCLOSURE_ACTIVITY } from "./disclosure.js";

/** Named, dated and reviewable — the three things a determination must carry. */
const DETERMINED_BY = "Vahid Mohammadi";
export const B2_DETERMINED_AT = new Date("2026-09-08T00:00:00Z");
/** Twelve months, as instructed. Law and circumstances change. */
export const B2_REVIEW_BY = new Date("2027-09-08T00:00:00Z");

function determination(
  determinationId: string,
  activity: string,
  purpose: string,
  documentTypes: readonly string[],
  article6: Article6Basis,
  requiresStudentAuthorisation: boolean,
  reasoning: string,
  extra: {
    readonly article9?: Article9Condition;
    readonly article9Required?: readonly string[];
  } = {},
): LawfulBasisDeterminationRecord {
  return {
    determinationId,
    activity: { activity, purpose, documentTypes },
    article6,
    requiresStudentAuthorisation,
    determinedBy: DETERMINED_BY,
    determinedAt: B2_DETERMINED_AT,
    reasoning,
    reviewBy: B2_REVIEW_BY,
    ...extra,
  };
}

/**
 * 1 · Storing identity documents.
 *
 * Article 6(1)(b), performance of a contract. No separate student
 * authorisation — the student asked for the application to be made, and
 * holding the identity document is part of doing it.
 *
 * **The Article 9 condition is the interesting half**, and it is scoped to the
 * national identity card alone. Vahid:
 *
 *   "Some national ID cards carry religion or ethnicity on their face.
 *    ADR-0077 made extracting those fields impossible, but holding the image is
 *    still processing the data, whether or not anything reads it."
 *
 * Consent works here where it does not work for the activity as a whole, and
 * the reason is written down so the condition cannot outlive it: **the student
 * has a passport as an alternative, so the choice is real.** If that ceases to
 * be true — a route that accepts only a national ID — this determination must
 * be revisited before it is relied on again.
 */
export const STORE_IDENTITY_DOCUMENT: LawfulBasisDeterminationRecord = determination(
  "b2-1-store-identity",
  "store_document:identity_verification",
  "Holding the identity document an application requires, so the student supplies it once",
  ["passport", "national_id"],
  "contract",
  false,
  "Article 6(1)(b), performance of a contract. The student has asked for an application to be " +
    "made on their behalf and an identity document is required to make it; holding it is part of " +
    "performing what was agreed. Consent is deliberately NOT the basis: a student who cannot get " +
    "their application submitted without agreeing has not freely given anything, and a record " +
    "claiming consent in that situation looks like compliance and is not. " +
    "ARTICLE 9, national identity card only: some carry religion or ethnicity on their face, and " +
    "holding the image is processing that data whether or not anything reads it — ADR-0077 makes " +
    "the fields unextractable, which is a different question. Article 9(2)(a), explicit consent, " +
    "asked separately at the point of upload. Consent works HERE, where it does not work for the " +
    "activity as a whole, because the student has a passport as an alternative and the choice is " +
    "therefore real. IF THAT CEASES TO BE TRUE, THIS MUST BE REVISITED. A passport needs no " +
    "Article 9 condition. Determined by Vahid Mohammadi, 2026-09-08.",
  { article9: "explicit_consent", article9Required: ["national_id"] },
);

/**
 * 2 · Storing academic documents.
 *
 * Article 6(1)(b), performance of a contract. No separate student
 * authorisation, for the same reason as 1.
 */
export const STORE_ACADEMIC_DOCUMENT: LawfulBasisDeterminationRecord = determination(
  "b2-2-store-academic",
  "store_document:application_submission",
  "Holding the academic evidence an application requires, so the student supplies it once",
  [
    "academic_transcript",
    "degree_certificate",
    "english_test_certificate",
    "personal_statement",
    "reference_letter",
    "birth_certificate",
    "other",
  ],
  "contract",
  false,
  "Article 6(1)(b), performance of a contract. The student has asked for an application to be " +
    "made and these are the documents it requires; holding them is part of performing what was " +
    "agreed, and holding them once is what lets a second application reuse them (ADR-0078). " +
    "Consent is deliberately NOT the basis, for the reason recorded on determination 1: consent " +
    "conditioned on getting an application submitted is not freely given. " +
    "Determined by Vahid Mohammadi, 2026-09-08.",
);

/**
 * 3 · Disclosing a document to an institution.
 *
 * Article 6(1)(b) for the basis, **and specific student authorisation is
 * required**. Vahid: *"Storing a document and sending it are different acts."*
 *
 * This is what makes ADR-0059's preview, the authorisation text and ADR-0057's
 * content hash **required rather than optional** — they were built for exactly
 * this and, until now, nothing said they had to be used.
 */
export const DISCLOSE_DOCUMENT: LawfulBasisDeterminationRecord = determination(
  "b2-3-disclose",
  DISCLOSURE_ACTIVITY,
  "Sending a document the student has confirmed to the institution they applied to",
  [
    "passport",
    "national_id",
    "academic_transcript",
    "degree_certificate",
    "english_test_certificate",
    "personal_statement",
    "reference_letter",
    "birth_certificate",
    "other",
  ],
  "contract",
  true,
  "Article 6(1)(b), performance of a contract, for the basis — the disclosure is how the " +
    "application is made. AND specific student authorisation is required, because storing a " +
    "document and sending it are DIFFERENT ACTS, and the second is the one a student would expect " +
    "to be asked about. The preview a student reads (ADR-0059), the authorisation text and the " +
    "content hash that binds it (ADR-0057) already exist for exactly this; this determination " +
    "registers them as REQUIRED, not optional. Determined by Vahid Mohammadi, 2026-09-08.",
);

/**
 * 4 · A minor's route.
 *
 * Article 6(1)(a), **consent**, given by the parent or guardian, and specific
 * authorisation required. Vahid: *"Contract does not work here: a minor cannot
 * form one on the same footing, so the basis has to be consent and it has to
 * come from the guardian."*
 *
 * Note that this one names consent and therefore MUST require authorisation —
 * `determineLawfulBasis` refuses the contradiction, and here the two agree
 * because the consent is real: a guardian who declines is not a student who
 * loses their application, they are a case that does not proceed down this
 * route.
 */
export const MINOR_ROUTE: LawfulBasisDeterminationRecord = determination(
  "b2-4-minor",
  "store_document:minor_safeguarding",
  "Holding what a minor's application requires, on the guardian's consent",
  ["parental_consent", "guardianship_document", "birth_certificate"],
  "consent",
  true,
  "Article 6(1)(a), consent, given by the parent or guardian, AND specific authorisation " +
    "required. Contract does not work here: a minor cannot form one on the same footing, so the " +
    "basis has to be consent and it has to come from the guardian. This is the one activity where " +
    "consent is the honest description rather than the convenient one. " +
    "Determined by Vahid Mohammadi, 2026-09-08.",
);

/**
 * The four, in the order they were decided.
 *
 * `financial_evidence` is ABSENT ON PURPOSE. The bank statement is B1 row 12,
 * out of scope and blocking under ADR-0021, and ADR-0079 refused to give it an
 * expiry threshold for the same reason: an entry would make it look half-ready.
 * With no determination registered, `assertStorable` throws
 * `NoLawfulBasisError` for it — absence of a decision is not permission.
 */
export const B2_DETERMINATIONS: readonly LawfulBasisDeterminationRecord[] = [
  STORE_IDENTITY_DOCUMENT,
  STORE_ACADEMIC_DOCUMENT,
  DISCLOSE_DOCUMENT,
  MINOR_ROUTE,
];

/**
 * A register carrying the four, each validated on the way in.
 *
 * Throws rather than returning a partial register: a register missing a
 * determination because it silently failed validation is the thing that would
 * let storage proceed on a basis nobody checked.
 */
export function b2Register(now: Date): LawfulBasisRegister {
  const register = new LawfulBasisRegister();
  for (const record of B2_DETERMINATIONS) {
    const checked = determineLawfulBasis(record, now);
    if (!checked.valid) {
      throw new Error(
        `B2 determination ${record.determinationId} is not usable: ${checked.refusal.kind} — ` +
          `${checked.refusal.detail}`,
      );
    }
    register.register(checked.determination);
  }
  return register;
}

// ───────────────────────────────────────────────────────────────────────────
// What B2 decided NOT to determine
// ───────────────────────────────────────────────────────────────────────────

/**
 * An activity somebody looked at and decided no determination should be made.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * The retention side has had this distinction since ADR-0023 and the lawful
 * basis side did not. `RetentionPolicyMissingError` means NOBODY LOOKED;
 * `RetentionRequirementUnresolvedError` means somebody looked and could not
 * responsibly say. Both refuse, and they are different facts about the world.
 *
 * Against that, `NoLawfulBasisError` said one thing for two situations: an
 * activity awaiting a decision, and an activity whose decision IS this refusal.
 * A later phase reading the second as the first would "fix" it by registering a
 * determination — which is precisely the outcome the decision was made to
 * prevent.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export interface DecidedRefusal {
  /** The storing activity, in `storageActivityFor`'s vocabulary. */
  readonly activity: string;
  /** Named, as a determination is. A decision nobody owns is not a decision. */
  readonly decidedBy: string;
  readonly decidedAt: Date;
  /** Why no determination will be made — the part a later phase must read. */
  readonly reasoning: string;
}

export type DecidedRefusalRegister = Readonly<Record<string, DecidedRefusal>>;

/**
 * The activities B2 deliberately left without a determination.
 *
 * ── `other / audit_evidence` — B1 row 5, and the one that looked like a gap ──
 *
 * ADR-0087 measured every (type, purpose) pair through both gates and reported
 * this one as an OPEN QUESTION: a retention policy exists — six years from
 * `case_concluded` — and no storage determination does. Vahid closed it on
 * 2026-09-08, and the answer was that it is not a gap:
 *
 *   "The audit record is the transmission record, the preview hash and the
 *    authorisation text, not an uploaded document. Allowing a document to be
 *    stored under that purpose would extend the six-year period from a receipt
 *    to a passport scan, which is what ADR-0078 was written to prevent."
 *
 * That is a statement about the six-year period, not about documents in
 * general: the same passport is storable under `identity_verification` for 365
 * days after last use. The purpose is what carries the period, so a document
 * admitted under this one would be held for six years by the retention rule
 * doing exactly what it was told.
 */
export const DECIDED_NOT_TO_DETERMINE: DecidedRefusalRegister = {
  "store_document:audit_evidence": {
    activity: "store_document:audit_evidence",
    decidedBy: DETERMINED_BY,
    decidedAt: B2_DETERMINED_AT,
    reasoning:
      "Decided, not open (ADR-0088). The audit record IS the transmission record, the preview " +
      "hash and the authorisation text (ADR-0077) — not an uploaded document, so there is nothing " +
      "for a storage determination to be about. Admitting a document under this purpose would " +
      "extend B1 row 5's six-year period from a receipt to a passport scan, which is what " +
      "ADR-0078 was written to prevent. The period is carried by the PURPOSE, so the same passport " +
      "remains storable under identity_verification for 365 days after last use; it is this " +
      "purpose that must not accept one. Decided by Vahid Mohammadi, 2026-09-08. Do not close " +
      "this by registering a determination.",
  },
};

/** An activity whose refusal is a decision, not an absence. */
export class DeterminationDecidedAgainstError extends Error {
  public override readonly name = "DeterminationDecidedAgainstError";
  public constructor(public readonly refusal: DecidedRefusal) {
    super(
      `No lawful basis will be determined for "${refusal.activity}", and that is a DECISION ` +
        `rather than an omission. ${refusal.reasoning} Decided by ${refusal.decidedBy} on ` +
        `${refusal.decidedAt.toISOString().slice(0, 10)}.`,
    );
  }
}

/**
 * Throws when the activity's refusal was decided; silent otherwise.
 *
 * Silence here does NOT mean permission — it means this particular record has
 * nothing to say, and `requireLawfulBasis` still has to find a determination.
 */
export function assertNotDecidedAgainst(
  activity: string,
  register: DecidedRefusalRegister = DECIDED_NOT_TO_DETERMINE,
): void {
  const refusal = register[activity];
  if (refusal !== undefined) throw new DeterminationDecidedAgainstError(refusal);
}
