-- 0015 · The worker's third job: telling a specialist (ADR-0071).
--
-- Forward-only and reviewed, per ADR-0003.
--
-- `worker_leases.job_kind` is a closed vocabulary with a CHECK constraint, so
-- that a typo in a job name is a failed insert rather than a lease nobody
-- notices is orphaned (migration 0010). Adding a job therefore means widening
-- the constraint, deliberately, in a reviewed migration — which is the point of
-- writing it as a CHECK rather than leaving the column free text.
--
-- Dropped and recreated because Postgres has no ALTER for a CHECK's expression.
-- Safe on a live table: the new predicate admits everything the old one did.
ALTER TABLE worker_leases DROP CONSTRAINT IF EXISTS worker_leases_job_kind_check;
ALTER TABLE worker_leases ADD CONSTRAINT worker_leases_job_kind_check
    CHECK (job_kind IN ('advance_runs', 'announce_interventions', 'notify_specialists'));
