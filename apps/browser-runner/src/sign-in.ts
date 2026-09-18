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
import { signInStartLine, thrownInWords } from "./runner-log.js";
import type { PerformOutcome } from "./work-intake.js";

/** How long to wait for a page or a control. Portals are slow; students wait. */
const STEP_TIMEOUT_MS = 15_000;

/**
 * The two waits at the submit, named apart (ADR-0127).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * MEASURE, DO NOT READ — the reason these are two numbers and not one.
 *
 * Until P160 the submit was `Promise.all([waitForLoadState("load"), click()])`
 * under one fifteen-second ceiling, and it READ as "press, then wait for the
 * next page to load". It did not do that. Playwright's own contract:
 * `waitForLoadState` *"resolves immediately"* when the current document has
 * already reached the state — and the current document was the login page,
 * loaded by `goto`. So the load wait resolved at once and guarded nothing.
 * The clock that expired on Run A's repeat was the CLICK's own, which waits
 * for the button to be pressable and then for the portal's answer to commit.
 *
 * The reading was confident, and it was the third piece of code that week to
 * do something other than what it read as doing. Two waits, two phrases, so
 * the next log line is a reading of which clock ran out — not a deduction.
 * ═══════════════════════════════════════════════════════════════════════════
 */
/** The button: attached, visible, enabled, receiving events. Unchanged at fifteen. */
export const SIGN_IN_PRESS_TIMEOUT_MS = 15_000;
/**
 * The portal's answer: its response to the POST committing as a document.
 * Thirty, not fifteen: the unknown is server time on the portal's own sign-in
 * handler, which exceeded fifteen once; doubling is a MEASUREMENT, and a second
 * failure at thirty says the cause is not time. Not sixty — a student watching
 * the box should not wait a minute to be told nothing.
 */
export const SIGN_IN_ANSWER_TIMEOUT_MS = 30_000;

export interface SettleSignInInput {
  readonly runId: string;
  /** The login form's own URL, from the reviewed blueprint. */
  readonly loginUrl: URL;
  readonly submitLocator: FieldLocator;
  readonly passwordLocator: FieldLocator;
  readonly say: (line: string) => void;
  /**
   * TESTS ONLY. Production never sets these; the numbers above are the ones
   * ADR-0127 names, and a test that shortens one does so to drive that one
   * wait to its own failure on a fixture.
   */
  readonly timeouts?: { readonly pressMs?: number; readonly answerMs?: number };
}

/**
 * The submit, settled: the press, then the answer, then where it landed.
 *
 * Exported and taken to the form already typed, so a test can drive each wait
 * to its own failure without a fill agent in the loop.
 */
export async function settleSignIn(page: Page, input: SettleSignInInput): Promise<PerformOutcome> {
  const pressMs = input.timeouts?.pressMs ?? SIGN_IN_PRESS_TIMEOUT_MS;
  const answerMs = input.timeouts?.answerMs ?? SIGN_IN_ANSWER_TIMEOUT_MS;

  const submit = await resolve(page, input.submitLocator);
  if (submit === null) return { kind: "failed", failure: "portal_drift" };

  // ── The answer, armed before the press ────────────────────────────────
  //
  // `framenavigated` on the main frame is the commit of the portal's answer
  // to the POST — a redirect chain commits once, at its end, and a refused
  // password that re-renders the form commits too. Armed first so an answer
  // that arrives during the press is not missed; caught into a value so a
  // press that fails leaves no rejection dangling.
  const answered = page
    .waitForEvent("framenavigated", {
      predicate: (frame) => frame === page.mainFrame(),
      timeout: answerMs,
    })
    .then((): unknown => null, (error: unknown) => error);

  // ── 1. The press ──────────────────────────────────────────────────────
  //
  // `noWaitAfter`: the press measures ONLY whether the button could be
  // pressed. Waiting for the answer is the next wait's job, under its own
  // name and its own number.
  try {
    await submit.click({ timeout: pressMs, noWaitAfter: true });
  } catch (error) {
    // The one extra fact for the overlay case: the button was attached and
    // resolvable, the press still failed — is the form still there? A yes
    // says "something is over the button", and the runner's page is one
    // nobody has read with tags allowed (ADR-0127). A word, never the page.
    const boxStill = await toPlaywrightLocator(page, input.passwordLocator)
      ?.isVisible()
      .catch(() => false);
    input.say(
      `run ${input.runId}: sign-in failed — the sign-in button could not be pressed — ` +
        `${thrownInWords(error)}; the password box is ${boxStill === true ? "still" : "no longer"} on the page`,
    );
    return { kind: "failed", failure: "runner_fault" };
  }

  // ── 2. The answer ─────────────────────────────────────────────────────
  const outcome = await answered;
  if (outcome !== null) {
    input.say(
      `run ${input.runId}: sign-in failed — the portal did not answer the sign-in — ` +
        `${thrownInWords(outcome)}`,
    );
    return { kind: "failed", failure: "runner_fault" };
  }
  // The new document has committed; let it parse before anything is read
  // from it. Cheap, and bounded by the same ceiling.
  try {
    await page.waitForLoadState("domcontentloaded", { timeout: answerMs });
  } catch (error) {
    input.say(
      `run ${input.runId}: sign-in failed — the portal's answer did not finish arriving — ` +
        `${thrownInWords(error)}`,
    );
    return { kind: "failed", failure: "runner_fault" };
  }

  // ── 3. Where it landed ────────────────────────────────────────────────
  //
  // The URL is the only recorded shape of the landing: the work item carries
  // the login form and nothing about the page after it, and a locator for
  // that page would be invented. So the rule is the one it always was: still
  // on the login form, the portal did not accept the password; anywhere
  // else, it did — and if THAT page asks for a code, the sign-in is gated by
  // something only the student holds (ADR-0101 §5).
  if (new URL(page.url()).pathname === input.loginUrl.pathname) {
    return { kind: "failed", failure: "portal_refused" };
  }
  const afterwards = await detectChallenge(page);
  if (afterwards !== null) return { kind: "failed", failure: challengeFailure(afterwards) };
  return { kind: "succeeded" };
}

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
  /**
   * Where this attempt says what it is doing (ADR-0124, P157).
   *
   * Optional so every existing test builds deps without one. What it receives
   * has already been through `runner-log`'s vocabulary: our words for a
   * recognised error, or the class alone when the message could not be
   * repeated. Nothing from a page reaches it.
   */
  readonly log?: (line: string) => void;
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
  const say = deps.log ?? ((): void => undefined);
  // BEFORE anything opens: a runner that dies inside the attempt has still
  // said it began, and which attempt, and where (ADR-0124).
  say(
    signInStartLine({
      runId: work.runId,
      ...(work.signInAttempt === undefined ? {} : { attempt: work.signInAttempt }),
      url: target.toString(),
    }),
  );

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
    } catch (error) {
      say(`run ${work.runId}: sign-in failed opening the login page — ${thrownInWords(error)}`);
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
    } catch (error) {
      say(`run ${work.runId}: sign-in failed typing the e-mail — ${thrownInWords(error)}`);
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

    // ── 5. Submit, and ask the page (ADR-0127) ────────────────────────────
    //
    // The password is spent whether or not the press landed, and a sign-in
    // that may or may not have happened creates nothing on the portal: the
    // honest answer is a failure the plane can act on — ask again — rather
    // than an uncertainty a person has to adjudicate. `settleSignIn` says
    // WHICH wait failed, and that is the whole point of it.
    return await settleSignIn(page, {
      runId: work.runId,
      loginUrl: target,
      submitLocator: targets.submitLocator,
      passwordLocator: targets.passwordLocator,
      say,
    });
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
