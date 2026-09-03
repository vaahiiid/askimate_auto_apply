/**
 * Resolving an authenticated person to the student this system knows.
 *
 * ADR-0038: the provider's `sub` is the ONLY identifier persisted, and it is
 * what `students.subject` has always held. ADR-0056: the trusted verification
 * result is persisted beside it, and every secure step reads it from here.
 */

import type { Pool } from "pg";

import type { IdentityClaims } from "@askimate/aas-oidc";

export interface ResolvedStudent {
  /** This system's own id. Never the provider's. */
  readonly studentId: string;
  readonly emailVerified: boolean;
}

export class StudentIdentityStore {
  readonly #pool: Pool;

  public constructor(pool: Pool) {
    this.#pool = pool;
  }

  /**
   * Upserts the student for a signed-in identity, and records what the provider
   * said about their email.
   *
   * ── Only `verified` writes `true` ────────────────────────────────────────
   *
   * Every other outcome — unverified, no address, no claim — writes `false`.
   * The database therefore never holds an optimistic value, and a reader who
   * knows nothing about the four cases still cannot be misled by the column
   * (ADR-0056 §3).
   *
   * The write happens on EVERY login rather than on first sight, because that
   * is the moment the value is fresh. It is also the only moment it changes:
   * ADR-0056 §1 chose not to re-read from the provider, so a student who
   * verifies later signs in again — and this is the line that then notices.
   */
  public async resolve(claims: IdentityClaims): Promise<ResolvedStudent> {
    const verified = claims.kind === "verified";
    const rows = await this.#pool.query<{ id: string; email_verified: boolean }>(
      `INSERT INTO students (subject, email_verified)
            VALUES ($1, $2)
       ON CONFLICT (subject) DO UPDATE
              SET email_verified = EXCLUDED.email_verified,
                  updated_at = now()
        RETURNING id, email_verified`,
      [claims.subject, verified],
    );
    const row = rows.rows[0];
    if (row === undefined) {
      // Unreachable: the upsert always returns a row. Thrown rather than
      // defaulted, because a caller with no student cannot mint a session.
      throw new Error("student upsert returned no row");
    }
    return { studentId: row.id, emailVerified: row.email_verified };
  }

  /**
   * What this plane last learned about a student's email, from the provider.
   *
   * The secure step's authority (ADR-0056). Answers `null` for a student this
   * system has never seen, which the caller must treat as "not verified" — an
   * unknown student is not a verified one.
   */
  public async verificationOf(studentId: string): Promise<boolean | null> {
    const rows = await this.#pool.query<{ email_verified: boolean }>(
      "SELECT email_verified FROM students WHERE id = $1",
      [studentId],
    );
    return rows.rows[0]?.email_verified ?? null;
  }
}
