/**
 * What a deployed runner does with a unit of work — the one performer
 * `main.ts` runs and the journey drives.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ADR-0101 §2 (P71, slice d). Until now the entry point performed
 * `create_account` and answered `needs_the_student` to everything else; the
 * form was filled by the journey test and by nothing a deployable runs
 * (blocker 19). This performs both kinds, in one sitting:
 *
 *   create_account   in a context the `SessionHold` keeps for the run, so the
 *                    session the portal set at registration survives to the
 *                    next item
 *   sign_in          the resume path (§3, P72): into a fresh held context,
 *                    with the password the student typed a second time
 *   execute          in that same context, page by page, with the plane's
 *                    document source (ADR-0099) and the challenge probe
 *                    (ADR-0101 §6) — the whole fill, then the handover
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Exported as a function over its dependencies rather than living inside
 * `start`, so the journey runs exactly this against a real portal rather than
 * a performer of its own that would prove a different thing.
 */

import type { Browser } from "playwright";

import type { LawfulBasisRegister } from "@askimate/aas-disclosure";

import { createPortalAccount } from "./create-account.js";
import { documentSourceFor } from "./document-source.js";
import { fillApplication } from "./fill-application.js";
import { signInToPortal } from "./sign-in.js";
import { PlaywrightPreparationSession } from "./playwright-fill-session.js";
import type { SessionHold } from "./session-hold.js";
import { SESSION_ENDING_FAILURES } from "@askimate/aas-contracts";

import type { PerformOutcome, WorkIntake, WorkPerformer } from "./work-intake.js";

export interface RunnerPerformerDeps {
  readonly browser: Browser;
  /** The CDP endpoint the fill agent reaches this runner's browser on. */
  readonly browserEndpoint: string;
  readonly agentBaseUrl: string;
  readonly agentServiceToken?: string;
  /** The same intake the supervisor claims through: documents are asked for under the lease. */
  readonly intake: Pick<WorkIntake, "document">;
  readonly hold: SessionHold;
  readonly register: LawfulBasisRegister;
  readonly now: () => Date;
  readonly fetch?: typeof globalThis.fetch;
}

/**
 * The failures after which the run's session is let go — the contract's list,
 * so the plane records the session lost on exactly the reports this releases
 * it (ADR-0101 §3). Every other failure keeps it: a refused page may be
 * offered to this runner again, signed in.
 */
const RELEASES_THE_SESSION = new Set<string>(SESSION_ENDING_FAILURES);

export function runnerPerformer(deps: RunnerPerformerDeps): WorkPerformer {
  return async (work): Promise<PerformOutcome> => {
    if (work.kind === "create_account") {
      const context = await deps.hold.open(work.runId);
      const outcome = await createPortalAccount(work, {
        browser: deps.browser,
        browserEndpoint: deps.browserEndpoint,
        agentBaseUrl: deps.agentBaseUrl,
        ...(deps.agentServiceToken === undefined ? {} : { serviceToken: deps.agentServiceToken }),
        ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
        // Kept open afterwards: the cookie it is about to hold is the run's
        // only session, and the fill needs it.
        context,
      });
      // A creation that did not succeed holds no session worth keeping — and
      // a creation met by a second factor holds one the plane has stopped on.
      if (outcome.kind !== "succeeded") await deps.hold.release(work.runId);
      return outcome;
    }

    if (work.kind === "sign_in") {
      // The resume path (ADR-0101 §3). Into a context held for the run from
      // this moment — `open` closes nothing, and a stale context for the same
      // run cannot be here, because the plane offers a sign-in only once no
      // session can exist. Kept open on success: it IS the session now.
      const context = await deps.hold.open(work.runId);
      const outcome = await signInToPortal(work, {
        browser: deps.browser,
        browserEndpoint: deps.browserEndpoint,
        agentBaseUrl: deps.agentBaseUrl,
        ...(deps.agentServiceToken === undefined ? {} : { serviceToken: deps.agentServiceToken }),
        ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
        context,
      });
      if (outcome.kind !== "succeeded") await deps.hold.release(work.runId);
      return outcome;
    }

    // `execute`. The plane hands a fill only to a runner that declared the
    // run's session (ADR-0101 §2), so a hold is expected here; one that
    // idled out between the claim and this moment is the one case it is not,
    // and the honest answer is the one the resume path acts on.
    const page = await deps.hold.pageFor(work.runId);
    if (page === null) return { kind: "failed", failure: "needs_the_student" };

    const advance = work.advanceLocator;
    const session = PlaywrightPreparationSession.attach(page, {
      capability: "fillable",
      runId: work.runId,
      allowedHosts: [hostnameOf(work.portalHost)],
      // EXACTLY the control the plane sent, and nothing else: the submit
      // button is unreachable however the blueprint changes (ADR-0014).
      // ...plus the control that opens a fresh entry on a page filled once
      // per item (ADR-0103, gap 3), which is also the plane's to send.
      clickableControls: [
        ...(advance === undefined ? [] : [advance]),
        ...(work.repeat?.addAnother === undefined ? [] : [work.repeat.addAnother]),
      ],
    });
    const outcome = await fillApplication(work, {
      now: deps.now,
      session,
      challenge: () => session.challenge(),
      documents: documentSourceFor({
        intake: deps.intake,
        work,
        register: deps.register,
        ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
      }),
    });
    if (outcome.kind !== "succeeded" && RELEASES_THE_SESSION.has(outcome.failure)) {
      await deps.hold.release(work.runId);
    }
    return outcome;
  };
}

/** `host:port` → `host`. The allow-list is by hostname; the bound host carries the port. */
function hostnameOf(portalHost: string): string {
  return portalHost.split(":")[0] ?? portalHost;
}
