-- 0018 · The worker's fourth job: sweeping expired document intakes (ADR-0096).
--
-- Forward-only and reviewed, per ADR-0003.
--
-- An intake is fifteen minutes of permission to confirm one upload (ADR-0090).
-- `take` never returns an expired row and spends the one it finds, so an
-- expired intake is already unusable; what this job removes is the row a
-- student never came back to confirm — a declaration made and abandoned. It
-- holds no document and no byte (migration 0017 has no column that could), so
-- nothing is lost by removing it and nothing is protected by keeping it; it is
-- a record that a permission once existed, and the audit for that is the
-- conversation log, not this table.
--
-- `worker_leases.job_kind` is a closed vocabulary with a CHECK constraint, so
-- adding a job means widening it in a reviewed migration (migrations 0010 and
-- 0015). Dropped and recreated because Postgres has no ALTER for a CHECK's
-- expression; safe on a live table, because the new predicate admits everything
-- the old one did.
ALTER TABLE worker_leases DROP CONSTRAINT IF EXISTS worker_leases_job_kind_check;
ALTER TABLE worker_leases ADD CONSTRAINT worker_leases_job_kind_check
    CHECK (job_kind IN ('advance_runs', 'announce_interventions', 'notify_specialists', 'sweep_document_intakes'));
