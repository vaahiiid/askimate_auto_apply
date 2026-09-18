/**
 * Attached inspection of a form a person has signed in to (P79).
 *
 *   pnpm run inspect:attached <target> --cdp http://127.0.0.1:9222 [--out <dir>] [--as-is]
 *                             [--as-runner] [--covering <strategy>=<value> ...] <url> [url ...]
 *
 * With `--as-runner` (ADR-0128) it reads the page the RUNNER meets: reads to
 * hosts off the target's list are let through and recorded — a tag manager
 * loads — every request presents the runner's own user agent, and the tab is
 * the runner's viewport. `--covering` names a control and the read says what
 * stands at its centre point, top-most first. Neither presses anything.
 *
 * With `--as-is` it reads the person's OWN open tab at each URL as it stands —
 * no navigation, so what they chose on the page (and every list a choice
 * loaded) is in the read (P127, distance item 5).
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

import type { FieldLocator } from "@askimate/aas-blueprint";

import { PlaywrightAttachedInspection, type CoveringReading } from "./attached-inspection.js";
import { RUNNER_PRESENTS, parseCoveringLocator } from "./runner-identity.js";
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

function coveringInWords(reading: CoveringReading): string {
  const who = `${reading.locator.strategy}=${reading.locator.value}`;
  if (!reading.found) return `     ${who}: not on this page`;
  if (!reading.covered) return `     ${who}: at its own point — nothing over it`;
  const top = reading.atPoint;
  const name = top === undefined ? "?" : `<${top.tag}${top.id === null ? "" : `#${top.id}`}${top.classes.length === 0 ? "" : `.${top.classes.join(".")}`}>`;
  const shape = top === undefined ? "" : ` position ${top.position}, z-index ${top.zIndex}, ${String(top.box.width)}×${String(top.box.height)} at ${String(top.box.x)},${String(top.box.y)}${top.role === null ? "" : `, ${top.role}`}`;
  const text = top === undefined || top.text === "" ? "" : `\n       text: ${JSON.stringify(top.text)}`;
  return `     ${who}: COVERED by ${name}${shape}${text}\n       stack, top first: ${reading.stack.map((layer) => `${layer.tag}${layer.id === null ? "" : `#${layer.id}`}`).join(" > ")}`;
}

function usage(root: string): void {
  process.stderr.write(
    `Usage: pnpm run inspect:attached <target> --cdp <endpoint> <url> [url ...]\n\n` +
      `  <endpoint>   the browser's remote-debugging address, e.g. http://127.0.0.1:9222\n` +
      `  <url>        the signed-in pages to read, in order. No crawl: only these.\n` +
      `  --out <dir>  where to write the run (default: inspection-runs/ in this checkout)\n` +
      `  --as-is      read YOUR open tab at each url as it stands, without navigating it —\n` +
      `               for a page whose lists load only after a choice (open the page, make\n` +
      `               the choices, leave the tab on it, then run)\n` +
      `  --as-runner  read the page the RUNNER meets (ADR-0128): off-host reads allowed and\n` +
      `               recorded, the runner's user agent presented, the runner's viewport\n` +
      `  --covering <strategy>=<value>\n` +
      `               say what stands at this control's centre point (repeatable), e.g.\n` +
      `               --covering name=loginBtn\n\n` +
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
  const asIsIndex = args.indexOf("--as-is");
  const asIs = asIsIndex !== -1;
  const asRunnerIndex = args.indexOf("--as-runner");
  const asRunner = asRunnerIndex !== -1;
  const taken = new Set([0, cdpIndex, cdpIndex + 1, outIndex, outIndex + 1, asIsIndex, asRunnerIndex]);
  const coveringLocators: FieldLocator[] = [];
  args.forEach((arg, index) => {
    if (arg !== "--covering") return;
    taken.add(index);
    taken.add(index + 1);
    const parsed = parseCoveringLocator(args[index + 1] ?? "");
    if (parsed === null) {
      process.stderr.write(`--covering wants <strategy>=<value>, e.g. name=loginBtn; got "${args[index + 1] ?? ""}".\n`);
      process.exitCode = 2;
      return;
    }
    coveringLocators.push(parsed);
  });
  if (process.exitCode === 2) return;
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
      `and the run record says so.\n` +
      (asIs
        ? `\n--as-is: each page is read in place from YOUR open tab, as it stands. Nothing is\n` +
          `navigated; the tab stays yours and stays open.\n`
        : ``) +
      (asRunner
        ? `\n--as-runner: reads to hosts OFF ${target.allowedHosts.join(", ")} are let through and\n` +
          `recorded, so tags load; every request presents "${RUNNER_PRESENTS.userAgent}"; the tab is\n` +
          `${String(RUNNER_PRESENTS.viewport.width)}×${String(RUNNER_PRESENTS.viewport.height)}. Writes are still refused everywhere.\n`
        : ``) +
      `\n`,
  );

  const session = await PlaywrightAttachedInspection.open({
    runId,
    capability: "read_only",
    allowedHosts: [...target.allowedHosts],
    traceDir: outDir,
    cdpEndpoint: cdp,
    navigableUrlPatterns: urls.map((url) => new RegExp(`^${escapeRegExp(url.split("#")[0] ?? url)}`)),
    ...(asRunner
      ? {
          offHostReads: "allowed" as const,
          presentUserAgent: RUNNER_PRESENTS.userAgent,
          viewport: RUNNER_PRESENTS.viewport,
        }
      : {}),
  });
  const coverings: { url: string; readings: readonly CoveringReading[] }[] = [];

  const observations: PageObservation[] = [];
  const captured: { url: string; file: string; capturedAt: string }[] = [];
  const visited: string[] = [];
  const failed: { url: string; error: string }[] = [];

  try {
    for (const url of urls) {
      await pause(delayMs);
      process.stdout.write(`  → ${url}\n`);
      try {
        if (asIs) {
          await session.adopt(url);
          process.stdout.write(`     read in place, not navigated\n`);
        } else {
          await session.goto(url);
          await session.settle(20_000);
        }
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
        if (coveringLocators.length > 0) {
          const readings = await session.covering(coveringLocators);
          coverings.push({ url: observation.url, readings });
          for (const reading of readings) process.stdout.write(`${coveringInWords(reading)}\n`);
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
        // P127: true when each page was read from the person's own open tab as
        // it stood, with no navigation — so a list another field loaded is a
        // fact of the page as they left it, not of the page as it opens.
        readInPlace: asIs,
        // Method, URL, which rule refused it and why: "Requests refused 1" on
        // the terminal is answerable from the record, without a second run.
        blockedRequests: session.blockedLog.entries.map((entry) => ({
          method: entry.method,
          url: entry.url,
          rule: entry.rule ?? "method",
          reason: entry.reason ?? "",
        })),
        refusedNavigations: session.refusedNavigations,
        // ADR-0128: what the runner's page loaded that no capture ever did,
        // what was presented to get it, and what stands at the named points.
        asRunner,
        presented: asRunner
          ? { userAgent: RUNNER_PRESENTS.userAgent, viewport: RUNNER_PRESENTS.viewport, note: "the User-Agent HEADER was rewritten at the guard; the page's navigator.userAgent is this browser's own" }
          : null,
        offHostReads: session.offHostReads,
        covering: coverings,
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
  if (asRunner) process.stdout.write(`Off-host reads      ${String(session.offHostReads.length)} (allowed and recorded)\n`);
  // P123: how much of the draft's labelling is a read of the row rather than
  // a tie in the markup, and how many rows carry a visible mandatory marker.
  const drafted = blueprint.pages.flatMap((page) => page.sections.flatMap((section) => section.fields));
  process.stdout.write(`Labels from row text ${String(drafted.filter((field) => field.labelSource === "row_text").length)} of ${String(drafted.length)}\n`);
  process.stdout.write(`Marked mandatory     ${String(drafted.filter((field) => field.validations.some((v) => v.kind === "required" && v.source === "observed_marker")).length)}\n`);
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
