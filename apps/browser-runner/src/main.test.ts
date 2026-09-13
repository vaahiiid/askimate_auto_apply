/**
 * The runner's REAL entry point, started as the deployable starts it — no
 * injected browser — and asked the one question every credential fill
 * depends on: does the CDP endpoint it declares to the Fill Agent answer?
 *
 * Found while writing the local-stack runbook (P120). `AAS_BROWSER_CDP_URL`
 * is documented as "its own browser's CDP endpoint, as the agent will dial
 * it", the performer hands that URL to the agent, and every test that drove a
 * runner injected a browser launched with a remote-debugging port. Nothing
 * exercised the launch the entry point itself makes.
 */

import { afterEach, describe, expect, it } from "vitest";

import { start, type RunningRunner } from "./main.js";

const CDP_PORT = 9877;
const CDP_URL = `http://127.0.0.1:${String(CDP_PORT)}`;

const ENV: Record<string, string> = {
  // Nobody listens on these: the supervisor's first poll fails and is logged
  // as a turn; the browser is what this test is about.
  AAS_CONVERSATION_INTERNAL_URL: "http://127.0.0.1:1",
  AAS_RUNNER_SERVICE_TOKEN: "browser-runner",
  AAS_RUNNER_HOLDER: "runner-main-test",
  AAS_AGENT_INTERNAL_URL: "http://127.0.0.1:1",
  AAS_RUNNER_SERVICE_TOKEN_AGENT: "browser-runner",
  AAS_BROWSER_CDP_URL: CDP_URL,
  AAS_RUNNER_IDLE_MS: "60000",
};

describe("the runner's entry point", () => {
  let running: RunningRunner | undefined;

  afterEach(async () => {
    await running?.close();
    running = undefined;
  });

  it("launches a browser that ANSWERS at the CDP endpoint it declares to the Fill Agent", async () => {
    running = await start({ env: ENV, log: () => undefined });
    expect(running.config.browserCdpUrl).toBe(CDP_URL);
    const answer = await fetch(`${CDP_URL}/json/version`);
    expect(answer.status).toBe(200);
    const version = (await answer.json()) as { webSocketDebuggerUrl?: string };
    expect(version.webSocketDebuggerUrl).toMatch(/^ws:\/\/127\.0\.0\.1:9877\//);
  }, 60_000);

  it("REFUSES a CDP URL with no port — an endpoint nothing could dial", async () => {
    await expect(start({ env: { ...ENV, AAS_BROWSER_CDP_URL: "http://127.0.0.1" }, log: () => undefined })).rejects.toThrow(
      /AAS_BROWSER_CDP_URL/,
    );
  }, 30_000);
});
