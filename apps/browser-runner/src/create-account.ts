/**
 * Creating the student's portal account — the first consequential action this
 * system performs on somebody else's website.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ADR-0020: the account belongs to the STUDENT. This creates it with their
 * email, with a password only they have ever seen, and hands nothing to us —
 * AskiMate never learns the credential and never becomes able to.
 *
 * ADR-0042: the password is typed by the Secure Plane's fill agent, over CDP,
 * into this process's browser. This process asks for that and is told whether
 * it worked. It holds no vault, has no KMS grant, and has no certificate that
 * could resolve the handle it is holding.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── The order, and why every step is where it is ──────────────────────────
 *
 *   1. The context is SENSITIVE before anything is typed. Tracing is made
 *      unavailable rather than left off, because Playwright writes typed values
 *      verbatim into `trace.trace` and stopping tracing around the fill does
 *      not prevent it (ADR-0025, measured).
 *   2. The URL is checked against the host the work was bound to, here as well
 *      as in the plane. A registration URL somewhere else would be an
 *      instruction to create an account on a host nobody authorised.
 *   3. The email goes in first — ordinary text, typed by this process.
 *   4. The password goes in via the fill agent, one handle for every box.
 *   5. Only then is the form submitted.
 *
 * Step 4 before step 5 is the whole shape: submitting first would create an
 * account with no password, and asking for the password after submitting would
 * be asking for a box that is no longer on the page.
 *
 * ── What this returns, and what it cannot ─────────────────────────────────
 *
 * A `PerformOutcome` — three words and a closed-set reason. There is no field
 * on it that could carry a portal's error text, and that is deliberate: a
 * portal renders whatever it likes, and this is the boundary between a site we
 * do not control and a plane that keeps durable records.
 */

import type { FieldLocator } from "@askimate/aas-blueprint";
import { toPlaywrightLocator } from "@askimate/aas-browser-fill";
import type { ClaimedWork } from "@askimate/aas-contracts";
import type { Browser, BrowserContext, Page } from "playwright";

import { fillSecret } from "./secret-fill.js";
import { openSensitiveContext } from "./sensitive.js";
import type { PerformOutcome } from "./work-intake.js";

/** How long to wait for a page or a control. Portals are slow; students wait. */
const STEP_TIMEOUT_MS = 15_000;

export interface CreateAccountDeps {
  /** The runner's own browser. Its CDP endpoint is reachable by the fill agent alone. */
  readonly browser: Browser;
  /** This browser's CDP endpoint, as the fill agent will dial it. */
  readonly browserEndpoint: string;
  /** The Secure Plane fill agent's internal base URL, on the private subnet. */
  readonly agentBaseUrl: string;
  readonly serviceToken?: string;
  readonly userAgent?: string;
  readonly fetch?: typeof globalThis.fetch;
  /**
   * A context to work in, kept open afterwards.
   *
   * ═════════════════════════════════════════════════════════════════════
   * Creating the account SIGNS THE STUDENT IN — the portal sets a session
   * cookie, exactly as it would for a person — and the application form is
   * unreachable without it. So a runner that goes on to fill the form needs
   * the context that holds that cookie, and closing it here would throw away
   * the only session the run has.
   * ═════════════════════════════════════════════════════════════════════
   *
   * Absent, a context is opened and closed here, which is right for a runner
   * that only creates the account. Supplied, it is the CALLER's to close — and
   * it must be a sensitive one; `fillSecret` refuses anything else, loudly.
   */
  readonly context?: BrowserContext;
}

/**
 * Does the work, and says how it went.
 *
 * Never throws for an ordinary failure — a portal that refuses, a selector that
 * has drifted, a handle that is gone are all outcomes rather than exceptions.
 * A thrown error would carry a page's text into whatever catches it, and the
 * outcome type has nowhere to put that on purpose.
 */
export async function createPortalAccount(
  work: ClaimedWork,
  deps: CreateAccountDeps,
): Promise<PerformOutcome> {
  if (work.secretHandle === undefined) {
    // The step exists because the portal needs a password and the student has
    // typed one. Without a handle there is nothing to type, and creating the
    // account anyway would leave an account nobody can sign in to.
    return { kind: "failed", failure: "secret_unavailable" };
  }

  const targets = work.registration;
  if (targets === undefined) {
    // An account-creation item with no registration targets is a plane that
    // sent the wrong shape. Refused rather than guessed at: there is no
    // sensible default for "which box is the password".
    return { kind: "failed", failure: "portal_drift" };
  }

  // ── 2. The form must be on the host this work was bound to ─────────────
  //
  // Checked here as well as in the plane, and for the same reason the fill
  // agent re-checks the live page: this is the process that will actually
  // navigate, so this is where the check is about the thing that happens.
  let target: URL;
  try {
    target = new URL(targets.url);
  } catch {
    return { kind: "failed", failure: "portal_drift" };
  }
  if (target.host !== work.portalHost) {
    return { kind: "failed", failure: "portal_drift" };
  }

  // ── 1. Sensitive before anything is typed ──────────────────────────────
  const supplied = deps.context;
  const context =
    supplied ??
    (await openSensitiveContext(deps.browser, {
      userAgent: deps.userAgent ?? "AskiMate-Runner/1.0",
    }));
  try {
    const page = await context.newPage();
    try {
      await page.goto(target.toString(), { timeout: STEP_TIMEOUT_MS });
    } catch {
      return { kind: "failed", failure: "runner_fault" };
    }

    // ── 3. The email. Ordinary text, and this process types it ────────────
    const email = await resolve(page, targets.emailLocator);
    if (email === null) return { kind: "failed", failure: "portal_drift" };
    try {
      await email.fill(work.email, { timeout: STEP_TIMEOUT_MS });
    } catch {
      return { kind: "failed", failure: "portal_drift" };
    }

    // ── 4. The password. ONE handle, EVERY box, and not by this process ───
    const filled = await fillSecret({
      page,
      claim: {
        handle: work.secretHandle,
        studentRef: work.studentRef,
        caseRef: work.caseId,
        purpose: "portal_account_creation",
        targetHost: work.portalHost,
      },
      locators: targets.passwordLocators.map(
        (locator): FieldLocator => ({ strategy: locator.strategy, value: locator.value }),
      ),
      agentBaseUrl: deps.agentBaseUrl,
      browserEndpoint: deps.browserEndpoint,
      ...(deps.serviceToken === undefined ? {} : { serviceToken: deps.serviceToken }),
      ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
    });
    if (!filled.ok) {
      // ── The one distinction worth making here ──────────────────────────
      //
      // A refusal that did NOT spend the handle is a fix-and-retry: the
      // student's password is still live, and a corrected blueprint spends it
      // with no new prompt. One that spent it means asking again. Both are
      // failures of THIS attempt; only the plane can act on the difference, so
      // the reason it is told names which happened.
      return {
        kind: "failed",
        failure: filled.reason === "no_such_field" ? "portal_drift" : "secret_unavailable",
      };
    }

    // ── 5. Submit, and only now ────────────────────────────────────────────
    const submit = await resolve(page, targets.submitLocator);
    if (submit === null) return { kind: "failed", failure: "portal_drift" };
    try {
      await Promise.all([
        page.waitForLoadState("load", { timeout: STEP_TIMEOUT_MS }),
        submit.click({ timeout: STEP_TIMEOUT_MS }),
      ]);
    } catch {
      // ═══════════════════════════════════════════════════════════════════
      // UNCERTAIN, not failed. The click may have reached the portal and the
      // account may exist; this process simply stopped being able to tell. A
      // `failed` here would assert that nothing happened on a university's
      // system, which is a claim about somebody else's database that nobody in
      // this process is entitled to make (ADR-0008).
      // ═══════════════════════════════════════════════════════════════════
      return { kind: "uncertain", failure: "runner_fault" };
    }

    // ── Did it work? Asked of the PAGE, not assumed from the click ────────
    //
    // A portal that refused re-renders the form; a portal that accepted moves
    // on. So "are we still looking at the registration page?" is the question,
    // and it is answered by where the browser actually is.
    const landed = new URL(page.url());
    if (landed.pathname === target.pathname) {
      // Still on the form. The portal rejected something — a duplicate email, a
      // rule we do not model. Which one it was is in text this plane must not
      // carry, so the distinction that IS made is the one that changes what
      // happens next.
      return { kind: "failed", failure: "portal_refused" };
    }
    return { kind: "succeeded" };
  } finally {
    // The context, not the browser — the browser belongs to the runner and may
    // be doing other work. And only a context opened HERE: a supplied one holds
    // the session the caller is about to fill a form with.
    if (supplied === undefined) await context.close().catch(() => undefined);
  }
}

/** A locator that exists on the page right now, or `null`. */
async function resolve(page: Page, locator: FieldLocator): Promise<ReturnType<Page["locator"]> | null> {
  const found = toPlaywrightLocator(page, locator);
  if (found === null) return null;
  try {
    await found.waitFor({ state: "attached", timeout: STEP_TIMEOUT_MS });
  } catch {
    return null;
  }
  return found;
}
