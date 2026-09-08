/**
 * Two lanes: the one that launches browsers, and everything else.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * MEASURED, 2026-09-08, on the four-CPU container this suite runs in.
 *
 *   peak concurrent Chromium processes   21
 *   peak load average                     3.97   (of 4)
 *
 * Vitest schedules test FILES across workers, and each browser file launches a
 * browser that is itself five to eight processes. Three or four landing
 * together saturates the machine, and the symptom is not a crash — it is a
 * page that takes longer than a twenty-second poll to process an input event,
 * on a different test each time. Two full-suite runs in five failed that way,
 * each on a test that passed 4/4 in isolation.
 *
 * `two-origin.test.ts` had already diagnosed the shape and fixed one instance
 * of it by retrying an input. That was right for that test and wrong as a
 * strategy. Vahid, 2026-09-08: *"a suite that goes red for reasons that turn
 * out not to matter teaches everyone to discount red, and the cost lands on
 * the day a real failure arrives and gets waved through. Fix the contention
 * rather than the assertions."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why a lane and not a lower worker count ───────────────────────────────
 *
 * Capping workers globally would slow the 155 seconds of work that has no
 * browser in it, to fix the 87 seconds that does — and it would still let two
 * browser files pair up. A lane serialises exactly the files that contend,
 * and the rest of the suite keeps all its parallelism.
 *
 * The browser lane is not the critical path: its files sum to 87s against the
 * suite's 242s of total work, so it finishes while the other lane is still
 * going.
 *
 * ── The list is checked, not trusted ──────────────────────────────────────
 *
 * `scripts/browser-lane.test.ts` asserts `BROWSER_TEST_FILES` is exactly the
 * set of test files that launch a browser — following one level of first-party
 * imports, because five of them launch through a `Playwright*Session` class
 * rather than calling `chromium.launch` themselves. Both directions: a file
 * that starts launching a browser and is not listed would silently rejoin the
 * contention, and a listed file that no longer launches one would be
 * serialised for nothing.
 */

import { defineWorkspace } from "vitest/config";

import { BROWSER_TEST_FILES } from "./scripts/browser-test-files.js";

const EVERYTHING = [
  "packages/**/src/**/*.test.ts",
  "apps/**/src/**/*.test.ts",
  "apps/**/src/**/*.test.tsx",
  "scripts/**/*.test.ts",
];

export default defineWorkspace([
  {
    extends: "./vitest.config.ts",
    test: {
      name: "unit",
      include: EVERYTHING,
      exclude: ["**/node_modules/**", "**/dist/**", ...BROWSER_TEST_FILES],
    },
  },
  {
    extends: "./vitest.config.ts",
    test: {
      name: "chromium",
      include: [...BROWSER_TEST_FILES],
      // ── The whole point: ONE browser at a time in this lane ───────────
      //
      // `fileParallelism: false` is NOT available here, and the first version
      // of this file set it anyway. Vitest lists it in `NonProjectOptions`
      // alongside `maxWorkers` and `coverage` — it is a root-level setting, so
      // a workspace project that carries it is silently ignored at runtime.
      // Measured before the typecheck caught it: the lane still ran about
      // three files at once and peaked at three browsers, against one for a
      // file run on its own. It looked serialised and was not.
      //
      // A single fork is a per-project setting, and it is what actually made
      // the difference: peak browsers 3 → 1, peak Chromium processes 21 → 7,
      // peak load 5.13 → 3.13.
      pool: "forks",
      poolOptions: { forks: { singleFork: true } },
    },
  },
]);
