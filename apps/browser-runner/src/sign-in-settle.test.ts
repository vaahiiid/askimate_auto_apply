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
let consenting: FixturePortal;
/** The same two presses, and a record that says the opposite (ADR-0131, P169). */
let lying: FixturePortal;

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
  consenting = await startFixturePortal({ loginConsentBanner: true });
  lying = await startFixturePortal({ loginConsentBanner: "settings-records-everything" });
  await register(plain);
  await register(slow);
  await register(covered);
  await register(consenting);
  await register(lying);
}, 120_000);

afterAll(async () => {
  await browser.close();
  await plain.stop();
  await slow.stop();
  await covered.stop();
  await consenting.stop();
  await lying.stop();
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

describe("a consent notice is answered only with the student's own choice (ADR-0131, P165, P169)", () => {
  // ═══════════════════════════════════════════════════════════════════════
  // Vahid, 2026-09-18: *"a cookie choice is a choice made on the student's
  // account, in their name, against an institution that may one day be asked
  // what they consented to."* So the runner presses a consent control only
  // when the work item carries the student's recorded choice; otherwise it
  // presses nothing and says so with its own code.
  //
  // P169 (shape 3): a choice is a PATH of controls that have words, and the
  // press is not the evidence — the portal's own record is. What a consent
  // control records is set by configuration nobody outside the portal can
  // see, so the runner reads the record back and stops when it disagrees.
  // ═══════════════════════════════════════════════════════════════════════
  const ACCEPT = [{ strategy: "id" as const, value: "ccc-accept" }];
  const REFUSE = [
    { strategy: "id" as const, value: "ccc-settings" },
    { strategy: "id" as const, value: "ccc-close" },
  ];
  const CHOICES = [ACCEPT, REFUSE];
  /** Sheffield's refusal, as Vahid measured it: the notice met, nothing accepted. */
  const REFUSED = {
    cookie: "portal_consent",
    mustHold: [
      { path: ["interactedWith"], present: true, equals: true },
      { path: ["optionalCookies", "analytics"], present: false },
    ],
  };
  const ACCEPTED = {
    cookie: "portal_consent",
    mustHold: [
      { path: ["interactedWith"], present: true, equals: true },
      { path: ["optionalCookies", "analytics"], present: true, equals: "accepted" },
    ],
  };
  const record = async (context: BrowserContext): Promise<unknown> => {
    const cookie = (await context.cookies()).find((one) => one.name === "portal_consent");
    return cookie === undefined ? null : JSON.parse(decodeURIComponent(cookie.value));
  };

  it("stops with consent_banner_met, pressing nothing, when the notice is met and no choice is on record", async () => {
    const said: string[] = [];
    const { context, page } = await atTheForm(consenting);
    try {
      expect(await settleSignIn(page, { ...input(consenting, said, { pressMs: 1_500 }), consent: { choices: CHOICES } })).toEqual({
        kind: "failed",
        failure: "consent_banner_met",
      });
      expect(said.at(-1)).toBe(
        "run run_settle: sign-in stopped — the press met the portal's consent notice, and no choice of the student's is on record for this portal; nothing was pressed on it",
      );
      // Pressed nothing: the notice is still there, and no consent cookie was set.
      expect(await page.locator("#ccc-overlay").count()).toBe(1);
      expect(await record(context)).toBeNull();
      // The notice's words are on the page and in none of the lines.
      expect(said.join("\n")).not.toContain("cookies");
    } finally {
      await context.close();
    }
  }, 30_000);

  it("presses the TWO controls of the student's recorded refusal, in order, reads the record back, and signs in (P169)", async () => {
    const said: string[] = [];
    const { context, page } = await atTheForm(consenting);
    try {
      expect(
        await settleSignIn(page, {
          ...input(consenting, said),
          consent: { choices: CHOICES, chosen: { steps: REFUSE, verify: REFUSED } },
        }),
      ).toEqual({ kind: "succeeded" });
      expect(said).toEqual([
        expect.stringMatching(/just before the press: over the sign-in button: div#ccc-overlay \(fixed, /u),
        "run run_settle: sign-in: the consent notice was answered with the student's recorded choice — 2 control(s) pressed, in the order the entry names",
        "run run_settle: sign-in: the portal's record agrees with the student's choice — 2 of 2 checks held",
        "run run_settle: sign-in: the button was pressed",
      ]);
      // The refusal the student made, and no other, reached the portal.
      expect(await record(context)).toEqual({ interactedWith: true, optionalCookies: {} });
      expect(page.url()).not.toContain("/login");
      // Counts, never content: no control's words reach a line.
      expect(said.join("\n")).not.toContain("Settings");
      expect(said.join("\n")).not.toContain("Close");
    } finally {
      await context.close();
    }
  }, 30_000);

  it("a one-press choice is a path of one, and its record is checked the same way", async () => {
    const said: string[] = [];
    const { context, page } = await atTheForm(consenting);
    try {
      expect(
        await settleSignIn(page, {
          ...input(consenting, said),
          consent: { choices: CHOICES, chosen: { steps: ACCEPT, verify: ACCEPTED } },
        }),
      ).toEqual({ kind: "succeeded" });
      expect(said).toContain(
        "run run_settle: sign-in: the consent notice was answered with the student's recorded choice — 1 control(s) pressed, in the order the entry names",
      );
      expect(await record(context)).toEqual({
        interactedWith: true,
        optionalCookies: { functional: "accepted", analytics: "accepted", marketing: "accepted" },
      });
    } finally {
      await context.close();
    }
  }, 30_000);

  it("STOPS, without signing in, when the path looks like a refusal and the portal records an acceptance (P169)", async () => {
    // ═════════════════════════════════════════════════════════════════════
    // The whole of shape 3. This portal's two presses are the student's
    // refusal by their words and an acceptance by what they write, which is
    // exactly what no button could ever disclose — the meaning is in
    // configuration nobody outside the portal can see. The press succeeds;
    // the read-back is what refuses.
    // ═════════════════════════════════════════════════════════════════════
    const said: string[] = [];
    const { context, page } = await atTheForm(lying);
    try {
      expect(
        await settleSignIn(page, {
          ...input(lying, said),
          consent: { choices: CHOICES, chosen: { steps: REFUSE, verify: REFUSED } },
        }),
      ).toEqual({ kind: "failed", failure: "consent_not_recorded" });
      expect(said.at(-1)).toBe(
        "run run_settle: sign-in stopped — the student's consent choice was made and the portal's record does not say what they chose: 1 of 2 checks held",
      );
      // Not signed in: the sign-in button was never pressed after the check.
      expect(page.url()).toContain("/login");
      expect(said.join("\n")).not.toContain("the button was pressed");
    } finally {
      await context.close();
    }
  }, 30_000);

  it("STOPS when the portal keeps no record at all to read: nothing is claimed about what it says (P169)", async () => {
    const said: string[] = [];
    const { context, page } = await atTheForm(consenting);
    try {
      expect(
        await settleSignIn(page, {
          ...input(consenting, said),
          consent: {
            choices: CHOICES,
            chosen: { steps: REFUSE, verify: { ...REFUSED, cookie: "a_cookie_this_portal_never_writes" } },
          },
        }),
      ).toEqual({ kind: "failed", failure: "consent_not_recorded" });
      expect(said.at(-1)).toBe(
        "run run_settle: sign-in stopped — the student's consent choice was made and the portal's record could not be read, so nothing is claimed about what it says",
      );
      expect(page.url()).toContain("/login");
    } finally {
      await context.close();
    }
  }, 30_000);

  it("STOPS when a control on the path is not on the page, rather than looking for another way through (P169)", async () => {
    const said: string[] = [];
    const { context, page } = await atTheForm(consenting);
    try {
      expect(
        await settleSignIn(page, {
          ...input(consenting, said, { pressMs: 1_500 }),
          consent: {
            choices: CHOICES,
            chosen: {
              steps: [REFUSE[0]!, { strategy: "id" as const, value: "ccc-no-such-control" }],
              verify: REFUSED,
            },
          },
        }),
      ).toEqual({ kind: "failed", failure: "consent_not_recorded" });
      expect(said.at(-1)).toBe(
        "run run_settle: sign-in stopped — the consent notice is on the page but step 2 of 2 of the student's choice is not; 1 pressed, nothing else tried",
      );
    } finally {
      await context.close();
    }
  }, 60_000);

  it("does NOT press a consent control for an obstacle that is not the notice: the plain cover fails as before", async () => {
    const said: string[] = [];
    const { context, page } = await atTheForm(covered);
    try {
      expect(
        await settleSignIn(page, {
          ...input(covered, said, { pressMs: 1_500 }),
          consent: { choices: CHOICES, chosen: { steps: ACCEPT, verify: ACCEPTED } },
        }),
      ).toEqual({ kind: "failed", failure: "runner_fault" });
      expect(said.at(-1)).toContain("could not be pressed");
      expect(said.join("\n")).not.toContain("consent notice");
    } finally {
      await context.close();
    }
  }, 30_000);

  it("the notice, once answered, is not shown again in that browser context — the choice held", async () => {
    const said: string[] = [];
    const { context, page } = await atTheForm(consenting);
    try {
      expect(
        await settleSignIn(page, {
          ...input(consenting, said),
          consent: { choices: CHOICES, chosen: { steps: ACCEPT, verify: ACCEPTED } },
        }),
      ).toEqual({ kind: "succeeded" });
      await page.goto(`${consenting.baseUrl}/login`);
      expect(await page.locator("#ccc-overlay").count(), "answered once, not shown again").toBe(0);
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
