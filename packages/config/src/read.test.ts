/**
 * The reader that decides whether a process may start.
 *
 * Its two properties are both about the operator reading a failed deploy: every
 * problem arrives at once, and no value ever does.
 */

import { describe, expect, it } from "vitest";

import { ConfigError, isProduction, readConfig } from "./read.js";

describe("reading a configuration", () => {
  it("builds one when the environment is complete", () => {
    const config = readConfig({ A: "hello", P: "4000", U: "https://x.test" }, (r) => ({
      a: r.string("A"),
      p: r.int("P", { min: 1, max: 65_535 }),
      u: r.url("U", { httpsInProduction: true }),
    }));
    expect(config).toEqual({ a: "hello", p: 4000, u: "https://x.test" });
  });

  it("reports EVERY problem at once, not the first", () => {
    // ═══════════════════════════════════════════════════════════════════
    // The property that decides whether configuring a service is one round
    // trip or five. A reader that threw on the first missing variable would
    // make an operator discover the list one deploy at a time.
    // ═══════════════════════════════════════════════════════════════════
    let error: unknown;
    try {
      readConfig({}, (r) => ({
        a: r.string("A"),
        b: r.string("B"),
        p: r.int("P"),
        u: r.url("U"),
      }));
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ConfigError);
    const problems = (error as ConfigError).problems;
    expect(problems.map((p) => p.variable)).toEqual(["A", "B", "P", "U"]);
  });

  it("NEVER puts a value in the message", () => {
    // ═══════════════════════════════════════════════════════════════════
    // These variables carry a session-signing secret and two database URLs
    // with credentials in them, and this message reaches the log of whatever
    // caught the startup failure.
    // ═══════════════════════════════════════════════════════════════════
    const secret = "hunter2-not-long-enough";
    const dsn = "postgresql://user:s3cr3t@db.internal/aas";
    let error: unknown;
    try {
      readConfig({ AAS_SESSION_SECRET: secret, AAS_DATABASE_URL: dsn }, (r) => ({
        s: r.string("AAS_SESSION_SECRET", { minLength: 64 }),
        d: r.url("AAS_DATABASE_URL", { schemes: ["https:"] }),
      }));
    } catch (caught) {
      error = caught;
    }
    const message = (error as Error).message;
    expect(message, "the secret").not.toContain(secret);
    expect(message, "the password inside the DSN").not.toContain("s3cr3t");
    expect(message, "the whole DSN").not.toContain(dsn);
    // What it DOES say is enough to act on.
    expect(message).toContain("AAS_SESSION_SECRET");
    expect(message).toContain("at least 64 characters");
  });

  it("names the value for a CLOSED SET, where there is nothing to leak", () => {
    // The one exception, and it earns itself: "you wrote 'fixture', the choices
    // are 'fixtures'" is the most useful thing this error can say, and a closed
    // set of literals has no secret in it.
    let error: unknown;
    try {
      readConfig({ AAS_CATALOGUE: "fixture" }, (r) => ({
        c: r.choice("AAS_CATALOGUE", ["fixtures"] as const),
      }));
    } catch (caught) {
      error = caught;
    }
    expect((error as Error).message).toContain('got "fixture"');
  });

  it("treats whitespace and empty strings as ABSENT", () => {
    // An orchestrator that sets an unset variable to "" is common, and a
    // service that accepted it would start with an empty session secret.
    let error: unknown;
    try {
      readConfig({ A: "   ", B: "" }, (r) => ({ a: r.string("A"), b: r.string("B") }));
    } catch (caught) {
      error = caught;
    }
    expect((error as ConfigError).problems.map((p) => p.variable)).toEqual(["A", "B"]);
  });

  it("requires https in production, and allows http outside it", () => {
    const build = (r: Parameters<Parameters<typeof readConfig>[1]>[0]): unknown => ({
      u: r.url("U", { httpsInProduction: true }),
    });
    expect(() => readConfig({ U: "http://localhost:4000" }, build)).not.toThrow();
    expect(() =>
      readConfig({ NODE_ENV: "production", U: "http://localhost:4000" }, build),
    ).toThrow(/must be https in production/);
    expect(() =>
      readConfig({ NODE_ENV: "production", U: "https://app.test" }, build),
    ).not.toThrow();
  });

  it("lets a caller refuse a configuration that is unsafe rather than malformed", () => {
    // A development control enabled in production is not a shape problem, and
    // it belongs in the same report — to an operator it is the same kind of news.
    expect(() =>
      readConfig({ NODE_ENV: "production", AAS_DEV_SESSION: "1" }, (r) => {
        const dev = r.flag("AAS_DEV_SESSION");
        if (dev && r.production) r.refuse("AAS_DEV_SESSION", "must not be set in production");
        return { dev };
      }),
    ).toThrow(/must not be set in production/);
  });

  it("knows what production is, in one place", () => {
    expect(isProduction("production")).toBe(true);
    expect(isProduction("staging")).toBe(false);
    expect(isProduction(undefined)).toBe(false);
  });
});
