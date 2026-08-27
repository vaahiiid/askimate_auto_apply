import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "packages/**/src/**/*.test.ts",
      "apps/**/src/**/*.test.ts",
      // The React secure control. Its tests need a DOM, which is configured
      // per-file via the `@vitest-environment` docblock rather than globally —
      // everything else in this repository is a node test and jsdom would only
      // slow it down.
      "apps/**/src/**/*.test.tsx",
      // The end-to-end script's own test, which runs it as a subprocess.
      "scripts/**/*.test.ts",
    ],
    globals: false,
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts"],
      exclude: ["**/*.test.ts", "**/index.ts"],
    },
  },
});
