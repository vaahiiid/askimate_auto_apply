/**
 * What stands at a control's point, in words a log may carry (ADR-0129).
 *
 * The one read the runner makes at the moment a press fails, shared by the
 * sign-in (P162) and the fill (P163): resolve the control, read the layer
 * stack at its centre with the text left out, and say it in one clause.
 * Structure only — tag, id, classes, position, box — because the line goes to
 * a log and a page's text is the one thing a runner log must never carry.
 */

import type { FieldLocator } from "@askimate/aas-blueprint";
import { toPlaywrightLocator } from "@askimate/aas-browser-fill";
import type { Page } from "playwright";

import { layerInWords, stackAtPoint } from "./point-read.js";

/** How long the read waits for the control to still be on the page. */
const CONTROL_HANDLE_TIMEOUT_MS = 1_000;

/**
 * One of exactly three clauses: the stack, top-most first down to the control;
 * that nothing was at the point; or that the point could not be read at all
 * (the control gone, the page closed). Never throws, because it runs inside
 * a catch that already has a failure to report.
 */
export async function atPointInWords(page: Page, locator: FieldLocator): Promise<string> {
  const control = toPlaywrightLocator(page, locator);
  if (control === null) return "the point could not be read";
  const handle = await control.elementHandle({ timeout: CONTROL_HANDLE_TIMEOUT_MS }).catch(() => null);
  if (handle === null) return "the point could not be read";
  const point = await stackAtPoint(handle, { withText: false }).catch(() => null);
  if (point === null) return "the point could not be read";
  if (point.layers.length === 0) return "nothing at the button's point";
  return `at the button's point: ${point.layers.map(layerInWords).join(" > ")}`;
}

/**
 * The same read, said the other way round, for the two moments a press has
 * NOT failed (ADR-0130): as the page opens, and just before the press. Names
 * what is OVER the control — the layers above it, top-most first — or that
 * nothing is, with the control's own box so a later reading of the same
 * button can be compared to it. The failed-press clause above is unchanged.
 */
export async function overControlInWords(page: Page, locator: FieldLocator, name: string): Promise<string> {
  const control = toPlaywrightLocator(page, locator);
  if (control === null) return `the ${name}'s point could not be read`;
  const handle = await control.elementHandle({ timeout: CONTROL_HANDLE_TIMEOUT_MS }).catch(() => null);
  if (handle === null) return `the ${name}'s point could not be read`;
  const point = await stackAtPoint(handle, { withText: false }).catch(() => null);
  if (point === null) return `the ${name}'s point could not be read`;
  const own = point.layers.at(-1);
  if (own === undefined) return `nothing at the ${name}'s point`;
  const above = point.layers.slice(0, -1);
  return point.covered && above.length > 0
    ? `over the ${name}: ${above.map(layerInWords).join(" > ")}`
    : `nothing over the ${name} (${layerInWords(own)})`;
}

