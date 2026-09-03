/**
 * P20 — the catalogue loads a reviewed artefact, and can prove that is what it
 * loaded.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * The artefact under test is the GATED TEST PORTAL fixture, and it stays that.
 * It is a real artefact we own — a portal this repository runs, discovered
 * against real observed URLs — which is what makes it usable as evidence for
 * the technical pipeline. It is not a university, and nothing here presents it
 * as one.
 *
 * Vahid, 2026-09-03: *"Do not invent a university blueprint… The gated portal
 * fixture may be used as the controlled real artefact for proving the technical
 * pipeline… but its status as a test-controlled artefact must remain clear."*
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from "vitest";

import { GATED_PORTAL_BLUEPRINT, GATED_PORTAL_MAPPING_SET } from "@askimate/aas-mapping/fixtures/gated";
import { PROFILE_FIELD_KEYS } from "@askimate/aas-profile";

import { canonicalText, contentHash, labelledHash } from "./canonical.js";
import { toCanonical, type ReviewedCatalogueEntry } from "./entry.js";
import { loadReviewedEntry, ReviewedCatalogue } from "./loader.js";
import { parseReviewedEntry, parseReviewedEntryText } from "./parse.js";
import { InMemoryApprovalRegistry, approveContent, hashOf } from "./registry.js";

/** The reviewed half of a catalogue entry for the gated TEST portal. */
const ENTRY: ReviewedCatalogueEntry = {
  blueprint: GATED_PORTAL_BLUEPRINT,
  mappingSet: GATED_PORTAL_MAPPING_SET,
  requiredDocuments: [],
  institutionRef: "inst-gated",
  courseRef: "course-msc-controlled",
  intakeRef: "2026-09",
  portalAuthentication: {
    portalHost: "gated.portal.test",
    discoveryRunId: "run-gated-1",
    observedAt: new Date("2026-08-30T09:00:00Z"),
    applicantChoosesPassword: true,
    portalIssuesCredential: false,
    passwordlessAvailable: false,
    emailVerificationRequired: false,
    mfaOrOtpRequired: false,
    captchaPresent: false,
    passwordResetAvailable: true,
    credentialsCanBeHandedBack: true,
  },
  passwordDelivery: "askimate_secure_channel",
};

/** The entry as it would sit on disk. Dates become ISO-8601, as JSON requires. */
function documentOf(entry: ReviewedCatalogueEntry = ENTRY): string {
  return JSON.stringify(toCanonical(entry));
}

const AUTHOR = "test-specialist-a";
const REVIEWER = "test-specialist-b";
const APPROVED_AT = new Date("2026-09-01T10:00:00Z");

/** A registry that approves exactly the content given, and nothing else. */
function registryApproving(text: string): InMemoryApprovalRegistry {
  const parsed = parseReviewedEntryText(text);
  if (!parsed.ok) expect.unreachable(`fixture does not parse: ${parsed.refusal.path}`);
  const registry = new InMemoryApprovalRegistry();
  const recorded = registry.record({
    contentHash: hashOf(toCanonical(parsed.value)),
    authoredBy: AUTHOR,
    approvedBy: REVIEWER,
    approvedAt: APPROVED_AT,
  });
  if (!recorded.ok) expect.unreachable(`could not record: ${recorded.refusal.kind}`);
  return registry;
}

describe("the canonical form", () => {
  it("does not depend on key order or whitespace", () => {
    const a = { beta: 1, alpha: [{ y: true, x: "one" }] };
    const b = { alpha: [{ x: "one", y: true }], beta: 1 };
    expect(canonicalText(toCanonical(a))).toBe(canonicalText(toCanonical(b)));
    expect(contentHash(toCanonical(a))).toBe(contentHash(toCanonical(b)));
  });

  it("sorts keys in `canonicalText` ITSELF, not only in `toCanonical`", () => {
    // ═══════════════════════════════════════════════════════════════════
    // A shadowed control, found by mutation. `toCanonical` sorts keys and so
    // does `canonicalText`, so removing the sort from `canonicalText` changed
    // nothing any test could see — every assertion reached it through
    // `toCanonical`, which had already sorted.
    //
    // The sort is kept in both (`canonicalText` is exported and takes a
    // `Canonical`, which a caller can build by hand), and this asserts the
    // second one directly rather than through the first.
    // ═══════════════════════════════════════════════════════════════════
    expect(canonicalText({ beta: 1, alpha: 2 })).toBe('{"alpha":2,"beta":1}');
    expect(canonicalText({ beta: 1, alpha: 2 })).toBe(canonicalText({ alpha: 2, beta: 1 }));
  });

  it("DOES depend on array order, because order is content", () => {
    // A blueprint's pages are a sequence and a mapping set's mappings are a
    // list a reviewer read top to bottom. Reordering them is a real change.
    const a = toCanonical({ pages: ["one", "two"] });
    const b = toCanonical({ pages: ["two", "one"] });
    expect(contentHash(a)).not.toBe(contentHash(b));
  });

  it("renders a Date as an ISO-8601 instant, not as a locale string", () => {
    const text = canonicalText(toCanonical({ at: new Date("2026-09-01T10:00:00Z") }));
    expect(text).toBe('{"at":"2026-09-01T10:00:00.000Z"}');
  });

  it("treats an absent optional and an omitted key alike", () => {
    expect(canonicalText(toCanonical({ a: 1, b: undefined }))).toBe(canonicalText(toCanonical({ a: 1 })));
  });

  it("refuses a value that could not have come from a parse", () => {
    // A function in an artefact means something built it that was not the
    // parser. Dropping it silently would hash an artefact that is not this one.
    expect(() => toCanonical({ hack: () => "x" })).toThrow(/cannot appear/);
  });
});

describe("parsing rebuilds rather than casts", () => {
  it("round-trips the gated TEST portal entry", () => {
    const parsed = parseReviewedEntryText(documentOf());
    if (!parsed.ok) expect.unreachable(parsed.refusal.path);
    expect(String(parsed.value.blueprint.blueprintId)).toBe("bp-gated-portal");
    expect(parsed.value.mappingSet.mappings.length).toBe(GATED_PORTAL_MAPPING_SET.mappings.length);
  });

  it("produces REAL Dates, which a cast does not", () => {
    // The defect measured before P20: `JSON.parse(...) as MappingSet` leaves a
    // String in a field typed Date, and the first `.getTime()` throws in
    // production. This is the assertion that the coercion happened.
    const parsed = parseReviewedEntryText(documentOf());
    if (!parsed.ok) expect.unreachable(parsed.refusal.path);
    expect(parsed.value.mappingSet.authoredAt).toBeInstanceOf(Date);
    expect(parsed.value.blueprint.provenance.discoveredAt).toBeInstanceOf(Date);
    expect(parsed.value.portalAuthentication?.observedAt).toBeInstanceOf(Date);
    expect(parsed.value.mappingSet.authoredAt.getTime()).toBe(
      GATED_PORTAL_MAPPING_SET.authoredAt.getTime(),
    );
  });

  it("re-canonicalises to the same bytes it was given", () => {
    // If parse → canonical were not idempotent, the hash an operator was shown
    // and the hash the loader computes could differ, and every approval would
    // be a coin flip.
    const text = documentOf();
    const parsed = parseReviewedEntryText(text);
    if (!parsed.ok) expect.unreachable(parsed.refusal.path);
    expect(canonicalText(toCanonical(parsed.value))).toBe(canonicalText(toCanonical(ENTRY)));
  });

  it("normalises an EMPTY optional to an absent one, so both hash alike", () => {
    // `campus: ""` and no campus at all mean the same thing to a reviewer, and
    // two tools saving the same artefact disagree about which to write. If they
    // hashed differently, a reformat would silently need a new approval.
    const withEmpty = JSON.parse(documentOf()) as Record<string, unknown>;
    (withEmpty["blueprint"] as Record<string, unknown>)["campus"] = "";
    const withNone = JSON.parse(documentOf()) as Record<string, unknown>;
    delete (withNone["blueprint"] as Record<string, unknown>)["campus"];

    const a = parseReviewedEntry(withEmpty);
    const b = parseReviewedEntry(withNone);
    if (!a.ok || !b.ok) expect.unreachable("both should parse");
    expect(a.value.blueprint.campus).toBeUndefined();
    expect(contentHash(toCanonical(a.value))).toBe(contentHash(toCanonical(b.value)));
  });

  it("names WHERE it stopped", () => {
    const broken = JSON.parse(documentOf()) as Record<string, unknown>;
    const blueprint = broken["blueprint"] as Record<string, unknown>;
    const pages = blueprint["pages"] as Record<string, unknown>[];
    const sections = pages[0]?.["sections"] as Record<string, unknown>[];
    const fields = sections[0]?.["fields"] as Record<string, unknown>[];
    if (fields[0] === undefined) expect.unreachable("fixture has no fields");
    fields[0]["inputType"] = "telepathy";

    const parsed = parseReviewedEntry(broken);
    if (parsed.ok) expect.unreachable("an unknown input type should refuse");
    expect(parsed.refusal.path).toBe("entry.blueprint.pages[0].sections[0].fields[0].inputType");
    expect(parsed.refusal.detail).toContain("expected one of");
  });

  it("refuses a date that is not one, rather than making an Invalid Date", () => {
    const broken = JSON.parse(documentOf()) as Record<string, unknown>;
    (broken["mappingSet"] as Record<string, unknown>)["authoredAt"] = "sometime last March";
    const parsed = parseReviewedEntry(broken);
    if (parsed.ok) expect.unreachable("prose is not an instant");
    expect(parsed.refusal.path).toBe("entry.mappingSet.authoredAt");
  });

  it("refuses a profile field key the profile package does not define", () => {
    const broken = JSON.parse(documentOf()) as Record<string, unknown>;
    const set = broken["mappingSet"] as Record<string, unknown>;
    const mappings = set["mappings"] as Record<string, unknown>[];
    const target = mappings.find(
      (mapping) => (mapping["source"] as Record<string, unknown>)["kind"] === "profile_field",
    );
    if (target === undefined) expect.unreachable("fixture has no profile_field mapping");
    (target["source"] as Record<string, unknown>)["fieldKey"] = "contact.inside_leg";

    const parsed = parseReviewedEntry(broken);
    if (parsed.ok) expect.unreachable("an invented field key should refuse");
    expect(parsed.refusal.detail).toContain("canonical profile field");
  });

  it("refuses an unparseable document without throwing", () => {
    const parsed = parseReviewedEntryText("{ this is not json");
    if (parsed.ok) expect.unreachable("that is not JSON");
    expect(parsed.refusal.detail).toBe("is not valid JSON");
  });
});

describe("an approval binds to content", () => {
  it("loads the entry when the registry approves exactly this content", async () => {
    const text = documentOf();
    const result = await loadReviewedEntry({ text, registry: registryApproving(text) });
    if (!result.ok) expect.unreachable(`refused: ${result.refusal.kind}`);
    expect(String(result.entry.blueprint.blueprintId)).toBe("bp-gated-portal");
    expect(result.approval.approvedBy).toBe(REVIEWER);
    expect(result.contentHash).toBe(labelledHash(toCanonical(ENTRY)));
  });

  it("REFUSES when the registry is empty, however reviewed the bytes look", async () => {
    // The gated fixture genuinely says `status: "reviewed"` and carries a
    // reviewer and a review date. None of it is consulted.
    expect(ENTRY.blueprint.status).toBe("reviewed");
    expect(ENTRY.mappingSet.reviewedBy).not.toBeUndefined();

    const result = await loadReviewedEntry({
      text: documentOf(),
      registry: new InMemoryApprovalRegistry(),
    });
    if (result.ok) expect.unreachable("an empty registry approves nothing");
    expect(result.refusal.kind).toBe("not_approved");
  });

  // ═════════════════════════════════════════════════════════════════════════
  // THE PROOF VAHID ASKED FOR, both directions.
  // ═════════════════════════════════════════════════════════════════════════

  it("REFUSES altered bytes whose reviewer-looking fields are left intact", async () => {
    const original = documentOf();
    const registry = registryApproving(original);

    // Every way of meaningfully altering this artefact that a forger would try,
    // each leaving `status`, `reviewedBy` and `reviewedAt` untouched.
    const tampers: readonly { readonly what: string; readonly apply: (doc: Record<string, unknown>) => void }[] = [
      {
        what: "what a credential field is FOR (ADR-0043's marker)",
        apply: (doc) => {
          const mappings = (doc["mappingSet"] as Record<string, unknown>)["mappings"] as Record<string, unknown>[];
          const credential = mappings.find(
            (mapping) => (mapping["source"] as Record<string, unknown>)["kind"] === "secure_credential",
          );
          if (credential === undefined) expect.unreachable("fixture has no secure_credential");
          (credential["source"] as Record<string, unknown>)["purpose"] = "portal_password_reset";
        },
      },
      {
        what: "a date's FORMAT — the same value typed the wrong way round",
        apply: (doc) => {
          const mappings = (doc["mappingSet"] as Record<string, unknown>)["mappings"] as Record<string, unknown>[];
          const dated = mappings.find((mapping) => {
            const source = mapping["source"] as Record<string, unknown>;
            return (source["format"] as Record<string, unknown> | undefined)?.["kind"] === "date";
          });
          if (dated === undefined) expect.unreachable("fixture has no date format rule");
          const source = dated["source"] as Record<string, unknown>;
          (source["format"] as Record<string, unknown>)["pattern"] = "MM/DD/YYYY";
        },
      },
      {
        what: "which profile field feeds a portal field",
        apply: (doc) => {
          const mappings = (doc["mappingSet"] as Record<string, unknown>)["mappings"] as Record<string, unknown>[];
          const profile = mappings.find(
            (mapping) => (mapping["source"] as Record<string, unknown>)["kind"] === "profile_field",
          );
          if (profile === undefined) expect.unreachable("fixture has no profile_field mapping");
          const source = profile["source"] as Record<string, unknown>;
          // A DIFFERENT canonical key, chosen rather than hardcoded: naming one
          // the fixture already used would leave the document unaltered and the
          // refusal would prove nothing.
          const other = PROFILE_FIELD_KEYS.find((key) => key !== source["fieldKey"]);
          if (other === undefined) expect.unreachable("there is only one profile field key");
          source["fieldKey"] = other;
        },
      },
      {
        what: "a field's locator — where on the page the value is typed",
        apply: (doc) => {
          const pages = (doc["blueprint"] as Record<string, unknown>)["pages"] as Record<string, unknown>[];
          const sections = pages[0]?.["sections"] as Record<string, unknown>[];
          const fields = sections[0]?.["fields"] as Record<string, unknown>[];
          const locators = fields[0]?.["locators"] as Record<string, unknown>[];
          if (locators[0] === undefined) expect.unreachable("fixture field has no locator");
          locators[0]["value"] = "#somewhere-else";
        },
      },
      {
        what: "the intake the application is filed against",
        apply: (doc) => {
          doc["intakeRef"] = "2027-01";
        },
      },
      {
        what: "whether the portal demands MFA",
        apply: (doc) => {
          (doc["portalAuthentication"] as Record<string, unknown>)["mfaOrOtpRequired"] = true;
        },
      },
      {
        what: "how the student's password reaches the portal",
        apply: (doc) => {
          doc["passwordDelivery"] = "student_types_into_portal";
        },
      },
      {
        what: "the order of the pages",
        apply: (doc) => {
          const blueprint = doc["blueprint"] as Record<string, unknown>;
          blueprint["pages"] = [...(blueprint["pages"] as unknown[])].reverse();
        },
      },
    ];

    for (const tamper of tampers) {
      const doc = JSON.parse(original) as Record<string, unknown>;
      tamper.apply(doc);

      // The forgery is complete: the document still says it was reviewed, by
      // somebody other than its author, on a date.
      const set = doc["mappingSet"] as Record<string, unknown>;
      expect(set["status"], tamper.what).toBe("reviewed");
      expect(set["reviewedBy"], tamper.what).toBe(GATED_PORTAL_MAPPING_SET.reviewedBy);
      expect(set["reviewedBy"], tamper.what).not.toBe(set["authoredBy"]);
      expect((doc["blueprint"] as Record<string, unknown>)["status"], tamper.what).toBe("reviewed");
      // And it is genuinely different from what was approved.
      expect(JSON.stringify(doc), tamper.what).not.toBe(original);

      const result = await loadReviewedEntry({ text: JSON.stringify(doc), registry });
      if (result.ok) expect.unreachable(`altering ${tamper.what} was NOT refused`);
      expect(result.refusal.kind, tamper.what).toBe("not_approved");
    }
  });

  it("does NOT approve different content that shares id, version, author and reviewer", async () => {
    // The reverse question. Every descriptive field an approval might have been
    // keyed by is identical between these two documents; only the content
    // differs. If the registry were keyed by metadata this would load.
    const original = documentOf();
    const registry = registryApproving(original);

    const impostor = JSON.parse(original) as Record<string, unknown>;
    const set = impostor["mappingSet"] as Record<string, unknown>;
    const blueprint = impostor["blueprint"] as Record<string, unknown>;
    const mappings = set["mappings"] as Record<string, unknown>[];
    // One mapping removed: a required field silently left blank.
    set["mappings"] = mappings.slice(0, -1);

    const originalDoc = JSON.parse(original) as Record<string, unknown>;
    const originalSet = originalDoc["mappingSet"] as Record<string, unknown>;
    const originalBlueprint = originalDoc["blueprint"] as Record<string, unknown>;
    for (const key of ["mappingSetId", "version", "status", "authoredBy", "authoredAt", "reviewedBy", "reviewedAt", "blueprintId", "blueprintVersion"]) {
      expect(set[key], key).toEqual(originalSet[key]);
    }
    for (const key of ["blueprintId", "version", "status", "institutionName", "courseName", "intake"]) {
      expect(blueprint[key], key).toEqual(originalBlueprint[key]);
    }
    expect(impostor["institutionRef"]).toBe(originalDoc["institutionRef"]);
    expect(impostor["courseRef"]).toBe(originalDoc["courseRef"]);

    const result = await loadReviewedEntry({ text: JSON.stringify(impostor), registry });
    if (result.ok) expect.unreachable("matching metadata is not a matching artefact");
    expect(result.refusal.kind).toBe("not_approved");
    expect(result.refusal).toHaveProperty("contentHash");
  });

  it("accepts the SAME artefact written differently — whitespace is not content", async () => {
    // The other half of "binds to content": a reformatted file must not need a
    // new approval, or reviewers learn to re-approve without reading.
    const original = documentOf();
    const registry = registryApproving(original);
    const reformatted = JSON.stringify(JSON.parse(original), null, 4);
    expect(reformatted).not.toBe(original);

    const result = await loadReviewedEntry({ text: reformatted, registry });
    if (!result.ok) expect.unreachable(`refused: ${result.refusal.kind}`);
    expect(result.contentHash).toBe(labelledHash(toCanonical(ENTRY)));
  });

  it("is unaffected by the DEPLOYMENT origin, which nobody reviewed", async () => {
    // ADR-0057: the same approved entry runs against a university's UAT
    // environment without a second approval, because the origin is not in it.
    const text = documentOf();
    const registry = registryApproving(text);

    const production = await loadReviewedEntry({ text, registry });
    const sandbox = await loadReviewedEntry({
      text,
      registry,
      portalOrigin: "https://uat.gated.portal.test",
    });
    if (!production.ok || !sandbox.ok) expect.unreachable("both should load");
    expect(sandbox.contentHash).toBe(production.contentHash);
    expect(sandbox.entry.portalOrigin).toBe("https://uat.gated.portal.test");
    expect(production.entry.portalOrigin).toBeUndefined();
  });

  it("still applies the integrity gates an approval does not replace", async () => {
    // Two people can approve a mapping set pinned to the wrong blueprint
    // version. The pin check catches that, and it still runs — an approval is
    // not a substitute for coherence.
    const doc = JSON.parse(documentOf()) as Record<string, unknown>;
    (doc["mappingSet"] as Record<string, unknown>)["blueprintVersion"] = "9.9.9";
    const text = JSON.stringify(doc);

    const result = await loadReviewedEntry({ text, registry: registryApproving(text) });
    if (result.ok) expect.unreachable("a mismatched pin should refuse");
    expect(result.refusal.kind).toBe("mapping_not_usable");
  });

  it("refuses a DRAFT blueprint even when its content is approved", async () => {
    const doc = JSON.parse(documentOf()) as Record<string, unknown>;
    (doc["blueprint"] as Record<string, unknown>)["status"] = "draft";
    const text = JSON.stringify(doc);

    const result = await loadReviewedEntry({ text, registry: registryApproving(text) });
    if (result.ok) expect.unreachable("a draft is not executable");
    expect(result.refusal.kind).toBe("blueprint_not_executable");
  });
});

describe("the registry records people, not claims", () => {
  it("refuses an approval by the artefact's own author", () => {
    const result = approveContent({
      contentHash: labelledHash(toCanonical(ENTRY)),
      authoredBy: AUTHOR,
      approvedBy: AUTHOR,
      approvedAt: APPROVED_AT,
    });
    if (result.ok) expect.unreachable("self-approval is not review");
    expect(result.refusal.kind).toBe("self_approval");
  });

  it("refuses an approval that names nobody", () => {
    const result = approveContent({
      contentHash: labelledHash(toCanonical(ENTRY)),
      authoredBy: AUTHOR,
      approvedBy: "   ",
      approvedAt: APPROVED_AT,
    });
    if (result.ok) expect.unreachable("a blank name names nobody");
    expect(result.refusal.kind).toBe("missing_reviewer");
  });

  it("refuses a hash that is not one", () => {
    const result = approveContent({
      contentHash: "bp-gated-portal",
      authoredBy: AUTHOR,
      approvedBy: REVIEWER,
      approvedAt: APPROVED_AT,
    });
    if (result.ok) expect.unreachable("an id is not a content hash");
    expect(result.refusal.kind).toBe("malformed_hash");
  });

  it("refuses to overwrite an existing approval", () => {
    // Re-approving would replace the record of who actually reviewed it, which
    // is the only thing the registry is for.
    const registry = new InMemoryApprovalRegistry();
    const hash = labelledHash(toCanonical(ENTRY));
    const first = registry.record({
      contentHash: hash, authoredBy: AUTHOR, approvedBy: REVIEWER, approvedAt: APPROVED_AT,
    });
    expect(first.ok).toBe(true);
    const second = registry.record({
      contentHash: hash, authoredBy: AUTHOR, approvedBy: "someone-else", approvedAt: APPROVED_AT,
    });
    if (second.ok) expect.unreachable("an approval is not overwritten");
    expect(second.refusal.kind).toBe("already_approved");
    expect(registry.all()[0]?.approvedBy).toBe(REVIEWER);
  });
});

describe("the catalogue that gets served", () => {
  it("serves an entry by blueprint id and answers null for anything else", async () => {
    const text = documentOf();
    const loaded = await loadReviewedEntry({ text, registry: registryApproving(text) });
    if (!loaded.ok) expect.unreachable("should load");

    const catalogue = new ReviewedCatalogue([
      { entry: loaded.entry, contentHash: loaded.contentHash },
    ]);
    expect(await catalogue.find("bp-gated-portal")).not.toBeNull();
    expect(await catalogue.find("bp-something-nobody-reviewed")).toBeNull();
    expect(catalogue.size).toBe(1);
    expect(catalogue.inventory()[0]?.contentHash).toBe(loaded.contentHash);
  });

  it("is empty when nothing was approved, and empty serves nothing", async () => {
    const catalogue = new ReviewedCatalogue([]);
    expect(catalogue.size).toBe(0);
    expect(await catalogue.find("bp-gated-portal")).toBeNull();
  });
});
