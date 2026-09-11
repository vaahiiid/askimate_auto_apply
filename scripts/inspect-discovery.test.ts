/**
 * `inspect-discovery` counts refusals by RULE.
 *
 * P81's reading of Sheffield: sixteen refusals, of which one was the portal
 * writing (a POST on its own host) and fifteen were analytics tags reaching
 * off-host. The summary said *"16 state-changing requests were blocked"* —
 * counting a blocked tracker as a write, which overstates what the portal
 * did and buries the one refusal that matters. The rule field has existed on
 * `blockedRequests` since P79; this script ignored it.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");

function runDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "aas-inspect-"));
  writeFileSync(
    join(dir, "run.json"),
    JSON.stringify({
      runId: "r",
      target: { institutionName: "Example", allowedHosts: ["portal.test"] },
      visited: ["https://portal.test/a"],
      failed: [],
      blockedRequests: [
        { method: "GET", url: "https://tags.example/t.js", rule: "host", reason: "off-host" },
        { method: "GET", url: "https://tags.example/u.js", rule: "host", reason: "off-host" },
        { method: "POST", url: "https://portal.test/lookup.do", rule: "method", reason: "a write" },
        { method: "GET", url: "https://portal.test/elsewhere", rule: "navigation", reason: "off the list" },
      ],
    }),
  );
  writeFileSync(
    join(dir, "blueprint.draft.json"),
    JSON.stringify({
      blueprintId: "bp", version: "0.1.0", status: "draft", institutionName: "Example",
      courseName: "MSc", intake: "2027-09", route: "direct_portal",
      authentication: { required: false, accountCreationRequired: false, notes: "" },
      pages: [], handoffPoints: [],
      provenance: { discoveryRunId: "r", discoveredAt: "2026-09-11T00:00:00Z", observedUrls: ["https://portal.test/a"], unobservedClaims: [] },
    }),
  );
  return dir;
}

describe("inspect-discovery, on the refusals", () => {
  it("counts by rule, and calls only a method refusal on the target a write", () => {
    const result = spawnSync(process.execPath, ["--import", "tsx", join(ROOT, "scripts", "inspect-discovery.ts"), runDir()], {
      cwd: ROOT, encoding: "utf8", timeout: 120_000,
    });
    const colour = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
    const out = (result.stdout + result.stderr).replace(colour, "");
    expect(result.status, out).toBe(0);
    expect(out).not.toContain("4 state-changing");
    expect(out).toContain("1 state-changing request");
    expect(out).toContain("2 request(s) went to hosts outside");
    expect(out).toContain("1 navigation");
  });
});
