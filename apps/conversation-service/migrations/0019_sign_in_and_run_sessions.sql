-- 0019 · `sign_in` is a kind of work, and the plane records who holds a run's
--        signed-in session and until when.
--
-- Forward-only and reviewed, per ADR-0003. 0005, 0006 and 0007 are NOT edited.
--
-- ADR-0101 §2 and §3 (P71, P72). The runner that creates an account keeps the
-- browser session it was given and fills in it, in memory, for at most five
-- minutes idle. When that session is gone the run asks the student for their
-- password once more — the resume path — and a runner signs back in with it.
--
-- ── Why the plane needs a record of the session at all ───────────────────
--
-- Because "no runner holds one" is the condition for the one second ask, and
-- the plane cannot see a runner's memory. What it can see is the runners'
-- REPORTS: an account created, a sign-in done, a page saved — each by a named
-- holder, each the moment a session was demonstrably live. From the last of
-- those and the same five-minute constant the runner sweeps by
-- (`SECURE_HOLD_CEILING_SECONDS`, ADR-0034's ceiling), the plane knows the
-- latest instant a session can still exist. Past it, or after the runner
-- reported the session gone, the run resumes by §3.
--
-- ── What this table is NOT ───────────────────────────────────────────────
--
-- Not a session. No cookie, no token, no credential of any kind — a holder's
-- name and an instant, and nothing a compromised copy could sign in with
-- (brief §8). Not a second lease: a lease says who is WORKING a run now; this
-- says who was last SIGNED IN to it and until when that can still be true.
-- And not a second record of progress: pages saved stay in the intent ledger.

ALTER TABLE work_leases DROP CONSTRAINT IF EXISTS work_leases_kind_check;

ALTER TABLE work_leases
    ADD CONSTRAINT work_leases_kind_check
    CHECK (kind IN ('create_account', 'sign_in', 'execute'));

CREATE TABLE IF NOT EXISTS run_sessions (
    -- One session record per run, as the runner keeps one context per run.
    -- No REFERENCES, for the reason 0005 gives: `workflow_runs` belongs to
    -- another package's migration set.
    run_id       text        PRIMARY KEY,

    -- Which runner last reported the session live. An identifier for an
    -- operator, never a credential, never used for authorisation.
    holder       text        NOT NULL CHECK (length(holder) BETWEEN 1 AND 128),

    -- The latest instant the runner's in-memory session can still exist:
    -- the report's time plus the one ceiling. Past this, the session is gone
    -- whatever the runner would say, because the runner sweeps by the same
    -- number.
    held_until   timestamptz NOT NULL,

    recorded_at  timestamptz NOT NULL,

    CHECK (held_until > recorded_at)
);
