// @ts-check
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/dist-tools/**", "**/node_modules/**", "**/*.tsbuildinfo"] },

  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        // allowDefaultProject covers root-level tooling files (vitest.config.ts,
        // scripts/*.ts) that are not part of a package tsconfig.
        projectService: {
          allowDefaultProject: ["*.js"],
          // Root tooling files lint under the same strict settings as real code.
          defaultProject: "tsconfig.tools.json",
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
      // A leading underscore marks an intentionally unused binding — used where
      // a signature is the point (see the fill-boundary guard in values.test.ts).
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/no-unnecessary-condition": "error",
      "no-restricted-syntax": [
        "error",
        {
          // Determinism: correctness here depends on dates (the 31-day
          // financial-evidence window, handoff TTLs, revalidate-by deadlines).
          // A clock read from ambient state cannot be tested. Inject one.
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message:
            "Do not read the ambient clock. Inject a clock (see `stamp({ now })`) so date-dependent behaviour is testable.",
        },
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message:
            "Do not read the ambient clock. Inject a clock so date-dependent behaviour is testable.",
        },
      ],
    },
  },

  {
    // ── The AI SDK boundary (ADR-0004) ────────────────────────────────────
    // Only packages/llm may import a model SDK. Everywhere else, model output
    // has no legitimate way to enter, which is what keeps ModelText confined
    // to the one package that produces it.
    files: ["packages/**/*.ts", "apps/**/*.ts"],
    ignores: ["packages/llm/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "openai", message: "Only packages/llm may import a model SDK (ADR-0004)." },
            { name: "@anthropic-ai/sdk", message: "Only packages/llm may import a model SDK (ADR-0004)." },
            { name: "@aws-sdk/client-bedrock-runtime", message: "Only packages/llm may import a model SDK (ADR-0004)." },
          ],
          patterns: [
            { group: ["openai/*", "@anthropic-ai/*", "@google/generative-ai*"], message: "Only packages/llm may import a model SDK (ADR-0004)." },
          ],
        },
      ],
    },
  },

  {
    // The domain core is pure. No I/O of any kind — that is what makes Phase 1
    // verifiable with no external systems (brief §11).
    files: ["packages/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "node:fs", message: "packages/domain must stay pure — no I/O." },
            { name: "node:net", message: "packages/domain must stay pure — no I/O." },
            { name: "node:http", message: "packages/domain must stay pure — no I/O." },
            { name: "node:https", message: "packages/domain must stay pure — no I/O." },
            { name: "node:child_process", message: "packages/domain must stay pure — no I/O." },
            { name: "pg", message: "packages/domain must stay pure — no database access." },
            { name: "drizzle-orm", message: "packages/domain must stay pure — no database access." },
          ],
        },
      ],
    },
  },

  {
    files: ["**/*.test.ts"],
    rules: {
      // Tests deliberately construct branded values and fixture dates.
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "no-restricted-syntax": "off",
    },
  },

  { files: ["**/*.js"], extends: [tseslint.configs.disableTypeChecked] },
);
