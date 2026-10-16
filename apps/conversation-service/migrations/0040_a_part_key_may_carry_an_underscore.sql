-- 0040 · A part key may carry an underscore (P314).
--
-- Forward-only and reviewed, per ADR-0003.
--
-- His run of 2026-10-16 (docs/run-a/p314-his-message-as-sent.txt): "I typed
-- "no". No playback, no "could not read", no reply of any kind: the same
-- question was simply asked again."
--
-- The interview read his "no" to "Do you hold a British passport?" and wrote
-- it as a part of `immigration.uk_status`, keyed `british_passport`. This
-- column refused the row: 0024 took a part key as letters and digits, because
-- the registry's composites were lowerCamelCase when it was written (`line1`,
-- `postalCode`), and 0025 widened it to `word.word` for a list entry and kept
-- the same letters. P197 then gave the UK status its seven claims, each the
-- name the registry's own type uses (`british_passport`, `indefinite_leave`,
-- `refugee_status`, `migrant_worker`, `spouse_of_uk_citizen`, `eu_passport`,
-- `spouse_of_eu_citizen`), and the signed Sheffield entry reads them by those
-- names. Nothing wrote one to this column until a student was asked one, so
-- the check could not fire until then; the interview's unit tests run on a log
-- in memory, which has no such check.
--
-- So the shape is widened by the one character those keys need, and no
-- further: a key still starts with a letter, holds only letters, digits and
-- underscores, and is one word or `word.word`. A hyphen, a space, a leading
-- digit or underscore, or a second dot is still refused, because a log that
-- accepted any string here would accept a part key nobody's spec names.
-- `schema.test.ts` writes every part key the specs can produce against it.

ALTER TABLE conversation_events
    DROP CONSTRAINT conversation_events_part_key_check;

ALTER TABLE conversation_events
    ADD CONSTRAINT conversation_events_part_key_check CHECK (
        part_key IS NULL
        OR part_key ~ '^[a-zA-Z][a-zA-Z0-9_]{0,63}(\.[a-zA-Z][a-zA-Z0-9_]{0,63})?$');
