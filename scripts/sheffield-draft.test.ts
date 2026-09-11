/**
 * The Sheffield artefacts, as committed, hold together under the real checks.
 *
 * `docs/captures/sheffield-pgt-2026-09-10/` carries the curated draft
 * blueprint and the equal-opportunities mapping set that ADR-0102 produced.
 * Both are DRAFTS — `checkUsable` rightly refuses a draft — so this test does
 * what a second reviewer's signature would do, in memory, and asserts what
 * must then be true: every field classified, the two refusals accepted, the
 * eleven covered controls neither answered nor blockers, the only blockers the
 * required fields on pages nobody has mapped yet, and the preview block
 * reading as Vahid specified — the quote on the disability refusal, nothing
 * quoted on ethnic origin, because that field's text says nothing.
 *
 * Vahid, 2026-09-11: *"Omit, do not borrow the disability field's sentence."*
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseBlueprint, parseMappingSet } from "@askimate/aas-catalogue";
import { proposeValue, studentId } from "@askimate/aas-domain";
import { checkUsable, planFill, textOf } from "@askimate/aas-mapping";
import { buildPreview, renderPreview } from "@askimate/aas-preparation";
import type { ConfirmedProfile, ProfileFieldKey, ProfileFieldType } from "@askimate/aas-profile";
import { applyConfirmation, confirmField, emptyProfile, isDeclined } from "@askimate/aas-profile";

const NOW = new Date(0);
const STUDENT = studentId("stu");

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
      confirmation: { studentRef: STUDENT, presentedText: "…", respondedAt: NOW, response: { kind: "accepted" } },
    });
    if (isDeclined(result)) expect.unreachable("accepted");
    profile = confirmField(profile, result, NOW);
  }
  return profile;
}

const PROFILE_ENTRIES: readonly [ProfileFieldKey, unknown][] = [
  ["identity.given_name", "Niloofar"],
  ["identity.family_name", "Hosseini"],
  ["identity.date_of_birth", new Date("1999-04-02T00:00:00Z")],
  ["contact.email", "niloofar.hosseini@example.com"],
  ["contact.address", { line1: "12 Example Road", city: "Sheffield", postalCode: "S10 2TN", countryCode: "GB" }],
];
const PROFILE = withConfirmed(PROFILE_ENTRIES);

const DIR = join(import.meta.dirname, "..", "docs", "captures", "sheffield-pgt-2026-09-10");

function load() {
  const blueprint = parseBlueprint(JSON.parse(readFileSync(join(DIR, "blueprint.draft.curated.json"), "utf8")));
  const mappingSet = parseMappingSet(
    JSON.parse(readFileSync(join(DIR, "mapping-set.draft.json"), "utf8")),
  );
  if (!blueprint.ok) expect.unreachable(`blueprint: ${JSON.stringify(blueprint.refusal)}`);
  if (!mappingSet.ok) expect.unreachable(`mapping set: ${JSON.stringify(mappingSet.refusal)}`);
  return { blueprint: blueprint.value, mappingSet: mappingSet.value };
}

describe("the Sheffield drafts, under the real checks", () => {
  const { blueprint, mappingSet } = load();
  // What a second reviewer's signature would do. In memory only: the files
  // stay drafts, and the signature is Iman's to give, not this test's.
  const asIfReviewed = { ...mappingSet, status: "reviewed" as const, reviewedBy: "reviewer-b", reviewedAt: new Date(0) };

  it("are drafts, and the checks say so", () => {
    expect(blueprint.status).toBe("draft");
    expect(mappingSet.status).toBe("draft");
    const check = checkUsable(mappingSet, blueprint);
    expect(check.usable).toBe(false);
    if (!check.usable) expect(check.refusal.kind).toBe("not_reviewed");
  });

  it("classify every one of the 216 fields, and accept the two refusals the form offers", () => {
    const check = checkUsable(asIfReviewed, blueprint);
    expect(check.usable, check.usable ? "" : JSON.stringify(check.refusal).slice(0, 300)).toBe(true);
    if (!check.usable) expect.unreachable("usable");
    const plan = planFill(blueprint, check.mappingSet, emptyProfile(studentId("stu"), new Date(0)));
    expect(plan.instructions.filter((i) => i.value.kind === "form_refusal").map((i) => i.fieldRef)).toEqual([
      "ratherNotSay",
      "ethnicOriginCode",
    ]);
    // With an empty profile the mapped fields want values (the interview's
    // job), and the four employment fields have no mapping because the
    // registry has no field for them (P89, raised) — and NOTHING else blocks:
    // no covered control, no unclassified field, no refused render.
    expect(new Set(plan.blockers.map((b) => b.kind))).toEqual(new Set(["value_unavailable", "no_mapping"]));
    expect(plan.blockers.filter((b) => b.kind === "no_mapping").map((b) => b.fieldRef).sort()).toEqual([
      "duties",
      "employerDetails",
      "position",
      "startMonth",
    ]);
  });

  it("fill the personal and contact pages from a confirmed profile, the date as three selects", () => {
    const check = checkUsable(asIfReviewed, blueprint);
    if (!check.usable) expect.unreachable(check.refusal.kind);
    const plan = planFill(blueprint, check.mappingSet, PROFILE);
    const typed = new Map(plan.instructions.map((i) => [i.fieldRef, textOf(i.value)]));
    expect(typed.get("forename")).toBe("Niloofar");
    expect(typed.get("surname")).toBe("Hosseini");
    expect(typed.get("dobDay")).toBe("2");
    expect(typed.get("dobMonth")).toBe("April");
    expect(typed.get("dobYear")).toBe("1999");
    expect(typed.get("confirmEmail")).toBe("niloofar.hosseini@example.com");
    expect(typed.get("corrCountry")).toBe("UNITED KINGDOM");
    expect(typed.get("corrPostcode")).toBe("S10 2TN");
    expect(plan.blockers.map((b) => b.kind)).toEqual(["no_mapping", "no_mapping", "no_mapping", "no_mapping"]);
  });

  it("refuse to render a country the partial map does not name, rather than approximate", () => {
    const check = checkUsable(asIfReviewed, blueprint);
    if (!check.usable) expect.unreachable(check.refusal.kind);
    const elsewhere = withConfirmed([
      ...PROFILE_ENTRIES.filter(([key]) => key !== "contact.address"),
      ["contact.address", { line1: "1 Rue Example", city: "Lyon", postalCode: "69001", countryCode: "FR" }],
    ]);
    const plan = planFill(blueprint, check.mappingSet, elsewhere);
    const refused = plan.blockers.find((b) => b.kind === "render_refused");
    expect(refused?.fieldRef).toBe("corrCountry");
  });

  it("render the block as decided: the quote on disability, nothing quoted on ethnic origin", () => {
    const page = { ...blueprint, pages: blueprint.pages.filter((p) => p.pageRef === "page9") };
    const onPage = new Set(page.pages.flatMap((p) => p.sections.flatMap((s) => s.fields.map((f) => f.fieldRef))));
    const pageOnly = { ...asIfReviewed, mappings: asIfReviewed.mappings.filter((m) => onPage.has(m.fieldRef)) };
    const check = checkUsable(pageOnly, page);
    if (!check.usable) expect.unreachable(check.refusal.kind);
    const plan = planFill(page, check.mappingSet, emptyProfile(studentId("stu"), new Date(0)));
    const preview = buildPreview(page, plan, new Map(), { portalHost: "www.sheffield.ac.uk" });
    if (!preview.built) expect.unreachable(preview.refusal.kind);
    const text = renderPreview(preview.preview);
    expect(text).toContain("We did not answer these for you:");
    expect(text).toContain('The form says: "if you go on to register on a course you will have another opportunity to answer later"');
    expect(text).toContain("Left untouched, as part of this:");
    expect(text).toContain("Learning difference such as dyslexia, dyspraxia or AD(H)D");
    const ethnic = text.slice(text.indexOf("ethnic origin"));
    expect(ethnic).toContain('Instead we entered "Prefer not to say"');
    expect(ethnic).not.toContain("The form says:");
    expect(preview.preview.entries).toHaveLength(0);
    expect(preview.preview.refusals).toHaveLength(2);
  });
});
