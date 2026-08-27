/**
 * The versioning mechanism's own tests.
 *
 * A version tool that gets SemVer arithmetic wrong is worse than no tool: it
 * produces confident, wrong numbers that then go into tags and changelogs and
 * are awkward to withdraw.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { drifted, nextVersion, parseSemver, rootVersion } from "./version.js";

describe("SemVer arithmetic", () => {
  it("bumps PATCH for a fix", () => {
    expect(nextVersion("0.1.0", "patch")).toBe("0.1.1");
    expect(nextVersion("1.4.9", "patch")).toBe("1.4.10");
  });

  it("bumps MINOR for a feature, and RESETS patch", () => {
    // The reset is the part people get wrong by hand.
    expect(nextVersion("0.1.7", "minor")).toBe("0.2.0");
    expect(nextVersion("2.0.0", "minor")).toBe("2.1.0");
  });

  it("bumps MAJOR for a breaking change, and resets both", () => {
    expect(nextVersion("0.9.3", "major")).toBe("1.0.0");
    expect(nextVersion("1.2.3", "major")).toBe("2.0.0");
  });

  it("refuses anything that is not SemVer", () => {
    // A version tool that accepted "v1.0" or "1.0" would put it in a tag.
    for (const bad of ["1.0", "v1.0.0", "1.0.0.0", "", "latest", "01.0.0"]) {
      expect(() => parseSemver(bad), bad).toThrow("not a valid SemVer version");
    }
  });

  it("accepts a prerelease suffix", () => {
    expect(parseSemver("1.0.0-rc.1").prerelease).toBe("rc.1");
  });
});

describe("the repository's own version", () => {
  it("is valid SemVer", () => {
    expect(() => parseSemver(rootVersion())).not.toThrow();
  });

  it("is the SAME in every manifest", () => {
    // The invariant ADR-0027 exists to hold. This runs in `pnpm run verify`,
    // so a manifest that drifts fails the build rather than being noticed at
    // release time — which is when nobody wants to find it.
    expect(drifted()).toEqual([]);
  });
});

describe("the version edit touches nothing but the version", () => {
  it("leaves compact one-line objects compact", () => {
    // ── The regression this pins ──────────────────────────────────────────
    //
    // The first implementation round-tripped each manifest through
    // `JSON.stringify(m, null, 2)`, which expanded every compact object in the
    // repository:
    //
    //     -  "exports": { ".": "./src/index.ts" },
    //     +  "exports": {
    //     +    ".": "./src/index.ts"
    //     +  },
    //
    // Eleven manifests grew by ten lines each, so a version bump produced a
    // 250-line diff in which the four characters that actually changed were
    // invisible. A reviewer who cannot see the change does not review it.
    //
    // Several manifests still use the compact style. If the edit ever starts
    // reformatting again, this fails.
    const compact = readFileSync("packages/blueprint/package.json", "utf8");
    expect(compact).toContain('"exports": { ".": "./src/index.ts" }');
    expect(compact).toContain('"devDependencies": { "vitest": "^2.1.8" }');
  });

  it("still carries the repository version in that same file", () => {
    // So the test above cannot pass by the file having been left alone.
    const compact = readFileSync("packages/blueprint/package.json", "utf8");
    expect(compact).toContain(`"version": "${rootVersion()}"`);
  });
});
