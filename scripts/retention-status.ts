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
  UnresolvedRetentionRequirement,
} from "@askimate/aas-domain";
import {
  RetentionPolicyMissingError,
  RetentionRequirementUnresolvedError,
  blockedByRetention,
  effectiveFor,
  requirePolicy,
  validateSchedule,
} from "@askimate/aas-domain";

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
  ["national_id", "identity_verification"],
  ["academic_transcript", "application_submission"],
  ["degree_certificate", "application_submission"],
  ["english_test_certificate", "application_submission"],
  ["personal_statement", "application_submission"],
  ["reference_letter", "application_submission"],
  ["birth_certificate", "minor_safeguarding"],
  ["parental_consent", "minor_safeguarding"],
  ["guardianship_document", "minor_safeguarding"],
];

function heading(title: string): void {
  console.log(`\n${BOLD}${title}${RESET}\n${DIM}${"─".repeat(74)}${RESET}`);
}

/** Parses a schedule file, reviving the dates JSON cannot carry. */
function parseSchedule(raw: string, file: string): RetentionSchedule {
  const parsed = JSON.parse(raw) as Record<string, unknown>;

  /** A required string field. Refuses anything else rather than stringifying it. */
  const text = (value: unknown, field: string): string => {
    if (typeof value !== "string") {
      throw new Error(`${file}: "${field}" must be a string, got ${typeof value}.`);
    }
    return value;
  };

  const date = (value: unknown, field: string): Date => {
    if (typeof value !== "string") {
      throw new Error(`${file}: "${field}" must be an ISO date string.`);
    }
    const asDate = new Date(value);
    if (Number.isNaN(asDate.getTime())) throw new Error(`${file}: "${field}" is not a date.`);
    return asDate;
  };

  const policies = (parsed["policies"] as Record<string, unknown>[] | undefined) ?? [];
  const unresolved = (parsed["unresolved"] as Record<string, unknown>[] | undefined) ?? [];

  return {
    version: text(parsed["version"], "version"),
    approvedAt: date(parsed["approvedAt"], "approvedAt"),
    approvedBy: text(parsed["approvedBy"], "approvedBy"),
    effectiveFrom: date(parsed["effectiveFrom"], "effectiveFrom"),
    ...(typeof parsed["supersedes"] === "string" ? { supersedes: parsed["supersedes"] } : {}),
    policies: policies.map((policy) => ({
      documentType: policy["documentType"] as DocumentType,
      purpose: policy["purpose"] as RetentionPurpose,
      trigger: policy["trigger"] as RetentionSchedule["policies"][number]["trigger"],
      retainForDays: Number(policy["retainForDays"]),
      action: policy["action"] as "delete" | "anonymise",
      erasureBehaviour: policy["erasureBehaviour"] as
        | "full"
        | "redact_contents"
        | "retain_for_legal_obligation",
      ...(typeof policy["legalBasis"] === "string" ? { legalBasis: policy["legalBasis"] } : {}),
      policyReference: text(policy["policyReference"], "policyReference"),
      reviewBy: date(policy["reviewBy"], "reviewBy"),
      basis: {
        kind: (policy["basis"] as Record<string, unknown>)["kind"] as
          | "legal_requirement"
          | "operational_requirement"
          | "policy_decision",
        statement: text((policy["basis"] as Record<string, unknown>)["statement"], "basis.statement"),
        authoritativeSource: text(
          (policy["basis"] as Record<string, unknown>)["authoritativeSource"],
          "basis.authoritativeSource",
        ),
        verifiedBy: text((policy["basis"] as Record<string, unknown>)["verifiedBy"], "basis.verifiedBy"),
        verifiedAt: date(
          (policy["basis"] as Record<string, unknown>)["verifiedAt"],
          "basis.verifiedAt",
        ),
      },
    })),
    unresolved: unresolved.map(
      (entry): UnresolvedRetentionRequirement => ({
        documentType: entry["documentType"] as DocumentType,
        purpose: entry["purpose"] as RetentionPurpose,
        question: text(entry["question"], "question"),
        authoritativeSourceNeeded: text(entry["authoritativeSourceNeeded"], "authoritativeSourceNeeded"),
        expectedBasisKind: entry["expectedBasisKind"] as UnresolvedRetentionRequirement["expectedBasisKind"],
        owner: text(entry["owner"], "owner"),
        raisedBy: text(entry["raisedBy"], "raisedBy"),
        raisedAt: date(entry["raisedAt"], "raisedAt"),
      }),
    ),
  };
}

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
  for (const file of files) {
    versions.push(parseSchedule(await readFile(file, "utf8"), file));
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

  heading("3 · What could be stored today");
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

  heading("4 · What is open, and who owns it");
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
    `  ${String(storable)} of ${String(PAIRS.length)} document types could be stored today.\n` +
      `  ${String(blocked.length)} question(s) recorded as unresolved.\n`,
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
