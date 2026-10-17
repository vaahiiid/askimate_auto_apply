-- 0041 · A value changed in place moves its revision (P318, ADR-0161 §6).
--
-- Forward-only and reviewed, per ADR-0003.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- A mandatory review now covers only the content it reviewed: financial
-- evidence and a minor's date of birth (his "D3: approved.", 2026-10-17). The
-- fingerprint it covers is made of each answer's `revision` and the moment it
-- was confirmed, never its value, so that the case log holds nothing the
-- student said. That holds only while every change to a value moves one of
-- the two.
--
-- The store's own write does (`save`, `revision + 1` on every overwrite since
-- P318). An UPDATE that changes `value` or `provenance` in place does not: 0028
-- is one, a format-only rewrite of dates, and a hand-written statement would
-- be another. Found by P318's bypass refuter. So the table moves the revision
-- itself for any UPDATE, whoever writes it: a row whose value or provenance
-- changes gets at least one more than it had, and no UPDATE lowers it (a
-- revision lowered first and a value changed after would otherwise come back
-- to a fingerprint already approved). A write that changes neither keeps it,
-- and one that already moved it (the store's) is not moved twice.
--
-- What it does not cover: a row deleted and written again, which fires no
-- UPDATE. Nothing in the application does that (a profile is deleted only with
-- its student); a hand-written DELETE and INSERT could.
--
-- It fails closed: a rewrite that changes only a value's format, as 0028 did,
-- now sends a reviewed answer back to review.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION profile_entry_revision_moves() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.value IS DISTINCT FROM OLD.value OR NEW.provenance IS DISTINCT FROM OLD.provenance THEN
        NEW.revision := GREATEST(NEW.revision, OLD.revision + 1);
    ELSE
        NEW.revision := GREATEST(NEW.revision, OLD.revision);
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER profile_entry_revision_moves
    BEFORE UPDATE ON profile_entries
    FOR EACH ROW
    EXECUTE FUNCTION profile_entry_revision_moves();
