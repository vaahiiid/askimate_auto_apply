/**
 * End-to-end CLI test.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * The unit tests all passed while the real entry point failed on its first
 * page with "__name is not defined" — esbuild rewrites named functions to
 * reference a helper that exists in Node but not in the browser, and vitest's
 * transform does not inject it while `tsx` does.
 *
 * So a test that imports the modules directly CANNOT catch that class of bug.
 * This one runs the actual CLI as a subprocess, through the actual runner, the
 * way it will really be invoked — which is the only way to catch a fault that
 * lives in the gap between the test harness and the entry point.
 */

import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const PORT = 8123;
let server: Server;
let writesReachingServer = 0;
let targetPath: string;
let runRoot: string;

beforeAll(async () => {
  const form = await readFile(
    join(import.meta.dirname, "..", "fixtures", "application-form.html"),
    "utf8",
  );
  const landing = `<!doctype html><html lang="en"><head><meta charset="utf-8">
    <title>How to apply</title></head><body>
    <a href="/application/start">Start your application</a>
    <a href="/news/latest">Latest news</a></body></html>`;

  server = createServer((req, res) => {
    if (req.method !== "GET") {
      // Reached only if the read-only guard failed.
      writesReachingServer += 1;
      res.writeHead(200).end("{}");
      return;
    }
    const body = (req.url ?? "").startsWith("/application") ? form : landing;
    res.writeHead(200, { "content-type": "text/html" }).end(body);
  });
  await new Promise<void>((resolve) => server.listen(PORT, "127.0.0.1", resolve));

  targetPath = join(tmpdir(), `aas-cli-target-${String(Date.now())}.json`);
  await writeFile(
    targetPath,
    JSON.stringify({
      targetId: "cli-fixture",
      institutionName: "Fixture University",
      courseName: "MSc Fixture",
      intake: "2026-09",
      route: "partner_portal",
      routeNotes: [],
      allowedHosts: ["127.0.0.1"],
      seedUrls: [`http://127.0.0.1:${String(PORT)}/apply`],
      linkPatterns: ["appl(y|ication)"],
      maxPages: 5,
      claimsToVerify: ["Whether an account is required"],
    }),
  );
  // The repo root, not the package. The CLI writes here deliberately: `pnpm
  // run discover` sets the cwd to the package, and output landing wherever
  // pnpm happened to point is one more thing for someone to hunt for.
  runRoot = join(import.meta.dirname, "..", "..", "..", "discovery-runs");
});

afterAll(async () => {
  server.close();
  await rm(targetPath, { force: true });
});

function runCli(): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    const child = spawn("npx", ["tsx", join(import.meta.dirname, "cli.ts"), targetPath], {
      cwd: join(import.meta.dirname, ".."),
      env: process.env,
    });
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.on("close", (code) => resolve({ code: code ?? -1, stdout }));
  });
}

describe("the discovery CLI, run for real", () => {
  it("completes a run and produces a draft blueprint", async () => {
    const { code, stdout } = await runCli();

    // The regression guard: "__name is not defined" made every page fail while
    // the unit tests stayed green.
    expect(stdout).not.toContain("__name is not defined");
    expect(stdout).not.toContain("Pages visited      0");
    expect(code).toBe(0);

    expect(stdout).toContain("READ-ONLY. Cannot fill, click or submit.");
    expect(stdout).toContain("Pages visited      2");
    expect(stdout).toContain("Blueprint status: DRAFT");

    // It followed the in-scope application link and skipped /news.
    expect(stdout).toContain("/application/start");
    expect(stdout).not.toContain("/news/latest");

    // The portal's POST-on-load was blocked and surfaced as a finding.
    // Two: the portal's own POST-on-load, and the reCAPTCHA script the fixture
    // loads from google.com. The second is not incidental — a real portal WILL
    // pull CAPTCHA from a third party, and discovery is scoped to one target's
    // hosts, so refusing it is the allow-list doing its job.
    expect(stdout).toContain("Requests blocked   2");
    expect(stdout).toContain("attempted state-changing requests");
    expect(writesReachingServer).toBe(0);

    // And the artefact is real.
    const runs = (await readdir(runRoot)).filter((name) => name.includes("cli-fixture"));
    expect(runs.length).toBeGreaterThan(0);
    const latest = runs.sort().at(-1);
    if (latest === undefined) throw new Error("no run directory");

    const blueprint = JSON.parse(
      await readFile(join(runRoot, latest, "blueprint.draft.json"), "utf8"),
    ) as { status: string; pages: { sections: { fields: { mapsTo?: string }[] }[] }[]; provenance: { observedUrls: string[] } };

    expect(blueprint.status).toBe("draft");
    expect(blueprint.provenance.observedUrls).toHaveLength(2);
    // Discovery does not guess mappings.
    const fields = blueprint.pages.flatMap((p) => p.sections.flatMap((s) => s.fields));
    expect(fields.length).toBeGreaterThan(0);
    expect(fields.every((f) => f.mapsTo === undefined)).toBe(true);

    await rm(join(runRoot, latest), { recursive: true, force: true });
  }, 120_000);
});

// ───────────────────────────────────────────────────────────────────────────
// The command in the runbook has to work
// ───────────────────────────────────────────────────────────────────────────
//
// The runbook told Vahid to run `pnpm run discover targets/<name>.json`, and
// it did not work: `pnpm run discover` sets the cwd to this package, so a path
// relative to the repo root — which is where the file visibly is — resolved
// against the wrong directory and the run died before it started. Five minutes
// of his time turned into a support round-trip.
//
// These are cheap and they cover every form a person would reasonably type.

describe("resolving what someone typed to a target file", () => {
  const repoRoot = join(import.meta.dirname, "..", "..", "..");
  const cli = join(import.meta.dirname, "cli.ts");

  /** Runs the CLI from THIS package's directory, which is what pnpm does. */
  async function usage(arg?: string): Promise<{ code: number; out: string }> {
    return await new Promise((resolvePromise) => {
      const child = spawn("npx", ["tsx", cli, ...(arg === undefined ? [] : [arg])], {
        cwd: join(import.meta.dirname, ".."),
        // No network, so any target that resolves will fail at navigation —
        // which is fine. What is under test is whether it gets that far.
        env: { ...process.env, AAS_DISCOVERY_DRY_RUN: "1" },
      });
      let out = "";
      child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
      child.stderr.on("data", (chunk: Buffer) => (out += chunk.toString()));
      child.on("close", (code) => resolvePromise({ code: code ?? -1, out }));
    });
  }

  it("lists the targets when given nothing, instead of an unhelpful usage line", async () => {
    const { code, out } = await usage();
    expect(code).toBe(2);
    expect(out).toContain("ulster-birmingham-msc-ib-2026.json");
  });

  it("accepts the path as written in the runbook, relative to the repo root", async () => {
    const { out } = await usage("targets/ulster-birmingham-msc-ib-2026.json");
    // It got past resolution — it printed the target's own details.
    expect(out).toContain("Ulster University");
  }, 60_000);

  it("accepts a bare filename", async () => {
    const { out } = await usage("ulster-birmingham-msc-ib-2026.json");
    expect(out).toContain("Ulster University");
  }, 60_000);

  it("accepts an unambiguous prefix", async () => {
    const { out } = await usage("ulster");
    expect(out).toContain("Ulster University");
  }, 60_000);

  it("refuses a name that matches nothing, and says what does exist", async () => {
    const { code, out } = await usage("oxford");
    expect(code).toBe(2);
    expect(out).toContain('No target found for "oxford"');
    expect(out).toContain("ulster-birmingham-msc-ib-2026.json");
  });

  it("writes its output under the repo root, where the runbook says to look", () => {
    expect(runRoot).toBe(join(repoRoot, "discovery-runs"));
  });
});
