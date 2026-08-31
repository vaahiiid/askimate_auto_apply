-- 0005 · Work leases — who is currently holding a run's browser work.
--
-- Forward-only and reviewed, per ADR-0003. Never edited once applied anywhere;
-- a change is a new numbered file.
--
-- ADR-0045: the Automation Runner PULLS work and reports how it ended. This is
-- the whole of the state that mechanism needs.
--
-- ── What this table is NOT ───────────────────────────────────────────────
--
-- It is not a queue. There is no `pending` row, no `status`, no ordering, and
-- nothing that says what work EXISTS — the run's own durable checkpoint says
-- that, and `nextStep` decides it. A queue here would be a second opinion about
-- what a run should do next, and ADR-0041 exists because two models of the same
-- thing have already come apart in this repository once.
--
-- So a row means exactly one thing: *this runner is holding this run right now,
-- until this instant.* When the work is reported the row is deleted; the run's
-- checkpoint moves, `nextStep` answers something else, and it stops being a
-- candidate. One authority.
--
-- ── Where the mutual exclusion actually lives ────────────────────────────
--
--   one lease per run          PRIMARY KEY (run_id)
--   a lease cannot start spent CHECK (expires_at > claimed_at)
--   closed vocabulary          CHECK (kind IN (…))
--
-- In the constraints, not in the handler above them. Two runners racing to
-- claim the same unleased run both INSERT; one gets 23505. Two racing to take
-- over the same EXPIRED lease both UPDATE with `expires_at <= $now` in the
-- WHERE; one updates a row and the other updates none. Neither outcome depends
-- on a check somebody remembered to write.

CREATE TABLE IF NOT EXISTS work_leases (
    -- One lease per run, as a database guarantee. Deliberately the primary key
    -- rather than a column with an index: "a run cannot be worked twice at
    -- once" is the property this table exists for, and it should be impossible
    -- to violate rather than merely unlikely.
    --
    -- No REFERENCES. `workflow_runs` is created by @askimate/aas-case-store's
    -- own numbered migrations into this same database, and a foreign key from
    -- this file to that table would make these two migration sets ordered with
    -- respect to each other — which the registry, keyed by filename, does not
    -- promise.
    run_id      text        PRIMARY KEY,

    -- Random, and regenerated on every claim including a takeover. It is the
    -- proof a reporter is the holder: a runner that was superseded while it
    -- worked presents a lease id nobody holds any more, and its report is
    -- refused rather than allowed to overwrite the current holder's.
    lease_id    text        NOT NULL,

    kind        text        NOT NULL CHECK (kind IN ('create_account')),

    -- Which runner. An identifier for an operator reading this table during an
    -- incident, never a credential and never used for authorisation — the
    -- service certificate does that.
    holder      text        NOT NULL CHECK (length(holder) BETWEEN 1 AND 128),

    claimed_at  timestamptz NOT NULL,

    -- Leases EXPIRE; they are not released by a heartbeat. A runner that dies
    -- mid-task cannot tell anyone, and a lease that outlived its holder forever
    -- would strand a student's application behind a process that no longer
    -- exists.
    expires_at  timestamptz NOT NULL,

    CONSTRAINT work_leases_expire_after_they_are_claimed
        CHECK (expires_at > claimed_at)
);

-- The claim path's "is anything free?" question, and the sweep an operator runs
-- to see what is stuck.
CREATE INDEX IF NOT EXISTS work_leases_by_expiry ON work_leases (expires_at);
