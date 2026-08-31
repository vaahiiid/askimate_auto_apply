-- 0003 · The confirmed profile. ADR-0044.
--
-- Forward-only and reviewed, per ADR-0003. Never edited once applied anywhere.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY THIS TABLE EXISTS, AND WHAT IT IS NOT
--
-- `docs/durable-execution-architecture.md` §12 flagged the gap when durable
-- runs were designed: a `ConfirmedProfile` is not reconstructible from the
-- event log by existing design, and closing it either way was "a change to what
-- the event log is for". It was decided rather than assumed (ADR-0044).
--
-- The log keeps recording THAT a confirmation happened, by reference. This
-- table holds WHAT THE VALUE IS. `ConfirmationCaptured` is unchanged.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ── Mutable by design, and that is why it is not in the log ──────────────
--
-- A student who corrects an answer overwrites their entry, and `revision` goes
-- up. That is what makes this a PROJECTION rather than a history — and it is
-- exactly why the confirmations are recorded separately, in the append-only
-- place built for history. Two copies of a mutable value in an immutable log
-- would disagree eventually; one mutable row and a log of the events that
-- changed it cannot.
--
-- ── What is deliberately NOT here ────────────────────────────────────────
--
-- No password, and no column one could go in. A password is never a
-- ConfirmedValue (ADR-0026) and has no profile field key, so it has no row
-- here. `scripts/check-boundaries.ts` stops this service naming a vault, a
-- store or a resolver, and that rule is unaffected by this table.

CREATE TABLE IF NOT EXISTS profile_entries (
    student_id  uuid        NOT NULL REFERENCES students (id) ON DELETE CASCADE,

    -- The canonical field key: `identity.given_name`, `contact.email`. Bounded
    -- because it comes from a closed set in packages/profile, not from input.
    field_key   text        NOT NULL CHECK (length(field_key) BETWEEN 1 AND 128),

    -- The confirmed value, as tagged JSON. Tagged rather than plain because a
    -- profile holds dates and a plain JSON round-trip turns a Date into a
    -- string silently — the same defect `case_events` avoids the same way, and
    -- for the same reason.
    value       jsonb       NOT NULL,

    -- How the value reached the profile, and when the student confirmed it.
    -- Stored WITH the value rather than beside it: a confirmed value is a value
    -- AND its provenance, and a row that had one without the other would
    -- rehydrate into something ADR-0004 says cannot exist.
    provenance  jsonb       NOT NULL,

    -- 1 on first confirmation, higher after a correction. A correction is
    -- materially different evidence from an acceptance (ADR-0008's learning
    -- loop cares), and this is what says one happened.
    revision    integer     NOT NULL DEFAULT 1 CHECK (revision >= 1),

    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),

    -- One value per field per student. Two would make "what is their date of
    -- birth?" depend on ordering, and the minor-detection safeguard reads it.
    PRIMARY KEY (student_id, field_key)
);

CREATE INDEX IF NOT EXISTS profile_entries_by_student
    ON profile_entries (student_id, updated_at DESC);
