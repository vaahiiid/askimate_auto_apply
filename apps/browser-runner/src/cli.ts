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

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { PlaywrightDiscoverySession } from "./playwright-session.js";
import type { PageObservation } from "./session.js";
import { draftBlueprintFrom } from "./discovery.js";
import { parseTarget, shouldFollow, type DiscoveryTarget } from "./target.js";

interface RunResult {
  readonly observations: readonly PageObservation[];
  readonly visited: readonly string[];
  readonly failed: readonly { readonly url: string; readonly error: string }[];
  readonly blockedRequests: readonly { readonly method: string; readonly url: string }[];
}

async function discover(target: DiscoveryTarget, traceDir: string, runId: string): Promise<RunResult> {
  const session = await PlaywrightDiscoverySession.open({
    capability: "read_only",
    allowedHosts: [...target.allowedHosts],
    runId,
    traceDir,
  });

  const observations: PageObservation[] = [];
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
      visited,
      failed,
      blockedRequests: session.blockedRequests(),
    };
  } finally {
    await session.close();
  }
}

async function main(): Promise<void> {
  const targetPath = process.argv[2];
  if (targetPath === undefined) {
    process.stderr.write("Usage: pnpm run discover <target.json>\n");
    process.exitCode = 2;
    return;
  }

  const target = parseTarget(JSON.parse(await readFile(resolve(targetPath), "utf8")));

  // Deterministic where it matters, but a run needs a real timestamp. This is
  // the one sanctioned clock read in the CLI; everything downstream receives it.
  // eslint-disable-next-line no-restricted-syntax -- run boundary
  const startedAt = new Date();
  const runId = `disc-${target.targetId}-${startedAt.toISOString().replace(/[:.]/g, "-")}`;
  const outDir = resolve("discovery-runs", runId);
  await mkdir(outDir, { recursive: true });

  process.stdout.write(`\nDiscovery — ${target.institutionName}`);
  if (target.campus !== undefined) process.stdout.write(` (${target.campus})`);
  process.stdout.write(`\n${target.courseName}, ${target.intake}\n`);
  process.stdout.write(`READ-ONLY. Cannot fill, click or submit.\n`);
  process.stdout.write(`Hosts: ${target.allowedHosts.join(", ")}\n\n`);

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

await main();
