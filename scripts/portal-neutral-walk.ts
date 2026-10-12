/**
 * Is the profile portal-neutral? A walk across every portal the repository
 * holds (P297).
 *
 * Vahid, 2026-10-12: *"Profile data must be portal-neutral, so a second
 * university asks only that portal's own questions. Confirm whether it
 * already is."*
 *
 * Deterministic: no model, no network, nothing written. For Sheffield's signed
 * entry and the two test portals (Example University, Gated University) it
 * prints the profile keys each portal's mapping reads, the keys its interview
 * would ask on an empty profile, which of a second portal's keys the first
 * already asked, and what each plans to with the Run A synthetic profile.
 *
 * What it cannot see: a second REAL portal (the repository holds one, and the
 * two others are portals it wrote itself), and a profile built by a real
 * interview. It says how the mechanism behaves, not what another university
 * asks.
 *
 * Usage: tsx scripts/portal-neutral-walk.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { ApplicationBlueprint } from "@askimate/aas-blueprint";
import { studentId } from "@askimate/aas-domain";
import { parseReviewedEntryText } from "@askimate/aas-catalogue";
import { checkUsable, planFill } from "@askimate/aas-mapping";
import type { MappingSet, UsableMappingSet } from "@askimate/aas-mapping";
import { FIXTURE_BLUEPRINT, FIXTURE_MAPPING_SET } from "@askimate/aas-mapping/fixtures";
import { GATED_PORTAL_BLUEPRINT, GATED_PORTAL_MAPPING_SET } from "@askimate/aas-mapping/fixtures/gated";
import { partPolicyFor, requiredFieldsFor } from "@askimate/aas-orchestrator";
import { emptyProfile, PROFILE_FIELD_KEYS, rehydrateProfile } from "@askimate/aas-profile";
import type { StoredProfileEntry } from "@askimate/aas-profile";

const ROOT = join(import.meta.dirname, "..");
const NOW = new Date("2026-10-12T12:00:00Z");

interface Portal {
  readonly name: string;
  readonly blueprint: ApplicationBlueprint;
  readonly mappingSet: MappingSet;
}

const parsed = parseReviewedEntryText(readFileSync(join(ROOT, "docs", "run-a", "catalogue", "entries", "sheffield-pgt-2027-09.json"), "utf8"));
if (!parsed.ok) throw new Error(`Sheffield's entry does not parse: ${JSON.stringify(parsed.refusal)}`);
const PORTALS: readonly Portal[] = [
  { name: "sheffield", blueprint: parsed.value.blueprint, mappingSet: parsed.value.mappingSet },
  { name: "fixture (Example University)", blueprint: FIXTURE_BLUEPRINT, mappingSet: FIXTURE_MAPPING_SET },
  { name: "gated (Gated University)", blueprint: GATED_PORTAL_BLUEPRINT, mappingSet: GATED_PORTAL_MAPPING_SET },
];

function usable(portal: Portal): UsableMappingSet {
  const check = checkUsable(portal.mappingSet, portal.blueprint);
  if (!check.usable) throw new Error(`${portal.name}: not usable: ${check.refusal.detail}`);
  return check.mappingSet;
}

const out: string[] = [`PROFILE_FIELD_KEYS: ${String(PROFILE_FIELD_KEYS.length)}`];
const worklists = new Map<string, ReadonlySet<string>>();
for (const portal of PORTALS) {
  const set = usable(portal);
  const mapped = new Set(set.mappings.flatMap((mapping) => (mapping.source.kind === "profile_field" ? [mapping.source.fieldKey] : [])));
  const plan = planFill(portal.blueprint, set, emptyProfile(studentId("walk"), NOW), []);
  const worklist = new Set<string>([
    ...requiredFieldsFor(portal.blueprint, set),
    ...plan.blockers.flatMap((blocker) => (blocker.kind === "value_unavailable" ? [blocker.fieldKey] : [])),
  ]);
  worklists.set(portal.name, worklist);
  out.push(`${portal.name}: mapped profile keys ${String(mapped.size)}: ${[...mapped].sort().join(", ")}`);
  out.push(`${portal.name}: interview worklist on an empty profile ${String(worklist.size)}: ${[...worklist].sort().join(", ")}`);
  for (const [fieldKey, rule] of partPolicyFor(portal.blueprint, set)) {
    out.push(`${portal.name}: parts asked of ${fieldKey}: ${rule.asked === "all" ? "all" : [...rule.asked].sort().join("|")}; required: ${[...rule.required].sort().join("|")}`);
  }
}
const first = worklists.get("sheffield") ?? new Set<string>();
for (const portal of PORTALS.slice(1)) {
  const second = worklists.get(portal.name) ?? new Set<string>();
  out.push(`${portal.name} after sheffield: already asked ${[...second].filter((key) => first.has(key)).sort().join(", ") || "(none)"}; new ${[...second].filter((key) => !first.has(key)).sort().join(", ") || "(none)"}`);
}

const fixture = JSON.parse(readFileSync(join(ROOT, "docs", "run-a", "synthetic-profile.json"), "utf8")) as { readonly entries: readonly { readonly key: string; readonly value: unknown }[] };
const profile = rehydrateProfile({
  studentId: "walk",
  updatedAt: NOW,
  entries: fixture.entries.map((held) => ({ key: held.key, value: held.value, provenance: { source: "seeded", confirmedAt: NOW }, revision: 1 })) as unknown as readonly StoredProfileEntry[],
});
out.push(`Run A synthetic profile: ${String(fixture.entries.length)} keys held`);
for (const portal of PORTALS) {
  const plan = planFill(portal.blueprint, usable(portal), profile, []);
  out.push(`${portal.name} with the synthetic profile: ${String(plan.blockers.length)} blocker(s)`);
  for (const blocker of plan.blockers) {
    const said =
      blocker.kind === "value_unavailable"
        ? `${blocker.fieldKey} (${blocker.reason})`
        : blocker.kind === "render_refused"
          ? `${blocker.fieldRef}: ${blocker.refusal.kind}${"value" in blocker.refusal ? ` "${String(blocker.refusal.value)}"` : ""}`
          : blocker.fieldRef;
    out.push(`  ${blocker.kind}: ${said}`);
  }
}
process.stdout.write(`${out.join("\n")}\n`);
