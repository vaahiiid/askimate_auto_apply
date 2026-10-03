/**
 * P276, row 131: what did the old stripping MISS?
 *
 *   pnpm exec tsx scripts/measure-what-the-stripping-missed.ts        (REF=<commit> to measure another history)
 *
 * Reads git history only; changes nothing.
 */
// Every site's current rule,
// applied to every version in history of every file that site reads — once
// through the old regular expressions, once through the parser. A verdict
// that differs is reported: HIDDEN (the parser's reading breaks the rule and
// the old did not) or PHANTOM (the old reading broke it and the parser's
// does not). The work-contract and workflow sites read a declaration's
// structure rather than search for a call, and are not measured here.
import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";

import { codeOnly, withoutComments } from "./source-text.js";

const C = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ");
const old4 = (s: string) => C(s).replace(/\/\/[^\n]*/g, " ").replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/`(?:[^`\\]|\\.)*`/g, "``");
const old3 = (s: string) => C(s).replace(/\/\/[^\n]*/g, " ").replace(/"(?:[^"\\]|\\.)*"/g, '""');
const old2 = (s: string) => C(s).replace(/\/\/[^\n]*/g, " ");
const oldLs = (s: string) => C(s).replace(/^\s*\/\/.*$/gm, " ");
const oldLs0 = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const oldReach = (s: string) => C(s).replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const top = (dir: string) => (p: string) => p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes("/") && p.endsWith(".ts");
const includes = (list: string[]) => (code: string) => list.filter((f) => code.includes(f));
const SECRET_NAMES = ["aas-secrets", "secrets/src", "InMemorySecretStore", "EnvelopeVault", "LocalDataKeyProvider", "getSecret", "useSecret"];
const DECISIONS = ["openSecretRequest", "latestSecretRequest", "composerPolicy", "decideRendering", "projectTranscript", "buildModelRequest"];
const CONFIRMED_CAST = /\bas\s+(?:unknown\s+as\s+)?(?:(?:[A-Za-z_$][\w$]*|import\([^)]*\))\s*\.\s*)*ConfirmedValue\b/;
interface Site { name: string; files: (p: string) => boolean; old: (s: string) => string; fresh: (s: string, f: string) => string; rule: (code: string) => string[] }
const SITES: Site[] = [
  { name: "sensitive fill path", files: (p) => ["apps/browser-runner/src/playwright-fill-session.ts", "apps/browser-runner/src/sensitive.ts"].includes(p), old: old4, fresh: codeOnly, rule: includes(["tracing.start", "recordVideo"]) },
  { name: "runner names no secret", files: top("apps/browser-runner/src"), old: old2, fresh: withoutComments, rule: includes(SECRET_NAMES) },
  { name: "worker names no secret", files: top("apps/worker/src"), old: old2, fresh: withoutComments, rule: includes(SECRET_NAMES) },
  { name: "conversation names no secret", files: top("apps/conversation-service/src"), old: old2, fresh: withoutComments, rule: includes(SECRET_NAMES) },
  { name: "operator CLI writes nothing", files: (p) => p === "scripts/interventions.ts", old: old4, fresh: codeOnly,
    rule: (code) => ["pg", "aas-case-store", "InterventionStore", "PostgresInterventionStore", "WorkflowRunStore", "ConversationEventStore"].filter((f) => new RegExp(`(^|[^\\w-])${f}([^\\w-]|$)`).test(code)) },
  { name: "driver decides nothing", files: (p) => p === "apps/conversation-service/src/run-driver.ts", old: old4, fresh: codeOnly,
    rule: (code) => [...includes(["step.kind ==", "step.kind !=", "switch (step", "phaseFor(", "deriveCheckpoint("])(code), ...["requiresSecureRequest(", "nextStep("].filter((r) => !code.includes(r)).map((r) => `missing ${r}`)] },
  { name: "planning reads no requiredDocuments", files: (p) => ["packages/orchestrator/src", "packages/mapping/src", "packages/preparation/src", "packages/execution/src"].some((d) => top(d)(p)) && !p.endsWith(".test.ts"), old: old2, fresh: withoutComments, rule: includes(["requiredDocuments"]) },
  { name: "secure client carries no value", files: (p) => p === "apps/conversation-service/src/secure-requests.ts", old: old2, fresh: withoutComments, rule: includes(['record["value"]', 'record["secret"]', 'record["password"]', 'record["plaintext"]', "as OpenedSecureRequest", "/secret`", '/secret"']) },
  { name: "work intake decides nothing", files: (p) => p === "apps/browser-runner/src/work-intake.ts", old: old2, fresh: withoutComments, rule: includes(["nextStep(", "work.kind ===", "switch (work", "as ClaimedWork", "planFill(", "ConfirmedValue"]) },
  { name: "account creation holds no credential", files: (p) => p === "apps/browser-runner/src/create-account.ts", old: old2, fresh: withoutComments, rule: includes(["inputValue()", "randomBytes", "generatePassword", "EnvelopeVault", "tracing.start", "recordVideo"]) },
  { name: "fill agent leaks nothing", files: (p) => ["apps/secure-filler/src/fill.ts", "apps/secure-filler/src/app.ts"].includes(p), old: old4, fresh: codeOnly,
    rule: (code) => [...(/console\.(log|debug|info|warn|error|trace|dir)\s*\(/.test(code) ? ["console call"] : []), ...includes(["tracing.start", "recordVideo", "JSON.stringify(secret", "inputValue()"])(code)] },
  { name: "no secret getter", files: top("packages/secrets/src"), old: old3, fresh: codeOnly, rule: (code) => (/\bgetSecret\b|\bpeekSecret\b|\brevealSecret\b/.test(code) ? ["getter"] : []) },
  { name: "no ConfirmedValue cast", files: (p) => (p.startsWith("packages/") || p.startsWith("apps/")) && p.endsWith(".ts") && !p.endsWith(".test.ts") && !p.includes("packages/profile/src/"), old: old2, fresh: withoutComments, rule: (code) => (CONFIRMED_CAST.test(code) ? ["cast"] : []) },
  { name: "one implementation per decision", files: (p) => /^(apps|packages)\/[^/]+\/src\/[^/]+\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p) && !p.startsWith("packages/conversation/"), old: oldLs0, fresh: withoutComments,
    rule: (code) => DECISIONS.filter((d) => new RegExp(`(export\\s+)?function\\s+${d}\\s*[(<]|(const|let|var)\\s+${d}\\s*(:[^=]+)?=\\s*(\\(|function|async)`).test(code)) },
  { name: "CSP not weakened", files: (p) => p === "apps/secure-service/src/control-document.ts", old: oldLs, fresh: withoutComments, rule: includes(["'unsafe-inline'", "'unsafe-eval'", "script-src *", "connect-src *"]) },
  { name: "no third origin", files: (p) => ["apps/secure-service/src/control-document.ts", "apps/secure-service/src/control-client.ts"].includes(p), old: oldLs, fresh: withoutComments, rule: (code) => [...code.matchAll(/https?:\/\/[A-Za-z0-9.-]+/g)].map((m) => m[0]) },
  { name: "no wildcard targetOrigin", files: (p) => ["apps/secure-service/src/control-client.ts", "apps/conversation-service/src/client/journey.ts"].includes(p), old: oldLs, fresh: withoutComments, rule: (code) => (/postMessage\s*\([\s\S]*?,\s*["'`]\*["'`]\s*,?\s*\)/.test(code) ? ["wildcard"] : []) },
  { name: "one transaction owner", files: (p) => p === "apps/secure-service/src/routes.ts", old: oldLs, fresh: withoutComments, rule: (code) => (/query\(\s*["'`](BEGIN|COMMIT|ROLLBACK)/.test(code) ? ["transaction"] : []) },
];
const ROOT = join(import.meta.dirname, "..");
const SYMBOLS = [...execFileSync("cat", ["scripts/check-reachability.ts"], { cwd: ROOT, encoding: "utf8" }).matchAll(/symbol: "([A-Za-z_]+)"/g)].map((m) => m[1] ?? "");
const log = execFileSync("git", ["log", "--reverse", "--format=@%H", "--name-only", "--diff-filter=AM", process.env["REF"] ?? "origin/main", "--", "apps", "packages", "scripts/interventions.ts"], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 });
const versions: { sha: string; path: string }[] = [];
let sha = "";
for (const line of log.split("\n")) {
  if (line.startsWith("@")) sha = line.slice(1);
  else if (/\.(ts|tsx)$/.test(line.trim()) && !line.includes("/dist/")) versions.push({ sha, path: line.trim() });
}
let checked = 0;
const differences: string[] = [];
const reach: string[] = [];
for (const { sha: at, path } of versions) {
  const sites = SITES.filter((site) => site.files(path));
  const got = spawnSync("git", ["show", `${at}:${path}`], { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 26 });
  if (got.status !== 0) continue;
  const source = got.stdout;
  for (const site of sites) {
    checked += 1;
    const before = site.rule(site.old(source)).sort().join(", ");
    const after = site.rule(site.fresh(source, path)).sort().join(", ");
    if (before !== after) differences.push(`${at.slice(0, 8)}  ${path}  [${site.name}]  old: {${before}}  parser: {${after}}`);
  }
  if (!path.endsWith(".test.ts")) {
    const o = oldReach(source), n = withoutComments(source, path);
    for (const sym of SYMBOLS) {
      const count = (s: string) => (s.match(new RegExp(`\\b${sym}\\s*\\(|["'\`]${sym}["'\`]`, "g")) ?? []).length;
      if (count(n) > count(o)) reach.push(`${at.slice(0, 8)}  ${path}  ${sym}: old ${String(count(o))}, parser ${String(count(n))}`);
    }
  }
}
console.log(`file versions in history: ${String(versions.length)}; (version, site) readings compared: ${String(checked)}`);
console.log(`verdicts that differ: ${String(differences.length)}`);
for (const d of differences) console.log(`  ${d}`);
console.log(`reachability: a registered symbol's use visible to the parser and not to the old stripping: ${String(reach.length)}`);
for (const r of reach) console.log(`  ${r}`);
