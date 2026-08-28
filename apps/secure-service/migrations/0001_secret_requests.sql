-- 0001 · Secret requests, frame tokens, sessions, and the use audit.
--
-- Forward-only and reviewed, per ADR-0003.
--
-- ADR-0026 (a password the model can ask for and never see), ADR-0030 (its own
-- origin), ADR-0032 (cancellation is its own word), ADR-0033 (the bootstrap),
-- ADR-0034 (the vault is ephemeral — NOT this database), ADR-0037 (separate
-- database, separate credentials, unreachable from the conversation plane).
--
-- ═══════════════════════════════════════════════════════════════════════════
-- THE PROPERTY THIS FILE EXISTS TO MAKE TRUE:
--
--   THERE IS NO COLUMN IN THIS SCHEMA THAT CAN HOLD A SECRET.
--
--   Not encrypted, not hashed, not truncated, not a length, not a strength
--   score. A length is a fact about a password and a strength score is a fact
--   derived from one. The plaintext lives in an ephemeral encrypted cache with
--   all persistence disabled (ADR-0034) and in one stack frame; it never
--   reaches this database, so there is nothing here to back up, replicate,
--   snapshot or subpoena.
--
--   `secret-schema.test.ts` asserts this by reading `information_schema`
--   after the migration runs, rather than by trusting this comment.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- Requests
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS secret_requests (
    request_id            text        PRIMARY KEY
                                      CHECK (request_id ~ '^sr_[0-9a-f]{32}$'),

    -- Who it was opened for. Checked at submission AND again when the handle
    -- is spent, because the two failures are different: one is someone
    -- answering a prompt that was not theirs, the other is a handle being
    -- spent somewhere it should not be.
    student_ref           text        NOT NULL CHECK (length(student_ref) BETWEEN 1 AND 128),
    conversation_id       text        NOT NULL CHECK (length(conversation_id) BETWEEN 1 AND 128),
    case_ref              text        NOT NULL CHECK (length(case_ref) BETWEEN 1 AND 128),

    -- Closed sets, and both come from the case and the blueprint rather than
    -- from model output. A prompt-injected model can ask for *a* password; it
    -- cannot choose whose, or for which portal.
    purpose               text        NOT NULL CHECK (purpose IN
                                      ('portal_account_creation', 'portal_password_reset')),
    target_host           text        NOT NULL CHECK (length(target_host) BETWEEN 1 AND 253),

    lifecycle             text        NOT NULL DEFAULT 'secret_requested'
                                      CHECK (lifecycle IN (
                                          'secret_requested', 'secret_received',
                                          'secret_consumed', 'secret_expired',
                                          'secret_cancelled')),

    -- Opaque and random rather than derived, so two students choosing the same
    -- password get unrelated handles and a handle reveals nothing about a
    -- value. UNIQUE so a collision is a constraint violation rather than a
    -- silent aliasing of one student's secret onto another's.
    handle                text        UNIQUE CHECK (handle IS NULL OR handle ~ '^sh_[0-9a-f]{32}$'),

    requires_confirmation boolean     NOT NULL DEFAULT true,

    -- Shown to the student INSIDE the secure frame, and never returned to the
    -- conversation plane. This is why the conversation log needs no exception
    -- to its "secure events carry no free text" constraint: the text a model
    -- wrote about a password stops here.
    title                 text        CHECK (title IS NULL OR length(title) <= 200),
    explanation           text        CHECK (explanation IS NULL OR length(explanation) <= 1000),

    expires_at            timestamptz NOT NULL,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),

    -- A handle exists exactly while a secret does or did. It appears at
    -- receipt and survives into consumption as an audit fact; it can never
    -- exist on a request nobody answered.
    CONSTRAINT a_handle_means_it_was_answered
        CHECK (handle IS NULL OR lifecycle IN ('secret_received', 'secret_consumed')),

    -- Its mirror: a received request must have one, so a receipt recorded
    -- without minting a handle is impossible rather than merely unlikely.
    CONSTRAINT receipt_requires_a_handle
        CHECK (lifecycle <> 'secret_received' OR handle IS NOT NULL)
);

-- The conversation's open-request lookup, and expiry sweeps.
CREATE INDEX IF NOT EXISTS secret_requests_open
    ON secret_requests (conversation_id, expires_at DESC)
    WHERE lifecycle = 'secret_requested';
CREATE INDEX IF NOT EXISTS secret_requests_expiring
    ON secret_requests (expires_at)
    WHERE lifecycle IN ('secret_requested', 'secret_received');

-- ───────────────────────────────────────────────────────────────────────────
-- Frame bootstrap tokens
-- ───────────────────────────────────────────────────────────────────────────

-- The one-time capability that turns "someone loaded this frame" into "this
-- student is answering this request" (ADR-0033).
--
-- ── Only the HASH is stored ──────────────────────────────────────────────
--
-- The token itself exists in the conversation service's memory, in one
-- postMessage, and in one request body. It is never written down. A database
-- holding usable bearer tokens is a database whose backup is a set of
-- credentials, and the comparison a hash costs is not worth the exposure.
CREATE TABLE IF NOT EXISTS frame_tokens (
    token_hash  text        PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    request_id  text        NOT NULL REFERENCES secret_requests(request_id) ON DELETE CASCADE,

    -- Seconds, not minutes. It exists only to cross one postMessage.
    expires_at  timestamptz NOT NULL,

    -- Single use, claimed atomically:
    --   UPDATE frame_tokens SET consumed_at = $now
    --    WHERE token_hash = $1 AND consumed_at IS NULL RETURNING request_id
    -- Checking first and then updating races, and the race is a token usable
    -- twice.
    consumed_at timestamptz,

    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS frame_tokens_by_request ON frame_tokens (request_id);

-- ───────────────────────────────────────────────────────────────────────────
-- Secure-plane sessions
-- ───────────────────────────────────────────────────────────────────────────

-- This plane's OWN session, established by exchanging a frame token
-- (ADR-0033). Server-side rather than a self-contained signed cookie, so a
-- session can be revoked the moment its request settles rather than remaining
-- valid until it expires.
--
-- Hashed, for the same reason as the tokens above.
CREATE TABLE IF NOT EXISTS secure_sessions (
    session_hash text        PRIMARY KEY CHECK (session_hash ~ '^[0-9a-f]{64}$'),
    request_id   text        NOT NULL REFERENCES secret_requests(request_id) ON DELETE CASCADE,

    -- Denormalised from the request on purpose: the ownership check on every
    -- submission reads it, and it must not be able to drift from the request
    -- it was minted for. `secure_sessions_match_their_request` in the tests
    -- reconciles the two.
    student_ref  text        NOT NULL,

    expires_at   timestamptz NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS secure_sessions_by_request ON secure_sessions (request_id);
CREATE INDEX IF NOT EXISTS secure_sessions_expiring ON secure_sessions (expires_at);

-- ───────────────────────────────────────────────────────────────────────────
-- The use audit
-- ───────────────────────────────────────────────────────────────────────────

-- Every attempt to spend a handle, successful or not (ADR-0025, ADR-0026).
--
-- Append-only by convention and by the absence of any UPDATE or DELETE in the
-- store's interface. It records THAT a capability spent a secret and what it
-- was for — never the value, never a derivative of it.
CREATE TABLE IF NOT EXISTS secret_uses (
    id           bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    request_id   text        NOT NULL REFERENCES secret_requests(request_id) ON DELETE CASCADE,
    handle       text        NOT NULL CHECK (handle ~ '^sh_[0-9a-f]{32}$'),

    -- The audit label of the capability that spent it.
    consumer     text        NOT NULL CHECK (length(consumer) BETWEEN 1 AND 128),

    outcome      text        NOT NULL CHECK (outcome IN ('used', 'refused')),

    -- Why it was refused, from a closed set. A free-text reason here would be
    -- the field somebody eventually fills in from the request that failed.
    refusal_code text        CHECK (refusal_code IS NULL OR refusal_code IN (
                                 'unknown_handle', 'already_spent', 'expired',
                                 'wrong_student', 'wrong_case', 'wrong_purpose',
                                 'wrong_target', 'diagnostic_capture_not_confirmed')),

    used_at      timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT a_refusal_has_a_code
        CHECK ((outcome = 'refused') = (refusal_code IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS secret_uses_by_request ON secret_uses (request_id, used_at);
