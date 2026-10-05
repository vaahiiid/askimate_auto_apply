/**
 * A student's choices from a form's own lists, per application (P290,
 * ADR-0155). Migration 0039.
 *
 * Their words stay in the profile as they gave them; this holds, beside them,
 * which entry of THIS form's list they chose — and, for the form's escape, it
 * is the record that permits the runner to choose it (ADR-0109 amended).
 * Written by the Run Driver alone, on the student's press.
 */

import type pg from "pg";

import type { StudentChoice } from "@askimate/aas-mapping";

export interface EntryChoice extends StudentChoice {
  readonly choiceId: string;
  readonly caseId: string;
  readonly conversationId: string;
  readonly offerHash: string;
  readonly chosenAt: Date;
}

interface Row {
  choice_id: string;
  case_id: string;
  conversation_id: string;
  field_ref: string;
  item_index: number | null;
  student_value: string;
  chosen_value: string;
  chosen_label: string;
  is_escape: boolean;
  searched_with: string | null;
  offer_hash: string;
  chosen_at: Date;
}

const COLUMNS =
  "choice_id, case_id, conversation_id, field_ref, item_index, student_value, chosen_value, chosen_label, is_escape, searched_with, offer_hash, chosen_at";

function fromRow(row: Row): EntryChoice {
  return {
    choiceId: row.choice_id,
    caseId: row.case_id,
    conversationId: row.conversation_id,
    fieldRef: row.field_ref,
    ...(row.item_index === null ? {} : { item: row.item_index }),
    studentValue: row.student_value,
    value: row.chosen_value,
    label: row.chosen_label,
    escape: row.is_escape,
    ...(row.searched_with === null ? {} : { searchedWith: row.searched_with }),
    offerHash: row.offer_hash,
    chosenAt: row.chosen_at,
  };
}

export class EntryChoiceStore {
  readonly #pool: pg.Pool;

  public constructor(pool: pg.Pool) {
    this.#pool = pool;
  }

  /**
   * Records a choice, or answers with the one already standing for this value:
   * one choice per (application, field, entry, the student's words). A second
   * press on the same offer records nothing and changes nothing.
   */
  public async record(choice: Omit<EntryChoice, "chosenAt"> & { readonly chosenAt: Date }): Promise<{ readonly recorded: boolean; readonly choice: EntryChoice }> {
    const inserted = await this.#pool.query<Row>(
      `INSERT INTO entry_choices (${COLUMNS})
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (case_id, field_ref, coalesce(item_index, -1), student_value) DO NOTHING
       RETURNING ${COLUMNS}`,
      [
        choice.choiceId,
        choice.caseId,
        choice.conversationId,
        choice.fieldRef,
        choice.item ?? null,
        choice.studentValue,
        choice.value,
        choice.label,
        choice.escape,
        choice.searchedWith ?? null,
        choice.offerHash,
        choice.chosenAt,
      ],
    );
    const row = inserted.rows[0];
    if (row !== undefined) return { recorded: true, choice: fromRow(row) };
    const standing = (await this.forCase(choice.caseId)).find(
      (held) => held.fieldRef === choice.fieldRef && (held.item ?? -1) === (choice.item ?? -1) && held.studentValue === choice.studentValue,
    );
    if (standing === undefined) throw new Error(`a choice for ${choice.fieldRef} was neither recorded nor standing`);
    return { recorded: false, choice: standing };
  }

  /** Every choice standing for an application, in the order made. */
  public async forCase(caseId: string): Promise<readonly EntryChoice[]> {
    const found = await this.#pool.query<Row>(`SELECT ${COLUMNS} FROM entry_choices WHERE case_id = $1 ORDER BY chosen_at, choice_id`, [caseId]);
    return found.rows.map(fromRow);
  }
}
