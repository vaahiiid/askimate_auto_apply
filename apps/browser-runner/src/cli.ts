/**
 * Discovery CLI.
 *
 *   pnpm run discover targets/ulster-birmingham-msc-ib-2026.json
 *
 * Runs READ-ONLY discovery against a target and writes a draft Application
 * Blueprint, screenshots, a Playwright trace and a human-readable report.
 *
 * Safety, unchanged from ADR-0014 and not weakened by being a CLI:
 *   • the session is `read_only` — no fill, no click, no submit
 *   • every non-GET request is aborted before it leaves the machine
 *   • navigation is confined to the target's allowed hosts
 *   • the output is always a DRAFT; a specialist must review it
 *
 * Runnable anywhere with normal network access, which is the point: discovery
 * does not depend on where it runs.
 */

import { existsSync, readdirSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { PlaywrightDiscoverySession } from "./playwright-session.js";
import type { PageObservation } from "./session.js";
import type { CapturedPage } from "./replay.js";
import { draftBlueprintFrom } from "./discovery.js";
import { parseTarget, shouldFollow, type DiscoveryTarget } from "./target.js";

interface RunResult {
  readonly observations: readonly PageObservation[];
  /** Pages saved to disk, so the run can be replayed locally afterwards. */
  readonly captured: readonly CapturedPage[];
  readonly visited: readonly string[];
  readonly failed: readonly { readonly url: string; readonly error: string }[];
  readonly blockedRequests: readonly { readonly method: string; readonly url: string }[];
}

async function discover(target: DiscoveryTarget, outDir: string, runId: string): Promise<RunResult> {
  const session = await PlaywrightDiscoverySession.open({
    capability: "read_only",
    allowedHosts: [...target.allowedHosts],
    runId,
    traceDir: outDir,
  });

  const observations: PageObservation[] = [];
  const captured: CapturedPage[] = [];
  const visited: string[] = [];
  const failed: { url: string; error: string }[] = [];
  const seen = new Set<string>();
  const queue = [...target.seedUrls];

  try {
    while (queue.length > 0 && visited.length < target.maxPages) {
      const url = queue.shift();
      if (url === undefined) break;

      const key = url.split("#")[0] ?? url;
      if (seen.has(key)) continue;
      seen.add(key);

      process.stdout.write(`  → ${url}\n`);
      try {
        await session.goto(url);
        const observation = await session.observe();
        observations.push(observation);
        visited.push(observation.url);
        await session.screenshot(`page-${String(visited.length)}`);

        // Capture the page so the run can be REPLAYED locally. This is what
        // lets the fill logic be built and debugged against what the portal
        // really looks like, without a live admissions system involved.
        const file = `pages/${String(visited.length).padStart(3, "0")}.html`;
        await writeFile(resolve(outDir, file), await session.html());
        captured.push({ url: observation.url, file, capturedAt: observation.observedAt.toISOString() });

        // Follow in-scope links. Conservative by design: only links matching
        // the target's patterns, and only within the allow-list.
        for (const link of await session.links()) {
          if (!seen.has(link.split("#")[0] ?? link) && shouldFollow(target, link)) {
            queue.push(link);
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stdout.write(`     ✗ ${message}\n`);
        failed.push({ url, error: message });
      }
    }

    return {
      observations,
      captured,
      visited,
      failed,
      blockedRequests: session.blockedRequests(),
    };
  } finally {
    await session.close();
  }
}

/**
 * Finds the repository root by walking up for the workspace marker.
 *
 * `pnpm run discover` runs this with the cwd set to `apps/browser-runner`,
 * not the repo root, so a path a person naturally types —
 * `targets/ulster-....json`, because that is where the file is — resolves
 * against the wrong directory and the run dies before it starts. That is a
 * five-minute job turned into a support round-trip.
 */
function repoRoot(): string {
  let dir = import.meta.dirname;
  for (let up = 0; up < 8; up += 1) {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  return process.cwd();
}

/**
 * Resolves what the person typed to a target file.
 *
 * Accepts a path relative to the cwd, a path relative to the repo root, a bare
 * filename in `targets/`, and a bare name with no extension — so `ulster` and
 * `targets/ulster-birmingham-msc-ib-2026.json` both work. Guessing here is
 * safe: it either finds the file or lists what exists.
 */
function resolveTargetPath(typed: string, root: string): string | null {
  const candidates = [
    resolve(typed),
    resolve(root, typed),
    resolve(root, "targets", typed),
    resolve(root, "targets", `${typed}.json`),
  ];
  const exact = candidates.find((candidate) => existsSync(candidate));
  if (exact !== undefined) return exact;

  // Finally, an unambiguous prefix: `ulster` finds
  // `ulster-birmingham-msc-ib-2026.json`. Only when exactly one matches —
  // running discovery against the wrong university because two names shared a
  // prefix would be a bad way to save four keystrokes.
  const matching = listTargets(root).filter((name) => name.startsWith(typed));
  return matching.length === 1 ? resolve(root, "targets", matching[0] as string) : null;
}

async function main(): Promise<void> {
  const root = repoRoot();
  const typed = process.argv[2];

  if (typed === undefined) {
    process.stderr.write(
      `Usage: pnpm run discover <target>\n\n` +
        `Targets available:\n` +
        listTargets(root)
          .map((name) => `  ${name}\n`)
          .join("") +
        `\nA bare name works: pnpm run discover ulster-birmingham-msc-ib-2026\n`,
    );
    process.exitCode = 2;
    return;
  }

  const targetPath = resolveTargetPath(typed, root);
  if (targetPath === null) {
    process.stderr.write(
      `No target found for "${typed}".\n\nTargets available:\n` +
        listTargets(root)
          .map((name) => `  ${name}\n`)
          .join(""),
    );
    process.exitCode = 2;
    return;
  }

  const target = parseTarget(JSON.parse(await readFile(targetPath, "utf8")));

  // Deterministic where it matters, but a run needs a real timestamp. This is
  // the one sanctioned clock read in the CLI; everything downstream receives it.
  // eslint-disable-next-line no-restricted-syntax -- run boundary
  const startedAt = new Date();
  const runId = `disc-${target.targetId}-${startedAt.toISOString().replace(/[:.]/g, "-")}`;
  // Always under the repo root, never under whichever directory pnpm happened
  // to set as the cwd. One predictable place to look for the output.
  const outDir = resolve(root, "discovery-runs", runId);
  await mkdir(resolve(outDir, "pages"), { recursive: true });

  process.stdout.write(`\nDiscovery — ${target.institutionName}`);
  if (target.campus !== undefined) process.stdout.write(` (${target.campus})`);
  process.stdout.write(`\n${target.courseName}, ${target.intake}\n`);
  process.stdout.write(`READ-ONLY. Cannot fill, click or submit.\n`);
  process.stdout.write(`Hosts: ${target.allowedHosts.join(", ")}\n\n`);

  // ── Resolve-only: stop here, before any browser or network exists ───────
  //
  // `cli.test.ts` verifies that a typed name resolves to the right target. It
  // has always set `AAS_DISCOVERY_DRY_RUN=1` for that, with the comment "No
  // network, so any target that resolves will fail at navigation — which is
  // fine." **Nothing read the variable.** The comment was describing the
  // sandboxed development environment, where egress is blocked and navigation
  // fails in seconds.
  //
  // GitHub Actions has open network. So on every push, three tests launched a
  // real browser and began crawling up to `maxPages` of qahighereducation.com
  // and ulster.ac.uk — live university websites — until each hit its 60-second
  // timeout. That is why the CI job has failed on every run, and it is the more
  // serious half of the problem: the standing rule is that nothing runs against
  // a real university site without an explicit safe target and Vahid's
  // go-ahead, and a test suite had been doing it unattended.
  //
  // The flag is now real. Resolution is what those tests check, so resolution
  // is where they stop — and the line below gives them something to assert
  // that only holds if no page was ever fetched.
  if (process.env["AAS_DISCOVERY_DRY_RUN"] === "1" || process.argv.includes("--resolve-only")) {
    process.stdout.write(`Resolve-only: stopping here. No pages fetched.\n`);
    return;
  }

  const result = await discover(target, outDir, runId);

  const blueprint = draftBlueprintFrom({
    blueprintId: `bp-${target.targetId}`,
    institutionName: target.institutionName,
    courseName: target.courseName,
    intake: target.intake,
    route: target.route,
    observations: result.observations,
    discoveryRunId: runId,
    discoveredAt: startedAt,
    // Everything not observed first-hand is recorded as such, so the blueprint
    // is honest about the difference between "we saw this" and "we were told".
    unobservedClaims: [...target.claimsToVerify],
    authenticationRequired: true,
    authenticationNotes:
      "Determined during review. Discovery cannot test a login without creating an account, " +
      "which it is not authorised to do.",
    ...(target.campus !== undefined ? { campus: target.campus } : {}),
    ...(target.platformHypothesis !== undefined ? { platform: target.platformHypothesis } : {}),
  });

  await writeFile(resolve(outDir, "blueprint.draft.json"), JSON.stringify(blueprint, null, 2) + "\n");
  await writeFile(
    resolve(outDir, "pages", "index.json"),
    JSON.stringify(
      { runId, capturedAt: startedAt.toISOString(), pages: result.captured },
      null,
      2,
    ) + "\n",
  );
  await writeFile(
    resolve(outDir, "run.json"),
    JSON.stringify(
      { runId, target, visited: result.visited, failed: result.failed, blockedRequests: result.blockedRequests },
      null,
      2,
    ) + "\n",
  );

  process.stdout.write(`\nPages visited      ${String(result.visited.length)}\n`);
  process.stdout.write(`Pages failed       ${String(result.failed.length)}\n`);
  process.stdout.write(`Requests blocked   ${String(result.blockedRequests.length)}\n`);
  if (result.blockedRequests.length > 0) {
    process.stdout.write(
      `  ⚠ The portal attempted state-changing requests during ordinary browsing.\n` +
        `    A specialist must review this before any execution run.\n`,
    );
  }
  process.stdout.write(`\nOutput: ${outDir}\n`);
  process.stdout.write(`Blueprint status: DRAFT — not executable until reviewed.\n\n`);

  if (result.visited.length === 0) {
    process.stderr.write(
      "No pages were reached. If every URL failed, check network access to the target hosts.\n",
    );
    process.exitCode = 1;
  }
}

function listTargets(root: string): readonly string[] {
  try {
    return readdirSync(resolve(root, "targets")).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
}

await main();
