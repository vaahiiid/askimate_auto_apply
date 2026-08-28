-- 0002 · The lifecycle outbox: how a transition reaches the conversation log.
--
-- Forward-only and reviewed, per ADR-0003.
--
-- ADR-0031 (one conversation event log), ADR-0032 (cancellation is its own
-- word), ADR-0037 (separate databases, separate credentials).
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY AN OUTBOX AND NOT AN HTTP CALL
--
--   Vahid, 2026-08-28: *"The browser must remain a UX observer and
--   accelerator, not the authority for secure lifecycle transitions… A failed
--   lifecycle push must fail closed."*
--
--   The two planes have separate databases, so a lifecycle change here and the
--   event that records it there cannot share a transaction. Something has to
--   bridge them, and the choice is where the failure lands:
--
--     Push inside the request  → the student's submission fails because a
--                                DIFFERENT service was briefly unreachable,
--                                and the password they already typed is gone.
--     Push and forget          → a dropped call means the conversation log
--                                never learns the step settled, and the
--                                composer stays blocked for the whole TTL with
--                                nothing to explain it.
--     OUTBOX                   → the transition and the intent to publish it
--                                commit together, here, atomically. Delivery
--                                is retried until the conversation service
--                                confirms. A crash between the two is not a
--                                lost transition, because there is no moment
--                                at which one exists without the other.
--
--   That is the only arrangement in which "the transition happened" and "the
--   conversation log will hear about it" cannot disagree.
--
--   FAIL-CLOSED FOLLOWS FROM THE DIRECTION OF THE ERROR. An undelivered row
--   means the conversation log still shows the request OPEN, so the guard
--   there refuses messages. The failure mode of this table is a composer that
--   stays blocked, never one that opens early.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ═══════════════════════════════════════════════════════════════════════════
-- AND STILL NO COLUMN THAT CAN HOLD A SECRET.
--
--   `handle` is an opaque `sh_` reference that resolves only inside a live
--   vault; `reason` is a code from a closed set. There is no body, no text,
--   no payload column — a generic `payload jsonb` would have been the obvious
--   design and would have been a place a password could be put by accident.
--   `secret-schema.test.ts` reads `information_schema` and proves it.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS lifecycle_outbox (
    id              bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    request_id      text        NOT NULL
                                REFERENCES secret_requests(request_id) ON DELETE CASCADE,

    -- The conversation this belongs to, in the OTHER plane's id space. Copied
    -- rather than joined: this service cannot read that database, which is the
    -- separation ADR-0037 requires.
    conversation_id text        NOT NULL CHECK (length(conversation_id) BETWEEN 1 AND 128),

    kind            text        NOT NULL CHECK (kind IN (
                                    'secret_requested', 'secret_received',
                                    'secret_consumed', 'secret_expired',
                                    'secret_cancelled', 'secret_rejected')),

    -- Only a request names a channel or an expiry; only a receipt carries a
    -- handle; only a rejection carries a reason. The same shape the conversation
    -- log enforces on the other side, enforced again here, so a row that could
    -- not be accepted there cannot be written here either.
    channel         text        CHECK (channel IS NULL OR channel = 'secure_control'),
    expires_at      timestamptz,
    handle          text        CHECK (handle IS NULL OR handle ~ '^sh_[0-9a-f]{32}$'),
    reason          text        CHECK (reason IS NULL OR reason IN (
                                    'confirmation_mismatch', 'empty', 'unknown_request',
                                    'expired', 'already_submitted', 'not_your_request',
                                    'wrong_conversation', 'unsupported_client',
                                    'insecure_context', 'endpoint_unreachable',
                                    'server_error')),

    CONSTRAINT only_a_request_has_a_channel
        CHECK ((kind = 'secret_requested') = (channel IS NOT NULL)),
    CONSTRAINT only_a_request_has_an_expiry
        CHECK ((kind = 'secret_requested') = (expires_at IS NOT NULL)),
    CONSTRAINT a_handle_means_receipt
        CHECK ((kind = 'secret_received') = (handle IS NOT NULL)),
    CONSTRAINT a_reason_means_rejection
        CHECK ((kind = 'secret_rejected') = (reason IS NOT NULL)),

    -- ── Delivery ──────────────────────────────────────────────────────────
    attempts        integer     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    delivered_at    timestamptz,

    -- A CODE, never a message. An error string from an HTTP client is the one
    -- field in this table that could carry a URL, a header or a body fragment,
    -- and this is a service where such a fragment might be a password.
    last_error      text        CHECK (last_error IS NULL OR last_error IN (
                                    'unreachable', 'refused', 'server_error',
                                    'unknown_conversation', 'malformed')),

    created_at      timestamptz NOT NULL DEFAULT now(),

    -- ── One row per transition ────────────────────────────────────────────
    --
    -- A retry that re-enqueued would deliver the same transition twice, and a
    -- transcript that showed `secret_received` twice would be wrong in a way a
    -- student would see. The conversation service is ALSO idempotent on
    -- (conversation, request, kind) — two independent layers, because a
    -- duplicate here and a duplicate there have different causes.
    CONSTRAINT one_row_per_transition UNIQUE (request_id, kind)
);

-- The publisher's query: due, undelivered, oldest first. Partial, so delivered
-- rows — which is nearly all of them, forever — cost nothing to skip.
CREATE INDEX IF NOT EXISTS lifecycle_outbox_pending
    ON lifecycle_outbox (next_attempt_at, id)
    WHERE delivered_at IS NULL;
