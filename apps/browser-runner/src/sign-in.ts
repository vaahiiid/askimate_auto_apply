/**
 * Signing back in to the student's portal account — the resume path
 * (ADR-0101 §3, P72).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * The one condition under which a student is asked for their password a
 * second time: the runner's signed-in session for the run is gone — a crash,
 * the five-minute ceiling, a portal that signed the runner out — and the
 * application is not yet filled. They typed it once more into the secure
 * control, saying why was the run's job (`describeSignInResume`), and this
 * spends the handle on the login form. Single use; then it is gone.
 *
 * ADR-0042 as for the creation: the password is typed by the Secure Plane's
 * fill agent, over CDP, into this process's browser. This process holds no
 * vault, no KMS grant and no certificate that could resolve the handle.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── The order, and why ────────────────────────────────────────────────────
 *
 *   1. The context is SENSITIVE before anything is typed (ADR-0025), and it
 *      is the caller's — the `SessionHold`'s — so the session the portal
 *      sets survives to the next item, which is the whole point.
 *   2. The URL is checked against the bound host, here as well as in the
 *      plane: this is the process that navigates.
 *   3. The page is read for a challenge BEFORE the email is typed and before
 *      the Secure Plane is asked to spend the handle (ADR-0101 §6). A CAPTCHA
 *      on the login form costs nothing here: no password spent.
 *   4. The email, typed by this process. The password, via the fill agent,
 *      into ONE box — a login asks once.
 *   5. Submit, and ask the PAGE whether it worked: a portal that refused
 *      re-renders the login form; one that accepted moves on. A page that
 *      then asks for a code is a second factor at sign-in: stop, and say so.
 *
 * ── What this returns ─────────────────────────────────────────────────────
 *
 * A `PerformOutcome` and nothing a portal wrote. `portal_refused` is the
 * wrong password, as the portal sees it; the plane asks again, because that
 * is what a portal would do too.
 */

import type { FieldLocator } from "@askimate/aas-blueprint";
import { toPlaywrightLocator } from "@askimate/aas-browser-fill";
import type { ClaimedWork } from "@askimate/aas-contracts";
import type { Browser, BrowserContext, Page } from "playwright";

import { fillSecret } from "./secret-fill.js";
import { challengeFailure, detectChallenge } from "./challenge.js";
import { openSensitiveContext } from "./sensitive.js";
import type { PerformOutcome } from "./work-intake.js";

/** How long to wait for a page or a control. Portals are slow; students wait. */
const STEP_TIMEOUT_MS = 15_000;

export interface SignInDeps {
  readonly browser: Browser;
  /** This browser's CDP endpoint, as the fill agent will dial it. */
  readonly browserEndpoint: string;
  /** The Secure Plane fill agent's internal base URL, on the private subnet. */
  readonly agentBaseUrl: string;
  readonly serviceToken?: string;
  readonly userAgent?: string;
  readonly fetch?: typeof globalThis.fetch;
  /**
   * The context to sign in — the run's held one, kept open afterwards, so
   * the cookie the portal sets is the session the next page item fills in
   * (ADR-0101 §2). Absent, one is opened and closed here, which signs in for
   * nothing but a test of this function alone.
   */
  readonly context?: BrowserContext;
}

/**
 * Does the sign-in, and says how it went. Never throws for an ordinary
 * failure, for the reason `createPortalAccount` does not.
 */
export async function signInToPortal(work: ClaimedWork, deps: SignInDeps): Promise<PerformOutcome> {
  if (work.secretHandle === undefined) {
    // The step exists because the student typed the password again. Without
    // a handle there is nothing to type, and a sign-in with no password is
    // not a thing to attempt.
    return { kind: "failed", failure: "secret_unavailable" };
  }
  const targets = work.login;
  if (targets === undefined) return { kind: "failed", failure: "portal_drift" };

  // ── 2. The form must be on the host this work was bound to ─────────────
  let target: URL;
  try {
    target = new URL(targets.url);
  } catch {
    return { kind: "failed", failure: "portal_drift" };
  }
  if (target.host !== work.portalHost) return { kind: "failed", failure: "portal_drift" };

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

    // ── 3. A challenge on the login form, before a character is typed ─────
    const challenged = await detectChallenge(page);
    if (challenged !== null) return { kind: "failed", failure: challengeFailure(challenged) };

    // ── 4. The email, then the password — the latter never by this process ─
    const email = await resolve(page, targets.emailLocator);
    if (email === null) return { kind: "failed", failure: "portal_drift" };
    try {
      await email.fill(work.email, { timeout: STEP_TIMEOUT_MS });
    } catch {
      return { kind: "failed", failure: "portal_drift" };
    }

    const filled = await fillSecret({
      page,
      claim: {
        handle: work.secretHandle,
        studentRef: work.studentRef,
        caseRef: work.caseId,
        purpose: "portal_sign_in",
        targetHost: work.portalHost,
      },
      locators: [
        { strategy: targets.passwordLocator.strategy, value: targets.passwordLocator.value },
      ] satisfies readonly FieldLocator[],
      agentBaseUrl: deps.agentBaseUrl,
      browserEndpoint: deps.browserEndpoint,
      ...(deps.serviceToken === undefined ? {} : { serviceToken: deps.serviceToken }),
      ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
    });
    if (!filled.ok) {
      // As for the creation: `no_such_field` left the handle alive, so a
      // corrected blueprint spends it with no new ask; anything else spent
      // it, and the plane asks again.
      return {
        kind: "failed",
        failure: filled.reason === "no_such_field" ? "portal_drift" : "secret_unavailable",
      };
    }

    // ── 5. Submit, and ask the page ────────────────────────────────────────
    const submit = await resolve(page, targets.submitLocator);
    if (submit === null) return { kind: "failed", failure: "portal_drift" };
    try {
      await Promise.all([
        page.waitForLoadState("load", { timeout: STEP_TIMEOUT_MS }),
        submit.click({ timeout: STEP_TIMEOUT_MS }),
      ]);
    } catch {
      // The password is spent whether or not the click landed, and a sign-in
      // that may or may not have happened creates nothing on the portal: the
      // honest answer is a failure the plane can act on — ask again — rather
      // than an uncertainty a person has to adjudicate.
      return { kind: "failed", failure: "runner_fault" };
    }

    const landed = new URL(page.url());
    if (landed.pathname === target.pathname) {
      // Still on the login form: the portal did not accept the password.
      return { kind: "failed", failure: "portal_refused" };
    }
    // Accepted, and answered with a page. If THAT page asks for a code, the
    // sign-in is gated by something only the student holds (ADR-0101 §5).
    const afterwards = await detectChallenge(page);
    if (afterwards !== null) return { kind: "failed", failure: challengeFailure(afterwards) };
    return { kind: "succeeded" };
  } finally {
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
