/**
 * The console snippets the plans ask him to run, as one scanner (P295).
 *
 *   pnpm exec tsx scripts/read-snippets.ts
 *
 * prints every snippet it finds, with the start of its sha256, where it is,
 * and whether it can be run as written. `reads-print-their-country.test.ts`
 * holds each one to his rule of 2026-10-10: *"each snippet must also print the
 * country selected at the time of the read"*.
 *
 * ── What it searches, and what it cannot see ─────────────────────────────
 *
 * The Markdown in `docs/run-a/` and `docs/captures/` (`.md` and `.markdown`,
 * any case), where reads are planned and recorded. A snippet is text that
 * reads the page: `document.` and a property, or the console's `$(`, `$$(` or
 * `$0`. That is a pattern, so a read written another way (through `window.`,
 * or a variable holding the document) is not seen. Inside a fenced block (``` or
 * ~~~), the whole block is one snippet; outside one, each line is. A snippet
 * can be run as written only if it is a closed ```js block of one line: one
 * line pasted whole, whose value the console prints. Anything else (a block
 * of several lines, another language, a fence never closed, a line in prose)
 * is reported with the reason. It cannot see a read planned anywhere else, or
 * sent only in a message.
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

export const ROOT = resolve(join(import.meta.dirname, ".."));
export const SEARCHED: readonly string[] = ["docs/run-a", "docs/captures"];
export const READS_THE_PAGE = /\bdocument\.[A-Za-z]|\$\$?\(|\$0\b/;

export interface Snippet {
  readonly path: string;
  /** The line it starts on, from 1. */
  readonly line: number;
  /** A runnable snippet's one line, trimmed; otherwise the block's lines, or the line. */
  readonly text: string;
  /** Why it cannot be run as written; absent when it can. */
  readonly unrunnable?: string;
  readonly sha256: string;
}

function snippet(path: string, line: number, text: string, unrunnable?: string): Snippet {
  return { path, line, text, ...(unrunnable === undefined ? {} : { unrunnable }), sha256: createHash("sha256").update(text).digest("hex") };
}

export function markdownUnder(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(join(ROOT, dir))) {
    const path = `${dir}/${entry}`;
    if (statSync(join(ROOT, path)).isDirectory()) markdownUnder(path, found);
    else if (/\.(md|markdown)$/i.test(entry)) found.push(path);
  }
  return found;
}

export function snippetsIn(path: string, text: string): Snippet[] {
  const found: Snippet[] = [];
  let fence: { readonly char: string; readonly length: number; readonly info: string; readonly start: number; readonly body: string[] } | null = null;
  const close = (closed: boolean): void => {
    if (fence === null) return;
    const body = fence.body.join("\n");
    if (READS_THE_PAGE.test(body)) {
      const lines = fence.body.filter((line) => line.trim() !== "");
      const unrunnable = !closed
        ? "its fence is never closed"
        : fence.info !== "js"
          ? `in a ${fence.info === "" ? "plain" : `"${fence.info}"`} block, not js`
          : lines.length !== 1
            ? `${String(lines.length)} lines; a read is one line, pasted whole`
            : undefined;
      found.push(snippet(path, fence.start, unrunnable === undefined ? (lines[0] ?? "").trim() : body, unrunnable));
    }
    fence = null;
  };
  const lines = text.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    if (fence === null) {
      const open = /^(`{3,}|~{3,})\s*([^\s`]*)/.exec(trimmed);
      if (open !== null) {
        const marker = open[1] ?? "```";
        fence = { char: marker.charAt(0), length: marker.length, info: (open[2] ?? "").toLowerCase(), start: index + 1, body: [] };
      } else if (READS_THE_PAGE.test(line)) {
        found.push(snippet(path, index + 1, line, "outside a fenced block"));
      }
    } else if (trimmed.length >= fence.length && [...trimmed].every((char) => char === fence?.char)) {
      close(true);
    } else {
      fence.body.push(line);
    }
  }
  close(false);
  return found;
}

export function allSnippets(): Snippet[] {
  return SEARCHED.flatMap((dir) => markdownUnder(dir)).flatMap((path) => snippetsIn(path, readFileSync(join(ROOT, path), "utf8")));
}

if (process.argv[1]?.endsWith("read-snippets.ts") === true) {
  for (const found of allSnippets()) {
    process.stdout.write(`${found.sha256.slice(0, 16)}  ${found.path}:${String(found.line)}  ${found.unrunnable ?? "runs as written"}\n`);
  }
}
