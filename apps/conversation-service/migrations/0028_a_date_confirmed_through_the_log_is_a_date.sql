-- 0028 · A date confirmed through the log is a date, not the string JSON made of it.
--
-- Forward-only and reviewed, per ADR-0003.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- P225, found on the way to ADR-0146. 0003 says why `value` is TAGGED JSON:
-- a plain round-trip turns a Date into a string silently. The profile store
-- honoured that; the conversation log did not. A proposal crossed the log as
-- plain JSON, the Date inside it became its ISO string, and a confirmation
-- read back from the log stored that string as the confirmed value. The plan
-- then refused the three date-of-birth maps (`render_refused`), the run's
-- next step read `specialist` while its status was `running`, and Vahid's
-- page said "specialist (running)" — his date of birth, confirmed on
-- 2026-09-26 through exactly this path, is such a row.
--
-- The service now encodes at the log boundary. This puts right the rows
-- written before it did, in the four places a date lives in a profile:
-- the date of birth itself, a passport's expiry, a language test's date and
-- a current visa's expiry. Only a bare ISO timestamp string is touched; a
-- tagged value, a `none`, or anything else is left exactly as it is, and a
-- second run finds nothing to do.
-- ═══════════════════════════════════════════════════════════════════════════
UPDATE profile_entries
   SET value = jsonb_build_object('$date', value #>> '{}')
 WHERE field_key = 'identity.date_of_birth'
   AND jsonb_typeof(value) = 'string'
   AND (value #>> '{}') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$';

UPDATE profile_entries
   SET value = jsonb_set(value, '{expiry}', jsonb_build_object('$date', value #>> '{expiry}'))
 WHERE field_key = 'identity.passport'
   AND jsonb_typeof(value -> 'expiry') = 'string'
   AND (value #>> '{expiry}') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$';

UPDATE profile_entries
   SET value = jsonb_set(value, '{testDate}', jsonb_build_object('$date', value #>> '{testDate}'))
 WHERE field_key = 'education.english_language_test'
   AND jsonb_typeof(value -> 'testDate') = 'string'
   AND (value #>> '{testDate}') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$';

UPDATE profile_entries
   SET value = jsonb_set(value, '{currentVisaExpiry}', jsonb_build_object('$date', value #>> '{currentVisaExpiry}'))
 WHERE field_key = 'immigration.uk_study'
   AND jsonb_typeof(value -> 'currentVisaExpiry') = 'string'
   AND (value #>> '{currentVisaExpiry}') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$';
