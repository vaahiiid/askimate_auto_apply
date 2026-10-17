/**
 * The confirmed profile, in the plane that owns the student. ADR-0044.
 *
 * ── Why here and not in a third database ──────────────────────────────────
 *
 * This plane already owns students, conversations and — since P1 — cases, and a
 * profile belongs to a student. ADR-0037 keeps the system at two databases; a
 * third store for data with exactly one owner would be a third thing to
 * migrate, back up and keep consistent.
 *
 * The Secure Plane's database is emphatically not a candidate, and the reason
 * is worth stating rather than assuming: a confirmed profile is the student's
 * personal data in plain text, and the secure plane is the one place kept free
 * of anything that outlives a request.
 *
 * ── This class does not mint ──────────────────────────────────────────────
 *
 * It reads rows and hands them to `rehydrateProfile` in `@askimate/aas-profile`,
 * which is the package that owns the one cast (ADR-0004). Nothing here
 * constructs a `ConfirmedValue`, and `scripts/check-boundaries.ts` would fail
 * the build if it tried.
 */

import type { ConfirmedProfile, ConfirmedProfileStore, StoredProfileEntry } from "@askimate/aas-profile";
import { rehydrateProfile } from "@askimate/aas-profile";
import type { Pool } from "pg";

interface ProfileRow {
  readonly field_key: string;
  readonly value: unknown;
  readonly provenance: unknown;
  readonly revision: number;
}

export class PostgresConfirmedProfileStore implements ConfirmedProfileStore {
  readonly #pool: Pool;

  public constructor(pool: Pool) {
    this.#pool = pool;
  }

  public async load(studentId: string, now: Date): Promise<ConfirmedProfile> {
    const rows = await this.#pool.query<ProfileRow>(
      "SELECT field_key, value, provenance, revision FROM profile_entries WHERE student_id = $1",
      [studentId],
    );
    return rehydrateProfile({
      studentId,
      entries: rows.rows.map((row) => ({
        key: row.field_key as StoredProfileEntry["key"],
        value: row.value,
        provenance: row.provenance as StoredProfileEntry["provenance"],
        revision: row.revision,
      })),
      updatedAt: now,
    });
  }

  /**
   * Writes one entry, overwriting the key.
   *
   * `ON CONFLICT … DO UPDATE` rather than delete-then-insert: a student
   * correcting an answer must not have a window in which they have no date of
   * birth, because the minor-detection safeguard reads it and "absent" and
   * "under 18" lead to very different behaviour.
   *
   * Every overwrite moves the revision past the one held, whatever revision
   * the writer gave (ADR-0161 §6, P318). A mandatory review covers the content
   * it saw by each answer's revision and the moment it was confirmed, never by
   * its value; a writer that overwrote an answer at the same revision would
   * slip a changed financial answer past its review. So the store, not each
   * writer, makes every overwrite count.
   */
  public async save(studentId: string, entry: StoredProfileEntry): Promise<void> {
    await this.#pool.query(
      `INSERT INTO profile_entries (student_id, field_key, value, provenance, revision)
            VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (student_id, field_key) DO UPDATE
               SET value = EXCLUDED.value,
                   provenance = EXCLUDED.provenance,
                   revision = GREATEST(EXCLUDED.revision, profile_entries.revision + 1),
                   updated_at = now()`,
      [
        studentId,
        entry.key,
        JSON.stringify(entry.value),
        JSON.stringify(entry.provenance),
        entry.revision,
      ],
    );
  }
}
