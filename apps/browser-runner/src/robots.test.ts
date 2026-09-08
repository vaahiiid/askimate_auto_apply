/**
 * robots.txt is read, obeyed, and kept.
 *
 * The evidence half is as important as the obedience half — Vahid: *"the
 * difference between 'we respected the rules' and 'we did not look' is the
 * whole difference if anyone ever asks."* So these check that a policy carries
 * what it read, and that a refusal names the rule that caused it.
 */

import { describe, expect, it } from "vitest";

import type { RobotsPolicy } from "./robots.js";
import {
  MINIMUM_CRAWL_DELAY_MS,
  ROBOTS_AGENT_TOKEN,
  crawlDelayMs,
  decideAgainstRobots,
  groupFor,
  parseRobots,
  pathOf,
} from "./robots.js";

const HOST = "www.example.ac.uk";
const AT = new Date("2026-09-08T12:00:00Z");

function fetched(body: string): RobotsPolicy {
  const groups = parseRobots(body);
  return {
    kind: "fetched",
    host: HOST,
    fetchedAt: AT,
    statusCode: 200,
    body,
    groups,
    applicable: groupFor(groups),
  };
}

describe("parsing", () => {
  it("reads a group's agents, rules and crawl delay", () => {
    const groups = parseRobots(
      ["User-agent: *", "Disallow: /search/", "Allow: /search/courses", "Crawl-delay: 5"].join("\n"),
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.agents).toEqual(["*"]);
    expect(groups[0]?.crawlDelaySeconds).toBe(5);
    expect(groups[0]?.rules).toEqual([
      { kind: "disallow", pattern: "/search/" },
      { kind: "allow", pattern: "/search/courses" },
    ]);
  });

  it("keeps CONSECUTIVE user-agent lines in one group", () => {
    // How a file says "these two, same rules". Splitting them would give the
    // second an empty rule set, which is the difference between "disallowed"
    // and "no rules apply".
    const groups = parseRobots(
      ["User-agent: alpha", "User-agent: beta", "Disallow: /private/"].join("\n"),
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.agents).toEqual(["alpha", "beta"]);
  });

  it("starts a new group when a user-agent follows rules", () => {
    const groups = parseRobots(
      ["User-agent: alpha", "Disallow: /a/", "User-agent: beta", "Disallow: /b/"].join("\n"),
    );
    expect(groups).toHaveLength(2);
    expect(groups[1]?.agents).toEqual(["beta"]);
    expect(groups[1]?.rules).toEqual([{ kind: "disallow", pattern: "/b/" }]);
  });

  it("strips comments and ignores fields it does not know", () => {
    const groups = parseRobots(
      [
        "# a comment line",
        "User-agent: *   # trailing comment",
        "Sitemap: https://example.ac.uk/sitemap.xml",
        "Request-rate: 1/10s",
        "Disallow: /admin/",
      ].join("\n"),
    );
    expect(groups[0]?.agents).toEqual(["*"]);
    expect(groups[0]?.rules).toEqual([{ kind: "disallow", pattern: "/admin/" }]);
  });
});

describe("choosing the group that applies to us", () => {
  it("prefers a group naming us over the wildcard", () => {
    const groups = parseRobots(
      [
        "User-agent: *",
        "Disallow: /",
        `User-agent: ${ROBOTS_AGENT_TOKEN}`,
        "Disallow: /private/",
      ].join("\n"),
    );
    expect(groupFor(groups)?.rules).toEqual([{ kind: "disallow", pattern: "/private/" }]);
  });

  it("prefers the LONGEST matching prefix among several", () => {
    const groups = parseRobots(
      ["User-agent: askimate", "Disallow: /a/", "User-agent: askimate-aas", "Disallow: /b/"].join(
        "\n",
      ),
    );
    expect(groupFor(groups)?.rules).toEqual([{ kind: "disallow", pattern: "/b/" }]);
  });

  it("returns null when no group is addressed to us — which is NOT the same as absent", () => {
    const groups = parseRobots(["User-agent: SomeOtherBot", "Disallow: /"].join("\n"));
    expect(groupFor(groups)).toBeNull();
    // A file with rules for other crawlers and no `*` says nothing to us.
    expect(decideAgainstRobots(fetched("User-agent: Other\nDisallow: /"), "https://x/y").allowed).toBe(
      true,
    );
  });
});

describe("deciding a URL", () => {
  const policy = fetched(
    ["User-agent: *", "Disallow: /search/", "Allow: /search/courses", "Disallow: /apply/*/submit$"].join(
      "\n",
    ),
  );

  it("allows a path no rule matches", () => {
    expect(decideAgainstRobots(policy, `https://${HOST}/courses/msc-data`).allowed).toBe(true);
  });

  it("refuses a disallowed path, and NAMES the rule", () => {
    const decision = decideAgainstRobots(policy, `https://${HOST}/search/everything`);
    expect(decision.allowed).toBe(false);
    expect(decision.rule).toEqual({ kind: "disallow", pattern: "/search/" });
    expect(decision.reason).toMatch(/Disallow: \/search\//);
  });

  it("lets the LONGER Allow beat the shorter Disallow", () => {
    // The whole reason longest-match exists: a file saying "not the search
    // pages, but the course search is fine".
    const decision = decideAgainstRobots(policy, `https://${HOST}/search/courses/pgt`);
    expect(decision.allowed).toBe(true);
    expect(decision.rule?.kind).toBe("allow");
  });

  it("honours `*` and `$`", () => {
    expect(decideAgainstRobots(policy, `https://${HOST}/apply/123/submit`).allowed).toBe(false);
    // `$` anchors: the same path with more after it is not the same path.
    expect(decideAgainstRobots(policy, `https://${HOST}/apply/123/submit/step2`).allowed).toBe(true);
  });

  it("matches on path AND query, as the standard does", () => {
    expect(pathOf(`https://${HOST}/search/?q=x`)).toBe("/search/?q=x");
    expect(decideAgainstRobots(policy, `https://${HOST}/search/?q=x`).allowed).toBe(false);
  });

  it("treats an empty `Disallow:` as allowing everything", () => {
    const permissive = fetched(["User-agent: *", "Disallow:"].join("\n"));
    expect(decideAgainstRobots(permissive, `https://${HOST}/anything`).allowed).toBe(true);
  });
});

describe("when robots.txt cannot be read", () => {
  it("ABSENT (404) allows everything — the site said there is no policy", () => {
    const absent: RobotsPolicy = { kind: "absent", host: HOST, fetchedAt: AT, statusCode: 404 };
    expect(decideAgainstRobots(absent, `https://${HOST}/anything`).allowed).toBe(true);
  });

  it("UNAVAILABLE (5xx or a network failure) allows NOTHING", () => {
    // ── The rule that makes the instruction real ──────────────────────────
    //
    // RFC 9309 §2.3.1.4, and the only reading that satisfies what this exists
    // for: a run that could not read the rules has not respected them.
    // Proceeding anyway is precisely the "we did not look" it prevents.
    const unavailable: RobotsPolicy = {
      kind: "unavailable",
      host: HOST,
      fetchedAt: AT,
      statusCode: 503,
      error: "503 from the origin",
    };
    const decision = decideAgainstRobots(unavailable, `https://${HOST}/anything`);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/complete disallow/);
  });

  it("keeps the two apart — absent and unavailable are different facts", () => {
    const absent: RobotsPolicy = { kind: "absent", host: HOST, fetchedAt: AT, statusCode: 404 };
    const unavailable: RobotsPolicy = {
      kind: "unavailable",
      host: HOST,
      fetchedAt: AT,
      statusCode: null,
      error: "ETIMEDOUT",
    };
    expect(decideAgainstRobots(absent, "https://x/").allowed).not.toBe(
      decideAgainstRobots(unavailable, "https://x/").allowed,
    );
  });
});

describe("keeping what it said", () => {
  it("holds the raw body, the status and the time it was read", () => {
    // The evidence, not a summary of it. A report can quote the file.
    const body = "User-agent: *\nDisallow: /private/\n";
    const policy = fetched(body);
    expect(policy.kind).toBe("fetched");
    if (policy.kind !== "fetched") return;
    expect(policy.body).toBe(body);
    expect(policy.statusCode).toBe(200);
    expect(policy.fetchedAt).toEqual(AT);
  });
});

describe("the delay between requests", () => {
  it("never goes below the floor, whatever the file or the target says", () => {
    const none = fetched("User-agent: *\nDisallow:");
    expect(crawlDelayMs(none, 0)).toBe(MINIMUM_CRAWL_DELAY_MS);
    expect(crawlDelayMs(none, -5_000)).toBe(MINIMUM_CRAWL_DELAY_MS);
    // A file asking for NO delay does not get one honoured below the floor.
    expect(crawlDelayMs(fetched("User-agent: *\nCrawl-delay: 0"), 0)).toBe(MINIMUM_CRAWL_DELAY_MS);
  });

  it("lets the FILE raise it", () => {
    expect(crawlDelayMs(fetched("User-agent: *\nCrawl-delay: 10"), 1_000)).toBe(10_000);
  });

  it("lets the TARGET raise it", () => {
    expect(crawlDelayMs(fetched("User-agent: *\nCrawl-delay: 2"), 5_000)).toBe(5_000);
  });

  it("applies the floor when there is no robots.txt at all", () => {
    const absent: RobotsPolicy = { kind: "absent", host: HOST, fetchedAt: AT, statusCode: 404 };
    expect(crawlDelayMs(absent, 0)).toBe(MINIMUM_CRAWL_DELAY_MS);
  });
});
