/**
 * The student's choice on a portal's consent banner — ADR-0131 (P165).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * One row per student and portal, durable across runs and cases, changeable
 * in place. Vahid, 2026-09-18: *"The choice is per portal and it is durable,
 * but it is not permanent. A student who chose once on Sheffield should not be
 * asked again on Sheffield, and should be asked afresh on Manchester. And they
 * must be able to see what they chose and change it — not buried, but somewhere
 * they can reach."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * What is stored is the choice's KEY from the reviewed blueprint (`accept`,
 * `reject`, …), never the banner's text: the words are the blueprint's, under
 * review and signature, and are read from there whenever the choice is shown
 * back to the student. Migration 0023.
 */

import type pg from "pg";

export interface PortalConsentRecord {
  readonly choice: string;
  readonly chosenAt: Date;
  readonly changedAt: Date;
}

export class PortalConsentStore {
  readonly #pool: pg.Pool;

  public constructor(pool: pg.Pool) {
    this.#pool = pool;
  }

  /** The student's choice on this portal, or `null` when they have not chosen. */
  public async choiceFor(studentId: string, portalHost: string): Promise<PortalConsentRecord | null> {
    const rows = await this.#pool.query<{ choice: string; chosen_at: Date; changed_at: Date }>(
      "SELECT choice, chosen_at, changed_at FROM student_portal_consents WHERE student_id = $1 AND portal_host = $2",
      [studentId, portalHost],
    );
    const row = rows.rows[0];
    return row === undefined ? null : { choice: row.choice, chosenAt: row.chosen_at, changedAt: row.changed_at };
  }

  /**
   * Records the choice, or changes it. The first time keeps `chosen_at`; a
   * change moves `changed_at` only, so the record says both when the student
   * first decided and when they last changed their mind.
   */
  public async record(input: {
    readonly studentId: string;
    readonly portalHost: string;
    readonly choice: string;
    readonly now: Date;
  }): Promise<void> {
    await this.#pool.query(
      `INSERT INTO student_portal_consents (student_id, portal_host, choice, chosen_at, changed_at)
       VALUES ($1, $2, $3, $4, $4)
       ON CONFLICT (student_id, portal_host) DO UPDATE
         SET choice = EXCLUDED.choice,
             changed_at = EXCLUDED.changed_at`,
      [input.studentId, input.portalHost, input.choice, input.now],
    );
  }
}
