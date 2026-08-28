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

  // ── ADR-0004: a ConfirmedValue is minted in ONE place ───────────────────
  //
  // Found by deliberately weakening the guarantee: adding
  //
  //     export function trustTheModel<T>(t: ModelText): ConfirmedValue<T> {
  //       return t as unknown as ConfirmedValue<T>;
  //     }
  //
  // to packages/domain compiled cleanly and failed NO test.
  //
  // The `@ts-expect-error` directives in values.test.ts are real compile-time
  // tests, but they test one thing only: that a DIRECT ASSIGNMENT from
  // ModelText to ConfirmedValue is illegal. A conversion FUNCTION using
  // `as unknown as` leaves that assignment just as illegal, so the directives
  // stay used and the build stays green — while the guarantee is gone.
  //
  // The brand cannot defend itself against a cast; only a rule about where
  // casts may appear can. `applyConfirmation` in packages/profile is the one
  // sanctioned mint, and it exists because a ConfirmedValue means a human read
  // the value back and approved it.
  // Matches `as ConfirmedValue`, `as unknown as ConfirmedValue`, and the
  // qualified forms — `as unknown as Domain.ConfirmedValue`, and
  // `as unknown as import("@askimate/aas-domain").ConfirmedValue`.
  //
  // The qualified forms are not paranoia. The first version of this rule
  // matched only an unqualified name, and a deliberately smuggled
  // `x as unknown as import("@askimate/aas-domain").ConfirmedValue<string>`
  // walked straight past it — a check that a regression can step around is not
  // a check.
  const CONFIRMED_CAST =
    /\bas\s+(?:unknown\s+as\s+)?(?:(?:[A-Za-z_$][\w$]*|import\([^)]*\))\s*\.\s*)*ConfirmedValue\b/;
  const MINT_SITES = ["packages/profile/src/"];

  const sourceFiles: string[] = [];
  const collect = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) collect(full);
      else if (entry.name.endsWith(".ts")) sourceFiles.push(full);
    }
  };
  for (const root of ["packages", "apps"]) collect(root);

  let scanned = 0;
  for (const file of sourceFiles) {
    // Tests may cast freely: they construct fixtures, and `values.test.ts`
    // exists precisely to write illegal things and assert they are rejected.
    if (file.endsWith(".test.ts")) continue;
    if (MINT_SITES.some((site) => file.replace(/\\/g, "/").includes(site))) continue;
    scanned += 1;

    const source = readFileSync(file, "utf8");
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ");
    if (!CONFIRMED_CAST.test(code)) continue;

    violations.push(
      `${file.replace(/\\/g, "/")} casts to ConfirmedValue. A ConfirmedValue means a human read ` +
        `the value back and approved it, and it is minted in exactly one place — ` +
        `applyConfirmation in packages/profile (ADR-0004). A cast anywhere else is a way for ` +
        `model output, or an unreviewed string, to reach a university form field.`,
    );
  }
  checked += scanned;
  console.log(
    `  ✓  ADR-0004 — ${String(scanned)} file(s) outside packages/profile cast to ConfirmedValue: none`,
  );

  // ── Rule 3: a checkpoint holds POSITION, never FACTS ────────────────────
  //
  // `CheckpointValue` admits only primitives, which stops a business fact
  // entering a checkpoint by assignment. It does not stop someone widening the
  // type itself — and the lesson from ADR-0004's amendment is that a brand
  // cannot defend itself against the code that defines it.
  //
  // So this checks the definition. Widening `CheckpointValue` to `unknown`,
  // `object`, `any` or a generic would let a ConfirmedValue, a document or a
  // profile entry into a checkpoint, and the checkpoint would become the
  // second source of truth the architecture forbids.
  const WORKFLOW_SOURCE = "packages/domain/src/workflow.ts";
  if (existsSync(WORKFLOW_SOURCE)) {
    const source = readFileSync(WORKFLOW_SOURCE, "utf8");
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ");

    const definition = /export\s+type\s+CheckpointValue\s*=\s*([^;]+);/.exec(code);
    if (definition === null) {
      violations.push(
        `${WORKFLOW_SOURCE} no longer defines CheckpointValue. It is what stops a business fact ` +
          `entering a checkpoint, and without it a checkpoint becomes a second source of truth ` +
          `(approved architecture, rule 3).`,
      );
    } else {
      const permitted = new Set(["string", "number", "boolean", "null"]);
      const parts = (definition[1] ?? "").split("|").map((part) => part.trim());
      const unexpected = parts.filter((part) => !permitted.has(part));
      if (unexpected.length > 0) {
        violations.push(
          `${WORKFLOW_SOURCE} widens CheckpointValue to include: ${unexpected.join(", ")}. A ` +
            `checkpoint may hold POSITION, never FACTS — only string, number, boolean and null. ` +
            `Anything wider admits a ConfirmedValue, a document or a profile entry, and makes the ` +
            `checkpoint a second competing source of truth for business facts.`,
        );
      }
    }

    // The same file must not reach for the things a checkpoint must not hold.
    for (const forbidden of ["ConfirmedValue", "PreviewDocument", "SecretHandle", "ConfirmedProfile"]) {
      if (!code.includes(forbidden)) continue;
      violations.push(
        `${WORKFLOW_SOURCE} mentions ${forbidden}. The run model must not be able to name a ` +
          `business fact, a document or a secret — naming one is the first step to storing it.`,
      );
    }
    checked += 1;
  }
  console.log(`  ✓  workflow checkpoints — position only, no business facts`);

  // ── `pg` is dev-only in the orchestrator ────────────────────────────────
  //
  // The orchestrator's end-to-end restart test drives the real Postgres
  // adapter, so `pg` is a devDependency there. It must never become a runtime
  // one: the orchestrator talks to storage through the CaseStore and
  // WorkflowRunStore ports, and a direct driver dependency would let someone
  // write a query in the middle of a decision function — which is exactly the
  // purity `assess` and `nextStep` are designed to keep.
  //
  // The rule table above merges dependencies and devDependencies, so this
  // distinction needs its own check.
  const ORCHESTRATOR_MANIFEST = "packages/orchestrator/package.json";
  if (existsSync(ORCHESTRATOR_MANIFEST)) {
    const manifest = readManifest("packages/orchestrator");
    for (const driver of ["pg", "drizzle-orm", "@aws-sdk/client-s3"]) {
      if (manifest?.dependencies?.[driver] === undefined) continue;
      violations.push(
        `packages/orchestrator has \`${driver}\` as a RUNTIME dependency. It reaches storage only ` +
          `through the CaseStore and WorkflowRunStore ports; a direct driver here would let a ` +
          `query be written inside a decision function, which is the purity assess() and ` +
          `nextStep() exist to keep. A devDependency for integration tests is fine.`,
      );
    }
    checked += 1;
  }
  console.log(`  ✓  packages/orchestrator — no runtime database driver`);

  // ── The React secure control must stay UNCONTROLLED ─────────────────────
  //
  // Vahid, 2026-08-27: *"the secret input must remain outside React
  // application state; the React secure control must use an uncontrolled
  // input."*
  //
  // The idiomatic React input is controlled — `useState` plus `value` and
  // `onChange` — and that is precisely what must not happen here, because it
  // puts the password in component state where React DevTools, an error
  // boundary serialising the tree, and any error reporter that snapshots state
  // can all reach it. The plain-DOM prototype does not have that hazard; the
  // move to React introduces it.
  //
  // There are tests for this (`SecureControl.test.tsx` walks the fibre tree
  // for the typed value), but a test can be deleted by the same commit that
  // breaks the rule. This makes it fail the BUILD, where the diff has to
  // explain itself.
  const SECURE_CONTROL = "apps/chat-integration/src/SecureControl.tsx";
  if (existsSync(SECURE_CONTROL)) {
    const raw = readFileSync(SECURE_CONTROL, "utf8");

    // Comments are stripped before matching. The first version of this rule
    // did not do that, and it fired on the doc comment that EXPLAINS the
    // hazard — the block showing `useState` and `value={…}` as the thing to
    // avoid. A rule that rejects correct code is worse than no rule: it
    // teaches whoever hits it to weaken the rule rather than the code.
    const source = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

    if (/\buseState\b/.test(source) || /\buseReducer\b/.test(source)) {
      violations.push(
        `${SECURE_CONTROL} uses React state. The secure control must be UNCONTROLLED: the ` +
          `password lives in the input element and is read through a ref at submit. React state ` +
          `is visible to DevTools, to an error boundary that serialises the tree, and to any ` +
          `error reporter that snapshots component state.`,
      );
    }
    if (/\n\s*(value|defaultValue)=\{/.test(source)) {
      violations.push(
        `${SECURE_CONTROL} sets a \`value\` or \`defaultValue\` prop, which makes the input ` +
          `controlled — the one thing this component may not be.`,
      );
    }

    // Scoped to the PROPS interface, not the whole file. `submit` legitimately
    // takes a `password` in its own parameter type — that function is how the
    // value reaches the endpoint. Matching file-wide flagged that too, which is
    // the same mistake in a different place: a rule has to name the thing it
    // actually forbids, which here is a prop on the component.
    const props = /export interface SecureControlProps \{([\s\S]*?)\n\}/.exec(source);
    if (props === null) {
      violations.push(
        `${SECURE_CONTROL} has no \`SecureControlProps\` interface, so the prop rule below ` +
          `cannot be enforced. If the component was renamed, update this check rather than ` +
          `leaving it silently inert.`,
      );
    } else {
      for (const forbidden of ["password", "secret", "plaintext", "value", "defaultValue"]) {
        // Anchored to TOP-LEVEL props: two spaces of indentation, start of
        // line. The `submit` callback's own parameter type declares a
        // `password` at four spaces, and must — that function is how the value
        // reaches the endpoint. Matching anywhere inside the interface flagged
        // it, which would have made the rule reject the correct component for
        // the third time.
        if (new RegExp(`^  readonly ${forbidden}\\??:`, "m").test(props[1] ?? "")) {
          violations.push(
            `${SECURE_CONTROL} declares a prop \`${forbidden}\`. No prop may carry a secret in ` +
              `either direction — \`onSubmitted\` receives an opaque handle, not a value.`,
          );
        }
      }
    }
    checked += 1;
    console.log(`  ✓  ${SECURE_CONTROL} — uncontrolled, no secret-bearing prop`);
  }

  // ── The five decisions have exactly one implementation ──────────────────
  //
  // Vahid, 2026-08-28: *"Treat it as the single domain authority for
  // conversation decisions… remove duplicated decision logic."*
  //
  // The duplication this replaces was not sloppiness — it was two generations
  // of the same idea, and they had already drifted. The superseded
  // `openSecureRequest` closed the open step on ANY status, because the turn
  // model's status variant had no `requestId` to compare. Two requests in one
  // conversation and a lapsed one released the live one's guard.
  //
  // A comment cannot stop that coming back. This can: outside
  // `packages/conversation`, these names may be IMPORTED but not DEFINED.
  const DECISIONS = [
    "openSecretRequest",
    "composerPolicy",
    "decideRendering",
    "projectTranscript",
    "buildModelRequest",
  ];
  const AUTHORITY = "packages/conversation";
  for (const area of ["apps", "packages"]) {
    if (!existsSync(area)) continue;
    for (const entry of readdirSync(area)) {
      const root = join(area, entry, "src");
      if (!existsSync(root) || join(area, entry) === AUTHORITY) continue;
      for (const file of readdirSync(root)) {
        if (!file.endsWith(".ts") && !file.endsWith(".tsx")) continue;
        if (file.endsWith(".test.ts") || file.endsWith(".test.tsx")) continue;
        const source = readFileSync(join(root, file), "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/^\s*\/\/.*$/gm, "");
        for (const decision of DECISIONS) {
          // `export function X(` or `const X = (` — a definition, not a
          // re-export and not a call.
          const defines = new RegExp(
            `(export\\s+)?function\\s+${decision}\\s*[(<]|` +
              `(const|let|var)\\s+${decision}\\s*(:[^=]+)?=\\s*(\\(|function|async)`,
          );
          if (defines.test(source)) {
            violations.push(
              `${join(root, file)} defines \`${decision}\`. That decision belongs to ` +
                `@askimate/aas-conversation and nowhere else — a second implementation is how ` +
                `the client and the server come to disagree about whether a secure step is open.`,
            );
          }
        }
      }
    }
  }
  checked += 1;
  console.log(`  ✓  ${String(DECISIONS.length)} conversation decision(s) — one implementation each`);

  // ── The contract package stays dependency-free ──────────────────────────
  //
  // `@askimate/aas-contracts` is consumed by two services and two browser
  // bundles, and one of those four is the secure control — the file whose
  // supply chain has to stay inspectable by reading it. A dependency added
  // here is a dependency in all four, arriving without anyone deciding that.
  //
  // It must also hold no behaviour. Deciding what to render, what to send the
  // model, or whether the composer may send belongs to `packages/conversation`
  // (ADR-0039); this package answers only "what may appear on the wire".
  const CONTRACTS = "packages/contracts/package.json";
  if (existsSync(CONTRACTS)) {
    const manifest = JSON.parse(readFileSync(CONTRACTS, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const runtime = Object.keys(manifest.dependencies ?? {});
    if (runtime.length > 0) {
      violations.push(
        `packages/contracts declares runtime dependencies (${runtime.join(", ")}). The wire ` +
          `contract is consumed by both services and both browser bundles, including the secure ` +
          `control. A dependency here is a dependency in all four.`,
      );
    }
    // A test-only dependency is fine; a workspace one is not, because it would
    // let behaviour in through the side door.
    for (const dev of Object.keys(manifest.devDependencies ?? {})) {
      if (dev.startsWith("@askimate/")) {
        violations.push(
          `packages/contracts devDepends on ${dev}. The contract package must not depend on any ` +
            `workspace package, even for tests — that is how behaviour arrives in a package that ` +
            `is meant to describe the wire and nothing else.`,
        );
      }
    }
    checked += 1;
    console.log(`  ✓  packages/contracts — no runtime dependencies, no workspace dependencies`);
  }

  // ── Exactly one password input exists, and it is the uncontrolled one ────
  //
  // Vahid, 2026-08-28: *"Extend the boundary protection to every relevant
  // `.tsx` file under the integration area, not just SecureControl.tsx."*
  //
  // The rule above hardcodes one path, which was right when one path was all
  // there was. Now the client is React: a container, a view, and whatever comes
  // next. The rule it enforces — the password lives in an uncontrolled DOM
  // element and nowhere else — is not a property of that one file. It is a
  // property of the client, and it fails just as completely if a PARENT renders
  // its own `<input type="password">` with a `useState` behind it.
  //
  // So two things are checked across every non-test `.tsx` in the app:
  //
  //   1. Only `SecureControl.tsx` may render `type="password"`. One password
  //      field, in the file whose discipline is enforced.
  //   2. No `useState`/`useReducer` anywhere may BIND a name that suggests it
  //      holds one. A blanket ban on state would be wrong — a chat view needs
  //      state for its turn list — so the rule names what may not be in it.
  const CLIENT_DIR = "apps/chat-integration/src";
  if (existsSync(CLIENT_DIR)) {
    const clientFiles = readdirSync(CLIENT_DIR)
      .filter((name) => name.endsWith(".tsx") && !name.endsWith(".test.tsx"))
      .sort();

    if (clientFiles.length === 0) {
      violations.push(
        `${CLIENT_DIR} contains no .tsx files, so the client rules below are inert. If the React ` +
          `client moved, update this check rather than leaving it silently passing.`,
      );
    }

    let passwordInputs = 0;
    for (const name of clientFiles) {
      const source = readFileSync(join(CLIENT_DIR, name), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");

      if (/type=["']password["']/.test(source)) {
        passwordInputs += 1;
        if (name !== "SecureControl.tsx") {
          violations.push(
            `${CLIENT_DIR}/${name} renders an <input type="password">. Only SecureControl.tsx ` +
              `may — it is the one file whose uncontrolled discipline is enforced above, and a ` +
              `password field anywhere else is a field nothing stops from being controlled.`,
          );
        }
      }

      // `const [password, setPassword] = useState(…)` and its relatives.
      const stateBindings = source.matchAll(
        /const\s*\[\s*([A-Za-z0-9_$]+)[^\]]*\]\s*=\s*(useState|useReducer)\b/g,
      );
      for (const match of stateBindings) {
        const bound = match[1] ?? "";
        if (/pass|secret|plain|credential|pwd/i.test(bound)) {
          violations.push(
            `${CLIENT_DIR}/${name} holds \`${bound}\` in React state via ${match[2] ?? "useState"}. ` +
              `A secret in component state is readable from DevTools, from an error boundary that ` +
              `serialises the tree, and from any reporter that snapshots state.`,
          );
        }
      }
    }

    if (passwordInputs === 0) {
      violations.push(
        `No file in ${CLIENT_DIR} renders an <input type="password">. The rule above counts them ` +
          `to prove it is looking at something; zero means the control was renamed or moved and ` +
          `the check has gone inert.`,
      );
    }

    checked += 1;
    console.log(
      `  ✓  ${CLIENT_DIR}/*.tsx — ${String(clientFiles.length)} file(s), one password input, ` +
        `no secret in React state`,
    );
  }

  console.log(`\nPackages present: ${listExistingPackages().join(", ") || "(none)"}`);

  if (violations.length > 0) {
    console.error("\nDependency boundary violations:\n");
    for (const violation of violations) console.error(`  ✗  ${violation}\n`);
    process.exit(1);
  }

  console.log(`\nBoundary check passed (${checked} package(s) enforced).`);
}

main();
