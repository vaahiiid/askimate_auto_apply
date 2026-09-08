import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // ── WHICH FILES RUN IS DECIDED BY `vitest.workspace.ts` ───────────────
    //
    // Not here, and this is deliberate rather than an omission. The suite runs
    // in two lanes — one that launches browsers, serialised, and everything
    // else in parallel — and a project that `extends` this file MERGES its
    // include with the one below rather than replacing it.
    //
    // Measured: with an `include` here, the browser lane matched all 113 test
    // files instead of its 17, every file ran in both lanes, and the run went
    // from 2,283 tests to 4,274 with the load average WORSE than before the
    // change. File selection lives in one place because two places produced
    // that.
    //
    // The React secure control's tests need a DOM; that is configured per-file
    // with an `@vitest-environment` docblock rather than globally, because
    // everything else here is a node test and jsdom would only slow it down.
    globals: false,
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts"],
      exclude: ["**/*.test.ts", "**/index.ts"],
    },
  },
});
