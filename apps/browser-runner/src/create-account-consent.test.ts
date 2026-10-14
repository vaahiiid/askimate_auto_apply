/**
 * The account creation meets the portal's consent notice BEFORE it types
 * anything (ADR-0131, ADR-0144, P219).
 *
 * The sign-in learnt the notice at a failed press, with the password already
 * typed and spent (attempt 1 of Run A). The creation reads it first, because
 * here it can: the submit control is checked for something over it before a
 * character goes in, so an unanswered notice costs no password and no account.
 * Measured on a real browser against the fixture portal, with the notice over
 * the registration form in the shape Civic CookieControl put over Sheffield's.
 *
 * Since P310 a notice that arrives after the page opened is met at the press,
 * as the sign-in meets it, with the password already typed: the second group
 * below. There an unanswered notice does cost the password, and says so.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

import { createPortalAccount } from "./create-account.js";
import { startFixturePortal, type FixturePortal } from "./fixture-portal.js";
import { interceptedBeforeSending, pressCheckInWords, pressWasDispatched } from "./runner-log.js";
import { openSensitiveContext } from "./sensitive.js";

let browser: Browser;
/** The notice over the registration form; opening its settings records nothing. */
let consenting: FixturePortal;
/** The same two presses, and a record that says the opposite (P169). */
let lying: FixturePortal;
/** No notice at all — the targets are carried and the probe must not stop a clean page. */
let plain: FixturePortal;
/** P310: the notice arrives once the e-mail is typed — after the look as the page opens. */
let lateConsenting: FixturePortal;
/** P310: the same, with a record that says the opposite of the two presses (P169). */
let lateLying: FixturePortal;
/** P310: late, and the registration's answer held back after the account exists. */
let lateSlow: FixturePortal;

const EMAIL = "creation@example.test";
/** An agent nothing listens on: asked, the fill fails as `secret_unavailable`. */
const NOBODY = "http://127.0.0.1:9";

const ACCEPT = [{ strategy: "id" as const, value: "ccc-accept" }];
const REFUSE = [
  { strategy: "id" as const, value: "ccc-settings" },
  { strategy: "id" as const, value: "ccc-close" },
];
const REFUSED = {
  cookie: "portal_consent",
  mustHold: [
    { path: ["interactedWith"], present: true, equals: true },
    { path: ["optionalCookies", "analytics"], present: false },
  ],
};
const CHOICES = [
  { id: "accept", steps: ACCEPT },
  { id: "reject", steps: REFUSE },
];

function work(portal: FixturePortal, consent?: { chosen?: string; verify?: typeof REFUSED }) {
  return {
    leaseId: "wl_consent",
    expiresAt: new Date(Date.now() + 120_000).toISOString(),
    runId: "run_consent_1",
    caseId: "case_consent",
    studentRef: "11111111-1111-1111-1111-111111111111",
    kind: "create_account" as const,
    portalHost: portal.host,
    email: EMAIL,
    approach: "student_chosen" as const,
    secretHandle: `sh_${"0".repeat(32)}`,
    registration: {
      url: `${portal.baseUrl}/register`,
      emailLocator: { strategy: "id" as const, value: "email" },
      passwordLocators: [
        { strategy: "name" as const, value: "password" },
        { strategy: "name" as const, value: "password_confirm" },
      ],
      submitLocator: { strategy: "id" as const, value: "createAccount" },
      ...(consent === undefined ? {} : { consent: { choices: CHOICES, ...consent } }),
    },
  };
}

/** A fill agent that answers "filled" and records what the page held when it was asked. */
function agentThatFills(context: BrowserContext, seen: { overlay: number; email: string }[]): typeof globalThis.fetch {
  return (async () => {
    const page = context.pages()[0];
    if (page !== undefined) {
      seen.push({ overlay: await page.locator("#ccc-overlay").count(), email: await page.locator("#email").inputValue() });
    }
    return new Response(JSON.stringify({ status: "filled", lifecycle: "secret_consumed" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
}

async function record(context: BrowserContext): Promise<unknown> {
  const cookie = (await context.cookies()).find((one) => one.name === "portal_consent");
  return cookie === undefined ? null : JSON.parse(decodeURIComponent(cookie.value));
}

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
  consenting = await startFixturePortal({ registerConsentBanner: true });
  lying = await startFixturePortal({ registerConsentBanner: "settings-records-everything" });
  plain = await startFixturePortal();
  lateConsenting = await startFixturePortal({ registerConsentBanner: true, registerConsentBannerArrives: "once the e-mail is typed" });
  lateLying = await startFixturePortal({
    registerConsentBanner: "settings-records-everything",
    registerConsentBannerArrives: "once the e-mail is typed",
  });
  lateSlow = await startFixturePortal({
    registerConsentBanner: true,
    registerConsentBannerArrives: "once the e-mail is typed",
    registerAnswerDelayMs: 20_000,
  });
}, 120_000);

afterAll(async () => {
  await browser.close();
  await consenting.stop();
  await lying.stop();
  await plain.stop();
  await lateConsenting.stop();
  await lateLying.stop();
  await lateSlow.stop();
});

describe("the account creation meets the consent notice before it types (ADR-0144)", () => {
  it("stops with consent_banner_met, pressing nothing and typing nothing, when no choice is on record — and the Secure Plane is never asked", async () => {
    const said: string[] = [];
    const context = await openSensitiveContext(browser, { userAgent: "test" });
    try {
      // Nobody listens on the agent's address: had the creation got as far as
      // asking for the password, this would come back `secret_unavailable`.
      const outcome = await createPortalAccount(work(consenting, {}), {
        browser,
        browserEndpoint: "ws://127.0.0.1:9/never",
        agentBaseUrl: NOBODY,
        context,
        log: (line) => said.push(line),
      });
      expect(outcome).toEqual({ kind: "failed", failure: "consent_banner_met" });
      expect(said.at(-1)).toBe(
        "run run_consent_1: account creation stopped — the registration page carries the portal's consent notice, and no choice of the student's is on record for this portal; nothing was pressed on it and nothing was typed",
      );
      const page = context.pages()[0];
      expect(page, "the page is still open in the supplied context").toBeDefined();
      // Pressed nothing: the notice is still there and no consent cookie was set.
      expect(await page?.locator("#ccc-overlay").count()).toBe(1);
      expect(await record(context)).toBeNull();
      // Typed nothing: the e-mail box is empty.
      expect(await page?.locator("#email").inputValue()).toBe("");
      expect(consenting.accounts(), "no account was attempted").toEqual([]);
      expect(consenting.requests.filter((r) => r.method === "POST"), "nothing was posted").toEqual([]);
      // The notice's words are on the page and in none of the lines.
      expect(said.join("\n")).not.toContain("cookies");
    } finally {
      await context.close();
    }
  }, 60_000);

  it("presses the student's recorded refusal, reads the record back, and only THEN types and asks for the password", async () => {
    const said: string[] = [];
    const seen: { overlay: number; email: string }[] = [];
    const context = await openSensitiveContext(browser, { userAgent: "test" });
    try {
      const outcome = await createPortalAccount(work(consenting, { chosen: "reject", verify: REFUSED }), {
        browser,
        browserEndpoint: "ws://127.0.0.1:9/never",
        agentBaseUrl: "http://agent.test",
        fetch: agentThatFills(context, seen),
        context,
        log: (line) => said.push(line),
      });
      // The agent "filled" and typed nothing, so the browser's own `required`
      // check held the empty password form on the page: the creation got all
      // the way to the press, which is the point, and read the page it was
      // still on as a refusal.
      expect(outcome).toEqual({ kind: "failed", failure: "portal_refused" });
      expect(seen, "asked once, with the notice gone and the e-mail already typed").toEqual([{ overlay: 0, email: EMAIL }]);
      expect(await record(context)).toEqual({ interactedWith: true, optionalCookies: {} });
      expect(said).toEqual([
        "run run_consent_1: account creation: the consent notice was answered with the student's recorded choice — 2 control(s) pressed, in the order the entry names",
        "run run_consent_1: account creation: the portal's record agrees with the student's choice — 2 of 2 checks held",
      ]);
    } finally {
      await context.close();
    }
  }, 60_000);

  it("STOPS with consent_not_recorded, typing nothing, when the path looks like a refusal and the portal records an acceptance (P169)", async () => {
    const said: string[] = [];
    const seen: { overlay: number; email: string }[] = [];
    const context = await openSensitiveContext(browser, { userAgent: "test" });
    try {
      const outcome = await createPortalAccount(work(lying, { chosen: "reject", verify: REFUSED }), {
        browser,
        browserEndpoint: "ws://127.0.0.1:9/never",
        agentBaseUrl: "http://agent.test",
        fetch: agentThatFills(context, seen),
        context,
        log: (line) => said.push(line),
      });
      expect(outcome).toEqual({ kind: "failed", failure: "consent_not_recorded" });
      expect(said.at(-1)).toBe(
        "run run_consent_1: account creation stopped — the student's consent choice was made and the portal's record does not say what they chose: 1 of 2 checks held",
      );
      expect(seen, "the Secure Plane was never asked").toEqual([]);
      expect(await context.pages()[0]?.locator("#email").inputValue(), "nothing typed").toBe("");
      expect(lying.requests.filter((r) => r.method === "POST"), "nothing was posted").toEqual([]);
    } finally {
      await context.close();
    }
  }, 60_000);

  it("does not stop a page with no notice on it: the targets are carried, the probe passes, the creation goes on", async () => {
    const seen: { overlay: number; email: string }[] = [];
    const context = await openSensitiveContext(browser, { userAgent: "test" });
    try {
      const outcome = await createPortalAccount(work(plain, {}), {
        browser,
        browserEndpoint: "ws://127.0.0.1:9/never",
        agentBaseUrl: "http://agent.test",
        fetch: agentThatFills(context, seen),
        context,
      });
      expect(outcome).toEqual({ kind: "failed", failure: "portal_refused" });
      expect(seen).toEqual([{ overlay: 0, email: EMAIL }]);
    } finally {
      await context.close();
    }
  }, 60_000);

  it("the notice, once answered at the registration, is not shown again in that browser context", async () => {
    const context = await openSensitiveContext(browser, { userAgent: "test" });
    try {
      const page = await context.newPage();
      await page.goto(`${consenting.baseUrl}/register`);
      expect(await page.locator("#ccc-overlay").count()).toBe(1);
      await page.locator("#ccc-accept").click();
      await page.goto(`${consenting.baseUrl}/register`);
      expect(await page.locator("#ccc-overlay").count()).toBe(0);
      await page.goto(`${consenting.baseUrl}/login`);
      expect(await page.locator("#ccc-overlay").count(), "nor on the sign-in: one notice, one answer").toBe(0);
    } finally {
      await context.close();
    }
  }, 30_000);
});

/** The two password boxes, typed as the fill agent would type them. */
const PASSWORD = "correct horse battery staple";

/**
 * P310. A fill agent that types: it records what the page held when asked,
 * fills both password boxes as the real agent does, and then lets the test
 * change the page before the press.
 */
function agentThatTypes(
  context: BrowserContext,
  seen: { overlay: number; email: string }[],
  then?: (page: Page) => Promise<void>,
): typeof globalThis.fetch {
  return (async () => {
    const page = context.pages()[0];
    if (page !== undefined) {
      seen.push({ overlay: await page.locator("#ccc-overlay").count(), email: await page.locator("#email").inputValue() });
      await page.locator("[name=password]").fill(PASSWORD);
      await page.locator("[name=password_confirm]").fill(PASSWORD);
      if (then !== undefined) await then(page);
    }
    return new Response(JSON.stringify({ status: "filled", lifecycle: "secret_consumed" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
}

// A portal's request log runs for the whole file, so each test counts from
// where the log stood when it began: T2's registration is not T8's.
const startedAt = new Map<FixturePortal, number>();
const posts = (portal: FixturePortal): readonly { method: string; path: string }[] =>
  portal.requests.slice(startedAt.get(portal) ?? 0).filter((r) => r.method === "POST");

describe("the account creation meets a notice that arrives late at its press, as the sign-in does (P302 item 3, P310)", () => {
  beforeEach(() => {
    for (const portal of [plain, lateConsenting, lateLying, lateSlow]) startedAt.set(portal, portal.requests.length);
  });

  // Vahid, 2026-10-14: "P302 item 3 alone first: the consent notice at the
  // account-creation press, handled as sign-in already handles it." On
  // Sheffield's page 0 the notice was not there as the page opened and was
  // over the button just before the press (P176). Here it arrives once the
  // e-mail is typed: after the look as the page opens, before the press.

  it("stops with consent_banner_met, pressing nothing on the notice, and says the password was already typed (secretSpent)", async () => {
    const said: string[] = [];
    const seen: { overlay: number; email: string }[] = [];
    const context = await openSensitiveContext(browser, { userAgent: "test" });
    try {
      const outcome = await createPortalAccount(work(lateConsenting, {}), {
        browser,
        browserEndpoint: "ws://127.0.0.1:9/never",
        agentBaseUrl: "http://agent.test",
        fetch: agentThatTypes(context, seen),
        context,
        log: (line) => said.push(line),
      });
      expect(outcome).toEqual({ kind: "failed", failure: "consent_banner_met", secretSpent: true });
      expect(said.at(-1)).toBe(
        "run run_consent_1: account creation stopped — the press met the portal's consent notice, and no choice of the student's is on record for this portal; nothing was pressed on it, and the password had already been typed",
      );
      expect(seen, "the notice came once the e-mail was typed, before the password").toEqual([{ overlay: 1, email: EMAIL }]);
      const page = context.pages()[0];
      expect(await page?.locator("#ccc-overlay").count(), "pressed nothing on the notice").toBe(1);
      expect(await record(context)).toBeNull();
      expect(posts(lateConsenting), "the registration was never sent").toEqual([]);
      expect(lateConsenting.accounts()).toEqual([]);
      expect(said.join("\n")).not.toContain("cookies");
    } finally {
      await context.close();
    }
  }, 60_000);

  it("with the student's choice on record, presses it, reads the record back, and presses the creation ONCE more", async () => {
    const said: string[] = [];
    const seen: { overlay: number; email: string }[] = [];
    const context = await openSensitiveContext(browser, { userAgent: "test" });
    try {
      const outcome = await createPortalAccount(work(lateConsenting, { chosen: "reject", verify: REFUSED }), {
        browser,
        browserEndpoint: "ws://127.0.0.1:9/never",
        agentBaseUrl: "http://agent.test",
        fetch: agentThatTypes(context, seen),
        context,
        log: (line) => said.push(line),
      });
      expect(outcome).toEqual({ kind: "succeeded" });
      expect(seen).toEqual([{ overlay: 1, email: EMAIL }]);
      expect(posts(lateConsenting).filter((r) => r.path === "/register"), "exactly one registration").toHaveLength(1);
      expect(lateConsenting.accounts()).toContain(EMAIL.toLowerCase());
      expect(await record(context)).toEqual({ interactedWith: true, optionalCookies: {} });
      expect(said).toEqual([
        "run run_consent_1: account creation: the consent notice was answered with the student's recorded choice — 2 control(s) pressed, in the order the entry names",
        "run run_consent_1: account creation: the portal's record agrees with the student's choice — 2 of 2 checks held",
      ]);
    } finally {
      await context.close();
    }
  }, 90_000);

  it("STOPS with consent_not_recorded, the password already typed (secretSpent), when the portal records the opposite of the presses", async () => {
    const said: string[] = [];
    const seen: { overlay: number; email: string }[] = [];
    const context = await openSensitiveContext(browser, { userAgent: "test" });
    try {
      const outcome = await createPortalAccount(work(lateLying, { chosen: "reject", verify: REFUSED }), {
        browser,
        browserEndpoint: "ws://127.0.0.1:9/never",
        agentBaseUrl: "http://agent.test",
        fetch: agentThatTypes(context, seen),
        context,
        log: (line) => said.push(line),
      });
      expect(outcome).toEqual({ kind: "failed", failure: "consent_not_recorded", secretSpent: true });
      expect(said.at(-1)).toBe(
        "run run_consent_1: account creation stopped — the student's consent choice was made and the portal's record does not say what they chose: 1 of 2 checks held",
      );
      expect(seen, "typed before the notice was met, unlike the look as the page opens").toHaveLength(1);
      expect(posts(lateLying), "the registration was never sent").toEqual([]);
    } finally {
      await context.close();
    }
  }, 60_000);

  it("leaves anything else over the button UNCERTAIN, as before: a plain cover is not the notice, and nothing is pressed on it", async () => {
    const said: string[] = [];
    const context = await openSensitiveContext(browser, { userAgent: "test" });
    try {
      const outcome = await createPortalAccount(work(plain, { chosen: "reject", verify: REFUSED }), {
        browser,
        browserEndpoint: "ws://127.0.0.1:9/never",
        agentBaseUrl: "http://agent.test",
        fetch: agentThatTypes(context, [], async (page) => {
          await page.evaluate(() => {
            const cover = document.createElement("div");
            cover.id = "late";
            cover.style.cssText = "position:fixed;inset:0;background:transparent;z-index:10";
            document.body.appendChild(cover);
          });
        }),
        context,
        log: (line) => said.push(line),
      });
      expect(outcome).toEqual({ kind: "uncertain", failure: "runner_fault" });
      expect(await record(context)).toBeNull();
      expect(posts(plain)).toEqual([]);
      expect(said.join("\n")).not.toContain("consent notice");
      // P310's review: the stop says what the runner knows about the press.
      const line = said.at(-1) ?? "";
      expect(line).toContain("account creation: the press was not sent — ");
      expect(line).toContain("; pending: another element intercepts pointer events; reported as uncertain");
    } finally {
      await context.close();
    }
  }, 60_000);

  it("never takes a press that WAS sent for one the notice stopped: the cover goes, the registration goes out, the answer is slow — UNCERTAIN, not consent_banner_met", async () => {
    // The danger the guard exists for. The press is intercepted at first, so
    // Playwright's call log names the interception; then the notice is hidden
    // (its controls stay in the page), the click is sent, the account is made,
    // and the answer is held back past the press's own wait. A `failed` here
    // would offer a second creation for an account that exists.
    const said: string[] = [];
    const context = await openSensitiveContext(browser, { userAgent: "test" });
    try {
      const outcome = await createPortalAccount(work(lateSlow, {}), {
        browser,
        browserEndpoint: "ws://127.0.0.1:9/never",
        agentBaseUrl: "http://agent.test",
        fetch: agentThatTypes(context, [], async (page) => {
          await page.evaluate(() => {
            setTimeout(() => {
              const overlay = document.getElementById("ccc-overlay");
              if (overlay !== null) overlay.style.display = "none";
            }, 1_500);
          });
        }),
        context,
        log: (line) => said.push(line),
      });
      // First, that the danger was real: the registration went out and the account exists.
      expect(posts(lateSlow).filter((r) => r.path === "/register")).toHaveLength(1);
      expect(lateSlow.accounts()).toContain(EMAIL.toLowerCase());
      expect(outcome).toEqual({ kind: "uncertain", failure: "runner_fault" });
      // And that the guard was what the press met: intercepted first, then sent.
      const line = said.at(-1) ?? "";
      expect(line).toContain("account creation: the press was sent, and then failed — ");
      expect(line).toContain("; pending: another element intercepts pointer events; reported as uncertain");
    } finally {
      await context.close();
    }
  }, 90_000);

  it("a second press that still cannot be made, after the choice was pressed, is UNCERTAIN, and says it was not sent", async () => {
    const said: string[] = [];
    const context = await openSensitiveContext(browser, { userAgent: "test" });
    try {
      const outcome = await createPortalAccount(work(lateConsenting, { chosen: "reject", verify: REFUSED }), {
        browser,
        browserEndpoint: "ws://127.0.0.1:9/never",
        agentBaseUrl: "http://agent.test",
        fetch: agentThatTypes(context, [], async (page) => {
          // A plain cover UNDER the notice: still there once the notice is answered.
          await page.evaluate(() => {
            const cover = document.createElement("div");
            cover.id = "under";
            cover.style.cssText = "position:fixed;inset:0;background:transparent;z-index:5";
            document.body.appendChild(cover);
          });
        }),
        context,
        log: (line) => said.push(line),
      });
      expect(outcome).toEqual({ kind: "uncertain", failure: "runner_fault" });
      expect(await record(context), "the student's choice was pressed").toEqual({ interactedWith: true, optionalCookies: {} });
      expect(posts(lateConsenting)).toEqual([]);
      expect(said.at(-1)).toContain("account creation: the press was not sent — ");
    } finally {
      await context.close();
    }
  }, 90_000);

  it("leaves a press that failed for another reason UNCERTAIN, with nothing pressed on the notice", async () => {
    const context = await openSensitiveContext(browser, { userAgent: "test" });
    try {
      const outcome = await createPortalAccount(work(lateConsenting, {}), {
        browser,
        browserEndpoint: "ws://127.0.0.1:9/never",
        agentBaseUrl: "http://agent.test",
        fetch: agentThatTypes(context, [], async (page) => {
          await page.evaluate(() => {
            const overlay = document.getElementById("ccc-overlay");
            if (overlay !== null) overlay.style.display = "none";
            (document.getElementById("createAccount") as HTMLButtonElement).disabled = true;
          });
        }),
        context,
      });
      expect(outcome).toEqual({ kind: "uncertain", failure: "runner_fault" });
      expect(await record(context)).toBeNull();
    } finally {
      await context.close();
    }
  }, 60_000);
});

describe("the guard reads Playwright's own call log: a press never sent, or one sent and still waiting (P310)", () => {
  it("names a press the notice stopped before it was sent, and refuses one that was sent and is waiting for its answer", async () => {
    const context = await openSensitiveContext(browser, { userAgent: "test" });
    try {
      const page = await context.newPage();
      // Never sent: the notice over the button the whole time.
      await page.goto(`${consenting.baseUrl}/register`);
      let neverSent: unknown;
      try {
        await page.locator("#createAccount").click({ timeout: 1_500 });
      } catch (thrown) {
        neverSent = thrown;
      }
      expect(pressCheckInWords(neverSent)).toBe("another element intercepts pointer events");
      expect(pressWasDispatched(neverSent)).toBe(false);
      expect(interceptedBeforeSending(neverSent), "the one case a second press cannot repeat").toBe(true);

      // Sent, and still waiting: stopped at first, then the cover goes, the
      // registration goes out, and the portal holds its answer back.
      const SENT = "sent@example.test";
      await page.goto(`${lateSlow.baseUrl}/register`);
      await page.locator("#email").fill(SENT);
      await page.locator("[name=password]").fill(PASSWORD);
      await page.locator("[name=password_confirm]").fill(PASSWORD);
      await page.evaluate(() => {
        setTimeout(() => {
          const overlay = document.getElementById("ccc-overlay");
          if (overlay !== null) overlay.style.display = "none";
        }, 500);
      });
      let sent: unknown;
      try {
        await page.locator("#createAccount").click({ timeout: 4_000 });
      } catch (thrown) {
        sent = thrown;
      }
      expect(lateSlow.accounts(), "the registration reached the portal").toContain(SENT);
      expect(pressCheckInWords(sent), "its log still names the interception").toBe("another element intercepts pointer events");
      expect(pressWasDispatched(sent)).toBe(true);
      expect(interceptedBeforeSending(sent), "never taken for a press the notice stopped").toBe(false);
    } finally {
      await context.close();
    }
  }, 60_000);
});
