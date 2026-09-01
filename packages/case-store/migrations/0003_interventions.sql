-- 0003 · Specialist interventions (ADR-0048).
--
-- Forward-only and reviewed, per ADR-0003.
--
-- ── What this table is FOR, and what it is not ───────────────────────────
--
-- `workflow_action_intents` (0002) is authoritative for ONE question: did the
-- action happen? This table answers a different one: WHO decided, on what
-- evidence, and does the fix generalise.
--
-- They are not two copies of one fact, and the split is the whole point of
-- ADR-0048. A resolution recorded here does not say whether the account was
-- created — completing the intent says that. It says a named person looked and
-- what they found. Rule 3 and ADR-0041 are satisfied because neither table can
-- contradict the other: they answer different questions.
--
-- Note what is NOT here: no position, no cursor, no resume point. Where a run
-- picks up is derived from the intent ledger (ADR-0047), and a column here that
-- something might honour is exactly the second source of truth ADR-0041
-- forbids. Vahid rejected storing one, 2026-09-01. `A_RESOLUTION_CARRIES_NO_
-- POSITION` in the domain fails the build if a position is added to the type.
CREATE TABLE IF NOT EXISTS interventions (
    intervention_id text        PRIMARY KEY,
    run_id          text        NOT NULL REFERENCES workflow_runs (run_id),

    -- The intent this adjudicates. Not a random key: an intervention is ABOUT
    -- one consequential action, and pairing it with that action's idempotency
    -- key is what makes raising one twice impossible rather than merely
    -- unlikely — a second raise for the same stuck action hits this constraint
    -- and returns the intervention that already exists.
    idempotency_key text        NOT NULL,
    case_id         text        NOT NULL,
    student_ref     text        NOT NULL,

    reason          text        NOT NULL,
    priority        text        NOT NULL,
    encountered     text        NOT NULL,
    expected        text        NOT NULL,
    -- Diagnostic, never executable: where a specialist looks, not what decides
    -- the next step (ADR-0048 §5).
    checkpoint      jsonb       NOT NULL,
    context         jsonb       NOT NULL,
    raised_at       timestamptz NOT NULL,

    -- When the student was told. NULL means they have not been, and the next
    -- pass will tell them — so a crash between raising and announcing cannot
    -- leave a paused run whose student never hears about it.
    announced_at    timestamptz,

    lifecycle       text        NOT NULL,

    -- ── The resolution, all of it or none of it ─────────────────────────
    specialist_id      text,
    actions_taken      text,
    resolution         text,
    resolution_outcome text,
    resolved_at        timestamptz,
    reusability        jsonb,

    CONSTRAINT interventions_one_per_stuck_action UNIQUE (run_id, idempotency_key),

    -- A half-written resolution reads as an adjudication that never happened.
    CONSTRAINT interventions_resolution_is_whole CHECK (
        (specialist_id IS NULL)      = (resolved_at IS NULL)
    AND (actions_taken IS NULL)      = (resolved_at IS NULL)
    AND (resolution IS NULL)         = (resolved_at IS NULL)
    AND (resolution_outcome IS NULL) = (resolved_at IS NULL)
    AND (reusability IS NULL)        = (resolved_at IS NULL)
    ),

    -- `route_fallback` is rejected, not partially implemented (ADR-0048 §4,
    -- Vahid 2026-09-01). Enforced here as well as at the route, because a
    -- refusal that lives only in a parser is a refusal one caller away from
    -- being bypassed. A route change needs its own ADR and its own machinery.
    CONSTRAINT interventions_route_fallback_is_not_implemented CHECK (
        resolution_outcome IS NULL OR resolution_outcome IN ('resume', 'abandon')
    )
);

-- "What is waiting for a specialist?" — the query the operator CLI runs, and
-- the one an alerting transport will run when it exists.
CREATE INDEX IF NOT EXISTS interventions_open_idx
    ON interventions (raised_at) WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS interventions_run_idx ON interventions (run_id);
