/**
 * The student's own page, in a real browser, against the real service.
 *
 * ── Why this file lives here ──────────────────────────────────────────────
 *
 * Beside the client it serves, which is what `apps/chat-integration` says of
 * its own browser test: *"the test that boots the real Conversation Service
 * lives beside the client it serves … it moves with the client."* It is also
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
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

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
import { RunDriver } from "./run-driver.js";
import type { ApplicationCatalogue, CatalogueEntry } from "./run-driver.js";
import { StudentIdentityStore } from "./identity-store.js";
import { WorkLeaseStore } from "./work-store.js";
import { buildStudentClient } from "./build-client.js";
import { createConversationApp } from "./app.js";

const PORT = 4930;
const BASE = `http://127.0.0.1:${String(PORT)}`;
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
  const context = await browser.newContext();
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

  const store = new ConversationEventStore(pool);
  const driver = new RunDriver({
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

    // The run is interviewing. NOTE: the question itself is not appended to
    // the log — `#putToTheStudent` writes only the PLAYBACK, after an answer —
    // so there is nothing for the page to render yet. Recorded here because it
    // is a real gap in the journey and not this phase's to close.
    await page.waitForFunction(
      () =>
        (document.querySelector("#pending")?.textContent ?? "").includes(
          "interview",
        ),
      undefined,
      { timeout: 20_000 },
    );
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
