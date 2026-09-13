/**
 * The runner's own contexts, under the launcher the runbook uses (P121).
 *
 * P80 found that `tsx` (esbuild) rewrites a function passed to `page.evaluate`
 * to call a `__name` helper the page does not have, and shimmed it in the
 * three session classes. The account-creation and sign-in paths open their
 * contexts through `openSensitiveContext` instead, which had no shim — so the
 * runner PROCESS threw `__name is not defined` on its first `detectChallenge`
 * and reported the account creation UNCERTAIN, while every in-process test
 * (vitest's transform injects no helper) stayed green. Found by the journey
 * through the five real processes, `scripts/local-stack-journey.test.ts`.
 *
 * Proved the way P80 proved it: through the real launcher, not vitest's.
 */

import { spawn } from "node:child_process";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function runProbe(): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn("npx", ["tsx", join(import.meta.dirname, "sensitive-tsx-probe.ts")], {
      cwd: join(import.meta.dirname, ".."),
      env: process.env,
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.on("close", (code) => resolve({ code: code ?? -1, output }));
  });
}

describe("a sensitive context, under tsx", () => {
  it("can read a page for a challenge without the esbuild helper being missing", async () => {
    const { code, output } = await runProbe();
    expect(output, output).not.toContain("__name is not defined");
    expect(output).toContain('{"challenge":null}');
    expect(code).toBe(0);
  }, 120_000);
});
