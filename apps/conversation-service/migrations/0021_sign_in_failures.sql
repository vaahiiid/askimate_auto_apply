-- 0021 · A failed sign-in is counted, and the handle it spent is named.
--
-- Forward-only and reviewed, per ADR-0003. 0019 is NOT edited.
--
-- ADR-0120 (P151). Vahid, 2026-09-16: *"The sign-in failure shape is blocker
-- 26 again, unsolved… apply ADR-0114's shape to sign-in. Two attempts, then
-- stop for a person, with the student told which attempt failed and what the
-- portal said."*
--
-- ── Why a table of its own, and not a column on run_sessions ─────────────
--
-- `run_sessions` holds a LIVE session and is deleted when one is lost — which
-- is exactly when a failed sign-in is reported — so it cannot carry the count.
-- The creation's count lives on its intent row (0005), but a sign-in has no
-- intent on purpose (ADR-0101 §3: the handle's consumption is the Secure
-- Plane's record, and a sign-in creates nothing). So: one row per run, the
-- attempts MADE since the last live session (a hand-out the runner could not
-- use is not an attempt — ADR-0114: "once is chance, twice is the portal"
-- counts attempts, not hand-outs), which secure request's handle the last
-- attempt was handed (never offered again, whatever the outbox has delivered),
-- and the runner's closed-set failure code. Cleared when a session is next
-- recorded live: a later loss starts a new count of two.

CREATE TABLE IF NOT EXISTS run_sign_in_failures (
    run_id                  text        PRIMARY KEY,

    -- Attempts made since the last live session. The driver stops at two.
    attempts                integer     NOT NULL DEFAULT 0 CHECK (attempts >= 0),

    -- The `sr_…` id of the secure request whose handle the last report was
    -- handed, when it was handed one. An opaque id, never a credential.
    spent_secret_request_id text        NULL CHECK (spent_secret_request_id IS NULL OR length(spent_secret_request_id) BETWEEN 1 AND 64),

    -- The runner's failure code, from the closed set the contract names.
    last_failure            text        NULL CHECK (last_failure IS NULL OR length(last_failure) BETWEEN 1 AND 64),

    failed_at               timestamptz NOT NULL
);
