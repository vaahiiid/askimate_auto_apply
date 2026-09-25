-- 0025 · A part of one ENTRY of a list-valued field.
--
-- Forward-only and reviewed, per ADR-0003.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ADR-0113, built in P211 as item 1 of the list to `ready_to_submit`.
--
-- P210 measured, on an empty profile against the signed Sheffield entry, that
-- the interview's FIRST action was `escalate` on `employment.history` — before
-- the student's name — because the three list-valued fields the entry reads
-- had no question at all. The interview now collects a list entry by entry,
-- one part at a time (ADR-0113), and the walk lives on this log between
-- requests exactly as a composite's does (0024): one `value_part_read` per
-- answer, keyed by the part.
--
-- A list's part keys carry the entry they belong to:
--
--   any               "is there anything to list?"
--   item0.employer    the first entry's parts, in the item spec's order
--   item0.another     "is there another?"
--   item1.employer    …
--
-- 0024's shape for `part_key` was one lowerCamelCase word, the registry's own
-- composite part names. A list's key is that word under an entry prefix, so
-- the shape is WIDENED to `word` or `word.word` — and no further: a key that
-- starts with a digit, carries two dots, or holds anything but letters and
-- digits is still refused, because a log that accepted any string here would
-- accept a part key nobody's spec names.
--
-- Nothing else changes: `value_part_read` is still the only kind that names a
-- part, the `value_proposed` after the last part still carries the WHOLE list
-- and no part key, and `open_value_proposals` is still blind to parts.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE conversation_events
    DROP CONSTRAINT conversation_events_part_key_check;

ALTER TABLE conversation_events
    ADD CONSTRAINT conversation_events_part_key_check CHECK (
        part_key IS NULL
        OR part_key ~ '^[a-zA-Z][a-zA-Z0-9]{0,63}(\.[a-zA-Z][a-zA-Z0-9]{0,63})?$');
