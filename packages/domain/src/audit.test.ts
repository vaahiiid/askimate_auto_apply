/**
 * Tests for the audit log and its redaction guarantee (brief §8).
 *
 * "Redact personal data from logs by default. Audit records may reference
 *  document IDs, not document contents."
 */

import { describe, expect, it } from "vitest";

import { auditEntry, auditLabel, auditRef, AuditRedactionError, type RedactedDetail } from "./audit.js";
import { caseId } from "./ids.js";
import { describeRedacted, redact } from "./redaction.js";

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
    const record = entry({ selector: auditLabel("#continue"), step: 3 });

    expect(record.component).toBe("browser-runner");
    expect(record.action).toBe("dom_action");
    expect(record.outcome).toBe("success");
    expect(record.detail?.["selector"]).toBe("#continue");
  });

  it("allows a document ID", () => {
    // Explicitly permitted: IDs yes, contents no.
    const record = entry({ documentId: auditRef("doc_abc123"), pages: 2 });
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
    expect(() => entry({ [key]: auditLabel("anything") })).toThrow(AuditRedactionError);
  });

  it("refuses regardless of casing", () => {
    expect(() => entry({ PASSWORD: auditLabel("x") })).toThrow(AuditRedactionError);
    expect(() => entry({ Access_Token: auditLabel("x") })).toThrow(AuditRedactionError);
  });

  it("still allows passport_id, which is a reference not a document", () => {
    // The distinction the brief draws: IDs are fine, contents are not.
    expect(() => entry({ passport_id: auditRef("doc_123") })).not.toThrow();
  });

  it("throws rather than silently dropping the key", () => {
    // A silent drop would make a leak look like a successful write. Being
    // noisy in development is the whole point of this control.
    expect(() => entry({ password: auditLabel("hunter2") })).toThrow(/must not be logged/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The gap this type closes
// ───────────────────────────────────────────────────────────────────────────

describe("plaintext personal data cannot reach an audit record", () => {
  it("REFUSES an unwrapped confirmed value, even under an innocuous key", () => {
    // The hole `RedactedDetail` used to have. The old type was
    // `string | number | boolean | null`, on the reasoning that a
    // ConfirmedValue is an object and cannot satisfy it. True — but
    // `unwrapConfirmed(value)` is a string, and the runtime key check only
    // looks at KEYS. `{ answer: … }` is an innocuous key holding a passport
    // number, and it type-checked.
    const passportNumber: string = "TEST-PASSPORT-987654";

    // @ts-expect-error a bare string is not AuditSafeText. Widening
    // RedactedDetail back to `string` makes this directive unused and fails
    // the build.
    const detail: RedactedDetail = { answer: passportNumber };
    expect(detail).toBeDefined();
  });

  it("REFUSES a runtime string even through auditLabel", () => {
    const runtimeValue: string = "TEST-DOB-2000-01-01";

    // @ts-expect-error auditLabel takes a string LITERAL. A runtime value has
    // widened to `string`, and `string extends T ? never : T` refuses it. That
    // is the whole control: a personal value is never a literal in the source.
    auditLabel(runtimeValue);
  });

  it("accepts a literal, which is how a fixed reason is recorded", () => {
    expect(auditLabel("blueprint_not_executable")).toBe("blueprint_not_executable");
  });

  it("accepts an identifier through auditRef", () => {
    expect(auditRef("doc_abc123")).toBe("doc_abc123");
    expect(auditRef(caseId("case-1"))).toBe("case-1");
  });

  it("REFUSES prose through auditRef, because prose is content", () => {
    // The obvious way round `auditRef` would be to pass a sentence. An
    // identifier has no spaces; a personal statement has many.
    expect(() => auditRef("I have always wanted to study international business")).toThrow(
      AuditRedactionError,
    );
  });

  it("REFUSES an over-long reference, because that is content too", () => {
    expect(() => auditRef("x".repeat(129))).toThrow(AuditRedactionError);
  });

  it("accepts a value's SHAPE, which is what a diagnostic actually needs", () => {
    const shape = describeRedacted(redact("TEST-SECRET-PASSWORD-123!"));
    const detail: RedactedDetail = { submitted: shape };
    expect(String(detail["submitted"])).toContain("[redacted");
    expect(String(detail["submitted"])).not.toContain("TEST-SECRET");
  });
});
