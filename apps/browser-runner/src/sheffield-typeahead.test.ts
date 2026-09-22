/**
 * The institution box, rebuilt from the portal's own code (P184).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Seven attempts at Sheffield's `education.do` ended the same way: the
 * institution box offered nothing, and every explanation anyone reached for
 * turned out to be wrong when it was checked.
 *
 *   ADR-0133 said the portal shipped Tom Select 1.x, whose `keyup` binding a
 *   one-act fill never reaches. Vahid fetched the page's scripts: **2.3.1**,
 *   which binds `input`. Withdrawn (P183).
 *
 *   P181 said the fill session's guard might be refusing the page's own
 *   requests. The guard had no method rule — and was not installed on the
 *   attached context at all. Refuted, and fixed (P182).
 *
 *   P183 said the widget might have no `load` function on a fresh page, which
 *   would make it ask nothing, silently, with no error. Vahid read the live
 *   instance off the element on 2026-09-22: `load` IS set, with
 *   `shouldLoad: e => e.length > 0`, `loadThrottle: 300`, `valueField: "code"`,
 *   `labelField: "displayName"`, `searchField: []`, `openOnFocus: true`.
 *   Ruled out.
 *
 *   And he typed the runner's own text — the whole of "University of
 *   Sheffield", key by key — by hand into that box. The list came.
 *
 * So the widget is configured, the query works, the country is set, and the
 * only thing left that differs is **the runner's act**. This file removes the
 * portal from that sentence: the same vendored bundle, the same settings, the
 * portal's own `loadInstitutionSearch` and `searchInstitutions` served
 * verbatim from the committed capture, and the runner driven at it through
 * `attach()` — the door production uses.
 *
 * It is a fixture, so it cannot prove anything about Sheffield. What it can do
 * is tell us which side the fault is on, without a password and without
 * touching a live site. That is the whole point of it.
 *
 * ── Nothing here is retyped ───────────────────────────────────────────────
 *
 * `tom-select.complete.min.js` and `education.js` are read off disk from
 * `docs/captures/sheffield-pgt-2026-09-21-education-scripts/` and served
 * byte for byte. A hand-written imitation of a widget is how P180 came to
 * prove a fix against a version the portal does not run.
 */

import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import type { FieldLocator } from "@askimate/aas-blueprint";
import type { ConfirmedValue } from "@askimate/aas-domain";
import { proposeValue, studentId } from "@askimate/aas-domain";
import { applyConfirmation, isDeclined, renderConfirmed } from "@askimate/aas-profile";
import type { Browser, Page } from "playwright";
import { chromium } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { OptionNotAvailableError, PlaywrightPreparationSession } from "./playwright-fill-session.js";
import { openSensitiveContext } from "./sensitive.js";

const CAPTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../docs/captures/sheffield-pgt-2026-09-21-education-scripts",
);
// Served WITH a charset, and the page declares one (P184). Without either,
// Chromium decodes a classic script in the document's fallback encoding —
// windows-1252 — and Tom Select's diacritics table becomes mojibake, which
// throws `Invalid regular expression: Range out of order in character class`
// before `TomSelect` is ever defined. The committed capture is clean UTF-8;
// the first run of this fixture broke on its own serving, not on the bundle.
const TOM_SELECT = readFileSync(join(CAPTURE, "tom-select.complete.min.js"), "utf8");
const EDUCATION_JS = readFileSync(join(CAPTURE, "education.js"), "utf8");

const NOW = new Date("2026-09-22T09:00:00.000Z");

/** The eleven entries one search for "Sheff" in the United Kingdom returned (P118). */
const ENTRIES: readonly { readonly code: string; readonly displayName: string }[] = [
  { code: "SHEFFIELD", displayName: "University of Sheffield" },
  { code: "SCH40189", displayName: "Sheffield College" },
  { code: "UNI1182", displayName: "Sheffield Hallam University" },
  { code: "UNI9147", displayName: "Sheffield Hallam University / City University Hong Kong" },
  { code: "SCH40484", displayName: "Sheffield International College" },
  { code: "SHE0512", displayName: "Sheffield International College" },
  { code: "UNI7760", displayName: "Sheffield School of Nursing" },
  { code: "UNI24866", displayName: "Sheffield and North Trent College of Nursing and Midwifery" },
  { code: "SHE0600", displayName: "University of Sheffield International College" },
  { code: "UNI7619", displayName: "University of Sheffield's Institute of Work Psychology" },
];

const INSTITUTION: FieldLocator = { strategy: "id", value: "institution-ts-control" };
const INSTITUTION_ENTRIES: FieldLocator = {
  strategy: "css",
  value: '#institution-ts-dropdown [role="option"][data-selectable]',
};
const COUNTRY: FieldLocator = { strategy: "id", value: "institutionCountry-ts-control" };
const COUNTRY_ENTRIES: FieldLocator = {
  strategy: "css",
  value: '#institutionCountry-ts-dropdown [role="option"][data-selectable]',
};

const STUDENT = studentId("11111111-1111-4111-8111-111111111111");

function confirmedText(value: string): ConfirmedValue<string> {
  const result = applyConfirmation({
    key: "identity.given_name",
    proposed: proposeValue({ value, origin: "conversation", verbatim: value, confidence: 0.9 }),
    confirmation: {
      studentRef: STUDENT,
      presentedText: "\u2026",
      respondedAt: NOW,
      response: { kind: "accepted" },
    },
  });
  if (isDeclined(result)) throw new Error("the fixture's own value was declined");
  const rendered = renderConfirmed(result.value, { kind: "text" });
  if (!rendered.rendered) throw new Error("text renders");
  return rendered.value;
}

describe("the institution box, in the portal's own code", () => {
  let server: Server;
  let baseUrl = "";
  /** Every search the page made, so a silent box can be told from an answered one. */
  let searched: { readonly name: string; readonly country: string; readonly studyAbroad: string }[] =
    [];
  let gradingPosts: string[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");

      if (url.pathname === "/scripts/tom-select/tom-select.complete.min.js") {
        res.writeHead(200, { "content-type": "application/javascript; charset=utf-8" }).end(TOM_SELECT);
        return;
      }
      if (url.pathname === "/education.js") {
        res.writeHead(200, { "content-type": "application/javascript; charset=utf-8" }).end(EDUCATION_JS);
        return;
      }

      // The portal's own search endpoint, in the shape `searchInstitutions`
      // builds and `loadInstitutionSearch` consumes: a JSON list of
      // {code, displayName}, and NOTHING without a country — the behaviour
      // P179 met on the live form.
      if (url.pathname === "/ajax/institution/search.app") {
        const name = url.searchParams.get("name") ?? "";
        const country = url.searchParams.get("country") ?? "";
        searched.push({
          name,
          country,
          studyAbroad: url.searchParams.get("studyAbroad") ?? "",
        });
        const hits =
          country.length === 0
            ? []
            : ENTRIES.filter((entry) =>
                entry.displayName.toLowerCase().includes(name.toLowerCase()),
              );
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(hits));
        return;
      }

      // The sibling lookup, POST with its parameters in the query string —
      // the shape the 10 September capture recorded.
      if (url.pathname === "/getGradingSystemsForCountry.do") {
        gradingPosts.push(url.search);
        res.writeHead(200, { "content-type": "text/xml" }).end("<grades/>");
        return;
      }

      res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(`<!doctype html>
<html><head><meta charset="utf-8"></head><body>
  <form name="form">
    <select id="institutionCountry" name="institutionCountry" onchange="institutionChanged()">
      <option value=""></option>
      <option value="UNITED KINGDOM">United Kingdom</option>
      <option value="INDIA">India</option>
    </select>

    <select id="institution" name="institutionCode" onchange="institutionChanged()"></select>

    <div id="indiaWarning" style="display:none">India</div>
    <div id="unlistedInstitutionDiv" style="display:none">Unlisted</div>
    <span id="gradingSystemLoader" style="display:none">loading</span>
    <select id="gradingSystems" name="gradingSystemId"><option value="">Enter your institution to see grades</option></select>
  </form>

  <script>var erasmusStudyAbroad = false;</script>
  <script src="/scripts/tom-select/tom-select.complete.min.js"></script>
  <script src="/education.js"></script>
  <script>
    // Vahid read these off the live instance on 2026-09-22, from
    // document.getElementById('institution').tomselect.settings. They are not
    // a guess at the construction: they ARE the construction, as the widget
    // reports it.
    new TomSelect('#institution', {
      valueField: 'code',
      labelField: 'displayName',
      searchField: [],
      load: loadInstitutionSearch,
      shouldLoad: function (q) { return q.length > 0; },
      preload: null,
      loadThrottle: 300,
      maxOptions: null,
      openOnFocus: true,
      placeholder: 'Search for an institution...'
    });
    // The country box is a Tom Select over a plain select, with NO load —
    // which is what he read: load=undefined on that element.
    new TomSelect('#institutionCountry', {});
  </script>
</body></html>`);
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (address === null || typeof address === "string") throw new Error("no port");
        baseUrl = `http://127.0.0.1:${String(address.port)}`;
        resolve();
      });
    });
  });

  afterAll(() => {
    server.close();
  });

  const opened: Browser[] = [];
  afterEach(async () => {
    searched = [];
    gradingPosts = [];
    while (opened.length > 0) await opened.pop()?.close();
  });

  async function attachSession(): Promise<{
    session: PlaywrightPreparationSession;
    page: Page;
  }> {
    const executablePath = process.env["AAS_CHROMIUM_PATH"];
    const browser = await chromium.launch({
      headless: true,
      ...(executablePath !== undefined && executablePath.length > 0 ? { executablePath } : {}),
    });
    opened.push(browser);
    // The production door (ADR-0046 §6, ADR-0134): a sensitive context, a page
    // handed to the session rather than opened by it.
    const context = await openSensitiveContext(browser, { userAgent: "aas-test" });
    const page = await context.newPage();
    const session = await PlaywrightPreparationSession.attach(page, {
      capability: "fillable",
      allowedHosts: ["127.0.0.1"],
      runId: "run-sheffield-typeahead",
      now: () => NOW,
      clickableControls: [],
    });
    await page.goto(`${baseUrl}/education.do?new=true`);
    return { session, page };
  }

  it("fills the country and then the institution, through the runner's own act", async () => {
    const { session, page } = await attachSession();

    // Exactly the order the plan walks: the country box first, because the
    // institution's options follow it (`optionsAfter`, ADR-0103 gap 1).
    await session.fillTypeahead(
      COUNTRY,
      { optionLocator: COUNTRY_ENTRIES, text: "United Kingdom" },
      confirmedText("UNITED KINGDOM"),
    );
    expect(await page.locator("#institutionCountry").inputValue()).toBe("UNITED KINGDOM");

    let thrown: unknown;
    try {
      await session.fillTypeahead(
        INSTITUTION,
        { optionLocator: INSTITUTION_ENTRIES, text: "University of Sheffield" },
        confirmedText("SHEFFIELD"),
      );
    } catch (error) {
      thrown = error;
    }

    // The diagnosis, printed whichever way it goes: if the runner's act is at
    // fault this is the line that says so, and it is the same line the live
    // attempts produced.
    if (thrown instanceof OptionNotAvailableError) {
      expect.unreachable(
        `the runner could not fill the box on the portal's OWN code. ` +
          `Searches the page made: ${JSON.stringify(searched)}. ` +
          `Grading POSTs: ${JSON.stringify(gradingPosts)}. Line: ${thrown.message}`,
      );
    }
    // Anything else is the fixture's own fault and is reported as such.
    if (thrown instanceof Error) throw thrown;
    if (thrown !== undefined) expect.unreachable("the fill threw something that is not an Error");

    // What the portal would have stored.
    expect(await page.locator("#institution").inputValue()).toBe("SHEFFIELD");
    // And the search really went out, with the country the hidden select holds.
    expect(searched).toHaveLength(1);
    expect(searched[0]?.name).toBe("University of Sheffield");
    expect(searched[0]?.country).toBe("UNITED KINGDOM");
    expect(searched[0]?.studyAbroad).toBe("false");
  }, 60_000);
});
