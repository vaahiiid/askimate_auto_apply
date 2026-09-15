/**
 * The runner's robots.txt gate (P135, distance item 7): read before the
 * browser opens, obeyed, kept for a while, and failing CLOSED when it could
 * not be read (ADR-0091, applied to the fill path).
 */

import { describe, expect, it } from "vitest";

import { MINIMUM_CRAWL_DELAY_MS, RUNNER_AGENT_TOKEN } from "./robots.js";
import { robotsGate } from "./robots-gate.js";

const NOW = new Date("2026-09-15T09:00:00Z");

function serving(bodies: Readonly<Record<string, { status: number; body?: string }>>) {
  const calls: string[] = [];
  const get = (url: string): Promise<Response> => {
    calls.push(url);
    const answer = bodies[url];
    if (answer === undefined) return Promise.reject(new Error(`no route for ${url}`));
    return Promise.resolve(new Response(answer.body ?? "", { status: answer.status, headers: { "content-type": "text/plain" } }));
  };
  return { get, calls };
}

describe("the runner's robots gate", () => {
  it("reads the host's robots.txt once, decides every URL the work will open, and hands back the floor", async () => {
    const { get, calls } = serving({ "https://portal.example/robots.txt": { status: 200, body: "User-agent: *\nDisallow: /private/\nCrawl-delay: 2\n" } });
    const gate = robotsGate({ now: () => NOW, get });
    const verdict = await gate.check(["https://portal.example/apply", "https://portal.example/summary"]);
    expect(verdict.allowed).toBe(true);
    if (!verdict.allowed) expect.unreachable("allowed");
    expect(verdict.delayMs).toBe(2_000);
    expect(calls).toEqual(["https://portal.example/robots.txt"]);
    // Again, within the keep: no second read.
    await gate.check(["https://portal.example/apply"]);
    expect(calls).toHaveLength(1);
  });

  it("refuses a page the file disallows, and says which and why", async () => {
    const { get } = serving({ "https://portal.example/robots.txt": { status: 200, body: "User-agent: *\nDisallow: /private/\n" } });
    const gate = robotsGate({ now: () => NOW, get });
    const verdict = await gate.check(["https://portal.example/apply", "https://portal.example/private/staff-only"]);
    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) expect.unreachable("refused");
    expect(verdict.url).toBe("https://portal.example/private/staff-only");
    expect(verdict.reason).toMatch(/private/);
  });

  it("fails CLOSED when the file could not be read — a run that could not ask has not obeyed", async () => {
    const { get } = serving({ "https://portal.example/robots.txt": { status: 503 } });
    const gate = robotsGate({ now: () => NOW, get });
    const verdict = await gate.check(["https://portal.example/apply"]);
    expect(verdict.allowed).toBe(false);
  });

  it("treats a site with no file as allowing everything, with the floor as the pace", async () => {
    const { get } = serving({ "https://portal.example/robots.txt": { status: 404 } });
    const gate = robotsGate({ now: () => NOW, get });
    const verdict = await gate.check(["https://portal.example/apply"]);
    expect(verdict.allowed).toBe(true);
    if (!verdict.allowed) expect.unreachable("allowed");
    expect(verdict.delayMs).toBe(MINIMUM_CRAWL_DELAY_MS);
  });

  it("re-reads after the keep has passed, and identifies as the runner, not the crawler", async () => {
    const { get, calls } = serving({ "https://portal.example/robots.txt": { status: 200, body: "User-agent: *\nDisallow:\n" } });
    let clock = NOW.getTime();
    const gate = robotsGate({ now: () => new Date(clock), get, keepMs: 60_000 });
    await gate.check(["https://portal.example/apply"]);
    clock += 61_000;
    await gate.check(["https://portal.example/apply"]);
    expect(calls).toHaveLength(2);
    expect(RUNNER_AGENT_TOKEN).toBe("askimate-aas-runner");
  });
});
