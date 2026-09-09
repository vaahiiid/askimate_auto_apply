/**
 * The transport: how a student's bytes arrive, and what has to be true first.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * B4, open since the document boundary was drawn (ADR-0067 §8): *"There is no
 * route, no schema and no client surface by which a student could supply a
 * document."* Every policy blocker in front of it is now answered — B5
 * (ADR-0078), B1's eleven periods, B2's four determinations (ADR-0087), and
 * the two things that followed (ADR-0088, ADR-0089).
 *
 * ── The property this file exists for ─────────────────────────────────────
 *
 *     THE GATES RUN BEFORE A SINGLE BYTE IS ACCEPTED.
 *
 * Not "before the bytes are stored" — before they are *accepted*. An upload is
 * a TWO-STEP exchange: the student declares what they are about to send, that
 * declaration goes through `assertStorable`, and only then does a route exist
 * that will read a body at all.
 *
 * The structure is what enforces it, not the order of statements in a handler:
 * `openIntake` takes a `StorableUpload`, which only `assertStorable` can mint
 * (ADR-0068). There is no way to obtain an intake without the retention policy
 * and the lawful basis having been established for that exact document.
 *
 * ── Since ADR-0092 the bytes never arrive here at all ─────────────────────
 *
 * The second step used to be a PUT to this service, checked by `acceptBytes`.
 * Now the declaration answers with a pre-signed upload the browser sends the
 * bytes on, straight to the bucket, and S3 performs the hash check the upload
 * URL's signature binds it to (ADR-0093). `acceptBytes` is retired; the
 * declaration and the gates in front of it are unchanged.
 *
 * ── Why not one request with the metadata alongside the bytes ─────────────
 *
 * Because the server would have to read the body to find out whether it was
 * allowed to. A refusal that arrives after a passport has crossed the wire has
 * already failed: the bytes were received, they were in a process's memory,
 * and "we did not keep them" is a claim rather than a structure.
 *
 * It also lets the server STATE the constraints — the exact byte ceiling, the
 * accepted content types, the hash it will check — instead of a client
 * guessing and being refused. ADR-0075's rule, one layer out: a refusal a
 * person cannot act on is a defect.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { DocumentType } from "@askimate/aas-domain";

import type { StorableUpload } from "./vault.js";

/** Opaque handle to an opened intake. Travels; contents do not. */
export type IntakeId = string;

/**
 * How long an opened intake stays open.
 *
 * Short, because an intake is a standing permission to send bytes and the
 * student is on the other end of it right now. Long enough for a slow upload
 * on a bad connection, and nowhere near long enough to be a queue.
 */
export const INTAKE_TTL_MS = 15 * 60 * 1000;

/**
 * What a document type may arrive as, and how much of it.
 *
 * ── Total over `DocumentType`, and that is the point ──────────────────────
 *
 * `as const satisfies Record<DocumentType, …>` — a type added to the union and
 * not to this table does not compile. The alternative, a default ceiling for
 * anything unlisted, is the shape ADR-0023 refuses: a limit nobody chose,
 * applied to a document nobody thought about.
 *
 * The ceilings are deliberately unequal. A personal statement is text and a
 * transcript is a scan of several pages; giving the statement the scan's
 * ceiling would mean accepting a 20 MB "personal statement" without anyone
 * having decided that was reasonable.
 *
 * These are ENGINEERING limits, not policy: they bound what a request may cost
 * this system. They are not a judgement about the document, and they are not a
 * determination — nothing here needs Vahid's name on it.
 */
export const DOCUMENT_LIMITS = {
  passport: { maxBytes: 10 * 1024 * 1024, contentTypes: ["application/pdf", "image/jpeg", "image/png"] },
  birth_certificate: { maxBytes: 10 * 1024 * 1024, contentTypes: ["application/pdf", "image/jpeg", "image/png"] },
  bank_statement: { maxBytes: 10 * 1024 * 1024, contentTypes: ["application/pdf"] },
  sponsorship_letter: { maxBytes: 10 * 1024 * 1024, contentTypes: ["application/pdf"] },
  academic_transcript: { maxBytes: 20 * 1024 * 1024, contentTypes: ["application/pdf"] },
  degree_certificate: { maxBytes: 10 * 1024 * 1024, contentTypes: ["application/pdf", "image/jpeg", "image/png"] },
  english_test_certificate: { maxBytes: 10 * 1024 * 1024, contentTypes: ["application/pdf"] },
  personal_statement: { maxBytes: 2 * 1024 * 1024, contentTypes: ["application/pdf"] },
  reference_letter: { maxBytes: 5 * 1024 * 1024, contentTypes: ["application/pdf"] },
  parental_consent: { maxBytes: 5 * 1024 * 1024, contentTypes: ["application/pdf", "image/jpeg", "image/png"] },
  guardianship_document: { maxBytes: 10 * 1024 * 1024, contentTypes: ["application/pdf"] },
  visa_document: { maxBytes: 10 * 1024 * 1024, contentTypes: ["application/pdf", "image/jpeg", "image/png"] },
  other: { maxBytes: 10 * 1024 * 1024, contentTypes: ["application/pdf"] },
} as const satisfies Record<
  DocumentType,
  { readonly maxBytes: number; readonly contentTypes: readonly string[] }
>;

export interface DocumentLimit {
  readonly maxBytes: number;
  readonly contentTypes: readonly string[];
}

export function limitFor(documentType: DocumentType): DocumentLimit {
  return DOCUMENT_LIMITS[documentType];
}

/**
 * An opened intake: permission to send exactly one document, once.
 *
 * `upload` is the branded `StorableUpload`, carried rather than re-derived, so
 * the record of WHICH determination and WHICH retention policy were relied on
 * travels with the permission they granted.
 */
export interface DocumentIntake {
  readonly intakeId: IntakeId;
  readonly conversationId: string;
  readonly upload: StorableUpload;
  /** SHA-256 the student declared. The received bytes must hash to this. */
  readonly declaredHash: string;
  readonly declaredSizeBytes: number;
  readonly contentType: string;
  readonly openedAt: Date;
  readonly expiresAt: Date;
}

/** Why an intake could not be opened or could not be spent. */
export class IntakeRefusedError extends Error {
  public override readonly name = "IntakeRefusedError";
  public constructor(
    /** The published problem code a route should answer with. */
    public readonly code:
      | "unsupported_media_type"
      | "payload_too_large"
      | "content_hash_mismatch"
      | "intake_not_open"
      | "upload_not_received"
      | "validation_failed",
    message: string,
  ) {
    super(message);
  }
}

/**
 * Opens an intake for an upload that has already passed the storage gates.
 *
 * Takes `StorableUpload` and nothing looser. That signature is the control:
 * a caller cannot reach this without `assertStorable` having run on this exact
 * document type and purpose (ADR-0068).
 */
export function openIntake(input: {
  readonly intakeId: IntakeId;
  readonly conversationId: string;
  readonly upload: StorableUpload;
  readonly contentType: string;
  readonly declaredSizeBytes: number;
  readonly now: Date;
}): DocumentIntake {
  const limit = limitFor(input.upload.documentType);

  if (!limit.contentTypes.includes(input.contentType)) {
    throw new IntakeRefusedError(
      "unsupported_media_type",
      `A ${input.upload.documentType} may be sent as ${limit.contentTypes.join(" or ")}. ` +
        `This upload declares ${input.contentType}. The type is checked here, before any body is ` +
        `read, so a file we cannot accept is never received.`,
    );
  }

  if (!Number.isSafeInteger(input.declaredSizeBytes) || input.declaredSizeBytes <= 0) {
    throw new IntakeRefusedError(
      "validation_failed",
      `An upload must declare a positive size in bytes. This one declares ` +
        `${String(input.declaredSizeBytes)}.`,
    );
  }

  if (input.declaredSizeBytes > limit.maxBytes) {
    throw new IntakeRefusedError(
      "payload_too_large",
      `A ${input.upload.documentType} may be up to ${String(limit.maxBytes)} bytes. This upload ` +
        `declares ${String(input.declaredSizeBytes)}. Refused before it was sent, so the student ` +
        `is not asked to wait for an upload that was never going to be accepted.`,
    );
  }

  if (!/^[0-9a-f]{64}$/.test(input.upload.contentHash)) {
    throw new IntakeRefusedError(
      "validation_failed",
      `An upload must declare the SHA-256 of its contents as 64 lowercase hex characters.`,
    );
  }

  return {
    intakeId: input.intakeId,
    conversationId: input.conversationId,
    upload: input.upload,
    declaredHash: input.upload.contentHash,
    declaredSizeBytes: input.declaredSizeBytes,
    contentType: input.contentType,
    openedAt: input.now,
    expiresAt: new Date(input.now.getTime() + INTAKE_TTL_MS),
  };
}
