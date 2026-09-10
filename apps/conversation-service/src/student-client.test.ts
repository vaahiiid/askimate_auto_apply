/**
 * The student's own page, in a real browser, against the real service.
 *
 * ── Why this file lives here ──────────────────────────────────────────────
 *
 * Beside the client it serves. The research build removed in P53 said the same
 * of its own browser test — *"the test that boots the real Conversation Service
 * lives beside the client it serves … it moves with the client"* — and that is
 * the rule this file follows rather than a reference to it. It is also
 * the only place with DOM types, which a Playwright `evaluate` callback needs
 * even though it runs in the browser.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ADR-0060, ADR-0061. Everything below runs against a real Chromium page, a
 * real Express server, a real PostgreSQL log and a real `EventSource`. The
 * page is built from the sources in the tree by `buildStudentClient`, so what
 * is tested is what is written.
 *
 * What this file is FOR is the property the client exists to have: it holds no
 * workflow truth. Every test either drives the journey through the page, or
 * reloads it and asserts the screen comes back — from the server, because the
 * page kept nothing.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { Server } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { Server as HttpsServer } from "node:https";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import pg from "pg";

import { migrate } from "@askimate/aas-migrate";
import {
  announceSkip,
  databaseReachable,
  TEST_DATABASE_URL,
} from "@askimate/aas-migrate/testing";
import { MIGRATIONS_DIR as CASE_MIGRATIONS } from "@askimate/aas-case-store";
import { PostgresCaseStore } from "@askimate/aas-case-store/postgres";
import { PostgresWorkflowRunStore } from "@askimate/aas-case-store/postgres-workflow";
import { PostgresInterventionStore } from "@askimate/aas-case-store/postgres-interventions";
import { DeterministicModelClient } from "@askimate/aas-llm";
import { targetOf, type ReviewedTarget } from "@askimate/aas-catalogue";
import {
  FIXTURE_BLUEPRINT,
  FIXTURE_MAPPING_SET,
} from "@askimate/aas-mapping/fixtures";
import {
  GATED_PORTAL_BLUEPRINT,
  GATED_PORTAL_MAPPING_SET,
} from "@askimate/aas-mapping/fixtures/gated";

import { ApplicationBindingStore } from "./application-store.js";
import { ConversationEventStore } from "./event-store.js";
import { MIGRATIONS_DIR } from "./index.js";
import { PostgresConfirmedProfileStore } from "./profile-store.js";
import {
  applyConfirmation,
  confirmField,
  emptyProfile,
  isDeclined,
  toStoredEntry,
} from "@askimate/aas-profile";
import type { ProfileFieldKey, ProfileFieldType } from "@askimate/aas-profile";
import {
  askimateActor,
  decide,
  externalRef,
  fold,
  caseId as makeCaseId,
  proposeValue,
  stamp,
  studentId,
} from "@askimate/aas-domain";
import { RunDriver } from "./run-driver.js";
import type { ApplicationCatalogue, CatalogueEntry } from "./run-driver.js";
import { StudentIdentityStore } from "./identity-store.js";
import { WorkLeaseStore } from "./work-store.js";
import { buildStudentClient } from "./build-client.js";
import { createConversationApp } from "./app.js";
import { b2Register } from "@askimate/aas-disclosure";
import { InMemoryDocumentVault, InMemoryObjectStore } from "@askimate/aas-documents";
import { InMemoryDocumentIntakePort } from "./document-intake-store.js";
import { loadGoverningSchedule } from "./wiring.js";

const PORT = 4930;
const BASE = `http://127.0.0.1:${String(PORT)}`;
/**
 * The bucket, on an origin of its own (ADR-0092). HTTPS because
 * `assertBoundUploadUrl` refuses any other scheme, and a test that loosened
 * that for its own convenience would be proving a URL nothing may mint.
 */
const BUCKET_PORT = 4932;
const BUCKET_ORIGIN = `https://127.0.0.1:${String(BUCKET_PORT)}`;
const SECRET = "a-p25-session-secret-that-is-long-enough";
const DATABASE = "aas_p25_client";

const HAVE_DATABASE = await databaseReachable();
if (!HAVE_DATABASE) announceSkip("P25 — the student's page in a real browser");
const describeIfDatabase = HAVE_DATABASE ? describe : describe.skip;

/**
 * A fabricated content hash for a compiled-in entry.
 *
 * Named as fabricated so nobody reads it as an approval. The registry-backed
 * path is exercised by `p21-target-selection.test.ts`.
 */
const TEST_CONTENT_HASH = `sha256:${"a".repeat(64)}`;

const ENTRY: CatalogueEntry = {
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

/**
 * A second reviewed route to the SAME course and intake as `ENTRY`.
 *
 * Its only job is to make the pair AMBIGUOUS, so the listing flags both and
 * the page has to show the student what distinguishes them (ADR-0058). One
 * unambiguous target would leave that branch of the page untested.
 */
const PARTNER: CatalogueEntry = {
  ...ENTRY,
  blueprint: {
    ...GATED_PORTAL_BLUEPRINT,
    blueprintId:
      "bp-gated-partner" as typeof GATED_PORTAL_BLUEPRINT.blueprintId,
    route: "partner_portal",
  },
  mappingSet: {
    ...GATED_PORTAL_MAPPING_SET,
    mappingSetId: "map-gated-partner",
    blueprintId: "bp-gated-partner",
  },
};

/**
 * A target with no login at all, so a run against it goes straight to the
 * INTERVIEW — which is the only way this test reaches a pending decision
 * through the page. The gated portal stops at a secure step instead.
 */
const OPEN_ENTRY: CatalogueEntry = {
  blueprint: FIXTURE_BLUEPRINT,
  mappingSet: FIXTURE_MAPPING_SET,
  requiredDocuments: [],
  institutionRef: "inst-example",
  courseRef: "course-msc-example",
  intakeRef: "2026-09",
};

const BY_ID: Readonly<Record<string, CatalogueEntry>> = {
  "bp-gated-portal": ENTRY,
  "bp-gated-partner": PARTNER,
  [String(FIXTURE_BLUEPRINT.blueprintId)]: OPEN_ENTRY,
};

const CATALOGUE: ApplicationCatalogue & {
  targets(): readonly ReviewedTarget[];
} = {
  find: (id) => Promise.resolve(BY_ID[id] ?? null),
  targets: () =>
    [ENTRY, PARTNER, OPEN_ENTRY].map((entry) =>
      targetOf({ entry, contentHash: TEST_CONTENT_HASH }),
    ),
};

/** Clicks the target whose row names this course. */
async function chooseCourse(courseName: string): Promise<void> {
  const row = page.locator("#targets .target", { hasText: courseName }).first();
  await row.locator("button").first().click();
}

let pool: pg.Pool;
let server: Server;
let browser: Browser;
/**
 * Assigned by the first `visitAs`/`visitAnonymously`, so it is genuinely absent
 * before then and after an early `beforeAll` return. `closeCurrentPage` is the
 * only place that has to care.
 */
let page: Page;

/** Closes whatever context is open, tolerating there not being one yet. */
async function closeCurrentPage(): Promise<void> {
  const open = page as Page | undefined;
  if (open === undefined) return;
  await open
    .context()
    .close()
    .catch(() => undefined);
}
let publicDir: string;
let driver: RunDriver;
let bucketServer: HttpsServer;
/** The in-memory bucket the browser's PUT lands in, behind the HTTPS listener. */
let objects: InMemoryObjectStore;
/** What the bucket saw: every preflight and every PUT, for the assertions. */
const bucketLog: { readonly kind: "preflight" | "put"; readonly path: string; readonly headers: Readonly<Record<string, string>>; readonly status: number; readonly bytes: number }[] = [];

/**
 * The CORS rule, READ FROM THE PROVISIONING REQUEST rather than written here.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * `docs/provisioning-request-document-vault.md` tells Vahid what to put on the
 * bucket, in a JSON block. This test stands a bucket in front of the page
 * that admits EXACTLY that rule and nothing else — origin, method, headers —
 * so the document's claim that the page's PUT is admitted is proved by the
 * PUT the page actually makes, against the rule as written. A header the page
 * starts sending that the document does not list fails here, not on Vahid's
 * bucket.
 * ═══════════════════════════════════════════════════════════════════════════
 */
interface CorsRule {
  readonly AllowedOrigins: readonly string[];
  readonly AllowedMethods: readonly string[];
  readonly AllowedHeaders: readonly string[];
  readonly ExposeHeaders: readonly string[];
  readonly MaxAgeSeconds: number;
}

function documentedCorsRule(): CorsRule {
  const request = readFileSync(
    join(import.meta.dirname, "..", "..", "..", "docs", "provisioning-request-document-vault.md"),
    "utf8",
  );
  const section = request.slice(request.indexOf("### Bucket CORS"));
  const match = /```json\n([\s\S]*?)```/.exec(section);
  if (match?.[1] === undefined) throw new Error("the provisioning request has no CORS JSON block");
  const rules = JSON.parse(match[1]) as CorsRule[];
  const rule = rules[0];
  if (rule === undefined || rules.length !== 1) throw new Error("expected exactly one CORS rule");
  // The one substitution: the placeholder origin becomes this test's page.
  return { ...rule, AllowedOrigins: rule.AllowedOrigins.map((o) => (o.startsWith("https://<") ? BASE : o)) };
}

/** A self-signed certificate for the bucket's loopback listener, minted for this run only. */
function selfSigned(dir: string): { key: Buffer; cert: Buffer } {
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
    "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1",
    "-keyout", join(dir, "bucket-key.pem"), "-out", join(dir, "bucket-cert.pem"),
  ], { stdio: "ignore" });
  return { key: readFileSync(join(dir, "bucket-key.pem")), cert: readFileSync(join(dir, "bucket-cert.pem")) };
}

/**
 * The bucket's HTTP face: the documented CORS rule, then `InMemoryObjectStore.put`.
 *
 * A preflight outside the rule is answered WITHOUT CORS headers, which is
 * what S3 does and what makes the browser refuse the PUT. A PUT is handed to
 * the same store the route tests use, so what it refuses is what the run of
 * 2026-09-09 saw S3 refuse.
 */
function startBucket(dir: string): Promise<HttpsServer> {
  const rule = documentedCorsRule();
  const allowedHeaders = new Set(rule.AllowedHeaders.map((h) => h.toLowerCase()));
  const server = createHttpsServer(selfSigned(dir), (req, res) => {
    const origin = req.headers["origin"] ?? "";
    const path = req.url ?? "/";
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(req.headers)) {
      if (typeof value === "string") headers[name.toLowerCase()] = value;
    }
    const permitted = rule.AllowedOrigins.includes(origin);

    if (req.method === "OPTIONS") {
      const requested = (headers["access-control-request-headers"] ?? "")
        .split(",")
        .map((h) => h.trim().toLowerCase())
        .filter((h) => h.length > 0);
      const method = headers["access-control-request-method"] ?? "";
      const admitted =
        permitted && rule.AllowedMethods.includes(method) && requested.every((h) => allowedHeaders.has(h));
      bucketLog.push({ kind: "preflight", path, headers, status: admitted ? 204 : 403, bytes: 0 });
      if (!admitted) {
        res.writeHead(403).end();
        return;
      }
      res.writeHead(204, {
        "access-control-allow-origin": origin,
        "access-control-allow-methods": rule.AllowedMethods.join(", "),
        "access-control-allow-headers": rule.AllowedHeaders.join(", "),
        "access-control-max-age": String(rule.MaxAgeSeconds),
      }).end();
      return;
    }

    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const result =
        req.method === "PUT"
          ? objects.put(`${BUCKET_ORIGIN}${path}`, headers, new Uint8Array(body), new Date())
          : { status: 405, code: "MethodNotAllowed" };
      bucketLog.push({ kind: "put", path, headers, status: result.status, bytes: body.byteLength });
      const cors = permitted
        ? { "access-control-allow-origin": origin, "access-control-expose-headers": rule.ExposeHeaders.join(", ") }
        : {};
      if (result.code === null) {
        res.writeHead(result.status, { ...cors, etag: `"${createHash("md5").update(body).digest("hex")}"` }).end();
      } else {
        res.writeHead(result.status, { ...cors, "content-type": "application/xml" })
          .end(`<Error><Code>${result.code}</Code></Error>`);
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(BUCKET_PORT, "127.0.0.1", () => resolve(server));
  });
}
let student: string;
let otherStudent: string;

function connectionString(): string {
  const url = new URL(TEST_DATABASE_URL);
  url.pathname = `/${DATABASE}`;
  return url.toString();
}

/**
 * Opens the page as one student.
 *
 * The session is a real `__Host-` cookie, set by the browser from a real
 * `Set-Cookie`. NOT injected with `addCookies`: `__Host-` has browser-enforced
 * rules — Secure, Path=/, no Domain — and a test that set the cookie by hand
 * would prove the page works with a cookie the browser would have refused.
 * (Loopback is a secure context, so `Secure` is accepted over http here.)
 *
 * A fresh context per student, so one student's cookie jar is never the other's.
 */
async function visitAs(subject: string): Promise<void> {
  await closeCurrentPage();
  // `ignoreHTTPSErrors` is for the BUCKET's self-signed certificate only; the
  // page itself is plain loopback HTTP, where `__Host-` is accepted.
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  page = await context.newPage();
  watch(page);

  const minted = await page.request.post(`${BASE}/dev/session`, {
    data: { subject },
    headers: { "Content-Type": "application/json" },
  });
  expect(minted.status(), "the session route must mint a cookie").toBe(204);
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
}

/** A page with no session at all. */
async function visitAnonymously(): Promise<void> {
  await closeCurrentPage();
  const context = await browser.newContext();
  page = await context.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
}

/**
 * Confirms one field the way the interview does, and stores it.
 *
 * Through `applyConfirmation` — the one minter of a `ConfirmedValue` — so the
 * seeded profile is indistinguishable from one a student filled in. Used by the
 * escalation test to leave exactly ONE field outstanding: `nextAction` skips an
 * exhausted field and asks the next, so it escalates only when every
 * outstanding field is exhausted, and exhausting six through a browser would be
 * eighteen round trips to prove a thing three prove.
 */
async function confirmFieldFor<K extends ProfileFieldKey>(
  subject: string,
  key: K,
  value: ProfileFieldType<K>,
  /**
   * What the student said. Given explicitly rather than stringified from the
   * value: not every field type is a string, and `String(aDate)` or
   * `String(anAddress)` is not what anybody typed.
   */
  verbatim: string,
): Promise<void> {
  const when = new Date();
  const result = applyConfirmation({
    key,
    proposed: proposeValue({
      value,
      origin: "conversation",
      verbatim,
      confidence: 1,
    }),
    confirmation: {
      studentRef: studentId(subject),
      presentedText: "Is that right?",
      response: { kind: "accepted" },
      respondedAt: when,
    },
  });
  if (isDeclined(result))
    expect.unreachable(`${key} should have been accepted`);
  const profile = confirmField(
    emptyProfile(studentId(subject), when),
    result,
    when,
  );
  const entry = profile.entries.get(key);
  if (entry === undefined)
    expect.unreachable(`${key} should be in the profile`);
  await new PostgresConfirmedProfileStore(pool).save(
    subject,
    toStoredEntry(key, entry),
  );
}

/** Waits for a selector to hold text, so a test never races the render. */
async function textOf(selector: string, timeout = 15_000): Promise<string> {
  await page.waitForFunction(
    (query: string) =>
      (document.querySelector(query)?.textContent ?? "").length > 0,
    selector,
    { timeout },
  );
  return (await page.locator(selector).textContent()) ?? "";
}

beforeAll(async () => {
  if (!HAVE_DATABASE) return;
  const admin = new pg.Pool({ connectionString: TEST_DATABASE_URL });
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${DATABASE} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${DATABASE}`);
  } finally {
    await admin.end();
  }

  pool = new pg.Pool({ connectionString: connectionString(), max: 8 });
  await migrate(pool, CASE_MIGRATIONS);
  await migrate(pool, MIGRATIONS_DIR);

  const first = await pool.query<{ id: string }>(
    "INSERT INTO students (subject, email_verified) VALUES ('oidc-p25-a', true) RETURNING id",
  );
  student = first.rows[0]!.id;
  const second = await pool.query<{ id: string }>(
    "INSERT INTO students (subject, email_verified) VALUES ('oidc-p25-b', true) RETURNING id",
  );
  otherStudent = second.rows[0]!.id;

  publicDir = await mkdtemp(`${tmpdir()}/aas-p25-`);
  await buildStudentClient(publicDir);

  // ── The document transport, over a bucket the browser can reach ─────────
  //
  // The REAL governing schedule (`config/retention`) and the real register,
  // so what the page is offered and what the gates refuse is what production
  // would offer and refuse. The vault is in memory — this port is refused in
  // production — but its bucket is behind a real HTTPS origin, so the PUT the
  // page makes is a real cross-origin request with a real preflight.
  objects = new InMemoryObjectStore("in-memory-vault", BUCKET_ORIGIN);
  bucketServer = await startBucket(publicDir);
  const schedule = await loadGoverningSchedule(
    join(import.meta.dirname, "..", "..", "..", "config", "retention"),
    new Date(),
  );
  const documents = new InMemoryDocumentIntakePort(
    schedule,
    b2Register(new Date()),
    new InMemoryDocumentVault(objects),
  );

  const store = new ConversationEventStore(pool);
  driver = new RunDriver({
    stores: {
      cases: new PostgresCaseStore(pool),
      runs: new PostgresWorkflowRunStore(pool),
    },
    bindings: new ApplicationBindingStore(pool),
    catalogue: CATALOGUE,
    model: new DeterministicModelClient(),
    profiles: new PostgresConfirmedProfileStore(pool),
    conversations: store,
    identities: new StudentIdentityStore(pool),
    leases: new WorkLeaseStore(pool),
    // ADR-0048. Present because every deployment has one (`deployables.md`),
    // and a run that stops silently and a run that stops and SAYS SO must not
    // be indistinguishable here either — the student reads the message.
    interventions: new PostgresInterventionStore(pool),
    now: () => new Date(),
  });
  const app = createConversationApp({
    store,
    sessionSecret: SECRET,
    authorise: async (subject, conversation) => {
      const owned = await pool.query(
        "SELECT 1 FROM conversations WHERE id = $1 AND student_id = $2",
        [conversation, subject],
      );
      return owned.rowCount === 1;
    },
    now: () => new Date(),
    runs: driver,
    targets: CATALOGUE,
    publicDir,
    // The dev session route, which is REFUSED in production (`main.ts` mounts
    // it only outside it). Used here for the reason the chat client's browser
    // test uses it: a real `Set-Cookie` is the only way a browser will hold a
    // `__Host-` cookie.
    issueSessionFor: (req: { body?: unknown }) => {
      const subject = (req.body as { subject?: unknown } | undefined)?.subject;
      return typeof subject === "string" ? subject : null;
    },
    secureOrigin: "http://127.0.0.1:4931",
    documents,
  });
  server = await new Promise<Server>((resolve) => {
    const listening = app.listen(PORT, "127.0.0.1", () => resolve(listening));
  });

  browser = await chromium.launch({ headless: true });
}, 300_000);

// Surfaces a page error instead of letting it look like a timeout.
function watch(target: Page): void {
  target.on("console", (message) => {
    if (message.type() === "error")
      console.log(`[page error] ${message.text()}`);
  });
  target.on("pageerror", (error) =>
    console.log(`[page threw] ${String(error)}`),
  );
}

afterAll(async () => {
  if (!HAVE_DATABASE) return;
  await (page as Page | undefined)?.close().catch(() => undefined);
  await (browser as Browser | undefined)?.close().catch(() => undefined);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await new Promise<void>((resolve) => {
    if ((bucketServer as HttpsServer | undefined) === undefined) resolve();
    else bucketServer.close(() => resolve());
  });
  await pool.end();
  await rm(publicDir, { recursive: true, force: true });
});

describeIfDatabase("the student's page", () => {
  it("opens a conversation on first load, without one existing", async () => {
    // ADR-0060. The page has nothing to go on: no conversation, no local
    // storage, no id in the URL. It asks the service, finds none, and opens
    // one — the step that had no production path at all before P23.
    await visitAs(student);
    await page.waitForFunction(
      () => document.querySelectorAll("#targets .target").length > 0,
      undefined,
      { timeout: 15_000 },
    );
    const rows = await pool.query<{ id: string }>(
      "SELECT id FROM conversations WHERE student_id = $1",
      [student],
    );
    expect(rows.rowCount, "one conversation, opened by the page").toBe(1);
  }, 120_000);

  it("shows only REVIEWED targets, from the listing and nowhere else", async () => {
    // Gate 1. The page renders what `GET /v1/application-targets` returned; it
    // has no catalogue of its own and no way to name a target the server did
    // not offer.
    const shown = await textOf("#targets");
    expect(shown).toContain("Gated University");
    expect(shown).toContain("MSc Controlled Studies");
  }, 120_000);

  it("shows the SERVER's rendering of an offer, not one it composed", async () => {
    await chooseCourse("MSc Controlled Studies");
    const offer = await textOf("#offer pre");
    // Every line of this comes from `renderOffer` on the server. The page puts
    // it in a <pre> and does not touch it.
    expect(offer).toContain("Apply to Gated University");
    expect(offer).toContain("Course: MSc Controlled Studies");
    expect(offer).toContain("Applied through: gated.portal.test");

    // An offer is not a case (ADR-0058).
    const bound = await pool.query<{ case_id: string | null }>(
      "SELECT case_id FROM conversations WHERE student_id = $1",
      [student],
    );
    expect(bound.rows[0]?.case_id ?? null).toBeNull();
  }, 120_000);

  it("REFUSES to request an application with no statement of its own", async () => {
    // Product rule 1: explicit request before consequential action. The page
    // will not send a request the student did not put words to.
    await page.locator("#offer button").first().click();
    expect(await textOf("#notice")).toContain("your own words");
    const bound = await pool.query<{ case_id: string | null }>(
      "SELECT case_id FROM conversations WHERE student_id = $1",
      [student],
    );
    expect(bound.rows[0]?.case_id ?? null, "and nothing opened").toBeNull();
  }, 120_000);

  it("opens the case when the student asks, in their own words", async () => {
    // Gate 2. The page sends the offer hash the SERVER gave it, and the
    // sentence the student typed.
    await page.locator("#statement").fill("Please apply to the MSc for me.");
    await page.locator("#offer button").first().click();
    await page.waitForFunction(
      () =>
        (document.querySelector("#pending")?.textContent ?? "").includes(
          "Your application",
        ),
      undefined,
      { timeout: 15_000 },
    );

    const log = await pool.query<{ kind: string }>(
      `SELECT e.kind FROM conversation_events e
         JOIN conversations c ON c.id = e.conversation_id
        WHERE c.student_id = $1 ORDER BY e.ordinal`,
      [student],
    );
    const kinds = log.rows.map((row) => row.kind);
    expect(kinds, "the offer was recorded before the request").toContain(
      "target_offered",
    );
    expect(kinds).toContain("target_requested");
    expect(kinds.indexOf("target_offered")).toBeLessThan(
      kinds.indexOf("target_requested"),
    );

    // And the student's own sentence is the case's request evidence.
    const opened = await pool.query<{ statement: string }>(
      `SELECT event->'requestEvidence'->>'studentStatement' AS statement
         FROM case_events WHERE event->>'type' = 'CaseOpened'`,
    );
    expect(opened.rows[0]?.statement).toBe("Please apply to the MSc for me.");
  }, 180_000);

  it("RECONSTRUCTS the whole screen after a reload, holding nothing", async () => {
    // ═══════════════════════════════════════════════════════════════════
    // The property the client exists to have. Local storage is cleared as
    // well as the page reloaded, so nothing the page could have written
    // survives — and the screen comes back identical, because it was never
    // the source of any of it.
    // ═══════════════════════════════════════════════════════════════════
    const before = await textOf("#pending");

    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload({ waitUntil: "domcontentloaded" });

    const after = await textOf("#pending");
    expect(after, "the same position, read again from the server").toBe(before);

    // And it did not open a SECOND conversation on the way back.
    const rows = await pool.query(
      "SELECT 1 FROM conversations WHERE student_id = $1",
      [student],
    );
    expect(rows.rowCount).toBe(1);
  }, 120_000);

  it("keeps NOTHING about the run in browser storage", async () => {
    // The negative form of the same claim, asserted rather than assumed: no
    // run id, no step, no offer hash anywhere a reload could read.
    const stored = await page.evaluate(() => ({
      local: JSON.stringify(localStorage),
      session: JSON.stringify(sessionStorage),
    }));
    expect(stored.local).toBe("{}");
    expect(stored.session).toBe("{}");
  }, 120_000);

  it("SHOWS what distinguishes two reviewed routes to one course", async () => {
    // ═══════════════════════════════════════════════════════════════════
    // ADR-0058. `submissionKey` does not contain the blueprint, so applying
    // through one of these permanently rules out the other. The choice is
    // irreversible — so the page must show the collision and name the route
    // and portal that tell them apart, rather than presenting two rows that
    // look identical.
    //
    // Read from the LISTING's `needsDisambiguation`. The page has no opinion
    // about which targets collide.
    // ═══════════════════════════════════════════════════════════════════
    await visitAs(otherStudent);
    const shown = await textOf("#targets");
    expect(shown).toContain("More than one way to apply to this");
    expect(shown, "the portal that tells them apart").toContain(
      "gated.portal.test",
    );
    expect(shown, "and the route").toContain("partner portal");

    // The unambiguous one is NOT flagged.
    const open = page.locator("#targets .target", {
      hasText: "MSc Example Studies",
    });
    expect(
      await open.locator(".warn").count(),
      "nothing collides with it",
    ).toBe(0);
  }, 120_000);

  it("REFUSES to send while a secure step is open, and keeps the draft", async () => {
    // ═══════════════════════════════════════════════════════════════════
    // `composerPolicy` from `packages/conversation` — the SAME function the
    // service consults, which is what makes "the client and the server cannot
    // disagree" structural rather than a promise (ADR-0041).
    //
    // The guard is a function of the LOG, so the step is opened by appending
    // the event a secure step produces. This test is about the composer, not
    // about how a request reaches the Secure Plane.
    // ═══════════════════════════════════════════════════════════════════
    await visitAs(student);
    await page.waitForFunction(
      () =>
        (document.querySelector("#pending")?.textContent ?? "").includes(
          "Your application",
        ),
      undefined,
      { timeout: 15_000 },
    );
    // Typed BEFORE the step opens, so the guard has something to preserve.
    await page.locator("#say").fill("half a sentence");

    const held = await pool.query<{ id: string }>(
      "SELECT id FROM conversations WHERE student_id = $1",
      [student],
    );
    await new ConversationEventStore(pool).append({
      conversationId: held.rows[0]!.id,
      event: {
        kind: "secret_requested",
        requestId: `sr_${"0".repeat(31)}1`,
        channel: "secure_control",
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      },
    });

    await page.waitForFunction(
      () =>
        (document.querySelector("#composer-hint")?.textContent ?? "").length >
        0,
      undefined,
      { timeout: 20_000 },
    );
    expect(await textOf("#composer-hint")).toContain("secure step");
    expect(
      await page.locator("#composer button").isDisabled(),
      "and the button says so",
    ).toBe(true);

    // The draft survives the guard. Nothing ever writes to the input.
    expect(await page.locator("#say").inputValue()).toBe("half a sentence");

    // Pressing Enter does not send either: HTML blocks implicit submission
    // when the default button is disabled, so the guard holds on both paths.
    await page.locator("#say").press("Enter");
    expect(await page.locator("#say").inputValue()).toBe("half a sentence");
  }, 180_000);

  it("KEEPS the draft when a send is refused", async () => {
    // ═══════════════════════════════════════════════════════════════════
    // The composer clears only AFTER the server has taken the message. A
    // composer that cleared on submit throws away what the student wrote
    // every time a send fails — and the send that fails is the one they most
    // want back.
    //
    // Refused by LENGTH, which is a rule the route owns: the page does not
    // pre-validate, so this is a real round trip to a real refusal.
    // ═══════════════════════════════════════════════════════════════════
    const fresh = await pool.query<{ id: string }>(
      "INSERT INTO students (subject, email_verified) VALUES ('oidc-p25-d', true) RETURNING id",
    );
    await visitAs(fresh.rows[0]!.id);
    await page.waitForFunction(
      () => document.querySelectorAll("#targets .target").length > 0,
      undefined,
      { timeout: 15_000 },
    );

    const tooLong = "x".repeat(9000);
    await page.locator("#say").fill(tooLong);
    await page.locator("#composer button").click();
    await page.waitForFunction(
      () => (document.querySelector("#notice")?.textContent ?? "").length > 0,
      undefined,
      { timeout: 20_000 },
    );

    expect(
      (await page.locator("#say").inputValue()).length,
      "refused by the server, and still in the box",
    ).toBe(9000);

    // And nothing was written.
    const written = await pool.query<{ count: string }>(
      `SELECT count(*) AS count FROM conversation_events e
         JOIN conversations c ON c.id = e.conversation_id
        WHERE c.student_id = $1 AND e.kind = 'message'`,
      [fresh.rows[0]!.id],
    );
    expect(written.rows[0]?.count).toBe("0");
  }, 180_000);

  it("says WHY a refusal happened, in words, not \"that did not work\"", async () => {
    // ═══════════════════════════════════════════════════════════════════
    // P41, end to end and with nothing faked: a body over the service's
    // 64 KiB limit, refused by `express.json` itself, stated as the
    // contract's 413 `payload_too_large` by the error handler, read as that
    // code by the transport, and rendered as the sentence for it.
    //
    // Every link in that chain was broken before this phase. The server
    // answered 500 for a body only the student could shorten, and the page
    // had no wording for the code even once it was sent — both halves fell
    // through to "That did not work. Let me show you where things stand."
    //
    // One code proves the chain. That EVERY code has a wording is
    // `refusal-wording.test.ts`, which does not need a browser to answer it.
    // ═══════════════════════════════════════════════════════════════════
    const fresh = await pool.query<{ id: string }>(
      "INSERT INTO students (subject, email_verified) VALUES ('oidc-p41-a', true) RETURNING id",
    );
    await visitAs(fresh.rows[0]!.id);
    await page.waitForFunction(
      () => document.querySelectorAll("#targets .target").length > 0,
      undefined,
      { timeout: 15_000 },
    );

    // Set directly rather than typed: this is 70 KB, and the point is the
    // body's SIZE, not the composer's input handling — which its own tests
    // cover. The submit below is a real click on the real form.
    await page.locator("#say").evaluate((node, value) => {
      (node as HTMLInputElement).value = value;
    }, "x".repeat(70_000));
    await page.locator("#composer button").click();

    await page.waitForFunction(
      () => (document.querySelector("#notice")?.textContent ?? "").length > 0,
      undefined,
      { timeout: 20_000 },
    );
    const notice = (await page.locator("#notice").textContent()) ?? "";

    expect(notice, "the generic notice is what P41 exists to replace").not.toContain(
      "That did not work",
    );
    expect(notice.toLowerCase()).toContain("longer than i can take");

    // And it is still theirs: a refusal never costs the student what they wrote.
    expect((await page.locator("#say").inputValue()).length).toBe(70_000);
  }, 180_000);

  it("asks a decision the SERVER named, and sends the hash it was given", async () => {
    // ═══════════════════════════════════════════════════════════════════
    // ADR-0061, through the page. A run with no login goes straight to the
    // interview; answering puts a reading to the student, and `pending` then
    // says `confirm_value` with the playback hash the service wrote.
    //
    // The page reads both. It does not work out which decision applies from
    // the step, and it does not hash anything.
    // ═══════════════════════════════════════════════════════════════════
    const third = await pool.query<{ id: string }>(
      "INSERT INTO students (subject, email_verified) VALUES ('oidc-p25-c', true) RETURNING id",
    );
    await visitAs(third.rows[0]!.id);
    await page.waitForFunction(
      () => document.querySelectorAll("#targets .target").length > 0,
      undefined,
      { timeout: 15_000 },
    );
    await chooseCourse("MSc Example Studies");
    await textOf("#offer pre");
    await page.locator("#statement").fill("Please apply to this one for me.");
    await page.locator("#offer button").first().click();

    // The run is interviewing, and the student can SEE what it wants.
    //
    // P25 could only wait on `#pending` saying "interview" here, because the
    // question was composed by the orchestrator and thrown away by the driver:
    // the page had a position to render and nothing to answer. ADR-0062 put it
    // in the log, so the assertion is now on the transcript — the thing a
    // student actually reads.
    await page.waitForFunction(
      () =>
        (document.querySelector("#pending")?.textContent ?? "").includes(
          "interview",
        ),
      undefined,
      { timeout: 20_000 },
    );
    const beforeAnswering = await textOf("#transcript");
    expect(
      beforeAnswering.length,
      "the interview asked something the student can read",
    ).toBeGreaterThan(0);

    // And it came from the SERVER, not from the page: `value_asked` is the
    // durable record beside it.
    const question = await pool.query<{ field_key: string }>(
      `SELECT e.field_key FROM conversation_events e
         JOIN conversations c ON c.id = e.conversation_id
        WHERE c.student_id = $1 AND e.kind = 'value_asked'`,
      [third.rows[0]!.id],
    );
    expect(question.rowCount, "one question, recorded").toBe(1);
    await page.locator("#say").fill("niloofar@example.test");
    await page.locator("#composer button").click();

    // And now the run is waiting for a confirmation the SERVER named.
    await page.waitForFunction(
      () =>
        (document.querySelector("#pending")?.textContent ?? "").includes(
          "Yes, that's right",
        ),
      undefined,
      { timeout: 20_000 },
    );

    // The button sends the hash the read carried — checked against the row the
    // service wrote, not against anything the page produced.
    const written = await pool.query<{ playback_hash: string }>(
      `SELECT e.playback_hash FROM conversation_events e
         JOIN conversations c ON c.id = e.conversation_id
        WHERE c.student_id = $1 AND e.kind = 'value_proposed'
        ORDER BY e.ordinal DESC LIMIT 1`,
      [third.rows[0]!.id],
    );
    expect(written.rowCount, "a reading was put to them").toBe(1);

    await page
      .locator("#pending button", { hasText: "Yes, that's right" })
      .click();
    await page.waitForFunction(
      () =>
        !(document.querySelector("#pending")?.textContent ?? "").includes(
          "Yes, that's right",
        ),
      undefined,
      { timeout: 20_000 },
    );

    // Confirmed through the sanctioned path, with the hash the service knew.
    const confirmed = await pool.query<{ playback_hash: string }>(
      `SELECT e.playback_hash FROM conversation_events e
         JOIN conversations c ON c.id = e.conversation_id
        WHERE c.student_id = $1 AND e.kind = 'value_confirmed'`,
      [third.rows[0]!.id],
    );
    expect(confirmed.rowCount).toBe(1);
    expect(confirmed.rows[0]?.playback_hash).toBe(
      written.rows[0]?.playback_hash,
    );
  }, 300_000);

  it("offers a stop at every step, and it needs no hash", async () => {
    await visitAs(student);
    await page.waitForFunction(
      () =>
        (document.querySelector("#pending")?.textContent ?? "").includes(
          "Your application",
        ),
      undefined,
      { timeout: 15_000 },
    );
    // ADR-0053. Present because the architecture says so, not because a read
    // named it — `pending` never mentions `cancel`.
    const buttons = await page.locator("#pending button").allTextContents();
    expect(
      buttons.some((label) => label.includes("Stop this application")),
    ).toBe(true);
  }, 120_000);

  it("shows ANOTHER student their own empty journey, not this one", async () => {
    // Ownership, through the page rather than through curl. The second
    // student's session sees no conversation of the first's, and the page
    // opens them one of their own.
    await visitAs(otherStudent);
    await page.waitForFunction(
      () => document.querySelectorAll("#targets .target").length > 0,
      undefined,
      { timeout: 15_000 },
    );
    const pending = (await page.locator("#pending").textContent()) ?? "";
    expect(pending, "no application of anybody else's").not.toContain(
      "Your application",
    );

    const theirs = await pool.query(
      "SELECT 1 FROM conversations WHERE student_id = $1",
      [otherStudent],
    );
    expect(theirs.rowCount).toBe(1);
  }, 120_000);

  it("REFUSES a body the contract does not describe, rather than drawing it", async () => {
    // ═══════════════════════════════════════════════════════════════════
    // Written after a mutation to the transport's contract check SURVIVED.
    // It survived honestly: the mutation executed on every read, but nothing
    // in this suite ever handed the page a body the contract refuses, so
    // deleting the check changed no observable behaviour. A control whose
    // only evidence is "the real server happens to be correct" is not a
    // control — it is an assumption about a server that will be redeployed
    // independently of this page.
    //
    // So the response is corrupted in the browser, at the network boundary,
    // exactly as a version-skewed or proxied server would corrupt it. Two
    // things must then hold, and the second is the one that matters:
    //
    //   1. the page says it did not understand, rather than rendering the
    //      shape it got; and
    //   2. it does not keep showing the run it read a moment ago. A stale
    //      `pending` is a decision button bound to a hash the server has not
    //      just named, which is precisely what ADR-0060 forbids this page
    //      from holding.
    // ═══════════════════════════════════════════════════════════════════
    await visitAs(student);
    await page.waitForFunction(
      () =>
        (document.querySelector("#pending")?.textContent ?? "").includes(
          "Your application",
        ),
      undefined,
      { timeout: 15_000 },
    );

    // The run read, and only the run read, starts answering something the
    // contract does not describe. `runId` is gone, so `parseConversationRun`
    // refuses it — a 200 with a plausible-looking body, which is the case a
    // status check alone would sail straight past.
    await page.route("**/v1/conversations/*/runs", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          run: { step: "AWAITING_STUDENT_AUTHORISATION" },
          pending: null,
        }),
      });
    });

    // Any durable event triggers the re-read. Appended directly, because this
    // student's composer is held closed by the secure step an earlier test
    // opened — and the point here is the re-read, not how it is provoked.
    const mine = await pool.query<{ id: string }>(
      "SELECT id FROM conversations WHERE student_id = $1",
      [student],
    );
    await new ConversationEventStore(pool).append({
      conversationId: mine.rows[0]!.id,
      event: { kind: "message", actor: "assistant", content: "Still here." },
    });

    await page.waitForFunction(
      () =>
        (document.querySelector("#notice")?.textContent ?? "").includes(
          "did not understand",
        ),
      undefined,
      { timeout: 20_000 },
    );

    const pending = (await page.locator("#pending").textContent()) ?? "";
    expect(
      pending,
      "and it stopped showing a run the server did not just confirm",
    ).not.toContain("Your application");

    await page.unroute("**/v1/conversations/*/runs");
  }, 180_000);

  it("shows a run handed to a PERSON as exactly that, not as a live interview", async () => {
    // ═══════════════════════════════════════════════════════════════════
    // ADR-0064, through the browser. What this proves is the RENDERING: that
    // a run the server has handed to a specialist does not read as a live
    // interview with a composer inviting an answer.
    //
    // The escalation itself is driven through the SERVER's own message path —
    // `answerStudent`, the same entry point the route calls — rather than
    // through six composer round trips. The first version did drive them, and
    // it was flaky under parallel load: six browser exchanges to reach a state
    // the driver suite already proves deterministically, in order to assert
    // one line of text. Each proof belongs where it can be made honestly.
    //
    // Before the position line was fixed the student saw
    // `Your application: interview (escalated)` above an open composer — the
    // step they were last asked about, inviting an answer nobody would read.
    // ═══════════════════════════════════════════════════════════════════
    const stuck = await pool.query<{ id: string }>(
      "INSERT INTO students (subject, email_verified) VALUES ('oidc-p28-ui', true) RETURNING id",
    );
    const subject = stuck.rows[0]!.id;
    // Five of the six required fields, leaving `contact.email` outstanding:
    // `nextAction` skips an exhausted field and asks the next, so it escalates
    // only once every outstanding field is exhausted.
    await confirmFieldFor(
      subject,
      "identity.given_name",
      "Niloofar",
      "Niloofar",
    );
    await confirmFieldFor(
      subject,
      "identity.family_name",
      "Hosseini",
      "Hosseini",
    );
    await confirmFieldFor(
      subject,
      "identity.date_of_birth",
      new Date("1999-04-02T00:00:00Z"),
      "2 April 1999",
    );
    await confirmFieldFor(
      subject,
      "identity.nationality",
      "Iranian",
      "Iranian",
    );
    await confirmFieldFor(
      subject,
      "study.personal_statement",
      "I want to study data science.",
      "I want to study data science.",
    );

    await visitAs(subject);
    await page.waitForFunction(
      () => document.querySelectorAll("#targets .target").length > 0,
      undefined,
      { timeout: 15_000 },
    );
    await chooseCourse("MSc Example Studies");
    await textOf("#offer pre");
    await page.locator("#statement").fill("Please apply to this one for me.");
    await page.locator("#offer button").first().click();
    await page.waitForFunction(
      () =>
        (document.querySelector("#pending")?.textContent ?? "").includes(
          "interview",
        ),
      undefined,
      { timeout: 20_000 },
    );

    // ── Three readings put and refused, through the real message path ──
    const conversation = await pool.query<{ id: string }>(
      "SELECT id FROM conversations WHERE student_id = $1",
      [subject],
    );
    const conversationId = conversation.rows[0]!.id;
    const store = new ConversationEventStore(pool);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      for (const words of [
        `niloofar${String(attempt)}@example.test`,
        "no that is not it at all",
      ]) {
        const written = await store.append({
          conversationId,
          event: { kind: "message", actor: "student", content: words },
        });
        await driver.answerStudent({ conversationId, event: written.event });
      }
    }

    // The run really is stopped, in the database, before the page is asked.
    const stopped = await pool.query<{ status: string }>(
      `SELECT r.status FROM workflow_runs r
         JOIN conversations c ON c.case_id = r.case_id
        WHERE c.student_id = $1`,
      [subject],
    );
    expect(stopped.rows[0]?.status, "the interview gave up and said so").toBe(
      "escalated",
    );

    // ── And the page tells the student the truth about it ──────────────
    //
    // Reloaded first, and with browser storage cleared, so what is asserted is
    // the SERVER's answer reconstructed from nothing (ADR-0060).
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () =>
        (document.querySelector("#pending")?.textContent ?? "").includes(
          "with a member of the team",
        ),
      undefined,
      { timeout: 20_000 },
    );
    const position = await textOf("#pending");
    expect(
      position,
      "the step is not shown as though it were live",
    ).not.toContain("interview");

    // The escalation message is in the transcript too, so the two agree.
    expect(await textOf("#transcript")).toMatch(/member of the team/);
  }, 300_000);

  it("sends the student to log in when there is no session", async () => {
    // 401 is the ordinary case for a page loaded without one. The page does
    // not render an empty journey and pretend; it goes where the cookie is
    // minted (ADR-0056).
    await visitAnonymously();
    await page
      .waitForURL(/\/auth\/login/, { timeout: 15_000 })
      .catch(() => undefined);
    // The service has no OIDC configured here, so `/auth/login` itself
    // refuses — what is asserted is that the page went there rather than
    // staying and drawing a journey it has no session for.
    expect(page.url()).toContain("/auth/login");
  }, 120_000);
});

// ───────────────────────────────────────────────────────────────────────────
// The second attempt (ADR-0006 §3, P38 · reachable by a student from P42)
// ───────────────────────────────────────────────────────────────────────────

describeIfDatabase("the second attempt, from the student's own page", () => {
  // ═══════════════════════════════════════════════════════════════════════
  // Both halves of ADR-0006's exchange have been built, published and tested
  // since P38, and NO CLIENT COULD REACH EITHER. `AlreadyApplyingProblem` says
  // why they exist in its own words — "the refusal is otherwise a dead end.
  // 'You already have an application for this' is only useful if the client
  // can take the student to it, or — when it has concluded — offer them a
  // second attempt" — and the page threw both fields away.
  //
  // Driven entirely through the page: the student applies, stops, comes back,
  // is refused, is asked what happened, is SHOWN the advice, and instructs the
  // second attempt in their own words. Nothing below reaches past the browser
  // except to seed the student and to read what the case log holds.
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Concludes a case, the way P15's own tests do.
   *
   * The one fixture step here, and deliberately so: a cancellation reaches
   * CANCELLED through `#concludeCancellation` on the next ADVANCE, and nothing
   * in this file advances a run — the worker does that, and its own tests
   * prove it. What P42 is about is what the student can do once the prior
   * application HAS concluded.
   */
  async function conclude(caseRef: string): Promise<void> {
    const store = new PostgresCaseStore(pool);
    const ref = makeCaseId(caseRef);
    for (const to of ["WINDING_DOWN", "CANCELLED"] as const) {
      const current = fold(await store.read(ref));
      const decision = decide(current, {
        kind: "transition",
        to,
        reason: "The student stopped.",
      });
      if (!decision.accepted) expect.unreachable(`refused: ${JSON.stringify(decision.refusal)}`);
      await store.append(
        ref,
        current.sequence,
        stamp({
          caseId: ref,
          fromSequence: current.sequence,
          payloads: decision.events,
          actor: askimateActor(externalRef("test:p42-conclude")),
          now: new Date("2026-09-07T12:00:00Z"),
          nextEventId: (index: number) => `evt_p42_c${String(current.sequence + index + 1)}`,
        }),
      );
    }
  }

  /** Picks the first reviewed target and asks to apply, with a statement. */
  async function applyToTheFirstTarget(statement: string): Promise<void> {
    await page.waitForFunction(
      () => document.querySelectorAll("#targets .target").length > 0,
      undefined,
      { timeout: 15_000 },
    );
    await page.locator("#targets .target button").first().click();
    await page.waitForSelector("#statement", { timeout: 15_000 });
    await page.locator("#statement").fill(statement);
    await page.locator("#offer button").first().click();
  }

  it("takes the student through the whole exchange, in order", async () => {
    const fresh = await pool.query<{ id: string }>(
      "INSERT INTO students (subject, email_verified) VALUES ('oidc-p42', true) RETURNING id",
    );
    const owner = fresh.rows[0]!.id;
    await visitAs(owner);

    // ── One application, and then they stop ─────────────────────────────
    await applyToTheFirstTarget("Please apply to the MSc for me.");
    await page.waitForFunction(
      () => (document.querySelector("#pending")?.textContent ?? "").length > 0,
      undefined,
      { timeout: 20_000 },
    );
    const first = await pool.query<{ case_id: string }>(
      "SELECT case_id FROM conversations WHERE student_id = $1 AND case_id IS NOT NULL",
      [owner],
    );
    const priorCaseId = first.rows[0]!.case_id;
    await conclude(priorCaseId);

    // ── They come back, in a new conversation ───────────────────────────
    //
    // A conversation owns at most one case, so the second application needs
    // one of its own. `GET /v1/conversations` is newest-first, so a reload
    // lands the page there without it having remembered anything.
    // From INSIDE the page, so it is the page's own credentialed same-origin
    // request — the `__Host-` cookie belongs to the document, and an API
    // request made beside it is not the same caller.
    const opened = await page.evaluate(async () => {
      const response = await fetch("/v1/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      return response.status;
    });
    expect(opened).toBe(201);
    await page.reload({ waitUntil: "domcontentloaded" });

    // ── Refused, and NOT at a dead end ──────────────────────────────────
    await applyToTheFirstTarget("The same one again, please.");
    const offered = await textOf("#reapplication", 20_000);
    expect(offered, "the refusal opened the second attempt").toContain(
      "You have applied for this before",
    );
    expect(offered, "and it asks what happened first").toContain(
      "What happened to that application?",
    );

    // The instruction does not exist yet. ADR-0006 rule 4 is mandatory in
    // PRESENTATION, and a page that offered the box here would be asking the
    // server for a refusal.
    expect(
      await page.locator("#reapply-statement").count(),
      "the instruction was offered before the advice",
    ).toBe(0);

    // ── They say what happened, and are shown the advice ────────────────
    await page.locator("#reapplication button").first().click();
    const advice = await textOf("#wait-advice", 20_000);
    expect(advice.length, "the server's own rationale, shown verbatim").toBeGreaterThan(20);

    // And the fact that it was shown is DURABLE, in the conversation log —
    // which is what the server checks before it will take an instruction.
    const advised = await pool.query<{ prior_case_id: string; advice: string }>(
      `SELECT prior_case_id, advice FROM conversation_events
         WHERE kind = 'reapplication_advised'`,
    );
    expect(advised.rows[0]?.prior_case_id).toBe(priorCaseId);

    // ── The instruction, in their own words ─────────────────────────────
    await page.locator("#reapply-statement").fill(
      "I understand the advice, but I would like to apply again.",
    );
    await page.locator("#reapplication button").first().click();
    await page.waitForFunction(
      () => (document.querySelector("#pending")?.textContent ?? "").length > 0,
      undefined,
      { timeout: 20_000 },
    );

    // ── What the case log says ──────────────────────────────────────────
    const cases = await pool.query<{ case_id: string }>(
      "SELECT case_id FROM conversations WHERE student_id = $1 AND case_id IS NOT NULL",
      [owner],
    );
    expect(cases.rowCount, "a NEW case, not a second ordinal on the old one").toBe(2);

    const store = new PostgresCaseStore(pool);
    const second = cases.rows.map((row) => row.case_id).find((id) => id !== priorCaseId);
    const attempt2 = fold(await store.read(makeCaseId(second!)));
    expect(attempt2.submissionIdentity.attemptOrdinal).toBe(2);
    expect(attempt2.priorCaseId).toBe(priorCaseId);

    const attempt1 = fold(await store.read(makeCaseId(priorCaseId)));
    expect(attempt1.submissionIdentity.attemptOrdinal, "the prior one is untouched").toBe(1);
    expect(
      { ...attempt2.submissionIdentity, attemptOrdinal: 1 },
      "same student, same target — a second attempt at something else is not a re-application",
    ).toEqual(attempt1.submissionIdentity);
  }, 300_000);

  it("does NOT offer a second attempt while the first one is still live", async () => {
    // `concluded` is the server's answer and the only thing that decides this.
    // A page that offered it from its own reading of a case state would be
    // offering an instruction `decideReapplication` refuses — two concurrent
    // applications for one course and intake, which its own comment calls "a
    // different bug with the same blast radius".
    const fresh = await pool.query<{ id: string }>(
      "INSERT INTO students (subject, email_verified) VALUES ('oidc-p42-live', true) RETURNING id",
    );
    await visitAs(fresh.rows[0]!.id);

    await applyToTheFirstTarget("Please apply to the MSc for me.");
    await page.waitForFunction(
      () => (document.querySelector("#pending")?.textContent ?? "").length > 0,
      undefined,
      { timeout: 20_000 },
    );

    // From INSIDE the page, so it is the page's own credentialed same-origin
    // request — the `__Host-` cookie belongs to the document, and an API
    // request made beside it is not the same caller.
    const opened = await page.evaluate(async () => {
      const response = await fetch("/v1/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      return response.status;
    });
    expect(opened).toBe(201);
    await page.reload({ waitUntil: "domcontentloaded" });
    await applyToTheFirstTarget("The same one again, please.");

    // Told, in words, and offered nothing.
    const notice = await textOf("#notice", 20_000);
    expect(notice).toContain("already have an application");
    expect(
      (await page.locator("#reapplication").textContent()) ?? "",
      "a live application may not be re-applied to",
    ).toBe("");
  }, 300_000);
});

// ───────────────────────────────────────────────────────────────────────────
// P62 — the page makes the PUT, and the documented CORS rule admits it
// ───────────────────────────────────────────────────────────────────────────

describeIfDatabase("the student's page sends a document (ADR-0095)", () => {
  const PASSPORT = Buffer.from("%PDF-1.7\n% a synthetic passport scan for the browser test, not a real one\n");
  const PASSPORT_HASH = createHash("sha256").update(PASSPORT).digest("hex");

  it("sends a document to the BUCKET, never to this origin, and shows it from a re-read", async () => {
    // ─────────────────────────────────────────────────────────────────────
    // ADR-0092 in a browser: the bytes go from the page to the bucket on the
    // URL the declaration answered with; this service sees a declaration and
    // a confirm and not one byte of the file. ADR-0095: the page hashes the
    // file itself — the one hash it computes — and the bucket, not the page,
    // is what checks it.
    // ─────────────────────────────────────────────────────────────────────
    const fresh = await pool.query<{ id: string }>(
      "INSERT INTO students (subject, email_verified) VALUES ('oidc-p62-a', true) RETURNING id",
    );
    const owner = fresh.rows[0]!.id;
    await visitAs(owner);
    await page.waitForSelector("#document-file", { timeout: 15_000 });

    // Every request the page makes, so "never to this origin" is asserted
    // rather than assumed.
    const requests: { method: string; url: string }[] = [];
    page.on("request", (request) => requests.push({ method: request.method(), url: request.url() }));
    bucketLog.length = 0;

    // The choice is the SERVER's list — the governing schedule's rows.
    const offered = await page.locator("#document-type option").allTextContents();
    expect(offered).toContain("passport");
    expect(offered, "removed in ADR-0089; not offered").not.toContain("national id");
    await page.selectOption("#document-type", "passport");
    await page.setInputFiles("#document-file", {
      name: "passport.pdf",
      mimeType: "application/pdf",
      buffer: PASSPORT,
    });
    await page.locator("#document-form button").click();

    await page.waitForFunction(
      () => (document.querySelector("#held-documents")?.textContent ?? "").includes("passport"),
      undefined,
      { timeout: 20_000 },
    );
    expect(await textOf("#held-documents")).toContain("passport — uploaded");

    // ── Where the bytes went ────────────────────────────────────────────
    const puts = bucketLog.filter((entry) => entry.kind === "put");
    expect(puts, "exactly one PUT reached the bucket").toHaveLength(1);
    expect(puts[0]!.status).toBe(200);
    expect(puts[0]!.bytes).toBe(PASSPORT.byteLength);
    expect(puts[0]!.path, "under the student's own prefix").toMatch(new RegExp(`^/documents/${owner}/[0-9A-Z]{26}\\?`));
    // The signed headers, sent exactly as stated (E6, E7).
    expect(puts[0]!.headers["x-amz-checksum-sha256"]).toBe(Buffer.from(PASSPORT_HASH, "hex").toString("base64"));
    expect(puts[0]!.headers["x-amz-server-side-encryption"]).toBe("aws:kms");
    // And a real preflight, admitted by the DOCUMENTED rule.
    const preflights = bucketLog.filter((entry) => entry.kind === "preflight");
    expect(preflights.length, "the PUT was cross-origin, so the browser asked first").toBeGreaterThanOrEqual(1);
    expect(preflights.every((entry) => entry.status === 204), "and every ask was within the rule").toBe(true);
    expect(preflights[0]!.headers["origin"]).toBe(BASE);

    // ── Where they did not go ───────────────────────────────────────────
    const toThisOrigin = requests.filter((r) => r.url.startsWith(BASE));
    expect(toThisOrigin.some((r) => r.method === "PUT"), "no PUT to this service").toBe(false);
    expect(
      toThisOrigin.filter((r) => r.method === "POST" && r.url.includes("/documents")).length,
      "a declaration and a confirm, and that is all",
    ).toBe(2);
    expect(requests.filter((r) => r.url.startsWith(BUCKET_ORIGIN) && r.method === "PUT")).toHaveLength(1);

    // The record is the server's, and it is what the bucket holds.
    const held = await page.evaluate(async () => {
      const conversations = (await (await fetch("/v1/conversations")).json()) as { conversations: { id: string }[] };
      const id = conversations.conversations[0]!.id;
      return (await (await fetch(`/v1/conversations/${id}/documents`)).json()) as {
        documents: { documentType: string; state: string; contentHash: string; sizeBytes: number }[];
      };
    });
    expect(held.documents).toHaveLength(1);
    expect(held.documents[0]).toMatchObject({
      documentType: "passport",
      state: "uploaded",
      contentHash: PASSPORT_HASH,
      sizeBytes: PASSPORT.byteLength,
    });

    // And a reload shows the same list, from the server, the page having kept nothing.
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () => (document.querySelector("#held-documents")?.textContent ?? "").includes("passport"),
      undefined,
      { timeout: 15_000 },
    );
    const stored = await page.evaluate(() => JSON.stringify(localStorage) + JSON.stringify(sessionStorage));
    expect(stored).toBe("{}{}");
  }, 180_000);

  it("is REFUSED by the gate before a byte crosses the wire, and told so in words", async () => {
    // `other` is offered — the schedule has a row for it — and refused at the
    // declaration, because its determination was decided against (ADR-0088).
    // The page has no opinion about that; it shows the refusal and makes no
    // PUT. The wording is per CODE — `document_type_refused`, one of the
    // closed set ADR-0098 gave the gates — and the gate's own sentence never
    // reaches the wire.
    bucketLog.length = 0;
    await page.selectOption("#document-type", "other");
    await page.setInputFiles("#document-file", {
      name: "something.pdf",
      mimeType: "application/pdf",
      buffer: PASSPORT,
    });
    await page.locator("#document-form button").click();
    const notice = await textOf("#notice", 20_000);
    expect(notice).toContain("not one I keep");
    expect(bucketLog, "nothing reached the bucket — no preflight, no PUT").toEqual([]);
    // Still one document held: the refusal recorded nothing.
    expect(await textOf("#held-documents")).toContain("passport — uploaded");
    expect((await page.locator("#held-documents li").count())).toBe(1);
  }, 120_000);

  it("keeps the chosen file across a redraw the server triggers", async () => {
    // The form is built once. Every other panel is replaced whole on every
    // read, and an SSE frame from the student's own message would have
    // emptied a file input that was rebuilt with the rest.
    await page.setInputFiles("#document-file", {
      name: "kept.pdf",
      mimeType: "application/pdf",
      buffer: PASSPORT,
    });
    await page.locator("#say").fill("hello");
    await page.locator("#composer button").click();
    await page.waitForFunction(
      () => (document.querySelector("#transcript")?.textContent ?? "").includes("hello"),
      undefined,
      { timeout: 15_000 },
    );
    const kept = await page.evaluate(
      () => (document.querySelector("#document-file") as HTMLInputElement).files?.[0]?.name ?? null,
    );
    expect(kept).toBe("kept.pdf");
  }, 120_000);
});
