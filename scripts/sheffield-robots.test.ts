/**
 * Sheffield's robots.txt, evaluated by the runner's own matcher (distance item 7).
 *
 * Vahid read `https://www.sheffield.ac.uk/robots.txt` on 2026-09-13 and pasted the
 * body whole on 2026-09-14; it is kept verbatim beside the capture. He asked for
 * two things to be checked by the matcher rather than by his reading: that the
 * form's paths under `/postgradapplication/` are allowed, and specifically that
 * the three Drupal disallows for `/user/login`, `/user/register` and
 * `/user/password` do not reach the form's sign-in, registration and
 * forgotten-password paths, which are the same kind of act at a different path.
 * And that with no Crawl-delay the one-second floor is ours (ADR-0091).
 *
 * The status line was not pasted, so the policy is built as a fetched 200
 * body. A live run reads the file itself (P123) and would refuse on anything
 * else.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  MINIMUM_CRAWL_DELAY_MS,
  ROBOTS_AGENT_TOKEN,
  crawlDelayMs,
  decideAgainstRobots,
  groupFor,
  parseRobots,
  type RobotsPolicy,
} from "@askimate/aas-browser-runner";

const HOST = "www.sheffield.ac.uk";
const BODY = readFileSync(join(import.meta.dirname, "..", "docs", "captures", "sheffield-pgt-2026-09-10", "robots.txt"), "utf8");

const groups = parseRobots(BODY);
const policy: RobotsPolicy = {
  kind: "fetched",
  host: HOST,
  fetchedAt: new Date("2026-09-13T00:00:00Z"),
  statusCode: 200,
  body: BODY,
  groups,
  applicable: groupFor(groups, ROBOTS_AGENT_TOKEN),
};

/** The eleven observed pages, the entry, and the forgotten-password page he named. */
const FORM_PATHS = [
  "/postgradapplication/",
  "/postgradapplication/overview.do",
  "/postgradapplication/summary.do",
  "/postgradapplication/personal.do",
  "/postgradapplication/contact.do",
  "/postgradapplication/nationality.do",
  "/postgradapplication/language.app",
  "/postgradapplication/education.do?new=true",
  "/postgradapplication/employment.do",
  "/postgradapplication/equalOpportunities.do",
  "/postgradapplication/marketing.do",
  "/postgradapplication/documents.do",
  "/postgradapplication/forgottenPassword.do",
];

describe("Sheffield's robots.txt, as the runner reads it", () => {
  it("is one group, addressed to everyone, with no Crawl-delay", () => {
    expect(groups).toHaveLength(1);
    expect(groups[0]?.agents).toEqual(["*"]);
    expect(groups[0]?.crawlDelaySeconds).toBeNull();
    expect(policy.applicable, "the * group is the one that applies to us").not.toBeNull();
  });

  it("allows every observed path of the form, by no rule matching", () => {
    for (const path of FORM_PATHS) {
      const decision = decideAgainstRobots(policy, `https://${HOST}${path}`);
      expect(decision.allowed, path).toBe(true);
      expect(decision.rule, `${path}: allowed because nothing matches, not because an Allow won`).toBeNull();
    }
  });

  it("the /user/* disallows are live in the matcher, and do not reach the form's sign-in, registration or password paths", () => {
    // The rules are real: the matcher refuses the paths they name.
    for (const path of ["/user/login", "/user/register", "/user/password", "/index.php/user/login"]) {
      const decision = decideAgainstRobots(policy, `https://${HOST}${path}`);
      expect(decision.allowed, path).toBe(false);
      expect(decision.rule?.pattern).toBe(path);
    }
    // And they are path rules, nothing more: the form's own sign-in and
    // registration live under /postgradapplication/, which no pattern touches.
    for (const path of ["/postgradapplication/", "/postgradapplication/forgottenPassword.do"]) {
      expect(decideAgainstRobots(policy, `https://${HOST}${path}`).rule).toBeNull();
    }
  });

  it("the one-second floor is ours: the file states no delay and the floor cannot be lowered", () => {
    expect(crawlDelayMs(policy, 0)).toBe(MINIMUM_CRAWL_DELAY_MS);
    expect(crawlDelayMs(policy, 2_000)).toBe(2_000);
  });
});
