/**
 * The hold: in memory, per run, five minutes idle, and nothing written.
 * ADR-0101 §2, with a clock the test moves rather than waits on.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";

import { SECURE_HOLD_CEILING_SECONDS } from "@askimate/aas-contracts";

import { SessionHold } from "./session-hold.js";

let browser: Browser;
let clock = new Date("2026-09-10T12:00:00Z");
const now = (): Date => clock;
const advance = (seconds: number): void => {
  clock = new Date(clock.getTime() + seconds * 1000);
};

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
}, 60_000);

afterAll(async () => {
  await browser.close();
});

describe("what it holds", () => {
  it("is the vault's ceiling, referenced and not redeclared", () => {
    // Vahid: "Two different timeouts for two sensitive things is how someone
    // eventually applies the wrong one."
    expect(SessionHold.CEILING_SECONDS).toBe(SECURE_HOLD_CEILING_SECONDS);
    expect(SessionHold.CEILING_SECONDS).toBe(300);
  });

  it("keeps a run's context between looks, and declares the run", async () => {
    const hold = new SessionHold({ browser, now });
    try {
      const context = await hold.open("run_a");
      expect(await hold.open("run_a"), "the same context, not a second one").toBe(context);
      expect(await hold.held()).toEqual(["run_a"]);
      const page = await hold.pageFor("run_a");
      expect(page, "a page in the held context").not.toBeNull();
      expect(page?.context()).toBe(context);
      expect(await hold.pageFor("run_b"), "a run it does not hold").toBeNull();
    } finally {
      await hold.closeAll();
    }
  });

  it("lets a context go once it has idled past five minutes, and not before", async () => {
    const hold = new SessionHold({ browser, now });
    try {
      const context = await hold.open("run_idle");
      advance(SessionHold.CEILING_SECONDS - 1);
      expect(await hold.held(), "one second inside the bound").toEqual(["run_idle"]);
      // A use resets the clock the bound counts from.
      await hold.pageFor("run_idle");
      advance(SessionHold.CEILING_SECONDS - 1);
      expect(await hold.held(), "used since; still held").toEqual(["run_idle"]);
      advance(1);
      expect(await hold.held(), "exactly at the bound: gone").toEqual([]);
      expect(await hold.pageFor("run_idle")).toBeNull();
      // Closed, not merely forgotten: the browser has no such context any more.
      expect(browser.contexts()).not.toContain(context);
    } finally {
      await hold.closeAll();
    }
  });

  it("adopts a context signed in by other means, closing any it already held for the run", async () => {
    const hold = new SessionHold({ browser, now });
    try {
      const first = await hold.open("run_adopt");
      const signedInElsewhere = await browser.newContext();
      await hold.adopt("run_adopt", signedInElsewhere);
      expect(browser.contexts(), "one session per run").not.toContain(first);
      expect((await hold.pageFor("run_adopt"))?.context()).toBe(signedInElsewhere);
    } finally {
      await hold.closeAll();
    }
  });

  it("closes everything when the process stops, and nothing survives", async () => {
    const hold = new SessionHold({ browser, now });
    await hold.open("run_x");
    await hold.open("run_y");
    const before = browser.contexts().length;
    await hold.closeAll();
    expect(await hold.held()).toEqual([]);
    expect(browser.contexts().length).toBe(before - 2);
  });
});
