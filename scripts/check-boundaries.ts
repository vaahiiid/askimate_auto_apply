/**
 * Dependency-boundary checks.
 *
 * Two structural rules from the Phase 0 decisions cannot be expressed as lint
 * rules, because they are about the shape of the *dependency graph* rather than
 * the contents of any one file:
 *
 *   1. packages/domain is pure. It depends on nothing.
 *
 *   2. apps/browser-runner has NO access to the case store, the profile, or the
 *      document vault (brief §8: browser automation executes untrusted page
 *      content and must run "with no access to application secrets or the
 *      primary database"). See docs/phase-0/03 §4.
 *
 * Run in CI. If someone adds a forbidden dependency, the build fails rather
 * than a reviewer having to notice.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

interface PackageManifest {
  readonly name?: string;
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
}

interface Rule {
  /** Workspace-relative path of the package the rule applies to. */
  readonly packagePath: string;
  /** Dependency names this package must never have. */
  readonly forbidden: readonly string[];
  readonly rationale: string;
}

const RULES: readonly Rule[] = [
  {
    packagePath: "packages/domain",
    forbidden: ["pg", "drizzle-orm", "@aws-sdk/client-s3", "@aws-sdk/client-sqs", "playwright", "express"],
    rationale:
      "The domain core must stay pure so Phase 1 is fully testable with no external systems (brief §11).",
  },
  {
    packagePath: "apps/browser-runner",
    forbidden: [
      "@askimate/aas-case-store",
      "@askimate/aas-profile",
      "@askimate/aas-documents",
      "pg",
      "drizzle-orm",
      "@aws-sdk/client-secrets-manager",
    ],
    rationale:
      "Browser automation executes untrusted page content and must have no access to application " +
      "secrets or the primary database (brief §8).",
  },
];

function readManifest(packagePath: string): PackageManifest | null {
  const manifestPath = join(packagePath, "package.json");
  if (!existsSync(manifestPath)) return null;
  return JSON.parse(readFileSync(manifestPath, "utf8")) as PackageManifest;
}

function listExistingPackages(): readonly string[] {
  const roots = ["packages", "apps"];
  const found: string[] = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (entry.isDirectory() && existsSync(join(root, entry.name, "package.json"))) {
        found.push(`${root}/${entry.name}`);
      }
    }
  }
  return found;
}

function main(): void {
  const violations: string[] = [];
  let checked = 0;

  for (const rule of RULES) {
    const manifest = readManifest(rule.packagePath);
    if (manifest === null) {
      // The package does not exist yet (it belongs to a later phase). Rules are
      // declared ahead of time deliberately, so the constraint is in place
      // before the package that must obey it is written.
      console.log(`  ·  ${rule.packagePath} — not yet created, rule staged`);
      continue;
    }

    checked += 1;
    const deps = { ...manifest.dependencies, ...manifest.devDependencies };
    const breached = rule.forbidden.filter((name) => name in deps);

    if (breached.length > 0) {
      violations.push(
        `${rule.packagePath} must not depend on: ${breached.join(", ")}\n    ${rule.rationale}`,
      );
    } else {
      console.log(`  ✓  ${rule.packagePath} — ${rule.forbidden.length} forbidden dependencies absent`);
    }
  }

  console.log(`\nPackages present: ${listExistingPackages().join(", ") || "(none)"}`);

  if (violations.length > 0) {
    console.error("\nDependency boundary violations:\n");
    for (const violation of violations) console.error(`  ✗  ${violation}\n`);
    process.exit(1);
  }

  console.log(`\nBoundary check passed (${checked} package(s) enforced).`);
}

main();
