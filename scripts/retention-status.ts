/**
 * What can this deployment store, and what is it waiting on?
 *
 *   pnpm run retention-status [schedule.json ...]
 *
 * Loads the retention schedule versions, validates them, and reports — per
 * document type and purpose — whether a document could be stored today and, if
 * not, exactly what is needed and who owns getting it.
 *
 * ── Why this is a script and not a comment ────────────────────────────────
 *
 * "The retention schedule is not configured yet" is easy to write in a README
 * and easy to stop being true without anyone noticing, in either direction. A
 * half-configured schedule is the dangerous state: it looks configured.
 *
 * Run before any deployment that will hold a real student's documents.
 */

import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import type {
  DocumentType,
  RetentionPurpose,
  RetentionSchedule,
} from "@askimate/aas-domain";
import {
  RetentionPolicyMissingError,
  RetentionRequirementUnresolvedError,
  blockedByRetention,
  effectiveFor,
  validateHistory,
  requirePolicy,
  validateSchedule,
} from "@askimate/aas-domain";
import { parseRetentionSchedule } from "@askimate/aas-domain";
import type { OutOfScopeRow } from "@askimate/aas-domain";

const DIM = "[2m";
const BOLD = "[1m";
const GREEN = "[32m";
const AMBER = "[33m";
const RED = "[31m";
const RESET = "[0m";

const SCHEDULE_DIR = "config/retention";

/** The pairs the first Ulster Birmingham run could plausibly touch. */
const PAIRS: readonly (readonly [DocumentType, RetentionPurpose])[] = [
  ["passport", "identity_verification"],
  ["academic_transcript", "application_submission"],
  ["degree_certificate", "application_submission"],
  ["english_test_certificate", "application_submission"],
  ["personal_statement", "application_submission"],
  ["reference_letter", "application_submission"],
  ["birth_certificate", "minor_safeguarding"],
  ["parental_consent", "minor_safeguarding"],
  ["guardianship_document", "minor_safeguarding"],
  ["bank_statement", "financial_evidence"],
  ["other", "audit_evidence"],
];

function heading(title: string): void {
  console.log(`\n${BOLD}${title}${RESET}\n${DIM}${"─".repeat(74)}${RESET}`);
}

/** Parses a schedule file, reviving the dates JSON cannot carry. */
/**
 * A policy row naming a document type the system no longer supports.
 *
 * ── Why this is REPORTED rather than dropped, or treated as an error ──────
 *
 * `config/retention/v1.2026-09-07.json` carries `AAS-RET-B1-02`, a period for
 * `national_id` that Vahid determined and approved by name on 2026-09-07. The
 * document type left scope on 2026-09-08 (ADR-0089) and the determination did
 * not become WRONG — it became MOOT.
 *
 * So the file is not edited. An approved schedule version is a record, and
 * `validateHistory` exists because versions are superseded rather than
 * rewritten. Dropping the row silently would lose the fact; erroring would
 * make a correct historical record unloadable. It is reported, with its
 * reference, where somebody reading the retention position will see it.
 */


async function main(): Promise<void> {
  const explicit = process.argv.slice(2);
  const files =
    explicit.length > 0
      ? explicit.map((file) => resolve(file))
      : (await readdir(SCHEDULE_DIR))
          .filter((name) => name.endsWith(".json"))
          .map((name) => resolve(join(SCHEDULE_DIR, name)));

  if (files.length === 0) {
    console.log(
      `\n${RED}No retention schedule found${RESET} in ${SCHEDULE_DIR}.\n\n` +
        `${DIM}No documents can be stored. That is the correct state, not a fault.${RESET}\n`,
    );
    process.exitCode = 1;
    return;
  }

  const versions: RetentionSchedule[] = [];
  const outOfScope: (OutOfScopeRow & { readonly version: string })[] = [];
  for (const file of files) {
    const parsed = parseRetentionSchedule(await readFile(file, "utf8"), file);
    versions.push(parsed.schedule);
    for (const row of parsed.outOfScope) outOfScope.push({ ...row, version: parsed.schedule.version });
  }

  // eslint-disable-next-line no-restricted-syntax -- run boundary
  const now = new Date();

  heading("1 · Versions");
  for (const version of versions.sort(
    (a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime(),
  )) {
    const supersedes = version.supersedes === undefined ? "" : ` (supersedes ${version.supersedes})`;
    console.log(
      `  ${BOLD}${version.version}${RESET}${supersedes}  ` +
        `${DIM}effective ${version.effectiveFrom.toISOString().slice(0, 10)} · ` +
        `${String(version.policies.length)} policies · ` +
        `${String(version.unresolved.length)} unresolved${RESET}`,
    );
    console.log(`    ${DIM}approved by: ${version.approvedBy}${RESET}`);
  }

  // The history, before any one version: two versions effective from the same
  // instant make the governing one depend on load order, and no single version
  // can see that about itself.
  const historyProblems = validateHistory({ versions });
  if (historyProblems.length > 0) {
    console.log(`\n  ${RED}The history itself is inconsistent:${RESET}`);
    for (const problem of historyProblems) console.log(`  ${RED}✗${RESET} ${problem}`);
    process.exitCode = 1;
  }

  const governing = effectiveFor({ versions }, now);
  if (governing === null) {
    console.log(`\n  ${RED}No version is effective today.${RESET} Nothing can be stored.\n`);
    process.exitCode = 1;
    return;
  }

  heading("2 · Is the governing version internally consistent?");
  const problems = validateSchedule(governing, now);
  if (problems.length === 0) {
    console.log(`  ${GREEN}✓${RESET} No contradictions, no placeholder bases.`);
  } else {
    for (const problem of problems) console.log(`  ${RED}✗${RESET} ${problem}`);
  }

  heading("3 · What has been determined, and by whom");
  // Printed BEFORE the periods, because a determination constrains them. A
  // cross-cutting answer that nobody sees is the "written rule" this phase
  // exists to replace.
  if (governing.determinations.length === 0) {
    console.log(`  ${DIM}Nothing determined. Every period is unconstrained by a prior answer.${RESET}`);
  }
  for (const determination of governing.determinations) {
    console.log(
      `  ${BOLD}${determination.id}${RESET}  ` +
        `${DIM}${determination.determinedBy} · ` +
        `${determination.determinedAt.toISOString().slice(0, 10)}${RESET}`,
    );
    console.log(`    ${determination.answer}`);
    console.log(`    ${DIM}${determination.reasoning}${RESET}\n`);
  }

  heading("4 · What is still OWED, and by whom");
  // Not "unresolved" — the periods these attach to ARE decided. These are the
  // things Vahid attached to rows 4 and 8 when he answered them, and an item
  // recorded now rather than later is only recorded if something shows it.
  if (governing.obligations.length === 0) {
    console.log(`  ${DIM}Nothing owed.${RESET}`);
  }
  for (const obligation of governing.obligations) {
    console.log(
      `  ${BOLD}${obligation.id}${RESET}  ` +
        `${DIM}owner: ${obligation.owner} · before: ${obligation.dueBefore}${RESET}`,
    );
    console.log(`    ${obligation.statement}\n`);
  }

  heading("5 · What could be stored today");
  let storable = 0;
  for (const [documentType, purpose] of PAIRS) {
    try {
      const policy = requirePolicy(governing, documentType, purpose);
      storable += 1;
      console.log(
        `  ${GREEN}✓${RESET} ${`${documentType} / ${purpose}`.padEnd(48)} ` +
          `${DIM}${String(policy.retainForDays)}d after ${policy.trigger} · ${policy.basis.kind}${RESET}`,
      );
    } catch (error) {
      const label = `${documentType} / ${purpose}`.padEnd(48);
      if (error instanceof RetentionRequirementUnresolvedError) {
        console.log(`  ${AMBER}·${RESET} ${label} ${DIM}unresolved — see below${RESET}`);
      } else if (error instanceof RetentionPolicyMissingError) {
        console.log(`  ${RED}✗${RESET} ${label} ${DIM}no policy at all${RESET}`);
      } else {
        throw error;
      }
    }
  }

  // ── Determined, and now moot ───────────────────────────────────────────
  //
  // A period somebody determined for a document type that has since left
  // scope. The determination is not wrong and the file is not edited: an
  // approved schedule version is a record, superseded rather than rewritten
  // (`validateHistory`). Reported here so the fact is visible rather than
  // dropped — ADR-0089.
  if (outOfScope.length > 0) {
    heading("5b · Determined, and now out of scope");
    for (const row of outOfScope) {
      console.log(
        `  ${BOLD}${row.policyReference}${RESET}  ${DIM}${row.version}${RESET}\n` +
          `    ${row.documentType} / ${row.purpose} — the period was determined and approved; the\n` +
          `    ${DIM}document type is no longer supported (ADR-0089). The record is kept as made.${RESET}\n`,
      );
    }
  }

  heading("6 · What is open, and who owns it");
  const blocked = blockedByRetention(governing);
  if (blocked.length === 0) {
    console.log(`  ${DIM}Nothing recorded as unresolved.${RESET}`);
  }
  for (const entry of blocked) {
    console.log(`  ${BOLD}${entry.key}${RESET}  ${DIM}owner: ${entry.owner}${RESET}`);
    console.log(`    ${entry.reason}\n`);
  }

  heading("Summary");
  console.log(
    `  ${String(storable)} of ${String(PAIRS.length)} pairs have a RETENTION POLICY today.\n` +
      `  ${String(blocked.length)} question(s) recorded as unresolved.\n`,
  );

  // ── Retention is ONE of two gates, and saying otherwise would lie ───────
  //
  // `assertStorable` requires a retention policy AND a registered lawful basis
  // (ADR-0022). Until P44 the distinction did not matter, because no period was
  // set and the answer was "nothing" either way.
  //
  // This line has now been wrong twice, in opposite directions, one phase
  // apart. It called B2 "NOT yet determined" for a day after ADR-0087
  // determined it; then it named FOUR gates for a day after ADR-0089 removed
  // two of them with the one document type they existed for. Both were records
  // asserting something production did not do — the shape this repository has
  // spent ten phases finding — and both were produced by the fix for the one
  // before. What stays true is the sentence it was written for: a retention
  // policy is not permission.
  console.log(
    `  ${AMBER}A retention policy is not permission to store.${RESET} ` +
      `${DIM}\`assertStorable\` also requires a\n` +
      `  registered lawful basis for the storing activity (ADR-0022, B2 — DETERMINED on\n` +
      `  2026-09-08, ADR-0087), which this report does not read. Retention resolved means one of\n` +
      `  two gates opened.${RESET}\n`,
  );

  if (storable === 0) {
    console.log(
      `  ${AMBER}No student document can enter the vault.${RESET} That is the designed state\n` +
        `  until the periods are determined — not a fault, and not something to work around.\n` +
        `  ${DIM}See docs/retention-analysis.md.${RESET}\n`,
    );
  }

  if (problems.length > 0) process.exitCode = 1;
}

await main();
