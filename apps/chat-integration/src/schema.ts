/**
 * AskiMate's actual conversation tables, plus the one column this adds.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-27: *"Do not invent a new frontend or endpoint architecture in
 * isolation. Inspect the existing… Find the actual points where a password
 * could leak."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `askimateConversations`, `askimateMessages` and `askimateUsers` below are
 * **transcribed from the real schema**, at
 * `vaahiiid/Universitio` → `archive/askimate/db-schema/askimate-conversations.ts`
 * and `askimate-users.ts`. They are here so the integration test writes to the
 * real table shapes with the real column types and the real NOT NULL
 * constraints — a test against an invented `messages(id, text)` table would
 * prove nothing about the system a password would actually leak into.
 *
 * ── The leak surface these tables represent ───────────────────────────────
 *
 * `askimate_messages.content` is `text NOT NULL`, holds every turn verbatim,
 * and is read back into `history` on the next request — which is then replayed
 * into the model's prompt. **A password that becomes a message is not merely
 * stored; it is re-sent to the model on every subsequent turn of that
 * conversation, indefinitely.** That is the single most important fact in this
 * file and it is what the whole secure control exists to avoid.
 *
 * ── What is added, and what is deliberately not ───────────────────────────
 *
 * `askimateSecretRequests` is new. It exists because a student can refresh the
 * page mid-password, and the chat has to be able to say "you were asked for a
 * password and the box is still open" without holding the password.
 *
 * **It has no column a password fits in.** Not an encrypted one, not a hashed
 * one, not a length. The plaintext lives only in the in-memory store in
 * `@askimate/aas-secrets`; this table holds the binding and the lifecycle word,
 * which is exactly what ADR-0026 permits to be written down.
 */

import {
  boolean,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

// ───────────────────────────────────────────────────────────────────────────
// AskiMate's real tables — transcribed, not designed
// ───────────────────────────────────────────────────────────────────────────

export const askimateUsers = pgTable("askimate_users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  emailVerified: boolean("email_verified").notNull().default(false),
  plan: text("plan").notNull().default("free"),
  trialEndsAt: timestamp("trial_ends_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const askimateConversations = pgTable("askimate_conversations", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  guestSessionId: text("guest_session_id"),
  title: text("title").default("New Conversation"),
  isGuest: boolean("is_guest").notNull().default(true),
  questionCount: integer("question_count").default(0),
  status: text("status").notNull().default("open"),
  mentorTakenOver: boolean("mentor_taken_over").notNull().default(false),
  needsExpertReview: boolean("needs_expert_review").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const askimateMessages = pgTable("askimate_messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull(),
  isUserMessage: boolean("is_user_message").notNull(),
  /** "user" | "ai" | "mentor" | "system" */
  sender: text("sender").notNull().default("ai"),
  /** Verbatim. Replayed into the model's prompt on every later turn. */
  content: text("content").notNull(),
  isRead: boolean("is_read").notNull().default(false),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ───────────────────────────────────────────────────────────────────────────
// What this integration adds
// ───────────────────────────────────────────────────────────────────────────

/**
 * The binding for one secure-password request. **No plaintext column.**
 *
 * Every column here is either an identifier, a lifecycle word, or a timestamp.
 * There is no `password`, no `password_encrypted`, no `password_hash` and no
 * `password_length` — the first three would be a credential at rest and the
 * fourth is a fact about the credential.
 *
 * The handle is stored because it is an opaque label that resolves to nothing
 * outside the in-memory store: after a process restart the row is a tombstone
 * saying a password was asked for, which is exactly what a student returning to
 * a refreshed page needs to see.
 */
export const askimateSecretRequests = pgTable("askimate_secret_requests", {
  id: serial("id").primaryKey(),
  /** `sr_…` — the request id minted by the secret store. */
  requestId: text("request_id").notNull(),
  /** Session binding. All four are checked before a secret may be spent. */
  userId: integer("user_id").notNull(),
  conversationId: integer("conversation_id").notNull(),
  caseRef: text("case_ref").notNull(),
  purpose: text("purpose").notNull(),
  targetHost: text("target_host").notNull(),
  /** One of the four words. Never a fifth. */
  lifecycle: text("lifecycle").notNull().default("secret_requested"),
  /** `sh_…`, once the student has typed something. Resolves to nothing here. */
  handle: text("handle"),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

/**
 * The DDL, so a test can create the real shapes without a migration runner.
 *
 * Kept beside the table definitions deliberately: if a column is added above
 * and not here, the integration test fails to insert and says so.
 */
export const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS askimate_users (
  id             serial PRIMARY KEY,
  email          text NOT NULL,
  password_hash  text NOT NULL,
  email_verified boolean NOT NULL DEFAULT false,
  plan           text NOT NULL DEFAULT 'free',
  trial_ends_at  timestamp,
  created_at     timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS askimate_conversations (
  id                  serial PRIMARY KEY,
  user_id             integer,
  guest_session_id    text,
  title               text DEFAULT 'New Conversation',
  is_guest            boolean NOT NULL DEFAULT true,
  question_count      integer DEFAULT 0,
  status              text NOT NULL DEFAULT 'open',
  mentor_taken_over   boolean NOT NULL DEFAULT false,
  needs_expert_review boolean NOT NULL DEFAULT false,
  created_at          timestamp NOT NULL DEFAULT now(),
  updated_at          timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS askimate_messages (
  id              serial PRIMARY KEY,
  conversation_id integer NOT NULL,
  is_user_message boolean NOT NULL,
  sender          text NOT NULL DEFAULT 'ai',
  content         text NOT NULL,
  is_read         boolean NOT NULL DEFAULT false,
  metadata        jsonb,
  created_at      timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS askimate_secret_requests (
  id              serial PRIMARY KEY,
  request_id      text NOT NULL,
  user_id         integer NOT NULL,
  conversation_id integer NOT NULL,
  case_ref        text NOT NULL,
  purpose         text NOT NULL,
  target_host     text NOT NULL,
  lifecycle       text NOT NULL DEFAULT 'secret_requested',
  handle          text,
  expires_at      timestamp NOT NULL,
  created_at      timestamp NOT NULL DEFAULT now(),
  updated_at      timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS askimate_conversation_events (
  id              serial PRIMARY KEY,
  conversation_id integer NOT NULL,
  ordinal         integer NOT NULL,
  -- Closed sets, enforced by the DATABASE. A free-text value cannot be
  -- smuggled into any of these columns, which is what makes "this table
  -- cannot hold what a student typed" a fact rather than a convention.
  kind            text NOT NULL CHECK (kind IN ('directive','secret_status','secret_rejected')),
  request_id      text NOT NULL,
  lifecycle       text CHECK (lifecycle IS NULL OR lifecycle IN
                    ('secret_requested','secret_received','secret_consumed',
                     'secret_expired','secret_cancelled')),
  reason_code     text CHECK (reason_code IS NULL OR reason_code IN
                    ('confirmation_mismatch','empty','unknown_request','expired',
                     'already_submitted','not_your_request','wrong_conversation',
                     'endpoint_unreachable','prompt_expired',
                     'client_does_not_support_secure_control','insecure_context',
                     'unknown_channel')),
  created_at      timestamp NOT NULL DEFAULT now(),
  -- One row per position per conversation: a replayed insert cannot duplicate
  -- an item in the transcript.
  UNIQUE (conversation_id, ordinal)
);
`;

/**
 * Every column in the schema that holds free text a password could land in.
 *
 * The adversarial test scans these by name rather than dumping whole rows, so
 * that adding a text column without thinking about it makes the scan wider
 * rather than leaving a blind spot.
 */
/**
 * Where a secure step SAT in the conversation — and nothing about what was
 * typed into it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-27: *"Persisting enough directive state to survive refresh
 * without ever persisting secret content."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── The problem ───────────────────────────────────────────────────────────
 *
 * `askimate_messages` stores only `kind: "message"` turns, because everything
 * in it is replayed to the model. That is right, and it means a directive and
 * its outcome are stored nowhere. A student who refreshes mid-flow gets a
 * conversation with a hole in it: the assistant's message, then nothing, then
 * a box that appears from somewhere with no explanation of why.
 *
 * ── Why this table cannot leak ────────────────────────────────────────────
 *
 * There is NO text column that anything typed could reach. `kind` and
 * `reason_code` are text, but both are constrained by CHECK to closed sets
 * the database itself enforces — so "just put the message in reason_code"
 * fails at the INSERT rather than at review. `request_id` is an identifier
 * minted before the student typed anything.
 *
 * Display text is reconstructed at read time from `askimate_secret_requests`
 * plus a fixed table of sentences. Nothing renderable is stored twice, and
 * nothing renderable is stored here at all.
 */
export const askimateConversationEvents = pgTable("askimate_conversation_events", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull(),
  /** Position in the transcript, so the item is redrawn where it happened. */
  ordinal: integer("ordinal").notNull(),
  /** `directive` | `secret_status` | `secret_rejected`. CHECK-constrained. */
  kind: text("kind").notNull(),
  /** Which request this concerns. An id, not content. */
  requestId: text("request_id").notNull(),
  /** Lifecycle word for a status; null otherwise. CHECK-constrained. */
  lifecycle: text("lifecycle"),
  /** Rejection code; null otherwise. CHECK-constrained. */
  reasonCode: text("reason_code"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const FREE_TEXT_COLUMNS: readonly { table: string; column: string }[] = [
  { table: "askimate_messages", column: "content" },
  { table: "askimate_messages", column: "metadata" },
  { table: "askimate_conversations", column: "title" },
  { table: "askimate_conversations", column: "guest_session_id" },
  { table: "askimate_users", column: "email" },
  { table: "askimate_users", column: "password_hash" },
  { table: "askimate_secret_requests", column: "request_id" },
  { table: "askimate_secret_requests", column: "handle" },
  { table: "askimate_secret_requests", column: "lifecycle" },
  { table: "askimate_secret_requests", column: "case_ref" },
  { table: "askimate_secret_requests", column: "purpose" },
  { table: "askimate_secret_requests", column: "target_host" },
  { table: "askimate_conversation_events", column: "kind" },
  { table: "askimate_conversation_events", column: "request_id" },
  { table: "askimate_conversation_events", column: "lifecycle" },
  { table: "askimate_conversation_events", column: "reason_code" },
];
