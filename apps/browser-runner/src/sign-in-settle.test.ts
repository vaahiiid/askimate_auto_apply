/**
 * The submit of a sign-in, settled in two waits with two names (ADR-0127).
 *
 * Run A's second run printed *"the step timed out"* at the submit, and the code
 * read as if the load event had been slow. It was not: the load-state wait was
 * called on a page that had already loaded, resolved at once, and guarded
 * nothing — the clock that expired was the click's own. The reading was
 * confident and wrong, for the third time that week. So this file MEASURES:
 * each wait is driven to its own failure on a real browser against a fixture
 * that answers slowly, or covers the button, and the log line names which.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

import { startFixturePortal, type FixturePortal } from "./fixture-portal.js";
import { sayOverButton, settleSignIn, type SettleSignInInput } from "./sign-in.js";

let browser: Browser;
let plain: FixturePortal;
let slow: FixturePortal;
let covered: FixturePortal;

const EMAIL = "settle@example.test";
const PASSWORD = "Tr0ub4dor-3-horses!";

const LOGIN = {
  submitLocator: { strategy: "id", value: "signIn" },
  passwordLocator: { strategy: "id", value: "password" },
} as const;

async function register(portal: FixturePortal): Promise<void> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${portal.baseUrl}/register`);
  await page.getByLabel("Email address").fill(EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Confirm password").fill(PASSWORD);
  await Promise.all([page.waitForLoadState("load"), page.getByRole("button", { name: "Create account" }).click()]);
  await context.close();
}

/** The form typed by hand, so what is under test is the settle alone. */
async function atTheForm(portal: FixturePortal, password = PASSWORD): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${portal.baseUrl}/login`);
  await page.getByLabel("Email address").fill(EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(password);
  return { context, page };
}

function input(portal: FixturePortal, said: string[], timeouts?: SettleSignInInput["timeouts"]): SettleSignInInput {
  return {
    runId: "run_settle",
    loginUrl: new URL(`${portal.baseUrl}/login`),
    submitLocator: LOGIN.submitLocator,
    passwordLocator: LOGIN.passwordLocator,
    say: (line) => said.push(line),
    ...(timeouts === undefined ? {} : { timeouts }),
  };
}

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
  plain = await startFixturePortal();
  slow = await startFixturePortal({ loginAnswerDelayMs: 2_500 });
  covered = await startFixturePortal({ loginButtonCovered: true });
  await register(plain);
  await register(slow);
  await register(covered);
}, 120_000);

afterAll(async () => {
  await browser.close();
  await plain.stop();
  await slow.stop();
  await covered.stop();
});

describe("the two waits", () => {
  it("accepts a sign-in the portal answers promptly, and leaves the form", async () => {
    const said: string[] = [];
    const { context, page } = await atTheForm(plain);
    try {
      expect(await settleSignIn(page, input(plain, said))).toEqual({ kind: "succeeded" });
      // ADR-0130 (P164): a successful press is read too. Two lines, and
      // neither is a failure.
      expect(said).toEqual([
        expect.stringMatching(/^run run_settle: sign-in, just before the press: nothing over the sign-in button \(button#signIn \(static, \d+×\d+ at \d+,\d+\)\)$/u),
        "run run_settle: sign-in: the button was pressed",
      ]);
      expect(new URL(page.url()).pathname).toBe("/apply");
    } finally {
      await context.close();
    }
  }, 30_000);

  it("waits for the portal's ANSWER, not for the page's load event — a slow answer inside the ceiling succeeds", async () => {
    const said: string[] = [];
    const { context, page } = await atTheForm(slow);
    try {
      expect(await settleSignIn(page, input(slow, said))).toEqual({ kind: "succeeded" });
      expect(new URL(page.url()).pathname).toBe("/apply");
    } finally {
      await context.close();
    }
  }, 30_000);

  it("names the ANSWER as the wait that expired, when the portal is slower than the ceiling", async () => {
    // The ceiling shortened below the fixture's delay, so the clock that
    // expires is the one this test is about — and not the press.
    const said: string[] = [];
    const { context, page } = await atTheForm(slow);
    try {
      expect(await settleSignIn(page, input(slow, said, { answerMs: 800 }))).toEqual({
        kind: "failed",
        failure: "runner_fault",
      });
      // The two readings of a press that succeeded, then the answer's failure.
      expect(said).toHaveLength(3);
      expect(said[0]).toContain("just before the press: nothing over the sign-in button");
      expect(said[1]).toBe("run run_settle: sign-in: the button was pressed");
      expect(said[2]).toContain("the portal did not answer the sign-in");
      expect(said[2]).toContain("the step timed out");
      expect(said[2]).not.toContain("could not be pressed");
      // Nothing from the page or the URL in the line — the rule ADR-0124 set.
      expect(said.join("\n")).not.toContain(slow.baseUrl);
      expect(said.join("\n")).not.toContain(EMAIL);
    } finally {
      await context.close();
    }
  }, 30_000);

  it("names the PRESS as the wait that expired, and says the password box is still there, when something is over the button", async () => {
    const said: string[] = [];
    const { context, page } = await atTheForm(covered);
    try {
      expect(await settleSignIn(page, input(covered, said, { pressMs: 1_500 }))).toEqual({
        kind: "failed",
        failure: "runner_fault",
      });
      // ADR-0130: the reading just before the press names the cover too, so a
      // failure is seen against what stood there a moment earlier.
      expect(said).toHaveLength(2);
      expect(said[0]).toMatch(/^run run_settle: sign-in, just before the press: over the sign-in button: div#cover \(fixed, \d+×\d+ at 0,0\)$/u);
      const failed = said[1] ?? "";
      expect(failed).toContain("the sign-in button could not be pressed");
      expect(failed).toContain("the step timed out");
      expect(failed).toContain("the password box is still on the page");
      // ADR-0129: the obstacle, named from the page's structure at the moment
      // of the failure — and Playwright's own check, from its closed phrases.
      // This line is UNCHANGED by ADR-0130.
      expect(failed).toContain("pending: another element intercepts pointer events");
      expect(failed).toContain("at the button's point: div#cover (fixed, ");
      expect(failed).toMatch(/at the button's point: div#cover \(fixed, \d+×\d+ at 0,0\) > button#signIn \(static, /);
      expect(failed).not.toContain("did not answer");
      expect(said.join("\n")).not.toContain(covered.baseUrl);
      // Structure only: the cover's text, were it a banner, would not be here.
      expect(said.join("\n")).not.toContain("text:");
    } finally {
      await context.close();
    }
  }, 30_000);

  it("reads a wrong password as REFUSED, promptly — never as a timeout", async () => {
    const said: string[] = [];
    const { context, page } = await atTheForm(plain, "not-the-password");
    try {
      const started = Date.now();
      expect(await settleSignIn(page, input(plain, said))).toEqual({
        kind: "failed",
        failure: "portal_refused",
      });
      expect(Date.now() - started, "answered, not waited out").toBeLessThan(10_000);
      expect(new URL(page.url()).pathname).toBe("/login");
      // The press itself went through; the refusal is the portal's answer.
      expect(said).toEqual([expect.stringContaining("just before the press: nothing over the sign-in button"), "run run_settle: sign-in: the button was pressed"]);
    } finally {
      await context.close();
    }
  }, 30_000);
});

describe("the point is read at every press, not only a failed one (ADR-0130, P164)", () => {
  // ═══════════════════════════════════════════════════════════════════════
  // Attempt 1 of the third conversation named the overlay at a failed
  // press; attempt 2 pressed through, and nothing was read, because the
  // runner read the point only when a press failed. Vahid, 2026-09-18:
  // *"We do not know why the overlay was absent at attempt 2, and anything
  // built on top of an unmeasured absence is built on a guess. Read the
  // point at a successful press as well as a failed one, and once as the
  // login page opens, so attempt 3 names it either way."*
  // ═══════════════════════════════════════════════════════════════════════
  function reading(portal: FixturePortal, said: string[]): Parameters<typeof sayOverButton>[1] {
    return { runId: "run_settle", submitLocator: LOGIN.submitLocator, say: (line) => said.push(line), when: "as the login page opens" };
  }

  it("says nothing is over the button as a plain login page opens, naming the button's own box", async () => {
    const said: string[] = [];
    const { context, page } = await atTheForm(plain);
    try {
      await sayOverButton(page, reading(plain, said));
      expect(said).toHaveLength(1);
      expect(said[0]).toMatch(/^run run_settle: sign-in, as the login page opens: nothing over the sign-in button \(button#signIn \(static, \d+×\d+ at \d+,\d+\)\)$/u);
    } finally {
      await context.close();
    }
  }, 30_000);

  it("names what is over the button as a covered login page opens, structure only", async () => {
    const said: string[] = [];
    const { context, page } = await atTheForm(covered);
    try {
      await sayOverButton(page, reading(covered, said));
      expect(said).toHaveLength(1);
      expect(said[0]).toMatch(/^run run_settle: sign-in, as the login page opens: over the sign-in button: div#cover \(fixed, \d+×\d+ at 0,0\)$/u);
      expect(said[0]).not.toContain("text:");
    } finally {
      await context.close();
    }
  }, 30_000);

  it("catches an overlay that ARRIVES after the page opened: nothing at the open, the cover just before the press, the cover at the failure", async () => {
    // The race attempt 2 may have won and attempt 1 lost, made deterministic:
    // the page opens clean, a full-viewport layer is added afterwards, and
    // the three readings disagree in exactly the way that names the moment.
    const said: string[] = [];
    const { context, page } = await atTheForm(plain);
    try {
      await sayOverButton(page, reading(plain, said));
      await page.evaluate(() => {
        const late = document.createElement("div");
        late.id = "late";
        late.setAttribute("style", "position:fixed;inset:0;background:transparent;z-index:10");
        late.textContent = "We use cookies";
        document.body.append(late);
      });
      expect(await settleSignIn(page, input(plain, said, { pressMs: 1_500 }))).toEqual({ kind: "failed", failure: "runner_fault" });
      expect(said).toHaveLength(3);
      expect(said[0]).toContain("as the login page opens: nothing over the sign-in button");
      expect(said[1]).toMatch(/^run run_settle: sign-in, just before the press: over the sign-in button: div#late \(fixed, /u);
      expect(said[2]).toContain("could not be pressed");
      expect(said[2]).toContain("at the button's point: div#late (fixed, ");
      // The layer's text is on the page and in none of the three lines.
      expect(said.join("\n")).not.toContain("cookies");
    } finally {
      await context.close();
    }
  }, 30_000);
});

describe("the runner's presented identity (ADR-0128)", () => {
  it("is what the --as-runner read presents — the two cannot drift apart silently", async () => {
    const { RUNNER_PRESENTS } = await import("./runner-identity.js");
    const source = await import("node:fs/promises").then((fs) => fs.readFile(new URL("./sign-in.ts", import.meta.url), "utf8"));
    expect(source).toContain(`deps.userAgent ?? "${RUNNER_PRESENTS.userAgent}"`);
    // Playwright's default viewport, which `openSensitiveContext` does not override.
    expect(RUNNER_PRESENTS.viewport).toEqual({ width: 1280, height: 720 });
  });
});

describe("the numbers", () => {
  it("are the ones ADR-0127 names, and the answer is the longer wait", async () => {
    const { SIGN_IN_PRESS_TIMEOUT_MS, SIGN_IN_ANSWER_TIMEOUT_MS } = await import("./sign-in.js");
    expect(SIGN_IN_PRESS_TIMEOUT_MS).toBe(15_000);
    expect(SIGN_IN_ANSWER_TIMEOUT_MS).toBe(30_000);
  });
});
