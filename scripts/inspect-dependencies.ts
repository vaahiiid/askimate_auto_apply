/**
 * What the captured pages declare about fields depending on other fields.
 *
 *   pnpm run inspect-dependencies <run-directory>
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 *
 * Vahid, 2026-09-10, on the first real attached read of Sheffield's form: a
 * refused `POST …/getGradingSystemsForCountry.do` on the education page —
 * *"the education page fetches grading systems when a country is chosen, so
 * some fields depend on others being set first. If the blueprint does not
 * carry that, a fill will set a field whose options have not loaded. Find
 * every dependency of that shape in the captures, not just this one."*
 *
 * The captures stay on the machine that made them (a signed-in page can
 * carry the person's name), so this reads them THERE and prints structure:
 * which controls carry an inline handler, which endpoints the page's scripts
 * name, which selects have no options in the capture, which forms are the
 * site's own furniture rather than the application. No values are printed —
 * the captures already have input values removed, and this prints element
 * names, ids, handler text and endpoint paths only.
 *
 * It reads markup with regular expressions, deliberately: no parser
 * dependency, no browser, no network, and an honest limit — a listener added
 * by `addEventListener` in a script is not an attribute and is reported only
 * if the script text names the control. What it finds is evidence for the
 * reviewer; what it misses is said at the end.
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

const BOLD = "[1m";
const DIM = "[2m";
const RESET = "[0m";

interface RunRecord {
  readonly runId?: string;
  readonly blockedRequests?: readonly {
    readonly method: string;
    readonly url: string;
    readonly rule?: string;
    readonly reason?: string;
  }[];
}

interface IndexRecord {
  readonly pages?: readonly { readonly url: string; readonly file: string }[];
}

interface Control {
  readonly tag: string;
  readonly name: string;
  readonly id: string;
  readonly type: string;
  readonly required: boolean;
  readonly handlers: readonly { readonly on: string; readonly text: string }[];
  readonly optionCount: number | null;
}

/** Collapses whitespace and truncates, so a handler is one line. */
function snippet(text: string, max = 140): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

function attribute(tag: string, name: string): string {
  const match = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return match?.[2] ?? match?.[3] ?? match?.[4] ?? "";
}

function hasFlag(tag: string, name: string): boolean {
  return new RegExp(`\\s${name}(\\s|=|>|/)`, "i").test(tag);
}

/** Every input, select and textarea in the markup, with what it declares. */
function controlsOf(html: string): Control[] {
  const controls: Control[] = [];
  const pattern = /<(input|select|textarea)\b([^>]*)>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const tag = match[0];
    const kind = (match[1] ?? "").toLowerCase();
    const handlers: { on: string; text: string }[] = [];
    const handlerPattern = /\s(on[a-z]+)\s*=\s*("([^"]*)"|'([^']*)')/gi;
    let handler: RegExpExecArray | null;
    while ((handler = handlerPattern.exec(tag)) !== null) {
      handlers.push({ on: (handler[1] ?? "").toLowerCase(), text: snippet(handler[3] ?? handler[4] ?? "") });
    }
    let optionCount: number | null = null;
    if (kind === "select") {
      const close = html.indexOf("</select>", match.index);
      const body = close === -1 ? "" : html.slice(match.index, close);
      optionCount = (body.match(/<option\b/gi) ?? []).length;
    }
    controls.push({
      tag: kind,
      name: attribute(tag, "name"),
      id: attribute(tag, "id"),
      type: kind === "input" ? attribute(tag, "type").toLowerCase() || "text" : kind,
      required: hasFlag(tag, "required") || /aria-required\s*=\s*"?true/i.test(tag),
      handlers,
      optionCount,
    });
  }
  return controls;
}

/** Endpoints the page's own scripts name: anything ending .do or .app. */
function endpointsInScripts(html: string): { endpoint: string; context: string }[] {
  const found: { endpoint: string; context: string }[] = [];
  const scripts = html.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) ?? [];
  const seen = new Set<string>();
  for (const script of scripts) {
    const pattern = /["'`]([^"'`\s]*\.(?:do|app)(?:\?[^"'`\s]*)?)["'`]/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(script)) !== null) {
      const endpoint = (match[1] ?? "").split("?")[0] ?? "";
      if (endpoint.length === 0 || seen.has(endpoint)) continue;
      seen.add(endpoint);
      const start = Math.max(0, match.index - 100);
      found.push({ endpoint, context: snippet(script.slice(start, match.index + 100), 200) });
    }
  }
  return found;
}

/** Forms whose fields are the site's search box, not the application. */
function looksLikeSiteFurniture(fields: readonly Control[]): boolean {
  if (fields.length === 0 || fields.length > 3) return false;
  return fields.every((field) =>
    /search|^q$|query|submit|button|hidden/i.test(`${field.name} ${field.id} ${field.type}`),
  );
}

interface Form {
  readonly action: string;
  readonly method: string;
  readonly fields: readonly Control[];
  readonly furniture: boolean;
}

function formsOf(html: string): Form[] {
  const forms: Form[] = [];
  const pattern = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const open = `<form${match[1] ?? ""}>`;
    const fields = controlsOf(match[2] ?? "");
    forms.push({
      action: attribute(open, "action"),
      method: (attribute(open, "method") || "get").toUpperCase(),
      fields,
      furniture: looksLikeSiteFurniture(fields),
    });
  }
  return forms;
}

function hostAndPath(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return url;
  }
}

async function main(): Promise<void> {
  const argument = process.argv[2];
  if (argument === undefined) {
    process.stderr.write(
      "Usage: pnpm run inspect-dependencies <run-directory>\n\n" +
        "  The directory an attached inspection or a discovery run produced — the one\n" +
        "  containing run.json and pages/. Prints what the captured markup declares about\n" +
        "  fields depending on other fields: inline handlers, endpoints named by scripts,\n" +
        "  selects with no options, and the site's own search forms. No values are printed.\n",
    );
    process.exitCode = 2;
    return;
  }
  const runDir = resolve(argument);
  const runFile = join(runDir, "run.json");
  try {
    await stat(runFile);
  } catch {
    process.stderr.write(`No run.json in ${runDir}. Point this at a run directory.\n`);
    process.exitCode = 2;
    return;
  }
  const run = JSON.parse(await readFile(runFile, "utf8")) as RunRecord;
  let index: IndexRecord = {};
  try {
    index = JSON.parse(await readFile(join(runDir, "pages", "index.json"), "utf8")) as IndexRecord;
  } catch {
    // No index: the files are read in name order.
  }
  const pagesDir = join(runDir, "pages");
  const files = (await readdir(pagesDir)).filter((name) => name.endsWith(".html")).sort();
  const urlOf = new Map(
    (index.pages ?? []).map((page) => [page.file.replace(/^pages\//, ""), page.url] as const),
  );

  console.log(
    `${BOLD}Dependencies declared by the captured pages${RESET}  ${DIM}${run.runId ?? runDir}${RESET}\n`,
  );

  let handlerTotal = 0;
  let emptySelectTotal = 0;
  const endpointTotal = new Set<string>();

  for (const file of files) {
    const html = await readFile(join(pagesDir, file), "utf8");
    const url = urlOf.get(file) ?? file;
    const forms = formsOf(html);
    const endpoints = endpointsInScripts(html);
    console.log(`${BOLD}${url}${RESET}`);
    for (const [i, form] of forms.entries()) {
      const label = form.furniture
        ? `${DIM}site furniture, not the application${RESET}`
        : `${String(form.fields.length)} control(s)`;
      console.log(`  form ${String(i + 1)}  ${form.method} ${form.action || "(no action)"}  ${label}`);
      if (form.furniture) continue;
      for (const control of form.fields) {
        if (control.handlers.length === 0 && control.optionCount !== 0) continue;
        const name = control.name || control.id || "(unnamed)";
        const flags = [
          control.required ? "required" : "",
          control.optionCount === 0 ? "NO OPTIONS IN CAPTURE" : "",
          control.optionCount !== null && control.optionCount > 0
            ? `${String(control.optionCount)} option(s)`
            : "",
        ].filter((flag) => flag.length > 0);
        console.log(
          `    ${control.type.padEnd(9)} ${name}${flags.length > 0 ? `  [${flags.join(", ")}]` : ""}`,
        );
        for (const handler of control.handlers) {
          handlerTotal += 1;
          console.log(`      ${handler.on}: ${DIM}${handler.text}${RESET}`);
        }
        if (control.optionCount === 0) emptySelectTotal += 1;
      }
    }
    if (endpoints.length > 0) {
      console.log(`  endpoints named by this page's scripts:`);
      for (const found of endpoints) {
        endpointTotal.add(found.endpoint);
        console.log(`    ${found.endpoint}`);
        console.log(`      ${DIM}${found.context}${RESET}`);
      }
    }
    console.log("");
  }

  const refused = run.blockedRequests ?? [];
  if (refused.length > 0) {
    console.log(`${BOLD}Requests the guard refused during the run${RESET}  ${DIM}(from run.json)${RESET}`);
    const byRule = new Map<string, typeof refused>();
    for (const entry of refused) {
      const rule = entry.rule ?? "method";
      byRule.set(rule, [...(byRule.get(rule) ?? []), entry]);
    }
    for (const [rule, entries] of byRule) {
      console.log(`  ${rule}: ${String(entries.length)}`);
      for (const entry of entries) console.log(`    ${entry.method} ${hostAndPath(entry.url)}`);
    }
    console.log(
      `\n  A ${BOLD}method${RESET} refusal on the target's own host is a write the page attempted by itself —\n` +
        `  most often a lookup that loads one field's options from another field's value. Each one\n` +
        `  is a dependency the blueprint must carry as an order, or the fill will set a field whose\n` +
        `  options have not loaded. A ${BOLD}host${RESET} refusal is the page reaching off the target's hosts.\n`,
    );
  }

  console.log(`${BOLD}Summary${RESET}`);
  console.log(`  inline handlers on controls   ${String(handlerTotal)}`);
  console.log(`  selects with no options       ${String(emptySelectTotal)}`);
  console.log(`  endpoints named by scripts    ${String(endpointTotal.size)}`);
  console.log(
    `\n${DIM}Limits: a listener attached from a script by addEventListener is not an attribute and is\n` +
      `not seen here unless the script names the control's id. A select the page fills after a\n` +
      `choice is reported as having no options only if the capture was taken before any choice.${RESET}`,
  );
}

await main();
