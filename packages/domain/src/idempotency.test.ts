/**
 * Tests for submission identity (ADR-0006, brief §4).
 *
 * "Duplicate submission is the characteristic catastrophic failure of this
 *  class of system and must be structurally impossible, not merely unlikely."
 */

import { describe, expect, it } from "vitest";

import { courseId, institutionId, intake, studentId } from "./ids.js";
import type { SubmissionIdentity } from "./idempotency.js";
import {
  idempotencyKey,
  identityForRetry,
  isIdempotencyKey,
  isSameSubmission,
  submissionKey,
} from "./idempotency.js";

const BASE: SubmissionIdentity = {
  studentId: studentId("stu_001"),
  institutionId: institutionId("inst_leeds"),
  courseId: courseId("crs_msc_data_science"),
  intake: intake("2027-09"),
  attemptOrdinal: 1,
};

describe("submission identity", () => {
  it("treats identical identities as the same submission", () => {
    expect(isSameSubmission(BASE, { ...BASE })).toBe(true);
  });

  it("is stable across repeated serialisation", () => {
    expect(submissionKey(BASE)).toBe(submissionKey({ ...BASE }));
  });

  it("distinguishes a different intake", () => {
    // Applying to the same course for a later intake is legitimate and must
    // produce a different key.
    const laterIntake = { ...BASE, intake: intake("2028-09") };
    expect(isSameSubmission(BASE, laterIntake)).toBe(false);
  });

  it("distinguishes a different course at the same institution", () => {
    // Two courses at one university, same intake — allowed, different keys.
    const otherCourse = { ...BASE, courseId: courseId("crs_msc_computer_science") };
    expect(isSameSubmission(BASE, otherCourse)).toBe(false);
  });

  it("distinguishes a different attempt ordinal", () => {
    const secondAttempt = { ...BASE, attemptOrdinal: 2 };
    expect(isSameSubmission(BASE, secondAttempt)).toBe(false);
  });

  it("distinguishes a different student", () => {
    const otherStudent = { ...BASE, studentId: studentId("stu_002") };
    expect(isSameSubmission(BASE, otherStudent)).toBe(false);
  });

  it("cannot be forged by ids containing separator-like characters", () => {
    // A printable separator would let "a:b" + "c" collide with "a" + "b:c".
    // The key uses a unit separator (U+001F) precisely to close that off.
    const a: SubmissionIdentity = {
      ...BASE,
      studentId: studentId("stu:001"),
      institutionId: institutionId("inst_leeds"),
    };
    const b: SubmissionIdentity = {
      ...BASE,
      studentId: studentId("stu"),
      institutionId: institutionId("001:inst_leeds"),
    };
    expect(submissionKey(a)).not.toBe(submissionKey(b));
  });

  it("rejects an attempt ordinal below 1", () => {
    expect(() => submissionKey({ ...BASE, attemptOrdinal: 0 })).toThrow(RangeError);
    expect(() => submissionKey({ ...BASE, attemptOrdinal: -1 })).toThrow(RangeError);
  });

  it("rejects a non-integer attempt ordinal", () => {
    expect(() => submissionKey({ ...BASE, attemptOrdinal: 1.5 })).toThrow(RangeError);
    expect(() => submissionKey({ ...BASE, attemptOrdinal: Number.NaN })).toThrow(RangeError);
  });
});

describe("retry behaviour — the guarantee", () => {
  it("gives a retry the same identity, always", () => {
    // FAILURE SCENARIO (brief §10): timeout and retry.
    //
    // This is the property that makes duplication structurally impossible. A
    // retry has no mechanism by which to produce a different key, so it
    // necessarily collides with the attempt already recorded — and the
    // collision is what stops it.
    const retried = identityForRetry(BASE);
    expect(isSameSubmission(BASE, retried)).toBe(true);
    expect(retried.attemptOrdinal).toBe(BASE.attemptOrdinal);
  });

  it("keeps the same identity across many retries", () => {
    let identity = BASE;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      identity = identityForRetry(identity);
    }
    expect(isSameSubmission(BASE, identity)).toBe(true);
    expect(identity.attemptOrdinal).toBe(1);
  });
});

describe("request-level idempotency keys", () => {
  it("accepts a UUID", () => {
    expect(isIdempotencyKey("9f2c1b7e-4a3d-4f1e-9c8b-2d5a7e0f1b3c")).toBe(true);
  });

  it("rejects keys that are too short to be unguessable", () => {
    expect(isIdempotencyKey("short")).toBe(false);
    expect(() => idempotencyKey("short")).toThrow(RangeError);
  });

  it("rejects keys containing characters that would need escaping in a header", () => {
    expect(isIdempotencyKey("has spaces in it here")).toBe(false);
    expect(isIdempotencyKey("has/slashes/in/it/here")).toBe(false);
  });

  it("rejects an over-long key", () => {
    expect(isIdempotencyKey("a".repeat(129))).toBe(false);
  });

  it("returns the branded value for a valid key", () => {
    const key = idempotencyKey("9f2c1b7e-4a3d-4f1e-9c8b-2d5a7e0f1b3c");
    expect(key).toBe("9f2c1b7e-4a3d-4f1e-9c8b-2d5a7e0f1b3c");
  });
});

describe("intake format", () => {
  it("accepts a valid year-month", () => {
    expect(intake("2027-09")).toBe("2027-09");
    expect(intake("2027-01")).toBe("2027-01");
    expect(intake("2027-12")).toBe("2027-12");
  });

  it("rejects a month outside 01-12", () => {
    expect(() => intake("2027-00")).toThrow(RangeError);
    expect(() => intake("2027-13")).toThrow(RangeError);
  });

  it("rejects a day component", () => {
    // Day precision would split one intake into many distinct keys, which
    // would quietly defeat the duplicate-submission guarantee.
    expect(() => intake("2027-09-01")).toThrow(RangeError);
  });

  it("rejects free-text intakes", () => {
    expect(() => intake("September 2027")).toThrow(RangeError);
    expect(() => intake("")).toThrow(RangeError);
  });
});
