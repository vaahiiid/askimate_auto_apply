/**
 * What the runner is allowed to say about a thrown error, and how a turn is
 * announced (ADR-0124, P157).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Run A stopped at the sign-in twice, with `runner_fault` both times, and the
 * runner's whole account of it on disk was two words: `turn: worked`. Every
 * failure site in the sign-in path was a BARE `catch {` that did not even
 * bind the error, so there was nothing to print even had there been a logger.
 *
 * Vahid, 2026-09-18: *"Whatever it does between 'turn' and 'worked', none of
 * it is on disk, and that is the first thing I would fix before trying again
 * — not the connection, the silence."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why this is a VOCABULARY and not a scrubber ────────────────────────────
 *
 * A scrubber decides what to remove; this decides what may be said. The
 * difference matters because the thing being described is a browser error
 * from a page we do not control: its message can carry the page's text, a
 * URL with a one-time token in the query, or a whole request body. A regular
 * expression that strips "the bits that look like URLs" is a guess about
 * every message it has not seen, and the cost of the guess being wrong is a
 * credential in a log file.
 *
 * So: a message is matched against a closed set of PATTERNS, and what gets
 * printed is the phrase written HERE for that pattern — never any part of the
 * thrown text. A message matching nothing is withheld entirely, and the line
 * says it was withheld rather than pretending the error had nothing to say.
 * Vahid, 2026-09-18: *"I would rather it were strict than useful… A URL with
 * a token in a log is a worse outcome than a log I cannot read."*
 *
 * This is the same discipline `SecureLogger` already holds for the Secure
 * Plane, which permits an `errorClass` and forbids a message outright. This
 * module is the Automation Runner's version of it, one step less strict in
 * exactly one place: a recognised pattern may add a phrase of OUR words.
 *
 * The one datum quoted from a message is a Chromium network code
 * (`ERR_CONNECTION_RESET` and its siblings): a fixed enum from the browser
 * engine, which names no page, no host and no value, and which is the single
 * most useful fact about a failed navigation.
 */

import type { TurnResult } from "./work-intake.js";

/** What a thrown value may be said to be. */
export interface ThrownDescription {
  /** The constructor's name, or the primitive's type. Never a message. */
  readonly errorClass: string;
  /** Our words for a recognised pattern, or `null` when nothing matched. */
  readonly phrase: string | null;
  /** True when a message existed and none of it could be said. */
  readonly withheld: boolean;
}

/**
 * The patterns this module can recognise, and our phrase for each.
 *
 * Ordered: the first match wins, so a more specific pattern precedes a more
 * general one. Adding one is a deliberate act — the phrase is what a person
 * reads at three in the morning, and it must be true of every message the
 * pattern matches, not just the one that prompted it.
 */
const RECOGNISED: readonly { readonly pattern: RegExp; readonly phrase: string }[] = [
  {
    // The leading hypothesis Run A left open, and deliberately NOT fixed
    // before the log could confirm it. Vahid: *"One attempt with a real error
    // message is worth more than a fix that might be right."*
    pattern: /execution context was destroyed|navigating and changing the content/i,
    phrase: "the page navigated while the step was running",
  },
  {
    pattern: /target (page|frame|browser)?,? ?(context )?closed|target closed/i,
    phrase: "the page or the browser closed under the step",
  },
  {
    pattern: /timeout \d+ ?ms exceeded|navigation timeout|waiting for .* exceeded/i,
    phrase: "the step timed out",
  },
  {
    pattern: /browser has been closed|browser has disconnected|websocket error|connection closed/i,
    phrase: "the link to the browser dropped",
  },
  {
    pattern: /frame was detached|detached from the dom|element is not attached/i,
    phrase: "the element left the page before the step finished",
  },
];

/**
 * Which of Playwright's actionability checks a failed press was waiting on
 * (ADR-0129). Playwright's OWN fixed phrases, not the page's: the message is
 * matched against this closed set and our word is printed, never a slice.
 * The one datum a click failure carries that names the obstacle — "<div …>
 * intercepts pointer events" — is NOT quoted; the element is read from the
 * page's structure instead, by `stackAtPoint`.
 */
const PRESS_CHECKS: readonly { readonly pattern: RegExp; readonly phrase: string }[] = [
  { pattern: /intercepts pointer events/i, phrase: "another element intercepts pointer events" },
  { pattern: /element is not visible/i, phrase: "the button is not visible" },
  { pattern: /outside of the viewport/i, phrase: "the button is outside the viewport" },
  { pattern: /element is not enabled/i, phrase: "the button is not enabled" },
  { pattern: /element is not stable/i, phrase: "the button is not stable — it keeps moving" },
];

/** What a failed press was waiting on, in our words, or that the log does not name it. */
export function pressCheckInWords(thrown: unknown): string {
  const message = thrown instanceof Error ? thrown.message : "";
  for (const check of PRESS_CHECKS) {
    if (check.pattern.test(message)) return check.phrase;
  }
  return "a check this log does not name";
}

export const PRESS_CHECK_PHRASES: readonly string[] = PRESS_CHECKS.map((check) => check.phrase);

/** A Chromium network code: a closed enum, naming no page and no value. */
const NETWORK_CODE = /\b(ERR_[A-Z0-9_]{3,40})\b/;

/**
 * Every fixed phrase this module can print, for the test that holds the rule
 * that none of them can carry a URL, a token or an address.
 */
export const RECOGNISED_PHRASES: readonly string[] = RECOGNISED.map((entry) => entry.phrase);

/** The class of a thrown value, without reading anything it holds. */
function classOf(thrown: unknown): string {
  if (thrown === null) return "Null";
  if (thrown === undefined) return "Undefined";
  if (thrown instanceof Error) return thrown.name;
  const primitive = typeof thrown;
  return primitive.charAt(0).toUpperCase() + primitive.slice(1);
}

/**
 * What may be said about a thrown value.
 *
 * Note what this does NOT do: it never returns any slice, prefix, first line
 * or redacted form of the message. Either a pattern matched and the phrase is
 * ours, or nothing is said at all.
 */
export function describeThrown(thrown: unknown): ThrownDescription {
  const errorClass = classOf(thrown);
  const message = thrown instanceof Error ? thrown.message : "";
  if (message === "") {
    // Nothing to withhold when there was nothing to say. A non-Error carries
    // no message this module will read, so it is withheld by definition.
    return { errorClass, phrase: null, withheld: true };
  }

  for (const entry of RECOGNISED) {
    if (entry.pattern.test(message)) return { errorClass, phrase: entry.phrase, withheld: false };
  }

  const network = NETWORK_CODE.exec(message);
  if (network?.[1] !== undefined) {
    return { errorClass, phrase: `the network failed: ${network[1]}`, withheld: false };
  }

  return { errorClass, phrase: null, withheld: true };
}

/** One line's worth of what a thrown value may be said to be. */
export function thrownInWords(thrown: unknown): string {
  const said = describeThrown(thrown);
  return said.withheld
    ? `${said.errorClass} (message withheld: it matched nothing this runner may repeat)`
    : `${said.errorClass}: ${said.phrase ?? ""}`;
}

/**
 * What a finished turn is called in the log (ADR-0124).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Before this the runner printed `turn: worked`, where "worked" meant "a turn
 * ran" and not "it succeeded" — so a sign-in that failed twice against a live
 * portal and a sign-in that succeeded produced the same two words. Vahid,
 * 2026-09-18: *"A word that means the same thing for a successful sign-in and
 * a failed one is worse than no word."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `null` for an idle turn, which is the runner finding nothing to do and is
 * not worth a line at a poll a second.
 *
 * Every word here is ours or a closed-set code from the wire contract. The
 * report carries no free text, by the compile-time constraint on it.
 */
export function turnInWords(result: TurnResult): string | null {
  // The REAL turn type, not a look-alike: a new turn kind is then a compile
  // error here rather than a line that silently says nothing.
  if (result.kind === "idle") return null;
  const run = `run ${result.runId}`;
  if (result.kind === "report_refused") {
    return `${run}: the work was done and the plane would not accept the report`;
  }
  const report = result.report;
  if (report.outcome === "succeeded") return `${run}: sign-in/work succeeded`;
  const code = report.failure ?? "no code";
  return `${run}: ${report.outcome} (${code})`;
}

/**
 * The line a sign-in writes BEFORE it opens anything (ADR-0124).
 *
 * Vahid, 2026-09-18: *"a line at the start of each sign-in attempt, not only
 * at the end: which attempt, which URL, when. If the runner dies mid-attempt,
 * I want to know it started."* Run A's runner died (in the sense of returning
 * a fault) inside an attempt twice, and nothing on disk said an attempt had
 * begun at all.
 *
 * The URL is a REVIEWED blueprint fact — the login page named in the entry
 * Vahid signed — not a URL from a page, so it carries no token and is the one
 * thing that makes the line worth reading. The attempt is the plane's count,
 * carried on the work item; when an older plane sends none, the line says the
 * attempt is unknown rather than defaulting to a number that would be wrong
 * on the second try.
 */
export function signInStartLine(input: {
  readonly runId: string;
  readonly attempt?: number;
  readonly url: string;
}): string {
  const attempt = input.attempt === undefined ? "attempt unknown" : `attempt ${String(input.attempt)}`;
  return `run ${input.runId}: sign-in ${attempt}, starting, opening ${input.url}`;
}
