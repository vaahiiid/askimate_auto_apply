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
  RobotsDisallowedError,
  ValueNotAcceptedError,
} from "./playwright-fill-session.js";
import { robotsGate } from "./robots-gate.js";

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
    // Sheffield's summary.do as captured on 2026-09-14 with one throwaway job
    // saved (P131) — the real listing, not a fixture in its shape.
    const sheffieldSummary = readFileSync(
      join(import.meta.dirname, "..", "..", "..", "docs", "captures", "sheffield-pgt-2026-09-14-employment", "001.html"),
      "utf8",
    );
    server = createServer((req, res) => {
      // The portal's robots.txt (P135): one path disallowed, a one-second delay.
      if (req.method === "GET" && req.url === "/robots.txt") {
        res.writeHead(200, { "content-type": "text/plain" }).end("User-agent: *\nDisallow: /private/\nCrawl-delay: 1\n");
        return;
      }
      if (req.method === "GET" && req.url === "/sheffield-summary") {
        res.writeHead(200, { "content-type": "text/html" }).end(sheffieldSummary);
        return;
      }
      // ── A lookup box in the first real form's shape (P179) ───────────
      //
      // Sheffield's institution search takes the chosen COUNTRY as a
      // parameter and answers nothing without it, and its entries arrive by
      // fetch rather than with the page. Attempt 5 met exactly that: the box
      // offered nothing and the line could not say whether anything had been
      // asked. This page is that shape, so the answer can be proved through a
      // real browser making a real request.
      if (req.method === "GET" && req.url?.startsWith("/lookup/search")) {
        const asked = new URL(req.url, "http://127.0.0.1");
        const forCountry = (asked.searchParams.get("country") ?? "").length > 0;
        res
          .writeHead(200, { "content-type": "application/json" })
          .end(
            JSON.stringify(
              forCountry ? [{ value: "SHEFFIELD", label: "University of Sheffield" }] : [],
            ),
          );
        return;
      }
      if (req.method === "GET" && req.url?.startsWith("/lookup")) {
        const country = new URL(req.url, "http://127.0.0.1").searchParams.get("country") ?? "";
        res.writeHead(200, { "content-type": "text/html" }).end(`<!doctype html>
<html><body>
  <input type="hidden" id="country" value="${country}">
  <input type="hidden" id="chosen" value="">
  <label for="place">Search for an institution...</label>
  <input type="text" id="place" autocomplete="off">
  <ul id="placeOptions" role="listbox"></ul>
  <script>
    // Tom Select's own shape, from its source (P180): 1.x binds KEYUP and has
    // no input listener (tom-select.ts:317 in 1.7.8), and the user's load is
    // wrapped in a 300 ms TRAILING debounce (loadDebounce, defaults.ts
    // loadThrottle: 300). Both are reproduced here, because both are what
    // made the runner's one-act fill ask the portal nothing while a person's
    // typing asked once.
    var box = document.getElementById("place");
    var pending = null;
    box.addEventListener("keyup", function () {
      if (pending) window.clearTimeout(pending);
      pending = window.setTimeout(search, 300);
    });
    function search() {
      pending = null;
      var country = document.getElementById("country").value;
      fetch("/lookup/search?name=" + encodeURIComponent(box.value) + "&studyAbroad=false&country=" + encodeURIComponent(country))
        .then(function (answer) { return answer.json(); })
        .then(function (offered) {
          var list = document.getElementById("placeOptions");
          list.innerHTML = "";
          offered.forEach(function (entry) {
            var option = document.createElement("li");
            option.setAttribute("role", "option");
            option.setAttribute("data-selectable", "");
            option.setAttribute("data-value", entry.value);
            option.textContent = entry.label;
            option.addEventListener("click", function () {
              document.getElementById("chosen").value = entry.value;
            });
            list.appendChild(option);
          });
        });
    }
  </script>
</body></html>`);
        return;
      }
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

  // ── P110: a radio is set by VALUE, and "yes" is a value ───────────────

  it("chooses the radio whose VALUE is \"yes\" — not the first one the locator finds", async () => {
    // Sheffield's nationality.do, read by Vahid on 2026-09-12: twelve groups
    // submit "yes" / "no". The old rule read the text "yes" as "tick this
    // radio" — a boolean — and ticked whichever member the locator resolved
    // to first. Here that is "no".
    const session = await openSession();
    await session.goto(`${baseUrl}/apply`);
    await session.fill({ strategy: "name", value: "lived_outside" }, confirmedText("yes"));
    expect(await session.readValue({ strategy: "name", value: "lived_outside" })).toBe("yes");
    await session.fill({ strategy: "name", value: "lived_outside" }, confirmedText("no"));
    expect(await session.readValue({ strategy: "name", value: "lived_outside" })).toBe("no");
  }, 30_000);

  it("REFUSES \"Yes\" on a group that offers \"yes\" — the case is the portal's, and nothing is chosen", async () => {
    // personal.do submits "Yes" / "No"; nationality.do submits "yes" / "no".
    // *"Any rule that normalises case would be wrong on one of them."*
    const session = await openSession();
    await session.goto(`${baseUrl}/apply`);
    await expect(
      session.fill({ strategy: "name", value: "lived_outside" }, confirmedText("Yes")),
    ).rejects.toThrow(OptionNotAvailableError);
    expect(await session.readValue({ strategy: "name", value: "lived_outside" })).toBe("");
  }, 30_000);

  it("still ticks a LONE radio told \"true\" — the boolean shortcut is for a radio that is not a group", async () => {
    const session = await openSession();
    await session.goto(`${baseUrl}/apply`);
    await session.fill({ strategy: "id", value: "agreeTerms" }, confirmedText("true"));
    expect(await session.readValue({ strategy: "id", value: "agreeTerms" })).toBe("agreed");
  }, 30_000);

  // ── P113: a listing counted by its numbered heading, exactly ──────────

  it("counts the entries whose heading reads exactly \"Previous Education N\" — not the section title, not another section, not a substring", async () => {
    // Sheffield's summary.do, read by Vahid on 2026-09-13: the wrappers are
    // every section's, so structure counts sections; what is specific is the
    // h5's own text, and that it is numbered. A text-shaped locator, named by
    // the reviewer in the page's words, exact to the number — not a guess.
    const session = await openSession();
    await session.goto(`${baseUrl}/apply`);
    expect(await session.count({ strategy: "css", value: 'div.homepageInfomation > h5:text-matches("^Previous Education [0-9]+$")' })).toBe(2);
    // The structural count is the wrong thing, as he said: it counts sections.
    expect(await session.count({ strategy: "css", value: "div.homepageInfomation" })).toBe(4);
    // And a substring would count the unnumbered title too.
    expect(await session.count({ strategy: "css", value: 'div.homepageInfomation > h5:has-text("Previous Education")' })).toBe(3);
  }, 30_000);

  it("counts the employment listing on Sheffield's summary.do AS CAPTURED — the same shape as education's, exact to the number (P131)", async () => {
    // The page Vahid committed (ebac18d): section F is div.homepageBlock >
    // div.homepageInfomation > h5 "Previous Employment 1", the entry's table,
    // its Edit and Delete links — education's shape with the other heading.
    // The locator the curated draft (0.2.20) carries, run by the runner's own
    // count against the real markup rather than a fixture in its shape.
    const session = await openSession();
    await session.goto(`${baseUrl}/sheffield-summary`);
    expect(await session.count({ strategy: "css", value: 'div.homepageInfomation > h5:text-matches("^Previous Employment [0-9]+$")' })).toBe(1);
    expect(await session.count({ strategy: "css", value: 'div.homepageInfomation > h5:text-matches("^Previous Education [0-9]+$")' })).toBe(2);
    // A section with no numbered heading counts nothing — and the section
    // title, an h2, is never an entry.
    expect(await session.count({ strategy: "css", value: 'div.homepageInfomation > h5:text-matches("^Previous Language [0-9]+$")' })).toBe(0);
    expect(await session.count({ strategy: "css", value: 'div.homepageInfomation > h5:has-text("Relevant Employment")' })).toBe(0);
  }, 30_000);

  // ── P135: robots.txt on the fill path, and the floor between navigations ──

  it("refuses a navigation the portal's robots.txt disallows, at the session as well as at the gate (P135, ADR-0091)", async () => {
    const gate = robotsGate({ now: () => NOW });
    const verdict = await gate.check([`${baseUrl}/apply`]);
    expect(verdict.allowed).toBe(true);
    if (!verdict.allowed) expect.unreachable("the fixture allows /apply");
    // The fixture's file disallows /private/ and states Crawl-delay: 1.
    const refused = await gate.check([`${baseUrl}/apply`, `${baseUrl}/private/staff-only`]);
    expect(refused.allowed).toBe(false);
    if (refused.allowed) expect.unreachable("refused");
    expect(refused.url).toBe(`${baseUrl}/private/staff-only`);
    const traceDir = await mkdtemp(join(tmpdir(), "aas-prep-"));
    const session = await PlaywrightPreparationSession.open({
      capability: "fillable",
      allowedHosts: ["127.0.0.1"],
      runId: "run-robots",
      traceDir,
      now: () => NOW,
      clickableControls: [],
      forbiddenEndpoints: [],
      robots: (url) => verdict.set.decide(url),
      pace: { minimumMs: verdict.delayMs },
    });
    sessions.push(session);
    const before = saved.length;
    await expect(session.goto(`${baseUrl}/private/staff-only`)).rejects.toThrow(RobotsDisallowedError);
    expect(saved.length).toBe(before);
    // ...and the page the file allows opens, paced: the second navigation
    // waits for the remainder of the floor. The fixture asks for one second.
    const started = Date.now();
    await session.goto(`${baseUrl}/apply`);
    await session.goto(`${baseUrl}/apply`);
    expect(Date.now() - started).toBeGreaterThanOrEqual(verdict.delayMs - 50);
    expect(verdict.delayMs).toBe(1_000);
  }, 30_000);

  // ── P94 (ADR-0103, gap 1) ─────────────────────────────────────────────

  it("waits for an option the page loads AFTER another field is set, then selects it", async () => {
    const session = await openSession();
    await session.goto(`${baseUrl}/apply`);
    await session.fill({ strategy: "id", value: "nationality" }, confirmedText("IR"));
    // Not yet there: the page fills the list 400ms after the change.
    await expect(
      session.fill({ strategy: "id", value: "passportCountry" }, confirmedText("IR")),
    ).rejects.toThrow(OptionNotAvailableError);

    await session.awaitOption({ strategy: "id", value: "passportCountry" }, "IR");
    await session.fill({ strategy: "id", value: "passportCountry" }, confirmedText("IR"));
    expect(await session.readValue({ strategy: "id", value: "passportCountry" })).toBe("IR");
  }, 30_000);

  it("fails with what the page offered when the option never arrives — bounded, and nothing chosen", async () => {
    const session = await openSession();
    await session.goto(`${baseUrl}/apply`);
    await session.fill({ strategy: "id", value: "nationality" }, confirmedText("IR"));

    const started = Date.now();
    await expect(
      session.awaitOption({ strategy: "id", value: "passportCountry" }, "GB"),
    ).rejects.toThrow(OptionNotAvailableError);
    expect(Date.now() - started).toBeLessThan(20_000);
    // The error names what WAS offered once the list had arrived.
    await expect(
      session.awaitOption({ strategy: "id", value: "passportCountry" }, "GB"),
    ).rejects.toThrow(/IR/);
    expect(await session.readValue({ strategy: "id", value: "passportCountry" })).toBe("");
  }, 30_000);

  // ── P95 (ADR-0103, gap 2) ─────────────────────────────────────────────

  const BIRTH_COUNTRY: FieldLocator = { strategy: "id", value: "birthCountry" };
  // The shape of the Sheffield draft's locator (P101): the list by its id, an
  // entry by its role and its selectable mark — never by a class, which
  // changes with state.
  const ENTRIES: FieldLocator = { strategy: "css", value: '#birthCountryOptions [role="option"][data-selectable]' };
  const CODE: FieldLocator = { strategy: "id", value: "birthCountryCode" };

  // ── ADR-0109 (P118): a typeahead entry is chosen by its TEXT and its VALUE, both ──
  //
  // Vahid, 2026-09-13: *"the mapping names the value AND the reviewer records
  // the text it reads as, and both must match at the fill."* The runner types
  // the text, waits for the ONE entry that reads exactly it AND carries the
  // value the form will submit, and chooses that entry. The value alone
  // finds nothing; the text alone finds nothing; the escape is refused by
  // value whatever it reads as.
  const entries = (text: string, escapeValue?: string) => ({ optionLocator: ENTRIES, text, ...(escapeValue === undefined ? {} : { escapeValue }) });

  it("types the text and chooses the ONE entry that reads it AND carries the value", async () => {
    const session = await openSession();
    await session.goto(`${baseUrl}/apply`);
    await session.fillTypeahead(BIRTH_COUNTRY, entries("Iran"), confirmedText("IRAN"));
    expect(await session.readValue(BIRTH_COUNTRY)).toBe("Iran");
    expect(await session.readValue(CODE)).toBe("IRAN");
    // The long label with its short value (Vahid's copy of the live country box).
    await session.fillTypeahead(BIRTH_COUNTRY, entries("Myanmar (Burma) [The Republic of the Union of Myanmar]"), confirmedText("MYANMAR"));
    expect(await session.readValue(CODE)).toBe("MYANMAR");
  }, 30_000);

  it("tells two entries that READ the same apart by their values — the case the decision was made for", async () => {
    // "Ireland" twice, as Sheffield's list reads "Sheffield International
    // College" twice (SCH40484, SHE0512). Text alone chose nothing (P97's
    // M7); text and value choose the one named.
    const session = await openSession();
    await session.goto(`${baseUrl}/apply`);
    await session.fillTypeahead(BIRTH_COUNTRY, entries("Ireland"), confirmedText("IRELAND-2"));
    expect(await session.readValue(CODE)).toBe("IRELAND-2");
    await session.fillTypeahead(BIRTH_COUNTRY, entries("Ireland"), confirmedText("IRELAND"));
    expect(await session.readValue(CODE)).toBe("IRELAND");
  }, 30_000);

  it("refuses when the text and the value do not name the SAME entry, or either names none — and chooses nothing", async () => {
    const session = await openSession();
    await session.goto(`${baseUrl}/apply`);
    // Text of one entry, value of another: no entry has both.
    await expect(session.fillTypeahead(BIRTH_COUNTRY, entries("Iran"), confirmedText("IRAQ"))).rejects.toThrow(OptionNotAvailableError);
    // The value as the text, or the text as the value: exact means exact, on each.
    await expect(session.fillTypeahead(BIRTH_COUNTRY, entries("IRAN"), confirmedText("IRAN"))).rejects.toThrow(OptionNotAvailableError);
    await expect(session.fillTypeahead(BIRTH_COUNTRY, entries("Iran"), confirmedText("Iran"))).rejects.toThrow(OptionNotAvailableError);
    // "Ira" offers Iran and Iraq; neither reads "Ira". "Atlantis" offers nothing.
    await expect(session.fillTypeahead(BIRTH_COUNTRY, entries("Ira"), confirmedText("IRAN"))).rejects.toThrow(/Iraq/);
    await expect(session.fillTypeahead(BIRTH_COUNTRY, entries("Atlantis"), confirmedText("ATLANTIS"))).rejects.toThrow(OptionNotAvailableError);
    // "Ital" offers ONE entry, Italy, and it is not the text: never the nearest.
    await expect(session.fillTypeahead(BIRTH_COUNTRY, entries("Ital"), confirmedText("ITALY"))).rejects.toThrow(OptionNotAvailableError);
    expect(await session.readValue(CODE)).toBe("");
  }, 60_000); // six bounded waits, each the runner's own five seconds

  // ── P179: a box that found nothing says what the page ASKED for ───────

  const PLACE: FieldLocator = { strategy: "id", value: "place" };
  const PLACE_ENTRIES: FieldLocator = {
    strategy: "css",
    value: '#placeOptions [role="option"][data-selectable]',
  };

  it("says what the page asked the portal and what came back, when the list arrives EMPTY", async () => {
    // ═══════════════════════════════════════════════════════════════════
    // Attempt 5 on the first real form, 2026-09-21. The line said:
    //
    //   institution-ts-control — The portal's "institution-ts-control" list
    //   does not offer the confirmed value (9 characters). It offers: .
    //
    // Empty, and nothing else. Four causes on the record read the same way
    // (blocker 49), and the option list cannot separate them, because the
    // difference is in what the page asked for and what the portal answered.
    //
    // This page is the real form's shape: the search takes the chosen country
    // and answers nothing without it, and the entries arrive by fetch.
    // ═══════════════════════════════════════════════════════════════════
    const session = await openSession();
    await session.goto(`${baseUrl}/lookup`);

    let thrown: unknown;
    try {
      await session.fillTypeahead(
        PLACE,
        { optionLocator: PLACE_ENTRIES, text: "University of Sheffield" },
        confirmedText("SHEFFIELD"),
      );
    } catch (error) {
      thrown = error;
    }
    if (!(thrown instanceof OptionNotAvailableError)) expect.unreachable("the list is empty");

    // The request went out, and the parameter that would have found something
    // arrived empty. That is the whole answer, and neither half of it is a
    // value: `name` is the text the reviewer recorded, and on the next box it
    // would be the student's own answer.
    expect(thrown.message).toContain(
      "GET /lookup/search?name=(set)&studyAbroad=(set)&country=(empty) → 200, 0 entries",
    );
    expect(thrown.message).toContain("the page asked the portal once");
    // Never the values, on either side: not what was typed, not what the
    // portal would have answered for a country that was set.
    expect(thrown.message).not.toContain("University of Sheffield");
    expect(thrown.message).not.toContain("UNITED KINGDOM");
  }, 30_000);

  it("TYPES key by key, so a box whose entries arrive on keyup is filled at all (P180)", async () => {
    // ═══════════════════════════════════════════════════════════════════
    // The fix, and the measurement behind it. Vahid, on the live form,
    // 2026-09-21: typing `sheff` by hand opened the list with all eleven
    // entries; the runner's fill asked the portal nothing — P179's line is
    // what showed that.
    //
    // The cause is in Tom Select's source and it is a version fork: 1.x
    // binds `keyup` and has NO `input` listener; 2.x binds `input` instead.
    // Playwright's `fill` dispatches one `input` event, so on a 1.x page it
    // fires nothing at all. Typing satisfies both, because a keystroke fires
    // keydown, keypress, input AND keyup.
    //
    // This page is 1.x's shape. With a one-act fill this test finds an empty
    // list and throws; with typing it chooses the entry.
    // ═══════════════════════════════════════════════════════════════════
    const session = await openSession();
    await session.goto(`${baseUrl}/lookup?country=UNITED+KINGDOM`);
    await session.fillTypeahead(
      PLACE,
      { optionLocator: PLACE_ENTRIES, text: "University of Sheffield" },
      confirmedText("SHEFFIELD"),
    );
    expect(await session.readValue({ strategy: "id", value: "chosen" })).toBe("SHEFFIELD");
  }, 30_000);

  it("says the page asked NOTHING when the entries are already there — the other half of the answer", async () => {
    // The same failure with no request behind it. `birthCountry`'s entries
    // are in the page, so a box that finds nothing there is a different
    // fault from one whose lookup came back empty, and the line says which.
    const session = await openSession();
    await session.goto(`${baseUrl}/apply`);
    let thrown: unknown;
    try {
      await session.fillTypeahead(BIRTH_COUNTRY, entries("Atlantis"), confirmedText("ATLANTIS"));
    } catch (error) {
      thrown = error;
    }
    if (!(thrown instanceof OptionNotAvailableError)) expect.unreachable("Atlantis is not offered");
    expect(thrown.message).toContain("the page made NO request of its own to the portal");
  }, 30_000);

  it("says NOTHING about requests when nobody was watching — the difference between none and unknown", async () => {
    // `awaitOption` raises the same error for a list that is already on the
    // page, and it does not watch. An empty record there would read as *the
    // page asked for nothing*, which nobody established. The line is silent
    // instead, and that silence is the honest answer.
    const session = await openSession();
    await session.goto(`${baseUrl}/apply`);
    await session.fill({ strategy: "id", value: "nationality" }, confirmedText("IR"));
    let thrown: unknown;
    try {
      await session.awaitOption({ strategy: "id", value: "passportCountry" }, "GB");
    } catch (error) {
      thrown = error;
    }
    if (!(thrown instanceof OptionNotAvailableError)) expect.unreachable("GB is not offered");
    expect(thrown.lookups, "nobody watched, and the error says so by holding nothing").toBeUndefined();
    expect(thrown.message).not.toContain("asked the portal");
    expect(thrown.message).not.toContain("NO request");
  }, 30_000);

  it("REFUSES the form's ESCAPE by its value, whatever it reads as — closing P102's OPEN case", async () => {
    // Sheffield's institution list ends with "Not in list", whose value is
    // its own label. Named on the blueprint as the escape, it is never
    // chosen: not when the text names it, not when the value does.
    const session = await openSession();
    await session.goto(`${baseUrl}/apply`);
    await expect(
      session.fillTypeahead(BIRTH_COUNTRY, entries("Not in list", "Not in list"), confirmedText("Not in list")),
    ).rejects.toThrow(ClickRefusedError);
    expect(await session.readValue(CODE)).toBe("");
    // The same words as a reviewed constant: the same refusal.
    await expect(
      session.fillTypeaheadConstant(BIRTH_COUNTRY, entries("Not in list", "Not in list"), "Not in list"),
    ).rejects.toThrow(ClickRefusedError);
    expect(await session.readValue(CODE)).toBe("");
  }, 30_000);

  it("refuses a list wait on a typeahead's box — it offers entries for what is typed, not a list to wait on (P102)", async () => {
    const session = await openSession();
    await session.goto(`${baseUrl}/apply`);
    await expect(session.awaitOption(BIRTH_COUNTRY, "Iran")).rejects.toThrow(OptionNotAvailableError);
  }, 30_000);

  it("is not put off by the state classes an entry carries", async () => {
    // "Iran" is rendered `class="option selected"` and the second "Ireland"
    // `class="option active"`: the locator names role and selectable mark,
    // so the class is not consulted.
    const session = await openSession();
    await session.goto(`${baseUrl}/apply`);
    await session.fillTypeahead(BIRTH_COUNTRY, entries("Iran"), confirmedText("IRAN"));
    expect(await session.readValue(CODE)).toBe("IRAN");
    await session.fillTypeahead(BIRTH_COUNTRY, entries("Ireland"), confirmedText("IRELAND-2"));
    expect(await session.readValue(CODE)).toBe("IRELAND-2");
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
