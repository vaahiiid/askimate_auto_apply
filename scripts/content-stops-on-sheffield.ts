/**
 * What Sheffield's signed entry makes of a few answers, at the point where the
 * run would stop for content (P315).
 *
 * Vahid, 2026-10-16 (docs/run-a/p315-his-message-as-sent.txt): *"If the cause
 * is the contradiction between permanent residence Iran and a current period
 * in the UK, say what the code expects me to correct."* Answered by measuring,
 * not by reasoning about it, and kept so the measure can be run again.
 *
 * Deterministic: no model, no network, nothing written. Each case is Run A's
 * synthetic profile (docs/run-a/synthetic-profile.json) with the keys it names
 * replaced or removed, planned and validated exactly as the orchestrator's
 * `assess` does (`planFill`, then `validatePlan` only when nothing blocks).
 * It prints, per case, the blockers (what the interview would still ask), the
 * violations (what would stop the run at `fix_content`) and the boxes the
 * entry does not know.
 *
 * What it cannot see, and says: his own answers. Every value is synthetic,
 * with his residence answers put in by hand: permanent residence Iran and one
 * period, the United Kingdom from May 2023, current, as his message says; and
 * two it implies but does not state, that he lived outside Iran in the last
 * three years (the list is asked only then) and lives in the UK now. No
 * recorded list choice is applied (his three "not in the list"
 * choices are not on this profile). Which violation his run met is in his
 * database (`docs/run-a/p315-read-the-halt.md` §2), not here.
 *
 * Usage: tsx scripts/content-stops-on-sheffield.ts [entry.json]
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { checkUsable, planFill } from "@askimate/aas-mapping";
import type { FillBlocker, FillPlan } from "@askimate/aas-mapping";
import { validatePlan } from "@askimate/aas-preparation";
import type { ValidationResult } from "@askimate/aas-preparation";
import { rehydrateProfile } from "@askimate/aas-profile";
import type { ConfirmedProfile, StoredProfileEntry } from "@askimate/aas-profile";

import { readFixture } from "./profile-seed.js";
import { readEntry } from "./questions-per-application.js";

const ROOT = join(import.meta.dirname, "..");
const NOW = new Date("2026-10-16T12:00:00Z");

/** His residence answers as his message of 2026-10-16 states them, the rest of the profile synthetic. */
export const HIS_RESIDENCE: Readonly<Record<string, unknown>> = {
  "residence.country": "IR",
  "residence.outside_residence_country_last_three_years": true,
  "residence.in_uk_now": true,
  "residence.history": [{ countryCode: "GB", from: { year: 2023, month: 5 }, to: { kind: "current" } }],
};

export interface Case {
  readonly name: string;
  readonly replace: Readonly<Record<string, unknown>>;
  readonly remove: readonly string[];
}

export const CASES: readonly Case[] = [
  { name: "Run A's synthetic profile as it is", replace: {}, remove: [] },
  { name: "his residence answers", replace: HIS_RESIDENCE, remove: [] },
  { name: "his residence answers, the list not yet confirmed", replace: HIS_RESIDENCE, remove: ["residence.history"] },
  { name: "a job list confirmed empty", replace: { "employment.history": [] }, remove: [] },
  { name: "funding not known", replace: { "finance.funding": { known: false } }, remove: [] },
];

/** Run A's synthetic profile with these keys replaced and these removed; a key it does not hold is refused. */
export function profileFor(one: Case): ConfirmedProfile {
  const base = readFixture(readFileSync(join(ROOT, "docs", "run-a", "synthetic-profile.json"), "utf8"));
  if (!base.ok) throw new Error(`the synthetic profile does not read: ${JSON.stringify(base.refusal)}`);
  const held = new Set<string>(base.fixture.entries.map((entry) => entry.key));
  const unknown = [...Object.keys(one.replace), ...one.remove].filter((key) => !held.has(key));
  if (unknown.length > 0) throw new Error(`${one.name}: names keys the synthetic profile does not hold: ${unknown.join(", ")}`);
  return rehydrateProfile({
    studentId: "synthetic-p315",
    updatedAt: NOW,
    entries: base.fixture.entries
      .filter((entry) => !one.remove.includes(entry.key))
      .map((entry) => ({
        ...entry,
        ...(entry.key in one.replace ? { value: one.replace[entry.key] } : {}),
        provenance: { source: "seeded", confirmedAt: NOW },
        revision: 1,
      })) as unknown as readonly StoredProfileEntry[],
  });
}

export interface Outcome {
  readonly plan: FillPlan;
  /** Null when the plan blocks: the orchestrator validates only a plan with nothing missing. */
  readonly validation: ValidationResult | null;
}

/** Planned and validated as `assess` does (packages/orchestrator/src/run.ts), with no recorded list choice. */
export function outcomeFor(entryPath: string, one: Case): Outcome {
  const entry = readEntry(entryPath);
  const check = checkUsable(entry.mappingSet, entry.blueprint);
  if (!check.usable) throw new Error(`the entry's mapping set is not usable: ${check.refusal.detail}`);
  const plan = planFill(entry.blueprint, check.mappingSet, profileFor(one), []);
  return { plan, validation: plan.blockers.length > 0 ? null : validatePlan(entry.blueprint, plan) };
}

function blockerLine(blocker: FillBlocker): string {
  const key = "fieldKey" in blocker ? ` ${String(blocker.fieldKey)}` : "";
  return `    ${blocker.kind}${key} → ${blocker.fieldRef}`;
}

export function describe(one: Case, outcome: Outcome): string {
  const lines = [`${one.name}`];
  lines.push(`  blockers: ${String(outcome.plan.blockers.length)}`);
  lines.push(...outcome.plan.blockers.map(blockerLine));
  if (outcome.validation === null) {
    lines.push("  not validated: the plan blocks, so the step is the interview");
    return lines.join("\n");
  }
  lines.push(`  violations: ${String(outcome.validation.violations.length)}`);
  for (const violation of outcome.validation.violations) {
    const entry = violation.item === undefined ? "" : `, entry ${String(violation.item + 1)}`;
    const bound = violation.rule.value === undefined ? "" : ` ${String(violation.rule.value)}`;
    lines.push(`    "${violation.label}" (${violation.fieldRef}${entry}): ${violation.rule.kind}${bound} [${violation.source}]`);
  }
  lines.push(`  boxes the entry does not know: ${String(outcome.validation.unknownFields.length)}`);
  lines.push(
    `  so: ${outcome.validation.violations.length > 0 || outcome.validation.unknownFields.length > 0 ? "fix_content, a person" : "no stop for content"}`,
  );
  return lines.join("\n");
}

if (process.argv[1] !== undefined && import.meta.filename === process.argv[1]) {
  const entryPath = process.argv[2] ?? join(ROOT, "docs", "run-a", "catalogue", "entries", "sheffield-pgt-2027-09.json");
  const entry = readEntry(entryPath);
  const lines = [`Sheffield's entry: blueprint ${entry.blueprint.version}, mapping set ${entry.mappingSet.version}.`, ""];
  for (const one of CASES) lines.push(describe(one, outcomeFor(entryPath, one)), "");
  process.stdout.write(`${lines.join("\n")}\n`);
}
