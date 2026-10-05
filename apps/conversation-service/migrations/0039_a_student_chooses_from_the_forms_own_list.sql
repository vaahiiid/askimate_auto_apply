-- 0039 · A student chooses from the form's own list (P290, ADR-0155; ADR-0109 amended).
--
-- Forward-only and reviewed, per ADR-0003.
--
-- When a student's value is not among the entries a portal's list was read
-- to hold, the student is shown what it does hold and chooses — an entry, or
-- the form's own escape. In the message of 2026-10-05, 15:02 UTC, which
-- speaks of Vahid in the third person: "Whatever they pick is their answer,
-- recorded as theirs, and the run carries on with it." And: "And what they
-- pick is stored as their own words, with the portal's entry recorded beside
-- it." So their words stay in the profile untouched, and this row records,
-- for THIS application, which entry of THIS form's list they chose for them.
--
-- And of the escape, in Vahid's own words (15:52 UTC): "The record of that
-- choice is what permits the press, so a run with no recorded choice refuses
-- the escape exactly as it does today." This row is that record.
--
-- One choice standing per value: (case, field, entry of a repeating page, the
-- student's words). `offer_hash` is the offer the press answered, so a choice
-- can be traced to exactly what was shown. `chosen_value` may be the empty
-- string: Sheffield's award title submits "" for its escape.
CREATE TABLE entry_choices (
    choice_id        text        PRIMARY KEY,
    case_id          text        NOT NULL,
    conversation_id  text        NOT NULL,
    field_ref        text        NOT NULL CHECK (length(field_ref) > 0),
    item_index       integer     CHECK (item_index IS NULL OR item_index >= 0),
    student_value    text        NOT NULL CHECK (length(student_value) > 0),
    chosen_value     text        NOT NULL,
    chosen_label     text        NOT NULL,
    is_escape        boolean     NOT NULL,
    searched_with    text        CHECK (searched_with IS NULL OR length(searched_with) > 0),
    offer_hash       text        NOT NULL CHECK (offer_hash ~ '^sha256:[0-9a-f]{64}$'),
    chosen_at        timestamptz NOT NULL
);

CREATE UNIQUE INDEX entry_choices_one_per_value
    ON entry_choices (case_id, field_ref, coalesce(item_index, -1), student_value);
