/**
 * The controlled portal, and the blueprint that claims to describe it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Two things are proved here, and the second is the one that matters.
 *
 *   1. The portal behaves like a portal: it gates, it refuses, it remembers.
 *   2. The BLUEPRINT actually describes it — every locator a specialist
 *      reviewed resolves to a real element on the real page.
 *
 * The second is what stops this fixture drifting into a mock. A blueprint that
 * says "First name" while the page says "Given name" would pass every test
 * written against the fixture alone, and fail on the first run.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";

import { toPlaywrightLocator } from "@askimate/aas-browser-fill";
import { checkExecutable } from "@askimate/aas-blueprint";
import { checkUsable } from "@askimate/aas-mapping";
import {
  GATED_PORTAL_BLUEPRINT,
  GATED_PORTAL_MAPPING_SET,
  GATED_PORTAL_ORIGIN,
} from "@askimate/aas-mapping/fixtures/gated";

import { openSensitiveContext } from "./sensitive.js";
import { startFixturePortal, type FixturePortal } from "./fixture-portal.js";

const PASSWORD = "Correct-Horse-9!";
const EMAIL = "niloofar@example.test";

let portal: FixturePortal;
let browser: Browser;

beforeAll(async () => {
  portal = await startFixturePortal();
  browser = await chromium.launch({ headless: true });
}, 120_000);

afterAll(async () => {
  await browser.close();
  await portal.stop();
});

/** The blueprint's URL, on the port the portal actually got. */
function addressOf(blueprintUrl: string): string {
  return blueprintUrl.replace(GATED_PORTAL_ORIGIN, portal.baseUrl);
}

/** The blueprint's page URLs are declared, so this narrows for `goto`. */
function urlOf(page: { readonly url?: string }): string {
  const url = page.url;
  if (url === undefined) throw new Error("a reviewed page must have an observed url");
  return addressOf(url);
}

async function form(path: string, body: Record<string, string>, cookie?: string): Promise<Response> {
  return await fetch(`${portal.baseUrl}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...(cookie === undefined ? {} : { cookie }),
    },
    body: new URLSearchParams(body).toString(),
  });
}

function sessionFrom(response: Response): string {
  const value = /portal_session=([^;]+)/.exec(response.headers.get("set-cookie") ?? "")?.[1];
  if (value === undefined) expect.unreachable("a session cookie should have been set");
  return `portal_session=${value}`;
}

describe("the gate is what makes the secure step real", () => {
  it("redirects the application form to registration with no account", async () => {
    // If this ever stops being true, every later phase would still pass while
    // skipping the entire credential path — the run would simply fill the form.
    const response = await fetch(`${portal.baseUrl}/apply`, { redirect: "manual" });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/register");
  });

  it("redirects the review page too", async () => {
    const response = await fetch(`${portal.baseUrl}/review`, { redirect: "manual" });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/register");
  });
});

describe("registration behaves like a portal, refusals included", () => {
  it("refuses a password shorter than the portal's own minimum", async () => {
    const response = await form("/register", {
      email: "short@example.test",
      password: "Ab1!",
      password_confirm: "Ab1!",
    });
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("at least 8 characters");
    expect(portal.accounts()).not.toContain("short@example.test");
  });

  it("refuses a confirmation that does not match, and names neither value", async () => {
    const response = await form("/register", {
      email: "mismatch@example.test",
      password: PASSWORD,
      password_confirm: `${PASSWORD}x`,
    });
    expect(response.status).toBe(400);
    const body = await response.text();
    expect(body).toContain("do not match");
    // A fixture that echoed one would be a fixture teaching the wrong habit.
    expect(body).not.toContain(PASSWORD);
  });

  it("creates the account and hands back a session", async () => {
    const response = await form("/register", {
      email: EMAIL,
      password: PASSWORD,
      password_confirm: PASSWORD,
    });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/apply");
    expect(portal.accounts()).toContain(EMAIL);
    expect(sessionFrom(response)).toMatch(/^portal_session=[0-9a-f]{32}$/);
  });

  it("refuses a second account for the same email", async () => {
    const response = await form("/register", {
      email: EMAIL,
      password: PASSWORD,
      password_confirm: PASSWORD,
    });
    expect(response.status).toBe(409);
  });

  it("never renders the password back, on any page", async () => {
    for (const path of ["/register", "/login", "/"]) {
      const body = await (await fetch(`${portal.baseUrl}${path}`)).text();
      expect(body, `${path} rendered the password`).not.toContain(PASSWORD);
    }
  });
});

describe("the password actually arrived, proved the way a portal proves it", () => {
  it("signs in with the registered password", async () => {
    // The only check that a password reached the portal INTACT — and it reveals
    // nothing, because it answers a question that was already asked. A single
    // truncated or swapped character fails here.
    expect(portal.credentialsWork(EMAIL, PASSWORD)).toBe(true);
    const response = await form("/login", { email: EMAIL, password: PASSWORD });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/apply");
  });

  it("refuses a password that is nearly right", async () => {
    expect(portal.credentialsWork(EMAIL, `${PASSWORD} `)).toBe(false);
    const response = await form("/login", { email: EMAIL, password: PASSWORD.slice(0, -1) });
    expect(response.status).toBe(401);
  });
});

describe("the application form remembers, and the review page shows it", () => {
  it("stores what was filled and renders it back", async () => {
    const signedIn = sessionFrom(await form("/login", { email: EMAIL, password: PASSWORD }));

    const refused = await form(
      "/apply",
      {
        given_name: "Niloofar",
        family_name: "Hosseini",
        date_of_birth: "1999-04-02",
        nationality: "IR",
        personal_statement: "Because the course is the one I want.",
      },
      signedIn,
    );
    // The portal has its own format rule and enforces it, so an automation that
    // sent an ISO date would be told, rather than silently storing the wrong one.
    expect(refused.status).toBe(400);

    const accepted = await form(
      "/apply",
      {
        given_name: "Niloofar",
        family_name: "Hosseini",
        date_of_birth: "02/04/1999",
        nationality: "IR",
        personal_statement: "Because the course is the one I want.",
      },
      signedIn,
    );
    expect(accepted.status).toBe(302);
    expect(accepted.headers.get("location")).toBe("/review");

    const review = await fetch(`${portal.baseUrl}/review`, { headers: { cookie: signedIn } });
    const body = await review.text();
    expect(body).toContain("Niloofar");
    expect(body).toContain("02/04/1999");
    expect(body).not.toContain(PASSWORD);

    expect(portal.application(EMAIL)?.familyName).toBe("Hosseini");
  });

  it("records a submission, so that never happening is provable", async () => {
    // ── A counter nobody has ever seen tick is not evidence ──────────────
    //
    // "Nothing submitted" is only meaningful if a submission WOULD be seen.
    // Nothing in AskiMate may press this button (ADR-0014, and `FillableSession`
    // structurally has no `submit`), so the control is pressed here, by the
    // test, on purpose — and the counter is checked before and after.
    expect(portal.submissions(), "nothing has submitted so far").toEqual([]);

    const signedIn = sessionFrom(await form("/login", { email: EMAIL, password: PASSWORD }));
    const submitted = await form("/submit", {}, signedIn);
    expect(submitted.status).toBe(200);
    expect(portal.submissions()).toEqual([EMAIL]);
  });
});

describe("the blueprint describes THIS portal", () => {
  it("is executable and its mapping set is usable", () => {
    const executable = checkExecutable(GATED_PORTAL_BLUEPRINT);
    expect(executable.executable, JSON.stringify(executable)).toBe(true);
    const usable = checkUsable(GATED_PORTAL_MAPPING_SET, GATED_PORTAL_BLUEPRINT);
    expect(usable.usable, JSON.stringify(usable)).toBe(true);
  });

  it("requires an account, and says so", () => {
    expect(GATED_PORTAL_BLUEPRINT.authentication.required).toBe(true);
    expect(GATED_PORTAL_BLUEPRINT.authentication.accountCreationRequired).toBe(true);
    expect(GATED_PORTAL_BLUEPRINT.authentication.loginUrl).toBe(`${GATED_PORTAL_ORIGIN}/login`);
  });

  it("has NO mapping for either password field", () => {
    const passwords = GATED_PORTAL_BLUEPRINT.pages
      .flatMap((page) => page.sections)
      .flatMap((section) => section.fields)
      .filter((field) => field.inputType === "password")
      .map((field) => field.fieldRef);
    expect(passwords).toEqual(["account_password", "account_password_confirm"]);

    const mapped = GATED_PORTAL_MAPPING_SET.mappings.map((mapping) => mapping.fieldRef);
    for (const field of passwords) {
      expect(mapped, `${field} must have no mapping to review`).not.toContain(field);
    }
  });

  it("resolves EVERY reviewed locator against the real pages", async () => {
    // The assertion that stops this fixture drifting into a mock. A blueprint
    // saying "Given name" while the page says "First name" passes every other
    // test in this file and fails on the first real run.
    const context = await openSensitiveContext(browser, { userAgent: "test" });
    const page = await context.newPage();
    try {
      const signedIn = sessionFrom(await form("/login", { email: EMAIL, password: PASSWORD }));
      await context.addCookies([
        {
          name: "portal_session",
          value: signedIn.split("=")[1] ?? "",
          domain: "127.0.0.1",
          path: "/",
        },
      ]);

      for (const blueprintPage of GATED_PORTAL_BLUEPRINT.pages) {
        await page.goto(urlOf(blueprintPage));
        for (const section of blueprintPage.sections) {
          for (const field of section.fields) {
            const first = field.locators[0];
            if (first === undefined) {
              expect.unreachable(`${field.fieldRef} has no locator`);
              continue;
            }
            const target = toPlaywrightLocator(page, first);
            if (target === null) expect.unreachable(`${field.fieldRef} built no locator`);
            await expect(
              target.count(),
              `${blueprintPage.pageRef}/${field.fieldRef} (${first.strategy}=${first.value})`,
            ).resolves.toBe(1);
          }
        }
        // And the control the blueprint says advances the page.
        const advance = blueprintPage.advanceControl;
        if (advance !== undefined) {
          const control = toPlaywrightLocator(page, advance);
          if (control === null) expect.unreachable(`${blueprintPage.pageRef} built no control`);
          await expect(control.count(), `${blueprintPage.pageRef} advance control`).resolves.toBe(1);
        }
      }
    } finally {
      await context.close();
    }
  }, 60_000);
});
