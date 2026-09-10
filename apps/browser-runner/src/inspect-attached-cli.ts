/**
 * Attached inspection of a form a person has signed in to (P79).
 *
 *   pnpm run inspect:attached <target> --cdp http://127.0.0.1:9222 [--out <dir>] <url> [url ...]
 *
 * The person launches Chromium with a remote-debugging port and signs in to
 * the portal by hand. This attaches to that browser, opens one tab in their
 * signed-in context, reads the named pages, and writes what discovery writes:
 * captures, observations, a DRAFT blueprint and a run record that
 * `pnpm run inspect-discovery` can read.
 *
 * It creates nothing, signs in to nothing, types nothing and clicks nothing.
 * While it is attached, the person's browser is read-only too — every request
 * that is not a GET, HEAD or OPTIONS to the target's hosts is refused and
 * recorded — and it is given back on exit. See `attached-inspection.ts`.
 */

import { existsSync, readdirSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { PlaywrightAttachedInspection } from "./attached-inspection.js";
import { draftBlueprintFrom } from "./discovery.js";
import { parseTarget } from "./target.js";
import type { PageObservation } from "./session.js";

function repoRoot(): string {
  let dir = import.meta.dirname;
  for (let up = 0; up < 8; up += 1) {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  return process.cwd();
}

function listTargets(root: string): readonly string[] {
  try {
    return readdirSync(resolve(root, "targets")).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
}

function resolveTargetPath(typed: string, root: string): string | null {
  const candidates = [
    resolve(typed),
    resolve(root, typed),
    resolve(root, "targets", typed),
    resolve(root, "targets", `${typed}.json`),
  ];
  const exact = candidates.find((candidate) => existsSync(candidate));
  if (exact !== undefined) return exact;
  const matching = listTargets(root).filter((name) => name.startsWith(typed));
  return matching.length === 1 ? resolve(root, "targets", matching[0] as string) : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pause(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

function usage(root: string): void {
  process.stderr.write(
    `Usage: pnpm run inspect:attached <target> --cdp <endpoint> <url> [url ...]\n\n` +
      `  <endpoint>   the browser's remote-debugging address, e.g. http://127.0.0.1:9222\n` +
      `  <url>        the signed-in pages to read, in order. No crawl: only these.\n` +
      `  --out <dir>  where to write the run (default: inspection-runs/ in this checkout)\n\n` +
      `Targets:\n` +
      listTargets(root)
        .map((name) => `  ${name}\n`)
        .join("") +
      `\nStart the browser first — see docs/runbook-discovery-handoff.md, "Attached inspection".\n`,
  );
  process.exitCode = 2;
}

async function main(): Promise<void> {
  const root = repoRoot();
  const args = process.argv.slice(2);
  const typed = args[0];
  const cdpIndex = args.indexOf("--cdp");
  const cdp = cdpIndex === -1 ? undefined : args[cdpIndex + 1];
  const outIndex = args.indexOf("--out");
  const outRoot = outIndex === -1 ? resolve(root, "inspection-runs") : resolve(args[outIndex + 1] ?? "");
  const taken = new Set([0, cdpIndex, cdpIndex + 1, outIndex, outIndex + 1]);
  const urls = args.filter((_, index) => !taken.has(index));

  if (typed === undefined || cdp === undefined || urls.length === 0) {
    usage(root);
    return;
  }
  const targetPath = resolveTargetPath(typed, root);
  if (targetPath === null) {
    process.stderr.write(`No target found for "${typed}".\n`);
    process.exitCode = 2;
    return;
  }
  const target = parseTarget(JSON.parse(await readFile(targetPath, "utf8")));

  // eslint-disable-next-line no-restricted-syntax -- run boundary
  const startedAt = new Date();
  const runId = `attached-${target.targetId}-${startedAt.toISOString().replace(/[:.]/g, "-")}`;
  const outDir = resolve(outRoot, runId);
  await mkdir(resolve(outDir, "pages"), { recursive: true });

  // Paced at the target's delay, never below the floor (ADR-0091).
  const delayMs = Math.max(target.crawlDelayMs, PlaywrightAttachedInspection.paceFloorMs);

  process.stdout.write(
    `\nAttached inspection — ${target.institutionName}\n` +
      `${target.courseName}, ${target.intake}\n\n` +
      `READ-ONLY, in YOUR browser's signed-in session. While this runs, that browser\n` +
      `cannot save, submit or sign in to anything on ${target.allowedHosts.join(", ")}:\n` +
      `every request that is not a GET is refused and recorded. It is yours again on exit.\n` +
      `Nothing here creates, fills, clicks, uploads or submits. Paced at ${String(delayMs)}ms.\n` +
      `robots.txt is NOT applied to this mode — this is your own session, not a crawl —\n` +
      `and the run record says so.\n\n`,
  );

  const session = await PlaywrightAttachedInspection.open({
    runId,
    capability: "read_only",
    allowedHosts: [...target.allowedHosts],
    traceDir: outDir,
    cdpEndpoint: cdp,
    navigableUrlPatterns: urls.map((url) => new RegExp(`^${escapeRegExp(url.split("#")[0] ?? url)}`)),
  });

  const observations: PageObservation[] = [];
  const captured: { url: string; file: string; capturedAt: string }[] = [];
  const visited: string[] = [];
  const failed: { url: string; error: string }[] = [];

  try {
    for (const url of urls) {
      await pause(delayMs);
      process.stdout.write(`  → ${url}\n`);
      try {
        await session.goto(url);
        await session.settle(20_000);
        const observation = await session.observe();
        observations.push(observation);
        visited.push(observation.url);
        const file = `pages/${String(visited.length).padStart(3, "0")}.html`;
        await writeFile(resolve(outDir, file), await session.html());
        captured.push({ url: observation.url, file, capturedAt: observation.observedAt.toISOString() });
        await session.screenshot(`page-${String(visited.length)}`);
        const fields = observation.forms.reduce((n, form) => n + form.fields.length, 0);
        process.stdout.write(
          `     ${String(observation.forms.length)} form(s), ${String(fields)} field(s), ` +
            `${String(observation.signals.length)} signal(s)\n`,
        );
        if (observation.url !== url) {
          process.stdout.write(`     landed on ${observation.url}\n`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failed.push({ url, error: message });
        process.stdout.write(`     ✗ ${message.split("\n")[0] ?? ""}\n`);
      }
    }
  } finally {
    await session.close();
  }

  const blueprint = draftBlueprintFrom({
    blueprintId: `bp-${target.targetId}`,
    institutionName: target.institutionName,
    courseName: target.courseName,
    intake: target.intake,
    route: target.route,
    observations,
    discoveryRunId: runId,
    discoveredAt: startedAt,
    unobservedClaims: [...target.claimsToVerify],
    authenticationRequired: true,
    authenticationNotes:
      "Observed from a session a person signed in to by hand (attached inspection, P79). The " +
      "registration and login pages themselves were not observed by this run, and the " +
      "registration and login boxes are authored by a person from their captures.",
    ...(target.campus !== undefined ? { campus: target.campus } : {}),
    ...(target.platformHypothesis !== undefined ? { platform: target.platformHypothesis } : {}),
  });
  await writeFile(resolve(outDir, "blueprint.draft.json"), JSON.stringify(blueprint, null, 2) + "\n");
  await writeFile(
    resolve(outDir, "pages", "index.json"),
    JSON.stringify({ runId, capturedAt: startedAt.toISOString(), pages: captured }, null, 2) + "\n",
  );
  await writeFile(
    resolve(outDir, "run.json"),
    JSON.stringify(
      {
        runId,
        mode: "attached_read_only",
        target: {
          targetId: target.targetId,
          institutionName: target.institutionName,
          allowedHosts: target.allowedHosts,
        },
        cdpEndpoint: new URL(cdp.replace(/^ws/, "http")).host,
        urls,
        visited,
        failed,
        // Method, URL, which rule refused it and why: "Requests refused 1" on
        // the terminal is answerable from the record, without a second run.
        blockedRequests: session.blockedLog.entries.map((entry) => ({
          method: entry.method,
          url: entry.url,
          rule: entry.rule ?? "method",
          reason: entry.reason ?? "",
        })),
        refusedNavigations: session.refusedNavigations,
        crawlDelayMs: delayMs,
        robots: "not applied: attached to a person's own signed-in session, a named handful of pages, one tab, paced. ADR-0091 governs a crawler; this is not one. Recorded so the choice is visible.",
        capturesScrubbed: "input values and textarea bodies removed from pages/*.html; the page itself was not touched",
        startedAt: startedAt.toISOString(),
      },
      null,
      2,
    ) + "\n",
  );

  process.stdout.write(`\nPages read         ${String(visited.length)} of ${String(urls.length)}\n`);
  process.stdout.write(`Pages failed       ${String(failed.length)}\n`);
  process.stdout.write(`Navigations refused ${String(session.refusedNavigations.length)}\n`);
  process.stdout.write(`Requests refused    ${String(session.blockedRequests().length)}\n`);
  if (session.refusedNavigations.length > 0) {
    process.stdout.write(
      `\nA page sent this run somewhere off its list — most often the login page, which\n` +
        `means the session had ended. Sign in again in your browser and re-run:\n` +
        session.refusedNavigations.map((url) => `  ${url}\n`).join(""),
    );
  }
  process.stdout.write(`\nOutput: ${outDir}\n`);
  process.stdout.write(`Read it back with: pnpm run inspect-discovery ${outDir}\n\n`);
  process.stdout.write(
    `Before sending it anywhere, look at pages/*.html. Input values were removed, but a\n` +
      `signed-in page can still carry your name or email in its text.\n` +
      `Your browser is yours again. Nothing was created, signed into, filled, uploaded or submitted.\n`,
  );
  if (visited.length === 0) process.exitCode = 1;
}

await main();
