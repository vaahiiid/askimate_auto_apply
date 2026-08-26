/**
 * Tests for the canonical profile and the typed field resolver.
 */

import { describe, expect, it } from "vitest";

import { proposeValue, isFieldUnavailable, studentId, unwrapConfirmed } from "@askimate/aas-domain";

import { applyConfirmation, isDeclined } from "./confirmation.js";
import type { ConfirmedField } from "./confirmation.js";
import type { ProfileFieldKey } from "./fields.js";
import {
  confirmField,
  confirmedFieldKeys,
  emptyProfile,
  hasField,
  missingFields,
  resolveField,
  resolveFieldWithValidity,
  revisionOf,
} from "./profile.js";

const NOW = new Date("2026-08-26T12:00:00Z");
const STUDENT = studentId("stu_001");

function confirmed<K extends ProfileFieldKey>(key: K, value: never, documentId?: string): ConfirmedField<K> {
  const result = applyConfirmation({
    key,
    proposed: proposeValue({
      value,
      origin: documentId === undefined ? "conversation" : "document",
      verbatim: "as stated",
      confidence: 0.95,
      ...(documentId !== undefined ? { documentId } : {}),
    }),
    confirmation: { studentRef: "stu_001", presentedText: "...", respondedAt: NOW, response: { kind: "accepted" } },
  });
  if (isDeclined(result)) throw new Error("fixture");
  return result;
}

describe("confirmed-only writes", () => {
  it("starts empty", () => {
    const profile = emptyProfile(STUDENT, NOW);
    expect(confirmedFieldKeys(profile)).toEqual([]);
    expect(hasField(profile, "identity.given_name")).toBe(false);
  });

  it("stores a confirmed field", () => {
    const profile = confirmField(
      emptyProfile(STUDENT, NOW),
      confirmed("identity.given_name", "Reza" as never),
      NOW,
    );
    expect(hasField(profile, "identity.given_name")).toBe(true);
  });

  it("has NO setter that takes a raw value", () => {
    // Confirmed-only writes is a property of the API, not a rule people
    // follow. `confirmField` accepts only what `applyConfirmation` produces.
    const profile = emptyProfile(STUDENT, NOW);
    // @ts-expect-error — a raw value is not a ConfirmedField.
    confirmField(profile, { key: "identity.given_name", value: "Reza" }, NOW);
    expect(true).toBe(true);
  });

  it("is immutable — writing returns a new profile", () => {
    const before = emptyProfile(STUDENT, NOW);
    const after = confirmField(before, confirmed("identity.given_name", "Reza" as never), NOW);

    expect(hasField(before, "identity.given_name")).toBe(false);
    expect(hasField(after, "identity.given_name")).toBe(true);
  });

  it("counts revisions, so corrections are visible", () => {
    let profile = emptyProfile(STUDENT, NOW);
    expect(revisionOf(profile, "identity.given_name")).toBe(0);

    profile = confirmField(profile, confirmed("identity.given_name", "Rezza" as never), NOW);
    expect(revisionOf(profile, "identity.given_name")).toBe(1);

    profile = confirmField(profile, confirmed("identity.given_name", "Reza" as never), NOW);
    expect(revisionOf(profile, "identity.given_name")).toBe(2);
  });
});

describe("the typed resolver", () => {
  it("returns the confirmed value when present", () => {
    const profile = confirmField(
      emptyProfile(STUDENT, NOW),
      confirmed("contact.email", "reza@example.com" as never),
      NOW,
    );

    const resolution = resolveField(profile, "contact.email");
    expect(isFieldUnavailable(resolution)).toBe(false);
    if (!isFieldUnavailable(resolution)) {
      expect(unwrapConfirmed(resolution)).toBe("reza@example.com");
    }
  });

  it("returns FieldUnavailable rather than a guess or a default", () => {
    // The stop-and-ask branch. Never an empty string standing in for "we don't
    // know" — that is how a blank reaches a university form.
    const resolution = resolveField(emptyProfile(STUDENT, NOW), "identity.passport_number");

    expect(isFieldUnavailable(resolution)).toBe(true);
    if (isFieldUnavailable(resolution)) {
      expect(resolution.reason).toBe("not_collected");
      expect(resolution.field).toBe("identity.passport_number");
    }
  });

  it("preserves the field's value type", () => {
    // Asking for date_of_birth gives ConfirmedValue<Date>, not <string>.
    const profile = confirmField(
      emptyProfile(STUDENT, NOW),
      confirmed("identity.date_of_birth", new Date("2008-04-02T00:00:00Z") as never),
      NOW,
    );

    const resolution = resolveField(profile, "identity.date_of_birth");
    if (!isFieldUnavailable(resolution)) {
      expect(unwrapConfirmed(resolution).getUTCFullYear()).toBe(2008);
    }
  });
});

describe("validity-aware resolution (brief §2.4)", () => {
  it("marks a field unavailable when its source document is no longer valid", () => {
    // The value is still CONFIRMED. But the bank statement behind it fell
    // outside its recency window, so it must not be reused silently — this is
    // the exact failure the system exists to prevent.
    const profile = confirmField(
      emptyProfile(STUDENT, NOW),
      confirmed("finance.available_funds", { amountMinorUnits: 2_500_000, currency: "GBP" } as never, "doc_stale"),
      NOW,
    );

    const stillValid = resolveFieldWithValidity(profile, "finance.available_funds", new Set());
    expect(isFieldUnavailable(stillValid)).toBe(false);

    const nowStale = resolveFieldWithValidity(profile, "finance.available_funds", new Set(["doc_stale"]));
    expect(isFieldUnavailable(nowStale)).toBe(true);
    if (isFieldUnavailable(nowStale)) expect(nowStale.reason).toBe("source_expired");
  });

  it("leaves conversationally sourced fields alone", () => {
    // No document behind it, so no document can invalidate it.
    const profile = confirmField(
      emptyProfile(STUDENT, NOW),
      confirmed("identity.given_name", "Reza" as never),
      NOW,
    );
    expect(isFieldUnavailable(resolveFieldWithValidity(profile, "identity.given_name", new Set(["doc_x"])))).toBe(false);
  });
});

describe("driving the interview", () => {
  it("reports which required fields are still missing", () => {
    // What the agent asks about next. Not a form — a list of questions.
    const profile = confirmField(
      emptyProfile(STUDENT, NOW),
      confirmed("identity.given_name", "Reza" as never),
      NOW,
    );

    const required: readonly ProfileFieldKey[] = [
      "identity.given_name",
      "identity.family_name",
      "contact.email",
    ];
    expect(missingFields(profile, required)).toEqual(["identity.family_name", "contact.email"]);
  });

  it("reports nothing missing once everything is confirmed", () => {
    let profile = emptyProfile(STUDENT, NOW);
    profile = confirmField(profile, confirmed("identity.given_name", "Reza" as never), NOW);
    profile = confirmField(profile, confirmed("identity.family_name", "Hosseini" as never), NOW);

    expect(missingFields(profile, ["identity.given_name", "identity.family_name"])).toEqual([]);
  });
});
