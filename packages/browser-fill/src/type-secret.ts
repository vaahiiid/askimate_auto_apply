/**
 * The keystroke. One function, and the only place a plaintext password is
 * handed to a browser.
 *
 * Moved here from `apps/browser-runner` by ADR-0042 without changing what it
 * does, because what it does was right: the runner was the wrong PROCESS to
 * call it from, not the wrong code.
 *
 * ── What is deliberately different from an ordinary fill ──────────────────
 *
 * `PlaywrightFillSession.fill` reads the value back and compares it, because a
 * portal silently truncating a personal statement is a real and invisible
 * failure. That read-back cannot happen here: `inputValue()` returns the
 * plaintext into the caller's scope, and the comparison — and any error it
 * raised — would be about the secret.
 *
 * So the verification is on SHAPE only: the field's length must match what was
 * typed. That catches the failure that matters (the portal took nothing, or
 * truncated it) and reveals nothing beyond what anyone watching the screen
 * already sees. The read-back happens INSIDE the callback, so the plaintext it
 * returns dies with the same stack frame as the secret itself.
 */

import type { FieldLocator } from "@askimate/aas-blueprint";
import type { Locator } from "playwright";

import { FIELD_TIMEOUT_MS } from "./locator.js";

/** Raised when the portal did not take the secret, or took only part of it. */
export class SecretNotAcceptedError extends Error {
  public override readonly name = "SecretNotAcceptedError";
  public constructor(
    public readonly locator: FieldLocator,
    /** Shapes only. Never the characters. */
    public readonly intendedLength: number,
    public readonly storedLength: number,
  ) {
    super(
      `The field at ${locator.strategy}=${locator.value} did not accept the secret: ` +
        `${String(intendedLength)} characters were typed and ${String(storedLength)} are in the ` +
        `field. A password the portal silently truncated would produce an account nobody can sign ` +
        `in to. The characters themselves are not reported here, deliberately.`,
    );
  }
}

/**
 * Types the secret and verifies its shape. Returns nothing.
 *
 * A return value shaped like the input is how a value escapes, so this returns
 * `void` and the caller learns success from the absence of a throw.
 */
export async function typeSecretInto(
  target: Locator,
  locator: FieldLocator,
  secret: string,
): Promise<void> {
  // `fill` rather than `type`: one operation, no per-keystroke events, and
  // nothing that a page's own listeners can reconstruct character by character
  // from timing.
  await target.fill(secret, { timeout: FIELD_TIMEOUT_MS });

  const stored = (await target.inputValue()).length;
  if (stored !== secret.length) {
    throw new SecretNotAcceptedError(locator, secret.length, stored);
  }
}
