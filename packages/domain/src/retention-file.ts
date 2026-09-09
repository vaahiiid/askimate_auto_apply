/**
 * Reading a retention schedule from its file form.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Until P61 this parser lived in `scripts/retention-status.ts`, which is the
 * command that reports on a schedule. Production had no way to load one: the
 * Conversation Service's document transport took a `RetentionSchedule` and
 * nothing in the process could produce it, which is why the transport ran
 * only in tests. The parser moves here — PURE, a string in and a schedule
 * out, no file system — so the script and the service read the same file the
 * same way, and a schedule that loads in one loads in the other.
 *
 * ── A cast is not a check ─────────────────────────────────────────────────
 *
 * `documentType` is checked against the real union (`isDocumentType`) rather
 * than cast. A policy naming a type that does not exist — `national_id` since
 * ADR-0089 — is reported as OUT OF SCOPE rather than loaded as a lie. The
 * remaining fields are read strictly where a wrong value would be silent
 * (`reliesOnLegalClaims` defaults to the value that FAILS validation).
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type {
  DocumentType,
  RetentionDetermination,
  RetentionObligation,
  RetentionPurpose,
  RetentionSchedule,
  UnresolvedRetentionRequirement,
} from "./retention.js";
import { isDocumentType } from "./retention.js";

/** A policy row naming a document type this system no longer has. Reported, not loaded. */
export interface OutOfScopeRow {
  readonly documentType: string;
  readonly purpose: string;
  readonly policyReference: string;
}

export interface ParsedSchedule {
  readonly schedule: RetentionSchedule;
  /** Rows naming a document type outside `DOCUMENT_TYPES`, kept for the report. */
  readonly outOfScope: readonly OutOfScopeRow[];
}

/**
 * Parses one schedule file's text. `file` names it in every refusal.
 *
 * Throws on a malformed file. Does NOT validate the schedule's content —
 * `validateSchedule` does that, and a caller decides what a problem means.
 */
export function parseRetentionSchedule(raw: string, file: string): ParsedSchedule {
  const parsed = JSON.parse(raw) as Record<string, unknown>;

  /** A required string field. Refuses anything else rather than stringifying it. */
  const text = (value: unknown, field: string): string => {
    if (typeof value !== "string") {
      throw new Error(`${file}: "${field}" must be a string, got ${typeof value}.`);
    }
    return value;
  };

  const date = (value: unknown, field: string): Date => {
    if (typeof value !== "string") {
      throw new Error(`${file}: "${field}" must be an ISO date string.`);
    }
    const asDate = new Date(value);
    if (Number.isNaN(asDate.getTime())) throw new Error(`${file}: "${field}" is not a date.`);
    return asDate;
  };

  const allPolicies = (parsed["policies"] as Record<string, unknown>[] | undefined) ?? [];

  // ── A CAST IS NOT A CHECK ──────────────────────────────────────────────
  //
  // This line used to read `policy["documentType"] as DocumentType`, which
  // would have accepted any string in the file and typed it as a lie — a
  // schedule naming a document type that does not exist would have loaded,
  // validated and reported as a set period. ADR-0089 found it while removing a
  // union member, which is exactly the case the cast could not see.
  const outOfScope: OutOfScopeRow[] = [];
  const policies: Record<string, unknown>[] = [];
  for (const policy of allPolicies) {
    const documentType = text(policy["documentType"], "documentType");
    if (isDocumentType(documentType)) {
      policies.push(policy);
    } else {
      outOfScope.push({
        documentType,
        purpose: text(policy["purpose"], "purpose"),
        policyReference: text(policy["policyReference"], "policyReference"),
      });
    }
  }
  const unresolved = (parsed["unresolved"] as Record<string, unknown>[] | undefined) ?? [];
  const determinations = (parsed["determinations"] as Record<string, unknown>[] | undefined) ?? [];
  const obligations = (parsed["obligations"] as Record<string, unknown>[] | undefined) ?? [];

  const schedule: RetentionSchedule = {
    version: text(parsed["version"], "version"),
    approvedAt: date(parsed["approvedAt"], "approvedAt"),
    approvedBy: text(parsed["approvedBy"], "approvedBy"),
    effectiveFrom: date(parsed["effectiveFrom"], "effectiveFrom"),
    ...(typeof parsed["supersedes"] === "string" ? { supersedes: parsed["supersedes"] } : {}),
    policies: policies.map((policy) => ({
      documentType: text(policy["documentType"], "documentType") as DocumentType,
      purpose: policy["purpose"] as RetentionPurpose,
      trigger: policy["trigger"] as RetentionSchedule["policies"][number]["trigger"],
      retainForDays: Number(policy["retainForDays"]),
      action: policy["action"] as "delete" | "anonymise",
      erasureBehaviour: policy["erasureBehaviour"] as
        | "full"
        | "redact_contents"
        | "retain_for_legal_obligation",
      ...(typeof policy["legalBasis"] === "string" ? { legalBasis: policy["legalBasis"] } : {}),
      policyReference: text(policy["policyReference"], "policyReference"),
      ...(Array.isArray(policy["obligations"])
        ? { obligations: policy["obligations"] as readonly string[] }
        : {}),
      reviewBy: date(policy["reviewBy"], "reviewBy"),
      basis: {
        kind: (policy["basis"] as Record<string, unknown>)["kind"] as
          | "legal_requirement"
          | "operational_requirement"
          | "policy_decision",
        statement: text((policy["basis"] as Record<string, unknown>)["statement"], "basis.statement"),
        authoritativeSource: text(
          (policy["basis"] as Record<string, unknown>)["authoritativeSource"],
          "basis.authoritativeSource",
        ),
        verifiedBy: text((policy["basis"] as Record<string, unknown>)["verifiedBy"], "basis.verifiedBy"),
        verifiedAt: date(
          (policy["basis"] as Record<string, unknown>)["verifiedAt"],
          "basis.verifiedAt",
        ),
        // Read strictly, and DEFAULTED TO TRUE when absent or not a boolean.
        //
        // The safe default is the one that fails validation. A schedule that
        // omits the declaration is one nobody has thought about, and reading
        // that as "no, it does not rely on legal claims" would let exactly the
        // period this determination exists to prevent pass unremarked.
        reliesOnLegalClaims:
          (policy["basis"] as Record<string, unknown>)["reliesOnLegalClaims"] !== false,
      },
    })),
    unresolved: unresolved.map(
      (entry): UnresolvedRetentionRequirement => ({
        documentType: entry["documentType"] as DocumentType,
        purpose: entry["purpose"] as RetentionPurpose,
        question: text(entry["question"], "question"),
        authoritativeSourceNeeded: text(entry["authoritativeSourceNeeded"], "authoritativeSourceNeeded"),
        expectedBasisKind: entry["expectedBasisKind"] as UnresolvedRetentionRequirement["expectedBasisKind"],
        owner: text(entry["owner"], "owner"),
        raisedBy: text(entry["raisedBy"], "raisedBy"),
        raisedAt: date(entry["raisedAt"], "raisedAt"),
      }),
    ),
    determinations: determinations.map(
      (entry): RetentionDetermination => ({
        id: text(entry["id"], "determination.id"),
        question: text(entry["question"], "determination.question"),
        answer: text(entry["answer"], "determination.answer"),
        reasoning: text(entry["reasoning"], "determination.reasoning"),
        determinedBy: text(entry["determinedBy"], "determination.determinedBy"),
        determinedAt: date(entry["determinedAt"], "determination.determinedAt"),
      }),
    ),
    obligations: obligations.map(
      (entry): RetentionObligation => ({
        id: text(entry["id"], "obligation.id"),
        statement: text(entry["statement"], "obligation.statement"),
        dueBefore: text(entry["dueBefore"], "obligation.dueBefore"),
        owner: text(entry["owner"], "obligation.owner"),
        raisedAt: date(entry["raisedAt"], "obligation.raisedAt"),
      }),
    ),
  };

  return { schedule, outOfScope };
}
