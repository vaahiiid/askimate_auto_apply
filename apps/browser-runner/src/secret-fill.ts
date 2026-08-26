/**
 * Typing a secret into a portal, without any part of the run being able to
 * observe it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-26: *"Automation consumes it only through the sensitive
 * browser context already implemented. The normal Playwright traced context
 * must never receive it."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This file is the join between two things built separately: the ephemeral
 * secret store in `@askimate/aas-secrets`, which will only hand plaintext to a
 * consumer that confirms it captures nothing, and `openSensitiveContext` in
 * ./sensitive.ts, which is the only browser context in this system that can
 * make that confirmation truthfully.
 *
 * ── Why the check is made against the live context ────────────────────────
 *
 * `confirmNoDiagnosticCapture` does not return a flag someone set at
 * construction. It calls `tracingIsForbidden(context)`, which **actually
 * invokes `context.tracing.start()`** and reports whether it threw. So the
 * assertion is a live experiment against the very object that would do the
 * leaking, performed microseconds before the secret is handed over. A context
 * that was sensitive at construction and got swapped for a traced one would
 * fail here rather than at review time.
 *
 * ── What is deliberately different from `fill` ────────────────────────────
 *
 * `fill` reads the value back and compares it, because a portal silently
 * truncating a personal statement is a real and invisible failure. That
 * read-back cannot happen here: `inputValue()` on a password field returns the
 * plaintext into this process's scope, and the comparison — and any error it
 * raised — would be about the secret.
 *
 * So the verification is on SHAPE only: the field must be non-empty
 * afterwards, and its length must match. That catches the failure that matters
 * (the portal took nothing, or truncated it) and reveals nothing beyond what
 * anyone watching the screen already sees.
 */

import type { Locator, Page } from "playwright";

import type { AuditSafeText } from "@askimate/aas-domain";
import { auditLabel } from "@askimate/aas-domain";
import type { SecretClaim, SecretConsumer, SecretStore, SecretUnavailable } from "@askimate/aas-secrets";

import type { FieldLocator } from "@askimate/aas-blueprint";
import { toPlaywrightLocator } from "./playwright-fill-session.js";
import { tracingIsForbidden } from "./sensitive.js";

/**
 * How long to wait for the password field.
 *
 * Short, deliberately. The field's existence is established before the secret
 * is spent, and Playwright's thirty-second default would mean half a minute of
 * a live password sitting in scope waiting for a field that is not coming.
 */
const FIELD_TIMEOUT_MS = 5_000;

/** Raised when something tries to type a secret into a context that could record it. */
export class SecretIntoTracedContextError extends Error {
  public override readonly name = "SecretIntoTracedContextError";
  public constructor() {
    super(
      "Refusing to type a secret into a browser context that has tracing available. Playwright " +
        "writes typed values verbatim into trace.trace, and stopping tracing around the keystroke " +
        "does not prevent it — the action is buffered and replayed into the next trace file. Open " +
        "the context with openSensitiveContext(), which makes tracing throw (ADR-0025).",
    );
  }
}

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
 * A consumer backed by a live, untraced page.
 *
 * The only implementation of `SecretConsumer` in this repository. A boundary
 * test asserts there is no second one on the traced path, because a second
 * implementation that returned `true` unconditionally would quietly undo this.
 */
export function untracedPageConsumer(page: Page, name: AuditSafeText): SecretConsumer {
  return {
    name,
    confirmNoDiagnosticCapture(): boolean {
      // The live experiment, not a flag. `tracingIsForbidden` calls
      // `tracing.start()` and reports whether it threw.
      if (!tracingIsForbidden(page.context())) return false;
      // A context created with `recordVideo` writes a .webm for every page,
      // and a video of a login shows the keystrokes. `page.video()` is null
      // unless recording was requested, so this is a direct check rather than
      // a check on the options we think we passed.
      return page.video() === null;
    },
  };
}

/**
 * Types a secret into a field, spending the handle.
 *
 * Single-use is the store's property, not this function's: `store.use` removes
 * the entry before the callback runs, so a retry needs a new handle and a
 * fresh prompt to the student. That is intentional — a retried password is a
 * password that was wrong, and asking again is the honest response.
 */
export async function fillSecret(input: {
  readonly page: Page;
  readonly store: SecretStore;
  readonly claim: SecretClaim;
  readonly locator: FieldLocator;
  readonly now: Date;
  /** Named for the audit line, e.g. `auditLabel("portal_account_creation_fill")`. */
  readonly consumerName?: AuditSafeText;
}): Promise<
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: SecretUnavailable }
> {
  const { page, locator } = input;

  // Checked here as well as inside `store.use`. The store's check is the one
  // that protects the secret; this one exists so the failure is a loud,
  // specific error at the call site rather than a generic refusal reason —
  // it is a programming mistake, not an ordinary outcome.
  if (!tracingIsForbidden(page.context())) throw new SecretIntoTracedContextError();

  const target: Locator | null = toPlaywrightLocator(page, locator);
  if (target === null) {
    throw new Error(
      `No locator could be built for ${locator.strategy}=${locator.value}, so there is nowhere ` +
        `to type the secret. The handle has NOT been spent.`,
    );
  }

  // ── The field must EXIST before the secret is spent ───────────────────
  //
  // Found by a test that expected a missing field to be reported and got a
  // thirty-second timeout instead. Playwright locators are lazy: building one
  // for a selector that matches nothing succeeds, and the failure only arrives
  // when an action on it times out. The `target === null` check above
  // therefore never fires for a CSS selector.
  //
  // That is not a cosmetic difference. Without this wait the sequence is
  // `store.use` → secret taken → `fill` hangs → timeout, and the student's
  // single-use password has been spent on a field that was never there. They
  // would have to be asked for a new one because of a blueprint mistake.
  //
  // So existence is established first, on a short timeout, OUTSIDE the
  // consumption. A blueprint problem now fails as a blueprint problem.
  try {
    await target.waitFor({ state: "attached", timeout: FIELD_TIMEOUT_MS });
  } catch {
    throw new Error(
      `No field matched ${locator.strategy}=${locator.value} within ` +
        `${String(FIELD_TIMEOUT_MS)}ms, so there is nowhere to type the secret. The handle has ` +
        `NOT been spent — this is a blueprint problem, and the student should not be asked for ` +
        `another password because of one.`,
    );
  }

  const consumer = untracedPageConsumer(
    page,
    input.consumerName ?? auditLabel("untraced_portal_fill"),
  );

  const outcome = await input.store.use(
    input.claim,
    consumer,
    async (secret: string): Promise<void> => {
      // `fill` rather than `type`: one operation, no per-keystroke events, and
      // nothing that a page's own listeners can reconstruct character by
      // character from timing.
      await target.fill(secret, { timeout: FIELD_TIMEOUT_MS });

      // Shape-only verification. `inputValue()` returns the plaintext, so it is
      // measured and discarded inside this callback and never leaves it.
      const stored = (await target.inputValue()).length;
      if (stored !== secret.length) {
        throw new SecretNotAcceptedError(locator, secret.length, stored);
      }
    },
    input.now,
  );

  return outcome.ok ? { ok: true } : { ok: false, reason: outcome.reason };
}
