-- 0010 · Worker leases — which background worker is running which job kind.
--
-- Forward-only and reviewed, per ADR-0003. Never edited once applied anywhere;
-- a change is a new numbered file.
--
-- ADR-0052 §3 and §13.2. The Background Worker is a fifth deployable and there
-- may be several instances of it. This is the whole of the state that mechanism
-- needs.
--
-- ── Why not `work_leases` ────────────────────────────────────────────────
--
-- Vahid, 2026-09-02: preserve `work_leases` for run execution work. And
-- 0005_work_leases.sql already argues its own case, in its header:
--
--     "It is not a queue … a row means exactly one thing: this runner is
--      holding this run right now, until this instant."
--
-- Its PRIMARY KEY is `run_id`, and that key IS the property it exists for. A
-- background job is a different shape — "drain the outbox" is not about a run
-- at all — and giving one a synthetic `run_id` to fit the key would destroy the
-- one meaning that key has. So: the same mechanism, keyed by what a background
-- job actually is.
--
-- ── Why this is NOT a second source of truth ─────────────────────────────
--
-- This is the question ADR-0041 and ADR-0047 both turn on, and the answer has
-- to be structural rather than a promise:
--
--     A row here holds NO BUSINESS FACT. It answers only "which worker is
--     running which job kind right now, until when". Drop this entire table and
--     nothing about any case, run, request, intervention or student is lost —
--     the next worker re-derives exactly the same work.
--
-- Every job derives its work from the record that already owns that fact:
--
--     advance_runs           workflow_runs.status + checkpoint->>'phase',
--                            excluding anything currently leased in work_leases
--     announce_interventions interventions WHERE resolved_at IS NULL
--                              AND announced_at IS NULL
--
-- There is deliberately NO `worker_jobs` table with a `pending` status, and
-- there must never be one. A queue of business work here would be a second
-- opinion about what the system should do next, and this repository has already
-- had two models of the same thing come apart once.
--
-- ── Where the mutual exclusion lives ─────────────────────────────────────
--
--   one lease per job kind     PRIMARY KEY (job_kind)
--   a lease cannot start spent CHECK (expires_at > claimed_at)
--   closed vocabulary          CHECK (job_kind IN (…))
--
-- In the constraints, not in the handler above them — the same argument 0005
-- makes. Two workers racing to claim an unleased job both INSERT; one gets
-- 23505. Two racing to take over the same EXPIRED lease both UPDATE with
-- `expires_at <= $now` in the WHERE; one updates a row and the other updates
-- none.
--
-- ── The lease is an efficiency, never the correctness argument ───────────
--
-- ADR-0052 §9 and §13.2. A job whose correctness depended on holding its lease
-- would already be wrong, because a lease can always lapse under a slow query.
-- Correctness comes from the jobs being idempotent and their work re-derived;
-- this table stops two workers doing the same thing at once, which is a cost
-- saving and an operational signal.
--
-- Which is also why there is no renewal mechanism and no `renewed_at` column.
-- The lease is simply longer than any job is expected to take, and each tick
-- re-claims it. A worker that dies stops ticking and its lease lapses.

CREATE TABLE IF NOT EXISTS worker_leases (
    -- One lease per job kind, as a database guarantee. The primary key rather
    -- than an indexed column, for the reason `work_leases` uses `run_id`: "this
    -- job cannot run twice at once" is the property this table exists for and
    -- should be impossible to violate rather than merely unlikely.
    job_kind    text        PRIMARY KEY
                            CHECK (job_kind IN ('advance_runs', 'announce_interventions')),

    -- Random, and regenerated on every claim including a takeover. Proof that a
    -- worker still holds what it thinks it holds — the same role `lease_id`
    -- plays in `work_leases`.
    lease_id    text        NOT NULL CHECK (length(lease_id) BETWEEN 1 AND 128),

    -- Which worker instance. For an operator reading this table during an
    -- incident, never a credential and never used for authorisation.
    holder      text        NOT NULL CHECK (length(holder) BETWEEN 1 AND 128),

    claimed_at  timestamptz NOT NULL,
    expires_at  timestamptz NOT NULL,

    CONSTRAINT worker_leases_cannot_start_spent CHECK (expires_at > claimed_at)
);

-- No index beyond the primary key, deliberately. This table holds one row per
-- job kind — two, today — and every read is by that key. An index on
-- `expires_at` would be a promise that this table grows, which it must not.
