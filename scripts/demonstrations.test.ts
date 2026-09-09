/**
 * Every published demonstration still demonstrates something.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * P37 found `pnpm run walkthrough` printing "REFUSED" through nine consecutive
 * steps and exiting 0, because a demonstration with no expectations cannot be
 * wrong. ADR-0072 gave that script per-step expectations and
 * `walkthrough.test.ts` made them load-bearing.
 *
 * The precedent was never applied to the others. `package.json` publishes
 * twelve commands; five of them — `interview-demo`, `extraction-demo`,
 * `catalogue`, `interventions`, `inspect-discovery` — had no guard of any kind.
 * P51 ran all five: every one behaves correctly TODAY. Nothing keeps them that
 * way, which is the same sentence that was true of the walkthrough the day
 * before it rotted.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Exit code is not the property ─────────────────────────────────────────
 *
 * The walkthrough's defect passed an exit-code check. So these assert what each
 * command exists to SHOW:
 *
 *   extraction-demo   an honest reader accepted AND an inventing one discarded.
 *                     Only-discarded is P37's shape exactly. Only-accepted means
 *                     ADR-0016's grounding guard has stopped working, which is
 *                     far worse and would also exit 0.
 *   interview-demo    the interview both asks and refuses — a run that only
 *                     accepts is not demonstrating a gate.
 *   catalogue         a command needing an argument must REFUSE without one and
 *                     say how, not exit 0 having done nothing.
 *   interventions     the same, for a missing service credential — and it must
 *                     not leak the credential's value while explaining it.
 *
 * `inspect-discovery` is here for its usage contract only: it needs a discovery
 * run directory, and this repository has none that is not a fixture.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = resolve(join(import.meta.dirname, ".."));

/**
 * The ANSI colour codes these scripts print, as a pattern.
 *
 * Built rather than written as a literal because ESC is a control character and
 * `no-control-regex` refuses one inside a regex however it is spelled — as
 * `\u001b` too. Constructing it is the honest way past that: the rule exists to
 * catch control characters nobody meant to match, and this one is the point.
 */
const COLOUR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

interface Run {
  readonly code: number | null;
  readonly out: string;
}

/** Runs a published script the way `pnpm run <name>` does. */
function run(script: string, args: readonly string[] = [], env: NodeJS.ProcessEnv = {}): Run {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", join(ROOT, "scripts", script), ...args],
    {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 180_000,
      env: { ...process.env, ...env },
    },
  );
  // Colour codes make every assertion below unreadable when one fails.
  const plain = `${result.stdout}${result.stderr}`.replace(COLOUR, "");
  return { code: result.status, out: plain };
}

describe("the published demonstrations", () => {
  describe("extraction-demo", () => {
    const demo = run("extraction-demo.ts");

    it("completes", () => {
      expect(demo.code, demo.out).toBe(0);
    });

    it("shows an honest reader being ACCEPTED", () => {
      // The half that would vanish silently if the grounding check started
      // rejecting everything — P37's shape, and the one this file exists for.
      expect(demo.out).toContain("An honest reader");
      expect(demo.out, "no reading was accepted — the demo shows only refusal").toMatch(
        /✓\s+identity\.family_name\s+HOSSEINI/,
      );
      const accepted = (demo.out.match(/quoted from page 1:/g) ?? []).length;
      expect(accepted, "a demonstration of grounded reading with no grounded reading").toBeGreaterThanOrEqual(9);
    });

    it("shows an inventing reader being DISCARDED", () => {
      // The other half, and the more dangerous one to lose: a run where every
      // invented reading is accepted still exits 0, and means ADR-0016's
      // guarantee — an extracted value must quote the document — is gone.
      expect(demo.out).toContain("A reader that invents, at confidence 1.0");
      expect(demo.out, "the inventing reader was not refused").toContain("not in the document");
      expect(demo.out).toMatch(/0 readings accepted, [1-9]\d* discarded/);
    });

    it("says which reader its closing tally counts", () => {
      // ── A defect found by making it ─────────────────────────────────────
      //
      // The last line read "0 readings accepted, 8 discarded" — as the closing
      // line of a three-section demo whose first section accepted nine. On its
      // own, and the last line of a long run IS read on its own, it says the
      // demonstration accepted nothing. I misread it exactly that way while
      // looking for demos that report refusal as success.
      expect(demo.out).toContain("From the inventing reader:");
      expect(demo.out).toMatch(/The honest reader in section 1 had all \d+ accepted/);
    });
  });

  describe("interview-demo", () => {
    const demo = run("interview-demo.ts");

    it("completes", () => {
      expect(demo.code, demo.out).toBe(0);
    });

    it("both asks and refuses, rather than only agreeing", () => {
      // A gate demonstrated only by things passing through it is not
      // demonstrated. Counted rather than named, because the interview's script
      // is allowed to change and the property is that both outcomes occur.
      const accepted = (demo.out.match(/✓/g) ?? []).length;
      const refused = (demo.out.match(/✗/g) ?? []).length;
      expect(accepted, "nothing was accepted").toBeGreaterThan(0);
      expect(refused, "nothing was refused — the demo shows no gate at all").toBeGreaterThan(0);
    });

    it("contacts no portal and submits nothing, and says so", () => {
      // The standing constraint, printed where a person running it sees it.
      expect(demo.out).toContain("Nothing was submitted. No portal was contacted.");
    });
  });

  describe("catalogue", () => {
    const bare = run("catalogue.ts");

    it("REFUSES with no argument, and says how to call it", () => {
      // Exiting 0 having done nothing is the failure this file is about. A
      // command that needs an argument must say so and fail.
      expect(bare.code, "a command with no argument exited as though it worked").not.toBe(0);
      expect(bare.out).toContain("Usage:");
      expect(bare.out).toContain("hash");
      expect(bare.out).toContain("check");
    });
  });

  describe("interventions", () => {
    const bare = run("interventions.ts", [], { AAS_SERVICE_CERT: "" });

    it("REFUSES without the service credential, and explains which one", () => {
      expect(bare.code).not.toBe(0);
      expect(bare.out).toContain("AAS_SERVICE_CERT");
      expect(bare.out, "the reason must name the boundary it protects").toContain("ADR-0048");
    });

    it("does not print a credential while explaining that one is missing", () => {
      // A message about a secret is a place secrets get printed. The value is
      // set here so that echoing it would be visible.
      const withValue = run("interventions.ts", [], {
        AAS_SERVICE_CERT: "",
        AAS_CONVERSATION_URL: "http://127.0.0.1:4000",
      });
      expect(withValue.out).not.toContain("BEGIN CERTIFICATE");
    });
  });

  describe("inspect-discovery", () => {
    const bare = run("inspect-discovery.ts");

    it("REFUSES without a discovery run directory, and says what it wants", () => {
      expect(bare.code).not.toBe(0);
      expect(bare.out).toContain("Usage:");
      expect(bare.out).toContain("blueprint.draft.json");
    });
  });

  it("guards every published command that can run unattended", () => {
    // ── The list cannot go stale in the direction that matters ───────────
    //
    // A command added to `package.json` and not guarded here is the state all
    // five of these were in. `discover` and `inspect` are excluded by name:
    // both drive a real browser at a real portal, which this repository has
    // never had and which is blocker 1.
    const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };

    const NEEDS_A_REAL_PORTAL = ["discover", "inspect"];
    const INFRASTRUCTURE = [
      "preinstall", "typecheck", "lint", "test", "test:watch", "verify", "verify:integration",
      "clean", "census", "boundaries", "reachability", "version:check", "version:set",
      "version:bump",
    ];

    const published = Object.keys(manifest.scripts)
      .filter((name) => !name.startsWith("start:") && !name.startsWith("migrate:"))
      .filter((name) => !INFRASTRUCTURE.includes(name))
      .filter((name) => !NEEDS_A_REAL_PORTAL.includes(name));

    // Guarded here, or by a file of its own that predates this one.
    const GUARDED_ELSEWHERE = [
      "walkthrough", "end-to-end", "retention-status", "analyse-journey", "verify-bedrock",
      // P59 — `verify-s3-checksum.test.ts` checks the judgement offline and the
      // no-bucket path (NOT CHECKED, exit 1, no record written).
      "verify-s3-checksum",
    ];
    const GUARDED_HERE = [
      "extraction-demo", "interview-demo", "catalogue", "interventions", "inspect-discovery",
    ];

    const unguarded = published.filter(
      (name) => !GUARDED_ELSEWHERE.includes(name) && !GUARDED_HERE.includes(name),
    );
    expect(
      unguarded,
      "these commands are published and nothing checks they still work",
    ).toEqual([]);
  });
});
