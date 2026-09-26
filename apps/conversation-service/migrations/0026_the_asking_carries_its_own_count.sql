-- 0026 · The asking carries its own count.
--
-- Forward-only and reviewed, per ADR-0003.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ADR-0145, P224. How many times a student has been asked for a field was a
-- DERIVATION over the log — readings superseded, readings rejected, and from
-- P223 re-asks — and the derivation changed under a conversation that was
-- already running. Vahid's date of birth had been asked twice in silence the
-- day before (the system's fault, P221's loop); P223's rule counted those two
-- retroactively; his third answer exhausted the field and the interview moved
-- on without a word. In his words: *"My two silent re-asks yesterday were the
-- system's fault, not mine, and they spent my attempts."*
--
--   value_asked.attempt   which asking of this field this is, 1-based, since
--                         the field was last confirmed. Written by the asker
--                         AT the asking, from the last written attempt + 1.
--
-- The count is what was written, never what a rule derives. A rule can change
-- what the NEXT asking writes; it cannot change what an earlier one wrote.
-- Rows from before this migration carry NULL and read as 1: the askings the
-- old loop made do not count against the student.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE conversation_events
    ADD COLUMN IF NOT EXISTS attempt smallint;

-- ── Only an asking carries a count, and a count starts at one ────────────
ALTER TABLE conversation_events
    DROP CONSTRAINT IF EXISTS only_an_asking_carries_an_attempt;
ALTER TABLE conversation_events
    ADD CONSTRAINT only_an_asking_carries_an_attempt
        CHECK (attempt IS NULL OR (kind = 'value_asked' AND attempt >= 1));
