/**
 * The in-page observation script.
 *
 * Runs inside the browser and returns plain data. It READS the DOM — it does
 * not click, type, focus, or dispatch events. Anything that could change page
 * state belongs to a later capability level, not to discovery.
 *
 * Kept as a standalone function so it can be unit-tested against a fixture
 * without launching a browser.
 */

import type { ObservedField, ObservedForm } from "./session.js";
import type { FieldLocator } from "@askimate/aas-blueprint";

/**
 * Something the page shows that answers a question about the flow.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A SIGNAL IS AN OBSERVATION, NOT A CONCLUSION.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * "There is a script tag from google.com/recaptcha" is a fact. "This portal
 * uses CAPTCHA" is an inference from it — a very good one, but an inference,
 * and it belongs to the specialist reviewing the blueprint rather than to a
 * regex running in a page.
 *
 * So each signal carries the EVIDENCE that produced it. A reviewer reading the
 * discovery output can check every one without re-running anything.
 */
export interface FlowSignal {
  readonly kind:
    | "login"
    | "account_creation"
    | "captcha"
    | "mfa_or_otp"
    | "email_verification"
    | "submission"
    | "payment"
    | "conditional_field";
  /** What was actually seen. A selector, a script host, a label, a phrase. */
  readonly evidence: string;
  /** Where on the page. */
  readonly locator?: FieldLocator;
}

export interface RawObservation {
  readonly forms: readonly ObservedForm[];
  readonly candidateAdvanceControls: readonly FieldLocator[];
  /**
   * What the page shows about how the flow works.
   *
   * The questions a real discovery run has to answer — authentication,
   * account creation, CAPTCHA/MFA/email verification, submission — answered
   * with evidence rather than assumed.
   */
  readonly signals: readonly FlowSignal[];
}

/**
 * Serialised and evaluated in the page context, so it may not close over
 * anything from this module.
 */
export const OBSERVE_SCRIPT = (): RawObservation => {
  const labelFor = (element: Element): string | undefined => {
    const id = element.getAttribute("id");
    if (id !== null) {
      const explicit = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (explicit?.textContent != null) return explicit.textContent.trim();
    }
    const wrapping = element.closest("label");
    if (wrapping?.textContent != null) return wrapping.textContent.trim();
    const aria = element.getAttribute("aria-label");
    return aria ?? undefined;
  };

  const readField = (element: Element): ObservedField => {
    const tagName = element.tagName.toLowerCase();
    const attr = (name: string): string | undefined => element.getAttribute(name) ?? undefined;

    const options =
      tagName === "select"
        ? [...element.querySelectorAll("option")].map((option) => ({
            value: option.getAttribute("value") ?? option.textContent?.trim() ?? "",
            label: option.textContent?.trim() ?? "",
          }))
        : undefined;

    const maxLengthRaw = attr("maxlength");
    const maxLength = maxLengthRaw === undefined ? undefined : Number(maxLengthRaw);

    const field: Record<string, unknown> = {
      tagName,
      required: element.hasAttribute("required") || element.getAttribute("aria-required") === "true",
    };
    const name = attr("name");
    if (name !== undefined) field["name"] = name;
    const id = attr("id");
    if (id !== undefined) field["id"] = id;
    const label = labelFor(element);
    if (label !== undefined) field["label"] = label;
    const type = attr("type");
    if (type !== undefined) field["type"] = type;
    const placeholder = attr("placeholder");
    if (placeholder !== undefined) field["placeholder"] = placeholder;
    if (maxLength !== undefined && Number.isFinite(maxLength)) field["maxLength"] = maxLength;
    const pattern = attr("pattern");
    if (pattern !== undefined) field["pattern"] = pattern;
    const accept = attr("accept");
    if (accept !== undefined) field["accept"] = accept;
    if (options !== undefined) field["options"] = options;

    return field as unknown as ObservedField;
  };

  const forms: ObservedForm[] = [...document.querySelectorAll("form")].map((form, index) => {
    const observed: Record<string, unknown> = {
      formIndex: index,
      fields: [...form.querySelectorAll("input, select, textarea")]
        // Hidden inputs and CSRF tokens are machinery, not questions asked of
        // the student, so they are not part of the blueprint's field list.
        .filter((element) => element.getAttribute("type") !== "hidden")
        .map(readField),
    };
    const action = form.getAttribute("action");
    if (action !== null) observed["action"] = action;
    const method = form.getAttribute("method");
    if (method !== null) observed["method"] = method;
    return observed as unknown as ObservedForm;
  });

  // Controls that plausibly advance a flow. Candidates only — which one really
  // advances is a decision for the reviewing specialist, not for a heuristic.
  const advanceWords = /\b(next|continue|proceed|save and continue|start|apply|begin)\b/i;
  const candidateAdvanceControls: FieldLocator[] = [
    ...document.querySelectorAll("button, a[href], input[type=submit], input[type=button]"),
  ]
    .filter((element) => {
      const text = (element.textContent ?? "") + " " + (element.getAttribute("value") ?? "");
      return advanceWords.test(text);
    })
    .slice(0, 20)
    .map((element) => {
      const id = element.getAttribute("id");
      if (id !== null) return { strategy: "id" as const, value: id };
      const text = (element.textContent ?? element.getAttribute("value") ?? "").trim();
      return { strategy: "label" as const, value: text };
    });

  // ── Flow signals ────────────────────────────────────────────────────────
  //
  // Everything here is a READ. The point is to answer, with evidence, the
  // questions that decide whether the authentication model in ADR-0020 fits
  // this portal at all.
  const signals: FlowSignal[] = [];
  const seen = new Set<string>();
  const add = (kind: FlowSignal["kind"], evidence: string, locator?: FieldLocator): void => {
    const key = `${kind}:${evidence}`;
    if (seen.has(key) || signals.length >= 200) return;
    seen.add(key);
    signals.push(locator === undefined ? { kind, evidence } : { kind, evidence, locator });
  };

  const pageText = (document.body.textContent ?? "").replace(/\s+/g, " ");

  // Password fields are the least ambiguous evidence of authentication there
  // is, and they distinguish a login from a registration by their count: a
  // sign-up form usually asks twice.
  const passwords = [...document.querySelectorAll("input[type=password]")];
  for (const field of passwords) {
    const name = field.getAttribute("name") ?? field.getAttribute("id") ?? "password";
    add("login", `input[type=password] name="${name}"`, { strategy: "name", value: name });
  }
  if (passwords.length >= 2) {
    add("account_creation", `${String(passwords.length)} password fields on one page (confirm-password pattern)`);
  }

  // CAPTCHA leaves a very specific footprint: a third-party script or iframe.
  const captchaHosts = ["recaptcha", "hcaptcha", "turnstile", "friendlycaptcha", "arkoselabs"];
  for (const element of [...document.querySelectorAll("script[src], iframe[src]")]) {
    const src = element.getAttribute("src") ?? "";
    const match = captchaHosts.find((host) => src.toLowerCase().includes(host));
    if (match !== undefined) add("captcha", `${element.tagName.toLowerCase()} src contains "${match}": ${src.slice(0, 160)}`);
  }
  for (const element of [...document.querySelectorAll("[class*=captcha], [id*=captcha], [data-sitekey]")]) {
    add("captcha", `element ${element.tagName.toLowerCase()} with captcha marker: ${(element.getAttribute("class") ?? element.getAttribute("id") ?? "data-sitekey").slice(0, 80)}`);
  }

  // One-time codes: autocomplete="one-time-code" is the standard hint, and
  // the wording is distinctive enough to be worth recording as a phrase.
  for (const field of [...document.querySelectorAll("input[autocomplete='one-time-code'], input[name*=otp], input[name*=code], input[id*=otp]")]) {
    const name = field.getAttribute("name") ?? field.getAttribute("id") ?? "code";
    add("mfa_or_otp", `one-time-code style input name="${name}"`, { strategy: "name", value: name });
  }
  for (const phrase of ["verification code", "authentication code", "two-factor", "2-step", "authenticator app", "one-time passcode", "security code"]) {
    if (pageText.toLowerCase().includes(phrase)) add("mfa_or_otp", `page text contains "${phrase}"`);
  }

  for (const phrase of ["verify your email", "confirm your email", "check your inbox", "verification email", "we have sent you an email", "activation link"]) {
    if (pageText.toLowerCase().includes(phrase)) add("email_verification", `page text contains "${phrase}"`);
  }

  for (const phrase of ["create an account", "register", "sign up", "new applicant", "create your account"]) {
    if (pageText.toLowerCase().includes(phrase)) add("account_creation", `page text contains "${phrase}"`);
  }

  // Submission controls. Recorded so preparation's network guard can refuse
  // the endpoint, and so the click guard has something to be pointed at.
  const submitWords = /\b(submit|send (my )?application|confirm and send|finish and send|complete application|pay and submit)\b/i;
  for (const element of [...document.querySelectorAll("button, input[type=submit], a[href]")]) {
    const text = ((element.textContent ?? "") + " " + (element.getAttribute("value") ?? "")).trim();
    if (!submitWords.test(text)) continue;
    const id = element.getAttribute("id");
    add(
      "submission",
      `control reading "${text.slice(0, 80)}"`,
      id === null ? { strategy: "label", value: text.slice(0, 80) } : { strategy: "id", value: id },
    );
  }

  for (const phrase of ["application fee", "card payment", "pay now", "payment details"]) {
    if (pageText.toLowerCase().includes(phrase)) add("payment", `page text contains "${phrase}"`);
  }

  // Conditional logic: fields the page itself marks as conditional, or that
  // are present but hidden. Both are evidence that what a student sees depends
  // on what they answered.
  for (const element of [...document.querySelectorAll("[data-conditional], [data-depends-on], [data-show-if], [aria-controls]")]) {
    const name = element.getAttribute("name") ?? element.getAttribute("id") ?? element.tagName.toLowerCase();
    add("conditional_field", `${name} carries a conditional attribute`);
  }
  for (const element of [...document.querySelectorAll("input[name], select[name], textarea[name]")]) {
    const style = element.getAttribute("style") ?? "";
    const hidden =
      element.getAttribute("hidden") !== null ||
      element.getAttribute("aria-hidden") === "true" ||
      /display:\s*none|visibility:\s*hidden/i.test(style);
    if (hidden) {
      add("conditional_field", `${element.getAttribute("name") ?? "?"} is present but hidden`);
    }
  }

  return { forms, candidateAdvanceControls, signals };
};
