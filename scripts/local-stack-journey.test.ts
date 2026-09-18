/**
 * The journey through the five REAL processes (P121).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * `scripts/journey.test.ts` proves the journey with every plane built in this
 * process: it constructs the apps, injects the browser, calls the runner's turn
 * itself and drains the Secure Plane's outbox by hand. That is the right shape
 * for a proof of the DESIGN, and it is blind to a whole class of defect — the
 * one P120 found: an entry point that does not open the port its tests
 * injected. This file drives the same journey through the processes the
 * local-stack script starts, and touches none of their internals:
 *
 *   - the student's requests go over HTTP to the Conversation Service process;
 *   - the password goes through the real secure frame, in a Chromium THIS file
 *     launches for the student, from the Secure Service process's origin;
 *   - the Secure Service's own background loop delivers the receipt;
 *   - the Background Worker process advances the run — no request of the
 *     student's moves it past the yes;
 *   - the Automation Runner process claims the work, creates the account and
 *     fills the portal in the browser IT launched, with the Fill Agent
 *     process typing the password over CDP.
 *
 * The portal is the fixture portal, started here, and named to the stack by
 * `AAS_PORTAL_ORIGINS` — the deployment fact the runbook documents. What this
 * file asks of the outside is what a person at the keyboard could ask: the
 * HTTP API, the page, and the portal's own record.
 *
 * Against the fixture catalogue. With `AAS_LOCAL_CATALOGUE=registry` and a
 * reviewed entry this is the shape of Run A (docs/distance-to-a-reviewed-
 * sheffield-run.md), which this repository cannot run.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { Redis } from "ioredis";
import { chromium, type Browser } from "playwright";

import { proposeValue, studentId as makeStudentId } from "@askimate/aas-domain";
import type { ConfirmedProfile, ProfileFieldKey, ProfileFieldType } from "@askimate/aas-profile";
import { applyConfirmation, confirmField, emptyProfile, isDeclined, toStoredEntry } from "@askimate/aas-profile";
import { parseConversationRun, parseRunPreview } from "@askimate/aas-contracts";
import { announceSkip, databaseReachable, TEST_DATABASE_URL } from "@askimate/aas-migrate/testing";
import { PostgresConfirmedProfileStore } from "@askimate/aas-conversation-service";
import { startFixturePortal, type FixturePortal } from "@askimate/aas-browser-runner";

const ROOT = join(import.meta.dirname, "..");
const REDIS_URL = process.env["AAS_TEST_REDIS_URL"] ?? "redis://127.0.0.1:56379";
// Its own port range (4960–4969, which no other suite listens on) and its own
// database names: `local-stack.test.ts` and the two secure-plane e2e suites run
// beside this file in the census.
const PORT_BASE = 4960;
const PREFIX = "aas_localstack_journey";
const CONVERSATION_URL = `http://127.0.0.1:${String(PORT_BASE)}`;
const BLUEPRINT = "bp-gated-portal";
const EMAIL = "niloofar@example.test";
const PASSWORD = "Stack-Tr0ub4dor-3-horses!";
const STATEMENT = "Please apply to Gated University for me.";
const APPS = ["conversation-service", "secure-service", "secure-filler", "browser-runner", "worker"] as const;

const HAVE_DATABASE = await databaseReachable();
if (!HAVE_DATABASE) announceSkip("P121 — the journey through the five processes the local-stack script starts");

async function redisReachable(): Promise<boolean> {
  const probe = new Redis(REDIS_URL, { enableOfflineQueue: false, maxRetriesPerRequest: 1, lazyConnect: true });
  try {
    await probe.connect();
    await probe.ping();
    return true;
  } catch {
    return false;
  } finally {
    await probe.quit().catch(() => undefined);
  }
}
const HAVE_REDIS = HAVE_DATABASE ? await redisReachable() : false;
if (HAVE_DATABASE && !HAVE_REDIS && process.env["AAS_REQUIRE_REDIS"] === "1") {
  throw new Error(`P121 needs a Redis at ${REDIS_URL}: the Secure Service and the Fill Agent share one`);
}
const describeIfBoth = HAVE_DATABASE && HAVE_REDIS ? describe : describe.skip;

interface Finished {
  readonly code: number | null;
  readonly output: string;
}

/** The script, with exactly the environment the runbook names. */
function script(command: string, dir: string, portalOrigin: string): Promise<Finished> {
  return new Promise((resolve) => {
    const child = spawn("bash", ["scripts/local-stack.sh", command], {
      cwd: ROOT,
      env: {
        PATH: process.env["PATH"] ?? "",
        HOME: process.env["HOME"] ?? "",
        ...(process.env["PLAYWRIGHT_BROWSERS_PATH"] === undefined ? {} : { PLAYWRIGHT_BROWSERS_PATH: process.env["PLAYWRIGHT_BROWSERS_PATH"] }),
        AAS_LOCAL_DIR: dir,
        AAS_LOCAL_ADMIN_DATABASE_URL: TEST_DATABASE_URL,
        AAS_LOCAL_REDIS_URL: REDIS_URL,
        AAS_LOCAL_PORT_BASE: String(PORT_BASE),
        AAS_LOCAL_DB_PREFIX: PREFIX,
        // The deployment fact: where the fixture catalogue's one blueprint is
        // actually served. The reviewed entry is not rewritten.
        AAS_PORTAL_ORIGINS: `${BLUEPRINT}=${portalOrigin}`,
      },
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
    const timer = setTimeout(() => child.kill("SIGKILL"), 240_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}

/** The script's conversation database: the admin URL with its path replaced, as the script itself derives it. */
function databaseUrl(name: string): string {
  const url = new URL(TEST_DATABASE_URL);
  url.pathname = `/${name}`;
  return url.toString();
}

let dir = "";
let portal: FixturePortal;
let conversationPool: pg.Pool;
let studentUuid = "";
let studentBrowser: Browser;
let profile: ConfirmedProfile;
let cookie = "";
let conversation = "";
let offerHash = "";
let runId = "";
let stackOutput = "";

/** This file's two databases, gone: before the start so a leftover pair cannot carry an earlier student, and after. */
async function dropDatabases(): Promise<void> {
  const admin = new pg.Pool({ connectionString: TEST_DATABASE_URL });
  try {
    for (const name of [`${PREFIX}_conversation`, `${PREFIX}_secure`]) {
      await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    }
  } finally {
    await admin.end();
  }
}

async function confirmInto<K extends ProfileFieldKey>(
  store: PostgresConfirmedProfileStore,
  key: K,
  value: ProfileFieldType<K>,
  verbatim: string,
): Promise<void> {
  const result = applyConfirmation({
    key,
    proposed: proposeValue({ value, origin: "conversation", verbatim, confidence: 1 }),
    confirmation: {
      studentRef: makeStudentId(studentUuid),
      presentedText: "Is that right?",
      response: { kind: "accepted" },
      respondedAt: new Date(),
    },
  });
  if (isDeclined(result)) expect.unreachable(`${key} should have been accepted`);
  profile = confirmField(profile, result, new Date());
  const entry = profile.entries.get(key);
  if (entry === undefined) expect.unreachable(`${key} should be in the profile`);
  await store.save(studentUuid, toStoredEntry(key, entry));
}

/** A request on the student's session, to the Conversation Service process. */
function asStudent(path: string, init: { method?: string; body?: unknown } = {}): Promise<Response> {
  return fetch(`${CONVERSATION_URL}${path}`, {
    method: init.method ?? "GET",
    headers: {
      cookie,
      ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
}

interface RunRead {
  readonly run: ReturnType<typeof parseConversationRun>;
  readonly pending: { decision: string; contentHash: string } | null;
  readonly ownActs: readonly { key: string; done: boolean }[];
}

async function readRun(): Promise<RunRead> {
  const response = await asStudent(`/v1/conversations/${conversation}/runs`);
  expect(response.status, await response.clone().text()).toBe(200);
  const body = (await response.json()) as { run: unknown; pending: RunRead["pending"]; ownActs: RunRead["ownActs"] };
  return { run: parseConversationRun(body.run), pending: body.pending, ownActs: body.ownActs };
}

/**
 * Waits for the processes to bring the run to a PHASE, reading only. Nothing
 * here advances anything: the Worker's clock, the Secure Service's drain and
 * the Runner's poll are what move it, which is the property under test.
 *
 * The phase, not the step: the read route reports the step the run is AT
 * (derived), while the phase is the durable checkpoint the worker writes —
 * the first run of this file saw `request_secret` reported against a
 * checkpoint still at `awaiting_authorisation`, before the worker's tick.
 */
async function untilPhase(phase: string, withinMs: number): Promise<RunRead> {
  const deadline = Date.now() + withinMs;
  let last: RunRead = await readRun();
  while (last.run?.phase !== phase) {
    if (Date.now() > deadline) {
      throw new Error(`the run did not reach ${phase} within ${String(withinMs)}ms; last seen ${JSON.stringify(last.run)}\n${await logs()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    last = await readRun();
  }
  return last;
}

/**
 * What a person would read when the run stops: the five logs, the intent
 * ledger, any intervention with its reason, and the last things the student
 * was told. In the failure message, because CI cannot be asked afterwards.
 */
async function logs(): Promise<string> {
  const parts: string[] = [];
  for (const app of APPS) {
    const text = await readFile(join(dir, `${app}.log`), "utf8").catch(() => "(no log)");
    parts.push(`── ${app}.log ──\n${text.slice(-16_000)}`);
  }
  parts.push(`── portal ──\naccounts ${JSON.stringify(portal.accounts())}; application ${JSON.stringify(portal.application(EMAIL))}; submissions ${JSON.stringify(portal.submissions())}`);
  try {
    const intents = await conversationPool.query<{ action: string; target: string; outcome: string | null }>(
      "SELECT action, target, outcome FROM workflow_action_intents WHERE run_id = $1 ORDER BY started_at",
      [runId],
    );
    parts.push(`── intents ──\n${intents.rows.map((row) => `${row.action} ${row.target} → ${row.outcome ?? "open"}`).join("\n")}`);
    const interventions = await conversationPool.query<{ reason: string; encountered: string; expected: string; lifecycle: string }>(
      "SELECT reason, encountered, expected, lifecycle FROM interventions WHERE run_id = $1",
      [runId],
    );
    parts.push(`── interventions ──\n${interventions.rows.map((row) => `${row.reason} (${row.lifecycle}): encountered ${row.encountered}; expected ${row.expected}`).join("\n")}`);
    const told = await conversationPool.query<{ kind: string; content: string | null }>(
      `SELECT e.kind, mb.content FROM conversation_events e LEFT JOIN message_bodies mb ON mb.id = e.body_id
        WHERE e.conversation_id = $1 ORDER BY e.ordinal DESC LIMIT 4`,
      [conversation],
    );
    parts.push(`── last told ──\n${told.rows.map((row) => `${row.kind}: ${(row.content ?? "").slice(0, 400)}`).join("\n")}`);
  } catch (error) {
    parts.push(`── database ──\n${String(error)}`);
  }
  return parts.join("\n");
}

beforeAll(async () => {
  if (!HAVE_DATABASE || !HAVE_REDIS) return;
  await dropDatabases();
  portal = await startFixturePortal();
  dir = await mkdtemp(join(tmpdir(), "aas-local-stack-journey-"));
  const started = await script("start", dir, portal.baseUrl);
  stackOutput = started.output;
  if (started.code !== 0) throw new Error(`the stack did not start:\n${started.output}`);

  // ── The student, and what they have already said ─────────────────────
  //
  // Seeded into the database the script created, through the same store the
  // interview writes to (the interview has its own suites and its own model).
  // The stack's processes see it exactly as they would see a student who had
  // finished the interview.
  conversationPool = new pg.Pool({ connectionString: databaseUrl(`${PREFIX}_conversation`), max: 2 });
  const student = await conversationPool.query<{ id: string }>(
    "INSERT INTO students (subject, email_verified) VALUES ('oidc-local-stack', true) RETURNING id",
  );
  studentUuid = student.rows[0]!.id;
  profile = emptyProfile(makeStudentId(studentUuid), new Date());
  const profiles = new PostgresConfirmedProfileStore(conversationPool);
  await confirmInto(profiles, "identity.given_name", "Niloofar", "Niloofar");
  await confirmInto(profiles, "identity.family_name", "Hosseini", "Hosseini");
  await confirmInto(profiles, "identity.date_of_birth", new Date("1999-04-02T00:00:00Z"), "2 April 1999");
  await confirmInto(profiles, "identity.nationality", "Iranian", "Iranian");
  await confirmInto(profiles, "contact.email", EMAIL, EMAIL);
  await confirmInto(
    profiles,
    "education.prior_qualifications",
    [
      { level: "Bachelor's degree", subject: "Industrial Engineering", institution: "Sharif University of Technology", countryCode: "IR", start: { year: 2017, month: 9 }, end: { kind: "completed", date: { year: 2021, month: 6 } }, grade: "17.2", gradeScale: "iran_20_point" },
      { level: "High school diploma", subject: "Mathematics and Physics", institution: "Farzanegan High School", countryCode: "IR", start: { year: 2013, month: 9 }, end: { kind: "completed", date: { year: 2017, month: 6 } }, grade: "19.1", gradeScale: "iran_20_point" },
    ],
    "as stated",
  );
  await confirmInto(profiles, "study.personal_statement", "Because it is the course I want.", "…");

  // ── The student's session, minted by the process's own dev route ──────
  const minted = await fetch(`${CONVERSATION_URL}/dev/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subject: studentUuid }),
  });
  if (minted.status !== 204) throw new Error(`the dev session route answered ${String(minted.status)}`);
  const set = minted.headers.getSetCookie().find((line) => line.startsWith("__Host-aas-session="));
  if (set === undefined) throw new Error("the dev session route set no session cookie");
  cookie = set.split(";")[0] ?? "";

  studentBrowser = await chromium.launch({ headless: true });
}, 300_000);

afterAll(async () => {
  if (!HAVE_DATABASE || !HAVE_REDIS) return;
  await studentBrowser.close().catch(() => undefined);
  await conversationPool.end().catch(() => undefined);
  // `AAS_LOCAL_STACK_KEEP=1` leaves the processes, the state directory and the
  // two databases in place, for reading what happened by hand
  // (docs/runbook-local-stack.md, "Reading what happened").
  if (process.env["AAS_LOCAL_STACK_KEEP"] === "1") {
    process.stdout.write(`P121: kept the stack in ${dir} and the databases ${PREFIX}_conversation / ${PREFIX}_secure\n`);
    return;
  }
  if (dir.length > 0) {
    await script("stop", dir, portal.baseUrl).catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  }
  await portal.stop().catch(() => undefined);
  await dropDatabases();
}, 300_000);

describeIfBoth("the journey through the five processes the local-stack script starts", () => {
  it("the stack is up, with the fixture portal named as the deployment's origin", () => {
    expect(stackOutput).toContain("up:");
    expect(stackOutput, "the deployment fact is not echoed with anything else").not.toContain(TEST_DATABASE_URL);
  });

  it("the student opens a conversation, is offered the target, asks for it, and is asked to authorise", async () => {
    const opened = await fetch(`${CONVERSATION_URL}/v1/conversations`, {
      method: "POST",
      headers: { "Idempotency-Key": "local-stack-journey-opens-one", cookie },
    });
    expect(opened.status, await opened.clone().text()).toBe(201);
    conversation = ((await opened.json()) as { id: string }).id;

    const offered = await asStudent(`/v1/conversations/${conversation}/target-offers`, { method: "POST", body: { blueprintId: BLUEPRINT } });
    expect(offered.status, await offered.clone().text()).toBe(201);
    const offer = (await offered.json()) as { offerHash: string; rendered: string };
    offerHash = offer.offerHash;
    // The destination the student reads is the fixture portal this stack was
    // pointed at, not the host the fixture blueprint observed.
    expect(offer.rendered).toContain(portal.host);
    expect(offer.rendered).not.toContain("gated.portal.test");

    const started = await asStudent(`/v1/conversations/${conversation}/runs`, { method: "POST", body: { offerHash, studentStatement: STATEMENT } });
    expect(started.status, await started.clone().text()).toBe(201);
    const run = parseConversationRun(await started.json());
    if (run === null) expect.unreachable("the run did not match the published contract");
    runId = run.runId;
    expect(run.step).toBe("authorise");
    expect(portal.accounts(), "nothing exists before the yes").toEqual([]);
  }, 120_000);

  it("the student reads the preview and says yes; the WORKER PROCESS moves the run to the password without another request", async () => {
    const shown = await asStudent(`/v1/conversations/${conversation}/runs/${runId}/preview`);
    expect(shown.status, await shown.clone().text()).toBe(200);
    const preview = parseRunPreview(await shown.json());
    if (preview === null) expect.unreachable("the preview did not match the published contract");
    expect(preview.presentedText).toContain(`Portal: ${portal.host}`);

    const decided = await asStudent(`/v1/conversations/${conversation}/runs/${runId}/decision`, { method: "POST", body: { kind: "authorise", contentHash: preview.contentHash } });
    expect(decided.status, await decided.clone().text()).toBe(204);

    // The journey file POSTs `/runs` here to advance. This file does not: the
    // Worker process advances on its own clock, and this read is the proof.
    const asking = await untilPhase("awaiting_secret", 90_000);
    expect(asking.run?.step).toBe("request_secret");
    expect(asking.ownActs.map((act) => act.done), "the two certificates the student attaches themselves (ADR-0108)").toEqual([false, false]);
    expect(portal.accounts(), "and still no account").toEqual([]);
  }, 180_000);

  it("the password goes through the REAL frame from the Secure Service process; the runner PROCESS creates the account and fills the portal; the run asks for the account back", async () => {
    const context = await studentBrowser.newContext();
    try {
      const minted = await context.request.post(`${CONVERSATION_URL}/dev/session`, {
        data: { subject: studentUuid },
        headers: { "Content-Type": "application/json" },
      });
      expect(minted.status(), "the session route must mint a cookie").toBe(204);
      const page = await context.newPage();
      const thrown: string[] = [];
      page.on("pageerror", (error) => thrown.push(String(error)));
      await page.goto(CONVERSATION_URL, { waitUntil: "domcontentloaded" });
      const frame = page.frameLocator("#secure iframe");
      await frame.locator("#secure-form").waitFor({ state: "visible", timeout: 30_000 }).catch(async (error: unknown) => {
        throw new Error(`the secure frame did not mount: ${String(error)}\npage errors: ${thrown.join(" | ")}\n${await logs()}`);
      });
      await frame.locator("#secure-password").fill(PASSWORD);
      await frame.locator("#secure-confirmation").fill(PASSWORD);
      await frame.locator("#secure-submit").click();
      await expect
        .poll(async () => await frame.locator("#state").textContent(), { timeout: 20_000 })
        .toContain("received");
      // The Secure Service's OWN loop delivers the receipt; the page learns it
      // from the log and takes the frame down.
      await expect
        .poll(async () => await page.locator("#secure iframe").count(), { timeout: 30_000 })
        .toBe(0);
    } finally {
      await context.close();
    }

    // From here every move is the processes': the worker advances, the runner
    // claims and performs (account, then the pages), the agent types the
    // password over CDP into the runner's browser. This file only reads.
    const handing = await untilPhase("handing_over", 300_000);
    expect(handing.run?.step).toBe("hand_over_account");
    expect(handing.pending?.decision).toBe("confirm_handoff");

    expect(portal.accounts(), "one account, at the student's address").toEqual([EMAIL]);
    expect(portal.credentialsWork(EMAIL, PASSWORD), "with the password the student typed").toBe(true);
    const application = portal.application(EMAIL);
    if (application === null) expect.unreachable("the portal should hold the application");
    expect(application.givenName).toBe("Niloofar");
    expect(application.familyName).toBe("Hosseini");
    expect(application.nationality).toBe("IR");
    expect(application.courseCode).toBe("PG-EX-2026");
    expect(application.qualifications.map((qualification) => qualification.institution)).toEqual([
      "Sharif University of Technology",
      "Farzanegan High School",
    ]);
    expect(application.personalStatement).toBe("Because it is the course I want.");
    expect(portal.submissions(), "filled, not submitted (ADR-0014)").toEqual([]);

    // It was the runner PROCESS: its log says what the turn DID, and this
    // file never performed a turn. Since ADR-0124 the line carries the
    // outcome rather than the word `worked`, which said the same thing for a
    // turn that succeeded and one that failed twice against a live portal.
    const runnerLog = await readFile(join(dir, "browser-runner.log"), "utf8");
    expect(runnerLog).toContain("sign-in/work succeeded");
    expect(runnerLog, "the word Run A's failure hid behind").not.toContain("turn: worked");
  }, 420_000);

  it("the student takes the account back, twice confirmed; the run finishes ready to submit, and nothing was submitted", async () => {
    const confirm = async (): Promise<void> => {
      const read = await readRun();
      expect(read.pending?.decision).toBe("confirm_handoff");
      const response = await asStudent(`/v1/conversations/${conversation}/runs/${runId}/decision`, {
        method: "POST",
        body: { kind: "confirm_handoff", contentHash: read.pending?.contentHash ?? "" },
      });
      expect(response.status, await response.clone().text()).toBe(204);
    };
    await confirm();
    // The worker advances past the first confirmation and asks the second.
    await expect
      .poll(async () => (await readRun()).pending?.contentHash, { timeout: 90_000, interval: 1_000 })
      .not.toBe((await readRun()).pending?.contentHash);
    await confirm();
    const finished = await untilPhase("ready_to_submit", 90_000);
    expect(finished.run?.step).toBe("ready_to_submit");
    expect(portal.submissions(), "still not submitted — ADR-0014").toEqual([]);
  }, 300_000);

  it("the password is in no process's log and in no row of the conversation plane", async () => {
    for (const app of APPS) {
      const text = await readFile(join(dir, `${app}.log`), "utf8");
      expect(text, `${app}.log`).not.toContain(PASSWORD);
    }
    const rows = await conversationPool.query<{ row: string }>(
      "SELECT e::text AS row FROM conversation_events e WHERE e.conversation_id = $1",
      [conversation],
    );
    expect(rows.rows.length).toBeGreaterThan(0);
    for (const { row } of rows.rows) {
      expect(row).not.toContain(PASSWORD);
      expect(row.toLowerCase()).not.toContain("password");
    }
  });
});
