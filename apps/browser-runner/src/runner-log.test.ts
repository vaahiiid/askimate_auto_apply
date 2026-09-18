/**
 * The runner's log vocabulary (ADR-0124, P157).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-09-18, after Run A stopped at the sign-in twice with two words
 * on disk: *"The scrubbed message rule is the important half and I would
 * rather it were strict than useful… If a message cannot be scrubbed with
 * confidence, print the class alone and say the message was withheld. A URL
 * with a token in a log is a worse outcome than a log I cannot read."*
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { describe, expect, it } from "vitest";

import { describeThrown, RECOGNISED_PHRASES, signInStartLine, turnInWords,
  PRESS_CHECK_PHRASES,
  pressCheckInWords,
} from "./runner-log.js";

describe("what the runner may say about a thrown error", () => {
  it("names the class, and answers OUR phrase for a pattern it recognises", () => {
    // Playwright's own wording for a navigation that destroyed the context
    // the step was running in — the hypothesis Run A left open. What reaches
    // the log is the phrase written HERE, never the thrown text.
    const thrown = new Error(
      "page.click: Execution context was destroyed, most likely because of a navigation.",
    );
    const said = describeThrown(thrown);
    expect(said.errorClass).toBe("Error");
    expect(said.phrase).toBe("the page navigated while the step was running");
    expect(said.withheld).toBe(false);
  });

  it("answers a timeout as a timeout, without the message's own numbers or target", () => {
    const said = describeThrown(
      new Error("locator.click: Timeout 15000ms exceeded.\nCall log:\n  - waiting for locator('#signin')"),
    );
    expect(said.phrase).toBe("the step timed out");
    expect(said.withheld).toBe(false);
  });

  it("carries a Chromium network code, which is a closed vocabulary and names no page", () => {
    const said = describeThrown(new Error("page.goto: net::ERR_CONNECTION_RESET at https://portal.example/login"));
    expect(said.phrase).toBe("the network failed: ERR_CONNECTION_RESET");
    // The URL in the thrown text must not survive into the phrase.
    expect(said.phrase).not.toContain("portal.example");
    expect(said.phrase).not.toContain("http");
  });

  it("WITHHOLDS a message it does not recognise, and says so", () => {
    // The whole point. An unrecognised message may carry a page's text or a
    // URL with a token, so nothing of it is printed — not a prefix, not a
    // first line, not a redacted form.
    const said = describeThrown(
      new Error("Unexpected server reply: <html>Dear Vahid, your reset link is https://x/y?token=abcd</html>"),
    );
    expect(said.errorClass).toBe("Error");
    expect(said.phrase).toBeNull();
    expect(said.withheld).toBe(true);
  });

  it("never lets a recognised pattern smuggle the rest of the message through", () => {
    // A recognised prefix followed by a page's text. The phrase is ours and
    // fixed, so the tail cannot ride along.
    const said = describeThrown(
      new Error("Timeout 15000ms exceeded. Dear Vahid, token=abcd, https://x/y"),
    );
    expect(said.phrase).toBe("the step timed out");
    expect(said.phrase).not.toContain("abcd");
    expect(said.phrase).not.toContain("Vahid");
  });

  it("handles a thrown value that is not an Error at all", () => {
    expect(describeThrown("a string nobody should print")).toEqual({
      errorClass: "String",
      phrase: null,
      withheld: true,
    });
    expect(describeThrown(null)).toEqual({ errorClass: "Null", phrase: null, withheld: true });
  });

  it("every phrase it can print is in the closed set, and none contains a URL or a number from a message", () => {
    for (const phrase of RECOGNISED_PHRASES) {
      expect(phrase).not.toMatch(/https?:|www\.|token|@/i);
    }
    // The network phrase is a template; every other phrase is a fixed string.
    expect(RECOGNISED_PHRASES.length).toBeGreaterThan(3);
  });
});

describe("how a turn is announced (ADR-0124)", () => {
  it("says the OUTCOME, never the bare fact that a turn ended", () => {
    // ═══════════════════════════════════════════════════════════════════
    // Vahid, 2026-09-18: *"'worked' has to go. A word that means the same
    // thing for a successful sign-in and a failed one is worse than no
    // word. Print the outcome — succeeded, failed with which code, or
    // stopped — not the fact that a turn ended."*
    // ═══════════════════════════════════════════════════════════════════
    expect(
      turnInWords({ kind: "worked", runId: "run-1", report: { leaseId: "wl_1", outcome: "succeeded" } }),
    ).toBe("run run-1: sign-in/work succeeded");

    const failed = turnInWords({
      kind: "worked",
      runId: "run-1",
      report: { leaseId: "wl_1", outcome: "failed", failure: "runner_fault" },
    });
    expect(failed).toContain("failed");
    expect(failed).toContain("runner_fault");
    expect(failed, "the word that hid a failure for a whole live run").not.toContain("worked");

    const uncertain = turnInWords({
      kind: "worked",
      runId: "run-1",
      report: { leaseId: "wl_1", outcome: "uncertain", failure: "not_recorded" },
    });
    expect(uncertain).toContain("uncertain");
    expect(uncertain).toContain("not_recorded");

    expect(turnInWords({ kind: "report_refused", runId: "run-1" })).toContain("the plane would not accept");
    expect(turnInWords({ kind: "idle" })).toBeNull();
  });
});

describe("the line a sign-in writes before it starts (ADR-0124, reworded in P163)", () => {
  it("names how many sign-ins have FAILED so far, the URL and the run, so a runner that dies mid-attempt still said it started", () => {
    // Vahid: *"a line at the start of each sign-in attempt, not only at the
    // end: which attempt, which URL, when. If the runner dies mid-attempt, I
    // want to know it started."* The count is the PLANE's, carried on the
    // work item; the runner never invents it. And it is a count of FAILURES
    // (ADR-0120 counts failures: twice is the portal, and a success in
    // between ENDS the count — "a later loss is a new episode of two"), so
    // the line says so in the rule's own word. Before P163 it printed the
    // count plus one as "attempt N", which on Run A's third conversation
    // would have called the third sign-in "attempt 1".
    const line = signInStartLine({
      runId: "run-1",
      failuresSoFar: 1,
      url: "https://www.sheffield.ac.uk/apply/login",
    });
    expect(line).toContain("run run-1");
    expect(line).toContain("failures in this episode: 1 of 2 allowed");
    expect(line).not.toContain("attempt");
    expect(line).toContain("https://www.sheffield.ac.uk/apply/login");
    expect(line).toContain("starting");
  });

  it("says zero of two when the count is zero", () => {
    const line = signInStartLine({ runId: "run-1", failuresSoFar: 0, url: "https://portal.example/login" });
    expect(line).toContain("failures in this episode: 0 of 2 allowed");
  });

  it("says the count is unknown rather than guessing a number", () => {
    // An older plane that does not send the count. Saying "0 of 2" here
    // would be a number that does not mean what it says.
    const line = signInStartLine({ runId: "run-1", url: "https://portal.example/login" });
    expect(line).toContain("failures in this episode: unknown");
    expect(line).not.toContain("0 of 2");
  });
});

describe("which check a failed press was waiting on (ADR-0129)", () => {
  it("names Playwright's own check in our words, and never quotes the element", () => {
    const thrown = new Error(
      "locator.click: Timeout 15000ms exceeded.\nCall log:\n  - waiting for locator('#signIn')\n" +
        "  - <div id=\"ccc-overlay\" class=\"ccc-overlay\">Our cookies…</div> intercepts pointer events\n" +
        "  - retrying click action",
    );
    const said = pressCheckInWords(thrown);
    expect(said).toBe("another element intercepts pointer events");
    expect(said).not.toContain("ccc-overlay");
    expect(said).not.toContain("cookies");
  });

  it("says when the check is not one this log names, rather than guessing", () => {
    expect(pressCheckInWords(new Error("something else entirely"))).toBe("a check this log does not name");
    expect(pressCheckInWords("not an error")).toBe("a check this log does not name");
  });

  it("holds a closed set, each phrase ours", () => {
    expect(PRESS_CHECK_PHRASES).toEqual([
      "another element intercepts pointer events",
      "the button is not visible",
      "the button is outside the viewport",
      "the button is not enabled",
      "the button is not stable — it keeps moving",
    ]);
    for (const phrase of PRESS_CHECK_PHRASES) expect(phrase).not.toMatch(/https?:|@|<|>/);
  });
});
