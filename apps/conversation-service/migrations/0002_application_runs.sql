-- 0002 · The case a conversation owns, and the student who authorised it.
--
-- Forward-only and reviewed, per ADR-0003. Never edited once applied anywhere;
-- the runner records this file's SHA-256 and refuses a changed one.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT THIS MIGRATION IS FOR
--
-- `docs/roadmap-and-priorities.md` §3 recorded the structural finding: the
-- domain's event-sourced case and the orchestrator's `RunState` "were built in
-- different phases and were never joined". This is the join, and it is
-- deliberately the SMALLEST one that makes the chain real:
--
--     students ──► conversations ──► cases ──► workflow_runs
--
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ── What `cases` is, and what it emphatically is not ─────────────────────
--
-- It is an IDENTITY ANCHOR. Three columns: who the case belongs to, when it
-- appeared, and its id. There is no status, no phase, no profile, no blueprint,
-- no checkpoint and no business fact of any kind.
--
-- That restraint is the point. `case_events` in @askimate/aas-case-store is the
-- authoritative record of what was agreed and what happened, and P1's brief is
-- explicit: *"Do not create a second independent case model."* A `status`
-- column here would immediately become a second opinion about a case that the
-- event log already answers, and the two would drift on the first bug.
--
-- The precedent is in this same schema: `conversations` holds an id, an owner
-- and a cached ordinal, and `conversation_events` holds everything that was
-- said. `cases` is that shape for the application domain.
--
-- ── Why the foreign key is COMPOSITE ─────────────────────────────────────
--
-- The requirement is that "a run must always be attributable to the student and
-- conversation that authorised it". A plain `conversations.case_id REFERENCES
-- cases (case_id)` would let student A's conversation point at student B's
-- case: the reference would be valid and the ownership would be wrong.
--
-- So the reference carries the owner with it. `cases` has UNIQUE (student_id,
-- case_id) purely to make that possible, and `conversations` references the
-- PAIR. A row can only name a case its own student owns, and the database is
-- what says so — not a check in a route handler that a later refactor removes.
--
-- MATCH SIMPLE (PostgreSQL's default) is what makes the column nullable and
-- still safe: when `case_id` IS NULL the constraint is satisfied and no case is
-- claimed; when it is set, BOTH columns must match a real row. A conversation
-- that has not started an application is the normal case, not an exception.

-- ───────────────────────────────────────────────────────────────────────────
-- Cases
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cases (
    -- The domain's CaseId, a branded non-empty string. Bounded here because an
    -- unbounded identifier column is an unbounded index entry.
    case_id     text        PRIMARY KEY CHECK (length(case_id) BETWEEN 1 AND 128),

    -- The owner. ON DELETE CASCADE because a deleted student's case is not a
    -- case anyone may act on, and leaving an orphan would leave a run
    -- attributable to nobody.
    student_id  uuid        NOT NULL REFERENCES students (id) ON DELETE CASCADE,

    created_at  timestamptz NOT NULL DEFAULT now(),

    -- Exists so `conversations` can reference the pair. Redundant with the
    -- primary key on its own; load-bearing for the composite foreign key below.
    CONSTRAINT cases_student_and_id UNIQUE (student_id, case_id)
);

CREATE INDEX IF NOT EXISTS cases_by_student ON cases (student_id, created_at DESC);

-- ───────────────────────────────────────────────────────────────────────────
-- The binding
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE conversations
    ADD COLUMN IF NOT EXISTS case_id text
        CONSTRAINT conversations_case_id_shape
        CHECK (case_id IS NULL OR length(case_id) BETWEEN 1 AND 128);

ALTER TABLE conversations
    DROP CONSTRAINT IF EXISTS conversations_case_belongs_to_the_same_student;

ALTER TABLE conversations
    ADD CONSTRAINT conversations_case_belongs_to_the_same_student
        FOREIGN KEY (student_id, case_id) REFERENCES cases (student_id, case_id);

-- One conversation per case, in the direction that matters.
--
-- A case may be attempted by more than one RUN — `workflow_runs_case_id_idx`
-- exists precisely because a recovery or a reapplication starts another one —
-- but a case belongs to the ONE conversation in which the student asked for it.
-- Two conversations claiming the same case would make "which conversation
-- authorised this?" unanswerable, and that question is the whole reason this
-- migration exists.
CREATE UNIQUE INDEX IF NOT EXISTS conversations_one_conversation_per_case
    ON conversations (case_id) WHERE case_id IS NOT NULL;
