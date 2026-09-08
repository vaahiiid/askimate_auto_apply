/**
 * Reachability: a declared capability with no production caller fails the build.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * P37 audited ADRs 0005–0021 against the code and found that a quarter of the
 * records checked asserted something production did not do. The question that
 * found almost all of them was not *"does the code contain this?"* but
 *
 *     DOES ANYTHING IN PRODUCTION CALL IT?
 *
 * `claimSubmissionKey` — ADR-0006's "second line of defence" against the
 * duplicate submission the brief calls the characteristic catastrophic failure
 * of this class of system — had exactly one caller in the repository, and it
 * was `scripts/walkthrough.ts`. `machine.ts` imported `decideReapplication` as
 * a TYPE and enforced one of its five rules. Neither was visible to anything
 * automatic, because both compile, both are tested, and both are exported.
 *
 * This is that question, asked by the build. A capability the register says is
 * enforced must have a caller inside a deployable's dependency closure; one the
 * register says is unreachable must have none, and must say why and what would
 * close it.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── What "production" means here, precisely ────────────────────────────────
 *
 *   1. NOT a test. `*.test.ts`, fixtures, and the shared store contract suites
 *      are excluded. A capability exercised only by its own tests is the exact
 *      shape P37 found.
 *
 *   2. NOT a script. `scripts/` is a demonstration surface, and the whole of
 *      P37's finding was that the walkthrough was the only caller. A script
 *      counting as production would make this check agree with the defect.
 *
 *   3. Inside a DEPLOYABLE'S CLOSURE. The five deployables (ADR-0037,
 *      ADR-0052, ADR-0055) and every workspace package they transitively
 *      depend on. A call site in a package nothing deploys is not reachable in
 *      production however real the call is — `packages/requirements` has no
 *      dependents at all, so a function called only from there is called by
 *      nothing that runs.
 *
 * ── What it does NOT prove ────────────────────────────────────────────────
 *
 * That a REQUEST can reach it. This answers P37's question — is there a
 * production call site — not "is there a path from an HTTP route". A function
 * called only by another function that nothing calls passes here. Closing that
 * gap needs a call graph rather than a symbol search, and claiming otherwise
 * would be the kind of confident overstatement this check exists to catch.
 */

import { readdirSync, readFileSync, existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.cwd();
const DIM = "[2m";
const RESET = "[0m";

/** The five processes that are actually deployed (ADR-0037, ADR-0052, ADR-0055). */
const DEPLOYABLES: readonly string[] = [
  "apps/conversation-service",
  "apps/secure-service",
  "apps/secure-filler",
  "apps/browser-runner",
  "apps/worker",
];

export type Reachability =
  | { readonly kind: "reachable" }
  | {
      readonly kind: "unreachable";
      /** Why nothing calls it, stated as a fact about the system. */
      readonly reason: string;
      /** What would close it. A phase, a decision, or a named blocker. */
      readonly closedBy: string;
    };

export interface Capability {
  /** The exported symbol, or the string literal, whose reachability is asked about. */
  readonly symbol: string;
  /**
   * `call` matches `symbol(` and `.symbol(`; `literal` matches the quoted
   * string. A `ConsequentialAction` member is a literal rather than a function,
   * and the question about it is the same one.
   */
  readonly kind: "call" | "literal";
  /**
   * Every file that DECLARES it — an interface, and each implementation.
   *
   * Excluded from the search, because a declaration is not a caller. Named
   * rather than derived so the register cannot quietly go stale: a file here
   * that no longer contains the symbol fails the check.
   */
  readonly declaredIn: readonly string[];
  /** The record that asserts this capability does something. */
  readonly record: string;
  /** What that record promises, in one line. */
  readonly promise: string;
  readonly status: Reachability;
}

// ───────────────────────────────────────────────────────────────────────────
// The register
//
// Every entry is a claim about the world that this script then checks. It is
// deliberately NOT every exported symbol: the question is about capabilities a
// DECISION says are enforced, because those are the ones whose absence is a
// false record rather than merely dead code.
// ───────────────────────────────────────────────────────────────────────────

export const CAPABILITIES: readonly Capability[] = [
  // ── Enforced, and the build now says so ────────────────────────────────
  {
    symbol: "claimSubmissionKey",
    kind: "call",
    declaredIn: [
      "packages/case-store/src/store.ts",
      "packages/case-store/src/postgres.ts",
      "packages/case-store/src/in-memory.ts",
    ],
    record: "ADR-0006",
    promise:
      "the database's unique key is the second line of defence against duplicate submission",
    status: { kind: "reachable" },
  },
  {
    symbol: "decideReapplication",
    kind: "call",
    declaredIn: ["packages/domain/src/reapplication.ts"],
    record: "ADR-0006, ADR-0072",
    promise: "the single gate; nothing else may increment an attempt ordinal",
    status: { kind: "reachable" },
  },
  {
    symbol: "openReapplication",
    kind: "call",
    declaredIn: ["packages/domain/src/machine.ts"],
    record: "ADR-0006 §3 (amended P38)",
    promise: "the one constructor for a second attempt; every field of its identity is derived",
    status: { kind: "reachable" },
  },
  {
    symbol: "recommendWait",
    kind: "call",
    declaredIn: ["packages/domain/src/reapplication.ts"],
    record: "ADR-0006 rule 4",
    promise: "the wait recommendation is advisory in effect and mandatory in presentation",
    status: { kind: "reachable" },
  },
  {
    symbol: "mayTransmit",
    kind: "call",
    declaredIn: ["packages/disclosure/src/disclosure.ts"],
    record: "ADR-0022, ADR-0069",
    promise:
      "an authorisation is spendable only for the document, content, host and CASE it names",
    status: { kind: "reachable" },
  },
  {
    symbol: "noticeFor",
    kind: "call",
    declaredIn: ["packages/notify/src/notice.ts"],
    record: "ADR-0071",
    promise: "the only constructor for a specialist notice, and it reads named fields",
    status: { kind: "reachable" },
  },
  {
    symbol: "reopenIntent",
    kind: "call",
    declaredIn: [
      "packages/case-store/src/workflow-store.ts",
      "packages/case-store/src/postgres-workflow.ts",
      "packages/case-store/src/in-memory-workflow.ts",
    ],
    record: "ADR-0054",
    promise: "a cleanly failed action may be tried again, guarded to failed_cleanly",
    status: { kind: "reachable" },
  },
  {
    symbol: "checkTransition",
    kind: "call",
    declaredIn: ["packages/domain/src/transitions.ts"],
    record: "ADR-0049",
    promise: "every case movement goes through one guard, terminal states included",
    status: { kind: "reachable" },
  },
  {
    symbol: "suggestsMinority",
    kind: "call",
    declaredIn: ["packages/domain/src/minors.ts"],
    record: "ADR-0011",
    promise: "a case involving a minor is reviewed every time, regardless of confidence",
    status: { kind: "reachable" },
  },
  {
    symbol: "isFinancialField",
    kind: "call",
    declaredIn: ["packages/profile/src/fields.ts"],
    record: "brief §2.5",
    promise: "financial evidence is reviewed by a person every time",
    status: { kind: "reachable" },
  },
  {
    symbol: "isHeldByAPerson",
    kind: "call",
    declaredIn: ["packages/domain/src/workflow.ts"],
    record: "ADR-0074",
    promise:
      "a run a person is holding is returned to the student, never restarted, and cannot be advanced",
    status: { kind: "reachable" },
  },
  {
    // ═══════════════════════════════════════════════════════════════════
    // Found in P46, and the eighth of this shape.
    //
    // ADR-0021 calls this "the single line that keeps the visa journey out of
    // the application journey", and NOTHING IN PRODUCTION CALLS IT — because
    // nothing in production carries a `Requirement` at all. `packages/
    // requirements` has no dependents, and the catalogue's own
    // `requiredDocuments` are free-text strings with no authority (ADR-0066,
    // ADR-0070), not scoped requirements.
    //
    // Listed rather than wired. Giving it a caller would be a control over
    // unreachable code, which ADR-0071 declined for `attach_document` for the
    // same reason. What makes the absence safe TODAY is that the visa journey
    // is not built at all — not that this line is stopping it.
    // ═══════════════════════════════════════════════════════════════════
    symbol: "blocksApplication",
    kind: "call",
    declaredIn: ["packages/domain/src/requirements.ts"],
    record: "ADR-0021, ADR-0080",
    promise: "the single line that keeps the visa journey out of the application journey",
    status: {
      kind: "unreachable",
      reason:
        "nothing in production carries a `Requirement`, so there is no scope for it to read — " +
        "the visa journey is absent rather than excluded",
      closedBy:
        "the Requirements Service phase, or anything else that puts a scoped `Requirement` on a " +
        "production path. Until then the boundary is held by ADR-0080's decision and not by code",
    },
  },
  {
    // The client half of ADR-0006 rule 4. Both routes existed, were published
    // and were tested from P38, and NOTHING CALLED EITHER until P42 — the
    // shape this register exists to catch, one layer further out than the
    // symbol it usually asks about. Its caller is the student's page, which
    // this check counts as production because it is inside a deployable.
    symbol: "advisePriorOutcome",
    kind: "call",
    declaredIn: ["apps/conversation-service/src/client/transport.ts"],
    record: "ADR-0006 §3 rule 4, ADR-0076",
    promise:
      "the wait recommendation is shown to the student before any instruction to apply again is taken",
    status: { kind: "reachable" },
  },
  {
    symbol: "problemForBodyError",
    kind: "call",
    declaredIn: ["packages/contracts/src/problems.ts"],
    record: "ADR-0075",
    promise:
      "a body this service refuses is stated as the code the contract publishes, not as an internal error",
    status: { kind: "reachable" },
  },
  {
    symbol: "assessIntent",
    kind: "call",
    declaredIn: ["packages/domain/src/workflow.ts"],
    record: "ADR-0045 §4, ADR-0054",
    promise: "an action that may already have happened is never handed out again",
    status: { kind: "reachable" },
  },

  // ── Declared, unreachable, and REVIEWED ────────────────────────────────
  //
  // Each is kept deliberately. ADR-0019: the constraint ships before the thing
  // it constrains. What the register adds is that the reason is written down
  // and the build re-checks it, so an entry cannot quietly become "we forgot" —
  // and if one acquires a production caller this check FAILS, because a stale
  // allow-list is what hides the next finding.
  {
    symbol: "checkMinorGate",
    kind: "call",
    declaredIn: ["packages/domain/src/minors.ts"],
    record: "ADR-0011",
    promise: "an application involving a minor cannot be submitted without the conditions met",
    status: {
      kind: "unreachable",
      reason:
        "its one BLOCKING condition is at the submission stage, and submission is out of scope " +
        "(ADR-0014). The trigger that stops a case for review is a different thing and IS " +
        "reachable: `suggestsMinority`, above.",
      closedBy: "the phase that brings submission into scope",
    },
  },
  {
    symbol: "assertStorable",
    kind: "call",
    declaredIn: ["packages/documents/src/vault.ts"],
    record: "ADR-0068",
    promise:
      "the retention and lawful-basis gates both run, and their branded result is the only " +
      "thing `store` accepts",
    status: {
      kind: "unreachable",
      reason:
        "no transport exists by which a student can supply bytes, and no deployable holds a vault",
      closedBy:
        "B5 is DECIDED (A — hold, 2026-09-07) and B1's eleven periods are set, so the " +
        "retention gate opens. Still waiting on B2 (the ADR-0022 lawful basis, which " +
        "`assertStorable` requires alongside the policy) and on the transport phase",
    },
  },
  {
    symbol: "authoriseDisclosure",
    kind: "call",
    declaredIn: ["packages/disclosure/src/disclosure.ts"],
    record: "ADR-0022",
    promise: "no document leaves without a recorded lawful basis",
    status: {
      kind: "unreachable",
      reason:
        "nothing acquires a document, and the `disclose_document_to_institution` lawful basis is " +
        "undetermined (B2), so the function refuses everything it is given",
      closedBy: "B2, which is the one of the three that is still undetermined, and the transport phase",
    },
  },
  {
    symbol: "purgeContents",
    kind: "call",
    declaredIn: [
      "packages/documents/src/vault.ts",
      "packages/documents/src/in-memory-vault.ts",
    ],
    record: "ADR-0010",
    promise: "a document's contents are destroyed when its retention schedule expires",
    status: {
      kind: "unreachable",
      reason: "the vault holds nothing, because nothing can put anything into it",
      closedBy:
        "B1 is DECIDED (2026-09-07): eleven periods set, row 12 still blocking. What is " +
        "left is a vault holding something to purge, and the job that calls this when a " +
        "period elapses — the transport phase",
    },
  },
  {
    symbol: "assessUsability",
    kind: "call",
    declaredIn: ["packages/domain/src/requirements.ts"],
    record: "ADR-0009, ADR-0021",
    promise: "a requirement below the evidence bar cannot block an application",
    status: {
      kind: "unreachable",
      reason:
        "its only caller is `packages/requirements`, which NO DEPLOYABLE DEPENDS ON. Requirements " +
        "come from the reviewed catalogue today (ADR-0057) and nothing feeds this path.",
      closedBy: "the Requirements Service phase, if the KB workflow is ever wired",
    },
  },
  {
    symbol: "attach_document",
    kind: "literal",
    declaredIn: ["packages/domain/src/workflow.ts"],
    record: "ADR-0045, ADR-0069",
    promise: "a declared `ConsequentialAction`, marked verifiable",
    status: {
      kind: "unreachable",
      reason:
        "produced by nothing. `WorkKind` is `create_account | execute`, so no work item can carry " +
        "it, and `toStoredPlan` refuses a plan with uploads.",
      closedBy:
        "B5 is DECIDED (A — hold, 2026-09-07). What is left is the attachment intent " +
        "identity ADR-0069 names, and a `WorkKind` that can carry it",
    },
  },
];

// ───────────────────────────────────────────────────────────────────────────
// The closure: which packages a deployable can actually reach
// ───────────────────────────────────────────────────────────────────────────

interface Manifest {
  readonly name?: string;
  readonly dependencies?: Record<string, string>;
}

function manifestAt(dir: string): Manifest | null {
  const path = join(ROOT, dir, "package.json");
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as Manifest;
}

function workspaceDirs(): readonly string[] {
  const dirs: string[] = [];
  for (const group of ["packages", "apps"]) {
    const base = join(ROOT, group);
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (entry.isDirectory()) dirs.push(`${group}/${entry.name}`);
    }
  }
  return dirs;
}

/** Every workspace package a deployable transitively depends on, plus the deployables. */
function deployableClosure(): ReadonlySet<string> {
  const byName = new Map<string, string>();
  for (const dir of workspaceDirs()) {
    const manifest = manifestAt(dir);
    if (manifest?.name !== undefined) byName.set(manifest.name, dir);
  }

  const reached = new Set<string>();
  const queue = [...DEPLOYABLES];
  while (queue.length > 0) {
    const dir = queue.pop();
    if (dir === undefined || reached.has(dir)) continue;
    reached.add(dir);
    const manifest = manifestAt(dir);
    for (const dependency of Object.keys(manifest?.dependencies ?? {})) {
      const next = byName.get(dependency);
      if (next !== undefined && !reached.has(next)) queue.push(next);
    }
  }
  return reached;
}

// ───────────────────────────────────────────────────────────────────────────
// The search
// ───────────────────────────────────────────────────────────────────────────

const EXCLUDED: readonly RegExp[] = [
  /\.test\.tsx?$/,
  /\/fixtures\//,
  /\/testing\.ts$/,
  // The shared store contract suites: one `describe` block that both
  // implementations run. Tests, living in `src` so both can import them.
  /\/contract\.ts$/,
  /\/workflow-contract\.ts$/,
  /\/intervention-contract\.ts$/,
];

function sourceFiles(dir: string): readonly string[] {
  const base = join(ROOT, dir, "src");
  if (!existsSync(base)) return [];
  const found: string[] = [];
  const walk = (at: string): void => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      const relative = path.slice(ROOT.length + 1);
      if (EXCLUDED.some((pattern) => pattern.test(`/${relative}`))) continue;
      found.push(relative);
    }
  };
  walk(base);
  return found;
}

/**
 * The file with comments removed.
 *
 * Written because the first version of this check counted the WORD
 * `recommendWait` in three doc comments as three production callers. A
 * reachability check that reports a comment as a call is exactly the kind of
 * confident wrong answer it exists to prevent.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** True when a line brings a name in or sends it out rather than using it. */
function isImportOrExport(line: string): boolean {
  return /^\s*(import|export)\b/.test(line) && !/=>/.test(line);
}

function callersOf(capability: Capability, closure: ReadonlySet<string>): readonly string[] {
  const pattern =
    capability.kind === "call"
      ? new RegExp(`\\b${capability.symbol}\\s*\\(`)
      : new RegExp(`["'\`]${capability.symbol}["'\`]`);

  const found: string[] = [];
  for (const dir of [...closure].sort()) {
    for (const file of sourceFiles(dir)) {
      if (capability.declaredIn.includes(file)) continue;
      const lines = withoutComments(readFileSync(join(ROOT, file), "utf8")).split("\n");
      if (lines.some((line) => !isImportOrExport(line) && pattern.test(line))) found.push(file);
    }
  }
  return found;
}

// ───────────────────────────────────────────────────────────────────────────

function main(): void {
  const closure = deployableClosure();
  const failures: string[] = [];

  console.log(
    `Reachability — ${String(CAPABILITIES.length)} declared capabilities, against the closure of ` +
      `${String(DEPLOYABLES.length)} deployables (${String(closure.size)} packages)\n`,
  );

  for (const capability of CAPABILITIES) {
    // The register must name something that exists. A `declaredIn` that no
    // longer contains the symbol means the register describes a repository that
    // has moved on, which is the failure mode this whole file is about.
    for (const file of capability.declaredIn) {
      const path = join(ROOT, file);
      if (!existsSync(path)) {
        failures.push(`${capability.symbol}: declared in ${file}, which does not exist`);
        continue;
      }
      if (!readFileSync(path, "utf8").includes(capability.symbol)) {
        failures.push(
          `${capability.symbol}: not found in ${file}, which the register says declares it`,
        );
      }
    }

    const callers = callersOf(capability, closure);
    if (capability.status.kind === "reachable") {
      if (callers.length === 0) {
        failures.push(
          `${capability.symbol} — ${capability.record} says "${capability.promise}", and NOTHING ` +
            `IN PRODUCTION CALLS IT. Either wire it, or move it to the reviewed unreachable list ` +
            `with a reason and what would close it.`,
        );
      } else {
        console.log(`  ✓  ${capability.symbol} ${DIM}← ${callers.join(", ")}${RESET}`);
      }
    } else if (callers.length > 0) {
      failures.push(
        `${capability.symbol} is on the reviewed unreachable list and now HAS a production caller ` +
          `(${callers.join(", ")}). Move it: a stale allow-list is what hides the next one.`,
      );
    } else {
      console.log(
        `  ⏸  ${capability.symbol} ${DIM}unreachable — ${capability.status.closedBy}${RESET}`,
      );
    }
  }

  if (failures.length > 0) {
    console.error(`\n${String(failures.length)} reachability failure(s):\n`);
    for (const failure of failures) console.error(`  ✗  ${failure}\n`);
    process.exitCode = 1;
    return;
  }

  const unreachable = CAPABILITIES.filter((c) => c.status.kind === "unreachable").length;
  console.log(
    `\nReachability check passed. ${String(CAPABILITIES.length - unreachable)} enforced, ` +
      `${String(unreachable)} declared-but-unreachable and reviewed.`,
  );
}

// ── Run only when this file IS the program ────────────────────────────────
//
// `docs/state-of-the-system.md` carries the human-readable version of the same
// question, and `scripts/unreachable-is-documented.test.ts` reconciles the two
// by IMPORTING the register above. Without this guard that import would run the
// whole check as a side effect and, worse, leak its `process.exitCode` into the
// test run — a check that can silently fail the suite it is being read by.
//
// Compared by real path so the mutation copies in `check-reachability.test.ts`,
// which run from a temporary directory, still execute.
const invokedDirectly = (() => {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (invokedDirectly) main();
