/**
 * Read a discovery run, and say what it means.
 *
 *   pnpm run inspect-discovery <path-to-discovery-run-directory>
 *
 * ── What this is for ──────────────────────────────────────────────────────
 *
 * Live discovery cannot run from the Claude Code environment (EGRESS_BLOCKED —
 * see docs/phase-3-access-required.md), so the run happens on a machine with
 * normal network access and the output directory comes back. This reads it.
 *
 * Three questions, answered in order:
 *
 *   1. What did the run actually see?          — and did the portal write?
 *   2. What does the draft blueprint say?      — pages, fields, documents
 *   3. Where does the REAL portal differ from what the replay proved?
 *
 * Question 3 is the point. Everything downstream was built and proven against
 * a fixture, and the honest question is not "does it work" but "what does this
 * portal do that the fixture did not".
 *
 * It changes nothing, reaches no network, and starts no browser.
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { ApplicationBlueprint, BlueprintField } from "@askimate/aas-blueprint";
import { allFields, allRequiredDocuments, checkExecutable } from "@askimate/aas-blueprint";

const DIM = "[2m";
const BOLD = "[1m";
const GREEN = "[32m";
const AMBER = "[33m";
const RED = "[31m";
const RESET = "[0m";

interface RunRecord {
  readonly runId: string;
  readonly target: { readonly institutionName: string; readonly allowedHosts: readonly string[] };
  readonly visited: readonly string[];
  readonly failed: readonly { readonly url: string; readonly error: string }[];
  readonly blockedRequests: readonly { readonly method: string; readonly url: string }[];
}

function heading(step: string, title: string): void {
  console.log(`\n${BOLD}${step}  ${title}${RESET}\n${DIM}${"─".repeat(74)}${RESET}`);
}

async function main(): Promise<void> {
  const argument = process.argv[2];
  if (argument === undefined) {
    process.stderr.write(
      "Usage: pnpm run inspect-discovery <discovery-run-directory>\n\n" +
        "The directory a discovery run produced — the one containing blueprint.draft.json.\n",
    );
    process.exitCode = 2;
    return;
  }

  const runDir = resolve(argument);
  const run = JSON.parse(await readFile(join(runDir, "run.json"), "utf8")) as RunRecord;
  const blueprint = JSON.parse(
    await readFile(join(runDir, "blueprint.draft.json"), "utf8"),
  ) as ApplicationBlueprint;

  // ── 1. What the run saw ────────────────────────────────────────────────
  heading("1", "What the run saw");

  console.log(`  Institution      ${BOLD}${run.target.institutionName}${RESET}`);
  console.log(`  Hosts permitted  ${run.target.allowedHosts.join(", ")}`);
  console.log(`  Pages visited    ${String(run.visited.length)}`);
  for (const url of run.visited) console.log(`    ${DIM}${url}${RESET}`);

  if (run.failed.length > 0) {
    console.log(`\n  ${AMBER}Pages that failed${RESET}`);
    for (const failure of run.failed) {
      console.log(`    ${failure.url}\n      ${DIM}${failure.error}${RESET}`);
    }
  }

  // The most important line in this section. A portal that writes during
  // ordinary browsing cannot be inspected without side effects, and that
  // changes what a controlled live run means.
  if (run.blockedRequests.length === 0) {
    console.log(
      `\n  ${GREEN}✓${RESET} The portal attempted no state-changing requests. It can be` +
        ` inspected read-only.`,
    );
  } else {
    console.log(
      `\n  ${RED}⚠ ${String(run.blockedRequests.length)} state-changing request(s) were blocked.${RESET}`,
    );
    for (const blocked of run.blockedRequests.slice(0, 10)) {
      console.log(`    ${blocked.method} ${DIM}${blocked.url}${RESET}`);
    }
    console.log(
      `\n  ${DIM}The portal writes during ordinary browsing. A specialist must decide what\n` +
        `  that means before any live run — merely opening pages may register something.${RESET}`,
    );
  }

  // ── 2. The draft blueprint ─────────────────────────────────────────────
  heading("2", "What the draft blueprint says");

  const fields = allFields(blueprint);
  const documents = allRequiredDocuments(blueprint);

  console.log(`  Platform         ${blueprint.platform ?? `${DIM}not determined${RESET}`}`);
  console.log(`  Route            ${blueprint.route}`);
  console.log(
    `  Authentication   ${blueprint.authentication.required ? "required" : "not required"}` +
      `${blueprint.authentication.accountCreationRequired ? ", account creation required" : ""}`,
  );
  console.log(`  Pages            ${String(blueprint.pages.length)}`);
  console.log(`  Fields           ${String(fields.length)}`);
  console.log(`  Documents asked  ${String(documents.length)}`);
  console.log(`  Handoff points   ${String(blueprint.handoffPoints.length)}`);

  for (const page of blueprint.pages) {
    console.log(`\n  ${BOLD}${page.title}${RESET} ${DIM}${page.url ?? ""}${RESET}`);
    for (const section of page.sections) {
      console.log(`    ${section.title}`);
      for (const field of section.fields) {
        const required = field.validations.some((v) => v.kind === "required") ? "required" : "optional";
        const options = field.options === undefined ? "" : ` · ${String(field.options.length)} options`;
        console.log(
          `      ${field.fieldRef.padEnd(28)} ${DIM}${field.inputType} · ${required}${options}${RESET}`,
        );
      }
    }
    for (const document of page.requiredDocuments) {
      console.log(`      ${DIM}[document] ${document.documentRef} — ${document.acceptedFormats.join(", ")}${RESET}`);
    }
  }

  // ── 3. Where the real portal differs from the replay ───────────────────
  heading("3", "Where this differs from what the replay proved");

  const gaps: string[] = [];

  const executable = checkExecutable(blueprint);
  if (!executable.executable) {
    gaps.push(
      `The blueprint is not executable yet: ${executable.refusal.detail} ` +
        `A specialist reviews it against the real portal first — that step is a decision, ` +
        `not code, and it has not happened.`,
    );
  }

  const unlocatable = fields.filter((field) => field.locators.length === 0);
  if (unlocatable.length > 0) {
    gaps.push(
      `${String(unlocatable.length)} field(s) have NO locator: ` +
        `${unlocatable.map((f) => f.fieldRef).join(", ")}. The fill layer cannot find them, and it ` +
        `will not look for something similar.`,
    );
  }

  const unknownType = fields.filter((field) => field.inputType === "unknown");
  if (unknownType.length > 0) {
    gaps.push(
      `${String(unknownType.length)} field(s) have an unrecognised input type: ` +
        `${unknownType.map((f) => f.fieldRef).join(", ")}. Each needs a format rule decided by a ` +
        `human before it can be mapped.`,
    );
  }

  const selects = fields.filter((field) => field.options !== undefined && field.options.length > 0);
  if (selects.length > 0) {
    gaps.push(
      `${String(selects.length)} dropdown(s) need an explicit option map in the mapping set ` +
        `(${selects.map((f) => f.fieldRef).join(", ")}). An unmapped option BLOCKS the case — ` +
        `nothing is approximated (ADR-0017).`,
    );
  }

  const noAdvance = blueprint.pages.filter((page) => page.advanceControl === undefined);
  if (noAdvance.length > 0) {
    gaps.push(
      `${String(noAdvance.length)} page(s) have no recorded advance control ` +
        `(${noAdvance.map((p) => p.pageRef).join(", ")}). Preparation may only click controls the ` +
        `blueprint records, so with none recorded it cannot move past that page.`,
    );
  }

  if (blueprint.submission === undefined) {
    gaps.push(
      `No submission step was recorded. Preparation does not need one — but without it the ` +
        `network guard cannot refuse the submission endpoint, so only the type and click guards ` +
        `stand between a run and a submission.`,
    );
  }

  if (blueprint.provenance.unobservedClaims.length > 0) {
    gaps.push(
      `${String(blueprint.provenance.unobservedClaims.length)} claim(s) in this blueprint were ` +
        `NOT observed first-hand and must be verified before anything depends on them:\n` +
        blueprint.provenance.unobservedClaims.map((claim) => `        · ${claim}`).join("\n"),
    );
  }

  if (blueprint.authentication.required) {
    gaps.push(
      `The portal requires authentication. Discovery cannot test a login without creating an ` +
        `account, which it is not authorised to do — so the logged-in pages are UNSEEN and the ` +
        `blueprint describes only what an anonymous visitor gets.`,
    );
  }

  const capturedPages = await countCapturedPages(runDir);
  if (capturedPages === 0) {
    gaps.push(
      `No pages were captured, so this run cannot be replayed locally. Everything downstream ` +
        `would have to be built against the live portal instead, which is the situation the ` +
        `replay harness exists to avoid.`,
    );
  }

  if (gaps.length === 0) {
    console.log(`  ${GREEN}✓${RESET} Nothing found that the replay did not already cover.`);
  } else {
    for (const [index, gap] of gaps.entries()) {
      console.log(`  ${AMBER}${String(index + 1)}.${RESET} ${gap}\n`);
    }
  }

  // ── 4. What a mapping set must cover ───────────────────────────────────
  heading("4", "What the mapping set must cover");

  const required = fields.filter((field) => field.validations.some((v) => v.kind === "required"));
  console.log(
    `  ${String(required.length)} required field(s). Each needs a source decided by a specialist:\n` +
      `  ${DIM}a profile field (with a format rule), a document, a student handoff, or a reviewed\n` +
      `  constant. Nothing may be left to the run to work out (ADR-0017).${RESET}\n`,
  );
  for (const field of required) {
    console.log(`    ${field.fieldRef.padEnd(28)} ${DIM}${describe(field)}${RESET}`);
  }

  console.log(
    `\n${DIM}  Replay this run locally:  the capture is in ${join(runDir, "pages")}${RESET}\n`,
  );
}

function describe(field: BlueprintField): string {
  const parts = [field.inputType, field.label];
  if (field.options !== undefined) parts.push(`options: ${field.options.map((o) => o.value).join("|")}`);
  return parts.join(" · ");
}

async function countCapturedPages(runDir: string): Promise<number> {
  try {
    const pagesDir = join(runDir, "pages");
    if (!(await stat(pagesDir)).isDirectory()) return 0;
    const entries = await readdir(pagesDir);
    return entries.filter((name) => name.endsWith(".html")).length;
  } catch {
    return 0;
  }
}

await main();
