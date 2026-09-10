/**
 * Where the runner gets a document from: the plane, under its lease, then the
 * bucket — and the gates, again, before `executePlan` sees a byte.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ADR-0099, slice c of the attachment path. The plan crossed with uploads as
 * REFERENCES (which box, which document the mapping named, where the box is).
 * This is the other half: for each reference, ask the plane, and the plane
 * answers with a sixty-second retrieval URL and the disclosure record its own
 * gates ran — or refuses. This process holds no vault credential (ADR-0042)
 * and is forbidden `@askimate/aas-documents`; it holds a URL for a minute.
 *
 * ── The gate twice, on two machines ───────────────────────────────────────
 *
 * `AuthorisedDocument.authorisation` is a brand only `authoriseDisclosure` can
 * mint, and that is the point of the brand (ADR-0022): a document is not sent
 * because it EXISTS but because somebody decided it should be, and the
 * decision is re-checked here — same record, same register, this process. A
 * cast would satisfy the type and defeat it. `executePlan` then runs
 * `mayTransmit` with the case at the moment of attaching, as it always has.
 *
 * ── What is refused here, and how ─────────────────────────────────────────
 *
 * Every refusal answers `null`, which `executePlan` reports as a named
 * failure on the upload's field — never a throw. The plane's reason for a
 * refusal is the plane's; this process's answer to all of them is that the
 * work needs a person. Refused: the plane's refusal; a retrieval that did not
 * answer 200; bytes that do not hash to what the plane said; a determination
 * this register does not hold; a record `authoriseDisclosure` refuses.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { createHash } from "node:crypto";

import type { ClaimedWork } from "@askimate/aas-contracts";
import {
  DISCLOSURE_ACTIVITY,
  authoriseDisclosure,
  determinationOf,
} from "@askimate/aas-disclosure";
import type { DisclosureRequestRecord, LawfulBasisRegister } from "@askimate/aas-disclosure";
import { studentId } from "@askimate/aas-domain";
import type { AuthorisedDocument, DocumentSource } from "@askimate/aas-execution";

import type { WorkIntake } from "./work-intake.js";

export interface DocumentSourceOptions {
  readonly intake: Pick<WorkIntake, "document">;
  readonly work: Pick<ClaimedWork, "runId" | "leaseId" | "caseId">;
  /** The same register the plane read from — in code, not on the wire. */
  readonly register: LawfulBasisRegister;
  readonly fetch?: typeof globalThis.fetch;
}

export function documentSourceFor(options: DocumentSourceOptions): DocumentSource {
  const doFetch = options.fetch ?? globalThis.fetch;
  return async (documentRef: string): Promise<AuthorisedDocument | null> => {
    const handed = await options.intake.document(options.work.runId, options.work.leaseId, documentRef);
    if (handed === null) return null;

    // The plane's record must be about THIS work. A record naming another
    // case is refused before a byte is fetched — `mayTransmit` would refuse it
    // too, but there is no reason to hold the bytes first.
    if (handed.disclosure.subject.caseId !== options.work.caseId) return null;

    let response: Response;
    try {
      response = await doFetch(handed.retrieval.url, { method: handed.retrieval.method });
    } catch {
      return null;
    }
    if (!response.ok) return null;
    const contents = new Uint8Array(await response.arrayBuffer());
    const contentHash = createHash("sha256").update(contents).digest("hex");
    if (contentHash !== handed.contentHash) return null;

    const determination = options.register.forActivity(DISCLOSURE_ACTIVITY);
    if (determination === undefined) return null;
    if (determinationOf(determination).determinationId !== handed.disclosure.determinationId) return null;

    const record: DisclosureRequestRecord = {
      disclosureId: handed.disclosure.disclosureId,
      subject: handed.disclosure.subject,
      destination: handed.disclosure.destination,
      determination,
      studentAuthorisation: {
        studentRef: studentId(handed.disclosure.studentAuthorisation.studentRef),
        presentedText: handed.disclosure.studentAuthorisation.presentedText,
        authorisedAt: new Date(handed.disclosure.studentAuthorisation.authorisedAt),
        method: handed.disclosure.studentAuthorisation.method,
      },
    };
    const check = authoriseDisclosure(record);
    if (!check.authorised) return null;

    return { documentId: handed.documentId, contents, contentHash, authorisation: check.authorisation };
  };
}
