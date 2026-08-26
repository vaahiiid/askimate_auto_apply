/**
 * Runs the end-to-end script for real, as a subprocess.
 *
 * ── Why a subprocess ──────────────────────────────────────────────────────
 *
 * The same lesson as `apps/browser-runner/src/cli.test.ts`. Every unit test in
 * this repository passed while the real discovery entry point failed on its
 * first page, because vitest's transform and `tsx`'s differ in a way that only
 * shows up when the actual entry point runs. A test that imports the modules
 * cannot catch a fault living in the gap between the harness and the entry
 * point.
 *
 * ── What this asserts ─────────────────────────────────────────────────────
 *
 * That the chain completes, that the guards held, and — most importantly —
 * that it stopped. A demonstration that quietly stops demonstrating is worse
 * than no demonstration, and this is the milestone the rest of the work is
 * measured against.
 */

import { spawn } from "node:child_process";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/** Strips ANSI so assertions are about content, not colour. */
function plain(text: string): string {
  // eslint-disable-next-line no-control-regex -- stripping terminal colour codes
  return text.replace(/\[[0-9;]*m/g, "");
}

function runScript(): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("pnpm", ["run", "end-to-end"], {
      cwd: join(import.meta.dirname, ".."),
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("close", (code) => {
      resolve({ code, stdout: plain(stdout), stderr: plain(stderr) });
    });
  });
}

describe("the end-to-end run, executed for real", () => {
  it("completes the chain and stops before submitting", async () => {
    const { code, stdout, stderr } = await runScript();

    expect(stderr).not.toContain("Error");
    expect(code).toBe(0);

    // Discovery saw the portal.
    expect(stdout).toContain("observed 6 fields");
    expect(stdout).toContain("draft blueprint — status draft");

    // The blueprint had to be reviewed before anything used it.
    expect(stdout).toContain("blueprint status now reviewed");

    // The conversation happened, and the ambiguous date was refused first.
    expect(stdout).toContain("Student   02/04/1999");
    expect(stdout).toContain("Could not read a");
    expect(stdout).toContain("Student   2 April 1999");

    // The student saw exactly what would be sent, in words they can check.
    expect(stdout).toContain("This is exactly what will be submitted.");
    expect(stdout).toContain("Date of birth: 02/04/1999");
    expect(stdout).toContain('Nationality: Iran  (sent as "IR")');

    // The form was filled, and the declaration was left for the student.
    expect(stdout).toContain("given_name       Niloofar");
    expect(stdout).toContain("declaration      the student");

    // And it stopped.
    expect(stdout).toContain("Nothing was submitted.");
    expect(stdout).not.toContain("submitted successfully");
  }, 120_000);
});
