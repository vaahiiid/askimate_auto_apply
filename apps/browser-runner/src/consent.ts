/**
 * A portal's consent notice, answered only with the student's own choice
 * (ADR-0131, P169) — shared by the sign-in and, since ADR-0144, the account
 * creation, because on Sheffield they are one page and one notice.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-09-18: *"a cookie choice is a choice made on the student's
 * account, in their name."* So nothing here presses a consent control unless
 * the work item carries the student's recorded choice, and what it presses is
 * the path the reviewed entry names — in order, and nothing else. What Vahid
 * refused was *"the runner learning to click things away"*, and a sequence
 * that improvises is exactly that.
 *
 * The press is not the evidence; the portal's own record is (P169, the third
 * shape). What a consent control records is set by configuration nobody
 * outside the portal can see, so the record is read back and the step stops
 * when it disagrees.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The lines said here count controls and clauses; they never carry a control's
 * words, which are page text (ADR-0124).
 */

import type { FieldLocator } from "@askimate/aas-blueprint";
import { toPlaywrightLocator } from "@askimate/aas-browser-fill";
import type { LoginConsent } from "@askimate/aas-contracts";
import type { Page } from "playwright";

import { thrownInWords } from "./runner-log.js";
import type { PerformOutcome } from "./work-intake.js";

/** How long to wait for a control. Portals are slow; students wait. */
const STEP_TIMEOUT_MS = 15_000;

/**
 * The notice as the work item carries it: every choice as the controls that
 * make it, and the student's recorded choice with what the portal must record
 * for it (ADR-0131).
 */
export interface ConsentTargets {
  /** Each choice as the controls that make it. The FIRST of each tells the notice from anything else. */
  readonly choices: readonly (readonly FieldLocator[])[];
  /** The student's recorded choice: the path to press, and what the portal must record for it. */
  readonly chosen?: {
    readonly steps: readonly FieldLocator[];
    readonly verify: ConsentRecordCheck;
  };
}

export interface ConsentRecordCheck {
  readonly cookie: string;
  readonly mustHold: readonly {
    readonly path: readonly string[];
    readonly present: boolean;
    readonly equals?: string | boolean;
  }[];
}

/**
 * The notice as the wire carries it, as the runner presses it. Both or
 * neither for the chosen path: the contract's parser already refuses a chosen
 * path with no read-back, and this is the second place that pairing has to
 * hold, where the pressing happens.
 */
export function consentTargetsOf(consent: LoginConsent): ConsentTargets {
  const chosen = consent.choices.find((choice) => choice.id === consent.chosen);
  return {
    choices: consent.choices.map((choice) => choice.steps),
    ...(chosen === undefined || consent.verify === undefined
      ? {}
      : { chosen: { steps: chosen.steps, verify: consent.verify } }),
  };
}

/**
 * Whether the notice is on the page right now: the first control of any of its
 * choices is. What tells the notice from any other obstacle over a button.
 */
export async function consentNoticeOnThePage(page: Page, consent: ConsentTargets): Promise<boolean> {
  const first = consent.choices.flatMap((steps) => (steps[0] === undefined ? [] : [steps[0]]));
  return (await firstPresent(page, first)) !== null;
}

/**
 * Presses the student's recorded path, in order, and reads the portal's record
 * back. `null` when the record agrees with the choice; otherwise the outcome
 * the step stops with, every line already said.
 *
 * `doing` is the word the lines open with — `sign-in` or `account creation` —
 * so a log reads as the step it belongs to.
 */
export async function pressConsentPath(
  page: Page,
  input: {
    readonly runId: string;
    readonly doing: "sign-in" | "account creation";
    readonly chosen: NonNullable<ConsentTargets["chosen"]>;
    readonly pressMs: number;
    readonly say: (line: string) => void;
  },
): Promise<PerformOutcome | null> {
  const { chosen, doing, say } = input;
  let pressed = 0;
  for (const [index, step] of chosen.steps.entries()) {
    const control = await resolve(page, step);
    if (control === null) {
      say(
        `run ${input.runId}: ${doing} stopped — the consent notice is on the page but step ` +
          `${String(index + 1)} of ${String(chosen.steps.length)} of the student's choice is not; ` +
          `${String(pressed)} pressed, nothing else tried`,
      );
      return { kind: "failed", failure: "consent_not_recorded" };
    }
    try {
      await control.click({ timeout: input.pressMs });
      pressed += 1;
    } catch (again) {
      say(
        `run ${input.runId}: ${doing} stopped — the student's consent choice could not be made at step ` +
          `${String(index + 1)} of ${String(chosen.steps.length)} — ${thrownInWords(again)}`,
      );
      return { kind: "failed", failure: "consent_not_recorded" };
    }
  }
  say(
    `run ${input.runId}: ${doing}: the consent notice was answered with the student's recorded choice — ` +
      `${String(pressed)} control(s) pressed, in the order the entry names`,
  );

  // ── The read-back: a measured state, not a trusted press ──────────────
  const record = await consentRecordHolds(page, chosen.verify);
  if (!record.read) {
    say(
      `run ${input.runId}: ${doing} stopped — the student's consent choice was made and the portal's ` +
        `record could not be read, so nothing is claimed about what it says`,
    );
    return { kind: "failed", failure: "consent_not_recorded" };
  }
  if (record.held !== record.total) {
    say(
      `run ${input.runId}: ${doing} stopped — the student's consent choice was made and the portal's ` +
        `record does not say what they chose: ${String(record.held)} of ${String(record.total)} checks held`,
    );
    return { kind: "failed", failure: "consent_not_recorded" };
  }
  say(
    `run ${input.runId}: ${doing}: the portal's record agrees with the student's choice — ` +
      `${String(record.total)} of ${String(record.total)} checks held`,
  );
  return null;
}

/**
 * What the portal's own consent record says, against what the signed entry
 * says it must say (ADR-0131, P169).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * The whole of the third shape is here. What a consent control records is set
 * by configuration nobody outside the portal can see; on Sheffield it was
 * observed once, on one account, on one day, and it can change without the
 * button changing. So the press is not the evidence — this is. Presence and,
 * where the entry asks for it, an exact value: never truthiness, because a
 * record that says `"revoked"` says it in a truthy string.
 *
 * Counts come back, never content. The record belongs to the portal and the
 * student; what crosses into a log is how many of the reviewer's own clauses
 * held.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export async function consentRecordHolds(
  page: Page,
  check: ConsentRecordCheck,
): Promise<{ readonly read: boolean; readonly held: number; readonly total: number }> {
  const total = check.mustHold.length;
  const cookies = await page
    .context()
    .cookies()
    .catch(() => []);
  const found = cookies.find((cookie) => cookie.name === check.cookie);
  if (found === undefined) return { read: false, held: 0, total };
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeURIComponent(found.value));
  } catch {
    return { read: false, held: 0, total };
  }
  let held = 0;
  for (const clause of check.mustHold) {
    let cursor: unknown = parsed;
    let exists = true;
    for (const key of clause.path) {
      if (typeof cursor !== "object" || cursor === null || !Object.prototype.hasOwnProperty.call(cursor, key)) {
        exists = false;
        break;
      }
      cursor = (cursor as Record<string, unknown>)[key];
    }
    if (exists !== clause.present) continue;
    if (clause.equals !== undefined && cursor !== clause.equals) continue;
    held += 1;
  }
  return { read: true, held, total };
}

/** The first of the locators that is on the page right now, or `null` (ADR-0131). */
export async function firstPresent(page: Page, locators: readonly FieldLocator[]): Promise<FieldLocator | null> {
  for (const locator of locators) {
    const found = toPlaywrightLocator(page, locator);
    if (found === null) continue;
    if ((await found.count().catch(() => 0)) > 0) return locator;
  }
  return null;
}

/** A locator that exists on the page right now, or `null`. */
async function resolve(page: Page, locator: FieldLocator): Promise<ReturnType<Page["locator"]> | null> {
  const found = toPlaywrightLocator(page, locator);
  if (found === null) return null;
  try {
    await found.waitFor({ state: "attached", timeout: STEP_TIMEOUT_MS });
  } catch {
    return null;
  }
  return found;
}
