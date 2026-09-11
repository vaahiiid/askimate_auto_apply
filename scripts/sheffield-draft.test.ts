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
import { studentId } from "@askimate/aas-domain";
import { checkUsable, planFill } from "@askimate/aas-mapping";
import { buildPreview, renderPreview } from "@askimate/aas-preparation";
import { emptyProfile } from "@askimate/aas-profile";

const DIR = join(import.meta.dirname, "..", "docs", "captures", "sheffield-pgt-2026-09-10");

function load() {
  const blueprint = parseBlueprint(JSON.parse(readFileSync(join(DIR, "blueprint.draft.curated.json"), "utf8")));
  const mappingSet = parseMappingSet(
    JSON.parse(readFileSync(join(DIR, "mapping-set.equal-opportunities.draft.json"), "utf8")),
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
    // The other pages are unmapped, so their required fields block — and
    // NOTHING else does: no covered control, no unclassified field.
    expect(new Set(plan.blockers.map((b) => b.kind))).toEqual(new Set(["no_mapping"]));
    expect(plan.blockers).toHaveLength(13);
  });

  it("render the block as decided: the quote on disability, nothing quoted on ethnic origin", () => {
    const page = { ...blueprint, pages: blueprint.pages.filter((p) => p.pageRef === "page9") };
    const check = checkUsable(asIfReviewed, page);
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
