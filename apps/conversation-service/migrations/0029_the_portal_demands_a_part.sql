-- 0029 · The portal would not save a page without a part the student left out.
--
-- Forward-only and reviewed, per ADR-0003.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ADR-0148 §11, P233, row 94. A page was read back after its save and not
-- seen (ADR-0106). Until now that was a person's problem and the student read
-- "with a member of the team". Vahid: *"A student whose application stopped
-- because a university demanded a field we thought was optional is owed more
-- than silence. They are the one who could answer it in thirty seconds."*
--
--   value_part_demanded   the portal would not keep the page without this
--                         part of this field (`part_key`, an entry's part for
--                         a list). `proposal` holds what we know, in the
--                         words a student reads: the page, the boxes we left
--                         empty on it, and what the read-back did not see.
--                         Never the portal's own words.
--
-- Closed by the field's next `value_confirmed`. Not an asking: the asking
-- that follows writes its own attempt (0026).
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
        'value_part_demanded',
        'value_confirmed',
        'value_rejected',
        'target_offered',
        'target_requested',
        'reapplication_advised'));
ALTER TABLE conversation_events
    DROP CONSTRAINT a_proposal_exchange_names_a_field;
ALTER TABLE conversation_events
    ADD CONSTRAINT a_proposal_exchange_names_a_field CHECK (
        (kind IN ('value_asked', 'value_proposed', 'value_offered', 'value_part_read',
                  'value_part_demanded', 'value_confirmed', 'value_rejected'))
        = (field_key IS NOT NULL));
ALTER TABLE conversation_events
    DROP CONSTRAINT only_a_part_read_names_a_part;
ALTER TABLE conversation_events
    ADD CONSTRAINT only_a_part_read_names_a_part CHECK (
        (kind IN ('value_part_read', 'value_part_demanded') AND part_key IS NOT NULL)
        OR (kind = 'value_offered')
        OR (kind NOT IN ('value_part_read', 'value_part_demanded', 'value_offered') AND part_key IS NULL));
ALTER TABLE conversation_events
    DROP CONSTRAINT only_a_proposal_carries_a_value;
ALTER TABLE conversation_events
    ADD CONSTRAINT only_a_proposal_carries_a_value CHECK (
        (kind IN ('value_proposed', 'value_offered', 'value_part_read', 'value_part_demanded')) = (proposal IS NOT NULL));
