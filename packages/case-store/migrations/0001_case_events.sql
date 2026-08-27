-- 0001 · The case event log and the submission-key claim table.
--
-- Forward-only and reviewed, per ADR-0003. This file is never edited once it
-- has been applied anywhere — a change is a new numbered file.
--
-- ── Where the durability guarantees actually live ────────────────────────
--
-- The brief's §4 guarantees are enforced by CONSTRAINTS here, not by the
-- application code above them. That is deliberate: application-level checks
-- race, and the whole point of the submission-key rule is to survive two
-- workers deciding simultaneously on stale reads.
--
--   append-only            no UPDATE or DELETE is issued by the store, and the
--                          store's interface has no operation that would
--   no sequence gaps       CHECK (sequence > 0) plus the application's
--                          consecutive check, with the primary key as backstop
--   optimistic concurrency PRIMARY KEY (case_id, sequence) — two writers
--                          inserting the same sequence: one gets 23505
--   unique submission keys PRIMARY KEY (submission_key)

CREATE TABLE IF NOT EXISTS case_events (
    case_id     text        NOT NULL,
    -- Starts at 1 and strictly increases with no gaps. `sequence` is a
    -- reserved word in SQL, so it is quoted everywhere it appears.
    "sequence"  integer     NOT NULL CHECK ("sequence" > 0),
    -- The event, with Dates tagged as {"$date": "…"} — see serialisation.ts
    -- for why a plain JSON round-trip is not safe here.
    event       jsonb       NOT NULL,
    -- The envelope's occurredAt, denormalised as a real timestamp so it can be
    -- queried and indexed. The tagged form inside `event` is the authority;
    -- this is a projection of it.
    occurred_at timestamptz NOT NULL,
    appended_at timestamptz NOT NULL DEFAULT now(),

    -- THE concurrency guarantee. Two workers that both believe the case is at
    -- sequence 1 will both try to insert sequence 2; exactly one succeeds and
    -- the other gets a unique violation, which the store turns into a
    -- ConcurrencyConflictError.
    PRIMARY KEY (case_id, "sequence")
);

-- Reading a case's log is the hot path, and the primary key already orders it.
-- This index serves "what happened recently, across all cases" — the shape a
-- specialist console asks for.
CREATE INDEX IF NOT EXISTS case_events_occurred_at_idx ON case_events (occurred_at DESC);

CREATE TABLE IF NOT EXISTS submission_keys (
    -- The second line of defence against duplicate submission. The domain
    -- refuses a duplicate at decision time; this refuses it at write time.
    submission_key text        PRIMARY KEY,
    case_id        text        NOT NULL,
    claimed_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS submission_keys_case_id_idx ON submission_keys (case_id);
