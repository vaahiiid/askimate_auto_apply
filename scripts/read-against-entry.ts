/**
 * A read, passed through, against the rows an entry was built with (P284).
 *
 *   pnpm exec tsx scripts/read-against-entry.ts <entry.json> <fieldRef> <read-file> [<case> | "(escaped)"]
 *
 * P283 built 201 grade rows from a sentence describing a list, and the list
 * sent to correct it carried an ellipsis. CLAUDE.md, second instance: a read
 * reaches a record as its own output, never retyped. This is the comparison
 * that output is for: every line of the read against the options the entry's
 * blueprint holds for that field, said line by line.
 *
 * The read file is the form's own output, unedited: lines of `value<TAB>label`,
 * or a JSON array of `[value, label]` pairs or `{ value, label }` objects (what
 * the console snippet and the inspection files print). A line that is neither
 * — an ellipsis, a note — is reported as NOT A READ LINE, and the comparison
 * says it cannot vouch for what that line stands for.
 *
 * And the other way: every value the field's mapping rows type, under the
 * switch case named (an institution, say — the blueprint's list is the union
 * of every institution's), that the file does not hold is BUILT, NOT IN FILE: a
 * row that would send the form a value its list never offered. The case
 * "(escaped)" names a switch's branch taken after a form's escape (P293): the
 * rows sent once the student chose "Not in list" in the field it names, to be
 * compared with the list read with that escape chosen.
 *
 * Exits 1 on any difference, on any row the read does not hold, and on any
 * line it cannot read, so silence is never the verdict.
 *
 * P294: a read printed with what it was made under — `{ under: {…}, <list>: […] }`
 * (docs/run-a/p294-reads.md) — is also checked against the entry's records of
 * its reads for that field: one must be made under exactly what the file says,
 * or it exits 1 (NO RECORD).
 *
 * What it cannot see (P285): where the file came from. A list rebuilt with a
 * shell loop compares exactly as the form's own output does, and P285 ran one
 * and counted its matches as confirmed reads. So the summary says "lines of
 * this file", never "read", and says that it cannot tell the difference.
 */

import { readFileSync } from "node:fs";

interface Option {
  readonly value: string;
  readonly label: string;
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

function readLines(text: string): { readonly pairs: Option[]; readonly unread: string[]; readonly under?: Readonly<Record<string, string>>; readonly typed?: string } {
  const trimmed = text.trim();
  // P294: the printed form of a read that says what it was made under —
  // { under: { <select name>: <value>, … }, <the list>: [[value, label, …], …] }
  // with `typed` beside it for a search.
  if (trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const lists = Object.entries(parsed).filter(([key, value]) => key !== "under" && Array.isArray(value));
    if (lists.length !== 1) fail(`The read holds ${String(lists.length)} lists; expected one beside "under".`);
    const under = parsed["under"];
    if (under === null || typeof under !== "object" || Array.isArray(under)) fail('The read has no "under": what it was made under is not in it.');
    return {
      pairs: (lists[0]?.[1] as unknown[]).map((item) => (Array.isArray(item) ? { value: String(item[0]), label: String(item[1]) } : { value: String((item as Option).value), label: String((item as Option).label) })),
      unread: [],
      under: Object.fromEntries(Object.entries(under as Record<string, unknown>).map(([key, value]) => [key, String(value)])),
      ...(typeof parsed["typed"] === "string" ? { typed: parsed["typed"] } : {}),
    };
  }
  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed) as unknown[];
    return {
      pairs: parsed.map((item) =>
        Array.isArray(item) ? { value: String(item[0]), label: String(item[1]) } : { value: String((item as Option).value), label: String((item as Option).label) },
      ),
      unread: [],
    };
  }
  const pairs: Option[] = [];
  const unread: string[] = [];
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) continue;
    const parts = line.split("\t");
    if (parts.length === 2) pairs.push({ value: parts[0] ?? "", label: parts[1] ?? "" });
    else unread.push(line);
  }
  return { pairs, unread };
}

function optionsOf(entry: unknown, fieldRef: string): Option[] {
  const pages = (entry as { blueprint?: { pages?: { sections: { fields: { fieldRef: string; options?: Option[] }[] }[] }[] } }).blueprint?.pages ?? [];
  for (const page of pages) {
    for (const section of page.sections) {
      const field = section.fields.find((candidate) => candidate.fieldRef === fieldRef);
      if (field !== undefined) return field.options ?? [];
    }
  }
  return fail(`No field "${fieldRef}" in the entry's blueprint.`);
}

/** The values a mapping's option rows send, under the switch case named where there is one. */
function targetsOf(rule: unknown, caseKey: string | undefined, into: Set<string>): void {
  if (rule === null || typeof rule !== "object") return;
  const node = rule as { kind?: string; options?: Record<string, string>; cases?: Record<string, unknown>; then?: unknown };
  if (node.kind === "option" && node.options !== undefined) for (const target of Object.values(node.options)) into.add(target);
  if (node.cases !== undefined) {
    const named = caseKey === "(escaped)" ? [] : caseKey !== undefined && caseKey in node.cases ? [node.cases[caseKey]] : Object.values(node.cases);
    for (const branch of named) targetsOf(branch, caseKey, into);
  }
  if (node.then !== undefined) targetsOf(node.then, caseKey, into);
  // P293: a switch's branch taken after a form's escape — walked when no case
  // is named, or when it is named as "(escaped)".
  const escaped = (node as { escaped?: { then?: unknown } }).escaped;
  if (escaped !== undefined && (caseKey === undefined || caseKey === "(escaped)")) targetsOf(escaped.then, undefined, into);
}

const [entryPath, fieldRef, readPath, caseKey] = process.argv.slice(2);
if (entryPath === undefined || fieldRef === undefined || readPath === undefined) {
  fail('Usage: tsx scripts/read-against-entry.ts <entry.json> <fieldRef> <read-file> [<case> | "(escaped)"]');
}
const entry = JSON.parse(readFileSync(entryPath, "utf8")) as { mappingSet?: { mappings?: { fieldRef: string; source?: { format?: unknown } }[] } };
const built = optionsOf(entry, fieldRef);
const rows = new Set<string>();
for (const mapping of entry.mappingSet?.mappings ?? []) if (mapping.fieldRef === fieldRef) targetsOf(mapping.source?.format, caseKey, rows);
const { pairs, unread, under, typed } = readLines(readFileSync(readPath, "utf8"));
const builtLabel = new Map(built.map((option) => [option.value, option.label]));

let differs = 0;
for (const { value, label } of pairs) {
  const have = builtLabel.get(value);
  if (have === undefined) {
    differs += 1;
    process.stdout.write(`MISSING   ${JSON.stringify(value)} "${label}" — in the file, not in the entry\n`);
  } else if (have !== label) {
    differs += 1;
    process.stdout.write(`DIFFERS   ${JSON.stringify(value)} — the file says "${label}", the entry "${have}"\n`);
  }
}
const readValues = new Set(pairs.map((pair) => pair.value));
const unreadRows = [...rows].filter((value) => !readValues.has(value));
for (const value of unreadRows) process.stdout.write(`BUILT, NOT IN FILE   ${JSON.stringify(value)} — a row sends it; the file does not hold it\n`);
for (const line of unread) process.stdout.write(`NOT A READ LINE   ${JSON.stringify(line)} — what it stands for is not vouched for\n`);

// P294: what the file says it was read under, against the entry's records of
// its reads for this field. The file names the form's own selects; the entry
// names the box that sets each (`frontedBy`), so each is translated first.
let madeUnderMissing = false;
if (under !== undefined) {
  type Field = { fieldRef: string; locators?: { strategy: string; value: string }[]; frontedBy?: string; optionsAfter?: { fieldRef: string }; searches?: { word: string; under?: { fieldRef: string; value: string }[] }[]; listsAfter?: { fieldRef: string; value: string; under?: { fieldRef: string; value: string }[] }[] };
  const fields = ((entry as { blueprint?: { pages?: { sections: { fields: Field[] }[] }[] } }).blueprint?.pages ?? []).flatMap((page) => page.sections.flatMap((section) => section.fields));
  const refOf = (name: string): string => {
    const select = fields.find((candidate) => (candidate.locators ?? []).some((locator) => locator.strategy === "name" && locator.value === name));
    return select?.frontedBy ?? select?.fieldRef ?? name;
  };
  const said = Object.entries(under).map(([name, value]) => [refOf(name), value] as const);
  process.stdout.write(`MADE UNDER (the file)   ${said.map(([ref, value]) => `${ref} = ${JSON.stringify(value)}`).join(", ")}\n`);
  const field = fields.find((candidate) => candidate.fieldRef === fieldRef);
  const records = [
    ...(field?.searches ?? []).filter((search) => typed === undefined || search.word === typed).map((search) => ({ name: `search "${search.word}"`, held: new Map((search.under ?? []).map((entry_) => [entry_.fieldRef, entry_.value])) })),
    ...(typed !== undefined ? [] : (field?.listsAfter ?? []).map((list) => ({ name: `list after ${list.fieldRef} = ${JSON.stringify(list.value)}`, held: new Map([[list.fieldRef, list.value], ...(list.under ?? []).map((entry_) => [entry_.fieldRef, entry_.value] as const)]) }))),
  ];
  // The fields this field's list follows, as the entry records them. Every
  // one of them the file printed must be in the record with the same value;
  // a select the file printed that the list does not follow (the field's own
  // value, say) is not a condition of the read. And everything the record
  // holds must be what the file printed.
  const chain: string[] = [];
  for (let next = field?.optionsAfter?.fieldRef; next !== undefined && !chain.includes(next); next = fields.find((candidate) => candidate.fieldRef === next)?.optionsAfter?.fieldRef) {
    chain.push(next);
  }
  const matching = records.filter(
    (record) =>
      said.every(([ref, value]) => !chain.includes(ref) || record.held.get(ref) === value) &&
      [...record.held].every(([ref, value]) => said.some(([other, its]) => other === ref && its === value)),
  );
  for (const record of records) {
    process.stdout.write(`${matching.includes(record) ? "RECORD MATCHES" : "RECORD DIFFERS"}   the entry's ${record.name}: ${[...record.held].map(([ref, value]) => `${ref} = ${JSON.stringify(value)}`).join(", ") || "made under nothing recorded"}\n`);
  }
  if (matching.length === 0) {
    madeUnderMissing = true;
    process.stdout.write(`NO RECORD   the entry holds no read for ${fieldRef} made under what the file says\n`);
  }
}

const confirmed = pairs.length - differs;
process.stdout.write(
  `\n${String(pairs.length)} line(s) in ${readPath}; ${String(confirmed)} match the entry's options for ${fieldRef}, ` +
    `${String(differs)} differ or are missing, ${String(unread.length)} could not be read as a line.\n` +
    `${String(rows.size)} value(s) sent by ${fieldRef}'s rows${caseKey === undefined ? "" : ` under "${caseKey}"`}: ` +
    `${String(rows.size - unreadRows.length)} held by a line of this file, ${String(unreadRows.length)} not.\n` +
    `This compares a FILE with the entry. Whether the file is the form's own output — exported, not retyped,\n` +
    `not rebuilt by a loop — it cannot tell; only where the file came from can say that.\n`,
);
process.exit(differs > 0 || unread.length > 0 || unreadRows.length > 0 || madeUnderMissing ? 1 : 0);
