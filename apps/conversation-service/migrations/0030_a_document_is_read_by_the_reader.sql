-- 0030 · A CV is read by the reader, once, under a lease.
--
-- Forward-only and reviewed, per ADR-0003.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ADR-0148 §9, ADR-0149, P246. Vahid: *"A separate process whose only job is
-- reading a CV. It fetches the document, produces text, and forgets it."*
-- This table is what the plane knows about that: which document was sent in
-- which conversation, whether a reader holds it, and how the reading ended.
-- No byte of the document, no line of it, no value read from it — the values
-- go on the conversation log as part readings (0025), where the interview
-- picks them up.
--
--   pending   sent and confirmed; no reader has it
--   leased    a reader holds it until `lease_expires_at`; lapsed, it is
--             pending again — a reader that died mid-read left nothing that
--             needs undoing, because a reading writes nothing until it reports
--   read      reported; the walk is seeded
--   failed    reported as failed, with one of the contract's closed words, or
--             refused by the gate at the claim
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE document_readings (
    document_id       text        PRIMARY KEY
                                  CHECK (document_id ~ '^[0-9A-Z]{26}$'),
    conversation_id   text        NOT NULL,
    student_id        text        NOT NULL,
    content_hash      text        NOT NULL
                                  CHECK (content_hash ~ '^[0-9a-f]{64}$'),
    state             text        NOT NULL
                                  CHECK (state IN ('pending', 'leased', 'read', 'failed')),
    requested_at      timestamptz NOT NULL,
    lease_id          text,
    holder            text,
    lease_expires_at  timestamptz,
    read_at           timestamptz,
    -- The contract's closed word, or the gate's; never a sentence.
    failure           text        CHECK (failure IS NULL OR failure ~ '^[a-z_]{1,40}$'),
    -- A lease has all three parts or none.
    CONSTRAINT document_readings_lease_is_whole CHECK (
        (lease_id IS NULL) = (holder IS NULL) AND (lease_id IS NULL) = (lease_expires_at IS NULL)),
    -- A reading that ended says when; one that has not, does not.
    CONSTRAINT document_readings_ended_says_when CHECK (
        (state IN ('read', 'failed')) = (read_at IS NOT NULL)),
    -- Only a failed reading carries a failure.
    CONSTRAINT document_readings_only_a_failure_says_why CHECK (
        (failure IS NULL) OR (state = 'failed'))
);
CREATE INDEX document_readings_claimable ON document_readings (state, requested_at);
CREATE INDEX document_readings_by_conversation ON document_readings (conversation_id);
