/**
 * P20 — a catalogue on disk, and a real process that refuses to serve it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * `packages/catalogue`'s own suite proves the integrity model in memory. This
 * one proves it survives the two things that actually happen in a deployment:
 * the artefact is a FILE somebody edited, and the thing that refuses it is a
 * PROCESS an operator started.
 *
 * The artefact is the gated TEST portal throughout — a real artefact this
 * repository owns and runs, used to prove the pipeline. It is not a university
 * and nothing here dresses it as one.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import {
  hashOf,
  loadCatalogueDirectory,
  parseReviewedEntryText,
  toCanonical,
  type ReviewedCatalogueEntry,
} from "@askimate/aas-catalogue";
import { GATED_PORTAL_BLUEPRINT, GATED_PORTAL_MAPPING_SET } from "@askimate/aas-mapping/fixtures/gated";
import { announceSkip, databaseReachable, TEST_DATABASE_URL } from "@askimate/aas-migrate/testing";

const ROOT = join(import.meta.dirname, "..");
const TSX = join(ROOT, "node_modules", ".bin", "tsx");
const DATABASE = "aas_p20_catalogue";
const SESSION_SECRET = "a-p20-session-secret-that-is-long-enough-to-pass";

const AUTHOR = "test-specialist-a";
const REVIEWER = "test-specialist-b";

const HAVE_DATABASE = await databaseReachable();
if (!HAVE_DATABASE) announceSkip("P20 — a catalogue on disk, and a process that refuses it");
const describeIfDatabase = HAVE_DATABASE ? describe : describe.skip;

const ENTRY: ReviewedCatalogueEntry = {
  blueprint: GATED_PORTAL_BLUEPRINT,
  mappingSet: GATED_PORTAL_MAPPING_SET,
  requiredDocuments: [],
  institutionRef: "inst-gated",
  courseRef: "course-msc-controlled",
  intakeRef: "2026-09",
  portalAuthentication: {
    portalHost: "gated.portal.test",
    discoveryRunId: "run-gated-1",
    observedAt: new Date("2026-08-30T09:00:00Z"),
    applicantChoosesPassword: true,
    portalIssuesCredential: false,
    passwordlessAvailable: false,
    emailVerificationRequired: false,
    mfaOrOtpRequired: false,
    captchaPresent: false,
    passwordResetAvailable: true,
    credentialsCanBeHandedBack: true,
  },
  passwordDelivery: "askimate_secure_channel",
};

const DOCUMENT = JSON.stringify(toCanonical(ENTRY), null, 2);

/**
 * Writes a catalogue directory.
 *
 * `approve` decides whether `approvals.json` covers the entry actually written
 * — which is the only difference between a catalogue that loads and one that
 * does not.
 */
async function writeCatalogue(input: {
  readonly document: string;
  readonly approve: "the-written-entry" | "the-original-entry" | "nothing";
}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aas-p20-"));
  await mkdir(join(dir, "entries"), { recursive: true });
  await writeFile(join(dir, "entries", "gated-portal.json"), input.document);

  const approvals: unknown[] = [];
  if (input.approve !== "nothing") {
    const text = input.approve === "the-written-entry" ? input.document : DOCUMENT;
    const parsed = parseReviewedEntryText(text);
    if (!parsed.ok) expect.unreachable(`could not parse to approve: ${parsed.refusal.path}`);
    approvals.push({
      contentHash: hashOf(toCanonical(parsed.value)),
      authoredBy: AUTHOR,
      approvedBy: REVIEWER,
      approvedAt: "2026-09-01T10:00:00Z",
      note: "Gated TEST portal. Not a university artefact.",
    });
  }
  await writeFile(join(dir, "approvals.json"), JSON.stringify(approvals, null, 2));
  return dir;
}

function urlFor(database: string): string {
  const url = new URL(TEST_DATABASE_URL);
  url.pathname = `/${database}`;
  return url.toString();
}

/** Runs a process to completion and reports what it said and how it exited. */
async function run(
  app: string,
  args: readonly string[],
  env: Readonly<Record<string, string>>,
): Promise<{ code: number | null; output: string }> {
  const child = spawn(TSX, [`apps/${app}/src/bin.ts`, ...args], {
    cwd: ROOT,
    env: { PATH: process.env["PATH"] ?? "", HOME: process.env["HOME"] ?? "", ...env },
  });
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
  child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
  const code = await new Promise<number | null>((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve(null);
    }, 90_000);
    child.on("close", (exit) => {
      clearTimeout(timer);
      resolve(exit);
    });
  });
  return { code, output };
}

/**
 * Starts a process that is meant to KEEP running, waits for it to say so, and
 * stops it.
 *
 * Used only for the case that succeeds. Every refusal below exits on its own,
 * which is the behaviour under test — a process that refuses to start does not
 * need to be signalled to find out.
 */
async function startThenStop(
  app: string,
  env: Readonly<Record<string, string>>,
  ready: RegExp,
): Promise<{ output: string; code: number | null }> {
  const child: ChildProcessWithoutNullStreams = spawn(TSX, [`apps/${app}/src/bin.ts`], {
    cwd: ROOT,
    env: { PATH: process.env["PATH"] ?? "", HOME: process.env["HOME"] ?? "", ...env },
  });
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
  child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
  const exited = new Promise<number | null>((resolve) => child.on("close", resolve));

  await new Promise<void>((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error(`never ready:\n${output}`)), 60_000);
    const poll = setInterval(() => {
      if (ready.test(output)) {
        clearInterval(poll);
        clearTimeout(deadline);
        resolve();
      }
    }, 100);
    void exited.then(() => {
      clearInterval(poll);
      clearTimeout(deadline);
      reject(new Error(`exited before becoming ready:\n${output}`));
    });
  });

  child.kill("SIGTERM");
  return { output, code: await exited };
}

let baseEnv: Record<string, string>;

beforeAll(async () => {
  if (!HAVE_DATABASE) return;
  const admin = new pg.Pool({ connectionString: TEST_DATABASE_URL });
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${DATABASE} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${DATABASE}`);
  } finally {
    await admin.end();
  }
  baseEnv = {
    AAS_PORT: "4885",
    AAS_CONVERSATION_DATABASE_URL: urlFor(DATABASE),
    AAS_SESSION_SECRET: SESSION_SECRET,
    AAS_SECURE_ORIGIN: "http://127.0.0.1:4886",
    AAS_SECURE_INTERNAL_URL: "http://127.0.0.1:4886",
    AAS_SECURE_SERVICE_TOKEN: "conversation-service",
    AAS_SERVICE_CERT_SECURE: "secure-service",
    AAS_SERVICE_CERT_RUNNER: "browser-runner",
  };

  // `migrate` is a command mode and still reads the whole configuration, so it
  // is given one — the same shape every other startup test uses.
  const migrated = await run("conversation-service", ["migrate"], {
    ...baseEnv,
    AAS_CATALOGUE: "fixtures",
  });
  if (migrated.code !== 0) throw new Error(`migrate failed:\n${migrated.output}`);
}, 180_000);

afterAll(() => undefined);

describe("a catalogue directory", () => {
  it("loads when approvals.json covers the entry beside it", async () => {
    const dir = await writeCatalogue({ document: DOCUMENT, approve: "the-written-entry" });
    const load = await loadCatalogueDirectory({ directory: dir });
    if (!load.ok) expect.unreachable(load.problems.map((p) => `${p.source}: ${p.detail}`).join("\n"));
    expect(load.catalogue.size).toBe(1);
    expect(await load.catalogue.find("bp-gated-portal")).not.toBeNull();
  }, 60_000);

  it("REFUSES a file edited after it was approved", async () => {
    // ═══════════════════════════════════════════════════════════════════
    // The scenario ADR-0057 exists for, played out on real files: somebody
    // approves an entry, then edits the file. Every reviewer-looking field is
    // left exactly as approved.
    // ═══════════════════════════════════════════════════════════════════
    const edited = JSON.parse(DOCUMENT) as Record<string, unknown>;
    edited["intakeRef"] = "2027-01";

    const dir = await writeCatalogue({
      document: JSON.stringify(edited, null, 2),
      approve: "the-original-entry",
    });

    // The approval on disk is real and well-formed; it just covers other bytes.
    const approvals = JSON.parse(await readFile(join(dir, "approvals.json"), "utf8")) as unknown[];
    expect(approvals).toHaveLength(1);

    const load = await loadCatalogueDirectory({ directory: dir });
    if (load.ok) expect.unreachable("an edited entry must not load");
    expect(load.problems[0]?.detail).toContain("No approval exists");
    expect(load.problems[0]?.source).toContain("gated-portal.json");
  }, 60_000);

  it("REFUSES when approvals.json is missing entirely", async () => {
    const dir = await mkdtemp(join(tmpdir(), "aas-p20-"));
    await mkdir(join(dir, "entries"), { recursive: true });
    await writeFile(join(dir, "entries", "gated-portal.json"), DOCUMENT);
    const load = await loadCatalogueDirectory({ directory: dir });
    if (load.ok) expect.unreachable("no registry approves nothing");
    expect(load.problems.some((p) => p.source === "approvals.json")).toBe(true);
  }, 60_000);

  it("REFUSES an approvals file whose two names are the same person", async () => {
    const dir = await writeCatalogue({ document: DOCUMENT, approve: "the-written-entry" });
    const parsed = parseReviewedEntryText(DOCUMENT);
    if (!parsed.ok) expect.unreachable("fixture parses");
    await writeFile(
      join(dir, "approvals.json"),
      JSON.stringify([
        {
          contentHash: hashOf(toCanonical(parsed.value)),
          authoredBy: AUTHOR,
          approvedBy: AUTHOR,
          approvedAt: "2026-09-01T10:00:00Z",
        },
      ]),
    );
    const load = await loadCatalogueDirectory({ directory: dir });
    if (load.ok) expect.unreachable("self-approval is not review");
    expect(load.problems[0]?.detail).toContain("draft with a signature on it");
  }, 60_000);

  it("reports EVERY problem, not just the first", async () => {
    // An operator fixing a catalogue one refusal per restart is an operator who
    // will eventually look for a way to turn the check off (ADR-0055).
    const dir = await writeCatalogue({ document: DOCUMENT, approve: "nothing" });
    await writeFile(join(dir, "entries", "second.json"), '{"not":"an entry"}');
    const load = await loadCatalogueDirectory({ directory: dir });
    if (load.ok) expect.unreachable("neither entry is loadable");
    expect(load.problems.length).toBeGreaterThanOrEqual(2);
  }, 60_000);

  it("applies a deployment origin without changing what was approved", async () => {
    const dir = await writeCatalogue({ document: DOCUMENT, approve: "the-written-entry" });
    const load = await loadCatalogueDirectory({
      directory: dir,
      portalOrigins: { "bp-gated-portal": "https://uat.gated.portal.test" },
    });
    if (!load.ok) expect.unreachable(load.problems.map((p) => p.detail).join("\n"));
    const entry = await load.catalogue.find("bp-gated-portal");
    expect(entry?.portalOrigin).toBe("https://uat.gated.portal.test");
    // The same hash as the run with no origin: the origin is not in the artefact.
    const plain = await loadCatalogueDirectory({ directory: dir });
    if (!plain.ok) expect.unreachable("should load");
    expect(load.catalogue.inventory()[0]?.contentHash).toBe(
      plain.catalogue.inventory()[0]?.contentHash,
    );
  }, 60_000);
});

describeIfDatabase("the Conversation Service, started for real", () => {
  it("STARTS on a catalogue whose entry is approved, and says what it serves", async () => {
    const dir = await writeCatalogue({ document: DOCUMENT, approve: "the-written-entry" });
    const started = await startThenStop(
      "conversation-service",
      { ...baseEnv, AAS_CATALOGUE: "registry", AAS_CATALOGUE_DIR: dir },
      /conversation service listening/,
    );
    expect(started.output).toContain("catalogue=registry");
    // And it shut down cleanly, so this asserts a working process rather than
    // one that merely got as far as printing a line.
    expect(started.code, started.output).toBe(0);
  }, 120_000);

  it("REFUSES TO START when the catalogue holds an unapproved entry", async () => {
    // ═══════════════════════════════════════════════════════════════════
    // The assertion that makes the rest of P20 matter to a deployment. The
    // process does not start degraded, does not serve a smaller catalogue and
    // does not log a warning — it exits non-zero and names the file.
    // ═══════════════════════════════════════════════════════════════════
    const dir = await writeCatalogue({ document: DOCUMENT, approve: "nothing" });
    const started = await run("conversation-service", [], {
      ...baseEnv,
      AAS_CATALOGUE: "registry",
      AAS_CATALOGUE_DIR: dir,
    });
    expect(started.code, started.output).not.toBe(0);
    expect(started.output).toContain("No approval exists");
    expect(started.output).toContain("gated-portal.json");
  }, 120_000);

  it("REFUSES a production start on the fixture catalogue, as it always has", async () => {
    const started = await run("conversation-service", [], {
      ...baseEnv,
      NODE_ENV: "production",
      AAS_CATALOGUE: "fixtures",
      AAS_SECURE_ORIGIN: "https://secure.example.test",
      AAS_SECURE_INTERNAL_URL: "https://secure.example.test",
    });
    expect(started.code, started.output).not.toBe(0);
    expect(started.output).toContain("AAS_CATALOGUE");
    expect(started.output).toContain("TEST portal");
  }, 120_000);

  it("REFUSES 'registry' with no directory to read", async () => {
    const started = await run("conversation-service", [], {
      ...baseEnv,
      AAS_CATALOGUE: "registry",
    });
    expect(started.code, started.output).not.toBe(0);
    expect(started.output).toContain("AAS_CATALOGUE_DIR");
  }, 120_000);
});

describeIfDatabase("the Background Worker reads the same catalogue", () => {
  it("REFUSES an unapproved entry exactly as the service does", async () => {
    // ADR-0041: a worker that served an artefact the service would refuse is
    // the second opinion the shared wiring exists to prevent.
    const dir = await writeCatalogue({ document: DOCUMENT, approve: "nothing" });
    const started = await run("worker", [], {
      AAS_CONVERSATION_DATABASE_URL: urlFor(DATABASE),
      AAS_WORKER_HOLDER: "p20-worker",
      AAS_SECURE_INTERNAL_URL: "http://127.0.0.1:4886",
      AAS_SECURE_SERVICE_TOKEN: "worker",
      AAS_CATALOGUE: "registry",
      AAS_CATALOGUE_DIR: dir,
    });
    expect(started.code, started.output).not.toBe(0);
    expect(started.output).toContain("No approval exists");
  }, 120_000);
});
