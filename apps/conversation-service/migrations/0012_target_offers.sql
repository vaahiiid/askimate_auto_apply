-- 0012 · The offer a student accepted, and the request that opened a case.
--
-- Forward-only and reviewed, per ADR-0003.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ADR-0058. A case opens from an offer the student accepted, not from an
-- identifier they sent. Two events make that auditable:
--
--   target_offered    the server resolved a REVIEWED target and put it to the
--                     student. Carries the offer hash, the blueprint it names,
--                     and the catalogue content hash that supported it.
--   target_requested  the student explicitly asked to apply to that exact
--                     offer. The event that precedes `CaseOpened`.
--
-- Modelled on 0008's value_proposed → value_confirmed exchange, for the reason
-- that exchange exists: "what exactly did I agree to?" is answerable from two
-- events and the rendered message between them.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ── Why a separate hash column, and not `playback_hash` ──────────────────
--
-- 0008's `a_playback_hash_belongs_to_the_exchange` says a playback hash belongs
-- to the value exchange and to nothing else. Widening it would make one column
-- mean two things; a second column keeps each constraint able to say exactly
-- which kinds it governs.

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
        'value_proposed',
        'value_confirmed',
        'value_rejected',
        'target_offered',
        'target_requested'));

-- `sha256:<64 hex>`, the same shape every hash in this system is written in.
ALTER TABLE conversation_events
    ADD COLUMN offer_hash text
        CHECK (offer_hash IS NULL OR offer_hash ~ '^sha256:[0-9a-f]{64}$');

-- Which reviewed blueprint the offer names. Bounded like every other id column.
ALTER TABLE conversation_events
    ADD COLUMN target_blueprint_id text
        CHECK (target_blueprint_id IS NULL
               OR length(target_blueprint_id) BETWEEN 1 AND 128);

-- ── The column that makes the audit survive a catalogue change ──────────
--
-- ADR-0057's content hash for the catalogue entry the offer was built from.
--
-- Recorded rather than re-derived, and that is the whole point: if the reviewed
-- artefact is later superseded, re-deriving would produce a DIFFERENT answer
-- and the log would silently describe an offer nobody made. With the hash
-- written down, "which exact reviewed content supported this?" stays answerable
-- and a later change becomes DETECTABLE rather than invisible.
--
-- What it does not do is reproduce the artefact. That would need the artefact
-- archived, which is a separate decision; this makes the mismatch visible.
ALTER TABLE conversation_events
    ADD COLUMN target_content_hash text
        CHECK (target_content_hash IS NULL
               OR target_content_hash ~ '^sha256:[0-9a-f]{64}$');

-- Both halves of the exchange name the offer they are about.
ALTER TABLE conversation_events
    ADD CONSTRAINT a_target_exchange_names_an_offer CHECK (
        (kind IN ('target_offered', 'target_requested')) = (offer_hash IS NOT NULL));

-- Only the OFFER carries the target it resolved. The request names the offer;
-- what was offered is the offer's to state, and duplicating it on the request
-- would make two rows able to disagree about one fact.
ALTER TABLE conversation_events
    ADD CONSTRAINT only_an_offer_carries_a_target CHECK (
        (kind = 'target_offered')
        = (target_blueprint_id IS NOT NULL AND target_content_hash IS NOT NULL));

-- The target exchange of one conversation, in order.
--
-- A view rather than a query in the application, for the reason
-- `open_secret_requests` and `open_value_proposals` are views: "which offers
-- were made here, and which of them were asked for" is a rule about the log,
-- and a rule written in the application is a rule each caller can get subtly
-- wrong. The run route reads THIS to decide both halves of Gate 2's first
-- condition, rather than filtering the whole log itself.
--
-- Deliberately contains no `now()`. An offer does not expire — ADR-0058
-- §"the request re-derives" explains why a clock would refuse unchanged offers
-- and accept changed ones inside the window — so a view that read one would
-- make its answer untestable for no benefit.
CREATE OR REPLACE VIEW conversation_target_exchange AS
SELECT conversation_id,
       ordinal,
       kind,
       offer_hash,
       target_blueprint_id,
       target_content_hash,
       created_at
  FROM conversation_events
 WHERE kind IN ('target_offered', 'target_requested');

COMMENT ON VIEW conversation_target_exchange IS
    'Offers put to a student and the requests that accepted them, per ADR-0058. '
    'An offer is evidence that a target was shown; the request that names its '
    'hash is what opens a case.';
