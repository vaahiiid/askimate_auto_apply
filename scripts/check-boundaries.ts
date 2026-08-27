/**
 * Dependency-boundary checks.
 *
 * Two structural rules from the Phase 0 decisions cannot be expressed as lint
 * rules, because they are about the shape of the *dependency graph* rather than
 * the contents of any one file:
 *
 *   1. packages/domain is pure. It depends on nothing.
 *
 *   2. apps/browser-runner has NO access to the case store, the profile, or the
 *      document vault (brief §8: browser automation executes untrusted page
 *      content and must run "with no access to application secrets or the
 *      primary database"). See docs/phase-0/03 §4.
 *
 * Run in CI. If someone adds a forbidden dependency, the build fails rather
 * than a reviewer having to notice.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

interface PackageManifest {
  readonly name?: string;
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
}

interface Rule {
  /** Workspace-relative path of the package the rule applies to. */
  readonly packagePath: string;
  /** Dependency names this package must never have. */
  readonly forbidden: readonly string[];
  readonly rationale: string;
}

const RULES: readonly Rule[] = [
  {
    packagePath: "packages/domain",
    forbidden: ["pg", "drizzle-orm", "@aws-sdk/client-s3", "@aws-sdk/client-sqs", "playwright", "express"],
    rationale:
      "The domain core must stay pure so Phase 1 is fully testable with no external systems (brief §11).",
  },
  {
    packagePath: "packages/profile",
    forbidden: ["openai", "@anthropic-ai/sdk",
      "@anthropic-ai/bedrock-sdk", "@aws-sdk/client-bedrock-runtime", "playwright"],
    rationale:
      "The profile package is the ONLY place a ConfirmedValue is minted (ADR-0004). It must never " +
      "be able to call a model — a value it creates is by definition one a human confirmed.",
  },
  {
    packagePath: "packages/interview",
    forbidden: ["openai", "@anthropic-ai/sdk",
      "@anthropic-ai/bedrock-sdk", "@aws-sdk/client-bedrock-runtime", "playwright", "express"],
    rationale:
      "The interview capability talks to a model only through @askimate/aas-llm (ADR-0004), and " +
      "renders nothing — it is a capability of AskiMate Chat, not an interface (ADR-0015).",
  },
  {
    packagePath: "packages/orchestrator",
    forbidden: [
      "openai",
      "@anthropic-ai/sdk",
      "@anthropic-ai/bedrock-sdk",
      "@aws-sdk/client-bedrock-runtime",
      "playwright",
      "@askimate/aas-browser-runner",
    ],
    rationale:
      "The orchestrator talks to a model only through the port, and to a browser only through " +
      "its own ApplicationSession interface — so packages never depend on apps, and the " +
      "workflow is testable with no browser at all.",
  },
  {
    packagePath: "packages/preparation",
    forbidden: [
      "openai",
      "@anthropic-ai/sdk",
      "@anthropic-ai/bedrock-sdk",
      "@aws-sdk/client-bedrock-runtime",
      "@askimate/aas-llm",
      "playwright",
    ],
    rationale:
      "The preview is what a student authorises, and it is rendered deterministically from the " +
      "fill plan. A model anywhere near it would mean the student approving a summary of their " +
      "application rather than the application.",
  },
  {
    packagePath: "packages/mapping",
    forbidden: [
      "openai",
      "@anthropic-ai/sdk",
      "@anthropic-ai/bedrock-sdk",
      "@aws-sdk/client-bedrock-runtime",
      "@askimate/aas-llm",
      "playwright",
    ],
    rationale:
      "Mapping decides what student data goes in which university form field. It is reviewed " +
      "data, never inference — so it must have no way to ask a model, not even through the port.",
  },
  {
    packagePath: "packages/extraction",
    forbidden: [
      "openai",
      "@anthropic-ai/sdk",
      "@anthropic-ai/bedrock-sdk",
      "@aws-sdk/client-bedrock-runtime",
      "playwright",
      "@askimate/aas-case-store",
    ],
    rationale:
      "Extraction reads documents through @askimate/aas-llm and produces ProposedValues only. " +
      "Its own model SDK would let a reading skip the grounding check that discards invented " +
      "spans; a browser or the case store would make it something other than a reader.",
  },
  {
    packagePath: "packages/requirements",
    forbidden: [
      "openai",
      "@anthropic-ai/sdk",
      "@anthropic-ai/bedrock-sdk",
      "@aws-sdk/client-bedrock-runtime",
      "@askimate/aas-llm",
      "playwright",
    ],
    rationale:
      "A requirement's two channels are a human specialist and the university's own page. A model " +
      "reading a page produces a ProposedValue, not evidence — so the service must have no way to " +
      "ask one, and no way to become a third channel nobody approved (ADR-0009, ADR-0019).",
  },
  {
    packagePath: "packages/account",
    forbidden: [
      "openai",
      "@anthropic-ai/sdk",
      "@anthropic-ai/bedrock-sdk",
      "@aws-sdk/client-bedrock-runtime",
      "playwright",
      "@askimate/aas-llm",
      "imap",
      "imapflow",
      "mailparser",
      "@aws-sdk/client-ses",
      "googleapis",
    ],
    rationale:
      "The account package must have NO capability to read a mailbox — not a disabled one, none. " +
      "Email verification and password recovery reach the student and are theirs to act on " +
      "(ADR-0020). A mail client here would be the mechanism for intercepting them.",
  },
  {
    packagePath: "packages/disclosure",
    forbidden: [
      "openai",
      "@anthropic-ai/sdk",
      "@anthropic-ai/bedrock-sdk",
      "@aws-sdk/client-bedrock-runtime",
      "playwright",
      "@askimate/aas-llm",
    ],
    rationale:
      "Whether a document may be sent to a university is a legal and factual question with a " +
      "recorded answer. A model must have no way to participate in it — not even through the " +
      "port (ADR-0022).",
  },
  {
    packagePath: "packages/documents",
    forbidden: ["openai", "@anthropic-ai/sdk",
      "@anthropic-ai/bedrock-sdk", "@aws-sdk/client-bedrock-runtime"],
    rationale:
      "The validity engine is deterministic date logic and runs BEFORE any AI confidence system " +
      "is involved (brief §2.4). It must not be able to ask a model whether a document is stale.",
  },
  {
    packagePath: "packages/llm",
    forbidden: [
      "@askimate/aas-secrets",
      "@askimate/aas-account",
      "@askimate/aas-profile",
      "@askimate/aas-case-store",
      "playwright",
    ],
    rationale:
      "The model package must have NO route to a student's password. Not a redacted one, not a " +
      "handle it could resolve — none (ADR-0026). @askimate/aas-secrets holds the only plaintext " +
      "in the system and @askimate/aas-account holds EphemeralCredential; a dependency on either " +
      "would put a resolver inside the one package that talks to a language model.",
  },
  {
    packagePath: "packages/secrets",
    forbidden: [
      "openai",
      "@anthropic-ai/sdk",
      "@anthropic-ai/bedrock-sdk",
      "@aws-sdk/client-bedrock-runtime",
      "@askimate/aas-llm",
      "@askimate/aas-profile",
      "@askimate/aas-case-store",
      "playwright",
      "pg",
      "drizzle-orm",
    ],
    rationale:
      "The reverse direction of the same rule, and the more important one. The store holds live " +
      "plaintext; a model SDK here would be a password one prompt away from a provider, a " +
      "database driver would be a way to persist one, and @askimate/aas-profile would be a way " +
      "for a password to become a ConfirmedValue and appear in a submission preview (ADR-0026).",
  },
  {
    packagePath: "apps/chat-integration",
    forbidden: [
      "openai",
      "@anthropic-ai/sdk",
      "@anthropic-ai/bedrock-sdk",
      "@aws-sdk/client-bedrock-runtime",
      "@askimate/aas-llm",
      "@askimate/aas-profile",
      "morgan",
      "pino",
      "pino-http",
      "winston",
      "@sentry/node",
      "@sentry/express",
      "dd-trace",
      "newrelic",
      "@opentelemetry/sdk-node",
      "express-winston",
      "errorhandler",
    ],
    rationale:
      "This app contains the ONE endpoint in AskiMate that receives a plaintext password. Every " +
      "forbidden name here is a request logger, an APM agent or an error reporter — the exact " +
      "class of middleware that serialises a caught error, and body-parser attaches the raw " +
      "request body to a JSON parse error as `err.body` (measured: JSON.stringify(err) emits the " +
      "password in full). A model SDK is forbidden for the same reason as everywhere else.",
  },
  {
    packagePath: "apps/browser-runner",
    forbidden: [
      "@askimate/aas-case-store",
      "@askimate/aas-profile",
      "@askimate/aas-documents",
      "pg",
      "drizzle-orm",
      "@aws-sdk/client-secrets-manager",
    ],
    rationale:
      "Browser automation executes untrusted page content and must have no access to application " +
      "secrets or the primary database (brief §8).",
  },
];

function readManifest(packagePath: string): PackageManifest | null {
  const manifestPath = join(packagePath, "package.json");
  if (!existsSync(manifestPath)) return null;
  return JSON.parse(readFileSync(manifestPath, "utf8")) as PackageManifest;
}

function listExistingPackages(): readonly string[] {
  const roots = ["packages", "apps"];
  const found: string[] = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (entry.isDirectory() && existsSync(join(root, entry.name, "package.json"))) {
        found.push(`${root}/${entry.name}`);
      }
    }
  }
  return found;
}

function main(): void {
  const violations: string[] = [];
  let checked = 0;

  for (const rule of RULES) {
    const manifest = readManifest(rule.packagePath);
    if (manifest === null) {
      // The package does not exist yet (it belongs to a later phase). Rules are
      // declared ahead of time deliberately, so the constraint is in place
      // before the package that must obey it is written.
      console.log(`  ·  ${rule.packagePath} — not yet created, rule staged`);
      continue;
    }

    checked += 1;
    const deps = { ...manifest.dependencies, ...manifest.devDependencies };
    const breached = rule.forbidden.filter((name) => name in deps);

    if (breached.length > 0) {
      violations.push(
        `${rule.packagePath} must not depend on: ${breached.join(", ")}\n    ${rule.rationale}`,
      );
    } else {
      console.log(`  ✓  ${rule.packagePath} — ${rule.forbidden.length} forbidden dependencies absent`);
    }
  }

  // ── Tracing must not exist on the sensitive fill path ──────────────────
  //
  // A source-level check, because the runtime guard in sensitive.ts only fires
  // once someone runs the code. This fails the build.
  //
  // Playwright writes typed values verbatim into trace.trace, and stopping
  // tracing around the fill does not prevent it — the action is buffered and
  // replayed into the next trace file. So the fill session must never contain
  // `tracing.start` or `recordVideo` at all.
  const SENSITIVE_SOURCES = [
    "apps/browser-runner/src/playwright-fill-session.ts",
    "apps/browser-runner/src/sensitive.ts",
  ];
  for (const file of SENSITIVE_SOURCES) {
    const path = file;
    if (!existsSync(path)) continue;
    const source = readFileSync(path, "utf8");
    // Strip comments and string literals so the prose explaining the rule does
    // not trip the rule.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ")
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')
      .replace(/`(?:[^`\\]|\\.)*`/g, "``");

    for (const forbidden of ["tracing.start", "recordVideo"]) {
      if (!code.includes(forbidden)) continue;
      violations.push(
        `${file} contains \`${forbidden}\`. This file handles a student's passport number, date ` +
          `of birth and personal statement, and Playwright writes typed values verbatim into ` +
          `trace.trace. Tracing and video are not available on this path — see ADR-0025.`,
      );
    }
    checked += 1;
  }
  console.log(`  ✓  sensitive fill path — no tracing, no video recording`);

  // ── The model package cannot even NAME the secret store ────────────────
  //
  // The manifest rule above catches a declared dependency. This catches the
  // other route: a deep relative import that reaches across the workspace
  // without ever appearing in a package.json.
  //
  // Checked by reading every source file rather than by trusting the manifest,
  // because `import "../../secrets/src/store.js"` resolves perfectly well and
  // pnpm never hears about it.
  const LLM_FORBIDDEN_IMPORTS = [
    "aas-secrets",
    "secrets/src",
    "aas-account",
    "account/src/credential",
    "EphemeralCredential",
    "InMemorySecretStore",
    "useSecret",
    "getSecret",
  ];
  const llmSources = existsSync("packages/llm/src")
    ? readdirSync("packages/llm/src").filter((name) => name.endsWith(".ts"))
    : [];
  for (const name of llmSources) {
    const source = readFileSync(join("packages/llm/src", name), "utf8");
    for (const forbidden of LLM_FORBIDDEN_IMPORTS) {
      if (!source.includes(forbidden)) continue;
      violations.push(
        `packages/llm/src/${name} mentions \`${forbidden}\`. The model package must have no ` +
          `route to a student's password — no import, no resolver, no named reference it could ` +
          `later call. See ADR-0026.`,
      );
    }
    checked += 1;
  }
  console.log(
    `  ✓  packages/llm — ${String(llmSources.length)} source file(s) name nothing that resolves a secret`,
  );

  // ── There is no getter, in the package or anywhere above it ────────────
  //
  // `useSecret(handle, callback)` is the whole API. A `getSecret` returning a
  // string would put a live password into a caller's scope, and from there into
  // their closures, error objects and stack traces. This fails the build if one
  // ever appears — including in a test, where it would be just as real.
  const secretSources = existsSync("packages/secrets/src")
    ? readdirSync("packages/secrets/src").filter((name) => name.endsWith(".ts"))
    : [];
  for (const name of secretSources) {
    const source = readFileSync(join("packages/secrets/src", name), "utf8");
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ")
      .replace(/"(?:[^"\\]|\\.)*"/g, '""');
    if (/\bgetSecret\b|\bpeekSecret\b|\brevealSecret\b/.test(code)) {
      violations.push(
        `packages/secrets/src/${name} defines a secret getter. There is no getter by design: ` +
          `\`use\` hands the plaintext to a callback and never returns it, so the set of places ` +
          `a password can reach stays countable (ADR-0026).`,
      );
    }
    checked += 1;
  }
  console.log(`  ✓  packages/secrets — no getSecret, in any file`);

  // ── The secure endpoint must not interpolate the body into anything ─────
  //
  // A source-level check on the one file that handles plaintext. The realistic
  // regression is not malice — it is someone adding `console.log("submit for",
  // req.body)` while debugging a confirmation mismatch, and leaving it in.
  //
  // So: no `console.log`/`console.debug`/`console.info` at all in that file
  // (the error handler in app.ts logs a type, and that is the only logging on
  // this path), and no mention of the two identifiers a password lives in.
  const SECRET_ROUTE = "apps/chat-integration/src/secret-routes.ts";
  if (existsSync(SECRET_ROUTE)) {
    const source = readFileSync(SECRET_ROUTE, "utf8");
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ");

    if (/console\.(log|debug|info|warn|error|trace|dir)\s*\(/.test(code)) {
      violations.push(
        `${SECRET_ROUTE} contains a console call. This file holds a student's plaintext password ` +
          `for the length of one request; nothing in it may write to a log. The error handler in ` +
          `app.ts logs an error TYPE, and that is the only logging permitted on this path ` +
          `(ADR-0027).`,
      );
    }
    for (const forbidden of ["JSON.stringify(req", "JSON.stringify(body", "inspect(body", "inspect(req"]) {
      if (!code.includes(forbidden)) continue;
      violations.push(
        `${SECRET_ROUTE} serialises the request body (\`${forbidden}\`). The body carries a ` +
          `plaintext password, and a serialised copy is one assignment away from a log line, an ` +
          `error message or a response (ADR-0027).`,
      );
    }
    checked += 1;
  }
  console.log(`  ✓  the secure endpoint — no console calls, no serialised bodies`);

  console.log(`\nPackages present: ${listExistingPackages().join(", ") || "(none)"}`);

  if (violations.length > 0) {
    console.error("\nDependency boundary violations:\n");
    for (const violation of violations) console.error(`  ✗  ${violation}\n`);
    process.exit(1);
  }

  console.log(`\nBoundary check passed (${checked} package(s) enforced).`);
}

main();
