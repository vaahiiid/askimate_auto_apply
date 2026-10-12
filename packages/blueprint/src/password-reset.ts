/**
 * A portal's "Forgot password", recognised (P301).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-10-12 (docs/run-a/p301-his-auth7-as-sent.txt), having tried it on
 * Sheffield on the account used for the reads: *"The run must never press
 * "Forgot password" itself: it silently replaces the student's password and
 * puts a new one in their inbox in plain text."*
 *
 * His sentence names the run, not a portal, so this holds on every portal: the
 * run has no work that needs a password reset (`WORK_KINDS` has none), and a
 * reset pressed by mistake can cost a student their password. What a reset
 * DOES is Sheffield's, as he observed it; another portal's may differ. The test
 * is wide on purpose. A false positive costs a review; a false negative can
 * replace a student's password — the asymmetry `SUBMISSION_NAMES` is drawn on.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Two readings, because neither is enough alone:
 *
 *   - the URL: a navigation, a form's action, a link's href, a request. Catches
 *     Sheffield's `forgottenPassword.do` and Salesforce's `/s/login/ForgotPassword`
 *     whatever the button on the page says — Sheffield's reset button is a plain
 *     "Send" (`name=sendBtn`), which no name check would ever catch;
 *   - the words: a control's accessible name or identifier. Catches the link
 *     itself ("Forgotten Password") before anything is requested.
 *
 * What it cannot see: a reset reached through a URL and words that say
 * neither, such as "Trouble signing in?" pointing at an opaque path. A miss
 * here is not evidence of safety; it is why the rule is also stated on every
 * press and every request rather than at one of them.
 *
 * Pure, and here beside the blueprint because two places hold to it, and each
 * refusal is LOUD:
 *
 *   - the catalogue refuses an entry whose pages, sign-in or presses are a
 *     reset (`parseReviewedEntry`), so a reviewer meets it at review, before
 *     any signature;
 *   - the runner refuses a press or a request that reaches one and reports a
 *     named failure with a line saying why (the browser runner's
 *     password-reset-guard.ts).
 *
 * Not at the runner's intake: a work item the intake cannot parse reads as "no
 * work this time round", the lease expires and the item is offered again, so a
 * refusal there would be silent. P301's first build put one there; its review
 * caught it (CLAUDE.md: a check that reports nothing is not a check).
 */

/**
 * A path or query that reads as a password reset — either word order, with a
 * hyphen, an underscore or a slash between (P301's review: `/password/reset`,
 * a framework's default, and `/password-recovery` were missed).
 */
const RESET_IN_URL = /forgot|reset[-_/]?pass|pass(?:word)?[-_/]?(?:reset|recover)|lost[-_/]?pass|recover(?:y)?[-_/]?pass/iu;

/**
 * Words that read as a password reset: a control's name, text or identifier,
 * read after `-`, `_`, `.` and `#` are taken as spaces (P301's review: an id
 * `reset-password` was not read as one). The last alternative is the words of
 * a reset that sends a new password, as Sheffield's does.
 */
const RESET_IN_WORDS =
  /forgot|reset\s*(?:your\s*|my\s*|the\s*)?pass(?:word)?|pass(?:word)?\s*(?:reset|recover)|lost\s*(?:your\s*|my\s*)?pass(?:word)?|recover\s*(?:your\s*|my\s*)?pass(?:word)?|(?:request|send|e\s*mail|get)\s+(?:me\s+)?(?:a\s+)?new\s+pass(?:word)?/iu;

/**
 * Whether a URL is, or submits to, a portal's password reset.
 *
 * Reads the path and the query, decoded, so `/s/login/ForgotPassword`,
 * `/forgottenPassword.do` and `?action=resetPassword` are all caught. The host
 * is not read: a reset on any host is a reset.
 */
export function isPasswordResetUrl(url: string): boolean {
  let tail = url;
  try {
    const parsed = new URL(url);
    tail = `${parsed.pathname}${parsed.search}`;
  } catch {
    // Not absolute: read what was given, so a relative action is still read.
  }
  try {
    tail = decodeURIComponent(tail);
  } catch {
    // Malformed escapes: read it undecoded rather than not at all.
  }
  return RESET_IN_URL.test(tail);
}

/** Whether a control's name, text or identifier reads as a password reset. */
export function readsAsPasswordReset(words: string): boolean {
  return RESET_IN_WORDS.test(words.replace(/[-_.#]+/gu, " ").replace(/\s+/gu, " "));
}

/** Why a reset is refused, in his words, for every refusal that names one. */
export const PASSWORD_RESET_REFUSAL =
  `the run never presses a portal's "Forgot password": Vahid, 2026-10-12, "it silently replaces ` +
  `the student's password and puts a new one in their inbox in plain text"`;
