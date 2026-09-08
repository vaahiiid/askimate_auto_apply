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
  /**
   * Names forbidden as a PRODUCTION dependency but permitted as a dev one.
   *
   * Used for exactly one thing: `playwright` in `apps/secure-service`. That
   * service's tests drive a real browser and legitimately need it; the shipped
   * service must not carry a browser automation library in its dependency tree,
   * because it is the process that receives the password and every package in
   * its tree is a supply-chain path to that process (ADR-0042).
   */
  readonly forbiddenInProduction?: readonly string[];
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
    packagePath: "packages/notify",
    forbidden: [
      // ── What a notice may not be able to reach ────────────────────────
      //
      // A `SpecialistNotice` leaves the system, to a URL an operator
      // configures and this repository does not control (ADR-0071). Its shape
      // is the primary control — `noticeFor` reads named fields and there is
      // nowhere for a value to land — and this is the second: the package
      // cannot reach a profile, a plan, a preview, a secret or a database, so
      // a future field cannot be sourced from one by a well-meaning edit.
      //
      // `@askimate/aas-case-store` IS permitted, and is the only store here:
      // `StoredIntervention` is the input, and reading it is the whole job.
      "@askimate/aas-profile",
      "@askimate/aas-preparation",
      "@askimate/aas-mapping",
      "@askimate/aas-secrets",
      "@askimate/aas-documents",
      "@askimate/aas-llm",
      "openai",
      "@anthropic-ai/sdk",
      "@anthropic-ai/bedrock-sdk",
      "@aws-sdk/client-bedrock-runtime",
      "pg",
      "drizzle-orm",
      "playwright",
      "express",
    ],
    rationale:
      "packages/notify composes the one payload in this system that is sent to a third party by " +
      "design. It must not be able to reach a student's profile, a fill plan, a preview, a secret " +
      "or a database — a notice says that something needs a person, and everything else a " +
      "specialist needs lives behind the internal route they authenticate to.",
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
    packagePath: "apps/secure-service",
    forbidden: [
      "openai",
      "@anthropic-ai/sdk",
      "@anthropic-ai/bedrock-sdk",
      "@aws-sdk/client-bedrock-runtime",
      "@askimate/aas-llm",
      "morgan",
      "pino",
      "pino-http",
      "winston",
      "express-winston",
      "@sentry/node",
      "@sentry/express",
      "dd-trace",
      "newrelic",
      "@opentelemetry/sdk-node",
      "errorhandler",
      "body-parser-xml",
      "connect-logger",
      // ── ADR-0052 §13.0, the binding rule on this service's background loops
      //
      // "The Secure Service may run only loops over its OWN tables that publish
      //  outward. It may never poll another plane's state, and it may never
      //  acquire a second plane's credentials."
      //
      // P14 gave this service two in-process loops (`background.ts`), which is
      // what makes this rule necessary rather than obvious: a third loop that
      // wanted a run's status would reach for the conversation plane's stores,
      // and then this process would hold both planes' credentials — the exact
      // thing option C was chosen to avoid.
      "@askimate/aas-case-store",
      "@askimate/aas-orchestrator",
    ],
    // `@askimate/aas-conversation-service` is a PRODUCTION forbidden name, not
    // an absolute one: `lifecycle.test.ts` builds a real conversation app in a
    // second database, which is the only way to prove the push crosses two
    // planes rather than two objects in one process. A production dependency
    // would be the thing §13.0 forbids; a test dependency is what proves the
    // separation is real.
    forbiddenInProduction: ["playwright", "@askimate/aas-conversation-service"],
    rationale:
      "This service contains THE ONE ENDPOINT IN ASKIMATE THAT RECEIVES A PASSWORD. Every " +
      "forbidden name is a request logger, an APM agent or an error reporter — the class of " +
      "middleware that serialises a caught error, and body-parser attaches the raw request body " +
      "to a JSON parse error as `err.body`. @askimate/aas-secure-logging exists precisely because " +
      "a logger that accepts an arbitrary object is not sufficient here. Playwright is a " +
      "production forbidden name for a different reason: ADR-0042 put browser automation in the " +
      "fill agent so this service would not have to grow it. The three @askimate names are " +
      "ADR-0052 §13.0: this service runs background loops now, and they may only read its own " +
      "tables — a loop that polled the conversation plane would put both databases' credentials " +
      "in one process.",
  },
  {
    packagePath: "apps/secure-filler",
    forbidden: [
      "openai",
      "@anthropic-ai/sdk",
      "@anthropic-ai/bedrock-sdk",
      "@aws-sdk/client-bedrock-runtime",
      "@askimate/aas-llm",
      "@askimate/aas-profile",
      "@askimate/aas-case-store",
      "@askimate/aas-documents",
      "pg",
      "drizzle-orm",
      "morgan",
      "pino",
      "pino-http",
      "winston",
      "express-winston",
      "@sentry/node",
      "@sentry/express",
      "dd-trace",
      "newrelic",
      "@opentelemetry/sdk-node",
      "errorhandler",
      "body-parser-xml",
      "connect-logger",
    ],
    rationale:
      "The fill agent is a Secure Plane process: it holds a KMS grant, reads the vault's cache, " +
      "and holds a plaintext password for one stack frame per request (ADR-0042). Every logging " +
      "and APM name forbidden in the secure service is forbidden here for the same reason. It " +
      "additionally has no database and no case store: it settles a lifecycle by ASKING the " +
      "secure service, so a driver here would be a way to write to a plane it does not own.",
  },
  {
    packagePath: "apps/conversation-service",
    // `playwright` is production-forbidden rather than forbidden outright, for
    // the reason it is on `secure-service`: since ADR-0060 this app serves the
    // student's page, and `student-client.test.ts` drives it in a real
    // browser. The SHIPPED service must still not carry a browser automation
    // library — every package in its tree is a supply-chain path to the
    // process that holds the conversation database.
    forbiddenInProduction: ["playwright"],
    forbidden: [
      "@askimate/aas-secrets",
      "@aws-sdk/client-kms",
      "morgan",
      "pino",
      "pino-http",
      "winston",
      "express-winston",
      "@sentry/node",
      "@sentry/express",
      "dd-trace",
      "newrelic",
      "@opentelemetry/sdk-node",
      "errorhandler",
    ],
    rationale:
      "P1 gave this service the application domain — the orchestrator, the case store, the " +
      "interview — and with it a TRANSITIVE path to @askimate/aas-secrets. A DIRECT dependency " +
      "would be a resolver in the plane ADR-0037 keeps free of them: the conversation plane " +
      "learns which request a secure step was, what lifecycle it reached and an opaque handle, " +
      "and nothing else. Playwright is forbidden for the same reason it is in the secure " +
      "service — this service drives no browser. The logging and APM names are the usual list.",
  },
  {
    packagePath: "apps/worker",
    forbidden: [
      "@askimate/aas-secrets",
      "@askimate/aas-secure-service",
      "@aws-sdk/client-kms",
      "playwright",
      "morgan",
      "pino",
      "pino-http",
      "winston",
      "express-winston",
      "@sentry/node",
      "@sentry/express",
      "dd-trace",
      "newrelic",
      "@opentelemetry/sdk-node",
      "errorhandler",
    ],
    rationale:
      "ADR-0052 §13.0, Vahid's decision: the Background Worker owns the CONVERSATION PLANE " +
      "ONLY, and no process holds both planes' credentials. `@askimate/aas-secure-service` is " +
      "on this list and the others are not — a dependency on it would give this worker the " +
      "secure database's stores, and then a compromise of the one non-public process that " +
      "advances every case in the system would yield both databases. That is exactly the " +
      "property ADR-0037's separation exists to provide. The vault, KMS and Playwright are " +
      "forbidden for the same reasons they are in the conversation service; the logging and " +
      "APM names are the usual list.",
  },
  {
    packagePath: "apps/browser-runner",
    forbidden: [
      "@askimate/aas-case-store",
      // `@askimate/aas-profile` was on this list until ADR-0046. The runner now
      // depends on it, and deliberately: a fill plan crossing a wire has to be
      // reassembled through the ONE mint that may produce a `ConfirmedValue`,
      // and the alternative was stripping the brand at the boundary — which
      // would have left the process that actually types unable to tell a value
      // the student confirmed from one nobody did.
      //
      // The rationale below is unchanged and still holds: profile is neither a
      // secret store nor a database driver. `@askimate/aas-orchestrator` stays
      // absent for exactly that reason — it carries both — which is why
      // `executePlan` moved to `@askimate/aas-execution`.
      "@askimate/aas-orchestrator",
      "@askimate/aas-documents",
      "@askimate/aas-secrets",
      "@aws-sdk/client-kms",
      "pg",
      "drizzle-orm",
      "@aws-sdk/client-secrets-manager",
    ],
    rationale:
      "Browser automation executes untrusted page content and must have no access to application " +
      "secrets or the primary database (brief §8). @askimate/aas-secrets is the newest and the " +
      "most important name on this list: ADR-0042 moved credential consumption into the Secure " +
      "Plane, and this rule is what stops it coming back. The runner asks the fill agent to type " +
      "a secret; it holds no vault, and @aws-sdk/client-kms is forbidden so it cannot grow one.",
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
    const breachedInProduction = (rule.forbiddenInProduction ?? []).filter(
      (name) => name in (manifest.dependencies ?? {}),
    );

    if (breached.length > 0 || breachedInProduction.length > 0) {
      violations.push(
        `${rule.packagePath} must not depend on: ${[...breached, ...breachedInProduction].join(", ")}` +
          `\n    ${rule.rationale}`,
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

  // ── ADR-0042: the runner cannot NAME anything that resolves a secret ───
  //
  // The manifest rule above catches a declared dependency. This catches the
  // other route, the one the llm rule already guards against: a deep relative
  // import that reaches across the workspace without ever appearing in a
  // package.json. `import "../../../packages/secrets/src/store.js"` resolves
  // perfectly well and pnpm never hears about it.
  //
  // The whole of ADR-0042 is that the runner's PROCESS does not hold plaintext.
  // A single import undoes it, so the import is what is checked — in tests too,
  // because a test that constructs an in-process vault in the runner is a
  // template for production code that does the same.
  const RUNNER_FORBIDDEN_IMPORTS = [
    "aas-secrets",
    "secrets/src",
    "InMemorySecretStore",
    "EnvelopeVault",
    "LocalDataKeyProvider",
    "getSecret",
    "useSecret",
  ];
  const runnerSources = existsSync("apps/browser-runner/src")
    ? readdirSync("apps/browser-runner/src").filter((name) => name.endsWith(".ts"))
    : [];
  for (const name of runnerSources) {
    const source = readFileSync(join("apps/browser-runner/src", name), "utf8");
    // Comments may explain the rule; code may not break it.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ");
    for (const forbidden of RUNNER_FORBIDDEN_IMPORTS) {
      if (!code.includes(forbidden)) continue;
      violations.push(
        `apps/browser-runner/src/${name} mentions \`${forbidden}\`. The runner consumes no ` +
          `credential: it asks the Secure Plane's fill agent to type one and learns only whether ` +
          `the field was filled. A vault, a store or a resolver in this process is the ` +
          `architecture ADR-0042 replaced.`,
      );
    }
    checked += 1;
  }
  console.log(
    `  ✓  apps/browser-runner — ${String(runnerSources.length)} source file(s) name no vault, no store, no resolver`,
  );

  // ── ADR-0043: credential fields and credential sources, BOTH ways ──────
  //
  // The domain authority is `checkUsable`, which refuses an unusable mapping
  // set so it can never reach `planFill`. This is the second line: the domain
  // check protects a RUN, and this protects the REPOSITORY — a fixture that
  // broke the rule would be a template the next specialist copies.
  //
  // Both directions, because one alone leaves a hole. A password field mapped
  // to a profile field is the route ADR-0026 exists to prevent; `secure_
  // credential` on an ordinary field is a password typed into a name box, which
  // the fill agent's masked-field check would refuse at the last moment rather
  // than the mapping being refused at review time.
  const FIXTURE_MODULES = existsSync("packages/mapping/src/fixtures")
    ? readdirSync("packages/mapping/src/fixtures").filter((name) => name.endsWith(".ts"))
    : [];
  for (const name of FIXTURE_MODULES) {
    const source = readFileSync(join("packages/mapping/src/fixtures", name), "utf8");
    const blueprintHalf = source.slice(0, source.indexOf("MAPPING_SET"));
    const mappingHalf = source.slice(source.indexOf("MAPPING_SET"));

    // Which fieldRefs the blueprint declares as credential fields.
    const credentialFields = new Set<string>();
    for (const block of blueprintHalf.split("fieldRef:").slice(1)) {
      const ref = /^\s*"([^"]+)"/.exec(block)?.[1];
      if (ref === undefined) continue;
      if (/inputType:\s*"password"/.test(block.slice(0, 400))) credentialFields.add(ref);
    }

    // Which fieldRefs the mapping set gives which source.
    for (const block of mappingHalf.split("fieldRef:").slice(1)) {
      const ref = /^\s*"([^"]+)"/.exec(block)?.[1];
      if (ref === undefined) continue;
      const window = block.slice(0, 400);
      const isCredentialSource = window.includes('kind: "secure_credential"');

      if (credentialFields.has(ref) && !isCredentialSource) {
        violations.push(
          `packages/mapping/src/fixtures/${name} maps \`${ref}\` with something other than ` +
            `{ kind: "secure_credential" }, and the blueprint declares it a password field. A ` +
            `password is not profile data and never becomes a ConfirmedValue (ADR-0026, ADR-0043).`,
        );
      }
      if (!credentialFields.has(ref) && isCredentialSource) {
        violations.push(
          `packages/mapping/src/fixtures/${name} uses { kind: "secure_credential" } on \`${ref}\`, ` +
            `which the blueprint does not declare as a password field. The marker means the ` +
            `Secure Plane types a password into it; anywhere else that is a password typed ` +
            `somewhere it can be read (ADR-0043).`,
        );
      }
    }
    checked += 1;
  }
  console.log(
    `  ✓  ${String(FIXTURE_MODULES.length)} mapping fixture(s) — credential fields and credential sources agree, both ways`,
  );

  // ── The conversation plane cannot NAME anything that resolves a secret ──
  //
  // The manifest rule above stops a declared dependency. This stops the other
  // route — a deep relative import that never appears in a package.json — and
  // it matters more here than it did before P1, because the orchestrator's
  // `RunState.secret` puts the vocabulary of secrets legitimately in reach.
  //
  // Four lifecycle words and an opaque handle are exactly what this plane may
  // hold. A vault, a store or a resolver is not.
  const CONVERSATION_FORBIDDEN_IMPORTS = [
    "aas-secrets",
    "secrets/src",
    "InMemorySecretStore",
    "EnvelopeVault",
    "LocalDataKeyProvider",
    "getSecret",
    "useSecret",
  ];
  // ── The worker cannot NAME anything that resolves a secret either ──────
  //
  // The manifest rule above stops a declared dependency; this stops the deep
  // relative import that never appears in a package.json. ADR-0052 §13.0: this
  // process advances every case in the system autonomously, so it is the one
  // whose compromise would matter most — and it must be provably unable to
  // reach a credential.
  const workerSources = existsSync("apps/worker/src")
    ? readdirSync("apps/worker/src").filter((name) => name.endsWith(".ts"))
    : [];
  for (const name of workerSources) {
    const source = readFileSync(join("apps/worker/src", name), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
    for (const forbidden of CONVERSATION_FORBIDDEN_IMPORTS) {
      if (!code.includes(forbidden)) continue;
      violations.push(
        `apps/worker/src/${name} mentions \`${forbidden}\`. The Background Worker holds ` +
          `conversation-plane credentials only (ADR-0052 §13.0); a vault, a store or a ` +
          `resolver here would put both planes in one process.`,
      );
    }
    checked += 1;
  }
  console.log(
    `  ✓  apps/worker — ${String(workerSources.length)} source file(s) name no vault, no store, no resolver`,
  );

  const conversationSources = existsSync("apps/conversation-service/src")
    ? readdirSync("apps/conversation-service/src").filter((name) => name.endsWith(".ts"))
    : [];
  for (const name of conversationSources) {
    const source = readFileSync(join("apps/conversation-service/src", name), "utf8");
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ");
    for (const forbidden of CONVERSATION_FORBIDDEN_IMPORTS) {
      if (!code.includes(forbidden)) continue;
      violations.push(
        `apps/conversation-service/src/${name} mentions \`${forbidden}\`. The conversation plane ` +
          `holds four lifecycle words and an opaque handle. A vault, a store or a resolver here ` +
          `would put a password in the one plane ADR-0037 keeps free of them.`,
      );
    }
    checked += 1;
  }
  console.log(
    `  ✓  apps/conversation-service — ${String(conversationSources.length)} source file(s) name no vault, no store, no resolver`,
  );

  // ── P1: the Run Driver coordinates; the orchestrator decides ────────────
  //
  // The rule that keeps the split real. A driver that grew a `switch (step.kind)`
  // would be a SECOND implementation of the decision `nextStep` already makes,
  // and the pure one would stop being the answer — which is exactly how the two
  // models of a case came apart in the first place.
  //
  // `phaseFor` is named too: the mapping from a decision to a durable phase
  // lives in the orchestrator's `durable.ts`, and a copy here would be a second
  // opinion about where a run has got to.
  // ── The operator CLI calls the service; it does not open the store ─────
  //
  // ADR-0048's whole shape. A CLI writing the database directly would be a
  // SECOND WRITER, and every invariant the Conversation Service enforces would
  // need enforcing here too — and would eventually be enforced in only one of
  // them. This repository has already had two models of one thing come apart
  // (ADR-0041), and ADR-0045 turned on the same principle.
  //
  // The rule is worth having as a check rather than a comment because the
  // shortcut is so easy: one `pg.Pool` and a specialist queue becomes a second
  // implementation of the run's rules.
  const CLI = "scripts/interventions.ts";
  if (existsSync(CLI)) {
    const source = readFileSync(CLI, "utf8");
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ")
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')
      .replace(/`(?:[^`\\]|\\.)*`/g, "``");
    for (const forbidden of [
      "pg",
      "aas-case-store",
      "InterventionStore",
      "PostgresInterventionStore",
      "WorkflowRunStore",
      "ConversationEventStore",
    ]) {
      const pattern = new RegExp(`(^|[^\\w-])${forbidden}([^\\w-]|$)`);
      if (!pattern.test(code)) continue;
      violations.push(
        `${CLI} mentions \`${forbidden}\`. The operator CLI is an INTERFACE, not a writer ` +
          `(ADR-0048): it calls the Conversation Service's internal routes so the service stays ` +
          `the only thing that writes a resolution. Opening the store here would put the run's ` +
          `invariants in two places and, in time, in one.`,
      );
    }
  }

  const DRIVER = "apps/conversation-service/src/run-driver.ts";
  if (existsSync(DRIVER)) {
    const source = readFileSync(DRIVER, "utf8");
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ")
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')
      .replace(/`(?:[^`\\]|\\.)*`/g, "``");

    // COMPARING a step's kind, in either direction. The rule used to name only
    // `step.kind ===` and missed `step.kind !==` — the same second copy of the
    // step vocabulary written the other way round, and one had been sitting in
    // this file passing the check. Every narrowing now lives in the orchestrator
    // (`browserWorkFor`, `accountWorkOf`, `executePlanOf`).
    //
    // Reading `step.kind` is fine and stays fine: the run's reported position
    // carries it, and repeating a word is not deciding with it.
    for (const forbidden of [
      "step.kind ==",
      "step.kind !=",
      "switch (step",
      "phaseFor(",
      "deriveCheckpoint(",
    ]) {
      if (!code.includes(forbidden)) continue;
      violations.push(
        `${DRIVER} contains \`${forbidden}\`. The Conversation Service COORDINATES and the ` +
          `orchestrator DECIDES: branching on a step's kind here, or deriving a phase here, ` +
          `would be a second implementation of a decision that already has one pure home.`,
      );
    }
    if (!code.includes("requiresSecureRequest(")) {
      violations.push(
        `${DRIVER} does not call requiresSecureRequest(). A step that needs the Secure ` +
          `Interaction Service opened is recognised by the orchestrator's own predicate, never ` +
          `by a list of step kinds kept here — a list here would go silently out of date the ` +
          `first time another step gained an external effect.`,
      );
    }
    if (!code.includes("nextStep(")) {
      violations.push(
        `${DRIVER} does not call nextStep(). The whole point of the Run Driver is that the ` +
          `orchestrator makes the decision; a driver that reached a conclusion another way ` +
          `would be the second model of a case returning.`,
      );
    }
    checked += 1;
  }
  console.log(`  ✓  the Run Driver — calls nextStep, decides nothing itself`);

  // ── P30 / ADR-0066: an upload is planned from the MAPPING, and only that ──
  //
  // Three reviewed declarations carry the word "document" and exactly ONE of
  // them may decide what happens:
  //
  //   BlueprintPage.requiredDocuments   discovery's record of the file inputs
  //                                     it SAW, keyed by `fieldRef` — the
  //                                     portal's own name for the box, never a
  //                                     domain document type (ADR-0070).
  //                                     Nothing plans from it — measured, not
  //                                     assumed (ADR-0066 §2).
  //   MappingSource {kind:"document"}   the reviewed, two-person, blueprint-
  //                                     pinned decision (ADR-0017). THIS is
  //                                     what `planFill` turns into an upload.
  //   CatalogueEntry.requiredDocuments  a list of domain document TYPES, shown
  //                                     to the student in the offer. Advisory:
  //                                     it carries no scope, no criticality
  //                                     and no provenance, so ADR-0009 and
  //                                     ADR-0021 forbid it deciding anything.
  //
  // The tempting change is to "join them up" — make the planner read a
  // declaration because it has the same name. That is how a list with no
  // evidence behind it would come to block a real application, which is the
  // failure ADR-0021 names: a rule defaulting into blocking, by omission.
  //
  // So the planning path may not mention the word at all. Fixtures are
  // blueprints and legitimately declare it; tests may read it to assert these
  // very facts. Neither plans anything.
  const PLANNING_PATH = [
    "packages/orchestrator/src",
    "packages/mapping/src",
    "packages/preparation/src",
    "packages/execution/src",
  ];
  let planningFiles = 0;
  for (const dir of PLANNING_PATH) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).filter((file) => file.endsWith(".ts"))) {
      if (name.endsWith(".test.ts")) continue;
      const code = readFileSync(join(dir, name), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/\/\/[^\n]*/g, " ");
      planningFiles += 1;
      if (!code.includes("requiredDocuments")) continue;
      violations.push(
        `${dir}/${name} mentions \`requiredDocuments\`. An upload is planned from a reviewed ` +
          `MAPPING (ADR-0017), never from a declaration that happens to share the name. The ` +
          `catalogue entry's list has no scope, no criticality and no provenance, so ADR-0009 ` +
          `and ADR-0021 forbid it deciding anything; the blueprint page's is discovery's record ` +
          `of what it saw. See ADR-0066.`,
      );
    }
    checked += 1;
  }
  console.log(
    `  ✓  the planning path — ${String(planningFiles)} file(s) plan an upload from the mapping alone`,
  );

  // ── P4: the conversation plane's client for the secure plane ───────────
  //
  // This is the only file in the conversation plane that talks to the service
  // that holds passwords, so it is the only place the old architecture could
  // come back. Two ways it could:
  //
  //   * by READING a value out of a response. `SecretUseResult` and
  //     `OpenedSecretRequest` both forbid one, and `parseOpened` rebuilds the
  //     answer field by field so a service that sent one has nowhere to put it.
  //     A cast would undo that in a single line.
  //   * by calling the STUDENT-FACING submission endpoint. `/v1/secret-requests
  //     /{id}/secret` is the one route in this system that carries a plaintext
  //     password, and it is same-origin from inside the frame by design. A
  //     server-to-server call to it from here would mean this plane had a value
  //     to send.
  const SECURE_CLIENT = "apps/conversation-service/src/secure-requests.ts";
  if (existsSync(SECURE_CLIENT)) {
    const source = readFileSync(SECURE_CLIENT, "utf8");
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ");

    for (const forbidden of [
      'record["value"]',
      'record["secret"]',
      'record["password"]',
      'record["plaintext"]',
      "as OpenedSecureRequest",
      "/secret`",
      '/secret"',
    ]) {
      if (!code.includes(forbidden)) continue;
      violations.push(
        `${SECURE_CLIENT} contains \`${forbidden}\`. This plane opens requests and mints frame ` +
          `capabilities; it neither sends a password nor reads one back. A value crossing here ` +
          `is the architecture ADR-0037 and ADR-0042 were written to prevent.`,
      );
    }
    if (!code.includes("function parseOpened")) {
      violations.push(
        `${SECURE_CLIENT} no longer rebuilds the response with parseOpened. Rebuilding field by ` +
          `field is what gives a value-shaped field nowhere to land; a cast trusts the wire.`,
      );
    }
    checked += 1;
  }
  console.log(`  ✓  the secure-plane client — opens and mints, carries no value`);

  // ── ADR-0045: the runner pulls work, and decides nothing about it ──────
  //
  // Two rules on the one file in the runner that talks to the Application
  // Plane, and they guard the two ways the runner could stop being a component
  // that does what it is told.
  //
  //   * By DECIDING. A runner that branched on a step kind, called `nextStep`,
  //     or picked which run to work would be a second implementation of the
  //     orchestrator's decision — in the least trusted process in the system.
  //   * By RECEIVING. The claim response is rebuilt by the contract's own
  //     parser, which is what gives a plane answering with a fill value, a
  //     password or a profile nowhere to put it. A cast undoes that in a line.
  const INTAKE = "apps/browser-runner/src/work-intake.ts";
  if (existsSync(INTAKE)) {
    const source = readFileSync(INTAKE, "utf8");
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ");

    for (const forbidden of [
      "nextStep(",
      "work.kind ===",
      "switch (work",
      "as ClaimedWork",
      "planFill(",
      "ConfirmedValue",
    ]) {
      if (!code.includes(forbidden)) continue;
      violations.push(
        `${INTAKE} contains \`${forbidden}\`. The runner does what the Application Plane tells ` +
          `it and reports how it went. Deciding what to do here, or trusting the wire instead of ` +
          `parsing it, is the architecture ADR-0045 and ADR-0041 were written to prevent.`,
      );
    }
    if (!code.includes("parseClaimedWork(")) {
      violations.push(
        `${INTAKE} no longer parses the claim with parseClaimedWork. Rebuilding the response ` +
          `field by field is what gives a value-shaped field nowhere to land; a cast trusts a ` +
          `plane this process should not have to trust.`,
      );
    }
    checked += 1;
  }
  console.log(`  ✓  the runner's work intake — pulls, parses, decides nothing`);

  // ── The work contract carries no value, and says so in the type ────────
  //
  // `packages/contracts` has no dependencies, so this file CANNOT import a
  // `ConfirmedValue`, a `FillPlan` or a `SecretHandle` — but it could still
  // declare a `password: string`. The compile-time assertion in the file is what
  // stops that, and this rule is what stops the assertion being deleted.
  const WORK_CONTRACT = "packages/contracts/src/work.ts";
  if (existsSync(WORK_CONTRACT)) {
    const source = readFileSync(WORK_CONTRACT, "utf8");
    for (const assertion of [
      "NO_WORK_FIELD_IS_FREE_TEXT",
      "REGISTRATION_CARRIES_ONLY_TARGETS",
      // ADR-0046's load-bearing half. Without it a plan could cross as text
      // with the provenance dropped, and the only way to rebuild a value on the
      // far side would be to INVENT one — an assertion that a student said
      // something, made by a process with no idea whether they did.
      "A_CONFIRMED_VALUE_CARRIES_ITS_PROVENANCE",
    ]) {
      if (source.includes(assertion)) continue;
      violations.push(
        `${WORK_CONTRACT} no longer asserts ${assertion}. These assertions are the only things ` +
          `that fail the build when the payload the Automation Runner receives grows a field it ` +
          `must not carry.`,
      );
    }
    // Scoped to the PAYLOAD's own declaration, not to the whole file. Two
    // earlier versions of this rule scanned the file and both cried wolf —
    // once on `"passwordless"`, which is a legal approach, and once on a
    // parser's `value: unknown` parameter. A rule that has to be explained
    // away gets weakened; this one reads the fields of the interface the
    // runner actually receives, which is what it was always about.
    const declaration = /export interface ClaimedWork \{([\s\S]*?)\n\}/.exec(
      source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " "),
    );
    if (declaration === null) {
      violations.push(
        `${WORK_CONTRACT} no longer declares \`export interface ClaimedWork\`. This rule reads ` +
          `its fields; a payload it cannot find is a payload it cannot check.`,
      );
    } else {
      const fields = [...(declaration[1] ?? "").matchAll(/readonly\s+([A-Za-z0-9_]+)\??\s*:/g)].map(
        (match) => match[1] ?? "",
      );
      // `plan` was on this list until ADR-0046 decided how a fill plan may
      // cross: as text plus the provenance that confirmed it, reassembled
      // through the one mint. What guards its CONTENTS is the compile-time
      // assertion below, which is why removing the name from here is a
      // narrowing rather than a hole.
      const FORBIDDEN_FIELDS = ["password", "plaintext", "secret", "secretValue", "value", "fillValue", "profile"];
      for (const field of fields) {
        if (!FORBIDDEN_FIELDS.includes(field)) continue;
        violations.push(
          `${WORK_CONTRACT} declares \`ClaimedWork.${field}\`. This is the payload the Automation ` +
            `Runner receives on every claim; a field by that name would hand the least trusted ` +
            `component in the system something ADR-0045 says it must never be given.`,
        );
      }
    }
    checked += 1;
  }
  console.log(`  ✓  the work contract — no free text, no value-shaped field`);

  // ── P6: the process that creates the account holds no password ─────────
  //
  // `create-account.ts` drives a real browser through a real registration form
  // on a real portal. It is the closest this system comes to holding a
  // credential while not holding one, so the two ways it could start are named:
  //
  //   * By TYPING one. `fill(` on a password box, a literal, a generated
  //     string — anything that puts characters into a masked field from this
  //     process. Only `fillSecret` may, and it does not type: it ASKS the
  //     Secure Plane's agent to, over CDP, from a process that has the vault.
  //   * By READING one back. `inputValue()` on the box it just had filled.
  //     ADR-0042 records this as the honest residual — the runner owns the
  //     browser — but a call in the shipped path is a different thing from a
  //     capability the architecture concedes.
  const ACCOUNT = "apps/browser-runner/src/create-account.ts";
  if (existsSync(ACCOUNT)) {
    const source = readFileSync(ACCOUNT, "utf8");
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ");

    for (const forbidden of [
      "inputValue()",
      "randomBytes",
      "generatePassword",
      "EnvelopeVault",
      "tracing.start",
      "recordVideo",
    ]) {
      if (!code.includes(forbidden)) continue;
      violations.push(
        `${ACCOUNT} contains \`${forbidden}\`. This process creates the account and never holds ` +
          `the credential: the Secure Plane's fill agent types it (ADR-0042), and nothing here ` +
          `may generate one, read one back, or record the page while one is on it.`,
      );
    }
    if (!code.includes("openSensitiveContext(")) {
      violations.push(
        `${ACCOUNT} does not open a SENSITIVE context. Playwright writes typed values verbatim ` +
          `into trace.trace, and stopping tracing around a fill does not prevent it — the action ` +
          `is buffered and replayed into the next trace file (ADR-0025, measured).`,
      );
    }
    if (!code.includes("fillSecret(")) {
      violations.push(
        `${ACCOUNT} no longer asks the Secure Plane to type the password. If it fills the field ` +
          `itself then the plaintext is in the heap of the process that loads pages we do not ` +
          `control, which is the architecture ADR-0042 exists to prevent.`,
      );
    }
    checked += 1;
  }
  console.log(`  ✓  account creation — sensitive context, and the agent types`);

  // ── The fill agent holds plaintext, and must leak nothing while it does ─
  //
  // The same source-level rules the secure endpoint has, applied to the other
  // process that holds a password. The realistic regression is identical:
  // someone adds `console.log("filling", request)` while debugging a locator
  // that will not match, and leaves it in.
  const FILLER_SOURCES = ["apps/secure-filler/src/fill.ts", "apps/secure-filler/src/app.ts"];
  for (const file of FILLER_SOURCES) {
    if (!existsSync(file)) continue;
    const source = readFileSync(file, "utf8");
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ")
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')
      .replace(/`(?:[^`\\]|\\.)*`/g, "``");

    if (/console\.(log|debug|info|warn|error|trace|dir)\s*\(/.test(code)) {
      violations.push(
        `${file} contains a console call. This process holds a plaintext password for the length ` +
          `of one callback. Nothing in it may write to a log except SecureLogger, whose fields ` +
          `are a closed set of scalars (ADR-0042).`,
      );
    }
    for (const forbidden of ["tracing.start", "recordVideo", "JSON.stringify(secret", "inputValue()"]) {
      if (!code.includes(forbidden)) continue;
      violations.push(
        `${file} contains \`${forbidden}\`. The agent types a secret into a page it does not own; ` +
          `it must not record what it typed, and it must not read a value back outside the one ` +
          `shape-only comparison in @askimate/aas-browser-fill (ADR-0025, ADR-0042).`,
      );
    }
    checked += 1;
  }
  console.log(`  ✓  the fill agent — no console calls, no tracing, no read-back`);

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

  // ── The six decisions have exactly one implementation ───────────────────
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
    "latestSecretRequest",
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

  // ── The Secure Plane admits no third-party script, and no third origin ───
  //
  // ═════════════════════════════════════════════════════════════════════════
  // Vahid, 2026-08-28 (R14): *"Introduce a third-party script into the Secure
  // Plane… extend the browser/build checks so the Secure Plane has the approved
  // script and network-origin restrictions."*
  // ADR-0036 — no third-party scripts on authenticated surfaces.
  // ═════════════════════════════════════════════════════════════════════════
  //
  // The Content-Security-Policy is the control the browser enforces; this is
  // what stops the policy being weakened in a diff nobody reads. `script-src
  // 'self'` and `connect-src 'self'` are the two directives that matter most —
  // the first means an injected inline script does not run, the second means
  // that even if one did, there is no origin it could send the password to.
  const CONTROL_DOCUMENT = "apps/secure-service/src/control-document.ts";
  if (existsSync(CONTROL_DOCUMENT)) {
    const source = readFileSync(CONTROL_DOCUMENT, "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

    const required = [
      "default-src 'none'",
      "script-src 'self'",
      "connect-src 'self'",
      "form-action 'self'",
      "base-uri 'none'",
      "frame-ancestors",
    ];
    for (const directive of required) {
      if (!code.includes(directive)) {
        violations.push(
          `${CONTROL_DOCUMENT} no longer sets \`${directive}\`. The secure control's policy is ` +
            `what makes "no third-party script can read or exfiltrate the password" a property ` +
            `the BROWSER enforces rather than one this repository asserts.`,
        );
      }
    }
    // A wildcard or an unsafe keyword anywhere in the policy defeats it.
    for (const weakening of ["'unsafe-inline'", "'unsafe-eval'", "script-src *", "connect-src *"]) {
      if (code.includes(weakening)) {
        violations.push(
          `${CONTROL_DOCUMENT} contains \`${weakening}\`. That re-admits exactly the class of ` +
            `script the Secure Plane exists to exclude.`,
        );
      }
    }
    // No origin but this service's own may appear in the document or its
    // script. A CDN, a font host, an analytics tag: all the same finding.
    const CONTROL_FILES = [CONTROL_DOCUMENT, "apps/secure-service/src/control-client.ts"];
    for (const file of CONTROL_FILES) {
      if (!existsSync(file)) {
        violations.push(`${file} is missing, so the Secure Plane script check is inert.`);
        continue;
      }
      const body = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/^\s*\/\/.*$/gm, " ");
      for (const match of body.matchAll(/https?:\/\/[A-Za-z0-9.-]+/g)) {
        violations.push(
          `${file} names the absolute URL \`${match[0]}\`. Everything the secure control loads ` +
            `or calls must be same-origin: a third origin here is a third party inside the one ` +
            `document that handles a credential.`,
        );
      }
      if (/<script\s+src=/i.test(body) && !/src="\/control\.js"/.test(body)) {
        violations.push(`${file} loads a script that is not /control.js.`);
      }
    }

    // ── No wildcard targetOrigin, on EITHER side of the boundary ──────────
    //
    // `postMessage(payload, "*")` delivers to whatever happens to be at the
    // other end. Inside the secure frame that means handing a lifecycle
    // message — and the opaque handle that rides on a receipt — to whichever
    // page embedded the control, which is precisely the attacker in the threat
    // model. From the parent it means delivering the one-time bootstrap
    // capability to a frame that may have been navigated since it was rendered.
    //
    // Added because a regression that replaced the exact origin with `"*"`
    // was NOT caught: every test passed, because the wildcard is a superset of
    // the correct behaviour and nothing in a cooperating test ever notices.
    // Only a rule that reads the source can see it.
    // ── Both ends of the handshake, and P53 found one of them uncovered ──
    //
    // This listed the secure service's control client and the RESEARCH build's
    // `SecureFrame.tsx`. The production client — `journey.ts`, which mounts the
    // real frame and posts the real handshake — was never in it, so the one
    // postMessage a student's browser actually makes had no wildcard rule over
    // it. Removing the research build (ADR-0086) is what surfaced that.
    const POST_MESSAGE_FILES = [
      "apps/secure-service/src/control-client.ts",
      "apps/conversation-service/src/client/journey.ts",
    ];
    for (const file of POST_MESSAGE_FILES) {
      if (!existsSync(file)) {
        violations.push(`${file} is missing, so the targetOrigin check is inert.`);
        continue;
      }
      const body = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/^\s*\/\/.*$/gm, " ");
      // `postMessage(x, "*")` and `postMessage(x, '*')`, however spaced or
      // wrapped across lines.
      // A trailing comma is legal and idiomatic — `postMessage(x, "*",)` — and
      // my first version of this pattern required the quote to be followed
      // immediately by `)`. It therefore caught the wildcard in one file and
      // missed it in the other, which is the failure mode a check like this
      // exists to avoid.
      if (/postMessage\s*\([\s\S]*?,\s*["'`]\*["'`]\s*,?\s*\)/.test(body)) {
        violations.push(
          `${file} calls postMessage with a wildcard targetOrigin. The browser will deliver to ` +
            `whatever is at the other end — which is the attacker in this design's threat model.`,
        );
      }
      if (!/postMessage/.test(body)) {
        violations.push(
          `${file} no longer calls postMessage, so this rule is checking nothing. If the frame ` +
            `protocol moved, move this check with it.`,
        );
      }
    }
    // ── Only the store opens and closes a transaction ────────────────────
    //
    // The receipt and the intent to publish it MUST commit together: that is
    // the whole of the outbox guarantee, and it is what makes a failed
    // publication leave nothing behind rather than a settled request nobody
    // will ever announce.
    //
    // Added because a regression that put a `COMMIT` between the two was NOT
    // caught: on the happy path both writes succeed either way, and no test
    // was forcing the failure that distinguishes them. A behavioural test for
    // this needs a fault injected between two statements inside one handler,
    // which is a seam this service deliberately does not have — so the rule
    // reads the source instead. `withTransaction` in `requests.ts` is the one
    // place that may say BEGIN, COMMIT or ROLLBACK.
    const TRANSACTION_OWNERS = ["apps/secure-service/src/requests.ts"];
    const TRANSACTION_USERS = [
      "apps/secure-service/src/routes.ts",
      "apps/secure-service/src/lifecycle-outbox.ts",
    ];
    for (const file of TRANSACTION_USERS) {
      if (!existsSync(file)) continue;
      const body = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/^\s*\/\/.*$/gm, " ");
      // `lifecycle-outbox.ts` owns its own publisher transaction, so it is
      // allowed BEGIN/COMMIT; `routes.ts` is not, and that is the rule.
      if (file.endsWith("routes.ts") && /query\(\s*["'`](BEGIN|COMMIT|ROLLBACK)/.test(body)) {
        violations.push(
          `${file} issues BEGIN, COMMIT or ROLLBACK directly. Transaction boundaries in this ` +
            `service belong to \`withTransaction\` — a COMMIT in a handler splits the receipt ` +
            `from the outbox row it must commit with, and the outbox guarantee is exactly that ` +
            `they cannot be split.`,
        );
      }
    }
    for (const file of TRANSACTION_OWNERS) {
      if (!existsSync(file)) {
        violations.push(`${file} is missing, so the transaction-ownership rule is inert.`);
        continue;
      }
      if (!/withTransaction/.test(readFileSync(file, "utf8"))) {
        violations.push(`${file} no longer defines withTransaction; move this rule with it.`);
      }
    }

    checked += 1;
    console.log(
      `  ✓  the Secure Plane — CSP intact, ${String(CONTROL_FILES.length)} file(s) name no third ` +
        `origin, transaction boundaries owned by one module`,
    );
  }

  // ── The student's page may not reach into the service it is served by ──
  //
  // ═══════════════════════════════════════════════════════════════════════
  // ADR-0060 puts the client INSIDE `apps/conversation-service`, because that
  // is the origin that mints its session. The cost of that decision is
  // proximity: `run-driver.ts` is one directory away, and importing it would
  // give the browser the orchestrator, the case machine and the domain — a
  // client holding workflow logic, which is the one thing it must not be.
  //
  // So the rule is the import DIRECTION, and it is what the app-wide `"lib":
  // ["dom"]` in that tsconfig leans on: the compiler will not stop a server
  // file touching `document`, and this will not stop it either — but this
  // stops the failure that actually matters.
  // ═══════════════════════════════════════════════════════════════════════
  {
    const CLIENT_DIR = "apps/conversation-service/src/client";
    // Every server module in the app. Read from the directory rather than
    // listed, so a file added tomorrow is covered without anyone remembering.
    const serverModules = existsSync("apps/conversation-service/src")
      ? readdirSync("apps/conversation-service/src")
          .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
          .map((name) => name.replace(/\.ts$/, ""))
      : [];
    const clientFiles = existsSync(CLIENT_DIR)
      ? readdirSync(CLIENT_DIR).filter((name) => name.endsWith(".ts"))
      : [];

    if (clientFiles.length === 0) {
      violations.push(
        `No client file found under ${CLIENT_DIR}. This rule polices the student's page; a ` +
          `rule looking at nothing passes for the wrong reason.`,
      );
    }
    if (serverModules.length === 0) {
      violations.push(
        `No server module found under apps/conversation-service/src. This rule compares the ` +
          `client against them and would be vacuous.`,
      );
    }

    for (const file of clientFiles) {
      const source = readFileSync(join(CLIENT_DIR, file), "utf8");
      for (const match of source.matchAll(/from\s+"([^"]+)"/g)) {
        const specifier = match[1] ?? "";
        // A relative import that climbs OUT of the client directory.
        if (!specifier.startsWith("../")) continue;
        const named = specifier.replace(/^\.\.\//, "").replace(/\.js$/, "");
        if (serverModules.includes(named)) {
          violations.push(
            `${CLIENT_DIR}/${file} imports "${specifier}" — a server module of the service it ` +
              `is served by. The student's page is a projection: it reads the published API and ` +
              `holds no workflow logic (ADR-0060).`,
          );
        }
      }
      // The server-side packages a browser has no business holding. Named
      // rather than derived, because the point is which CAPABILITIES must not
      // reach the page, not which packages happen to exist.
      for (const forbidden of [
        "@askimate/aas-orchestrator",
        "@askimate/aas-domain",
        "@askimate/aas-case-store",
        "@askimate/aas-catalogue",
        "@askimate/aas-preparation",
        "@askimate/aas-interview",
        "@askimate/aas-llm",
        "@askimate/aas-mapping",
        "@askimate/aas-profile",
        "@askimate/aas-migrate",
        "@askimate/aas-oidc",
        "pg",
      ]) {
        if (source.includes(`"${forbidden}"`)) {
          violations.push(
            `${CLIENT_DIR}/${file} imports ${forbidden}. A client that held it would be ` +
              `deriving what the server is authoritative for (ADR-0060, ADR-0061).`,
          );
        }
      }
    }

    checked += 1;
    console.log(
      `  ✓  the student's page — ${String(clientFiles.length)} file(s) reach no server module ` +
        `of the ${String(serverModules.length)} beside them`,
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
