-- 0002 · Workflow runs, checkpoints and action intents.
--
-- Forward-only and reviewed, per ADR-0003. Never edited once applied anywhere;
-- a change is a new numbered file, and 0.2.0's checksum check enforces that.
--
-- ── Operational state, kept apart from business truth ────────────────────
--
-- These tables hold WHERE a run got to. `case_events` (0001) holds WHAT WAS
-- AGREED and WHAT HAPPENED. The separation is the approved architecture's
-- rule 3, and the testable form of it is: dropping every row in
-- `workflow_checkpoints` must lose no business fact — only the efficiency of
-- not having to re-derive position from the event log.
--
-- Note what is NOT here: no profile, no documents, no blueprint, no mapping
-- set, no secret, no confirmed value. A checkpoint's `detail` is JSONB but the
-- domain type admits only primitives, and check-boundaries.ts fails the build
-- if that type is widened.

CREATE TABLE IF NOT EXISTS workflow_runs (
    run_id      text        PRIMARY KEY,
    case_id     text        NOT NULL,
    student_ref text        NOT NULL,
    status      text        NOT NULL,
    -- Optimistic concurrency, the same mechanism as case_events' expected
    -- sequence and for the same reason: two processes resuming one run must
    -- not both win.
    revision    integer     NOT NULL DEFAULT 0 CHECK (revision >= 0),
    -- The current checkpoint. Overwritten on every save — this table is
    -- mutable by design, which is precisely why it is not in the append-only
    -- case log.
    checkpoint  jsonb       NOT NULL,
    started_at  timestamptz NOT NULL,
    updated_at  timestamptz NOT NULL
);

-- "Which runs belong to this case?" A case may be attempted more than once:
-- a recovery resolution with outcome route_fallback, or a reapplication.
CREATE INDEX IF NOT EXISTS workflow_runs_case_id_idx ON workflow_runs (case_id, started_at DESC);

-- ── Action intents: the evidence that something may have happened ────────
--
-- Written BEFORE a consequential action, completed AFTER. The gap between them
-- is the uncertainty window, and this table is what makes that window
-- detectable — which is the most any system can do, since a process can always
-- die between an external success and our recording of it.
--
-- There is no UPDATE path for `intent` fields and no DELETE. An intent whose
-- completion could be forged, or which could be deleted to make an awkward
-- uncertainty disappear, would defeat the point of writing it down.
CREATE TABLE IF NOT EXISTS workflow_action_intents (
    run_id          text        NOT NULL REFERENCES workflow_runs (run_id),
    -- Derived from (runId, action, target) — never random, because a random
    -- key regenerated after a restart would not match the record written
    -- before the crash, and the mechanism would silently do nothing.
    idempotency_key text        NOT NULL,
    action          text        NOT NULL,
    target          text        NOT NULL,
    started_at      timestamptz NOT NULL,
    -- NULL means started and never recorded as finished: the uncertain case.
    outcome         text,
    completed_at    timestamptz,

    -- At most one intent per key. Two would make the record ambiguous, and the
    -- record is the only evidence about whether the action happened.
    PRIMARY KEY (run_id, idempotency_key),

    -- An outcome and its timestamp arrive together or not at all. A completed
    -- intent with no time, or a time with no outcome, is a half-written
    -- completion, which reads as certainty the system does not have.
    CONSTRAINT workflow_action_intents_completion_is_whole
        CHECK ((outcome IS NULL) = (completed_at IS NULL))
);

CREATE INDEX IF NOT EXISTS workflow_action_intents_run_idx ON workflow_action_intents (run_id);
