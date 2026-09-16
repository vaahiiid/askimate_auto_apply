/**
 * The catalogue operator's tool.
 *
 *   pnpm run catalogue hash    <entry.json>     what this content hashes to
 *   pnpm run catalogue show    <entry.json>     the canonical form, as approved
 *   pnpm run catalogue check   <directory>      would this catalogue load?
 *   pnpm run catalogue preview <entry.json> <profile.json>
 *                                              what a run would type into which box, page by
 *                                              page, for that profile — the read a signature is
 *                                              about (P152)
 *
 * ── Why `preview` exists ───────────────────────────────────────────────────
 *
 * Vahid, 2026-09-16, the only signature since ADR-0118: *"give me the
 * human-readable version to read. Not the JSON — the list of what will be
 * typed into which box, page by page. That is the one review that is actually
 * mine, and it is the thing the two-signature rule existed to catch."* The
 * text is the student's own preview (ADR-0059), rendered by the same code the
 * run shows at the yes, for a profile in the seed's file shape. A draft entry
 * is planned AS IF its set were reviewed, and the output says so at the top,
 * so the read can happen before the signature it informs.
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
 * person read something, and a CLI that writes one on request is a CLI that
 * manufactures the evidence it is supposed to record. Approvals are added to
 * `approvals.json` by the person approving — since ADR-0118 that may be the
 * author, naming under `ownAccountOnly.studentId` the one account their single
 * signature admits, and `check` prints that admission per entry so nobody
 * starts a process on a one-account entry without seeing it.
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
import { checkUsable, planFill } from "@askimate/aas-mapping";
import { buildPreview, renderPreview } from "@askimate/aas-preparation";
import { rehydrateProfile } from "@askimate/aas-profile";

import { readFixture } from "./profile-seed.js";
import type { ProfileFixture } from "./profile-seed.js";

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
      "  pnpm run catalogue check <directory>    would this catalogue load, and why not\n" +
      "  pnpm run catalogue preview <entry.json> <profile.json>\n" +
      "                                          what a run would type into which box, page by page\n",
  );
  process.exitCode = 2;
}

async function readEntry(path: string): Promise<ReturnType<typeof parseReviewedEntryText>> {
  return parseReviewedEntryText(await readFile(resolve(path), "utf8"));
}

type Entry = Extract<ReturnType<typeof parseReviewedEntryText>, { ok: true }>["value"];

/**
 * The page-by-page read for one profile, in the student's own preview words
 * (ADR-0059): the same builder and renderer the run uses at the yes. A draft
 * entry is planned as if its set were reviewed and the header says so; a
 * plan with blockers prints them instead of a preview, because a read of
 * half a form is not the read a signature is about.
 */
export function previewText(entry: Entry, fixture: ProfileFixture): string {
  const now = new Date(0);
  const isDraft = entry.mappingSet.status !== "reviewed" || entry.blueprint.status !== "reviewed";
  const asReviewed = isDraft
    ? { ...entry.mappingSet, status: "reviewed" as const, reviewedBy: entry.mappingSet.reviewedBy ?? "(nobody yet)", reviewedAt: entry.mappingSet.reviewedAt ?? now }
    : entry.mappingSet;
  const check = checkUsable(asReviewed, entry.blueprint);
  if (!check.usable) {
    process.exitCode = 1;
    return `The mapping set is not usable: ${check.refusal.kind} — ${"detail" in check.refusal ? check.refusal.detail : ""}`;
  }
  const profile = rehydrateProfile({
    studentId: "preview",
    updatedAt: now,
    entries: fixture.entries.map((e) => ({ ...e, provenance: { source: "seeded", confirmedAt: now }, revision: 1 })),
  });
  const plan = planFill(entry.blueprint, check.mappingSet, profile);
  const header = [
    isDraft
      ? `DRAFT — blueprint ${entry.blueprint.version} (${entry.blueprint.status}), mapping set ${entry.mappingSet.version} (${entry.mappingSet.status}); planned AS IF reviewed. Nothing here is signed.`
      : `REVIEWED — blueprint ${entry.blueprint.version}, mapping set ${entry.mappingSet.version}, reviewed by ${entry.mappingSet.reviewedBy ?? ""}.`,
    `Profile: ${String(fixture.entries.length)} value(s) from the file given. Every line below is what the run would type, attach or leave, for that profile.`,
    "",
  ];
  if (plan.blockers.length > 0) {
    process.exitCode = 1;
    return [
      ...header,
      `The plan has ${String(plan.blockers.length)} blocker(s); no preview is built for a form that cannot be filled:`,
      ...plan.blockers.map((b) => `  - ${b.kind}: ${b.fieldRef}${"detail" in b ? ` — ${b.detail}` : ""}`),
    ].join("\n");
  }
  const preview = buildPreview(entry.blueprint, plan, new Map(), { portalHost: entry.portalAuthentication?.portalHost ?? new URL(entry.blueprint.authentication.loginUrl ?? "https://unknown.invalid/").host });
  if (!preview.built) {
    process.exitCode = 1;
    return [...header, `No preview: ${preview.refusal.kind}`].join("\n");
  }
  return [...header, renderPreview(preview.preview)].join("\n");
}

async function main(): Promise<void> {
  const [command, argument, second] = process.argv.slice(2);
  if (command === undefined || argument === undefined) return usage();

  if (command === "preview") {
    if (second === undefined) return usage();
    const parsed = await readEntry(argument);
    if (!parsed.ok) {
      console.error(`${RED}✗${RESET} ${parsed.refusal.path}: ${parsed.refusal.detail}`);
      process.exitCode = 1;
      return;
    }
    const fixture = readFixture(await readFile(resolve(second), "utf8"));
    if (!fixture.ok) {
      console.error(`${RED}✗${RESET} ${second}: ${JSON.stringify(fixture.refusal)}`);
      process.exitCode = 1;
      return;
    }
    console.log(previewText(parsed.value, fixture.fixture));
    return;
  }

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
      const entry = await load.catalogue.find(item.blueprintId);
      const admission =
        entry === null
          ? ""
          : entry.admits.kind === "any_applicant"
            ? `${GREEN}admits any applicant${RESET} (a second person's signature)`
            : `${RED}admits ONE account only${RESET} — studentId ${entry.admits.studentId}, ` +
              `signed by ${entry.admits.signedBy} alone (ADR-0118): usable for that account and ` +
              `for nothing else`;
      console.log(
        `  ${BOLD}${item.blueprintId}${RESET}\n    ${DIM}${item.contentHash}${RESET}\n    ${admission}`,
      );
    }
    console.log();
    return;
  }

  usage();
}

await main();
