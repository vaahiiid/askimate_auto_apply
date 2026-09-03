-- ADR-0056 — email verification is established at LOGIN, not re-read live.
--
-- ── Why this is a migration and not an edit to 0001 ───────────────────────
--
-- `0001_conversation_log.sql` says, on `students.email_verified`:
--
--   "Re-read from the provider at every secure step rather than trusted from
--    a client claim."
--
-- That was never implemented, and P19 deliberately did not implement it: a live
-- re-read needs a stored provider access token per student, which is long-lived
-- sensitive state in the plane that holds student identity, added for one
-- boolean. Vahid weighed it and declined (ADR-0056 §1).
--
-- The comment is wrong and it cannot be corrected in place. Migrations are
-- forward-only and checksum-verified (ADR-0003): changing an applied file makes
-- `migrate` throw `MigrationChangedError` in every database that already ran it,
-- and the file's own runner says "add a new numbered migration instead".
--
-- So the correction goes where a person actually reads it — on the column, in
-- the database — and this file records why the source comment above it still
-- says something else.
COMMENT ON COLUMN students.email_verified IS
    'ADR-0056. Established at LOGIN from a signature-verified ID token and read '
    'from here at every secure step; NOT re-read from the provider. Never taken '
    'from a client claim. False for every ambiguous case — an absent email, an '
    'absent email_verified claim — because absence is not verification. A student '
    'who verifies afterwards must sign in again before a secure step will open.';
