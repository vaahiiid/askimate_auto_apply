/**
 * Questions per application on HIS run (P292): the measure in
 * `questions-per-application.ts`, on the entry given and his two
 * qualifications as P286 measured them from the 3 October intervention — the
 * doctorate at HHE, the Master's at Islamic Azad University, both in
 * International Business, 19.5 on the twenty-point scale. Dates synthetic; the
 * rest of the profile is `docs/run-a/synthetic-profile.json`.
 *
 *   pnpm exec tsx scripts/questions-his-run.ts <entry.json> [award title]
 *
 * The award title defaults to the one the intervention quoted. The message of
 * 2026-10-08 says he is correcting it to "DBA" in the chat (ADR-0154); this
 * never edits his profile — it measures the shape with either title.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { rehydrateProfile } from "@askimate/aas-profile";
import type { StoredProfileEntry } from "@askimate/aas-profile";

import { readFixture } from "./profile-seed.js";
import { formatQuestions, NO_STANDING_RULES, questionsProposed, questionsToday, readEntry } from "./questions-per-application.js";

const ROOT = join(import.meta.dirname, "..");
const [entryPath, title = "Doctorate of Business Administration"] = process.argv.slice(2);
if (entryPath === undefined) {
  process.stderr.write("usage: tsx scripts/questions-his-run.ts <entry.json> [award title]\n");
  process.exit(2);
}

const NOW = new Date("2026-10-08T12:00:00Z");
const fixture = readFixture(readFileSync(join(ROOT, "docs", "run-a", "synthetic-profile.json"), "utf8"));
if (!fixture.ok) throw new Error(JSON.stringify(fixture.refusal));
const qualification = { countryCode: "IR", subject: "International Business", start: { year: 2013, month: 9 }, end: { kind: "completed", date: { year: 2015, month: 9 } }, award: { year: 2015, month: 9 }, grade: "19.5", gradeScale: "twenty_point" };
const doctorate = { ...qualification, level: "Doctorate", awardTitle: title, institution: "HHE" };
const masters = { ...qualification, level: "Master's degree", awardTitle: "MSc", institution: "Islamic Azad University" };
const profile = rehydrateProfile({
  studentId: "his-run",
  updatedAt: NOW,
  entries: fixture.fixture.entries.map((held) => ({ ...held, ...(held.key === "education.prior_qualifications" ? { value: [doctorate, masters] } : {}), provenance: { source: "seeded", confirmedAt: NOW }, revision: 1 })) as unknown as readonly StoredProfileEntry[],
});

const entry = readEntry(entryPath);
const today = questionsToday(entry, profile);
const bare = questionsProposed(entry, profile, NO_STANDING_RULES);
const shortForm = [...title].length > 28 ? { awardTitle: "DBA" } : {};
const withIntake = questionsProposed(entry, profile, { escapeWhenNotListed: true, shortForms: shortForm });

const lines = [
  `Entry: blueprint ${entry.blueprint.version}, mapping set ${entry.mappingSet.version}. Doctorate's award title: "${title}".`,
  "",
  `TODAY — ${String(today.length)} question(s) per application:`,
  formatQuestions(today),
  "",
  `PROPOSED (ADR-0156), no standing rules on the profile — ${String(bare.perApplication.length)} per application, asked together before the run; intake would ask: ${bare.atIntake.length === 0 ? "nothing" : bare.atIntake.join("; ")}`,
  formatQuestions(bare.perApplication),
  "",
  `PROPOSED (ADR-0156), with the intake answers (escape when not listed${Object.keys(shortForm).length === 0 ? "" : `; short form of awardTitle "DBA" — a stand-in for his own answer, never chosen for him`}) — ${String(withIntake.perApplication.length)} per application, asked together before the run:`,
  formatQuestions(withIntake.perApplication),
  "  settled without a question:",
  ...withIntake.settled.map((item) => `    ${item.field}#${String(item.item ?? "-")}: ${item.how}`),
  "",
];
process.stdout.write(lines.join("\n"));
