/**
 * The time a portal takes to onboard is read from markers, never written
 * (P297).
 *
 * Vahid, 2026-10-12: *"Measure one more thing from now on: the time it takes
 * to onboard a new portal. That is the number that decides whether we are
 * global."* These run the measure on Sheffield's record and on records made
 * wrong on purpose: a check that cannot refuse is not a check.
 *
 * It reads git history, so the checkout must hold it whole (CI fetches it:
 * `fetch-depth: 0`).
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const TSX = join(ROOT, "node_modules", ".bin", "tsx");

function measure(record: string): { readonly status: number | null; readonly out: string } {
  const run = spawnSync(TSX, ["scripts/portal-onboarding-time.ts", record], { cwd: ROOT, encoding: "utf8" });
  return { status: run.status, out: `${run.stdout}${run.stderr}` };
}

function recordOf(stages: readonly object[]): { readonly file: string; readonly done: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "onboarding-"));
  const file = join(dir, "portal.json");
  writeFileSync(file, JSON.stringify({ portal: "a portal made wrong on purpose", target: "targets/sheffield-pgt-2026-09.json", stages }));
  return { file, done: () => rmSync(dir, { recursive: true, force: true }) };
}

const T0 = { stage: "T0", name: "target opened", marker: { commit: "98ae8ef7", what: "x" } };
const T1 = { stage: "T1", name: "first capture", marker: { capture: "docs/captures/sheffield-pgt-2026-09-10/run.json", what: "x" } };
const NOT = (stage: string) => ({ stage, name: stage, missing: ["everything"] });
const AT = (stage: string, commit: string) => ({ stage, name: stage, marker: { commit, what: "x" } });

function refused(stages: readonly object[], said: string): void {
  const record = recordOf(stages);
  try {
    const { status, out } = measure(record.file);
    expect(status, out).toBe(2);
    expect(out).toContain(said);
  } finally {
    record.done();
  }
}

describe("the time to onboard a portal, read from its markers (P297)", () => {
  it("Sheffield: every stage from its marker, T5 not reached, and how long since T1", () => {
    const { status, out } = measure("docs/onboarding/sheffield-pgt.json");
    expect(status, out).toBe(0);
    expect(out).toContain("T0 target opened          2026-09-10T14:09:14Z   2 h 4 m before T1   commit 98ae8ef7");
    expect(out).toContain("T1 first capture          2026-09-10T16:13:23Z   the clock starts");
    expect(out).toContain("partly, 2026-09-16T19:20:54Z   6 d 3 h 7 m after T1   commit 3575eb1e");
    expect(out).toContain("partly, 2026-09-22T17:19:05Z   12 d 1 h 5 m after T1   commit 44a44b3d");
    expect(out).toMatch(/TIME TO ONBOARD \(T5 - T1\) {3}not reached: \d+ d \d+ h \d+ m after T1, at HEAD [0-9a-f]{8}/);
    expect(out).toContain("GLOBAL (T6 - T1)            not reached");
  });

  it("refuses a marker that names a commit this history does not hold", () => {
    const record = recordOf([{ stage: "T0", name: "target", marker: { commit: "0000000000000000000000000000000000000000", what: "x" } }, T1, ...["T2", "T3", "T4", "T5", "T6"].map(NOT)]);
    try {
      const { status, out } = measure(record.file);
      expect(status, out).toBe(2);
      expect(out).toContain("does not exist in this checkout's history");
    } finally {
      record.done();
    }
  });

  it("refuses anchors that are not what they say: a T0 that did not add the target, a T1 that is not its first capture", () => {
    refused([AT("T0", "44a44b3d"), T1, ...["T2", "T3", "T4", "T5", "T6"].map(NOT)], "the marker is not the commit that added targets/sheffield-pgt-2026-09.json");
    refused(
      [T0, { stage: "T1", name: "first capture", marker: { capture: "docs/captures/sheffield-pgt-2026-09-14-education-dependent/run.json", what: "a later capture" } }, ...["T2", "T3", "T4", "T5", "T6"].map(NOT)],
      "the first committed capture of sheffield-pgt-september-direct is docs/captures/sheffield-pgt-2026-09-10/run.json",
    );
  });

  it("refuses a marker that is not a hash in HEAD's history: HEAD itself would move with every commit", () => {
    refused([AT("T0", "HEAD"), T1, ...["T2", "T3", "T4", "T5", "T6"].map(NOT)], '"HEAD" is not a commit hash');
    refused([AT("T0", "--all"), T1, ...["T2", "T3", "T4", "T5", "T6"].map(NOT)], '"--all" is not a commit hash');
  });

  it("refuses a stage reached without the one it rests on, and before it — and allows a live run before a rehearsal", () => {
    refused([T0, T1, NOT("T2"), NOT("T3"), NOT("T4"), NOT("T5"), AT("T6", "4e05911b")], "T6 is reached and T5, which it rests on, is not");
    refused([T0, T1, AT("T2", "44a44b3d"), AT("T3", "3575eb1e"), NOT("T4"), NOT("T5"), NOT("T6")], "T3 (2026-09-16T19:20:54Z) is earlier than T2 (2026-09-22T17:19:05Z), which it rests on");
    // T5 before T4: a portal run live before it is rehearsed. Real commits, in
    // the order the stages rest on one another; nothing here is Sheffield's.
    const record = recordOf([T0, T1, AT("T2", "3575eb1e"), AT("T3", "44a44b3d"), AT("T4", "4e05911b"), AT("T5", "44a44b3d"), NOT("T6")]);
    try {
      const { status, out } = measure(record.file);
      expect(status, out).toBe(0);
      expect(out).toMatch(/TIME TO ONBOARD \(T5 - T1\) {3}12 d 1 h 5 m/);
    } finally {
      record.done();
    }
  });

  it("refuses a stage that is neither reached nor says what is missing, and a record with a stage left out", () => {
    for (const [stages, said] of [
      [[NOT("T0"), T1, { stage: "T2", name: "structure" }, ...["T3", "T4", "T5", "T6"].map(NOT)], "a stage not reached says what is missing"],
      [[NOT("T0"), T1, ...["T2", "T3", "T5", "T6"].map(NOT)], "the stages must be T0, T1, T2, T3, T4, T5, T6"],
    ] as const) {
      const record = recordOf(stages);
      try {
        const { status, out } = measure(record.file);
        expect(status, out).toBe(2);
        expect(out).toContain(said);
      } finally {
        record.done();
      }
    }
  });
});
