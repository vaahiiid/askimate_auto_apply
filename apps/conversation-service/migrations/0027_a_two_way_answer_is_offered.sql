-- 0027 · A two-way answer is offered, never guessed and never refused.
--
-- Forward-only and reviewed, per ADR-0003.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ADR-0146, P225. "11/08/1989" is 11 August 1989 and 8 November 1989. Not
-- guessing was right; refusing was the defect: the student knows which they
-- meant, types it again, and the third attempt stops the run on a date they
-- gave correctly twice. Vahid: *"The system already knows both readings. It
-- should put them to the student and let them pick."*
--
--   value_offered   the answer read more than one way and the readings were
--                   put to the student. `proposal` holds the readings, each
--                   with its id, its words and the proposal a pick becomes;
--                   `playback_hash` holds the hash of the offer as shown;
--                   `part_key` names the part when the field is walked.
--
-- Not an asking: it writes no attempt (0026), because the pick is an answer
-- to the question that stands, not a new question.
-- ═══════════════════════════════════════════════════════════════════════════
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
        'value_confirmed',
        'value_rejected',
        'target_offered',
        'target_requested',
        'reapplication_advised'));

-- ── Widened, not weakened: the offer is part of the value exchange ────────
ALTER TABLE conversation_events
    DROP CONSTRAINT a_proposal_exchange_names_a_field;
ALTER TABLE conversation_events
    ADD CONSTRAINT a_proposal_exchange_names_a_field CHECK (
        (kind IN ('value_asked', 'value_proposed', 'value_offered', 'value_part_read',
                  'value_confirmed', 'value_rejected'))
        = (field_key IS NOT NULL));

-- A part read names its part; an offer MAY, when the readings are of a part.
ALTER TABLE conversation_events
    DROP CONSTRAINT only_a_part_read_names_a_part;
ALTER TABLE conversation_events
    ADD CONSTRAINT only_a_part_read_names_a_part CHECK (
        (kind = 'value_part_read' AND part_key IS NOT NULL)
        OR (kind = 'value_offered')
        OR (kind NOT IN ('value_part_read', 'value_offered') AND part_key IS NULL));

-- The readings on offer are stored as the proposal column holds a reading:
-- structured, so the pick applies exactly what was shown.
ALTER TABLE conversation_events
    DROP CONSTRAINT only_a_proposal_carries_a_value;
ALTER TABLE conversation_events
    ADD CONSTRAINT only_a_proposal_carries_a_value CHECK (
        (kind IN ('value_proposed', 'value_offered', 'value_part_read')) = (proposal IS NOT NULL));

-- And the offer's hash rides where the playback's does: what the student was
-- shown, so the pick can be checked against it.
ALTER TABLE conversation_events
    DROP CONSTRAINT a_playback_hash_belongs_to_the_exchange;
ALTER TABLE conversation_events
    ADD CONSTRAINT a_playback_hash_belongs_to_the_exchange CHECK (
        (kind IN ('value_proposed', 'value_offered', 'value_confirmed')) = (playback_hash IS NOT NULL));
