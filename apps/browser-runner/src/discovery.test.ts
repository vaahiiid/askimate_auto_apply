/**
 * Discovery tests.
 *
 * The safety tests come first, because "discovery cannot submit" is the
 * property Vahid's go-ahead was conditional on.
 */

import { createServer, type Server } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { FlowSignal } from "./observe-script.js";
import { PlaywrightDiscoverySession } from "./playwright-session.js";
import { HostAllowList, decideDiscoveryRequest, decideDiscoveryRequestForHost } from "./safety.js";
import { draftBlueprintFrom, inputTypeOf, pageFrom, validationsOf } from "./discovery.js";
import type { FieldLocator } from "@askimate/aas-blueprint";
import type { PageObservation } from "./session.js";
import { checkExecutable } from "@askimate/aas-blueprint";

// ── The pure guard rules, testable with no browser ────────────────────────

describe("the read-only guard", () => {
  it("permits safe, idempotent reads", () => {
    for (const method of ["GET", "HEAD", "OPTIONS", "get"]) {
      expect(decideDiscoveryRequest(method, "https://example.com/").allowed).toBe(true);
    }
  });

  it("BLOCKS every state-changing method", () => {
    // The property Vahid's authorisation depends on.
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const decision = decideDiscoveryRequest(method, "https://example.com/apply");
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain("must not create, modify or submit");
    }
  });

  it("blocks an unrecognised method rather than permitting it", () => {
    // Allow-list, not block-list: a method nobody thought of is refused.
    expect(decideDiscoveryRequest("PROPFIND", "https://example.com/").allowed).toBe(false);
    expect(decideDiscoveryRequest("", "https://example.com/").allowed).toBe(false);
  });

  it("confines a run to its allow-listed hosts", () => {
    const allow = new HostAllowList(["qahighereducation.com"]);
    expect(allow.permits("https://apply.qahighereducation.com/s/login/")).toBe(true);
    expect(allow.permits("https://qahighereducation.com/")).toBe(true);
    expect(allow.permits("https://www.ulster.ac.uk/")).toBe(false);
    expect(allow.permits("https://evil.com/?x=qahighereducation.com")).toBe(false);
  });

  it("fails closed on an unparseable URL", () => {
    expect(new HostAllowList(["example.com"]).permits("not a url")).toBe(false);
  });

  it("blocks a POST even to an allow-listed host", () => {
    const allow = new HostAllowList(["example.com"]);
    expect(decideDiscoveryRequestForHost("POST", "https://example.com/apply", allow).allowed).toBe(false);
  });
});

// ── The runtime, against a local fixture ──────────────────────────────────

describe("discovery against a fixture portal", () => {
  let server: Server;
  let baseUrl: string;
  let trackAttempts = 0;

  beforeAll(async () => {
    const html = await readFile(
      join(import.meta.dirname, "..", "fixtures", "application-form.html"),
      "utf8",
    );
    server = createServer((req, res) => {
      if (req.method === "POST") {
        // Reached only if the guard failed. Counted so the test can prove it
        // did not.
        trackAttempts += 1;
        res.writeHead(200).end("{}");
        return;
      }
      res.writeHead(200, { "content-type": "text/html" }).end(html);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("no address");
    baseUrl = `http://127.0.0.1:${String(address.port)}`;
  });

  afterAll(() => {
    server.close();
  });

  it("BLOCKS the portal's own POST on page load", async () => {
    // The fixture fires a POST from its own JavaScript the moment it loads —
    // exactly how a portal might register a partial application. No method on
    // our session was called, so type safety alone would not have stopped it.
    const session = await PlaywrightDiscoverySession.open({
      capability: "read_only",
      allowedHosts: ["127.0.0.1"],
      runId: "test-run",
      traceDir: join(tmpdir(), `aas-discovery-${String(Date.now())}`),
    });

    try {
      await session.goto(`${baseUrl}/apply`);
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(trackAttempts).toBe(0);
      expect(session.blockedLog.portalAttemptedWrite).toBe(true);
      expect(session.blockedRequests().some((r) => r.method === "POST")).toBe(true);
      expect(session.blockedLog.summarise()).toContain("blocked");
    } finally {
      await session.close();
    }
  }, 60_000);

  it("refuses to navigate off the allow-list", async () => {
    const session = await PlaywrightDiscoverySession.open({
      capability: "read_only",
      allowedHosts: ["127.0.0.1"],
      runId: "test-run",
      traceDir: join(tmpdir(), `aas-discovery-${String(Date.now())}`),
    });

    try {
      await expect(session.goto("https://www.ulster.ac.uk/")).rejects.toThrow(/allow-list/);
    } finally {
      await session.close();
    }
  }, 60_000);

  it("observes the form structure and produces a draft blueprint", async () => {
    const session = await PlaywrightDiscoverySession.open({
      capability: "read_only",
      allowedHosts: ["127.0.0.1"],
      runId: "test-run",
      traceDir: join(tmpdir(), `aas-discovery-${String(Date.now())}`),
    });

    try {
      await session.goto(`${baseUrl}/apply`);
      const observation = await session.observe();

      expect(observation.title).toContain("Postgraduate Application");
      expect(observation.forms).toHaveLength(1);

      const fields = observation.forms[0]?.fields ?? [];
      // Hidden inputs are machinery, not questions asked of the student.
      expect(fields.some((f) => f.name === "csrf_token")).toBe(false);
      expect(fields.map((f) => f.name)).toContain("given_name");
      expect(fields.map((f) => f.name)).toContain("date_of_birth");

      const blueprint = draftBlueprintFrom({
        blueprintId: "bp_fixture",
        institutionName: "Fixture University",
        courseName: "MSc Fixture",
        intake: "2026-09",
        route: "direct_portal",
        observations: [observation],
        discoveryRunId: "test-run",
        discoveredAt: new Date("2026-08-26T12:00:00Z"),
        unobservedClaims: [],
        authenticationRequired: false,
        authenticationNotes: "Fixture is public.",
      });

      // Field types read off the DOM, not guessed.
      const all = blueprint.pages[0]?.sections[0]?.fields ?? [];
      expect(all.find((f) => f.fieldRef === "email")?.inputType).toBe("email");
      expect(all.find((f) => f.fieldRef === "date_of_birth")?.inputType).toBe("date");
      expect(all.find((f) => f.fieldRef === "personal_statement")?.inputType).toBe("textarea");
      expect(all.find((f) => f.fieldRef === "nationality")?.options).toHaveLength(4);

      // File inputs become required documents, keyed by the PORTAL'S OWN
      // field name — these two strings are the `name` attributes of the two
      // `<input type="file">` elements in the fixture, not document types.
      expect(blueprint.pages[0]?.requiredDocuments.map((d) => d.fieldRef)).toEqual([
        "transcript",
        "passport",
      ]);
      expect(blueprint.pages[0]?.requiredDocuments[0]?.acceptedFormats).toEqual([".pdf", ".jpg", ".png"]);

      // Discovery does NOT guess mappings.
      expect(all.every((f) => f.mapsTo === undefined)).toBe(true);

      // ── P88: what the first real form exposed ──────────────────────────
      // A radio group is ONE question: one field, its options carrying the
      // values the form submits, not one field per input with no value.
      const studyMode = all.filter((f) => f.fieldRef === "study_mode");
      expect(studyMode).toHaveLength(1);
      expect(studyMode[0]?.inputType).toBe("radio");
      expect(studyMode[0]?.options).toEqual([
        { value: "FT", label: "Full-time" },
        { value: "PT", label: "Part-time" },
      ]);
      // The observer records the value the input submits.
      expect(fields.find((f) => f.name === "study_mode")?.value).toBe("FT");
      // No candidate advance control with nothing to find it by, and no
      // sentence that merely contains "start"; the real button, by id, wins.
      for (const candidate of observation.candidateAdvanceControls) {
        expect(candidate.value.length).toBeGreaterThan(0);
        expect(candidate.value).not.toContain("start date of your course");
      }
      expect(blueprint.pages[0]?.advanceControl).toEqual({ strategy: "id", value: "continueBtn" });

      // And the draft is not executable.
      const check = checkExecutable(blueprint);
      expect(check.executable).toBe(false);
      if (!check.executable) expect(check.refusal.kind).toBe("not_reviewed");
    } finally {
      await session.close();
    }
  }, 60_000);
});

// ── Pure conversion rules ─────────────────────────────────────────────────

describe("radio groups and the advance control, from a synthetic observation (P88)", () => {
  const observation = (candidates: FieldLocator[]): PageObservation => ({
    url: "https://portal.test/page",
    title: "Page",
    observedAt: new Date(0),
    forms: [
      {
        formIndex: 0,
        fields: [
          { tagName: "input", type: "radio", name: "sex", id: "sexF", value: "F", label: "Female", required: false },
          { tagName: "input", type: "text", name: "middle", required: false },
          { tagName: "input", type: "radio", name: "sex", id: "sexM", value: "M", label: "Male", required: true },
          { tagName: "input", type: "radio", name: "sex", id: "sexO", label: "Other", required: false },
        ],
      },
    ],
    candidateAdvanceControls: candidates,
    signals: [],
  });

  it("emits one radio field per name, in the first input's place, with every option's submitted value", () => {
    const page = pageFrom(observation([]), "p");
    const fields = page.sections[0]?.fields ?? [];
    expect(fields.map((f) => f.fieldRef)).toEqual(["sex", "middle"]);
    const sex = fields[0];
    expect(sex?.inputType).toBe("radio");
    expect(sex?.locators).toEqual([{ strategy: "name", value: "sex" }]);
    // An input with no value attribute submits "on"; recorded as observed, not invented.
    expect(sex?.options).toEqual([
      { value: "F", label: "Female" },
      { value: "M", label: "Male" },
      { value: "on", label: "Other" },
    ]);
    // Required if any input in the group says so.
    expect(sex?.validations).toEqual([{ kind: "required", source: "dom_attribute" }]);
  });

  it("never emits a blank advance locator, and prefers one found by id", () => {
    expect(pageFrom(observation([{ strategy: "label", value: "" }]), "p").advanceControl).toBeUndefined();
    expect(
      pageFrom(observation([{ strategy: "label", value: "Save" }, { strategy: "id", value: "saveBtn" }]), "p")
        .advanceControl,
    ).toEqual({ strategy: "id", value: "saveBtn" });
  });
});

describe("observation to blueprint conversion", () => {
  it("records an unrecognised input type as unknown rather than guessing", () => {
    // "unknown" is a finding a specialist can act on. A wrong guess is not.
    expect(inputTypeOf({ tagName: "input", type: "color", required: false })).toBe("unknown");
  });

  it("reads validations only from what the portal declares", () => {
    const validations = validationsOf({
      tagName: "input",
      type: "text",
      required: true,
      maxLength: 50,
      pattern: "[A-Z]+",
    });

    expect(validations.map((v) => v.kind).sort()).toEqual(["maxlength", "pattern", "required"]);
    expect(validations.every((v) => v.source === "dom_attribute")).toBe(true);
  });

  it("names a required document by the PORTAL'S FIELD, not by a document type", () => {
    // ── What `BlueprintPage.requiredDocuments[].fieldRef` is ─────────────
    //
    // A portal identifier: `field.fieldRef`, the name attribute of the
    // `<input type="file">`. It is a coincidence of wording that a portal often
    // calls that box something a person would also call a document, and that
    // coincidence is what made the old name (`documentRef`, ADR-0070) readable
    // as the other thing.
    //
    // The other thing is the mapping set's `MappingSource { kind: "document" }
    // .documentRef` — a DOMAIN key, what AskiMate calls the document, chosen by
    // a reviewer. The two namespaces never meet: a boundary rule keeps
    // `requiredDocuments` out of the whole planning path (ADR-0066). This test
    // is what holds the meaning at the only place that produces it, so the
    // names cannot drift back together.
    const observation: PageObservation = {
      url: "https://apply.example.test/documents",
      title: "Documents",
      forms: [
        {
          formIndex: 0,
          fields: [
            {
              // The portal's own name for the box. Nothing here is a document
              // type, and discovery does not invent one.
              name: "supporting_doc_1",
              label: "Upload your passport",
              tagName: "input",
              type: "file",
              required: true,
              accept: ".pdf",
            },
          ],
        },
      ],
      candidateAdvanceControls: [],
      signals: [],
      observedAt: new Date("2026-08-26T12:00:00Z"),
    };

    const page = pageFrom(observation, "page-documents");
    const field = page.sections[0]?.fields[0];

    expect(page.requiredDocuments[0]?.fieldRef).toBe("supporting_doc_1");
    expect(page.requiredDocuments[0]?.fieldRef).toBe(field?.fieldRef);
    // And emphatically not the human-readable label, which is the string that
    // looks like a document type and is the one a reader would expect.
    expect(page.requiredDocuments[0]?.fieldRef).not.toBe(field?.label);
  });

  it("refuses to execute a blueprint that observed nothing", () => {
    const blueprint = draftBlueprintFrom({
      blueprintId: "bp_hearsay",
      institutionName: "Somewhere",
      courseName: "Something",
      intake: "2026-09",
      route: "direct_portal",
      observations: [],
      discoveryRunId: "none",
      discoveredAt: new Date(),
      unobservedClaims: ["Everything here came from search results."],
      authenticationRequired: true,
      authenticationNotes: "Unknown.",
    });

    const reviewed = { ...blueprint, status: "reviewed" as const };
    const check = checkExecutable(reviewed);
    expect(check.executable).toBe(false);
    if (!check.executable) expect(check.refusal.kind).toBe("nothing_observed");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Flow signals — the questions a real discovery run has to answer
// ───────────────────────────────────────────────────────────────────────────

describe("what the page shows about the flow", () => {
  let server: Server;
  let session: PlaywrightDiscoverySession;
  let signals: readonly FlowSignal[];
  const requestsFor = new Map<string, number>();

  beforeAll(async () => {
    const html = await readFile(
      join(import.meta.dirname, "..", "fixtures", "application-form.html"),
      "utf8",
    );
    server = createServer((req, res) => {
      const path = req.url ?? "/";
      requestsFor.set(path, (requestsFor.get(path) ?? 0) + 1);
      res.writeHead(200, { "content-type": "text/html" }).end(html);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("no address");
    const baseUrl = `http://127.0.0.1:${String(address.port)}`;

    session = await PlaywrightDiscoverySession.open({
      capability: "read_only",
      allowedHosts: ["127.0.0.1"],
      runId: "signals-test",
      traceDir: await mkdtemp(join(tmpdir(), "aas-signals-")),
      now: () => new Date("2026-08-26T10:00:00Z"),
    });
    await session.goto(`${baseUrl}/apply`);
    signals = (await session.observe()).signals;
  }, 60_000);

  afterAll(async () => {
    await session.close();
    server.close();
  });

  const evidenceFor = (kind: FlowSignal["kind"]): string =>
    signals
      .filter((signal) => signal.kind === kind)
      .map((signal) => signal.evidence)
      .join(" | ");

  it("detects authentication from password fields — the least ambiguous evidence there is", () => {
    expect(evidenceFor("login")).toContain("input[type=password]");
  });

  it("distinguishes account creation from login by the confirm-password pattern", () => {
    expect(evidenceFor("account_creation")).toContain("confirm-password pattern");
  });

  it("detects CAPTCHA by its third-party footprint, not by guessing", () => {
    expect(evidenceFor("captcha")).toContain("recaptcha");
  });

  it("detects a one-time code input", () => {
    expect(evidenceFor("mfa_or_otp")).toContain("one-time-code");
  });

  it("does not mistake a postcode or a course code for a one-time code", () => {
    // Sheffield, 2026-09-10 (P81): `input[name*=code]` matched corrPostcode,
    // permPostcode and four neighbours, and the draft carried an `mfa` handoff
    // on a page with no second factor. The name has to BE a code field, as the
    // runner's challenge detector already requires (P70), not contain the word.
    expect(evidenceFor("mfa_or_otp")).toContain('name="otp"');
    expect(evidenceFor("mfa_or_otp")).not.toMatch(/postcode/i);
    expect(evidenceFor("mfa_or_otp")).not.toContain("course_code");
  });

  it("does not read 'registered charity' as an invitation to register", () => {
    // Sheffield's education and equal-opportunities pages carry the word
    // inside another word; a substring match called each an account-creation
    // page. Whole words only.
    expect(evidenceFor("account_creation")).toContain("create an account");
    expect(evidenceFor("account_creation")).not.toContain('"register"');
  });

  it("detects email verification from the portal's own wording", () => {
    expect(evidenceFor("email_verification")).toContain("verify your email");
  });

  it("detects the submission control, so the guards have something to refuse", () => {
    expect(evidenceFor("submission")).toContain("Submit application");
  });

  it("detects a field that is present but hidden — evidence of conditional logic", () => {
    expect(evidenceFor("conditional_field")).toContain("sponsor_name");
  });

  it("carries EVIDENCE with every signal, never a bare conclusion", () => {
    // "This portal uses CAPTCHA" is an inference. "There is a script tag from
    // google.com/recaptcha" is a fact, and the inference belongs to the
    // specialist reviewing the blueprint.
    for (const signal of signals) {
      expect(signal.evidence.length).toBeGreaterThan(3);
    }
  });

  it("reads the page without fetching anything the page did not", () => {
    // P82's first fix cloned the body to read its text with the scripts cut
    // out. A cloned <img> fetches its source, so observation made a request
    // the page had not — the CLI test counted one refusal too many. Reading
    // is walking the DOM, never copying it: the pixel is fetched once, by the
    // page, and never by the observer.
    expect(requestsFor.get("/pixel.gif")).toBe(1);
  });

  it("does not click, type or otherwise touch the page to find them", () => {
    // The fixture POSTs on load and that is blocked. If observation had
    // interacted with anything, this count would move.
    expect(session.blockedRequests().length).toBeGreaterThan(0);
  });
});
