-- 0037 · The retention sweep's lease (P274, row 128).
--
-- Forward-only and reviewed, per ADR-0003.
--
-- The CV upload sentence promises "I will keep it for one year from the last
-- time I use it", and until P274 nothing deleted anything. The sweep that
-- keeps it runs in the conversation service — the worker may not hold a vault
-- (ADR-0096, `pnpm run boundaries`) — and is held under a worker lease so two
-- instances of the service cannot both delete one document and both tell its
-- student. `worker_leases.job_kind` is a closed vocabulary with a CHECK, so
-- the new job widens it here, dropped and recreated as in 0018; the new
-- predicate admits everything the old one did.
ALTER TABLE worker_leases DROP CONSTRAINT IF EXISTS worker_leases_job_kind_check;
ALTER TABLE worker_leases ADD CONSTRAINT worker_leases_job_kind_check
    CHECK (job_kind IN ('advance_runs', 'announce_interventions', 'notify_specialists', 'sweep_document_intakes', 'sweep_retention'));
