/**
 * What can be verified about a page BEFORE a password is typed into it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ADR-0042 moves the fill out of the runner's process and into the Secure
 * Plane's fill agent, which reaches the runner's browser over CDP. The agent
 * therefore cannot use `tracingIsForbidden()`: that reads a private symbol left
 * on a `BrowserContext` object by `openSensitiveContext`, and the agent holds a
 * DIFFERENT object for the same underlying context — one it did not create.
 *
 * The question that mattered was whether anything real was left to check, or
 * whether the agent would have to take the runner's word for it. Three
 * experiments, run against real Chromium:
 *
 *   | Runner-side state                     | Value in trace.trace | Detectable from the page |
 *   |---------------------------------------|----------------------|--------------------------|
 *   | tracing with `snapshots: true`        | **yes, verbatim**    | **yes**                  |
 *   | tracing with `snapshots: false`       | no                   | no                       |
 *   | no tracing                            | no                   | no                       |
 *
 *   The first row is the finding this file exists for: a value typed by ANOTHER
 *   PROCESS still lands in the runner's trace, because the leak is the DOM
 *   snapshot rather than the action's own parameters — the agent's `fill` is
 *   not one of the runner's recorded actions, but the input's value is in the
 *   snapshot taken after it.
 *
 *   The third column is the finding that makes it fixable: Playwright's
 *   snapshotter installs a property on `window` whose name begins
 *   `__playwright_snapshot_streamer_`, and it is present in exactly the case
 *   that leaks and absent in both cases that do not. The marker maps onto the
 *   leak, not merely onto "tracing is on".
 *
 * So the agent VERIFIES rather than trusts. That is stronger than what it
 * replaces: `confirmNoDiagnosticCapture()` runs inside the runner, and ADR-0026
 * already admits that a caller "could write a consumer that returns `true` and
 * lies". A check performed by the component being checked is a guard against
 * accident. This one is performed by the component that holds the plaintext.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { Frame, Locator, Page } from "playwright";

/** The prefix Playwright's snapshotter installs on `window`, per frame. */
const SNAPSHOT_STREAMER_PREFIX = "__playwright_snapshot_streamer_";

/**
 * Whether anything in this page is streaming DOM snapshots.
 *
 * Every frame is asked, not just the main one: a password field inside an
 * iframe is snapshotted through that frame's own streamer, and checking only
 * the top document would miss it. A frame that cannot be evaluated in — one
 * that is detaching, or cross-origin in a way that refuses — is treated as
 * **suspect**, because "I could not look" is not "there is nothing there".
 */
export async function snapshotStreamerPresent(page: Page): Promise<boolean> {
  const frames: readonly Frame[] = page.frames();
  for (const frame of frames) {
    let present: boolean;
    try {
      present = await frame.evaluate(
        (prefix: string) => Object.getOwnPropertyNames(window).some((n) => n.startsWith(prefix)),
        SNAPSHOT_STREAMER_PREFIX,
      );
    } catch {
      return true;
    }
    if (present) return true;
  }
  return false;
}

/**
 * Whether the element is an input the browser renders as dots.
 *
 * ── Why this is a security check and not a usability one ──────────────────
 *
 * Video is the one diagnostic route the agent cannot detect remotely: a
 * `recordVideo` context records on the runner's side and leaves no mark in the
 * page. What makes that survivable is that a `type="password"` input renders
 * masked, so a recording of one shows dots. Requiring the field to be masked
 * therefore closes the vector this file cannot otherwise see.
 *
 * It also catches the blunter failure: a blueprint whose locator has drifted
 * onto the "email" box would otherwise type a password into a field the portal
 * will echo back on the next page.
 *
 * There is deliberately no override. A portal that collects a password in an
 * unmasked field is a finding to escalate, not a flag to set.
 */
export async function fieldIsMasked(target: Locator): Promise<boolean> {
  try {
    const type = await target.evaluate((element: Element) =>
      element instanceof HTMLInputElement ? element.type : null,
    );
    return type === "password";
  } catch {
    return false;
  }
}

/**
 * Whether the page is on the host the request was bound to.
 *
 * The binding is re-checked against the secure plane's own record before a use
 * is authorised, but that check compares metadata with metadata. This one
 * compares the metadata with the PAGE — the actual document the characters
 * would be typed into.
 *
 * It is the difference between "this handle was issued for apply.example.ac.uk"
 * and "the keystrokes are going to apply.example.ac.uk". A run that has been
 * navigated somewhere else, by a redirect or by anything else, fails here.
 *
 * Compared on host, not origin: a portal that moves between `https://` and a
 * port is still the same portal, and the transport is separately constrained.
 */
export function pageHostMatches(page: Page, expectedHost: string): boolean {
  let host: string;
  try {
    host = new URL(page.url()).host;
  } catch {
    return false;
  }
  return host.toLowerCase() === expectedHost.toLowerCase();
}
