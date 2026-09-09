-- 0017 · Document metadata is durable (ADR-0094). The bytes are not here.
--
-- Forward-only and reviewed, per ADR-0003.
--
-- Two tables, and what is NOT in either of them is the point: there is no
-- column of any type that could hold a document's contents. Under ADR-0092 the
-- bytes go from the browser to the bucket on a pre-signed PUT and never enter a
-- process this repository runs; this schema records that they went, where they
-- rest, and what they hashed to. `documents.test.ts` asserts the absence
-- against this file's text.

-- ── An open intake: permission to upload one document, once, for fifteen minutes ──
--
-- Held durably so that two replicas agree on what is open, and so that a
-- restart between the declaration and the confirm does not strand a student
-- with a URL nobody will confirm. `take` is one DELETE … RETURNING, so two
-- concurrent confirms cannot both see it open; an expired row is never
-- returned, and is removed by the same statement when it is found.
--
-- The gates' result travels with the row — the policy reference and the
-- determination relied on — for the audit, and the gates RE-RUN on take
-- against the schedule then in force (ADR-0090: "the checks that permitted it
-- are re-run, which is the point").
CREATE TABLE document_intakes (
    intake_id             text        PRIMARY KEY
                                      CHECK (intake_id ~ '^[0-9A-Z]{26}$'),
    conversation_id       text        NOT NULL,
    student_id            text        NOT NULL,
    document_type         text        NOT NULL,
    purpose               text        NOT NULL,
    content_type          text        NOT NULL,
    content_hash          text        NOT NULL
                                      CHECK (content_hash ~ '^[0-9a-f]{64}$'),
    declared_size_bytes   bigint      NOT NULL CHECK (declared_size_bytes > 0),
    policy_reference      text        NOT NULL,
    lawful_basis          jsonb       NOT NULL,
    opened_at             timestamptz NOT NULL,
    expires_at            timestamptz NOT NULL,
    CONSTRAINT document_intakes_open_before_expiry CHECK (expires_at > opened_at)
);

CREATE INDEX document_intakes_by_conversation ON document_intakes (conversation_id, intake_id);
CREATE INDEX document_intakes_by_expiry ON document_intakes (expires_at);

-- ── A document: metadata, the object key, and the hash the bucket enforced ──
--
-- `object_key` survives a purge so the audit can say WHERE the contents were,
-- after they are gone; `purged_at` says when. `content_hash` survives too
-- (ADR-0010): the record can still answer which document was used and whether
-- it was the one the student confirmed, without the personal data.
CREATE TABLE documents (
    document_id                text        PRIMARY KEY
                                           CHECK (document_id ~ '^[0-9A-Z]{26}$'),
    student_id                 text        NOT NULL,
    document_type              text        NOT NULL,
    purpose                    text        NOT NULL,
    state                      text        NOT NULL
                                           CHECK (state IN ('uploaded', 'extracted', 'confirmed',
                                                            'verified', 'superseded', 'purged')),
    content_hash               text        NOT NULL
                                           CHECK (content_hash ~ '^[0-9a-f]{64}$'),
    content_type               text        NOT NULL,
    size_bytes                 bigint      NOT NULL CHECK (size_bytes > 0),
    uploaded_at                timestamptz NOT NULL,
    dates                      jsonb       NOT NULL DEFAULT '{}'::jsonb,
    retention_policy_reference text        NOT NULL,
    retention_triggered_at     timestamptz,
    superseded_by              text        REFERENCES documents (document_id),
    object_key                 text        NOT NULL,
    purged_at                  timestamptz,
    -- A purged document says so in both places, or in neither.
    CONSTRAINT documents_purge_is_whole
        CHECK ((state = 'purged') = (purged_at IS NOT NULL)),
    -- Superseded means by something; nothing else names a successor.
    CONSTRAINT documents_supersession_is_whole
        CHECK ((state = 'superseded') = (superseded_by IS NOT NULL))
);

CREATE INDEX documents_by_student ON documents (student_id, uploaded_at);
