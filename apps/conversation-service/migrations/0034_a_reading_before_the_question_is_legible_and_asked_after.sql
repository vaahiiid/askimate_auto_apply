-- 0034 · A reading done before the question existed is legible as that, and
--        the question is put after it, honestly.
--
-- Forward-only and reviewed, per ADR-0003.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- P253, row 108. Vahid, 2026-09-30: *"A `read` row with no decision is a fact
-- about how this system behaved for a period, and it should be legible as
-- that rather than as missing data."* And: *"Parts never confirmed get the
-- honest question… 'I read your CV before I should have asked. Do you want
-- me to use what I read, or would you rather tell me yourself?' Do not
-- soften it."*
--
-- Under the rule before 0032 a confirmed CV went straight to the reader. A
-- row read then has `read_at` and no `decided_at`: nobody was asked. 0033 left
-- such rows alone, correctly — the reading happened, and a `held` row would
-- say it had not. This migration gives that fact its name in the schema, and
-- the question its own columns, because a read row cannot become `offered`
-- (a read row has a `read_at`; an offered one has none — 0030's
-- `ended_says_when`) and must not pretend to.
--
--   asked_after_reading_at   when the honest question was put, on a row read
--                            before anyone asked; null on every other row
--   used                     the answer: true, use what was read; false, do
--                            not — the CV is deleted, as on the ordinary no,
--                            and the parts it seeded are never read back
--                            into the walk. Null while the question stands.
--
-- `decided_at` stays null on a read row nobody was asked about, and stays
-- null after this migration unless the student answers. Nothing here, and
-- nothing later, "repairs" it.
-- ═══════════════════════════════════════════════════════════════════════════
COMMENT ON COLUMN document_readings.decided_at IS
    'When the student answered the question about this document. NULL on a read, leased or failed row means the document was read before the question existed (before migration 0032, ADR-0151): nobody was asked. That null is a record, not a gap — do not fill it (P253, row 108).';

ALTER TABLE document_readings
    ADD COLUMN asked_after_reading_at timestamptz;
ALTER TABLE document_readings
    ADD COLUMN used boolean;
-- The question after reading is put only on a read row; an answer to it
-- carries the question and the time of the answer; the question, once
-- answered, has its answer.
ALTER TABLE document_readings
    ADD CONSTRAINT document_readings_the_question_after_reading CHECK (
        (asked_after_reading_at IS NULL OR state = 'read')
        AND (used IS NULL OR (asked_after_reading_at IS NOT NULL AND decided_at IS NOT NULL))
        AND (asked_after_reading_at IS NULL OR decided_at IS NULL OR used IS NOT NULL));
