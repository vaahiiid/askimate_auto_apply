/**
 * The conversation schema, against a real PostgreSQL.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-28: *"verify the database constraints with real PostgreSQL
 * tests."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Every assertion here is an INSERT that must fail. A CHECK constraint tested
 * only with valid rows is a constraint nobody has established exists — it can
 * be dropped, mistyped, or written against the wrong column, and a suite of
 * happy paths stays green throughout.
 *
 * So each test writes the row the design forbids and asserts the database
 * refuses it, by SQLSTATE and by constraint name where one exists.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import { MigrationChangedError, loadMigrations, migrate } from "@askimate/aas-migrate";
import { ACTORS, EVENT_KINDS, REJECTION_REASONS } from "@askimate/aas-contracts";

import { MIGRATIONS_DIR, SCHEMA_ACTORS, SCHEMA_EVENT_KINDS, SETTLING_KINDS } from "./index.js";
import { announceSkip, databaseReachable, TEST_DATABASE_URL } from "@askimate/aas-migrate/testing";

/** PostgreSQL error classes we assert on, by name rather than by number. */
const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";
const NOT_NULL_VIOLATION = "23502";

const MARKER = "SECRET-PASSWORD-DO-NOT-LEAK-123!";
const ULID = "01JBXQ8Z9WKTQ6M4H2NPVR3TCD";
const REQUEST_ID = `sr_${"a".repeat(32)}`;
const HANDLE = `sh_${"b".repeat(32)}`;

let pool: pg.Pool;
let studentId: string;

const HAVE_DATABASE = await databaseReachable();
if (!HAVE_DATABASE) announceSkip("the conversation schema's constraints");
const describeIfDatabase = HAVE_DATABASE ? describe : describe.skip;

async function ownDatabase(name: string): Promise<pg.Pool> {
  const admin = new pg.Pool({ connectionString: TEST_DATABASE_URL });
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }
  const url = new URL(TEST_DATABASE_URL);
  url.pathname = `/${name}`;
  return new pg.Pool({ connectionString: url.toString() });
}

/** Asserts a write is refused, and by WHICH rule. */
async function refuses(
  sql: string,
  params: readonly unknown[],
  expected: { code: string; constraint?: string },
): Promise<void> {
  try {
    await pool.query(sql, [...params]);
    expect.unreachable(`the database accepted a row it must refuse: ${sql}`);
  } catch (error) {
    const failure = error as { code?: string; constraint?: string; message?: string };
    expect(failure.code, failure.message ?? "no message").toBe(expected.code);
    if (expected.constraint !== undefined) expect(failure.constraint).toBe(expected.constraint);
  }
}

async function newConversation(id: string = ULID): Promise<string> {
  await pool.query("INSERT INTO conversations (id, student_id) VALUES ($1, $2)", [id, studentId]);
  return id;
}

async function newBody(content: string): Promise<number> {
  const rows = await pool.query<{ id: string }>(
    "INSERT INTO message_bodies (content) VALUES ($1) RETURNING id",
    [content],
  );
  return Number(rows.rows[0]!.id);
}

beforeAll(async () => {
  if (!HAVE_DATABASE) return;
  pool = await ownDatabase("aas_conversation_schema");
  const applied = await migrate(pool, MIGRATIONS_DIR);
  // A migration run that applied nothing would leave every test below passing
  // against an empty database in the most misleading way possible.
  expect(applied).toEqual([
    "0001_conversation_log",
    "0002_application_runs",
    "0003_profile_entries",
    "0004_case_blueprint",
    "0005_work_leases",
    "0006_execute_work",
    "0007_lease_page",
    "0008_value_proposals",
    "0009_lease_page_version",
    "0010_worker_leases",
      "0011_verification_is_established_at_login",
  ]);

  const student = await pool.query<{ id: string }>(
    "INSERT INTO students (subject, email_verified) VALUES ($1, true) RETURNING id",
    ["oidc-subject-1"],
  );
  studentId = student.rows[0]!.id;
}, 120_000);

afterAll(async () => {
  // `pool` is typed non-nullish but is only assigned in `beforeAll`, which can
  // throw before it runs. A truthiness check reads as the guard it is; an
  // optional chain on a non-nullish type is dead code the linter rejects.
  if (HAVE_DATABASE) await pool.end();
});

// ───────────────────────────────────────────────────────────────────────────
// The constraint the whole model exists for
// ───────────────────────────────────────────────────────────────────────────

describeIfDatabase("a secure event cannot hold what a student typed", () => {
  it("refuses a secure event that points at a message body", async () => {
    const conversation = await newConversation("01JBXQ8Z9WKTQ6M4H2NPVR3T01");
    const body = await newBody(MARKER);
    await refuses(
      `INSERT INTO conversation_events
         (conversation_id, ordinal, kind, request_id, channel, expires_at, body_id)
       VALUES ($1, 1, 'secret_requested', $2, 'secure_control', now() + interval '5 min', $3)`,
      [conversation, REQUEST_ID, body],
      { code: CHECK_VIOLATION, constraint: "only_messages_have_bodies" },
    );
  });

  it("refuses a MESSAGE with no body — the other half of the same rule", async () => {
    // Without this direction, the constraint could be satisfied by never
    // writing a body at all, and every message would silently lose its text.
    const conversation = await newConversation("01JBXQ8Z9WKTQ6M4H2NPVR3T02");
    await refuses(
      `INSERT INTO conversation_events (conversation_id, ordinal, kind, actor)
       VALUES ($1, 1, 'message', 'student')`,
      [conversation],
      { code: CHECK_VIOLATION, constraint: "only_messages_have_bodies" },
    );
  });

  it("refuses a message that names a request, and a secure event that does not", async () => {
    const conversation = await newConversation("01JBXQ8Z9WKTQ6M4H2NPVR3T03");
    const body = await newBody("a genuine question");
    await refuses(
      `INSERT INTO conversation_events
         (conversation_id, ordinal, kind, actor, body_id, request_id)
       VALUES ($1, 1, 'message', 'student', $2, $3)`,
      [conversation, body, REQUEST_ID],
      { code: CHECK_VIOLATION, constraint: "secure_events_name_a_request" },
    );
    await refuses(
      `INSERT INTO conversation_events (conversation_id, ordinal, kind)
       VALUES ($1, 2, 'secret_expired')`,
      [conversation],
      { code: CHECK_VIOLATION, constraint: "secure_events_name_a_request" },
    );
  });

  it("refuses an actor on a secure event, and a message without one", async () => {
    const conversation = await newConversation("01JBXQ8Z9WKTQ6M4H2NPVR3T04");
    await refuses(
      `INSERT INTO conversation_events
         (conversation_id, ordinal, kind, request_id, actor)
       VALUES ($1, 1, 'secret_expired', $2, 'system')`,
      [conversation, REQUEST_ID],
      { code: CHECK_VIOLATION, constraint: "only_messages_have_an_actor" },
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Closed vocabularies
// ───────────────────────────────────────────────────────────────────────────

describeIfDatabase("the database refuses a word it does not know", () => {
  it("refuses an event kind outside the closed set", async () => {
    const conversation = await newConversation("01JBXQ8Z9WKTQ6M4H2NPVR3T05");
    await refuses(
      `INSERT INTO conversation_events (conversation_id, ordinal, kind, request_id)
       VALUES ($1, 1, 'secret_exfiltrated', $2)`,
      [conversation, REQUEST_ID],
      { code: CHECK_VIOLATION },
    );
  });

  it("accepts every kind the contract publishes, and only those", async () => {
    // Both directions. A constraint listing a superset would accept a word the
    // contract cannot express; a subset would refuse one it can.
    expect([...SCHEMA_EVENT_KINDS].sort()).toEqual([...EVENT_KINDS].sort());
    const conversation = await newConversation("01JBXQ8Z9WKTQ6M4H2NPVR3T06");
    let ordinal = 0;
    for (const kind of SCHEMA_EVENT_KINDS) {
      ordinal += 1;
      const requestId = `sr_${"c".repeat(30)}${String(ordinal).padStart(2, "0")}`;
      if (kind === "message") {
        const body = await newBody("ordinary");
        await pool.query(
          `INSERT INTO conversation_events (conversation_id, ordinal, kind, actor, body_id)
           VALUES ($1, $2, 'message', 'student', $3)`,
          [conversation, ordinal, body],
        );
        continue;
      }
      // ── The interview's proposal exchange (ADR-0051) ────────────────
      //
      // Not a secure event: it names no request, and migration 0008 rewrote
      // `secure_events_name_a_request` from "everything that is not a message"
      // to an explicit list precisely so this row is legal and a secure event
      // still cannot be written without one.
      if (kind === "value_proposed" || kind === "value_confirmed" || kind === "value_rejected") {
        const proposal = kind === "value_proposed" ? { value: "x" } : null;
        const playback =
          kind === "value_rejected" ? null : `sha256:${"a".repeat(64)}`;
        await pool.query(
          `INSERT INTO conversation_events
             (conversation_id, ordinal, kind, field_key, proposal, playback_hash)
           VALUES ($1, $2, $3, 'identity.given_name', $4::jsonb, $5)`,
          [conversation, ordinal, kind, proposal === null ? null : JSON.stringify(proposal), playback],
        );
        continue;
      }
      const columns: Record<string, unknown> = { request_id: requestId };
      if (kind === "secret_requested") {
        columns["channel"] = "secure_control";
        columns["expires_at"] = new Date(Date.now() + 300_000);
      }
      if (kind === "secret_received") columns["handle"] = `sh_${"d".repeat(30)}${String(ordinal).padStart(2, "0")}`;
      if (kind === "secret_rejected") columns["reason_code"] = "confirmation_mismatch";
      const names = ["conversation_id", "ordinal", "kind", ...Object.keys(columns)];
      const values = [conversation, ordinal, kind, ...Object.values(columns)];
      await pool.query(
        `INSERT INTO conversation_events (${names.join(", ")})
         VALUES (${names.map((_, index) => `$${String(index + 1)}`).join(", ")})`,
        values,
      );
    }
    const written = await pool.query<{ n: string }>(
      "SELECT count(*) AS n FROM conversation_events WHERE conversation_id = $1",
      [conversation],
    );
    expect(Number(written.rows[0]!.n)).toBe(SCHEMA_EVENT_KINDS.length);
  });

  // ── The proposal exchange's own rules (ADR-0051, migration 0008) ───────
  //
  // Written as refusals rather than as a comment on the migration, because a
  // CHECK nothing ever violates in a test is a CHECK that can be loosened
  // without anything noticing. Each of these three was loosened deliberately
  // and only these tests failed.

  it("refuses a confirmation that carries a value of its own", async () => {
    // What was agreed is the proposal the hash names. A confirmation carrying
    // its own value would be a second place the agreed value lives, able to
    // disagree with the proposal the student actually read.
    const conversation = await newConversation("01JBXQ8Z9WKTQ6M4H2NPVR3T50");
    await refuses(
      `INSERT INTO conversation_events
         (conversation_id, ordinal, kind, field_key, proposal, playback_hash)
       VALUES ($1, 1, 'value_confirmed', 'identity.given_name', '{"value":"x"}'::jsonb, $2)`,
      [conversation, `sha256:${"a".repeat(64)}`],
      { code: CHECK_VIOLATION, constraint: "only_a_proposal_carries_a_value" },
    );
  });

  it("refuses a proposal with no value at all", async () => {
    // The other half: the constraint is an equivalence, so it must also refuse
    // a proposal that proposes nothing.
    const conversation = await newConversation("01JBXQ8Z9WKTQ6M4H2NPVR3T51");
    await refuses(
      `INSERT INTO conversation_events
         (conversation_id, ordinal, kind, field_key, playback_hash)
       VALUES ($1, 1, 'value_proposed', 'identity.given_name', $2)`,
      [conversation, `sha256:${"a".repeat(64)}`],
      { code: CHECK_VIOLATION, constraint: "only_a_proposal_carries_a_value" },
    );
  });

  it("refuses a proposal exchange that names no field", async () => {
    const conversation = await newConversation("01JBXQ8Z9WKTQ6M4H2NPVR3T52");
    await refuses(
      `INSERT INTO conversation_events (conversation_id, ordinal, kind)
       VALUES ($1, 1, 'value_rejected')`,
      [conversation],
      { code: CHECK_VIOLATION, constraint: "a_proposal_exchange_names_a_field" },
    );
  });

  it("refuses a MESSAGE that names a field", async () => {
    // The equivalence again, from the other side: `field_key` belongs to the
    // exchange and to nothing else.
    const conversation = await newConversation("01JBXQ8Z9WKTQ6M4H2NPVR3T53");
    const body = await newBody("hello");
    await refuses(
      `INSERT INTO conversation_events (conversation_id, ordinal, kind, actor, body_id, field_key)
       VALUES ($1, 1, 'message', 'student', $2, 'identity.given_name')`,
      [conversation, body],
      { code: CHECK_VIOLATION, constraint: "a_proposal_exchange_names_a_field" },
    );
  });

  it("refuses a rejection that carries a playback hash", async () => {
    // A rejection answers a playback but is not itself one. The hash pairs a
    // proposal with the confirmation that agreed to it.
    const conversation = await newConversation("01JBXQ8Z9WKTQ6M4H2NPVR3T54");
    await refuses(
      `INSERT INTO conversation_events (conversation_id, ordinal, kind, field_key, playback_hash)
       VALUES ($1, 1, 'value_rejected', 'identity.given_name', $2)`,
      [conversation, `sha256:${"a".repeat(64)}`],
      { code: CHECK_VIOLATION, constraint: "a_playback_hash_belongs_to_the_exchange" },
    );
  });

  it("refuses an actor outside the closed set, and matches the contract", async () => {
    expect([...SCHEMA_ACTORS].sort()).toEqual([...ACTORS].sort());
    const conversation = await newConversation("01JBXQ8Z9WKTQ6M4H2NPVR3T07");
    const body = await newBody("x");
    await refuses(
      `INSERT INTO conversation_events (conversation_id, ordinal, kind, actor, body_id)
       VALUES ($1, 1, 'message', 'administrator', $2)`,
      [conversation, body],
      { code: CHECK_VIOLATION },
    );
  });

  it("refuses a rejection reason outside the closed set", async () => {
    const conversation = await newConversation("01JBXQ8Z9WKTQ6M4H2NPVR3T08");
    await refuses(
      `INSERT INTO conversation_events
         (conversation_id, ordinal, kind, request_id, reason_code)
       VALUES ($1, 1, 'secret_rejected', $2, 'server_error')`,
      [conversation, REQUEST_ID],
      { code: CHECK_VIOLATION },
    );
  });

  it("admits exactly the rejection reasons the contract publishes", async () => {
    const conversation = await newConversation("01JBXQ8Z9WKTQ6M4H2NPVR3T09");
    let ordinal = 0;
    for (const reason of REJECTION_REASONS) {
      ordinal += 1;
      await pool.query(
        `INSERT INTO conversation_events
           (conversation_id, ordinal, kind, request_id, reason_code)
         VALUES ($1, $2, 'secret_rejected', $3, $4)`,
        [conversation, ordinal, REQUEST_ID, reason],
      );
    }
    expect(ordinal).toBe(REJECTION_REASONS.length);
  });

  it("refuses a malformed request id or handle", async () => {
    const conversation = await newConversation("01JBXQ8Z9WKTQ6M4H2NPVR3T10");
    await refuses(
      `INSERT INTO conversation_events (conversation_id, ordinal, kind, request_id)
       VALUES ($1, 1, 'secret_expired', 'not-a-request-id')`,
      [conversation],
      { code: CHECK_VIOLATION },
    );
    await refuses(
      `INSERT INTO conversation_events
         (conversation_id, ordinal, kind, request_id, handle)
       VALUES ($1, 2, 'secret_received', $2, 'sh_NOT_HEX')`,
      [conversation, REQUEST_ID],
      { code: CHECK_VIOLATION },
    );
  });

  it("refuses a conversation id that is not a ULID", async () => {
    // The CHECK is the pattern published in conversation.v1.yaml, so the
    // contract and the column cannot disagree about what an id is.
    await refuses(
      "INSERT INTO conversations (id, student_id) VALUES ('not-a-ulid', $1)",
      [studentId],
      { code: CHECK_VIOLATION },
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Handles, reasons, channels, expiries
// ───────────────────────────────────────────────────────────────────────────

describeIfDatabase("a field belongs to exactly the kind that has it", () => {
  it("refuses a handle on anything but a receipt, in both directions", async () => {
    const conversation = await newConversation("01JBXQ8Z9WKTQ6M4H2NPVR3T11");
    // A handle on a cancellation would make a dead request look live.
    await refuses(
      `INSERT INTO conversation_events
         (conversation_id, ordinal, kind, request_id, handle)
       VALUES ($1, 1, 'secret_cancelled', $2, $3)`,
      [conversation, REQUEST_ID, HANDLE],
      { code: CHECK_VIOLATION, constraint: "a_handle_means_receipt" },
    );
    // And a receipt without one would be a receipt for nothing.
    await refuses(
      `INSERT INTO conversation_events (conversation_id, ordinal, kind, request_id)
       VALUES ($1, 2, 'secret_received', $2)`,
      [conversation, REQUEST_ID],
      { code: CHECK_VIOLATION, constraint: "a_handle_means_receipt" },
    );
  });

  it("refuses a reason on anything but a rejection, in both directions", async () => {
    const conversation = await newConversation("01JBXQ8Z9WKTQ6M4H2NPVR3T12");
    await refuses(
      `INSERT INTO conversation_events
         (conversation_id, ordinal, kind, request_id, reason_code)
       VALUES ($1, 1, 'secret_expired', $2, 'expired')`,
      [conversation, REQUEST_ID],
      { code: CHECK_VIOLATION, constraint: "a_reason_means_rejection" },
    );
    await refuses(
      `INSERT INTO conversation_events (conversation_id, ordinal, kind, request_id)
       VALUES ($1, 2, 'secret_rejected', $2)`,
      [conversation, REQUEST_ID],
      { code: CHECK_VIOLATION, constraint: "a_reason_means_rejection" },
    );
  });

  it("keeps the channel and the expiry on the request and nowhere else", async () => {
    const conversation = await newConversation("01JBXQ8Z9WKTQ6M4H2NPVR3T13");
    await refuses(
      `INSERT INTO conversation_events
         (conversation_id, ordinal, kind, request_id, channel)
       VALUES ($1, 1, 'secret_expired', $2, 'secure_control')`,
      [conversation, REQUEST_ID],
      { code: CHECK_VIOLATION, constraint: "only_a_request_has_a_channel" },
    );
    await refuses(
      `INSERT INTO conversation_events
         (conversation_id, ordinal, kind, request_id, channel)
       VALUES ($1, 2, 'secret_requested', $2, 'secure_control')`,
      [conversation, REQUEST_ID],
      { code: CHECK_VIOLATION, constraint: "only_a_request_has_an_expiry" },
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Ordinals
// ───────────────────────────────────────────────────────────────────────────

describeIfDatabase("one event per position", () => {
  it("refuses a second event at the same ordinal", async () => {
    const conversation = await newConversation("01JBXQ8Z9WKTQ6M4H2NPVR3T14");
    const first = await newBody("first");
    const second = await newBody("second");
    await pool.query(
      `INSERT INTO conversation_events (conversation_id, ordinal, kind, actor, body_id)
       VALUES ($1, 1, 'message', 'student', $2)`,
      [conversation, first],
    );
    // This is the race two concurrent writers lose: one gets 23505 rather than
    // both believing they wrote position 1.
    await refuses(
      `INSERT INTO conversation_events (conversation_id, ordinal, kind, actor, body_id)
       VALUES ($1, 1, 'message', 'assistant', $2)`,
      [conversation, second],
      { code: UNIQUE_VIOLATION, constraint: "one_event_per_position" },
    );
  });

  it("allows the same ordinal in a DIFFERENT conversation", async () => {
    const other = await newConversation("01JBXQ8Z9WKTQ6M4H2NPVR3T15");
    const body = await newBody("first here too");
    await pool.query(
      `INSERT INTO conversation_events (conversation_id, ordinal, kind, actor, body_id)
       VALUES ($1, 1, 'message', 'student', $2)`,
      [other, body],
    );
    expect(true).toBe(true);
  });

  it("refuses ordinal zero", async () => {
    const conversation = await newConversation("01JBXQ8Z9WKTQ6M4H2NPVR3T16");
    const body = await newBody("x");
    await refuses(
      `INSERT INTO conversation_events (conversation_id, ordinal, kind, actor, body_id)
       VALUES ($1, 0, 'message', 'student', $2)`,
      [conversation, body],
      { code: CHECK_VIOLATION },
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Redaction
// ───────────────────────────────────────────────────────────────────────────

describeIfDatabase("redaction removes the text and keeps the shape", () => {
  it("refuses a body that is null without being redacted, and the reverse", async () => {
    await refuses(
      "INSERT INTO message_bodies (content) VALUES (NULL)",
      [],
      { code: CHECK_VIOLATION, constraint: "redaction_is_explicit" },
    );
    await refuses(
      "INSERT INTO message_bodies (content, redacted_at) VALUES ('still here', now())",
      [],
      { code: CHECK_VIOLATION, constraint: "redaction_is_explicit" },
    );
  });

  it("redacts in place, leaving the event and the ordinal untouched", async () => {
    const conversation = await newConversation("01JBXQ8Z9WKTQ6M4H2NPVR3T17");
    // A marker unique to THIS test. The first version reused the shared one and
    // then scanned the whole table, which found a row an earlier test had
    // legitimately written — message bodies are where free text belongs. The
    // assertion was scoped wrongly, not the schema.
    const redactable = `${MARKER}-redactable`;
    const body = await newBody(redactable);
    await pool.query(
      `INSERT INTO conversation_events (conversation_id, ordinal, kind, actor, body_id)
       VALUES ($1, 1, 'message', 'student', $2)`,
      [conversation, body],
    );

    await pool.query(
      "UPDATE message_bodies SET content = NULL, redacted_at = now() WHERE id = $1",
      [body],
    );

    const rows = await pool.query<{ ordinal: number; content: string | null }>(
      `SELECT e.ordinal, b.content
         FROM conversation_events e JOIN message_bodies b ON b.id = e.body_id
        WHERE e.conversation_id = $1`,
      [conversation],
    );
    expect(rows.rows).toEqual([{ ordinal: 1, content: null }]);
    // The text is gone from the database entirely, not merely hidden.
    const scan = await pool.query<{ n: string }>(
      "SELECT count(*) AS n FROM message_bodies WHERE content LIKE $1",
      [`%${redactable}%`],
    );
    expect(Number(scan.rows[0]!.n)).toBe(0);
  });

  it("REFUSES to delete a body an event still points at", async () => {
    // ON DELETE RESTRICT, not SET NULL. SET NULL would silently violate
    // `only_messages_have_bodies` the first time anybody deleted a body, and
    // the message would become an event of no kind at all.
    const conversation = await newConversation("01JBXQ8Z9WKTQ6M4H2NPVR3T18");
    const body = await newBody("do not delete me");
    await pool.query(
      `INSERT INTO conversation_events (conversation_id, ordinal, kind, actor, body_id)
       VALUES ($1, 1, 'message', 'student', $2)`,
      [conversation, body],
    );
    await refuses(
      "DELETE FROM message_bodies WHERE id = $1",
      [body],
      { code: FOREIGN_KEY_VIOLATION },
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The guard
// ───────────────────────────────────────────────────────────────────────────

describeIfDatabase("the open-request view is the fail-closed guard", () => {
  it("reports a request that has been asked for and not settled", async () => {
    const conversation = await newConversation("01JBXQ8Z9WKTQ6M4H2NPVR3T19");
    await pool.query(
      `INSERT INTO conversation_events
         (conversation_id, ordinal, kind, request_id, channel, expires_at)
       VALUES ($1, 1, 'secret_requested', $2, 'secure_control', now() + interval '5 min')`,
      [conversation, REQUEST_ID],
    );
    const open = await pool.query<{ request_id: string }>(
      "SELECT request_id FROM open_secret_requests WHERE conversation_id = $1",
      [conversation],
    );
    expect(open.rows.map((row) => row.request_id)).toEqual([REQUEST_ID]);
  });

  it("does NOT close on a rejection — the divergence Phase D removed", async () => {
    const conversation = await newConversation("01JBXQ8Z9WKTQ6M4H2NPVR3T20");
    await pool.query(
      `INSERT INTO conversation_events
         (conversation_id, ordinal, kind, request_id, channel, expires_at)
       VALUES ($1, 1, 'secret_requested', $2, 'secure_control', now() + interval '5 min')`,
      [conversation, REQUEST_ID],
    );
    await pool.query(
      `INSERT INTO conversation_events
         (conversation_id, ordinal, kind, request_id, reason_code)
       VALUES ($1, 2, 'secret_rejected', $2, 'confirmation_mismatch')`,
      [conversation, REQUEST_ID],
    );
    const open = await pool.query(
      "SELECT request_id FROM open_secret_requests WHERE conversation_id = $1",
      [conversation],
    );
    expect(open.rowCount).toBe(1);
  });

  it("closes on every settling kind, and on nothing else", async () => {
    let suffix = 20;
    for (const kind of SETTLING_KINDS) {
      suffix += 1;
      const conversation = await newConversation(`01JBXQ8Z9WKTQ6M4H2NPVR3T${String(suffix)}`);
      const requestId = `sr_${"e".repeat(30)}${String(suffix)}`;
      await pool.query(
        `INSERT INTO conversation_events
           (conversation_id, ordinal, kind, request_id, channel, expires_at)
         VALUES ($1, 1, 'secret_requested', $2, 'secure_control', now() + interval '5 min')`,
        [conversation, requestId],
      );
      const extra: Record<string, unknown> = {};
      if (kind === "secret_received") extra["handle"] = `sh_${"f".repeat(30)}${String(suffix)}`;
      const names = ["conversation_id", "ordinal", "kind", "request_id", ...Object.keys(extra)];
      await pool.query(
        `INSERT INTO conversation_events (${names.join(", ")})
         VALUES (${names.map((_, i) => `$${String(i + 1)}`).join(", ")})`,
        [conversation, 2, kind, requestId, ...Object.values(extra)],
      );
      const open = await pool.query(
        "SELECT request_id FROM open_secret_requests WHERE conversation_id = $1",
        [conversation],
      );
      expect(open.rowCount, kind).toBe(0);
    }
  });

  it("does not let one request's settlement close another's", async () => {
    const conversation = await newConversation("01JBXQ8Z9WKTQ6M4H2NPVR3T30");
    const live = `sr_${"1".repeat(32)}`;
    const stale = `sr_${"2".repeat(32)}`;
    await pool.query(
      `INSERT INTO conversation_events
         (conversation_id, ordinal, kind, request_id, channel, expires_at)
       VALUES ($1, 1, 'secret_requested', $2, 'secure_control', now() + interval '5 min')`,
      [conversation, live],
    );
    await pool.query(
      `INSERT INTO conversation_events (conversation_id, ordinal, kind, request_id)
       VALUES ($1, 2, 'secret_expired', $2)`,
      [conversation, stale],
    );
    const open = await pool.query<{ request_id: string }>(
      "SELECT request_id FROM open_secret_requests WHERE conversation_id = $1",
      [conversation],
    );
    expect(open.rows.map((row) => row.request_id)).toEqual([live]);
  });

  it("leaves the clock to the caller, so expiry stays testable", async () => {
    // The view has no `now()` in it. A clock inside a view is an ambient read
    // no test can move, and every clock in this repository is injected.
    const definition = await pool.query<{ definition: string }>(
      "SELECT pg_get_viewdef('open_secret_requests'::regclass, true) AS definition",
    );
    expect(definition.rows[0]!.definition).not.toMatch(/\bnow\(\)|CURRENT_TIMESTAMP/i);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Idempotency and ownership
// ───────────────────────────────────────────────────────────────────────────

describeIfDatabase("idempotency and ownership", () => {
  it("scopes a key to one student, so two students cannot collide", async () => {
    const other = await pool.query<{ id: string }>(
      "INSERT INTO students (subject) VALUES ($1) RETURNING id",
      ["oidc-subject-2"],
    );
    const key = "k".repeat(20);
    const digest = "a".repeat(64);
    await pool.query(
      "INSERT INTO idempotency_keys (student_id, key, request_digest) VALUES ($1, $2, $3)",
      [studentId, key, digest],
    );
    // The same key, a different student: allowed.
    await pool.query(
      "INSERT INTO idempotency_keys (student_id, key, request_digest) VALUES ($1, $2, $3)",
      [other.rows[0]!.id, key, digest],
    );
    // The same key, the same student: refused.
    await refuses(
      "INSERT INTO idempotency_keys (student_id, key, request_digest) VALUES ($1, $2, $3)",
      [studentId, key, digest],
      { code: UNIQUE_VIOLATION },
    );
  });

  it("refuses a digest that is not a SHA-256", async () => {
    await refuses(
      "INSERT INTO idempotency_keys (student_id, key, request_digest) VALUES ($1, $2, $3)",
      [studentId, "j".repeat(20), MARKER],
      { code: CHECK_VIOLATION },
    );
  });

  it("refuses a conversation with no student, and cascades when one goes", async () => {
    await refuses(
      "INSERT INTO conversations (id, student_id) VALUES ($1, gen_random_uuid())",
      ["01JBXQ8Z9WKTQ6M4H2NPVR3T40"],
      { code: FOREIGN_KEY_VIOLATION },
    );

    const doomed = await pool.query<{ id: string }>(
      "INSERT INTO students (subject) VALUES ($1) RETURNING id",
      ["oidc-subject-doomed"],
    );
    await pool.query("INSERT INTO conversations (id, student_id) VALUES ($1, $2)", [
      "01JBXQ8Z9WKTQ6M4H2NPVR3T41",
      doomed.rows[0]!.id,
    ]);
    await pool.query("DELETE FROM students WHERE id = $1", [doomed.rows[0]!.id]);
    const left = await pool.query("SELECT 1 FROM conversations WHERE id = $1", [
      "01JBXQ8Z9WKTQ6M4H2NPVR3T41",
    ]);
    expect(left.rowCount).toBe(0);
  });

  it("requires a subject on every student", async () => {
    await refuses(
      "INSERT INTO students (subject) VALUES (NULL)",
      [],
      { code: NOT_NULL_VIOLATION },
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
// ADR-0003, for this directory specifically
// ───────────────────────────────────────────────────────────────────────────

describeIfDatabase("a lease names a page only when it is holding one", () => {
  // ADR-0047. The lease's `page_ref` answers "which page is this runner
  // holding", and only a fill holds one — `create_account` is a single form and
  // the account either exists or does not. An account-creation lease carrying a
  // page ref would be a claim about a page nobody is on, and the report would
  // then key an `advance_portal_page` intent for a page nothing ever filled.
  //
  // In the CHECK rather than in the handler, for the reason every constraint in
  // this schema is: application-level rules race, drift, and can be bypassed by
  // a migration script or a psql session.
  const run = "run_lease_check_1";

  it("refuses an account-creation lease that names a page", async () => {
    await expect(
      pool.query(
        `INSERT INTO work_leases (run_id, lease_id, kind, holder, claimed_at, expires_at, page_ref)
              VALUES ($1, 'wl_x', 'create_account', 'runner', now(), now() + interval '2 minutes', 'page-application')`,
        [run],
      ),
    ).rejects.toThrow(/work_leases_only_fill_names_a_page/);
  });

  it("refuses a page VERSION on a lease that names no page", async () => {
    // ADR-0051 §6. A content hash with no page is a claim about content on no
    // page at all, and the target is rebuilt from the pair.
    await expect(
      pool.query(
        `INSERT INTO work_leases (run_id, lease_id, kind, holder, claimed_at, expires_at, page_version)
              VALUES ($1, 'wl_v', 'create_account', 'runner', now(), now() + interval '2 minutes', $2)`,
        [run, `sha256:${"a".repeat(64)}`],
      ),
    ).rejects.toThrow(/work_leases_a_version_belongs_to_a_page/);
  });

  it("accepts a fill lease that names one, and an account lease that does not", async () => {
    // Both halves, so the constraint is shown to admit what it should as well
    // as refuse what it should — a rule that refuses everything passes the test
    // above and is useless.
    await pool.query(
      `INSERT INTO work_leases (run_id, lease_id, kind, holder, claimed_at, expires_at, page_ref)
            VALUES ($1, 'wl_a', 'execute', 'runner', now(), now() + interval '2 minutes', 'page-application')`,
      [run],
    );
    await pool.query(
      `INSERT INTO work_leases (run_id, lease_id, kind, holder, claimed_at, expires_at, page_ref)
            VALUES ($1, 'wl_b', 'create_account', 'runner', now(), now() + interval '2 minutes', NULL)`,
      [`${run}_2`],
    );
    const rows = await pool.query<{ page_ref: string | null }>(
      "SELECT page_ref FROM work_leases WHERE run_id IN ($1, $2) ORDER BY run_id",
      [run, `${run}_2`],
    );
    expect(rows.rows.map((row) => row.page_ref)).toEqual(["page-application", null]);
    await pool.query("DELETE FROM work_leases WHERE run_id IN ($1, $2)", [run, `${run}_2`]);
  });
});

describeIfDatabase("migrations are forward-only and applied once", () => {
  it("applies nothing on a second run", async () => {
    const fresh = await ownDatabase("aas_conversation_twice");
    try {
      expect(await migrate(fresh, MIGRATIONS_DIR)).toEqual([
        "0001_conversation_log",
        "0002_application_runs",
        "0003_profile_entries",
        "0004_case_blueprint",
        "0005_work_leases",
        "0006_execute_work",
        "0007_lease_page",
        "0008_value_proposals",
        "0009_lease_page_version",
    "0010_worker_leases",
      "0011_verification_is_established_at_login",
      ]);
      expect(await migrate(fresh, MIGRATIONS_DIR)).toEqual([]);
    } finally {
      await fresh.end();
    }
  }, 60_000);

  it("refuses to run when an applied file has been edited", async () => {
    // The failure this catches: someone adds a column to 0001, it applies
    // cleanly on their empty laptop database, and does NOTHING AT ALL in every
    // environment where 0001 already ran. Checked against THIS service's
    // directory, so a service wired to the wrong one is caught here rather
    // than in production.
    const fresh = await ownDatabase("aas_conversation_edited");
    try {
      await migrate(fresh, MIGRATIONS_DIR);
      await fresh.query("UPDATE schema_migrations SET checksum = $1", ["0".repeat(64)]);
      await expect(() => migrate(fresh, MIGRATIONS_DIR)).rejects.toThrow(
        MigrationChangedError,
      );
    } finally {
      await fresh.end();
    }
  }, 60_000);

  it("names and orders every migration as ADR-0003 requires", () => {
    // The list is written out rather than counted. A new migration is a
    // reviewed addition, so it should be a line in a diff here too — and the
    // ORDER matters, because 0002 adds a foreign key to a table 0001 created.
    const migrations = loadMigrations(MIGRATIONS_DIR);
    expect(migrations.map((migration) => migration.version)).toEqual([
      "0001_conversation_log",
      "0002_application_runs",
      "0003_profile_entries",
      "0004_case_blueprint",
      "0005_work_leases",
      "0006_execute_work",
      "0007_lease_page",
      "0008_value_proposals",
      "0009_lease_page_version",
    "0010_worker_leases",
      "0011_verification_is_established_at_login",
    ]);
    // Zero-padded, so 0002 sorts after 0001 and before 0010 — which an
    // unpadded numeric sort of filenames gets wrong.
    for (const migration of migrations) expect(migration.version).toMatch(/^[0-9]{4}_/);
  });
});
