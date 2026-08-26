/**
 * Preparation-mode tests.
 *
 * The pure guard is tested on its own; the session is tested against a real
 * Chromium and a local fixture portal, because the interesting properties —
 * "it refuses to click submit", "the portal really did save a draft" — are
 * facts about a browser talking to a server, not about a function.
 */

import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FieldLocator } from "@askimate/aas-blueprint";
import type { ConfirmedValue } from "@askimate/aas-domain";
import { proposeValue, studentId } from "@askimate/aas-domain";
import { applyConfirmation, isDeclined, renderConfirmed } from "@askimate/aas-profile";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  ClickAllowList,
  HostAllowList,
  WriteLog,
  decidePreparationRequest,
  isStateChanging,
  looksLikeSubmission,
} from "./preparation-safety.js";
import {
  ClickRefusedError,
  LocatorNotFoundError,
  OptionNotAvailableError,
  PlaywrightPreparationSession,
  ValueNotAcceptedError,
} from "./playwright-fill-session.js";

// ───────────────────────────────────────────────────────────────────────────
// The pure guard
// ───────────────────────────────────────────────────────────────────────────

describe("what reads as a submission control", () => {
  it("recognises the ways portals word it", () => {
    for (const name of [
      "Submit",
      "Submit application",
      "Send my application",
      "Confirm and send",
      "Finish and send",
      "Complete application",
      "Pay and submit",
      "Apply now",
    ]) {
      expect(looksLikeSubmission(name)).toBe(true);
    }
  });

  it("does not refuse the controls that merely advance a form", () => {
    for (const name of ["Save and continue", "Next", "Continue", "Back", "Save draft"]) {
      expect(looksLikeSubmission(name)).toBe(false);
    }
  });
});

describe("the click allow-list", () => {
  const advance: FieldLocator = { strategy: "id", value: "continueBtn" };
  const allowList = new ClickAllowList([advance]);

  it("permits a recorded advance control", () => {
    expect(allowList.decide(advance, "Save and continue").allowed).toBe(true);
  });

  it("refuses a control the blueprint never recorded", () => {
    const decision = allowList.decide({ strategy: "id", value: "somethingElse" }, "Next");
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("not one of the controls");
  });

  it("refuses a submission control EVEN IF it is on the allow-list", () => {
    // An allow-list assembled from a blueprint is only as right as the
    // blueprint. This is the second layer, and it is the one that matters.
    const mislisted: FieldLocator = { strategy: "id", value: "submitBtn" };
    const permissive = new ClickAllowList([mislisted]);

    const decision = permissive.decide(mislisted, "Submit application");
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("reads as a submission control");
  });
});

describe("the preparation network policy", () => {
  const allowList = new HostAllowList(["apply.example.test"]);
  const policy = { allowList, forbiddenEndpoints: ["https://apply.example.test/apply/submit"] };

  it("permits a POST to an allow-listed host — a portal saves drafts", () => {
    expect(
      decidePreparationRequest("POST", "https://apply.example.test/apply/save", policy).allowed,
    ).toBe(true);
  });

  it("refuses anything off-target, however harmless the method", () => {
    expect(decidePreparationRequest("GET", "https://analytics.example.com/x", policy).allowed).toBe(
      false,
    );
  });

  it("refuses a write to a recorded submission endpoint", () => {
    const decision = decidePreparationRequest(
      "POST",
      "https://apply.example.test/apply/submit",
      policy,
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("submission endpoint");
  });

  it("still permits reading the submission page", () => {
    // Reading the page is how the run knows what is there. It is the POST that
    // sends the application, not the GET.
    expect(
      decidePreparationRequest("GET", "https://apply.example.test/apply/submit", policy).allowed,
    ).toBe(true);
  });

  it("knows which methods change something", () => {
    expect(isStateChanging("GET")).toBe(false);
    expect(isStateChanging("post")).toBe(true);
    expect(isStateChanging("PATCH")).toBe(true);
  });
});

describe("the write log", () => {
  it("says plainly that the portal now holds something", () => {
    const log = new WriteLog();
    log.record("POST", "https://apply.example.test/apply/save");
    expect(log.summarise()).toContain("has stored something");
  });

  it("says so when nothing was sent", () => {
    expect(new WriteLog().summarise()).toContain("saved nothing");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Against a real browser and a real (local) portal
// ───────────────────────────────────────────────────────────────────────────

describe("filling a fixture portal", () => {
  let server: Server;
  let baseUrl: string;
  const saved: string[] = [];
  const submitted: string[] = [];
  const sessions: PlaywrightPreparationSession[] = [];

  const NOW = new Date("2026-08-26T10:00:00Z");
  const STUDENT = studentId("student-1");

  function confirmedText(value: string): ConfirmedValue<string> {
    const result = applyConfirmation({
      key: "identity.given_name",
      proposed: proposeValue({
        value,
        origin: "conversation",
        verbatim: value,
        confidence: 0.9,
      }),
      confirmation: {
        studentRef: STUDENT,
        presentedText: "…",
        respondedAt: NOW,
        response: { kind: "accepted" },
      },
    });
    if (isDeclined(result)) expect.unreachable("the student accepted");
    const rendered = renderConfirmed(result.value, { kind: "text" });
    if (!rendered.rendered) expect.unreachable("text renders");
    return rendered.value;
  }

  beforeAll(() => {
    const html = readFileSync(
      join(import.meta.dirname, "..", "fixtures", "preparation-form.html"),
      "utf8",
    );
    server = createServer((req, res) => {
      if (req.method === "POST" && req.url === "/apply/save") {
        saved.push(req.url);
        res.writeHead(204).end();
        return;
      }
      if (req.method === "POST" && req.url === "/apply/submit") {
        submitted.push(req.url);
        res.writeHead(204).end();
        return;
      }
      res.writeHead(200, { "content-type": "text/html" }).end(html);
    });
    return new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (address === null || typeof address === "string") throw new Error("no port");
        baseUrl = `http://127.0.0.1:${String(address.port)}`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    while (sessions.length > 0) await sessions.pop()?.close();
  });

  afterAll(() => {
    server.close();
  });

  async function openSession(
    clickableControls: readonly FieldLocator[] = [{ strategy: "id", value: "continueBtn" }],
  ): Promise<PlaywrightPreparationSession> {
    const traceDir = await mkdtemp(join(tmpdir(), "aas-prep-"));
    const session = await PlaywrightPreparationSession.open({
      capability: "fillable",
      allowedHosts: ["127.0.0.1"],
      runId: "run-prep-test",
      traceDir,
      now: () => NOW,
      clickableControls,
      forbiddenEndpoints: [`${baseUrl}/apply/submit`],
    });
    sessions.push(session);
    return session;
  }

  it("types confirmed values into the right fields", async () => {
    const session = await openSession();
    await session.goto(`${baseUrl}/apply`);

    await session.fill({ strategy: "label", value: "First name" }, confirmedText("Niloofar"));
    await session.fill({ strategy: "id", value: "familyName" }, confirmedText("Hosseini"));
    await session.fill({ strategy: "name", value: "date_of_birth" }, confirmedText("02/04/1999"));

    // Read the values back out of the real page rather than trusting the calls.
    expect(await session.readValue({ strategy: "id", value: "givenName" })).toBe("Niloofar");
    expect(await session.readValue({ strategy: "id", value: "familyName" })).toBe("Hosseini");
    expect(await session.readValue({ strategy: "id", value: "dob" })).toBe("02/04/1999");
  }, 30_000);

  it("sets a dropdown by the portal's own option value", async () => {
    const session = await openSession();
    await session.goto(`${baseUrl}/apply`);
    await session.fill({ strategy: "id", value: "nationality" }, confirmedText("IR"));

    expect(await session.readValue({ strategy: "id", value: "nationality" })).toBe("IR");
  }, 30_000);

  it("fails rather than choosing a default when the option does not exist", async () => {
    const session = await openSession();
    await session.goto(`${baseUrl}/apply`);

    await expect(
      session.fill({ strategy: "id", value: "nationality" }, confirmedText("KURDISH")),
    ).rejects.toThrow(OptionNotAvailableError);

    // Nothing was chosen. A wrong nationality is worse than a blank one.
    expect(await session.readValue({ strategy: "id", value: "nationality" })).toBe("");
  }, 30_000);

  it("attaches a document", async () => {
    const session = await openSession();
    await session.goto(`${baseUrl}/apply`);
    await session.attach(
      { strategy: "id", value: "passport" },
      "doc-passport-1",
      new TextEncoder().encode("%PDF-1.4 fake"),
    );

    // The browser reports an attached file through the input's value.
    expect(await session.readValue({ strategy: "id", value: "passport" })).toContain(
      "doc-passport-1",
    );
  }, 30_000);

  // ── The one that matters ────────────────────────────────────────────────

  it("REFUSES to click the submit button", async () => {
    const session = await openSession();
    await session.goto(`${baseUrl}/apply`);

    const before = submitted.length;
    await expect(session.click({ strategy: "id", value: "submitBtn" })).rejects.toThrow(
      ClickRefusedError,
    );

    // Not merely an exception — the application was not sent.
    expect(submitted).toHaveLength(before);
  }, 30_000);

  it("refuses even when the submit button is on the click allow-list", async () => {
    const session = await openSession([{ strategy: "id", value: "submitBtn" }]);
    await session.goto(`${baseUrl}/apply`);

    const before = submitted.length;
    await expect(session.click({ strategy: "id", value: "submitBtn" })).rejects.toThrow(
      ClickRefusedError,
    );
    expect(submitted).toHaveLength(before);
  }, 30_000);

  it("clicks the advance control, and records the draft the portal saved", async () => {
    const session = await openSession();
    await session.goto(`${baseUrl}/apply`);

    const before = saved.length;
    await session.click({ strategy: "id", value: "continueBtn" });
    await session.observe();

    expect(saved.length).toBeGreaterThan(before);
    // The run is honest about having changed something on the server.
    expect(session.writeLog.count).toBeGreaterThan(0);
    expect(session.writeLog.summarise()).toContain("has stored something");
  }, 30_000);

  it("catches a value the portal silently truncated", async () => {
    const session = await openSession();
    await session.goto(`${baseUrl}/apply`);

    // The field has maxlength="50". The browser accepts the fill and quietly
    // keeps the first 50 characters — the page looks entirely normal, and the
    // stored name is not the student's name.
    const tooLong = "N".repeat(60);
    await expect(
      session.fill({ strategy: "id", value: "givenName" }, confirmedText(tooLong)),
    ).rejects.toThrow(ValueNotAcceptedError);
  }, 30_000);

  it("records a value the portal reformatted, without treating it as a failure", async () => {
    const session = await openSession();
    await session.goto(`${baseUrl}/apply`);

    // Nothing on this fixture reformats, so the log stays empty — the point of
    // the assertion is that ordinary fills do not accumulate false alarms.
    await session.fill({ strategy: "id", value: "givenName" }, confirmedText("Niloofar"));
    expect(session.reformattedFields).toHaveLength(0);
  }, 30_000);

  it("refuses to navigate off the allow-listed host", async () => {
    const session = await openSession();
    await expect(session.goto("https://www.ulster.ac.uk/")).rejects.toThrow(/allow-list/);
  }, 30_000);

  it("reports blueprint drift rather than looking for something similar", async () => {
    const session = await openSession();
    await session.goto(`${baseUrl}/apply`);

    await expect(
      session.fill({ strategy: "id", value: "middleName" }, confirmedText("x")),
    ).rejects.toThrow(LocatorNotFoundError);
  }, 30_000);
});
