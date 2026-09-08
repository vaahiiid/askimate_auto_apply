/**
 * Reading robots.txt: what each outcome means, without a network.
 *
 * The `get` is injected, so every branch — 200, 404, 500, a timeout, a body
 * larger than we will read — is exercised against a real `Response`.
 */

import { describe, expect, it } from "vitest";

import { fetchRobots, fetchRobotsFor, originsFor, robotsSet } from "./robots-fetch.js";

const NOW = new Date("2026-09-08T12:00:00Z");
const OPTIONS = { userAgent: "AskiMate-AAS-Discovery/0.1", now: () => NOW };

function respond(status: number, body = ""): (url: string) => Promise<Response> {
  return () => Promise.resolve(new Response(body, { status }));
}

describe("fetching one host's robots.txt", () => {
  it("keeps the body, the status and the time — the evidence", async () => {
    const body = "User-agent: *\nDisallow: /apply/\n";
    const policy = await fetchRobots("https://www.example.ac.uk", { ...OPTIONS, get: respond(200, body) });

    expect(policy.kind).toBe("fetched");
    if (policy.kind !== "fetched") return;
    expect(policy.body).toBe(body);
    expect(policy.statusCode).toBe(200);
    expect(policy.fetchedAt).toEqual(NOW);
    expect(policy.applicable?.rules).toEqual([{ kind: "disallow", pattern: "/apply/" }]);
  });

  it("reads a 404 as ABSENT — the site says there is no policy", async () => {
    const policy = await fetchRobots("https://x.ac.uk", { ...OPTIONS, get: respond(404) });
    expect(policy.kind).toBe("absent");
  });

  it("reads a 500 as UNAVAILABLE — which disallows everything", async () => {
    const policy = await fetchRobots("https://x.ac.uk", { ...OPTIONS, get: respond(503) });
    expect(policy.kind).toBe("unavailable");
    if (policy.kind !== "unavailable") return;
    expect(policy.statusCode).toBe(503);
  });

  it("reads a network failure as UNAVAILABLE, keeping the error", async () => {
    const policy = await fetchRobots("https://x.ac.uk", {
      ...OPTIONS,
      get: () => Promise.reject(new Error("ETIMEDOUT")),
    });
    expect(policy.kind).toBe("unavailable");
    if (policy.kind !== "unavailable") return;
    expect(policy.error).toBe("ETIMEDOUT");
    expect(policy.statusCode).toBeNull();
  });

  it("asks for the file over plain HTTP, not through the browser", async () => {
    // A page load runs the site's JavaScript. Reading robots.txt must not
    // execute anything — least of all before we know what the file permits.
    let asked = "";
    let sentAgent: string | undefined;
    await fetchRobots("https://www.example.ac.uk", {
      ...OPTIONS,
      get: (url, init) => {
        asked = url;
        sentAgent = new Headers(init.headers).get("user-agent") ?? undefined;
        return Promise.resolve(new Response("", { status: 200 }));
      },
    });
    expect(asked).toBe("https://www.example.ac.uk/robots.txt");
    // Identified honestly, and with the same token the rules are matched on.
    expect(sentAgent).toContain("AskiMate-AAS-Discovery");
  });
});

describe("the decider the guard calls", () => {
  it("refuses a host whose robots.txt was never read", async () => {
    // Cannot normally happen — the host allow-list runs first — but "cannot
    // normally happen" is not a reason to default to allow in the function
    // whose job is to say no.
    const set = robotsSet(await fetchRobotsFor(["https://a.ac.uk"], { ...OPTIONS, get: respond(404) }));
    expect(set.decide("https://b.ac.uk/anything").allowed).toBe(false);
    expect(set.decide("https://b.ac.uk/anything").reason).toMatch(/has not been checked/);
  });

  it("refuses something that is not a URL", () => {
    expect(robotsSet(new Map()).decide("not a url").allowed).toBe(false);
  });

  it("applies the policy of the host the URL belongs to", async () => {
    const policies = new Map(
      await Promise.all([
        fetchRobots("https://open.ac.uk", { ...OPTIONS, get: respond(200, "User-agent: *\nDisallow:") }).then(
          (p) => ["open.ac.uk", p] as const,
        ),
        fetchRobots("https://shut.ac.uk", { ...OPTIONS, get: respond(200, "User-agent: *\nDisallow: /") }).then(
          (p) => ["shut.ac.uk", p] as const,
        ),
      ]),
    );
    const set = robotsSet(policies);
    expect(set.decide("https://open.ac.uk/courses").allowed).toBe(true);
    expect(set.decide("https://shut.ac.uk/courses").allowed).toBe(false);
  });

  it("matches the host case-insensitively", async () => {
    const set = robotsSet(
      await fetchRobotsFor(["https://WWW.Example.AC.UK"], { ...OPTIONS, get: respond(404) }),
    );
    expect(set.decide("https://www.example.ac.uk/x").allowed).toBe(true);
  });
});

describe("choosing the origin to read robots.txt from", () => {
  it("uses the scheme and port the SEEDS use, not an assumed https", () => {
    // ── The bug this function exists because of ──────────────────────────
    //
    // `https://${host}` was the obvious shape. Against the fixture portal —
    // plain HTTP on a loopback port — the fetch failed, the policy became
    // `unavailable`, and the run correctly fetched nothing. Correct behaviour
    // from a wrong input: it failed CLOSED, which looks exactly like the rule
    // working, and only the fixture run's "Pages visited 0" showed it.
    expect(originsFor(["127.0.0.1:8123"], ["http://127.0.0.1:8123/apply"])).toEqual([
      "http://127.0.0.1:8123",
    ]);
  });

  it("falls back to https for an allowed host with no seed", () => {
    expect(originsFor(["a.ac.uk", "b.ac.uk"], ["https://a.ac.uk/x"])).toEqual([
      "https://a.ac.uk",
      "https://b.ac.uk",
    ]);
  });

  it("ignores a seed that is not a URL", () => {
    expect(originsFor(["a.ac.uk"], ["nonsense", "https://a.ac.uk/x"])).toEqual(["https://a.ac.uk"]);
  });
});
