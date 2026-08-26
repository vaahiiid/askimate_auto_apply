/**
 * Target parsing and crawl-scope tests.
 *
 * A target is data. A malformed one must fail loudly BEFORE a browser opens,
 * rather than half-running against a partly-understood configuration.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { InvalidTargetError, parseTarget, shouldFollow } from "./target.js";

const VALID = {
  targetId: "t1",
  institutionName: "Ulster University",
  campus: "Birmingham",
  courseName: "MSc International Business",
  intake: "2026-09",
  route: "partner_portal",
  routeNotes: [],
  allowedHosts: ["qahighereducation.com"],
  seedUrls: ["https://apply.qahighereducation.com/s/login/"],
  linkPatterns: ["appl(y|ication)"],
  maxPages: 10,
  claimsToVerify: [],
};

describe("target validation", () => {
  it("parses a valid target", () => {
    const target = parseTarget(VALID);
    expect(target.targetId).toBe("t1");
    expect(target.campus).toBe("Birmingham");
  });

  it("REFUSES a seed URL outside the allow-list", () => {
    // A seed the run is not permitted to visit is a configuration mistake, and
    // it should surface here rather than as a confusing mid-run refusal.
    expect(() =>
      parseTarget({ ...VALID, seedUrls: ["https://www.ulster.ac.uk/apply"] }),
    ).toThrow(/not covered by allowedHosts/);
  });

  it("refuses an invalid regular expression before a browser opens", () => {
    expect(() => parseTarget({ ...VALID, linkPatterns: ["([unclosed"] })).toThrow(
      /invalid regular expression/,
    );
  });

  it("refuses an unknown route", () => {
    expect(() => parseTarget({ ...VALID, route: "carrier_pigeon" })).toThrow(InvalidTargetError);
  });

  it("refuses a missing or absurd page cap", () => {
    expect(() => parseTarget({ ...VALID, maxPages: 0 })).toThrow(InvalidTargetError);
    expect(() => parseTarget({ ...VALID, maxPages: 5000 })).toThrow(InvalidTargetError);
    expect(() => parseTarget({ ...VALID, maxPages: "ten" })).toThrow(InvalidTargetError);
  });

  it("refuses an empty seed list", () => {
    expect(() => parseTarget({ ...VALID, seedUrls: [] })).toThrow(InvalidTargetError);
  });

  it("refuses a non-object", () => {
    expect(() => parseTarget(null)).toThrow(InvalidTargetError);
    expect(() => parseTarget("a target")).toThrow(InvalidTargetError);
  });
});

describe("crawl scope", () => {
  const target = parseTarget(VALID);

  it("follows an in-scope link matching a pattern", () => {
    expect(shouldFollow(target, "https://qahighereducation.com/how-to-apply/")).toBe(true);
  });

  it("does NOT follow an out-of-scope host", () => {
    expect(shouldFollow(target, "https://www.ulster.ac.uk/apply")).toBe(false);
  });

  it("does not follow an in-scope link that matches nothing", () => {
    expect(shouldFollow(target, "https://qahighereducation.com/news/")).toBe(false);
  });

  it("does not follow non-http schemes", () => {
    expect(shouldFollow(target, "mailto:admissions@example.com")).toBe(false);
    expect(shouldFollow(target, "javascript:void(0)")).toBe(false);
  });

  it("follows subdomains of an allowed host", () => {
    expect(shouldFollow(target, "https://apply.qahighereducation.com/s/application")).toBe(true);
  });

  it("follows nothing when no patterns are configured", () => {
    // Seeds only — the conservative default.
    const seedsOnly = parseTarget({ ...VALID, linkPatterns: [] });
    expect(shouldFollow(seedsOnly, "https://qahighereducation.com/apply/")).toBe(false);
  });
});

describe("the real Ulster target file", () => {
  it("parses", async () => {
    // The file Vahid will actually run against. If it is malformed, that must
    // be a test failure here rather than a surprise at run time.
    const raw = await readFile(
      join(import.meta.dirname, "..", "..", "..", "targets", "ulster-birmingham-msc-ib-2026.json"),
      "utf8",
    );
    const target = parseTarget(JSON.parse(raw));

    expect(target.institutionName).toBe("Ulster University");
    expect(target.campus).toBe("Birmingham");
    expect(target.intake).toBe("2026-09");
    expect(target.route).toBe("partner_portal");
    expect(target.allowedHosts).toContain("qahighereducation.com");
    // The claims this run exists to confirm or refute.
    expect(target.claimsToVerify.length).toBeGreaterThan(0);
    expect(target.claimsToVerify.some((c) => c.includes("18 at course start"))).toBe(true);
  });
});
