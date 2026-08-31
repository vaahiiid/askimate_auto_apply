/**
 * How the Automation Runner learns there is something to do.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ADR-0045. The runner PULLS. It claims a unit of work from the Application
 * Plane over the internal API, does it, and reports how it ended.
 *
 * Nothing calls into this process. ADR-0037 gives it exactly one inbound port —
 * a CDP endpoint reachable by the fill agent alone — and an HTTP control API
 * would be a second inbound surface on the component that loads pages we do not
 * control and is the most likely thing in this system to be compromised.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── What this file is not ─────────────────────────────────────────────────
 *
 * It is not a decision-maker. It does not choose what work to do, in what
 * order, or what a run should do next: it asks, and the Application Plane
 * answers from the orchestrator. The one judgement made here is *how did the
 * thing I was told to do turn out*, which is the only question this process is
 * in a position to answer at all.
 *
 * It is also not a queue consumer. There is no queue — the run's own durable
 * position says what work exists, and a claim is a lease over one run.
 *
 * ── Why the performer is a port ───────────────────────────────────────────
 *
 * Because "open a browser and create an account on a university portal" is a
 * capability, and a loop that both scheduled work and performed it could not be
 * tested without one. The loop is proved here against a performer that records
 * what it was asked; the real performer opens Chromium.
 */

import type { ClaimedWork, WorkFailure, WorkReport } from "@askimate/aas-contracts";
import { parseClaimedWork } from "@askimate/aas-contracts";

/** What the runner does with a unit of work once it has one. */
export type WorkPerformer = (work: ClaimedWork) => Promise<PerformOutcome>;

/**
 * How it went, in the runner's own words before they become a report.
 *
 * `uncertain` is separate from `failed` and the distinction is the runner's to
 * make, because nobody else is in a position to: only the process that was
 * driving the browser knows whether it saw the portal accept. A run reported
 * `failed` claims nothing happened out there; `uncertain` claims nothing at all,
 * and leaves the Application Plane's uncertainty window open (ADR-0008).
 */
export type PerformOutcome =
  | { readonly kind: "succeeded" }
  | { readonly kind: "failed"; readonly failure: WorkFailure }
  | { readonly kind: "uncertain"; readonly failure: WorkFailure };

export interface WorkIntakeOptions {
  /** The Application Plane's internal base URL, on the private subnet. */
  readonly baseUrl: string;
  /** Which runner this is. For an operator reading the lease table; never a credential. */
  readonly holder: string;
  /** mTLS in production; a header here, exactly as `fillSecret`'s client. */
  readonly serviceToken?: string;
  readonly leaseSeconds?: number;
  readonly fetch?: typeof globalThis.fetch;
}

/** The two calls the runner makes. A PORT, so the loop can be tested without a network. */
export interface WorkIntake {
  claim(): Promise<ClaimedWork | null>;
  /** `true` when the plane accepted the report; `false` when this lease is no longer held. */
  report(runId: string, report: WorkReport): Promise<boolean>;
}

export function httpWorkIntake(options: WorkIntakeOptions): WorkIntake {
  const doFetch = options.fetch ?? globalThis.fetch;
  const headers = {
    "content-type": "application/json",
    ...(options.serviceToken === undefined ? {} : { "x-service-cert": options.serviceToken }),
  };

  return {
    claim: async (): Promise<ClaimedWork | null> => {
      let response: Response;
      try {
        response = await doFetch(`${options.baseUrl}/internal/v1/work/claims`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            holder: options.holder,
            leaseSeconds: options.leaseSeconds ?? 120,
          }),
        });
      } catch {
        // A quiet `null`, not a throw. An unreachable plane is an ordinary
        // thing for a poll to find — it means "no work this time round", and a
        // thrown error here would take down a loop that should simply wait.
        return null;
      }
      // 204 is the ordinary answer: a successful poll that found nothing.
      if (response.status === 204) return null;
      if (response.status !== 200) return null;
      const body: unknown = await response.json();
      // Rebuilt field by field by the contract's own parser rather than cast,
      // so a plane answering with a field this app should never receive has
      // nowhere to put it.
      return parseClaimedWork(body);
    },

    report: async (runId: string, report: WorkReport): Promise<boolean> => {
      let response: Response;
      try {
        response = await doFetch(
          `${options.baseUrl}/internal/v1/work/${encodeURIComponent(runId)}/report`,
          { method: "POST", headers, body: JSON.stringify(report) },
        );
      } catch {
        return false;
      }
      return response.status === 204;
    },
  };
}

/**
 * One turn of the loop: claim at most one unit of work, do it, report it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ONE unit, deliberately. A runner that claimed a batch would hold leases on
 * work it had not started, and every one of those runs would be stranded for
 * the lease duration if this process died — which is the failure the lease
 * exists to bound, made worse by the thing meant to bound it.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Returns what happened, so a caller can decide how long to wait before the
 * next turn. It never throws: a performer that throws is reported as
 * `uncertain` with `runner_fault`, because a thrown error means this process
 * does not know what the browser managed to do before it stopped — and silently
 * dropping the work would leave the lease to expire with no record that anybody
 * tried.
 */
export type TurnResult =
  | { readonly kind: "idle" }
  | { readonly kind: "worked"; readonly runId: string; readonly report: WorkReport }
  /** The work was done but the plane would not accept the report. */
  | { readonly kind: "report_refused"; readonly runId: string };

export async function runOneTurn(
  intake: WorkIntake,
  perform: WorkPerformer,
): Promise<TurnResult> {
  const work = await intake.claim();
  if (work === null) return { kind: "idle" };

  let outcome: PerformOutcome;
  try {
    outcome = await perform(work);
  } catch {
    // The error object is deliberately not read. A thrown error from a browser
    // session can carry a page's text, a URL with a token in it, or a whole
    // request body — and the report has no field it could go in anyway.
    outcome = { kind: "uncertain", failure: "runner_fault" };
  }

  const report: WorkReport =
    outcome.kind === "succeeded"
      ? { leaseId: work.leaseId, outcome: "succeeded" }
      : { leaseId: work.leaseId, outcome: outcome.kind, failure: outcome.failure };

  const accepted = await intake.report(work.runId, report);
  return accepted
    ? { kind: "worked", runId: work.runId, report }
    : { kind: "report_refused", runId: work.runId };
}
