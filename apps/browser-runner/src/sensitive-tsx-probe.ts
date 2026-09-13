/**
 * A probe run under `tsx`, the launcher the runbook starts the runner with:
 * opens a sensitive context the way the runner's account creation does and
 * reads the page for a challenge. Prints the detector's answer as JSON, or the
 * error's message. Driven by `sensitive-under-tsx.test.ts`; not an entry point.
 */

import { chromium } from "playwright";

import { detectChallenge } from "./challenge.js";
import { openSensitiveContext } from "./sensitive.js";

const browser = await chromium.launch({ headless: true });
try {
  const context = await openSensitiveContext(browser, { userAgent: "AskiMate-Probe/1.0" });
  const page = await context.newPage();
  await page.setContent(
    '<form><label for="e">Email address</label><input id="e" name="email"><input name="password" type="password"><button type="submit">Create</button></form>',
  );
  try {
    process.stdout.write(`${JSON.stringify({ challenge: await detectChallenge(page) })}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ threw: error instanceof Error ? error.message : String(error) })}\n`);
  }
} finally {
  await browser.close();
}
