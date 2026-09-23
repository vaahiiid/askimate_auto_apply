-- 0024 · One part of a field whose value has several.
--
-- Forward-only and reviewed, per ADR-0003.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ADR-0140, closing blocker 60.
--
-- The run driver rebuilds the interview from this log on EVERY REQUEST. P192
-- gave the interview fields answered part by part — an address is six
-- questions, a passport up to four — and then measured, through the real
-- driver, what the rebuild did with them:
--
--     ask  "the first line of your address — the number and street"
--           → answer read → dropped with the request → status: running
--     ask  "the first line of your address — the number and street"
--
-- The log carried one event per FIELD and none for a PART, so a student's
-- answer to the first line had nowhere to live between requests. P192 stopped
-- the run rather than asking, because a silent loop is worse than a clean
-- stop. This is the row that makes the walk possible instead.
--
--   value_part_read   one part was read and is being held. Nothing was shown
--                     to the student about it, and nothing is agreed.
--
-- ── Its own kind, not a value_proposed with a compound key ───────────────
--
-- `open_value_proposals` answers "what is this conversation waiting on?" by
-- selecting `kind = 'value_proposed'`. A part folded into that kind would be
-- reported as an outstanding confirmation, and a client could offer the
-- student a way to agree to half an address. The confirmation comes ONCE,
-- against the whole assembled value, and it is the `value_proposed` after the
-- last part that carries the playback hash.
--
-- The view is therefore untouched, deliberately: a new kind is invisible to it.
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
        'value_part_read',
        'value_confirmed',
        'value_rejected',
        'target_offered',
        'target_requested',
        'reapplication_advised'));

-- Which part of the field. A closed shape rather than free text, like
-- `field_key` beside it: a `FieldPart.partKey`, as `field-specs.ts` writes
-- them — lowerCamelCase, because the registry's own composite types do
-- (`line1`, `postalCode`, `issuingCountry`).
ALTER TABLE conversation_events
    ADD COLUMN part_key text CHECK (part_key IS NULL OR part_key ~ '^[a-zA-Z][a-zA-Z0-9]{0,63}$');

-- Widened, not weakened: 0014's rule was that a `field_key` belongs to the
-- value exchange and to nothing else. A part read IS that exchange — it is the
-- turn between the question and the reading — so the kind joins the list.
ALTER TABLE conversation_events
    DROP CONSTRAINT a_proposal_exchange_names_a_field;

ALTER TABLE conversation_events
    ADD CONSTRAINT a_proposal_exchange_names_a_field CHECK (
        (kind IN ('value_asked', 'value_proposed', 'value_part_read',
                  'value_confirmed', 'value_rejected'))
        = (field_key IS NOT NULL));

-- And its mirror, which is the new one: only a part read names a part. A
-- `value_proposed` for `contact.address` is the WHOLE address, and a part key
-- on it would say otherwise.
ALTER TABLE conversation_events
    ADD CONSTRAINT only_a_part_read_names_a_part CHECK (
        (kind = 'value_part_read') = (part_key IS NOT NULL));

-- 0008 said only a proposal carries a value. Two kinds carry one now, and for
-- the same reason 0008 gave: the reading is stored rather than re-parsed from
-- the prose beside it, because re-parsing depends on `render ∘ parse` being
-- lossless and fails silently where it is not. A part read has no prose beside
-- it at all, so there would be nothing to re-parse from.
ALTER TABLE conversation_events
    DROP CONSTRAINT only_a_proposal_carries_a_value;

ALTER TABLE conversation_events
    ADD CONSTRAINT only_a_proposal_carries_a_value CHECK (
        (kind IN ('value_proposed', 'value_part_read')) = (proposal IS NOT NULL));

-- `a_playback_hash_belongs_to_the_exchange` is deliberately UNTOUCHED. A part
-- read carries no hash, for `value_asked`'s reason: there is nothing to
-- confirm yet, and a hash here would invite a client to offer the student a
-- way to agree to one line of an address.
