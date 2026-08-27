/**
 * The versioning mechanism.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-27: *"If the repository uses a monorepo, identify and follow
 * its versioning strategy rather than inventing a second conflicting system.
 * If the current repository does not yet have a proper release/versioning
 * mechanism, stop and establish one first before continuing with significant
 * implementation work."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * There was no strategy to follow. Before this, every one of the eighteen
 * manifests said `0.0.0`, there were no git tags, no changelog and no release
 * tooling — so a strategy had to be chosen, and the choice is written down here
 * and in ADR-0027 rather than left implicit in a script.
 *
 * ── The choice: ONE version, locked across the whole repository ───────────
 *
 * Every package here is `private: true`, is linked by `workspace:*`, is never
 * published to a registry, and ships as one system. Under `workspace:*` the
 * version field plays no part in resolution at all — pnpm links the directory
 * regardless of what the number says.
 *
 * So independent per-package versions (the Changesets model) would buy nothing
 * and cost real accuracy: seventeen numbers nobody consumes, drifting apart,
 * each requiring a judgement about whether a shared change was a MINOR for
 * this package and a PATCH for that one. The failure mode is not "we picked
 * the wrong number" — it is that the numbers stop meaning anything and people
 * stop reading them.
 *
 * One number, applied everywhere, means the version answers a question someone
 * actually asks: *which state of this system am I looking at?*
 *
 * If a package is ever published independently, this decision is reversed by a
 * new ADR and Changesets is the tool to reach for. That is a real possibility
 * and this is not designed to make it hard.
 *
 * ── The authoritative source ─────────────────────────────────────────────
 *
 * The root `package.json`'s `version`. Everything else is derived from it, and
 * `check` fails the build if any manifest has drifted — so the invariant is
 * enforced rather than remembered.
 *
 * ── Usage ────────────────────────────────────────────────────────────────
 *
 *   pnpm run version:check          verify every manifest matches the root
 *   pnpm run version:set 0.2.0      set the version everywhere
 *   pnpm run version:bump minor     compute the next version and set it
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT_MANIFEST = "package.json";

interface Manifest {
  name?: string;
  version?: string;
  [key: string]: unknown;
}

/** Every manifest this repository versions, root first. */
function manifests(): readonly string[] {
  const found: string[] = [ROOT_MANIFEST];
  for (const root of ["packages", "apps"]) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      const path = join(root, entry.name, "package.json");
      if (entry.isDirectory() && existsSync(path)) found.push(path);
    }
  }
  return found;
}

function read(path: string): Manifest {
  return JSON.parse(readFileSync(path, "utf8")) as Manifest;
}

/**
 * Rewrites ONLY the version value, leaving every other byte untouched.
 *
 * ── Why this is a string edit and not JSON.parse → JSON.stringify ─────────
 *
 * The first version of this function round-tripped through `JSON.stringify(m,
 * null, 2)`, and it expanded every compact one-line object in the repository:
 *
 *     -  "exports": { ".": "./src/index.ts" },
 *     +  "exports": {
 *     +    ".": "./src/index.ts"
 *     +  },
 *
 * Eleven manifests grew by ten lines each, so a version bump produced a
 * 250-line diff in which the four characters that actually changed were
 * invisible. That is the exact failure this file's own comment warned about,
 * and it is worse than cosmetic: a reviewer who cannot see the change in the
 * diff does not review it.
 *
 * So the edit is surgical. The file's formatting — compact or expanded, tabs
 * or spaces, whatever a future contributor prefers — survives untouched, and
 * the diff is always one line per manifest.
 */
const VERSION_LINE = /^(\s*"version"\s*:\s*")([^"]*)(")/m;

function writeVersion(path: string, version: string): void {
  const source = readFileSync(path, "utf8");
  if (!VERSION_LINE.test(source)) {
    throw new Error(
      `${path} has no \`version\` field to update. Every manifest in this repository carries the ` +
        `repository version (ADR-0027); add \`"version": "${version}"\` to it.`,
    );
  }
  writeFileSync(path, source.replace(VERSION_LINE, `$1${version}$3`), "utf8");
}

export function rootVersion(): string {
  const version = read(ROOT_MANIFEST).version;
  if (version === undefined) {
    throw new Error(
      "The root package.json has no `version`. It is the authoritative source for this " +
        "repository's version (ADR-0027); without it there is nothing to check against.",
    );
  }
  return version;
}

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/;

export function parseSemver(value: string): {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
} {
  const match = SEMVER.exec(value);
  if (match === null) {
    throw new Error(
      `"${value}" is not a valid SemVer version. Expected MAJOR.MINOR.PATCH, e.g. 0.2.0.`,
    );
  }
  const prerelease = match[4];
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    ...(prerelease === undefined ? {} : { prerelease }),
  };
}

export type Bump = "major" | "minor" | "patch";

export function nextVersion(current: string, bump: Bump): string {
  const { major, minor, patch } = parseSemver(current);
  switch (bump) {
    case "major":
      return `${String(major + 1)}.0.0`;
    case "minor":
      return `${String(major)}.${String(minor + 1)}.0`;
    case "patch":
      return `${String(major)}.${String(minor)}.${String(patch + 1)}`;
  }
}

/** Every manifest whose version does not match the root. */
export function drifted(): readonly { path: string; version: string }[] {
  const expected = rootVersion();
  return manifests()
    .map((path) => ({ path, version: read(path).version ?? "(none)" }))
    .filter((entry) => entry.version !== expected);
}

function setEverywhere(version: string): void {
  parseSemver(version);
  for (const path of manifests()) {
    writeVersion(path, version);
  }
}

// ───────────────────────────────────────────────────────────────────────────

function main(): void {
  const [command, argument] = process.argv.slice(2);

  if (command === "check") {
    const bad = drifted();
    console.log(`Repository version: ${rootVersion()}`);
    if (bad.length > 0) {
      console.error("\nVersion drift — these manifests do not match the root:\n");
      for (const entry of bad) console.error(`  ✗  ${entry.path} — ${entry.version}`);
      console.error(
        `\nThis repository versions every package together (ADR-0027). Run:\n` +
          `  pnpm run version:set ${rootVersion()}\n`,
      );
      process.exit(1);
    }
    console.log(`  ✓  ${String(manifests().length)} manifest(s) in step`);
    return;
  }

  if (command === "set") {
    if (argument === undefined) throw new Error("Usage: version.ts set <MAJOR.MINOR.PATCH>");
    setEverywhere(argument);
    console.log(`Set ${String(manifests().length)} manifest(s) to ${argument}`);
    return;
  }

  if (command === "bump") {
    if (argument !== "major" && argument !== "minor" && argument !== "patch") {
      throw new Error("Usage: version.ts bump <major|minor|patch>");
    }
    const from = rootVersion();
    const to = nextVersion(from, argument);
    setEverywhere(to);
    console.log(`${from} → ${to}  (${argument})`);
    console.log(
      `\nNow: add a CHANGELOG.md entry for ${to}, commit, and tag with:\n` +
        `  git tag -a v${to} -m "v${to}"\n`,
    );
    return;
  }

  console.error(
    "Usage:\n" +
      "  pnpm run version:check          verify every manifest matches the root\n" +
      "  pnpm run version:set <version>  set the version everywhere\n" +
      "  pnpm run version:bump <level>   major | minor | patch\n",
  );
  process.exit(1);
}

// Only when run directly, so the exported helpers stay importable by tests.
if (process.argv[1]?.endsWith("version.ts") === true) main();
