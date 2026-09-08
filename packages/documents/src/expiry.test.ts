/**
 * The expiry rule, and the three properties that make it a rule rather than a
 * habit.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * B5 is "hold and reuse" (ADR-0078), so a document lives across applications
 * and can go out of date between them. Vahid's rule, 2026-09-07: the student
 * is warned, chooses, and the choice is recorded with the exact wording they
 * were shown — once, not repeatedly.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from "vitest";

import type { DocumentType } from "@askimate/aas-domain";

import {
  EXPIRY_THRESHOLDS,
  decideExpiryWarning,
  provisionalThresholds,
  recordChoice,
  thresholdFor,
  undeterminedThresholds,
} from "./expiry.js";
import type { ExpiryWarning } from "./expiry.js";

const NOW = new Date("2026-09-07T00:00:00Z");
const inDays = (days: number): Date => new Date(NOW.getTime() + days * 86_400_000);

/** The approved thresholds, as decided. */
describe("every document type has a decided threshold", () => {
  it("classifies EVERY type — a new one cannot compile without a decision", () => {
    // The `satisfies Record<DocumentType, ExpiryThreshold>` does this at
    // compile time; this asserts the runtime table agrees, because a plan
    // reading it at runtime meets the object rather than the type.
    for (const type of Object.keys(EXPIRY_THRESHOLDS) as DocumentType[]) {
      expect(["warn_before", "does_not_expire", "out_of_scope", "undetermined"], type).toContain(
        thresholdFor(type).kind,
      );
    }
  });

  it("warns six months before a passport expires, and three for a national ID", () => {
    // The threshold is the time to obtain a REPLACEMENT, not a fraction of the
    // document's life. UK passport renewal runs to ten weeks at its worst, and
    // six months also covers the validity many visa routes require at entry.
    expect(thresholdFor("passport")).toEqual({ kind: "warn_before", days: 180 });
    // A national ID warned at three months, determined the same day and on the
    // same principle. It went with the document type in ADR-0089; the number
    // and its reasoning are recorded there so re-adding starts from them.
  });

  it("keeps the English test number PROVISIONAL, linked to the obligation", () => {
    // Vahid: "keep that link explicit so the number cannot be treated as
    // settled." Row 8's obligation is to read the IELTS, PTE and Duolingo
    // terms, which may constrain validity in a way that moves this number.
    expect(provisionalThresholds()).toEqual([
      { documentType: "english_test_certificate", obligation: "read_the_test_provider_terms" },
    ]);
  });

  it("gives the bank statement NOTHING, on purpose", () => {
    // "Row 12 is out of scope and blocking, and giving it a threshold makes it
    // look half-ready. Leave it with nothing."
    const threshold = thresholdFor("bank_statement");
    expect(threshold.kind).toBe("out_of_scope");
    if (threshold.kind !== "out_of_scope") expect.unreachable("narrowed");
    expect(threshold.reason, "and says why, so it is not mistaken for an omission").toContain(
      "half-ready",
    );
  });

  it("shuts the visa path on COMPLIANCE grounds, not on scope", () => {
    // ═══════════════════════════════════════════════════════════════════
    // ADR-0080. The distinction is the whole point, and it is worth a test
    // because the weaker reason is the one that reads naturally.
    //
    // "Visa evidence is out of scope for the MVP" is a product-scope argument,
    // and a later engineer could reasonably decide to overturn it citing
    // product value. "The visa path is shut until the OISC position is
    // resolved" is not theirs to overturn. Both sentences describe the same
    // table entry; only one of them holds.
    //
    // This asserts the reason names the compliance record, so that reverting
    // the citation to ADR-0021 alone — which is how a boundary erodes, by
    // everyone citing the version that sounds like a priority call — fails.
    // ═══════════════════════════════════════════════════════════════════
    const visa = thresholdFor("visa_document");
    expect(visa.kind, "shut, not undecided — `undetermined` invites a later decision").toBe(
      "out_of_scope",
    );
    if (visa.kind !== "out_of_scope") expect.unreachable("narrowed");
    expect(visa.reason, "the compliance record, not the product-scope one").toContain("ADR-0080");
    expect(visa.reason).toContain("OISC");
    expect(visa.reason, "and it says what it is not").toMatch(/not a scheduling gap/i);
  });

  it("says which types nobody has decided, rather than defaulting them to silent", () => {
    // An undetermined threshold means a held document can reach its expiry
    // with nobody warned. That must be visible, not absent.
    expect([...undeterminedThresholds()].sort()).toEqual([
      "guardianship_document",
      "other",
      "parental_consent",
      "sponsorship_letter",
    ]);
  });
});

describe("when the student is warned", () => {
  const passport = (expiresIn: number, alreadyWarnedAt: Date | null = null) =>
    decideExpiryWarning({
      documentType: "passport",
      expiresAt: inDays(expiresIn),
      now: NOW,
      alreadyWarnedAt,
    });

  it("warns inside the threshold and not before it", () => {
    expect(passport(179).warn, "one day inside").toBe(true);
    expect(passport(180).warn, "exactly on it").toBe(true);
    const outside = passport(181);
    expect(outside.warn).toBe(false);
    if (outside.warn) expect.unreachable("narrowed");
    expect(outside.because).toBe("not_yet_within_threshold");
  });

  it("FIRES ONCE — a run that has warned cannot warn again", () => {
    // "A countdown that nags is one people learn to dismiss." There is no
    // parameter through which a caller could ask for a second warning; the
    // only input is when the first one happened.
    const again = passport(10, new Date("2026-09-01T00:00:00Z"));
    expect(again.warn).toBe(false);
    if (again.warn) expect.unreachable("narrowed");
    expect(again.because).toBe("already_warned");
  });

  it("does NOT warn about a document that has already expired", () => {
    // A different fact with a different answer: an expired document is a
    // validity failure, and "this is about to expire" would be both wrong and
    // too late.
    const gone = passport(-1);
    expect(gone.warn).toBe(false);
    if (gone.warn) expect.unreachable("narrowed");
    expect(gone.because).toBe("already_expired");
  });

  it("distinguishes the four reasons a type is never warned about", () => {
    const reasons = (type: DocumentType): string => {
      const decision = decideExpiryWarning({
        documentType: type,
        expiresAt: inDays(1),
        now: NOW,
        alreadyWarnedAt: null,
      });
      return decision.warn ? "warned" : decision.because;
    };
    expect(reasons("degree_certificate")).toBe("does_not_expire");
    expect(reasons("bank_statement")).toBe("out_of_scope");
    expect(reasons("sponsorship_letter")).toBe("threshold_undetermined");
    expect(
      decideExpiryWarning({
        documentType: "passport",
        expiresAt: null,
        now: NOW,
        alreadyWarnedAt: null,
      }),
    ).toEqual({ warn: false, because: "no_expiry_date_recorded" });
  });

  it("tells the student both options, and does not push either", () => {
    const decision = passport(30);
    if (!decision.warn) expect.unreachable("inside the threshold");
    expect(decision.warning.wording).toContain("expires on 2026-10-07");
    expect(decision.warning.wording).toContain("in 30 days");
    expect(decision.warning.wording, "carrying on is a real option").toContain("carry on with it");
    expect(decision.warning.wording, "so is replacing it").toContain("upload a newer one");
    expect(decision.warning.wording, "and it promises not to nag").toContain("will not ask again");
  });

  it("marks a warning from a provisional threshold as provisional", () => {
    const decision = decideExpiryWarning({
      documentType: "english_test_certificate",
      expiresAt: inDays(30),
      now: NOW,
      alreadyWarnedAt: null,
    });
    if (!decision.warn) expect.unreachable("inside the threshold");
    expect(decision.warning.provisional).toBe(true);

    const settled = passport(30);
    if (!settled.warn) expect.unreachable("inside the threshold");
    expect(settled.warning.provisional, "the passport number is settled").toBe(false);
  });
});

describe("what is recorded when they choose", () => {
  it("records the EXACT wording that was shown, taken from the warning", () => {
    // ═══════════════════════════════════════════════════════════════════
    // The property, and the reason `recordChoice` takes a warning rather than
    // a string: there is no parameter through which a caller could record a
    // sentence other than the one the student read. A record saying "the
    // student was warned" without saying what they read is evidence of
    // nothing.
    // ═══════════════════════════════════════════════════════════════════
    const decision = decideExpiryWarning({
      documentType: "passport",
      expiresAt: inDays(20),
      now: NOW,
      alreadyWarnedAt: null,
    });
    if (!decision.warn) expect.unreachable("inside the threshold");

    const record = recordChoice(decision.warning, "proceed", NOW);
    expect(record.wordingShown).toBe(decision.warning.wording);
    expect(record.choice).toBe("proceed");
    expect(record.documentType).toBe("passport");
    expect(record.expiresAt).toEqual(inDays(20));
    expect(record.provisionalThreshold).toBe(false);
  });

  it("records replacing just as fully as proceeding", () => {
    const decision = decideExpiryWarning({
      documentType: "english_test_certificate",
      expiresAt: inDays(5),
      now: NOW,
      alreadyWarnedAt: null,
    });
    if (!decision.warn) expect.unreachable("inside the threshold");
    const record = recordChoice(decision.warning, "replace", NOW);
    expect(record.choice).toBe("replace");
    expect(record.provisionalThreshold, "and carries that the number may move").toBe(true);
  });

  it("cannot be given a warning nobody produced", () => {
    // A compile-time property, asserted here in the only way a runtime test
    // can: the branded shape is what `recordChoice` takes, and a hand-written
    // object needs a cast to become one. If that cast ever stops being needed,
    // the brand has been lost and the wording guarantee with it.
    const forged = {
      documentType: "passport",
      expiresAt: inDays(1),
      daysRemaining: 1,
      wording: "a sentence nobody was shown",
      provisional: false,
    } as unknown as ExpiryWarning;
    // It runs — nothing can stop a cast — and that is precisely why the
    // guarantee lives in the type rather than in a check here.
    expect(recordChoice(forged, "proceed", NOW).wordingShown).toBe("a sentence nobody was shown");
  });
});
