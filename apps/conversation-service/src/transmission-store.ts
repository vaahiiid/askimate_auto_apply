/**
 * What left: the audit record of every document the runner attached
 * (ADR-0022, ADR-0069 — P73). Migration 0020.
 *
 * Written by the Run Driver from a runner's report, for exactly the
 * `attach_document` intents that report settled; read by an operator asking
 * "why did this leave our systems?", and by a test. Identifiers and a hash,
 * never contents.
 */

import type pg from "pg";

export interface RecordedTransmission {
  readonly runId: string;
  readonly intentKey: string;
  readonly caseId: string;
  readonly disclosureId: string;
  readonly documentId: string;
  readonly contentHash: string;
  readonly toHost: string;
  readonly institutionName: string;
  readonly transmittedAt: Date;
  readonly recordedAt: Date;
}

export class TransmissionStore {
  readonly #pool: pg.Pool;

  public constructor(pool: pg.Pool) {
    this.#pool = pool;
  }

  /** Idempotent by intent: a report delivered twice records one transmission. */
  public async record(input: Omit<RecordedTransmission, "recordedAt"> & { readonly now: Date }): Promise<void> {
    await this.#pool.query(
      `INSERT INTO document_transmissions
         (run_id, intent_key, case_id, disclosure_id, document_id, content_hash,
          to_host, institution_name, transmitted_at, recorded_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (run_id, intent_key) DO NOTHING`,
      [
        input.runId,
        input.intentKey,
        input.caseId,
        input.disclosureId,
        input.documentId,
        input.contentHash,
        input.toHost,
        input.institutionName,
        input.transmittedAt,
        input.now,
      ],
    );
  }

  /** Everything that left for one application, in the order it left. */
  public async forCase(caseId: string): Promise<readonly RecordedTransmission[]> {
    const rows = await this.#pool.query<{
      run_id: string;
      intent_key: string;
      case_id: string;
      disclosure_id: string;
      document_id: string;
      content_hash: string;
      to_host: string;
      institution_name: string;
      transmitted_at: Date;
      recorded_at: Date;
    }>(
      `SELECT run_id, intent_key, case_id, disclosure_id, document_id, content_hash,
              to_host, institution_name, transmitted_at, recorded_at
         FROM document_transmissions WHERE case_id = $1
        ORDER BY transmitted_at ASC, intent_key ASC`,
      [caseId],
    );
    return rows.rows.map((row) => ({
      runId: row.run_id,
      intentKey: row.intent_key,
      caseId: row.case_id,
      disclosureId: row.disclosure_id,
      documentId: row.document_id,
      contentHash: row.content_hash,
      toHost: row.to_host,
      institutionName: row.institution_name,
      transmittedAt: row.transmitted_at,
      recordedAt: row.recorded_at,
    }));
  }
}
