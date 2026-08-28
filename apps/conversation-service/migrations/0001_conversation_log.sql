-- 0001 · The conversation log, and the constraint that makes a secure event
--        unable to hold what a student typed.
--
-- Forward-only and reviewed, per ADR-0003. This file is never edited once it
-- has been applied anywhere — a change is a new numbered file.
--
-- ADR-0031 (one append-only log), ADR-0032 (cancellation is its own word),
-- ADR-0037 (this database is the CONVERSATION plane's, with its own
-- credentials; it cannot read the secure plane's), ADR-0038 (identity is
-- delegated: `sub` is the only identifier we persist).
--
-- ── Where the security guarantees actually live ──────────────────────────
--
-- In the CHECK constraints below, not in the application above them.
-- Application-level rules race, drift and can be bypassed by a migration
-- script, a psql session or a bug. A constraint cannot.
--
--   only a message has free text     CHECK ((kind = 'message') = (body_id IS NOT NULL))
--   a secure event names a request   CHECK ((kind = 'message') = (request_id IS NULL))
--   a handle only after receipt      CHECK (handle IS NULL OR kind = 'secret_received')
--   closed vocabularies              CHECK (… IN (…)) on kind, actor, reason_code, channel
--   one row per position             UNIQUE (conversation_id, ordinal)
--   redaction is not deletion        ON DELETE RESTRICT on body_id
--
-- ── What is deliberately NOT here ────────────────────────────────────────
--
--   * No password column, hash, length, or strength score. A length is a fact
--     about a password and a strength score is a fact derived from one.
--   * No prompt title, explanation or portal host. Those are text a model
--     wrote about a password; the secure service holds them and renders them
--     itself, so this plane never receives them and the CHECK above needs no
--     exception.
--   * No `metadata jsonb`. An untyped bag defeats every constraint in this
--     file. A new fact is a typed column with a CHECK, or a new event kind.

-- ───────────────────────────────────────────────────────────────────────────
-- Students
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS students (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The OIDC `sub`, and the ONLY identifier the provider gives us that we
    -- persist (ADR-0038). Email is profile data, not identity: a student who
    -- changes it must not become a different person.
    subject         text        NOT NULL UNIQUE CHECK (length(subject) BETWEEN 1 AND 255),

    -- Re-read from the provider at every secure step rather than trusted from
    -- a client claim. Stored so an unverified student can be told why.
    email_verified  boolean     NOT NULL DEFAULT false,

    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ───────────────────────────────────────────────────────────────────────────
-- Conversations
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS conversations (
    -- A ULID, matching the pattern published in conversation.v1.yaml. The
    -- CHECK is that pattern: the contract and the column cannot disagree,
    -- because the column will not hold a value the contract forbids.
    id              text        PRIMARY KEY CHECK (id ~ '^[0-9A-HJKMNP-TV-Z]{26}$'),
    student_id      uuid        NOT NULL REFERENCES students(id) ON DELETE CASCADE,

    title           text        CHECK (title IS NULL OR length(title) <= 200),

    -- The highest ordinal written. Maintained in the same transaction as the
    -- event insert, so it is a cache of the log rather than a second opinion
    -- about it; `conversation_ordinals_agree` in the tests reconciles the two.
    last_ordinal    integer     NOT NULL DEFAULT 0 CHECK (last_ordinal >= 0),

    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS conversations_by_student
    ON conversations (student_id, created_at DESC);

-- ───────────────────────────────────────────────────────────────────────────
-- Message bodies — the only free text in the system
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS message_bodies (
    id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    -- NULL means redacted. Not "empty", not "deleted" — the row survives so
    -- the event that points at it survives, so ordinals stay dense and the
    -- transcript keeps its shape (ADR-0031).
    content     text,
    redacted_at timestamptz,

    created_at  timestamptz NOT NULL DEFAULT now(),

    -- Redaction is explicit and symmetric: content goes away exactly when the
    -- timestamp appears. A NULL body with no timestamp would be a write that
    -- failed half-way and looks like an erasure.
    CONSTRAINT redaction_is_explicit
        CHECK ((content IS NULL) = (redacted_at IS NOT NULL)),
    CONSTRAINT content_is_bounded
        CHECK (content IS NULL OR length(content) <= 8000)
);

-- ───────────────────────────────────────────────────────────────────────────
-- The log
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS conversation_events (
    id              bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    conversation_id text        NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,

    -- Dense, 1-based, per conversation. Also the SSE event id, which is what
    -- makes `Last-Event-ID` resumption need no cursor of its own.
    ordinal         integer     NOT NULL CHECK (ordinal >= 1),

    kind            text        NOT NULL CHECK (kind IN (
                        'message',
                        'secret_requested',
                        'secret_received',
                        'secret_consumed',
                        'secret_expired',
                        'secret_cancelled',
                        'secret_rejected')),

    -- Only a message has an actor. A lifecycle transition is not "from"
    -- anybody: it is a fact about a request.
    actor           text        CHECK (actor IS NULL OR actor IN
                        ('student', 'assistant', 'mentor', 'system')),

    -- By REFERENCE, never by value. ON DELETE RESTRICT rather than SET NULL:
    -- SET NULL would silently violate `only_messages_have_bodies` the first
    -- time anybody deleted a body. Redaction is an UPDATE; deleting a body out
    -- from under a live event is refused.
    body_id         bigint      REFERENCES message_bodies(id) ON DELETE RESTRICT,

    request_id      text        CHECK (request_id IS NULL OR request_id ~ '^sr_[0-9a-f]{32}$'),

    -- Opaque, random rather than derived, single-use, and bound at the point
    -- it is spent. Safe here; it resolves to nothing outside a live vault.
    handle          text        CHECK (handle IS NULL OR handle ~ '^sh_[0-9a-f]{32}$'),

    reason_code     text        CHECK (reason_code IS NULL OR reason_code IN (
                        'confirmation_mismatch', 'empty', 'unknown_request', 'expired',
                        'already_submitted', 'not_your_request', 'wrong_conversation',
                        'endpoint_unreachable', 'prompt_expired',
                        'client_does_not_support_secure_control', 'insecure_context',
                        'unknown_channel')),

    channel         text        CHECK (channel IS NULL OR channel IN ('secure_control')),
    expires_at      timestamptz,

    created_at      timestamptz NOT NULL DEFAULT now(),

    -- One row per position. Two writers racing for ordinal 7: one gets 23505.
    CONSTRAINT one_event_per_position UNIQUE (conversation_id, ordinal),

    -- ── The load-bearing constraint ─────────────────────────────────────
    -- A message has a body; nothing else may have one. This is what makes
    -- "a secure event cannot hold what a student typed" a fact about the
    -- schema rather than a convention the application is trusted to keep.
    CONSTRAINT only_messages_have_bodies
        CHECK ((kind = 'message') = (body_id IS NOT NULL)),

    CONSTRAINT only_messages_have_an_actor
        CHECK ((kind = 'message') = (actor IS NOT NULL)),

    -- Its mirror: every secure event names the request it is about, and a
    -- message never does.
    CONSTRAINT secure_events_name_a_request
        CHECK ((kind = 'message') = (request_id IS NULL)),

    CONSTRAINT a_handle_means_receipt
        CHECK ((kind = 'secret_received') = (handle IS NOT NULL)),

    CONSTRAINT a_reason_means_rejection
        CHECK ((kind = 'secret_rejected') = (reason_code IS NOT NULL)),

    -- The channel and the expiry belong to the request itself, and to nothing
    -- that settles it.
    CONSTRAINT only_a_request_has_a_channel
        CHECK ((kind = 'secret_requested') = (channel IS NOT NULL)),
    CONSTRAINT only_a_request_has_an_expiry
        CHECK ((kind = 'secret_requested') = (expires_at IS NOT NULL))
);

-- Reading the transcript, and tailing it for SSE.
CREATE INDEX IF NOT EXISTS conversation_events_in_order
    ON conversation_events (conversation_id, ordinal);

-- The fail-closed guard, and the settlement lookup it depends on.
CREATE INDEX IF NOT EXISTS conversation_events_open_requests
    ON conversation_events (conversation_id, ordinal DESC)
    WHERE kind = 'secret_requested';
CREATE INDEX IF NOT EXISTS conversation_events_by_request
    ON conversation_events (conversation_id, request_id)
    WHERE request_id IS NOT NULL;

-- ───────────────────────────────────────────────────────────────────────────
-- The guard, as a view
-- ───────────────────────────────────────────────────────────────────────────

-- A request is OPEN when it has been asked for and nothing has settled it.
--
-- Deliberately NOT filtered by time. Every clock in this repository is
-- injected so that expiry is testable without waiting five minutes, and a
-- `now()` buried in a view is an ambient clock read that no test can move. The
-- caller supplies the instant: `WHERE conversation_id = $1 AND expires_at > $2`.
--
-- A rejection is deliberately absent from the settling kinds. A mistyped
-- confirmation leaves the request open so the student can retry; treating a
-- rejection as closure would release the composer while the request is live,
-- which is the client/server divergence Phase D removed.
CREATE OR REPLACE VIEW open_secret_requests AS
SELECT
    requested.conversation_id,
    requested.request_id,
    requested.expires_at,
    requested.ordinal
FROM conversation_events AS requested
WHERE requested.kind = 'secret_requested'
  AND NOT EXISTS (
      SELECT 1
      FROM conversation_events AS settled
      WHERE settled.conversation_id = requested.conversation_id
        AND settled.request_id      = requested.request_id
        AND settled.kind IN (
            'secret_received', 'secret_consumed', 'secret_expired', 'secret_cancelled')
  );

-- ───────────────────────────────────────────────────────────────────────────
-- Idempotency
-- ───────────────────────────────────────────────────────────────────────────

-- Written ONLY on the accepted path.
--
-- That matters more than it looks. The message endpoint's guard runs before
-- the body is read, so on a refused send there is no body in scope to digest —
-- and therefore no row here that could carry a digest of something a student
-- typed into the wrong box. The digest that IS stored covers a body already
-- held in plaintext in `message_bodies`, so it reveals nothing new.
CREATE TABLE IF NOT EXISTS idempotency_keys (
    student_id      uuid        NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    key             text        NOT NULL CHECK (length(key) BETWEEN 16 AND 128),

    -- SHA-256 of the canonical request body. Reuse of a key with a DIFFERENT
    -- body is a conflict, not a replay: returning the first result would hide
    -- a client bug rather than surface it.
    request_digest  text        NOT NULL CHECK (request_digest ~ '^[0-9a-f]{64}$'),

    event_id        bigint      REFERENCES conversation_events(id) ON DELETE CASCADE,
    created_at      timestamptz NOT NULL DEFAULT now(),

    -- Scoped per student, so one student's key cannot collide with another's.
    PRIMARY KEY (student_id, key)
);

CREATE INDEX IF NOT EXISTS idempotency_keys_by_age ON idempotency_keys (created_at);
