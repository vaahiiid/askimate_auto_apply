/**
 * The run never presses a portal's "Forgot password" (P301).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-10-12 (docs/run-a/p301-his-auth7-as-sent.txt), having tried it on
 * Sheffield with his own account: *"The run must never press "Forgot password"
 * itself: it silently replaces the student's password and puts a new one in
 * their inbox in plain text."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Until P301 nothing refused it: the run did not press it only because no
 * signed target pointed at it. A curation that copied the 2026-09-11 read's
 * reset page into an entry, or a press that landed on the link, would have
 * replaced a student's password with nothing going red. So it is now held at
 * every layer a press or a request passes, with one test underneath them
 * all (`isPasswordResetUrl`, `readsAsPasswordReset`, in the blueprint package):
 *
 *   ENTRY     The catalogue refuses an entry whose pages, sign-in, presses or
 *             typeahead entries are a reset — at review, loudly, before any
 *             signature.
 *   PRESS     Every press reads the control first — its name, its identifiers,
 *             where it would go (`href`, `formaction`, its form's `action`) —
 *             and refuses a reset: `ClickAllowList.decide` for the fill, and
 *             `refusalToPress` for the sign-in's and the creation's own presses.
 *   REQUEST   Every context the run opens aborts any request to a reset page,
 *             by any method (`openSensitiveContext`), and the fill's own
 *             guard, which takes over once a fill attaches, refuses it too
 *             (`decidePreparationRequest`). A route handler is shown a
 *             redirect's FIRST request only, so a later hop onto a reset is
 *             not refused here — and a 307 or 308 carries a form's body to it,
 *             so that reset is sent (measured in P301's review; state row 178).
 *   AFTER     Every request to a reset page, refused or not, redirect hops
 *             included, is WATCHED (`passwordResetWatch`), and read after each
 *             press: a sign-in or a creation that reached one, or landed on
 *             one, is not a success, and a fill that reached one is never
 *             reported saved. Each says so in a line. This is how the refusal
 *             above is loud, and how the redirect it cannot refuse is seen.
 *
 * What none of them can see is a reset that neither its URL nor its words call
 * one. That is a reason the rule is stated at every layer, not a gap any one of
 * them closes.
 *
 * What is said is which check fired, in fixed words — never the control's own
 * words or where it goes. The runner's log takes nothing from a page, because
 * a page's URL can carry a token (P301's review).
 */
import type { BrowserContext, Locator, Page } from "playwright";

import { PASSWORD_RESET_REFUSAL, isPasswordResetUrl, readsAsPasswordReset } from "@askimate/aas-blueprint";

/**
 * Where a control would go if pressed: a link's `href`, a button's own
 * `formaction`, or the action of the form it submits — each resolved against
 * the page, as the browser would resolve it. Read, never followed.
 */
export async function destinationsOf(target: Locator): Promise<readonly string[]> {
  try {
    return await target.evaluate((element) => {
      const out: string[] = [];
      const absolute = (value: string | null): void => {
        if (value === null || value.length === 0) return;
        try {
          out.push(new URL(value, document.baseURI).toString());
        } catch {
          out.push(value);
        }
      };
      const anchor = element.closest("a");
      if (anchor !== null) absolute(anchor.getAttribute("href"));
      absolute(element.getAttribute("formaction"));
      const form = (element as HTMLInputElement | HTMLButtonElement).form ?? element.closest("form");
      if (form !== null) absolute(form.getAttribute("action"));
      return out;
    });
  } catch {
    // An element that cannot be read cannot be shown to be safe either; the
    // name check still runs on what could be read.
    return [];
  }
}

/** Which of the three readings of a control found a reset. */
export type ResetCheck = "its words" | "its name" | "where it goes";

/** What a control says to a person, and what it is called in the markup. */
async function wordsOf(target: Locator): Promise<{ readonly said: string; readonly identifiers: readonly string[] }> {
  const read = async (attribute: string): Promise<string> => ((await target.getAttribute(attribute).catch(() => null)) ?? "").trim();
  const text = ((await target.textContent().catch(() => null)) ?? "").trim();
  const said = [text, await read("value"), await read("aria-label"), await read("title"), await read("alt")]
    .filter((part) => part.length > 0)
    .join(" / ");
  const identifiers = [await read("name"), await read("id")].filter((part) => part.length > 0);
  return { said, identifiers };
}

/**
 * Why pressing this control would be pressing a password reset, or `null`.
 *
 * For the presses the fill's `ClickAllowList` does not see: the sign-in's and
 * the creation's own buttons, and the consent path's.
 */
export async function refusalToPress(target: Locator): Promise<string | null> {
  const { said, identifiers } = await wordsOf(target);
  const destinations = await destinationsOf(target);
  return resetReason(said, identifiers, destinations);
}

/** Which reading found a reset, or `null`. Pure. */
export function resetCheck(
  said: string,
  identifiers: readonly string[],
  destinations: readonly string[],
): ResetCheck | null {
  if (said.length > 0 && readsAsPasswordReset(said)) return "its words";
  if (identifiers.some((identifier) => readsAsPasswordReset(identifier))) return "its name";
  if (destinations.some((destination) => isPasswordResetUrl(destination))) return "where it goes";
  return null;
}

/**
 * The shared reading, pure: words, identifiers, destinations. Used by
 * `refusalToPress` and by `ClickAllowList.decide`, so the two cannot disagree
 * about what a reset is. Says which check fired and nothing the page said.
 */
export function resetReason(
  said: string,
  identifiers: readonly string[],
  destinations: readonly string[],
): string | null {
  const check = resetCheck(said, identifiers, destinations);
  if (check === null) return null;
  return `Refusing to press a control that reads as a password reset by ${check} — ${PASSWORD_RESET_REFUSAL}.`;
}

/** Every request to a reset page a context has issued, refused or not. */
interface SeenResetRequest {
  /** A navigation, or a request that sends something (not a GET or HEAD). */
  readonly reached: boolean;
}

const WATCHED = new WeakMap<BrowserContext, SeenResetRequest[]>();

/**
 * What a context has asked of a reset page since a mark.
 *
 * `reached` — a navigation to one, or a request that sends to one — is what a
 * press must never cause. `resource` — only a GET of something on such a page —
 * is said and not counted against the press.
 */
export interface PasswordResetWatch {
  mark(): number;
  since(mark: number): "reached" | "resource" | null;
}

/**
 * Watches every request a context issues for a password reset, redirect hops
 * included: Playwright reports each hop as a request of its own, which is
 * exactly what a route handler is NOT shown (P301's review). Installed once per
 * context, by `abortPasswordResetRequests`; asking again returns the same watch.
 */
export function passwordResetWatch(context: BrowserContext): PasswordResetWatch {
  let seen = WATCHED.get(context);
  if (seen === undefined) {
    const list: SeenResetRequest[] = [];
    seen = list;
    WATCHED.set(context, list);
    context.on("request", (request) => {
      if (!isPasswordResetUrl(request.url())) return;
      const method = request.method().toUpperCase();
      list.push({ reached: request.isNavigationRequest() || (method !== "GET" && method !== "HEAD") });
    });
  }
  const list = seen;
  return {
    mark: () => list.length,
    since: (mark) => {
      const after = list.slice(mark);
      if (after.length === 0) return null;
      return after.some((one) => one.reached) ? "reached" : "resource";
    },
  };
}

/**
 * Aborts every request to a password reset, by any method, on every context
 * the run opens, and watches for them (`passwordResetWatch`). Any other
 * request falls through to whatever else is installed, unchanged.
 *
 * Installed FIRST, by `openSensitiveContext`. Playwright runs the most recently
 * added handler first, and the fill's own guard (`guardContext`) continues a
 * request without falling back — so once a fill attaches this handler no
 * longer sees its requests, and `decidePreparationRequest` refuses a reset
 * there itself. Tests in preparation.test.ts hold both.
 */
export async function abortPasswordResetRequests(context: BrowserContext): Promise<void> {
  passwordResetWatch(context);
  await context.route("**/*", async (route) => {
    if (isPasswordResetUrl(route.request().url())) {
      await route.abort("blockedbyclient");
      return;
    }
    await route.fallback();
  });
}

/**
 * Whether a press has ended on, or reached, a password reset: the page is on
 * one, or the context asked one for a page or sent one something since `mark`
 * (a navigation the guard refused leaves the browser on its own error page,
 * which no URL test would read as a reset). A route handler sees a redirect's
 * first request only, so this is read where the press's success would be.
 */
export function landedOnPasswordReset(page: Page, mark?: number): boolean {
  if (isPasswordResetUrl(page.url())) return true;
  return mark !== undefined && passwordResetWatch(page.context()).since(mark) === "reached";
}

/** The fixed line for a press that reached a reset, for every caller alike. */
export const REACHED_A_RESET = `the press reached a password reset page, and that is never a success — ${PASSWORD_RESET_REFUSAL}`;
