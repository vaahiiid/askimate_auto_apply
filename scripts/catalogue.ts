/**
 * The catalogue operator's tool.
 *
 *   pnpm run catalogue hash    <entry.json>     what this content hashes to
 *   pnpm run catalogue show    <entry.json>     the canonical form, as approved
 *   pnpm run catalogue check   <directory>      would this catalogue load?
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY `show` EXISTS, and why it is not a convenience.
 *
 * ADR-0057 approves a canonical form. If a reviewer read the raw file and the
 * loader hashed something else, the signature and the artefact would be about
 * two different documents — and the gap between them would be exactly where an
 * unreviewed change could live. `show` prints the bytes that are hashed, so
 * the thing a reviewer reads IS the thing the approval covers.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * There is deliberately no `approve` subcommand. An approval is a record that a
 * second person read something, and a CLI that writes one on request is a CLI
 * that manufactures the evidence it is supposed to record. Approvals are added
 * to `approvals.json` by the person approving.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  canonicalText,
  labelledHash,
  loadCatalogueDirectory,
  parseReviewedEntryText,
  toCanonical,
} from "@askimate/aas-catalogue";

const BOLD = "[1m";
const DIM = "[2m";
const RED = "[31m";
const GREEN = "[32m";
const RESET = "[0m";

function usage(): void {
  console.error(
    "Usage:\n" +
      "  pnpm run catalogue hash  <entry.json>   the content hash an approval must carry\n" +
      "  pnpm run catalogue show  <entry.json>   the canonical form that gets hashed\n" +
      "  pnpm run catalogue check <directory>    would this catalogue load, and why not\n",
  );
  process.exitCode = 2;
}

async function readEntry(path: string): Promise<ReturnType<typeof parseReviewedEntryText>> {
  return parseReviewedEntryText(await readFile(resolve(path), "utf8"));
}

async function main(): Promise<void> {
  const [command, argument] = process.argv.slice(2);
  if (command === undefined || argument === undefined) return usage();

  if (command === "hash" || command === "show") {
    const parsed = await readEntry(argument);
    if (!parsed.ok) {
      console.error(`${RED}✗${RESET} ${parsed.refusal.path}: ${parsed.refusal.detail}`);
      process.exitCode = 1;
      return;
    }
    const canonical = toCanonical(parsed.value);
    if (command === "show") console.log(canonicalText(canonical));
    else console.log(labelledHash(canonical));
    return;
  }

  if (command === "check") {
    const load = await loadCatalogueDirectory({ directory: resolve(argument) });
    if (!load.ok) {
      console.error(`\n${RED}This catalogue would NOT load.${RESET}\n`);
      for (const problem of load.problems) {
        console.error(`  ${BOLD}${problem.source}${RESET}\n    ${problem.detail}\n`);
      }
      // The most common reason, and the one most likely to be misread as a bug.
      if (load.problems.some((problem) => problem.detail.includes("No approval exists"))) {
        console.error(
          `${DIM}  An artefact with no approval is refused however complete it looks. That is\n` +
            `  ADR-0057 working, not failing: production reads the registry, never the\n` +
            `  document's own claim to have been reviewed.${RESET}\n`,
        );
      }
      process.exitCode = 1;
      return;
    }

    console.log(`\n${GREEN}✓${RESET} ${String(load.catalogue.size)} reviewed entr(ies).\n`);
    for (const item of load.catalogue.inventory()) {
      console.log(`  ${BOLD}${item.blueprintId}${RESET}\n    ${DIM}${item.contentHash}${RESET}`);
    }
    console.log();
    return;
  }

  usage();
}

await main();
