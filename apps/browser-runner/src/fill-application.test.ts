/**
 * What the fill does when the page does not cooperate.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Written after a deliberate regression was NOT detected. Changing the outcome
 * of a save that never lands from `uncertain` to `failed` broke nothing,
 * because the journey only ever exercises a portal that answers.
 *
 * It is the most consequential distinction in the fill: the click may have
 * reached the portal and the page may be saved, and `failed` asserts that
 * nothing happened on a university's system — a claim about somebody else's
 * database that this process is not entitled to make (ADR-0008).
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { describe, expect, it } from "vitest";

import type { ClaimedWork } from "@askimate/aas-contracts";
import type { ApplicationSession } from "@askimate/aas-execution";

import { fillApplication } from "./fill-application.js";

const NOW = new Date("2026-08-31T10:00:00Z");
const FORM = "https://portal.test/apply";

const WORK: ClaimedWork = {
  leaseId: "wl_1",
  expiresAt: NOW.toISOString(),
  runId: "run_1",
  caseId: "case_1",
  studentRef: "11111111-1111-1111-1111-111111111111",
  kind: "execute",
  portalHost: "portal.test",
  email: "niloofar@example.test",
  approach: "student_chosen",
  formUrl: FORM,
  advanceLocator: { strategy: "role", value: "button:Save and continue" },
  plan: {
    blueprintId: "bp",
    blueprintVersion: "1.0.0",
    mappingSetId: "ms",
    instructions: [
      {
        fieldRef: "given_name",
        label: "First name",
        inputType: "text",
        locators: [{ strategy: "label", value: "First name" }],
        value: {
          kind: "confirmed",
          fieldKey: "identity.given_name",
          text: "Niloofar",
          provenance: { source: "student_stated", confirmedAt: NOW.toISOString() },
        },
      },
    ],
  },
};

/** A session that does what it is told, and records it. */
function session(over: Partial<ApplicationSession> = {}): ApplicationSession & {
  readonly typed: string[];
  readonly clicked: string[];
} {
  const typed: string[] = [];
  const clicked: string[] = [];
  let url = FORM;
  return {
    typed,
    clicked,
    goto: (to: string) => {
      url = to;
      return Promise.resolve();
    },
    fill: (_locator, value) => {
      typed.push(String((value as unknown as { value: string }).value));
      return Promise.resolve();
    },
    fillConstant: (_locator, text) => {
      typed.push(text);
      return Promise.resolve();
    },
    click: (locator) => {
      clicked.push(locator.value);
      return Promise.resolve();
    },
    attach: () => Promise.reject(new Error("no documents")),
    readValue: () => Promise.resolve("Niloofar"),
    currentUrl: () => Promise.resolve(url),
    ...over,
  };
}

describe("filling a page that does not cooperate", () => {
  it("types, then SAVES — because a portal keeps nothing until the page is saved", async () => {
    const live = session();
    expect(await fillApplication(WORK, { session: live, now: () => NOW })).toEqual({
      kind: "succeeded",
    });
    expect(live.typed).toEqual(["Niloofar"]);
    expect(live.clicked, "the save is not optional").toEqual(["button:Save and continue"]);
  });

  it("reports UNCERTAIN when the save never lands, never a clean failure", async () => {
    const dying = session({
      click: () => Promise.reject(new Error("net::ERR_CONNECTION_RESET at /apply")),
    });
    const outcome = await fillApplication(WORK, { session: dying, now: () => NOW });
    expect(outcome).toEqual({ kind: "uncertain", failure: "runner_fault" });
    // And the page's error text is nowhere in the answer. There is no field on
    // the outcome that could hold what a site we do not control wrote.
    expect(JSON.stringify(outcome)).not.toContain("ERR_CONNECTION");
  });

  it("refuses when the student has been logged out", async () => {
    // The gate redirects to the registration page without a session. Only the
    // student can get us back in — the password was single-use and is gone —
    // so `needs_the_student` is the honest answer rather than a retry.
    const loggedOut = session({
      currentUrl: () => Promise.resolve("https://portal.test/register"),
    });
    expect(await fillApplication(WORK, { session: loggedOut, now: () => NOW })).toEqual({
      kind: "failed",
      failure: "needs_the_student",
    });
    expect(loggedOut.typed, "and nothing was typed into the wrong page").toEqual([]);
  });

  it("refuses a form that is not on the bound host", async () => {
    const elsewhere = session();
    const outcome = await fillApplication(
      { ...WORK, formUrl: "https://somewhere-else.test/apply" },
      { session: elsewhere, now: () => NOW },
    );
    expect(outcome).toEqual({ kind: "failed", failure: "portal_drift" });
    expect(elsewhere.typed).toEqual([]);
  });

  it("refuses an execute item with no plan, rather than guessing", async () => {
    const idle = session();
    // Built by omission rather than by assigning `undefined`: with
    // `exactOptionalPropertyTypes` those are different things, and the wire
    // form of "absent" is the one a plane would actually send.
    const { plan: _plan, ...withoutAPlan } = WORK;
    void _plan;
    const outcome = await fillApplication(withoutAPlan, { session: idle, now: () => NOW });
    expect(outcome).toEqual({ kind: "failed", failure: "portal_drift" });
    expect(idle.typed).toEqual([]);
  });

  it("reports a portal that refused, distinguished from drift", async () => {
    // `drift` is the executor's word for "the page was not what the blueprint
    // described". Everything else is the portal declining what we sent, and the
    // two lead to different work: one is a blueprint to re-review, the other is
    // content to fix.
    const refusing = session({
      fill: () => Promise.reject(new Error("the portal would not take it")),
    });
    expect(await fillApplication(WORK, { session: refusing, now: () => NOW })).toEqual({
      kind: "failed",
      failure: "portal_refused",
    });
  });
});
