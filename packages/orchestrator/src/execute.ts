/**
 * Executing a fill plan against a portal.
 *
 * Deterministic: it walks the plan and does exactly what the plan says. The
 * plan was computed before a browser opened, reviewed as data, validated, and
 * authorised by the student. Nothing here decides anything about content.
 *
 * ── The port ──────────────────────────────────────────────────────────────
 *
 * `ApplicationSession` is declared here rather than imported from the browser
 * runner, so the dependency runs the right way: packages do not depend on apps.
 * The Playwright preparation session satisfies it structurally, with no adapter
 * — and a test double satisfies it just as easily, which is how this logic is
 * tested without a browser.
 *
 * ── There is no `submit` on this port ─────────────────────────────────────
 *
 * Deliberately. The orchestrator has no way to submit an application, in the
 * same way discovery has no way to fill one (ADR-0014). Submission arrives in
 * Phase 6, as a different port with a different requirement.
 */

import type { FieldLocator } from "@askimate/aas-blueprint";
import type { ConfirmedValue } from "@askimate/aas-domain";
import type { FillPlan } from "@askimate/aas-mapping";
import { textOf } from "@askimate/aas-mapping";

/** What the orchestrator needs a session to be able to do. */
export interface ApplicationSession {
  goto(url: string): Promise<void>;
  fill(locator: FieldLocator, value: ConfirmedValue<string>): Promise<void>;
  /**
   * Types a reviewed application constant — a course code, an intake term.
   *
   * Separate from `fill` on purpose. It is the one way a string reaches a form
   * field without a student's confirmation behind it, and keeping it visible
   * and separately named is the control: one call site, searchable by name,
   * covered by the mapping set's two-person review (ADR-0017).
   */
  fillConstant(locator: FieldLocator, text: string): Promise<void>;
  click(locator: FieldLocator): Promise<void>;
  attach(locator: FieldLocator, documentId: string, contents: Uint8Array): Promise<void>;
  readValue(locator: FieldLocator): Promise<string>;
  currentUrl(): Promise<string>;
}

/** Supplies a document's bytes at the moment they are needed. */
export type DocumentSource = (documentRef: string) => Promise<{
  readonly documentId: string;
  readonly contents: Uint8Array;
} | null>;

/** What happened to one instruction. */
export type ExecutionOutcome =
  | { readonly kind: "filled"; readonly fieldRef: string; readonly stored: string }
  | { readonly kind: "attached"; readonly fieldRef: string; readonly documentId: string }
  | {
      readonly kind: "failed";
      readonly fieldRef: string;
      readonly error: string;
      /**
       * Whether this is drift — the page not matching the blueprint.
       *
       * Distinguished because the response differs: drift means the blueprint
       * needs rediscovery, and any other failure means something went wrong
       * with this particular run (brief §3.2).
       */
      readonly drift: boolean;
    };

export interface ExecutionReport {
  readonly outcomes: readonly ExecutionOutcome[];
  /** Fields the plan reserves for the student. Not filled, by design. */
  readonly handoffs: readonly { readonly fieldRef: string; readonly reason: string }[];
  readonly completed: boolean;
}

/**
 * Runs the plan.
 *
 * Stops at the first failure rather than pressing on. A half-filled application
 * whose second page was filled against a page the blueprint did not describe is
 * worse than one that stopped and said so — and the recovery design (ADR-0008)
 * depends on stopping AT the failure point so a specialist can resume from it.
 */
export async function executePlan(
  session: ApplicationSession,
  plan: FillPlan,
  documents: DocumentSource,
): Promise<ExecutionReport> {
  const outcomes: ExecutionOutcome[] = [];

  for (const instruction of plan.instructions) {
    const locator = instruction.locators[0];
    if (locator === undefined) {
      outcomes.push({
        kind: "failed",
        fieldRef: instruction.fieldRef,
        error: "The blueprint records no locator for this field.",
        drift: true,
      });
      return report(outcomes, plan, false);
    }

    try {
      if (instruction.value.kind === "confirmed") {
        await session.fill(locator, instruction.value.value);
      } else {
        // A reviewed constant is not the student's data and does not go through
        // the confirmed path. The two stay distinguishable all the way to the
        // keyboard — no fabricated provenance, at any point.
        await session.fillConstant(locator, textOf(instruction.value));
      }
      outcomes.push({
        kind: "filled",
        fieldRef: instruction.fieldRef,
        stored: await session.readValue(locator),
      });
    } catch (error) {
      outcomes.push({
        kind: "failed",
        fieldRef: instruction.fieldRef,
        error: error instanceof Error ? error.message : String(error),
        drift: isDrift(error),
      });
      return report(outcomes, plan, false);
    }
  }

  for (const upload of plan.uploads) {
    const locator = upload.locators[0];
    const document = await documents(upload.documentRef);

    if (locator === undefined || document === null) {
      outcomes.push({
        kind: "failed",
        fieldRef: upload.fieldRef,
        error:
          locator === undefined
            ? "The blueprint records no locator for this upload."
            : `No document was supplied for "${upload.documentRef}".`,
        drift: locator === undefined,
      });
      return report(outcomes, plan, false);
    }

    try {
      await session.attach(locator, document.documentId, document.contents);
      outcomes.push({
        kind: "attached",
        fieldRef: upload.fieldRef,
        documentId: document.documentId,
      });
    } catch (error) {
      outcomes.push({
        kind: "failed",
        fieldRef: upload.fieldRef,
        error: error instanceof Error ? error.message : String(error),
        drift: isDrift(error),
      });
      return report(outcomes, plan, false);
    }
  }

  return report(outcomes, plan, true);
}

function isDrift(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  return name === "LocatorNotFoundError" || name === "OptionNotAvailableError";
}

function report(
  outcomes: readonly ExecutionOutcome[],
  plan: FillPlan,
  completed: boolean,
): ExecutionReport {
  return {
    outcomes,
    handoffs: plan.handoffs.map((handoff) => ({
      fieldRef: handoff.fieldRef,
      reason: handoff.reason,
    })),
    completed,
  };
}

/** Whether anything failed. */
export function failures(report: ExecutionReport): readonly Extract<
  ExecutionOutcome,
  { kind: "failed" }
>[] {
  return report.outcomes.filter(
    (outcome): outcome is Extract<ExecutionOutcome, { kind: "failed" }> =>
      outcome.kind === "failed",
  );
}
