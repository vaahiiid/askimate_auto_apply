import { describe, expect, it } from "vitest";

import { studentId } from "@askimate/aas-domain";

import {
  DISCLOSURE_ACTIVITY,
  authoriseDisclosure,
  disclosureOf,
  mayTransmit,
  recordTransmission,
  renderDisclosureRequest,
  type DisclosureRequestRecord,
} from "./disclosure.js";
import {
  LawfulBasisRegister,
  NoLawfulBasisError,
  determineLawfulBasis,
  requireLawfulBasis,
  type LawfulBasisDetermination,
  type LawfulBasisDeterminationRecord,
} from "./lawful-basis.js";

const NOW = new Date("2026-08-26T10:00:00Z");
const REVIEW_BY = new Date("2027-08-26T00:00:00Z");
const STUDENT = studentId("student-1");

function determinationRecord(
  overrides: Partial<LawfulBasisDeterminationRecord> = {},
): LawfulBasisDeterminationRecord {
  return {
    determinationId: "lb-1",
    activity: {
      activity: DISCLOSURE_ACTIVITY,
      purpose: "Send supporting documents to the university.",
      documentTypes: ["passport"],
    },
    article6: "contract",
    requiresStudentAuthorisation: true,
    determinedBy: "dpo-1",
    determinedAt: NOW,
    reasoning: "Necessary to perform the service the student asked for.",
    reviewBy: REVIEW_BY,
    ...overrides,
  };
}

function basis(overrides: Partial<LawfulBasisDeterminationRecord> = {}): LawfulBasisDetermination {
  const check = determineLawfulBasis(determinationRecord(overrides), NOW);
  if (!check.valid) expect.unreachable(`expected a valid determination: ${check.refusal.kind}`);
  return check.determination;
}

function request(overrides: Partial<DisclosureRequestRecord> = {}): DisclosureRequestRecord {
  return {
    disclosureId: "disc-1",
    subject: {
      documentId: "doc-passport-1",
      documentType: "passport",
      contentHash: "sha256:v1",
      caseId: "case-1",
      requestedFor: "Identity verification",
    },
    destination: {
      institutionName: "Ulster University",
      portalHost: "apply.qahighereducation.com",
    },
    determination: basis(),
    studentAuthorisation: {
      studentRef: STUDENT,
      presentedText:
        "I need to send your passport to Ulster University for identity verification. " +
        "Is that alright?",
      authorisedAt: NOW,
      method: "chat_affirmation",
    },
    ...overrides,
  };
}

/**
 * Drops the student's authorisation.
 *
 * Under `exactOptionalPropertyTypes`, absent and present-but-undefined are
 * different things, and absent is what "we never asked them" means.
 */
function withoutAuthorisation(record: DisclosureRequestRecord): DisclosureRequestRecord {
  const { studentAuthorisation: _none, ...rest } = record;
  return rest;
}

// ───────────────────────────────────────────────────────────────────────────
// Lawful basis
// ───────────────────────────────────────────────────────────────────────────

describe("the lawful basis is recorded, never assumed", () => {
  it("accepts a determination with a named person and reasoning", () => {
    expect(determineLawfulBasis(determinationRecord(), NOW).valid).toBe(true);
  });

  it("refuses a determination nobody can be asked to justify", () => {
    const check = determineLawfulBasis(determinationRecord({ reasoning: "  " }), NOW);
    if (check.valid) expect.unreachable("reasoning is mandatory");
    expect(check.refusal.kind).toBe("no_reasoning");
  });

  it("refuses a determination with no named determiner", () => {
    const check = determineLawfulBasis(determinationRecord({ determinedBy: "" }), NOW);
    if (check.valid) expect.unreachable("a determiner is mandatory");
    expect(check.refusal.kind).toBe("no_determiner");
  });

  it("refuses a lapsed determination — law and circumstances change", () => {
    const check = determineLawfulBasis(
      determinationRecord({ reviewBy: new Date("2026-01-01T00:00:00Z") }),
      NOW,
    );
    if (check.valid) expect.unreachable("a lapsed determination is not relied on");
    expect(check.refusal.kind).toBe("expired");
  });

  it("refuses 'consent' that nobody was ever asked for", () => {
    // Self-contradictory, and worse than no record at all because it looks
    // like compliance.
    const check = determineLawfulBasis(
      determinationRecord({ article6: "consent", requiresStudentAuthorisation: false }),
      NOW,
    );
    if (check.valid) expect.unreachable("consent must be asked for");
    expect(check.refusal.kind).toBe("consent_without_authorisation");
  });

  it("does not treat consent as the default basis", () => {
    // The ordinary case here is contract, not consent — a student who cannot
    // get their application submitted without agreeing has not freely given
    // anything.
    expect(disclosureOfBasisArticle6()).toBe("contract");
  });
});

function disclosureOfBasisArticle6(): string {
  const check = determineLawfulBasis(determinationRecord(), NOW);
  if (!check.valid) expect.unreachable("valid");
  return check.determination.article6;
}

describe("the register of determinations", () => {
  it("fails loudly for an activity nobody has decided about", () => {
    const register = new LawfulBasisRegister();
    expect(() => requireLawfulBasis(register, "something_new")).toThrow(NoLawfulBasisError);
  });

  it("returns the determination once one is registered", () => {
    const register = new LawfulBasisRegister();
    register.register(basis());
    expect(requireLawfulBasis(register, DISCLOSURE_ACTIVITY)).toBeDefined();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Authorising a disclosure
// ───────────────────────────────────────────────────────────────────────────

describe("authorising one document to one destination", () => {
  it("accepts a complete request", () => {
    expect(authoriseDisclosure(request()).authorised).toBe(true);
  });

  it("refuses a basis for HOLDING a document as a basis for SENDING it", () => {
    // The most plausible mistake in this file. "We may lawfully store your
    // passport" is a different sentence from "we may send it to a university".
    const holdingOnly = basis({
      activity: {
        activity: "store_identity_document",
        purpose: "Hold identity documents for the student's applications.",
        documentTypes: ["passport"],
      },
    });

    const check = authoriseDisclosure(request({ determination: holdingOnly }));
    if (check.authorised) expect.unreachable("wrong activity");
    expect(check.refusal.kind).toBe("wrong_activity");
  });

  it("refuses when the basis requires authorisation and none was taken", () => {
    const check = authoriseDisclosure(withoutAuthorisation(request()));
    if (check.authorised) expect.unreachable("authorisation required");
    expect(check.refusal.kind).toBe("authorisation_required");
  });

  it("refuses a general agreement as authorisation for a specific disclosure", () => {
    // "I agree to AskiMate handling my application" is not "yes, send my
    // passport to Ulster". Specific means specific.
    const check = authoriseDisclosure(
      request({
        studentAuthorisation: {
          studentRef: STUDENT,
          presentedText: "Do you agree to AskiMate helping with your application?",
          authorisedAt: NOW,
          method: "chat_affirmation",
        },
      }),
    );

    if (check.authorised) expect.unreachable("not specific");
    expect(check.refusal.kind).toBe("authorisation_not_specific");
  });

  it("needs the destination named, not only the document", () => {
    const check = authoriseDisclosure(
      request({
        studentAuthorisation: {
          studentRef: STUDENT,
          presentedText: "Can I send your passport somewhere?",
          authorisedAt: NOW,
          method: "chat_affirmation",
        },
      }),
    );
    expect(check.authorised).toBe(false);
  });

  it("does not require authorisation when the basis does not", () => {
    // Not every processing activity needs consent on top — and pretending it
    // does is its own kind of wrong, because it trains students to click yes.
    const check = authoriseDisclosure(
      withoutAuthorisation(
        request({
          determination: basis({
            article6: "legal_obligation",
            requiresStudentAuthorisation: false,
          }),
        }),
      ),
    );
    expect(check.authorised).toBe(true);
  });
});

describe("when the applicant is a minor", () => {
  it("treats an EMPTY condition set as undetermined, not as no requirements", () => {
    // ADR-0011. Nobody having looked is not the same as there being nothing to
    // find, and the difference decides who gets asked next.
    const check = authoriseDisclosure(request({ minorConditions: [] }));
    if (check.authorised) expect.unreachable("undetermined conditions block");
    expect(check.refusal.kind).toBe("minor_conditions_undetermined");
  });

  it("refuses while a determined condition is unsatisfied", () => {
    const check = authoriseDisclosure(
      request({
        minorConditions: [
          { condition: "guardian_authorisation", satisfied: false },
          { condition: "identity_verified", satisfied: true },
        ],
      }),
    );

    if (check.authorised) expect.unreachable("unsatisfied conditions block");
    if (check.refusal.kind !== "minor_conditions_unsatisfied") expect.unreachable("checked above");
    expect(check.refusal.outstanding).toEqual(["guardian_authorisation"]);
  });

  it("permits once every determined condition is satisfied", () => {
    const check = authoriseDisclosure(
      request({
        minorConditions: [{ condition: "guardian_authorisation", satisfied: true }],
      }),
    );
    expect(check.authorised).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Spending it — the checks at the moment of upload
// ───────────────────────────────────────────────────────────────────────────

function authorised() {
  const check = authoriseDisclosure(request());
  if (!check.authorised) expect.unreachable("the fixture is authorised");
  return check.authorisation;
}

describe("at the moment the document would leave", () => {
  const base = {
    documentId: "doc-passport-1",
    contentHash: "sha256:v1",
    toHost: "apply.qahighereducation.com",
    withdrawals: [],
  };

  it("permits exactly what was authorised", () => {
    expect(mayTransmit({ authorisation: authorised(), ...base }).permitted).toBe(true);
  });

  it("REFUSES a different document under the same authorisation", () => {
    const result = mayTransmit({
      authorisation: authorised(),
      ...base,
      documentId: "doc-transcript-1",
    });
    if (result.permitted) expect.unreachable("an authorisation is not transferable");
    expect(result.refusal.kind).toBe("wrong_document");
  });

  it("REFUSES when the file changed since the student agreed", () => {
    // The student authorised one passport scan. This is a different file
    // under the same ID, and they have not seen it.
    const result = mayTransmit({ authorisation: authorised(), ...base, contentHash: "sha256:v2" });
    if (result.permitted) expect.unreachable("content changed");
    expect(result.refusal.kind).toBe("content_changed");
  });

  it("REFUSES a different portal, even a plausible one", () => {
    const result = mayTransmit({
      authorisation: authorised(),
      ...base,
      toHost: "apply.someotheruniversity.ac.uk",
    });
    if (result.permitted) expect.unreachable("wrong destination");
    expect(result.refusal.kind).toBe("wrong_destination");
  });

  it("allows a subdomain of the authorised host", () => {
    const result = mayTransmit({
      authorisation: authorised(),
      ...base,
      toHost: "uploads.apply.qahighereducation.com",
    });
    expect(result.permitted).toBe(true);
  });

  it("REFUSES once the student has withdrawn", () => {
    const result = mayTransmit({
      authorisation: authorised(),
      ...base,
      withdrawals: [
        { disclosureId: "disc-1", withdrawnAt: NOW, reason: "Changed their mind." },
      ],
    });
    if (result.permitted) expect.unreachable("withdrawn");
    expect(result.refusal.kind).toBe("withdrawn");
  });
});

describe("the record of what left", () => {
  it("carries IDs and hashes, never contents", () => {
    const record = recordTransmission(authorised(), NOW, "apply.qahighereducation.com");

    expect(record.documentId).toBe("doc-passport-1");
    expect(record.contentHash).toBe("sha256:v1");
    expect(record.caseId).toBe("case-1");
    // Brief §8: audit records reference document IDs, not document contents.
    expect(JSON.stringify(record)).not.toContain("PDF");
  });
});

describe("what the student is shown", () => {
  it("names all four things, so 'yes' answers the right question", () => {
    const text = renderDisclosureRequest(request());

    expect(text).toContain("passport");
    expect(text).toContain("Ulster University");
    expect(text).toContain("apply.qahighereducation.com");
    expect(text).toContain("Identity verification");
    expect(text).toContain("case-1");
  });

  it("produces text that satisfies the specificity check it is written for", () => {
    // The rendering and the check cannot drift apart: if the wording stopped
    // naming the document and the destination, this fails.
    const record = request();
    const rendered = renderDisclosureRequest(record);

    const check = authoriseDisclosure({
      ...record,
      studentAuthorisation: {
        studentRef: STUDENT,
        presentedText: rendered,
        authorisedAt: NOW,
        method: "chat_affirmation",
      },
    });
    expect(check.authorised).toBe(true);
  });

  it("tells the student they can change their mind", () => {
    expect(renderDisclosureRequest(request())).toContain("change your mind");
  });

  it("names the processor when the portal is run by someone else", () => {
    const text = renderDisclosureRequest(
      request({
        destination: {
          institutionName: "Ulster University",
          portalHost: "apply.qahighereducation.com",
          processorName: "QA Higher Education",
        },
      }),
    );
    expect(text).toContain("QA Higher Education");
  });
});

describe("what the type system will not allow", () => {
  it("has no way to build an authorisation without going through the check", () => {
    const raw = request();
    // @ts-expect-error a DisclosureRequestRecord is not a DisclosureAuthorisation
    disclosureOf(raw);
  });
});
