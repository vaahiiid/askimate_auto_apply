/**
 * The one operation this service performs: type a secret into a portal field.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠  THE ONE PROCESS BESIDES THE SECURE INTERACTION SERVICE THAT HOLDS A
 *    PASSWORD. It holds one for the duration of a single stack frame, and it
 *    exists so that the automation runner does not.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Where the plaintext comes from, and why not over HTTP ─────────────────
 *
 * From the vault, locally. This process constructs its own `EnvelopeVault` over
 * the SAME envelope cache and the SAME KMS key as the secure service, so the
 * ciphertext it needs is already reachable and the data key is unwrapped here.
 * Nothing has to send it a value.
 *
 * Vahid, 2026-08-30: *"Sending the plaintext back in an HTTP response, even
 * over mTLS and a private subnet, weakens one of the strongest guarantees we
 * have deliberately established: that the secret does not become ordinary
 * service-to-service response data."* It does not become one. The only thing
 * that crosses a service boundary here is the AUTHORITY to spend.
 *
 * ── The order, and why every step is where it is ──────────────────────────
 *
 *   1–5. Everything that can be established WITHOUT a secret is established
 *        without one: the browser is reachable, the page is the right page, the
 *        field exists, it is masked, and nothing is snapshotting the DOM. A
 *        blueprint mistake fails here, and a handle that fails here has NOT
 *        been spent — the student is not asked for a new password because a
 *        selector drifted.
 *   6.   The authority to spend is obtained from the secure service.
 *   7.   Only now does plaintext exist, inside one callback, for one `fill`.
 *
 * ── What this function returns ────────────────────────────────────────────
 *
 * A closed union of two strings and a lifecycle word. It cannot return a value,
 * a length, or free text, and the type-level assertion in `@askimate/aas-
 * contracts` fails the build if a field is added that could.
 */

import type { FieldLocator } from "@askimate/aas-blueprint";
import {
  FIELD_TIMEOUT_MS,
  SecretNotAcceptedError,
  fieldIsMasked,
  pageHostMatches,
  snapshotStreamerPresent,
  toPlaywrightLocator,
  typeSecretInto,
} from "@askimate/aas-browser-fill";
import type { SecretFillRequest, SecretFillResult } from "@askimate/aas-contracts";
import type { EnvelopeVault } from "@askimate/aas-secrets";
import type { SecureLogger } from "@askimate/aas-secure-logging";
import type { Browser, Locator, Page } from "playwright";

import type { UseAuthorisation } from "./authorise.js";

/** How the agent reaches a browser. A port, so a test can hand it a real one. */
export type ConnectToBrowser = (endpoint: string) => Promise<Browser>;

export interface FillAgentDeps {
  /** This process's own vault, over the shared cache and the shared KMS key. */
  readonly vault: EnvelopeVault;
  readonly authorise: (request: SecretFillRequest) => Promise<UseAuthorisation>;
  readonly connect: ConnectToBrowser;
  readonly now: () => Date;
  readonly logger: SecureLogger;
}

type FillRefusal = Extract<SecretFillResult, { status: "refused" }>["reason"];

/** Refused before the use was settled: the handle is untouched and still live. */
function refused(reason: FillRefusal): SecretFillResult {
  return { status: "refused", reason };
}

/** Refused after the use was settled: the handle is dead either way. */
function refusedAfterSettlement(reason: FillRefusal): SecretFillResult {
  return { status: "refused", reason, lifecycle: "secret_consumed" };
}

export async function performSecretFill(
  request: SecretFillRequest,
  deps: FillAgentDeps,
): Promise<SecretFillResult> {
  let browser: Browser;
  try {
    browser = await deps.connect(request.browserEndpoint);
  } catch {
    return refused("browser_unreachable");
  }

  try {
    const page = selectPage(browser, request.pageUrl);
    if (page === null) return refused("browser_unreachable");

    // ── 2. The page must be the page the student was told about ───────────
    //
    // The binding is re-checked by the secure service too, but that compares
    // metadata with metadata. This compares it with the document the
    // characters would actually go into. A run that has been navigated
    // somewhere else fails here, before anything is decrypted.
    if (!pageHostMatches(page, request.targetHost)) return refused("host_mismatch");

    // ── The whole SET is established before any plaintext exists ─────────
    //
    // A registration form asks for a password twice, and one handle fills both
    // (P1: *"never ask the student twice"*). That makes steps 3 and 4 a loop,
    // and the loop has to finish before step 7 rather than interleaving with
    // it: a second field that turns out not to exist AFTER the first has been
    // typed would leave a spent handle, a half-filled form, and a student asked
    // for a new password because a selector drifted.
    const targets: { readonly locator: FieldLocator; readonly target: Locator }[] = [];
    for (const asked of request.locators) {
      const locator: FieldLocator = { strategy: asked.strategy, value: asked.value };
      const target: Locator | null = toPlaywrightLocator(page, locator);
      if (target === null) return refused("no_such_field");

      // ── 3. The field must EXIST before the secret is spent ──────────────
      //
      // Playwright locators are lazy: building one for a selector that matches
      // nothing succeeds, and the failure only arrives when an action on it
      // times out. Without this wait the sequence is `vault.use` → ciphertext
      // taken → `fill` hangs → timeout, and a single-use password has been
      // spent on a field that was never there.
      try {
        await target.waitFor({ state: "attached", timeout: FIELD_TIMEOUT_MS });
      } catch {
        return refused("no_such_field");
      }

      // ── 4. The field must be one the browser renders as dots ────────────
      //
      // EVERY field, not just the first. A form whose confirmation box is a
      // plain text input renders the student's password in the clear, and it
      // would be visible in any video or screenshot of the run.
      if (!(await fieldIsMasked(target))) return refused("field_not_masked");

      targets.push({ locator, target });
    }

    // ── 5. Nothing may be streaming DOM snapshots ─────────────────────────
    //
    // Verified against the live page rather than asserted by the caller. See
    // `guards.ts` for the three experiments that establish this marker is
    // present in exactly the configuration that leaks.
    if (await snapshotStreamerPresent(page)) {
      deps.logger.log({
        event: "fill_target_refused",
        code: "diagnostic_capture_detected",
      });
      return refused("diagnostic_capture_detected");
    }

    // ── 6. The authority to spend ─────────────────────────────────────────
    const authorised = await deps.authorise(request);
    if (!authorised.ok) {
      deps.logger.log({ event: "secret_fill_refused", code: "not_authorised" });
      return refused("not_authorised");
    }

    // ── 7. The only place plaintext exists in this system outside the ─────
    //      secure service's submission frame.
    // The callback returns a BOOLEAN and `use` returns the callback's result.
    // That is the vault's whole shape, used as intended: the outcome crosses the
    // frame and the plaintext does not. `SecretNotAcceptedError` carries lengths
    // rather than characters, but nothing about it needs to escape either, and
    // an error object is the classic way a value leaves a frame.
    const used = await deps.vault.use(
      request.handle,
      async (secret: string): Promise<boolean> => {
        try {
          // All of them, inside the ONE callback. The plaintext exists for the
          // duration of this frame whether it is typed once or twice, and a
          // second `use` would mean the handle was not single-use.
          for (const { locator, target } of targets) {
            await typeSecretInto(target, locator, secret);
          }
          return true;
        } catch (error: unknown) {
          if (error instanceof SecretNotAcceptedError) return false;
          throw error;
        }
      },
      deps.now(),
    );

    if (!used.ok) {
      deps.logger.log({ event: "secret_fill_refused", code: "secret_unavailable" });
      return refusedAfterSettlement("secret_unavailable");
    }
    if (!used.result) {
      deps.logger.log({ event: "secret_fill_refused", code: "not_accepted" });
      return refusedAfterSettlement("not_accepted");
    }
    deps.logger.log({ event: "secret_filled" });
    return { status: "filled", lifecycle: "secret_consumed" };
  } finally {
    // Disconnects; it does not kill the runner's browser. `connectOverCDP`
    // attaches as one DevTools client among possibly several, and closing that
    // client leaves the browser and its pages alone — measured, because the
    // opposite would end every run at the moment the password was typed.
    await browser.close().catch(() => undefined);
  }
}

/**
 * Which page to fill.
 *
 * Ambiguity is refused rather than guessed at. Two pages matching the same URL
 * is a state where "the right one" is a coin toss, and the cost of getting it
 * wrong is a password typed into a page nobody asked about.
 */
function selectPage(browser: Browser, pageUrl: string | undefined): Page | null {
  const pages = browser.contexts().flatMap((context) => context.pages());
  if (pageUrl === undefined) return pages.length === 1 ? (pages[0] ?? null) : null;
  const matching = pages.filter((page) => page.url() === pageUrl);
  return matching.length === 1 ? (matching[0] ?? null) : null;
}
