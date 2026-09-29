-- 0032 · A document is read only on the student's word; a no ends it.
--
-- Forward-only and reviewed, per ADR-0003.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ADR-0151, P251. Vahid, 2026-09-29: *"Uploading a file is not consent to
-- take its contents as the whole answer… Ask first."* And: *"A no deletes
-- it… we hold a CV under one purpose, and a student who declines that
-- purpose has left us holding a document for nothing."*
--
-- So a confirmed CV no longer waits for the reader; it waits for the
-- student. Two states before `pending`, and one more end:
--
--   held       confirmed into the vault; nobody has been asked
--   offered    the interview reached the first field the CV could fill and
--              put the question; the run's pending decision is this
--   pending    the student said yes; the reader may claim it (as before)
--   leased / read / failed   as before
--   declined   the student said no; the document was deleted and they were
--              told; nothing is ever read from it
--
-- `decided_at` is when the student answered, either way.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE document_readings
    DROP CONSTRAINT document_readings_state_check;
ALTER TABLE document_readings
    ADD CONSTRAINT document_readings_state_check
        CHECK (state IN ('held', 'offered', 'pending', 'leased', 'read', 'failed', 'declined'));
ALTER TABLE document_readings
    ADD COLUMN decided_at timestamptz;
-- A no says when; a document nobody has answered about carries no answer.
ALTER TABLE document_readings
    ADD CONSTRAINT document_readings_a_no_says_when CHECK (
        (state <> 'declined' OR decided_at IS NOT NULL)
        AND (state NOT IN ('held', 'offered') OR decided_at IS NULL));
