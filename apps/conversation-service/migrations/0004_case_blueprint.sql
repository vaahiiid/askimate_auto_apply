-- 0004 · Which blueprint a case is an application against.
--
-- Forward-only and reviewed, per ADR-0003.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY: a version alone cannot identify a blueprint.
--
-- P1's Run Driver resumed a run by asking the catalogue for the blueprint whose
-- VERSION matched the checkpoint's. That worked while one blueprint existed and
-- stopped working the moment a second one was written: both fixtures are at
-- "1.0.0", and a version is only unique WITHIN a blueprint.
--
-- The right identifier was already implied by the domain — a case is "this
-- student applying to this course, through this portal's blueprint", and
-- `CaseOpened.submissionIdentity` already records the institution, course and
-- intake. This adds the fourth part of that identity, in the one place a case's
-- identity lives.
--
-- The checkpoint's `blueprintVersion` keeps its job, which is a different one:
-- detecting that the blueprint MOVED since the position was written, so the
-- position is discarded and re-derived (`resumeRun`). Identity and revision are
-- two questions and now have two answers.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Nullable, because 0002 created this table without it and a forward-only
-- migration does not rewrite history. A case with no blueprint id cannot be
-- resumed — the driver refuses with `unknown_blueprint` rather than guessing,
-- which is the correct answer for a case nobody can identify.

ALTER TABLE cases
    ADD COLUMN IF NOT EXISTS blueprint_id text
        CONSTRAINT cases_blueprint_id_shape
        CHECK (blueprint_id IS NULL OR length(blueprint_id) BETWEEN 1 AND 128);
