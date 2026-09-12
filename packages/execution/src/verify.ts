/**
 * A page is saved when the portal shows it, not when a control was pressed
 * (ADR-0106).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-09-12, on the real portal: a qualification saved with two of
 * its radios unanswered drew no error, no complaint, and a summary page
 * listing one entry — the save was pressed and nothing was recorded. An error
 * locator would have found nothing and passed; a landing URL would have
 * matched and passed. His shape, verbatim: *"a page is not reported saved
 * because a control was pressed. It is reported saved when the portal shows
 * the thing exists. Where a blueprint can name how to see that, name it.
 * Where it cannot, the honest report is uncertain, not succeeded."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Three ways of seeing, and what each costs is in the decision sheet:
 *
 *   a page filled once   → reopened, and every filled value read back. The
 *                          comparison is on the redacted shape the executor
 *                          recorded at the fill (length and digest), so a
 *                          value the portal changed reads as not kept, and
 *                          no value is held here in the clear.
 *   a page filled per    → its listing counted before and after the save:
 *   item                   one more entry is the save. The new-entry form
 *                          reopens empty by design and cannot be read back.
 *   a slot attached to   → the marker the blueprint names for a held file,
 *                          present on the reopened page. A file input reads
 *                          back empty by HTML's rule; without a marker the
 *                          slot cannot be seen.
 *
 * Anything not seen makes the page `uncertain` — never `failed`, because the
 * press went through and the portal may hold part of it — and the caller
 * records no transmission for it.
 */

import type { FieldLocator } from "@askimate/aas-blueprint";
import { redact, sameRedacted } from "@askimate/aas-domain";
import type { FillPlan } from "@askimate/aas-mapping";

import type { ApplicationSession, ExecutionReport } from "./execute.js";

/** A repeating page's listing, and how many entries it held before the save. */
export interface RecordedListing {
  readonly url: string;
  readonly entryLocator: FieldLocator;
  readonly before: number;
}

export type RecordedCheck =
  | { readonly recorded: true }
  /** Which field references were not seen; a repeating page's listing reads as `entries`. */
  | { readonly recorded: false; readonly unseen: readonly string[] };

/** Counts a listing's entries; the number a later `verifyRecorded` compares against. */
export async function countRecorded(session: ApplicationSession, listing: { readonly url: string; readonly entryLocator: FieldLocator }): Promise<number> {
  await session.goto(listing.url);
  return await session.count(listing.entryLocator);
}

export async function verifyRecorded(
  session: ApplicationSession,
  input: {
    readonly plan: FillPlan;
    readonly report: ExecutionReport;
    readonly formUrl: string;
    /** The page is filled once per item: only its listing can show the item. */
    readonly repeating: boolean;
    readonly listing?: RecordedListing;
  },
): Promise<RecordedCheck> {
  if (input.listing !== undefined) {
    let after: number;
    try {
      after = await countRecorded(session, input.listing);
    } catch {
      return { recorded: false, unseen: ["entries"] };
    }
    return after === input.listing.before + 1 ? { recorded: true } : { recorded: false, unseen: ["entries"] };
  }
  if (input.repeating) {
    // Nothing names the listing: the new-entry form opens empty by design, so
    // there is nothing on the page that could show this item exists.
    return { recorded: false, unseen: ["entries"] };
  }

  try {
    await session.goto(input.formUrl);
  } catch {
    return { recorded: false, unseen: input.report.outcomes.map((outcome) => outcome.fieldRef) };
  }
  const unseen: string[] = [];
  for (const outcome of input.report.outcomes) {
    if (outcome.kind === "filled") {
      const locator = locatorFor(input.plan, outcome.fieldRef);
      if (locator === null) {
        unseen.push(outcome.fieldRef);
        continue;
      }
      let held: string;
      try {
        held = await session.readValue(locator);
      } catch {
        unseen.push(outcome.fieldRef);
        continue;
      }
      if (!sameRedacted(redact(held), outcome.stored)) unseen.push(outcome.fieldRef);
    } else if (outcome.kind === "attached") {
      const marker = input.plan.uploads.find((upload) => upload.fieldRef === outcome.fieldRef)?.recorded;
      if (marker === undefined) {
        unseen.push(outcome.fieldRef);
        continue;
      }
      let shown: number;
      try {
        shown = await session.count(marker);
      } catch {
        shown = 0;
      }
      if (shown === 0) unseen.push(outcome.fieldRef);
    }
  }
  return unseen.length === 0 ? { recorded: true } : { recorded: false, unseen };
}

/** The locator a filled field was filled through: an instruction's, or a slot companion's. */
function locatorFor(plan: FillPlan, fieldRef: string): FieldLocator | null {
  const instruction = plan.instructions.find((candidate) => candidate.fieldRef === fieldRef);
  if (instruction !== undefined) return instruction.locators[0] ?? null;
  const companion = plan.uploads.find((upload) => upload.companion?.fieldRef === fieldRef)?.companion;
  return companion?.locators[0] ?? null;
}
