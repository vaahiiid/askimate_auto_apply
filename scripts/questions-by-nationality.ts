/**
 * Questions per application for synthetic students of several nationalities
 * (P298, decision 5).
 *
 * Vahid, 2026-10-12: *"a test plan with synthetic students of several
 * nationalities (India, Nigeria, Pakistan, Bangladesh, Gulf) on the fixture
 * portal plus live read-only list searches, measuring questions per
 * application for each."*
 *
 * Deterministic: no model, no network, nothing written. For each student in
 * docs/run-a/synthetic-students.json (Run A's synthetic profile with the keys
 * it lists replaced) it prints:
 *
 *   - on the gated test portal: whether the plan takes the student's
 *     nationality, and the questions per application there;
 *   - on Sheffield's signed entry: the questions per application today, and
 *     under ADR-0156 with and without the intake's standing rule — the measure
 *     of scripts/questions-per-application.ts, unchanged.
 *
 * What it cannot see, and says: what ADR-0158's rule would ask, because that
 * needs the lists Sheffield shows under each country, and no list under these
 * countries has been read (P298's plan asks him for those reads).
 *
 * Usage: tsx scripts/questions-by-nationality.ts [entry.json]
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { GATED_PORTAL_BLUEPRINT, GATED_PORTAL_MAPPING_SET } from "@askimate/aas-mapping/fixtures/gated";
import { checkUsable, planFill } from "@askimate/aas-mapping";
import { rehydrateProfile } from "@askimate/aas-profile";
import type { ConfirmedProfile, StoredProfileEntry } from "@askimate/aas-profile";

import { readFixture } from "./profile-seed.js";
import { formatQuestions, NO_STANDING_RULES, questionsProposed, questionsToday, readEntry } from "./questions-per-application.js";
import type { Question } from "./questions-per-application.js";

const ROOT = join(import.meta.dirname, "..");
const NOW = new Date("2026-10-12T12:00:00Z");

export interface Student {
  readonly code: string;
  readonly name: string;
  readonly replace: Readonly<Record<string, unknown>>;
}

/** Run A's synthetic profile with these keys replaced, as a confirmed profile; a key it does not hold is refused. */
export function profileReplacing(code: string, replace: Readonly<Record<string, unknown>>): ConfirmedProfile {
  const base = readFixture(readFileSync(join(ROOT, "docs", "run-a", "synthetic-profile.json"), "utf8"));
  if (!base.ok) throw new Error(`the synthetic profile does not read: ${JSON.stringify(base.refusal)}`);
  const unknown = Object.keys(replace).filter((key) => !base.fixture.entries.some((held) => held.key === key));
  if (unknown.length > 0) throw new Error(`${code}: replaces keys the synthetic profile does not hold: ${unknown.join(", ")}`);
  return rehydrateProfile({
    studentId: `synthetic-${code}`,
    updatedAt: NOW,
    entries: base.fixture.entries.map((held) => ({
      ...held,
      ...(held.key in replace ? { value: replace[held.key] } : {}),
      provenance: { source: "seeded", confirmedAt: NOW },
      revision: 1,
    })) as unknown as readonly StoredProfileEntry[],
  });
}

/** The students of docs/run-a/synthetic-students.json, each as a confirmed profile. */
export function studentsAsProfiles(): readonly { readonly student: Student; readonly profile: ConfirmedProfile }[] {
  const { students } = JSON.parse(readFileSync(join(ROOT, "docs", "run-a", "synthetic-students.json"), "utf8")) as { readonly students: readonly Student[] };
  return students.map((student) => ({ student, profile: profileReplacing(student.code, student.replace) }));
}

const TEST_PORTAL = { blueprint: GATED_PORTAL_BLUEPRINT, mappingSet: GATED_PORTAL_MAPPING_SET };

/**
 * What the gated test portal makes of this profile: whether the plan takes the
 * nationality (an instruction for it, and no stop on it or on the passport's
 * country after it), and the questions per application there, counted by the
 * same measure as Sheffield's.
 */
export function onTheTestPortal(profile: ConfirmedProfile): { readonly nationalityTaken: boolean; readonly questions: readonly Question[] } {
  const check = checkUsable(GATED_PORTAL_MAPPING_SET, GATED_PORTAL_BLUEPRINT);
  if (!check.usable) throw new Error(`the gated test portal is not usable: ${check.refusal.detail}`);
  const plan = planFill(GATED_PORTAL_BLUEPRINT, check.mappingSet, profile, []);
  const nationalityTaken =
    plan.instructions.some((instruction) => instruction.fieldRef === "nationality") &&
    !plan.blockers.some((blocker) => blocker.fieldRef === "nationality" || blocker.fieldRef === "passport_country");
  return { nationalityTaken, questions: questionsToday(TEST_PORTAL, profile) };
}

if (process.argv[1] !== undefined && import.meta.filename === process.argv[1]) {
  const entryPath = process.argv[2] ?? join(ROOT, "docs", "run-a", "catalogue", "entries", "sheffield-pgt-2027-09.json");
  const entry = readEntry(entryPath);
  const lines: string[] = [`Sheffield's entry: blueprint ${entry.blueprint.version}, mapping set ${entry.mappingSet.version}.`, ""];
  for (const { student, profile } of studentsAsProfiles()) {
    const portal = onTheTestPortal(profile);
    const today = questionsToday(entry, profile);
    const bare = questionsProposed(entry, profile, NO_STANDING_RULES);
    const withRule = questionsProposed(entry, profile, { escapeWhenNotListed: true, shortForms: {} });
    lines.push(
      `${student.code} — ${student.name}`,
      `  test portal: nationality ${portal.nationalityTaken ? "taken" : "NOT taken"}; ${String(portal.questions.length)} question(s) per application`,
      formatQuestions(portal.questions),
      `  Sheffield today: ${String(today.length)} question(s) per application`,
      formatQuestions(today),
      `  Sheffield under ADR-0156, no standing rule: ${String(bare.perApplication.length)}; with the intake's escape rule: ${String(withRule.perApplication.length)}`,
      formatQuestions(withRule.perApplication),
      `  Sheffield under ADR-0158 (approved in direction, not built): not measured — no list under ${student.code} has been read`,
      "",
    );
  }
  process.stdout.write(`${lines.join("\n")}\n`);
}
