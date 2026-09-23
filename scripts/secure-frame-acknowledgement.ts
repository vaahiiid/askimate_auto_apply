/**
 * What the secure frame said — and, when it said nothing, which of the two
 * things that means (P198, blocker 67).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CI 327 went red here with one line:
 *
 *     AssertionError: expected 'Loading…' to contain 'received'
 *
 * `Loading…` is the placeholder `controlDocument` ships with. The control
 * script HIDES that element on a successful mount without touching its text,
 * and writes over it only on a successful submit. So the message said exactly
 * one thing — *the frame mounted and has not answered* — and could not
 * distinguish the two failures hiding behind it:
 *
 *   THE PASSWORD NEVER WENT. The submit was refused, and the frame's own
 *     error line (`#secure-error`) says why. The run is still waiting for a
 *     secret.
 *
 *   THE PASSWORD WENT AND THE PAGE NEVER SAID SO. The run has moved on, and
 *     what failed is the sentence the STUDENT reads before the box is taken
 *     away. Different defect, different owner, same words on the screen.
 *
 * In CI 327 it was the second, and nothing in the failure said so: it took
 * reading the five OTHER tests in that file, which passed, to see that the
 * account existed and the run had reached the handover. A message that needs
 * the rest of the suite read back to it is not a message.
 *
 * So this is where the words live, for all four places that make this wait.
 * The CEILING is deliberately unchanged at twenty seconds — see blocker 67:
 * this is the shape P47 measured and Vahid ruled on, *"fix the contention
 * rather than the assertions"*, and raising the ceiling is fixing the
 * assertion. What was actually wrong was that the failure said nothing.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { FrameLocator, Page } from "playwright";
import { expect } from "vitest";

/**
 * Twenty seconds, and NOT raised. P47's lane serialises the browser files
 * against each other; it does not serialise them against the 145 files of the
 * other lane on the same four-vCPU runner, and this is the wait that catches
 * what is left. Whether to spend CI time closing that is blocker 67.
 */
export const ACKNOWLEDGEMENT_MS = 20_000;

/** How long a diagnostic read may take. It must not outlive the failure. */
const A_GLANCE_MS = 2_000;

export interface SecureFrameWait {
  /** The student's page — asked only how many frames are still mounted. */
  readonly page: Page;
  /** The frame itself. */
  readonly frame: FrameLocator;
  /** What the page threw, from the caller's own `pageerror` listener. */
  readonly pageErrors?: readonly string[];
  /**
   * The run as the SERVICE reports it. This is the one fact that separates
   * the two failures, so a caller that can read it should pass it.
   */
  readonly run?: () => Promise<unknown>;
  /** The caller's own `logs()` — the five processes, for CI. */
  readonly logs?: () => Promise<string>;
}

/**
 * Waits for the frame's own word that the secret went, and says what it saw
 * when it never came.
 */
export async function secureFrameSaysReceived(wait: SecureFrameWait): Promise<void> {
  try {
    await expect
      .poll(async () => await wait.frame.locator("#state").textContent(), { timeout: ACKNOWLEDGEMENT_MS })
      .toContain("received");
  } catch (error) {
    throw new Error(await whatItSawInstead(wait, error));
  }
}

async function whatItSawInstead(wait: SecureFrameWait, error: unknown): Promise<string> {
  const glance = async (selector: string): Promise<string> =>
    await wait.frame
      .locator(selector)
      .textContent({ timeout: A_GLANCE_MS })
      .then((text) => text ?? "(empty)")
      .catch(() => "(the frame is gone, or would not answer)");

  const parts = [`the secure frame never said the password was received: ${String(error)}`];
  parts.push(`#state: ${JSON.stringify(await glance("#state"))} — "Loading…" is the placeholder, and means the frame mounted and has not answered`);
  parts.push(`#secure-error, the frame's own word on a refusal: ${JSON.stringify(await glance("#secure-error"))}`);
  const mounted = await wait.page
    .locator("#secure iframe")
    .count()
    .catch(() => -1);
  parts.push(`frames still mounted: ${String(mounted)} (0 means the page took the box down, which it does when the log says the secret arrived)`);
  if (wait.run !== undefined) {
    const run = await wait.run().catch((reason: unknown) => `(unreadable: ${String(reason)})`);
    parts.push(`the run, as the SERVICE reports it — anything past awaiting_secret means the password DID go and only the sentence is missing: ${JSON.stringify(run)}`);
  }
  if (wait.pageErrors !== undefined) parts.push(`page errors: ${wait.pageErrors.join(" | ")}`);
  if (wait.logs !== undefined) parts.push(await wait.logs().catch((reason: unknown) => `(no logs: ${String(reason)})`));
  return parts.join("\n");
}
