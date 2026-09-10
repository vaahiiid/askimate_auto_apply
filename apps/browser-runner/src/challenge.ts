/**
 * A page asking for something only a person can pass — a CAPTCHA, a second
 * factor — detected before the runner does anything it cannot undo.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ADR-0101 §6 — Vahid, 2026-09-10: *"If a runner meets a CAPTCHA or a second
 * factor where A expects neither, it must stop and say which it met, not fail
 * as a fill error. That refusal is the signal that moves C from deferred to
 * needed, and I would rather it arrive as a stated refusal than as a confusing
 * failure months from now."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Narrower than discovery's signals, on purpose ─────────────────────────
 *
 * `observe-script.ts` records `captcha` and `mfa_or_otp` SIGNALS with their
 * evidence, for a specialist to read. A signal there may be wrong and costs
 * nothing: a person weighs it. A signal HERE stops a live run against a real
 * portal, so it may not be wrong in the direction of firing on an ordinary
 * form. Discovery's `input[name*=code]` matches a postcode box; a runner that
 * stopped every UK address page and called it a second factor would be
 * refusing to fill. So this detector keeps discovery's vocabulary and drops
 * its loosest rules:
 *
 *   captcha        a WIDGET or its response field — `.g-recaptcha`,
 *                  `.h-captcha`, `.cf-turnstile`, `[data-sitekey]`, an iframe
 *                  from a CAPTCHA host, or the hidden response textarea/input
 *                  the widget writes to. Not a bare script tag: a v3 script
 *                  that scores silently is not a challenge the page shows.
 *   second_factor  `autocomplete="one-time-code"`; a name or id that IS an
 *                  otp/mfa/totp/2fa/passcode/verification-code field rather
 *                  than one that merely contains "code"; or a text input whose
 *                  own label says verification/authentication/security code,
 *                  two-factor, 2-step or authenticator.
 *
 * The asymmetry is deliberate: a challenge this misses fails the way it
 * always did (drift, refusal), and one it sees stops with the reason named.
 *
 * ── What crosses ──────────────────────────────────────────────────────────
 *
 * The CODE. Not the evidence, not the page text, not a selector: the runner
 * reports `captcha_met` or `second_factor_met` and nothing about the page,
 * because a work report is a durable record in a plane the portal's page must
 * not be able to write into (ADR-0045 §4). The evidence stays in this process.
 */

import type { Page } from "playwright";

import type { WorkFailure } from "@askimate/aas-contracts";

export type Challenge = "captcha" | "second_factor";

/** A probe the fill path calls on the page it is about to type into. */
export type ChallengeProbe = () => Promise<Challenge | null>;

/**
 * Serialised and evaluated in the page context, so it may not close over
 * anything from this module. Returns the first challenge found, CAPTCHA first:
 * a page with both is a page a person has to pass either way, and the CAPTCHA
 * is the one no relay of a code can help with.
 */
export const CHALLENGE_SCRIPT = (): "captcha" | "second_factor" | null => {
  const captchaHosts = ["recaptcha", "hcaptcha", "turnstile", "friendlycaptcha", "arkoselabs"];
  for (const frame of [...document.querySelectorAll("iframe[src]")]) {
    const src = (frame.getAttribute("src") ?? "").toLowerCase();
    if (captchaHosts.some((host) => src.includes(host))) return "captcha";
  }
  const widget = document.querySelector(
    ".g-recaptcha, .h-captcha, .cf-turnstile, .frc-captcha, [data-sitekey], " +
      "textarea[name='g-recaptcha-response'], input[name='g-recaptcha-response'], " +
      "textarea[name='h-captcha-response'], input[name='h-captcha-response'], " +
      "input[name='cf-turnstile-response']",
  );
  if (widget !== null) return "captcha";

  const secondFactorName =
    /^(otp|one[-_]?time[-_]?(code|passcode|password)|mfa[-_]?(code)?|totp|2fa|two[-_]?factor|passcode|verification[-_]?code|verify[-_]?code|auth(entication)?[-_]?code|security[-_]?code)$/i;
  const secondFactorLabel =
    /(verification|authentication|security|one[- ]time) code|two[- ]factor|2[- ]step|authenticator/i;
  const labelFor = (element: Element): string => {
    const id = element.getAttribute("id");
    if (id !== null) {
      const explicit = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (explicit?.textContent != null) return explicit.textContent.trim();
    }
    const wrapping = element.closest("label");
    return wrapping?.textContent?.trim() ?? "";
  };
  for (const field of [...document.querySelectorAll("input, textarea")]) {
    const type = (field.getAttribute("type") ?? "text").toLowerCase();
    if (type === "hidden" || type === "submit" || type === "button" || type === "checkbox") continue;
    if ((field.getAttribute("autocomplete") ?? "").toLowerCase() === "one-time-code") {
      return "second_factor";
    }
    const name = field.getAttribute("name") ?? "";
    const id = field.getAttribute("id") ?? "";
    if (secondFactorName.test(name) || secondFactorName.test(id)) return "second_factor";
    if (secondFactorLabel.test(labelFor(field))) return "second_factor";
  }
  return null;
};

/** Reads the page. Types nothing, clicks nothing, remembers nothing. */
export async function detectChallenge(page: Page): Promise<Challenge | null> {
  return await page.evaluate(CHALLENGE_SCRIPT);
}

/** The code that crosses for a challenge. Total, so a third kind is a compile error. */
export function challengeFailure(challenge: Challenge): WorkFailure {
  const codes: Readonly<Record<Challenge, WorkFailure>> = {
    captcha: "captcha_met",
    second_factor: "second_factor_met",
  };
  return codes[challenge];
}
