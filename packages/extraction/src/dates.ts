/**
 * Turning extracted dates into the validity engine's input.
 *
 * ── Why this is not just a cast ───────────────────────────────────────────
 *
 * The validity engine is deterministic arithmetic (brief §2.4) and is trusted
 * accordingly. But arithmetic on a wrong date gives a confident wrong answer,
 * and the dates come out of a document via a model. "Is this bank statement
 * inside the 31-day window?" is only as good as "what date does the statement
 * close on?".
 *
 * So the sanctioned path from extraction to the validity engine takes
 * `ConfirmedValue<Date>` — dates the student has seen and agreed to — not
 * proposals. An unconfirmed statement date can be held on the record, but it
 * cannot be what a reuse decision rests on.
 *
 * This is a sanctioned path rather than a wall: `DocumentDates` is a plain
 * interface, so nothing stops another package building one by hand. What it
 * does is make the correct route obvious and the incorrect one deliberate.
 * The vault closes the loop on its side — `isReusable` requires a `confirmed`
 * or `verified` document, so an unconfirmed one is never offered for reuse
 * whatever its dates say.
 */

import type { ConfirmedValue } from "@askimate/aas-domain";
import { unwrapConfirmed } from "@askimate/aas-domain";
import type { DocumentDates } from "@askimate/aas-documents";

export interface ConfirmedDocumentDates {
  readonly issuedAt?: ConfirmedValue<Date>;
  readonly expiresAt?: ConfirmedValue<Date>;
  readonly coversFrom?: ConfirmedValue<Date>;
  readonly coversTo?: ConfirmedValue<Date>;
}

/** Builds the validity engine's input from confirmed dates only. */
export function documentDatesFrom(confirmed: ConfirmedDocumentDates): DocumentDates {
  return {
    ...(confirmed.issuedAt !== undefined ? { issuedAt: unwrapConfirmed(confirmed.issuedAt) } : {}),
    ...(confirmed.expiresAt !== undefined
      ? { expiresAt: unwrapConfirmed(confirmed.expiresAt) }
      : {}),
    ...(confirmed.coversFrom !== undefined
      ? { coversFrom: unwrapConfirmed(confirmed.coversFrom) }
      : {}),
    ...(confirmed.coversTo !== undefined ? { coversTo: unwrapConfirmed(confirmed.coversTo) } : {}),
  };
}

/** No dates known. Explicit, so "we did not read any" is never mistaken for "there are none". */
export const NO_DATES: DocumentDates = {};
