-- 0033 · A CV that arrives after its fields are confirmed is asked about at
--        once; a yes reopens what it can fill, from that point.
--
-- Forward-only and reviewed, per ADR-0003.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- P252, row 107. Vahid, 2026-09-30: *"ask, do not hold silently. A CV
-- uploaded after both sections are confirmed should get a sentence, not
-- silence… asking whether they want to go back and use the CV for either —
-- with the honest note that it would mean redoing what they already
-- confirmed… If they say no, delete it and say so, same as the decline
-- path."*
--
-- `reopened_after` is the conversation's last ordinal when the student said
-- that late yes. The confirmations before it are theirs and stand until they
-- confirm the CV's; the reading seeded after it is what reopens the field.
-- Ordinals, not clocks: the log is ordered by ordinal, and a clock is not.
-- Null on every reading that was not a late yes.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE document_readings
    ADD COLUMN reopened_after integer;
-- Only a yes reopens anything: the row was decided, and it is on the reader's
-- side of the question — never held, offered or declined.
ALTER TABLE document_readings
    ADD CONSTRAINT document_readings_a_reopening_follows_a_yes CHECK (
        reopened_after IS NULL
        OR (decided_at IS NOT NULL AND reopened_after >= 0 AND state IN ('pending', 'leased', 'read', 'failed')));

-- ═══════════════════════════════════════════════════════════════════════════
-- And the rows P251 left behind. Before 0032 a confirmed CV went straight to
-- `pending`, for the reader; 0032 added the question but did not move the
-- rows already waiting, so a CV confirmed under 0030 and still unread would
-- have been claimed without anyone asking — the exact thing ADR-0151 refuses.
-- A `pending` row nobody has answered about goes back to `held`, and the
-- question is put when its field comes up, or at once if that has passed.
-- ═══════════════════════════════════════════════════════════════════════════
UPDATE document_readings
    SET state = 'held'
    WHERE state = 'pending' AND decided_at IS NULL;
