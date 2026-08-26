/**
 * Discovery tests.
 *
 * The safety tests come first, because "discovery cannot submit" is the
 * property Vahid's go-ahead was conditional on.
 */

import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PlaywrightDiscoverySession } from "./playwright-session.js";
import { HostAllowList, decideDiscoveryRequest, decideDiscoveryRequestForHost } from "./safety.js";
import { draftBlueprintFrom, inputTypeOf, validationsOf } from "./discovery.js";
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

      // File inputs become required documents.
      expect(blueprint.pages[0]?.requiredDocuments.map((d) => d.documentRef)).toEqual([
        "transcript",
        "passport",
      ]);
      expect(blueprint.pages[0]?.requiredDocuments[0]?.acceptedFormats).toEqual([".pdf", ".jpg", ".png"]);

      // Discovery does NOT guess mappings.
      expect(all.every((f) => f.mapsTo === undefined)).toBe(true);

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
