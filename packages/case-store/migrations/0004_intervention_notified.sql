-- 0004 · When a specialist was told (ADR-0071).
--
-- Forward-only and reviewed, per ADR-0003.
--
-- ── Why this is a SECOND column and not `announced_at` ───────────────────
--
-- `announced_at` (0003) records that the STUDENT was told their application is
-- paused. This records that a SPECIALIST — the person who can actually unstick
-- it — was told. They are different audiences, told different things, over
-- different channels, and either can succeed while the other fails.
--
-- Reusing one column would mean a delivery failure on one channel silently
-- suppressing the other, which is precisely the failure this phase exists to
-- close: an intervention that was raised, and that nobody who could act on it
-- ever heard about.
--
-- ── NULL means "not yet", and that is the whole retry mechanism ──────────
--
-- The notifier sends first and marks second, the same order `announcePending`
-- uses and for the same reason: a crash between them re-tells somebody, which
-- is a much smaller failure than a stopped run nobody is told about. There is
-- no attempt counter and no backoff column — a notice that keeps failing keeps
-- being retried, and the operator finds out because the run is still open in
-- the queue they can already read.
ALTER TABLE interventions ADD COLUMN IF NOT EXISTS notified_at timestamptz;

-- "What is open and nobody has been told about?" — the query the notifier runs
-- on every pass. Partial on both conditions, because the steady state is that
-- almost every row is resolved or already notified and the answer is empty.
CREATE INDEX IF NOT EXISTS interventions_unnotified_idx
    ON interventions (raised_at)
    WHERE resolved_at IS NULL AND notified_at IS NULL;
