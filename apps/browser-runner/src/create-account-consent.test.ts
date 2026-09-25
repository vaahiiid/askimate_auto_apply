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
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type BrowserContext } from "playwright";

import { createPortalAccount } from "./create-account.js";
import { startFixturePortal, type FixturePortal } from "./fixture-portal.js";
import { openSensitiveContext } from "./sensitive.js";

let browser: Browser;
/** The notice over the registration form; opening its settings records nothing. */
let consenting: FixturePortal;
/** The same two presses, and a record that says the opposite (P169). */
let lying: FixturePortal;
/** No notice at all — the targets are carried and the probe must not stop a clean page. */
let plain: FixturePortal;

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
}, 120_000);

afterAll(async () => {
  await browser.close();
  await consenting.stop();
  await lying.stop();
  await plain.stop();
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
