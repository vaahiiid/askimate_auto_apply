-- 0006 · `execute` becomes a kind of work a runner can be given.
--
-- Forward-only and reviewed, per ADR-0003. 0005 is NOT edited: it has been
-- applied, and a change to an applied file does nothing everywhere it already
-- ran while looking correct on an empty database.
--
-- ADR-0046 decided how a fill plan reaches the Automation Runner, and
-- `WORK_KINDS` gained its second member. The CHECK below is the database's copy
-- of that closed set, and it has to be widened in step — a lease it refuses is
-- an insert that fails, a claim that 500s, and a client that reads the failure
-- as "nothing to do". Which is exactly how this was found: the run sat in
-- `filling` with work nobody could take, and the poll looked idle.
--
-- Still a closed set, and still deliberately. Adding a third kind is a
-- reviewable change to this file's successor, not a `text` column that would
-- accept anything a caller sent.

ALTER TABLE work_leases DROP CONSTRAINT IF EXISTS work_leases_kind_check;

ALTER TABLE work_leases
    ADD CONSTRAINT work_leases_kind_check
    CHECK (kind IN ('create_account', 'execute'));
