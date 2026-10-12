/**
 * How long a portal has taken to onboard, stage by stage (P297).
 *
 * Vahid, 2026-10-12: *"Measure one more thing from now on: the time it takes
 * to onboard a new portal. That is the number that decides whether we are
 * global."*
 *
 * Reads a record under docs/onboarding/ (the stages are defined in its
 * README) and prints each stage with the time its MARKER says: a commit's
 * committer time, or a capture's own `startedAt`. The record names markers;
 * it never carries a time, so no number here is written from recollection.
 * A stage not reached prints how long it has been since T1, at the time of
 * the commit this runs on, and what the record says is missing.
 *
 * It checks that every marker exists and is in HEAD's history, that each
 * stage reached has the one it rests on (T3 on T2, T4 and T5 on T3, T6 on T5)
 * and is not earlier than it, and that the clock's two anchors are what they
 * say: T0 the commit that added the record's target file, T1 the first
 * committed capture of that target. It cannot check that the work behind any
 * other marker meets its stage's definition; the record says that, and why.
 *
 * Usage: tsx scripts/portal-onboarding-time.ts docs/onboarding/<portal>.json
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const STAGES = ["T0", "T1", "T2", "T3", "T4", "T5", "T6"] as const;

interface Marker {
  readonly commit?: string;
  readonly capture?: string;
  readonly what: string;
}

interface Stage {
  readonly stage: string;
  readonly name: string;
  readonly marker?: Marker;
  readonly partly?: readonly Marker[];
  readonly missing?: readonly string[];
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

function git(args: readonly string[]): string | null {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch {
    return null;
  }
}

/** A commit marker, resolved: an abbreviated or full hash, in HEAD's history. */
function commitOf(commit: string, where: string): string {
  // A hash and nothing else: "HEAD" or a branch name would move with every
  // commit, and a value starting "--" would reach git as an option.
  if (!/^[0-9a-f]{7,40}$/.test(commit)) fail(`${where}: "${commit}" is not a commit hash; a marker names a commit by its hash.`);
  const full = git(["rev-parse", "--verify", "--quiet", "--end-of-options", `${commit}^{commit}`]);
  if (full === null || full.length === 0) fail(`${where}: commit ${commit} does not exist in this checkout's history. A shallow clone holds none: fetch the history whole.`);
  if (git(["merge-base", "--is-ancestor", full, "HEAD"]) === null) fail(`${where}: commit ${commit} is not in HEAD's history, so nothing on this branch reached it.`);
  return full;
}

/** The time a marker says, read from the marker itself. */
function timeOf(marker: Marker, where: string): Date {
  if (marker.commit !== undefined && marker.capture === undefined) {
    const printed = git(["show", "-s", "--format=%cI", commitOf(marker.commit, where)]) ?? "";
    return new Date(printed);
  }
  if (marker.capture !== undefined && marker.commit === undefined) {
    let startedAt: unknown;
    try {
      startedAt = (JSON.parse(readFileSync(join(ROOT, marker.capture), "utf8")) as { startedAt?: unknown }).startedAt;
    } catch {
      fail(`${where}: capture ${marker.capture} cannot be read as a capture's run.json.`);
    }
    if (typeof startedAt !== "string" || Number.isNaN(new Date(startedAt).getTime())) fail(`${where}: capture ${marker.capture} holds no startedAt instant.`);
    return new Date(startedAt);
  }
  fail(`${where}: a marker names exactly one of a commit or a capture.`);
}

function elapsed(from: Date, to: Date): string {
  // Whole minutes elapsed, counted down, as a clock line counts them.
  const minutes = Math.floor(Math.abs(to.getTime() - from.getTime()) / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const parts = [days > 0 ? `${String(days)} d` : "", days > 0 || hours > 0 ? `${String(hours)} h` : "", `${String(minutes % 60)} m`].filter(Boolean).join(" ");
  return to.getTime() < from.getTime() ? `${parts} before T1` : `${parts} after T1`;
}

function iso(at: Date): string {
  return at.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function labelOf(marker: Marker): string {
  return marker.commit !== undefined ? `commit ${marker.commit}` : `${marker.capture ?? ""} startedAt`;
}

/** What each stage rests on (docs/onboarding/README.md): reached only after it. */
const RESTS_ON: Readonly<Record<string, string>> = { T2: "T1", T3: "T2", T4: "T3", T5: "T3", T6: "T5" };

const [recordPath] = process.argv.slice(2);
if (recordPath === undefined) fail("Usage: tsx scripts/portal-onboarding-time.ts docs/onboarding/<portal>.json");
const shown = relative(ROOT, resolve(recordPath));

let record: { readonly portal?: unknown; readonly target?: unknown; readonly stages?: unknown };
try {
  record = JSON.parse(readFileSync(resolve(recordPath), "utf8")) as typeof record;
} catch {
  fail(`${shown} cannot be read as JSON.`);
}
if (typeof record.portal !== "string" || typeof record.target !== "string" || !Array.isArray(record.stages)) {
  fail(`${shown}: a record names its portal, its target file and its stages.`);
}
const targetFile = record.target;
let targetId: unknown;
try {
  targetId = (JSON.parse(readFileSync(join(ROOT, targetFile), "utf8")) as { targetId?: unknown }).targetId;
} catch {
  fail(`${shown}: its target file ${targetFile} cannot be read.`);
}
if (typeof targetId !== "string") fail(`${shown}: its target file ${targetFile} names no targetId.`);
const stages = record.stages as readonly Stage[];
if (stages.map((stage) => stage.stage).join(" ") !== STAGES.join(" ")) {
  fail(`${shown}: the stages must be ${STAGES.join(", ")}, in that order, each once; the record has ${stages.map((stage) => String(stage.stage)).join(", ")}.`);
}

// Everything is read and checked before anything is printed.
const reached = new Map<string, Date>();
const partly = new Map<string, readonly { readonly marker: Marker; readonly at: Date }[]>();
for (const stage of stages) {
  const where = `${shown} ${stage.stage}`;
  if (stage.marker !== undefined && stage.missing !== undefined) fail(`${where}: a stage is reached (a marker) or not (what is missing), not both.`);
  if (stage.marker === undefined && (stage.missing === undefined || stage.missing.length === 0)) fail(`${where}: a stage not reached says what is missing.`);
  if (stage.marker !== undefined) reached.set(stage.stage, timeOf(stage.marker, where));
  partly.set(stage.stage, (stage.partly ?? []).map((marker) => ({ marker, at: timeOf(marker, `${where} (partly)`) })));
}
const t1 = reached.get("T1");
if (t1 === undefined) fail(`${shown}: T1, the first capture, is where the clock starts; a record begins there.`);

// The clock's anchors are what they say, read from the repository.
const added = git(["log", "--diff-filter=A", "--format=%H", "--", targetFile])?.split("\n").filter(Boolean).at(-1);
const t0Marker = stages.find((stage) => stage.stage === "T0")?.marker;
if (t0Marker !== undefined && (t0Marker.commit === undefined || added === undefined || !added.startsWith(commitOf(t0Marker.commit, `${shown} T0`)))) {
  fail(`${shown} T0: the marker is not the commit that added ${targetFile}${added === undefined ? "" : ` (${added.slice(0, 8)})`}.`);
}
const t1Marker = stages.find((stage) => stage.stage === "T1")?.marker;
if (t1Marker?.capture === undefined) fail(`${shown} T1: the first capture is a capture's run.json.`);
const captures = (git(["ls-files", "docs/captures/*/run.json"]) ?? "").split("\n").filter(Boolean).flatMap((file) => {
  try {
    const run = JSON.parse(readFileSync(join(ROOT, file), "utf8")) as { target?: { targetId?: unknown }; startedAt?: unknown };
    return run.target?.targetId === targetId && typeof run.startedAt === "string" ? [{ file, at: new Date(run.startedAt) }] : [];
  } catch {
    return [];
  }
});
if (!captures.some((capture) => capture.file === t1Marker.capture)) fail(`${shown} T1: ${t1Marker.capture} is not a committed capture of ${targetId}.`);
const first = captures.reduce((earliest, capture) => (capture.at.getTime() < earliest.at.getTime() ? capture : earliest));
if (first.file !== t1Marker.capture) fail(`${shown} T1: the first committed capture of ${targetId} is ${first.file} (${iso(first.at)}), not ${t1Marker.capture}.`);

const t0 = reached.get("T0");
if (t0 !== undefined && t0.getTime() > t1.getTime()) fail(`${shown}: T0 (${iso(t0)}) is later than T1 (${iso(t1)}); a target is opened before it is read.`);
for (const [stage, restsOn] of Object.entries(RESTS_ON)) {
  const at = reached.get(stage);
  if (at === undefined) continue;
  const before = reached.get(restsOn);
  if (before === undefined) fail(`${shown}: ${stage} is reached and ${restsOn}, which it rests on, is not.`);
  if (at.getTime() < before.getTime()) fail(`${shown}: ${stage} (${iso(at)}) is earlier than ${restsOn} (${iso(before)}), which it rests on.`);
}

const headSha = execFileSync("git", ["rev-parse", "--short=8", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
const head = new Date(execFileSync("git", ["show", "-s", "--format=%cI", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim());

const lines: string[] = [`ONBOARDING   ${record.portal} (${shown})`, ""];
for (const stage of stages) {
  const label = `${stage.stage} ${stage.name}`.padEnd(26);
  const at = reached.get(stage.stage);
  if (at !== undefined && stage.marker !== undefined) {
    lines.push(`${label}${iso(at)}   ${stage.stage === "T1" ? "the clock starts" : elapsed(t1, at)}   ${labelOf(stage.marker)}: ${stage.marker.what}`);
  } else {
    lines.push(`${label}not reached`);
  }
  for (const { marker, at: when } of partly.get(stage.stage) ?? []) {
    lines.push(`${"".padEnd(26)}partly, ${iso(when)}   ${elapsed(t1, when)}   ${labelOf(marker)}: ${marker.what}`);
  }
  for (const gap of stage.missing ?? []) lines.push(`${"".padEnd(26)}missing: ${gap}`);
}
const t5 = reached.get("T5");
const t6 = reached.get("T6");
lines.push(
  "",
  `TIME TO ONBOARD (T5 - T1)   ${t5 === undefined ? `not reached: ${elapsed(t1, head)}, at HEAD ${headSha} (${iso(head)})` : elapsed(t1, t5).replace(/ after T1$/, "")}`,
  `GLOBAL (T6 - T1)            ${t6 === undefined ? "not reached" : elapsed(t1, t6).replace(/ after T1$/, "")}`,
  "",
  "Each time is read from its marker: a commit's committer time, or a capture's startedAt. This",
  "cannot see person-time, or whether the work behind a marker meets its stage; the record says that.",
);
process.stdout.write(`${lines.join("\n")}\n`);
