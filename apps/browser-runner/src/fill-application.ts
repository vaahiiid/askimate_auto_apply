/**
 * Filling the application form — the plan, executed.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ADR-0046. The plan arrives as its two halves — each value's text and the
 * provenance the student's confirmation produced — and is reassembled through
 * the one mint that may produce a `ConfirmedValue`. What runs here is
 * `executePlan` from `@askimate/aas-execution`: the same function
 * `scripts/end-to-end.ts` has always run, unchanged, on a plan that is the
 * same plan the Application Plane built.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why a session is passed in rather than opened ─────────────────────────
 *
 * Because the form is behind a login. Creating the account SIGNED THE STUDENT
 * IN — the portal set a session cookie exactly as it would for a person — and
 * the context holding that cookie is the only session this run has. A fill that
 * opened its own context would arrive logged out, be redirected to the
 * registration page, and have no way back: the password was single-use and is
 * gone.
 *
 * So the caller supplies the context, and a run that has lost it gets an honest
 * refusal — `needs_the_student` — rather than a second account.
 *
 * ── What this does not do ─────────────────────────────────────────────────
 *
 * Submit. `executePlan` fills and advances; the submit control is not among
 * the things it touches, and this file does not press one either. Submission is
 * out of scope by ADR-0014 and the portal's own `submissions()` is what asserts
 * it in the tests.
 */

import type { ClaimedWork } from "@askimate/aas-contracts";
import { executePlan, failures } from "@askimate/aas-execution";
import type { ApplicationSession } from "@askimate/aas-execution";
import { rehydratePlan } from "@askimate/aas-mapping";
import type { StoredFillPlan } from "@askimate/aas-mapping";
import type { ProfileFieldKey } from "@askimate/aas-profile";

import type { PerformOutcome } from "./work-intake.js";

export interface FillApplicationDeps {
  /** Injected, so date-dependent behaviour is testable. Required, not defaulted. */
  readonly now: () => Date;
  /**
   * The signed-in session, as an `ApplicationSession`.
   *
   * The runner's `PlaywrightPreparationSession` satisfies this structurally,
   * with no adapter — which is why the port is shaped the way it is.
   */
  readonly session: ApplicationSession;
}

export async function fillApplication(
  work: ClaimedWork,
  deps: FillApplicationDeps,
): Promise<PerformOutcome> {
  const wire = work.plan;
  const formUrl = work.formUrl;
  const advance = work.advanceLocator;
  if (wire === undefined || formUrl === undefined || advance === undefined) {
    // An `execute` item with no plan is a plane that sent the wrong shape.
    // There is no sensible default for "what to type", so it is refused.
    return { kind: "failed", failure: "portal_drift" };
  }

  let target: URL;
  try {
    target = new URL(formUrl);
  } catch {
    return { kind: "failed", failure: "portal_drift" };
  }
  if (target.host !== work.portalHost) {
    // Checked here as well as in the plane, and for the same reason the fill
    // agent re-checks the live page: this is the process that will navigate.
    return { kind: "failed", failure: "portal_drift" };
  }

  try {
    await deps.session.goto(target.toString());
  } catch {
    return { kind: "failed", failure: "runner_fault" };
  }

  // ── Still signed in? ───────────────────────────────────────────────────
  //
  // The gate redirects to the registration page without a session. Asked of
  // the browser rather than assumed, because the honest answer to "we were
  // logged out" is that only the student can get us back in — the password was
  // single-use and is gone.
  const landed = await deps.session.currentUrl();
  if (new URL(landed).pathname !== target.pathname) {
    return { kind: "failed", failure: "needs_the_student" };
  }

  const report = await executePlan(
    deps.session,
    rehydratePlan(toStoredPlan(wire)),
    // No documents, and none can be asked for: `toStoredPlan` on the plane
    // refuses any plan with uploads, so `plan.uploads` is empty here and this
    // is never called. It answers `null` rather than throwing so that a change
    // which DID transport uploads fails as a named outcome rather than a crash.
    () => Promise.resolve(null),
    {
      portalHost: work.portalHost,
      // Empty for the same reason: withdrawals gate document transmission, and
      // there are no documents. A plan that carried one would fail the
      // authorisation gate rather than pass it silently.
      withdrawals: [],
      now: deps.now(),
    },
  );

  if (!report.completed) {
    const failed = failures(report);
    // `drift` is the executor's own word for "the page was not what the
    // blueprint described". Everything else is the portal declining what we
    // sent — a rule we do not model — and the two lead to different work: one
    // is a blueprint to re-review, the other is content to fix.
    return {
      kind: "failed",
      failure: failed.some((outcome) => outcome.drift) ? "portal_drift" : "portal_refused",
    };
  }
  // ── Saving the page, which is what makes any of it real ────────────────
  //
  // A portal keeps nothing until the page is saved. Stopping at the last field
  // would report success over an application the university has no record of.
  //
  // `advance_portal_page`, and consequential: it may create a draft visible to
  // admissions. The session's click guard admits exactly the controls it was
  // configured with, so this cannot become a submit however the blueprint
  // changes (ADR-0014).
  try {
    await deps.session.click({ strategy: advance.strategy, value: advance.value });
  } catch {
    // The fields are typed and the save did not land. UNCERTAIN, not failed:
    // the click may have reached the portal, and asserting that nothing
    // happened on a university's system is not this process's to assert.
    return { kind: "uncertain", failure: "runner_fault" };
  }

  return { kind: "succeeded" };
}

/**
 * The wire form, as `@askimate/aas-mapping` declares it.
 *
 * The mirror of `toWirePlan` on the plane's side: two packages that may not
 * depend on each other hold the same shape, and this is where the wire's
 * version becomes the mapping package's. `scripts/contract-drift.test.ts` takes
 * a real plan through both and requires the round trip to be lossless.
 */
function toStoredPlan(wire: NonNullable<ClaimedWork["plan"]>): StoredFillPlan {
  return {
    blueprintId: wire.blueprintId,
    blueprintVersion: wire.blueprintVersion,
    mappingSetId: wire.mappingSetId,
    instructions: wire.instructions.map((instruction) => ({
      fieldRef: instruction.fieldRef,
      label: instruction.label,
      inputType: instruction.inputType as StoredFillPlan["instructions"][number]["inputType"],
      locators: instruction.locators.map((locator) => ({
        strategy: locator.strategy,
        value: locator.value,
      })),
      value:
        instruction.value.kind === "confirmed"
          ? {
              kind: "confirmed" as const,
              fieldKey: instruction.value.fieldKey as ProfileFieldKey,
              text: instruction.value.text,
              provenance: {
                source: instruction.value.provenance.source,
                confirmedAt: new Date(instruction.value.provenance.confirmedAt),
                ...(instruction.value.provenance.sourceExcerpt === undefined
                  ? {}
                  : { sourceExcerpt: instruction.value.provenance.sourceExcerpt }),
                ...(instruction.value.provenance.documentId === undefined
                  ? {}
                  : { documentId: instruction.value.provenance.documentId }),
              },
            }
          : {
              kind: "reviewed_constant" as const,
              text: instruction.value.text,
              rationale: instruction.value.rationale,
              mappingSetId: instruction.value.mappingSetId,
              reviewedBy: instruction.value.reviewedBy,
            },
    })),
    credentials: [],
  };
}
