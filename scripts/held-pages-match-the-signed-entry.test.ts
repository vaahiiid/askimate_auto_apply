/**
 * The held-page register holds the page it means in the entry his run loads.
 *
 * P305, ADR-0160. A hold is matched by (blueprint, pageRef) OR by address, so
 * one key drifting does not release it. Both drifting would, silently: the
 * register would name a page the entry no longer has, every run would pass
 * it, and nothing would say so. This test is what says so. It reads the
 * signed entry from disk, as the service does, and asks the register about
 * every page in it.
 *
 * Vahid, 2026-10-13 (`docs/run-a/p305-his-answers-on-adr-0159-as-sent.txt`):
 * *"Until this is known, my run must stop before saving page 12."*
 */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { HELD_PAGES, heldPageOf } from "@askimate/aas-catalogue";

const ROOT = resolve(join(import.meta.dirname, ".."));
const ENTRY = join(ROOT, "docs", "run-a", "catalogue", "entries", "sheffield-pgt-2027-09.json");

interface EntryPage {
  readonly pageRef: string;
  readonly url?: string;
  readonly nextPageRef?: string;
  readonly sections: readonly { readonly fields: readonly { readonly fieldRef: string }[] }[];
}

const entry = JSON.parse(readFileSync(ENTRY, "utf8")) as {
  readonly blueprint: { readonly blueprintId: string; readonly pages: readonly EntryPage[] };
  readonly mappingSet: { readonly mappings: readonly { readonly fieldRef: string }[] };
};

describe("the held-page register against the signed Sheffield entry", () => {
  const blueprintId = entry.blueprint.blueprintId;
  const held = entry.blueprint.pages.filter((page) => heldPageOf(blueprintId, page) !== null);

  it("holds page 12, the course choice page, and no other page of the entry", () => {
    expect(held.map((page) => page.pageRef)).toEqual(["page12"]);
  });

  it("holds it by BOTH keys, so either one drifting still holds it", () => {
    const page12 = entry.blueprint.pages.find((page) => page.pageRef === "page12");
    if (page12?.url === undefined) expect.unreachable("page 12 carries its address in the signed entry");
    expect(heldPageOf(blueprintId, { pageRef: "page12" }), "by its ref alone").not.toBeNull();
    expect(heldPageOf("bp-renamed", { pageRef: "renumbered", url: page12.url }), "by its address alone").not.toBeNull();
  });

  it("lets no page whose save continues to a held page be filled, so the run never lands on it", () => {
    // The P305 review: "I will not open it" holds only while no page the run
    // saves continues to the held page. Page 11 continues to page 12 and has
    // nothing mapped today; the first patch that maps it must turn this red.
    const mapped = new Set(entry.mappingSet.mappings.map((mapping) => mapping.fieldRef));
    const before = entry.blueprint.pages.filter(
      (page) =>
        page.nextPageRef !== undefined &&
        held.some((heldPage) => heldPage.pageRef === page.nextPageRef) &&
        page.sections.some((section) => section.fields.some((field) => mapped.has(field.fieldRef))),
    );
    expect(before.map((page) => page.pageRef), "a filled page whose save lands on a held page").toEqual([]);
    expect(
      entry.blueprint.pages.filter((page) => page.nextPageRef === "page12").map((page) => page.pageRef),
      "the page that continues to page 12 is still the one this test was written against",
    ).toEqual(["page11"]);
  });

  it("names, for every hold in the register, a page the signed entry has", () => {
    for (const hold of HELD_PAGES.filter((candidate) => candidate.blueprintId === blueprintId)) {
      expect(
        entry.blueprint.pages.some((page) => page.pageRef === hold.pageRef && page.url === hold.url),
        `${hold.pageRef} at ${hold.url}`,
      ).toBe(true);
    }
  });
});
