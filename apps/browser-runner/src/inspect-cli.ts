/**
 * Controlled inspection of a Salesforce Experience Cloud portal.
 *
 *   pnpm run inspect <target> [url ...]
 *
 * Renders the portal's real interface — which read-only discovery structurally
 * cannot do (Phase 3 report §C) — and captures it, while the inspection guard
 * refuses everything that is not a rendering call.
 *
 * It creates nothing, signs in to nothing, types nothing and clicks nothing.
 * There is no method on the session to do any of those.
 *
 * The safety properties are proven in `inspection.test.ts` against a hostile
 * fixture that attempts application creation, data persistence, submission,
 * file upload, self-navigation to a consequential endpoint, non-cacheable Apex
 * and PUT/PATCH/DELETE — all on page load, all blocked, asserted on what
 * reached the server rather than on what the guard returned.
 */

import { existsSync, readdirSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { PlaywrightInspectionSession } from "./playwright-inspection-session.js";
import { parseTarget } from "./target.js";
import type { PageObservation } from "./session.js";
import type { LwcObservation } from "./lwc-observe-script.js";

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

async function main(): Promise<void> {
  const root = repoRoot();
  const typed = process.argv[2];

  if (typed === undefined) {
    process.stderr.write(
      `Usage: pnpm run inspect <target> [url ...]\n\n` +
        `Targets:\n` +
        listTargets(root)
          .map((name) => `  ${name}\n`)
          .join("") +
        `\nWith no URLs, the target's inspectUrls are used.\n`,
    );
    process.exitCode = 2;
    return;
  }

  const targetPath = resolveTargetPath(typed, root);
  if (targetPath === null) {
    process.stderr.write(`No target found for "${typed}".\n`);
    process.exitCode = 2;
    return;
  }

  const raw = JSON.parse(await readFile(targetPath, "utf8")) as Record<string, unknown>;
  const target = parseTarget(raw);

  const configured = raw["inspectUrls"];
  const urls =
    process.argv.length > 3
      ? process.argv.slice(3)
      : Array.isArray(configured)
        ? configured.filter((entry): entry is string => typeof entry === "string")
        : [];

  if (urls.length === 0) {
    process.stderr.write(
      `No URLs to inspect. Add "inspectUrls" to ${targetPath}, or pass them on the command line.\n` +
        `Inspection is deliberately not a crawl: it looks at a named handful of pages.\n`,
    );
    process.exitCode = 2;
    return;
  }

  // eslint-disable-next-line no-restricted-syntax -- run boundary
  const startedAt = new Date();
  const runId = `insp-${target.targetId}-${startedAt.toISOString().replace(/[:.]/g, "-")}`;
  const outDir = resolve(root, "inspection-runs", runId);
  await mkdir(resolve(outDir, "pages"), { recursive: true });

  // Navigation is allow-listed to exactly the URLs asked for, plus their own
  // origin's login/registration area — a Lightning page legitimately moves
  // between /s/login/* routes as it renders. Nothing wider.
  const origins = [...new Set(urls.map((url) => new URL(url).origin))];
  const navigable = [
    ...urls.map((url) => new RegExp(`^${escapeRegExp(url.split("#")[0] ?? url)}`)),
    ...origins.map((origin) => new RegExp(`^${escapeRegExp(origin)}/s/login`)),
  ];

  process.stdout.write(
    `\nInspection — ${target.institutionName}` +
      `${target.campus === undefined ? "" : ` (${target.campus})`}\n` +
      `${target.courseName}, ${target.intake}\n\n` +
      `RENDERING MODE. The portal's own component traffic is permitted.\n` +
      `Everything else is refused: no create, save, submit, upload, payment,\n` +
      `declaration, registration, authentication, or navigation off this list.\n` +
      `There is no fill, click or submit capability on this session.\n\n`,
  );

  const session = await PlaywrightInspectionSession.open({
    runId,
    capability: "read_only",
    allowedHosts: target.allowedHosts,
    traceDir: outDir,
    navigableUrlPatterns: navigable,
  });

  const observations: PageObservation[] = [];
  const lwcObservations: { url: string; observation: LwcObservation }[] = [];
  const captured: { url: string; file: string }[] = [];
  const failed: { url: string; error: string }[] = [];

  try {
    for (const [index, url] of urls.entries()) {
      process.stdout.write(`  → ${url}\n`);
      try {
        await session.goto(url);
        // Lightning is empty at domcontentloaded and fills in over several
        // round trips. Capture as soon as it settles: a portal that redirects
        // itself will otherwise blank the DOM before we read it.
        await session.settle(20_000);

        const file = `pages/${String(index + 1).padStart(3, "0")}.html`;
        await writeFile(resolve(outDir, file), await session.html());
        captured.push({ url, file });

        const observation = await session.observe();
        observations.push(observation);

        // The one that can read a Lightning interface. `observe()` is kept
        // because plain-HTML portals still exist, but on LWC it reports zero
        // fields for a fully rendered page — see lwc-observe-script.ts.
        const lwc = await session.observeLwc();
        lwcObservations.push({ url, observation: lwc });

        await session.screenshot(`page-${String(index + 1)}`);

        const required = lwc.controls.filter((control) => control.required).length;
        process.stdout.write(
          `     ${String(lwc.controls.length)} control(s) (${String(required)} required), ` +
            `${String(lwc.buttons.length)} button(s), ${String(lwc.links.length)} link(s)\n`,
        );
        for (const control of lwc.controls) {
          process.stdout.write(
            `       ${control.kind.padEnd(15)} ${control.required ? "*" : " "} ` +
              `${control.label || "(no label)"}\n`,
          );
        }
        for (const limitation of lwc.limitations) {
          process.stdout.write(`       note: ${limitation}\n`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failed.push({ url, error: message });
        process.stdout.write(`     ✗ ${message.split("\n")[0] ?? ""}\n`);
      }
    }

    await writeFile(
      resolve(outDir, "pages", "index.json"),
      JSON.stringify({ runId, capturedAt: startedAt.toISOString(), pages: captured }, null, 2) +
        "\n",
    );

    await writeFile(
      resolve(outDir, "inspection.json"),
      JSON.stringify(
        {
          runId,
          mode: "controlled_render",
          target: { targetId: target.targetId, allowedHosts: target.allowedHosts },
          urls,
          captured,
          failed,
          observations,
          lwcObservations,
          permittedActions: session.permittedActions,
          refusedActions: session.refusedActions,
          refusedNavigations: session.refusedNavigations,
          blockedRequests: session.blockedRequests(),
        },
        null,
        2,
      ) + "\n",
    );

    // ── What the guard did, which is part of the finding ────────────────
    process.stdout.write(`\nPages captured    ${String(captured.length)} of ${String(urls.length)}\n`);
    process.stdout.write(`Actions permitted ${String(session.permittedActions.length)}\n`);
    process.stdout.write(`Action batches refused ${String(session.refusedActions.length)}\n`);
    process.stdout.write(`Navigations refused    ${String(session.refusedNavigations.length)}\n`);
    process.stdout.write(`Requests blocked       ${String(session.blockedLog.count)}\n`);

    if (session.refusedActions.length > 0) {
      process.stdout.write(
        `\nSome component traffic was refused, so a page may have rendered incompletely.\n` +
          `That is deliberate, and it is a finding rather than a fault — a specialist\n` +
          `decides whether a specific refused action is safe to permit:\n\n`,
      );
      const seen = new Set<string>();
      for (const refusal of session.refusedActions) {
        for (const verdict of refusal.verdicts) {
          if (verdict.allowed || seen.has(verdict.descriptor)) continue;
          seen.add(verdict.descriptor);
          process.stdout.write(`  ${verdict.descriptor}\n    ${verdict.reason}\n`);
        }
      }
    }

    process.stdout.write(`\nOutput: ${outDir}\n`);
    process.stdout.write(`Nothing was created, signed into, filled, uploaded or submitted.\n`);
  } finally {
    await session.close();
  }

  if (captured.length === 0) process.exitCode = 1;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

await main();
