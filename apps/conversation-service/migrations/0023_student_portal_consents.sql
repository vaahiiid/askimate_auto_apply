-- 0023 · The student's choice on a portal's consent banner (ADR-0131).
--
-- Forward-only and reviewed, per ADR-0003.
--
-- ── Why a table of its own, keyed by student and portal ──────────────────
--
-- Attempt 1 of Run A's third conversation (2026-09-18) named the obstacle at
-- the sign-in: Civic CookieControl's backdrop, the full viewport, over the
-- button. Dismissing it is a choice about cookies made on the student's
-- account, in their name. Vahid: "a cookie choice is a choice made on the
-- student's account, in their name, against an institution that may one day
-- be asked what they consented to. A system that asks for a yes before typing
-- a date of birth cannot decide this one by itself."
--
-- His two conditions shape the key: "The choice is per portal and it is
-- durable, but it is not permanent. A student who chose once on Sheffield
-- should not be asked again on Sheffield, and should be asked afresh on
-- Manchester. And they must be able to see what they chose and change it."
-- So one row per (student, portal), not per run or per case — a later case on
-- the same portal reads it — and a change is an update in place, with the
-- time it changed kept beside the time it was first made.
--
-- `choice` is the key the reviewed blueprint gives the banner's choice, never
-- the button's text: the words live in the blueprint, under review and
-- signature, and are read from there when the choice is shown back.
CREATE TABLE IF NOT EXISTS student_portal_consents (
    student_id  text        NOT NULL,
    portal_host text        NOT NULL,
    choice      text        NOT NULL,
    chosen_at   timestamptz NOT NULL,
    changed_at  timestamptz NOT NULL,
    PRIMARY KEY (student_id, portal_host)
);
