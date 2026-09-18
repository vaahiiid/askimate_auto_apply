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
import type { ClaimedWork } from "@askimate/aas-contracts";
import { fillApplication } from "./fill-application.js";
import { atPointInWords } from "./point-of-control.js";
import type { RobotsGate } from "./robots-gate.js";
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
  /**
   * The portal's robots.txt, read before the browser opens for each unit of
   * work and obeyed (P135, ADR-0091 on the fill path). Required, not
   * defaulted: a performer that silently had no gate would navigate unread.
   */
  readonly robots: RobotsGate;
  /**
   * Where a unit of work says what it is doing (ADR-0124, P157). Optional, so
   * a test builds deps without one; the production runner always passes it.
   * Everything written has been through `runner-log`'s vocabulary.
   */
  readonly log?: (line: string) => void;
}

/**
 * Every URL a unit of work will open, for the gate to decide before the
 * browser does. The account paths open one page; a fill opens the form and,
 * on a repeating page, the listing it is counted on (ADR-0106).
 */
export function urlsOpenedBy(work: ClaimedWork): readonly string[] {
  if (work.kind === "create_account") return work.registration === undefined ? [] : [work.registration.url];
  if (work.kind === "sign_in") return work.login === undefined ? [] : [work.login.url];
  return [
    ...(work.formUrl === undefined ? [] : [work.formUrl]),
    ...(work.repeat?.recorded === undefined ? [] : [work.repeat.recorded.url]),
  ];
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
    // ── robots.txt, before anything opens (P135) ─────────────────────────
    const verdict = await deps.robots.check(urlsOpenedBy(work));
    if (!verdict.allowed) return { kind: "failed", failure: "robots_disallows" };

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
        // ADR-0124: the attempt says what it is doing, before and after.
        ...(deps.log === undefined ? {} : { log: deps.log }),
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
      // The file the gate read, checked again at every navigation, and the
      // floor it hands back — the site's Crawl-delay or one second, whichever
      // is longer, and nothing lower (ADR-0091).
      robots: (url) => verdict.set.decide(url),
      pace: { minimumMs: verdict.delayMs },
      // EXACTLY the control the plane sent, and nothing else: the submit
      // button is unreachable however the blueprint changes (ADR-0014).
      // ...plus the control that opens a fresh entry on a page filled once
      // per item (ADR-0103, gap 3), which is also the plane's to send.
      clickableControls: [
        ...(advance === undefined ? [] : [advance]),
        ...(work.repeat?.addAnother === undefined ? [] : [work.repeat.addAnother]),
        // ...and each control the plan presses to load a list's options
        // (ADR-0105) — sent by the plane, refused by name if it reads as a
        // submission, and checked after the press not to have left the page.
        ...(work.plan?.instructions ?? []).flatMap((instruction) =>
          instruction.optionsAfter?.press === undefined ? [] : [instruction.optionsAfter.press],
        ),
      ],
    });
    const outcome = await fillApplication(work, {
      now: deps.now,
      session,
      challenge: () => session.challenge(),
      // ADR-0124, applied to the fill (P163): what the page fill is doing,
      // and what stood at the Save button's point when a press fails.
      ...(deps.log === undefined ? {} : { log: deps.log }),
      atPoint: (locator) => atPointInWords(page, locator),
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
