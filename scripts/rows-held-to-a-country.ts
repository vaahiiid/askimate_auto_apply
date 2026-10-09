/**
 * Which rows are held to what their reads were made under (P294, row 143).
 *
 *   pnpm exec tsx scripts/rows-held-to-a-country.ts <entry.json>
 *
 * Vahid, 2026-10-09: *"before any second portal, the Iran key must not depend
 * on someone setting it by hand."* For every field whose list follows another
 * that offers a choice (Sheffield's institution box follows the country box),
 * it counts the field's option rows and how many of them a read holds that
 * records what that field held (`under`, or the value a list is read after).
 * A row no such read holds is held to no country: `checkUsable` cannot refuse
 * it for one, because nothing records which it was.
 *
 * What it counts as a row: every value an option rule in the field's mapping
 * sends, a branch taken after an escape included, each once. What it cannot
 * see: whether a read's record is the read's own output or was entered by
 * hand. The entry's notes say which.
 */

import { readEntry } from "./questions-per-application.js";

import type { FormatRule } from "@askimate/aas-profile";

const [entryPath] = process.argv.slice(2);
if (entryPath === undefined) {
  process.stderr.write("usage: tsx scripts/rows-held-to-a-country.ts <entry.json>\n");
  process.exit(2);
}

function targetsOf(rule: FormatRule): readonly string[] {
  if (rule.kind === "option") return Object.values(rule.options);
  if (rule.kind === "part" || rule.kind === "date") return rule.then === undefined ? [] : targetsOf(rule.then);
  if (rule.kind === "switch") return [...Object.values(rule.cases), ...(rule.escaped === undefined ? [] : [rule.escaped.then])].flatMap((branch) => targetsOf(branch));
  return [];
}

const entry = readEntry(entryPath);
const fields = entry.blueprint.pages.flatMap((page) => page.sections.flatMap((section) => section.fields));
const byRef = new Map(fields.map((field) => [field.fieldRef, field]));
const lines: string[] = [];
for (const field of fields) {
  const chain: string[] = [];
  for (let next = field.optionsAfter?.fieldRef; next !== undefined && !chain.includes(next); next = byRef.get(next)?.optionsAfter?.fieldRef) chain.push(next);
  const choosing = chain.filter((fieldRef) => (byRef.get(fieldRef)?.options ?? []).length > 0);
  if (choosing.length === 0) continue;
  const mapping = entry.mappingSet.mappings.find((candidate) => candidate.fieldRef === field.fieldRef);
  if (mapping?.source.kind !== "profile_field") continue;
  const rows = [...new Set(targetsOf(mapping.source.format))];
  const recorded = [
    ...(field.searches ?? []).map((search) => ({ entries: search.entries, held: (search.under ?? []).map((held) => held.fieldRef) })),
    ...(field.listsAfter ?? []).map((list) => ({ entries: list.entries, held: [list.fieldRef, ...(list.under ?? []).map((held) => held.fieldRef)] })),
  ].filter((read) => read.held.some((fieldRef) => choosing.includes(fieldRef)));
  const held = rows.filter((target) => recorded.some((read) => read.entries.includes(target)));
  lines.push(
    `${field.fieldRef} (follows ${choosing.map((fieldRef) => `"${fieldRef}"`).join(", ")}): ${String(rows.length)} row value(s); ` +
      `${String(recorded.length)} read(s) recording what those held; ${String(held.length)} row value(s) held by one; ${String(rows.length - held.length)} held by none.`,
  );
}
process.stdout.write(`${lines.join("\n")}\n`);
