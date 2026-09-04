/**
 * P21 — a student chooses a reviewed target, and asks for it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ADR-0058's two gates, proved against the real things:
 *
 *   GATE 1  an offer can only be built from a REVIEWED CATALOGUE ENTRY. The
 *           catalogue here is loaded from FILES through P20's registry — the
 *           same loader a deployment uses — not a compiled-in fixture. If an
 *           entry is not covered by an approval, the load fails and there is
 *           nothing to offer.
 *
 *   GATE 2  a case opens ONLY when the authenticated student names the hash of
 *           an offer this server built for THEM, in THIS conversation.
 *
 * Both against a real PostgreSQL, over real HTTP, with real session cookies.
 * The artefacts are the gated TEST portal this repository owns and runs. It is
 * not a university, and nothing here dresses it as one.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { Server } from "node:http";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import {
  hashOf,
  loadCatalogueDirectory,
  parseReviewedEntryText,
  toCanonical,
  type ReviewedCatalogue,
  type ReviewedCatalogueEntry,
} from "@askimate/aas-catalogue";
import {
  GATED_PORTAL_BLUEPRINT,
  GATED_PORTAL_MAPPING_SET,
} from "@askimate/aas-mapping/fixtures/gated";
import { migrate } from "@askimate/aas-migrate";
import { announceSkip, databaseReachable, TEST_DATABASE_URL } from "@askimate/aas-migrate/testing";
import { MIGRATIONS_DIR as CASE_MIGRATIONS } from "@askimate/aas-case-store";
import { PostgresCaseStore } from "@askimate/aas-case-store/postgres";
import { PostgresWorkflowRunStore } from "@askimate/aas-case-store/postgres-workflow";
import { DeterministicModelClient } from "@askimate/aas-llm";
import { REQUEST_CHANNELS } from "@askimate/aas-domain";

import { createConversationApp } from "../apps/conversation-service/src/app.js";
import { ApplicationBindingStore } from "../apps/conversation-service/src/application-store.js";
import { ConversationEventStore } from "../apps/conversation-service/src/event-store.js";
import { MIGRATIONS_DIR } from "../apps/conversation-service/src/index.js";
import { StudentIdentityStore } from "../apps/conversation-service/src/identity-store.js";
import { PostgresConfirmedProfileStore } from "../apps/conversation-service/src/profile-store.js";
import { WorkLeaseStore } from "../apps/conversation-service/src/work-store.js";
import { RunDriver } from "../apps/conversation-service/src/run-driver.js";
import { issueSession } from "../apps/conversation-service/src/session.js";

const DATABASE = "aas_p21_targets";
const SECRET = "a-p21-session-secret-that-is-long-enough";
/**
 * Binds PORT, PORT+1 and PORT+2, so this file owns 4907-4909.
 *
 * Just above `journey.test.ts`'s 4901-4906 and well below everything else. See
 * the range note at the top of `runner-supervisor.test.ts`: two suites in this
 * repository have already had a test silently reach another suite's server
 * because a derived port landed inside a range nobody had written down.
 */
const PORT = 4907;
const BASE = `http://127.0.0.1:${String(PORT)}`;
const STATEMENT = "Please apply to the MSc for me.";

const AUTHOR = "test-specialist-a";
const REVIEWER = "test-specialist-b";

const CONVERSATION = "01JBXQ8Z9WKTQ6M4H2NPD00001";
const SECOND_CONVERSATION = "01JBXQ8Z9WKTQ6M4H2NPD00002";
const OTHER_CONVERSATION = "01JBXQ8Z9WKTQ6M4H2NPD00003";

const HAVE_DATABASE = await databaseReachable();
if (!HAVE_DATABASE) announceSkip("P21 — target selection and the explicit request");
const describeIfDatabase = HAVE_DATABASE ? describe : describe.skip;

// ───────────────────────────────────────────────────────────────────────────
// The reviewed artefacts
//
// Three entries, and the shape of the set is the point:
//
//   bp-gated-portal    inst-gated / course-msc-controlled / 2026-09, direct
//   bp-gated-partner   THE SAME three, through a partner route
//   bp-gated-other     a different course, unambiguous
//
// The first two collide on `submissionKey` — `(student, institution, course,
// intake, attempt)`, which does NOT contain the blueprint — so applying
// through one permanently blocks the other for that student. That is why the
// ambiguity refusal below is a safety property and not a presentation one.
// ───────────────────────────────────────────────────────────────────────────

const DIRECT: ReviewedCatalogueEntry = {
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
 * A second reviewed route to the SAME course and intake.
 *
 * The blueprint and the mapping set are both re-identified, because a mapping
 * set names the blueprint it was reviewed against and `checkUsable` refuses a
 * pair that does not agree — which is the mapping layer doing its job, and the
 * reason this clone is written out rather than spread with one field changed.
 */
const PARTNER: ReviewedCatalogueEntry = {
  ...DIRECT,
  blueprint: {
    ...GATED_PORTAL_BLUEPRINT,
    blueprintId: "bp-gated-partner" as typeof GATED_PORTAL_BLUEPRINT.blueprintId,
    route: "partner_portal",
  },
  mappingSet: {
    ...GATED_PORTAL_MAPPING_SET,
    mappingSetId: "map-gated-partner",
    blueprintId: "bp-gated-partner",
  },
};

/** A different course entirely. Nothing shares its submission identity. */
const OTHER: ReviewedCatalogueEntry = {
  ...DIRECT,
  courseRef: "course-msc-other",
  blueprint: {
    ...GATED_PORTAL_BLUEPRINT,
    blueprintId: "bp-gated-other" as typeof GATED_PORTAL_BLUEPRINT.blueprintId,
    courseName: "MSc Other Studies",
  },
  mappingSet: {
    ...GATED_PORTAL_MAPPING_SET,
    mappingSetId: "map-gated-other",
    blueprintId: "bp-gated-other",
  },
};

function documentFor(entry: ReviewedCatalogueEntry): string {
  return JSON.stringify(toCanonical(entry), null, 2);
}

/**
 * Writes a catalogue directory whose `approvals.json` covers exactly the files
 * beside it.
 *
 * There is no `approve` command anywhere in this repository and there is not
 * one here either: the approval is written by the test as the two named
 * specialists, because a test that could manufacture review evidence through
 * the production code would be proving the wrong thing.
 */
async function writeCatalogue(entries: readonly ReviewedCatalogueEntry[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "aas-p21-"));
  await mkdir(join(dir, "entries"), { recursive: true });
  const approvals: unknown[] = [];
  for (const entry of entries) {
    const document = documentFor(entry);
    await writeFile(join(dir, "entries", `${String(entry.blueprint.blueprintId)}.json`), document);
    const parsed = parseReviewedEntryText(document);
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

async function catalogueOf(entries: readonly ReviewedCatalogueEntry[]): Promise<{
  catalogue: ReviewedCatalogue;
  directory: string;
}> {
  const directory = await writeCatalogue(entries);
  const load = await loadCatalogueDirectory({ directory });
  if (!load.ok) {
    expect.unreachable(load.problems.map((p) => `${p.source}: ${p.detail}`).join("\n"));
  }
  return { catalogue: load.catalogue, directory };
}

function connectionString(): string {
  const url = new URL(TEST_DATABASE_URL);
  url.pathname = `/${DATABASE}`;
  return url.toString();
}

interface Instance {
  readonly pool: pg.Pool;
  readonly app: ReturnType<typeof createConversationApp>;
}

/**
 * A whole service, built from a connection string and a catalogue.
 *
 * `targets` is the SAME object the driver executes against, so a test cannot
 * offer one target and run another. `omitTargets` builds a deployment that has
 * no directory at all — the case that must refuse rather than fall back.
 */
function buildInstance(catalogue: ReviewedCatalogue, omitTargets = false): Instance {
  const pool = new pg.Pool({ connectionString: connectionString(), max: 8 });
  const store = new ConversationEventStore(pool);
  const driver = new RunDriver({
    stores: {
      cases: new PostgresCaseStore(pool),
      runs: new PostgresWorkflowRunStore(pool),
    },
    bindings: new ApplicationBindingStore(pool),
    catalogue,
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
    ...(omitTargets ? {} : { targets: catalogue }),
    secureOrigin: "https://secure.test",
  });
  return { pool, app };
}

let pool: pg.Pool;
let server: Server;
let live: Instance;
let student: string;
let otherStudent: string;
const scratch: string[] = [];

function cookieFor(subject: string): string {
  return (issueSession(subject, SECRET).split(";")[0] ?? "").trim();
}

async function get(path: string, subject?: string): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${BASE}${path}`, {
    headers: subject === undefined ? {} : { Cookie: cookieFor(subject) },
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

async function post(
  path: string,
  subject: string | null,
  body: unknown,
  baseUrl: string = BASE,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(subject === null ? {} : { Cookie: cookieFor(subject) }),
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

/** Gate 1, as a helper. Returns the hash the server produced. */
async function anOffer(
  conversation: string,
  subject: string,
  blueprintId: string,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const made = await post(`/v1/conversations/${conversation}/target-offers`, subject, {
    blueprintId,
    ...extra,
  });
  expect(made.status, JSON.stringify(made.body)).toBe(201);
  return (made.body as { offerHash: string }).offerHash;
}

async function kindsIn(conversation: string): Promise<readonly string[]> {
  const rows = await pool.query<{ kind: string }>(
    "SELECT kind FROM conversation_events WHERE conversation_id = $1 ORDER BY ordinal",
    [conversation],
  );
  return rows.rows.map((row) => row.kind);
}

async function caseOf(conversation: string): Promise<string | null> {
  const rows = await pool.query<{ case_id: string | null }>(
    "SELECT case_id FROM conversations WHERE id = $1",
    [conversation],
  );
  return rows.rows[0]?.case_id ?? null;
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
    "INSERT INTO students (subject, email_verified) VALUES ('oidc-p21-a', true) RETURNING id",
  );
  student = first.rows[0]!.id;
  const second = await pool.query<{ id: string }>(
    "INSERT INTO students (subject, email_verified) VALUES ('oidc-p21-b', true) RETURNING id",
  );
  otherStudent = second.rows[0]!.id;

  await pool.query("INSERT INTO conversations (id, student_id) VALUES ($1, $2), ($3, $2), ($4, $5)", [
    CONVERSATION,
    student,
    SECOND_CONVERSATION,
    OTHER_CONVERSATION,
    otherStudent,
  ]);

  const { catalogue, directory } = await catalogueOf([DIRECT, PARTNER, OTHER]);
  scratch.push(directory);
  live = buildInstance(catalogue);
  server = await new Promise<Server>((resolve) => {
    const listening = live.app.listen(PORT, "127.0.0.1", () => resolve(listening));
  });
}, 180_000);

afterAll(async () => {
  if (!HAVE_DATABASE) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await live.pool.end();
  await pool.end();
  for (const directory of scratch) await rm(directory, { recursive: true, force: true });
});

// ───────────────────────────────────────────────────────────────────────────
// GATE 1 — what can be offered at all
// ───────────────────────────────────────────────────────────────────────────

describeIfDatabase("GET /v1/application-targets", () => {
  it("REFUSES an unauthenticated reader", async () => {
    // Not public reference data: an unauthenticated reader could enumerate
    // which institutions this system has a relationship with.
    const { status } = await get("/v1/application-targets");
    expect(status).toBe(401);
  });

  it("lists exactly what the REGISTRY approved, and says which choices collide", async () => {
    const { status, body } = await get("/v1/application-targets", student);
    expect(status).toBe(200);
    const listing = body as {
      targets: { blueprintId: string; needsDisambiguation: boolean; courseName: string }[];
      ambiguousCount: number;
    };
    expect(listing.targets.map((t) => t.blueprintId).sort()).toEqual([
      "bp-gated-other",
      "bp-gated-partner",
      "bp-gated-portal",
    ]);

    // The pair that shares a submission identity is flagged; the singleton is
    // not. This is what lets a client present the choice rather than pick one.
    const flagged = Object.fromEntries(
      listing.targets.map((t) => [t.blueprintId, t.needsDisambiguation]),
    );
    expect(flagged).toEqual({
      "bp-gated-portal": true,
      "bp-gated-partner": true,
      "bp-gated-other": false,
    });
    expect(listing.ambiguousCount).toBe(1);
  });

  it("withholds the fields an offer hash is taken over", async () => {
    // Defence in depth rather than the gate itself — `verifyRequest` requires
    // the offer to be IN THE LOG, so a computed hash is refused either way.
    // But there is no reason to hand a client the ingredients.
    const { body } = await get("/v1/application-targets", student);
    const [first] = (body as { targets: Record<string, unknown>[] }).targets;
    expect(Object.keys(first ?? {})).not.toContain("contentHash");
    expect(Object.keys(first ?? {})).not.toContain("blueprintVersion");
  });
});

describeIfDatabase("POST /v1/conversations/{id}/target-offers", () => {
  it("puts a target to the student, and opens NOTHING", async () => {
    const made = await post(`/v1/conversations/${CONVERSATION}/target-offers`, student, {
      blueprintId: "bp-gated-other",
    });
    expect(made.status).toBe(201);
    const offer = made.body as { offerHash: string; rendered: string; target: { route: string } };
    expect(offer.offerHash).toMatch(/^sha256:[0-9a-f]{64}$/);

    // What the student reads is deterministic and model-free: the institution,
    // the course, the intake and the portal it will actually be applied
    // through. "What exactly did I agree to?" has an answer.
    expect(offer.rendered).toContain("Gated University");
    expect(offer.rendered).toContain("MSc Other Studies");
    expect(offer.rendered).toContain("2026-09");
    expect(offer.rendered).toContain("gated.portal.test");

    // Durable, as an offer and as the prose beside it.
    expect(await kindsIn(CONVERSATION)).toEqual(["target_offered", "message"]);

    // ── And nothing consequential happened ────────────────────────────
    expect(await caseOf(CONVERSATION), "an offer is not a case").toBeNull();
    const runs = await pool.query("SELECT 1 FROM workflow_runs");
    expect(runs.rowCount, "and not a run either").toBe(0);
  });

  it("is DETERMINISTIC — the same target, twice, is the same offer", async () => {
    const one = await anOffer(SECOND_CONVERSATION, student, "bp-gated-other");
    const two = await anOffer(SECOND_CONVERSATION, student, "bp-gated-other");
    expect(two).toBe(one);
  });

  it("binds the offer to the STUDENT and the CONVERSATION", async () => {
    const mine = await anOffer(CONVERSATION, student, "bp-gated-other");
    const elsewhere = await anOffer(SECOND_CONVERSATION, student, "bp-gated-other");
    const theirs = await anOffer(OTHER_CONVERSATION, otherStudent, "bp-gated-other");

    // Same target, same reviewed content, three different hashes. Both ids are
    // inside the canonical value, so this needs no expiry and no lookup table.
    expect(new Set([mine, elsewhere, theirs]).size).toBe(3);
  });

  it("REFUSES a target the catalogue does not hold — and opens no case for the demand", async () => {
    const before = await kindsIn(SECOND_CONVERSATION);
    const made = await post(`/v1/conversations/${SECOND_CONVERSATION}/target-offers`, student, {
      blueprintId: "bp-somewhere-we-have-not-reviewed",
    });
    expect(made.status).toBe(404);

    // The honest answer, and deliberately not a case. An unavailable target
    // does not become an application; the student's message and this reply are
    // already the durable record of what they asked for.
    expect(await kindsIn(SECOND_CONVERSATION)).toEqual(before);
    expect(await caseOf(SECOND_CONVERSATION)).toBeNull();
  });

  it("REFUSES an AMBIGUOUS target, naming the alternatives", async () => {
    // ═══════════════════════════════════════════════════════════════════
    // A safety refusal. `submissionKey` does not contain the blueprint, so
    // applying through one of these permanently blocks the other for this
    // student. The choice is irreversible — so nothing picks a default, a best
    // match, or the first one found.
    // ═══════════════════════════════════════════════════════════════════
    const before = await kindsIn(SECOND_CONVERSATION);
    const made = await post(`/v1/conversations/${SECOND_CONVERSATION}/target-offers`, student, {
      blueprintId: "bp-gated-portal",
    });
    expect(made.status).toBe(409);
    const problem = made.body as { code: string; candidates: { blueprintId: string }[] };
    expect(problem.code).toBe("validation_failed");
    expect(problem.candidates.map((c) => c.blueprintId).sort()).toEqual([
      "bp-gated-partner",
      "bp-gated-portal",
    ]);
    expect(await kindsIn(SECOND_CONVERSATION), "and no offer was made").toEqual(before);
  });

  it("offers an ambiguous target once the student has chosen between them", async () => {
    const made = await post(`/v1/conversations/${SECOND_CONVERSATION}/target-offers`, student, {
      blueprintId: "bp-gated-portal",
      disambiguated: true,
    });
    expect(made.status).toBe(201);
    expect((made.body as { target: { route: string } }).target.route).toBe("direct_portal");
  });

  it("REFUSES another student's conversation with 404, not 403", async () => {
    const made = await post(`/v1/conversations/${OTHER_CONVERSATION}/target-offers`, student, {
      blueprintId: "bp-gated-other",
    });
    expect(made.status).toBe(404);
  });

  it("REFUSES an unauthenticated caller", async () => {
    const made = await post(`/v1/conversations/${CONVERSATION}/target-offers`, null, {
      blueprintId: "bp-gated-other",
    });
    expect(made.status).toBe(401);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// GATE 2 — what may open a case
// ───────────────────────────────────────────────────────────────────────────

describeIfDatabase("POST /v1/conversations/{id}/runs — the explicit request", () => {
  it("REFUSES the OLD contract: a raw blueprintId opens nothing", async () => {
    // ═══════════════════════════════════════════════════════════════════
    // The pre-P21 body, exactly. It must not work — and it must not work by
    // accident: `blueprintId` is not read on this route at all, so a caller
    // that sends one is answered as a caller that named no offer.
    // ═══════════════════════════════════════════════════════════════════
    const started = await post(`/v1/conversations/${CONVERSATION}/runs`, student, {
      blueprintId: "bp-gated-other",
      studentStatement: STATEMENT,
    });
    expect(started.status).toBe(400);
    expect(started.body).toMatchObject({
      code: "validation_failed",
      pointers: ["/offerHash"],
    });
    expect(await caseOf(CONVERSATION)).toBeNull();
  });

  it("REFUSES a malformed offer hash", async () => {
    for (const bad of ["", "not-a-hash", `sha256:${"z".repeat(64)}`, `sha512:${"a".repeat(64)}`]) {
      const started = await post(`/v1/conversations/${CONVERSATION}/runs`, student, {
        offerHash: bad,
        studentStatement: STATEMENT,
      });
      expect(started.status, bad).toBe(400);
    }
    expect(await caseOf(CONVERSATION)).toBeNull();
  });

  it("REFUSES a well-formed hash that names no offer made here", async () => {
    const started = await post(`/v1/conversations/${CONVERSATION}/runs`, student, {
      offerHash: `sha256:${"c".repeat(64)}`,
      studentStatement: STATEMENT,
    });
    // 404, the same answer another student's conversation gets, so a probe
    // cannot tell "wrong owner" from "no such offer".
    expect(started.status).toBe(404);
    expect(await caseOf(CONVERSATION)).toBeNull();
  });

  it("REFUSES another student's offer, spent in this conversation", async () => {
    const theirs = await anOffer(OTHER_CONVERSATION, otherStudent, "bp-gated-other");
    const started = await post(`/v1/conversations/${CONVERSATION}/runs`, student, {
      offerHash: theirs,
      studentStatement: STATEMENT,
    });
    expect(started.status).toBe(404);
    expect(await caseOf(CONVERSATION)).toBeNull();
  });

  it("REFUSES this student's own offer from ANOTHER conversation", async () => {
    const elsewhere = await anOffer(SECOND_CONVERSATION, student, "bp-gated-other");
    const started = await post(`/v1/conversations/${CONVERSATION}/runs`, student, {
      offerHash: elsewhere,
      studentStatement: STATEMENT,
    });
    expect(started.status).toBe(404);
    expect(await caseOf(CONVERSATION)).toBeNull();
  });

  it("REFUSES a request with no statement of what the student asked for", async () => {
    const offerHash = await anOffer(CONVERSATION, student, "bp-gated-other");
    const started = await post(`/v1/conversations/${CONVERSATION}/runs`, student, { offerHash });
    expect(started.status).toBe(400);
    expect(started.body).toMatchObject({ pointers: ["/studentStatement"] });
    expect(await caseOf(CONVERSATION)).toBeNull();
  });

  it("OPENS the case for the offer the student named", async () => {
    const offerHash = await anOffer(CONVERSATION, student, "bp-gated-other");
    const started = await post(`/v1/conversations/${CONVERSATION}/runs`, student, {
      offerHash,
      studentStatement: STATEMENT,
    });
    expect(started.status, JSON.stringify(started.body)).toBe(201);
    const run = started.body as { caseId: string; runId: string; resumed: boolean };
    expect(run.resumed).toBe(false);

    // ── The request is in the log, BEFORE the case existed ────────────
    //
    // The request is the last thing about the TARGET, not the last thing in
    // the log: since ADR-0062 the run reaches the interview in the same call
    // and puts its first question to the student, so a `value_asked` and its
    // message follow. What this asserts is the request's position relative to
    // the exchange it closes, which is the claim that matters.
    const kinds = await kindsIn(CONVERSATION);
    expect(kinds.filter((kind) => kind === "target_requested")).toHaveLength(1);
    expect(
      kinds.lastIndexOf("target_requested"),
      "the request comes after the offer it names",
    ).toBeGreaterThan(kinds.lastIndexOf("target_offered"));
    expect(
      kinds.slice(kinds.lastIndexOf("target_requested") + 1),
      "and the interview follows it — nothing else about a target does",
    ).toEqual(["value_asked", "message"]);

    // ── And the case is bound to the target the OFFER named ───────────
    //
    // Never to anything the request body said, because the request body says
    // nothing about a blueprint at all.
    const bound = await pool.query<{ case_id: string; blueprint_id: string }>(
      "SELECT case_id, blueprint_id FROM cases WHERE case_id = $1",
      [run.caseId],
    );
    expect(bound.rows[0]?.blueprint_id).toBe("bp-gated-other");
    expect(await caseOf(CONVERSATION)).toBe(run.caseId);

    // ── The audit field that was FALSE until ADR-0058 ─────────────────
    //
    // `requestEvidence.channel` said `askimate_chat` unconditionally, so every
    // case ever opened asserted that the request arrived through a product
    // that did not receive it. Asserted here on the CASE LOG — the durable
    // record — rather than on the type, which permitted the wrong answer all
    // along.
    const opened = await pool.query<{ event: { requestEvidence?: { channel?: string;
      studentStatement?: string } } }>(
      `SELECT event FROM case_events
        WHERE case_id = $1 AND event->>'type' = 'CaseOpened'`,
      [run.caseId],
    );
    expect(opened.rowCount).toBe(1);
    const evidence = opened.rows[0]?.event.requestEvidence;
    expect(evidence?.channel).toBe("aas_conversation");
    expect(REQUEST_CHANNELS).toContain(evidence?.channel);
    // And the student's own words, so "why did you apply to this for them?"
    // is answerable with the sentence they wrote.
    expect(evidence?.studentStatement).toBe(STATEMENT);
  }, 60_000);

  it("IGNORES a blueprintId sent alongside a valid offer", async () => {
    // ═══════════════════════════════════════════════════════════════════
    // The subtler half of the old contract. The body carries a perfectly good
    // offer AND a `blueprintId` naming something else. If the route read the
    // body at all, this is where it would show: the case would be bound to the
    // client's choice rather than to the offer the student was shown.
    //
    // Written after the `blueprintId ?? verified.target.blueprintId` mutation
    // SURVIVED the rest of this suite — every other test sends only one of the
    // two, so none of them could tell which one was read.
    // ═══════════════════════════════════════════════════════════════════
    const conversation = "01JBXQ8Z9WKTQ6M4H2NPD00006";
    await pool.query("INSERT INTO conversations (id, student_id) VALUES ($1, $2)", [
      conversation,
      student,
    ]);
    const offerHash = await anOffer(conversation, student, "bp-gated-other");
    const started = await post(`/v1/conversations/${conversation}/runs`, student, {
      offerHash,
      blueprintId: "bp-gated-partner",
      studentStatement: STATEMENT,
    });
    expect(started.status, JSON.stringify(started.body)).toBe(201);
    const run = started.body as { caseId: string };
    const bound = await pool.query<{ blueprint_id: string }>(
      "SELECT blueprint_id FROM cases WHERE case_id = $1",
      [run.caseId],
    );
    expect(bound.rows[0]?.blueprint_id, "the OFFER decides, not the body").toBe("bp-gated-other");
  }, 60_000);

  it("REPLAYS idempotently — the same offer, again, is the same question", async () => {
    const offerHash = await anOffer(CONVERSATION, student, "bp-gated-other");
    const before = await kindsIn(CONVERSATION);
    const again = await post(`/v1/conversations/${CONVERSATION}/runs`, student, {
      offerHash,
      studentStatement: STATEMENT,
    });
    expect(again.status).toBe(200);
    expect((again.body as { resumed: boolean }).resumed).toBe(true);

    // One case, one run — and NOT a second `target_requested`. A log that grew
    // one on every retry would say the student asked to apply twice.
    const runs = await pool.query(
      `SELECT 1 FROM workflow_runs
        WHERE case_id = (SELECT case_id FROM conversations WHERE id = $1)`,
      [CONVERSATION],
    );
    expect(runs.rowCount).toBe(1);
    expect(
      (await kindsIn(CONVERSATION)).filter((kind) => kind === "target_requested"),
    ).toHaveLength(1);
    expect(before.filter((k) => k === "target_requested")).toHaveLength(1);
  }, 60_000);
});

// ───────────────────────────────────────────────────────────────────────────
// The offer does not expire — it RE-DERIVES
// ───────────────────────────────────────────────────────────────────────────

describeIfDatabase("an offer whose target moved", () => {
  /** A second service on the same database, serving a different catalogue. */
  async function withCatalogue(
    entries: readonly ReviewedCatalogueEntry[],
    body: (baseUrl: string) => Promise<void>,
  ): Promise<void> {
    const { catalogue, directory } = await catalogueOf(entries);
    scratch.push(directory);
    const instance = buildInstance(catalogue);
    const port = PORT + 1;
    const listening = await new Promise<Server>((resolve) => {
      const started = instance.app.listen(port, "127.0.0.1", () => resolve(started));
    });
    try {
      await body(`http://127.0.0.1:${String(port)}`);
    } finally {
      await new Promise<void>((resolve) => listening.close(() => resolve()));
      await instance.pool.end();
    }
  }

  const conversation = "01JBXQ8Z9WKTQ6M4H2NPD00004";

  beforeAll(async () => {
    if (!HAVE_DATABASE) return;
    await pool.query("INSERT INTO conversations (id, student_id) VALUES ($1, $2)", [
      conversation,
      student,
    ]);
  });

  it("REFUSES an offer whose target has been RETIRED", async () => {
    // The offer is made against the live catalogue, and then a deployment that
    // no longer carries that entry is asked to honour it. No clock is
    // involved: the target is simply not there to rebuild from.
    const offerHash = await anOffer(conversation, student, "bp-gated-other");

    await withCatalogue([DIRECT, PARTNER], async (baseUrl) => {
      const started = await post(
        `/v1/conversations/${conversation}/runs`,
        student,
        { offerHash, studentStatement: STATEMENT },
        baseUrl,
      );
      expect(started.status).toBe(409);
      expect(started.body).toMatchObject({ code: "content_changed" });
    });
    expect(await caseOf(conversation)).toBeNull();
  }, 60_000);

  it("REFUSES an offer whose REVIEWED CONTENT changed underneath it", async () => {
    // ═══════════════════════════════════════════════════════════════════
    // The harder case, and the one a lookup table would get wrong. The target
    // is still there, still called `bp-gated-other`, still reviewed and still
    // approved — by a NEW approval, over new bytes. ADR-0057: an approval
    // covers the content that was reviewed, not the identifier.
    //
    // The offer hash carries the old content hash, so it no longer rebuilds.
    // ═══════════════════════════════════════════════════════════════════
    const offerHash = await anOffer(conversation, student, "bp-gated-other");

    const changed: ReviewedCatalogueEntry = { ...OTHER, requiredDocuments: ["passport"] };
    await withCatalogue([DIRECT, PARTNER, changed], async (baseUrl) => {
      // The entry loads: it is properly reviewed and properly approved.
      const listed = await fetch(`${baseUrl}/v1/application-targets`, {
        headers: { Cookie: cookieFor(student) },
      });
      const body = (await listed.json()) as { targets: { blueprintId: string }[] };
      expect(body.targets.map((t) => t.blueprintId)).toContain("bp-gated-other");

      const started = await post(
        `/v1/conversations/${conversation}/runs`,
        student,
        { offerHash, studentStatement: STATEMENT },
        baseUrl,
      );
      expect(started.status).toBe(409);
      expect(started.body).toMatchObject({ code: "content_changed" });
    });
    expect(await caseOf(conversation)).toBeNull();
  }, 60_000);
});

// ───────────────────────────────────────────────────────────────────────────
// A deployment with no directory refuses; it does not fall back
// ───────────────────────────────────────────────────────────────────────────

describeIfDatabase("a deployment with no target directory", () => {
  const conversation = "01JBXQ8Z9WKTQ6M4H2NPD00005";

  it("REFUSES to start a run rather than skipping the gate", async () => {
    await pool.query("INSERT INTO conversations (id, student_id) VALUES ($1, $2)", [
      conversation,
      student,
    ]);
    const { catalogue, directory } = await catalogueOf([OTHER]);
    scratch.push(directory);
    const instance = buildInstance(catalogue, true);
    const port = PORT + 2;
    const listening = await new Promise<Server>((resolve) => {
      const started = instance.app.listen(port, "127.0.0.1", () => resolve(started));
    });
    try {
      const started = await post(
        `/v1/conversations/${conversation}/runs`,
        student,
        { offerHash: `sha256:${"d".repeat(64)}`, studentStatement: STATEMENT },
        `http://127.0.0.1:${String(port)}`,
      );
      // A deployment that could not have made an offer cannot verify one. The
      // same shape as ADR-0056's identity guard: refuse, never bypass.
      expect(started.status).toBe(503);
      expect(await caseOf(conversation)).toBeNull();
    } finally {
      await new Promise<void>((resolve) => listening.close(() => resolve()));
      await instance.pool.end();
    }
  }, 60_000);
});
