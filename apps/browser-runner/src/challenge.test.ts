/**
 * The challenge detector, against real pages in a real browser (ADR-0101 §6).
 *
 * Both directions are proved: the fixture portal's two challenge modes are
 * SEEN, and an ordinary form — a postcode box, a plain sign-in — is NOT. The
 * second half is the one that matters for a live run: a detector that stopped
 * every UK address page would be refusing to fill, and it would do so with a
 * stated reason that was wrong.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";

import { detectChallenge } from "./challenge.js";
import { createPortalAccount } from "./create-account.js";
import { startFixturePortal, type FixturePortal } from "./fixture-portal.js";

let browser: Browser;
let page: Page;
let plain: FixturePortal;
let captcha: FixturePortal;
let secondFactor: FixturePortal;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  plain = await startFixturePortal();
  captcha = await startFixturePortal({ challenge: "captcha" });
  secondFactor = await startFixturePortal({ challenge: "second_factor" });
}, 120_000);

afterAll(async () => {
  await browser.close();
  await plain.stop();
  await captcha.stop();
  await secondFactor.stop();
});

describe("what it sees", () => {
  it("sees a CAPTCHA widget on the registration form", async () => {
    await page.goto(`${captcha.baseUrl}/register`);
    expect(await detectChallenge(page)).toBe("captcha");
  });

  it("sees the second factor only where the portal asks for it — after the form is accepted", async () => {
    await page.goto(`${secondFactor.baseUrl}/register`);
    expect(await detectChallenge(page), "the registration form itself is ordinary").toBeNull();

    // The student's half, by hand: the portal accepts the form and then asks
    // for the code it "emailed".
    await page.getByLabel("Email address").fill("challenge@example.test");
    await page.getByLabel("Password", { exact: true }).fill("Tr0ub4dor-3-horses!");
    await page.getByLabel("Confirm password").fill("Tr0ub4dor-3-horses!");
    await Promise.all([page.waitForLoadState("load"), page.getByRole("button", { name: "Create account" }).click()]);
    expect(new URL(page.url()).pathname).toBe("/verify");
    expect(await detectChallenge(page)).toBe("second_factor");
    // And the account exists by then — the fact the plane has to be told.
    expect(secondFactor.accounts()).toEqual(["challenge@example.test"]);
  });

  it("sees a labelled code box even without the autocomplete hint", async () => {
    await page.setContent(`<form><label for="c">Authentication code</label><input id="c" name="challenge_answer"></form>`);
    expect(await detectChallenge(page)).toBe("second_factor");
  });
});

describe("what it does NOT see", () => {
  it("does not mistake a postcode, a course code or a sign-in form for a second factor", async () => {
    await page.setContent(`
      <form>
        <label for="pc">Postcode</label><input id="pc" name="postcode">
        <label for="cc">Course code</label><input id="cc" name="course_code">
        <label for="pw">Password</label><input id="pw" type="password" name="password" autocomplete="current-password">
        <p>We may ask you for a verification code later in the process.</p>
      </form>`);
    expect(await detectChallenge(page), "discovery's name*=code rule would have fired here").toBeNull();
  });

  it("does not mistake a bare analytics-style script for a CAPTCHA the page shows", async () => {
    await page.setContent(`<script src="https://www.google.com/recaptcha/api.js?render=site"></script><form><input name="email"></form>`);
    expect(await detectChallenge(page)).toBeNull();
  });

  it("finds nothing on the plain portal's registration and sign-in", async () => {
    await page.goto(`${plain.baseUrl}/register`);
    expect(await detectChallenge(page)).toBeNull();
    await page.goto(`${plain.baseUrl}/login`);
    expect(await detectChallenge(page)).toBeNull();
  });
});

describe("what the account creation does with it", () => {
  it("stops at a CAPTCHA before typing anything and before the Secure Plane is asked for the password", async () => {
    // No agent is reachable and no handle exists. If the creation got as far
    // as asking for the password, this would fail as `secret_unavailable`.
    const outcome = await createPortalAccount(
      {
        leaseId: "wl_challenge",
        expiresAt: new Date(Date.now() + 120_000).toISOString(),
        runId: "run_challenge_1",
        caseId: "case_challenge",
        studentRef: "11111111-1111-1111-1111-111111111111",
        kind: "create_account",
        portalHost: captcha.host,
        email: "challenge@example.test",
        approach: "student_chosen",
        secretHandle: `sh_${"0".repeat(32)}`,
        registration: {
          url: `${captcha.baseUrl}/register`,
          emailLocator: { strategy: "label", value: "Email address" },
          passwordLocators: [
            { strategy: "name", value: "password" },
            { strategy: "name", value: "password_confirm" },
          ],
          submitLocator: { strategy: "role", value: "button:Create account" },
        },
      },
      { browser, browserEndpoint: "ws://127.0.0.1:9/never", agentBaseUrl: "http://127.0.0.1:9" },
    );
    expect(outcome).toEqual({ kind: "failed", failure: "captcha_met" });
    expect(captcha.accounts(), "no account was attempted").toEqual([]);
    expect(
      captcha.requests.filter((r) => r.method === "POST"),
      "and nothing was posted to the portal",
    ).toEqual([]);
  }, 60_000);
});
