-- 0038 · A request to delete the confirmed details reaches a person (P275, row 130).
--
-- Forward-only and reviewed, per ADR-0003.
--
-- Two sentences a student reads promise a handoff that nothing performed. The
-- stop message (D6): "If you want your data deleted rather than just stopped,
-- tell me — that is a separate request and I will pass it to a person." After
-- a document is deleted (D31): "If you want any of those removed too, tell me
-- and I will say what that takes." Vahid, 2026-10-03: "A request that reaches
-- a person and a student who is told what the university already has is the
-- whole of what I promised." The deletion itself (stage B) is not built.
--
-- One row per request. Raised once: a student has at most one OPEN request,
-- so saying it again is told it is already with a person rather than queued
-- twice. A closing is whole — when, by whom, and what came of it — and a
-- refusal says why, because the student is told. `closed_by` is ASSERTED, on
-- the same terms as an intervention's specialist (ADR-0048 §3).
--
-- Identifiers only: what is asked to be deleted is the student's confirmed
-- details, which this row names and does not copy.
CREATE TABLE data_deletion_requests (
    request_id       text        PRIMARY KEY,
    conversation_id  text        NOT NULL,
    student_id       text        NOT NULL,
    case_id          text        NOT NULL,
    raised_at        timestamptz NOT NULL,
    closed_at        timestamptz,
    closed_by        text,
    outcome          text        CHECK (outcome IN ('deleted', 'declined')),
    reason           text,
    CONSTRAINT data_deletion_requests_a_closing_is_whole CHECK (
        (closed_at IS NULL AND closed_by IS NULL AND outcome IS NULL AND reason IS NULL)
        OR (closed_at IS NOT NULL AND closed_by IS NOT NULL AND length(closed_by) > 0 AND outcome IS NOT NULL)
    ),
    CONSTRAINT data_deletion_requests_a_refusal_says_why CHECK (
        outcome IS DISTINCT FROM 'declined' OR (reason IS NOT NULL AND length(reason) > 0)
    )
);

CREATE UNIQUE INDEX data_deletion_requests_one_open_per_student
    ON data_deletion_requests (student_id) WHERE closed_at IS NULL;

CREATE INDEX data_deletion_requests_open_by_age
    ON data_deletion_requests (raised_at) WHERE closed_at IS NULL;
