/**
 * Every dependency must run on the Node version this repository pins.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Written after CI failed on a commit whose local verification was fully
 * green — 56 files, 1108 tests, lint, typecheck, boundaries, all passing.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── What happened ─────────────────────────────────────────────────────────
 *
 * `jsdom@30` declares `engines.node: "^22.22.2 || ^24.15.0 || >=26.0.0"`.
 * `.nvmrc` pins `22.20.0`, and CI uses it via `setup-node`'s
 * `node-version-file`, so `pnpm install --frozen-lockfile` refused the install
 * with ERR_PNPM_UNSUPPORTED_ENGINE and both jobs died before a single test ran.
 *
 * It passed locally because this development sandbox happens to run Node
 * **22.22.2** — the exact minimum jsdom wanted. `engine-strict` is on, so the
 * check DID run; it simply ran against a version the project does not target.
 *
 * That is the whole failure: a constraint verified against the wrong number.
 * Nothing was skipped, nothing was vacuous, and every local signal was green.
 *
 * ── Why this file rather than "run install in CI" ─────────────────────────
 *
 * CI already catches it — that is how it was found. But it catches it at the
 * install step, which means the feedback arrives after a push, and it catches
 * it only on a machine whose Node differs from the developer's. Checking the
 * ranges against `.nvmrc` DIRECTLY makes the answer independent of whichever
 * Node happens to be running, so it is the same answer everywhere.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

import satisfies from "semver/functions/satisfies.js";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const require = createRequire(join(ROOT, "package.json"));

/** The version this repository targets. CI installs exactly this. */
const PINNED = readFileSync(join(ROOT, ".nvmrc"), "utf8").trim();

interface Manifest {
  readonly name?: string;
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly engines?: { readonly node?: string };
}

function readManifest(path: string): Manifest {
  return JSON.parse(readFileSync(path, "utf8")) as Manifest;
}

/** Every workspace manifest, root included. */
function workspaceManifests(): string[] {
  const workspace = readFileSync(join(ROOT, "pnpm-workspace.yaml"), "utf8");
  const globs = [...workspace.matchAll(/^\s+-\s+["']?([^"'\s]+)["']?\s*$/gm)].map((m) => m[1]);
  const dirs = new Set<string>([ROOT]);
  for (const glob of globs) {
    if (glob === undefined) continue;
    const base = glob.replace(/\/\*+$/, "");
    try {
      const parent = join(ROOT, base);
      if (!existsSync(parent)) continue;
      for (const child of readdirSync(parent)) {
        const candidate = join(parent, child);
        if (existsSync(join(candidate, "package.json"))) dirs.add(candidate);
      }
    } catch {
      // A glob that names no directory is not an error here.
    }
  }
  return [...dirs].map((dir) => join(dir, "package.json"));
}

/** The declared dependencies of every workspace package, deduplicated. */
function declaredDependencies(): string[] {
  const names = new Set<string>();
  for (const path of workspaceManifests()) {
    const manifest = readManifest(path);
    for (const group of [manifest.dependencies, manifest.devDependencies]) {
      for (const name of Object.keys(group ?? {})) {
        // Workspace packages are ours and carry no engines field.
        if ((group ?? {})[name]?.startsWith("workspace:") === true) continue;
        names.add(name);
      }
    }
  }
  return [...names].sort();
}

describe(`every dependency runs on the pinned Node (${PINNED})`, () => {
  it("reads a version out of .nvmrc at all", () => {
    // The control. If `.nvmrc` were empty or renamed, every check below would
    // pass against an empty string and prove nothing.
    expect(PINNED).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("checks a non-trivial number of packages", () => {
    // A second control: a bug in the workspace walk that found nothing would
    // otherwise leave this file green while checking zero packages.
    expect(declaredDependencies().length).toBeGreaterThan(15);
  });

  it("resolves nearly all of them, so skips cannot hide a mass failure", () => {
    // The third control, and the one guarding this file's own weak spot.
    //
    // The per-package check below SKIPS anything it cannot resolve from the
    // root — a package with restricted `exports`, or one hoisted somewhere
    // else. A skip there is reported as a pass, so a change to the workspace
    // layout that made everything unresolvable would leave this file green
    // while checking nothing at all. That is the failure mode this repository
    // keeps finding, so it gets a control rather than a comment.
    const all = declaredDependencies();
    const unresolvable = all.filter((name) => {
      try {
        require(`${name}/package.json`);
        return false;
      } catch {
        return true;
      }
    });
    expect(
      unresolvable.length,
      `Could not resolve ${String(unresolvable.length)} of ${String(all.length)} declared ` +
        `dependencies: ${unresolvable.join(", ")}. Each of those is silently skipped below.`,
    ).toBeLessThan(all.length / 4);
  });

  it.each(declaredDependencies())("%s", (name) => {
    let engines: string | undefined;
    try {
      const manifest = require(`${name}/package.json`) as Manifest;
      engines = manifest.engines?.node;
    } catch {
      // Not resolvable from the root — a package with restricted `exports`,
      // or one only present deeper in the tree. Skipping is safe: pnpm still
      // enforces engines at install time, and this check is a faster mirror of
      // that, not a replacement for it.
      return;
    }
    if (engines === undefined || engines.trim() === "") return;

    expect(
      satisfies(PINNED, engines, { includePrerelease: false }),
      `${name} requires Node "${engines}", which .nvmrc (${PINNED}) does not satisfy. ` +
        `CI installs the .nvmrc version, so this fails \`pnpm install --frozen-lockfile\` ` +
        `there before any test runs — even when every local check is green, because a ` +
        `development machine may happen to run a newer Node. Either pin a compatible ` +
        `version of ${name}, or raise .nvmrc deliberately.`,
    ).toBe(true);
  });
});
