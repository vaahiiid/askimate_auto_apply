/**
 * Tests for the audit log and its redaction guarantee (brief §8).
 *
 * "Redact personal data from logs by default. Audit records may reference
 *  document IDs, not document contents."
 */

import { describe, expect, it } from "vitest";

import { auditEntry, AuditRedactionError, type RedactedDetail } from "./audit.js";
import { caseId } from "./ids.js";

const CASE = caseId("case_001");
const AT = new Date("2026-08-26T12:00:00Z");

function entry(detail?: RedactedDetail) {
  return auditEntry({
    caseId: CASE,
    at: AT,
    action: "dom_action",
    outcome: "success",
    component: "browser-runner",
    summary: "Clicked continue",
    ...(detail !== undefined ? { detail } : {}),
  });
}

describe("audit entries", () => {
  it("records what the system did", () => {
    const record = entry({ selector: "#continue", step: 3 });

    expect(record.component).toBe("browser-runner");
    expect(record.action).toBe("dom_action");
    expect(record.outcome).toBe("success");
    expect(record.detail?.["selector"]).toBe("#continue");
  });

  it("allows a document ID", () => {
    // Explicitly permitted: IDs yes, contents no.
    const record = entry({ documentId: "doc_abc123", pages: 2 });
    expect(record.detail?.["documentId"]).toBe("doc_abc123");
  });

  it("omits absent optional fields entirely", () => {
    const record = entry();
    expect("detail" in record).toBe(false);
    expect("runId" in record).toBe(false);
  });
});

describe("redaction — refusing sensitive keys", () => {
  it.each([
    "password",
    "passphrase",
    "apiSecret",
    "access_token",
    "credential",
    "authorization",
    "cookie",
    "sessionId",
    "passportNumber",
    "iban",
    "account_number",
    "sortCode",
    "cardNumber",
    "cvv",
    "dob",
    "date_of_birth",
  ])("refuses the key %s", (key) => {
    expect(() => entry({ [key]: "anything" })).toThrow(AuditRedactionError);
  });

  it("refuses regardless of casing", () => {
    expect(() => entry({ PASSWORD: "x" })).toThrow(AuditRedactionError);
    expect(() => entry({ Access_Token: "x" })).toThrow(AuditRedactionError);
  });

  it("still allows passport_id, which is a reference not a document", () => {
    // The distinction the brief draws: IDs are fine, contents are not.
    expect(() => entry({ passport_id: "doc_123" })).not.toThrow();
  });

  it("throws rather than silently dropping the key", () => {
    // A silent drop would make a leak look like a successful write. Being
    // noisy in development is the whole point of this control.
    expect(() => entry({ password: "hunter2" })).toThrow(/must not be logged/);
  });
});
