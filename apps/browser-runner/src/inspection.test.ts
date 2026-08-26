/**
 * The safety proof for inspection mode.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid: *"Before using it against the real portal, prove the safety
 * properties against a local fixture that attempts: application creation,
 * data persistence, submission, file upload, navigation to a consequential
 * endpoint, and POST-on-load behaviour. The system must demonstrate that these
 * remain blocked."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * So these tests do not assert on the guard's return values. They run a real
 * Chromium against a real server that **records every request that reaches
 * it**, and then assert on what the server saw. A guard that returns the right
 * verdict but fails to abort would pass a unit test and fail this one.
 *
 * The fixture is hostile: it tries all six prohibited things on page load,
 * unprompted.
 *
 * The last test is the one that makes the rest worth anything — the interface
 * must actually RENDER. A mode that blocks everything is trivial and useless.
 */

import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { decideInspectionRequest } from "./inspection-safety.js";
import { HostAllowList } from "./safety.js";
import { PlaywrightInspectionSession } from "./playwright-inspection-session.js";

const PORT = 4322;
const BASE = `http://127.0.0.1:${String(PORT)}`;

let server: Server;
let traceDir: string;

/** Everything that reached the server. The evidence these tests rest on. */
let reached: { method: string; url: string; body: string }[] = [];

/** The action batch the fixture uses to draw its form. */
const RENDER_RESPONSE = JSON.stringify({
  fields: [
    { id: "sf-firstname", name: "firstName", label: "First Name", type: "text", required: true },
    { id: "sf-lastname", name: "lastName", label: "Last Name", type: "text", required: true },
    { id: "sf-email", name: "email", label: "Email", type: "email", required: true },
    { id: "sf-password", name: "password", label: "Create Password", type: "password", required: true },
  ],
});

beforeAll(async () => {
  const portal = await readFile(
    join(import.meta.dirname, "..", "fixtures", "aura-portal", "portal.html"),
    "utf8",
  );

  server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk.toString()));
    req.on("end", () => {
      reached.push({ method: req.method ?? "?", url: req.url ?? "", body });

      if ((req.url ?? "").startsWith("/s/sfsites/aura")) {
        res.writeHead(200, { "content-type": "application/json" }).end(RENDER_RESPONSE);
        return;
      }
      res
        .writeHead(200, { "content-type": "text/html" })
        .end(portal);
    });
  });
  await new Promise<void>((resolve) => server.listen(PORT, "127.0.0.1", resolve));

  traceDir = await mkdtemp(join(tmpdir(), "aas-inspect-"));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(traceDir, { recursive: true, force: true });
});

beforeEach(() => {
  reached = [];
});

async function loadPortal(hostileNav = true): Promise<PlaywrightInspectionSession> {
  const session = await PlaywrightInspectionSession.open({
    runId: "inspect-fixture-1",
    capability: "read_only",
    allowedHosts: ["127.0.0.1"],
    traceDir,
    navigableUrlPatterns: [/^http:\/\/127\.0\.0\.1:4322\/s\/login/],
  });
  await session.goto(
    `${BASE}/s/login/SelfRegister?startURL=%2Fs%2Fproduct%2F01tTv00000F73QqIAJ` +
      (hostileNav ? "" : "&hostileNav=0"),
  );
  await session.settle(6_000);
  return session;
}

/** Requests that reached the server, excluding the initial page load. */
function writesThatLanded(): { method: string; url: string; body: string }[] {
  return reached.filter((entry) => entry.method !== "GET");
}

// ───────────────────────────────────────────────────────────────────────────
// The six prohibited behaviours, proven against a real browser
// ───────────────────────────────────────────────────────────────────────────

describe("inspection mode against a hostile Salesforce-shaped portal", () => {
  it("lets the interface RENDER — the point of the whole mode", async () => {
    // Without this, every other test in this file is satisfied by a guard that
    // blocks everything, which is what discovery mode already does.
    //
    // The fixture's self-redirect is off here only because aborting it blanks
    // the DOM — that behaviour has its own test below.
    const session = await loadPortal(false);
    try {
      const html = await session.html();
      expect(html).toContain("selfRegisterForm");
      expect(html).toContain("Create Password");

      const observed = await session.observe();
      const names = observed.forms.flatMap((form) => form.fields.map((field) => field.name));
      expect(names).toContain("firstName");
      expect(names).toContain("email");
      expect(names).toContain("password");
    } finally {
      await session.close();
    }
  }, 60_000);

  it("BLOCKS application creation", async () => {
    const session = await loadPortal();
    try {
      const landed = writesThatLanded().filter((entry) => entry.body.includes("createApplication"));
      expect(landed).toEqual([]);
    } finally {
      await session.close();
    }
  }, 60_000);

  it("BLOCKS persisting applicant data", async () => {
    const session = await loadPortal();
    try {
      const landed = writesThatLanded().filter((entry) => entry.body.includes("saveRecord"));
      expect(landed).toEqual([]);
    } finally {
      await session.close();
    }
  }, 60_000);

  it("BLOCKS submission", async () => {
    const session = await loadPortal();
    try {
      const landed = reached.filter((entry) => entry.url.includes("submitApplication"));
      expect(landed).toEqual([]);
    } finally {
      await session.close();
    }
  }, 60_000);

  it("BLOCKS a file upload", async () => {
    const session = await loadPortal();
    try {
      const landed = reached.filter(
        (entry) => entry.url.includes("/upload") || entry.body.includes("passport.pdf"),
      );
      expect(landed).toEqual([]);
    } finally {
      await session.close();
    }
  }, 60_000);

  it("BLOCKS navigation to a consequential endpoint the page triggers itself", async () => {
    // The fixture sets window.location on a 400ms timer. The network guard
    // sees a GET to an allow-listed host; only the navigation allow-list
    // catches it.
    const session = await loadPortal();
    try {
      await session.settle(2_000);
      const landed = reached.filter((entry) => entry.url.includes("submit-confirm"));
      expect(landed).toEqual([]);
      expect(session.refusedNavigations.some((url) => url.includes("submit-confirm"))).toBe(true);
      // Aborting a navigation leaves Chromium on its own error page, which is
      // the correct outcome: what matters is that the consequential URL was
      // never fetched, not that we stayed put.
      expect(await session.currentUrl()).not.toContain("submit-confirm");
    } finally {
      await session.close();
    }
  }, 60_000);

  it("BLOCKS non-cacheable Apex, even with an innocuous name", async () => {
    // `PageController.getSettings` looks entirely harmless. Only the
    // cacheable flag distinguishes it from `createApplication`, and that flag
    // is the platform's own guarantee about DML.
    const session = await loadPortal();
    try {
      const landed = writesThatLanded().filter((entry) => entry.body.includes("getSettings"));
      expect(landed).toEqual([]);

      const refused = session.refusedActions.flatMap((entry) => entry.verdicts);
      expect(
        refused.some((verdict) => !verdict.allowed && /cacheable/i.test(verdict.reason)),
      ).toBe(true);
    } finally {
      await session.close();
    }
  }, 60_000);

  it("BLOCKS PUT, PATCH and DELETE outright", async () => {
    const session = await loadPortal();
    try {
      const landed = reached.filter((entry) => ["PUT", "PATCH", "DELETE"].includes(entry.method));
      expect(landed).toEqual([]);
    } finally {
      await session.close();
    }
  }, 60_000);

  it("lets EXACTLY ONE kind of write through: the render batch", async () => {
    // The strongest statement this file can make. Not "the bad ones were
    // blocked" but "of everything the page attempted, only rendering landed".
    const session = await loadPortal();
    try {
      const writes = writesThatLanded();
      expect(writes.length).toBeGreaterThan(0);
      for (const write of writes) {
        expect(write.method).toBe("POST");
        expect(write.url).toContain("/s/sfsites/aura");
        expect(write.url).toContain("r=render");
      }
    } finally {
      await session.close();
    }
  }, 60_000);

  it("records what it refused, so a partial render is visible not silent", async () => {
    const session = await loadPortal();
    try {
      expect(session.refusedActions.length).toBeGreaterThan(0);
      expect(session.permittedActions.length).toBeGreaterThan(0);
      expect(session.blockedLog.count).toBeGreaterThan(0);
    } finally {
      await session.close();
    }
  }, 60_000);
});

// ───────────────────────────────────────────────────────────────────────────
// The decision function, without a browser
// ───────────────────────────────────────────────────────────────────────────

const ALLOW = new HostAllowList(["example.test"]);

function auraBody(actions: unknown[]): string {
  return new URLSearchParams({ message: JSON.stringify({ actions }) }).toString();
}

function decide(method: string, url: string, postData: string | null = null) {
  return decideInspectionRequest({ method, url, postData, allowList: ALLOW });
}

describe("the inspection decision, in isolation", () => {
  it("permits a GET on an allow-listed host", () => {
    expect(decide("GET", "https://example.test/s/login").allowed).toBe(true);
  });

  it("refuses any host that is not allow-listed", () => {
    expect(decide("GET", "https://elsewhere.test/").allowed).toBe(false);
    expect(decide("POST", "https://elsewhere.test/s/sfsites/aura").allowed).toBe(false);
  });

  it("refuses PUT, PATCH and DELETE with no configuration that enables them", () => {
    for (const method of ["PUT", "PATCH", "DELETE"]) {
      const decision = decide(method, "https://example.test/s/sfsites/aura");
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain("no configuration");
    }
  });

  it("refuses a POST to any path other than the render endpoint", () => {
    const decision = decide("POST", "https://example.test/services/apply/submitApplication", "{}");
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("rendering endpoint");
  });

  it("refuses a POST whose body cannot be read", () => {
    expect(decide("POST", "https://example.test/s/sfsites/aura", null).allowed).toBe(false);
  });

  it("refuses a POST whose body cannot be parsed as an action batch", () => {
    const decision = decide("POST", "https://example.test/s/sfsites/aura", "message=not-json");
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("Failing closed");
  });

  it("permits a batch of rendering actions", () => {
    const decision = decide(
      "POST",
      "https://example.test/s/sfsites/aura",
      auraBody([
        { descriptor: "…hostConfig.HostConfigController/ACTION$getConfigData", params: {} },
        { descriptor: "…applauncher.LoginFormController/ACTION$getForgotPasswordUrl", params: {} },
      ]),
    );
    expect(decision.allowed).toBe(true);
  });

  it("refuses an unknown descriptor rather than assuming it harmless", () => {
    const decision = decide(
      "POST",
      "https://example.test/s/sfsites/aura",
      auraBody([{ descriptor: "…SomeController/ACTION$doSomethingNovel", params: {} }]),
    );
    expect(decision.allowed).toBe(false);
    expect(decision.actions?.[0]?.reason).toContain("allow-list");
  });

  it("refuses the WHOLE batch when one action is not a render", () => {
    // Aura executes a batch together. Permitting the safe half is not
    // something the protocol offers.
    const decision = decide(
      "POST",
      "https://example.test/s/sfsites/aura",
      auraBody([
        { descriptor: "…hostConfig.HostConfigController/ACTION$getConfigData", params: {} },
        { descriptor: "…SomeController/ACTION$doSomethingNovel", params: {} },
      ]),
    );
    expect(decision.allowed).toBe(false);
    expect(decision.actions?.filter((verdict) => verdict.allowed)).toHaveLength(1);
  });

  it("permits cacheable Apex, because the platform forbids DML in it", () => {
    const decision = decide(
      "POST",
      "https://example.test/s/sfsites/aura",
      auraBody([
        {
          descriptor: "aura://ApexActionController/ACTION$execute",
          params: { classname: "SelfRegPageController", method: "getFormFields", cacheable: true },
        },
      ]),
    );
    expect(decision.allowed).toBe(true);
  });

  it("refuses non-cacheable Apex, because the platform permits DML in it", () => {
    const decision = decide(
      "POST",
      "https://example.test/s/sfsites/aura",
      auraBody([
        {
          descriptor: "aura://ApexActionController/ACTION$execute",
          params: { classname: "PageController", method: "getSettings", cacheable: false },
        },
      ]),
    );
    expect(decision.allowed).toBe(false);
  });

  it("refuses Apex with the cacheable flag simply absent", () => {
    // Absent is not false-y-therefore-fine; it is unknown, and unknown fails
    // closed like everything else here.
    const decision = decide(
      "POST",
      "https://example.test/s/sfsites/aura",
      auraBody([
        {
          descriptor: "aura://ApexActionController/ACTION$execute",
          params: { classname: "PageController", method: "getSettings" },
        },
      ]),
    );
    expect(decision.allowed).toBe(false);
  });

  it("refuses a consequential payload hidden inside a permitted descriptor", () => {
    // The descriptor is on the allow-list. The payload is not what a render
    // carries. The body scan catches what the descriptor check would wave on.
    const decision = decide(
      "POST",
      "https://example.test/s/sfsites/aura",
      auraBody([
        {
          descriptor: "…hostConfig.HostConfigController/ACTION$getConfigData",
          params: { then: "saveRecord", apiName: "Application__c" },
        },
      ]),
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("consequential pattern");
  });
});
