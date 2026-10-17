/**
 * A constraint that cannot fire yet, held so it cannot be forgotten when it can.
 *
 * P318's bypass refuter: a student's choice from a form's own list (P290,
 * `entry_choices`) sets what a box submits from a table the mandatory review's
 * fingerprint does not read (ADR-0161 §6). Today no signed entry gives a box
 * filled from a financial answer an escape, so no such choice can be offered on
 * one, and nothing a review covers can change unseen that way. His D7
 * ("approved.": the form's own list, with its escape, for a scholarship or loan
 * it does not name) makes it reachable. When an entry first does, this fails,
 * and the review must cover the choice before that entry is signed.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { isFinancialField } from "@askimate/aas-profile";
import type { ProfileFieldKey } from "@askimate/aas-profile";
import { describe, expect, it } from "vitest";

const ENTRIES = join(import.meta.dirname, "..", "docs", "run-a", "catalogue", "entries");

/** Every value under `key` anywhere inside `node`. */
function valuesOf(node: unknown, key: string): unknown[] {
  if (Array.isArray(node)) return node.flatMap((item) => valuesOf(item, key));
  if (typeof node !== "object" || node === null) return [];
  return Object.entries(node as Record<string, unknown>).flatMap(([name, value]) => (name === key ? [value] : []).concat(valuesOf(value, key)));
}

/** The blueprint's fields that carry an escape, by their reference. */
function escapedFields(blueprint: unknown): Set<string> {
  const found = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node !== "object" || node === null) return;
    const record = node as Record<string, unknown>;
    if (typeof record["fieldRef"] === "string" && valuesOf(record, "escapeValue").length > 0) found.add(record["fieldRef"]);
    Object.values(record).forEach(walk);
  };
  walk(blueprint);
  return found;
}

/** Boxes filled from a financial answer that offer an escape: where a choice could change one unseen. */
export function financialBoxesWithAnEscape(entry: { readonly blueprint: unknown; readonly mappingSet: { readonly mappings: readonly unknown[] } }): string[] {
  const escaped = escapedFields(entry.blueprint);
  return entry.mappingSet.mappings.flatMap((mapping) => {
    const fieldRef = (mapping as { readonly fieldRef?: unknown }).fieldRef;
    if (typeof fieldRef !== "string" || !escaped.has(fieldRef)) return [];
    const financial = valuesOf(mapping, "fieldKey").some((key) => typeof key === "string" && isFinancialField(key as ProfileFieldKey));
    return financial ? [fieldRef] : [];
  });
}

const entries = readdirSync(ENTRIES)
  .filter((name) => name.endsWith(".json"))
  .map((name) => ({ name, entry: JSON.parse(readFileSync(join(ENTRIES, name), "utf8")) as Parameters<typeof financialBoxesWithAnEscape>[0] }));

describe("a choice on a box filled from a financial answer waits for the review to cover it (ADR-0161 §6, P318)", () => {
  it("reads at least one signed entry", () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it.each(entries)("$name offers no escape on a box filled from a financial answer", ({ entry }) => {
    expect(
      financialBoxesWithAnEscape(entry),
      "a box filled from a financial answer offers the form's own list with an escape: the review's fingerprint must cover the student's choice there before this entry is signed (ADR-0161 §6)",
    ).toEqual([]);
  });

  it("sees one when it is there: the funding source given an escape", () => {
    const signed = entries[0]?.entry;
    if (signed === undefined) expect.unreachable("an entry");
    const planted = JSON.parse(JSON.stringify(signed)) as { blueprint: unknown; mappingSet: { mappings: unknown[] } };
    const plant = (node: unknown): boolean => {
      if (Array.isArray(node)) return node.some(plant);
      if (typeof node !== "object" || node === null) return false;
      const record = node as Record<string, unknown>;
      if (record["fieldRef"] === "fundingSource") {
        record["escapeValue"] = "Other";
        return true;
      }
      return Object.values(record).some(plant);
    };
    expect(plant(planted.blueprint), "the signed entry has a funding source box").toBe(true);
    expect(financialBoxesWithAnEscape(planted)).toContain("fundingSource");
  });
});
