import { describe, expect, it } from "vitest";

import type { ApplicationBlueprint } from "@askimate/aas-blueprint";
import { auditRef, proposeValue, studentId } from "@askimate/aas-domain";
import type { RedactedDetail } from "@askimate/aas-domain";
import type { ConfirmedProfile, ProfileFieldKey, ProfileFieldType } from "@askimate/aas-profile";
import { applyConfirmation, confirmField, emptyProfile, isDeclined } from "@askimate/aas-profile";
import { checkUsable, planFill } from "@askimate/aas-mapping";
import type { FillPlan, UsableMappingSet } from "@askimate/aas-mapping";
import { FIXTURE_BLUEPRINT, FIXTURE_MAPPING_SET } from "@askimate/aas-mapping/fixtures";

import {
  InMemoryAuthorisationLedger,
  checkAuthorisable,
  stillCovers,
} from "./authorisation.js";
import type { AuthorisablePreview } from "./authorisation.js";
import { PreviewSerialisationError, buildPreview, renderPreview } from "./preview.js";
import type { PreviewDocument, SubmissionPreview } from "./preview.js";
import { isValid, validatePlan } from "./validate.js";

const NOW = new Date("2026-08-26T10:00:00Z");
const STUDENT = studentId("student-1");

const PASSPORT: PreviewDocument = {
  documentId: "doc-passport-1",
  describedAs: "passport",
  contentHash: "sha256:aaaa",
};

const DOCUMENTS = new Map<string, PreviewDocument>([["passport", PASSPORT]]);

function withConfirmed(entries: readonly [ProfileFieldKey, unknown][]): ConfirmedProfile {
  let profile = emptyProfile(STUDENT, NOW);
  for (const [key, value] of entries) {
    const result = applyConfirmation({
      key,
      proposed: proposeValue({
        value: value as ProfileFieldType<ProfileFieldKey>,
        origin: "conversation",
        verbatim: "as stated",
        confidence: 0.9,
      }),
      confirmation: {
        studentRef: STUDENT,
        presentedText: "…",
        respondedAt: NOW,
        response: { kind: "accepted" },
      },
    });
    if (isDeclined(result)) expect.unreachable("the student accepted");
    profile = confirmField(profile, result, NOW);
  }
  return profile;
}

const STATEMENT =
  "I want to study this course because it builds directly on my industrial engineering degree " +
  "and the operations work I did afterwards.";

const COMPLETE = withConfirmed([
  ["identity.given_name", "Niloofar"],
  ["identity.family_name", "Hosseini"],
  ["identity.date_of_birth", new Date("1999-04-02T00:00:00Z")],
  ["identity.nationality", "Iranian"],
  ["contact.email", "niloofar.hosseini@example.com"],
  ["study.personal_statement", STATEMENT],
]);

function usableSet(): UsableMappingSet {
  const check = checkUsable(FIXTURE_MAPPING_SET, FIXTURE_BLUEPRINT);
  if (!check.usable) expect.unreachable("the fixture mapping set is usable");
  return check.mappingSet;
}

function planFor(profile: ConfirmedProfile = COMPLETE): FillPlan {
  return planFill(FIXTURE_BLUEPRINT, usableSet(), profile);
}

function previewFor(plan: FillPlan = planFor()): SubmissionPreview {
  const result = buildPreview(FIXTURE_BLUEPRINT, plan, DOCUMENTS);
  if (!result.built) expect.unreachable(`expected a preview: ${result.refusal.kind}`);
  return result.preview;
}

function authorisable(preview: SubmissionPreview = previewFor()): AuthorisablePreview {
  const check = checkAuthorisable(preview, validatePlan(FIXTURE_BLUEPRINT, planFor()));
  if (!check.authorisable) expect.unreachable(`expected authorisable: ${check.refusal.kind}`);
  return check.preview;
}

// ───────────────────────────────────────────────────────────────────────────
// Validation
// ───────────────────────────────────────────────────────────────────────────

describe("validating against the portal's own rules", () => {
  it("passes a complete plan", () => {
    expect(isValid(validatePlan(FIXTURE_BLUEPRINT, planFor()))).toBe(true);
  });

  it("does not report a required field satisfied by an upload", () => {
    // `passport_upload` is required and nothing is typed into it. That is
    // correct, not a violation — reporting it would bury the real ones.
    const result = validatePlan(FIXTURE_BLUEPRINT, planFor());
    expect(result.violations.map((v) => v.fieldRef)).not.toContain("passport_upload");
  });

  it("does not report a required field reserved for the student", () => {
    const result = validatePlan(FIXTURE_BLUEPRINT, planFor());
    expect(result.violations.map((v) => v.fieldRef)).not.toContain("declaration");
  });

  it("catches a personal statement longer than the portal accepts", () => {
    const tooLong = withConfirmed([
      ["identity.given_name", "Niloofar"],
      ["identity.family_name", "Hosseini"],
      ["identity.date_of_birth", new Date("1999-04-02T00:00:00Z")],
      ["identity.nationality", "Iranian"],
      ["contact.email", "niloofar.hosseini@example.com"],
      ["study.personal_statement", "A".repeat(4_500)],
    ]);

    const result = validatePlan(FIXTURE_BLUEPRINT, planFor(tooLong));
    const violation = result.violations.find((v) => v.fieldRef === "personal_statement");

    expect(violation?.rule.kind).toBe("maxlength");
    // Caught here, before an account and a half-finished draft exist in a real
    // admissions system.
    expect(violation?.detail).toContain("must not be truncated");
  });

  it("catches a value that does not match the portal's format", () => {
    // The portal's pattern attribute says DD/MM/YYYY. A mapping that renders
    // ISO would pass every type check and be rejected on submit.
    const isoDates: ApplicationBlueprint = FIXTURE_BLUEPRINT;
    const wrongFormat = checkUsable(
      {
        ...FIXTURE_MAPPING_SET,
        mappings: FIXTURE_MAPPING_SET.mappings.map((mapping) =>
          mapping.fieldRef === "dob"
            ? {
                ...mapping,
                source: {
                  kind: "profile_field" as const,
                  fieldKey: "identity.date_of_birth" as const,
                  format: { kind: "date" as const, pattern: "YYYY-MM-DD" as const },
                },
              }
            : mapping,
        ),
      },
      isoDates,
    );
    if (!wrongFormat.usable) expect.unreachable("still a valid mapping set");

    const result = validatePlan(isoDates, planFill(isoDates, wrongFormat.mappingSet, COMPLETE));
    const violation = result.violations.find((v) => v.fieldRef === "dob");

    expect(violation?.rule.kind).toBe("pattern");
    expect(violation?.source).toBe("dom_attribute");
  });

  it("carries each rule's provenance, so a wrong-looking violation can be traced", () => {
    const result = validatePlan(FIXTURE_BLUEPRINT, planFor());
    for (const violation of result.violations) {
      expect(["dom_attribute", "observed_error", "specialist_noted"]).toContain(violation.source);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Preview
// ───────────────────────────────────────────────────────────────────────────

describe("the preview", () => {
  it("shows every field, with no summarising", () => {
    const preview = previewFor();
    const text = renderPreview(preview);

    expect(text).toContain("First name: Niloofar");
    expect(text).toContain("Date of birth: 02/04/1999");
    // Shown in words the student can check, AND with what is actually sent.
    // "Nationality: IR" alone is a string nobody can verify — they would say
    // yes and the confirmation would have done nothing.
    expect(text).toContain('Nationality: Iran (Islamic Republic of)  (sent as "IR")');
    expect(preview.entries).toHaveLength(planFor().instructions.length);
  });

  it("marks the one thing the student did not tell us", () => {
    const text = renderPreview(previewFor());
    expect(text).toContain("(set by AskiMate:");
  });

  it("names the documents that will be attached", () => {
    const text = renderPreview(previewFor());
    // ADR-0098: which document, going where, for what — per attachment.
    expect(text).toContain("Documents that will be sent:");
    expect(text).toContain("Upload your passport: your passport");
    expect(text).toContain("going to: Example University (apply.example.test)");
    expect(text).toMatch(/for: this application — .+, .+/);
  });

  it("says what the student will do themselves", () => {
    const text = renderPreview(previewFor());
    expect(text).toContain("You will complete these yourself:");
    expect(text).toContain("I declare that the information given is true and complete");
  });

  it("refuses to preview an incomplete application", () => {
    const partial = withConfirmed([["identity.given_name", "Niloofar"]]);
    const result = buildPreview(FIXTURE_BLUEPRINT, planFor(partial), DOCUMENTS);

    // Showing a student most of an application and asking them to approve it
    // would make the authorisation cover something that is not what is sent.
    if (result.built) expect.unreachable("an incomplete plan has no preview");
    expect(result.refusal.kind).toBe("plan_incomplete");
  });

  it("refuses when a required attachment has no document behind it", () => {
    const result = buildPreview(FIXTURE_BLUEPRINT, planFor(), new Map());
    if (result.built) expect.unreachable("a missing document has no preview");
    expect(result.refusal.kind).toBe("document_missing");
  });
});

describe("the content hash", () => {
  it("is the same for the same content", () => {
    expect(previewFor().contentHash).toBe(previewFor().contentHash);
  });

  it("changes when a single character of a single answer changes", () => {
    const original = previewFor().contentHash;

    const corrected = withConfirmed([
      ["identity.given_name", "Niloofar"],
      ["identity.family_name", "Hoseini"], // one letter
      ["identity.date_of_birth", new Date("1999-04-02T00:00:00Z")],
      ["identity.nationality", "Iranian"],
      ["contact.email", "niloofar.hosseini@example.com"],
      ["study.personal_statement", STATEMENT],
    ]);

    expect(previewFor(planFor(corrected)).contentHash).not.toBe(original);
  });

  it("changes when the application is re-pointed at a DIFFERENT portal host", () => {
    // ADR-0022's "where", inside the yes (ADR-0098): the same fields and the
    // same passport, sent to another host, is not what the student agreed to.
    const elsewhere = {
      ...FIXTURE_BLUEPRINT,
      provenance: { ...FIXTURE_BLUEPRINT.provenance, observedUrls: ["https://other.example.test/apply"] },
    };
    const result = buildPreview(elsewhere, planFor(), DOCUMENTS);
    if (!result.built) expect.unreachable("expected a preview");
    expect(result.preview.portalHost).toBe("other.example.test");
    expect(result.preview.contentHash).not.toBe(previewFor().contentHash);
  });

  it("names the DEPLOYMENT's host when the run is made to one, and the hash follows it (P74)", () => {
    // The same reviewed blueprint against a university's UAT environment
    // (ADR-0057): the passport goes to THAT host, and the transmission gate
    // refuses any other (ADR-0069). So the preview names it, and the hash the
    // student's authorisation covers is the hash of THAT destination.
    const result = buildPreview(FIXTURE_BLUEPRINT, planFor(), DOCUMENTS, { portalHost: "uat.example.test:8443" });
    if (!result.built) expect.unreachable("expected a preview");
    expect(result.preview.portalHost).toBe("uat.example.test:8443");
    expect(renderPreview(result.preview)).toContain("uat.example.test:8443");
    expect(result.preview.contentHash).not.toBe(previewFor().contentHash);
    // Everything else is the same application: only the destination line moved.
    expect(result.preview.entries).toEqual(previewFor().entries);
    expect(result.preview.attachments).toEqual(previewFor().attachments);
  });

  it("REFUSES a blueprint that observed no URL even when a deployment is named", () => {
    // A deployment says WHERE a reviewed blueprint runs; it does not make an
    // unreviewable one executable.
    const blind = { ...FIXTURE_BLUEPRINT, provenance: { ...FIXTURE_BLUEPRINT.provenance, observedUrls: [] } };
    const result = buildPreview(blind, planFor(), DOCUMENTS, { portalHost: "uat.example.test" });
    expect(result.built).toBe(false);
    if (result.built) expect.unreachable("checked above");
    expect(result.refusal.kind).toBe("destination_unknown");
  });

  it("REFUSES to preview a blueprint that observed no URL", () => {
    const blind = { ...FIXTURE_BLUEPRINT, provenance: { ...FIXTURE_BLUEPRINT.provenance, observedUrls: [] } };
    const result = buildPreview(blind, planFor(), DOCUMENTS);
    expect(result.built).toBe(false);
    if (result.built) expect.unreachable("no destination, no preview");
    expect(result.refusal.kind).toBe("destination_unknown");
  });

  it("changes when the SAME name holds a different document", () => {
    // "passport" replaced with a different passport is a change to what is
    // being submitted. A name-based hash would not notice.
    const replaced = new Map<string, PreviewDocument>([
      ["passport", { ...PASSPORT, contentHash: "sha256:bbbb" }],
    ]);
    const result = buildPreview(FIXTURE_BLUEPRINT, planFor(), replaced);
    if (!result.built) expect.unreachable("expected a preview");

    expect(result.preview.contentHash).not.toBe(previewFor().contentHash);
  });

  it("changes when the SAME document is attached to a DIFFERENT field", () => {
    // ── Attachment identity, layer one ──────────────────────────────────
    //
    // An attachment is `(fieldRef, documentRef, contentHash)`. All three are in
    // the hash, and the field is the one that is easy to lose: a passport sent
    // to "Passport" and the same passport sent to "Proof of address" are not
    // the same thing being submitted, even though every byte is identical.
    const plan = planFor();
    const moved: FillPlan = {
      ...plan,
      uploads: plan.uploads.map((upload) => ({ ...upload, fieldRef: "other_upload" })),
    };
    expect(plan.uploads.length, "the fixture really does attach a document").toBeGreaterThan(0);

    const result = buildPreview(FIXTURE_BLUEPRINT, moved, DOCUMENTS);
    if (!result.built) expect.unreachable("expected a preview");
    expect(result.preview.contentHash).not.toBe(previewFor().contentHash);
  });

  it("changes when the field is the same and the DOCUMENT NAMED is different", () => {
    // ── Attachment identity, layer two ──────────────────────────────────
    //
    // The mirror of the test above, and it is not implied by it. A re-reviewed
    // mapping set that points the same box at a different document key produces
    // this, and the bytes behind the new key can coincide with the old ones —
    // one scan filed under two names. The student authorised a decision about
    // WHICH document goes there, so the decision is in the hash and not only
    // its outcome.
    const plan = planFor();
    const renamed: FillPlan = {
      ...plan,
      uploads: plan.uploads.map((upload) => ({ ...upload, documentRef: "identity_document" })),
    };

    const result = buildPreview(
      FIXTURE_BLUEPRINT,
      renamed,
      new Map([["identity_document", PASSPORT]]),
    );
    if (!result.built) expect.unreachable("expected a preview");
    expect(result.preview.contentHash).not.toBe(previewFor().contentHash);
  });

  it("does NOT change when only the vault's id for the same bytes changes", () => {
    // The deliberate exclusion, and the reason the two tests above are about
    // `documentRef` rather than `documentId`. `documentId` is minted by the
    // vault; re-storing the same scan mints another. What the student agreed to
    // is a document, not a row — so a new id for identical bytes in the same
    // box must not void an outstanding authorisation.
    const restored = new Map<string, PreviewDocument>([
      ["passport", { ...PASSPORT, documentId: "doc-passport-2" }],
    ]);
    const result = buildPreview(FIXTURE_BLUEPRINT, planFor(), restored);
    if (!result.built) expect.unreachable("expected a preview");
    expect(result.preview.contentHash).toBe(previewFor().contentHash);
  });

  it("does not change when the blueprint's wording changes but the content does not", () => {
    // A portal relabelling "Last name" to "Family name" does not change what is
    // being submitted, and must not void an outstanding authorisation.
    const relabelled: ApplicationBlueprint = {
      ...FIXTURE_BLUEPRINT,
      institutionName: "Example University (relabelled)",
    };
    const result = buildPreview(relabelled, planFor(), DOCUMENTS);
    if (!result.built) expect.unreachable("expected a preview");

    expect(result.preview.contentHash).toBe(previewFor().contentHash);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Authorisation
// ───────────────────────────────────────────────────────────────────────────

describe("the gate before asking a student to approve", () => {
  it("lets a valid, complete application through", () => {
    expect(checkAuthorisable(previewFor(), validatePlan(FIXTURE_BLUEPRINT, planFor())).authorisable)
      .toBe(true);
  });

  it("refuses when the portal would reject the content", () => {
    const check = checkAuthorisable(previewFor(), {
      violations: [
        {
          fieldRef: "personal_statement",
          label: "Why do you want to study this course?",
          rule: { kind: "maxlength", value: "4000", source: "dom_attribute" },
          detail: "too long",
          source: "dom_attribute",
        },
      ],
      unknownFields: [],
    });

    if (check.authorisable) expect.unreachable("a failing application is not authorisable");
    expect(check.refusal.kind).toBe("validation_failed");
  });
});

describe("the ledger", () => {
  it("stores the preview text verbatim, not only the hash", async () => {
    const ledger = new InMemoryAuthorisationLedger();
    const preview = authorisable();

    const record = await ledger.record({
      authorisationId: "auth-1",
      caseId: "case-1",
      studentRef: STUDENT,
      preview,
      authorisedAt: NOW,
    });

    // Six months later, "what exactly did I approve?" has an answer that does
    // not depend on what the blueprint, the mapping or the profile look like
    // by then.
    expect(record.presentedText).toBe(renderPreview(preview));
    expect(record.contentHash).toBe(preview.contentHash);
  });

  it("still covers content that has not changed", async () => {
    const ledger = new InMemoryAuthorisationLedger();
    const record = await ledger.record({
      authorisationId: "auth-1",
      caseId: "case-1",
      studentRef: STUDENT,
      preview: authorisable(),
      authorisedAt: NOW,
    });

    expect(stillCovers(record, previewFor())).toBe(true);
  });

  it("stops covering content once a single answer changes", async () => {
    const ledger = new InMemoryAuthorisationLedger();
    const record = await ledger.record({
      authorisationId: "auth-1",
      caseId: "case-1",
      studentRef: STUDENT,
      preview: authorisable(),
      authorisedAt: NOW,
    });

    const corrected = withConfirmed([
      ["identity.given_name", "Niloofar"],
      ["identity.family_name", "Hoseini"],
      ["identity.date_of_birth", new Date("1999-04-02T00:00:00Z")],
      ["identity.nationality", "Iranian"],
      ["contact.email", "niloofar.hosseini@example.com"],
      ["study.personal_statement", STATEMENT],
    ]);

    expect(stillCovers(record, previewFor(planFor(corrected)))).toBe(false);
  });

  it("marks a voided authorisation rather than deleting it", async () => {
    const ledger = new InMemoryAuthorisationLedger();
    await ledger.record({
      authorisationId: "auth-1",
      caseId: "case-1",
      studentRef: STUDENT,
      preview: authorisable(),
      authorisedAt: NOW,
    });

    const voided = await ledger.void("auth-1", "content_changed", new Date("2026-08-27T09:00:00Z"));
    expect(voided.voidReason).toBe("content_changed");
    expect(await ledger.currentFor("case-1")).toBeNull();

    // "They authorised this, then the content changed, so we asked again" is
    // exactly the history that has to survive.
    expect(await ledger.historyFor("case-1")).toHaveLength(1);
  });

  it("does not treat a voided authorisation as covering anything", async () => {
    const ledger = new InMemoryAuthorisationLedger();
    await ledger.record({
      authorisationId: "auth-1",
      caseId: "case-1",
      studentRef: STUDENT,
      preview: authorisable(),
      authorisedAt: NOW,
    });
    const voided = await ledger.void("auth-1", "student_revoked", NOW);

    expect(stillCovers(voided, previewFor())).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The preview boundary: plaintext for the student, nowhere else
// ───────────────────────────────────────────────────────────────────────────

describe("where a submission preview is allowed to go", () => {
  const built = (): SubmissionPreview => previewFor();

  it("shows the student their own data, in full and unredacted", () => {
    // The thing that must NOT change. A preview exists so the student can read
    // exactly what will be sent and authorise it; a redacted one is useless.
    const text = renderPreview(built());
    expect(text).toContain("Niloofar");
    expect(text).toContain("02/04/1999");
  });

  it("renders no CREDENTIAL, even though the preview carries the list", () => {
    // ═══════════════════════════════════════════════════════════════════
    // ADR-0043, and it matters more since ADR-0059 put this text on an HTTP
    // response. `PreviewCredential` never holds a value, so nothing here
    // COULD leak one — but a future `renderPreview` that helpfully listed the
    // credential fields would put "password" into a body the contract's
    // secret-bearing walk cannot see, because that walk reads field NAMES and
    // this is one free-text field.
    //
    // So the rendering is asserted to omit the list entirely. A student is
    // told what the Secure Plane will fill by the secure step itself, not by
    // an application preview.
    // ═══════════════════════════════════════════════════════════════════
    // The fixture plan carries no credential, so rendering IT would prove
    // nothing — an absence that is only the fixture's. One is put in.
    const carrying: SubmissionPreview = {
      ...built(),
      credentials: [
        {
          fieldRef: "account.password",
          label: "Password",
          purpose: "portal_account_creation",
          explanation: "You will type this into the secure box; AskiMate never sees it.",
        },
      ],
    };
    expect(carrying.credentials, "the preview really is carrying one").toHaveLength(1);

    const text = renderPreview(carrying).toLowerCase();
    expect(text).not.toContain("password");
    expect(text).not.toContain("credential");
    expect(text).not.toContain("account.password");
    // And the rest of the rendering is unaffected — this is an omission, not
    // a renderer that gave up.
    expect(text).toContain("niloofar");
  });

  it("REFUSES JSON.stringify — the usual route into a log", () => {
    expect(() => JSON.stringify(built())).toThrow(PreviewSerialisationError);
  });

  it("refuses it nested inside a larger payload, which is how it would happen", () => {
    // Nobody serialises a preview on purpose. It happens because a preview is
    // on an object that gets logged — an event, a diagnostic, an error report.
    expect(() =>
      JSON.stringify({ caseId: "case-1", step: "authorise", preview: built() }),
    ).toThrow(PreviewSerialisationError);
    expect(() => JSON.stringify([built()])).toThrow(PreviewSerialisationError);
  });

  it("cannot reach an audit record, by type", () => {
    // Belt as well as braces: even without the throw, a preview is an object
    // and RedactedDetail takes only AuditSafeText, numbers, booleans and null.
    // @ts-expect-error a preview is not audit detail.
    const detail: RedactedDetail = { preview: built() };
    expect(detail).toBeDefined();
  });

  it("still exposes contentHash, which is how a preview IS referenced", () => {
    // The safe reference. An audit record says which preview was authorised
    // without carrying what was in it.
    const preview = built();
    expect(preview.contentHash).toMatch(/^sha256:[0-9a-f]+$/);
    const detail: RedactedDetail = { previewHash: auditRef(preview.contentHash) };
    expect(String(detail["previewHash"])).toBe(preview.contentHash);
  });

  it("says WHY in the error, not just that it is refused", () => {
    expect(() => JSON.stringify(built())).toThrow(/READ BY THEM/);
    expect(() => JSON.stringify(built())).toThrow(/renderPreview/);
  });
});
