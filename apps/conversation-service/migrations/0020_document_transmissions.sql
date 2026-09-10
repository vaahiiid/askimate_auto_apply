-- 0020 · What left: every document the runner attached, as the audit trail
--        keeps it (ADR-0069's third layer, P73).
--
-- Forward-only and reviewed, per ADR-0003.
--
-- ADR-0022 asked one question of every disclosure — "why did this leave our
-- systems?" — and `recordTransmission` has produced the answer since Phase 1,
-- inside the executor, where it was returned and then dropped: the runner's
-- report carried an outcome and nothing else. This table is where the answer
-- now lands, written by the Run Driver from the report the runner sends after
-- the page carrying the attachment was SAVED, and only then.
--
-- ── What a row is ────────────────────────────────────────────────────────
--
-- Identifiers and a hash, never contents (brief §8): which document, hashed
-- to what, under which disclosure, to which host, for which case, when. One
-- row per `attach_document` intent the report settled — the plane records
-- only a transmission that matches an intent it opened at the claim, so a
-- runner cannot record a disclosure the plane never gated.
--
-- ── What it is NOT ───────────────────────────────────────────────────────
--
-- Not the ledger: the intent in `workflow_action_intents` says the attachment
-- was started and how it ended; this says what the attachment WAS, for the
-- audit, once it succeeded. Not a second copy of the disclosure record either
-- — the disclosure id names one — and not readable by any route: an operator
-- reads it, and nothing in the product does.

CREATE TABLE IF NOT EXISTS document_transmissions (
    -- One row per document per intent: the same document attached again on a
    -- re-offered page (a corrected field beside it) is the same disclosure
    -- again, keyed by the intent that carried it.
    run_id            text        NOT NULL,
    intent_key        text        NOT NULL,
    case_id           text        NOT NULL,
    disclosure_id     text        NOT NULL,
    document_id       text        NOT NULL,
    content_hash      text        NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
    to_host           text        NOT NULL CHECK (length(to_host) BETWEEN 1 AND 253),
    institution_name  text        NOT NULL,
    -- When the runner attached it, by the runner's clock, and when the plane
    -- took the report, by its own. Two clocks, both kept.
    transmitted_at    timestamptz NOT NULL,
    recorded_at       timestamptz NOT NULL,
    PRIMARY KEY (run_id, intent_key)
);

CREATE INDEX IF NOT EXISTS document_transmissions_by_case
    ON document_transmissions (case_id, transmitted_at);

CREATE INDEX IF NOT EXISTS document_transmissions_by_document
    ON document_transmissions (document_id, transmitted_at);
