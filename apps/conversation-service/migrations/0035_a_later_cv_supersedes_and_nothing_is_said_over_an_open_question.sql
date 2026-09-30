-- 0035 · A later CV supersedes the earlier one; nothing is said over an open
--        question; an answer that could not be read is on the log.
--
-- Forward-only and reviewed, per ADR-0003.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- P256. Vahid, 2026-09-30, after a run stopped on his own walk:
--
-- *"Nothing is said over an open playback. A confirmation is a question, and
-- speaking over it while it waits invites exactly what I did — reading the
-- new sentence as the interview moving on. Whatever else is true, the student
-- should never have two things to answer at once… If the reader, a portal
-- demand, or anything else lands while a question is open, it queues."*
--
-- *"A later CV supersedes the earlier one, yes. And record that the vault has
-- defined a `superseded` state that nothing has ever set. A state in a schema
-- that no code writes is a claim the system makes about itself and does not
-- keep."*
--
-- *"Counting failed answers rather than askings is right."*
--
-- Three things, on two tables:
--
--   document_readings.superseded / superseded_by
--       A CV confirmed while an earlier one of the same student's is still
--       held or offered — nobody asked about it yet — ends that earlier row
--       `superseded`, naming the later document. It is never asked about.
--       The vault's own `superseded` state is set at the same moment, for the
--       first time since it was defined in 0017.
--
--   document_readings.told_at
--       When the student was told what this row had to tell them: the
--       question (held → offered), the one sentence that a CV ahead of its
--       field is held, or the reading's sentence. Null until then. The
--       arrival is recorded at once; the telling waits for a moment when the
--       student has nothing else to answer, and this column is what says the
--       telling is still owed. Rows written before this migration were told
--       under the old code at the moment they were written, read or decided.
--
--   conversation_events.kind = 'answer_unread'
--       A student's answer to the question that stood could not be read. The
--       stop rule counts these and the readings the student refused — failed
--       answers to THIS question — not askings, which also grew when the
--       interview asked again for other reasons and on messages addressed to
--       something else.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE document_readings
    DROP CONSTRAINT document_readings_state_check;
ALTER TABLE document_readings
    ADD CONSTRAINT document_readings_state_check
        CHECK (state IN ('held', 'offered', 'pending', 'leased', 'read', 'failed', 'declined', 'superseded'));
ALTER TABLE document_readings
    ADD COLUMN superseded_by text CHECK (superseded_by IS NULL OR superseded_by ~ '^[0-9A-Z]{26}$');
ALTER TABLE document_readings
    ADD CONSTRAINT document_readings_superseded_names_the_later CHECK (
        (state = 'superseded') = (superseded_by IS NOT NULL));
-- A superseded row was never answered about: its decided_at stays null.
ALTER TABLE document_readings
    DROP CONSTRAINT document_readings_a_no_says_when;
ALTER TABLE document_readings
    ADD CONSTRAINT document_readings_a_no_says_when CHECK (
        (state <> 'declined' OR decided_at IS NOT NULL)
        AND (state NOT IN ('held', 'offered', 'superseded') OR decided_at IS NULL));

ALTER TABLE document_readings
    ADD COLUMN told_at timestamptz;
COMMENT ON COLUMN document_readings.told_at IS
    'When the student was told what this row had to tell them — the question, that a CV ahead of its field is held, or the reading''s sentence. NULL: the telling is still owed, and is said at the next moment the student has nothing else to answer (P256).';
UPDATE document_readings
    SET told_at = COALESCE(read_at, decided_at, requested_at);

ALTER TABLE conversation_events
    DROP CONSTRAINT conversation_events_kind_check;
ALTER TABLE conversation_events
    ADD CONSTRAINT conversation_events_kind_check CHECK (kind IN (
        'message',
        'secret_requested',
        'secret_received',
        'secret_consumed',
        'secret_expired',
        'secret_cancelled',
        'secret_rejected',
        'value_asked',
        'value_proposed',
        'value_offered',
        'value_part_read',
        'value_part_demanded',
        'value_confirmed',
        'value_rejected',
        'answer_unread',
        'target_offered',
        'target_requested',
        'reapplication_advised'));
ALTER TABLE conversation_events
    DROP CONSTRAINT a_proposal_exchange_names_a_field;
ALTER TABLE conversation_events
    ADD CONSTRAINT a_proposal_exchange_names_a_field CHECK (
        (kind IN ('value_asked', 'value_proposed', 'value_offered', 'value_part_read',
                  'value_part_demanded', 'value_confirmed', 'value_rejected', 'answer_unread'))
        = (field_key IS NOT NULL));
